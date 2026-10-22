import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

async function loadAbortHelper() {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-web-abort-"));
  const output = join(temporary, "abort-signal.mjs");
  await build({
    entryPoints: ["shared/abort-signal.ts"],
    bundle: true,
    platform: "browser",
    format: "esm",
    outfile: output,
    logLevel: "silent",
  });
  return {
    helper: await import(`${pathToFileURL(output).href}?${Date.now()}`),
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}

test("Safari 16-compatible cancellation follows either request signal", async () => {
  const bundled = await loadAbortHelper();
  try {
    const first = new AbortController();
    const second = new AbortController();
    const combined = bundled.helper.combineAbortSignals([
      first.signal,
      second.signal,
    ]);
    assert.equal(combined.signal.aborted, false);
    second.abort();
    assert.equal(combined.signal.aborted, true);

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    assert.equal(
      bundled.helper.combineAbortSignals([alreadyAborted.signal]).signal.aborted,
      true,
    );
  } finally {
    await bundled.cleanup();
  }
});

test("completed requests detach from a long-lived caller signal", async () => {
  const bundled = await loadAbortHelper();
  try {
    const caller = new AbortController();
    const timeout = new AbortController();
    const combined = bundled.helper.combineAbortSignals([
      caller.signal,
      timeout.signal,
    ]);
    combined.dispose();
    caller.abort();
    assert.equal(combined.signal.aborted, false);
  } finally {
    await bundled.cleanup();
  }
});

test("Web API requests use the compatible helper and always dispose it", async () => {
  const [page, helper] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("shared/abort-signal.ts", "utf8"),
  ]);
  assert.doesNotMatch(page, /AbortSignal\.any\s*\(\s*\[/);
  assert.doesNotMatch(helper, /AbortSignal\.any\s*\(\s*\[/);
  assert.match(
    page,
    /combineAbortSignals\(\[requestOptions\.signal, timeout\.signal\]\)/,
  );
  assert.match(page, /combinedSignal\?\.dispose\(\);/);
});
