import { describe, expect, it } from "vitest";
import {
  APP_LOCALES,
  APP_LOCALE_OPTIONS,
  TRANSLATION_KEYS,
  appLocaleDirection,
  bootstrapLocaleAfterRefresh,
  desktopErrorMessage,
  detectAppLocale,
  hasDirectTranslation,
  isAppLocale,
  localizedUpdateNotes,
  persistAppLocale,
  translate,
  translationCoverage,
  type TranslationKey,
} from "./i18n";

describe("desktop locale", () => {
  it("honors a saved language before the operating-system language", () => {
    expect(detectAppLocale(["zh-CN"], "en")).toBe("en");
    expect(detectAppLocale(["en-US"], "zh-CN")).toBe("zh-CN");
  });

  it("normalizes every supported operating-system language tag", () => {
    expect(detectAppLocale(["zh-Hans-CN", "en-US"])).toBe("zh-CN");
    expect(detectAppLocale(["en-US"])).toBe("en");
    expect(detectAppLocale(["hi-IN"])).toBe("hi");
    expect(detectAppLocale(["es-MX"])).toBe("es");
    expect(detectAppLocale(["ar_SA"])).toBe("ar");
    expect(detectAppLocale(["fr-CA"])).toBe("fr");
    expect(detectAppLocale(["bn-BD"])).toBe("bn");
    expect(detectAppLocale(["pt-BR"])).toBe("pt");
    expect(detectAppLocale(["id-ID"])).toBe("id");
    expect(detectAppLocale(["ur-PK"])).toBe("ur");
    expect(detectAppLocale(["ja-JP", "es-ES"])).toBe("es");
    expect(detectAppLocale(["zh-Hant-TW", "fr-FR"])).toBe("fr");
    expect(detectAppLocale(["zh-TW"])).toBe("en");
    expect(detectAppLocale(["ja-JP"])).toBe("en");
  });

  it("exposes one accessible option and the correct writing direction per locale", () => {
    expect(APP_LOCALE_OPTIONS.map(({ code }) => code)).toEqual(APP_LOCALES);
    expect(new Set(APP_LOCALE_OPTIONS.map(({ label }) => label)).size).toBe(10);
    expect(APP_LOCALES.every(isAppLocale)).toBe(true);
    expect(APP_LOCALES.filter((value) => appLocaleDirection(value) === "rtl"))
      .toEqual(["ar", "ur"]);
    expect(APP_LOCALE_OPTIONS.every(({ code, direction }) =>
      direction === appLocaleDirection(code)
    )).toBe(true);
  });

  it("keeps exact per-locale coverage while common and safety paths stay translated", () => {
    const criticalKeys: TranslationKey[] = [
      "chooseLanguage",
      "signInRelayune",
      "desktopLoginNote",
      "folderAccessReason",
      "folderAccessDetail",
      "fileAccessWarningTitle",
      "fileAccessWarningDetail",
      "fileAccessSettings",
      "fileAccessRetry",
      "continueFolderAccess",
      "pairingPrivacy",
      "browserSecurityNote",
      "termsOfService",
      "privacyPolicy",
      "signOutWarning",
      "revokeQuestion",
      "relayUnauthorizedError",
      "credentialAccessError",
      "workspacePickerError",
      "pairingNativeError",
      "browserPairingRequiredError",
      "browserAccessError",
      "languageError",
      "updateFailed",
    ];
    const expectedCoverage = {
      en: { translated: 378, fallback: 0, total: 378 },
      "zh-CN": { translated: 378, fallback: 0, total: 378 },
      hi: { translated: 378, fallback: 0, total: 378 },
      es: { translated: 378, fallback: 0, total: 378 },
      ar: { translated: 378, fallback: 0, total: 378 },
      fr: { translated: 378, fallback: 0, total: 378 },
      bn: { translated: 378, fallback: 0, total: 378 },
      pt: { translated: 378, fallback: 0, total: 378 },
      id: { translated: 378, fallback: 0, total: 378 },
      ur: { translated: 378, fallback: 0, total: 378 },
    } as const;
    for (const locale of APP_LOCALES) {
      const coverage = translationCoverage(locale);
      expect(coverage.total).toBe(378);
      expect(coverage.translated + coverage.fallback).toBe(coverage.total);
      expect(coverage).toEqual(expectedCoverage[locale]);
      expect(criticalKeys.every((key) => hasDirectTranslation(locale, key))).toBe(true);
    }
  });

  it("keeps every interpolation placeholder identical to English", () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    expect(TRANSLATION_KEYS).toHaveLength(378);
    for (const locale of APP_LOCALES) {
      for (const key of TRANSLATION_KEYS) {
        expect(placeholders(translate(locale, key)), `${locale}.${key}`).toEqual(
          placeholders(translate("en", key)),
        );
      }
    }
  });

  it("interpolates dynamic status copy in both languages", () => {
    expect(translate("zh-CN", "browserCount", { count: 2 })).toBe("2 个授权");
    expect(translate("en", "updateVersion", { version: "1.2.3" })).toBe(
      "Relayune 1.2.3 is ready to install",
    );
    expect(translate("fr", "browserCount", { count: 12_345 })).toContain(
      new Intl.NumberFormat("fr").format(12_345),
    );
  });

  it("localizes settings chrome instead of leaking English into Chinese", () => {
    expect(translate("zh-CN", "settingsEyebrow")).toBe("设置");
    expect(translate("en", "settingsEyebrow")).toBe("SETTINGS");
    expect(translate("zh-CN", "revokeAccess")).toBe("撤销授权");
    expect(translate("zh-CN", "revokeBrowserNamed", { name: "Safari" })).toBe(
      "撤销 Safari 的授权",
    );
    expect(translate("en", "revokeBrowserNamed", { name: "Edge" })).toBe(
      "Revoke access for Edge",
    );
    expect(translate("zh-CN", "revoking")).toBe("正在撤销…");
  });

  it("uses client terminology for browser and app authorizations", () => {
    expect(translate("zh-CN", "browserAccess")).toBe("客户端访问");
    expect(translate("zh-CN", "authorizedBrowsers")).toBe("已授权客户端");
    expect(translate("zh-CN", "addBrowser")).toBe("连接新客户端");
    expect(translate("zh-CN", "revokeQuestion")).toBe("撤销客户端授权？");
    expect(translate("en", "browserAccess")).toBe("Client access");
    expect(translate("en", "authorizedBrowsers")).toBe("Authorized clients");
    expect(translate("en", "addBrowser")).toBe("Connect new client");
    expect(translate("en", "revokeQuestion")).toBe("Revoke client access?");
  });

  it("shows the minimum compatible client version", () => {
    expect(
      translate("zh-CN", "minimumClientVersion", { version: "0.3.6" }),
    ).toBe("Web / 手机端最低兼容版本 0.3.6");
    expect(
      translate("en", "minimumClientVersion", { version: "0.3.6" }),
    ).toBe("Minimum compatible Web / mobile version: 0.3.6");
  });

  it("names the language action in the current interface language", () => {
    expect(translate("zh-CN", "switchLanguage")).toBe("切换为英文");
    expect(translate("en", "switchLanguage")).toBe("Switch to Chinese");
  });

  it("selects release notes for the active language without leaking legacy copy", () => {
    const notes = JSON.stringify({
      "zh-CN": "更新连接体验。",
      en: "Improved connection recovery.",
    });
    expect(localizedUpdateNotes("zh-CN", notes)).toBe("更新连接体验。");
    expect(localizedUpdateNotes("en", notes)).toBe(
      "Improved connection recovery.",
    );
    expect(localizedUpdateNotes("es", notes)).toBe(
      "Improved connection recovery.",
    );
    expect(localizedUpdateNotes("ar", JSON.stringify({
      ar: "تحسين استعادة الاتصال.",
      en: "Improved connection recovery.",
    }))).toBe("تحسين استعادة الاتصال.");
    expect(localizedUpdateNotes("en", "仅有中文的旧版说明")).toBeNull();
    expect(localizedUpdateNotes("zh-CN", "English-only legacy notes")).toBeNull();
    expect(localizedUpdateNotes("en", "English legacy notes")).toBe(
      "English legacy notes",
    );
  });

  it("localizes native error codes without leaking Chinese into English UI", () => {
    expect(desktopErrorMessage("en", "credential_access_failed")).toBe(
      "Could not access the local encrypted vault. Check the application-data folder permissions and try again.",
    );
    expect(desktopErrorMessage("en", "relay_start_failed"))
      .not.toMatch(/[\u3400-\u9fff]/u);
    expect(desktopErrorMessage("zh-CN", "relay_start_failed")).toContain("Relay");
    expect(desktopErrorMessage("en", "claude_path_invalid")).toContain("Claude");
    expect(desktopErrorMessage("zh-CN", "claude_path_invalid")).toContain("Claude");
  });

  it("keeps native language changes usable when WebView storage is unavailable", () => {
    expect(() =>
      persistAppLocale("en", () => {
        throw new DOMException("Storage is disabled", "SecurityError");
      }),
    ).not.toThrow();

    const values = new Map<string, string>();
    persistAppLocale("zh-CN", () => ({
      setItem: (key, value) => values.set(key, value),
    }));
    expect(values.get("relayune.locale")).toBe("zh-CN");
  });

  it("does not let an older bootstrap response undo a newer language choice", () => {
    expect(
      bootstrapLocaleAfterRefresh("zh-CN", "en", {
        switchRevisionAtStart: 2,
        currentSwitchRevision: 3,
        switchWasIdleAtStart: true,
        switchInFlight: false,
      }),
    ).toBe("en");
    expect(
      bootstrapLocaleAfterRefresh("zh-CN", "en", {
        switchRevisionAtStart: 3,
        currentSwitchRevision: 3,
        switchWasIdleAtStart: false,
        switchInFlight: false,
      }),
    ).toBe("en");
    expect(
      bootstrapLocaleAfterRefresh("zh-CN", "en", {
        switchRevisionAtStart: 3,
        currentSwitchRevision: 3,
        switchWasIdleAtStart: true,
        switchInFlight: true,
      }),
    ).toBe("en");
  });

  it("adopts native language only when refresh did not overlap a switch", () => {
    expect(
      bootstrapLocaleAfterRefresh("zh-CN", "en", {
        switchRevisionAtStart: 4,
        currentSwitchRevision: 4,
        switchWasIdleAtStart: true,
        switchInFlight: false,
      }),
    ).toBe("zh-CN");
    expect(
      bootstrapLocaleAfterRefresh("unsupported", "en", {
        switchRevisionAtStart: 4,
        currentSwitchRevision: 4,
        switchWasIdleAtStart: true,
        switchInFlight: false,
      }),
    ).toBe("en");
  });
});
