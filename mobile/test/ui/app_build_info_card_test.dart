import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/build_provenance.dart';
import 'package:relayune_mobile/src/ui/app_build_info_card.dart';

void main() {
  test(
    'missing provenance stays unknown instead of inventing a build date',
    () {
      const missing = BuildProvenance(builtAt: '', sourceCommit: '');
      expect(missing.localBuildTime, isNull);
      expect(missing.shortCommit, isNull);
      const invalid = BuildProvenance(
        builtAt: 'not-a-date',
        sourceCommit: 'stale',
      );
      expect(invalid.localBuildTime, isNull);
      expect(invalid.shortCommit, isNull);
      expect(
        BuildProvenance.formatBuildTime(DateTime.utc(2026, 9, 9, 4, 25, 30)),
        '2026-09-09 04:25:30 UTC+00:00',
      );
    },
  );

  for (final locale in [
    const Locale('zh', 'CN'),
    const Locale('en'),
    const Locale('ar'),
  ]) {
    testWidgets('build details remain readable at narrow width in $locale', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(320, 700);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      const provenance = BuildProvenance(
        builtAt: '2026-09-09T04:25:30.000Z',
        sourceCommit: '4983a8b83a574a0594293917c12c7ba187afef3e',
        sourceDirty: true,
      );
      await tester.pumpWidget(
        MaterialApp(
          locale: locale,
          supportedLocales: relayuneSupportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(1.3)),
            child: child!,
          ),
          home: Scaffold(
            body: SingleChildScrollView(
              child: AppBuildInfoCard(
                provenance: provenance,
                loadVersion: () async => '0.3.21+31',
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final copy = relayuneLocalizationsFor(locale);
      expect(find.text(copy.settingsBuildInfo), findsOneWidget);
      expect(find.text('Relayune 0.3.21+31'), findsOneWidget);
      expect(find.text('4983a8b'), findsOneWidget);
      expect(find.text(provenance.localBuildTime!), findsOneWidget);
      expect(find.text(copy.buildUncommitted), findsOneWidget);
      await tester.pump(const Duration(hours: 1));
      expect(find.text(provenance.localBuildTime!), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets(
    'direct builds and unavailable package info show explicit fallbacks',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: relayuneSupportedLocales,
          home: Scaffold(
            body: AppBuildInfoCard(
              provenance: const BuildProvenance(builtAt: '', sourceCommit: ''),
              loadVersion: () async => throw StateError('not available'),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Not recorded'), findsNWidgets(2));
      expect(find.text('Relayune Not recorded'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
