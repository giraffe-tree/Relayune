import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

async function importSelectionModule() {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-active-session-"));
  const outfile = join(temporary, "active-session-selection.mjs");
  await build({
    entryPoints: ["app/active-session-selection.ts"],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  return {
    module: await import(`${pathToFileURL(outfile).href}?${Date.now()}`),
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
  };
}

function session(overrides = {}) {
  return {
    id: "session-a",
    name: "Session A",
    project: "Project",
    cwd: "/repo",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("keeps the in-memory selection while that session still exists", async () => {
  const { module, cleanup } = await importSelectionModule();
  try {
    const sessions = [
      session({ id: "session-a" }),
      session({ id: "session-b", updated_at: "2026-01-02T00:00:00.000Z" }),
    ];
    const selected = module.resolveActiveSessionSelection(
      sessions,
      sessions,
      "session-a",
      "session-b",
      "codex",
    );
    assert.equal(selected, "session-a");
  } finally {
    await cleanup();
  }
});

test("restores the persisted session after a reload", async () => {
  const { module, cleanup } = await importSelectionModule();
  try {
    const sessions = [
      session({ id: "session-a" }),
      session({ id: "session-b", updated_at: "2026-01-02T00:00:00.000Z" }),
    ];
    const selected = module.resolveActiveSessionSelection(
      sessions,
      sessions,
      "",
      "session-a",
      "codex",
    );
    assert.equal(selected, "session-a");
  } finally {
    await cleanup();
  }
});

test("falls back to the most recent session when the persisted id is gone", async () => {
  const { module, cleanup } = await importSelectionModule();
  try {
    const sessions = [
      session({ id: "session-a" }),
      session({ id: "session-b", updated_at: "2026-01-02T00:00:00.000Z" }),
    ];
    const selected = module.resolveActiveSessionSelection(
      sessions,
      sessions,
      "",
      "session-deleted",
      "codex",
    );
    assert.equal(selected, "session-b");
  } finally {
    await cleanup();
  }
});

test("ignores a persisted session that belongs to another provider", async () => {
  const { module, cleanup } = await importSelectionModule();
  try {
    const sessions = [
      session({ id: "session-a" }),
      session({ id: "session-kimi", provider: "kimi" }),
    ];
    const roots = sessions.filter((entry) => !entry.provider || entry.provider === "codex");
    const selected = module.resolveActiveSessionSelection(
      sessions,
      roots,
      "",
      "session-kimi",
      "codex",
    );
    assert.equal(selected, "session-a");
  } finally {
    await cleanup();
  }
});

test("persists the selection per device and clears empty selections", async () => {
  const { module, cleanup } = await importSelectionModule();
  try {
    const storage = memoryStorage();
    module.storeActiveSessionSelection("device-1", "session-a", storage);
    module.storeActiveSessionSelection("device-2", "session-b", storage);
    assert.equal(
      module.readActiveSessionSelection("device-1", storage),
      "session-a",
    );
    assert.equal(
      module.readActiveSessionSelection("device-2", storage),
      "session-b",
    );

    module.storeActiveSessionSelection("device-1", "", storage);
    assert.equal(module.readActiveSessionSelection("device-1", storage), "");
    assert.equal(
      module.readActiveSessionSelection("device-2", storage),
      "session-b",
      "clearing one device must not affect another device",
    );
    assert.equal(module.readActiveSessionSelection("", storage), "");
  } finally {
    await cleanup();
  }
});

test("survives unavailable storage without throwing", async () => {
  const { module, cleanup } = await importSelectionModule();
  try {
    const brokenStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };
    assert.equal(
      module.readActiveSessionSelection("device-1", brokenStorage),
      "",
    );
    module.storeActiveSessionSelection("device-1", "session-a", brokenStorage);
  } finally {
    await cleanup();
  }
});

test("workbench wires restore on refresh, persist on selection, clear on logout", async () => {
  const page = await readFile("app/workbench-page.tsx", "utf8");

  assert.match(
    page,
    /readActiveSessionSelection\(deviceId\)[\s\S]{0,200}setActiveSession\(\(current\) =>\s*resolveActiveSessionSelection\(/,
    "refresh must restore the persisted session through the shared resolver",
  );
  assert.match(
    page,
    /const openWorkspaceSession = useCallback\(\(sessionId: string\) => \{\s*setActiveSession\(sessionId\);\s*storeActiveSessionSelection\(/,
    "selecting a session must persist it for the current device",
  );
  assert.match(
    page,
    /async function logout\(\)[\s\S]{0,400}storeActiveSessionSelection\(relayDeviceId\.current \?\? "", ""\)/,
    "logout must clear the persisted selection before forgetting the device",
  );
});

test("new Web sessions enter an authoritative empty history state before activation", async () => {
  const page = await readFile("app/workbench-page.tsx", "utf8");
  assert.match(
    page,
    /if \(created\) \{[\s\S]*?historyLoaded\.current\.add\(created\.id\)[\s\S]*?\[created\.id\]: \[\][\s\S]*?loaded: true[\s\S]*?setActiveSession\(created\.id\)/,
  );
});
