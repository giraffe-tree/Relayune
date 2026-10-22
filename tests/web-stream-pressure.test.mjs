import assert from "node:assert/strict";
import test from "node:test";
import { ONLINE_EVENT_BYTES } from "../relay/online-transport.mjs";
import { cleanupReadCallbacks } from "./helpers/web-read-callbacks.mjs";
import { probeStreamPressure } from "./helpers/stream-pressure-fixture.mjs";

test.after(cleanupReadCallbacks);

test("[MOB-RT-012][web] Relay stream pressure recovers the original HTTP result within one second without duplicate commands", async () => {
  const result = await probeStreamPressure(ONLINE_EVENT_BYTES + 1);
  assert.equal(result.at_100_ms.stream_available, true);
  assert.equal(result.at_100_ms.http_response_already_present, true);
  assert.equal(result.at_100_ms.read_completed, false);
  assert.equal(result.logical_read_requests, 1);
  assert.equal(result.http_posts, 0);
  assert.equal(result.http_polls, 1);
  assert.equal(result.http_response_count, 1);
  assert.equal(result.wss_response_count, 0);
  assert.equal(result.original_envelope_bound, true);
  assert.equal(result.logical_id_kept, true);
  assert.ok(result.first_http_response_at_ms < 100);
  assert.ok(result.completed_at_ms >= 490 && result.completed_at_ms < 1_000);
  // This single logical read shrinks its provider page once to fit the wire budget.
  assert.equal(result.provider_reads, 2);
  assert.ok(result.response_message_count > 0);
});

test("an unpressured Relay delivers the original stream result without starting HTTP recovery", async () => {
  const result = await probeStreamPressure(0);
  assert.equal(result.logical_read_requests, 1);
  assert.equal(result.http_posts, 0);
  assert.equal(result.http_polls, 0);
  assert.equal(result.http_response_count, 0);
  assert.equal(result.wss_response_count, 1);
  assert.equal(result.logical_id_kept, true);
  assert.ok(result.completed_at_ms < 500);
});
