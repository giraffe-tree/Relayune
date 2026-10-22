import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';

import '../support/workbench_fixture.dart';

void main() {
  test(
    'persisted notices use the event session Agent, never the protocol name',
    () {
      for (final entry in {
        'claude': 'Claude Code',
        'codex': 'Codex',
        'kimi': 'Kimi Code',
      }.entries) {
        final controller = workbenchController(
          sessions: [relaySession(provider: entry.key)],
        );
        addTearDown(controller.dispose);
        // No network is configured: this is the decrypted legacy-named event.
        controller.applyEventForTesting(
          RelayEvent(
            cursor: 1,
            eventId: 'persisted-${entry.key}',
            sessionId: 'root',
            agentId: null,
            createdAt: '2026-09-09T00:00:00Z',
            event: {
              'kind': 'codex.persisted',
              'operation': 'thread',
              'persisted': true,
            },
          ),
        );
        expect(controller.notice, '会话已写入 ${entry.value}。');
        controller.notice = '';
        controller.applyEventForTesting(
          RelayEvent(
            cursor: 2,
            eventId: 'background',
            sessionId: 'other',
            agentId: null,
            createdAt: '2026-09-09T00:00:01Z',
            event: {
              'kind': 'codex.persisted',
              'operation': 'thread',
              'persisted': true,
              'provider': 'codex',
            },
          ),
        );
        expect(controller.notice, isEmpty);
      }
    },
  );

  testWidgets(
    'Agent label stays separate from the configured model when switching sessions',
    (tester) async {
      RelaySession configured(String id, String provider, String model) =>
          RelaySession.fromJson({
            ...relaySession(id: id, provider: provider).raw,
            'model': model,
            'session_config_options': [
              {
                'id': 'model',
                'type': 'select',
                'currentValue': model,
                'options': [
                  {'value': model, 'name': model},
                ],
              },
            ],
          });
      final controller = workbenchController(
        sessions: [
          configured('claude', 'claude', 'kimi-for-coding'),
          configured('codex', 'codex', 'gpt-test'),
          configured('kimi', 'kimi', 'kimi-test'),
        ],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      expect(find.text('Claude Code · kimi-for-coding'), findsOneWidget);
      await controller.selectSession('codex');
      await tester.pump();
      expect(find.text('Codex · gpt-test'), findsOneWidget);
      expect(find.text('Claude Code · kimi-for-coding'), findsNothing);
      await controller.selectSession('kimi');
      await tester.pump();
      expect(
        find.byKey(const ValueKey('session-model-settings-button')),
        findsNothing,
      );
      await controller.selectSession('claude');
      await tester.pump();
      expect(find.text('Claude Code · kimi-for-coding'), findsOneWidget);
    },
  );
}
