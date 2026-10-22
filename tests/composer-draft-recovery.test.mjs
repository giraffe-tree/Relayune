import assert from "node:assert/strict";
import test from "node:test";
import { restoreFailedComposerDraft } from "../app/composer-draft-recovery.mjs";

test("late send failure preserves the next message after the original draft", () => {
  assert.deepEqual(restoreFailedComposerDraft("first message", "next message").split(String.fromCharCode(10)), ["first message", "", "next message"]);
});

test("send failure restores original whitespace and incomplete formatting", () => {
  assert.equal(restoreFailedComposerDraft("  code\n\n", ""), "  code\n\n");
});

test("attachment-only failure leaves the next text draft intact", () => {
  assert.equal(restoreFailedComposerDraft("", "next message"), "next message");
});

test("repeated text is preserved because the second draft may be intentional", () => {
  assert.equal(restoreFailedComposerDraft("again", "again"), "again\n\nagain");
});
