import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("web user messages keep precise time and delivery state inside the bubble", async () => {
  const [source, styles] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/workbench.css", "utf8"),
  ]);
  const formatterStart = source.indexOf("function formatMessageTimestamp");
  const formatterEnd = source.indexOf("\n}\n\nfunction formatElapsed", formatterStart);
  const formatter = source.slice(formatterStart, formatterEnd + 2);

  assert.notEqual(formatterStart, -1);
  assert.notEqual(formatterEnd, -1);
  assert.match(formatter, /daysAgo <= 2/);
  assert.match(formatter, /Intl\.RelativeTimeFormat/);
  assert.match(formatter, /month: "short"[\s\S]*?day: "numeric"/);
  assert.match(formatter, /second: "2-digit"/);
  assert.match(
    source,
    /message\.role === "user" && !reminderOnly[\s\S]*?className="message-delivery-indicator"/,
  );
  assert.match(
    styles,
    /\.message\.user \.message-body\s*{[\s\S]*?position: relative;[\s\S]*?background: #292929;[\s\S]*?}/,
  );
  assert.match(
    styles,
    /\.message-delivery-indicator\s*{[\s\S]*?position: absolute;[\s\S]*?right: 10px;[\s\S]*?bottom: 8px;[\s\S]*?}/,
  );
});
