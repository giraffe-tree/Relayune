// Loopback-only synthetic loading fixture. No accounts, secrets or business writes.
import http from 'node:http';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const counts = {};
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://fixture');
  counts[url.pathname] = (counts[url.pathname] ?? 0) + 1;
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/state') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ counts })); return;
  }
  if (url.pathname === '/missing.css') {
    await delay(2200); response.writeHead(404, {'Content-Type':'text/css'});
    response.end('/* Synthetic missing resource. */'); return;
  }
  if (url.pathname === '/page.css') {
    await delay(3000); response.setHeader('Content-Type','text/css');
    response.end('body{margin:28px;background:#f3f1e9;color:#182d27;font:16px/1.6 sans-serif}h1{font-size:34px;line-height:1.2;margin:50px 0 24px}p{color:#5e6c65}img{display:block;width:100%;border-radius:8px;margin:30px 0}a{color:#1b7652}small{letter-spacing:.15em}'); return;
  }
  if (url.pathname === '/cover.svg') {
    await delay(8000); response.setHeader('Content-Type','image/svg+xml');
    response.end('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#d3dfd0"/><circle cx="410" cy="130" r="76" fill="#287453"/><path d="M0 260L260 80L500 360H0Z" fill="#172d27"/></svg>'); return;
  }
  if (url.pathname === '/page.js') {
    await delay(1800); response.setHeader('Content-Type','text/javascript');
    response.end("document.querySelector('#state').textContent='Page script received / 页面脚本已取回';"); return;
  }
  await delay(1800);
  if (url.searchParams.has('resource-fail')) {
    response.writeHead(404, {'Content-Type':'application/json'});
    response.end('{"synthetic":"missing data"}'); return;
  }
  if (url.searchParams.has('fail')) {
    response.writeHead(404, {'Content-Type':'text/html;charset=utf-8'});
    response.end('<!doctype html><title>Missing page</title><p>Synthetic missing page</p>'); return;
  }
  response.setHeader('Content-Type','text/html;charset=utf-8');
  response.end(`<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local page · Loading study</title><link rel="stylesheet" href="/page.css"><link rel="stylesheet" href="/missing.css"></head><body><small>RELAYUNE / LOADING STUDY</small><h1>A page,<br>from your computer.</h1><p>合成页面，用于验证等待、资源接收与失败提示。</p><img src="/cover.svg" alt="Geometric landscape"><p id="state">Waiting for page script…</p><p><a href="/child#section">打开子页面</a></p><p><a href="/?fail">打开缺失页面</a></p><p><button onclick="fetch(location.pathname+'?resource-fail').then(()=>this.textContent='数据请求已结束')">同路径数据请求失败</button></p><script src="/page.js"></script></body></html>`);
});
server.listen(49703, '127.0.0.1', () => console.log('Synthetic local-web fixture: http://127.0.0.1:49703/'));
process.on('SIGTERM', () => server.close());
