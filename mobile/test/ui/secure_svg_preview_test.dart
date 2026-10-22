import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/ui/secure_svg_preview.dart';

void main() {
  const animatedSvg = '''
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <style>
    .rotor { animation: spin 2.8s infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
  <g class="rotor"><path d="M0 0h10v10z"/></g>
</svg>
''';

  test('[MOB-ATT-009] animated SVG uses a secure image document', () {
    expect(isSafeSvgPreviewSource(animatedSvg), isTrue);
    expect(hasSvgDeclarativeAnimation(animatedSvg), isTrue);

    final document = buildSvgPreviewDocument(animatedSvg);

    expect(document, contains('data:image/svg+xml;base64,'));
    expect(document, isNot(contains(animatedSvg)));
    expect(document, contains("default-src 'none'"));
    expect(document, contains("script-src 'none'"));
    expect(document, contains('connect-src \'none\''));
    expect(document, contains('child-src \'none\''));
    expect(document, contains('manifest-src \'none\''));
  });

  test('[MOB-ATT-009] Relayune wait SVG is accepted as declarative motion', () {
    final source = File(
      '../public/brand/relayune/relayune-eclipse-wait.svg',
    ).readAsStringSync();

    expect(isSafeSvgPreviewSource(source), isTrue);
    expect(hasSvgDeclarativeAnimation(source), isTrue);
    expect(
      shouldUseAnimatedSvgWebView(
        source,
        disableAnimations: false,
        webViewAvailable: true,
      ),
      isTrue,
    );
  });

  test('[MOB-ATT-009] reduced motion stays on the static vector renderer', () {
    expect(
      shouldUseAnimatedSvgWebView(
        animatedSvg,
        disableAnimations: false,
        webViewAvailable: true,
      ),
      isTrue,
    );
    expect(
      shouldUseAnimatedSvgWebView(
        animatedSvg,
        disableAnimations: true,
        webViewAvailable: true,
      ),
      isFalse,
    );
    expect(
      shouldUseAnimatedSvgWebView(
        '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>',
        disableAnimations: false,
        webViewAvailable: true,
      ),
      isFalse,
    );
  });

  test('[MOB-ATT-009] active and external SVG content is rejected', () {
    expect(
      isSafeSvgPreviewSource(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
      isFalse,
    );
    expect(
      isSafeSvgPreviewSource(
        '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/pixel.png"/></svg>',
      ),
      isFalse,
    );
    expect(
      isSafeSvgPreviewSource(
        '<svg xmlns="http://www.w3.org/2000/svg"><style>.x{fill:url(https://example.com/a)}</style></svg>',
      ),
      isFalse,
    );
    expect(
      isSafeSvgPreviewSource(
        '<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="href" values="#local;https://example.com/a"/></svg>',
      ),
      isFalse,
    );
    expect(
      isSafeSvgPreviewSource(
        '<svg xmlns="http://www.w3.org/2000/svg"></svg><meta content="refresh"/>',
      ),
      isFalse,
    );
    expect(
      isSafeSvgPreviewSource(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="urn:bad"><s:script/></svg>',
      ),
      isFalse,
    );
    expect(
      isSafeSvgPreviewSource(
        '<?xml-stylesheet href="https://example.com/a.css"?><svg xmlns="http://www.w3.org/2000/svg"></svg>',
      ),
      isFalse,
    );
    expect(
      isSafeSvgPreviewSource(
        '<svg xmlns="http://www.w3.org/2000/svg"><style>.x{fill:u\\72l(https://example.com/a)}</style></svg>',
      ),
      isFalse,
    );
  });
}
