import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [webPage, webStyles, mobilePage, mobileProgress, mobileVisual] = await Promise.all([
  readFile(new URL("../app/workbench-page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/workbench.css", import.meta.url), "utf8"),
  readFile(
    new URL("../mobile/lib/src/ui/workbench_screen.dart", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../mobile/lib/src/ui/history_loading_progress.dart", import.meta.url), "utf8"),
  readFile(new URL("../mobile/lib/src/widgets/history_text_light.dart", import.meta.url), "utf8"),
]);

test("history loading uses the branded adaptive animation on web", () => {
  assert.match(webPage, /data-history-loading-visual/);
  assert.match(webPage, /className="history-loading-orbit"/);
  assert.match(webPage, /className="history-loading-rail"/);
  assert.match(webPage, /className="history-loading-dots"/);
  assert.match(webStyles, /@keyframes history-orbit/);
  assert.match(webStyles, /@keyframes history-rail-sweep/);
  assert.match(
    webStyles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.history-loading-orbit,[\s\S]*?animation: none !important/,
  );
});

// Actual first-page/older-page dimensions are exercised by Flutter's
// history_loading_animation_test.dart. Check the cross-file wiring here without
// binding this Node contract to Dart formatting or a removed private widget.
test("mobile connects observed history progress to its accessible adaptive visual", () => {
  assert.match(
    mobilePage,
    /HistoryLoadingProgress\([\s\S]*?progress: controller\.historyProgressFor\(session\.id\),[\s\S]*?compact: !firstPage,/,
  );
  assert.match(mobileProgress, /HistoryTextLight\([\s\S]*?compact: widget\.compact,[\s\S]*?phase: progress\?\.phase,/);
  assert.match(mobileProgress, /liveRegion: true/);
  assert.match(
    mobileVisual,
    /MediaQuery\.maybeOf\(context\)\?\.disableAnimations \?\? false/,
  );
});
