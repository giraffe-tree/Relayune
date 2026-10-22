import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

const directory = await mkdtemp(join(tmpdir(), "web-read-callbacks-"));
await build({ entryPoints: { e2ee: "app/e2ee.ts", "online-stream": "app/online-stream.ts", "workbench-entry": "app/workbench-entry.ts", "abort-signal": "shared/abort-signal.ts", "instance-client": "app/instance-client.ts" }, bundle: true, platform: "node", format: "esm", outdir: directory, outExtension: { ".js": ".mjs" }, logLevel: "silent" });
export const { importRelayKey, openJson, sealJson } = await import(pathToFileURL(join(directory, "e2ee.mjs")));
export const { OnlineStream, ONLINE_READ_TYPES, readOnlineOrHttp } = await import(pathToFileURL(join(directory, "online-stream.mjs")));
export const { combineAbortSignals } = await import(pathToFileURL(join(directory, "abort-signal.mjs")));
export const { isBrowserAuthorizationLost } = await import(pathToFileURL(join(directory, "workbench-entry.mjs")));
const { sameOriginApiUrl } = await import(pathToFileURL(join(directory, "instance-client.mjs")));
export const cleanupReadCallbacks = () => rm(directory, { recursive: true, force: true });

// Execute production callbacks with real A256GCM; transport fixtures control
// delivery without duplicating the read's sealing or response authentication.
const source = await readFile(new URL("../../app/workbench-page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("workbench.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map();
const support = [];
const apiSupport = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ["api", "isBrowserAuthorizedPath"].includes(node.name?.text)) apiSupport.push(node.getText(ast));
  if ((ts.isClassDeclaration(node) && node.name?.text === "RelayApiError") ||
      (ts.isFunctionDeclaration(node) && node.name?.text === "isPendingRelayResponse")) support.push(node.getText(ast));
  if (ts.isVariableDeclaration(node) && ["sendEncryptedCommand", "waitForEncryptedResponse"].includes(node.name.getText(ast)))
    callbacks.set(node.name.getText(ast), node.initializer.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(callbacks.size, 2);
export const { RelayApiError, isPendingRelayResponse } = new Function(ts.transpile(support.join("\n") + "\nreturn {RelayApiError,isPendingRelayResponse};", { target: ts.ScriptTarget.ES2022 }))();
const code = ts.transpile([...callbacks].map(([name, callback]) => `const ${name} = ${callback};`).join("\n") + "\nreturn { sendEncryptedCommand, waitForEncryptedResponse };", { target: ts.ScriptTarget.ES2022 });
export function createReadCallbacks(context) {
  return new Function(...Object.keys(context), code)(...Object.values(context));
}
const apiCode = ts.transpile(apiSupport.join("\n") + "\nreturn api;", { target: ts.ScriptTarget.ES2022 });
export function createWebApi(context) {
  context = { sameOriginApiUrl, ...context, window: { ...context.window, location: context.window.location ?? { origin: new URL(context.API_BASE).origin } } };
  return new Function(...Object.keys(context), apiCode)(...Object.values(context));
}
