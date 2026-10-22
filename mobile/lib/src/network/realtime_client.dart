import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../models.dart';
import 'instance_endpoint.dart';

class RealtimeSignal {
  const RealtimeSignal({
    required this.type,
    required this.deviceId,
    this.online,
    this.lastSeenAt,
    this.revision,
    this.serverTime,
    this.roundTripMs,
    this.scopes = const [],
  });

  final String type;
  final String deviceId;
  final bool? online;
  final String? lastSeenAt;
  final int? revision;
  final String? serverTime;
  final int? roundTripMs;
  final List<String> scopes;

  factory RealtimeSignal.fromJson(Map<String, dynamic> json) {
    final type = json['type'];
    final deviceId = json['device_id'];
    if (type is! String || deviceId is! String) {
      throw const FormatException('实时消息格式无效。');
    }
    return RealtimeSignal(
      type: type,
      deviceId: deviceId,
      online: json['online'] as bool?,
      lastSeenAt: json['last_seen_at'] as String?,
      revision: (json['revision'] as num?)?.toInt(),
      serverTime: json['server_time'] as String?,
      roundTripMs: (json['round_trip_ms'] as num?)?.toInt(),
      scopes: (json['scopes'] as List? ?? const []).whereType<String>().toList(
        growable: false,
      ),
    );
  }
}

abstract class RealtimeConnection {
  Stream<RealtimeSignal> get signals;
  int? get closeCode;
  String? get closeReason;
  Future<void> close();
}

abstract class RealtimeConnector {
  Future<RealtimeConnection> connect({
    required String origin,
    required String sessionToken,
    required String browserToken,
    required String deviceId,
  });
}

class IoRealtimeConnector implements RealtimeConnector {
  const IoRealtimeConnector({this.connectSocket});
  final Future<WebSocket> Function(String, Map<String, String>)? connectSocket;

  @override
  Future<RealtimeConnection> connect({
    required String origin,
    required String sessionToken,
    required String browserToken,
    required String deviceId,
  }) async {
    final base = Uri.parse(origin);
    final uri = base.replace(
      scheme: base.scheme == 'https' ? 'wss' : 'ws',
      path: '/api/realtime',
      query: null,
      fragment: null,
    );
    final headers = {
      'Cookie': 'relay_session=${Uri.encodeComponent(sessionToken)}',
      'Origin': base.origin,
    };
    final socket = await (connectSocket != null
        ? connectSocket!(uri.toString(), headers)
        : connectInstanceSocket(origin, null, uri.toString(), headers));
    socket.add(
      jsonEncode({
        'type': 'subscribe',
        'device_id': deviceId,
        'browser_token': browserToken,
      }),
    );
    return _IoRealtimeConnection(socket);
  }
}

class _IoRealtimeConnection implements RealtimeConnection {
  _IoRealtimeConnection(this._socket)
    : signals = _socket.map((message) {
        if (message is! String) {
          throw const FormatException('实时消息必须为文本。');
        }
        return RealtimeSignal.fromJson(jsonMap(jsonDecode(message)));
      }).asBroadcastStream();

  final WebSocket _socket;

  @override
  final Stream<RealtimeSignal> signals;

  @override
  int? get closeCode => _socket.closeCode;

  @override
  String? get closeReason => _socket.closeReason;

  @override
  Future<void> close() async {
    await _socket.close(WebSocketStatus.goingAway, 'client paused');
  }
}
