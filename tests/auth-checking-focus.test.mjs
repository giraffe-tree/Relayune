import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("entering authentication checking preserves keyboard and screen-reader context", async () => {
  const page = await readFile("app/workbench-page.tsx", "utf8");

  assert.match(
    page,
    /const checkingAuthTitleRef = useRef<HTMLHeadingElement \| null>\(null\);/,
  );
  assert.match(
    page,
    /if \(!checkingAuth \|\| !authenticationEntryRequested\) return;[\s\S]*?requestAnimationFrame\(\(\) => \{\s*checkingAuthTitleRef\.current\?\.focus\(\);[\s\S]*?\}, \[authenticationEntryRequested, checkingAuth\]\);/,
    "replacing a focused CTA or retry button must focus the checking-state heading",
  );
  assert.match(
    page,
    /<h1 ref=\{checkingAuthTitleRef\} tabIndex=\{-1\}>\s*\{authText\(authLocale, "checkingTitle"\)\}\s*<\/h1>/,
  );

  const focusEffectStart = page.indexOf(
    "if (!checkingAuth || !authenticationEntryRequested) return;",
  );
  const focusEffectEnd = page.indexOf(
    "}, [authenticationEntryRequested, checkingAuth]);",
    focusEffectStart,
  );
  assert.notEqual(focusEffectStart, -1);
  assert.notEqual(focusEffectEnd, -1);
  assert.doesNotMatch(
    page.slice(focusEffectStart, focusEffectEnd),
    /authLocale|refresh\(|api</,
    "language changes must not refocus the loading heading or replay authentication",
  );
});
