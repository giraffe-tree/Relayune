import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// PLAYWRIGHT_MODULE may point to an existing local Playwright installation.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const source = `flowchart TD
A[用户账号] --> B[原始记录]
A --> S[登录身份与会话]
B --> C[记录修订版本]
B --> D[照片 / 音频元数据]
C --> E[AI 回应]
C --> F[素材提取 / 整理]
C --> G[图片 / 音乐创作请求]
G --> H[后台任务与生成产物]
A --> I[增量同步账本]
A --> J[删除任务与清理账本]`;
const runtime = await readFile('public/mermaid/mermaid.min.js', 'utf8');
assert.equal(runtime, await readFile('mobile/assets/mermaid/mermaid.min.js', 'utf8'));
const { outputFiles } = await build({
  stdin: { contents: `import {createRoot} from 'react-dom/client';
import MessageMarkdown from './app/message-markdown';
const root=createRoot(document.getElementById('root'));
window.renderMarkdown=(source)=>root.render(<MessageMarkdown locale="zh">{source}</MessageMarkdown>);
window.renderMarkdown(${JSON.stringify('```mermaid\n' + source + '\n```')});`,
    loader: 'tsx', resolveDir: process.cwd() },
  bundle: true, format: 'iife', jsx: 'automatic', write: false,
});
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
  res.end(req.url === '/mermaid/mermaid.min.js' ? runtime : req.url === '/main.js'
    ? outputFiles[0].text
    : '<html><meta charset="utf-8"><body style="background:#111;color:#eee"><div id="root"></div><script src="/main.js"></script></body></html>');
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 430, height: 820 } });
  const errors = [];
  const external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:')) external.push(request.url());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const frame = page.frameLocator('iframe');
  await frame.locator('#diagram svg').waitFor();
  assert.equal(await frame.locator('.node').count(), 11);
  assert.match(await frame.locator('#diagram').textContent(), /用户账号/);
  const width = await frame.locator('svg').evaluate(element => element.getBoundingClientRect().width);
  assert.ok(width <= 430, 'diagram initially fits the viewport');
  await frame.locator('#plus').click();
  assert.ok(await frame.locator('svg').evaluate(element => element.getBoundingClientRect().width) > width);
  await frame.locator('#code').click();
  assert.equal(await frame.locator('#source').isVisible(), true);
  await page.evaluate(source => window.renderMarkdown('```\n' + source + '\n```'), source);
  await frame.locator('#diagram svg').waitFor();
  await page.evaluate(() => window.renderMarkdown('```mermaid\nflowchart TD\nA[\n```'));
  await frame.locator('#source').filter({ hasText: 'A[' }).waitFor();
  assert.equal(await frame.locator('#source').isVisible(), true);
  await page.evaluate(() => window.renderMarkdown('```mermaid\nflowchart TD\nA["<img src=https://example.invalid/track onerror=alert(1)>"]\n```'));
  await frame.locator('#source').filter({ hasText: 'example.invalid' }).waitFor({ state: 'attached' });
  await page.evaluate(() => window.renderMarkdown('```js\nflowchart TD\n```'));
  await page.locator('pre code').waitFor();
  assert.equal(await page.locator('iframe').count(), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('PASS: Chinese flowchart, fit/zoom, source, unlabeled block, malformed fallback, ordinary code, network isolation');
} finally {
  await browser.close();
  server.close();
}
