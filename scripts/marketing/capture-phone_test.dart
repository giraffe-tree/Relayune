// Explicit developer capture command; not part of the App or default test suite.
// Renders the production Flutter WorkbenchScreen with a reviewed public fixture.
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/ui/font_size_scope.dart';
import 'package:relayune_mobile/src/ui/theme.dart';
import 'package:relayune_mobile/src/ui/workbench_screen.dart';

import '../../mobile/test/support/workbench_fixture.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final task =
      jsonDecode(
            File('../scripts/marketing/font-size-task.json').readAsStringSync(),
          )
          as Map<String, dynamic>;
  final stages = task['stages'] as List;
  final records = task['messages'] as List;
  setUpAll(() async {
    // Widget tests otherwise use Ahem. Load the host's real iOS/CJK typefaces;
    // fonts are never copied into the public artifacts or distributed.
    final cjkPath = Platform.environment['CAPTURE_CJK_FONT'];
    if (cjkPath == null)
      throw StateError('Set CAPTURE_CJK_FONT to a local PingFang font.');
    for (final family in [
      'CupertinoSystemText',
      'CupertinoSystemDisplay',
      '.SF UI Text',
      '.SF UI Display',
      'Roboto',
    ]) {
      final loader = FontLoader(family)
        ..addFont(
          Future.value(
            ByteData.sublistView(
              File('/System/Library/Fonts/SFNS.ttf').readAsBytesSync(),
            ),
          ),
        )
        ..addFont(
          Future.value(ByteData.sublistView(File(cjkPath).readAsBytesSync())),
        );
      await loader.load();
    }
    final icons = FontLoader('MaterialIcons')
      ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await icons.load();
    final text = FontLoader('CaptureText')
      ..addFont(
        Future.value(ByteData.sublistView(File(cjkPath).readAsBytesSync())),
      );
    await text.load();
    final mono = FontLoader('monospace')
      ..addFont(
        Future.value(
          ByteData.sublistView(
            File('/System/Library/Fonts/SFNSMono.ttf').readAsBytesSync(),
          ),
        ),
      )
      ..addFont(
        Future.value(ByteData.sublistView(File(cjkPath).readAsBytesSync())),
      );
    await mono.load();
  });
  for (var index = 0; index < stages.length; index++) {
    final stage = stages[index] as Map<String, dynamic>;
    testWidgets('capture production phone UI: ${stage['id']}', (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final count = stage['messageCount'] as int;
      final controller = workbenchController(
        sessions: [
          RelaySession.fromJson({
            'id': 'font-size',
            'name': task['title'],
            'project': task['project'],
            'cwd': '/Projects/Relayune',
            'branch': '',
            'provider': 'codex',
            'status': 'idle',
            'updated_at': records[count - 1]['created_at'],
          }),
        ],
      );
      addTearDown(controller.dispose);
      controller.messages['font-size'] = records
          .take(count)
          .map(
            (record) => RelayMessage.fromHistory({
              ...Map<String, dynamic>.from(record as Map),
              'kind': 'message',
              'turn_id': 'font-size-turn',
            }),
          )
          .toList();
      final boundaryKey = GlobalKey();
      await tester.pumpWidget(
        RepaintBoundary(
          key: boundaryKey,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            locale: const Locale('zh', 'CN'),
            supportedLocales: relayuneSupportedLocales,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            theme: RelayTheme.webFor(usesIosSimulatorEmojiFallback: true)
                .copyWith(
                  textTheme: RelayTheme.web.textTheme.apply(
                    fontFamily: 'CaptureText',
                    fontFamilyFallback: ['CaptureText'],
                  ),
                  primaryTextTheme: RelayTheme.web.primaryTextTheme.apply(
                    fontFamily: 'CaptureText',
                    fontFamilyFallback: ['CaptureText'],
                  ),
                ),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                padding: const EdgeInsets.only(top: 48, bottom: 24),
                viewPadding: const EdgeInsets.only(top: 48, bottom: 24),
                disableAnimations: true,
              ),
              child: FontSizeScope(
                fontSize: controller.fontSizeListenable,
                child: child!,
              ),
            ),
            home: WorkbenchScreen(controller: controller),
          ),
        ),
      );
      for (var frame = 0; frame < 20; frame++) {
        await tester.pump(const Duration(milliseconds: 50));
      }
      if (index == 1 || index == 2) {
        final header = find.byWidgetPredicate(
          (widget) => widget.key.toString().contains('turn-activity-header-'),
        );
        if (header.evaluate().isNotEmpty) {
          await tester.tap(header.first);
          for (var frame = 0; frame < 10; frame++) {
            await tester.pump(const Duration(milliseconds: 50));
          }
        }
      }
      expect(
        find.byKey(const ValueKey('workbench-context-header')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('composer-send-button')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
      final boundary =
          boundaryKey.currentContext!.findRenderObject()!
              as RenderRepaintBoundary;
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 3);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File('../work/marketing-capture/phone-${stage['id']}.png');
        await file.parent.create(recursive: true);
        await file.writeAsBytes(bytes!.buffer.asUint8List());
        image.dispose();
      });
      await tester.pumpWidget(const SizedBox.shrink());
      debugDefaultTargetPlatformOverride = null;
    });
  }
}
