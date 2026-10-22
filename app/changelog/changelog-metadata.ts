import type { Metadata } from "next";
import { marketingLanguageAlternates } from "../marketing-metadata";
import { localePath, type SupportedLocale } from "../supported-locales";

const ORIGIN = "https://relayune.giraffetree.cn";
const copy: Record<SupportedLocale, { title: string; description: string }> = {
  en: { title: "Changelog | Relayune", description: "See production updates across Relayune web, server, and platform clients." },
  "zh-CN": { title: "版本记录 | Relayune", description: "查看 Relayune 网页、服务端与各平台客户端的正式版本变化。" },
  hi: { title: "रिलीज़ नोट्स | Relayune", description: "Relayune वेब, सर्वर और प्लेटफ़ॉर्म क्लाइंट के प्रोडक्शन अपडेट देखें।" },
  es: { title: "Historial de cambios | Relayune", description: "Consulta las actualizaciones de producción de la web, el servidor y los clientes de Relayune." },
  ar: { title: "سجل الإصدارات | Relayune", description: "اطّلع على تحديثات الإنتاج في الويب والخادم وعملاء Relayune." },
  fr: { title: "Journal des versions | Relayune", description: "Consultez les mises à jour de production du web, du serveur et des clients Relayune." },
  bn: { title: "রিলিজ নোট | Relayune", description: "Relayune ওয়েব, সার্ভার ও প্ল্যাটফর্ম ক্লায়েন্টের প্রোডাকশন আপডেট দেখুন।" },
  pt: { title: "Alterações | Relayune", description: "Consulte as atualizações de produção da Web, servidor e clientes Relayune." },
  id: { title: "Catatan rilis | Relayune", description: "Lihat pembaruan produksi Web, server, dan klien platform Relayune." },
  ur: { title: "ریلیز نوٹس | Relayune", description: "Relayune ویب، سرور اور پلیٹ فارم کلائنٹس کی پروڈکشن اپ ڈیٹس دیکھیں۔" },
};

export function changelogMetadata(locale: SupportedLocale): Metadata {
  const localized = copy[locale];
  const canonical = `${ORIGIN}${localePath(locale, "changelog")}`;
  const languages = Object.fromEntries(
    Object.entries(marketingLanguageAlternates()).map(([language, url]) => [
      language,
      language === "x-default" ? `${ORIGIN}/en/changelog/` : `${url}changelog/`,
    ]),
  );
  return { title: localized.title, description: localized.description, alternates: { canonical, languages } };
}
