import { describe, expect, it } from "vitest";
import {
  startupDiagnosticPresentation,
  startupMessageKeyForRender,
} from "./startup-diagnostics";
import type { RelaySnapshot } from "./types";

describe("startup diagnostics localization", () => {
  it("keeps a slow bootstrap distinct from a real startup failure while language changes", () => {
    expect(startupMessageKeyForRender(null, "preparing")).toBe("preparing");
    expect(startupMessageKeyForRender(null, "stillPreparing")).toBe(
      "stillPreparing",
    );
    expect(
      startupMessageKeyForRender("credential_access_failed", "stillPreparing"),
    ).toBe("startupFailed");
  });

  it("re-renders a stable error code and the latest Relay snapshot in the active language", () => {
    const relay: RelaySnapshot = {
      phase: "error",
      pid: null,
      started_at: null,
      last_error: "relayune:relay_start_failed",
      logs: [{
        at: "2026-08-09T08:08:00.000Z",
        level: "error",
        message: "relayune:diagnostic_hidden",
      }],
    };

    const chinese = startupDiagnosticPresentation(
      "zh-CN",
      "credential_access_failed",
      relay,
    );
    const english = startupDiagnosticPresentation(
      "en",
      "credential_access_failed",
      relay,
    );

    expect(chinese.summary).not.toBe(english.summary);
    expect(chinese.log).not.toBe(english.log);
    expect(english.summary).not.toMatch(/[\u3400-\u9fff]/u);
    expect(english.log).not.toMatch(/[\u3400-\u9fff]/u);
    expect(JSON.stringify({ chinese, english })).not.toContain("Error:");
  });

  it("localizes every native lifecycle code and hides unstructured details", () => {
    const codes = [
      "relayune:relay_starting",
      "relayune:relay_started",
      "relayune:relay_connected",
      "relayune:relay_sync_degraded",
      "relayune:relay_sync_recovered",
      "relayune:relay_stopping",
      "relayune:relay_stopped",
      "relayune:browser_authorizations_cleaned",
    ];
    const snapshot = (message: string): RelaySnapshot => ({
      phase: "connected",
      pid: null,
      started_at: null,
      last_error: null,
      logs: [{
        at: "2026-08-09T08:08:00.000Z",
        level: "info",
        message,
      }],
    });

    for (const code of codes) {
      const chinese = startupDiagnosticPresentation(
        "zh-CN",
        "startup_failed",
        snapshot(code),
      ).log;
      const english = startupDiagnosticPresentation(
        "en",
        "startup_failed",
        snapshot(code),
      ).log;
      expect(chinese).not.toBe(english);
      expect(english).not.toMatch(/[\u3400-\u9fff]/u);
      expect(english).not.toContain(code);
    }

    for (const raw of [
      "/Users/example/private/workspace",
      "stderr: process failed near C:\\Users\\Example",
      "原始本机错误",
    ]) {
      expect(
        startupDiagnosticPresentation(
          "en",
          "startup_failed",
          snapshot(raw),
        ).log,
      ).toContain("A local diagnostic event was recorded");
      expect(
        startupDiagnosticPresentation(
          "zh-CN",
          "startup_failed",
          snapshot(raw),
        ).log,
      ).toContain("已记录本机诊断事件");
    }
  });
});
