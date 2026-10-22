import type { AuthLocale } from "./auth-language";

const copy = {
  en: { latest: "Back to latest", records: "{count} agent records", review: "Review results and status", input: "Enter to send · Shift + Enter for a new line" },
  "zh-CN": { latest: "回到最新", records: "{count} 项 Agent 工作记录", review: "查看结果与状态", input: "Enter 发送 · Shift + Enter 换行" },
  hi: { latest: "नवीनतम पर जाएँ", records: "{count} एजेंट रिकॉर्ड", review: "परिणाम और स्थिति देखें", input: "भेजने के लिए Enter · नई पंक्ति के लिए Shift + Enter" },
  es: { latest: "Ir a lo más reciente", records: "{count} registros de agentes", review: "Ver resultados y estado", input: "Enter para enviar · Mayús + Enter para nueva línea" },
  ar: { latest: "العودة إلى الأحدث", records: "{count} سجلات للوكلاء", review: "عرض النتائج والحالة", input: "Enter للإرسال · Shift + Enter لسطر جديد" },
  fr: { latest: "Revenir aux derniers messages", records: "{count} activités d’agents", review: "Voir les résultats et le statut", input: "Entrée pour envoyer · Maj + Entrée pour un saut de ligne" },
  bn: { latest: "সর্বশেষে ফিরুন", records: "{count}টি এজেন্ট রেকর্ড", review: "ফলাফল ও অবস্থা দেখুন", input: "পাঠাতে Enter · নতুন লাইনের জন্য Shift + Enter" },
  pt: { latest: "Voltar ao mais recente", records: "{count} registros de agentes", review: "Ver resultados e estado", input: "Enter para enviar · Shift + Enter para nova linha" },
  id: { latest: "Kembali ke terbaru", records: "{count} catatan agen", review: "Lihat hasil dan status", input: "Enter untuk mengirim · Shift + Enter untuk baris baru" },
  ur: { latest: "تازہ ترین پر واپس جائیں", records: "{count} ایجنٹ ریکارڈ", review: "نتائج اور حالت دیکھیں", input: "بھیجنے کے لیے Enter · نئی سطر کے لیے Shift + Enter" },
} satisfies Record<AuthLocale, Record<string, string>>;

export function flowText(locale: AuthLocale, key: keyof typeof copy.en, count?: number) {
  return copy[locale][key].replace("{count}", new Intl.NumberFormat(locale).format(count ?? 0));
}
