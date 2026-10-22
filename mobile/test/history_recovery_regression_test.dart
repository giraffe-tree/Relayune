import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/ui/workbench_screen.dart';
import 'package:relayune_mobile/src/widgets/status_banner.dart';

void main() {
  test(
    'expired event cursor resets only after durable history recovers',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryApi(key);
      final controller = _preparedController(AppController(api: api), key)
        ..opaqueCursor = 42;
      addTearDown(controller.dispose);
      await controller.loadHistory('session_root');
      api.responsePayload = {
        'type': 'session.history_error',
        'error': 'unavailable',
      };
      await expectLater(
        controller.catchUpEventsForTesting(),
        throwsA(
          isA<RelayApiException>().having(
            (error) => error.code,
            'code',
            'history_resync_pending',
          ),
        ),
      );
      expect(controller.opaqueCursor, 42);
      api.responsePayload = _historyPage();
      await controller.catchUpEventsForTesting();
      expect(controller.opaqueCursor, 0);
      expect(api.historyPayloads, hasLength(3));
      expect(controller.messages['session_root']!.single.content, '历史已恢复');
    },
  );
  test(
    'a successful mobile history retry clears only its stale error',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryApi(key)
        ..responsePayload = {
          'type': 'session.history_error',
          'error': '历史读取失败。',
        };
      final controller = _preparedController(AppController(api: api), key);
      addTearDown(controller.dispose);

      await controller.loadHistory('session_root');

      expect(controller.error, isEmpty);
      expect(controller.historyErrorFor('session_root'), '无法读取历史记录。');
      expect(controller.error, isNot(contains('历史读取失败')));

      api.responsePayload = _historyPage();
      await controller.loadHistory('session_root');

      expect(controller.error, isEmpty);
      expect(controller.historyErrorFor('session_root'), isNull);
      expect(controller.messages['session_root'], hasLength(1));
    },
  );

  testWidgets(
    'history failure stays scoped and can be retried above a long conversation',
    (tester) async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryApi(key)
        ..responsePayload = {
          ..._historyPage(),
          'next_cursor': 'older-page',
          'has_more': true,
        };
      final controller = _preparedController(AppController(api: api), key);
      addTearDown(controller.dispose);
      await tester.runAsync(() async {
        await controller.loadHistory('session_root');
        api.responsePayload = {
          'type': 'session.history_error',
          'error': 'unavailable',
        };
        await controller.loadHistory('session_root', earlier: true);
      });
      expect(controller.error, isEmpty);
      expect(controller.historyErrorFor('session_root'), isNotNull);
      Widget banner(String? sessionId) => MaterialApp(
        home: Scaffold(
          body: AnimatedBuilder(
            animation: controller,
            builder: (_, _) => StatusBanner(
              controller: controller,
              historySessionId: sessionId,
            ),
          ),
        ),
      );
      await tester.pumpWidget(banner(null));
      expect(find.text('无法读取历史记录。'), findsNothing);
      await tester.pumpWidget(banner('another-session'));
      expect(find.text('无法读取历史记录。'), findsNothing);
      await tester.pumpWidget(banner('session_root'));
      expect(find.text('无法读取历史记录。'), findsOneWidget);
      final retry = find.byKey(const ValueKey('retry-history-banner'));
      expect(retry, findsOneWidget);
      expect(tester.getSize(retry).height, greaterThanOrEqualTo(44));
      api.responsePayload = {
        ..._historyPage(),
        'next_cursor': null,
        'has_more': false,
      };
      await tester.runAsync(() async {
        await tester.tap(retry);
        for (var i = 0; i < 100 && controller.historyLoading.isNotEmpty; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 10));
        }
      });
      await tester.pump();
      expect(api.historyPayloads.last['before'], 'older-page');
      expect(controller.historyErrorFor('session_root'), isNull);
      expect(controller.messages['session_root'], isNotEmpty);
      expect(find.text('无法读取历史记录。'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  test(
    'background history failures never overwrite an unrelated action error',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryApi(key)
        ..responsePayload = {
          'type': 'session.history_error',
          'error': 'unavailable',
        };
      final controller = _preparedController(AppController(api: api), key)
        ..error = '发送失败';
      addTearDown(controller.dispose);
      await controller.loadHistory('another-session');
      expect(controller.error, '发送失败');
      expect(controller.historyErrorFor('another-session'), isNotNull);
      api.responsePayload = _historyPage();
      await controller.retryHistory('another-session');
      expect(controller.error, '发送失败');
      expect(controller.historyErrorFor('another-session'), isNull);
    },
  );

  test(
    'reopening a conversation recovers the failed older frontier after its latest page',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryApi(key)
        ..responsePayload = {
          ..._historyPage(),
          'next_cursor': 'older-page',
          'has_more': true,
        };
      final controller = _preparedController(AppController(api: api), key);
      addTearDown(controller.dispose);
      await controller.selectSession('session_root');
      api.responsePayload = {
        'type': 'session.history_error',
        'error': 'unavailable',
      };
      await controller.loadHistory('session_root', earlier: true);
      api.responsePayload = _historyPage();
      await controller.selectSession('session_root');
      expect(api.historyPayloads.map((p) => p['before']), [
        null,
        'older-page',
        null,
        'older-page',
      ]);
      expect(controller.historyErrorFor('session_root'), isNull);
      expect(controller.historyHasMore['session_root'], false);
      expect(controller.messages['session_root'], isNotEmpty);
    },
  );

  testWidgets(
    '[MOB-MSG-004][flutter] retry after an older-page failure requests that same page',
    (tester) async {
      final key = RelayKey.import(_testKey());
      final api = _HistoryApi(key)
        ..responsePayload = {
          ..._historyPage(),
          'next_cursor': 'older-page',
          'has_more': true,
        };
      final controller = _preparedController(AppController(api: api), key);
      addTearDown(controller.dispose);
      await tester.runAsync(() async {
        await controller.loadHistory('session_root');
        api.responsePayload = {
          'type': 'session.history_error',
          'error': 'timeout',
        };
        await controller.loadHistory('session_root', earlier: true);
        // An unrelated latest-page refresh must not dismiss the older-page retry.
        api.responsePayload = {
          ..._historyPage(),
          'next_cursor': 'new-latest',
          'has_more': true,
        };
        await controller.loadHistory('session_root', silent: true);
      });
      await tester.pumpWidget(
        MaterialApp(
          home: AnimatedBuilder(
            animation: controller,
            builder: (context, _) => WorkbenchScreen(controller: controller),
          ),
        ),
      );
      await tester.pump();
      expect(controller.historyErrorFor('session_root'), isNotNull);
      api.responsePayload = {
        ..._historyPage(),
        'next_cursor': null,
        'has_more': false,
      };
      await tester.runAsync(() async {
        await tester.tap(find.byKey(const ValueKey('retry-history-load')));
        for (var i = 0; i < 50 && controller.historyLoading.isNotEmpty; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 10));
        }
      });
      await tester.pump();
      expect(api.historyPayloads.last['before'], 'older-page');
      expect(controller.historyHasMore['session_root'], false);
      expect(controller.historyErrorFor('session_root'), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('mobile history failure keeps a full-size inline retry action', (
    tester,
  ) async {
    final controller = _HistoryFailureController();
    _prepareVisibleWorkbench(controller);
    addTearDown(controller.dispose);
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        home: AnimatedBuilder(
          animation: controller,
          builder: (context, _) => WorkbenchScreen(controller: controller),
        ),
      ),
    );

    expect(find.text('历史读取失败。'), findsOneWidget);
    final retry = find.byKey(const ValueKey('retry-history-load'));
    expect(retry, findsOneWidget);
    expect(tester.getSize(retry).height, greaterThanOrEqualTo(44));

    await tester.tap(retry);
    await tester.pump();

    expect(controller.historyRetries, 1);
  });
}

AppController _preparedController(AppController controller, RelayKey key) {
  _prepareVisibleWorkbench(controller);
  controller.relayKey = key;
  return controller;
}

void _prepareVisibleWorkbench(AppController controller) {
  controller
    ..phase = AppPhase.ready
    ..email = 'owner@example.com'
    ..bootstrap = _bootstrap()
    ..sessions = [
      RelaySession.fromJson({
        'id': 'session_root',
        'name': 'Root',
        'project': 'Relayune',
        'branch': 'main',
        'cwd': '/workspace/relayune',
        'status': 'idle',
        'root_session_id': 'session_root',
      }),
    ]
    ..activeSessionId = 'session_root';
  controller.messages['session_root'] = [];
}

class _HistoryFailureController extends AppController {
  int historyRetries = 0;

  @override
  String? historyErrorFor(String sessionId) => '历史读取失败。';

  @override
  Future<void> loadHistory(
    String sessionId, {
    bool earlier = false,
    bool silent = false,
    bool localOnly = false,
  }) async {
    historyRetries += 1;
  }
}

class _HistoryApi extends RelayApi {
  _HistoryApi(this._key);

  @override
  Future<EventPage> pollEvents({
    required String deviceId,
    required int cursor,
  }) async => const EventPage(
    events: [],
    nextCursor: 0,
    hasMore: false,
    resyncRequired: true,
  );

  final RelayKey _key;
  Map<String, dynamic> responsePayload = _historyPage();
  final List<Map<String, dynamic>> historyPayloads = [];

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
    final command = await RelayCipher().openJson<Map<String, dynamic>>(
      _key,
      envelope,
      aad,
    );
    historyPayloads.add(Map<String, dynamic>.from(command['payload'] as Map));
    return CommandResult(requestId: requestId, delivery: 'delivered');
  }

  @override
  Future<OpaqueFrame> encryptedResponse(
    String requestId, {
    bool preserveCompression = false,
    DownloadProgressCallback? onProgress,
    Future<void>? abortTrigger,
    Duration? maxWait,
  }) async {
    final aad = RelayAad(
      direction: 'relay_to_web',
      type: 'session.history',
      deviceId: 'dev_test',
      sessionId: null,
      requestId: requestId,
      eventSeq: null,
      createdAt: DateTime.now().toUtc().toIso8601String(),
      expiresAt: null,
    );
    final envelope = await RelayCipher().sealJson(_key, responsePayload, aad);
    return OpaqueFrame(
      deviceId: 'dev_test',
      sessionId: null,
      requestId: requestId,
      aad: aad,
      envelope: envelope,
    );
  }
}

Map<String, dynamic> _historyPage() => {
  'type': 'session.history',
  'messages': [
    {
      'id': 'history_message',
      'role': 'codex',
      'content': '历史已恢复',
      'created_at': '2026-08-28T08:00:00.000Z',
      'kind': 'message.completed',
    },
  ],
  'next_cursor': null,
  'has_more': false,
  'agents': <Map<String, dynamic>>[],
  'sessions': <Map<String, dynamic>>[],
};

ServerBootstrap _bootstrap() => const ServerBootstrap(
  email: 'owner@example.com',
  device: RelayDevice(
    id: 'dev_test',
    name: 'Test Mac',
    online: true,
    agentConnected: true,
    lastSeenAt: '2026-08-28T08:00:00.000Z',
  ),
  catalog: null,
  events: [],
  cursor: 0,
  ackSequence: 0,
  queuedCommands: 0,
);

String _testKey() => base64Url
    .encode(List<int>.generate(32, (index) => index))
    .replaceAll('=', '');
