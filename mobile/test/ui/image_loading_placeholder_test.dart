import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/widgets/image_loading_placeholder.dart';

void main() {
  Widget scene(DownloadProgress progress, {bool reducedMotion = false}) =>
      MaterialApp(
        locale: const Locale('zh', 'CN'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: relayuneSupportedLocales,
        home: MediaQuery(
          data: MediaQueryData(disableAnimations: reducedMotion),
          child: Scaffold(
            body: Center(
              child: ImageLoadingPlaceholder(
                progress: progress,
                indicatorKey: const ValueKey('progress'),
              ),
            ),
          ),
        ),
      );

  testWidgets(
    'queued SVG and active sweep are distinct with identical square bounds',
    (tester) async {
      await tester.pumpWidget(
        scene(const DownloadProgress(0, null, waiting: true)),
      );
      await tester.pump();
      final bounds = tester.getSize(find.byType(ImageLoadingPlaceholder));
      expect(bounds, const Size.square(120));
      expect(find.text('等待加载'), findsOneWidget);
      expect(find.byKey(const ValueKey('image-wait-svg')), findsOneWidget);
      expect(find.byKey(const ValueKey('image-loading-sweep')), findsNothing);
      expect(find.byType(LinearProgressIndicator), findsNothing);
      expect(find.text('0%'), findsNothing);
      await tester.pump(const Duration(milliseconds: 500));
      await tester.pumpWidget(scene(const DownloadProgress(200, 1000)));
      expect(tester.getSize(find.byType(ImageLoadingPlaceholder)), bounds);
      expect(find.text('20%'), findsOneWidget);
      expect(find.byKey(const ValueKey('image-wait-svg')), findsNothing);
      expect(find.byKey(const ValueKey('image-loading-sweep')), findsOneWidget);
      expect(
        tester
            .widget<LinearProgressIndicator>(
              find.byKey(const ValueKey('progress')),
            )
            .value,
        .2,
      );
      await tester.pump(const Duration(milliseconds: 500));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'reduced motion stops artwork animation while progress stays accurate',
    (tester) async {
      await tester.pumpWidget(
        scene(const DownloadProgress(700, 1000), reducedMotion: true),
      );
      await tester.pumpAndSettle();
      expect(find.text('70%'), findsOneWidget);
      expect(tester.binding.hasScheduledFrame, isFalse);
      await tester.pumpWidget(
        scene(
          const DownloadProgress(0, null, waiting: true),
          reducedMotion: true,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('等待加载'), findsOneWidget);
      expect(tester.binding.hasScheduledFrame, isFalse);
      expect(tester.takeException(), isNull);
    },
  );
}
