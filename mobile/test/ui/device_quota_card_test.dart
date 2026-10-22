import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/ui/device_agent_quota.dart';

void main() {
  ProviderUsageSnapshot usage(List<Map<String, dynamic>> windows) =>
      ProviderUsageSnapshot.fromJson({'quota_windows': windows});
  Future<void> pump(
    WidgetTester tester,
    Map<String, ProviderUsageSnapshot> data, {
    bool online = true,
    double scale = 1,
  }) async {
    tester.view.physicalSize = const Size(360, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('zh'),
        supportedLocales: relayuneSupportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        home: Scaffold(
          body: MediaQuery(
            data: MediaQueryData(textScaler: TextScaler.linear(scale)),
            child: SingleChildScrollView(
              child: Column(
                children: [
                  for (final provider in ['codex', 'claude', 'kimi'])
                    DeviceAgentQuota(
                      provider: provider,
                      usage: data[provider],
                      online: online,
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  testWidgets(
    'all three providers show compact usage with reset times but no update times',
    (tester) async {
      final now = DateTime.now();
      final windows = [
        for (final id in ['five_hour', 'seven_day'])
          {
            'id': id,
            'used_percent': id == 'five_hour' ? 25 : 75,
            'as_of': now.toIso8601String(),
            'resets_at': now.add(const Duration(days: 1)).toIso8601String(),
          },
      ];
      await pump(tester, {
        'codex': usage(windows),
        'claude': usage(windows),
        'kimi': usage(windows),
      });
      expect(find.text('5h 已用 25%'), findsNWidgets(3));
      expect(find.text('7d 已用 75%'), findsNWidgets(3));
      expect(find.byType(LinearProgressIndicator), findsNothing);
      expect(find.textContaining('重置'), findsNWidgets(6));
      expect(
        find.textContaining(RegExp(r'UTC[+-]\d{2}:\d{2}')),
        findsNWidgets(6),
      );
      expect(find.textContaining('更新于'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'unknown, expired and offline data are explicit at large text scale',
    (tester) async {
      final now = DateTime.now();
      await pump(
        tester,
        {
          'codex': usage([
            {
              'id': 'five_hour',
              'used_percent': 90,
              'resets_at': now
                  .subtract(const Duration(minutes: 1))
                  .toIso8601String(),
              'as_of': now.subtract(const Duration(hours: 1)).toIso8601String(),
            },
          ]),
        },
        online: false,
        scale: 1.5,
      );
      expect(find.byTooltip('5 小时 · 等待新额度'), findsOneWidget);
      expect(find.text('5h —'), findsNWidgets(3));
      expect(find.text('7d —'), findsNWidgets(3));
      expect(find.byType(LinearProgressIndicator), findsNothing);
      expect(find.textContaining('更新于'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
  test('older catalogs and malformed percentages do not become zero', () {
    expect(ProviderUsageSnapshot.fromJson({}).quotaWindows, isEmpty);
    for (final value in [null, -1, '20', double.nan]) {
      expect(
        ProviderQuotaWindow.fromJson({'used_percent': value}).usedPercent,
        isNull,
      );
    }
    expect(ProviderQuotaWindow.fromJson({'used_percent': 0}).usedPercent, 0);
  });
}
