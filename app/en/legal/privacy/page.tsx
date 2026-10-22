import type { Metadata } from "next";
import { enPrivacy } from "../../../legal/legal-content";
import LegalPage from "../../../legal/legal-page";

const url = "https://relayune.giraffetree.cn/en/legal/privacy/";

export const metadata: Metadata = {
  title: "Privacy Policy | Relayune",
  description: "Relayune Privacy Policy covering end-to-end encryption, data categories, retention, security, disclosures, and user rights.",
  alternates: {
    canonical: url,
    languages: {
      "zh-CN": "https://relayune.giraffetree.cn/zh/legal/privacy/",
      en: url,
    },
  },
  openGraph: { title: "Relayune Privacy Policy", description: enPrivacy.summary, url, type: "article" },
  twitter: {
    card: "summary_large_image",
    title: "Relayune Privacy Policy",
    description: enPrivacy.summary,
    images: ["/og.png"],
  },
};

export default function EnglishPrivacyPage() {
  return <LegalPage document={enPrivacy} />;
}
