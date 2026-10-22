import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/network/local_web_progress.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/ui/local_web_loading.dart';
import 'package:relayune_mobile/src/ui/theme.dart';

Widget app(
  Widget child, {
  Locale locale = const Locale('zh'),
  double scale = 1,
}) => MaterialApp(
  theme: RelayTheme.web,
  locale: locale,
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
    child: child!,
  ),
  home: Scaffold(body: child),
);

void main() {
  testWidgets(
    'resource rows show real reception, unknown sizes and HTTP failure',
    (tester) async {
      final progress = LocalWebLoadProgress()..begin(1);
      addTearDown(progress.dispose);
      for (var id = 1; id <= 3; id++) {
        progress.observe(
          LocalWebResourceProgress(
            id: id,
            epoch: 1,
            path: '/assets/file$id.js',
            phase: LocalWebResourcePhase.waiting,
          ),
        );
      }
      progress.observe(
        progress.resources[0].withPhase(
          LocalWebResourcePhase.receiving,
          download: const DownloadProgress(63, 100),
        ),
      );
      progress.observe(
        progress.resources[1].withPhase(
          LocalWebResourcePhase.receiving,
          download: const DownloadProgress(2048, null),
        ),
      );
      progress.observe(
        progress.resources[2].withPhase(
          LocalWebResourcePhase.failed,
          statusCode: 404,
        ),
      );
      await tester.pumpWidget(
        app(
          LocalWebResourceSheet(progress: progress, address: 'localhost:3000'),
        ),
      );
      expect(find.text('63%'), findsOneWidget);
      expect(find.text('2.0 KB'), findsOneWidget);
      expect(find.text('HTTP 404'), findsOneWidget);
      expect(find.text('0 项已取回 · 2 项进行中'), findsOneWidget);
      expect(find.text('1 项失败'), findsOneWidget);
      expect(tester.takeException(), isNull);
      progress.stop();
      progress.stop();
      await tester.pumpWidget(const SizedBox());
    },
  );

  for (final locale in [const Locale('zh'), const Locale('ar')]) {
    testWidgets(
      'opening and details fit narrow screens with large text (${locale.languageCode})',
      (tester) async {
        tester.view.physicalSize = const Size(320, 640);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(
          app(
            const LocalWebOpening(
              status: 'Connecting…',
              address: 'localhost:3000',
              elapsed: Duration(seconds: 2),
            ),
            locale: locale,
            scale: 1.6,
          ),
        );
        expect(tester.takeException(), isNull);
        final progress = LocalWebLoadProgress()..begin(1);
        addTearDown(progress.dispose);
        progress.observe(
          const LocalWebResourceProgress(
            id: 1,
            epoch: 1,
            path: '/assets/a-very-long-file-name-with-several-sections.js',
            phase: LocalWebResourcePhase.waiting,
          ),
        );
        await tester.pumpWidget(
          app(
            LocalWebResourceSheet(
              progress: progress,
              address: '127.0.0.1:8766',
            ),
            locale: locale,
            scale: 1.6,
          ),
        );
        expect(tester.takeException(), isNull);
        final path = tester.widget<Directionality>(
          find
              .ancestor(
                of: find.text(
                  '/assets/a-very-long-file-name-with-several-sections.js',
                ),
                matching: find.byType(Directionality),
              )
              .first,
        );
        expect(path.textDirection, TextDirection.ltr);
        progress.stop();
        progress.stop();
        await tester.pumpWidget(const SizedBox());
      },
    );
  }
}
