// Run with the loopback fixture: node tests/fixtures/webrtc-mobile-server.mjs
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';
import 'package:relayune_mobile/src/ui/transport_settings_page.dart';
import 'package:relayune_mobile/src/ui/theme.dart';
import '../test/support/workbench_fixture.dart';

class _Store extends SecureStore {
  @override
  Future<void> saveDirectReads(bool value) async {}
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'native session traffic bypasses HTTP, retries mutations once and switches pending reads',
    (tester) async {
      const origin = 'http://127.0.0.1:43197';
      await http.get(Uri.parse('$origin/reset'));
      final api = RelayApi(origin: origin)
        ..sessionToken = 'fixture'
        ..browserToken = 'fixture';
      final controller =
          workbenchController(
              baseController: AppController(api: api, secureStore: _Store()),
            )
            ..relayKey = RelayKey.import(
              base64Url.encode(List.filled(32, 7)).replaceAll('=', ''),
            )
            ..desktopInfo = const RelayDesktopInfo(
              supportsDirectReads: true,
              supportsAutomaticRoute: true,
            );
      addTearDown(controller.dispose);
      controller.startDirectRouteMonitoringForTesting();
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: RelayTheme.web,
          home: TransportSettingsPage(
            controller: controller,
            locale: const Locale('zh'),
          ),
        ),
      );
      await tester.tap(find.byKey(const ValueKey('transport-direct')));
      final deadline = DateTime.now().add(const Duration(seconds: 45));
      while (controller.directReadStatus != 'direct' &&
          DateTime.now().isBefore(deadline)) {
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(
        controller.directReadStatus,
        'direct',
        reason: controller.directReadFailureStage,
      );
      final command = await controller.sendEncryptedCommand(
        'session.read_history',
        'root',
        {},
      );
      expect(command.delivery, 'direct');
      final response = await controller.waitForEncryptedResponse(
        command.requestId,
      );
      expect(response['type'], 'session.history');
      expect(
        (response['messages'] as List).first['content'],
        'fixture-payload-' * 20000,
      );
      final attachmentBytes = await controller.loadAttachment(
        'root',
        const RelayAttachment(
          id: 'fixture_image',
          type: 'image',
          name: 'fixture.png',
          mimeType: 'image/png',
          url: '',
        ),
      );
      expect(
        base64Encode(attachmentBytes),
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=',
      );
      var metrics = jsonDecode(
        (await http.get(Uri.parse('$origin/metrics'))).body,
      );
      expect(metrics['httpReads'], 0);
      expect(metrics['httpResponses'], 0);
      final submitted = await controller
          .sendEncryptedCommand('session.submit_message', 'root', {
            'content': 'native-upload-' * 15000,
            'client_message_id': 'native_client_message',
          });
      expect(submitted.delivery, 'direct');
      final eventDeadline = DateTime.now().add(const Duration(seconds: 10));
      while (!(controller.messages['root'] ?? []).any(
            (m) => m.content.contains('native-upload-'),
          ) &&
          DateTime.now().isBefore(eventDeadline)) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(
        (controller.messages['root'] ?? [])
            .where((m) => m.content.contains('native-upload-'))
            .length,
        1,
      );
      final approval =
          jsonDecode((await http.get(Uri.parse('$origin/approval'))).body)
              as Map<String, dynamic>;
      final approved = await controller.sendEncryptedCommand(
        'approval.resolve',
        'root',
        approval,
      );
      expect(approved.delivery, 'direct');
      await tester.pump(const Duration(milliseconds: 500));
      metrics = jsonDecode((await http.get(Uri.parse('$origin/metrics'))).body);
      expect(metrics['mutations'], 1);
      expect(metrics['decisions'], 1);
      expect(metrics['httpReads'], 0);
      expect(metrics['httpEvents'], 0);
      // Lose the data channel after the mutation has executed but before its response.
      final configured = await controller.sendEncryptedCommand(
        'session.configure',
        'root',
        {'config_id': 'fixture', 'value': 'test'},
      );
      final configResult = await controller.waitForEncryptedResponse(
        configured.requestId,
        timeout: const Duration(seconds: 30),
      );
      expect(configResult['type'], 'session.configure_result');
      metrics = jsonDecode((await http.get(Uri.parse('$origin/metrics'))).body);
      expect(
        metrics['mutations'],
        2,
        reason: 'configuration must not execute again through HTTP',
      );
      final readsBefore = metrics['httpReads'] as int;
      final responsesBefore = metrics['httpResponses'] as int;
      final automaticDeadline = DateTime.now().add(const Duration(seconds: 50));
      while (controller.directReadStatus != 'direct' &&
          DateTime.now().isBefore(automaticDeadline)) {
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(
        controller.directReadStatus,
        'direct',
        reason: 'recover without a manual retry or business request',
      );
      final slow = await controller.sendEncryptedCommand(
        'session.read_history',
        'slow',
        {},
      );
      expect(slow.delivery, 'direct');
      await tester.tap(find.byKey(const ValueKey('transport-server')));
      await tester.pump();
      final recovered = await controller.waitForEncryptedResponse(
        slow.requestId,
        timeout: const Duration(seconds: 30),
      );
      expect(recovered['type'], 'session.history');
      expect(controller.directReadStatus, 'server');
      metrics = jsonDecode((await http.get(Uri.parse('$origin/metrics'))).body);
      expect(metrics['httpReads'], readsBefore + 1);
      expect(metrics['httpResponses'], responsesBefore + 1);
      await tester.pumpAndSettle();
      expect(find.text('当前：服务器中转'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('transport-direct')));
      final reconnectDeadline = DateTime.now().add(const Duration(seconds: 45));
      while (controller.directReadStatus != 'direct' &&
          DateTime.now().isBefore(reconnectDeadline)) {
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(
        controller.directReadStatus,
        'direct',
        reason: controller.directReadFailureStage,
      );
      final interrupted = await controller.sendEncryptedCommand(
        'session.read_history',
        'slow',
        {},
      );
      expect(interrupted.delivery, 'direct');
      await http.get(Uri.parse('$origin/drop'));
      final fallback = await controller.waitForEncryptedResponse(
        interrupted.requestId,
        timeout: const Duration(seconds: 35),
      );
      expect(fallback['type'], 'session.history');
      expect(controller.directReadsEnabled, isTrue);
      metrics = jsonDecode((await http.get(Uri.parse('$origin/metrics'))).body);
      expect(metrics['httpReads'], readsBefore + 2);
      expect(metrics['httpResponses'], responsesBefore + 2);
      final recoveryDeadline = DateTime.now().add(const Duration(seconds: 90));
      while (controller.directReadStatus != 'direct' &&
          DateTime.now().isBefore(recoveryDeadline)) {
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(controller.directReadStatus, 'direct');
      // The socket remains open, but encrypted round trips stop working.
      await http.get(Uri.parse('$origin/probe-mode?value=blackhole'));
      final lostDeadline = DateTime.now().add(const Duration(seconds: 25));
      while (controller.directReadStatus == 'direct' &&
          DateTime.now().isBefore(lostDeadline)) {
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(
        controller.directReadStatus,
        'fallback',
        reason: 'health monitoring must detect a silent black hole',
      );
      // A bogus, but encrypted, probe reply must not promote the candidate route.
      await http.get(Uri.parse('$origin/probe-mode?value=invalid'));
      controller.retryAutomaticRoute();
      await tester.pump(const Duration(milliseconds: 200));
      final invalidDeadline = DateTime.now().add(const Duration(seconds: 25));
      while (controller.directReadStatus == 'connecting' &&
          DateTime.now().isBefore(invalidDeadline)) {
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(controller.directReadStatus, 'fallback');
      await http.get(Uri.parse('$origin/probe-mode?value=ok'));
      final healthyDeadline = DateTime.now().add(const Duration(seconds: 180));
      while (controller.directReadStatus != 'direct' &&
          DateTime.now().isBefore(healthyDeadline)) {
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(
        controller.directReadStatus,
        'direct',
        reason: 'automatic recovery must not require a message or a tap',
      );
      await tester.tap(find.byKey(const ValueKey('transport-server')));
      await tester.pump(const Duration(milliseconds: 200));
      final probesBefore = jsonDecode(
        (await http.get(Uri.parse('$origin/metrics'))).body,
      )['probes'];
      await tester.pump(const Duration(seconds: 16));
      expect(controller.directReadStatus, 'server');
      expect(
        jsonDecode(
          (await http.get(Uri.parse('$origin/metrics'))).body,
        )['probes'],
        probesBefore,
      );
    },
  );
}
