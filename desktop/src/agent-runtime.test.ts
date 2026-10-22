import { describe, expect, it } from "vitest";
import { agentRuntimeAction, agentRuntimeTone } from "./agent-runtime";

describe("Agent runtime recovery presentation", () => {
  it.each(["not_installed", "outdated", "broken"] as const)(
    "offers one-click installation for %s",
    (status) => {
      expect(agentRuntimeAction(status)).toBe("install");
      expect(agentRuntimeTone(status)).toBe("danger");
    },
  );

  it("offers sign-in when the CLI is installed but has no account", () => {
    expect(agentRuntimeAction("not_logged_in")).toBe("login");
    expect(agentRuntimeTone("not_logged_in")).toBe("warning");
  });

  it("does not offer a repair action for a ready CLI", () => {
    expect(agentRuntimeAction("ready")).toBeNull();
    expect(agentRuntimeTone("ready")).toBe("ready");
  });
});
