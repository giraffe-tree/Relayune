import { chmod, lstat, mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";

export async function prepareHookDirectory(paths) {
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const directory = await lstat(paths.directory);
  if (!directory.isDirectory() || directory.uid !== process.getuid()) throw new Error("unsafe_hook_directory");
  await chmod(paths.directory, 0o700);
}

// Serialize Relayune writers. A crash during the short critical section leaves
// a lock for manual inspection; never remove an unverified owner's lock.
export async function withHookLock(paths, name, operation) {
  await prepareHookDirectory(paths);
  const path = join(paths.directory, name + ".lock");
  const lock = await open(path, "wx", 0o600);
  try { return await operation(); }
  finally { await lock.close(); await unlink(path); }
}
