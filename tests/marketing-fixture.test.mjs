import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("public marketing fixture preserves renderer stages without private provenance", async () => {
  const task = JSON.parse(await read("scripts/marketing/font-size-task.json"));
  const manifest = JSON.parse(await read("scripts/marketing/capture-manifest.json"));
  assert.equal(task.fixtureKind, "synthetic");
  assert.equal(manifest.fixtureKind, "synthetic");
  for (const record of [task, manifest]) {
    assert.ok(Object.keys(record).every(key => !/source|commit|thread/i.test(key)));
    assert.doesNotMatch(JSON.stringify(record), /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i);
  }
  assert.deepEqual(task.messages.map(message => message.id), [
    "request", "inspect", "implement", "verify", "checks", "done",
  ]);
  assert.deepEqual(task.stages.map(stage => [stage.id, stage.messageCount]), [
    ["request", 1], ["implement", 3], ["verify", 5], ["done", 6],
  ]);
  let previous = -Infinity;
  for (const message of task.messages) {
    assert.match(message.created_at, /^2000-01-01T/);
    const timestamp = Date.parse(message.created_at);
    assert.ok(timestamp > previous);
    previous = timestamp;
    assert.equal(typeof message.content, "string");
  }
  assert.deepEqual(manifest.screens, task.stages.flatMap(stage =>
    ["web", "phone"].map(device => `${device}-${stage.id}.webp`)));
});

test("marketing accessibility copy discloses a synthetic scenario in every locale", async () => {
  const zh = await read("app/marketing-hero-demo-copy-zh.ts");
  const en = await read("app/marketing-hero-demo-copy-en.ts");
  const localized = await read("app/marketing-hero-demo-copy.ts");
  assert.match(zh, /合成中文示例/);
  assert.match(en, /Synthetic Chinese example/);
  const copy = JSON.parse(localized.slice(localized.lastIndexOf(" = {") + 3).trim().replace(/;$/, ""));
  assert.equal(Object.keys(copy).length, 8);
  for (const value of Object.values(copy)) {
    assert.ok(value.disclosure.length > 20);
    assert.equal(value.steps.length, 4);
    assert.equal(value.summaries.length, 4);
  }
  // A synthetic example must not link back to a private development commit.
  assert.doesNotMatch([zh, en, localized].join("\n"), /\b[0-9a-f]{7,40}\b/i);
  const hero = await read("app/marketing-hero-demo.tsx");
  assert.match(hero, /aria-label=\{`\$\{labels.title\} · \$\{labels.disclosure\}`\}/);
});
