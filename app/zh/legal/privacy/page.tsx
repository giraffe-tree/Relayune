import type { Metadata } from "next";
import { zhPrivacy } from "../../../legal/legal-content";
import LegalPage from "../../../legal/legal-page";

const url = "https://relayune.giraffetree.cn/zh/legal/privacy/";

export const metadata: Metadata = {
  title: "隐私政策 | Relayune",
  description: "Relayune 中文隐私政策：端到端加密、数据类别、保存期限、安全措施、共享范围与用户权利。",
  alternates: {
    canonical: url,
    languages: {
      "zh-CN": url,
      en: "https://relayune.giraffetree.cn/en/legal/privacy/",
    },
  },
  openGraph: { title: "Relayune 隐私政策", description: zhPrivacy.summary, url, type: "article" },
};

export default function ChinesePrivacyPage() {
  return <LegalPage document={zhPrivacy} />;
}
