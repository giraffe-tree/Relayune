import assert from "node:assert/strict";
import test from "node:test";
import { isComposerComposition } from "../app/composer-keyboard.mjs";

test("IME candidate confirmation is never handled as a send or command key", () => {
  assert.equal(isComposerComposition({ key: "Enter", isComposing: true }), true);
  assert.equal(isComposerComposition({ key: "Enter", isComposing: false, keyCode: 229 }), true);
  assert.equal(isComposerComposition({ key: "ArrowDown" }, true), true);
});

test("ordinary Enter returns to the normal send/newline handler after composition", () => {
  assert.equal(isComposerComposition({ key: "Enter", isComposing: false, keyCode: 13 }, false), false);
});
