import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// A real CLI process must terminate even though its Agent keeps stdin open.
// Synthetic credentials and a loopback server only; no user account or history.
for (const ignoresTerm of [false, true]) test(`failed initial registration exits and closes the live Agent${ignoresTerm ? " even when it ignores TERM" : " instead of staying Connecting"}`, { timeout: 15000, skip: ignoresTerm && process.platform === "win32" }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "relay-startup-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let registered = false;
  const server = createServer((req, res) => {
    registered ||= req.url === "/api/relay/hello";
    req.resume();
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "synthetic registration failure" } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const binary = join(directory, "fake-kimi");
  const pidFile = join(directory, "agent.pid");
  await writeFile(binary, `#!${process.execPath}\nimport { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n${ignoresTerm ? 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);' : ''}\nawait import(${JSON.stringify(new URL("./fixtures/fake-kimi-acp.mjs", import.meta.url).href)});\n`, { mode: 0o700 });
  const child = spawn(process.execPath, [fileURLToPath(new URL("../relay/cli.mjs", import.meta.url)), "relay"], {
    detached: process.platform !== "win32",
    env: {
      PATH: process.env.PATH, HOME: directory,
      RELAY_SERVER_URL: `http://127.0.0.1:${server.address().port}`,
      RELAY_DEVICE_ID: "dev_startup_test", RELAY_DEVICE_TOKEN: "synthetic-test-token",
      RELAY_BROWSER_KEYS: JSON.stringify([{ browser_id: `web_${"1".repeat(32)}`, e2ee_key: Buffer.alloc(32, 1).toString("base64url") }]),
      RELAY_ATTACHMENT_STORE_KEY: Buffer.alloc(32, 2).toString("base64url"),
      RELAY_ATTACHMENT_STORE_PATH: join(directory, "attachments.sqlite3"),
      RELAY_STATE_PATH: join(directory, "outbox.json"), RELAY_WORKSPACE: directory,
      RELAY_ADAPTER: "kimi", KIMI_BIN: binary, RELAY_CODEX_HOOKS: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => { try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL"); } catch {} });
  let stderr = "";
  child.stderr.on("data", bytes => { stderr += bytes; });
  child.stdout.resume();
  const result = await new Promise(resolve => {
    const timer = setTimeout(() => resolve("hung"), 8000);
    child.once("exit", code => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(result, 1, `startup must exit after registration fails; stderr: ${stderr}`);
  assert.equal(registered, true, "must reach the failing registration with a live Agent");
  assert.match(stderr, /startup failed: registration/);
  assert.doesNotMatch(stderr, /synthetic-test-token|synthetic registration failure/);
  const agentPid = Number(await readFile(pidFile, "utf8"));
  assert.throws(() => process.kill(agentPid, 0), { code: "ESRCH" });
});
