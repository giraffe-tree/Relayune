import 'dart:convert';

bool isLocalVisualizationNavigation(String value) {
  final uri = Uri.tryParse(value);
  return uri != null &&
      uri.scheme == 'about' &&
      !uri.hasQuery &&
      const {'blank', 'srcdoc'}.contains(uri.path);
}

String buildVisualizationPreviewDocument(
  String source, {
  String stylesheet = '',
  String iconScript = '',
  String cjkFontBase64 = '',
}) {
  final fontFace = cjkFontBase64.isEmpty
      ? ''
      : '''
@font-face{font-family:"Relayune Preview CJK";src:url(data:font/woff2;base64,$cjkFontBase64) format("woff2");font-display:swap;unicode-range:U+2000-9FFF,U+F900-FAFF,U+FF00-FFEF,U+20000-2FA1F}
''';
  const policy =
      "default-src 'none'; script-src 'unsafe-inline'; "
      "style-src 'unsafe-inline'; img-src data: blob:; font-src data:; "
      "media-src data: blob:; connect-src 'none'; object-src 'none'; "
      "worker-src 'none'; manifest-src 'none'; base-uri 'none'; "
      "form-action 'none'; frame-src 'none'";
  final frame =
      '''<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="$policy">
<style>$fontFace\n$stylesheet</style><script>$iconScript</script></head><body>
$source
<script>
if (${cjkFontBase64.isNotEmpty}) {
  // iOS Simulator WebKit may lack its CJK fallback. The bundled font covers
  // only CJK/punctuation, preserving the fragment's Latin and code fonts.
  function applyPreviewFont(root) {
    const elements = [root, ...root.querySelectorAll('*')];
    for (const element of elements) {
      if (!element.style) continue;
      const family = getComputedStyle(element).fontFamily;
      if (!family.includes('Relayune Preview CJK')) {
        element.style.fontFamily = '"Relayune Preview CJK",' + family;
      }
    }
  }
  applyPreviewFont(document.body);
  new MutationObserver(function(records) {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType === 1) applyPreviewFont(node);
    }
  }).observe(document.body, {childList:true,subtree:true});
}
if (globalThis.lucide) lucide.createIcons({attrs:{width:20,height:20}});
document.addEventListener('click', function(event) {
  const tab = event.target.closest('[role="tab"][aria-controls]');
  if (!tab || tab.disabled) return;
  const group = tab.closest('[role="tablist"]');
  if (!group) return;
  group.querySelectorAll('[role="tab"]').forEach(function(item) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.classList.toggle('active', selected);
    const panel = document.getElementById(item.getAttribute('aria-controls'));
    if (panel) panel.hidden = !selected;
  });
});
</script></body></html>''';
  final shellPolicy = policy.replaceFirst(
    "frame-src 'none'",
    "frame-src 'self'",
  );
  final encoded = const HtmlEscape().convert(frame);
  return '''<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="$shellPolicy">
<style>html,body{margin:0;height:100%;background:#111311}iframe{display:block;border:0;width:100%;height:100%}</style>
</head><body><iframe title="Visualization" sandbox="allow-scripts" referrerpolicy="no-referrer"
allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
srcdoc="$encoded"></iframe></body></html>''';
}
