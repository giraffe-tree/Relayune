const SEEN_KEY = "relayune.opening-seen.v1";

/** Presentation only: never delays bootstrap, navigation, or login. */
export class DesktopOpening {
  private visited = false;
  private readonly motion = window.matchMedia("(prefers-reduced-motion: reduce)");

  constructor(private readonly skip: HTMLButtonElement) {
    skip.addEventListener("click", () => {
      this.finish();
      document.getElementById("login-button")?.focus({ preventScroll: true });
    });
    document.addEventListener("pointerdown", (event) => {
      if (event.target !== skip) this.finish();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Tab" && event.target !== skip) this.finish();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.finish();
    });
    this.motion.addEventListener("change", () => {
      if (this.motion.matches) this.finish();
    });
    document.addEventListener("animationend", (event) => {
      if (event.animationName === "opening-arrive") this.finish();
    });
  }

  show(view: "loading" | "login" | "home", macos: boolean) {
    document.body.dataset.opening = macos && view !== "home" ? view : "none";
    if (macos && view === "home") document.body.classList.add("opening-home-enter");
    else document.body.classList.remove("opening-home-enter");
    if (!macos || view !== "login") {
      this.finish();
      return;
    }
    if (this.visited) return;
    this.visited = true;
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === "true";
      localStorage.setItem(SEEN_KEY, "true");
    } catch {
      // Cosmetic storage is optional; this instance still only plays once.
    }
    if (seen || this.motion.matches || document.hidden) return;
    document.body.classList.add("opening-playing");
    this.skip.hidden = false;
  }

  private finish() {
    document.body.classList.remove("opening-playing");
    // Keep keyboard focus on a real action when the timed skip control expires.
    if (document.activeElement === this.skip) {
      document.getElementById("login-button")?.focus({ preventScroll: true });
    }
    this.skip.hidden = true;
  }
}
