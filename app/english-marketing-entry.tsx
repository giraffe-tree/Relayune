"use client";

import { enMarketingCopy } from "./marketing-copy-en";
import MarketingLocalePage from "./marketing-locale-page";

export default function EnglishMarketingEntry() {
  return <MarketingLocalePage locale="en" copy={enMarketingCopy} />;
}
