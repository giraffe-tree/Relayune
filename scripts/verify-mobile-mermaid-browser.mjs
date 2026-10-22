import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const [runtime, adapter] = await Promise.all([
  readFile('mobile/assets/mermaid/mermaid.min.js', 'utf8'),
  readFile('mobile/assets/mermaid/native-svg.js', 'utf8'),
]);
const wide = `flowchart LR
A[点击本地网页链接] -->|打开预览| B[手机 WebView]
B --> C[加密连接]
C -->|转发请求| D[本机网关]
D --> E[localhost 服务]
classDef accent fill:#12634b,stroke:#68dbb1,color:#ffffff
class C accent`;
const sources = [wide, `flowchart TD
A[用户账号] --> B[原始记录]
A --> S[登录身份与会话]
B --> C[记录修订版本]
B --> D[照片 / 音频元数据]
C --> E[AI 回应]
C --> F[素材提取 / 整理]
C --> G[图片 / 音乐创作请求]
G --> H[后台任务与生成产物]
A --> I[增量同步账本]
A --> J[删除任务与清理账本]`, 'sequenceDiagram\n手机->>电脑: 请求预览\n电脑-->>手机: 返回内容',
'flowchart LR\nA[起点] <--> B[终点]'];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const external = [];
  page.on('request', request => external.push(request.url()));
  await page.setContent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'">`);
  await page.addScriptTag({ content: runtime + '\n' + adapter });
  for (const dark of [true, false]) {
    for (const [index, source] of sources.entries()) {
      const result = await page.evaluate(async ({ source, dark }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default',
          maxTextSize: 20000, maxEdges: 200, htmlLabels: false,
          flowchart: { htmlLabels: false }, fontFamily: 'sans-serif', suppressErrorRendering: true });
        const { svg } = await mermaid.render('diagram', source);
        const baselines = host => {
          const inverse = host.querySelector('svg').getScreenCTM().inverse();
          return [...host.querySelectorAll('text, tspan')]
            .filter(run => !run.querySelector('tspan') && run.getNumberOfChars())
            .map(run => {
              const point = run.getStartPositionOfChar(0).matrixTransform(inverse.multiply(run.getScreenCTM()));
              return { text: run.textContent, x: point.x, y: point.y };
            });
        };
        const original = document.createElement('div');
        original.innerHTML = svg;
        document.body.append(original);
        const expectedBaselines = baselines(original);
        original.remove();
        const native = prepareMermaidSvg(svg);
        const host = document.createElement('div');
        host.innerHTML = native;
        document.body.append(host);
        const drawing = host.querySelector('svg');
        const result = { native, width: drawing.viewBox.baseVal.width,
          expectedBaselines, actualBaselines: baselines(host),
          styleCount: host.querySelectorAll('style, [style], marker, [marker-end], [marker-start], filter, [filter]').length,
          fill: host.querySelector('.node rect')?.getAttribute('fill'),
          textFill: host.querySelector('text')?.getAttribute('fill'),
          arrowCount: host.querySelectorAll('.arrowMarkerPath').length,
          edgeCount: host.querySelectorAll('.flowchart-link').length,
          accent: host.querySelector('.accent rect')?.getAttribute('fill') };
        host.remove();
        return result;
      }, { source, dark });
      assert.equal(result.styleCount, 0, 'native output must not depend on stylesheets or markers');
      assert.equal(result.actualBaselines.length, result.expectedBaselines.length, 'all text runs survive export');
      for (const [index, expected] of result.expectedBaselines.entries()) {
        const actual = result.actualBaselines[index];
        assert.equal(actual.text, expected.text);
        assert.ok(Math.abs(actual.x - expected.x) < 0.1 && Math.abs(actual.y - expected.y) < 0.1,
          `label baseline stays aligned: ${expected.text}`);
      }
      assert.ok(result.textFill && (!dark || result.textFill !== 'rgb(0, 0, 0)'), `text retains its theme color (${dark}, ${index}, ${result.textFill})`);
      if (index !== 2) assert.ok(result.arrowCount >= result.edgeCount, 'native edges retain arrowheads');
      if (index === 0) {
        assert.ok(result.width > 600, 'horizontal fixture exercises phone overflow');
        assert.equal(result.accent, 'rgb(18, 99, 75)', 'custom node color survives');
        if (process.argv.includes('--update-fixtures')) {
          await writeFile(`mobile/test/fixtures/mermaid/wide-flowchart-${dark ? 'dark' : 'light'}.svg`, result.native + '\n');
        }
      }
      if (index === 1 && dark && process.argv.includes('--update-fixtures')) {
        await writeFile('mobile/test/fixtures/mermaid/flowchart.svg', result.native + '\n');
      }
    }
  }
  assert.deepEqual(external, [], 'Mermaid rendering must remain offline');
  console.log('PASS: dark/light themes, CSS/classDef colors, Chinese labels, arrowheads, sequence diagram, offline rendering');
} finally {
  await browser.close();
}
