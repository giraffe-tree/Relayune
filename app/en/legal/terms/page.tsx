import type { Metadata } from "next";
import { enTerms } from "../../../legal/legal-content";
import LegalPage from "../../../legal/legal-page";

const url = "https://relayune.giraffetree.cn/en/legal/terms/";

export const metadata: Metadata = {
  title: "Terms of Service | Relayune",
  description: "Relayune Terms covering accounts, security, third-party agents, acceptable use, fees, liability, and termination.",
  alternates: {
    canonical: url,
    languages: {
      "zh-CN": "https://relayune.giraffetree.cn/zh/legal/terms/",
      en: url,
    },
  },
  openGraph: { title: "Relayune Terms of Service", description: enTerms.summary, url, type: "article" },
  twitter: {
    card: "summary_large_image",
    title: "Relayune Terms of Service",
    description: enTerms.summary,
    images: ["/og.png"],
  },
};

export default function EnglishTermsPage() {
  return <LegalPage document={enTerms} />;
}
