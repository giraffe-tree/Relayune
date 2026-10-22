import { notFound } from "next/navigation";
import ChangelogPage from "../../changelog/changelog-page";
import { changelogMetadata } from "../../changelog/changelog-metadata";
import { LOCALE_DEFINITIONS, localeFromPathSegment } from "../../supported-locales";

const locales = ["hi", "es", "ar", "fr", "bn", "pt", "id", "ur"] as const;
type Locale = (typeof locales)[number];

export function generateStaticParams() {
  return locales.map((locale) => ({ locale: LOCALE_DEFINITIONS[locale].path }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFromPathSegment((await params).locale);
  return locale ? changelogMetadata(locale) : {};
}

export default async function LocalizedChangelogPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = localeFromPathSegment((await params).locale);
  if (!locale || !locales.includes(locale as Locale)) notFound();
  return <ChangelogPage locale={locale as Locale} />;
}
