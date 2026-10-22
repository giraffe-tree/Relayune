import 'dart:async';
import 'package:relayune_mobile/src/ui/notification_permission_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/notifications/notification_coordinator.dart';

import '../support/workbench_fixture.dart';

void main() {
  testWidgets(
    '[MOB-NOT-007][flutter] approval and Agent notifications open the conversation workspace',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);

      controller.requestWorkbenchTarget('approvals');
      await tester.pump();
      expect(controller.pendingWorkbenchTarget, 'conversation');
      expect(
        find.byKey(const ValueKey('workbench-context-header')),
        findsOneWidget,
      );
      expect(find.byType(IndexedStack), findsNothing);

      controller.requestWorkbenchTarget('agents');
      await tester.pump();
      expect(controller.pendingWorkbenchTarget, 'agents');
      expect(
        find.byKey(const ValueKey('workbench-context-header')),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    '[MOB-NOT-008][flutter] visual primer explains value before explicit system permission request',
    (tester) async {
      final manager = _FakeNotificationManager();
      final controller = workbenchController(notificationManager: manager);
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller, size: const Size(320, 568));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(
        find.byKey(const ValueKey('notification-primer-primary')),
        findsNothing,
      );
      unawaited(
        showNotificationPermissionPrimer(
          tester.element(find.byKey(const ValueKey('workbench-scaffold'))),
          controller,
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(manager.requests, 0);
      expect(find.text('任务在电脑跑，你不必一直盯着'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('notification-primer-real-image')),
        findsOneWidget,
      );
      expect(find.textContaining('先看回复摘要'), findsOneWidget);
      final primary = find.byKey(const ValueKey('notification-primer-primary'));
      expect(primary.hitTestable(), findsOneWidget);
      expect(tester.getRect(primary).bottom, lessThanOrEqualTo(568));
      await tester.tap(primary);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(manager.requests, 1);
      expect(
        controller.notificationAuthorization,
        RelayNotificationAuthorization.enabled,
      );
    },
  );

  testWidgets(
    '[MOB-NOT-016][flutter] denied primer offers a direct route to system notification settings',
    (tester) async {
      final manager = _FakeNotificationManager(grantPermission: false);
      final controller = workbenchController(notificationManager: manager);
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(
        find.byKey(const ValueKey('notification-primer-primary')),
        findsNothing,
      );
      unawaited(
        showNotificationPermissionPrimer(
          tester.element(find.byKey(const ValueKey('workbench-scaffold'))),
          controller,
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      final primary = find.byKey(const ValueKey('notification-primer-primary'));
      await tester.ensureVisible(primary);
      await tester.tap(primary);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.text('前往系统设置'), findsOneWidget);

      await tester.ensureVisible(primary);
      await tester.tap(primary);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(manager.settingsOpens, 1);
    },
  );
}

class _FakeNotificationManager implements RelayNotificationManager {
  _FakeNotificationManager({this.grantPermission = true});

  final bool grantPermission;
  int requests = 0;
  int settingsOpens = 0;
  final List<Locale> locales = [];

  @override
  RelayNotificationAuthorization authorization =
      RelayNotificationAuthorization.disabled;

  @override
  void setLocale(Locale locale) {
    locales.add(locale);
  }

  @override
  Future<RelayNotificationAuthorization> refreshAuthorization() async =>
      authorization;

  @override
  Future<RelayNotificationAuthorization> requestAuthorization() async {
    requests += 1;
    return authorization = grantPermission
        ? RelayNotificationAuthorization.enabled
        : RelayNotificationAuthorization.disabled;
  }

  @override
  Future<void> openSettings() async {
    settingsOpens += 1;
  }
}
