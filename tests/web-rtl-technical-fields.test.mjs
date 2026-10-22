import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Web workbench isolates security-sensitive technical fields from RTL text", async () => {
  const [page, markdown, css] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/message-markdown.tsx", "utf8"),
    readFile("app/workbench.css", "utf8"),
  ]);

  assert.match(
    page,
    /function TechnicalValue[\s\S]*?<bdi className="technical-ltr" dir="ltr">/,
  );
  assert.match(
    page,
    /title=\{isolateTechnicalText\(approval\.action\.cwd\)\}[\s\S]{0,120}<TechnicalValue>\{approval\.action\.cwd\}<\/TechnicalValue>/,
  );
  assert.match(
    page,
    /<code className="technical-ltr" dir="ltr">\{approval\.action\.display\}<\/code>/,
  );
  assert.match(
    page,
    /copyKey="commandDigest"[\s\S]{0,120}value=\{approval\.action\.command_hash\}/,
  );
  assert.match(page, /type="email"\s+dir="ltr"/);
  assert.match(page, /<TechnicalValue>\{email\}<\/TechnicalValue>/);
  assert.match(page, /<TechnicalValue>\{current\.cwd\}<\/TechnicalValue>/);
  assert.match(page, /<TechnicalValue>\{current\.branch\}<\/TechnicalValue>/);
  assert.match(page, /function isolateTechnicalText\(value: string\)[\s\S]{0,80}\\u2066\$\{value\}\\u2069/);
  assert.match(
    page,
    /copyKey=\{labelKey\}[\s\S]{0,120}value=\{activity\.label\}/,
  );

  assert.match(markdown, /<code[\s\S]{0,180}className=\{`technical-ltr\$\{className[\s\S]{0,100}dir="ltr"/);
  assert.match(markdown, /<pre[\s\S]{0,180}className=\{`technical-ltr\$\{className[\s\S]{0,100}dir="ltr"/);
  assert.match(markdown, /className=\{technicalLink \? "technical-ltr" : undefined\}/);
  assert.match(markdown, /dir=\{technicalLink \? "ltr" : undefined\}/);
  assert.match(
    css,
    /\.technical-ltr,[\s\S]{0,80}input\[dir="ltr"\][\s\S]{0,100}direction: ltr;[\s\S]{0,100}unicode-bidi: isolate;/,
  );

  assert.doesNotMatch(page, /<dd title=\{approval\.action\.cwd\}>\{approval\.action\.cwd\}<\/dd>/);
  assert.doesNotMatch(page, /<code>\{approval\.action\.display\}<\/code>/);
});
