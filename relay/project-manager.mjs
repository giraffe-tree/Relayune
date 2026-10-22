import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
  realpath,
  stat,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { createHash } from "node:crypto";

export class ProjectError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new ProjectError(code);
};
const normalizeLocation = (path) =>
  process.platform !== "win32"
    ? path
    : path.startsWith("\\\\?\\UNC\\")
      ? `\\\\${path.slice(8)}`
      : path.startsWith("\\\\?\\")
        ? path.slice(4)
        : path;
const identity = (path) =>
  process.platform === "win32" ? normalizeLocation(path).toLowerCase() : path;

export function validateProjectName(value) {
  if (typeof value !== "string") fail("invalid_name");
  const name = value.trim();
  if (
    !name ||
    Buffer.byteLength(name) > 240 ||
    /[\\/\u0000-\u001f\u007f]/.test(name) ||
    name === "." ||
    name === ".." ||
    (process.platform === "win32" &&
      (/[<>:"|?*]|[. ]$/.test(name) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)))
  )
    fail("invalid_name");
  return name;
}

const providers = new Set(["codex", "kimi", "claude", "claude-cowork", "opencode", "pi"]);

/** Local directory bookmarks for agents without a native project registry.
 * Never uploaded as files; catalogs travel through the existing encrypted snapshot.
 */
export class LocalProjectStore {
  constructor(path = null) {
    this.path = path;
    this.projects = [];
  }
  async list() {
    if (!this.path) return this.projects;
    try {
      return JSON.parse(await readFile(this.path, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }
  async create({ provider, cwd, name }) {
    const projects = await this.list();
    const id = `local_${createHash("sha256").update(`${provider}:${identity(cwd)}`).digest("hex")}`;
    const existing = projects.find(project => project.id === id);
    if (existing) return existing;
    const project = { id, provider, cwd, name, updated_at: new Date().toISOString() };
    const next = [...projects, project];
    if (this.path) {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await rename(temporary, this.path);
    }
    this.projects = next;
    return project;
  }
}

/** Paired clients use the Desktop process's OS filesystem permissions. */
export class ProjectManager {
  constructor({ adapter, defaultLocation, loadOperation, saveOperation, localProjects = new LocalProjectStore(), locationTimeoutMs = 3000 }) {
    Object.assign(this, { adapter, defaultLocation, loadOperation, saveOperation, localProjects, locationTimeoutMs });
    this.chain = Promise.resolve();
  }
  async supported(provider) {
    if (!providers.has(provider)) fail("unsupported");
    if (typeof this.adapter.status === "function") {
      if (!this.adapter.status()[provider]?.ready) fail("unsupported");
    } else if ((this.adapter.provider ?? "codex") !== provider) {
      fail("unsupported");
    }
    if (provider === "codex" && !(await this.adapter.supportsProjects?.(provider)))
      fail("unsupported");
  }
  async listProjects() {
    const native = await this.adapter.listProjects?.() ?? [];
    const local = await this.localProjects.list();
    return [...native, ...local.filter(project => !native.some(candidate =>
      (candidate.provider ?? "codex") === project.provider &&
      identity(candidate.cwd) === identity(project.cwd)
    ))];
  }
  async checked(path, write = false) {
    if (typeof path !== "string" || !isAbsolute(path)) fail("invalid_location");
    const canonical = await realpath(path)
      .then(normalizeLocation)
      .catch((error) =>
        fail(
          ["EACCES", "EPERM"].includes(error.code)
            ? "permission_denied"
            : "location_unavailable",
        ),
      );
    if (!(await stat(canonical)).isDirectory()) fail("location_unavailable");
    await access(
      canonical,
      constants.R_OK |
        (process.platform === "win32" ? 0 : constants.X_OK) |
        (write ? constants.W_OK : 0),
    ).catch(() => fail("permission_denied"));
    return canonical;
  }
  async sessions({ provider, cwd, cursor = null }) {
    if (!providers.has(provider) || typeof cwd !== "string" || !isAbsolute(cwd) ||
        (cursor !== null && (typeof cursor !== "string" || cursor.length > 4096))) fail("invalid_request");
    const adapter = this.adapter.adapters?.get(provider) ?? this.adapter;
    if ((adapter.provider ?? "codex") !== provider) fail("unsupported");
    const page = adapter.listProjectSessions
      ? await adapter.listProjectSessions({ cwd, cursor })
      : await this.sessionFallback(adapter, cwd, cursor);
    return { ...page, sessions: page.sessions.map(session =>
      this.adapter.decorateSession ? this.adapter.decorateSession(session, provider) : { ...session, provider }) };
  }
  async sessionFallback(adapter, cwd, cursor) {
    const offset = cursor === null ? 0 : Number(cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) fail("invalid_request");
    const sessions = (await adapter.listSessions()).filter(session =>
      identity(session.cwd) === identity(cwd) && !session.is_subagent);
    return { sessions: sessions.slice(offset, offset + 5),
      next_cursor: sessions.length > offset + 5 ? String(offset + 5) : null };
  }
  async locations(provider) {
    await this.supported(provider);
    // Suggestions must not wait for unrelated providers or a hung native scan.
    // Existing bookmarks and the default directory remain usable while offline.
    const target = this.adapter.adapters?.get(provider) ?? this.adapter;
    const bounded = async (operation, fallback) => {
      let timer;
      try {
        return await Promise.race([
          Promise.resolve().then(operation),
          new Promise(resolve => { timer = setTimeout(() => resolve(fallback), this.locationTimeoutMs); }),
        ]);
      } catch { return fallback; }
      finally { clearTimeout(timer); }
    };
    const [local, native, sessions] = await Promise.all([
      this.localProjects.list(),
      bounded(() => target.listProjects?.() ?? [], []),
      bounded(() => target.listSessions(), this.adapter.sessionCatalogs?.get(provider) ?? []),
    ]);
    const projects = [...local, ...native.map(project => ({ ...project, provider }))];
    const candidates = new Map();
    const records = [...projects, ...sessions.filter((s) => !s.is_subagent)]
      .filter(
        (p) => (p.provider ?? "codex") === provider && isAbsolute(p.cwd || ""),
      )
      .sort(
        (a, b) =>
          (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0),
      );
    for (const p of records) {
      const path = dirname(resolve(p.cwd));
      const key = identity(path);
      if (!candidates.has(key))
        candidates.set(key, {
          path,
          name: basename(path) || path,
          projects: [],
        });
      const names = candidates.get(key).projects;
      const name = p.project || p.name || basename(p.cwd);
      if (!names.includes(name) && names.length < 3) names.push(name);
    }
    const fallback = this.defaultLocation;
    if (
      typeof fallback === "string" &&
      isAbsolute(fallback) &&
      !candidates.has(identity(fallback))
    ) {
      candidates.set(identity(fallback), {
        path: fallback,
        name: basename(fallback) || fallback,
        projects: [],
      });
    }
    const checked = await Promise.all([...candidates.values()].slice(0, 100).map(item =>
      bounded(async () => {
        try {
          const path = await this.checked(item.path);
          const writable = await access(path, constants.W_OK).then(() => true, () => false);
          return { ...item, path, available: true, writable };
        } catch (error) {
          return { ...item, available: false, writable: false, error_code: error.code || "location_unavailable" };
        }
      }, { ...item, available: false, writable: false, error_code: "location_unavailable" }),
    ));
    const locations = [];
    for (const item of checked) {
      if (!locations.some(p => identity(p.path) === identity(item.path))) locations.push(item);
    }
    return { locations };
  }
  async browse(provider, path, offset = 0) {
    await this.supported(provider);
    const cwd = await this.checked(path);
    if (!Number.isSafeInteger(offset) || offset < 0) fail("invalid_location");
    const entries = (await readdir(cwd, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.isSymbolicLink())
      .sort((a, b) => a.name.localeCompare(b.name));
    const directories = entries
      .slice(offset, offset + 100)
      .map((e) => ({ name: e.name, path: join(cwd, e.name) }));
    let parent = null;
    if (dirname(cwd) !== cwd)
      parent = await this.checked(dirname(cwd)).catch(() => null);
    return {
      path: cwd,
      parent,
      directories,
      next_offset: offset + 100 < entries.length ? offset + 100 : null,
    };
  }
  async check({ provider, path, name }) {
    await this.supported(provider);
    const validName = validateProjectName(name);
    const location = await this.checked(path, true);
    const cwd = join(location, validName);
    const exists = await lstat(cwd).then(
      () => true,
      (error) => error.code === "ENOENT" ? false : fail("permission_denied"),
    );
    return { path: cwd, can_create: !exists, ...(exists ? { error_code: "already_exists" } : {}) };
  }
  create(payload, owner) {
    const operation = this.chain
      .catch(() => {})
      .then(() => this.createSerial(payload, owner));
    this.chain = operation;
    return operation;
  }
  async createSerial(payload, owner) {
    const { provider, mode, path, operation_id: operationId } = payload;
    await this.supported(provider);
    if (
      !/^[a-zA-Z0-9_-]{10,100}$/.test(operationId || "") ||
      !["new", "existing"].includes(mode)
    )
      fail("invalid_request");
    const name = mode === "new" ? validateProjectName(payload.name) : null;
    const signature = JSON.stringify({ provider, mode, path, name });
    const storageId = createHash("sha256")
      .update(`${owner}:${operationId}`)
      .digest("hex");
    let record = await this.loadOperation(storageId);
    if (record && record.signature !== signature) fail("operation_mismatch");
    if (record?.project) return { project: record.project };
    const location = await this.checked(path, mode === "new");
    let cwd = mode === "new" ? join(location, name) : location;
    if (record?.cwd && record.cwd !== cwd) fail("location_changed");
    if (mode === "new" && record?.stage !== "created") {
      // A crash between mkdir and the durable checkpoint is deliberately ambiguous.
      // Never claim an existing directory as ours, overwrite it, or delete it.
      const exists = await lstat(cwd).then(
        () => true,
        (error) =>
          error.code === "ENOENT" ? false : fail("permission_denied"),
      );
      if (exists) fail(record ? "creation_unconfirmed" : "already_exists");
      record = { signature, cwd, stage: "creating" };
      await this.saveOperation(storageId, record);
      const parentBefore = await stat(location);
      if ((await this.checked(path, true)) !== location)
        fail("location_changed");
      await mkdir(cwd, { mode: 0o700 }).catch((error) =>
        fail(error.code === "EEXIST" ? "already_exists" : "permission_denied"),
      );
      const parentAfter = await stat(location);
      if (
        parentBefore.dev !== parentAfter.dev ||
        parentBefore.ino !== parentAfter.ino ||
        normalizeLocation(await realpath(cwd)) !== cwd
      )
        fail("location_changed");
      const info = await stat(cwd);
      record = { ...record, stage: "created", dev: info.dev, ino: info.ino };
      await this.saveOperation(storageId, record);
    }
    cwd = await this.checked(cwd);
    if (record?.stage === "created") {
      const info = await lstat(cwd);
      if (
        info.dev !== record.dev ||
        info.ino !== record.ino ||
        info.isSymbolicLink()
      )
        fail("location_changed");
    }
    const projects = await this.listProjects();
    let existing;
    for (const candidate of projects) {
      if (
        (candidate.provider ?? "codex") !== provider ||
        !isAbsolute(candidate.cwd || "")
      )
        continue;
      const actual = await realpath(candidate.cwd).catch(() => null);
      if (actual && identity(actual) === identity(cwd)) {
        existing = candidate;
        break;
      }
    }
    let project = existing;
    if (!project) {
      try {
        const options = { cwd, name: name || basename(cwd), provider, idempotencyKey: storageId };
        project = provider === "codex"
          ? await this.adapter.createProject(options)
          : await this.localProjects.create(options);
      } catch {
        fail(mode === "new" ? "save_failed_directory_created" : "save_failed");
      }
    }
    await this.saveOperation(storageId, {
      signature,
      cwd,
      project,
      stage: "complete",
    });
    return { project };
  }
}
