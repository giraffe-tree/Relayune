import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { restoreFailedComposerDraft } from "../app/composer-draft-recovery.mjs";

// Execute the actual component callbacks with deferred delivery, without mocking
// their draft update logic or requiring a live encrypted relay connection.
const source = await readFile(new URL("../app/workbench-page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("workbench.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let sendSource;
let draftSource;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "sendMessage") sendSource = node.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "setDraft") draftSource = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(sendSource && draftSource);
const code = ts.transpile(`const setDraft = ${draftSource};\n${sendSource}\nreturn { sendMessage, setDraft };`, { target: ts.ScriptTarget.ES2022 });

function harness() {
  let drafts = { a: "original", b: "other session" };
  let attachments = { a: [{ id: "image", previewUrl: "blob:original" }] };
  let accept;
  let reject;
  const delivery = new Promise((resolve, fail) => { accept = resolve; reject = fail; });
  const inFlight = { current: false };
  let sends = 0;
  function render(sessionId) {
    const context = {
      activeSession: sessionId, draft: drafts[sessionId] ?? "",
      pendingAttachments: attachments[sessionId] ?? [], current: { id: sessionId },
      isRunning: false, supportsSteering: true, canInterrupt: false,
      agentName: "Agent", authLocale: "en", deviceOnline: true,
      useCallback: (callback) => callback,
      setDraftMap: (update) => { drafts = update(drafts); },
      setPendingAttachmentMap: (update) => { attachments = update(attachments); },
      messageSendInFlight: inFlight, setSendingMessage: () => {}, setToast: () => {},
      workbenchText: (_locale, key) => key, restoreFailedComposerDraft,
      window: { requestAnimationFrame: (callback) => callback() }, composerInput: { current: null },
      crypto: { randomUUID: () => "test-id" }, URL: { revokeObjectURL: () => {} },
      sendEncryptedCommand: () => { sends += 1; return delivery; }, refreshWithStatus: async () => {},
    };
    return new Function(...Object.keys(context), code)(...Object.values(context));
  }
  return { render, accept, reject, drafts: () => drafts, attachments: () => attachments, sends: () => sends, addAttachment: (sessionId, attachment) => { attachments = { ...attachments, [sessionId]: [...(attachments[sessionId] ?? []), attachment] }; } };
}
const event = { preventDefault() {} };

test("late failure restores to the original session and keeps text typed in both sessions", async () => {
  const state = harness();
  const sending = state.render("a").sendMessage(event);
  assert.equal(state.drafts().a, undefined);
  state.render("a").setDraft("next message");
  state.addAttachment("a", { id: "new-image", previewUrl: "blob:new" });
  state.render("b").setDraft("edited other session");
  state.reject(new Error("delivery failed"));
  await sending;
  assert.deepEqual(state.drafts().a.split(String.fromCharCode(10)), ["original", "", "next message"]);
  assert.equal(state.drafts().b, "edited other session");
  assert.deepEqual(state.attachments().a.map((attachment) => attachment.id), ["image", "new-image"]);
});

test("successful delivery preserves the next draft and a second send stays guarded", async () => {
  const state = harness();
  const sending = state.render("a").sendMessage(event);
  state.render("a").setDraft("next message");
  await state.render("a").sendMessage(event);
  assert.equal(state.sends(), 1);
  state.accept({ delivery: "delivered" });
  await sending;
  assert.equal(state.drafts().a, "next message");
});
