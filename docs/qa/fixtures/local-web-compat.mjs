// Synthetic loopback-only compatibility fixture; never submits business data.
// Run with Node 24: node docs/qa/fixtures/local-web-compat.mjs
import http from 'node:http';
import {readFile} from 'node:fs/promises';
const assets=new URL('../../../mobile/assets/',import.meta.url);
const reports=[]; let writes=0;
const fontFamilies=['system-ui','-apple-system','PingFang SC','Helvetica','Arial','sans-serif','serif','monospace'];
const head=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Web compatibility QA</title><link rel="stylesheet" href="/style.css"></head><body><nav><a href="/fonts">Fonts</a><a href="/layout">Layout</a><a href="/spa#one">SPA</a><a href="/forms">Forms</a><a href="/webfont">Webfont</a></nav>`;
const foot='<script src="/font-probe.js"></script></body></html>';
const sharedScript=`async function report(name,ok){await fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,ok})})}`;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture');
 res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/font-probe.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('./local-web-font-probe.js',import.meta.url),'utf8'));return;}
 if(url.pathname==='/site-font.woff2'||url.pathname==='/_relayune/compat/cjk.woff2'){res.setHeader('Content-Type','font/woff2');res.end(await readFile(new URL('visualization/noto-cjk.woff2',assets)));return;}
 if(url.pathname==='/_relayune/compat/font-fallback.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('local_web/font-fallback.js',assets),'utf8'));return;}
 if(url.pathname==='/report'&&req.method==='POST'){let b='';for await(const c of req)b+=c;if(b.length<4096){const v=JSON.parse(b);if(typeof v.name==='string'&&typeof v.ok==='boolean')reports.push(v);}res.end('ok');return;}
 if(url.pathname==='/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({writes,reports}));return;}
 if(url.pathname==='/style.css'){res.setHeader('Content-Type','text/css');res.end(`body{margin:14px;background:#f6f8fa;color:#14302b;font:14px/1.35 sans-serif}nav{display:flex;gap:8px;position:sticky;top:0;background:#f6f8fa;padding:8px 0;z-index:2}a,button{padding:7px 10px;border:1px solid #9bbfb0;border-radius:6px;color:#145542;background:#e6f2eb;text-decoration:none;font:inherit}nav a{padding:6px}h1{font-size:20px}p{margin:9px 0}.row{display:grid;grid-template-columns:110px 1fr;border-bottom:1px solid #ddd;padding:8px 0}.row b{font:11px sans-serif}.row span{font-size:19px}.card{border-radius:10px;padding:12px;background:white;margin:8px 0}input{display:block;width:90%;padding:8px;font:16px sans-serif;margin:8px 0}code{font-size:11px}svg{height:70px}canvas{width:280px;height:65px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}@media(max-width:500px){.grid{grid-template-columns:1fr}}`);return;}
 if(url.pathname==='/module.js'){res.setHeader('Content-Type','text/javascript');res.end(`import {hello} from '/helper.js';document.querySelector('#module').textContent=hello;fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'es-module',ok:hello==='ES Module / 中文模块 OK'})});`);return;}
 if(url.pathname==='/helper.js'){res.setHeader('Content-Type','text/javascript');res.end(`export const hello='ES Module / 中文模块 OK';`);return;}
 if(url.pathname==='/api'&&req.method==='POST'){let b='';for await(const c of req)b+=c;writes++;res.setHeader('Set-Cookie','compat=ok; HttpOnly; Path=/; SameSite=Strict');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:b.includes('中文')||decodeURIComponent(b.replace(/\+/g,' ')).includes('中文'),writes}));return;}
 if(url.pathname==='/cookie'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:req.headers.cookie==='compat=ok'}));return;}
 if(url.pathname==='/submit'&&req.method==='POST'){let b='';for await(const c of req)b+=c;writes++;reports.push({name:'native-form',ok:new URLSearchParams(b).get('name')==='中文表单'});res.writeHead(303,{Location:'/submitted#done'});res.end();return;}
 res.setHeader('Content-Type','text/html;charset=utf-8');
 let body='';
 if(url.searchParams.has('compat'))body+='<script defer src="/_relayune/compat/font-fallback.js"></script>';
 const compat=body;
 if(url.pathname==='/fonts'||url.pathname==='/'){
  body='<h1>Font matrix / 字体对照</h1>'+fontFamilies.map(f=>`<div class="row"><b>${f}</b><span style="font-family:'${f}'">中文网页测试 Aa</span></div>`).join('')+'<p style="font-family:system-ui;font-weight:700">Bold 中文加粗测试</p><div id="dynamic"></div><script>'+sharedScript+`;setTimeout(()=>{document.querySelector('#dynamic').innerHTML='<p style="font-family:system-ui">Dynamic 动态中文节点</p>';report('dom-dynamic',true)},400);`+'</script>';
 }else if(url.pathname==='/layout'){
  body='<h1>Responsive layout / 图文</h1><div class="grid"><article class="card"><h2>中文阅读页面</h2><p>正文、卡片、图片和响应式布局。</p><svg viewBox="0 0 200 70"><rect width="200" height="70" rx="15" fill="#b8dbc6"/><text x="15" y="43" font-size="23">SVG 中文 ✓</text></svg></article><article class="card"><div id="module">Module pending</div><canvas width="560" height="130"></canvas><a href="/child#anchor" target="_blank">Open child / 子页面</a></article></div><p><a href="#bottom">Jump to bottom / 跳到底部</a></p>'+Array.from({length:15},(_,i)=>`<article class="card">Paragraph ${i+1} · 中文长文段落。用于检查原生滚动与窄屏布局。</article>`).join('')+'<h2 id="bottom">BOTTOM / 长文底部</h2><a href="#">Top / 顶部</a><script type="module" src="/module.js"></script><script>'+sharedScript+`;const c=document.querySelector('canvas').getContext('2d');c.font='30px sans-serif';c.fillText('Canvas 中文图形 ✓',10,55);report('responsive-width',document.documentElement.scrollWidth<=innerWidth);`+'</script>';
 }else if(url.pathname==='/spa'){
  body='<h1>SPA / 单页应用</h1><p id="route"></p><button id="next">Next route / 下一页</button><button id="api">Fetch API</button><button id="xhr">XHR API</button><p id="result">Ready</p><script>'+sharedScript+`;const route=()=>document.querySelector('#route').textContent='Route: '+location.hash;route();onhashchange=route;document.querySelector('#next').onclick=()=>{location.hash='中文路由';report('hash-route',true)};document.querySelector('#api').onclick=async()=>{const v=await(await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'中文 API'})})).json();const cookie=await(await fetch('/cookie')).json();document.querySelector('#result').textContent='Fetch '+v.ok+' Cookie '+cookie.ok;report('fetch-cookie',v.ok&&cookie.ok)};document.querySelector('#xhr').onclick=()=>{const x=new XMLHttpRequest;x.open('POST','/api');x.setRequestHeader('Content-Type','application/json');x.onload=()=>{document.querySelector('#result').textContent='XHR '+JSON.parse(x.responseText).ok;report('xhr',JSON.parse(x.responseText).ok)};x.send(JSON.stringify({text:'中文 XHR'}))};`+'</script>';
 }else if(url.pathname==='/webfont'){
  body='<style>@font-face{font-family:SiteWebFont;src:url(/site-font.woff2) format("woff2");unicode-range:U+2000-9FFF}</style><h1>Same-origin WOFF2</h1><p style="font:24px SiteWebFont,serif">中文网页自带字体</p><p id="fontstatus">Loading...</p><script>'+sharedScript+`;document.fonts.load('24px SiteWebFont','中文').then(v=>{document.querySelector('#fontstatus').textContent='Webfont loaded: '+v.length;report('same-origin-webfont',v.length===1)}).catch(()=>report('same-origin-webfont',false));`+'</script>';
 }else if(url.pathname==='/forms'){
  body='<h1>Forms / 原生表单</h1><form action="/submit" method="post" target="_blank"><input name="name" value="中文表单"><button>Submit / 提交一次</button></form>';
 }else if(url.pathname==='/child')body='<h1 id="anchor">Child page / 子页面</h1><p>相对路径、独立页面与锚点加载成功。</p><a href="/layout">Back / 返回图文页</a><script>'+sharedScript+`report('child-hash',location.hash==='#anchor')`+'</script>';
 else if(url.pathname==='/submitted')body='<h1 id="done">Submitted / 已提交</h1><p>Writes: '+writes+'</p><script>'+sharedScript+`report('form-redirect-hash',location.hash==='#done')`+'</script>';
 else {res.statusCode=404;body='<h1>404</h1>'}
 res.end(head+compat+body+foot);
});server.listen(49700,'127.0.0.1',()=>console.log('Compatibility fixture: http://127.0.0.1:49700/fonts'));
