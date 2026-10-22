import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

test("桌面端退出入口停止 Relay、撤销设备并清除本机凭据", async () => {
  const [main, api, rust, secrets, relayCli] = await Promise.all([
    readFile("desktop/src/main.ts", "utf8"),
    readFile("desktop/src/api.ts", "utf8"),
    readFile("desktop/src-tauri/src/lib.rs", "utf8"),
    readFile("desktop/src-tauri/src/secrets.rs", "utf8"),
    readFile("relay/cli.mjs", "utf8"),
  ]);

  assert.match(main, /id="logout-button"/);
  assert.match(main, /id="logout-dialog"/);
  assert.match(main, /id="confirm-logout"/);
  assert.match(main, /id="cancel-logout"/);
  assert.match(
    main,
    /logoutInFlight = true;\s*confirmLogout\.setAttribute\("aria-busy", "true"\);\s*confirmLogout\.setAttribute\("aria-disabled", "true"\);\s*cancelLogout\.disabled = true;[\s\S]*?finally \{\s*logoutInFlight = false;\s*confirmLogout\.removeAttribute\("aria-busy"\);\s*confirmLogout\.removeAttribute\("aria-disabled"\);\s*cancelLogout\.disabled = false;/,
  );
  assert.match(
    main,
    /logoutDialog\.addEventListener\("cancel", \(event\) => \{\s*if \(logoutInFlight\) event\.preventDefault\(\);/,
  );
  assert.match(
    main,
    /finally \{\s*logoutInFlight = false;[\s\S]*?if \(logoutDialog\.open\) moveFocus\(confirmLogout\)/,
    "a failed sign-out must retain its dialog and return focus to the retryable confirmation",
  );
  assert.doesNotMatch(main, /window\.confirm/);
  assert.match(main, /relayApi\.logout\(\)/);
  assert.match(api, /invokeDesktop<Bootstrap>\("logout", "sign_out_failed"\)/);
  assert.match(rust, /relay::stop\(&app, &state\)/);
  assert.match(rust, /relay::revoke_current_device/);
  assert.match(rust, /secrets::clear_device_credentials/);
  const logoutCommand = rust.slice(
    rust.indexOf("async fn logout("),
    rust.indexOf("async fn save_settings("),
  );
  assert.match(
    logoutCommand,
    /fresh_identity[\s\S]*?config::save\(&app, &cleared\)[\s\S]*?revoke_current_device[\s\S]*?reconcile_durable_config_native_presentation\(&state, &cleared, false[\s\S]*?refresh_tray_status_locked/,
  );
  assert.match(
    logoutCommand,
    /clear_device_credentials[\s\S]*?credential_access_failed[\s\S]*?signed_out_bootstrap\(&app, &state\)/,
  );
  const signedOutBootstrap = rust.slice(
    rust.indexOf("fn signed_out_bootstrap("),
    rust.indexOf("async fn save_settings("),
  );
  const knownBootstrap = rust.slice(
    rust.indexOf("fn bootstrap_with_known_presence("),
    rust.indexOf("fn signed_out_bootstrap("),
  );
  assert.match(
    signedOutBootstrap,
    /bootstrap_with_known_presence\(app, state, SecretPresence::default\(\)\)/,
  );
  assert.match(knownBootstrap, /secrets,/);
  assert.match(knownBootstrap, /config: state\.config\(\)/);
  assert.doesNotMatch(signedOutBootstrap, /presence_for_browsers|config::load_or_create/);
  assert.doesNotMatch(knownBootstrap, /presence_for_browsers|config::load_or_create/);
  assert.match(secrets, /SecretKind::DeviceToken/);
  assert.match(secrets, /SecretKind::E2eeKey/);
  assert.match(relayCli, /\/api\/relay\/logout/);
  const revokeBody = relayCli.match(
    /async function revokeCurrentDevice\(\) \{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(revokeBody);
  assert.doesNotMatch(revokeBody, /console\.(?:log|error)|deviceToken\)/);
});

test("服务端退出接口立即撤销 bearer，且不删除密文数据", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "agent-relay-logout-"));
  try {
    const bundle = join(temporary, "relay-api.mjs");
    await build({
      entryPoints: ["server/relay-api.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: bundle,
      logLevel: "silent",
    });
    const { handleRelayApi } = await import(
      `${pathToFileURL(bundle).href}?${Date.now()}`
    );
    const token = "logout_test_device_token_1234567890";
    const device = {
      id: "dev_0123456789abcdef0123456789abcdef",
      user_id: "usr_test",
      relay_token_hash: createHash("sha256").update(token).digest("hex"),
      revoked_at: null,
      last_seen_at: Date.now(),
    };
    const database = new LogoutDatabase(device);
    const request = () =>
      new Request("https://relay.test/api/relay/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

    const response = await handleRelayApi(request(), {
      DB: database,
      RELAY_BLOBS: {},
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).revoked, true);
    assert.equal(typeof device.revoked_at, "number");
    assert.equal(device.last_seen_at, null);
    assert.equal(database.deletedDocuments, 0);

    const replay = await handleRelayApi(request(), {
      DB: database,
      RELAY_BLOBS: {},
    });
    assert.equal(replay.status, 401);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

class LogoutDatabase {
  deletedDocuments = 0;

  constructor(device) {
    this.device = device;
  }

  prepare(query) {
    const values = [];
    const { device } = this;
    return {
      bind(...next) {
        values.push(...next);
        return this;
      },
      async first() {
        if (query.includes("FROM relay_users WHERE id = ?")) {
          return values[0] === device.user_id
            ? { id: device.user_id, email: "desktop@example.com" }
            : null;
        }
        if (!query.includes("WHERE relay_token_hash = ?")) {
          throw new Error(`Unexpected read: ${query}`);
        }
        return device.relay_token_hash === values[0] &&
          device.revoked_at === null
          ? structuredClone(device)
          : null;
      },
      async run() {
        if (!query.includes("SET revoked_at = ?, last_seen_at = NULL")) {
          throw new Error(`Unexpected write: ${query}`);
        }
        if (
          device.id !== values[1] ||
          device.revoked_at !== null
        ) {
          return { success: true, meta: { changes: 0 } };
        }
        device.revoked_at = values[0];
        device.last_seen_at = null;
        return { success: true, meta: { changes: 1 } };
      },
    };
  }

  async batch() {
    throw new Error("Unexpected batch");
  }
}
