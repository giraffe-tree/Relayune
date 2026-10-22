import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/widgets/waiting_status_icon.dart';

void main() {
  testWidgets('waiting moon rotates and respects reduced motion', (tester) async {
    Widget host(bool reduced) => MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(disableAnimations: reduced),
        child: const Center(child: WaitingStatusIcon(color: Colors.grey)),
      ),
    );
    await tester.pumpWidget(host(false));
    await tester.pump(const Duration(milliseconds: 700));
    final rotation = tester.widget<RotationTransition>(find.byType(RotationTransition));
    expect(rotation.turns.value, greaterThan(0));
    await tester.pumpWidget(host(true));
    await tester.pump(const Duration(seconds: 3));
    expect(rotation.turns.value, 0);
    expect(tester.binding.transientCallbackCount, 0);
    expect(tester.takeException(), isNull);
  });
}
