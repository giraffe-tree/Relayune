import { describe, expect, it } from "vitest";

import {
  onlineBrowserIds,
  browserAuthorizationActionsDisabled,
  browserAuthorizationCount,
  browserPairingCopy,
  browserPairingHandoffActionsEnabled,
  browserRevokeActionLabel,
} from "./browser-access";

describe("客户端授权界面", () => {
  it("读取列表时不把未知数量显示成零授权", () => {
    expect(browserAuthorizationCount(0, true)).toBe("正在读取…");
    expect(browserAuthorizationCount(0, false)).toBe("0 个授权");
    expect(browserAuthorizationCount(2, false)).toBe("2 个授权");
  });

  it("locks every authorization action while pairing and names revoke controls", () => {
    expect(browserAuthorizationActionsDisabled("idle")).toBe(false);
    for (const stage of [
      "starting",
      "waiting",
      "recovering",
      "finishing",
    ] as const) {
      expect(browserAuthorizationActionsDisabled(stage)).toBe(true);
    }
    expect(browserRevokeActionLabel("Safari")).toBe("撤销 Safari 的授权");
    expect(browserRevokeActionLabel("Edge", "en")).toBe(
      "Revoke access for Edge",
    );
  });

  it("清楚区分新增授权的准备、等待和保存阶段", () => {
    expect(browserPairingCopy("starting", false)).toEqual({
      button: "正在连接…",
      status: "正在创建仅可使用一次的安全连接…",
      step: "准备中",
    });
    expect(browserPairingCopy("waiting", true)).toEqual({
      button: "等待确认…",
      status: "在要连接的客户端打开 Relayune，再输入下方 8 位码。现有客户端不会断开。",
      step: "等待客户端",
    });
    expect(browserPairingCopy("finishing", true)).toEqual({
      button: "正在连接…",
      status: "客户端已确认，正在保存独立授权…",
      step: "即将完成",
    });
    expect(browserPairingCopy("recovering", true)).toEqual({
      button: "等待网络恢复…",
      status: "网络连接中断，连接码仍然有效。Relayune 会自动继续。",
      step: "等待网络",
    });
    expect(browserPairingCopy("recovering", false)).toEqual({
      button: "等待网络恢复…",
      status: "网络连接中断，恢复后会自动生成连接码，无需重新点击。",
      step: "等待网络",
    });
  });

  it("只在一次性连接仍可交给浏览器时允许打开或复制", () => {
    expect(browserPairingHandoffActionsEnabled("waiting", true)).toBe(true);
    expect(browserPairingHandoffActionsEnabled("recovering", true)).toBe(true);
    expect(browserPairingHandoffActionsEnabled("waiting", false)).toBe(false);
    expect(browserPairingHandoffActionsEnabled("starting", true)).toBe(false);
    expect(browserPairingHandoffActionsEnabled("finishing", true)).toBe(false);
    expect(browserPairingHandoffActionsEnabled("idle", true)).toBe(false);
  });

  it("provides complete English progress and authorization count copy", () => {
    expect(browserPairingCopy("waiting", true, "en")).toEqual({
      button: "Waiting for confirmation…",
      status:
        "Open Relayune on the client you want to connect, then enter the 8-character code below. Existing clients stay connected.",
      step: "Waiting for client",
    });
    expect(browserAuthorizationCount(3, false, "en")).toBe("3 authorized");
    expect(browserPairingCopy("recovering", true, "en")).toEqual({
      button: "Waiting for connection…",
      status:
        "The network connection was interrupted. Your code is still valid, and Relayune will continue automatically.",
      step: "Waiting for network",
    });
    expect(browserPairingCopy("recovering", false, "en")).toEqual({
      button: "Waiting for connection…",
      status:
        "The network connection was interrupted. Relayune will create the code automatically when it recovers.",
      step: "Waiting for network",
    });
  });
});

describe("live client presence", () => {
  const relay = { phase: "connected" as const, pid: 1, started_at: null, last_error: null, logs: [],
    online_browser_ids: ["phone"], browser_presence_observed_at: 10_000 };
  it("requires a fresh live observation and expires without further events", () => {
    expect(onlineBrowserIds(relay, 15_999)).toEqual(["phone"]);
    expect(onlineBrowserIds(relay, 16_000)).toEqual([]);
    expect(onlineBrowserIds(relay, 9_999)).toEqual([]);
    expect(onlineBrowserIds({ ...relay, browser_presence_observed_at: null }, 10_000)).toEqual([]);
    for (const phase of ["starting", "stopped", "stopping", "error"] as const) {
      expect(onlineBrowserIds({ ...relay, phase }, 10_000)).toEqual([]);
    }
    expect(onlineBrowserIds(undefined)).toEqual([]);
  });
});
