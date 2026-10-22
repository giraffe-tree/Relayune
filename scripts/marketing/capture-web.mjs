// Offline capture of the production WorkbenchPage. No demo route, credentials,
// or capture switches are included in the shipped app. Only initial React state
// and the page's network/lifecycle effects are replaced in this temporary build.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import ts from "typescript";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = join(root, "public/marketing/task-replay");
const temporary = join(root, "work/marketing-capture");
const task = JSON.parse(await readFile(join(root, "scripts/marketing/font-size-task.json"), "utf8"));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
await mkdir(output, { recursive: true });
await mkdir(temporary, { recursive: true });

const initialStates = new Set([
  "authenticated", "checkingAuth", "email", "snapshot",
  "activeSession", "selectedProvider", "messageMap", "historyPageMap",
]);
const replaced = new Set();
const capturePlugin = {
  name: "offline-workbench-state",
  setup(bundler) {
    bundler.onResolve({ filter: /^\// }, args => args.kind === "url-token" ? { path: args.path, external: true } : null);
    bundler.onLoad({ filter: /workbench-page\.tsx$/ }, async ({ path }) => {
      const source = await readFile(path, "utf8");
      const transform = (context) => {
        const visitPage = (node) => {
          if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name)) {
            const name = node.name.elements[0]?.name?.getText();
            if (initialStates.has(name)) {
              if (!node.initializer || !ts.isCallExpression(node.initializer) || node.initializer.expression.getText() !== "useState") {
                throw new Error(`Capture state no longer uses useState: ${name}`);
              }
              replaced.add(name);
              return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
                ts.factory.updateCallExpression(node.initializer, node.initializer.expression, node.initializer.typeArguments,
                  [ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier("__captureState"), name)]));
            }
          }
          if (ts.isCallExpression(node) && ["useEffect", "useMarketingReturnFocus"].includes(node.expression.getText())) {
            return ts.factory.createVoidZero();
          }
          return ts.visitEachChild(node, visitPage, context);
        };
        return (file) => ts.visitEachChild(file, (node) =>
          ts.isFunctionDeclaration(node) && node.name?.text === "WorkbenchPage"
            ? ts.visitEachChild(node, visitPage, context) : node, context);
      };
      const compiled = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
        transformers: { before: [transform] }, fileName: path,
      });
      for (const name of initialStates) if (!replaced.has(name)) throw new Error(`Missing capture state: ${name}`);
      return { contents: "const __captureState = window.__captureState;\n" + compiled.outputText, loader: "js", resolveDir: dirname(path) };
    });
    bundler.onLoad({ filter: /globals\.css$/ }, async ({ path }) => ({
      contents: (await readFile(path, "utf8")).replace('@import "tailwindcss";', ""), loader: "css", resolveDir: dirname(path),
    }));
  },
};
await build({
  stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import "../../app/globals.css"; import Workbench from "../../app/workbench-page"; createRoot(document.getElementById("root")).render(<Workbench/>);', resolveDir: join(root, "scripts/marketing"), loader: "tsx" },
  bundle: true, outfile: join(temporary, "capture.js"), plugins: [capturePlugin],
  define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_AGENT_PROVIDER: "multi" }) },
  loader: { ".woff2": "file", ".woff": "file", ".svg": "file" }, logLevel: "warning",
});
await writeFile(join(temporary, "index.html"), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/capture.css"><style>body{margin:0}*,*::before,*::after{animation:none!important;transition:none!important}</style><div id="root"></div><script src="/capture.js"></script></html>');
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const base = ["/", "/capture.js", "/capture.css"].includes(url.pathname) ? temporary : join(root, "public");
  const path = resolve(base, "." + (url.pathname === "/" ? "/index.html" : url.pathname));
  if (!path.startsWith(base + "/")) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(path);
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png" })[extname(path)] ?? "application/octet-stream");
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  for (const stage of task.stages) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 708 }, deviceScaleFactor: 2, locale: "zh-CN", timezoneId: "Asia/Shanghai", reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const request = new URL(route.request().url());
      if (request.origin === origin && request.pathname === "/api/account/agent-order" && route.request().method() === "GET") {
        return route.fulfill({ json: { agent_order: ["codex", "claude", "kimi", "opencode", "zcode", "claude-cowork"] } });
      }
      if (request.origin !== origin || request.pathname.startsWith("/api/")) {
        errors.push(`Blocked capture request: ${request.pathname}`);
        return route.abort();
      }
      return route.continue();
    });
    const session = { id: "font-size", name: task.title, project: task.project, cwd: "/Projects/Relayune", branch: "", provider: "codex", status: "idle", updated_at: task.messages[stage.messageCount - 1].created_at };
    const messages = task.messages.slice(0, stage.messageCount).map(m => ({ ...m, createdAt: m.created_at, meta: m.role === "user" ? "" : "Codex", kind: "message", source: "history", turnId: "font-size-turn" }));
    await page.addInitScript(({ session, messages }) => {
      window.__captureState = {
        authenticated: true, checkingAuth: false, email: "",
        snapshot: { device: { id: "capture", name: "Mac", online: true, codex_connected: true, latency_ms: null, last_seen_at: null }, sessions: [session], projects: [], approvals: [], agents: [], events: [], cursor: 0, ack_seq: 0, queued_commands: 0 },
        activeSession: session.id, selectedProvider: "codex", messageMap: { [session.id]: messages },
        historyPageMap: { [session.id]: { loaded: true, loading: false, hasMore: false } },
      };
    }, { session, messages });
    await page.clock.install({ time: new Date() });
    await page.goto(origin);
    await page.locator(".workspace-grid").waitFor({ timeout: 10000 }).catch(async error => {
      throw new Error(`${error.message}\n${errors.join("\n")}\n${await page.locator("body").innerText()}`);
    });
    if (await page.locator('.project-toggle[aria-expanded="false"]').count()) await page.locator('.project-toggle').first().click();
    await page.locator(".message").first().waitFor();
    if (messages.length > 1) await page.locator('.message.codex .message-markdown').last().waitFor();
    await page.locator('.message-markdown-fallback').first().waitFor({ state: 'detached' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(temporary, `web-${stage.id}.png`), animations: "disabled" });
    if (errors.length) throw new Error(errors.join("\n"));
    await sharp(join(temporary, `web-${stage.id}.png`)).webp({ quality: 90 }).toFile(join(output, `web-${stage.id}.webp`));
    console.log(`Captured production Web UI: ${stage.id}`);
    await page.close();
  }
} finally {
  await browser?.close();
  server.close();
}
