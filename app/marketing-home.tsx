"use client";

import Link from "next/link";

import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import MarketingHeroDemo from "./marketing-hero-demo";
import { handoffInstallLink } from "./install-handoff.mjs";
import type { MarketingCopy, MarketingLocale } from "./marketing-copy";
import {
  comparisonSplitForKey,
  detectMarketingPlatform,
} from "./marketing-platform.mjs";
import {
  androidReleaseNotes,
  RELAYUNE_ANDROID_RELEASE,
  RELAYUNE_IOS_TESTFLIGHT_URL,
  RELAYUNE_MACOS_RELEASE_VERSION,
  RELAYUNE_RELEASE_ASSETS,
  RELAYUNE_PLATFORM_BUILDS,
  RELEASE_BUILD_LABELS,
} from "./release-assets";
import {
  persistMarketingMotionPaused,
  storedMarketingMotionPaused,
} from "./marketing-motion-preference";
import {
  LANGUAGE_PICKER_LABELS,
  LOCALE_DEFINITIONS,
  localeDirection,
  localePath,
  publicDocumentPath,
  SUPPORTED_LOCALES,
} from "./supported-locales";

const DESKTOP_SUPPORT_CONTACT = "mailto:giraffetree1@gmail.com";
type MarketingPlatform = "unknown" | "mac" | "windows" | "android" | "mobile" | "other";
type InstallHandoffNotice = "shared" | "copied" | "email";

function Mark({ size = 18 }: { size?: number }) {
  return (
    <span
      className="brand-mark"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

function ValueDemo({
  kind,
  copy,
}: {
  kind: "return" | "task" | "cipher";
  copy: MarketingCopy["valueDemo"];
}) {
  if (kind === "return") {
    return (
      <div className="value-demo value-demo-return" aria-hidden="true">
        <header><span><i /> {copy.returnHeader}</span><em>{copy.localRunning}</em></header>
        <div className="value-return-row value-return-done">
          <span>✓</span><strong>{copy.structureChecked}</strong><small>{copy.complete}</small>
        </div>
        <div className="value-return-cycle">
          <div className="value-return-row value-return-question">
            <span>?</span><strong>{copy.needsDecision}</strong><small>{copy.browser}</small>
          </div>
          <div className="value-return-row value-return-reply">
            <span>↗</span><strong>{copy.keepDirection}</strong><small>{copy.replied}</small>
          </div>
        </div>
      </div>
    );
  }

  if (kind === "task") {
    return (
      <div className="value-demo value-demo-task" aria-hidden="true">
        <header><span>{copy.taskChannel}</span><em>{copy.noPixels}</em></header>
        <div className="value-task-route">
          <div className="value-task-node"><span>⌘</span><small>{copy.computer}</small></div>
          <div className="value-task-lane">
            <i /><i /><i />
            <b>{copy.status}</b><b>{copy.reply}</b><b>{copy.approval}</b>
          </div>
          <div className="value-task-node"><span>◫</span><small>{copy.browser}</small></div>
        </div>
      </div>
    );
  }

  return (
    <div className="value-demo value-demo-cipher" aria-hidden="true">
      <header><span>A256GCM ENVELOPE</span><em>{copy.authenticated}</em></header>
      <div className="value-cipher-route">
        <div className="value-cipher-endpoint"><span>◫</span><small>{copy.taskPlaintext}</small></div>
        <div className="value-cipher-line"><i /><i /></div>
        <div className="value-cipher-relay"><span>◇</span><code>8f2a…</code><small>{copy.server}</small></div>
        <div className="value-cipher-line"><i /><i /></div>
        <div className="value-cipher-endpoint"><span>⌘</span><small>{copy.projectPlaintext}</small></div>
      </div>
    </div>
  );
}

function MarketingPrimaryAction({
  platform,
  onLogin,
  copy,
  compact = false,
}: {
  platform: MarketingPlatform;
  onLogin: () => void;
  copy: MarketingCopy;
  compact?: boolean;
}) {
  const className = compact ? "marketing-inline-cta" : "hero-primary";

  if (platform === "android") {
    return (
      <a
        className={className}
        href={RELAYUNE_RELEASE_ASSETS.android.url}
        download={RELAYUNE_RELEASE_ASSETS.android.fileName}
      >
        {copy.downloadAndroid} · {RELAYUNE_ANDROID_RELEASE.version} <span aria-hidden="true">↓</span>
      </a>
    );
  }

  if (platform === "mobile") {
    return (
      <button className={className} type="button" onClick={onLogin}>
        {copy.mobilePrimary} <span aria-hidden="true">→</span>
      </button>
    );
  }

  const href = platform === "unknown"
    ? "#how-it-works"
    : platform === "mac"
      ? RELAYUNE_RELEASE_ASSETS.macos.url
      : DESKTOP_SUPPORT_CONTACT;
  const label = platform === "unknown"
    ? copy.getDesktop
    : platform === "mac"
      ? copy.downloadMac
      : platform === "windows"
        ? copy.windowsBeta
        : copy.desktopSupport;
  const isDownload = platform === "mac";
  const icon = isDownload ? (compact ? "→" : "↓") : platform === "unknown" ? "→" : "↗";

  return (
    <a
      className={className}
      href={href}
      download={platform === "mac"
        ? RELAYUNE_RELEASE_ASSETS.macos.fileName
        : undefined}
    >
      {label} <span aria-hidden="true">{icon}</span>
    </a>
  );
}

function PlatformBuildDetails({ platform, locale }: {
  platform: keyof typeof RELAYUNE_PLATFORM_BUILDS;
  locale: MarketingLocale;
}) {
  const release = RELAYUNE_PLATFORM_BUILDS[platform];
  const builtAt = new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    timeZone: "Asia/Shanghai",
  }).format(new Date(release.builtAt));
  return (
    <div className="platform-build-details">
      <span>{platform === "macos" ? "macOS" : platform === "android" ? "Android" : "iOS"} · v{release.version}{"build" in release ? ` (${release.build})` : ""}</span>
      <span>{RELEASE_BUILD_LABELS[locale]} · <time dateTime={release.builtAt}>{builtAt} UTC+8</time></span>
    </div>
  );
}

function AndroidReleaseDetails({
  locale,
  copy,
}: {
  locale: MarketingLocale;
  copy: MarketingCopy;
}) {
  const release = androidReleaseNotes(locale);

  return (
    <div
      className="android-release-details"
      aria-label={`${copy.releaseVersion} ${RELAYUNE_ANDROID_RELEASE.version}: ${release.title}`}
    >
      <span className="android-release-version">
        {copy.releaseVersion} · {RELAYUNE_ANDROID_RELEASE.version}
      </span>
      <strong>{release.title}</strong>
      <ul>
        {release.items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function ConnectivityProofGroup({
  proofs,
  duplicate = false,
}: {
  proofs: MarketingCopy["connectivityProofs"];
  duplicate?: boolean;
}) {
  return (
    <ul
      className="marketing-proof-group"
      aria-hidden={duplicate ? true : undefined}
    >
      {proofs.map((proof) => (
        <li key={`${duplicate ? "copy" : "proof"}-${proof.label}`}>
          <span aria-hidden="true" />
          <p><strong>{proof.label}</strong><small>{proof.detail}</small></p>
        </li>
      ))}
    </ul>
  );
}

export default function MarketingHome({
  onLogin,
  locale,
  copy,
}: {
  onLogin: () => void;
  locale: MarketingLocale;
  copy: MarketingCopy;
}) {
  const continuityMoments = copy.continuityMoments;
  const securityPerspectives = copy.securityPerspectives;
  const marketingRootRef = useRef<HTMLElement>(null);
  const marketingNavRef = useRef<HTMLElement>(null);
  const mobileNavToggleRef = useRef<HTMLButtonElement>(null);
  const mobileNavFirstLinkRef = useRef<HTMLAnchorElement>(null);
  const productStageRef = useRef<HTMLDivElement>(null);
  const continuityDemoRef = useRef<HTMLDivElement>(null);
  const securityTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const continuityPointerPausedRef = useRef(false);
  const continuityFocusPausedRef = useRef(false);
  const continuityManualPauseTicksRef = useRef(0);
  const marketingUserMotionPausedRef = useRef(false);
  const [activeMarketingSection, setActiveMarketingSection] = useState("");
  const [comparisonSplit, setComparisonSplit] = useState(50);
  const [activeContinuityMoment, setActiveContinuityMoment] = useState(0);
  const [activeSecurityPerspective, setActiveSecurityPerspective] = useState(1);
  const [marketingUserMotionPaused, setMarketingUserMotionPaused] =
    useState(false);
  const [marketingPlatform, setMarketingPlatform] =
    useState<MarketingPlatform>("unknown");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [installHandoffNotice, setInstallHandoffNotice] =
    useState<InstallHandoffNotice | null>(null);
  const androidRelease = androidReleaseNotes(locale);
  const platformNote = marketingPlatform === "android"
    ? `${copy.platformNotes.android} · ${androidRelease.title}`
    : marketingPlatform === "mobile"
      ? copy.platformNotes.mobile
      : marketingPlatform === "windows"
        ? copy.platformNotes.windows
        : marketingPlatform === "other"
          ? copy.platformNotes.other
          : copy.platformNotes.default;
  const ctaReadiness = copy.platformReadiness[marketingPlatform];
  const securityPerspective = securityPerspectives[activeSecurityPerspective];
  const continuityTrajectoryStep = activeContinuityMoment === 0
    ? 0
    : activeContinuityMoment === 1
      ? 2
      : 3;

  useEffect(() => {
    const paused = storedMarketingMotionPaused();
    marketingUserMotionPausedRef.current = paused;
    marketingRootRef.current?.classList.toggle("marketing-user-paused", paused);
    const frame = window.requestAnimationFrame(() => {
      setMarketingUserMotionPaused(paused);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const root = marketingRootRef.current;
    const stage = productStageRef.current;
    if (!root) return;

    document.documentElement.lang = locale;
    document.documentElement.dir = localeDirection(locale);
    root.classList.add("marketing-motion-ready");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const precisePointer = window.matchMedia(
      "(any-hover: hover) and (any-pointer: fine)",
    );
    const revealTargets = Array.from(
      root.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
    const motionScenes = Array.from(
      root.querySelectorAll<HTMLElement>("[data-motion-scene]"),
    );
    const spotlightCards = Array.from(
      root.querySelectorAll<HTMLElement>(".value-grid article"),
    );
    const trackedSections = ["continuity", "how-it-works", "security", "downloads"]
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => Boolean(section));
    let observer: IntersectionObserver | null = null;
    let motionObserver: IntersectionObserver | null = null;

    if (reducedMotion.matches || !("IntersectionObserver" in window)) {
      revealTargets.forEach((target) => target.classList.add("is-visible"));
      motionScenes.forEach((scene) => scene.classList.add("is-motion-visible"));
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add("is-visible");
            observer?.unobserve(entry.target);
          }
        },
        { rootMargin: "0px 0px -10%", threshold: 0.12 },
      );
      revealTargets.forEach((target) => observer?.observe(target));

      motionObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            entry.target.classList.toggle(
              "is-motion-visible",
              entry.isIntersecting,
            );
          }
        },
        { rootMargin: "18% 0px", threshold: 0.01 },
      );
      motionScenes.forEach((scene) => motionObserver?.observe(scene));
    }

    setMarketingPlatform(
      detectMarketingPlatform(
        window.navigator.userAgent,
        window.navigator.maxTouchPoints,
      ),
    );

    let scrollFrame = 0;
    const syncPagePosition = () => {
      scrollFrame = 0;
      const scrollRange = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const scrollProgress = Math.min(
        1,
        Math.max(0, window.scrollY / scrollRange),
      );
      root.style.setProperty(
        "--marketing-scroll-progress",
        scrollProgress.toFixed(4),
      );

      const focusLine = window.innerHeight * 0.34;
      const activeSection = trackedSections.find((section) => {
        const bounds = section.getBoundingClientRect();
        return bounds.top <= focusLine && bounds.bottom > focusLine;
      });
      setActiveMarketingSection(activeSection?.id ?? "");
      if (window.innerWidth > 820) setMobileNavOpen(false);
    };
    const schedulePagePositionSync = () => {
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(syncPagePosition);
    };
    syncPagePosition();
    window.addEventListener("scroll", schedulePagePositionSync, {
      passive: true,
    });
    window.addEventListener("resize", schedulePagePositionSync, {
      passive: true,
    });

    const syncPageVisibility = () => {
      root.classList.toggle("marketing-page-paused", document.hidden);
    };
    syncPageVisibility();
    document.addEventListener("visibilitychange", syncPageVisibility);

    let pointerFrame = 0;
    let spotlightFrame = 0;
    let stageReleaseTimer = 0;
    let pendingStagePoint: { clientX: number; clientY: number } | null = null;
    let pendingSpotlightPoint: {
      card: HTMLElement;
      clientX: number;
      clientY: number;
    } | null = null;
    const resetStage = () => {
      if (!stage) return;
      pendingStagePoint = null;
      window.cancelAnimationFrame(pointerFrame);
      pointerFrame = 0;
      stage.style.setProperty("--stage-rotate-x", "0deg");
      stage.style.setProperty("--stage-rotate-y", "0deg");
      stage.style.setProperty("--stage-spot-x", "50%");
      stage.style.setProperty("--stage-spot-y", "42%");
      window.clearTimeout(stageReleaseTimer);
      stageReleaseTimer = window.setTimeout(
        () => stage.classList.remove("is-pointer-active"),
        220,
      );
    };
    const activateStage = () => {
      if (reducedMotion.matches || marketingUserMotionPausedRef.current) return;
      window.clearTimeout(stageReleaseTimer);
      stage?.classList.add("is-pointer-active");
    };
    const moveStage = (event: PointerEvent) => {
      if (
        !stage ||
        event.pointerType === "touch" ||
        reducedMotion.matches ||
        marketingUserMotionPausedRef.current
      ) return;
      pendingStagePoint = { clientX: event.clientX, clientY: event.clientY };
      if (pointerFrame) return;
      pointerFrame = window.requestAnimationFrame(() => {
        pointerFrame = 0;
        const point = pendingStagePoint;
        pendingStagePoint = null;
        if (!point) return;
        const bounds = stage.getBoundingClientRect();
        const x = Math.min(
          1,
          Math.max(0, (point.clientX - bounds.left) / bounds.width),
        );
        const y = Math.min(
          1,
          Math.max(0, (point.clientY - bounds.top) / bounds.height),
        );
        stage.style.setProperty("--stage-rotate-x", `${(0.5 - y) * 2.8}deg`);
        stage.style.setProperty("--stage-rotate-y", `${(x - 0.5) * 4.8}deg`);
        stage.style.setProperty("--stage-spot-x", `${x * 100}%`);
        stage.style.setProperty("--stage-spot-y", `${y * 100}%`);
      });
    };
    const moveCardSpotlight = (event: PointerEvent) => {
      if (
        event.pointerType === "touch" ||
        reducedMotion.matches ||
        marketingUserMotionPausedRef.current
      ) return;
      pendingSpotlightPoint = {
        card: event.currentTarget as HTMLElement,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      if (spotlightFrame) return;
      spotlightFrame = window.requestAnimationFrame(() => {
        spotlightFrame = 0;
        const point = pendingSpotlightPoint;
        pendingSpotlightPoint = null;
        if (!point) return;
        const bounds = point.card.getBoundingClientRect();
        point.card.style.setProperty(
          "--card-spot-x",
          `${point.clientX - bounds.left}px`,
        );
        point.card.style.setProperty(
          "--card-spot-y",
          `${point.clientY - bounds.top}px`,
        );
      });
    };

    const resetPointerMotionForReducedMotion = (event: MediaQueryListEvent) => {
      if (!event.matches) return;
      resetStage();
      pendingSpotlightPoint = null;
      window.cancelAnimationFrame(spotlightFrame);
      spotlightFrame = 0;
      spotlightCards.forEach((card) => {
        card.style.removeProperty("--card-spot-x");
        card.style.removeProperty("--card-spot-y");
      });
    };
    reducedMotion.addEventListener("change", resetPointerMotionForReducedMotion);

    if (precisePointer.matches) {
      stage?.addEventListener("pointerenter", activateStage, { passive: true });
      stage?.addEventListener("pointermove", moveStage, { passive: true });
      stage?.addEventListener("pointerleave", resetStage, { passive: true });
      spotlightCards.forEach((card) =>
        card.addEventListener("pointermove", moveCardSpotlight, { passive: true }),
      );
    }

    return () => {
      observer?.disconnect();
      motionObserver?.disconnect();
      window.cancelAnimationFrame(pointerFrame);
      window.cancelAnimationFrame(spotlightFrame);
      window.cancelAnimationFrame(scrollFrame);
      window.clearTimeout(stageReleaseTimer);
      window.removeEventListener("scroll", schedulePagePositionSync);
      window.removeEventListener("resize", schedulePagePositionSync);
      document.removeEventListener("visibilitychange", syncPageVisibility);
      reducedMotion.removeEventListener(
        "change",
        resetPointerMotionForReducedMotion,
      );
      stage?.classList.remove("is-pointer-active");
      stage?.removeEventListener("pointerenter", activateStage);
      stage?.removeEventListener("pointermove", moveStage);
      stage?.removeEventListener("pointerleave", resetStage);
      spotlightCards.forEach((card) =>
        card.removeEventListener("pointermove", moveCardSpotlight),
      );
    };
  }, [locale]);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timer = window.setInterval(() => {
      const demo = continuityDemoRef.current;
      if (
        reducedMotion.matches ||
        document.hidden ||
        !demo?.classList.contains("is-motion-visible") ||
        continuityPointerPausedRef.current ||
        continuityFocusPausedRef.current ||
        marketingUserMotionPausedRef.current
      ) {
        return;
      }
      if (continuityManualPauseTicksRef.current > 0) {
        continuityManualPauseTicksRef.current -= 1;
        return;
      }
      setActiveContinuityMoment(
        (current) => (current + 1) % continuityMoments.length,
      );
    }, 4_200);

    return () => window.clearInterval(timer);
  }, [continuityMoments.length]);

  useEffect(() => {
    if (!mobileNavOpen) return;

    const focusFrame = window.requestAnimationFrame(() => {
      mobileNavFirstLinkRef.current?.focus();
    });

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!marketingNavRef.current?.contains(event.target as Node)) {
        setMobileNavOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileNavOpen(false);
      window.requestAnimationFrame(() => mobileNavToggleRef.current?.focus());
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!installHandoffNotice) return;
    const timer = window.setTimeout(() => setInstallHandoffNotice(null), 3_600);
    return () => window.clearTimeout(timer);
  }, [installHandoffNotice]);

  const handleInstallHandoff = useCallback(async () => {
    const result = await handoffInstallLink({
      locale,
      share: navigator.share?.bind(navigator),
      canShare: navigator.canShare?.bind(navigator),
      writeClipboard: navigator.clipboard?.writeText?.bind(navigator.clipboard),
      openEmail: (url) => {
        window.location.href = url;
      },
    });

    if (result !== "cancelled") setInstallHandoffNotice(result);
  }, [locale]);

  const handoffNoticeCopy = installHandoffNotice === "shared"
    ? copy.handoffNotices.shared
    : installHandoffNotice === "copied"
      ? copy.handoffNotices.copied
      : copy.handoffNotices.email;
  const continuityMoment = continuityMoments[activeContinuityMoment];

  const selectContinuityMoment = (index: number) => {
    continuityManualPauseTicksRef.current = 3;
    setActiveContinuityMoment(index);
  };

  const toggleMarketingMotion = () => {
    const nextPaused = !marketingUserMotionPausedRef.current;
    marketingUserMotionPausedRef.current = nextPaused;
    setMarketingUserMotionPaused(nextPaused);
    persistMarketingMotionPaused(nextPaused);
    if (!nextPaused) return;

    const stage = productStageRef.current;
    stage?.classList.remove("is-pointer-active");
    stage?.style.setProperty("--stage-rotate-x", "0deg");
    stage?.style.setProperty("--stage-rotate-y", "0deg");
    stage?.style.setProperty("--stage-spot-x", "50%");
    stage?.style.setProperty("--stage-spot-y", "42%");
  };

  const navigateFromMobileMenu = (targetId: string) => {
    setMobileNavOpen(false);
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.focus({ preventScroll: true });
    });
  };

  return (
    <>
      <a className="marketing-skip-link" href="#top">
        {copy.skipToContent}
      </a>
      <main
        className={`marketing-page${marketingUserMotionPaused ? " marketing-user-paused" : ""}`}
        ref={marketingRootRef}
      >
      <nav
        className="marketing-nav"
        aria-label={copy.navigationLabel}
        data-reveal
        ref={marketingNavRef}
      >
        <a className="marketing-brand" href="#top" aria-label={copy.homeLabel}>
          <Mark size={25} />
          <span>Relayune</span>
        </a>
        <div className="marketing-nav-links">
          <a
            href="#continuity"
            aria-current={activeMarketingSection === "continuity" ? "location" : undefined}
          >{copy.navExperience}</a>
          <a
            href="#how-it-works"
            aria-current={activeMarketingSection === "how-it-works" ? "location" : undefined}
          >{copy.navHow}</a>
          <a
            href="#security"
            aria-current={activeMarketingSection === "security" ? "location" : undefined}
          >{copy.navSecurity}</a>
          <a
            href="#downloads"
            aria-current={activeMarketingSection === "downloads" ? "location" : undefined}
          >{copy.navDownloads}</a>
          <Link href="/community/">{copy.navCommunity}</Link>
        </div>
        <div className="marketing-nav-actions">
          <button
            className={`marketing-mobile-menu-button${mobileNavOpen ? " is-open" : ""}`}
            type="button"
            aria-label={mobileNavOpen ? copy.closeNavigation : copy.openNavigation}
            aria-expanded={mobileNavOpen}
            aria-controls="marketing-mobile-menu"
            ref={mobileNavToggleRef}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <span aria-hidden="true"><i /><i /></span>
          </button>
          <button
            className={`marketing-motion-toggle${marketingUserMotionPaused ? " is-paused" : ""}`}
            type="button"
            aria-label={marketingUserMotionPaused ? copy.playMotion : copy.pauseMotion}
            aria-pressed={marketingUserMotionPaused}
            onClick={toggleMarketingMotion}
          >
            <span aria-hidden="true">{marketingUserMotionPaused ? "▶" : "Ⅱ"}</span>
          </button>
          <button
            className="marketing-login"
            type="button"
            onClick={() => {
              setMobileNavOpen(false);
              onLogin();
            }}
          >
            {copy.login} <span aria-hidden="true">↗</span>
          </button>
          <label className="marketing-language">
            <span className="sr-only">{LANGUAGE_PICKER_LABELS[locale]}</span>
            <select
              value={locale}
              aria-label={LANGUAGE_PICKER_LABELS[locale]}
              onChange={(event) => {
                window.location.assign(localePath(event.target.value as MarketingLocale));
              }}
            >
              {SUPPORTED_LOCALES.map((candidate) => (
                <option
                  key={candidate}
                  value={candidate}
                  lang={candidate}
                  dir={LOCALE_DEFINITIONS[candidate].dir}
                >
                  {LOCALE_DEFINITIONS[candidate].nativeName}
                </option>
              ))}
            </select>
          </label>
        </div>
        {mobileNavOpen ? (
          <div
            className="marketing-mobile-menu"
            id="marketing-mobile-menu"
            role="group"
            aria-label={copy.mobileNavigationLabel}
          >
            <a
              ref={mobileNavFirstLinkRef}
              href="#continuity"
              aria-current={activeMarketingSection === "continuity" ? "location" : undefined}
              onClick={() => navigateFromMobileMenu("continuity")}
            ><span>{copy.navExperience}</span><small>{copy.mobileExperienceDetail}</small></a>
            <a
              href="#how-it-works"
              aria-current={activeMarketingSection === "how-it-works" ? "location" : undefined}
              onClick={() => navigateFromMobileMenu("how-it-works")}
            ><span>{copy.navHow}</span><small>{copy.mobileHowDetail}</small></a>
            <a
              href="#security"
              aria-current={activeMarketingSection === "security" ? "location" : undefined}
              onClick={() => navigateFromMobileMenu("security")}
            ><span>{copy.navSecurity}</span><small>{copy.mobileSecurityDetail}</small></a>
            <a
              href="#downloads"
              aria-current={activeMarketingSection === "downloads" ? "location" : undefined}
              onClick={() => navigateFromMobileMenu("downloads")}
            ><span>{copy.navDownloads}</span><small>{copy.mobileDownloadsDetail}</small></a>
            <Link href="/community/"><span>{copy.navCommunity}</span></Link>
          </div>
        ) : null}
        <span className="marketing-nav-progress" aria-hidden="true" />
      </nav>

      <section className="marketing-hero" id="top" tabIndex={-1} data-motion-scene>
        <div className="hero-glow hero-glow-one" aria-hidden="true" />
        <div className="hero-glow hero-glow-two" aria-hidden="true" />
        <div className="hero-beam" aria-hidden="true" />
        <div className="hero-copy" data-reveal>
          <p className="marketing-kicker">
            <span className="online-dot" /> {copy.heroKicker}
          </p>
          <h1>
            {copy.heroTitleLead}<br />
            <span>{copy.heroTitleAccent}</span>
          </h1>
          <p className="hero-description">{copy.heroDescription}</p>
          <ul className="hero-proof-pills" aria-label={copy.heroProofsLabel}>
            {copy.heroProofs.map((proof) => (
              <li key={proof}><span aria-hidden="true" />{proof}</li>
            ))}
          </ul>
          <div className="hero-actions">
            <MarketingPrimaryAction platform={marketingPlatform} onLogin={onLogin} copy={copy} />
            <a className="hero-secondary" href="#how-it-works">
              {copy.heroSecondary} <span aria-hidden="true">→</span>
            </a>
          </div>
          <div className="hero-build-details">
            {(["macos", "android", "ios"] as const).map((platform) => (
              <PlatformBuildDetails key={platform} platform={platform} locale={locale} />
            ))}
          </div>
          <p className="hero-platform-note">{platformNote}</p>
        </div>

        <div
          className="product-stage"
          role="region"
          aria-roledescription={copy.heroPreviewRole}
          aria-label={copy.heroPreviewLabel}
          aria-describedby="hero-preview-description"
          data-reveal
          data-motion-scene
          ref={productStageRef}
        >
          <p className="marketing-sr-only" id="hero-preview-description">
            {copy.heroPreviewDescription}
          </p>
          <div className="stage-orbit stage-orbit-one" aria-hidden="true" />
          <div className="stage-orbit stage-orbit-two" aria-hidden="true" />
          <MarketingHeroDemo copy={copy} locale={locale} motionPaused={marketingUserMotionPaused} />
        </div>
      </section>

      <section
        className="marketing-proof"
        aria-label={copy.connectivityLabel}
        data-reveal
        data-motion-scene
      >
        <div className="marketing-proof-heading">
          <span aria-hidden="true"><i /></span>
          <p><strong>{copy.connectivityTitle}</strong><small>{copy.availableNow}</small></p>
        </div>
        <div className="marketing-proof-track">
          <div className="marketing-proof-marquee">
            <ConnectivityProofGroup proofs={copy.connectivityProofs} />
            <ConnectivityProofGroup proofs={copy.connectivityProofs} duplicate />
          </div>
        </div>
      </section>

      <section
        className="marketing-value"
        aria-labelledby="value-title"
        data-motion-scene
      >
        <div className="section-heading" data-reveal>
          <p>{copy.valueKicker}</p>
          <h2 id="value-title">{copy.valueTitle}</h2>
        </div>
        <div className="value-grid">
          <article data-reveal>
            <span className="value-number">01</span>
            <ValueDemo kind="return" copy={copy.valueDemo} />
            <h3>{copy.valueCards[0].title}</h3>
            <p>{copy.valueCards[0].description}</p>
          </article>
          <article data-reveal>
            <span className="value-number">02</span>
            <ValueDemo kind="task" copy={copy.valueDemo} />
            <h3>{copy.valueCards[1].title}</h3>
            <p>{copy.valueCards[1].description}</p>
          </article>
          <article data-reveal>
            <span className="value-number">03</span>
            <ValueDemo kind="cipher" copy={copy.valueDemo} />
            <h3>{copy.valueCards[2].title}</h3>
            <p>{copy.valueCards[2].description}</p>
          </article>
        </div>
      </section>

      <section
        className="marketing-compare"
        aria-labelledby="compare-title"
        data-motion-scene
      >
        <div className="compare-copy" data-reveal>
          <p className="section-kicker">{copy.comparison.kicker}</p>
          <h2 id="compare-title">{copy.comparison.titleLead}<br />{copy.comparison.titleAccent}</h2>
          <p>{copy.comparison.description}</p>
          <dl className="compare-facts">
            <div><dt>{copy.comparison.remoteLabel}</dt><dd>{copy.comparison.remoteFact}</dd></div>
            <div><dt>{copy.comparison.relayuneLabel}</dt><dd>{copy.comparison.relayuneFact}</dd></div>
          </dl>
        </div>

        <div
          className="comparison-demo"
          data-reveal
          style={{ "--comparison-split": `${comparisonSplit}%` } as CSSProperties}
        >
          <div className="compare-scene compare-scene-remote" aria-hidden="true">
            <div className="compare-scene-label"><span>{copy.comparison.oldWay}</span><strong>{copy.comparison.remoteLabel}</strong></div>
            <div className="compare-remote-device">
              <header><span><i /><i /><i /></span><small>MacBook Pro · 1920 × 1080</small></header>
              <div className="compare-remote-screen">
                <aside><i /><i /><i /><i /></aside>
                <main>
                  <div className="compare-remote-toolbar"><i /><i /></div>
                  <div className="compare-remote-columns"><span /><span /><span /></div>
                  <div className="compare-remote-terminal"><i /><i /><i /><i /></div>
                </main>
              </div>
              <div className="compare-remote-cursor">↖</div>
            </div>
            <footer><strong>{copy.comparison.remoteFooterTitle}</strong><small>{copy.comparison.remoteFooterDetail}</small></footer>
          </div>

          <div className="compare-scene compare-scene-relayune" aria-hidden="true">
            <div className="compare-scene-label"><span>RELAYUNE</span><strong>{copy.comparison.relayuneMode}</strong></div>
            <div className="compare-task-device">
              <header><span className="compare-mini-mark" /><p><strong>{copy.comparison.taskTitle}</strong><small>relayune · main</small></p><em><i /> {copy.comparison.running}</em></header>
              <div className="compare-task-message">{copy.comparison.decision}</div>
              <div className="compare-task-reply">{copy.comparison.reply}</div>
              <div className="compare-task-action"><span>✓</span><p><strong>{copy.comparison.returnedTitle}</strong><small>{copy.comparison.returnedDetail}</small></p></div>
            </div>
            <footer><strong>{copy.comparison.relayuneFooterTitle}</strong><small>{copy.comparison.relayuneFooterDetail}</small></footer>
          </div>

          <input
            className="compare-range"
            type="range"
            min="12"
            max="88"
            value={comparisonSplit}
            aria-label={copy.comparison.rangeLabel}
            aria-valuetext={comparisonSplit < 45
              ? copy.comparison.moreRelayune
              : comparisonSplit > 55
                ? copy.comparison.moreRemote
                : copy.comparison.equal}
            onKeyDown={(event) => {
              const nextSplit = comparisonSplitForKey(
                comparisonSplit,
                event.key,
              );
              if (nextSplit === null) return;
              event.preventDefault();
              setComparisonSplit(nextSplit);
            }}
            onChange={(event) => setComparisonSplit(Number(event.target.value))}
          />
          <div className="compare-divider" aria-hidden="true"><b>↔</b></div>
          <p className="compare-drag-hint" aria-hidden="true">{copy.comparison.dragHint}</p>
        </div>
      </section>

      <section
        className="marketing-continuity"
        id="continuity"
        tabIndex={-1}
        aria-labelledby="continuity-title"
      >
        <div className="continuity-copy" data-reveal>
          <p className="section-kicker">{copy.continuityKicker}</p>
          <h2 id="continuity-title">{copy.continuityTitleLead}<br />{copy.continuityTitleAccent}</h2>
          <p>{copy.continuityDescription}</p>
          <dl className="continuity-facts">
            <div>
              <dt>{copy.contextLabel}</dt>
              <dd>{copy.contextValue}</dd>
            </div>
            <div>
              <dt>{copy.connectionLabel}</dt>
              <dd>{copy.connectionValue}</dd>
            </div>
          </dl>
        </div>

        <div
          className="continuity-demo"
          data-reveal
          data-motion-scene
          data-moment={continuityMoment.id}
          aria-label={copy.continuityDemoLabel}
          ref={continuityDemoRef}
          onPointerEnter={() => {
            continuityPointerPausedRef.current = true;
          }}
          onPointerLeave={() => {
            continuityPointerPausedRef.current = false;
          }}
          onFocusCapture={() => {
            continuityFocusPausedRef.current = true;
          }}
          onBlurCapture={(event) => {
            const nextTarget = event.relatedTarget;
            if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
              continuityFocusPausedRef.current = false;
            }
          }}
        >
          <div className="continuity-device-row">
            <div className={`continuity-device continuity-device-desktop${
              continuityMoment.activeDevice === "desktop" || continuityMoment.activeDevice === "both"
                ? " is-active"
                : ""
            }`}>
              <span aria-hidden="true">⌘</span>
              <p><strong>{copy.localAgent}</strong><small>relayune · main</small></p>
              <em>{continuityMoment.desktopStatus}</em>
            </div>
            <div className="continuity-channel" aria-hidden="true"><i /></div>
            <div className={`continuity-device continuity-device-browser${
              continuityMoment.activeDevice === "browser" || continuityMoment.activeDevice === "both"
                ? " is-active"
                : ""
            }`}>
              <span aria-hidden="true">◫</span>
              <p><strong>{copy.yourBrowser}</strong><small>{copy.securelyConnected}</small></p>
              <em>{continuityMoment.browserStatus}</em>
            </div>
          </div>

          <article className="continuity-task-card">
            <header>
              <div><Mark size={17} /><strong>{copy.websiteOptimization}</strong></div>
              <span key={continuityMoment.id}><i /> {continuityMoment.channel}</span>
            </header>
            <div className="continuity-trajectory">
              <span>{copy.trajectoryLabel}</span>
              <ol aria-label={copy.trajectoryLabel}>
                {copy.trajectoryActions.map((action, index) => (
                  <li
                    className={index === continuityTrajectoryStep
                      ? "is-active"
                      : index < continuityTrajectoryStep
                        ? "is-complete"
                        : undefined}
                    aria-current={index === continuityTrajectoryStep ? "step" : undefined}
                    key={action}
                  >
                    <i aria-hidden="true">{index < continuityTrajectoryStep ? "✓" : index + 1}</i>
                    <strong>{action}</strong>
                  </li>
                ))}
              </ol>
            </div>
            <ol className="continuity-timeline" aria-label={copy.chooseContinuityStage}>
              {continuityMoments.map((moment, index) => (
                <li
                  className={index === activeContinuityMoment ? "is-active" : undefined}
                  key={moment.id}
                >
                  <button
                    type="button"
                    aria-pressed={index === activeContinuityMoment}
                    onClick={() => selectContinuityMoment(index)}
                  >
                    <time>{moment.time}</time>
                    <div><strong>{moment.title}</strong><p>{moment.detail}</p></div>
                    <span>{moment.status}</span>
                  </button>
                </li>
              ))}
            </ol>
            <footer>
              <span aria-hidden="true" key={`${continuityMoment.id}-icon`}>
                {continuityMoment.icon}
              </span>
              <p className="continuity-summary" key={`${continuityMoment.id}-summary`}>
                <small>{continuityMoment.summaryLabel}</small>
                <strong>{continuityMoment.summary}</strong>
              </p>
              <em>{activeContinuityMoment + 1} / {continuityMoments.length}</em>
            </footer>
          </article>
        </div>
      </section>

      <section
        className="marketing-how"
        id="how-it-works"
        tabIndex={-1}
        aria-labelledby="how-title"
        data-motion-scene
      >
        <div className="how-copy" data-reveal>
          <p className="section-kicker">{copy.howKicker}</p>
          <h2 id="how-title">{copy.howTitleLead}<br />{copy.howTitleAccent}</h2>
          <p>{copy.howDescription}</p>
          {marketingPlatform === "mobile" ? (
            <>
              <button
                className="marketing-inline-cta marketing-handoff-action"
                type="button"
                onClick={() => void handleInstallHandoff()}
              >
                {copy.handoffAction}
                <span className="marketing-handoff-icon" aria-hidden="true">↗</span>
              </button>
              <p className="marketing-handoff-note">{copy.handoffNote}</p>
            </>
          ) : (
            <MarketingPrimaryAction
              platform={marketingPlatform}
              onLogin={onLogin}
              copy={copy}
              compact
            />
          )}
        </div>
        <div className="how-sequence" data-reveal>
          <header>
            <span><i aria-hidden="true" /> {copy.connectionPathLabel}</span>
            <em>{copy.connectionPathMode}</em>
          </header>
          <ol className="how-steps" aria-label={copy.connectionPathLabel}>
            {copy.howSteps.map((step, index) => (
              <li
                key={step.title}
                style={{ "--how-step-delay": `${180 + index * 670}ms` } as CSSProperties}
              >
                <span aria-hidden="true"><b>{index + 1}</b><i>✓</i></span>
                <div>
                  <small>{step.scope}</small>
                  <strong>{step.title}</strong>
                  <p>{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        className="marketing-security"
        id="security"
        tabIndex={-1}
        aria-labelledby="security-title"
      >
        <div
          className="security-visual"
          data-reveal
          data-motion-scene
          data-security-perspective={securityPerspective.id}
        >
          <div className="security-network">
            <div className="security-node-flow" aria-hidden="true"><i /><i /></div>
            <div
              className="security-node-list"
              role="tablist"
              aria-label={copy.securityTabsLabel}
            >
              {securityPerspectives.map((perspective, index) => (
                <button
                  className={index === activeSecurityPerspective ? "is-active" : undefined}
                  id={`security-node-${perspective.id}`}
                  type="button"
                  role="tab"
                  aria-selected={index === activeSecurityPerspective}
                  aria-controls="security-inspector"
                  tabIndex={index === activeSecurityPerspective ? 0 : -1}
                  key={perspective.id}
                  ref={(node) => {
                    securityTabRefs.current[index] = node;
                  }}
                  onClick={() => setActiveSecurityPerspective(index)}
                  onKeyDown={(event) => {
                    let nextIndex = index;
                    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                      nextIndex = (index + 1) % securityPerspectives.length;
                    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                      nextIndex = (index - 1 + securityPerspectives.length) % securityPerspectives.length;
                    } else if (event.key === "Home") {
                      nextIndex = 0;
                    } else if (event.key === "End") {
                      nextIndex = securityPerspectives.length - 1;
                    } else {
                      return;
                    }
                    event.preventDefault();
                    setActiveSecurityPerspective(nextIndex);
                    securityTabRefs.current[nextIndex]?.focus();
                  }}
                >
                  <span aria-hidden="true">
                    {perspective.id === "server" ? <Mark size={23} /> : perspective.icon}
                  </span>
                  <strong>{perspective.label}</strong>
                  <small>{perspective.role}</small>
                </button>
              ))}
            </div>
          </div>

          <div
            className="security-inspector"
            id="security-inspector"
            role="tabpanel"
            aria-labelledby={`security-node-${securityPerspective.id}`}
            tabIndex={0}
          >
            <header key={`${securityPerspective.id}-header`}>
              <span><i aria-hidden="true" /> {copy.currentInspection}{securityPerspective.label}</span>
              <em>{securityPerspective.role}</em>
            </header>
            <div className="security-inspector-copy" key={`${securityPerspective.id}-copy`}>
              <h3>{securityPerspective.title}</h3>
              <p>{securityPerspective.description}</p>
            </div>
            <dl key={`${securityPerspective.id}-facts`}>
              <div><dt>{securityPerspective.primaryLabel}</dt><dd>{securityPerspective.primaryValue}</dd></div>
              <div><dt>{securityPerspective.secondaryLabel}</dt><dd>{securityPerspective.secondaryValue}</dd></div>
            </dl>
          </div>
        </div>
        <div className="security-copy" data-reveal>
          <p className="section-kicker">{copy.securityKicker}</p>
          <h2 id="security-title">{copy.securityTitleLead}<br />{copy.securityTitleAccent}</h2>
          <p>{copy.securityDescription}</p>
          <ul>
            {copy.securityFacts.map((fact) => <li key={fact}><span>✓</span> {fact}</li>)}
          </ul>
          <a className="security-details-link" href={copy.privacyPath}>
            {copy.securityDetails} <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>

      <section
        className="marketing-downloads"
        id="downloads"
        aria-labelledby="downloads-title"
        data-motion-scene
      >
        <div className="section-heading" data-reveal>
          <p>{copy.downloadsKicker}</p>
          <h2 id="downloads-title">{copy.downloadsTitle}</h2>
          <span>{copy.downloadsDescription}</span>
        </div>
        <div className="download-grid">
          <article data-reveal>
            <span className="download-platform-icon" aria-hidden="true">⌘</span>
            <div>
              <small>{copy.desktopRelease} · {RELAYUNE_MACOS_RELEASE_VERSION}</small>
              <h3>macOS</h3>
              <p>{copy.macosDownloadDetail}</p>
              <PlatformBuildDetails platform="macos" locale={locale} />
            </div>
            <a
              href={RELAYUNE_RELEASE_ASSETS.macos.url}
              download={RELAYUNE_RELEASE_ASSETS.macos.fileName}
            >{copy.downloadMac} · {RELAYUNE_MACOS_RELEASE_VERSION} <span aria-hidden="true">↓</span></a>
          </article>
          <article data-reveal>
            <span className="download-platform-icon" aria-hidden="true">⊞</span>
            <div>
              <small>{copy.desktopBeta}</small>
              <h3>Windows</h3>
              <p>{copy.windowsDownloadDetail}</p>
            </div>
            <span className="download-unavailable" role="status">
              {copy.windowsBeta} <span aria-hidden="true">·</span>
            </span>
          </article>
          <article className="download-card-android" data-reveal>
            <span className="download-platform-icon" aria-hidden="true">◫</span>
            <div>
              <small>{copy.mobileRelease} · {RELAYUNE_ANDROID_RELEASE.version}</small>
              <h3>Android</h3>
              <p>{copy.androidDownloadDetail}</p>
              <PlatformBuildDetails platform="android" locale={locale} />
            </div>
            <AndroidReleaseDetails locale={locale} copy={copy} />
            <a
              href={RELAYUNE_RELEASE_ASSETS.android.url}
              download={RELAYUNE_RELEASE_ASSETS.android.fileName}
            >
              {copy.downloadAndroid} · {RELAYUNE_ANDROID_RELEASE.version}
              <span aria-hidden="true">↓</span>
            </a>
          </article>
          <article data-reveal>
            <span className="download-platform-icon" aria-hidden="true">◎</span>
            <div>
              <small>{copy.iosRelease}</small>
              <h3>iPhone / iPad</h3>
              <p>{copy.iosDownloadDetail}</p>
              <PlatformBuildDetails platform="ios" locale={locale} />
            </div>
            <a href={RELAYUNE_IOS_TESTFLIGHT_URL}>
              {copy.joinIosBeta} <span aria-hidden="true">→</span>
            </a>
          </article>
        </div>
        <p className="download-version" data-reveal>
          {copy.platformVersions}: macOS {RELAYUNE_MACOS_RELEASE_VERSION}
          {" · "}Android {RELAYUNE_ANDROID_RELEASE.version}
          {" · "}iOS {RELAYUNE_PLATFORM_BUILDS.ios.version}
          {" · "}{copy.windowsBeta}
        </p>
      </section>

      <section className="marketing-cta" data-reveal data-motion-scene>
        <div className="marketing-cta-copy">
          <div className="marketing-cta-mark">
            <Mark size={32} />
            <p><small>{copy.readyKicker}</small><strong>{copy.productName}</strong></p>
          </div>
          <h2>{copy.ctaTitleLead}<br />{copy.ctaTitleAccent}</h2>
          <p>{marketingPlatform === "android"
            ? copy.ctaAndroidDescription
            : marketingPlatform === "mobile"
              ? copy.ctaMobileDescription
              : copy.ctaDesktopDescription}</p>
          <div className="hero-actions">
            <MarketingPrimaryAction platform={marketingPlatform} onLogin={onLogin} copy={copy} />
            {marketingPlatform === "mobile" ? (
              <a className="hero-secondary" href="#how-it-works">{copy.learnDesktopInstall} <span>→</span></a>
            ) : (
              <button className="hero-secondary" type="button" onClick={onLogin}>{copy.existingAccountLogin} <span>→</span></button>
            )}
          </div>
        </div>

        <aside
          className="marketing-cta-readiness"
          aria-label={copy.readinessLabel}
        >
          <header>
            <span><i aria-hidden="true" /> {copy.readinessTitle}</span>
            <em>{ctaReadiness.badge}</em>
          </header>
          <div className="marketing-cta-platform">
            <span aria-hidden="true">{ctaReadiness.icon}</span>
            <p><strong>{ctaReadiness.label}</strong><small>{ctaReadiness.detail}</small></p>
          </div>
          <div className="marketing-cta-route" aria-hidden="true">
            <span><i />Desktop</span>
            <b><i /></b>
            <span><i />Browser</span>
          </div>
          <dl>
            <div><dt>{copy.agentLocation}</dt><dd>{copy.agentLocationValue}</dd></div>
            <div><dt>{copy.firstConnection}</dt><dd>{copy.firstConnectionValue}</dd></div>
            <div><dt>{copy.taskContent}</dt><dd>{copy.taskContentValue}</dd></div>
          </dl>
        </aside>
      </section>

      <footer className="marketing-footer">
        <div className="marketing-brand"><Mark size={22} /><span>{copy.productName}</span></div>
        <p>{copy.footerDescription}</p>
        <nav aria-label={copy.footerNavigation}>
          <a href={RELAYUNE_RELEASE_ASSETS.macos.url} download={RELAYUNE_RELEASE_ASSETS.macos.fileName}>macOS</a>
          <span className="footer-platform-unavailable">Windows · {copy.windowsBeta}</span>
          <a href={RELAYUNE_RELEASE_ASSETS.android.url} download={RELAYUNE_RELEASE_ASSETS.android.fileName}>Android</a>
          <Link href="/community/">{copy.navCommunity}</Link>
          <a href={publicDocumentPath(locale, "changelog")}>{copy.changelog}</a>
          <a href={copy.termsPath}>{copy.terms}</a>
          <a href={copy.privacyPath}>{copy.privacy}</a>
          <a href="mailto:giraffetree1@gmail.com">{copy.contact}</a>
          <a href={copy.alternateLocalePath} hrefLang={locale === "en" ? "zh-CN" : "en"}>{copy.alternateLocaleLabel}</a>
        </nav>
        <small>{copy.copyright}</small>
      </footer>

      {installHandoffNotice ? (
        <div
          className="marketing-handoff-toast"
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true">✓</span>
          <p>
            <strong>{handoffNoticeCopy[0]}</strong>
            <small>{handoffNoticeCopy[1]}</small>
          </p>
        </div>
      ) : null}
      </main>
    </>
  );
}
