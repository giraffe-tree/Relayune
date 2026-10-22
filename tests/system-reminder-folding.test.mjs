import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

async function importSegmentParser() {
  const temporary = await mkdtemp(join(tmpdir(), "relayune-system-reminder-"));
  const outfile = join(temporary, "system-reminder-segments.mjs");
  await build({
    entryPoints: ["app/system-reminder-segments.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  return {
    parser: await import(`${pathToFileURL(outfile).href}?${Date.now()}`),
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}

test("system reminder parser preserves normal content around multiline and repeated tags", async () => {
  const bundled = await importSegmentParser();
  try {
    const { splitSystemReminderSegments } = bundled.parser;
    assert.deepEqual(
      splitSystemReminderSegments(
        "Before\n\n<system-reminder>first line\nsecond line</system-reminder>\nBetween\n<system-reminder>second</system-reminder>\nAfter",
      ),
      [
        { kind: "content", content: "Before\n\n" },
        {
          kind: "system-reminder",
          content: "first line\nsecond line",
        },
        { kind: "content", content: "\nBetween\n" },
        { kind: "system-reminder", content: "second" },
        { kind: "content", content: "\nAfter" },
      ],
    );
  } finally {
    await bundled.cleanup();
  }
});

test("notification elements with metadata are folded as system reminders", async () => {
  const bundled = await importSegmentParser();
  try {
    const { isSystemReminderOnlyContent, splitSystemReminderSegments } =
      bundled.parser;
    const notification =
      '<notification id="task:bash-x53qzu8n:lost" category="task" type="task.lost" source_kind="background_task">Title: Background process lost\n<output-file path="/tmp/output.log" bytes="149">Read the output file.</output-file></notification>';

    assert.deepEqual(splitSystemReminderSegments(notification), [
      {
        kind: "system-reminder",
        content:
          'Title: Background process lost\n<output-file path="/tmp/output.log" bytes="149">Read the output file.</output-file>',
      },
    ]);
    assert.equal(isSystemReminderOnlyContent(notification), true);
    assert.equal(
      isSystemReminderOnlyContent(`Visible message\n${notification}`),
      false,
    );
  } finally {
    await bundled.cleanup();
  }
});

test("only complete system reminder pairs are folded", async () => {
  const bundled = await importSegmentParser();
  try {
    const { splitSystemReminderSegments } = bundled.parser;
    for (const content of [
      "ordinary message",
      "keep <system-reminder>an unfinished reminder visible",
      "keep a stray </system-reminder> visible",
      'keep <notification type="task.lost">an unfinished notification visible',
      "keep a stray </notification> visible",
    ]) {
      assert.deepEqual(splitSystemReminderSegments(content), [
        { kind: "content", content },
      ]);
    }
  } finally {
    await bundled.cleanup();
  }
});

test("system reminders use native default-closed disclosure in both lazy states", async () => {
  const [component, markdown, page, styles, language] = await Promise.all([
    readFile("app/system-reminder-content.tsx", "utf8"),
    readFile("app/message-markdown.tsx", "utf8"),
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/workbench.css", "utf8"),
    readFile("app/workbench-language.ts", "utf8"),
  ]);

  assert.match(component, /<details className="system-reminder"/);
  assert.doesNotMatch(component, /<details[^>]+\bopen(?:=|\s|>)/);
  assert.match(component, /<summary>/);
  assert.match(component, /aria-hidden="true"/);
  assert.match(component, /workbenchText\(locale, "systemReminder"\)/);
  assert.match(component, /workbenchText\(locale, "expandSystemReminder"\)/);
  assert.match(component, /workbenchText\(locale, "collapseSystemReminder"\)/);

  assert.match(markdown, /<SystemReminderContent/);
  assert.match(page, /fallback=\{[\s\S]*?<SystemReminderContent/);
  assert.match(page, /<MessageMarkdown locale=\{locale\}>/);
  assert.match(language, /systemReminder: "System reminder"/);
  assert.match(language, /systemReminder: "系统提醒"/);

  assert.match(styles, /\.system-reminder summary:focus-visible/);
  assert.match(
    styles,
    /@media \(max-width: 820px\)[\s\S]*?\.system-reminder summary \{[\s\S]*?min-height: 22px;/,
  );
  assert.match(styles, /\.message-reminder-only \.message-meta/);
  assert.match(styles, /\.message-reminder-only:not\(\.user\)/);
  assert.match(styles, /\.message\.user\.message-reminder-only \.message-markdown/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /@media \(forced-colors: active\)/);
});
