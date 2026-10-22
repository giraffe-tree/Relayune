export const OFFICIAL_SERVER_ORIGIN = "https://relayune.giraffetree.cn";

export function normalizedInstanceOrigin(value: string): string {
  const url = new URL(value.trim());
  const loopback = url.hostname === "localhost" || url.hostname === "[::1]"
    || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("https_required");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("origin_required");
  return url.origin;
}

export function isOfficialInstance(origin: string): boolean {
  try { return normalizedInstanceOrigin(origin) === OFFICIAL_SERVER_ORIGIN; }
  catch { return false; }
}

export function instanceCopy(locale: string) {
  const en = {
    title: "Service instance", official: "Official service", custom: "Self-hosted service",
    address: "Server address", probe: "Check connection", save: "Switch service", cancel: "Cancel",
    warning: "Switching stops Relay, signs out, removes saved authorizations and encrypted local caches. Log in and pair again. Previously authorized clients are not remotely revoked: revoke them from the previous service if needed.",
    confirm: "I understand and want to reset this computer's connection",
    checking: "Checking securely…", ready: "Connection verified. Sign in on this service after switching.",
    setup: "Connected. The owner must finish initialization locally on the server before signing in.",
    failure: "Connection failed. Check the address, VPN or public entry, and that this computer trusts the instance CA certificate. HTTPS certificate verification remains required.",
    resetFailure: "The service change could not finish. Check Help & Diagnostics and retry; do not reuse old credentials.",
    addressHelp: "Use an HTTPS origin, for example https://100.64.0.2:3443. For a private instance certificate, compare its fingerprint with the server owner and install the CA in the operating system's trust store first.",
    busy: "Finish or cancel the current operation before switching.",
    update: "Official signed app updates stay on the official channel. Self-hosted mode only checks for updates when you request it.",
  };
  if (locale !== "zh-CN") return en;
  return {
    title: "服务实例", official: "官方服务", custom: "自建服务", address: "服务地址",
    probe: "检查连接", save: "切换服务", cancel: "取消",
    warning: "切换会停止 Relay、退出账户，并清除保存的授权和本机加密缓存。需要重新登录和配对。旧服务上的授权不会远程撤销，如需撤销请到旧服务操作。",
    confirm: "我已了解，重置本电脑的连接并切换服务",
    checking: "正在检查安全连接…", ready: "连接检查通过。切换后请在此服务重新登录。",
    setup: "连接成功。部署者需要先在服务器本机完成初始化，之后才能登录。",
    failure: "连接失败。请检查地址、VPN 或公网入口，并确认本电脑已信任实例 CA 证书。不会跳过 HTTPS 证书校验。",
    resetFailure: "切换未能完成，请查看帮助与诊断后重试；不要复用旧凭据。",
    addressHelp: "填写 HTTPS 来源地址，例如 https://100.64.0.2:3443。私有实例证书需要先向部署者核对指纹，并在操作系统中安装和信任 CA。",
    busy: "请先完成或取消当前操作，再切换服务。",
    update: "官方签名应用仍使用官方更新渠道；自托管模式仅在你主动请求时检查更新。",
  };
}
