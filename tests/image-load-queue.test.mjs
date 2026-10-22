import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const directory = await mkdtemp(join(tmpdir(), "relayune-image-queue-"));
after(() => rm(directory, { recursive: true, force: true }));
const outfile = join(directory, "queue.mjs");
await build({ entryPoints: ["app/image-load-queue.ts"], outfile, bundle: true, platform: "node", format: "esm" });
const { ImageLoadQueue } = await import(pathToFileURL(outfile));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the initial batch and remaining downloads start newest first with five slots", async () => {
  const queue = new ImageLoadQueue();
  const gates = Array.from({ length: 8 }, () => Promise.withResolvers());
  const started = [];
  const requests = gates.map((gate, index) => queue.run(() => {
    started.push(index);
    return gate.promise;
  }, () => index, new AbortController().signal));
  assert.deepEqual(started, []);
  await tick();
  assert.deepEqual(started, [7, 6, 5, 4, 3]);
  gates[7].resolve("ready");
  await tick();
  assert.deepEqual(started, [7, 6, 5, 4, 3, 2]);
  gates.forEach((gate) => gate.resolve("ready"));
  await Promise.all(requests);
  assert.deepEqual(started, [7, 6, 5, 4, 3, 2, 1, 0]);
});

test("unmounted images never start and a failed image frees its slot", async () => {
  const queue = new ImageLoadQueue();
  const abort = new AbortController();
  const cancelled = queue.run(() => assert.fail("unmounted download"), () => 10, abort.signal);
  abort.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  const failed = queue.run(async () => { throw new Error("unavailable"); }, () => 1, new AbortController().signal);
  await assert.rejects(failed, /unavailable/);
  assert.equal(await queue.run(async () => "ready", () => 0, new AbortController().signal), "ready");
});
