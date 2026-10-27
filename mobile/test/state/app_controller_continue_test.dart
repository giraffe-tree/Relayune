import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/storage/history_store.dart';
import 'package:relayune_mobile/src/storage/image_cache_store.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import '../support/workbench_fixture.dart';

void main() {
  test(
    'retry persists a previously failed sealed save before any bytes reach transport',
    () async {
      sqfliteFfiInit();
      final api = _Api(), store = _FailSealedOnceStore();
      final c =
          workbenchController(
              api: api,
              baseController: AppController(
                api: api,
                historyStore: store,
                secureStore: _Keys(),
                imageCacheStore: store.imageCacheStore,
              ),
              sessions: [
                RelaySession.fromJson({
                  'id': 'root',
                  'provider': 'codex',
                  'status': 'idle',
                  'continue_turn_id': 'stopped',
                  'capabilities': {'continue_supported': true},
                }),
              ],
            )
            ..relayKey = RelayKey.import(
              base64UrlEncode(List<int>.filled(32, 13)).replaceAll('=', ''),
            );
      api.key = c.relayKey!;
      addTearDown(c.dispose);
      expect(await c.continueSession('root'), MessageSendOutcome.failed);
      expect(api.frames, isEmpty);
      final failed = store.failedFrame!;
      api.onSend = (frame, payload) async {
        final saved = (await store.readPending(
          List<int>.filled(32, 7),
          'root',
        )).single;
        expect((saved['frame'] as Map)['request_id'], failed['request_id']);
        expect((saved['frame'] as Map)['envelope'], failed['envelope']);
        expect(frame['envelope'], failed['envelope']);
        accept(c, frame, payload);
      };
      expect(await c.continueSession('root'), MessageSendOutcome.delivered);
      expect(api.frames, hasLength(1));
    },
  );
  test(
    'expired historical approval does not block a confirmed native continuation',
    () {
      final api = _Api();
      final c = _fixture(api);
      addTearDown(c.dispose);
      c.approvals = [
        RelayApproval(
          id: 'old',
          sessionId: 'root',
          action: const {},
          riskLevel: 'low',
          state: 'pending',
          requestedAt: '2020-01-01T00:00:00Z',
          expiresAt: '2020-01-01T00:01:00Z',
        ),
      ];
      expect(c.pendingApprovalCount, 0);
      expect(c.canContinueSession(c.activeSession), isTrue);
    },
  );
  test(
    'native acceptance outranks a later transport failure for the same continuation',
    () async {
      final api = _Api();
      final c = _fixture(api);
      addTearDown(c.dispose);
      api.onSend = (frame, payload) async {
        accept(c, frame, payload);
        throw const RelayApiException(
          'late transport failure',
          0,
          'network_unavailable',
        );
      };
      expect(await c.continueSession('root'), MessageSendOutcome.delivered);
      expect(c.messages['root'], isEmpty);
      expect(c.error, isEmpty);
    },
  );
  test(
    'a fast new stop arriving before the acceptance receipt retains its new continue button',
    () async {
      final api = _Api();
      final c = _fixture(api);
      addTearDown(c.dispose);
      api.onSend = (frame, payload) async {
        c.applyEventForTesting(
          event({'kind': 'turn.started', 'turn_id': 'continued'}),
        );
        c.applyEventForTesting(
          event({
            'kind': 'turn.completed',
            'turn_id': 'continued',
            'status': 'interrupted',
            'continue_turn_id': 'continued',
          }),
        );
        accept(c, frame, payload);
      };
      expect(await c.continueSession('root'), MessageSendOutcome.delivered);
      expect(c.activeSession!.continueTurnId, 'continued');
      expect(c.canContinueSession(c.activeSession), isTrue);
    },
  );
  test(
    'continue sends an encrypted empty action and waits for the matching native acceptance',
    () async {
      final api = _Api();
      final c = _fixture(api);
      addTearDown(c.dispose);
      final entered = Completer<void>(), release = Completer<void>();
      api.onSend = (frame, payload) async {
        expect(payload['action'], 'continue');
        expect(payload['expected_turn_id'], 'stopped');
        expect(payload['content'], '');
        expect(payload['attachments'], isEmpty);
        expect(payload.containsKey('runtime_settings'), isFalse);
        expect(payload.containsKey('interrupt_running'), isFalse);
        entered.complete();
        await release.future;
      };
      final operation = c.continueSession('root');
      await entered.future;
      expect(c.isContinuingSession('root'), isTrue);
      expect(await c.continueSession('root'), MessageSendOutcome.rejected);
      accept(c, api.frames.single, api.payloads.single, requestId: 'wrong');
      expect(c.messages['root']!.single.kind, 'local.user.action');
      accept(c, api.frames.single, api.payloads.single);
      release.complete();
      expect(await operation, MessageSendOutcome.delivered);
      expect(c.isContinuingSession('root'), isFalse);
      expect(c.messages['root'], isEmpty);
      expect(c.canContinueSession(c.activeSession), isFalse);
      expect(api.frames.single.toString(), isNot(contains('expected_turn_id')));
    },
  );

  test(
    'manual retry after an uncertain transport failure reuses the identical sealed request',
    () async {
      final api = _Api();
      final c = _fixture(api);
      addTearDown(c.dispose);
      api.onSend = (_, _) async =>
          throw const RelayApiException('offline', 0, 'network_unavailable');
      expect(await c.continueSession('root'), MessageSendOutcome.failed);
      expect(c.canContinueSession(c.activeSession), isTrue);
      expect(c.messages['root']!.single.kind, 'local.user.action');
      api.onSend = (frame, payload) async => accept(c, frame, payload);
      expect(await c.continueSession('root'), MessageSendOutcome.delivered);
      expect(api.frames, hasLength(2));
      expect(api.frames.last, api.frames.first);
      expect(api.payloads.last, api.payloads.first);
      expect(c.messages['root'], isEmpty);
    },
  );

  testWidgets(
    'missing native receipt becomes unconfirmed and manual retry retains the request',
    (tester) async {
      final api = _Api();
      final c = _fixture(api);
      addTearDown(c.dispose);
      final operation = c.continueSession('root');
      await tester.pump();
      expect(api.frames, hasLength(1));
      await tester.pump(const Duration(seconds: 21));
      expect(await operation, MessageSendOutcome.failed);
      expect(
        c.messages['root']!.single.deliveryState,
        MessageDeliveryState.unconfirmed,
      );
      expect(c.canContinueSession(c.activeSession), isTrue);
      api.onSend = (frame, payload) async => accept(c, frame, payload);
      final retry = c.continueSession('root');
      await tester.pump();
      expect(await retry, MessageSendOutcome.delivered);
      expect(api.frames.last, api.frames.first);
    },
  );

  test(
    'native rejection only fails the action and leaves the interrupted turn available',
    () async {
      final api = _Api();
      final c = _fixture(api);
      addTearDown(c.dispose);
      api.onSend = (frame, payload) async => c.applyEventForTesting(
        event({
          'kind': 'message.failed',
          'action': 'continue',
          'error': 'stale state',
          'client_message_id': payload['client_message_id'],
          'request_id': frame['request_id'],
        }),
      );
      expect(await c.continueSession('root'), MessageSendOutcome.failed);
      expect(
        c.messages['root']!.where((m) => m.kind == 'local.user.action'),
        isEmpty,
      );
      expect(
        c.messages['root']!.any(
          (m) => m.role == 'user' || m.kind == 'turn.failed',
        ),
        isFalse,
      );
      expect(c.canContinueSession(c.activeSession), isTrue);
    },
  );

  test(
    'trusted terminal events update continuation while running and unsupported cases cannot send',
    () async {
      final api = _Api();
      final c = _fixture(api);
      addTearDown(c.dispose);
      c.applyEventForTesting(
        event({'kind': 'turn.started', 'turn_id': 'next'}),
      );
      expect(c.activeSession!.continueTurnId, isNull);
      expect(await c.continueSession('root'), MessageSendOutcome.rejected);
      c.applyEventForTesting(
        event({
          'kind': 'turn.failed',
          'turn_id': 'next',
          'continue_turn_id': 'next',
          'error': 'temporary server error',
        }),
      );
      expect(c.activeSession!.continueTurnId, 'next');
      expect(c.canContinueSession(c.activeSession), isTrue);
      c.applyEventForTesting(
        event({'kind': 'turn.started', 'turn_id': 'third'}),
      );
      c.applyEventForTesting(
        event({
          'kind': 'turn.completed',
          'turn_id': 'next',
          'status': 'interrupted',
          'continue_turn_id': 'next',
        }),
      );
      expect(
        c.activeSession!.continueTurnId,
        isNull,
        reason: 'old terminal cannot replace a newer active turn',
      );
      expect(api.frames, isEmpty);
    },
  );
}

AppController _fixture(_Api api) {
  final c =
      workbenchController(
          api: api,
          sessions: [
            RelaySession.fromJson({
              'id': 'root',
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
  api.key = c.relayKey!;
  return c;
}

RelayEvent event(Map<String, dynamic> data) => RelayEvent(
  cursor: 0,
  agentId: null,
  eventId: 'event-${DateTime.now().microsecondsSinceEpoch}',
  sessionId: 'root',
  createdAt: DateTime.now().toUtc().toIso8601String(),
  event: data,
);

void accept(
  AppController c,
  Map<String, dynamic> frame,
  Map<String, dynamic> payload, {
  String? requestId,
}) {
  c.applyEventForTesting(
    event({
      'kind': 'codex.persisted',
      'operation': 'turn',
      'action': 'continue',
      'accepted': true,
      'persisted': false,
      'turn_id': 'continued',
      'client_message_id': payload['client_message_id'],
      'request_id': requestId ?? frame['request_id'],
    }),
  );
}

class _Api extends RelayApi {
  late RelayKey key;
  final frames = <Map<String, dynamic>>[], payloads = <Map<String, dynamic>>[];
  Future<void> Function(Map<String, dynamic>, Map<String, dynamic>)? onSend;
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
    final frame = {
      'request_id': requestId,
      'aad': aad.toJson(),
      'envelope': envelope.toJson(),
    };
    final opened = await RelayCipher().openJson<Map<String, dynamic>>(
      key,
      envelope,
      aad,
    );
    final payload = jsonMap(opened['payload']);
    frames.add(frame);
    payloads.add(payload);
    await onSend?.call(frame, payload);
    return CommandResult(requestId: requestId, delivery: 'delivered');
  }
}

class _FailSealedOnceStore extends HistoryStore {
  _FailSealedOnceStore()
    : super(
        factory: databaseFactoryFfi,
        path: inMemoryDatabasePath,
        imageCacheStore: ImageCacheStore(
          factory: databaseFactoryFfi,
          path: inMemoryDatabasePath,
        ),
      );
  Map<String, dynamic>? failedFrame;
  @override
  Future<void> savePending(
    List<int> key,
    String session,
    RelayMessage message,
    Map<String, dynamic> frame,
  ) async {
    if (frame.isNotEmpty && failedFrame == null) {
      failedFrame = frame;
      throw StateError('synthetic disk write failure');
    }
    await super.savePending(key, session, message, frame);
  }
}

class _Keys extends SecureStore {
  @override
  Future<String?> readHistoryKey(String scope) async =>
      base64Encode(List<int>.filled(32, 7));
  @override
  Future<void> saveHistoryKey(String scope, String key) async {}
  @override
  Future<List<String>> allHistoryKeys() async => [
    base64Encode(List<int>.filled(32, 7)),
  ];
}
