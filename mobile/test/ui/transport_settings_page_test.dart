import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';
import 'package:relayune_mobile/src/ui/transport_settings_page.dart';

class _Store extends SecureStore {
  final saved = <bool>[];
  bool fail = false;
  @override
  Future<void> saveDirectReads(bool value) async {
    if (fail) throw StateError('storage unavailable');
    saved.add(value);
  }
}

void main() {
  testWidgets(
    'route selection persists, reports actual fallback and can switch back',
    (tester) async {
      final store = _Store();
      final controller = AppController(secureStore: store);
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: TransportSettingsPage(
            controller: controller,
            locale: const Locale('zh'),
          ),
        ),
      );
      expect(find.text('当前：服务器中转'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('transport-direct')));
      await tester.pump();
      expect(controller.directReadsEnabled, true);
      expect(store.saved, [true]);
      expect(find.text('当前使用服务器，请连接支持直连的 Desktop'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('transport-server')));
      await tester.pump();
      expect(controller.directReadsEnabled, false);
      expect(store.saved, [true, false]);
      store.fail = true;
      await tester.tap(find.byKey(const ValueKey('transport-direct')));
      await tester.pump();
      expect(controller.directReadsEnabled, false);
      expect(find.text('未能保存，请重试'), findsOneWidget);
    },
  );
}
