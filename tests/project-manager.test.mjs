import assert from "node:assert/strict";
import test from "node:test";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalProjectStore, ProjectManager } from "../relay/project-manager.mjs";
import { CodexAppServerAdapter } from "../relay/codex-adapters.mjs";
import { MacRelay } from "../relay/mac-relay.mjs";
import { generateE2eeKey, keyIdForKey, openJson } from "../relay/e2ee.mjs";

async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-projects-"));
  const root = await realpath(temporary);
  t.after(() => rm(root, { recursive: true, force: true }));
  const allowed = join(root, "allowed"),
    outside = join(root, "outside");
  await mkdir(allowed);
  await mkdir(outside);
  let saves = 0,
    failSave = false;
  const projects = [],
    operations = new Map();
  const adapter = {
    supportsProjects: async () => true,
    listProjects: async () => projects,
    listSessions: async () => [
      { cwd: join(allowed, "one"), project: "one", provider: "codex" },
      { cwd: join(allowed, "two"), project: "two", provider: "codex" },
      { cwd: join(outside, "private"), project: "private", provider: "kimi" },
      { cwd: join(outside, "old"), project: "old", provider: "codex" },
    ],
    createProject: async ({ cwd, name, idempotencyKey }) => {
      saves++;
      if (failSave) throw new Error("private native error");
      const p = {
        id: idempotencyKey,
        cwd,
        name,
        provider: "codex",
        updated_at: new Date().toISOString(),
      };
      projects.push(p);
      return p;
    },
  };
  const options = {
    adapter,
    defaultLocation: allowed,
    loadOperation: async (id) => operations.get(id),
    saveOperation: async (id, value) => operations.set(id, value),
  };
  return {
    root,
    allowed,
    outside,
    adapter,
    options,
    manager: new ProjectManager(options),
    saves: () => saves,
    failSave: (value) => {
      failSave = value;
    },
  };
}

test("[MOB-PRJ-015][server] project parent suggestions deduplicate by path, isolate providers and make OS-accessible parents available without a whitelist", async (t) => {
  const f = await fixture(t);
  const { locations } = await f.manager.locations("codex");
  assert.equal(locations.length, 2);
  assert.deepEqual(locations[0].projects, ["one", "two"]);
  assert.equal(locations[0].available, true);
  assert.equal(locations[1].available, true);
  assert.equal(locations[1].writable, true);
  await assert.rejects(f.manager.locations("kimi"), { code: "unsupported" });
});

test("project creation survives retry and restart, and existing directories are never overwritten", async (t) => {
  const f = await fixture(t);
  const payload = {
    provider: "codex",
    mode: "new",
    path: f.allowed,
    name: "中文 project",
    operation_id: "project_same_operation",
  };
  const [a, b] = await Promise.all([
    f.manager.create(payload, "browser1"),
    f.manager.create(payload, "browser1"),
  ]);
  assert.deepEqual(a, b);
  assert.equal(f.saves(), 1);
  const restarted = new ProjectManager(f.options);
  assert.deepEqual(await restarted.create(payload, "browser1"), a);
  await assert.rejects(
    restarted.create({ ...payload, name: "different" }, "browser1"),
    { code: "operation_mismatch" },
  );
  await assert.rejects(
    restarted.create(
      { ...payload, operation_id: "project_new_operation" },
      "browser1",
    ),
    { code: "already_exists" },
  );
  await assert.rejects(restarted.create(payload, "browser2"), {
    code: "already_exists",
  });
  const added = await restarted.create(
    {
      ...payload,
      mode: "existing",
      path: a.project.cwd,
      operation_id: "project_existing_folder",
    },
    "browser2",
  );
  assert.equal(added.project.id, a.project.id);
  assert.equal(f.saves(), 1);
});

test("a saved-directory checkpoint resumes failed project registration without mkdir or file loss", async (t) => {
  const f = await fixture(t);
  f.failSave(true);
  const payload = {
    provider: "codex",
    mode: "new",
    path: f.allowed,
    name: "retry",
    operation_id: "project_partial_create",
  };
  await assert.rejects(f.manager.create(payload, "browser1"), {
    code: "save_failed_directory_created",
  });
  const marker = join(f.allowed, "retry", "user.txt");
  await writeFile(marker, "keep");
  f.failSave(false);
  const result = await new ProjectManager(f.options).create(
    payload,
    "browser1",
  );
  assert.equal(result.project.cwd, join(f.allowed, "retry"));
  assert.equal(await readFile(marker, "utf8"), "keep");
});

test("browse and create beyond the default workspace while validating names and resolving symlinks", async (t) => {
  const f = await fixture(t);
  await symlink(f.outside, join(f.allowed, "escape"));
  assert.equal((await f.manager.browse("codex", join(f.allowed, "escape"))).path, f.outside);
  const payload = {
    provider: "codex",
    mode: "new",
    path: f.allowed,
    operation_id: "project_bad_path",
  };
  for (const name of ["..", "../outside", "a/b", "a\\b", "\u0000"])
    await assert.rejects(f.manager.create({ ...payload, name }, "browser1"), {
      code: "invalid_name",
    });
  const created = await f.manager.create({ ...payload, name: "new", path: join(f.allowed, "escape") }, "browser1");
  assert.equal(created.project.cwd, join(f.outside, "new"));
  const listing = await f.manager.browse("codex", f.allowed);
  assert.equal(listing.parent, f.root);
  assert.deepEqual(listing.directories, []);
  assert.equal(f.saves(), 1);
});

test("missing folders, files and relative paths cannot be used as project directories", async (t) => {
  const f = await fixture(t);
  const file = join(f.root, "file.txt");
  await writeFile(file, "test");
  for (const path of [file, join(f.root, "missing")]) {
    await assert.rejects(f.manager.browse("codex", path), { code: "location_unavailable" });
  }
  await assert.rejects(f.manager.browse("codex", "relative"), { code: "invalid_location" });
});

test("OS permissions still control directory access and creation", {
  skip: process.platform === "win32" || process.getuid?.() === 0,
}, async (t) => {
  const f = await fixture(t);
  await chmod(f.outside, 0o500);
  try {
    const { locations } = await f.manager.locations("codex");
    const location = locations.find((item) => item.path === f.outside);
    assert.equal(location.available, true);
    assert.equal(location.writable, false);
    await f.manager.browse("codex", f.outside);
    await assert.rejects(f.manager.create({
      provider: "codex", mode: "new", path: f.outside, name: "blocked",
      operation_id: "project_os_permissions",
    }, "browser1"), { code: "permission_denied" });
    await chmod(f.outside, 0o000);
    await assert.rejects(f.manager.browse("codex", f.outside), { code: "permission_denied" });
  } finally {
    await chmod(f.outside, 0o700);
  }
});

test("native project/create uses the verified idempotencyKey and roots schema", async () => {
  const adapter = new CodexAppServerAdapter({
    codexBin: "/test/codex",
    workspace: "/test",
  });
  adapter.request = async (method, params) => {
    assert.equal(method, "project/create");
    assert.deepEqual(params, {
      name: "demo",
      roots: [{ path: "/test/demo" }],
      idempotencyKey: "stable",
    });
    return {
      project: {
        id: "project-id",
        name: "demo",
        roots: params.roots,
        createdAt: 1,
        updatedAt: 2,
      },
    };
  };
  assert.equal(
    (
      await adapter.createProject({
        cwd: "/test/demo",
        name: "demo",
        idempotencyKey: "stable",
      })
    ).id,
    "project-id:0",
  );
});

for (const provider of ["codex", "kimi"]) {
test(`${provider} project responses and durable operation checkpoints remain encrypted and browser-specific`, async (t) => {
  const f = await fixture(t);
  f.adapter.provider = provider;
  const statePath = join(f.root, "outbox.json");
  const relay = new MacRelay({
    adapter: f.adapter,
    workspace: f.allowed,
    statePath,
    deviceId: "dev_test",
    serverUrl: "https://example.invalid",
  });
  const key = generateE2eeKey();
  const keyId = await keyIdForKey(key);
  const browser = { browserId: "browser1", key, keyId };
  relay.activeBrowserKeys.set("browser1", browser);
  relay.projectOperationBrowser = browser;
  await relay.projectManager.create(
    {
      provider,
      mode: "new",
      name: "secret-project-name",
      path: f.allowed,
      operation_id: "project_opaque_create",
    },
    "browser1",
  );
  if (provider === "kimi") {
    const restarted = new MacRelay({ adapter: f.adapter, workspace: f.allowed, statePath, deviceId: "dev_test", serverUrl: "https://example.invalid" });
    const catalog = await restarted.readProjectCatalog();
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0].provider, provider);
    assert.equal(catalog[0].name, "secret-project-name");
  }
  const raw = await readFile(statePath, "utf8");
  assert.ok(!raw.includes("secret-project-name"));
  assert.ok(!raw.includes(f.allowed));
  relay.requestBrowsers.set("req_test", "browser1");
  const uploads = [];
  relay.enqueueRemoteMessages = (messages) => uploads.push(...messages);
  relay.flushRemoteUploads = async () => {};
  relay.acknowledgeCommand = () => {};
  await relay.handleProjectCommand({
    type: "project.check",
    request_id: "req_test",
    browser_id: "browser1",
    device_id: "dev_test",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    payload: {provider, path: f.allowed, name: "private-check-name"},
  });
  assert.equal(uploads.length, 1);
  assert.ok(!JSON.stringify(uploads).includes("private-check-name"));
  const checked = await openJson(key, uploads[0].envelope, uploads[0].aad);
  assert.equal(checked.path, join(f.allowed, "private-check-name"));
  assert.equal(checked.can_create, true);
  relay.requestBrowsers.set("req_test", "browser1");
  const [encoded] = await relay.encodeRemoteMessage({
    type: "project.result",
    request_id: "req_test",
    session_id: null,
    locations: [{ path: f.allowed }],
  });
  assert.equal(encoded.browser_id, "browser1");
  assert.ok(!JSON.stringify(encoded).includes(f.allowed));
  assert.equal(
    (await openJson(key, encoded.envelope, encoded.aad)).locations[0].path,
    f.allowed,
  );
});
}

test("project check is read-only, resolves paths and refuses existing entries", async (t) => {
  const f = await fixture(t);
  const payload = { provider: "codex", path: f.allowed, name: " Fresh " };
  assert.deepEqual(await f.manager.check(payload), {
    path: join(f.allowed, "Fresh"), can_create: true,
  });
  assert.deepEqual((await f.manager.browse("codex", f.allowed)).directories, []);
  assert.equal(f.saves(), 0);
  await mkdir(join(f.allowed, "Fresh"));
  assert.equal((await f.manager.check(payload)).error_code, "already_exists");
  await writeFile(join(f.allowed, "file"), "keep");
  assert.equal((await f.manager.check({...payload, name: "file"})).can_create, false);
  await symlink(join(f.allowed, "missing"), join(f.allowed, "link"));
  assert.equal((await f.manager.check({...payload, name: "link"})).can_create, false);
  await assert.rejects(f.manager.check({...payload, name: "../bad"}), {code: "invalid_name"});
  await assert.rejects(f.manager.check({...payload, path: join(f.root, "missing")}), {code: "location_unavailable"});
  assert.equal(await readFile(join(f.allowed, "file"), "utf8"), "keep");
});

for (const provider of ["kimi", "claude", "claude-cowork", "opencode", "pi"]) {
  test(`${provider} projects survive restart without creating sessions and remain provider-isolated`, async (t) => {
    const f = await fixture(t);
    f.adapter.status = () => Object.fromEntries(["codex", "kimi", "claude", "claude-cowork", "opencode", "pi"].map(p => [p, { ready: true }]));
    const path = join(f.root, "local-projects.json");
    f.options.localProjects = new LocalProjectStore(path);
    const manager = new ProjectManager(f.options);
    const payload = { provider, mode: "new", path: f.allowed, name: provider, operation_id: "project_multi_agent" };
    const created = await manager.create(payload, "browser1");
    assert.equal(created.project.provider, provider);
    assert.equal(f.saves(), 0);
    const restarted = new ProjectManager({ ...f.options, localProjects: new LocalProjectStore(path) });
    assert.deepEqual(await restarted.listProjects(), [created.project]);
    assert.deepEqual(await restarted.create(payload, "browser1"), created);
    const added = await restarted.create({ ...payload, mode: "existing", path: created.project.cwd, operation_id: "project_add_existing" }, "browser2");
    assert.deepEqual(added, created);
    const other = provider === "kimi" ? "claude" : "kimi";
    const isolated = await restarted.create({ ...payload, provider: other, mode: "existing", path: created.project.cwd, operation_id: "project_other_agent" }, "browser1");
    assert.notEqual(isolated.project.id, created.project.id);
    assert.equal(isolated.project.provider, other);
    const locations = await restarted.locations(provider);
    assert.ok(locations.locations.some(location => location.projects.includes(provider)));
    f.adapter.status = () => ({ [provider]: { ready: false } });
    await assert.rejects(restarted.create({ ...payload, name: "unavailable" }, "browser1"), { code: "unsupported" });
    await assert.rejects(restarted.browse("unknown", f.allowed), { code: "unsupported" });
  });
}

test("failed local project persistence resumes using the directory checkpoint", async (t) => {
  const f = await fixture(t);
  f.adapter.provider = "kimi";
  const path = join(f.root, "registry");
  await writeFile(path, "invalid json");
  const manager = new ProjectManager({ ...f.options, localProjects: new LocalProjectStore(path) });
  const payload = { provider: "kimi", mode: "new", path: f.allowed, name: "retry-local", operation_id: "project_retry_local" };
  await assert.rejects(manager.create(payload, "browser1"));
  await writeFile(join(f.allowed, "retry-local", "keep.txt"), "keep");
  await rm(path);
  const result = await manager.create(payload, "browser1");
  assert.equal(result.project.provider, "kimi");
  assert.equal(await readFile(join(result.project.cwd, "keep.txt"), "utf8"), "keep");
});


test("location suggestions isolate provider and return bookmarks when native discovery hangs", async t => {
  const f = await fixture(t);
  const localProjects = new LocalProjectStore();
  await localProjects.create({ provider: "kimi", cwd: join(f.outside, "project"), name: "saved" });
  let markDiscoveryStarted;
  const discoveryStarted = new Promise(resolve => { markDiscoveryStarted = resolve; });
  const selected = { listSessions: () => {
    markDiscoveryStarted();
    return new Promise(() => {});
  }, listProjects: () => new Promise(() => {}) };
  const manager = new ProjectManager({ ...f.options, localProjects, locationTimeoutMs: 10,
    adapter: { status: () => ({ kimi: { ready: true } }), adapters: new Map([["kimi", selected]]),
      listSessions: () => { throw new Error("must not scan all providers"); },
      listProjects: () => { throw new Error("must not scan all providers"); } } });
  // Exercise the native timeout without racing real filesystem I/O against a
  // 10ms wall-clock deadline under parallel test load.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const loading = manager.locations("kimi");
  await discoveryStarted;
  t.mock.timers.tick(10);
  const result = await loading;
  assert.equal(result.locations.length, 2);
  assert.equal(result.locations[0].path, f.outside);
  assert.equal(result.locations[1].path, f.allowed);
  assert.ok(result.locations.every(location => location.available && location.writable));
});


test("an unavailable filesystem location cannot hold the entire suggestion list", async t => {
  const f = await fixture(t);
  f.manager.locationTimeoutMs = 10;
  const checked = f.manager.checked.bind(f.manager);
  f.manager.checked = path => path === f.outside ? new Promise(() => {}) : checked(path);
  const { locations } = await f.manager.locations("codex");
  assert.equal(locations.find(x => x.path === f.allowed).available, true);
  assert.equal(locations.find(x => x.path === f.outside).available, false);
});
