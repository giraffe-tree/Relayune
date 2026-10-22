import { describe, expect, it } from "vitest";

import { desktopDeviceName } from "./device-name";

describe("desktopDeviceName", () => {
  it("adds the native macOS major and minor version", () => {
    expect(
      desktopDeviceName(
        {
          os: "macos",
          arch: "aarch64",
          update_target: "macos-universal",
          os_version: "15.6",
        },
        "这台 Mac",
      ),
    ).toBe("这台 Mac · macOS 15.6");
  });

  it("keeps the existing fallback when native metadata is unavailable", () => {
    expect(
      desktopDeviceName(
        {
          os: "macos",
          arch: "aarch64",
          update_target: "macos-universal",
          os_version: null,
        },
        "Mac",
      ),
    ).toBe("Mac");
  });
});
