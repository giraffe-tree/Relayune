import ChangelogPage from "../../changelog/changelog-page";
import { changelogMetadata } from "../../changelog/changelog-metadata";

export const metadata = changelogMetadata("zh-CN");

export default function ChineseChangelogPage() {
  return <ChangelogPage locale="zh-CN" />;
}
