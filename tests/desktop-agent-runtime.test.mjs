import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop reports and repairs local Agent installation, login, and compatibility", async () => {
  const [native, rust, source, api, types, copy] = await Promise.all([
    readFile("desktop/src-tauri/src/agent_runtime.rs", "utf8"),
    readFile("desktop/src-tauri/src/lib.rs", "utf8"),
    readFile("desktop/src/main.ts", "utf8"),
    readFile("desktop/src/api.ts", "utf8"),
    readFile("desktop/src/types.ts", "utf8"),
    readFile("desktop/src/i18n.ts", "utf8"),
  ]);

  for (const status of [
    "ready",
    "not_installed",
    "not_logged_in",
    "outdated",
    "broken",
  ]) {
    assert.match(types, new RegExp(`"${status}"`));
  }
  for (const command of [
    "get_agent_availability",
    "install_agent",
    "open_agent_login",
  ]) {
    assert.match(rust, new RegExp(command));
    assert.match(api, new RegExp(command));
  }

  assert.match(native, /CODEX_MINIMUM_VERSION: &str = "0\.143\.0"/);
  assert.match(native, /KIMI_MINIMUM_VERSION: &str = "0\.38\.0"/);
  assert.match(native, /CLAUDE_MINIMUM_VERSION: &str = "2\.1\.177"/);
  assert.match(
    native,
    /CODEX_DESKTOP_BUNDLED_PATHS:[\s\S]*?\/Applications\/ChatGPT\.app\/Contents\/Resources\/codex/,
  );
  assert.match(
    native,
    /for candidate in managed_binary_candidates\(provider\)[\s\S]*?for directory in executable_search_directories\(\)/,
  );
  assert.match(
    native,
    /fn managed_binary_candidates\(provider: RelayProvider\)[\s\S]*?provider == RelayProvider::Codex[\s\S]*?candidates\.push\(home\.join\("\.codex\/packages\/standalone\/current\/bin\/codex"\)\)[\s\S]*?candidates\.extend\(CODEX_DESKTOP_BUNDLED_PATHS[\s\S]*?return candidates/,
  );
  assert.match(native, /\["login", "status"\]/);
  assert.match(native, /\["auth", "status"\]/);
  assert.match(native, /credentials\/kimi-code\.json/);
  assert.match(native, /Duration::from_secs\(5\)/);

  for (const officialInstaller of [
    "https://chatgpt.com/codex/install.sh",
    "https://chatgpt.com/codex/install.ps1",
    "https://code.kimi.com/kimi-code/install.sh",
    "https://code.kimi.com/kimi-code/install.ps1",
    "https://claude.ai/install.sh",
    "https://claude.ai/install.ps1",
  ]) {
    assert.ok(native.includes(officialInstaller), officialInstaller);
  }
  assert.doesNotMatch(native, /sudo\s/);
  assert.match(native, /\.stdout\(Stdio::null\(\)\)[\s\S]*?\.stderr\(Stdio::null\(\)\)/);

  assert.match(source, /id="agent-readiness"/);
  assert.match(source, /relayApi\.agentAvailability\(\)/);
  assert.match(source, /relayApi\.installAgent\(provider\)/);
  assert.match(source, /relayApi\.openAgentLogin\(provider\)/);
  assert.match(copy, /installAgent: "安装"/);
  assert.match(copy, /尚未登录/);
  assert.match(copy, /版本过低/);
});
