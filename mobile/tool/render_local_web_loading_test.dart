import 'dart:io';
import 'dart:isolate';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/network/local_web_progress.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/ui/local_web_loading.dart';
import 'package:relayune_mobile/src/ui/theme.dart';

// Synthetic visual fixtures using the production widgets. No user webpage data.
Future<Directory> _flutterSdkRoot() async {
  final material = await Isolate.resolvePackageUri(
    Uri.parse('package:flutter/material.dart'),
  );
  if (material == null || material.scheme != 'file') {
    throw StateError('Cannot resolve the Flutter SDK from package:flutter.');
  }
  return File.fromUri(material).parent.parent.parent.parent;
}

void main() {
  testWidgets('render native webpage loading states', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.runAsync(() async {
      // A CJK font is required for these Chinese visual fixtures. It stays on
      // the contributor's machine and is not copied into the repository.
      final fontPath =
          Platform.environment['RELAYUNE_QA_FONT'] ??
          (Platform.isMacOS
              ? '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
              : null);
      if (fontPath == null || !File(fontPath).existsSync()) {
        throw StateError('Set RELAYUNE_QA_FONT to a local CJK TrueType font.');
      }
      final flutterSdk = await _flutterSdkRoot();
      final font = FontLoader('WebPreviewQA')
        ..addFont(File(fontPath).readAsBytes().then(ByteData.sublistView));
      await font.load();
      final icons = FontLoader('MaterialIcons')
        ..addFont(
          File(
            '${flutterSdk.path}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
          ).readAsBytes().then(ByteData.sublistView),
        );
      await icons.load();
    });
    final progress = LocalWebLoadProgress()..begin(1);
    addTearDown(progress.dispose);
    final paths = [
      '/',
      '/assets/app.css',
      '/assets/app.js',
      '/images/cover.webp',
      '/fonts/site.woff2',
    ];
    for (var index = 0; index < paths.length; index++) {
      progress.observe(
        LocalWebResourceProgress(
          id: index + 1,
          epoch: 1,
          path: paths[index],
          phase: LocalWebResourcePhase.waiting,
        ),
      );
    }
    for (final id in [1, 2]) {
      progress.observe(
        progress.resources
            .firstWhere((item) => item.id == id)
            .withPhase(LocalWebResourcePhase.complete),
      );
    }
    for (final entry in [(3, 63), (5, 28)]) {
      progress.observe(
        progress.resources
            .firstWhere((item) => item.id == entry.$1)
            .withPhase(
              LocalWebResourcePhase.receiving,
              download: DownloadProgress(entry.$2, 100),
            ),
      );
    }
    final key = GlobalKey();
    final theme = RelayTheme.web;
    Future<void> render(String name, Widget child) async {
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('zh'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          theme: theme.copyWith(
            textTheme: theme.textTheme.apply(fontFamily: 'WebPreviewQA'),
          ),
          home: RepaintBoundary(
            key: key,
            child: Scaffold(body: child),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 150));
      final boundary =
          key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 2);
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        final directory = Directory('../docs/design/local-web-loading')
          ..createSync(recursive: true);
        await File(
          '${directory.path}/$name.png',
        ).writeAsBytes(data!.buffer.asUint8List());
        image.dispose();
      });
    }

    await render(
      'opening',
      const LocalWebOpening(
        status: '正在获取网页…',
        address: 'localhost:3000',
        elapsed: Duration(milliseconds: 2100),
      ),
    );
    await render(
      'resources',
      Align(
        alignment: Alignment.bottomCenter,
        child: LocalWebResourceSheet(
          progress: progress,
          address: 'localhost:3000',
        ),
      ),
    );
    await render(
      'compact',
      Builder(
        builder: (context) => Column(
          children: [
            Expanded(
              child: LocalWebOpening(
                status: '正在获取网页…',
                address: 'localhost:3000',
                elapsed: const Duration(milliseconds: 2100),
              ),
            ),
            LocalWebStatusStrip(
              progress: progress,
              label: context.l10n.localWebResourceSummary(2, 3),
              busy: true,
              onTap: () {},
            ),
          ],
        ),
      ),
    );
    progress.stop();
    await tester.pumpWidget(const SizedBox());
  });
}
