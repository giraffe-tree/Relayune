import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';

import '../support/workbench_fixture.dart';
import '../support/codex_message_settings_fixture.dart';

RelaySession modelSession(String provider) => RelaySession.fromJson({
  ...relaySession(id: provider, provider: provider).raw,
  'session_config_options': [
    {
      'id': 'model',
      'type': 'select',
      'currentValue': 'first',
      'options': [
        {'value': 'first', 'name': 'Current model'},
        {'value': 'next', 'name': 'Next model'},
      ],
    },
    {
      'id': 'reasoning',
      'type': 'select',
      'currentValue': 'low',
      'options': [
        {'value': 'low', 'name': 'Low'},
        {'value': 'high', 'name': 'High'},
      ],
    },
  ],
});

void main() {
  testWidgets(
    'resumed Kimi settings become available through a live config event',
    (tester) async {
      final controller = workbenchController(
        sessions: [relaySession(id: 'kimi', provider: 'kimi')],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      final options = [
        {
          'id': 'model',
          'type': 'select',
          'currentValue': 'kimi-code/k3',
          'options': [
            {'value': 'kimi-code/k3', 'name': 'K3'},
          ],
        },
        {
          'id': 'thinking',
          'type': 'select',
          'currentValue': 'high',
          'options': [
            {'value': 'low', 'name': 'Low'},
            {'value': 'high', 'name': 'High'},
          ],
        },
      ];
      controller.receiveLiveEventForTesting(
        RelayEvent(
          cursor: 1,
          sourceSequence: 1,
          eventId: 'resumed-config',
          sessionId: 'kimi',
          agentId: null,
          createdAt: DateTime.now().toUtc().toIso8601String(),
          event: {
            'kind': 'session.config_updated',
            'provider': 'kimi',
            'config_options': options,
          },
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));
      expect(controller.sessions.single.raw['model'], 'kimi-code/k3');
      expect(controller.sessions.single.raw['reasoning_effort'], 'high');
      expect(controller.sessions.single.raw['kimi_config_options'], options);
      expect(controller.messages['kimi'] ?? [], isEmpty);
      expect(find.text('Thinking high'), findsOneWidget);
      await tester.ensureVisible(find.text('Thinking high'));
      await tester.tap(find.text('Thinking high'));
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.widgetWithText(OutlinedButton, 'High'), findsOneWidget);
      expect(
        tester
            .widget<OutlinedButton>(find.widgetWithText(OutlinedButton, 'Low'))
            .onPressed,
        isNotNull,
      );
      expect(tester.takeException(), isNull);
    },
  );

  for (final online in [true, false]) {
    testWidgets(
      '[MOB-PRJ-017] Codex model and effort select within one frame while running (online=$online)',
      (tester) async {
        final controller = workbenchController(
          online: online,
          sessions: [codexMessageSettingsSession()],
        );
        controller.runningSessions.add('codex');
        addTearDown(controller.dispose);
        await pumpWorkbench(tester, controller);
        await tester.enterText(
          find.byKey(const ValueKey('conversation-composer-input')),
          'Keep draft',
        );
        await tester.tap(
          find.byKey(const ValueKey('session-model-settings-button')),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        final next = find.byKey(const ValueKey('session-config-model-next'));
        await tester.tap(next);
        await tester.pump(const Duration(milliseconds: 16));
        expect(tester.widget<ChoiceChip>(next).selected, isTrue);
        expect(
          find.byKey(const ValueKey('session-config-reasoning-low')),
          findsNothing,
        );
        final medium = find.byKey(
          const ValueKey('session-config-reasoning-medium'),
        );
        expect(tester.widget<ChoiceChip>(medium).selected, isTrue);
        await tester.tap(
          find.byKey(const ValueKey('session-config-reasoning-high')),
        );
        await tester.pump(const Duration(milliseconds: 16));
        expect(
          tester
              .widget<ChoiceChip>(
                find.byKey(const ValueKey('session-config-reasoning-high')),
              )
              .selected,
          isTrue,
        );
        final manual = find.byKey(
          const ValueKey('session-config-permissions-manual'),
        );
        await tester.ensureVisible(manual);
        await tester.tap(manual);
        await tester.pump(const Duration(milliseconds: 16));
        expect(tester.widget<ChoiceChip>(manual).selected, isTrue);
        expect(find.text('下一条消息采用：Manual'), findsOneWidget);
        final full = find.byKey(
          const ValueKey('session-config-permissions-full'),
        );
        await tester.ensureVisible(full);
        await tester.tap(full);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        expect(find.byType(AlertDialog), findsOneWidget);
        await tester.tap(
          find
              .descendant(
                of: find.byType(AlertDialog),
                matching: find.byType(TextButton),
              )
              .first,
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        expect(tester.widget<ChoiceChip>(manual).selected, isTrue);
        await tester.tap(full);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        await tester.tap(
          find
              .descendant(
                of: find.byType(AlertDialog),
                matching: find.byType(FilledButton),
              )
              .first,
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        expect(tester.widget<ChoiceChip>(full).selected, isTrue);
        expect(controller.configuringSessions, isEmpty);
        expect(find.text('正在应用设置…'), findsNothing);
        if (online) expect(find.text('Keep draft'), findsOneWidget);
      },
    );
  }

  testWidgets(
    'Claude bootstrap settings fetch capabilities without a new turn',
    (tester) async {
      final capture = _ConfigController()
        ..refreshResult = modelSession('claude');
      final controller = workbenchController(
        baseController: capture,
        sessions: [
          RelaySession.fromJson({
            ...relaySession(id: 'claude', provider: 'claude').raw,
            'session_config_options': [
              {
                'id': 'permissions',
                'currentValue': 'inherit',
                'options': [
                  {'value': 'inherit', 'name': '沿用本机配置'},
                ],
              },
            ],
          }),
        ],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      await tester.tap(
        find.byKey(const ValueKey('session-model-settings-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(capture.historyRefreshes, ['claude']);
      expect(
        find.byKey(const ValueKey('session-config-model-next')),
        findsOneWidget,
      );
      expect(capture.configurations, isEmpty);
      expect(controller.activeSessionId, 'claude');
    },
  );

  testWidgets(
    'Codex unconfirmed permissions refresh when the settings sheet opens',
    (tester) async {
      final confirmed = RelaySession.fromJson({
        ...modelSession('codex').raw,
        'session_config_options': [
          {
            'id': 'permissions',
            'type': 'select',
            'currentValue': 'manual',
            'options': [
              {'value': 'manual', 'name': 'Manual'},
            ],
          },
        ],
      });
      final capture = _ConfigController()..refreshResult = confirmed;
      final controller = workbenchController(
        baseController: capture,
        sessions: [
          RelaySession.fromJson({
            ...modelSession('codex').raw,
            'session_config_options': [
              {
                'id': 'permissions',
                'type': 'select',
                'currentValue': 'unknown',
                'options': <Object>[],
              },
            ],
          }),
        ],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      await tester.tap(
        find.byKey(const ValueKey('session-model-settings-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(capture.historyRefreshes, ['codex']);
      expect(
        find.byKey(const ValueKey('session-config-permissions-manual')),
        findsOneWidget,
      );
      expect(capture.configurations, isEmpty);
    },
  );

  for (final (mode, locale, label) in [
    ('unknown', const Locale('zh', 'CN'), '权限待确认'),
    ('custom', const Locale('zh', 'CN'), '自定义权限'),
    ('unknown', const Locale('en'), 'Permissions unconfirmed'),
    ('custom', const Locale('en'), 'Custom permissions'),
  ]) {
    testWidgets(
      '[MOB-PRJ-017][flutter] $locale $mode permissions hide unconfirmed composer state and preserve sheet details',
      (tester) async {
        final capture = _ConfigController();
        final controller = workbenchController(
          baseController: capture,
          sessions: [
            RelaySession.fromJson({
              ...modelSession('codex').raw,
              'session_config_options': [
                ...modelSession('codex').raw['session_config_options'],
                {
                  'id': 'permissions',
                  'type': 'select',
                  'currentValue': mode,
                  'description': 'Open this conversation in Codex Desktop.',
                  'options': <Object>[],
                },
              ],
            }),
          ],
        );
        addTearDown(controller.dispose);
        controller.setLocale(locale);
        await pumpWorkbench(tester, controller);
        expect(
          find.text(
            mode == 'unknown'
                ? 'Codex · Current model · Low'
                : 'Codex · Current model · Low · $label',
          ),
          findsOneWidget,
        );
        await tester.tap(
          find.byKey(const ValueKey('session-model-settings-button')),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        expect(
          find.text(
            locale.languageCode == 'zh'
                ? '电脑端后续消息采用：$label'
                : 'Desktop permissions for future messages: $label',
          ),
          findsOneWidget,
        );
        expect(find.textContaining('unknown'), findsNothing);
        expect(
          find.text('Open this conversation in Codex Desktop.'),
          findsOneWidget,
        );
        expect(capture.configurations, isEmpty);
      },
    );
  }

  testWidgets(
    '[MOB-PRJ-017][flutter] Codex permissions show confirmed state and cancel full access without sending',
    (tester) async {
      final capture = _ConfigController();
      final controller = workbenchController(
        baseController: capture,
        sessions: [
          RelaySession.fromJson({
            ...modelSession('codex').raw,
            'session_config_options': [
              {
                'id': 'permissions',
                'type': 'select',
                'name': 'Permissions',
                'currentValue': 'manual',
                'description': 'Confirmed desktop permission policy',
                'options': [
                  {'value': 'manual', 'name': 'Manual'},
                  {'value': 'auto', 'name': 'Auto-review'},
                  {'value': 'full', 'name': 'Full access'},
                ],
              },
            ],
          }),
        ],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      await tester.tap(
        find.byKey(const ValueKey('session-model-settings-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      final manual = find.byKey(
        const ValueKey('session-config-permissions-manual'),
      );
      final full = find.byKey(
        const ValueKey('session-config-permissions-full'),
      );
      expect(tester.widget<ChoiceChip>(manual).selected, isTrue);
      await tester.tap(full);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(capture.configurations, isEmpty);
      expect(find.byType(AlertDialog), findsOneWidget);
      await tester.tap(
        find
            .descendant(
              of: find.byType(AlertDialog),
              matching: find.byType(TextButton),
            )
            .first,
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(capture.configurations, isEmpty);
      expect(tester.widget<ChoiceChip>(manual).selected, isTrue);
      await tester.tap(
        find.byKey(const ValueKey('session-config-permissions-auto')),
      );
      await tester.pump();
      expect(capture.configurations, [('permissions', 'auto')]);
      expect(tester.widget<ChoiceChip>(manual).selected, isTrue);
      capture.pending.complete();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
    },
  );

  testWidgets(
    '[MOB-PRJ-017][flutter] failed configuration stays visible in the sheet without selecting the failed model',
    (tester) async {
      final capture = _ConfigController()..failure = '电脑端未能应用会话设置。';
      final controller = workbenchController(
        baseController: capture,
        sessions: [modelSession('claude')],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      await tester.tap(
        find.byKey(const ValueKey('session-model-settings-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      final next = find.byKey(const ValueKey('session-config-model-next'));
      await tester.tap(next);
      capture.pending.complete();
      await tester.pump();
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('session-model-settings-panel')),
          matching: find.text('电脑端未能应用会话设置。'),
        ),
        findsOneWidget,
      );
      expect(tester.widget<ChoiceChip>(next).selected, isFalse);
      expect(tester.widget<ChoiceChip>(next).onSelected, isNotNull);
    },
  );

  testWidgets(
    '[MOB-PRJ-017][flutter] settings fit a narrow viewport with large text and the keyboard open',
    (tester) async {
      final controller = workbenchController(sessions: [modelSession('codex')]);
      addTearDown(controller.dispose);
      tester.view.viewInsets = const FakeViewPadding(bottom: 280);
      addTearDown(tester.view.resetViewInsets);
      await pumpWorkbench(
        tester,
        controller,
        size: const Size(320, 700),
        textScale: 1.8,
      );
      await tester.tap(
        find.byKey(const ValueKey('session-model-settings-button')),
      );
      await tester.pump();
      expect(
        find.byKey(const ValueKey('session-model-settings-panel')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  for (final provider in ['codex', 'claude']) {
    testWidgets(
      '[MOB-PRJ-017][flutter] $provider switches models without losing drafts and blocks duplicate taps',
      (tester) async {
        final capture = _ConfigController();
        final controller = workbenchController(
          baseController: capture,
          sessions: [modelSession(provider)],
        );
        addTearDown(controller.dispose);
        await pumpWorkbench(tester, controller, size: const Size(320, 700));
        await tester.enterText(
          find.byKey(const ValueKey('conversation-composer-input')),
          'Keep my draft',
        );
        await tester.tap(
          find.byKey(const ValueKey('session-model-settings-button')),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        final next = find.byKey(const ValueKey('session-config-model-next'));
        await tester.ensureVisible(next);
        await tester.tap(next);
        await tester.pump();
        expect(capture.configurations, [('model', 'next')]);
        expect(find.text('正在应用设置…'), findsOneWidget);
        await tester.tap(next);
        expect(capture.configurations.length, 1);
        expect(tester.widget<ChoiceChip>(next).selected, isFalse);
        capture.pending.complete();
        await tester.pump();
        expect(find.text('Keep my draft'), findsOneWidget);
        expect(controller.activeSessionId, provider);
        expect(tester.widget<ChoiceChip>(next).selected, isTrue);
        expect(tester.takeException(), isNull);
      },
    );
  }

  for (final offline in [true, false]) {
    testWidgets(
      '[MOB-PRJ-017][flutter] model settings explain ${offline ? 'offline' : 'running'} state and disable changes',
      (tester) async {
        final capture = _ConfigController();
        final controller = workbenchController(
          baseController: capture,
          online: !offline,
          sessions: [modelSession('claude')],
        );
        if (!offline) controller.runningSessions.add('claude');
        addTearDown(controller.dispose);
        await pumpWorkbench(tester, controller);
        await tester.tap(
          find.byKey(const ValueKey('session-model-settings-button')),
        );
        await tester.pump();
        final chip = tester.widget<ChoiceChip>(
          find.byKey(const ValueKey('session-config-model-next')),
        );
        expect(chip.onSelected, isNull);
        expect(capture.configurations, isEmpty);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    '[MOB-PRJ-017][flutter] older relays show an actionable empty state',
    (tester) async {
      final controller = workbenchController(
        baseController: _ConfigController(),
        sessions: [relaySession(provider: 'claude')],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      await tester.tap(
        find.byKey(const ValueKey('session-model-settings-button')),
      );
      await tester.pump();
      expect(find.textContaining('请更新电脑版'), findsOneWidget);
      expect(find.byType(ChoiceChip), findsNothing);
    },
  );
}

class _ConfigController extends AppController {
  RelaySession? refreshResult;
  final historyRefreshes = <String>[];
  @override
  Future<void> loadHistory(
    String sessionId, {
    bool earlier = false,
    bool silent = false,
    bool localOnly = false,
  }) async {
    historyRefreshes.add(sessionId);
    await Future<void>.value();
    if (refreshResult != null) {
      sessions = [refreshResult!];
      notifyListeners();
    }
  }

  String? failure;
  final configurations = <(String, Object)>[];
  final pending = Completer<void>();

  @override
  Future<void> configureSession(String configId, Object value) async {
    configurations.add((configId, value));
    await pending.future;
    if (failure != null) {
      error = failure!;
      notifyListeners();
      return;
    }
    sessions = sessions
        .map(
          (session) => RelaySession.fromJson({
            ...session.raw,
            'session_config_options': [
              for (final config
                  in session.raw['session_config_options'] as List)
                {
                  ...config as Map,
                  if (config['id'] == configId) 'currentValue': value,
                },
            ],
          }),
        )
        .toList();
    notifyListeners();
  }
}
