import type { Metadata } from "next";
import { marketingLanguageAlternates } from "../marketing-metadata";
import { localePath, type SupportedLocale } from "../supported-locales";

type ExtraLocale = Exclude<SupportedLocale, "zh-CN" | "en">;
export const LEGAL_ENGLISH_NOTICES: Record<ExtraLocale, string> = {
  hi: "इस कानूनी दस्तावेज़ का सत्यापित अनुवाद अभी उपलब्ध नहीं है। नीचे दिया आधिकारिक पाठ English में है।",
  es: "Aún no hay una traducción jurídica revisada. El texto oficial que aparece a continuación está en English.",
  ar: "لا تتوفر بعد ترجمة قانونية مراجَعة. النص الرسمي أدناه مكتوب باللغة English.",
  fr: "Aucune traduction juridique révisée n’est encore disponible. Le texte officiel ci-dessous est en English.",
  bn: "এই আইনি নথির পর্যালোচিত অনুবাদ এখনও নেই। নিচের আনুষ্ঠানিক পাঠটি English ভাষায়।",
  pt: "Ainda não existe uma tradução jurídica revista. O texto oficial abaixo está em English.",
  id: "Terjemahan hukum yang telah ditinjau belum tersedia. Teks resmi di bawah ini menggunakan English.",
  ur: "اس قانونی دستاویز کا نظرثانی شدہ ترجمہ ابھی دستیاب نہیں۔ نیچے سرکاری متن English میں ہے۔",
};

const labels: Record<ExtraLocale, Record<"terms" | "privacy", string>> = {
  hi: { terms: "सेवा की शर्तें", privacy: "गोपनीयता नीति" }, es: { terms: "Términos del servicio", privacy: "Política de privacidad" },
  ar: { terms: "شروط الخدمة", privacy: "سياسة الخصوصية" }, fr: { terms: "Conditions d’utilisation", privacy: "Politique de confidentialité" },
  bn: { terms: "পরিষেবার শর্ত", privacy: "গোপনীয়তা নীতি" }, pt: { terms: "Termos de Serviço", privacy: "Política de Privacidade" },
  id: { terms: "Ketentuan Layanan", privacy: "Kebijakan Privasi" }, ur: { terms: "سروس کی شرائط", privacy: "رازداری کی پالیسی" },
};

export function legalFallbackMetadata(locale: ExtraLocale, kind: "terms" | "privacy"): Metadata {
  const origin = "https://relayune.giraffetree.cn";
  const suffix = `legal/${kind}`;
  const languages = Object.fromEntries(Object.entries(marketingLanguageAlternates()).map(([language, url]) => [language, language === "x-default" ? `${origin}/en/${suffix}/` : `${url}${suffix}/`]));
  return { title: `${labels[locale][kind]} — English | Relayune`, description: LEGAL_ENGLISH_NOTICES[locale], alternates: { canonical: `${origin}${localePath(locale, suffix)}`, languages } };
}
