import { notFound } from "next/navigation";
import { localizedMarketingCopy } from "../marketing-copy-localized";
import MarketingLocalePage from "../marketing-locale-page";
import { marketingMetadata } from "../marketing-metadata";
import {
  LOCALE_DEFINITIONS,
  localeFromPathSegment,
  type SupportedLocale,
} from "../supported-locales";

const additionalLocales = ["hi", "es", "ar", "fr", "bn", "pt", "id", "ur"] as const;
type AdditionalLocale = (typeof additionalLocales)[number];

export function generateStaticParams() {
  return additionalLocales.map((locale) => ({
    locale: LOCALE_DEFINITIONS[locale].path,
  }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = localeFromPathSegment((await params).locale);
  return locale ? marketingMetadata(locale) : {};
}

export default async function LocalizedMarketingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = localeFromPathSegment((await params).locale);
  if (!locale || !additionalLocales.includes(locale as AdditionalLocale)) {
    notFound();
  }
  return (
    <MarketingLocalePage
      locale={locale as Exclude<SupportedLocale, "zh-CN" | "en">}
      copy={localizedMarketingCopy(locale as AdditionalLocale)}
    />
  );
}
