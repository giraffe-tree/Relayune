import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../models.dart';

const onlineReadTypes = {
  'session.read_history',
  'session.read_attachment',
  'session.read_agents',
  'project.locations',
  'project.check',
  'project.sessions',
  'project.browse',
};

// Local admission/send failure: unlike a remote unavailable/close receipt,
// this request never entered WSS and has no original HTTP result to recover.
class OnlineRequestNotSentError extends StateError {
  OnlineRequestNotSentError(super.message);
}

/// No durable state: each subscription belongs to one authenticated connection.
class OnlineStream {
  OnlineStream({
    required this.origin,
    required this.sessionToken,
    required this.browserToken,
    required this.deviceId,
    required this.onFrame,
    required this.onOnline,
    required this.onClosed,
    this.onPresence,
    this.connectSocket = _connectSocket,
    this.now = DateTime.now,
  });
  final String origin, sessionToken, browserToken, deviceId;
  final DateTime Function() now;
  final Future<void> Function(Map<String, dynamic>) onFrame;
  final void Function() onOnline, onClosed;
  final void Function(bool)? onPresence;
  final Future<WebSocket> Function(String, Map<String, String>) connectSocket;
  WebSocket? _socket;
  Timer? _renewal;
  Timer? _handshake;
  int? closeCode;
  DateTime? _lastRenewed;
  bool _closed = false;
  String? connectionId, browserId;
  bool relayOnline = false;
  int _queuedBytes = 0;
  Future<void> _receiving = Future.value();
  final _pending =
      <String, ({Completer<Map<String, dynamic>> result, Timer timer})>{};
  bool get available =>
      !_closed &&
      connectionId != null &&
      relayOnline &&
      _socket?.readyState == WebSocket.open;
  static Future<WebSocket> _connectSocket(
    String url,
    Map<String, String> headers,
  ) => WebSocket.connect(url, headers: headers);

  Future<void> connect() async {
    final base = Uri.parse(origin);
    final uri = base.replace(
      scheme: base.scheme == 'https' ? 'wss' : 'ws',
      path: '/api/stream',
      query: null,
      fragment: null,
    );
    final socket = await connectSocket(uri.toString(), {
      'Cookie': 'relay_session=${Uri.encodeComponent(sessionToken)}',
      'Origin': base.origin,
    });
    if (_closed) {
      await socket.close();
      return;
    }
    _socket = socket;
    _handshake = Timer(const Duration(seconds: 10), () {
      if (connectionId == null) close();
    });
    socket.listen(
      (raw) {
        if (_closed || !identical(socket, _socket)) return;
        if (raw is! String || utf8.encode(raw).length > 1048576) {
          close();
          return;
        }
        try {
          _receive(jsonMap(jsonDecode(raw)), utf8.encode(raw).length);
        } catch (_) {
          close();
        }
      },
      onDone: close,
      onError: (_) => close(),
    );
    socket.add(
      jsonEncode({
        'type': 'hello',
        'role': 'browser',
        'device_id': deviceId,
        'browser_token': browserToken,
      }),
    );
  }

  void _receive(Map<String, dynamic> value, int bytes) {
    if (value['type'] == 'ready') {
      if (connectionId != null ||
          value['connection_id'] is! String ||
          value['browser_id'] is! String) {
        close();
        return;
      }
      _handshake?.cancel();
      _handshake = null;
      connectionId = value['connection_id'] as String;
      browserId = value['browser_id'] as String;
      _lastRenewed = now();
      _renewal = Timer.periodic(const Duration(seconds: 10), (_) => renew());
    } else if (value['type'] == 'relay') {
      relayOnline = value['state'] == 'online';
      onPresence?.call(relayOnline);
      if (available) {
        onOnline();
      } else {
        _rejectPending();
      }
    } else if (value['type'] == 'unavailable' &&
        value['connection_id'] == connectionId) {
      final pending = _pending.remove(value['request_id']);
      pending?.timer.cancel();
      pending?.result.completeError(StateError('online_stream_unavailable'));
    } else if (value['type'] == 'frame' &&
        connectionId != null &&
        value['connection_id'] == connectionId &&
        value['browser_id'] == browserId &&
        value['frame'] is Map) {
      final frame = jsonMap(value['frame']);
      final pending = frame['kind'] == 'response'
          ? _pending.remove(frame['request_id'])
          : null;
      if (pending != null) {
        pending.timer.cancel();
        pending.result.complete(frame);
        return;
      }
      if (_queuedBytes + bytes > 2097152) {
        close();
        return;
      }
      _queuedBytes += bytes;
      _receiving = _receiving
          .then((_) async {
            if (!_closed) await onFrame(frame);
          })
          .catchError((Object _) {
            close();
          })
          .whenComplete(() {
            _queuedBytes -= bytes;
          });
    }
  }

  /// Called on the application event loop; native WebSocket pong cannot renew.
  void renew() {
    if (_closed) return;
    final time = now();
    if (_lastRenewed == null ||
        time.difference(_lastRenewed!) >= const Duration(seconds: 30) ||
        _socket?.readyState != WebSocket.open) {
      close();
      return;
    }
    _lastRenewed = time;
    _socket!.add(jsonEncode({'type': 'renew'}));
  }

  void send(Map<String, dynamic> frame) {
    if (!available) throw StateError('online_stream_unavailable');
    final body = jsonEncode({
      'type': 'frame',
      'browser_id': browserId,
      'connection_id': connectionId,
      'frame': {'kind': 'command', ...frame},
    });
    if (utf8.encode(body).length > 1048576) {
      throw StateError('online_stream_backpressure');
    }
    _socket!.add(body);
  }

  Future<Map<String, dynamic>> request(
    Map<String, dynamic> frame, {
    Duration timeout = const Duration(seconds: 8),
  }) {
    final id = frame['request_id'] as String;
    if (_pending.length >= 8 || _pending.containsKey(id)) {
      return Future.error(OnlineRequestNotSentError('online_stream_busy'));
    }
    final result = Completer<Map<String, dynamic>>();
    final timer = Timer(timeout, () {
      _pending.remove(id);
      result.completeError(TimeoutException('online_stream_timeout'));
    });
    _pending[id] = (result: result, timer: timer);
    try {
      send(frame);
    } catch (error) {
      timer.cancel();
      _pending.remove(id);
      result.completeError(
        OnlineRequestNotSentError(
          error is StateError ? error.message : 'online_stream_send_failed',
        ),
      );
    }
    return result.future;
  }

  void _rejectPending() {
    for (final value in _pending.values) {
      value.timer.cancel();
      value.result.completeError(StateError('online_stream_closed'));
    }
    _pending.clear();
  }

  void cancelRequest(
    String requestId, {
    Future<Map<String, dynamic>>? expectedFuture,
  }) {
    final pending = _pending[requestId];
    if (expectedFuture != null &&
        !identical(pending?.result.future, expectedFuture)) {
      return;
    }
    _pending.remove(requestId);
    pending?.timer.cancel();
    pending?.result.completeError(StateError('online_read_cancelled'));
  }

  void close() {
    if (_closed) return;
    _closed = true;
    connectionId = null;
    relayOnline = false;
    _handshake?.cancel();
    _renewal?.cancel();
    _rejectPending();
    closeCode = _socket?.closeCode;
    final socket = _socket;
    _socket = null;
    unawaited(
      socket?.close(WebSocketStatus.normalClosure, 'subscription ended'),
    );
    onClosed();
  }
}
