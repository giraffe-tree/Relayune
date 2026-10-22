"use client";

import { useEffect } from "react";
import type { AuthLocale } from "./auth-locale";
import { applyDocumentLocale, localeDirection } from "./supported-locales";

const openingWorkspace: Record<AuthLocale, string> = {
  "zh-CN": "正在打开安全工作区…",
  en: "Opening secure workspace…",
  hi: "सुरक्षित कार्यस्थान खुल रहा है…",
  es: "Abriendo el espacio de trabajo seguro…",
  ar: "جارٍ فتح مساحة العمل الآمنة…",
  fr: "Ouverture de l’espace de travail sécurisé…",
  bn: "নিরাপদ ওয়ার্কস্পেস খোলা হচ্ছে…",
  pt: "Abrindo o espaço de trabalho seguro…",
  id: "Membuka ruang kerja aman…",
  ur: "محفوظ ورک اسپیس کھل رہی ہے…",
};

export default function WorkbenchFallback({ locale }: { locale: AuthLocale }) {
  useEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);

  return (
    <main className="workbench-loading" aria-busy="true" lang={locale} dir={localeDirection(locale)}>
      <section className="workbench-loading-card" role="status" aria-live="polite">
        <span className="workbench-loading-spinner" aria-hidden="true" />
        <h1>Relayune</h1>
        <p>{openingWorkspace[locale]}</p>
      </section>
    </main>
  );
}
