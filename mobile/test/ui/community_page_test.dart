import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/network/community_api.dart';
import 'package:relayune_mobile/src/ui/community_page.dart';

class FakeCommunityApi extends CommunityApi {
  int calls = 0;
  bool fail = false;
  late CommunityQr qr;
  @override
  Future<CommunityQr> load() async {
    calls++;
    if (fail) throw Exception('offline');
    return qr;
  }
}

void main() {
  final png = File(
    '../public/community/assets/wechat-group-d0e56e76985d54f2.png',
  ).readAsBytesSync();
  CommunityQr qr(DateTime expiresAt) => CommunityQr(
    expiresAt: expiresAt,
    imageUri: Uri.parse(
      'https://relayune.giraffetree.cn/community/assets/wechat-group-test.png',
    ),
    bytes: png,
  );

  testWidgets(
    'native QR display, saves original bytes and refreshes after expiry/error',
    (tester) async {
      final api = FakeCommunityApi()
        ..qr = qr(DateTime.now().add(const Duration(days: 3)));
      addTearDown(api.close);
      final saved = <MethodCall>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        const MethodChannel('gal'),
        (call) async {
          if (call.method == 'hasAccess' || call.method == 'requestAccess') {
            return true;
          }
          saved.add(call);
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          const MethodChannel('gal'),
          null,
        ),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: CommunityPage(locale: const Locale('zh'), api: api),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(Image), findsOneWidget);
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('community-save')),
        300,
      );
      await tester.tap(find.byKey(const ValueKey('community-save')));
      await tester.pumpAndSettle();
      expect(saved.single.method, 'putImageBytes');
      expect(saved.single.arguments['bytes'], png);
      api.qr = qr(DateTime.utc(2020));
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('community-refresh')),
        200,
      );
      await tester.tap(find.byKey(const ValueKey('community-refresh')));
      await tester.pumpAndSettle();
      expect(find.byType(Image), findsNothing);
      expect(find.text('群二维码已过期，正在等待更新。'), findsOneWidget);
      api.fail = true;
      await tester.tap(find.byKey(const ValueKey('community-refresh')));
      await tester.pumpAndSettle();
      expect(find.textContaining('请检查网络'), findsOneWidget);
      api.fail = false;
      api.qr = qr(DateTime.now().add(const Duration(days: 3)));
      await tester.tap(find.byKey(const ValueKey('community-refresh')));
      await tester.pumpAndSettle();
      expect(find.byType(Image), findsOneWidget);
      final beforeTimer = api.calls;
      await tester.pump(const Duration(minutes: 1));
      await tester.pumpAndSettle();
      expect(api.calls, greaterThan(beforeTimer));
      final beforeResume = api.calls;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(api.calls, greaterThan(beforeResume));
      await tester.pumpWidget(const SizedBox());
    },
  );
}
