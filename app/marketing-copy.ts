import { enMarketingCopy } from "./marketing-copy-en";
import { zhMarketingCopy } from "./marketing-copy-zh";
import type { SupportedLocale } from "./supported-locales";

export type MarketingLocale = SupportedLocale;

export { enMarketingCopy, zhMarketingCopy };

export const marketingCopy = {
  "zh-CN": zhMarketingCopy,
  en: enMarketingCopy,
} as const;

type DeepWiden<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends readonly (infer Item)[]
        ? readonly DeepWiden<Item>[]
        : T extends object
          ? { readonly [Key in keyof T]: DeepWiden<T[Key]> }
          : T;

export type MarketingCopy = DeepWiden<typeof enMarketingCopy>;

export function getMarketingCopy(locale: MarketingLocale) {
  return locale === "zh-CN" ? zhMarketingCopy : enMarketingCopy;
}
