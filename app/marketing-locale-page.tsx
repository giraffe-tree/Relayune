"use client";

import { useEffect, useSyncExternalStore } from "react";
import { storeAuthLocale } from "./auth-locale-write";
import MarketingHome from "./marketing-home";
import type { MarketingCopy, MarketingLocale } from "./marketing-copy";
import {
  markMarketingReturnFocus,
  useMarketingReturnFocus,
} from "./marketing-return-focus";
import { rootAuthenticationEntryPath } from "./workbench-entry";
import DocumentLanguage from "./document-language";
import { localeDirection } from "./supported-locales";
import { authText } from "./auth-language";

export default function MarketingLocalePage({
  locale,
  copy,
}: {
  locale: MarketingLocale;
  copy: MarketingCopy;
}) {
  const authenticationEntryTarget = useSyncExternalStore(
    () => () => {},
    () => rootAuthenticationEntryPath(window.location.search),
    () => null,
  );
  useMarketingReturnFocus(!authenticationEntryTarget);

  useEffect(() => {
    if (!authenticationEntryTarget) return;
    storeAuthLocale(locale);
    window.location.replace(authenticationEntryTarget);
  }, [authenticationEntryTarget, locale]);

  if (authenticationEntryTarget) {
    // This route only exists long enough to normalize the locale-prefixed
    // authentication URL. Keep the transition localizable and accessible,
    // but do not pull the full root Workbench fallback into both marketing
    // entry bundles.
    return (
      <main className="workbench-loading" aria-busy="true" lang={locale} dir={localeDirection(locale)}>
        <DocumentLanguage lang={locale} />
        <section className="workbench-loading-card" role="status" aria-live="polite">
          <span className="workbench-loading-spinner" aria-hidden="true" />
          <p>{authText(locale, "checkingTitle")}</p>
        </section>
      </main>
    );
  }

  return (
    <>
      <DocumentLanguage lang={locale} />
      <MarketingHome
        locale={locale}
        copy={copy}
        onLogin={() => {
          markMarketingReturnFocus();
          storeAuthLocale(locale);
          window.location.assign("/?login=1");
        }}
      />
    </>
  );
}
