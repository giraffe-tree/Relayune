import assert from "node:assert/strict";
import test from "node:test";
import {
  generateE2eeKey,
  importE2eeKey,
  openJson,
  sealJson,
} from "../relay/e2ee.mjs";

const aad = {
  direction: "web-to-relay",
  device_id: "dev_test_mac",
  session_id: "ses_test",
  request_id: "req_test",
  type: "session.submit_message",
};

test("E2EE envelope round-trips JSON without exposing its plaintext", async () => {
  const exportedKey = await generateE2eeKey();
  const key = await importE2eeKey(exportedKey);
  const value = {
    content: "CANARY message only the browser and Mac Relay may read",
    client_message_id: "msg_secret",
    nested: {
      tasks: ["CANARY private agent task"],
      unicode: "端到端加密内容 🔐",
    },
  };

  const envelope = await sealJson(key, value, aad);
  const wire = JSON.stringify(envelope);

  assert.equal(envelope.v, 2);
  assert.equal(envelope.alg, "A256GCM");
  assert.equal(typeof envelope.kid, "string");
  assert.ok(envelope.kid.length > 0);
  assert.equal(typeof envelope.aad, "string");
  assert.deepEqual(
    JSON.parse(Buffer.from(envelope.aad, "base64url").toString("utf8")),
    aad,
  );
  assert.equal(typeof envelope.iv, "string");
  assert.ok(envelope.iv.length > 0);
  assert.equal(typeof envelope.ciphertext, "string");
  assert.ok(envelope.ciphertext.length > 0);
  assert.doesNotMatch(wire, /CANARY|message only|private agent task|端到端加密内容/);
  assert.deepEqual(await openJson(key, envelope, aad), value);
});

test("sealing the same value twice uses a fresh nonce", async () => {
  const key = await importE2eeKey(await generateE2eeKey());
  const value = { content: "same plaintext" };

  const first = await sealJson(key, value, aad);
  const second = await sealJson(key, value, aad);

  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.deepEqual(await openJson(key, first, aad), value);
  assert.deepEqual(await openJson(key, second, aad), value);
});

test("AAD is authenticated and cannot be replaced by the server", async () => {
  const key = await importE2eeKey(await generateE2eeKey());
  const envelope = await sealJson(key, { content: "session-bound secret" }, aad);
  const replacedAad = { ...aad, session_id: "ses_other" };

  await assert.rejects(
    openJson(key, envelope, replacedAad),
    /auth|decrypt|aad|integrity/i,
  );
  await assert.rejects(
    openJson(key, envelope, { ...aad, direction: "relay-to-web" }),
    /auth|decrypt|aad|integrity/i,
  );
  await assert.rejects(
    openJson(key, { ...envelope, aad: replacedAad }, replacedAad),
    /auth|decrypt|aad|integrity/i,
  );
});

test("wrong keys and modified ciphertext are rejected", async () => {
  const key = await importE2eeKey(await generateE2eeKey());
  const wrongKey = await importE2eeKey(await generateE2eeKey());
  const envelope = await sealJson(key, { content: "authenticated secret" }, aad);
  const tampered = {
    ...envelope,
    ciphertext: flipBase64UrlCharacter(envelope.ciphertext),
  };

  await assert.rejects(
    openJson(wrongKey, envelope, aad),
    /auth|decrypt|integrity|key id/i,
  );
  await assert.rejects(
    openJson(key, tampered, aad),
    /auth|decrypt|integrity/i,
  );
});

test("unsupported envelope versions and algorithms fail closed", async () => {
  const key = await importE2eeKey(await generateE2eeKey());
  const envelope = await sealJson(key, { content: "versioned secret" }, aad);

  await assert.rejects(
    openJson(key, { ...envelope, v: envelope.v + 1 }, aad),
    /version|unsupported/i,
  );
  await assert.rejects(
    openJson(key, { ...envelope, alg: "A128CBC" }, aad),
    /algorithm|unsupported/i,
  );
});

function flipBase64UrlCharacter(value) {
  assert.ok(value.length > 0, "ciphertext must not be empty");
  const replacement = value[0] === "A" ? "B" : "A";
  return `${replacement}${value.slice(1)}`;
}
