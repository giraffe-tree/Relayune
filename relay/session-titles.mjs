// These are UI placeholders sent by existing Web/mobile clients, not custom
// titles. Keep legacy translations here so upgrading the Relay also repairs
// display names for sessions created before the fix.
const PLACEHOLDER_TITLES = new Set([
  "新建远程会话",
  "新建远程 Claude 会话",
  "新建远程 Kimi 会话",
  "New remote session",
  "Nouvelle session distante",
  "Nova sessão remota",
  "Nueva sesión remota",
  "Sesi jarak jauh baru",
  "جلسة بعيدة جديدة",
  "نیا ریموٹ سیشن",
  "नया दूरस्थ सेशन",
  "नया रिमोट सत्र",
  "নতুন রিমোট সেশন",
  "নতুন দূরবর্তী সেশন",
]);

export function customSessionTitle(value) {
  const title = typeof value === "string" ? value.trim() : "";
  return PLACEHOLDER_TITLES.has(title) ? "" : title;
}
