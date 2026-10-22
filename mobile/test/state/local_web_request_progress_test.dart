import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';

import '../support/workbench_fixture.dart';

class _WebApi extends RelayApi {
  final key = RelayKey.import(
    base64UrlEncode(List.generate(32, (index) => index)).replaceAll('=', ''),
  );
  final commands = <String, Map<String, dynamic>>{};
  final compressed = <bool>[];
  bool wrongSession = false;

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
    commands[requestId] = await RelayCipher().openJson<Map<String, dynamic>>(
      key,
      envelope,
      aad,
    );
    return CommandResult(requestId: requestId, delivery: 'delivered');
  }

  @override
  Future<OpaqueFrame> encryptedResponse(
    String requestId, {
    DownloadProgressCallback? onProgress,
    bool preserveCompression = false,
    Future<void>? abortTrigger,
    Duration? maxWait,
  }) async {
    compressed.add(preserveCompression);
    onProgress?.call(const DownloadProgress(2048, null));
    final session = wrongSession
        ? 'other'
        : commands[requestId]!['session_id'] as String;
    final aad = RelayAad(
      direction: 'relay_to_web',
      type: 'session.web_result',
      deviceId: 'device',
      sessionId: session,
      requestId: requestId,
      eventSeq: null,
      createdAt: DateTime.now().toUtc().toIso8601String(),
      expiresAt: null,
    );
    final envelope = await RelayCipher().sealJson(key, {
      'type': 'session.web_result',
      'request_id': requestId,
      'session_id': session,
      'status': 200,
      'headers': {'content-type': 'text/plain'},
      'base64': base64Encode([1, 2, 3]),
    }, aad);
    onProgress?.call(const DownloadProgress(4096, 4096));
    return OpaqueFrame(
      deviceId: 'device',
      sessionId: session,
      requestId: requestId,
      aad: aad,
      envelope: envelope,
    );
  }
}

void main() {
  test(
    'parallel web responses retain request identity and deliver progress without disabling compression',
    () async {
      final api = _WebApi();
      final controller = workbenchController(api: api)
        ..relayKey = api.key
        ..desktopInfo = RelayDesktopInfo(supportsLocalWeb: true);
      final first = <DownloadProgress>[], second = <DownloadProgress>[];
      final results = await Future.wait([
        controller.requestLocalWeb('root', {
          'preview_id': 'p',
          'path': '/a.js',
        }, onProgress: first.add),
        controller.requestLocalWeb('root', {
          'preview_id': 'p',
          'path': '/b.js',
        }, onProgress: second.add),
      ]);
      expect(api.commands.length, 2);
      expect(results[0]['request_id'], isNot(results[1]['request_id']));
      expect(first.first.totalBytes, isNull);
      expect(second.last.receivedBytes, 4096);
      expect(api.compressed, [true, true]);
      controller.dispose();
    },
  );

  test('progress does not allow a response from another session', () async {
    final api = _WebApi()..wrongSession = true;
    final controller = workbenchController(api: api)
      ..relayKey = api.key
      ..desktopInfo = RelayDesktopInfo(supportsLocalWeb: true);
    await expectLater(
      controller.requestLocalWeb('root', {'path': '/'}),
      throwsFormatException,
    );
    expect(api.commands.length, 1);
    controller.dispose();
  });
}
