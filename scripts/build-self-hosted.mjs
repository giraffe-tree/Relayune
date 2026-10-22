import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = path.join(root, "out");
const staticDir = path.join(root, "dist", "self-hosted");
const serverDir = path.join(root, "dist", "self-hosted-server");

for (const legacyDirectory of [
  path.join(root, "dist", "client"),
  path.join(root, "dist", "server"),
  path.join(root, "dist", ".openai"),
]) {
  await rm(legacyDirectory, { recursive: true, force: true });
}
await rm(staticDir, { recursive: true, force: true });
await rm(serverDir, { recursive: true, force: true });
await mkdir(staticDir, { recursive: true });
await mkdir(serverDir, { recursive: true });
await cp(clientDir, staticDir, { recursive: true });
await cp(path.join(root, "release-notes"), path.join(serverDir, "release-notes"), {
  recursive: true,
});

console.log("Built independent self-hosted static files; official download validation is a separate command.");
