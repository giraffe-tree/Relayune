import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:crypto/crypto.dart' as hashes;
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/attachment_ranges.dart';
import 'package:relayune_mobile/src/storage/history_store.dart';
import 'package:relayune_mobile/src/storage/image_cache_store.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  group('persistent image cache', () {
    late Directory directory;
    late ImageCacheStore images;
    late _ImageSecureStore secure;
    final controllers = <AppController>[];
    final histories = <HistoryStore>[];
    const attachment = RelayAttachment(
      id: 'saved-image',
      type: 'image',
      name: 'image.png',
      mimeType: 'image/png',
      url: '/image',
    );

    AppController controller(_AttachmentRelayApi api) {
      final history = HistoryStore(
        factory: databaseFactoryFfi,
        path: '${directory.path}/history-${histories.length}.sqlite',
      );
      histories.add(history);
      final value =
          AppController(
              api: api,
              secureStore: secure,
              historyStore: history,
              imageCacheStore: images,
            )
            ..phase = AppPhase.ready
            ..email = 'owner@example.com'
            ..bootstrap = _bootstrap()
            ..relayKey = api.key;
      controllers.add(value);
      return value;
    }

    setUp(() async {
      sqfliteFfiInit();
      directory = await Directory.systemTemp.createTemp(
        'relayune-image-controller-',
      );
      images = ImageCacheStore(
        factory: databaseFactoryFfi,
        path: '${directory.path}/images.sqlite',
        maxImages: 2,
      );
      secure = _ImageSecureStore();
    });
    tearDown(() async {
      for (final value in controllers) {
        await value.flushHistoryCache();
        value.dispose();
      }
      controllers.clear();
      for (final history in histories) {
        await history.close();
      }
      histories.clear();
      await images.close();
      await directory.delete(recursive: true);
    });

    test(
      'reopened offline controller uses preview and original without network',
      () async {
        final api = _AttachmentRelayApi(RelayKey.import(_testKey()));
        final first = controller(api);
        final preview = await first.loadAttachment(
          'root',
          attachment,
          variant: RelayAttachmentVariant.preview,
        );
        final original = await first.loadAttachment('root', attachment);
        expect(api.readCommands, 2);
        await images.close();
        images = ImageCacheStore(
          factory: databaseFactoryFfi,
          path: '${directory.path}/images.sqlite',
        );
        final offline = _AttachmentRelayApi(RelayKey.import(_testKey()))
          ..failures.add(
            const RelayApiException('offline', 0, 'network_unavailable'),
          );
        final second = controller(offline);
        second.bootstrap = _bootstrap(online: false);
        final progress = <DownloadProgress>[];
        expect(
          await second.loadAttachment(
            'root',
            attachment,
            variant: RelayAttachmentVariant.preview,
            onProgress: progress.add,
          ),
          preview,
        );
        expect(await second.loadAttachment('root', attachment), original);
        expect(offline.readCommands, 0);
        expect(progress.last.receivedBytes, preview.length);
        expect(progress.last.totalBytes, preview.length);
      },
    );

    test(
      'cached original supplies a missing preview without retrying download',
      () async {
        final first = controller(
          _AttachmentRelayApi(RelayKey.import(_testKey())),
        );
        final original = await first.loadAttachment('root', attachment);
        final api = _AttachmentRelayApi(RelayKey.import(_testKey()));
        expect(
          await controller(api).loadAttachment(
            'root',
            attachment,
            variant: RelayAttachmentVariant.preview,
          ),
          original,
        );
        expect(api.readCommands, 0);
      },
    );

    test(
      'memory hits update disk LRU and an evicted image downloads again',
      () async {
        final api = _AttachmentRelayApi(RelayKey.import(_testKey()));
        final first = controller(api);
        RelayAttachment image(String id) => RelayAttachment(
          id: id,
          type: 'image',
          name: '$id.png',
          mimeType: 'image/png',
          url: '/$id',
        );
        for (final id in ['a', 'b', 'a', 'c']) {
          await first.loadAttachment(
            'root',
            image(id),
            variant: RelayAttachmentVariant.preview,
          );
        }
        await first.flushHistoryCache();
        final secondApi = _AttachmentRelayApi(RelayKey.import(_testKey()));
        final second = controller(secondApi);
        await second.loadAttachment(
          'root',
          image('a'),
          variant: RelayAttachmentVariant.preview,
        );
        expect(secondApi.readCommands, 0);
        await second.loadAttachment(
          'root',
          image('b'),
          variant: RelayAttachmentVariant.preview,
        );
        expect(secondApi.readCommands, 1);
      },
    );

    test('corrupted cache falls back to the authenticated download', () async {
      await controller(
        _AttachmentRelayApi(RelayKey.import(_testKey())),
      ).loadAttachment(
        'root',
        attachment,
        variant: RelayAttachmentVariant.preview,
      );
      await (await images.database).update('image_cache', {
        'preview': Uint8List(1),
      });
      final api = _AttachmentRelayApi(RelayKey.import(_testKey()));
      await controller(api).loadAttachment(
        'root',
        attachment,
        variant: RelayAttachmentVariant.preview,
      );
      expect(api.readCommands, 1);
      expect(
        (await (await images.database).query('image_cache')),
        hasLength(1),
      );
    });

    test('unavailable disk cache does not prevent image download', () async {
      await (await images.database).execute('DROP TABLE image_cache');
      final api = _AttachmentRelayApi(RelayKey.import(_testKey()));
      final bytes = await controller(api).loadAttachment('root', attachment);
      expect(bytes, utf8.encode('{"cached":true}\n'));
      expect(api.readCommands, 1);
    });

    test('another account cannot reuse the cached image', () async {
      await controller(
        _AttachmentRelayApi(RelayKey.import(_testKey())),
      ).loadAttachment('root', attachment);
      final api = _AttachmentRelayApi(RelayKey.import(_testKey()));
      final other = controller(api)..email = 'other@example.com';
      await other.loadAttachment('root', attachment);
      expect(api.readCommands, 1);
      expect(
        (await (await images.database).query('image_cache')),
        hasLength(2),
      );
    });

    test('failed image download does not leave a persistent entry', () async {
      final api = _AttachmentRelayApi(RelayKey.import(_testKey()))
        ..failures.add(const RelayApiException('denied', 403, 'forbidden'));
      await expectLater(
        controller(api).loadAttachment('root', attachment),
        throwsA(isA<RelayApiException>()),
      );
      expect(await (await images.database).query('image_cache'), isEmpty);
    });

    test(
      'removing authorization before the first image read purges persisted images',
      () async {
        await controller(
          _AttachmentRelayApi(RelayKey.import(_testKey())),
        ).loadAttachment('root', attachment);
        await images.close();
        images = ImageCacheStore(
          factory: databaseFactoryFfi,
          path: '${directory.path}/images.sqlite',
        );
        await controller(
          _AttachmentRelayApi(RelayKey.import(_testKey())),
        ).clearPairing();
        expect(await (await images.database).query('image_cache'), isEmpty);
        expect(secure.keys, isEmpty);
      },
    );

    test(
      'clearing authorization during a download never persists the image',
      () async {
        final api = _AttachmentRelayApi(RelayKey.import(_testKey()))
          ..responseGate = Completer<void>();
        final value = controller(api);
        final pending = value.loadAttachment('root', attachment);
        final rejected = expectLater(pending, throwsA(anything));
        await api.responseStarted.future;
        await value.clearPairing();
        api.responseGate!.complete();
        await rejected;
        expect(await (await images.database).query('image_cache'), isEmpty);
      },
    );
  });
  test(
    '[MOB-ATT-009][flutter] empty history exposes its full metadata file',
    () {
      final page = HistoryPage.fromJson({
        'messages': [],
        'metadata_attachment': {
          'id': 'details',
          'type': 'file',
          'name': '会话详情.json',
          'mime_type': 'application/json',
          'size': 100,
          'preview_supported': true,
          'url': '/api/sessions/root/attachments/details',
        },
      });
      expect(page.messages.single.kind, 'session_metadata');
      expect(page.messages.single.attachments.single.id, 'details');
      expect(page.messages.single.attachments.single.previewSupported, true);
    },
  );
  test(
    '[MOB-ATT-009][flutter] attachment ranges preserve complete content',
    () async {
      final key = RelayKey.import(_testKey());
      final bytes = Uint8List.fromList(utf8.encode('完整消息🙂\n' * 16000));
      final api = _AttachmentRelayApi(key)..rangeBody = bytes;
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key;
      addTearDown(controller.dispose);
      final result = await controller.loadAttachment(
        'root',
        const RelayAttachment(
          id: 'full-message',
          type: 'file',
          name: '完整消息.txt',
          mimeType: 'text/plain',
          url: '/full',
        ),
      );
      expect(result, bytes);
      expect(
        api.readCommands,
        (bytes.length / AttachmentRanges.partBytes).ceil(),
      );
      expect(
        api.commands.values.map((command) => command['offset']),
        List.generate(
          api.readCommands,
          (index) => index * AttachmentRanges.partBytes,
        ),
      );
    },
  );

  test('[MOB-ATT-009][flutter] range gaps and source changes are rejected', () {
    final bytes = utf8.encode('abcdef');
    final digest = hashes.sha256.convert(bytes).toString();
    Map<String, dynamic> part(int offset, String text, bool more) => {
      'base64': base64Encode(utf8.encode(text)),
      'offset': offset,
      'next_offset': offset + text.length,
      'total_size': 6,
      'has_more': more,
      'content_digest': digest,
      'mime_type': 'text/plain',
    };
    for (final invalid in [
      {...part(3, 'def', false), 'offset': 2},
      {...part(3, 'def', false), 'content_digest': 'a' * 64},
      {...part(3, 'def', false), 'total_size': 7},
      {...part(3, 'def', false), 'next_offset': 5},
      {...part(3, 'def', false), 'mime_type': 'application/json'},
    ]) {
      final ranges = AttachmentRanges()..append(part(0, 'abc', true));
      expect(() => ranges.append(invalid), throwsFormatException);
    }
    final ranges = AttachmentRanges()..append(part(0, 'abc', true));
    ranges.append(part(3, 'xyz', false));
    expect(ranges.takeBytes, throwsFormatException);
  });

  for (final failure in [
    const RelayApiException('offline', 0, 'network_unavailable'),
    const RelayApiException('timeout', 0, 'network_timeout'),
    const RelayApiException('busy', 503, 'server_error'),
  ]) {
    test(
      'attachment response recovers from ${failure.code} without resending command',
      () async {
        final key = RelayKey.import(_testKey());
        final api = _AttachmentRelayApi(key)..failures.add(failure);
        final controller = AppController(api: api)
          ..phase = AppPhase.ready
          ..bootstrap = _bootstrap()
          ..relayKey = key;
        addTearDown(controller.dispose);
        await controller.loadAttachment(
          'root',
          const RelayAttachment(
            id: 'recover',
            type: 'image',
            name: 'recover.png',
            mimeType: 'image/png',
            url: '/recover',
          ),
          variant: RelayAttachmentVariant.preview,
        );
        expect(api.readCommands, 1);
        expect(api.responseCount, 2);
        expect(api.responseIds.toSet(), hasLength(1));
      },
    );
  }

  test('attachment authorization failures are not retried', () async {
    final key = RelayKey.import(_testKey());
    final failure = const RelayApiException('denied', 403, 'forbidden');
    final api = _AttachmentRelayApi(key)..failures.add(failure);
    final controller = AppController(api: api)
      ..phase = AppPhase.ready
      ..bootstrap = _bootstrap()
      ..relayKey = key;
    addTearDown(controller.dispose);
    await expectLater(
      controller.loadAttachment(
        'root',
        const RelayAttachment(
          id: 'denied',
          type: 'image',
          name: 'denied.png',
          mimeType: 'image/png',
          url: '/denied',
        ),
      ),
      throwsA(same(failure)),
    );
    expect(api.responseCount, 1);
  });

  test(
    'conversation thumbnail requests start at the newest attachment',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _AttachmentRelayApi(key)..responseGate = Completer<void>();
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..activeSessionId = 'root';
      addTearDown(controller.dispose);
      final attachments = List.generate(
        8,
        (i) => RelayAttachment(
          id: 'image-$i',
          type: 'image',
          name: '$i.png',
          mimeType: 'image/png',
          url: '/image-$i',
        ),
      );
      controller.messages['root'] = [
        for (var i = 0; i < attachments.length; i++)
          RelayMessage(
            id: 'message-$i',
            role: 'user',
            content: 'Image $i',
            createdAt: '2026-09-08T10:00:00Z',
            kind: 'user.message',
            attachments: [attachments[i]],
          ),
      ];
      final loads = [
        for (final attachment in attachments)
          controller.loadAttachment(
            'root',
            attachment,
            variant: RelayAttachmentVariant.preview,
          ),
      ];
      await api.fiveResponses.future;
      expect(api.readAttachmentIds, [
        'image-7',
        'image-6',
        'image-5',
        'image-4',
        'image-3',
      ]);
      api.responseGate!.complete();
      await Future.wait(loads);
      expect(api.readAttachmentIds, List.generate(8, (i) => 'image-${7 - i}'));
    },
  );

  test(
    'image previews and originals share five download slots and queued duplicates',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _AttachmentRelayApi(key)..responseGate = Completer<void>();
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key;
      addTearDown(controller.dispose);
      final updates = List.generate(7, (_) => <DownloadProgress>[]);
      final queued = Completer<void>();
      final attachments = List.generate(
        7,
        (i) => RelayAttachment(
          id: 'image-$i',
          type: 'image',
          name: '$i.png',
          mimeType: 'image/png',
          url: '/image-$i',
        ),
      );
      final loads = [
        for (var i = 0; i < 7; i++)
          controller.loadAttachment(
            'root',
            attachments[i],
            variant: i.isEven
                ? RelayAttachmentVariant.preview
                : RelayAttachmentVariant.original,
            onProgress: (progress) {
              updates[i].add(progress);
              if (i == 6 && progress.waiting && !queued.isCompleted) {
                queued.complete();
              }
            },
          ),
      ];
      // Cache lookup completes before a miss joins the download queue.
      await queued.future;
      expect(updates[5].single.waiting, isTrue);
      expect(updates[6].single.waiting, isTrue);
      final duplicateUpdates = <DownloadProgress>[];
      final duplicate = controller.loadAttachment(
        'root',
        attachments[6],
        variant: RelayAttachmentVariant.preview,
        onProgress: duplicateUpdates.add,
      );
      expect(duplicate, same(loads[6]));
      expect(duplicateUpdates.single.waiting, isTrue);
      await api.fiveResponses.future;
      expect(api.readCommands, 5);
      api.responseGate!.complete();
      await Future.wait(loads);
      expect(api.readCommands, 7);
      expect(updates[6].map((p) => p.waiting), [true, false, false, false]);
      expect(duplicateUpdates.last.fraction, 1);
    },
  );

  test(
    '[MOB-ATT-009][flutter] shared attachment downloads replay and broadcast progress',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _AttachmentRelayApi(key)..responseGate = Completer<void>();
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key;
      addTearDown(controller.dispose);
      const attachment = RelayAttachment(
        id: 'shared',
        type: 'image',
        name: 'shared.png',
        mimeType: 'image/png',
        url: '/test',
      );
      final firstProgress = <DownloadProgress>[];
      final secondProgress = <DownloadProgress>[];
      final first = controller.loadAttachment(
        'session_root',
        attachment,
        variant: RelayAttachmentVariant.preview,
        onProgress: firstProgress.add,
      );
      await api.responseStarted.future;
      final second = controller.loadAttachment(
        'session_root',
        attachment,
        variant: RelayAttachmentVariant.preview,
        onProgress: secondProgress.add,
      );
      expect(second, same(first));
      expect(firstProgress.last.fraction, .2);
      expect(secondProgress.last.fraction, .2);
      api.responseGate!.complete();
      await Future.wait([first, second]);
      expect(firstProgress.last.fraction, 1);
      expect(secondProgress.last.fraction, 1);
      final cachedProgress = <DownloadProgress>[];
      await controller.loadAttachment(
        'session_root',
        attachment,
        variant: RelayAttachmentVariant.preview,
        onProgress: cachedProgress.add,
      );
      expect(cachedProgress.single.fraction, 1);
      expect(api.readCommands, 1);
    },
  );

  test(
    '[MOB-ATT-001][flutter] mobile uploads images only inside the encrypted submit command',
    () async {
      final api = _CaptureRelayApi();
      final key = RelayKey.import(_testKey());
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ]
        ..activeSessionId = 'session_root';

      final outcome = await controller.sendMessage(
        '',
        attachments: [
          UploadAttachment(
            id: 'upload_mobile',
            name: 'private.png',
            mimeType: 'image/png',
            bytes: Uint8List.fromList([137, 80, 78, 71, 13, 10, 26, 10]),
          ),
        ],
      );

      final plaintext = await RelayCipher().openJson<Map<String, dynamic>>(
        key,
        api.envelope!,
        api.aad!,
      );
      final attachment = jsonMapList(
        jsonMap(plaintext['payload'])['attachments'],
      ).single;
      expect(plaintext['type'], 'session.submit_message');
      expect(attachment['name'], 'private.png');
      expect(attachment['mime_type'], 'image/png');
      expect(attachment['base64'], 'iVBORw0KGgo=');
      expect(outcome, MessageSendOutcome.queued);
      expect(controller.notice, isEmpty);
      expect(
        controller.messages['session_root']!.single.deliveryState,
        MessageDeliveryState.sent,
      );
      controller.dispose();
    },
  );

  test(
    '[MOB-ATT-002][flutter] mobile rejects attachments over the shared 20 MiB limit',
    () async {
      final api = _CaptureRelayApi();
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = RelayKey.import(_testKey())
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ]
        ..activeSessionId = 'session_root';

      final outcome = await controller.sendMessage(
        'oversized',
        attachments: [
          UploadAttachment(
            id: 'upload_large',
            name: 'large.png',
            mimeType: 'image/png',
            bytes: Uint8List(AppController.maxUploadBytes + 1),
          ),
        ],
      );

      expect(api.envelope, isNull);
      expect(controller.error, contains('20 MiB'));
      expect(outcome, MessageSendOutcome.rejected);
      controller.dispose();
    },
  );

  test(
    '[MOB-ATT-003][flutter] send failures return a recoverable result',
    () async {
      final api = _CaptureRelayApi(throwOnSend: true);
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = RelayKey.import(_testKey())
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ]
        ..activeSessionId = 'session_root';

      final outcome = await controller.sendMessage('please retry');

      expect(outcome, MessageSendOutcome.failed);
      expect(controller.error, '操作失败，请重试。');
      expect(controller.error, isNot(contains('simulated send failure')));
      expect(
        controller.messages['session_root']!.single.deliveryState,
        MessageDeliveryState.failed,
      );
      controller.dispose();
    },
  );

  test(
    '[MOB-ATT-009][flutter] repeated file previews reuse the bounded memory cache',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _AttachmentRelayApi(key);
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ]
        ..activeSessionId = 'session_root';
      const attachment = RelayAttachment(
        id: 'cached-json',
        type: 'file',
        name: 'result.json',
        mimeType: 'application/json',
        url: '/api/sessions/session_root/attachments/cached-json',
        previewSupported: true,
      );

      final first = await controller.loadAttachment('session_root', attachment);
      final second = await controller.loadAttachment(
        'session_root',
        attachment,
      );

      expect(utf8.decode(first), '{"cached":true}\n');
      expect(second, same(first));
      expect(api.readCommands, 1);
      controller.dispose();
    },
  );

  test(
    '[MOB-ATT-009][flutter] repeated image previews reuse the bounded memory cache',
    () async {
      final key = RelayKey.import(_testKey());
      final api = _AttachmentRelayApi(key);
      final controller = AppController(api: api)
        ..phase = AppPhase.ready
        ..bootstrap = _bootstrap()
        ..relayKey = key
        ..sessions = [
          RelaySession.fromJson({'id': 'session_root', 'name': 'Root'}),
        ]
        ..activeSessionId = 'session_root';
      const attachment = RelayAttachment(
        id: 'cached-image',
        type: 'image',
        name: 'preview.png',
        mimeType: 'image/png',
        url: '/api/sessions/session_root/attachments/cached-image',
      );

      final first = await controller.loadAttachment(
        'session_root',
        attachment,
        variant: RelayAttachmentVariant.preview,
      );
      final second = await controller.loadAttachment(
        'session_root',
        attachment,
        variant: RelayAttachmentVariant.preview,
      );

      expect(second, same(first));
      expect(api.readCommands, 1);
      controller.dispose();
    },
  );
}

class _ImageSecureStore extends SecureStore {
  final keys = <String, String>{};
  @override
  Future<String?> readHistoryKey(String scope) async => keys[scope];
  @override
  Future<void> saveHistoryKey(String scope, String key) async {
    keys[scope] = key;
  }

  @override
  Future<void> clearHistoryKey(String scope) async {
    keys.remove(scope);
  }

  @override
  Future<void> clearPairing() async {}
}

class _CaptureRelayApi extends RelayApi {
  _CaptureRelayApi({this.throwOnSend = false});

  final bool throwOnSend;
  RelayAad? aad;
  SealedEnvelope? envelope;

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
    if (throwOnSend) throw StateError('simulated send failure');
    this.aad = aad;
    this.envelope = envelope;
    return CommandResult(requestId: requestId, delivery: 'queued');
  }

  @override
  Future<ServerBootstrap> bootstrap({String? deviceId}) async => _bootstrap();
}

class _AttachmentRelayApi extends RelayApi {
  _AttachmentRelayApi(this.key);

  final RelayKey key;
  int readCommands = 0;
  final readAttachmentIds = <String>[];
  Completer<void>? responseGate;
  final responseStarted = Completer<void>();
  final fiveResponses = Completer<void>();
  int responseCount = 0;
  final failures = <RelayApiException>[];
  final responseIds = <String>[];
  final commands = <String, Map<String, dynamic>>{};
  final commandSessions = <String, String?>{};
  Uint8List? rangeBody;

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
    if (commandType == 'session.read_attachment') {
      readCommands += 1;
      final command = await RelayCipher().openJson(key, envelope, aad);
      commands[requestId] = Map<String, dynamic>.from(
        command['payload'] as Map,
      );
      commandSessions[requestId] = sessionId;
      readAttachmentIds.add(
        (command['payload'] as Map)['attachment_id'] as String,
      );
    }
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
    responseCount += 1;
    responseIds.add(requestId);
    if (failures.isNotEmpty) throw failures.removeAt(0);
    if (responseCount == 5) fiveResponses.complete();
    onProgress?.call(const DownloadProgress(200, 1000));
    if (!responseStarted.isCompleted) responseStarted.complete();
    await responseGate?.future;
    onProgress?.call(const DownloadProgress(1000, 1000));
    final aad = RelayAad(
      direction: 'relay_to_web',
      type: 'session.attachment',
      deviceId: 'dev_test',
      sessionId: 'session_root',
      requestId: requestId,
      eventSeq: null,
      createdAt: DateTime.now().toUtc().toIso8601String(),
      expiresAt: null,
    );
    final command = commands[requestId]!;
    final offset = command['offset'] as int? ?? 0;
    final body = rangeBody;
    final end = body == null
        ? 0
        : (offset + AttachmentRanges.partBytes).clamp(0, body.length);
    final envelope = await RelayCipher().sealJson(key, {
      'type': 'session.attachment',
      'attachment_id': command['attachment_id'],
      'session_id': commandSessions[requestId],
      'mime_type': 'application/json',
      'base64': base64Encode(
        body == null
            ? utf8.encode('{"cached":true}\n')
            : body.sublist(offset, end),
      ),
      if (body != null) ...{
        'offset': offset,
        'next_offset': end,
        'total_size': body.length,
        'has_more': end < body.length,
        'content_digest': hashes.sha256.convert(body).toString(),
      },
    }, aad);
    return OpaqueFrame(
      deviceId: 'dev_test',
      sessionId: 'session_root',
      requestId: requestId,
      aad: aad,
      envelope: envelope,
    );
  }
}

ServerBootstrap _bootstrap({bool online = true}) => ServerBootstrap(
  email: 'owner@example.com',
  device: RelayDevice(
    id: 'dev_test',
    name: 'Test Mac',
    online: online,
    agentConnected: true,
    lastSeenAt: '2026-08-10T08:00:00.000Z',
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
