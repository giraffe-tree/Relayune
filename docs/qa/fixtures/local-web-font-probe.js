/* Synthetic pixel checks: no page data or images leave this test document. */
(async () => {
  if (!location.pathname.endsWith('/fonts')) return;
  const dynamic = document.querySelector('#dynamic');
  const sheet = new CSSStyleSheet();
  sheet.replaceSync('.late-font { font-family: system-ui; font-weight: 700; }');
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  setTimeout(() => {
    const p = document.createElement('p'); p.className = 'late-font';
    p.textContent = 'CSSOM 动态样式中文'; dynamic.append(p);
  }, 650);
  await new Promise(resolve => setTimeout(resolve, 2200));
  await document.fonts.ready;
  const raster = (font, text) => {
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=64;
    const c=canvas.getContext('2d',{willReadFrequently:true});c.font='32px '+font;c.fillText(text,4,42);
    return c.getImageData(0,0,160,64).data;
  };
  for (const element of document.querySelectorAll('.row span,#dynamic p')) {
    const family=getComputedStyle(element).fontFamily;
    const a=raster(family,'汉'), b=raster(family,'字');
    const ok=a.some((value,i)=>value!==b[i]);
    await fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'glyph:'+ (element.parentElement.className==='row'?element.previousElementSibling.textContent:element.className||'dynamic'),ok})});
  }
  const repaired=!!document.querySelector('style')?.textContent.includes('Relayune Local Web CJK');
  const note=document.createElement('p');note.style.font='12px sans-serif';note.textContent='Automatic fallback: '+repaired;document.body.append(note);
  await fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'fallback-active',ok:repaired})});
})();
