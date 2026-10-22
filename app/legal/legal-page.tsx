import Link from "next/link";
import DocumentLanguage from "../document-language";
import styles from "./legal.module.css";
import { authText } from "../auth-language";
import { LOCALE_DEFINITIONS, type SupportedLocale } from "../supported-locales";

export type LegalDocument = {
  locale: "zh-CN" | "en";
  kind: "terms" | "privacy";
  eyebrow: string;
  title: string;
  summary: string;
  effectiveLabel: string;
  effectiveDate: string;
  updatedLabel: string;
  updatedDate: string;
  versionLabel: string;
  version: string;
  noticeTitle: string;
  notice: React.ReactNode;
  sections: Array<{
    id: string;
    title: string;
    content: React.ReactNode;
  }>;
};

const paths = {
  "zh-CN": {
    home: "/zh/",
    terms: "/zh/legal/terms/",
    privacy: "/zh/legal/privacy/",
  },
  en: {
    home: "/en/",
    terms: "/en/legal/terms/",
    privacy: "/en/legal/privacy/",
  },
} as const;

export default function LegalPage({
  document,
  requestedLocale = document.locale,
  englishNotice,
}: {
  document: LegalDocument;
  requestedLocale?: SupportedLocale;
  englishNotice?: string;
}) {
  const chinese = document.locale === "zh-CN";
  const otherLocale = chinese ? "en" : "zh-CN";
  const relatedKind = document.kind === "terms" ? "privacy" : "terms";
  const fallback = requestedLocale !== document.locale;
  const base = `/${LOCALE_DEFINITIONS[requestedLocale].path}`;
  const pagePaths = fallback
    ? { home: `${base}/`, terms: `${base}/legal/terms/`, privacy: `${base}/legal/privacy/` }
    : paths[document.locale];

  return (
    <main className={styles.page} lang={requestedLocale}>
      <DocumentLanguage lang={requestedLocale} />
      <header className={styles.siteHeader}>
        <Link
          className={styles.brand}
          href={pagePaths.home}
          aria-label={`${authText(requestedLocale, "backHome")}: Relayune`}
        >
          <span className={styles.mark} aria-hidden="true" />
          <span>Relayune</span>
        </Link>
        <nav className={styles.headerNav} aria-label={authText(requestedLocale, "publicNavLabel")}>
          <Link href={pagePaths.terms} aria-current={document.kind === "terms" ? "page" : undefined}>
            {authText(requestedLocale, "terms")}
          </Link>
          <Link href={pagePaths.privacy} aria-current={document.kind === "privacy" ? "page" : undefined}>
            {authText(requestedLocale, "privacy")}
          </Link>
          <Link className={styles.languageLink} href={fallback ? paths.en[document.kind] : paths[otherLocale][document.kind]} hrefLang={fallback ? "en" : otherLocale}>
            {fallback ? "English" : chinese ? "English" : "中文"}
          </Link>
        </nav>
      </header>

      {fallback && englishNotice ? (
        <aside className={styles.notice} aria-label="English legal text notice">
          <span aria-hidden="true">◇</span><div><strong lang={requestedLocale}>{englishNotice}</strong></div>
        </aside>
      ) : null}

      <article className={styles.document} lang={document.locale} dir="ltr">
        <header className={styles.hero}>
          <p className={styles.eyebrow}>{document.eyebrow}</p>
          <h1>{document.title}</h1>
          <p className={styles.summary}>{document.summary}</p>
          <dl className={styles.meta}>
            <div>
              <dt>{document.effectiveLabel}</dt>
              <dd>{document.effectiveDate}</dd>
            </div>
            <div>
              <dt>{document.updatedLabel}</dt>
              <dd>{document.updatedDate}</dd>
            </div>
            <div>
              <dt>{document.versionLabel}</dt>
              <dd>{document.version}</dd>
            </div>
          </dl>
        </header>

        <aside className={styles.notice} aria-labelledby="legal-notice-title">
          <span aria-hidden="true">◇</span>
          <div>
            <h2 id="legal-notice-title">{document.noticeTitle}</h2>
            {document.notice}
          </div>
        </aside>

        <div className={styles.body}>
          <nav className={styles.toc} aria-label={chinese ? "目录" : "Contents"}>
            <p>{chinese ? "目录" : "Contents"}</p>
            <ol>
              {document.sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>{section.title}</a>
                </li>
              ))}
            </ol>
          </nav>

          <div className={styles.sections}>
            {document.sections.map((section, index) => (
              <section id={section.id} key={section.id}>
                <div className={styles.sectionNumber}>{String(index + 1).padStart(2, "0")}</div>
                <div>
                  <h2>{section.title}</h2>
                  {section.content}
                </div>
              </section>
            ))}
          </div>
        </div>

        <footer className={styles.documentFooter}>
          <div>
            <p>{chinese ? "相关文档" : "Related document"}</p>
            <Link href={pagePaths[relatedKind]}>
              {relatedKind === "privacy"
                ? chinese ? "阅读隐私政策 →" : "Read the Privacy Policy →"
                : chinese ? "阅读服务条款 →" : "Read the Terms of Service →"}
            </Link>
          </div>
          <div>
            <p>{chinese ? "客服与支持" : "Customer support"}</p>
            <a href="mailto:giraffetree1@gmail.com">giraffetree1@gmail.com</a>
          </div>
        </footer>
      </article>
    </main>
  );
}
