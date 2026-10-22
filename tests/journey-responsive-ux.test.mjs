import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";

function declarationsFor(css, selector, media = null) {
  const declarations = {};
  postcss.parse(css).walkRules((rule) => {
    const selectors = rule.selectors?.map((value) => value.trim()) ?? [];
    if (!selectors.includes(selector)) return;
    const parentMedia =
      rule.parent?.type === "atrule" && rule.parent.name === "media"
        ? rule.parent.params
        : null;
    if (parentMedia !== media) return;
    for (const node of rule.nodes) {
      if (node.type === "decl") declarations[node.prop] = node.value;
    }
  });
  assert.ok(
    Object.keys(declarations).length,
    `missing ${selector}${media ? ` in ${media}` : ""}`,
  );
  return declarations;
}

test("[MOB-LAY-001][web] 320 and 390 workbench contracts prevent horizontal page overflow", async () => {
  const css = await readFile("app/workbench.css", "utf8");
  const compact = "(max-width: 820px)";
  const narrow = "(max-width: 520px)";

  assert.equal(declarationsFor(css, ".app-shell").overflow, "hidden");
  assert.equal(declarationsFor(css, ".workspace-grid", compact).display, "block");
  assert.equal(declarationsFor(css, ".conversation-title-row", narrow)["min-width"], "0");
  assert.equal(declarationsFor(css, ".composer-tools", narrow)["min-width"], "0");
  assert.equal(declarationsFor(css, ".composer-tools", narrow)["overflow-x"], "auto");
  assert.equal(declarationsFor(css, ".mobile-project-trigger", narrow).width, "44px");
});

test("mobile workspace keeps support links in the project drawer and preserves journey order", async () => {
  const [css, page] = await Promise.all([
    readFile("app/workbench.css", "utf8"),
    readFile("app/workbench-page.tsx", "utf8"),
  ]);
  const compact = "(max-width: 820px)";

  assert.equal(declarationsFor(css, ".topbar", compact).order, "1");
  assert.equal(declarationsFor(css, ".sync-error-banner", compact).order, "2");
  assert.equal(declarationsFor(css, ".workspace-grid", compact).order, "3");
  assert.equal(declarationsFor(css, ".mobile-nav", compact).order, "4");
  assert.doesNotMatch(page, /className="app-support-footer"/);
  assert.match(
    page,
    /<aside[\s\S]*?className="sidebar-support-footer"[\s\S]*?<\/aside>/,
    "support and legal links must stay inside the project sidebar",
  );
  const supportFooterStart = page.indexOf('className="sidebar-support-footer"');
  const supportFooterEnd = page.indexOf("</footer>", supportFooterStart);
  const supportFooter = page.slice(supportFooterStart, supportFooterEnd);
  assert.match(supportFooter, /href="mailto:giraffetree1@gmail\.com"/);
  assert.doesNotMatch(supportFooter, /pricing/);
  assert.match(supportFooter, /publicDocumentPath\(authLocale, "legal\/terms"\)/);
  assert.match(supportFooter, /publicDocumentPath\(authLocale, "legal\/privacy"\)/);
  assert.equal(
    declarationsFor(css, ".sidebar-support-footer a", compact)["min-height"],
    "44px",
  );
  assert.equal(
    declarationsFor(css, ".topbar-actions .avatar-button", compact).width,
    "44px",
  );
  assert.equal(
    declarationsFor(css, ".topbar-actions .avatar-button", compact).height,
    "44px",
  );
  assert.equal(
    declarationsFor(css, ".account-menu-sign-out", compact)["min-height"],
    "44px",
  );

  const narrow = "(max-width: 520px)";
  assert.equal(
    declarationsFor(css, ".agent-provider-rail button")["min-height"],
    "72px",
  );
  assert.equal(
    declarationsFor(css, ".login-page > .auth-language-switch", narrow).height,
    "44px",
  );
  assert.equal(
    declarationsFor(css, ".auth-email-summary button")["min-height"],
    "44px",
    "changing the account must remain a full touch target",
  );
  assert.equal(
    declarationsFor(css, ".login-secondary-action")["min-height"],
    "44px",
    "password recovery must remain a full touch target",
  );
  assert.equal(
    declarationsFor(css, ".sync-error-banner button", narrow)["min-height"],
    "44px",
    "mobile sync recovery must remain a full touch target",
  );
  assert.equal(
    declarationsFor(css, ".send-button", compact).width,
    "44px",
    "mobile message submission must remain a full touch target",
  );
  assert.equal(
    declarationsFor(css, ".history-toolbar button", compact)["min-height"],
    "44px",
    "mobile history recovery must remain a full touch target",
  );
  const minimumViewport = "(max-width: 360px)";
  const compactPairingCode = declarationsFor(
    css,
    ".pairing-code-field input",
    minimumViewport,
  );
  assert.equal(compactPairingCode["font-size"], "22px");
  assert.equal(compactPairingCode["letter-spacing"], "0.14em");
});

test("long localized copy and errors wrap instead of being clipped", async () => {
  const [web, desktop, marketing] = await Promise.all([
    readFile("app/workbench.css", "utf8"),
    readFile("desktop/src/styles.css", "utf8"),
    readFile("app/globals.css", "utf8"),
  ]);

  assert.equal(declarationsFor(web, ".trust-row")["flex-wrap"], "wrap");
  const webToast = declarationsFor(web, ".toast");
  assert.equal(webToast["white-space"], "normal");
  assert.equal(webToast["overflow-wrap"], "anywhere");
  assert.doesNotMatch(
    JSON.stringify(declarationsFor(web, ".toast", "(max-width: 520px)")),
    /ellipsis|overflow[^:]*hidden/,
  );

  assert.equal(declarationsFor(desktop, "body")["min-width"], "320px");
  assert.equal(declarationsFor(desktop, ".error-copy")["overflow-wrap"], "anywhere");
  assert.equal(declarationsFor(desktop, ".toast")["overflow-wrap"], "anywhere");
  assert.equal(declarationsFor(desktop, ".dialog-card footer")["flex-wrap"], "wrap");
  assert.equal(
    declarationsFor(desktop, ".status-actions", "(max-width: 480px)")["flex-wrap"],
    "wrap",
  );

  const mobileMarketing = "(max-width: 520px)";
  for (const selector of [
    ".compare-task-action strong",
    ".compare-task-action small",
  ]) {
    const declarations = declarationsFor(marketing, selector, mobileMarketing);
    assert.equal(declarations["white-space"], "normal");
    assert.equal(declarations["overflow-wrap"], "anywhere");
    assert.equal(declarations["text-overflow"], "clip");
  }
});

test("motion preferences and stacked pairing copy remain truthful", async () => {
  const [page, marketing, web, desktop, i18n] = await Promise.all([
    readFile("app/page.tsx", "utf8"),
    readFile("app/globals.css", "utf8"),
    readFile("app/workbench.css", "utf8"),
    readFile("desktop/src/styles.css", "utf8"),
    readFile("desktop/src/i18n.ts", "utf8"),
  ]);

  assert.match(page, /prefers-reduced-motion:\s*reduce/);
  assert.match(page, /reduceMotion \? "auto" : "smooth"/);
  assert.match(marketing, /\.marketing-skip-link\s*\{/);
  assert.match(
    marketing,
    /\.marketing-skip-link:focus-visible\s*\{[\s\S]*?transform:\s*translateY\(0\)/,
  );
  const skipLink = declarationsFor(marketing, ".marketing-skip-link");
  assert.equal(skipLink.position, "fixed");
  assert.equal(skipLink["min-height"], "44px");
  const reducedMotion = "(prefers-reduced-motion: reduce)";
  assert.equal(
    declarationsFor(marketing, ".marketing-motion-toggle", reducedMotion).display,
    "none",
  );
  assert.equal(
    declarationsFor(marketing, ".marketing-proof-marquee", reducedMotion).animation,
    "none",
  );
  assert.equal(
    declarationsFor(
      marketing,
      '.marketing-proof-group[aria-hidden="true"]',
      reducedMotion,
    ).display,
    "none",
  );
  assert.equal(
    declarationsFor(marketing, "*", reducedMotion)["animation-iteration-count"],
    "1",
  );
  assert.equal(
    declarationsFor(web, ".toast", reducedMotion).animation,
    "none",
  );
  assert.equal(
    declarationsFor(desktop, ".spinner", reducedMotion).animation,
    "none",
  );

  assert.match(i18n, /这里显示的 8 位码/);
  assert.match(i18n, /8-character code shown here/);
  assert.doesNotMatch(i18n, /旁边的 8 位码|beside the QR image/);
});

test("hero keeps the journey actions and 3D product preview in separate responsive grid areas", async () => {
  const marketing = await readFile("app/globals.css", "utf8");
  const hero = declarationsFor(marketing, ".marketing-hero");
  const stage = declarationsFor(marketing, ".product-stage");
  const copy = declarationsFor(marketing, ".hero-copy");

  assert.equal(hero.display, "grid");
  assert.match(hero["grid-template-columns"], /380px/);
  assert.equal(stage.position, "relative");
  assert.equal(copy["justify-self"], "end");
  assert.ok(Number.parseFloat(stage.height) >= 600);

  const compact = "(max-width: 820px)";
  assert.equal(
    declarationsFor(marketing, ".marketing-hero", compact)["grid-template-columns"],
    "minmax(0, 1fr)",
  );
  assert.equal(declarationsFor(marketing, ".hero-copy", compact)["text-align"], "center");
  assert.equal(declarationsFor(marketing, ".product-stage", compact)["justify-self"], "center");
});

test("mobile marketing preview and every connectivity proof remain fully visible", async () => {
  const marketing = await readFile("app/globals.css", "utf8");
  const mobile = "(max-width: 520px)";

  assert.equal(
    declarationsFor(marketing, ".product-stage", mobile).width,
    "100%",
  );
  assert.equal(
    declarationsFor(marketing, ".product-stage", mobile)["--hero-device-scale"],
    "0.46",
  );
  assert.equal(declarationsFor(marketing, ".hero-device-scene", mobile).top, "48%");
  assert.equal(declarationsFor(marketing, ".hero-actions", mobile)["flex-direction"], "column");

  const proofTrack = declarationsFor(marketing, ".marketing-proof-track", mobile);
  assert.equal(proofTrack.overflow, "visible");
  assert.equal(proofTrack["mask-image"], "none");
  const proofMarquee = declarationsFor(marketing, ".marketing-proof-marquee", mobile);
  assert.equal(proofMarquee.width, "100%");
  assert.equal(proofMarquee.animation, "none");
  const proofGroup = declarationsFor(marketing, ".marketing-proof-group", mobile);
  assert.equal(proofGroup["flex-wrap"], "wrap");
  assert.equal(proofGroup.width, "100%");
  assert.equal(
    declarationsFor(marketing, '.marketing-proof-group[aria-hidden="true"]', mobile).display,
    "none",
  );
  assert.equal(
    declarationsFor(marketing, ".marketing-proof-group li", mobile)["min-width"],
    "0",
  );
});

test("a 320×560 English hero keeps the first primary action fully visible", async () => {
  const marketing = await readFile("app/globals.css", "utf8");
  const shortViewport = "(max-width: 360px) and (max-height: 620px)";
  const hero = declarationsFor(marketing, ".marketing-hero", shortViewport);
  const kicker = declarationsFor(marketing, ".marketing-kicker", shortViewport);
  const title = declarationsFor(marketing, ".marketing-hero h1", shortViewport);
  const description = declarationsFor(marketing, ".hero-description", shortViewport);
  const actions = declarationsFor(marketing, ".hero-actions", shortViewport);

  assert.equal(hero["padding-top"], "92px");
  assert.equal(title["font-size"], "40px");
  assert.equal(description["font-size"], "13px");

  // Conservative line budget for the current longest English hero at 320px:
  // one kicker, five title lines and six description lines before a 48px CTA.
  const firstActionBottom =
    Number.parseFloat(hero["padding-top"]) +
    11 + 2 * 6 + Number.parseFloat(kicker["margin-bottom"]) +
    5 * Number.parseFloat(title["font-size"]) * Number.parseFloat(title["line-height"]) +
    Number.parseFloat(description["margin-top"]) +
    6 * Number.parseFloat(description["font-size"]) * Number.parseFloat(description["line-height"]) +
    Number.parseFloat(actions["margin-top"]) +
    48;
  assert.ok(
    firstActionBottom <= 560,
    `first primary action would end at about ${firstActionBottom}px`,
  );
});
