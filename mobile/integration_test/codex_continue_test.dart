// Synthetic UI acceptance only. Uses no saved account, pairing or real history.
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/ui/theme.dart';
import 'package:relayune_mobile/src/ui/workbench_screen.dart';
import '../test/support/workbench_fixture.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'Codex interrupted and recoverable failed tasks continue without a new user message',
    (tester) async {
      for (final state in ['interrupted', 'failed']) {
        final api = _ContinueApi();
        final c =
            workbenchController(
                api: api,
                sessions: [
                  RelaySession.fromJson({
                    'id': 'root',
                    'name': '暂停与继续 · 合成验收',
                    'provider': 'codex',
                    'status': 'idle',
                    'continue_turn_id': 'stopped',
                    'capabilities': {'continue_supported': true},
                  }),
                ],
              )
              ..email = ''
              ..relayKey = RelayKey.import(
                base64UrlEncode(List<int>.filled(32, 13)).replaceAll('=', ''),
              );
        api.controller = c;
        c.messages['root'] = [
          RelayMessage(
            id: 'user',
            role: 'user',
            content: '请继续完成这个合成测试任务。',
            createdAt: DateTime.now().toUtc().toIso8601String(),
            kind: 'user.message',
            turnId: 'stopped',
          ),
          RelayMessage(
            id: 'stopped',
            role: 'system',
            content: state == 'interrupted' ? '任务已停止' : '模型暂时不可用',
            createdAt: DateTime.now().toUtc().toIso8601String(),
            kind: state == 'interrupted' ? 'turn.stopped' : 'turn.failed',
            turnId: 'stopped',
            turnStatus: state,
          ),
        ];
        // Preserve the simulator's real view metrics; unit-test viewport
        // overrides do not describe a native iOS surface.
        await tester.pumpWidget(
          MaterialApp(
            debugShowCheckedModeBanner: false,
            locale: c.locale,
            supportedLocales: relayuneSupportedLocales,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            theme: RelayTheme.webFor(usesIosSimulatorEmojiFallback: false),
            home: AnimatedBuilder(
              animation: c,
              builder: (_, _) => WorkbenchScreen(controller: c),
            ),
          ),
        );
        await tester.pump(const Duration(milliseconds: 300));
        expect(find.byTooltip('继续'), findsOneWidget);
        expect(
          find.byKey(const ValueKey('composer-continue-icon')),
          findsOneWidget,
        );
        await binding.takeScreenshot('continue-$state-before');
        await tester.tap(find.byKey(const ValueKey('composer-send-button')));
        for (var i = 0; i < 50 && api.payload == null; i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        expect(api.payload?['content'], '');
        expect(api.payload?['action'], 'continue');
        expect(api.payload?['expected_turn_id'], 'stopped');
        await tester.pump(const Duration(milliseconds: 200));
        expect(find.byTooltip('正在继续…'), findsOneWidget);
        await tester.tap(find.byKey(const ValueKey('composer-send-button')));
        expect(api.submissions, 1);
        await binding.takeScreenshot('continue-$state-pending');
        api.release.complete();
        for (var i = 0; i < 50 && c.isContinuingSession('root'); i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        await tester.pump(const Duration(milliseconds: 300));
        expect(
          c.messages['root']!.where((m) => m.role == 'user'),
          hasLength(1),
        );
        expect(
          c.messages['root']!.any((m) => m.kind == 'local.user.action'),
          isFalse,
        );
        expect(find.text('合成任务已继续并完成。'), findsOneWidget);
        expect(find.byTooltip('继续'), findsNothing);
        expect(c.isContinuingSession('root'), isFalse);
        // The reply reveal animation is intentionally live. Let its bounded
        // presentation finish before capturing the completed native surface.
        for (var i = 0; i < 12; i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        await binding.takeScreenshot('continue-$state-completed');
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        c.dispose();
      }
    },
  );
}

class _ContinueApi extends RelayApi {
  late AppController controller;
  Map<String, dynamic>? payload;
  int submissions = 0, sequence = 0;
  final release = Completer<void>();
  void emit(Map<String, dynamic> data) => controller.receiveLiveEventForTesting(
    RelayEvent(
      cursor: ++sequence,
      eventId: 'synthetic-$sequence',
      sessionId: 'root',
      agentId: null,
      createdAt: DateTime.now().toUtc().toIso8601String(),
      event: data,
    ),
  );
  @override
  Future<CommandResult> sendCommand({
    required String deviceId,
    required String? sessionId,
    required String requestId,
    required String commandType,
    required String createdAt,
    required String expiresAt,
    required RelayAad aad,
    required SealedEnvelope envelope,
  }) async {
    if (commandType != 'session.submit_message') {
      return CommandResult(requestId: requestId, delivery: 'delivered');
    }
    submissions++;
    final decoded = await RelayCipher().openJson<Map<String, dynamic>>(
      controller.relayKey!,
      envelope,
      aad,
    );
    payload = jsonMap(decoded['payload']);
    await release.future;
    emit({
      'kind': 'codex.persisted',
      'operation': 'turn',
      'action': 'continue',
      'accepted': true,
      'persisted': false,
      'turn_id': 'continued',
      'request_id': requestId,
      'client_message_id': payload!['client_message_id'],
    });
    emit({'kind': 'turn.started', 'turn_id': 'continued'});
    emit({
      'kind': 'message.completed',
      'turn_id': 'continued',
      'text': '合成任务已继续并完成。',
    });
    emit({
      'kind': 'turn.completed',
      'turn_id': 'continued',
      'status': 'completed',
      'continue_turn_id': null,
    });
    return CommandResult(requestId: requestId, delivery: 'delivered');
  }
}
