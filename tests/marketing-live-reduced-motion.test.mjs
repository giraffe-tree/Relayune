import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("marketing pointer motion follows a reduced-motion change without reloading", async () => {
  const source = await readFile("app/marketing-home.tsx", "utf8");
  const effectStart = source.indexOf("const reducedMotion = window.matchMedia");
  const effectEnd = source.indexOf("}, [locale]);", effectStart);
  assert.notEqual(effectStart, -1);
  assert.notEqual(effectEnd, -1);
  const motionEffect = source.slice(effectStart, effectEnd);

  assert.match(
    motionEffect,
    /const activateStage = \(\) => \{\s*if \(reducedMotion\.matches \|\| marketingUserMotionPausedRef\.current\) return;/,
  );
  assert.match(
    motionEffect,
    /const moveStage = \(event: PointerEvent\)[\s\S]*?event\.pointerType === "touch" \|\|\s*reducedMotion\.matches \|\|/,
  );
  assert.match(
    motionEffect,
    /const moveCardSpotlight = \(event: PointerEvent\)[\s\S]*?event\.pointerType === "touch" \|\|\s*reducedMotion\.matches \|\|/,
  );
  assert.match(
    motionEffect,
    /const resetPointerMotionForReducedMotion = \(event: MediaQueryListEvent\)[\s\S]*?if \(!event\.matches\) return;[\s\S]*?resetStage\(\);[\s\S]*?pendingSpotlightPoint = null;[\s\S]*?cancelAnimationFrame\(spotlightFrame\);[\s\S]*?removeProperty\("--card-spot-x"\)[\s\S]*?removeProperty\("--card-spot-y"\)/,
  );
  assert.match(
    motionEffect,
    /reducedMotion\.addEventListener\("change", resetPointerMotionForReducedMotion\)/,
  );
  assert.match(
    motionEffect,
    /reducedMotion\.removeEventListener\(\s*"change",\s*resetPointerMotionForReducedMotion,?\s*\)/,
  );
  assert.match(
    motionEffect,
    /if \(precisePointer\.matches\) \{[\s\S]*?addEventListener\("pointermove", moveStage/,
    "pointer handlers may stay installed because every pointer update checks the live preference",
  );
});
