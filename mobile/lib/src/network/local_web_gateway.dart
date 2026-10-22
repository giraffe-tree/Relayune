import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'local_web_progress.dart';
import 'relay_api.dart';

typedef LocalWebRequest =
    Future<Map<String, dynamic>> Function(
      Map<String, dynamic> payload, {
      DownloadProgressCallback? onProgress,
    });

Uri? localWebUri(String value) {
  if (!RegExp(
    r'^https?://(?:localhost|127\.0\.0\.1|\[::1\]):[0-9]+(?:[/?#]|$)',
  ).hasMatch(value)) {
    return null;
  }
  final uri = Uri.tryParse(value);
  return uri != null &&
          uri.userInfo.isEmpty &&
          uri.port >= 1024 &&
          uri.port <= 65535
      ? uri
      : null;
}

/// A private, short-lived WebView resource renderer on this phone's loopback.
/// Its only upstream is the authenticated E2EE callback, never a network URL.
/// This does not expose a desktop listener or a plaintext relay/broker.
class LocalWebGateway {
  LocalWebGateway._(
    this.upstream,
    this.previewId,
    this.request,
    this.server,
    this._secret,
    this.failureText,
    this.compatibilityScript,
    this.loadCompatibilityFont,
    this.onResourceProgress,
  ) : _port = server.port;
  final int _port;
  final Uri upstream;
  final String previewId, _secret, failureText;
  final String compatibilityScript;
  final Future<Uint8List> Function()? loadCompatibilityFont;
  final LocalWebRequest request;
  final LocalWebProgressCallback? onResourceProgress;
  final HttpServer server;
  final _cookies = <String, ({Cookie cookie, DateTime? expires})>{};
  bool _closed = false;
  int _active = 0;
  int _resourceSequence = 0, _progressEpoch = 0;
  int get progressEpoch => _progressEpoch;
  void beginNavigation() => _progressEpoch++;
  static const maxRequestBytes = 256 * 1024;
  static const maxResponseBytes = 12 * 1024 * 1024;
  String get _cookieName => 'relayune_preview_${_secret.substring(0, 16)}';
  Uri get origin => Uri.parse('http://127.0.0.1:$_port');
  Uri get entry => origin
      .resolve('/_relayune/$_secret')
      .replace(fragment: upstream.fragment);

  static Future<LocalWebGateway> start(
    Uri upstream,
    String previewId,
    LocalWebRequest request, {
    String failureText =
        'Preview request unavailable. If you submitted a form, check its result before trying again.',
    String compatibilityScript = '',
    Future<Uint8List> Function()? loadCompatibilityFont,
    LocalWebProgressCallback? onResourceProgress,
  }) async {
    if (localWebUri(upstream.toString()) == null) {
      throw const FormatException('web_url_invalid');
    }
    final server = await HttpServer.bind(
      InternetAddress.loopbackIPv4,
      0,
      shared: false,
    );
    final random = Random.secure();
    final secret = base64UrlEncode(
      List.generate(32, (_) => random.nextInt(256)),
    ).replaceAll('=', '');
    final gateway = LocalWebGateway._(
      upstream,
      previewId,
      request,
      server,
      secret,
      failureText,
      compatibilityScript,
      loadCompatibilityFont,
      onResourceProgress,
    );
    server.listen(
      (incoming) => unawaited(gateway._serve(incoming)),
      onError: (Object _) {},
    );
    return gateway;
  }

  bool allows(Uri uri) =>
      !_closed &&
      uri.scheme == 'http' &&
      uri.host == '127.0.0.1' &&
      uri.port == _port &&
      uri.userInfo.isEmpty;

  Uri? navigation(Uri uri) {
    if (allows(uri)) return uri;
    if ((uri.scheme == 'http' || uri.scheme == 'https') &&
        uri.origin == upstream.origin &&
        uri.userInfo.isEmpty) {
      return origin.replace(
        path: uri.path,
        query: uri.hasQuery ? uri.query : null,
        fragment: uri.hasFragment ? uri.fragment : null,
      );
    }
    return null;
  }

  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    _cookies.clear();
    await server.close(force: true);
  }

  static const policy =
      "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
      "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; "
      "media-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; "
      "worker-src 'none'; manifest-src 'none'; base-uri 'self'; form-action 'self'; "
      "frame-ancestors 'none'; sandbox allow-scripts allow-same-origin allow-forms";

  Future<void> _serve(HttpRequest incoming) async {
    final response = incoming.response;
    response.headers.set('content-security-policy', policy);
    response.headers.set('cache-control', 'no-store');
    // no-referrer makes native form POSTs send Origin: null. Keep same-origin
    // submissions verifiable while still withholding cross-origin referrers.
    // Referer is never forwarded to the desktop upstream.
    response.headers.set('referrer-policy', 'same-origin');
    response.headers.set('x-content-type-options', 'nosniff');
    response.headers.set(
      'permissions-policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    var admitted = false;
    LocalWebResourceProgress? resource;
    var requestFailed = false;
    void observe(
      LocalWebResourcePhase phase, {
      DownloadProgress? download,
      bool? isDocument,
      int? statusCode,
    }) {
      if (_closed || resource == null) return;
      resource = resource!.withPhase(
        phase,
        download: download,
        isDocument: isDocument,
        statusCode: statusCode,
      );
      try {
        onResourceProgress?.call(resource!);
      } on Object {
        // UI observers must never change HTTP delivery or repeat a submission.
      }
    }

    void beginResource() {
      resource = LocalWebResourceProgress(
        id: ++_resourceSequence,
        epoch: _progressEpoch,
        // Queries may contain credentials; they are never part of the UI record.
        path: incoming.uri.path,
        phase: LocalWebResourcePhase.waiting,
        isDocument:
            incoming.headers.value('sec-fetch-dest') == 'document' ||
            (incoming.headers.value('accept') ?? '').contains('text/html'),
      );
      observe(LocalWebResourcePhase.waiting);
    }

    try {
      if (_closed || incoming.headers.value('host') != origin.authority) {
        throw const FormatException('web_request_blocked');
      }
      final requestOrigin = incoming.headers.value('origin');
      if (requestOrigin != null && requestOrigin != origin.origin) {
        throw const FormatException('web_request_blocked');
      }
      if (incoming.method == 'GET' &&
          incoming.uri.path == '/_relayune/$_secret') {
        response.statusCode = HttpStatus.seeOther;
        response.headers.set(
          'set-cookie',
          '$_cookieName=$_secret; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800',
        );
        response.headers.set(
          'location',
          '${upstream.path.isEmpty ? '/' : upstream.path}${upstream.hasQuery ? '?${upstream.query}' : ''}${upstream.hasFragment ? '#${upstream.fragment}' : ''}',
        );
        return;
      }
      if (!incoming.cookies.any(
        (cookie) => cookie.name == _cookieName && cookie.value == _secret,
      )) {
        throw const FormatException('web_request_blocked');
      }
      if (_active >= 6 || incoming.headers.value('upgrade') != null) {
        throw const FormatException('web_preview_busy');
      }
      // Packaged compatibility assets stay on this phone and require the same
      // private renderer cookie. They never traverse the encrypted upstream.
      if (compatibilityScript.isNotEmpty &&
          const {
            '/_relayune/compat/font-fallback.js',
            '/_relayune/compat/cjk.woff2',
          }.contains(incoming.uri.path)) {
        if (!const {'GET', 'HEAD'}.contains(incoming.method)) {
          throw const FormatException('web_request_blocked');
        }
        _active++;
        admitted = true;
        beginResource();
        observe(LocalWebResourcePhase.preparing);
        final script = incoming.uri.path.endsWith('.js');
        final bytes = script
            ? utf8.encode(compatibilityScript)
            : await loadCompatibilityFont!();
        response.headers.set(
          'content-type',
          script ? 'text/javascript; charset=utf-8' : 'font/woff2',
        );
        response.contentLength = bytes.length;
        if (incoming.method != 'HEAD') response.add(bytes);
        return;
      }
      if (!const {
        'GET',
        'HEAD',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'OPTIONS',
      }.contains(incoming.method)) {
        throw const FormatException('web_request_blocked');
      }
      _active++;
      admitted = true;
      beginResource();
      final body = BytesBuilder(copy: false);
      await for (final chunk in incoming.timeout(const Duration(seconds: 15))) {
        if (body.length + chunk.length > maxRequestBytes) {
          throw const FormatException('web_request_too_large');
        }
        body.add(chunk);
      }
      final headers = <String, String>{};
      for (final name in [
        'accept',
        'accept-language',
        'content-type',
        'authorization',
        'range',
        'if-none-match',
        'if-modified-since',
        'x-csrf-token',
        'x-xsrf-token',
        'x-requested-with',
      ]) {
        final value = incoming.headers.value(name);
        if (value != null) headers[name] = value;
      }
      if (requestOrigin != null) headers['origin'] = upstream.origin;
      final now = DateTime.now();
      _cookies.removeWhere(
        (_, value) => value.expires != null && !value.expires!.isAfter(now),
      );
      final cookies = _cookies.values
          .where((entry) {
            final path = entry.cookie.path ?? '/';
            return (incoming.uri.path == path ||
                    incoming.uri.path.startsWith(
                      path.endsWith('/') ? path : '$path/',
                    )) &&
                (!entry.cookie.secure || upstream.scheme == 'https');
          })
          .map((entry) => '${entry.cookie.name}=${entry.cookie.value}')
          .join('; ');
      if (cookies.isNotEmpty) headers['cookie'] = cookies;
      final result = await request(
        {
          'preview_id': previewId,
          'path': incoming.uri.toString(),
          'method': incoming.method,
          'headers': headers,
          'base64': base64Encode(body.takeBytes()),
        },
        onProgress: onResourceProgress == null
            ? null
            : (download) {
                observe(LocalWebResourcePhase.receiving, download: download);
              },
      );
      if (_closed) return;
      observe(LocalWebResourcePhase.preparing);
      final status = result['status'];
      final encoded = result['base64'];
      if (status is! int ||
          status < 200 ||
          status > 599 ||
          encoded is! String ||
          encoded.length > (maxResponseBytes * 4 / 3).ceil() + 4) {
        throw const FormatException('web_response_invalid');
      }
      final values = Map<String, dynamic>.from(result['headers'] as Map);
      final setCookies = values['set-cookie'];
      if (setCookies is List) {
        for (final value in setCookies) {
          try {
            final cookie = Cookie.fromSetCookieValue(value as String);
            if (cookie.domain != null &&
                cookie.domain!.replaceFirst(RegExp(r'^\.'), '') !=
                    upstream.host) {
              continue;
            }
            cookie.path ??= incoming.uri.path.substring(
              0,
              incoming.uri.path.lastIndexOf('/') + 1,
            );
            final key = '${cookie.name}:${cookie.path}';
            if (_cookies.length < 100 || _cookies.containsKey(key)) {
              _cookies[key] = (
                cookie: cookie,
                expires: cookie.maxAge != null
                    ? now.add(Duration(seconds: cookie.maxAge!))
                    : cookie.expires,
              );
            }
          } on Object {
            /* A malformed site cookie must not fail a page. */
          }
        }
      }
      for (final name in [
        'content-type',
        'content-language',
        'etag',
        'last-modified',
        'content-range',
        'accept-ranges',
      ]) {
        final value = values[name];
        if (value is String && !value.contains(RegExp(r'[\r\n]'))) {
          response.headers.set(name, value);
        }
      }
      final location = values['location'];
      if (location is String) {
        final target = origin.resolve(location);
        if (!allows(target)) {
          throw const FormatException('web_redirect_blocked');
        }
        response.headers.set('location', target.toString());
      }
      var bytes = base64Decode(encoded);
      if (bytes.length > maxResponseBytes) {
        throw const FormatException('web_response_invalid');
      }
      final contentType = (values['content-type'] as String? ?? '')
          .toLowerCase();
      observe(
        LocalWebResourcePhase.preparing,
        statusCode: status,
        isDocument: resource!.isDocument || contentType.contains('text/html'),
      );
      requestFailed = status >= 400;
      if (contentType.contains('text/html') ||
          contentType.contains('text/css') ||
          contentType.contains('javascript')) {
        // Relative URLs work naturally. Rewrite literal absolute references to this
        // one origin only; dynamically constructed cross-origin URLs remain blocked.
        final source = utf8.decode(bytes, allowMalformed: true);
        var rewritten = source.replaceAll(upstream.origin, origin.origin);
        if (contentType.contains('text/html')) {
          // Generated documentation commonly uses target=_blank. Keep internal
          // links/forms in this view without enabling popups or a native bridge.
          const navigationScript = '''<script>
addEventListener('click',function(e){const a=e.target.closest&&e.target.closest('a[href]');if(a&&new URL(a.href,location.href).origin===location.origin)a.target='_self';},true);
addEventListener('submit',function(e){if(e.target instanceof HTMLFormElement)e.target.target='_self';},true);
</script>''';
          final head = RegExp(r'<head(?:\s[^>]*)?>', caseSensitive: false);
          rewritten = head.hasMatch(rewritten)
              ? rewritten.replaceFirstMapped(
                  head,
                  (match) => '${match[0]}$navigationScript',
                )
              : '$navigationScript$rewritten';
          if (compatibilityScript.isNotEmpty) {
            // A short external script tag preserves early charset sniffing and
            // also works on pages whose own CSP permits only same-origin scripts.
            const tag =
                '<script defer src="/_relayune/compat/font-fallback.js"></script>';
            rewritten = rewritten.replaceFirst(
              navigationScript,
              '$navigationScript$tag',
            );
          }
        }
        bytes = Uint8List.fromList(utf8.encode(rewritten));
      }
      response.statusCode = status;
      if (incoming.method != 'HEAD' && status != 204 && status != 304) {
        response.add(bytes);
      }
    } on Object {
      requestFailed = true;
      if (!_closed) {
        response.statusCode = HttpStatus.badGateway;
        response.headers.contentType = ContentType.text;
        // A failed submission is never automatically repeated with a fresh ID.
        response.write(failureText);
      }
    } finally {
      if (admitted) _active--;
      try {
        await response.close();
        observe(
          requestFailed
              ? LocalWebResourcePhase.failed
              : LocalWebResourcePhase.complete,
          statusCode: response.statusCode,
        );
      } on Object {
        observe(LocalWebResourcePhase.failed);
        /* View closed. */
      }
    }
  }
}
