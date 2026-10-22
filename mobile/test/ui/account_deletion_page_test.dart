import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/ui/account_deletion_page.dart';

class _Controller extends AppController {
  final Completer<void> result = Completer<void>();
  int calls = 0;
  String? password;
  @override
  Future<void> deleteAccount(String value) {
    calls++;
    password = value;
    return result.future;
  }
}

void main() {
  testWidgets(
    'deletion explains scope, requires password and prevents duplicate requests',
    (tester) async {
      final controller = _Controller()..email = 'review@example.com';
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('en'),
          supportedLocales: relayuneSupportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: AccountDeletionPage(controller: controller),
        ),
      );
      expect(
        find.byKey(const ValueKey('account-deletion-subscriptions')),
        findsNothing,
      );
      final confirm = find.byKey(const ValueKey('account-deletion-confirm'));
      expect(tester.widget<FilledButton>(confirm).onPressed, isNull);
      await tester.enterText(
        find.byKey(const ValueKey('account-deletion-password')),
        'test-password',
      );
      await tester.pump();
      await tester.ensureVisible(confirm);
      await tester.pumpAndSettle();
      await tester.tap(confirm);
      await tester.pump();
      expect(controller.calls, 1);
      expect(controller.password, 'test-password');
      expect(tester.widget<FilledButton>(confirm).onPressed, isNull);
      controller.result.completeError(
        const RelayApiException('wrong', 401, 'invalid_credentials'),
      );
      await tester.pumpAndSettle();
      expect(
        find.text('Incorrect password. Please try again.'),
        findsOneWidget,
      );
      expect(tester.widget<FilledButton>(confirm).onPressed, isNotNull);
      expect(find.byType(AccountDeletionPage), findsOneWidget);
    },
  );
}
