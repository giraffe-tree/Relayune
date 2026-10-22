import { notFound } from "next/navigation";
import { enPrivacy, enTerms } from "../../../legal/legal-content";
import { LEGAL_ENGLISH_NOTICES, legalFallbackMetadata } from "../../../legal/legal-fallback";
import LegalPage from "../../../legal/legal-page";
import { LOCALE_DEFINITIONS, localeFromPathSegment } from "../../../supported-locales";

const locales = ["hi", "es", "ar", "fr", "bn", "pt", "id", "ur"] as const;
const kinds = ["terms", "privacy"] as const;
type Locale = (typeof locales)[number];
type Kind = (typeof kinds)[number];

export function generateStaticParams() { return locales.flatMap((locale) => kinds.map((kind) => ({ locale: LOCALE_DEFINITIONS[locale].path, kind }))); }
export const dynamicParams = false;
export async function generateMetadata({ params }: { params: Promise<{ locale: string; kind: string }> }) { const value = await params; const locale = localeFromPathSegment(value.locale); if (!locale || !locales.includes(locale as Locale) || !kinds.includes(value.kind as Kind)) return {}; return legalFallbackMetadata(locale as Locale, value.kind as Kind); }
export default async function LocalizedLegalPage({ params }: { params: Promise<{ locale: string; kind: string }> }) { const value = await params; const locale = localeFromPathSegment(value.locale); if (!locale || !locales.includes(locale as Locale) || !kinds.includes(value.kind as Kind)) notFound(); const kind = value.kind as Kind; return <LegalPage document={kind === "terms" ? enTerms : enPrivacy} requestedLocale={locale as Locale} englishNotice={LEGAL_ENGLISH_NOTICES[locale as Locale]} />; }
