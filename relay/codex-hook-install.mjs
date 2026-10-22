import { lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { codexHookPaths } from "./codex-hook-client.mjs";
import { withHookLock } from "./codex-hook-files.mjs";

const LABEL = "Relayune: waiting for mobile approval";
export const shellQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";

export async function configureCodexHooks(action, { home, argv, automatic = false } = {}) {
  if (process.platform === "win32") throw new Error("codex_hooks_unix_only");
  if (!["install", "uninstall", "status"].includes(action)) throw new Error("Usage: codex-hooks install|uninstall|status");
  const paths = codexHookPaths(home);
  const inspect = async () => {
    const config = await readJson(paths.hooks);
    const registration = await readJson(paths.registration);
    if (config.value.hooks !== undefined && !object(config.value.hooks)) throw new Error("invalid_hooks_config");
    const groups = config.value.hooks?.PermissionRequest ?? [];
    if (!Array.isArray(groups)) throw new Error("invalid_permission_hooks");
    const entry = registration.value.entry;
    const matches = groups.filter(group => entry && equal(group, entry));
    return { config, registration, groups, entry, matches };
  };
  if (action === "status") {
    const state = await inspect();
    return { configured: state.matches.length === 1, disabled: state.registration.value.disabled === true,
      hooksPath: paths.hooks, trust: "Check the exact hook definition in Codex /hooks." };
  }
  return withHookLock(paths, "config", async () => {
    const { config, registration, groups, entry, matches } = await inspect();
    if (automatic && registration.value.disabled === true) return { configured: false, disabled: true };
    // If someone edited our registered definition, retain it for review. Do not
    // append a second approval handler or remove a user-modified group.
    if ((entry && matches.length !== 1) || (!entry && groups.some(group =>
      group?.hooks?.some?.(hook => hook?.statusMessage === LABEL)))) {
      throw new Error("relayune_hook_definition_changed");
    }
    let nextEntry;
    if (action === "install") {
      if (!Array.isArray(argv) || !argv.length || argv.some(arg => typeof arg !== "string" || !arg || /[\0\r\n]/.test(arg))) {
        throw new Error("invalid_hook_launcher");
      }
      nextEntry = { hooks: [{ type: "command", command: [...argv, "codex-hook", paths.home].map(shellQuote).join(" "),
        timeout: 120, statusMessage: LABEL }] };
    }
    const nextGroups = groups.filter(group => !entry || !equal(group, entry));
    if (nextEntry) nextGroups.push(nextEntry);
    const next = { ...config.value, hooks: { ...config.value.hooks, PermissionRequest: nextGroups } };
    const nextRegistration = nextEntry ? { entry: nextEntry, disabled: false } : { disabled: true };
    if (!equal(config.value, next)) await replaceJson(paths.hooks, config.raw, next);
    if (!equal(registration.value, nextRegistration)) await replaceJson(paths.registration, registration.raw, nextRegistration);
    return { configured: Boolean(nextEntry), disabled: !nextEntry, hooksPath: paths.hooks,
      trust: "Review and trust the exact hook definition in Codex /hooks before use." };
  });
}

function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
function equal(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }

async function readJson(path) {
  const stat = await lstat(path).catch(error => { if (error.code !== "ENOENT") throw error; });
  if (!stat) return { raw: null, value: {} };
  if (!stat.isFile() || stat.uid !== process.getuid() || stat.size > 1024 * 1024) throw new Error("unsafe_hook_config");
  const raw = await readFile(path, "utf8");
  const value = JSON.parse(raw);
  if (!object(value)) throw new Error("invalid_hook_config");
  return { raw, value };
}

async function replaceJson(path, previous, value) {
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    if ((await readJson(path)).raw !== previous) throw new Error("hook_config_changed_during_install");
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}
