import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { RESPONSE_WINDOW_MS, COMMAND_MAX_TTL_MS, COMMAND_RECEIPT_GRACE_MS } from "../shared/relay-retention.mjs";

export class FileBlobStore {
  private scan: AsyncGenerator<{ filename: string; kind: string }> | null = null;
  constructor(private readonly root: string) {}
  private filename(key: string) {
    if (!/^[A-Za-z0-9._/-]+$/.test(key) || key.includes("..")) throw new Error("Invalid blob key");
    const filename = path.resolve(this.root, key);
    if (!filename.startsWith(`${path.resolve(this.root)}${path.sep}`)) throw new Error("Invalid blob key");
    return filename;
  }
  async get(key: string) {
    try {
      const content = await fs.readFile(this.filename(key), "utf8");
      return { text: async () => content };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async put(key: string, value: string) {
    const filename = this.filename(key);
    const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
        await fs.writeFile(temporary, value, { encoding: "utf8", mode: 0o600 });
        await fs.rename(temporary, filename);
        return;
      } catch (error) {
        // A sweep may remove an empty directory between mkdir and write.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || attempt >= 2) throw error;
      }
    }
  }
  async delete(key: string) {
    await fs.unlink(this.filename(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  private async *files(directory: string, kind: string): AsyncGenerator<{ filename: string; kind: string }> {
    let handle;
    try { handle = await fs.opendir(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for await (const entry of handle) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        yield* this.files(filename, kind);
        // Only empty directories are removed. Never follow symlinks or recursively rm.
        await fs.rmdir(filename).catch((error: NodeJS.ErrnoException) => {
          if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code ?? "")) throw error;
        });
      } else if (entry.isFile()) yield { filename, kind };
    }
  }
  private async *allFiles() {
    for (const kind of ["responses", "commands"]) yield* this.files(path.join(this.root, kind), kind);
  }
  async prune(now = Date.now()) {
    this.scan ??= this.allFiles();
    let removed = 0;
    try {
      for (let checked = 0; checked < 500; checked++) {
        const next = await this.scan.next();
        if (next.done) { this.scan = null; break; }
        const { filename, kind } = next.value;
        let info;
        try { info = await fs.lstat(filename); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
        if (!info.isFile()) continue;
        const parts = path.relative(this.root, filename).split(path.sep);
        // New response keys carry an absolute deadline; old files use mtime for
        // migration. Command keys already carry the signed command deadline.
        const stamped = /^\d{13}$/.test(parts[1] ?? "") ? Number(parts[1]) : null;
        const deadline = stamped === null
          ? info.mtimeMs + (kind === "responses" ? RESPONSE_WINDOW_MS : COMMAND_MAX_TTL_MS + COMMAND_RECEIPT_GRACE_MS)
          : stamped + (kind === "commands" ? COMMAND_RECEIPT_GRACE_MS : 0);
        if (deadline > now) continue;
        await fs.unlink(filename).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
        removed++;
      }
    } catch (error) { await this.scan?.return(undefined); this.scan = null; throw error; }
    return removed;
  }
  async close() { await this.scan?.return(undefined); this.scan = null; }
}
