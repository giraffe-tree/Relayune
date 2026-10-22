import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform, WebSocket, HttpClient;

import 'package:flutter/foundation.dart' show compute;
import 'package:http/http.dart' as http;

import '../config.dart';
import 'instance_endpoint.dart';
import '../crypto/e2ee.dart';
import '../models.dart';
import '../version_info.dart';

/// Bytes in the encrypted HTTP response, not the plaintext image size.
class DownloadProgress {
  const DownloadProgress(
    this.receivedBytes,
    this.totalBytes, {
    this.waiting = false,
  });

  final int receivedBytes;
  final int? totalBytes;
  final bool waiting;

  double? get fraction => totalBytes != null && totalBytes! > 0
      ? (receivedBytes / totalBytes!).clamp(0.0, 1.0)
      : null;
}

typedef DownloadProgressCallback = void Function(DownloadProgress progress);

class RelayApiException implements Exception {
  const RelayApiException(this.message, this.status, this.code);

  final String message;
  final int status;
  final String code;

  @override
  String toString() => message;
}

class InstanceCapabilities {
  const InstanceCapabilities({
    required this.authMode,
    required this.setupRequired,
  });
  final String authMode;
  final bool setupRequired;
  bool get usernameMode => authMode == 'username';
  factory InstanceCapabilities.fromJson(Map<String, dynamic> json) {
    if (json['schema_version'] != 1 ||
        !{'username', 'email'}.contains(json['auth_mode']) ||
        json['setup_required'] is! bool) {
      throw const FormatException('Unsupported Relayune instance');
    }
    return InstanceCapabilities(
      authMode: json['auth_mode'] as String,
      setupRequired: json['setup_required'] as bool,
    );
  }
}

class PasswordLoginResult {
  const PasswordLoginResult({required this.sessionToken});

  final String sessionToken;
}

class CommandResult {
  const CommandResult({required this.requestId, required this.delivery});

  final String requestId;
  final String delivery;
}

class EventPage {
  const EventPage({
    required this.events,
    required this.nextCursor,
    required this.hasMore,
    this.resyncRequired = false,
  });

  final bool resyncRequired;
  final List<OpaqueFrame> events;
  final int nextCursor;
  final bool hasMore;
}

class RelayApi {
  RelayApi({
    String? origin,
    http.Client? client,
    String? certificatePem,
    this.allowInsecureLoopbackForTesting = false,
  }) : origin = normalizeApiOrigin(
         origin ?? RelayConfig.activeOrigin,
         allowInsecureLoopbackForTesting: allowInsecureLoopbackForTesting,
       ),
       certificatePem =
           certificatePem ??
           ((origin == null ||
                   Uri.parse(origin).origin == RelayConfig.activeOrigin)
               ? RelayConfig.activeCertificatePem
               : null),
       _client =
           client ??
           instanceHttpClient(
             certificatePem ??
                 ((origin == null ||
                         Uri.parse(origin).origin == RelayConfig.activeOrigin)
                     ? RelayConfig.activeCertificatePem
                     : null),
           );

  final String origin;
  final String? certificatePem;
  final bool allowInsecureLoopbackForTesting;

  final http.Client _client;
  bool _closed = false;
  final Set<HttpClient> _socketClients = {};
  ({String deviceId, int milliseconds, String? session, String? browser})?
  _responseWait;

  late final Future<String?> _clientVersion = _loadClientVersion();

  Future<String?> _loadClientVersion() async {
    try {
      return await loadRelayuneVersion();
    } catch (_) {
      // Optional metadata must not prevent requests on older platforms.
      return null;
    }
  }

  String? sessionToken;
  String? browserToken;

  Future<WebSocket> connectSocket(String url, Map<String, String> headers) {
    if (_closed) {
      return Future.error(const RelayApiException('', 0, 'request_cancelled'));
    }
    return connectInstanceSocket(
      origin,
      certificatePem,
      url,
      headers,
      allowInsecureLoopbackForTesting: allowInsecureLoopbackForTesting,
      onClientCreated: _socketClients.add,
      onClientClosed: _socketClients.remove,
    );
  }

  Future<InstanceCapabilities> discoverInstance() async {
    final request = http.Request('GET', Uri.parse('$origin/api/instance'))
      ..followRedirects = false
      ..headers['Accept'] = 'application/json';
    final response = await http.Response.fromStream(
      await _client.send(request).timeout(RelayConfig.requestTimeout),
    ).timeout(RelayConfig.requestTimeout);
    return InstanceCapabilities.fromJson(await _decodeResponse(response));
  }

  Future<void> registerIosPush(
    String deviceId,
    Map<String, dynamic> body,
  ) async {
    await _request(
      'POST',
      '/api/relay/devices/$deviceId/ios-push',
      body: body,
      browserAuthorized: true,
    );
  }

  Future<String> submitFeedback(Map<String, dynamic> submission) async {
    final response = await _request('POST', '/api/feedback', body: submission);
    if (response['id'] != submission['id']) {
      throw const RelayApiException(
        'feedback_invalid_response',
        502,
        'feedback_invalid_response',
      );
    }
    return response['id'] as String;
  }

  Future<String> emailStatus(String email) async {
    final body = await _request(
      'POST',
      '/api/auth/email-status',
      body: {'email': email.trim().toLowerCase()},
    );
    return body['next_action'] as String;
  }

  Future<void> requestMagicLink(
    String email, {
    String? pairingId,
    required String locale,
  }) async {
    await _request(
      'POST',
      '/api/auth/magic-link',
      body: {
        'email': email.trim().toLowerCase(),
        'pairing_id': pairingId,
        'locale': locale,
      },
      headers: {'Accept-Language': locale},
    );
  }

  Future<PasswordLoginResult> loginWithPassword({
    required String email,
    required String password,
    String? pairingId,
    bool usernameMode = false,
  }) async {
    final response = await _send(
      'POST',
      '/api/auth/password',
      body: {
        if (usernameMode)
          'username': email.trim().toLowerCase()
        else
          'email': email.trim().toLowerCase(),
        'password': password,
        'pairing_id': pairingId,
      },
    );
    await _decodeResponse(response);
    final token = _sessionFromSetCookie(response.headers['set-cookie']);
    if (token == null) {
      throw const RelayApiException(
        '登录未完成，请稍后重试。若持续出现，请更新 Relayune 或联系支持。',
        502,
        'session_cookie_missing',
      );
    }
    sessionToken = token;
    return PasswordLoginResult(sessionToken: token);
  }

  Future<void> registerAndroidPush({
    required String deviceId,
    required String? registrationId,
    required String locale,
  }) async {
    await _request(
      'POST',
      '/api/relay/push-registration',
      browserAuthorized: true,
      body: {
        'device_id': deviceId,
        'registration_id': registrationId,
        'locale': locale,
      },
    );
  }

  Future<void> revokeOwnAuthorization() async {
    if (sessionToken == null || browserToken == null) return;
    await _request(
      'POST',
      '/api/browser/authorizations/revoke',
      body: const {},
      browserAuthorized: true,
    );
  }

  Future<void> logout() async {
    try {
      await _request('POST', '/api/auth/logout', body: const {});
    } finally {
      sessionToken = null;
    }
  }

  Future<void> deleteAccount(String password) async {
    final result = await _request(
      'POST',
      '/api/account/delete',
      body: {'password': password, 'confirm': true},
    );
    if (result['deleted'] != true || result['authenticated'] != false) {
      throw const RelayApiException(
        'account_deletion_failed',
        502,
        'account_deletion_failed',
      );
    }
    sessionToken = null;
  }

  Future<PairingPublicState> pairingState(String pairingId) async {
    final body = await _request('GET', '/api/pairings/$pairingId');
    return PairingPublicState.fromJson(body);
  }

  Future<PendingBrowserPairingDiscovery> pendingBrowserPairings() async {
    final body = await _request('GET', '/api/browser/pairings/pending');
    return PendingBrowserPairingDiscovery.fromJson(body);
  }

  Future<String> respondToPairing({
    required String pairingId,
    required String responderShare,
    required String responderConfirm,
    required String browserTokenHash,
    required String browserKeyId,
    required String browserName,
    String? clientIdentity,
  }) async {
    final body = await _request(
      'POST',
      '/api/browser/pairings/$pairingId/respond',
      body: {
        'protocol': 'SPAKE2-P256-SHA256-HKDF-HMAC',
        'responder_share': responderShare,
        'responder_confirm': responderConfirm,
        'browser_token_hash': browserTokenHash,
        'browser_key_id': browserKeyId,
        'browser_name': browserName,
        if (clientIdentity != null) 'client_identity': clientIdentity,
      },
    );
    return body['browser_id'] as String;
  }

  Future<void> activateClientDevice() async {
    await _request(
      'POST',
      '/api/browser/pairings/activate',
      body: {},
      browserAuthorized: true,
    );
  }

  Future<ServerBootstrap> bootstrap({String? deviceId}) async {
    final session = sessionToken;
    final browser = browserToken;
    final suffix = deviceId == null
        ? ''
        : '?device_id=${Uri.encodeQueryComponent(deviceId)}';
    final body = await _request(
      'GET',
      '/api/bootstrap$suffix',
      browserAuthorized: deviceId != null,
    );
    final offeredWait = body['response_wait_ms'];
    _responseWait = deviceId != null && offeredWait is int && offeredWait > 0
        ? (
            deviceId: deviceId,
            milliseconds: offeredWait.clamp(1, 10000),
            session: session,
            browser: browser,
          )
        : null;
    return ServerBootstrap.fromJson(body);
  }

  Future<ServerBootstrap> queueStatus({required String deviceId}) async {
    final body = await _request(
      'GET',
      '/api/bootstrap?device_id=${Uri.encodeQueryComponent(deviceId)}&summary_only=1',
      browserAuthorized: true,
    );
    return ServerBootstrap.fromJson(body);
  }

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
    final body = await _request(
      'POST',
      '/api/commands',
      browserAuthorized: true,
      headers: {'Idempotency-Key': requestId},
      body: {
        'device_id': deviceId,
        'session_id': sessionId,
        'request_id': requestId,
        'command_type': commandType,
        'created_at': createdAt,
        'expires_at': expiresAt,
        'aad': aad.toJson(),
        'envelope': envelope.toJson(),
      },
    );
    return CommandResult(
      requestId: body['request_id'] as String,
      delivery: body['delivery'] as String? ?? 'queued',
    );
  }

  Future<EventPage> pollEvents({
    required String deviceId,
    required int cursor,
  }) async {
    final body = await _request(
      'GET',
      '/api/events?device_id=${Uri.encodeQueryComponent(deviceId)}&cursor=$cursor',
      browserAuthorized: true,
    );
    final events = jsonMapList(
      body['events'],
    ).map(OpaqueFrame.fromJson).toList();
    return EventPage(
      events: events,
      nextCursor: (body['next_cursor'] as num? ?? cursor).toInt(),
      hasMore: body['has_more'] as bool? ?? false,
      resyncRequired: body['resync_required'] == true,
    );
  }

  Future<OpaqueFrame> encryptedResponse(
    String requestId, {
    DownloadProgressCallback? onProgress,
    bool preserveCompression = false,
    // Only the online read hedge cancels a losing response wait.
    Future<void>? abortTrigger,
    Duration? maxWait,
  }) async {
    final wait = _responseWait;
    final canWait =
        wait != null &&
        wait.session == sessionToken &&
        wait.browser == browserToken;
    final waitMs = canWait
        ? (maxWait == null
              ? wait.milliseconds
              : maxWait.inMilliseconds.clamp(1, wait.milliseconds))
        : null;
    final suffix = canWait
        ? '?device_id=${Uri.encodeQueryComponent(wait.deviceId)}&wait_ms=$waitMs'
        : '';
    final body = await _request(
      'GET',
      '/api/responses/${Uri.encodeComponent(requestId)}$suffix',
      browserAuthorized: true,
      onProgress: onProgress,
      // History hints must not disable existing HTTP compression just to get
      // a total. Encoded Content-Length is ignored by the decoder below.
      headers: preserveCompression && onProgress != null
          ? const {'Accept-Encoding': 'gzip'}
          : null,
      abortTrigger: abortTrigger,
    );
    return OpaqueFrame.fromJson(body);
  }

  Future<List<RelayRelease>> releases({required String locale}) async {
    final body = await _request(
      'GET',
      '/api/release-notes?locale=${Uri.encodeQueryComponent(locale)}',
      sessionAuthorized: false,
    );
    return jsonMapList(
      body['releases'],
    ).map(RelayRelease.fromJson).toList(growable: false);
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? headers,
    bool browserAuthorized = false,
    bool sessionAuthorized = true,
    DownloadProgressCallback? onProgress,
    Future<void>? abortTrigger,
  }) async {
    final response = await _send(
      method,
      path,
      body: body,
      headers: headers,
      browserAuthorized: browserAuthorized,
      sessionAuthorized: sessionAuthorized,
      onProgress: onProgress,
      abortTrigger: abortTrigger,
    );
    return _decodeResponse(response);
  }

  Future<http.Response> _send(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? headers,
    bool browserAuthorized = false,
    bool sessionAuthorized = true,
    DownloadProgressCallback? onProgress,
    Future<void>? abortTrigger,
  }) async {
    if (_closed) throw const RelayApiException('', 0, 'request_cancelled');
    final uri = Uri.parse('$origin$path');
    final clientVersion = await _clientVersion;
    if (_closed) throw const RelayApiException('', 0, 'request_cancelled');
    final requestHeaders = <String, String>{
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Origin': origin,
      if (clientVersion != null) 'X-Relay-Client-Version': clientVersion,
      'X-Relay-Client-Platform': Platform.isIOS
          ? 'ios'
          : Platform.isAndroid
          ? 'android'
          : 'unknown',
      // Keep Content-Length and streamed bytes in the same representation.
      if (onProgress != null) 'Accept-Encoding': 'identity',
      ...?headers,
    };
    if (sessionAuthorized && sessionToken != null) {
      requestHeaders['Cookie'] =
          'relay_session=${Uri.encodeComponent(sessionToken!)}';
    }
    if (browserAuthorized && browserToken != null) {
      requestHeaders['X-Relay-Browser-Token'] = browserToken!;
    }
    final encodedBody = body == null ? '' : jsonEncode(body);
    final requestTimeout =
        path == '/api/account/delete' || encodedBody.length > 1000000
        ? const Duration(minutes: 1)
        : RelayConfig.requestTimeout;
    try {
      return await _client
          .send(
            (abortTrigger == null
                  ? http.Request(method, uri)
                  : http.AbortableRequest(
                      method,
                      uri,
                      abortTrigger: abortTrigger,
                    ))
              ..followRedirects = false
              ..headers.addAll(requestHeaders)
              ..body = encodedBody,
          )
          .then((response) async {
            if (onProgress == null || response.statusCode != 200) {
              return http.Response.fromStream(response);
            }
            // Pending/error polling responses are not attachment downloads.
            final length = response.contentLength;
            final encoding = response.headers['content-encoding'];
            final total =
                length != null &&
                    length > 0 &&
                    (encoding == null || encoding == 'identity')
                ? length
                : null;
            var received = 0;
            onProgress(DownloadProgress(0, total));
            final bytes = await http.ByteStream(
              response.stream.map((chunk) {
                received += chunk.length;
                onProgress(DownloadProgress(received, total));
                return chunk;
              }),
            ).toBytes();
            if (total != null && received != total) {
              throw http.ClientException('Incomplete response');
            }
            onProgress(DownloadProgress(received, received));
            return http.Response.bytes(
              bytes,
              response.statusCode,
              headers: response.headers,
              request: response.request,
              isRedirect: response.isRedirect,
              persistentConnection: response.persistentConnection,
              reasonPhrase: response.reasonPhrase,
            );
          })
          .timeout(requestTimeout);
    } on TimeoutException {
      throw const RelayApiException('网络请求超时，请稍后重试。', 0, 'network_timeout');
    } on http.RequestAbortedException {
      throw const RelayApiException('', 0, 'request_cancelled');
    } on http.ClientException {
      throw const RelayApiException(
        '无法连接 Relayune 服务。',
        0,
        'network_unavailable',
      );
    }
  }

  Future<Map<String, dynamic>> _decodeResponse(http.Response response) async {
    Map<String, dynamic> body;
    try {
      body = response.bodyBytes.isEmpty
          ? <String, dynamic>{}
          : response.bodyBytes.length >= 32 * 1024
          ? await compute(
              _decodeResponseBytes,
              response.bodyBytes,
              debugLabel: 'relay-http-json',
            )
          : _decodeResponseBytes(response.bodyBytes);
    } on FormatException {
      throw RelayApiException(
        '服务器返回了无法识别的响应。',
        response.statusCode,
        'invalid_response',
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = body['error'] is Map
          ? jsonMap(body['error'])
          : const <String, dynamic>{};
      throw RelayApiException(
        error['message'] as String? ?? 'Relayune 请求失败（${response.statusCode}）。',
        response.statusCode,
        error['code'] as String? ?? 'request_failed',
      );
    }
    return body;
  }

  String? _sessionFromSetCookie(String? value) {
    if (value == null) return null;
    return RegExp(
      r'(?:^|[,;]\s*)relay_session=([^;,\s]+)',
    ).firstMatch(value)?.group(1)?.let(Uri.decodeComponent);
  }

  void close() {
    _closed = true;
    for (final client in _socketClients.toList()) {
      client.close(force: true);
    }
    _socketClients.clear();
    _client.close();
  }
}

Map<String, dynamic> _decodeResponseBytes(List<int> bytes) =>
    jsonMap(jsonDecode(utf8.decode(bytes)));

extension _NullableTransform<T> on T {
  R let<R>(R Function(T) transform) => transform(this);
}
