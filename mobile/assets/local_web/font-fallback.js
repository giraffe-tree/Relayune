/* Local WebView compatibility, without a native bridge or network telemetry.
 * Healthy system fonts leave the document untouched. Only broken CJK system
 * aliases get a composite fallback; earlier site fonts and Latin stay intact.
 */
(() => {
  'use strict';
  const family = 'Relayune Local Web CJK';
  const aliases = ['system-ui', '-apple-system'];
  function raster(font, text) {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 64;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    if (!context) throw new Error('canvas unavailable');
    context.font = '32px ' + font;
    context.fillText(text, 4, 42);
    return context.getImageData(0, 0, 160, 64).data;
  }
  function collision(font) {
    const a = raster(font, '汉'), b = raster(font, '字');
    return a.some(value => value !== 0) && a.every((value, i) => value === b[i]);
  }
  let broken;
  try {
    if (collision('sans-serif')) return; // Inconclusive probe, leave the site alone.
    broken = new Set(aliases.filter(collision));
  } catch (_) { return; }
  if (!broken.size) return;

  // Split CSSOM family lists without splitting quoted font names containing commas.
  function repair(value) {
    const parts = value.match(/(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,])+/g) || [];
    const out = [];
    for (const part of parts) {
      const token = part.trim();
      const name = token.replace(/^(["'])(.*)\1$/, '$2').toLowerCase();
      if (broken.has(name) && out[out.length - 1] !== '"' + family + '"') {
        out.push('"' + family + '"');
      }
      out.push(token);
    }
    return out.join(', ');
  }
  function declaration(style) {
    if (!style) return;
    const before = style.getPropertyValue('font-family');
    if (!before || !aliases.some(alias => before.toLowerCase().includes(alias))) return;
    const after = repair(before);
    if (before !== after) style.setProperty('font-family', after, style.getPropertyPriority('font-family'));
  }
  function rules(sheet) {
    let list;
    try { list = sheet.cssRules; } catch (_) { return; }
    if (!list) return;
    for (const rule of list) {
      // @font-face declares site font identities: never rewrite those descriptors.
      if (rule.type === 5) continue;
      declaration(rule.style);
      if (rule.styleSheet) rules(rule.styleSheet); // @import
      else if (rule.cssRules) rules(rule); // @media, @supports, keyframes, layers
    }
  }
  const style = document.createElement('style');
  style.textContent = '@font-face{font-family:"' + family + '";src:url("/_relayune/compat/cjk.woff2") format("woff2");font-display:swap;unicode-range:U+2E80-9FFF,U+F900-FAFF,U+FE30-FE4F,U+FF00-FFEF,U+20000-323AF}';
  document.head.append(style);
  let scheduled = false;
  function apply() {
    scheduled = false;
    for (const sheet of document.styleSheets) rules(sheet);
    for (const sheet of document.adoptedStyleSheets || []) rules(sheet);
    for (const element of document.querySelectorAll('[style]')) declaration(element.style);
  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(apply); }
  }
  const observer = new MutationObserver(schedule);
  function observe() {
    observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['style']});
  }
  observe();
  document.addEventListener('load', schedule, true);
  document.addEventListener('DOMContentLoaded', schedule);
  // CSSOM insertRule/replace/style assignments don't emit DOM mutations. Revisit
  // only in the affected WebKit environment, without overriding browser APIs.
  const poll = () => { if (!document.hidden) schedule(); };
  let timer = setInterval(poll, 1000);
  addEventListener('pagehide', () => { clearInterval(timer); observer.disconnect(); });
  addEventListener('pageshow', event => {
    if (event.persisted) { observe(); timer = setInterval(poll, 1000); schedule(); }
  });
  apply();
})();
