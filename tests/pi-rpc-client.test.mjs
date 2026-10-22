import test from "node:test";
import assert from "node:assert/strict";
import { PiRpcClient, PiRpcDecoder } from "../relay/pi-rpc-client.mjs";

const frame = value => Buffer.from(`${JSON.stringify(value)}\n`);

test("Pi frames preserve Unicode separators and split UTF-8 across arbitrary chunks", () => {
  const decoder = new PiRpcDecoder();
  const input = { type: "message_update", text: "中文\u2028下一行\u2029结束" };
  const messages = [];
  for (const byte of frame(input)) messages.push(...decoder.push(Buffer.from([byte])));
  assert.deepEqual(messages, [input]);
  decoder.end();
});

test("Pi decoder accepts CRLF and multiple records while retaining the incomplete suffix", () => {
  const decoder = new PiRpcDecoder();
  assert.deepEqual(decoder.push('\r\n{"type":"agent_start"}\r\n{"type":'), [{ type: "agent_start" }]);
  assert.deepEqual(decoder.push('"agent_settled"}\n'), [{ type: "agent_settled" }]);
  decoder.end();
});

test("Pi decoder rejects oversized, malformed and incomplete frames without echoing content", () => {
  assert.throws(() => new PiRpcDecoder({ maxFrameBytes: 8 }).push("123456789"), /limit/);
  assert.throws(() => new PiRpcDecoder().push("SECRET_INVALID_INPUT\n"), error => !error.message.includes("SECRET"));
  for (const value of [null, [], { text: "no type" }]) {
    assert.throws(() => new PiRpcDecoder().push(frame(value)), /envelope/);
  }
  const decoder = new PiRpcDecoder();
  decoder.push('{"type":"agent_end"}');
  assert.throws(() => decoder.end(), /incomplete/);
});

test("Pi acceptance is separate from lifecycle; out-of-order replies retain request identity", async () => {
  const writes = [], events = [];
  const client = new PiRpcClient({ write: line => writes.push(JSON.parse(line)), onEvent: event => events.push(event) });
  const prompt = client.request("prompt", { message: "hello", id: "forged", type: "forged" });
  const state = client.request("get_state");
  assert.equal(writes[0].type, "prompt");
  assert.notEqual(writes[0].id, "forged");
  client.receive(frame({ type: "response", id: writes[1].id, command: "get_state", success: true, data: { isStreaming: true } }));
  client.receive(frame({ type: "response", id: writes[0].id, command: "prompt", success: true }));
  assert.equal((await prompt).success, true);
  assert.equal((await state).data.isStreaming, true);
  assert.deepEqual(events, []);
  for (const type of ["agent_start", "turn_end", "agent_end", "agent_settled"]) client.receive(frame({ type }));
  assert.deepEqual(events.map(e => e.type), ["agent_start", "turn_end", "agent_end", "agent_settled"]);
  client.close();
});

test("Pi timeout does not retry and late responses cannot resolve the next request", async () => {
  const writes = [];
  const client = new PiRpcClient({ write: line => writes.push(JSON.parse(line)) });
  await assert.rejects(client.request("prompt", {}, { timeoutMs: 5 }), /acceptance is unknown/);
  const next = client.request("get_state");
  client.receive(frame({ type: "response", id: writes[0].id, command: "prompt", success: true }));
  assert.equal(client.pending.size, 1);
  client.receive(frame({ type: "response", id: writes[1].id, command: "get_state", success: true }));
  await next;
  assert.equal(writes.length, 2);
  client.close();
});

test("Pi mismatched replies fail all pending commands and notify the owner once", async () => {
  const writes = [], failures = [];
  const client = new PiRpcClient({ write: line => writes.push(JSON.parse(line)), onFailure: error => failures.push(error) });
  const result = Promise.allSettled([client.request("prompt"), client.request("get_state")]);
  client.receive(frame({ type: "response", id: writes[0].id, command: "abort", success: true }));
  assert.deepEqual((await result).map(r => r.status), ["rejected", "rejected"]);
  assert.equal(client.pending.size, 0);
  assert.equal(failures.length, 1);
  await assert.rejects(client.request("prompt"), /closed/);
});

test("Pi errors redact upstream content and exit clears pending timers", async () => {
  const writes = [];
  const client = new PiRpcClient({ write: line => writes.push(JSON.parse(line)) });
  const rejected = assert.rejects(client.request("prompt"), error => /rejected/.test(error.message) && !error.message.includes("SECRET"));
  client.receive(frame({ type: "response", id: writes[0].id, command: "prompt", success: false, error: "SECRET" }));
  await rejected;
  const pending = assert.rejects(client.request("get_state"), /exited/);
  client.end();
  await pending;
  assert.equal(client.pending.size, 0);
});

test("Pi asynchronous write failure closes the transport without exposing the write error", async () => {
  const client = new PiRpcClient({ write: async () => { throw new Error("SECRET"); } });
  await assert.rejects(client.request("prompt"), /Pi RPC write failed\./);
  assert.equal(client.closed, true);
});
