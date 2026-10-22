import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import test from "node:test";

async function clientSources(directory) {
  const files = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(files.map(async entry => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return clientSources(path);
    return /\.(tsx?|css)$/.test(path) ? [[path, await readFile(path, "utf8")]] : [];
  }))).flat();
}

test("Web client has no payment routes, paid endpoints, or access-expiry lock", async () => {
  for (const path of ["app/billing", "app/pricing", "app/account", "app/zh/pricing", "app/en/pricing", "app/[locale]/pricing"]) {
    const info = await stat(path).catch(error => error.code === "ENOENT" ? null : Promise.reject(error));
    assert.equal(info, null, `${path} must not expose a payment-only route`);
  }
  for (const [path, source] of await clientSources("app")) {
    assert.doesNotMatch(source, /\/api\/account\/(?:entitlement|redeem|referral|billing)/, path);
    assert.doesNotMatch(source, /relayune-entitlement-expired|AccountEntitlement|RedemptionForm|ReferralPanel/, path);
    assert.doesNotMatch(source, /\/pricing\/|Relayune Pro/, path);
  }
  const workbench = await readFile("app/workbench-page.tsx", "utf8");
  assert.match(workbench, /authenticated &&\s*!pairingId &&\s*!needsE2eeKey &&\s*snapshot !== null/);
  assert.match(workbench, /relayune-browser-revoked/);
  assert.match(workbench, /logoutAfterConfirmation/);
});
