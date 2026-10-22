import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Use the same entry and bundle mode as prepare-sidecar: retired integrations
// must not ship, even if a user's environment still contains their credentials.
test("desktop Relay bundle does not ship the retired Feishu connector or SDK", async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../relay/cli.mjs", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  assert.deepEqual(
    Object.keys(result.metafile.inputs).filter((path) => /feishu|larksuite/i.test(path)),
    [],
  );
  assert.doesNotMatch(result.outputFiles[0].text, /RELAY_FEISHU_CONFIG|verify-feishu-credentials|verify-feishu-connection/);
});
