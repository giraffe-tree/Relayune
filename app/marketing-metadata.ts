import type { Metadata } from "next";
import {
  LOCALE_DEFINITIONS,
  SUPPORTED_LOCALES,
  localePath,
  type SupportedLocale,
} from "./supported-locales";

const ORIGIN = "https://relayune.giraffetree.cn";

const copy: Readonly<
  Record<SupportedLocale, { title: string; description: string }>
> = {
  en: {
    title: "Relayune — Continue your local Agent from anywhere",
    description: "Securely connect to Codex, Kimi Code, and Claude Code on your computer and continue local tasks from any browser.",
  },
  "zh-CN": {
    title: "Relayune — 随时回到你的本机 Agent",
    description: "安全连接电脑上的 Codex、Kimi Code 与 Claude Code，在浏览器继续本机任务。",
  },
  hi: {
    title: "Relayune — अपने स्थानीय Agent को कहीं से भी जारी रखें",
    description: "अपने कंप्यूटर के Codex, Kimi Code और Claude Code से सुरक्षित रूप से जुड़ें और किसी भी ब्राउज़र से स्थानीय कार्य जारी रखें।",
  },
  es: {
    title: "Relayune — Continúa tu Agent local desde cualquier lugar",
    description: "Conecta de forma segura Codex, Kimi Code y Claude Code de tu equipo y continúa las tareas locales desde cualquier navegador.",
  },
  ar: {
    title: "Relayune — تابع وكيلك المحلي من أي مكان",
    description: "اتصل بأمان بـ Codex وKimi Code وClaude Code على كمبيوترك وتابع المهام المحلية من أي متصفح.",
  },
  fr: {
    title: "Relayune — Continuez votre Agent local où que vous soyez",
    description: "Connectez en toute sécurité Codex, Kimi Code et Claude Code sur votre ordinateur et continuez vos tâches depuis tout navigateur.",
  },
  bn: {
    title: "Relayune — যেকোনো জায়গা থেকে স্থানীয় Agent চালিয়ে যান",
    description: "কম্পিউটারের Codex, Kimi Code ও Claude Code-এ নিরাপদে যুক্ত হয়ে যেকোনো ব্রাউজার থেকে স্থানীয় কাজ চালিয়ে যান।",
  },
  pt: {
    title: "Relayune — Continue seu Agent local de qualquer lugar",
    description: "Conecte com segurança Codex, Kimi Code e Claude Code no computador e continue tarefas locais em qualquer navegador.",
  },
  id: {
    title: "Relayune — Lanjutkan Agent lokal dari mana saja",
    description: "Hubungkan Codex, Kimi Code, dan Claude Code di komputer dengan aman lalu lanjutkan tugas lokal dari browser apa pun.",
  },
  ur: {
    title: "Relayune — اپنا مقامی Agent کہیں سے بھی جاری رکھیں",
    description: "اپنے کمپیوٹر کے Codex، Kimi Code اور Claude Code سے محفوظ طور پر جڑیں اور کسی بھی براؤزر سے مقامی کام جاری رکھیں۔",
  },
};

export function marketingLanguageAlternates(): Record<string, string> {
  return Object.fromEntries([
    ...SUPPORTED_LOCALES.map((locale) => [
      locale,
      `${ORIGIN}${localePath(locale)}`,
    ]),
    ["x-default", `${ORIGIN}/`],
  ]);
}

export function marketingMetadata(locale: SupportedLocale): Metadata {
  const localized = copy[locale];
  const url = `${ORIGIN}${localePath(locale)}`;
  return {
    title: localized.title,
    description: localized.description,
    alternates: {
      canonical: url,
      languages: marketingLanguageAlternates(),
    },
    openGraph: {
      title: localized.title,
      description: localized.description,
      url,
      type: "website",
      locale,
      alternateLocale: SUPPORTED_LOCALES.filter((item) => item !== locale),
      images: [{ url: "/og.png", width: 1680, height: 941, alt: "Relayune" }],
    },
    twitter: {
      card: "summary_large_image",
      title: localized.title,
      description: localized.description,
      images: ["/og.png"],
    },
    other: {
      "relayune:locale-path": LOCALE_DEFINITIONS[locale].path,
    },
  };
}
