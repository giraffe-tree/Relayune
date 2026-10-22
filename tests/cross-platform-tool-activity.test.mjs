import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Web and Flutter share the Codex-style compact tool lifecycle", async () => {
  const [web, css, mobileController, mobileUi, claude] = await Promise.all([
    readFile("app/workbench-page.tsx", "utf8"),
    readFile("app/workbench.css", "utf8"),
    readFile("mobile/lib/src/state/app_controller.dart", "utf8"),
    readFile("mobile/lib/src/ui/workbench_screen.dart", "utf8"),
    readFile("relay/claude-adapter.mjs", "utf8"),
  ]);

  assert.match(web, /if \(isToolActivityEvent\(event\)\)/);
  assert.match(web, /function upsertToolActivityMessage/);
  assert.match(web, /className={`tool-activity-message \$\{activity\.status\}`}/);
  assert.match(web, /function CompactToolActivityGroup/);
  assert.match(web, /\["command", "file_read", "file_change"\]/);
  assert.match(css, /\.tool-activity-output pre/);
  assert.match(css, /\.tool-activity-group > summary/);
  assert.match(css, /\.turn-running-status/);

  assert.match(
    mobileController,
    /'command\.started',[\s\S]{0,100}'command\.output',[\s\S]{0,100}'command\.completed'/,
  );
  assert.match(
    mobileController,
    /final id = 'command_\$\{turnId\}_\$\{event\['item_id'\] \?\? 'legacy'\}'/,
  );
  assert.match(mobileUi, /class _ToolActivityMessage/);
  assert.match(mobileUi, /class _CompactToolActivityGroup/);
  assert.match(mobileUi, /'file_read',[\s\S]{0,80}'file_change'/);
  assert.match(mobileUi, /class _AssistantActivityBubble extends StatefulWidget/);
  const activityBubble = mobileUi.slice(
    mobileUi.indexOf("class _AssistantActivityBubbleState"),
    mobileUi.indexOf("class _MessageSegment"),
  );
  assert.match(activityBubble, /DateTime\.now\(\)\.difference\(widget\.startedAt\)\.inSeconds/);
  assert.match(activityBubble, /copy\.controllerThinking/);
  assert.match(activityBubble, /copy\.workbenchDurationSeconds\(math\.max\(0, seconds\)\)/);
  assert.match(activityBubble, /ForegroundPeriodicTimer\(const Duration\(seconds: 1\)/);
  assert.match(activityBubble, /void dispose\(\)[\s\S]*?_timer\?\.cancel\(\)/);

  assert.match(
    claude,
    /kind: "command\.output",[\s\S]{0,320}status: failed \? "failed" : "completed"/,
  );
  assert.doesNotMatch(claude, /kind: "command\.completed"/);
});
