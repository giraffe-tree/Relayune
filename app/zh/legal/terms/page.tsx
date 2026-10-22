import type { Metadata } from "next";
import { zhTerms } from "../../../legal/legal-content";
import LegalPage from "../../../legal/legal-page";

const url = "https://relayune.giraffetree.cn/zh/legal/terms/";

export const metadata: Metadata = {
  title: "服务条款 | Relayune",
  description: "Relayune 中文服务条款：账户、安全、第三方 Agent、可接受使用、费用、责任与终止规则。",
  alternates: {
    canonical: url,
    languages: {
      "zh-CN": url,
      en: "https://relayune.giraffetree.cn/en/legal/terms/",
    },
  },
  openGraph: { title: "Relayune 服务条款", description: zhTerms.summary, url, type: "article" },
};

export default function ChineseTermsPage() {
  return <LegalPage document={zhTerms} />;
}
