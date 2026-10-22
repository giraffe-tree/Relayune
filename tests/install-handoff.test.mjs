import assert from "node:assert/strict";
import test from "node:test";
import {
  handoffInstallLink,
  INSTALL_HANDOFF_MAILTO,
  installHandoffMailto,
  installShareData,
  PUBLIC_INSTALL_URL,
} from "../app/install-handoff.mjs";

const supportedLocales = [
  "en",
  "zh-CN",
  "hi",
  "es",
  "ar",
  "fr",
  "bn",
  "pt",
  "id",
  "ur",
];

test("优先用系统分享把安装地址交给电脑", async () => {
  let sharedData;
  let copied = false;
  let emailOpened = false;

  const result = await handoffInstallLink({
    canShare: () => true,
    share: async (data) => {
      sharedData = data;
    },
    writeClipboard: async () => {
      copied = true;
    },
    openEmail: () => {
      emailOpened = true;
    },
  });

  assert.equal(result, "shared");
  assert.equal(sharedData.url, PUBLIC_INSTALL_URL);
  assert.equal(copied, false);
  assert.equal(emailOpened, false);
});

test("系统分享不可用时复制正式官网地址", async () => {
  let copiedText = "";

  const result = await handoffInstallLink({
    canShare: () => false,
    share: async () => assert.fail("不应调用不支持的系统分享"),
    writeClipboard: async (text) => {
      copiedText = text;
    },
  });

  assert.equal(result, "copied");
  assert.equal(copiedText, PUBLIC_INSTALL_URL);
});

test("英文页面的系统分享和邮件草稿保持完整英文", async () => {
  let sharedData;
  const shared = await handoffInstallLink({
    locale: "en",
    canShare: (data) => {
      sharedData = data;
      return true;
    },
    share: async (data) => {
      sharedData = data;
    },
  });

  assert.equal(shared, "shared");
  assert.deepEqual(sharedData, installShareData("en"));
  assert.match(sharedData.text, /Open Relayune on your computer/);
  assert.doesNotMatch(sharedData.text, /[\p{Script=Han}]/u);

  let emailUrl = "";
  const emailed = await handoffInstallLink({
    locale: "en",
    openEmail: (url) => {
      emailUrl = url;
    },
  });
  assert.equal(emailed, "email");
  assert.equal(emailUrl, installHandoffMailto("en"));
  assert.match(decodeURIComponent(emailUrl), /Install Relayune on your computer/);
  assert.doesNotMatch(decodeURIComponent(emailUrl), /[\p{Script=Han}]/u);
});

test("十种产品语言都有完整的系统分享和邮件文案", () => {
  const englishShare = installShareData("en");
  const localizedTextPatterns = {
    en: /Open Relayune on your computer/,
    "zh-CN": /在电脑上打开 Relayune/,
    hi: /अपने कंप्यूटर पर Relayune/,
    es: /Abre Relayune en tu ordenador/,
    ar: /افتح Relayune على جهاز الكمبيوتر/,
    fr: /Ouvrez Relayune sur votre ordinateur/,
    bn: /আপনার কম্পিউটারে Relayune/,
    pt: /Abra o Relayune no computador/,
    id: /Buka Relayune di komputer/,
    ur: /اپنے کمپیوٹر پر Relayune/,
  };

  for (const locale of supportedLocales) {
    const share = installShareData(locale);
    const decodedMail = decodeURIComponent(installHandoffMailto(locale));

    assert.equal(share.title, "Relayune", `${locale} share title`);
    assert.equal(share.url, PUBLIC_INSTALL_URL, `${locale} share URL`);
    assert.match(share.text, localizedTextPatterns[locale], `${locale} share text`);
    assert.match(share.text, /Relayune/, `${locale} preserves Relayune`);
    assert.match(share.text, /Agent/, `${locale} preserves Agent`);
    assert.match(decodedMail, /Relayune/, `${locale} mail preserves Relayune`);
    assert.match(decodedMail, /Agent/, `${locale} mail preserves Agent`);
    assert.ok(decodedMail.includes(PUBLIC_INSTALL_URL), `${locale} mail contains install URL`);
    if (locale !== "en") {
      assert.notEqual(share.text, englishShare.text, `${locale} must not use English copy`);
    }
  }
});

test("未知语言明确回退到英文交接文案", () => {
  assert.deepEqual(installShareData("de"), installShareData("en"));
  assert.equal(installHandoffMailto("de"), installHandoffMailto("en"));
});

test("系统分享失败后安全回退到剪贴板", async () => {
  let copiedText = "";

  const result = await handoffInstallLink({
    share: async () => {
      throw new Error("share unavailable");
    },
    writeClipboard: async (text) => {
      copiedText = text;
    },
  });

  assert.equal(result, "copied");
  assert.equal(copiedText, PUBLIC_INSTALL_URL);
});

test("用户取消系统分享时保持静默且不触发回退", async () => {
  let copied = false;
  let emailOpened = false;
  const cancelled = Object.assign(new Error("cancelled"), { name: "AbortError" });

  const result = await handoffInstallLink({
    share: async () => {
      throw cancelled;
    },
    writeClipboard: async () => {
      copied = true;
    },
    openEmail: () => {
      emailOpened = true;
    },
  });

  assert.equal(result, "cancelled");
  assert.equal(copied, false);
  assert.equal(emailOpened, false);
});

test("分享和剪贴板都不可用时准备邮件草稿", async () => {
  let openedUrl = "";

  const result = await handoffInstallLink({
    openEmail: (url) => {
      openedUrl = url;
    },
  });

  assert.equal(result, "email");
  assert.equal(openedUrl, INSTALL_HANDOFF_MAILTO);
  assert.match(decodeURIComponent(openedUrl), /relayune\.giraffetree\.cn/);
});

test("剪贴板被浏览器拒绝时仍能回退到邮件草稿", async () => {
  let openedUrl = "";

  const result = await handoffInstallLink({
    writeClipboard: async () => {
      throw new Error("clipboard denied");
    },
    openEmail: (url) => {
      openedUrl = url;
    },
  });

  assert.equal(result, "email");
  assert.equal(openedUrl, INSTALL_HANDOFF_MAILTO);
});
