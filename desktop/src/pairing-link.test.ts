import { describe, expect, it } from "vitest";

import { pairingConnectionUrl, pairingQrPayload } from "./pairing-link";

describe("pairingConnectionUrl", () => {
  it("只把随机配对编号放进二维码链接", () => {
    const url = new URL(
      pairingConnectionUrl(
        "https://relayune.giraffetree.cn/",
        "pair_1234/scan",
      ),
    );

    expect(url.origin).toBe("https://relayune.giraffetree.cn");
    expect(url.pathname).toBe("/");
    expect([...url.searchParams]).toEqual([["pair", "pair_1234/scan"]]);
    expect(url.hash).toBe("");
  });
});

describe("pairingQrPayload", () => {
  const pairingId = `pair_${"A".repeat(43)}`;

  it("uses a local camera envelope rather than a URL", () => {
    const payload = pairingQrPayload(pairingId, "abcd-2345");

    expect(payload).toBe(`relayune-pairing:v1:${pairingId}:ABCD2345`);
    expect(payload).not.toContain("://");
    expect(payload).not.toContain("?");
    expect(payload).not.toContain("code=");
  });

  it("rejects values outside the established PAKE identifiers", () => {
    expect(() => pairingQrPayload("pair_short", "ABCD-2345")).toThrow();
    expect(() => pairingQrPayload(pairingId, "ABCD-10IO")).toThrow();
  });
});
