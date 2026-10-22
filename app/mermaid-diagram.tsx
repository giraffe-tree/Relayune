"use client";

import { useEffect, useState } from "react";

let runtime: Promise<string> | undefined;

export function isMermaidBlock(source: string, language = "") {
  const tag = language.replace(/^language-/, "").toLowerCase();
  return source.length <= 20_000 && (tag === "mermaid" ||
    (["", "flowchart"].includes(tag) && /^\s*(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\b/.test(source)));
}

export default function MermaidDiagram({ source }: { source: string }) {
  const [document, setDocument] = useState("");
  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      runtime ??= fetch("/mermaid/mermaid.min.js").then((response) => {
        if (!response.ok) throw new Error("Mermaid unavailable");
        return response.text();
      }).catch((error) => { runtime = undefined; throw error; });
      void runtime.then((script) => {
        if (cancelled) return;
        const data = JSON.stringify(source).replaceAll("<", "\\u003c");
        setDocument(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<style>body{margin:0;padding:12px;background:#161916;color:#eee;font:14px sans-serif}#diagram{overflow:auto}svg{max-width:none!important}pre{white-space:pre-wrap}button{color:inherit;background:transparent;border:1px solid #666;border-radius:5px;padding:6px 10px;margin:0 6px 10px 0}</style></head><body>
<button id="minus" aria-label="Zoom out">−</button><button id="plus" aria-label="Zoom in">+</button><button id="code">Mermaid</button>
<div id="diagram"></div><pre id="source"></pre>
<script>${script.replaceAll("</script", "<\\/script")}</script>
<script>(async()=>{const source=${data};const pre=document.getElementById('source');pre.textContent=source;
try{if(source.length>20000 || /%%\\s*\\{|^\\s*---/.test(source))throw Error('config');
mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'dark',maxTextSize:20000,maxEdges:200,htmlLabels:false,flowchart:{htmlLabels:false},suppressErrorRendering:true});
const {svg}=await mermaid.render('chart',source);const host=document.getElementById('diagram');host.innerHTML=svg;pre.hidden=true;
const drawing=host.querySelector('svg');let width=Math.min(host.clientWidth,drawing.viewBox.baseVal.width);const resize=()=>{drawing.style.width=width+'px';drawing.style.height='auto';};resize();
document.getElementById('plus').onclick=()=>{width=Math.min(8000,width*1.25);resize()};document.getElementById('minus').onclick=()=>{width=Math.max(150,width/1.25);resize()};document.getElementById('code').onclick=()=>{pre.hidden=!pre.hidden;host.hidden=!pre.hidden};
}catch(_){document.getElementById('diagram').replaceChildren();}})();</script></body></html>`);
      }).catch(() => { /* Keep the original code when unavailable. */ });
    }, 350);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [source]);
  if (!document) return <pre dir="ltr"><code>{source}</code></pre>;
  return <iframe title="Mermaid" sandbox="allow-scripts" srcDoc={document}
    style={{ width: "100%", height: 360, border: "1px solid #444", borderRadius: 8 }} />;
}
