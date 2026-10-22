import { describe, expect, it } from "vitest";
import { DesktopCommandError, desktopErrorCode } from "./api";

describe("desktop native error boundary", () => {
  it("parses stable native markers without exposing diagnostic text", () => {
    expect(desktopErrorCode("relayune:browser_pairing_required"))
      .toBe("browser_pairing_required");
    expect(desktopErrorCode("relayune:server_https_required"))
      .toBe("server_https_required");
    expect(desktopErrorCode(new Error("relayune:relay_unauthorized")))
      .toBe("relay_unauthorized");
    expect(desktopErrorCode(new Error("relayune:agent_install_failed")))
      .toBe("agent_install_failed");
  });

  it("uses the command fallback for raw platform and sidecar failures", () => {
    expect(desktopErrorCode("无法访问 /private/path", "workspace_picker_failed"))
      .toBe("workspace_picker_failed");
    expect(desktopErrorCode("CreateProcess failed", "relay_start_failed"))
      .toBe("relay_start_failed");
  });

  it("preserves already classified command errors", () => {
    expect(desktopErrorCode(new DesktopCommandError("sign_out_failed")))
      .toBe("sign_out_failed");
  });
});
