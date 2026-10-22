import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/device_connection.dart';

Future<void> until(bool Function() predicate) async {
  for (var i = 0; i < 500 && !predicate(); i++) {
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
  expect(predicate(), true);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // This fixture binds only loopback; use real per-instance HttpClient sockets.
  HttpOverrides.global = null;
  for (final scenario in [
    'normal',
    'directory changes',
    'resync during recovery',
    'new Kimi empty baseline',
  ]) {
    testRecovery(scenario);
  }
}

void testRecovery(String scenario) {
  test(
    'encrypted reconnect: $scenario retains live delivery and stops directory polling',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final key = RelayKey.import(
        base64Url.encode(List.generate(32, (i) => i)).replaceAll('=', ''),
      );
      final cipher = RelayCipher();
      final api =
          RelayApi(
              origin: 'http://127.0.0.1:${server.port}',
              allowInsecureLoopbackForTesting: true,
            )
            ..sessionToken = 'session'
            ..browserToken = 'browser';
      final newKimi = scenario == 'new Kimi empty baseline';
      final sourceId = newKimi ? 'session_fixture_new_kimi' : 's';
      final sessionStatus = newKimi ? 'idle' : 'active';
      final session = RelaySession.fromJson({
        'id': sourceId,
        'provider': newKimi ? 'kimi' : 'codex',
        'cwd': '/work',
        'name': 'Task',
        'status': sessionStatus,
      });
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..relayKey = key
        ..activeSessionId = sourceId
        ..sessions = [session]
        ..desktopInfo = const RelayDesktopInfo(
          supportsOnlineStream: true,
          supportsSessionDirectory: true,
          supportsDirectoryPush: true,
        )
        ..bootstrap = const ServerBootstrap(
          email: 'a@b.test',
          device: RelayDevice(
            id: 'd',
            name: 'Desktop',
            online: true,
            agentConnected: true,
            lastSeenAt: null,
          ),
          catalog: null,
          events: [],
          cursor: 0,
          ackSequence: 0,
          queuedCommands: 0,
          onlineTransportVersion: 1,
        );
      if (newKimi) {
        controller.markHistoryLoadedForTesting(sourceId);
        controller.historyHasMore[sourceId] = false;
        controller.messages[sourceId] = [];
      }
      WebSocket? peer;
      var historyReads = 0;
      var missingWireReads = 0;
      var nativeWireReady = !newKimi;
      var directoryReads = 0;
      var resumes = 0;
      var acknowledgements = 0;
      var connections = 0;
      var content = 'baseline';
      var catalogRevision = 'r1';
      final requests = <String>[];
      Future<void> reply(
        String kind,
        String type,
        String? requestId,
        String? sessionId,
        Map<String, dynamic> payload, {
        int? sequence,
        String? eventId,
      }) async {
        final aad = RelayAad(
          direction: 'relay_to_web',
          type: type,
          deviceId: 'd',
          sessionId: sessionId,
          requestId: requestId,
          eventSeq: sequence,
          createdAt: DateTime.now().toUtc().toIso8601String(),
          expiresAt: null,
        );
        final envelope = await cipher.sealJson(key, {
          'type': type,
          'session_id': sessionId,
          'request_id': requestId,
          ...payload,
        }, aad);
        peer!.add(
          jsonEncode({
            'type': 'frame',
            'connection_id': 'connection',
            'browser_id': 'browser',
            'frame': {
              'kind': kind,
              'device_id': 'd',
              'session_id': sessionId,
              'request_id': requestId,
              if (eventId != null) 'event_id': eventId,
              if (sequence != null) 'event_seq': sequence,
              'aad': aad.toJson(),
              'envelope': envelope.toJson(),
            },
          }),
        );
      }

      server.listen((request) async {
        if (request.uri.path != '/api/stream') {
          request.response.statusCode = 500;
          await request.response.close();
          return;
        }
        connections++;
        peer = await WebSocketTransformer.upgrade(request);
        peer!.listen((wire) async {
          final outer = jsonMap(jsonDecode(wire as String));
          if (outer['type'] == 'hello') {
            peer!.add(
              jsonEncode({
                'type': 'ready',
                'connection_id': 'connection',
                'browser_id': 'browser',
              }),
            );
            peer!.add(jsonEncode({'type': 'relay', 'state': 'online'}));
            await reply('catalog', 'relay.sync_sessions', null, null, {
              'sessions': [],
              'projects': [],
              'directory_revision': 'r1',
              'desktop': {
                'transports': ['online-stream-v1'],
                'session_directory_version': 1,
                'directory_push_version': 1,
              },
            });
          } else if (outer['type'] == 'frame') {
            final frame = jsonMap(outer['frame']);
            final aad = RelayAad.fromJson(jsonMap(frame['aad']));
            final command = await cipher.openJson<Map<String, dynamic>>(
              key,
              SealedEnvelope.fromJson(jsonMap(frame['envelope'])),
              aad,
            );
            requests.add(command['type'] as String);
            if (command['type'] == 'project.sessions') {
              directoryReads++;
              final revision = catalogRevision;
              if (scenario == 'directory changes' && resumes == 0) {
                // An authoritative response can be older than a catalog push
                // arriving while it is in transit. It is still a valid baseline.
                catalogRevision = 'r${directoryReads + 1}';
                await reply('catalog', 'relay.sync_sessions', null, null, {
                  'sessions': [],
                  'projects': [],
                  'directory_revision': catalogRevision,
                  'desktop': {
                    'transports': ['online-stream-v1'],
                    'session_directory_version': 1,
                    'directory_push_version': 1,
                  },
                });
              }
              await reply('response', 'project.result', aad.requestId, null, {
                'directory': {
                  'version': 1,
                  'revision': revision,
                  'observed_at': DateTime.now().toUtc().toIso8601String(),
                  'sessions': [
                    {
                      'id': sourceId,
                      'provider': newKimi ? 'kimi' : 'codex',
                      'cwd': '/work',
                      'name': 'Task',
                      'status': sessionStatus,
                    },
                  ],
                  'projects': [],
                  'removed_ids': [],
                  'reset': true,
                  'next_cursor': null,
                },
              });
            } else if (command['type'] == 'session.read_history') {
              historyReads++;
              if (!nativeWireReady) {
                missingWireReads++;
                await reply(
                  'response',
                  'session.history_error',
                  aad.requestId,
                  sourceId,
                  {
                    'error_code': 'history_read_failed',
                    'error':
                        'Fixture native wire does not exist before the first prompt.',
                  },
                );
                nativeWireReady = true;
                return;
              }
              if (scenario == 'resync during recovery' && historyReads == 2) {
                // Pause after resume while the trailing history read is still
                // pending. Finishing that old recovery must not erase this work.
                await reply(
                  'response',
                  'transport.resync_required',
                  null,
                  null,
                  {'connection_id': 'connection'},
                );
              }
              await reply(
                'response',
                'session.history',
                aad.requestId,
                sourceId,
                {
                  'messages': [
                    {
                      'id': 'reply',
                      'role': 'codex',
                      'content': content,
                      'created_at': DateTime.now().toUtc().toIso8601String(),
                      'turn_id': 'turn',
                    },
                  ],
                  'has_more': false,
                  'next_cursor': null,
                },
              );
            } else if (command['type'] == 'transport.resume') {
              if (newKimi) {
                expect(nativeWireReady, isTrue);
                expect(historyReads, greaterThan(1));
              }
              expect(
                jsonMap(command['payload'])['connection_id'],
                'connection',
              );
              resumes++;
              // This update happened after the first snapshot but before delivery activation.
              content = 'baseline plus gap';
              await reply('response', 'transport.ready', aad.requestId, null, {
                'connection_id': 'connection',
              });
            } else if (command['type'] == 'transport.event_ack') {
              expect(
                jsonMap(command['payload'])['connection_id'],
                'connection',
              );
              acknowledgements++;
            }
          }
        });
      });
      addTearDown(() async {
        controller.dispose();
        await peer?.close();
        await server.close(force: true);
      });
      controller.startOnlineForTesting();
      controller.startDirectorySyncForTesting();
      final initialReadCount = newKimi
          ? 3
          : scenario == 'resync during recovery'
          ? 4
          : 2;
      await until(
        () =>
            historyReads == initialReadCount &&
            controller.messages[sourceId]?.any(
                  (m) => m.content == 'baseline plus gap',
                ) ==
                true,
      );
      final initialResumes = scenario == 'resync during recovery' ? 2 : 1;
      expect(resumes, initialResumes);
      if (newKimi) {
        expect(missingWireReads, 1);
        expect(
          connections,
          1,
          reason:
              'native persistence recovers on the existing stream without reopening',
        );
      }
      expect(
        requests.indexOf('session.read_history'),
        lessThan(requests.indexOf('transport.resume')),
      );
      expect(
        requests.lastIndexOf('session.read_history'),
        greaterThan(requests.indexOf('transport.resume')),
      );
      final reads = directoryReads;
      await Future<void>.delayed(const Duration(milliseconds: 1200));
      expect(
        directoryReads,
        reads,
        reason: 'unchanged directory emits no periodic RPC',
      );
      await reply(
        'event',
        'session.event',
        null,
        sourceId,
        {
          'created_at': DateTime.now().toUtc().toIso8601String(),
          'event': {
            'kind': 'user.message',
            'text': 'live event',
            'client_message_id': 'client1',
          },
        },
        sequence: 1,
        eventId: 'event1',
      );
      await until(() => acknowledgements == 1);
      expect(
        controller.messages[sourceId]!.any((m) => m.content == 'live event'),
        true,
      );
      await peer!.close(4001, 'connection replaced');
      await Future<void>.delayed(const Duration(milliseconds: 1200));
      expect(
        connections,
        1,
        reason: 'a replaced subscriber must not reconnect-fight',
      );
      expect(
        controller.deviceOnline,
        isFalse,
        reason: 'the replaced stream cannot retain its last online presence',
      );
      expect(
        controller.connectionSnapshot.transport,
        RealtimeTransportState.idle,
        reason:
            'idle describes a stopped subscriber, not an automatic reconnect',
      );
      controller.setPresentationForeground(false);
      controller.setPresentationForeground(true);
      await until(
        () =>
            historyReads == initialReadCount + 2 &&
            resumes == initialResumes + 1,
      );
      expect(controller.deviceOnline, isTrue);
      expect(
        controller.connectionSnapshot.transport,
        RealtimeTransportState.connected,
      );
      controller.setPresentationForeground(false);
      await until(() => peer?.readyState == WebSocket.closed);
    },
  );
}
