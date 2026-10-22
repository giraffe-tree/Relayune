import EnglishMarketingEntry from "../english-marketing-entry";
import { marketingMetadata } from "../marketing-metadata";

export const metadata = marketingMetadata("en");

export default function EnglishMarketingPage() {
  return <EnglishMarketingEntry />;
}
