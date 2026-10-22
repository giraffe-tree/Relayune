import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { canCreateSessionWorktree, createSessionWorktree } from "../relay/session-worktree.mjs";

const execFileAsync = promisify(execFile);
const git = async (cwd, args) => (await execFileAsync("git", ["-C", cwd, ...args], {
  encoding: "utf8", windowsHide: true,
})).stdout.trim();
const hash = (value) => createHash("sha256").update(value).digest("hex");

async function fixture(t, name = "repo") {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-session-worktree-"));
  const root = await realpath(temporary);
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, name), rootDir = join(root, "app data");
  await mkdir(cwd); await mkdir(rootDir);
  await git(cwd, ["init"]);
  await mkdir(join(cwd, "packages", "chat"), { recursive: true });
  await writeFile(join(cwd, "tracked.txt"), "committed\n");
  await writeFile(join(cwd, ".gitignore"), "ignored-user.txt\n");
  await writeFile(join(cwd, "packages", "chat", "index.txt"), "subdirectory\n");
  await git(cwd, ["add", "."]);
  await git(cwd, ["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "-m", "fixture"]);
  return { root, cwd, rootDir };
}

test("session worktree checks Git and HEAD without creating anything; errors stay sanitized", async (t) => {
  const f = await fixture(t), unborn = join(f.root, "unborn"), nonrepo = join(f.root, "nonrepo");
  await mkdir(unborn); await mkdir(nonrepo); await git(unborn, ["init"]);
  assert.equal(await canCreateSessionWorktree(f.cwd), true);
  for (const cwd of [unborn, nonrepo, join(f.root, "missing"), "relative", null]) {
    assert.equal(await canCreateSessionWorktree(cwd), false);
    await assert.rejects(createSessionWorktree({ cwd, rootDir: f.rootDir, requestId: "one" }), {
      code: "session_worktree_unavailable", message: "session_worktree_unavailable",
    });
  }
  await assert.rejects(access(join(f.rootDir, "session-worktrees")), { code: "ENOENT" });
  await assert.rejects(createSessionWorktree({ cwd: f.cwd, rootDir: nonrepo, requestId: "" }), {
    code: "session_worktree_unavailable",
  });
});

test("session worktree uses current commit, keeps dirty source files and creates no branch", async (t) => {
  const f = await fixture(t), head = await git(f.cwd, ["rev-parse", "HEAD"]);
  const branches = await git(f.cwd, ["for-each-ref", "refs/heads"]);
  await writeFile(join(f.cwd, "tracked.txt"), "dirty source\n");
  await writeFile(join(f.cwd, "untracked.txt"), "source only\n");
  const before = await git(f.cwd, ["status", "--porcelain"]);
  const worktree = await createSessionWorktree({ ...f, requestId: "current-commit" });
  assert.equal(await readFile(join(worktree.cwd, "tracked.txt"), "utf8"), "committed\n");
  await assert.rejects(access(join(worktree.cwd, "untracked.txt")), { code: "ENOENT" });
  assert.equal(await git(worktree.cwd, ["rev-parse", "HEAD"]), head);
  await assert.rejects(git(worktree.cwd, ["symbolic-ref", "HEAD"]));
  assert.equal(await git(f.cwd, ["status", "--porcelain"]), before);
  assert.equal(await git(f.cwd, ["for-each-ref", "refs/heads"]), branches);
  await worktree.cleanup();
  await worktree.cleanup();
  await assert.rejects(access(worktree.path), { code: "ENOENT" });
});

test("session worktree maps nested cwd and can branch from another existing worktree", async (t) => {
  const f = await fixture(t), linked = join(f.root, "existing worktree");
  await git(f.cwd, ["worktree", "add", "--detach", linked]);
  const cwd = join(linked, "packages", "chat");
  assert.equal(await canCreateSessionWorktree(cwd), true);
  const worktree = await createSessionWorktree({ cwd, rootDir: f.rootDir, requestId: "nested" });
  assert.equal(worktree.cwd, join(worktree.path, "packages", "chat"));
  assert.equal(await readFile(join(worktree.cwd, "index.txt"), "utf8"), "subdirectory\n");
  assert.equal(await git(worktree.cwd, ["rev-parse", "HEAD"]), await git(cwd, ["rev-parse", "HEAD"]));
  await worktree.cleanup();
  await git(f.cwd, ["worktree", "remove", linked]);
});

test("session worktree creates an empty mapped directory without copying untracked contents", async (t) => {
  const f = await fixture(t), cwd = join(f.cwd, "new folder");
  await mkdir(cwd); await writeFile(join(cwd, "dirty.txt"), "stay in source");
  const worktree = await createSessionWorktree({ cwd, rootDir: f.rootDir, requestId: "untracked-subdirectory" });
  await access(worktree.cwd);
  await assert.rejects(access(join(worktree.cwd, "dirty.txt")), { code: "ENOENT" });
  await worktree.cleanup();
});

test("session worktree refuses collisions and never removes files from a dirty owned checkout", async (t) => {
  const f = await fixture(t), input = { ...f, requestId: "collision" };
  const worktree = await createSessionWorktree(input);
  await assert.rejects(createSessionWorktree(input), {
    code: "session_worktree_failed", message: "session_worktree_failed",
  });
  await writeFile(join(worktree.path, "new-user-file.txt"), "retain");
  await assert.rejects(worktree.cleanup(), { code: "session_worktree_failed" });
  assert.equal(await readFile(join(worktree.path, "new-user-file.txt"), "utf8"), "retain");
  await rm(join(worktree.path, "new-user-file.txt"));
  await writeFile(join(worktree.path, "ignored-user.txt"), "retain ignored user file");
  assert.equal(await git(worktree.path, ["status", "--porcelain"]), "");
  await assert.rejects(worktree.cleanup(), { code: "session_worktree_failed" });
  assert.equal(await readFile(join(worktree.path, "ignored-user.txt"), "utf8"), "retain ignored user file");
  await rm(join(worktree.path, "ignored-user.txt"));
  await worktree.cleanup();
});

test("session worktree hashes opaque request IDs and passes unusual source paths as Git arguments", async (t) => {
  const f = await fixture(t, "repo; touch INJECTED"), requestId = "../../outside; $(touch INJECTED); `touch INJECTED`";
  const worktree = await createSessionWorktree({ ...f, requestId });
  assert.equal(dirname(dirname(worktree.path)), join(f.rootDir, "session-worktrees"));
  assert.equal(worktree.path, join(f.rootDir, "session-worktrees", hash(process.platform === "win32" ? f.cwd.toLowerCase() : f.cwd), `${basename(f.cwd)}-${hash(requestId).slice(0, 16)}`));
  await assert.rejects(access(join(f.root, "INJECTED")), { code: "ENOENT" });
  await assert.rejects(access(join(f.cwd, "INJECTED")), { code: "ENOENT" });
  await worktree.cleanup();
});

test("session worktree directory keeps a readable Unicode project name within filesystem limits", async (t) => {
  const f = await fixture(t, "中文项目".repeat(15)), requestId = "readable-name";
  const worktree = await createSessionWorktree({ ...f, requestId });
  assert.equal(basename(worktree.path), `${"中文项目".repeat(10)}-${hash(requestId).slice(0, 16)}`);
  assert.ok(Buffer.byteLength(basename(worktree.path)) <= 137);
  await worktree.cleanup();
});

test("session worktree refuses managed symlink redirection and cleanup of a replaced checkout", async (t) => {
  if (process.platform === "win32") { t.skip("directory symlink needs Windows privileges"); return; }
  const f = await fixture(t), outside = join(f.root, "outside");
  await mkdir(outside);
  await symlink(outside, join(f.rootDir, "session-worktrees"));
  await assert.rejects(createSessionWorktree({ ...f, requestId: "redirected" }), { code: "session_worktree_failed" });
  await rm(join(f.rootDir, "session-worktrees"));
  const worktree = await createSessionWorktree({ ...f, requestId: "replaced" });
  const saved = `${worktree.path}-saved`;
  await rename(worktree.path, saved);
  await mkdir(worktree.path);
  await writeFile(join(worktree.path, "user.txt"), "keep replacement");
  await assert.rejects(worktree.cleanup(), { code: "session_worktree_failed" });
  assert.equal(await readFile(join(worktree.path, "user.txt"), "utf8"), "keep replacement");
  await rm(worktree.path, { recursive: true });
  await rename(saved, worktree.path);
  await worktree.cleanup();
});

test("session worktree never maps cwd through a symlink restored by the current commit", async (t) => {
  if (process.platform === "win32") { t.skip("directory symlink needs Windows privileges"); return; }
  const f = await fixture(t), outside = join(f.root, "outside"), link = join(f.cwd, "linked");
  await mkdir(outside); await symlink(outside, link);
  await git(f.cwd, ["add", "linked"]);
  await git(f.cwd, ["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "-m", "symlink"]);
  await rm(link); await mkdir(join(link, "nested"), { recursive: true });
  await assert.rejects(createSessionWorktree({ cwd: join(link, "nested"), rootDir: f.rootDir, requestId: "old-symlink" }), {
    code: "session_worktree_failed",
  });
  await assert.rejects(access(join(outside, "nested")), { code: "ENOENT" });
  assert.equal((await git(f.cwd, ["worktree", "list", "--porcelain"])).match(/^worktree /gm).length, 1);
});
