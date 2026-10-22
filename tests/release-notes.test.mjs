import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  RELEASE_NOTE_LOCALES,
  ReleaseNotesApi,
  selectLocale,
} from "../server/release-notes.mjs";

test("release-note locale negotiation covers the ten product locales", () => {
  assert.deepEqual(RELEASE_NOTE_LOCALES, [
    "en", "zh-CN", "hi", "es", "ar", "fr", "bn", "pt", "id", "ur",
  ]);
  assert.equal(selectLocale("pt-BR", new Headers()), "pt");
  assert.equal(selectLocale("zh-Hans", new Headers()), "zh-CN");
  assert.equal(selectLocale("zh-Hant-TW", new Headers()), "en");
  assert.equal(
    selectLocale(null, new Headers({ "Accept-Language": "zh-TW, fr-FR;q=0.8" })),
    "fr",
  );
  assert.equal(
    selectLocale(null, new Headers({ "Accept-Language": "de;q=0.9, ur-PK;q=0.8, en;q=0.7" })),
    "ur",
  );
  assert.equal(
    selectLocale(null, new Headers({ "Accept-Language": "ar;q=0., fr;q=1." })),
    "fr",
  );
  assert.equal(
    selectLocale(null, new Headers({ "Accept-Language": "ar;q=0.1234, es;q=0.8" })),
    "es",
  );
  assert.equal(selectLocale(null, new Headers({ "Accept-Language": "de" })), "en");
});

const execFileAsync = promisify(execFile);

test("public release notes return only normalized published copy for the requested locale", async () => {
  const fixture = createDatabase([
    {
      _id: "0.3.0",
      published_at: new Date("2026-08-10T12:00:00.000Z"),
      platforms: ["web", "server", "android", "unknown", "web"],
      copy: {
        zh: { title: "  实时体验更新  ", items: ["状态同步更及时", "  手机布局更清晰  "] },
        en: { title: "Realtime improvements", items: ["Faster status sync", "Clearer mobile layouts"] },
      },
      internal_comment: "never expose deployment-only fields",
    },
    {
      _id: "invalid-copy",
      published_at: new Date("2026-08-09T12:00:00.000Z"),
      platforms: ["web"],
      copy: { zh: { title: "不完整", items: [] } },
    },
  ]);
  const api = new ReleaseNotesApi(fixture.db);
  await api.initialize();

  const response = await api.handle(
    new Request("https://relay.test/api/release-notes?locale=zh-CN"),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-language"), "zh-CN");
  assert.equal(response.headers.get("vary"), "Accept-Language");
  assert.match(response.headers.get("cache-control"), /s-maxage=300/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), {
    locale: "zh-CN",
    releases: [
      {
        version: "0.3.0",
        publishedAt: "2026-08-10T12:00:00.000Z",
        platforms: ["web", "server", "android"],
        locale: "zh-CN",
        title: "实时体验更新",
        items: ["状态同步更及时", "手机布局更清晰"],
      },
    ],
  });
  assert.deepEqual(fixture.index, {
    key: { published_at: -1 },
    options: { name: "relay_release_notes_published_idx" },
  });
  assert.equal(fixture.query.published_at.$lte instanceof Date, true);
  assert.deepEqual(fixture.sort, { published_at: -1, _id: -1 });
  assert.equal(fixture.limit, 50);
  assert.equal(fixture.projection.internal_comment, undefined);
});

test("release notes identify the actual language when localized copy falls back", async () => {
  const fixture = createDatabase([
    {
      _id: "0.3.1",
      published_at: new Date("2026-08-11T12:00:00.000Z"),
      platforms: ["web"],
      copy: {
        zh: { title: "更新", items: ["改进"] },
        en: { title: "Update", items: ["Improvement"] },
      },
    },
  ]);
  const response = await new ReleaseNotesApi(fixture.db).handle(
    new Request("https://relay.test/api/release-notes?locale=ar"),
  );
  const body = await response.json();
  assert.equal(body.locale, "ar");
  assert.equal(body.releases[0].locale, "en");
  assert.equal(body.releases[0].title, "Update");
});

test("release notes API is read-only and does not claim unrelated routes", async () => {
  const fixture = createDatabase([]);
  const api = new ReleaseNotesApi(fixture.db);

  assert.equal(
    await api.handle(new Request("https://relay.test/api/bootstrap")),
    null,
  );

  const rejected = await api.handle(
    new Request("https://relay.test/api/release-notes", { method: "POST" }),
  );
  assert.equal(rejected.status, 405);
  assert.equal(rejected.headers.get("allow"), "GET, HEAD");
  assert.equal(fixture.finds, 0);

  const head = await api.handle(
    new Request("https://relay.test/api/release-notes", {
      method: "HEAD",
      headers: { "Accept-Language": "en-US,en;q=0.9" },
    }),
  );
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-language"), "en");
  assert.equal(await head.text(), "");
});

test("localized changelog pages fetch release notes accessibly and delegate canonical metadata", async () => {
  const [source, metadata, zhPage, enPage, localizedPage, server] = await Promise.all([
    readFile("app/changelog/changelog-page.tsx", "utf8"),
    readFile("app/changelog/changelog-metadata.ts", "utf8"),
    readFile("app/zh/changelog/page.tsx", "utf8"),
    readFile("app/en/changelog/page.tsx", "utf8"),
    readFile("app/[locale]/changelog/page.tsx", "utf8"),
    readFile("server/self-hosted.ts", "utf8"),
  ]);

  assert.match(source, /fetch\(`\/api\/release-notes\?locale=/);
  assert.match(source, /aria-busy=/);
  assert.match(source, /role="status"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /<time dateTime=/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(zhPage, /metadata = changelogMetadata\("zh-CN"\)/);
  assert.match(enPage, /metadata = changelogMetadata\("en"\)/);
  assert.match(localizedPage, /return locale \? changelogMetadata\(locale\) : \{\}/);
  assert.match(metadata, /const canonical = `\$\{ORIGIN\}\$\{localePath\(locale, "changelog"\)\}`/);
  assert.match(server, /if \(pathname === "\/api\/release-notes"\)/);
  assert.match(server, /await releaseNotesApi\.initialize\(\)/);
  assert.doesNotMatch(server, /api\/release-notes[^\n]*(?:POST|PUT|PATCH|DELETE)/);
});

test("release manifest CLI validates 0.2.6 without Mongo and production build bundles the idempotent writer", async () => {
  const [{ stdout, stderr }, packageSource, buildSource, cliSource, bundleSource] = await Promise.all([
    execFileAsync(
      process.execPath,
      ["scripts/publish-release-notes.mjs", "release-notes/0.2.6.json", "--dry-run"],
      { cwd: process.cwd() },
    ),
    readFile("package.json", "utf8"),
    readFile("scripts/build-self-hosted.mjs", "utf8"),
    readFile("scripts/publish-release-notes.mjs", "utf8"),
    readFile("scripts/build-server-bundles.mjs", "utf8"),
  ]);

  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), {
    ok: true,
    dry_run: true,
    version: "0.2.6",
  });
  const packageJson = JSON.parse(packageSource);
  assert.equal(
    packageJson.scripts["release-notes:publish"],
    "node scripts/publish-release-notes.mjs",
  );
  assert.match(packageJson.scripts["build:self-hosted"], /node scripts\/build-server-bundles\.mjs/);
  assert.match(bundleSource, /scripts\/publish-release-notes\.mjs.*publish-release-notes\.cjs/);
  assert.match(buildSource, /path\.join\(root, "release-notes"\)/);
  assert.match(cliSource, /replaceOne\([\s\S]*?upsert: true/);
  assert.match(cliSource, /MONGO_HOST must remain loopback-only/);
  assert.doesNotMatch(cliSource, /console\.log|password.*stdout/i);
});

test("release manifest CLI rejects undeclared fields before reading Mongo credentials", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relayune-release-notes-"));
  const filename = path.join(temporary, "invalid.json");
  try {
    await writeFile(
      filename,
      JSON.stringify({
        version: "0.2.6",
        publishedAt: "2026-08-10T00:00:00.000Z",
        platforms: ["web"],
        copy: {
          zh: { title: "版本", items: ["更新"] },
          en: { title: "Release", items: ["Update"] },
        },
        deploymentSecret: "must-not-be-stored",
      }),
    );
    await assert.rejects(
      execFileAsync(
        process.execPath,
        ["scripts/publish-release-notes.mjs", filename, "--dry-run"],
        { cwd: process.cwd() },
      ),
      (error) => {
        assert.match(error.stderr, /Release manifest keys must be/);
        assert.doesNotMatch(error.stderr, /must-not-be-stored/);
        return true;
      },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

function createDatabase(rows) {
  const state = {
    db: {
      collection(name) {
        assert.equal(name, "relay_release_notes");
        return {
          async createIndex(key, options) {
            state.index = { key, options };
            return options.name;
          },
          find(query, { projection }) {
            state.finds += 1;
            state.query = query;
            state.projection = projection;
            return {
              sort(value) {
                state.sort = value;
                return this;
              },
              limit(value) {
                state.limit = value;
                return this;
              },
              async toArray() {
                return rows;
              },
            };
          },
        };
      },
    },
    finds: 0,
    index: null,
    query: null,
    projection: null,
    sort: null,
    limit: null,
  };
  return state;
}
