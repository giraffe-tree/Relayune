"use client";

import { useEffect } from "react";
import {
  applyDocumentLocale,
  type SupportedLocale,
} from "./supported-locales";

export default function DocumentLanguage({ lang }: { lang: SupportedLocale }) {
  useEffect(() => {
    applyDocumentLocale(lang);
    return () => {
      document.documentElement.lang = "zh-CN";
      document.documentElement.dir = "ltr";
    };
  }, [lang]);

  return null;
}
