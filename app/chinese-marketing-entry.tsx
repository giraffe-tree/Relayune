"use client";

import { zhMarketingCopy } from "./marketing-copy-zh";
import MarketingLocalePage from "./marketing-locale-page";

export default function ChineseMarketingEntry() {
  return <MarketingLocalePage locale="zh-CN" copy={zhMarketingCopy} />;
}
