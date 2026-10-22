import { describe, expect, it } from "vitest";
import { isOfficialInstance, normalizedInstanceOrigin, instanceCopy } from "./instance-selection";

describe("instance selection security boundaries", () => {
  it("normalizes only service origins, never credentials or URL routing components", () => {
    expect(normalizedInstanceOrigin(" HTTPS://EXAMPLE.COM:443/ ")).toBe("https://example.com");
    expect(normalizedInstanceOrigin("http://127.0.0.1:3192")).toBe("http://127.0.0.1:3192");
    expect(normalizedInstanceOrigin("http://[::1]:3192")).toBe("http://[::1]:3192");
    for (const value of ["http://192.168.1.1", "http://100.64.1.1", "http://localhost.example", "https://u:p@example.com", "https://example.com/api", "https://example.com?token=x", "https://example.com/#token", "file:///etc/passwd"]) {
      expect(() => normalizedInstanceOrigin(value), value).toThrow();
    }
  });
  it("does not treat a subdomain or lookalike as the official update/service identity", () => {
    expect(isOfficialInstance("https://relayune.giraffetree.cn/")).toBe(true);
    expect(isOfficialInstance("https://relayune.giraffetree.cn.attacker.example")).toBe(false);
    expect(isOfficialInstance("https://relayune.giraffetree.cn:444")).toBe(false);
  });
  it("explains credential destruction, certificate trust, and separate official updates", () => {
    expect(instanceCopy("zh-CN").warning).toContain("重新登录和配对");
    expect(instanceCopy("en").addressHelp).toContain("fingerprint");
    expect(instanceCopy("fr").update).toContain("only checks for updates when you request it");
  });
});
