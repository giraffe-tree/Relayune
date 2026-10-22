import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

/// Strict origin syntax prevents credentials, paths and redirects from silently
/// selecting a different instance. All remote access keeps normal TLS checks.
String normalizeInstanceOrigin(String value) {
  final uri = Uri.tryParse(value.trim());
  if (uri == null ||
      uri.scheme != 'https' ||
      uri.host.isEmpty ||
      uri.userInfo.isNotEmpty ||
      uri.hasQuery ||
      uri.hasFragment ||
      (uri.path.isNotEmpty && uri.path != '/') ||
      uri.port < 1) {
    throw const FormatException(
      'Use an HTTPS server origin without a path or credentials',
    );
  }
  return uri.origin;
}

/// Only isolated loopback fixtures opt into HTTP; runtime selection and build
/// defaults always take the strict HTTPS branch.
String normalizeApiOrigin(
  String value, {
  bool allowInsecureLoopbackForTesting = false,
}) {
  final uri = Uri.tryParse(value.trim());
  if (allowInsecureLoopbackForTesting &&
      uri != null &&
      uri.scheme == 'http' &&
      {'127.0.0.1', '::1', 'localhost'}.contains(uri.host) &&
      uri.userInfo.isEmpty &&
      !uri.hasQuery &&
      !uri.hasFragment &&
      (uri.path.isEmpty || uri.path == '/')) {
    return uri.origin;
  }
  return normalizeInstanceOrigin(value);
}

String? certificateFingerprint(String? pem) {
  if (pem == null || pem.trim().isEmpty) return null;
  if (utf8.encode(pem).length > 16384) {
    throw const FormatException('Instance CA certificate is too large');
  }
  final match = RegExp(
    r'^\s*-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+)\s*-----END CERTIFICATE-----\s*$',
  ).firstMatch(pem);
  if (match == null) {
    throw const FormatException('Import one public PEM CA certificate');
  }
  final der = base64.decode(match.group(1)!.replaceAll(RegExp(r'\s'), ''));
  // Parsing by the TLS engine rejects malformed certificates; private keys and
  // unrelated PEM blocks never reach the trust context.
  SecurityContext(
    withTrustedRoots: true,
  ).setTrustedCertificatesBytes(Platform.isIOS ? der : utf8.encode(pem));
  return sha256.convert(der).toString().toUpperCase();
}

HttpClient instanceIoClient(String? certificatePem) {
  final context = SecurityContext(withTrustedRoots: true);
  if (certificateFingerprint(certificatePem) != null) {
    final der = base64.decode(
      certificatePem!
          .replaceAll('-----BEGIN CERTIFICATE-----', '')
          .replaceAll('-----END CERTIFICATE-----', '')
          .replaceAll(RegExp(r'\s'), ''),
    );
    context.setTrustedCertificatesBytes(
      Platform.isIOS ? der : utf8.encode(certificatePem),
    );
  }
  return HttpClient(context: context);
}

http.Client instanceHttpClient(String? certificatePem) =>
    IOClient(instanceIoClient(certificatePem));

Future<WebSocket> connectInstanceSocket(
  String origin,
  String? certificatePem,
  String url,
  Map<String, String> headers, {
  bool allowInsecureLoopbackForTesting = false,
  void Function(HttpClient)? onClientCreated,
  void Function(HttpClient)? onClientClosed,
}) async {
  final uri = Uri.parse(url);
  final expected = Uri.parse(origin);
  final loopbackFixture =
      allowInsecureLoopbackForTesting &&
      expected.scheme == 'http' &&
      {'127.0.0.1', '::1', 'localhost'}.contains(expected.host);
  if (uri.scheme != (loopbackFixture ? 'ws' : 'wss') ||
      uri.host != expected.host ||
      uri.port != expected.port ||
      uri.userInfo.isNotEmpty) {
    throw const FormatException(
      'Socket origin does not match the confirmed instance',
    );
  }
  final client = instanceIoClient(certificatePem);
  onClientCreated?.call(client);
  void closeClient() {
    client.close(force: true);
    onClientClosed?.call(client);
  }

  try {
    final socket = await WebSocket.connect(
      url,
      headers: headers,
      customClient: _SocketHandshakeClient(client, Uri.parse(origin)),
    );
    // The HTTP client's owner is released when the socket finishes.
    socket.done.then<void>(
      (_) => closeClient(),
      onError: (Object _, StackTrace __) => closeClient(),
    );
    return socket;
  } catch (_) {
    closeClient();
    rethrow;
  }
}

/// WebSocket.connect otherwise follows HttpClient's default redirects before
/// validating the upgrade. It needs only openUrl from its custom client.
class _SocketHandshakeClient implements HttpClient {
  _SocketHandshakeClient(this.inner, this.origin);
  final HttpClient inner;
  final Uri origin;
  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async {
    if (url.scheme != origin.scheme ||
        url.host != origin.host ||
        url.port != origin.port) {
      throw const FormatException('Socket handshake origin mismatch');
    }
    final request = await inner.openUrl(method, url);
    request.followRedirects = false;
    return request;
  }

  @override
  void close({bool force = false}) => inner.close(force: force);
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
