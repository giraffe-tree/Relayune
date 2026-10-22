import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

async function importSessionProjects() {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-project-groups-"));
  const outfile = join(temporary, "session-projects.mjs");
  await build({
    entryPoints: ["app/session-projects.ts"],
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

function session(overrides = {}) {
  return {
    id: "session-default",
    name: "Default session",
    project: "relayune",
    cwd: "/work/relayune",
    updated_at: "2026-08-10T10:00:00.000Z",
    provider: "codex",
    ...overrides,
  };
}

test("[MOB-PRJ-001][web] equivalent paths form one project and duplicate names remain distinguishable", async () => {
  const fixture = await importSessionProjects();
  try {
    const groups = fixture.module.groupSessionsByProject([
      session({ id: "a", cwd: "/work/relayune/" }),
      session({ id: "b", cwd: "/work/./relayune" }),
      session({ id: "c", cwd: "/archive/relayune" }),
    ]);
    assert.equal(groups.length, 2);
    assert.deepEqual(
      groups.find((group) => group.key === "/work/relayune").sessions.map((item) => item.id),
      ["a", "b"],
    );
    assert.equal(new Set(groups.map((group) => group.displayName)).size, 2);
    assert.ok(groups.every((group) => group.displayName.includes(group.normalizedCwd)));
    assert.equal(
      fixture.module.normalizeProjectPath("c:\\Users\\me\\relayune\\."),
      "C:/Users/me/relayune",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("[MOB-PRJ-002][web] provider filtering never exposes child agent threads", async () => {
  const fixture = await importSessionProjects();
  try {
    const visible = fixture.module.rootSessionsForProvider([
      session({ id: "codex-root" }),
      session({ id: "codex-child", is_subagent: true }),
      session({ id: "kimi-root", provider: "kimi" }),
      session({ id: "claude-root", provider: "claude" }),
      session({ id: "cowork-root", provider: "claude-cowork" }),
    ], "codex");
    assert.deepEqual(visible.map((item) => item.id), ["codex-root"]);
    assert.deepEqual(
      fixture.module.rootSessionsForProvider([
        session({ id: "codex-root" }),
        session({ id: "claude-root", provider: "claude" }),
        session({ id: "claude-child", provider: "claude", is_subagent: true }),
      ], "claude").map((item) => item.id),
      ["claude-root"],
    );
    assert.deepEqual(
      fixture.module.rootSessionsForProvider([
        session({ id: "claude-root", provider: "claude" }),
        session({ id: "cowork-root", provider: "claude-cowork" }),
        session({
          id: "cowork-child",
          provider: "claude-cowork",
          is_subagent: true,
        }),
      ], "claude-cowork").map((item) => item.id),
      ["cowork-root"],
    );
    assert.deepEqual(
      fixture.module.groupSessionsByProject([
        session({ id: "root" }),
        session({ id: "child", is_subagent: true }),
      ]).flatMap((group) => group.sessions.map((item) => item.id)),
      ["root"],
    );
  } finally {
    await fixture.cleanup();
  }
});

test("[MOB-PRJ-003][web] project and session ordering is deterministic for ties and invalid dates", async () => {
  const fixture = await importSessionProjects();
  try {
    const input = [
      session({ id: "z", cwd: "/b", project: "b", updated_at: "invalid" }),
      session({ id: "b", cwd: "/a", project: "a", updated_at: "invalid" }),
      session({ id: "a", cwd: "/a", project: "a", updated_at: "invalid" }),
    ];
    const projectIds = (items) =>
      fixture.module.groupSessionsByProject(items).map((group) => ({
        key: group.key,
        sessions: group.sessions.map((item) => item.id),
      }));
    assert.deepEqual(projectIds(input), [
      { key: "/a", sessions: ["a", "b"] },
      { key: "/b", sessions: ["z"] },
    ]);
    assert.deepEqual(projectIds(input), projectIds([...input].reverse()));
  } finally {
    await fixture.cleanup();
  }
});

test("[MOB-PRJ-004][web] a valid active session survives refresh and invalid selection falls back predictably", async () => {
  const fixture = await importSessionProjects();
  try {
    const sessions = [
      session({ id: "older", updated_at: "2026-08-10T09:00:00.000Z" }),
      session({ id: "newer", updated_at: "2026-08-10T11:00:00.000Z" }),
      session({ id: "child", is_subagent: true, updated_at: "2026-08-10T12:00:00.000Z" }),
    ];
    assert.equal(
      fixture.module.preserveProjectSessionSelection(sessions, "older"),
      "older",
    );
    assert.equal(
      fixture.module.preserveProjectSessionSelection(sessions, "missing"),
      "newer",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("[MOB-PRJ-005][web] duplicate project names expose distinct long-path identities within an ellipsized label", async () => {
  const fixture = await importSessionProjects();
  try {
    const groups = fixture.module.groupSessionsByProject([
      session({
        id: "personal",
        cwd: "/Users/example/Documents/a-very-long-personal-workspace-name/relayune",
      }),
      session({
        id: "company",
        cwd: "/Volumes/company/a-very-long-shared-workspace-name/relayune",
      }),
    ]);
    assert.equal(groups.length, 2);
    assert.equal(new Set(groups.map((group) => group.displayName)).size, 2);
    assert.ok(
      groups.every(
        (group) =>
          group.displayName.startsWith("relayune · ") &&
          group.displayName.endsWith(group.normalizedCwd),
      ),
    );

    const css = await readFile("app/workbench.css", "utf8");
    assert.match(
      css,
      /\.project-name\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("provider project catalogs stay distinct and include saved projects without sessions", async () => {
  const fixture = await importSessionProjects();
  try {
    const groups = fixture.module.projectGroupsForProvider([
      session({
        id: "codex-root",
        cwd: "/work/relayune",
        updated_at: "2026-08-10T11:00:00.000Z",
      }),
      session({ id: "kimi-root", cwd: "/work/other", provider: "kimi" }),
    ], "claude");
    assert.deepEqual(groups, []);

    const codex = fixture.module.projectGroupsForProvider(
      [session({ id: "codex-root", cwd: "/work/relayune" })],
      "codex",
      "codex",
      [{
        id: "project-galaxy",
        name: "3d-galaxy",
        cwd: "/work/3d-galaxy",
        updated_at: "2026-09-02T08:00:00.000Z",
        provider: "codex",
      }],
    );
    assert.deepEqual(
      codex.map((group) => ({ cwd: group.cwd, sessions: group.sessions.length })),
      [
        { cwd: "/work/3d-galaxy", sessions: 0 },
        { cwd: "/work/relayune", sessions: 1 },
      ],
    );
  } finally {
    await fixture.cleanup();
  }
});

test("Claude Code and Claude Cowork keep separate project catalogs", async () => {
  const fixture = await importSessionProjects();
  try {
    const input = [
      session({ id: "claude", provider: "claude", cwd: "/work/shared" }),
      session({
        id: "cowork",
        provider: "claude-cowork",
        cwd: "/work/shared",
      }),
    ];
    assert.deepEqual(
      fixture.module.projectGroupsForProvider(input, "claude").flatMap(
        (group) => group.sessions.map((item) => item.id),
      ),
      ["claude"],
    );
    assert.deepEqual(
      fixture.module.projectGroupsForProvider(input, "claude-cowork").flatMap(
        (group) => group.sessions.map((item) => item.id),
      ),
      ["cowork"],
    );
  } finally {
    await fixture.cleanup();
  }
});
