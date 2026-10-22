"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { parseGroupConfig, type GroupConfig } from "./group-config";
import styles from "./community.module.css";

export default function GroupQr() {
  const [config, setConfig] = useState<GroupConfig | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(0);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let sequence = 0;
    async function refresh() {
      const request = ++sequence;
      setNow(Date.now());
      try {
        const response = await fetch(`/community/current.json?t=${Date.now()}`, {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error("QR configuration unavailable");
        const latest = parseGroupConfig(await response.json());
        if (!controller.signal.aborted && request === sequence) {
          setConfig(latest);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted && request === sequence) {
          setConfig(null);
          setError(true);
        }
      }
    }
    const onVisible = () => { if (!document.hidden) void refresh(); };
    void refresh();
    const interval = window.setInterval(onVisible, 60_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.clearInterval(clock);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [retry]);

  const active = config && Date.parse(config.expiresAt) > now;
  return <>
    {active && !error && <>
      <a className={styles.qrLink} href={config.image} aria-label="点开 Relayune 微信群二维码原图">
        <Image className={styles.groupQr} src={config.image} alt="Relayune 用户内测微信群二维码"
          width={720} height={1094} unoptimized onError={() => setError(true)} />
      </a>
      <p className={styles.longPress}>在微信内长按二维码<span>或保存原图，在微信「扫一扫」中从相册选择</span></p>
      <p className={styles.qrStatus}>有效至 {new Date(config.expiresAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）</p>
      <a className={styles.openQr} href={config.image} download>打开 / 保存二维码原图</a>
    </>}
    <p className={styles.qrStatus} role="status">
      {error ? "暂时无法加载最新群码，请重试。" : !config ? "正在获取最新群码…" : !active ? "群二维码已过期，正在等待更新。" : "此页面会自动获取最新群码。"}
    </p>
    <button className={styles.openQr} type="button" onClick={() => setRetry((value) => value + 1)}>刷新二维码</button>
    {(error || (config && !active)) && <p className={styles.qrStatus}><a href="mailto:giraffetree1@gmail.com">联系支持</a></p>}
  </>;
}
