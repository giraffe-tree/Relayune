import { describe, expect, it } from "vitest";
import {
  createPairingInitiator,
  finishPairingInitiator,
  respondToPairing,
  verifyDesktopConfirmation,
} from "../../shared/pairing-pake";
import {
  createSpake2P256Share,
  finishSpake2P256,
} from "../../shared/spake2-p256";

describe("短码 PAKE", () => {
  it("逐字节匹配 RFC 9382 P256-SHA256-HKDF-HMAC 测试向量", async () => {
    const w = fromHex(
      "2ee57912099d31560b3a44b1184b9b4866e904c49d12ac5042c97dca461b1a5f",
    );
    const scalarA = fromHex(
      "43dd0fd7215bdcb482879fca3220c6a968e66d70b1356cac18bb26c84a78d729",
    );
    const scalarB = fromHex(
      "dcb60106f276b02606d8ef0a328c02e4b629f84f89786af5befb0bc75b6e66be",
    );
    const shareA = await createSpake2P256Share("A", w, scalarA);
    const shareB = await createSpake2P256Share("B", w, scalarB);
    const output = await finishSpake2P256({
      role: "A",
      passwordScalar: w,
      ephemeralScalar: scalarA,
      ownShare: shareA,
      peerShare: shareB,
      identityA: new TextEncoder().encode("server"),
      identityB: new TextEncoder().encode("client"),
    });

    expect(toHex(shareA)).toBe(
      "04a56fa807caaa53a4d28dbb9853b9815c61a411118a6fe516a8798434751470" +
        "f9010153ac33d0d5f2047ffdb1a3e42c9b4e6be662766e1eeb4116988ede5f912c",
    );
    expect(toHex(shareB)).toBe(
      "0406557e482bd03097ad0cbaa5df82115460d951e3451962f1eaf4367a420676" +
        "d09857ccbc522686c83d1852abfa8ed6e4a1155cf8f1543ceca528afb591a1e0b7",
    );
    expect(toHex(output.sessionKey)).toBe(
      "0e0672dc86f8e45565d338b0540abe69",
    );
    expect(toHex(output.ownConfirmation)).toBe(
      "58ad4aa88e0b60d5061eb6b5dd93e80d9c4f00d127c65b3b35b1b5281fee38f0",
    );
    expect(toHex(output.expectedPeerConfirmation)).toBe(
      "d3e2e547f1ae04f2dbdbf0fc4b79f8ecff2dff314b5d32fe9fcef2fb26dc459b",
    );
  });

  it("让浏览器与 Mac 独立得到同一内容密钥并双向确认", async () => {
    const desktop = await createPairingInitiator();
    const browser = await respondToPairing(
      desktop.pairingId,
      desktop.code,
      desktop.initiatorShare,
    );
    const completed = await finishPairingInitiator(
      desktop,
      browser.responderShare,
      browser.responderConfirm,
    );

    expect(completed.contentKey).toBe(browser.contentKey);
    expect(completed.contentKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(() =>
      verifyDesktopConfirmation(
        browser.expectedDesktopConfirm,
        completed.desktopConfirm,
      ),
    ).not.toThrow();
  });
});

function fromHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

function toHex(value: Uint8Array): string {
  return [...value]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
