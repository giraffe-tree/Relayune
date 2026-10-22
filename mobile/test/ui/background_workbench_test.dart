import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/workbench_fixture.dart';

void main() {
  testWidgets(
    'warm background retains composer and deep release restores its draft',
    (tester) async {
      final controller = workbenchController();
      await pumpWorkbench(tester, controller);
      await tester.enterText(
        find.byType(TextField).last,
        'Keep this unsent draft',
      );
      controller.setPresentationForeground(false);
      await tester.pump();
      expect(find.byType(TextField), findsWidgets);
      controller.releaseBackgroundMemory();
      await tester.pump();
      expect(find.byType(TextField), findsNothing);
      controller.setPresentationForeground(true);
      await pumpWorkbench(tester, controller);
      expect(
        tester.widget<TextField>(find.byType(TextField).last).controller!.text,
        'Keep this unsent draft',
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      controller.dispose();
    },
  );
}
