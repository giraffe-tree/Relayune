import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const mindmapPath = "docs/qa/mobile-experience-test-mindmap.md";
const manifestPath = "tests/cases/mobile-experience.json";
const releaseGate = process.argv.includes("--release");
const idPattern = /MOB-(STA|RT|AGT|PRJ|DEV|LAY|REL|MSG|KIM|ATT|APR|NOT|UPD)-\d{3}/g;

const [mindmap, manifestText] = await Promise.all([
  readFile(mindmapPath, "utf8"),
  readFile(manifestPath, "utf8"),
]);
const manifest = JSON.parse(manifestText);
assert.equal(manifest.schema_version, 1, "unsupported mobile test map schema");
assert.ok(Array.isArray(manifest.cases), "mobile test manifest cases must be an array");

const mermaid = mindmap.match(/```mermaid\s+mindmap([\s\S]*?)```/)?.[1];
assert.ok(mermaid, "mobile test mindmap must contain one Mermaid mindmap block");
const mindmapIds = [...mermaid.matchAll(idPattern)].map((match) => match[0]);
assert.equal(
  new Set(mindmapIds).size,
  mindmapIds.length,
  "mobile test mindmap contains duplicate case IDs",
);

const casesById = new Map();
for (const item of manifest.cases) {
  assert.match(item.id, /^MOB-(STA|RT|AGT|PRJ|DEV|LAY|REL|MSG|KIM|ATT|APR|NOT|UPD)-\d{3}$/);
  assert.equal(casesById.has(item.id), false, `duplicate manifest case ${item.id}`);
  assert.equal(item.area, item.id.split("-")[1], `${item.id} has the wrong area`);
  assert.ok(["P0", "P1", "P2"].includes(item.priority), `${item.id} has invalid priority`);
  assert.ok(["active", "retired"].includes(item.status), `${item.id} has invalid status`);
  assert.ok(
    ["planned", "automated", "manual"].includes(item.implementation),
    `${item.id} has invalid implementation`,
  );
  assert.ok(Array.isArray(item.platforms) && item.platforms.length, `${item.id} has no platforms`);
  assert.ok(Array.isArray(item.automated_by), `${item.id} automated_by must be an array`);
  casesById.set(item.id, item);
}

const activeIds = manifest.cases
  .filter((item) => item.status === "active")
  .map((item) => item.id)
  .sort();
assert.deepEqual(
  [...mindmapIds].sort(),
  activeIds,
  "mindmap leaves must exactly match active mobile test cases",
);

for (const item of manifest.cases) {
  if (item.status === "retired") {
    assert.equal(mindmapIds.includes(item.id), false, `${item.id} is retired but remains in mindmap`);
    continue;
  }
  if (item.implementation === "planned") {
    assert.equal(item.automated_by.length, 0, `${item.id} planned case already declares automation`);
    if (releaseGate && ["P0", "P1"].includes(item.priority)) {
      assert.fail(`${item.id} is ${item.priority} but remains planned at release`);
    }
    continue;
  }
  if (item.implementation === "manual") {
    assert.notEqual(item.priority, "P0", `${item.id} P0 cases cannot be manual`);
    assert.match(item.manual_evidence ?? "", /^docs\//, `${item.id} needs manual evidence`);
    assert.match(item.evidence_date ?? "", /^\d{4}-\d{2}-\d{2}$/, `${item.id} needs evidence date`);
    await access(item.manual_evidence);
    continue;
  }
  assert.ok(item.automated_by.length, `${item.id} automated case has no bindings`);
  const boundPlatforms = new Set();
  for (const binding of item.automated_by) {
    assert.ok(item.platforms.includes(binding.platform), `${item.id} binds undeclared platform`);
    assert.equal(boundPlatforms.has(binding.platform), false, `${item.id} repeats ${binding.platform}`);
    boundPlatforms.add(binding.platform);
    const source = await readFile(binding.file, "utf8");
    assert.ok(
      source.includes(`[${item.id}][${binding.platform}]`),
      `${binding.file} does not contain [${item.id}][${binding.platform}]`,
    );
  }
  if (item.priority === "P0") {
    assert.deepEqual(
      [...boundPlatforms].sort(),
      [...item.platforms].sort(),
      `${item.id} P0 automation does not cover every declared platform`,
    );
  }
}

const registered = new Set(manifest.cases.map((item) => item.id));
for (const filename of [
  "tests/agent-status-ui.test.mjs",
  "tests/journey-responsive-ux.test.mjs",
  "tests/server-blindness.test.mjs",
  "mobile/test/widget_test.dart",
  "mobile/test/network/relay_api_test.dart",
  "mobile/test/state/app_controller_attachment_test.dart",
  "mobile/test/notifications/notification_coordinator_test.dart",
  "mobile/test/ui/conversation_resilience_test.dart",
  "mobile/test/ui/workbench_parity_test.dart",
  "mobile/test/ui/workbench_home_test.dart",
  "mobile/test/ui/notification_ui_test.dart",
  "mobile/test/update/android_auto_update_test.dart",
  "tests/attachment-upload.test.mjs",
]) {
  const source = await readFile(filename, "utf8");
  for (const match of source.matchAll(idPattern)) {
    assert.ok(registered.has(match[0]), `${filename} contains orphan mobile case ${match[0]}`);
  }
}

const automated = manifest.cases.filter((item) => item.implementation === "automated").length;
const planned = manifest.cases.filter((item) => item.implementation === "planned").length;
const p0 = manifest.cases.filter((item) => item.status === "active" && item.priority === "P0").length;
console.log(
  `mobile test map: ${activeIds.length} active, ${p0} P0, ${automated} automated, ${planned} planned`,
);
