import assert from "node:assert/strict";
import test from "node:test";
import {
  comparisonSplitForKey,
  detectMarketingPlatform,
} from "../app/marketing-platform.mjs";

test("官网主动作按真实访问设备分流", () => {
  assert.equal(
    detectMarketingPlatform(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    ),
    "mac",
  );
  assert.equal(
    detectMarketingPlatform(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    ),
    "windows",
  );
  assert.equal(
    detectMarketingPlatform(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile",
      5,
    ),
    "mobile",
  );
  assert.equal(
    detectMarketingPlatform(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
      5,
    ),
    "mobile",
  );
  assert.equal(
    detectMarketingPlatform("Mozilla/5.0 (Linux; Android 15) Mobile"),
    "android",
  );
  assert.equal(
    detectMarketingPlatform("Mozilla/5.0 (X11; Linux x86_64)"),
    "other",
  );
});

test("官网对比滑杆支持方向键、Home、End 与 Page 键", () => {
  assert.equal(comparisonSplitForKey(50, "ArrowRight"), 51);
  assert.equal(comparisonSplitForKey(50, "ArrowUp"), 51);
  assert.equal(comparisonSplitForKey(50, "ArrowLeft"), 49);
  assert.equal(comparisonSplitForKey(50, "ArrowDown"), 49);
  assert.equal(comparisonSplitForKey(50, "Home"), 12);
  assert.equal(comparisonSplitForKey(50, "End"), 88);
  assert.equal(comparisonSplitForKey(84, "PageUp"), 88);
  assert.equal(comparisonSplitForKey(16, "PageDown"), 12);
  assert.equal(comparisonSplitForKey(50, "Enter"), null);
});
