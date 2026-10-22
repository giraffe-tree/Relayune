import 'package:flutter/material.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/home_care.dart';
import 'package:relayune_mobile/src/ui/home_greeting.dart';
import 'package:relayune_mobile/src/ui/theme.dart';

import '../support/workbench_fixture.dart';

void main() {
  testWidgets(
    '[MOB-LAY-009][flutter] greeting crosses time boundaries and refreshes immediately on resume',
    (tester) async {
      var now = DateTime(2026, 9, 8, 22, 59);
      final controller = workbenchController(sessions: []);
      addTearDown(controller.dispose);
      await _pumpGreeting(tester, controller, () => now);
      expect(find.text('晚上好'), findsOneWidget);
      now = now.add(const Duration(minutes: 1));
      await tester.pump(const Duration(minutes: 1));
      expect(find.text('夜深了'), findsOneWidget);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      now = DateTime(2026, 9, 9, 9);
      await tester.pump(const Duration(hours: 10));
      expect(find.text('夜深了'), findsOneWidget);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(find.text('早上好'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'long-running task uses agent time and ignores offline catalog claims',
    (tester) async {
      final now = DateTime(2026, 9, 8, 15);
      final session = RelaySession.fromJson({
        'id': 'long',
        'status': 'active',
        'updated_at': now.toIso8601String(),
        'running_started_at': now
            .subtract(const Duration(hours: 2))
            .toIso8601String(),
      });
      final online = workbenchController(sessions: [session]);
      final offline = workbenchController(sessions: [session], online: false);
      addTearDown(online.dispose);
      addTearDown(offline.dispose);
      await _pumpGreeting(tester, online, () => now);
      expect(find.textContaining('等得有点久了'), findsOneWidget);
      expect(find.textContaining('忙了好一阵'), findsNothing);
      await _pumpGreeting(tester, offline, () => now);
      expect(find.textContaining('等得有点久了'), findsNothing);
      expect(find.textContaining('任务正在进行'), findsNothing);
    },
  );

  testWidgets(
    'malformed and future task timestamps cannot trigger long-work care',
    (tester) async {
      final now = DateTime(2026, 9, 8, 15);
      for (final start in [
        42,
        'invalid',
        now.add(const Duration(hours: 2)).toIso8601String(),
      ]) {
        final controller = workbenchController(
          sessions: [
            RelaySession.fromJson({
              'id': 'task',
              'status': 'active',
              'updated_at': now.toIso8601String(),
              'running_started_at': start,
            }),
          ],
        );
        addTearDown(controller.dispose);
        await _pumpGreeting(tester, controller, () => now);
        expect(find.textContaining('等得有点久了'), findsNothing);
        expect(tester.takeException(), isNull);
      }
    },
  );

  for (final option in relayuneLanguageOptions) {
    final locale = option.tag;
    testWidgets(
      'care remains readable on a narrow screen at 2x text in $locale',
      (tester) async {
        tester.view.physicalSize = const Size(320, 568);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final controller = workbenchController(sessions: []);
        addTearDown(controller.dispose);
        final now = DateTime(2026, 9, 8, 23);
        final activity = HomeCareActivity();
        for (var minute = 90; minute >= 0; minute--) {
          activity.interact(now.subtract(Duration(minutes: minute)));
        }
        await _pumpGreeting(
          tester,
          controller,
          () => now,
          locale: locale,
          textScale: 2,
          activity: activity,
        );
        final detail = tester.widget<Text>(
          find.byKey(const ValueKey('home-care-message')),
        );
        final l10n = relayuneLocalizationsFor(option.locale);
        expect(find.text(l10n.homeGreetingNight), findsOneWidget);
        expect(detail.data, l10n.homeCareLongBreak);
        final isRtl = const {'ar', 'ur'}.contains(option.locale.languageCode);
        expect(
          Directionality.of(tester.element(find.byType(HomeGreeting))),
          isRtl ? TextDirection.rtl : TextDirection.ltr,
        );
        final titleRect = tester.getRect(
          find.byKey(const ValueKey('home-greeting')),
        );
        final greetingRect = tester.getRect(find.byType(HomeGreeting));
        expect(
          isRtl ? titleRect.right : titleRect.left,
          closeTo(isRtl ? greetingRect.right : greetingRect.left, 0.01),
        );
        expect(detail.maxLines, isNull);
        expect(detail.overflow, isNull);
        expect(find.byType(AlertDialog), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'switching language preserves the current care context and activity',
    (tester) async {
      final now = DateTime(2026, 9, 8, 15);
      final activity = HomeCareActivity();
      for (var minute = 45; minute >= 0; minute--) {
        activity.interact(now.subtract(Duration(minutes: minute)));
      }
      final controller = workbenchController(sessions: []);
      addTearDown(controller.dispose);
      for (final locale in ['en', 'ar', 'ur', 'zh-CN']) {
        await _pumpGreeting(
          tester,
          controller,
          () => now,
          locale: locale,
          activity: activity,
        );
        final l10n = relayuneLocalizationsFor(relayuneLocaleForTag(locale)!);
        expect(find.text(l10n.homeCarePause), findsOneWidget);
        expect(activity.stretchAt(now), const Duration(minutes: 45));
      }
    },
  );
}

Future<void> _pumpGreeting(
  WidgetTester tester,
  AppController controller,
  DateTime Function() clock, {
  String locale = 'zh',
  double textScale = 1,
  HomeCareActivity? activity,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      locale: relayuneLocaleForTag(locale) ?? const Locale('zh', 'CN'),
      supportedLocales: relayuneSupportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      theme: RelayTheme.web,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: Scaffold(
        body: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: HomeGreeting(
              controller: controller,
              activity: activity ?? HomeCareActivity(),
              clock: clock,
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}
