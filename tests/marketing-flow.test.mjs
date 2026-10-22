import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

async function loadFlow() {
  const directory = await mkdtemp(join(tmpdir(), "relayune-membership-flow-"));
  const output = join(directory, "flow.mjs");
  await build({ stdin: { contents: `
    export { marketingFlowCopy, withMarketingFlowCopy } from "./app/marketing-flow-copy";
    export { enMarketingCopy } from "./app/marketing-copy";
    export { SUPPORTED_LOCALES, localePath, localeDirection } from "./app/supported-locales";
  `, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", outfile: output, logLevel: "silent" });
  return { module: await import(pathToFileURL(output).href), cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test("marketing journey stays localized while preserving independent client authorization", async () => {
  const loaded = await loadFlow();
  try {
    const { SUPPORTED_LOCALES, marketingFlowCopy, withMarketingFlowCopy, enMarketingCopy } = loaded.module;
    for (const locale of SUPPORTED_LOCALES) {
      const copy = withMarketingFlowCopy(enMarketingCopy, locale);
      assert.equal(copy.howSteps.length, 3);
      assert.equal(copy.howDescription, marketingFlowCopy[locale].intro);
      assert.ok(marketingFlowCopy[locale].steps.every((value) => value.trim()));
      assert.doesNotMatch([copy.howDescription, copy.securityDescription, ...copy.howSteps.map((step) => step.description)].join(" "), /vault|SPAKE2|A256GCM|密钥协商|handshake/);
      assert.equal(copy.heroScenarios, enMarketingCopy.heroScenarios, "preserve the existing demonstration");
    }
    assert.match(marketingFlowCopy.en.intro, /Each new client needs its own authorization after sign-in/);
    assert.match(marketingFlowCopy["zh-CN"].intro, /每个新客户端仍需单独授权/);
  } finally { await loaded.cleanup(); }
});
