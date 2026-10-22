import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const base = process.env.REPLAY_BASE_URL || "http://127.0.0.1:4177";
const output = resolve("work/replay-qa");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  for (const [width, locale] of [[1440, "zh"], [1024, "zh"], [768, "en"], [390, "zh"], [320, "zh"], [390, "fr"], [390, "ar"]]) {
    if (process.env.REPLAY_WIDTH && width !== Number(process.env.REPLAY_WIDTH)) continue;
    console.log(`Checking ${width}px ${locale}`);
    const page = await browser.newPage({ viewport: { width, height: 1000 }, locale: "zh-CN", reducedMotion: "no-preference" });
    const failures = [];
    const apiRequests = [];
    page.on("pageerror", error => failures.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (url.pathname.startsWith("/api/")) {
        apiRequests.push(url.pathname);
        return route.fulfill({ status: 401, json: { error: "unauthenticated" } });
      }
      return route.continue();
    });
    page.setDefaultTimeout(10000);
    await page.goto(`${base}/${locale}/`);
    const hero = page.locator(".hero-demo");
    await hero.scrollIntoViewIfNeeded();
    await page.locator(".hero-demo.is-demo-playing").waitFor();
    await page.evaluate(async () => Promise.all([...document.querySelectorAll('.replay-screen img')]
      .filter(image => image.getBoundingClientRect().width > 0).map(image => image.decode())));
    const callsBeforePlayback = apiRequests.length;
    await page.locator('.hero-demo[data-demo-beat="1"]').waitFor({ timeout: 9000 });
    assert.equal(await hero.getAttribute("data-demo-beat"), "1", "automatic shared clock advances");
    const sources = await page.locator(".replay-screen img.is-current").evaluateAll(images => images.map(image => image.getAttribute("src")));
    assert.equal(sources.length, 2);
    assert.equal(sources[0].replace("web-", "phone-"), sources[1], "devices show the same task stage");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator(".hero-demo:not(.is-demo-playing)").waitFor();
    const pausedBeat = await hero.getAttribute("data-demo-beat");
    await page.waitForTimeout(350);
    assert.equal(await hero.getAttribute("data-demo-beat"), pausedBeat, "live reduced-motion preference stops playback");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px ${locale} has no horizontal overflow`);
    assert.equal(apiRequests.length, callsBeforePlayback, "replay makes no API requests");
    assert.deepEqual(failures, []);
    if (process.env.REPLAY_TRACE) console.log("Capturing layout");
    if ((width === 1440 || width === 390) && locale === "zh") {
      await page.setViewportSize({ width, height: 1400 });
      await hero.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
      await hero.screenshot({ path: resolve(output, `hero-${width}.png`), animations: "disabled" });
      if (width === 1440) await page.screenshot({ path: resolve(output, "homepage-desktop.png"), animations: "disabled" });
    }
    console.log(`Replay verified: ${width}px ${locale}, synchronized playback, reduced motion, API isolation`);
    await page.close();
  }
} finally { await browser.close(); }
