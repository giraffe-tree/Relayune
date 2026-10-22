"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { AuthLocale } from "./auth-locale";
import type { InstanceCapabilities } from "./instance-client";
import { sameOriginApiUrl } from "./instance-client";

const copy = {
  "zh-CN": {
    title: "登录自建 Relayune", setupTitle: "实例尚未初始化",
    detail: "使用这个实例的用户名和密码，无需邮箱验证。",
    setup: "请在部署机器上运行初始化命令，设置管理员密码。初始化完成后刷新本页；其他访问者不能在这里创建管理员。",
    origin: "当前服务器", username: "用户名", password: "密码", login: "登录", busy: "正在登录…",
    invalid: "请输入用户名和密码。", failed: "登录失败，请检查用户名和密码。",
    limited: "尝试次数过多，请稍后再试。", network: "连接失败，请检查实例地址和网络后重试。",
    recover: "忘记密码时，请在部署机器上运行本地账户恢复命令。", retry: "刷新状态",
    note: "账户仅用于此实例。手机和浏览器仍需使用电脑上的连接码分别授权。",
  },
  en: {
    title: "Sign in to your Relayune instance", setupTitle: "Instance setup is required",
    detail: "Use this instance's username and password. Email verification is not required.",
    setup: "Run the initialization command on the deployment machine to choose an administrator password, then refresh this page. Visitors cannot claim administrator access here.",
    origin: "Current server", username: "Username", password: "Password", login: "Sign in", busy: "Signing in…",
    invalid: "Enter your username and password.", failed: "Sign-in failed. Check your username and password.",
    limited: "Too many attempts. Try again later.", network: "Connection failed. Check the instance address and network.",
    recover: "To recover a password, run the local account recovery command on the deployment machine.", retry: "Refresh status",
    note: "This account belongs to this instance. Each phone and browser still needs its own pairing authorization.",
  },
};

export function InstanceLogin({ locale, instance, apiBase, pairingId, desktopLoginId }: {
  locale: AuthLocale; instance: InstanceCapabilities; apiBase: string;
  pairingId: string | null; desktopLoginId: string | null;
}) {
  const text = copy[locale === "zh-CN" ? "zh-CN" : "en"];
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<"invalid" | "failed" | "limited" | "network" | null>(null);
  const [busy, setBusy] = useState(false);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => { const controller = operation.current; operation.current = null; controller?.abort(); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || instance.setup_required) return;
    if (!username.trim() || !password) { setError("invalid"); return; }
    setError(null); setBusy(true);
    const controller = new AbortController();
    operation.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(sameOriginApiUrl("/api/auth/password", apiBase, window.location.origin), {
        method: "POST", credentials: "same-origin", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim().toLowerCase(), password,
          pairing_id: pairingId ?? undefined, desktop_login_id: desktopLoginId ?? undefined }),
      });
      if (operation.current !== controller) return;
      setPassword("");
      if (!response.ok) { setError(response.status === 429 ? "limited" : "failed"); return; }
      const body = await response.json();
      if (operation.current !== controller) return;
      if (body.authenticated !== true) { setError("failed"); return; }
      window.location.reload();
    } catch {
      if (operation.current === controller) setError("network");
    } finally {
      window.clearTimeout(timer);
      if (operation.current === controller) { operation.current = null; setBusy(false); }
    }
  }

  return <section className="login-card" aria-labelledby="instance-login-title">
    <h1 id="instance-login-title">{instance.setup_required ? text.setupTitle : text.title}</h1>
    <p className="login-subtitle">{instance.setup_required ? text.setup : text.detail}</p>
    <p>{text.origin}: <bdi>{typeof window !== "undefined" ? window.location.origin : ""}</bdi></p>
    {instance.setup_required ? <>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 13, textAlign: "start" }}>
        <code>sudo node dist/self-hosted-server/local-account.cjs initialize</code>
      </pre>
      <button type="button" className="primary-button login-button" onClick={() => window.location.reload()}>{text.retry}</button>
    </> : <form className="login-form" onSubmit={submit} aria-busy={busy}>
      <div className="field-group"><label htmlFor="instance-username">{text.username}</label>
        <div className="email-field"><input id="instance-username" type="text" dir="ltr" autoComplete="username"
          value={username} onChange={(event) => setUsername(event.target.value)} maxLength={32} required disabled={busy} autoCapitalize="none" autoCorrect="off" /></div></div>
      <div className="field-group"><label htmlFor="instance-password">{text.password}</label>
        <div className="email-field"><input id="instance-password" type="password" autoComplete="current-password"
          value={password} onChange={(event) => setPassword(event.target.value)} maxLength={128} required disabled={busy} /></div></div>
      {error && <p role="alert" className="field-error">{text[error]}</p>}
      <button className="primary-button login-button" type="submit" disabled={busy}>{busy ? text.busy : text.login}</button>
      <p className="password-requirement">{text.recover}</p>
    </form>}
    <p className="password-requirement">{text.note}</p>
  </section>;
}

export function InstancePublicLinks({ locale }: { locale: AuthLocale }) {
  return <nav className="login-footnote"><Link href="/instance-info/">
    {locale === "zh-CN" ? "自建实例与数据说明" : "Instance and data information"}
  </Link></nav>;
}
