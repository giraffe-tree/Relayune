import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CONVERSATION_BOTTOM_TOLERANCE_PX,
  conversationDistanceFromBottom,
  isConversationNearBottom,
} from "../app/conversation-auto-scroll.mjs";

test("运行中会话仅在用户停留底部时持续跟随新内容", () => {
  const atBottom = { scrollHeight: 1_200, scrollTop: 600, clientHeight: 600 };
  const nearBottom = {
    scrollHeight: 1_200,
    scrollTop: 600 - CONVERSATION_BOTTOM_TOLERANCE_PX,
    clientHeight: 600,
  };
  const readingHistory = {
    scrollHeight: 1_200,
    scrollTop: 600 - CONVERSATION_BOTTOM_TOLERANCE_PX - 1,
    clientHeight: 600,
  };

  assert.equal(conversationDistanceFromBottom(atBottom), 0);
  assert.equal(isConversationNearBottom(atBottom), true);
  assert.equal(isConversationNearBottom(nearBottom), true);
  assert.equal(isConversationNearBottom(readingHistory), false);
});

test("工作台监听流式文字和内容尺寸变化，并在用户上滚时暂停跟随", async () => {
  const page = await readFile("app/workbench-page.tsx", "utf8");

  assert.match(page, /const messageScrollFollowsLatest = useRef\(true\)/);
  assert.match(
    page,
    /new MutationObserver[\s\S]{0,700}characterData: true,[\s\S]{0,100}childList: true,[\s\S]{0,100}subtree: true/,
  );
  assert.match(page, /new ResizeObserver\(scrollToLatest\)/);
  assert.match(
    page,
    /onScroll=\{\(event\) => \{[\s\S]{0,180}isConversationNearBottom\([\s\S]{0,80}event\.currentTarget/,
  );
  assert.match(
    page,
    /if \(!messageScrollFollowsLatest\.current\) return;[\s\S]{0,180}scrollElement\.scrollTo\(\{[\s\S]{0,100}top: scrollElement\.scrollHeight/,
  );
});
