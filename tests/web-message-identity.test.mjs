import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
const source = await readFile(new URL("../app/message-identity.ts", import.meta.url), "utf8");
const { code } = await transform(source, {loader: "ts", format: "esm"});
const { sameMessageIdentity } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

test("Relay acceptance and native echo reconcile by client submission ID", () => {
  assert.equal(sameMessageIdentity({id:"event-1",role:"user",clientMessageId:"submit-1"}, {id:"native-1",role:"user",clientMessageId:"submit-1"}), true);
});
test("separate submissions and missing identities remain separate", () => {
  assert.equal(sameMessageIdentity({id:"event-1",role:"user",clientMessageId:"submit-1"}, {id:"native-2",role:"user",clientMessageId:"submit-2"}), false);
  assert.equal(sameMessageIdentity({id:"event-1",role:"user"}, {id:"native-1",role:"user"}), false);
  assert.equal(sameMessageIdentity({id:"event-1",role:"user",clientMessageId:"submit-1"}, {id:"native-1",role:"codex",clientMessageId:"submit-1"}), false);
});
test("same native ID remains stable across repeated events", () => {
  assert.equal(sameMessageIdentity({id:"native-1",role:"user"}, {id:"native-1",role:"user"}), true);
});

const page = await readFile(new URL("../app/workbench-page.tsx", import.meta.url), "utf8");
const upsertSource = page.slice(page.indexOf("function upsertMessage("), page.indexOf("const TOOL_ACTIVITY_DETAIL_LIMIT"));
const compiled = await transform(source + "\n" + upsertSource + "\nexport { upsertMessage };", {loader:"ts",format:"esm"});
const { upsertMessage } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);
test("actual Web reducer renders acceptance and native echo once, preserves other sessions", () => {
  let state = {other:[{id:"other",role:"user",content:"same text"}]};
  const setter = fn => {state=fn(state);};
  upsertMessage(setter,"session",{id:"event",role:"user",clientMessageId:"submit",content:"same text"});
  upsertMessage(setter,"session",{id:"native",role:"user",clientMessageId:"submit",content:"same text",turnId:"turn"});
  assert.equal(state.session.length,1);
  assert.equal(state.session[0].id,"native");
  assert.equal(state.session[0].turnId,"turn");
  upsertMessage(setter,"session",{id:"native2",role:"user",clientMessageId:"submit2",content:"same text"});
  assert.equal(state.session.length,2);
  assert.equal(state.other.length,1);
});
