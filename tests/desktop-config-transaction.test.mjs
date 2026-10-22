import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function asyncFunction(source, name) {
  const match = source.match(
    new RegExp(`async fn ${name}\\([\\s\\S]*?\\n\\}`),
  );
  assert.ok(match, `missing async native command ${name}`);
  return match[0];
}

test("durable desktop config commands serialize identity and language writes", async () => {
  const [rust, state] = await Promise.all([
    readFile("desktop/src-tauri/src/lib.rs", "utf8"),
    readFile("desktop/src-tauri/src/state.rs", "utf8"),
  ]);

  assert.match(state, /config_update: AsyncMutex<\(\)>/);
  assert.match(state, /config_update: AsyncMutex::new\(\(\)\)/);

  for (const command of [
    "logout",
    "save_settings",
    "clear_secret",
    "complete_pairing",
    "revoke_browser_authorization",
    "complete_browser_pairing",
    "set_ui_language",
  ]) {
    const body = asyncFunction(rust, command);
    assert.match(
      body,
      /let _config_update = state\.inner\.config_update\.lock\(\)\.await;/,
      `${command} must not clone and persist a stale whole-config snapshot`,
    );
  }

  const saveSettings = asyncFunction(rust, "save_settings");
  assert.match(
    saveSettings,
    /let old_config = state\.config\(\);[\s\S]*?let mut next_config = input\.config;[\s\S]*?next_config\.ui_language = old_config\.ui_language\.clone\(\);[\s\S]*?config::validate\(&next_config\)[\s\S]*?config::save\(&app, &next_config\)/,
    "settings must merge the current durable language after waiting for the transaction gate",
  );
  assert.match(
    saveSettings,
    /let device_changed = old_config\.device_id != next_config\.device_id;[\s\S]*?reconcile_durable_config_native_presentation\([\s\S]*?&next_config/,
    "settings must commit and present the merged config rather than its stale form snapshot",
  );
});
