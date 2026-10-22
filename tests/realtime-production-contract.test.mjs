import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("[MOB-RT-010][deploy] nginx upgrades the exact realtime route while Desktop Relay remains HTTPS polling", async () => {
  const [nginx, server, packageJson, relay] = await Promise.all([
    readFile("deploy/relayune.giraffetree.cn.conf", "utf8"),
    readFile("server/self-hosted.ts", "utf8"),
    readFile("package.json", "utf8"),
    readFile("relay/mac-relay.mjs", "utf8"),
  ]);

  assert.match(
    nginx,
    /location = \/api\/realtime \{[\s\S]*?proxy_http_version 1\.1;[\s\S]*?proxy_set_header Upgrade \$http_upgrade;[\s\S]*?proxy_set_header Connection "upgrade";[\s\S]*?proxy_read_timeout 75s;[\s\S]*?proxy_buffering off;/,
  );
  assert.match(server, /attachRealtimeServer\(server/);
  assert.match(nginx, /location = \/api\/stream \{[\s\S]*?proxy_set_header Upgrade \$http_upgrade;[\s\S]*?proxy_set_header Connection "upgrade";[\s\S]*?proxy_buffering off;/);
  assert.match(server, /attachCipherStreamServer\(server/);
  const relayApi = await readFile("server/relay-api.ts", "utf8");
  assert.match(
    relayApi,
    /scope: "catalog"[\s\S]*?scope: "events"[\s\S]*?scope: "responses"[\s\S]*?scope: "queue"/,
  );
  assert.match(
    relayApi,
    /if \(changes > 0\) changedScopes\.add\(batch\[index\]\.scope\)/,
  );
  assert.doesNotMatch(
    relayApi,
    /invalidate\(device\.id, \[\s*"catalog",\s*"events",\s*"queue",\s*"responses"/,
  );
  assert.equal(JSON.parse(packageJson).dependencies.ws, "^8.21.3");
  assert.match(relay, /poll_after_ms|eventPollInterval|setTimeout/);
  assert.doesNotMatch(relay, /new WebSocket|\/api\/realtime/);
});
