"use client";

import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import MarketingHome from "./marketing-home";
import { detectAuthLocale, readStoredAuthLocale } from "./auth-locale";
import { storeAuthLocale } from "./auth-locale-write";
import { zhMarketingCopy } from "./marketing-copy-zh";
import WorkbenchFallback from "./workbench-fallback";
import {
  hasAuthenticationEntry,
  shouldOpenWorkbench,
} from "./workbench-entry";
import {
  hasMarketingReturnFocus,
  markMarketingReturnFocus,
  useMarketingReturnFocus,
} from "./marketing-return-focus";

const WorkbenchPage = lazy(() => import("./workbench-page"));

export default function Home() {
  const authenticationEntryRequested = useSyncExternalStore(
    () => () => {},
    () => hasAuthenticationEntry(window.location.search),
    () => false,
  );
  const [sessionWorkbenchRequested, setSessionWorkbenchRequested] =
    useState(false);
  const marketingLoginEntryRef = useRef(false);
  const workbenchRequested =
    authenticationEntryRequested || sessionWorkbenchRequested;
  useMarketingReturnFocus(!workbenchRequested);
  const fallbackLocale =
    typeof navigator === "undefined"
      ? "zh-CN"
      : detectAuthLocale(navigator.languages, readStoredAuthLocale());

  useEffect(() => {
    if (authenticationEntryRequested) return;
    const controller = new AbortController();
    void shouldOpenWorkbench(controller.signal)
      .then((authenticated) => {
        if (authenticated) setSessionWorkbenchRequested(true);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [authenticationEntryRequested]);

  useEffect(() => {
    const returnToMarketing = () => {
      if (
        (marketingLoginEntryRef.current || hasMarketingReturnFocus()) &&
        !hasAuthenticationEntry(window.location.search)
      ) {
        marketingLoginEntryRef.current = false;
        setSessionWorkbenchRequested(false);
      }
    };
    window.addEventListener("popstate", returnToMarketing);
    return () => window.removeEventListener("popstate", returnToMarketing);
  }, []);

  if (workbenchRequested) {
    return (
      <Suspense fallback={<WorkbenchFallback locale={fallbackLocale} />}>
        <WorkbenchPage />
      </Suspense>
    );
  }

  return (
    <MarketingHome
      locale="zh-CN"
      copy={zhMarketingCopy}
      onLogin={() => {
        storeAuthLocale("zh-CN");
        markMarketingReturnFocus();
        marketingLoginEntryRef.current = true;
        window.history.pushState(null, "", "/?login=1");
        setSessionWorkbenchRequested(true);
        const reduceMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
      }}
    />
  );
}
