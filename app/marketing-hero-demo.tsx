"use client";

import { useEffect, useRef, useState } from "react";
import type { MarketingCopy, MarketingLocale } from "./marketing-copy";
import { localeDirection } from "./supported-locales";
import "./marketing-hero-demo.css";

// Offline demonstration using a synthetic task; no real conversation history.
// The public page never loads private threads or calls an Agent API.
const STAGES = ["request", "implement", "verify", "done"] as const;
const DURATIONS = [5500, 6500, 6500, 8500];
const asset = (device: "web" | "phone", stage: number) => `/marketing/task-replay/${device}-${STAGES[stage]}.webp`;

export default function MarketingHeroDemo({ copy, locale, motionPaused }: {
  copy: MarketingCopy; locale: MarketingLocale; motionPaused: boolean;
}) {
  const labels = copy.heroReplay;
  const rootRef = useRef<HTMLDivElement>(null);
  const [clock, setClock] = useState({ beat: 0, elapsed: 0 });
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [ready, setReady] = useState(false);
  const { beat } = clock;
  const stopped = motionPaused || reducedMotion || !ready;
  const running = !stopped && visible && pageVisible;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(preference.matches);
    const updateVisibility = () => setPageVisible(document.visibilityState === "visible");
    updateMotion(); updateVisibility();
    preference.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.15 });
    const root = rootRef.current;
    const resizeObserver = new ResizeObserver(([entry]) => {
      root?.style.setProperty("--hero-device-scale", String(Math.min(1, entry.contentRect.width / 760)));
    });
    if (root) { observer.observe(root); resizeObserver.observe(root); }
    return () => {
      preference.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
      observer.disconnect(); resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    // Start the shared clock only when both devices can show every stage.
    const preload = STAGES.flatMap((_, stage) => (["web", "phone"] as const).map(device => {
      const image = new window.Image();
      image.src = asset(device, stage);
      return image.decode();
    }));
    void Promise.all(preload).then(() => { if (!disposed) setReady(true); }).catch(() => {});
    return () => { disposed = true; };
  }, [visible]);

  useEffect(() => {
    if (!running) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = Math.min(now - previous, 250);
      previous = now;
      setClock(current => {
        const nextElapsed = current.elapsed + delta;
        return nextElapsed >= DURATIONS[current.beat]
          ? { beat: (current.beat + 1) % STAGES.length, elapsed: 0 }
          : { ...current, elapsed: nextElapsed };
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [running]);

  const screen = (device: "web" | "phone") => <div className="replay-screen" lang="zh-CN">
    {STAGES.map((stage, index) => (
      // Assets are already sized and compressed for these device frames.
      // eslint-disable-next-line @next/next/no-img-element
      <img key={stage} src={asset(device, index)} alt="" width={device === "web" ? 2560 : 1170} height={device === "web" ? 1416 : 2532}
        className={index === beat ? "is-current" : ""} loading={index === 0 ? "eager" : "lazy"} decoding="async" />
    ))}
  </div>;

  return <div ref={rootRef} className={`hero-demo${running ? " is-demo-playing" : ""}`} data-demo-beat={beat} role="img" aria-label={`${labels.title} · ${labels.disclosure}`} dir={localeDirection(locale)}>
    <div className="demo-device-stage" aria-hidden="true"><div className="hero-device-scene" dir="ltr">
      <div className="hero-device-floor" />
      <div className="hero-laptop-device">
        <div className="hero-laptop-lid"><span className="hero-laptop-camera" /><div className="hero-laptop-display">{screen("web")}</div></div>
        <div className="hero-laptop-base"><span /><i /></div>
      </div>
      <div className="hero-phone-device"><span className="hero-phone-speaker" />
        <div className="hero-phone-display">{screen("phone")}<span className="replay-home-indicator" /></div><span className="hero-phone-button" />
      </div>
      <svg className="hero-secure-route" viewBox="0 0 760 590" focusable="false"><path className="hero-route-rail" d="M496 440 C530 440 512 398 549 398" /><path className="hero-route-flow" d="M496 440 C530 440 512 398 549 398" /><circle className="hero-route-node-ring" cx="496" cy="440" r="5" /><circle className="hero-route-node-core" cx="549" cy="398" r="4" /></svg>
      <div className="hero-encryption-badge"><span>⌁</span><p><strong>{copy.endToEndEncrypted}</strong><small>{copy.serverCiphertextOnly}</small></p></div>
    </div></div>
  </div>;
}
