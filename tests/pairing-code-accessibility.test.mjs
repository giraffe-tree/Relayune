import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("autofocused pairing code fields announce where the code comes from", async () => {
  const page = await readFile("app/workbench-page.tsx", "utf8");

  const linkedPairingStart = page.indexOf("if (pairingId) {");
  const directPairingStart = page.indexOf(
    "if (needsE2eeKey && pendingBrowserDiscovery?.has_bound_computer)",
    linkedPairingStart,
  );
  const genericRecoveryStart = page.indexOf(
    "if (needsE2eeKey)",
    directPairingStart + 1,
  );
  assert.notEqual(linkedPairingStart, -1);
  assert.notEqual(directPairingStart, -1);
  assert.notEqual(genericRecoveryStart, -1);

  const linkedPairing = page.slice(linkedPairingStart, directPairingStart);
  assert.match(
    linkedPairing,
    /<p className="login-subtitle" id="pairing-code-help">\s*\{authText\(authLocale, "codeSubtitle"\)\}/,
  );
  assert.match(
    linkedPairing,
    /aria-describedby=\{\s*pairingCodeError\s*\? "pairing-code-help pairing-code-error"\s*: "pairing-code-help"\s*\}/,
    "the field must keep its source instruction when an error is added",
  );

  const directPairing = page.slice(directPairingStart, genericRecoveryStart);
  assert.match(
    directPairing,
    /<p className="login-subtitle" id="direct-pairing-code-help">\s*\{authText\(authLocale, "addBrowserCodeHelp"\)\}/,
  );
  assert.match(
    directPairing,
    /aria-describedby=\{\s*pairingCodeError\s*\? "direct-pairing-code-help pairing-code-error"\s*: "direct-pairing-code-help"\s*\}/,
  );

  for (const copyKey of ["codeSubtitle", "addBrowserCodeHelp"]) {
    assert.match(
      page,
      new RegExp(`authText\\(authLocale, "${copyKey}"\\)`),
      `${copyKey} must remain dynamically bilingual`,
    );
  }
});
