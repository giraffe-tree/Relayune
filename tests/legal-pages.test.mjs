import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pages = [
  {
    path: "../out/zh/legal/terms/index.html",
    title: "Relayune 服务条款",
    canonical: "https://relayune.giraffetree.cn/zh/legal/terms/",
    related: "/zh/legal/privacy/",
  },
  {
    path: "../out/zh/legal/privacy/index.html",
    title: "Relayune 隐私政策",
    canonical: "https://relayune.giraffetree.cn/zh/legal/privacy/",
    related: "/zh/legal/terms/",
  },
  {
    path: "../out/en/legal/terms/index.html",
    title: "Relayune Terms of Service",
    canonical: "https://relayune.giraffetree.cn/en/legal/terms/",
    related: "/en/legal/privacy/",
  },
  {
    path: "../out/en/legal/privacy/index.html",
    title: "Relayune Privacy Policy",
    canonical: "https://relayune.giraffetree.cn/en/legal/privacy/",
    related: "/en/legal/terms/",
  },
];

test("中英文法律文档构建到稳定公开 URL", async () => {
  for (const page of pages) {
    const html = await readFile(new URL(page.path, import.meta.url), "utf8");
    assert.match(html, new RegExp(page.title));
    assert.ok(html.includes(`rel="canonical" href="${page.canonical}"`));
    assert.ok(html.includes(`href="${page.related}"`));
    assert.match(html, /giraffetree1@gmail\.com/);
    assert.doesNotMatch(html, /\[(?:公司|DATE|LEGAL|privacy@|support@|placeholder)/i);
  }
});

test("隐私政策披露真实加密边界与保留期限", async () => {
  const [zh, en] = await Promise.all([
    readFile(new URL(pages[1].path, import.meta.url), "utf8"),
    readFile(new URL(pages[3].path, import.meta.url), "utf8"),
  ]);

  assert.match(zh, /端到端加密/);
  assert.match(zh, /最长 10 分钟/);
  assert.match(zh, /最长 8 小时/);
  assert.match(en, /end-to-end encrypted/i);
  assert.match(en, /up to 24 hours/i);
  assert.match(en, /do not sell personal data/i);
});

test("法律页保留当前语言的首页与文档导航", async () => {
  const legal = await readFile(new URL("../app/legal/legal-page.tsx", import.meta.url), "utf8");
  assert.match(legal, /href=\{pagePaths\.home\}/);
  assert.match(legal, /authText\(requestedLocale, "backHome"\)/);
  assert.doesNotMatch(legal, /pricing/);
});

test("服务说明不包含收费承诺并准确区分 MIT 源码授权与托管条款", async () => {
  const source = await readFile(new URL("../app/legal/legal-content.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Relayune Pro|redemption|referral|退款政策|Refund policy|\/pricing\//);
  assert.match(source, /MIT 许可证/);
  assert.match(source, /第三方组件保留各自许可/);
  assert.match(source, /托管服务条款不改变源码许可/);
  assert.match(source, /MIT License/);
  assert.match(source, /third-party components retain their own licenses/);
  assert.match(source, /hosted-service terms do not replace the source license/);
  for (const page of [pages[0], pages[2]]) {
    const html = await readFile(new URL(page.path, import.meta.url), "utf8");
    assert.match(html, /MIT/);
  }
});
