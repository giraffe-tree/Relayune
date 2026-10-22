import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const placeholders = (value) =>
  [...String(value).matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort();

test("all eight additional workbench catalogs are complete and preserve placeholders", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-workbench-complete-"));
  const outfile = join(temporary, "workbench-language.mjs");
  try {
    await build({
      entryPoints: ["app/workbench-language.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile,
      logLevel: "silent",
    });
    const language = await import(`${pathToFileURL(outfile).href}?${Date.now()}`);
    for (const locale of ["hi", "es", "ar", "fr", "bn", "pt", "id", "ur"]) {
      assert.deepEqual(language.WORKBENCH_TRANSLATION_COVERAGE[locale], {
        translated: language.WORKBENCH_COPY_KEYS.length,
        total: language.WORKBENCH_COPY_KEYS.length,
      });
      for (const key of language.WORKBENCH_COPY_KEYS) {
        assert.deepEqual(
          placeholders(language.workbenchText(locale, key)),
          placeholders(language.workbenchText("en", key)),
          `${locale}.${key}`,
        );
      }
    }
    const urduTechnicalTokens = new Map([
      ["protocolDocsToast", ["docs/codex-relay-interaction-sequence.md"]],
      ["ackAndQueue", ["ACK"]],
      ["idleComposerHint", ["Idempotency-Key", "SSE", "Enter"]],
      ["attachmentTypeUnsupported", ["PNG", "JPEG", "WebP", "GIF", "AVIF"]],
      ["attachmentTooLarge", ["20 MiB"]],
      ["approvalEmptyDetail", ["SHA-256"]],
      ["encryptedRuntimeSettingsNote", ["session.configure", "Server"]],
      ["modeConfigDescription", ["Plan", "Auto", "YOLO"]],
      ["kimiSettingsDescription", ["Web", "TUI"]],
      ["toolAgentSwarm", ["AgentSwarm"]],
    ]);
    for (const [key, tokens] of urduTechnicalTokens) {
      const value = language.workbenchText("ur", key);
      for (const token of tokens) {
        assert.ok(value.includes(token), `ur.${key} must preserve ${token}`);
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
