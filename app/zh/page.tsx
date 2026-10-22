import ChineseMarketingEntry from "../chinese-marketing-entry";
import { marketingMetadata } from "../marketing-metadata";

export const metadata = marketingMetadata("zh-CN");

export default function ChineseMarketingPage() {
  return <ChineseMarketingEntry />;
}
