import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("delivered message facts retranslate instead of disappearing on locale change", async () => {
  const page = await readFile("app/workbench-page.tsx", "utf8");

  assert.match(
    page,
    /type WorkbenchToastPresentation = \{\s*key: WorkbenchCopyKey;\s*variables\?: Record<string, string \| number>;\s*\};/,
  );
  assert.match(
    page,
    /const \[toast, setToast\] = useState<string \| WorkbenchToastPresentation>\(""\);/,
  );
  assert.match(
    page,
    /result\.delivery === "queued"\s*\? \{ key: "messageQueued" \}\s*:\s*steering\s*\? \{ key: "messageSteered", variables: \{ agent: agentName \} \}\s*:\s*\{ key: "messageDelivered" \}/,
    "message delivery status must remain a stable fact while its localized text is visible",
  );
  assert.match(page, /setToast\(\{ key: "messageSyncInterrupted" \}\)/);
  assert.doesNotMatch(
    page,
    /setToast\(\s*result\.delivery === "queued"[\s\S]*?workbenchText\(authLocale, "message(?:Queued|Steered|Delivered)"/,
  );
  assert.match(
    page,
    /setToast\(\(current\) =>\s*\(?\s*typeof current === "string" \? "" : current\s*\)?\s*\)/,
    "locale changes may clear unknown rendered errors but must preserve structured delivery facts",
  );
  assert.match(
    page,
    /typeof toast === "string"\s*\? toast\s*:\s*workbenchText\(authLocale, toast\.key, toast\.variables\)/,
  );
});
