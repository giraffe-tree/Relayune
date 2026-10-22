import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const unavailable = "session_worktree_unavailable";
const failed = "session_worktree_failed";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

const normalize = (path) => process.platform !== "win32" ? path
  : path.startsWith("\\\\?\\UNC\\") ? `\\\\${path.slice(8)}`
    : path.startsWith("\\\\?\\") ? path.slice(4) : path;
const identity = (path) => process.platform === "win32" ? normalize(path).toLowerCase() : path;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const outputPath = (value) => normalize(value.replace(/\r?\n$/, ""));

function checkoutName(root, requestId) {
  let name = "";
  for (const character of basename(root)) {
    if (Buffer.byteLength(name + character) > 120) break;
    name += character;
  }
  return `${name || "project"}-${hash(requestId).slice(0, 16)}`;
}

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true,
  });
  return stdout;
}

async function checkedSource(cwd) {
  if (typeof cwd !== "string" || !isAbsolute(cwd)) fail(unavailable);
  const canonical = normalize(await realpath(cwd));
  if (!(await stat(canonical)).isDirectory()) fail(unavailable);
  const root = normalize(await realpath(outputPath(await git(canonical, ["rev-parse", "--show-toplevel"]))));
  const subdirectory = relative(root, canonical);
  if (isAbsolute(subdirectory) || subdirectory === ".." || subdirectory.startsWith(`..${sep}`)) fail(unavailable);
  const head = (await git(canonical, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  if (!/^[a-f0-9]{40,64}$/i.test(head)) fail(unavailable);
  return { root, subdirectory, head };
}

/** Availability only; this does not create directories or mutate the checkout. */
export async function canCreateSessionWorktree(cwd) {
  try { await checkedSource(cwd); return true; }
  catch { return false; }
}

async function managedDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  // Existing managed directories must not redirect a new checkout elsewhere.
  if (identity(normalize(await realpath(path))) !== identity(resolve(path))) fail(failed);
}

async function mappedDirectory(path, subdirectory) {
  let directory = path;
  for (const part of subdirectory.split(sep).filter(Boolean)) {
    directory = join(directory, part);
    try { await mkdir(directory); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const entry = await lstat(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail(failed);
  }
  return directory;
}

/** A detached checkout at the current commit; uncommitted source files stay put. */
export async function createSessionWorktree({ cwd, requestId, rootDir } = {}) {
  let source, managedRoot;
  try {
    if (typeof requestId !== "string" || !requestId || requestId.length > 4096 ||
        typeof rootDir !== "string" || !isAbsolute(rootDir)) fail(unavailable);
    source = await checkedSource(cwd);
    managedRoot = normalize(await realpath(rootDir));
    if (!(await stat(managedRoot)).isDirectory()) fail(unavailable);
  } catch { fail(unavailable); }

  const parent = join(managedRoot, "session-worktrees", hash(identity(source.root)));
  const path = join(parent, checkoutName(source.root, requestId));
  let created = false;
  let createdDirectory;
  const cleanup = async () => {
    if (!created) return;
    try {
      const current = await lstat(path);
      if (current.isSymbolicLink() || current.dev !== createdDirectory.dev ||
          current.ino !== createdDirectory.ino ||
          identity(normalize(await realpath(path))) !== identity(path)) fail(failed);
      // Git's removal check can overlook ignored files created since checkout.
      if (await git(path, ["status", "--porcelain", "-z", "--untracked-files=all", "--ignored", "--ignore-submodules=none"])) fail(failed);
      // Git refuses tracked or untracked user changes; never force removal.
      await git(source.root, ["worktree", "remove", path]);
      created = false;
    } catch { fail(failed); }
  };

  try {
    await managedDirectory(join(managedRoot, "session-worktrees"));
    await managedDirectory(parent);
    try { await lstat(path); fail(failed); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await git(source.root, ["worktree", "add", "--detach", path, source.head]);
    createdDirectory = await lstat(path);
    created = true;
    const mappedCwd = await mappedDirectory(path, source.subdirectory);
    if (identity(normalize(await realpath(mappedCwd))) !== identity(mappedCwd)) fail(failed);
    return { cwd: mappedCwd, path, cleanup };
  } catch {
    if (created) await cleanup().catch(() => {});
    fail(failed);
  }
}
