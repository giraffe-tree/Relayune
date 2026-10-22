import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import '../config.dart';
import 'instance_endpoint.dart';

class CommunityQr {
  const CommunityQr({
    required this.expiresAt,
    required this.imageUri,
    this.bytes,
  });

  final DateTime expiresAt;
  final Uri imageUri;
  final Uint8List? bytes;
  bool get expired => !expiresAt.isAfter(DateTime.now());
}

/// Public community content deliberately uses its own client, without account headers.
class CommunityApi {
  CommunityApi({http.Client? client, String? origin, String? certificatePem})
    : _client =
          client ??
          instanceHttpClient(
            certificatePem ?? RelayConfig.activeCertificatePem,
          ),
      _origin = Uri.parse(origin ?? RelayConfig.activeOrigin);
  final http.Client _client;
  final Uri _origin;

  Future<http.Response> _get(Uri uri, {Map<String, String>? headers}) async {
    final request = http.Request('GET', uri)..followRedirects = false;
    if (headers != null) request.headers.addAll(headers);
    return http.Response.fromStream(await _client.send(request));
  }

  Future<CommunityQr> load() async {
    final response = await _get(
      _origin
          .resolve('/community/current.json')
          .replace(
            queryParameters: {
              't': DateTime.now().microsecondsSinceEpoch.toString(),
            },
          ),
      headers: {'Cache-Control': 'no-cache, no-store'},
    ).timeout(const Duration(seconds: 15));
    if (response.statusCode != 200 || response.bodyBytes.length > 16384) {
      throw const FormatException('Community configuration unavailable');
    }
    final value = jsonDecode(response.body);
    if (value is! Map<String, dynamic>) {
      throw const FormatException('Invalid configuration');
    }
    final image = value['image'];
    final expiry = value['expiresAt'];
    if (image is! String ||
        !RegExp(
          r'^/community/assets/wechat-group-[a-zA-Z0-9-]+\.png$',
        ).hasMatch(image) ||
        expiry is! String ||
        !RegExp(r'(Z|[+-]\d{2}:\d{2})$').hasMatch(expiry)) {
      throw const FormatException('Invalid community QR');
    }
    final expiresAt = DateTime.parse(expiry);
    final uri = _origin.resolve(image);
    if (!expiresAt.isAfter(DateTime.now())) {
      return CommunityQr(expiresAt: expiresAt, imageUri: uri);
    }
    final picture = await _get(uri).timeout(const Duration(seconds: 15));
    final bytes = picture.bodyBytes;
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (picture.statusCode != 200 ||
        bytes.length < 8 ||
        bytes.length > 5 * 1024 * 1024 ||
        !List.generate(
          8,
          (index) => bytes[index] == signature[index],
        ).every((value) => value)) {
      throw const FormatException('Community image unavailable');
    }
    return CommunityQr(expiresAt: expiresAt, imageUri: uri, bytes: bytes);
  }

  void close() => _client.close();
}
