import { describe, expect, it, vi } from "vitest";
import { TransientStatusController } from "./transient-status";

describe("TransientStatusController", () => {
  it("re-renders the current fact when the UI language changes", () => {
    let locale = "en";
    const rendered: string[] = [];
    const status = new TransientStatusController<"saving" | "saved">(
      (key) => rendered.push(key ? `${locale}:${key}` : ""),
      vi.fn(),
    );

    status.set("saved", 1_600);
    locale = "zh-CN";
    status.retranslate();

    expect(rendered).toEqual(["en:saved", "zh-CN:saved"]);
  });

  it("does not let an older clear timer erase a newer save result", () => {
    const scheduled: Array<() => void> = [];
    const rendered: Array<string | null> = [];
    const status = new TransientStatusController<"saving" | "saved">(
      (key) => rendered.push(key),
      (callback) => scheduled.push(callback),
    );

    status.set("saved", 1_600);
    status.set("saving");
    status.set("saved", 1_600);
    scheduled[0]?.();
    expect(rendered.at(-1)).toBe("saved");

    scheduled[1]?.();
    expect(rendered.at(-1)).toBeNull();
  });
});
