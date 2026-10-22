import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopOpening } from "./opening";

class Element extends EventTarget {
  hidden = true;
  dataset: Record<string, string> = {};
  classes = new Set<string>();
  classList = { add: (v: string) => this.classes.add(v), remove: (v: string) => this.classes.delete(v) };
  focus = vi.fn();
}

describe("non-blocking opening", () => {
  let body: Element;
  let skip: Element;
  let doc: EventTarget & { body: Element; hidden: boolean; activeElement: unknown; getElementById: () => Element };
  let motion: EventTarget & { matches: boolean };
  let storage: Map<string, string>;
  beforeEach(() => {
    body = new Element(); skip = new Element(); storage = new Map();
    doc = Object.assign(new EventTarget(), {body, hidden: false, activeElement: null, getElementById: () => new Element()});
    motion = Object.assign(new EventTarget(), {matches: false});
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", {matchMedia: () => motion});
    vi.stubGlobal("localStorage", {getItem: (k: string) => storage.get(k), setItem: (k: string, v: string) => storage.set(k, v)});
  });
  afterEach(() => vi.unstubAllGlobals());
  const create = () => new DesktopOpening(skip as unknown as HTMLButtonElement);

  it("does not mark startup as a first visit and allows home immediately", () => {
    const opening = create();
    opening.show("loading", true);
    expect(storage.size).toBe(0);
    opening.show("home", true);
    expect(body.dataset.opening).toBe("none");
    expect(skip.hidden).toBe(true);
  });
  it("plays on the first login only, including across window launches", () => {
    const opening = create();
    opening.show("login", true);
    expect(skip.hidden).toBe(false);
    doc.dispatchEvent(new Event("pointerdown"));
    expect(skip.hidden).toBe(true);
    opening.show("login", true);
    expect(skip.hidden).toBe(true);
    create().show("login", true);
    expect(skip.hidden).toBe(true);
  });
  it("immediately leaves the intro when login completes", () => {
    const opening = create();
    opening.show("login", true);
    opening.show("home", true);
    expect(body.classes.has("opening-playing")).toBe(false);
    expect(body.dataset.opening).toBe("none");
  });
  it("does not play when reduced motion is requested or the window is hidden", () => {
    motion.matches = true;
    create().show("login", true);
    expect(skip.hidden).toBe(true);
    storage.clear(); motion.matches = false; doc.hidden = true;
    create().show("login", true);
    expect(skip.hidden).toBe(true);
  });
  it("settles on backgrounding and does not replay on resume", () => {
    const opening = create(); opening.show("login", true);
    doc.hidden = true; doc.dispatchEvent(new Event("visibilitychange"));
    doc.hidden = false; doc.dispatchEvent(new Event("visibilitychange"));
    opening.show("login", true);
    expect(skip.hidden).toBe(true);
  });
  it("leaves Windows presentation unchanged and tolerates restricted storage", () => {
    const opening = create(); opening.show("login", false);
    expect(body.dataset.opening).toBe("none");
    expect(storage.size).toBe(0);
    vi.stubGlobal("localStorage", {getItem: () => { throw new Error("restricted"); }});
    expect(() => opening.show("login", true)).not.toThrow();
    expect(skip.hidden).toBe(false);
  });
});
