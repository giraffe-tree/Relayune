"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import DocumentLanguage from "../document-language";
import styles from "./changelog.module.css";
import {
  LANGUAGE_PICKER_LABELS,
  LOCALE_DEFINITIONS,
  SUPPORTED_LOCALES,
  localeDirection,
  type SupportedLocale,
} from "../supported-locales";

type Locale = SupportedLocale;

type ReleaseNote = {
  version: string;
  publishedAt: string;
  platforms: string[];
  locale?: Locale;
  title: string;
  items: string[];
};

const PLATFORM_ARIA_LABELS: Record<Locale, string> = {
  "zh-CN": "发布平台",
  en: "Release platforms",
  hi: "रिलीज़ प्लेटफ़ॉर्म",
  es: "Plataformas de lanzamiento",
  ar: "منصات الإصدار",
  fr: "Plateformes de publication",
  bn: "রিলিজ প্ল্যাটফর্ম",
  pt: "Plataformas da versão",
  id: "Platform rilis",
  ur: "ریلیز پلیٹ فارمز",
};

export const CHANGELOG_COPY = {
  "zh-CN": {
    eyebrow: "RELAYUNE · 版本记录",
    title: "每次更新，都清楚可查",
    summary: "查看 Relayune 网页、服务端和各平台客户端的正式版本变化。",
    loading: "正在读取版本记录…",
    failed: "暂时无法读取版本记录，请稍后再试。",
    empty: "尚未发布版本记录。",
    retry: "重试",
    released: "发布于",
    changes: "更新内容",
    home: "首页",
changelog: "版本记录",
    terms: "服务条款",
    privacy: "隐私政策",
    contact: "联系我们",
    navigation: "公开页面导航",
    footer: "安全连接电脑上的 Codex、Kimi Code 与 Claude Code。",
  },
  en: {
    eyebrow: "RELAYUNE · CHANGELOG",
    title: "Every release, clearly recorded",
    summary: "See production changes across Relayune web, server, and platform clients.",
    loading: "Loading release history…",
    failed: "Release history is temporarily unavailable. Please try again.",
    empty: "No release notes have been published yet.",
    retry: "Retry",
    released: "Released",
    changes: "Changes",
    home: "Home",
changelog: "Changelog",
    terms: "Terms",
    privacy: "Privacy",
    contact: "Contact",
    navigation: "Public page navigation",
    footer: "Securely connect to Codex, Kimi Code, and Claude Code on your computer.",
  },
  hi: { eyebrow: "RELAYUNE · रिलीज़ नोट्स", title: "हर रिलीज़ का स्पष्ट रिकॉर्ड", summary: "Relayune वेब, सर्वर और सभी प्लेटफ़ॉर्म क्लाइंट के प्रोडक्शन बदलाव देखें।", loading: "रिलीज़ नोट्स लोड हो रहे हैं…", failed: "रिलीज़ नोट्स उपलब्ध नहीं हैं। फिर कोशिश करें।", empty: "अभी कोई रिलीज़ नोट्स नहीं हैं।", retry: "फिर कोशिश करें", released: "जारी", changes: "बदलाव", home: "होम",
changelog: "रिलीज़ नोट्स", terms: "सेवा की शर्तें", privacy: "गोपनीयता", contact: "सहायता", navigation: "सार्वजनिक पृष्ठ नेविगेशन", footer: "अपने कंप्यूटर के Codex, Kimi Code और Claude Code से सुरक्षित रूप से जुड़ें।" },
  es: { eyebrow: "RELAYUNE · CAMBIOS", title: "Cada versión, registrada con claridad", summary: "Consulta los cambios de producción de la web, el servidor y los clientes de Relayune.", loading: "Cargando el historial…", failed: "El historial no está disponible. Inténtalo de nuevo.", empty: "Aún no hay notas publicadas.", retry: "Reintentar", released: "Publicado", changes: "Cambios", home: "Inicio",
changelog: "Cambios", terms: "Términos", privacy: "Privacidad", contact: "Contacto", navigation: "Navegación pública", footer: "Conecta de forma segura Codex, Kimi Code y Claude Code de tu equipo." },
  ar: { eyebrow: "RELAYUNE · سجل الإصدارات", title: "سجل واضح لكل إصدار", summary: "اطّلع على تغييرات الإنتاج في الويب والخادم وعملاء Relayune.", loading: "جارٍ تحميل سجل الإصدارات…", failed: "سجل الإصدارات غير متاح. حاول مجددًا.", empty: "لا توجد ملاحظات إصدار بعد.", retry: "إعادة المحاولة", released: "صدر في", changes: "التغييرات", home: "الرئيسية",
changelog: "سجل الإصدارات", terms: "الشروط", privacy: "الخصوصية", contact: "تواصل معنا", navigation: "تنقل الصفحات العامة", footer: "اتصل بأمان بـ Codex وKimi Code وClaude Code على كمبيوترك." },
  fr: { eyebrow: "RELAYUNE · JOURNAL", title: "Chaque version, clairement documentée", summary: "Consultez les changements de production du web, du serveur et des clients Relayune.", loading: "Chargement de l’historique…", failed: "L’historique est indisponible. Réessayez.", empty: "Aucune note n’a encore été publiée.", retry: "Réessayer", released: "Publié le", changes: "Modifications", home: "Accueil",
changelog: "Journal", terms: "Conditions", privacy: "Confidentialité", contact: "Contact", navigation: "Navigation publique", footer: "Connectez en toute sécurité Codex, Kimi Code et Claude Code sur votre ordinateur." },
  bn: { eyebrow: "RELAYUNE · রিলিজ নোট", title: "প্রতিটি রিলিজের স্পষ্ট রেকর্ড", summary: "Relayune ওয়েব, সার্ভার ও প্ল্যাটফর্ম ক্লায়েন্টের প্রোডাকশন পরিবর্তন দেখুন।", loading: "রিলিজের ইতিহাস লোড হচ্ছে…", failed: "রিলিজের ইতিহাস পাওয়া যাচ্ছে না। আবার চেষ্টা করুন।", empty: "এখনও কোনো রিলিজ নোট প্রকাশিত হয়নি।", retry: "আবার চেষ্টা করুন", released: "প্রকাশিত", changes: "পরিবর্তন", home: "হোম",
changelog: "রিলিজ নোট", terms: "শর্তাবলি", privacy: "গোপনীয়তা", contact: "যোগাযোগ", navigation: "পাবলিক পেজ নেভিগেশন", footer: "কম্পিউটারের Codex, Kimi Code ও Claude Code-এ নিরাপদে যুক্ত হন।" },
  pt: { eyebrow: "RELAYUNE · ALTERAÇÕES", title: "Cada versão, registada com clareza", summary: "Consulte as alterações de produção da Web, servidor e clientes Relayune.", loading: "A carregar o histórico…", failed: "O histórico está indisponível. Tente novamente.", empty: "Ainda não há notas publicadas.", retry: "Tentar novamente", released: "Publicado", changes: "Alterações", home: "Início",
changelog: "Alterações", terms: "Termos", privacy: "Privacidade", contact: "Contacto", navigation: "Navegação pública", footer: "Ligue-se com segurança ao Codex, Kimi Code e Claude Code no seu computador." },
  id: { eyebrow: "RELAYUNE · CATATAN RILIS", title: "Setiap rilis tercatat dengan jelas", summary: "Lihat perubahan produksi Web, server, dan klien platform Relayune.", loading: "Memuat riwayat rilis…", failed: "Riwayat rilis tidak tersedia. Coba lagi.", empty: "Belum ada catatan rilis.", retry: "Coba lagi", released: "Dirilis", changes: "Perubahan", home: "Beranda",
changelog: "Catatan rilis", terms: "Ketentuan", privacy: "Privasi", contact: "Kontak", navigation: "Navigasi halaman publik", footer: "Hubungkan Codex, Kimi Code, dan Claude Code di komputer Anda dengan aman." },
  ur: { eyebrow: "RELAYUNE · ریلیز نوٹس", title: "ہر ریلیز کا واضح ریکارڈ", summary: "Relayune ویب، سرور اور پلیٹ فارم کلائنٹس کی پروڈکشن تبدیلیاں دیکھیں۔", loading: "ریلیز کی تاریخ لوڈ ہو رہی ہے…", failed: "ریلیز کی تاریخ دستیاب نہیں۔ دوبارہ کوشش کریں۔", empty: "ابھی کوئی ریلیز نوٹس شائع نہیں ہوئے۔", retry: "دوبارہ کوشش", released: "جاری کردہ", changes: "تبدیلیاں", home: "ہوم",
changelog: "ریلیز نوٹس", terms: "شرائط", privacy: "رازداری", contact: "رابطہ", navigation: "عوامی صفحات کی نیویگیشن", footer: "اپنے کمپیوٹر کے Codex، Kimi Code اور Claude Code سے محفوظ طور پر جڑیں۔" },
} as const;

export const CHANGELOG_PLATFORM_LABELS: Record<Locale, Record<string, string>> = {
  "zh-CN": {
    web: "网页",
    server: "服务端",
    android: "Android",
    ios: "iOS",
    macos: "macOS",
    windows: "Windows",
  },
  en: {
    web: "Web",
    server: "Server",
    android: "Android",
    ios: "iOS",
    macos: "macOS",
    windows: "Windows",
  },
  hi: { web: "वेब", server: "सर्वर", android: "Android", ios: "iOS", macos: "macOS", windows: "Windows" },
  es: { web: "Web", server: "Servidor", android: "Android", ios: "iOS", macos: "macOS", windows: "Windows" },
  ar: { web: "الويب", server: "الخادم", android: "Android", ios: "iOS", macos: "macOS", windows: "Windows" },
  fr: { web: "Web", server: "Serveur", android: "Android", ios: "iOS", macos: "macOS", windows: "Windows" },
  bn: { web: "ওয়েব", server: "সার্ভার", android: "Android", ios: "iOS", macos: "macOS", windows: "Windows" },
  pt: { web: "Web", server: "Servidor", android: "Android", ios: "iOS", macos: "macOS", windows: "Windows" },
  id: { web: "Web", server: "Server", android: "Android", ios: "iOS", macos: "macOS", windows: "Windows" },
  ur: { web: "ویب", server: "سرور", android: "Android", ios: "iOS", macos: "macOS", windows: "Windows" },
};

export default function ChangelogPage({ locale }: { locale: Locale }) {
  const text = CHANGELOG_COPY[locale];
  const base = `/${LOCALE_DEFINITIONS[locale].path}`;
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; releases: ReleaseNote[] }
    | { status: "error" }
  >({ status: "loading" });
  const [requestId, setRequestId] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/release-notes?locale=${encodeURIComponent(locale)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`release_notes_${response.status}`);
        const body = (await response.json()) as { releases?: unknown };
        if (!Array.isArray(body.releases)) throw new Error("invalid_release_notes");
        setState({ status: "ready", releases: body.releases as ReleaseNote[] });
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") {
          setState({ status: "error" });
        }
      });
    return () => controller.abort();
  }, [locale, requestId]);

  return (
    <main className={styles.page} lang={locale}>
      <DocumentLanguage lang={locale} />
      <header className={styles.siteHeader}>
        <Link className={styles.brand} href={`${base}/`} aria-label={text.home}>
          <span className={styles.mark} aria-hidden="true" />
          <span>Relayune</span>
        </Link>
        <nav className={styles.headerNav} aria-label={text.navigation}>
          <Link href={`${base}/changelog/`} aria-current="page">{text.changelog}</Link>
          <Link href={`${base}/legal/terms/`}>{text.terms}</Link>
          <label className={styles.languageLink}>
            <span className={styles.srOnly}>{LANGUAGE_PICKER_LABELS[locale]}</span>
            <select aria-label={LANGUAGE_PICKER_LABELS[locale]} value={locale} onChange={(event) => window.location.assign(`/${LOCALE_DEFINITIONS[event.target.value as Locale].path}/changelog/`)}>
              {SUPPORTED_LOCALES.map((candidate) => <option key={candidate} value={candidate} lang={candidate}>{LOCALE_DEFINITIONS[candidate].nativeName}</option>)}
            </select>
          </label>
        </nav>
      </header>

      <section className={styles.hero}>
        <p>{text.eyebrow}</p>
        <h1>{text.title}</h1>
        <div>{text.summary}</div>
      </section>

      <section className={styles.timeline} aria-label={text.changelog} aria-busy={state.status === "loading"}>
        {state.status === "loading" ? (
          <p className={styles.feedback} role="status">{text.loading}</p>
        ) : state.status === "error" ? (
          <div className={styles.feedback} role="alert">
            <p>{text.failed}</p>
            <button
              type="button"
              onClick={() => {
                setState({ status: "loading" });
                setRequestId((value) => value + 1);
              }}
            >{text.retry}</button>
          </div>
        ) : state.releases.length === 0 ? (
          <p className={styles.feedback} role="status">{text.empty}</p>
        ) : (
          state.releases.map((release) => {
            const contentLocale =
              release.locale && SUPPORTED_LOCALES.includes(release.locale)
                ? release.locale
                : locale;
            return (
              <article
                className={styles.release}
                key={`${release.version}-${release.publishedAt}`}
                lang={contentLocale}
                dir={localeDirection(contentLocale)}
              >
              <header>
                <div>
                  <p className={styles.version}>v{release.version}</p>
                  <h2>{release.title}</h2>
                </div>
                <p className={styles.date}>
                  <span>{text.released}</span>
                  <time dateTime={release.publishedAt}>{formatDate(release.publishedAt, locale)}</time>
                </p>
              </header>
              {release.platforms.length ? (
                <ul className={styles.platforms} aria-label={PLATFORM_ARIA_LABELS[locale]}>
                  {release.platforms.map((platform) => (
                    <li key={platform}>{CHANGELOG_PLATFORM_LABELS[locale][platform] ?? platform}</li>
                  ))}
                </ul>
              ) : null}
              <h3 className={styles.srOnly}>{text.changes}</h3>
              <ul className={styles.items}>
                {release.items.map((item, index) => <li key={`${release.version}-${index}`}>{item}</li>)}
              </ul>
              </article>
            );
          })
        )}
      </section>

      <footer className={styles.footer}>
        <p>{text.footer}</p>
        <nav aria-label={text.navigation}>
          <Link href={`${base}/`}>{text.home}</Link>
          <Link href={`${base}/legal/privacy/`}>{text.privacy}</Link>
          <a href="mailto:giraffetree1@gmail.com">{text.contact}</a>
        </nav>
        <small>© 2026 Relayune</small>
      </footer>
    </main>
  );
}

function formatDate(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: locale === "en" ? "short" : "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
