import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/ui/pairing_scanner_screen.dart';

void main() {
  test('scanner stops off-screen and does not auto-start on resume', () {
    bool mustStop(AppLifecycleState state, {bool permitted = true}) =>
        scannerMustStopForLifecycle(state, hasCameraPermission: permitted);

    expect(mustStop(AppLifecycleState.resumed), isFalse);
    expect(mustStop(AppLifecycleState.inactive), isTrue);
    expect(
      mustStop(AppLifecycleState.inactive, permitted: false),
      isFalse,
      reason: 'the first permission sheet must not hide its denial fallback',
    );
    expect(mustStop(AppLifecycleState.paused, permitted: false), isTrue);
    expect(mustStop(AppLifecycleState.hidden, permitted: false), isTrue);
    expect(mustStop(AppLifecycleState.detached, permitted: false), isTrue);
  });

  testWidgets('camera failure offers a manual-connection return path', (
    tester,
  ) async {
    var returned = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PairingCameraUnavailable(onClose: () => returned = true),
        ),
      ),
    );

    expect(find.textContaining('允许 Relayune 访问相机'), findsOneWidget);
    expect(find.textContaining('手动连接'), findsOneWidget);
    await tester.tap(find.text('返回'));
    expect(returned, isTrue);
  });
}
