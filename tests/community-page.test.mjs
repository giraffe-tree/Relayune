import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";

const COMMUNITY_URL = "https://relayune.giraffetree.cn/community/";
const GROUP_QR_IMAGE =
  "public/community/assets/wechat-group-qr-2026-09-10.png";
const WORKBENCH_IMAGE =
  "public/community/assets/relayune-mobile-workbench-v1.webp";

test("community page exposes a stable card entry and a long-pressable group QR", async () => {
  const [source, qrSource, configText] = await Promise.all([
    readFile("app/community/page.tsx", "utf8"),
    readFile("app/community/group-qr.tsx", "utf8"),
    readFile("public/community/current.json", "utf8"),
  ]);
  const config = JSON.parse(configText);
  assert.match(config.image, /^\/community\/assets\/wechat-group-[a-zA-Z0-9-]+\.png$/);
  await access(`public${config.image}`);
  assert.match(source, /import GroupQr from "\.\/group-qr"/);
  assert.match(source, /<GroupQr\s*\/>/);
  assert.match(source, new RegExp(COMMUNITY_URL.replaceAll("/", "\\/")));
  assert.match(qrSource, /href=\{config\.image\}[\s\S]*?<Image/);
  assert.match(qrSource, /src=\{config\.image\}/);
  assert.match(qrSource, /className=\{styles\.groupQr\}[\s\S]*?unoptimized/);
  assert.match(qrSource, /长按二维码/);
  assert.match(qrSource, /保存原图/);
  assert.match(qrSource, /href=\{config\.image\} download/);
  assert.match(source, /Codex/);
  assert.match(source, /Kimi Code/);
  assert.match(source, /Claude Code/);
  assert.match(source, /community\/assets\/relayune-mobile-workbench-v1\.webp/);
  await access(GROUP_QR_IMAGE);
  await access(WORKBENCH_IMAGE);
});

// The original QR screenshot served by current.json is preserved for saving.
// These budgets cover the legacy optimized QR and the workbench output only.
test("bundled optimized community media stays within its encoding budgets", async () => {
  const qr = await stat(GROUP_QR_IMAGE);
  const workbench = await stat(WORKBENCH_IMAGE);
  assert.ok(qr.size <= 24 * 1024, `group QR is ${qr.size} bytes`);
  assert.ok(
    workbench.size <= 96 * 1024,
    `workbench screenshot is ${workbench.size} bytes`,
  );

  const nginx = await readFile("deploy/relayune.giraffetree.cn.conf", "utf8");
  assert.match(nginx, /location \^~ \/community\/assets\//);
  assert.match(
    nginx,
    /Cache-Control "public, max-age=31536000, immutable"/,
  );
});

test("print card points to the stable community page instead of an expiring group QR", async () => {
  const generator = await readFile("scripts/generate-hackathon-card.py", "utf8");
  assert.match(generator, /COMMUNITY_QR/);
  assert.doesNotMatch(generator, /WECHAT_QR/);
  assert.match(generator, /relayune\.giraffetree\.cn\/community/);
  await access("docs/marketing/hackathon-card/assets/community-page-qr.png");
});
