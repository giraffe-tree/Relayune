import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import vm from "node:vm";
import { build } from "esbuild";

async function loadBootstrap() {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-not-found-"));
  const bundle = join(temporary, "not-found-bootstrap.mjs");
  await build({
    entryPoints: ["app/not-found-bootstrap.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: bundle,
    logLevel: "silent",
  });
  const compiled = await import(`${pathToFileURL(bundle).href}?${Date.now()}`);
  return {
    bootstrap: compiled.NOT_FOUND_BOOTSTRAP,
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}

function runBootstrap(bootstrap, { pathname, languages, saved }) {
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) {
      nodes.set(selector, {
        attributes: new Map(),
        textContent: "",
        focusOptions: null,
        setAttribute(name, value) {
          this.attributes.set(name, value);
        },
        focus(options) {
          this.focusOptions = options;
        },
      });
    }
    return nodes.get(selector);
  };
  const body = {};
  const document = {
    activeElement: body,
    body,
    documentElement: { lang: "zh-CN" },
    title: "404 | Relayune",
    querySelector: node,
  };
  vm.runInNewContext(bootstrap, {
    document,
    navigator: { languages },
    window: {
      location: { pathname },
      localStorage: { getItem: () => saved },
    },
  });
  return { document, node };
}

test("404 chooses the path language before stored or browser preferences", async () => {
  const loaded = await loadBootstrap();
  try {
    const english = runBootstrap(loaded.bootstrap, {
      pathname: "/en/missing",
      languages: ["zh-CN"],
      saved: "zh-CN",
    });
    assert.equal(english.document.documentElement.lang, "en");
    assert.equal(
      english.node('[data-not-found-link="home"]').attributes.get("href"),
      "/en/",
    );

    const chinese = runBootstrap(loaded.bootstrap, {
      pathname: "/zh/missing",
      languages: ["en-US"],
      saved: "en",
    });
    assert.equal(chinese.document.documentElement.lang, "zh-CN");
    assert.equal(
      chinese.node('[data-not-found-link="home"]').attributes.get("href"),
      "/zh/",
    );
    assert.notEqual(
      chinese.node('[data-not-found-copy="heading"]').textContent,
      "",
    );
    assert.equal(
      chinese.node('[data-not-found-copy="heading"]').focusOptions
        ?.preventScroll,
      true,
    );
  } finally {
    await loaded.cleanup();
  }
});

test("404 localizes all ten routes and keeps recovery links in the active locale", async () => {
  const loaded = await loadBootstrap();
  const localePaths = {
    en: "en", "zh-CN": "zh", hi: "hi", es: "es", ar: "ar",
    fr: "fr", bn: "bn", pt: "pt", id: "id", ur: "ur",
  };
  try {
    for (const [locale, path] of Object.entries(localePaths)) {
      const rendered = runBootstrap(loaded.bootstrap, {
        pathname: `/${path}/missing`,
        languages: ["en-US"],
        saved: "en",
      });
      assert.equal(rendered.document.documentElement.lang, locale);
      assert.equal(
        rendered.document.documentElement.dir,
        locale === "ar" || locale === "ur" ? "rtl" : "ltr",
      );

      assert.equal(
        rendered.node('[data-not-found-link="terms"]').attributes.get("href"),
        `/${path}/legal/terms/`,
      );
      assert.ok(rendered.node('[data-not-found-copy="heading"]').textContent.trim());
      assert.ok(rendered.document.title.includes("Relayune"));
    }
  } finally {
    await loaded.cleanup();
  }
});

test("404 does not mislabel unsupported Traditional Chinese as Simplified Chinese", async () => {
  const loaded = await loadBootstrap();
  try {
    const fallback = runBootstrap(loaded.bootstrap, {
      pathname: "/missing",
      languages: ["zh-TW"],
      saved: "zh-Hant-TW",
    });
    assert.equal(fallback.document.documentElement.lang, "en");
    assert.equal(
      fallback.node('[data-not-found-link="home"]').attributes.get("href"),
      "/en/",
    );
  } finally {
    await loaded.cleanup();
  }
});

test("404 source provides recovery without shared client or stylesheet boundaries", async () => {
  const [page, bootstrap] = await Promise.all([
    readFile("app/not-found.tsx", "utf8"),
    readFile("app/not-found-bootstrap.ts", "utf8"),
  ]);

  assert.match(page, /data-not-found-link="home"/);
  assert.doesNotMatch(page, /data-not-found-link="pricing"/);
  assert.match(page, /data-not-found-link="terms"/);
  assert.match(page, /data-not-found-link="privacy"/);
  assert.match(page, /tabIndex=\{-1\}/);
  assert.doesNotMatch(page, /"use client"|useEffect|not-found[.]module[.]css/);
  assert.match(page, /import Link from "next\/link"/);
  assert.match(bootstrap, /document\.activeElement === document\.body/);
  assert.doesNotMatch(bootstrap, /location\.(?:search|hash)/);
  assert.match(page, /@media\(max-width:420px\)/);
  assert.match(page, /\.not-found-actions a\{min-height:44px/);
  assert.match(page, /overflow-wrap:anywhere/);
});
