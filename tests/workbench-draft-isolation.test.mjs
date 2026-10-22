import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workbench drafts remain attached to the session that created them", async () => {
  const page = await readFile("app/workbench-page.tsx", "utf8");

  assert.match(
    page,
    /const \[draftMap, setDraftMap\] = useState<Record<string, string>>\(\{\}\);/,
  );
  assert.match(
    page,
    /const draft = activeSession \?\s*\(?draftMap\[activeSession\] \?\? ""\)?\s*: "";/,
    "switching sessions must reveal only the selected session's draft",
  );
  assert.match(
    page,
    /const setDraft = useCallback\([\s\S]{0,180}const sessionId = activeSession;[\s\S]{0,380}previous\[sessionId\][\s\S]{0,420}\[sessionId\]: next[\s\S]{0,100}\[activeSession\]/,
    "each render must bind draft updates to that render's active session",
  );
  assert.match(
    page,
    /async function sendMessage[\s\S]{0,1200}setDraft\(""\)[\s\S]{0,2400}catch \(error\) \{[\s\S]{0,100}setDraft\(\(nextDraft\) => restoreFailedComposerDraft\(submittedDraft, nextDraft\)\)/,
    "send success and failure must clear or restore the captured session only",
  );
  assert.doesNotMatch(
    page,
    /const \[draft, setDraft\] = useState\(""\)/,
    "a global draft would leak text across projects or Agent providers",
  );
});
