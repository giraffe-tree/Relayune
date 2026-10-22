import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  candidateDirectoryName,
  prunePeriodicCandidates,
  validatePeriodicMetadata,
} from "../scripts/prepare-periodic-android-artifact.mjs";

const certificate = "ce551c4cd78cd06dfb9c4c93c2ac8609388658e441a781da35ca7e1bda746fe9";
const commit = "0123456789abcdef0123456789abcdef01234567";

test("periodic Android metadata is exact, signed, and traceable", () => {
  const metadata = fixture("2026-08-11T02:00:00.000Z");
  assert.equal(validatePeriodicMetadata(metadata), metadata);
  assert.equal(candidateDirectoryName(metadata.built_at, commit, false), "20260811T020000Z-0123456");
  assert.equal(candidateDirectoryName(metadata.built_at, commit, true), "20260811T020000Z-0123456-dirty");
  assert.throws(() => validatePeriodicMetadata({ ...metadata, extra: true }), /keys are invalid/);
  assert.throws(
    () => validatePeriodicMetadata({ ...metadata, apk: { ...metadata.apk, signing_certificate_sha256: "0".repeat(64) } }),
    /signing certificate/,
  );
});

test("retention deletes only old candidates carrying the private marker", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relayune-periodic-"));
  const versionRoot = path.join(temporary, "0.2.8");
  try {
    await mkdir(versionRoot, { recursive: true });
    const dates = [
      "2026-08-11T00:00:00.000Z",
      "2026-08-11T02:00:00.000Z",
      "2026-08-11T04:00:00.000Z",
    ];
    for (const builtAt of dates) await createCandidate(versionRoot, builtAt, true);
    const unmarked = path.join(versionRoot, "20260810T220000Z-0123456");
    await mkdir(unmarked);
    await writeFile(path.join(unmarked, "artifact.json"), JSON.stringify(fixture("2026-08-10T22:00:00.000Z")));

    const removed = await prunePeriodicCandidates(temporary, 2);
    assert.equal(removed.length, 1);
    await assert.rejects(readFile(path.join(versionRoot, "20260811T000000Z-0123456", "artifact.json")), /ENOENT/);
    assert.ok(await readFile(path.join(unmarked, "artifact.json"), "utf8"));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

async function createCandidate(versionRoot, builtAt, marked) {
  const candidate = path.join(versionRoot, candidateDirectoryName(builtAt, commit, false));
  await mkdir(candidate);
  await writeFile(path.join(candidate, "artifact.json"), JSON.stringify(fixture(builtAt)));
  if (marked) await writeFile(path.join(candidate, ".relayune-periodic-candidate"), "relayune-periodic-android-v1\n");
}

function fixture(builtAt) {
  return {
    schema_version: 1,
    kind: "relayune-periodic-android",
    built_at: builtAt,
    version_name: "0.2.8",
    version_code: 8,
    package_id: "cn.giraffetree.relayune",
    source_commit: commit,
    source_dirty: false,
    apk: {
      file: "Relayune-0.2.8-Android.apk",
      size: 123456,
      sha256: "a".repeat(64),
      signing_certificate_sha256: certificate,
    },
  };
}
