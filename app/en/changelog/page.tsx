import ChangelogPage from "../../changelog/changelog-page";
import { changelogMetadata } from "../../changelog/changelog-metadata";

export const metadata = changelogMetadata("en");

export default function EnglishChangelogPage() {
  return <ChangelogPage locale="en" />;
}
