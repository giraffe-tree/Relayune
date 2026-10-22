import 'dart:async';
import 'dart:convert';

import 'package:flutter_webrtc/flutter_webrtc.dart';

/// Authenticated session data channel. No media is requested.
class WebRtcReadTransport {
  WebRtcReadTransport({
    required this.signal,
    required this.onChanged,
    this.onEvent,
    this.trickle = false,
    this.exchangeCandidates,
  });

  final Future<Map<String, dynamic>> Function(String sdp) signal;
  final bool trickle;
  final Future<Map<String, dynamic>> Function(
    String connectionId,
    List<Map<String, dynamic>> candidates,
    int cursor,
  )?
  exchangeCandidates;
  String? pathLabel;
  final void Function() onChanged;
  final Future<void> Function(Map<String, dynamic>)? onEvent;
  final _events = <String, ReadChunkAssembly>{};
  Future<void> _sendChain = Future.value();
  Future<void> _eventChain = Future.value();
  RTCPeerConnection? _peer;
  RTCDataChannel? _channel;
  final _pending = <String, _ReadAssembly>{};
  int _generation = 0;
  String? failureStage;
  bool connecting = false;
  bool connected = false;
  bool sessionReady = false;
  int? roundTripMs;
  DateTime? roundTripAt;
  int? connectionMs;
  final Map<String, int> connectionTimingsMs = {};
  int receivedBytes = 0;
  int _sending = 0;
  bool get busy => _pending.isNotEmpty || _sending > 0 || _events.isNotEmpty;

  Future<void> connect() async {
    if (connecting || connected) return;
    final generation = ++_generation;
    failureStage = null;
    pathLabel = null;
    connectionTimingsMs.clear();
    Future<T> timed<T>(String name, Future<T> Function() work) async {
      final watch = Stopwatch()..start();
      try {
        return await work();
      } finally {
        connectionTimingsMs[name] = watch.elapsedMilliseconds;
      }
    }

    var stage = 'create';
    connecting = true;
    onChanged();
    late RTCPeerConnection peer;
    try {
      peer = await timed(
        'create_peer',
        () => createPeerConnection({
          'iceServers': [
            {'urls': 'stun:stun.cloudflare.com:3478'},
          ],
          'iceTransportPolicy': 'all',
        }),
      );
      if (generation != _generation) {
        await _disposePeer(peer);
        return;
      }
      _peer = peer;
      final localCandidates = <Map<String, dynamic>>[];
      peer.onIceCandidate = (candidate) {
        if (generation != _generation || localCandidates.length >= 64) return;
        if (candidate.candidate?.isNotEmpty == true) {
          localCandidates.add(candidate.toMap());
        }
      };
      final gathered = Completer<void>();
      final opened = Completer<void>();
      // Observe failure futures before asynchronous signaling can fail.
      peer.onIceGatheringState = (state) {
        if (state == RTCIceGatheringState.RTCIceGatheringStateComplete &&
            !gathered.isCompleted) {
          gathered.complete();
        }
      };
      peer.onConnectionState = (state) {
        if (generation != _generation) return;
        if (state == RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
            state ==
                RTCPeerConnectionState.RTCPeerConnectionStateDisconnected ||
            state == RTCPeerConnectionState.RTCPeerConnectionStateClosed) {
          close();
        }
      };
      final channel = await timed(
        'create_channel',
        () => peer.createDataChannel(
          'relayune-session-v2',
          RTCDataChannelInit()..ordered = true,
        ),
      );
      if (generation != _generation) {
        await channel.close();
        return;
      }
      _channel = channel;
      channel.onDataChannelState = (state) {
        if (generation != _generation) return;
        if (state == RTCDataChannelState.RTCDataChannelOpen) {
          if (!opened.isCompleted) opened.complete();
        } else if (state == RTCDataChannelState.RTCDataChannelClosed) {
          close();
        }
      };
      channel.onMessage = (message) {
        if (generation != _generation) return;
        try {
          _receive(message);
        } catch (_) {
          close();
        }
      };
      stage = 'gather';
      await timed(
        'create_offer',
        () async => peer.setLocalDescription(
          await peer.createOffer({
            'mandatory': {
              'OfferToReceiveAudio': false,
              'OfferToReceiveVideo': false,
            },
            'optional': <dynamic>[],
          }),
        ),
      );
      if (!trickle) {
        await timed(
          'gather_candidates',
          () => gathered.future.timeout(
            const Duration(seconds: 8),
            onTimeout: () {},
          ),
        );
      }
      if (generation != _generation) return;
      stage = 'signal';
      final answer = await timed('signaling', () async {
        final description = await peer.getLocalDescription();
        return signal(description!.sdp!).timeout(const Duration(seconds: 20));
      });
      if (generation != _generation) return;
      if (answer['sdp'] is! String ||
          (answer['sdp'] as String).length > 48000) {
        throw const FormatException('webrtc_answer_invalid');
      }
      stage = 'answer';
      await timed(
        'apply_answer',
        () => peer.setRemoteDescription(
          RTCSessionDescription(answer['sdp'] as String, 'answer'),
        ),
      );
      if (trickle && exchangeCandidates != null) {
        unawaited(() async {
          var sent = 0;
          var cursor = 0;
          final deadline = DateTime.now().add(const Duration(seconds: 30));
          try {
            while (generation == _generation &&
                DateTime.now().isBefore(deadline)) {
              final batch = localCandidates.sublist(sent);
              final response = await exchangeCandidates!(
                answer['connection_id'] as String,
                batch,
                cursor,
              );
              if (generation != _generation) return;
              final candidates = response['candidates'];
              final next = response['cursor'];
              if (candidates is! List ||
                  candidates.length > 64 ||
                  next is! int ||
                  next != cursor + candidates.length ||
                  next > 64) {
                throw const FormatException('webrtc_candidates_invalid');
              }
              for (final raw in candidates) {
                if (raw is! Map ||
                    raw['candidate'] is! String ||
                    (raw['candidate'] as String).length > 2048 ||
                    !(raw['candidate'] as String).startsWith('candidate:') ||
                    (raw['sdpMid'] != null &&
                        (raw['sdpMid'] is! String ||
                            (raw['sdpMid'] as String).length > 32)) ||
                    (raw['sdpMLineIndex'] != null &&
                        raw['sdpMLineIndex'] != 0)) {
                  throw const FormatException('webrtc_candidates_invalid');
                }
                await peer.addCandidate(
                  RTCIceCandidate(
                    raw['candidate'] as String,
                    raw['sdpMid'] as String?,
                    raw['sdpMLineIndex'] as int?,
                  ),
                );
                if (generation != _generation) return;
              }
              sent += batch.length;
              cursor = next;
              if (connected ||
                  (gathered.isCompleted &&
                      response['complete'] == true &&
                      sent == localCandidates.length)) {
                return;
              }
              await Future<void>.delayed(const Duration(milliseconds: 250));
            }
          } catch (_) {
            if (generation == _generation && !connected) {
              failureStage = 'candidates';
              close();
            }
          }
        }());
      }
      stage = 'open';
      await timed(
        'open_channel',
        () => opened.future.timeout(const Duration(seconds: 10)),
      );
      if (generation != _generation) return;
      connected = true;
      await refreshPath();
      if (generation != _generation) return;
      connecting = false;
      onChanged();
    } catch (_) {
      if (generation == _generation) {
        failureStage = stage;
        close();
      }
    }
  }

  Future<void> refreshPath() async {
    final peer = _peer;
    final generation = _generation;
    if (peer == null || !connected) return;
    try {
      final reports = await peer.getStats().timeout(const Duration(seconds: 2));
      if (generation != _generation) return;
      final next = selectedIcePath(
        reports
            .map(
              (r) => <String, dynamic>{
                'id': r.id,
                'type': r.type,
                ...Map<String, dynamic>.from(r.values),
              },
            )
            .toList(),
      );
      if (pathLabel != next) {
        pathLabel = next;
        onChanged();
      }
    } catch (_) {
      /* Diagnostics must never fail a working connection. */
    }
  }

  Future<Map<String, dynamic>> read(
    Map<String, dynamic> frame, {
    bool receipt = false,
    Duration timeout = const Duration(seconds: 20),
  }) async {
    if (!connected || _pending.length >= 4) {
      throw StateError('webrtc_unavailable');
    }
    final id = frame['request_id'] as String;
    final wire = jsonEncode(frame);
    if (wire.length > 44 * 1024 * 1024 || _pending.containsKey(id)) {
      throw StateError('webrtc_request_invalid');
    }
    final pending = _ReadAssembly()..receipt = receipt;
    _pending[id] = pending;
    try {
      // Install the timeout/error handler before invoking the platform channel.
      final result = pending.result.future.timeout(timeout);
      unawaited(
        send(frame).catchError((Object error) {
          if (!pending.result.isCompleted) pending.result.completeError(error);
        }),
      );
      return await result;
    } finally {
      _pending.remove(id);
    }
  }

  Future<void> send(Map<String, dynamic> frame) {
    final generation = _generation;
    _sending++;
    final operation = _sendChain.catchError((Object _) {}).then((_) async {
      final wire = jsonEncode(frame);
      if (wire.length > 44 * 1024 * 1024) {
        throw StateError('webrtc_request_invalid');
      }
      final total = (wire.length / 12000).ceil();
      for (var index = 0; index < total; index++) {
        if (!connected || generation != _generation) {
          throw StateError('webrtc_closed');
        }
        final end = ((index + 1) * 12000).clamp(0, wire.length);
        await _channel!.send(
          RTCDataChannelMessage(
            jsonEncode({
              'type': 'chunk',
              'request_id': frame['request_id'],
              'index': index,
              'total': total,
              'length': wire.length,
              'data': wire.substring(index * 12000, end),
            }),
          ),
        );
        // Bound the native SCTP queue even for encrypted attachment uploads.
        final deadline = DateTime.now().add(const Duration(seconds: 10));
        while ((await _channel?.getBufferedAmount() ?? 0) > 256000) {
          if (generation != _generation || DateTime.now().isAfter(deadline)) {
            throw StateError('webrtc_backpressure');
          }
          await Future<void>.delayed(const Duration(milliseconds: 10));
        }
      }
    });
    _sendChain = operation;
    return operation.whenComplete(() => _sending--);
  }

  void setProgress(String id, void Function(int, int)? callback) {
    _pending[id]?.onProgress = callback;
  }

  void _receive(RTCDataChannelMessage message) {
    if (message.isBinary || message.text.length > 14000) {
      throw const FormatException('webrtc_chunk_invalid');
    }
    final chunk = jsonDecode(message.text) as Map<String, dynamic>;
    final streamId = chunk['stream_id'];
    if (streamId is String) {
      if (!_events.containsKey(streamId) && _events.length >= 4) {
        throw StateError('webrtc_event_overflow');
      }
      final assembly = _events.putIfAbsent(streamId, ReadChunkAssembly.new);
      final result = assembly.add(chunk);
      if (result != null) {
        _events.remove(streamId);
        final generation = _generation;
        _eventChain = _eventChain
            .then((_) async {
              if (generation == _generation) await onEvent?.call(result);
            })
            .catchError((Object _) {
              if (generation == _generation) close();
            });
      }
      return;
    }
    final pending = _pending[chunk['request_id']];
    if (pending == null || pending.result.isCompleted) return;
    final result = pending.assembly.add(chunk);
    receivedBytes += (chunk['data'] as String).length;
    pending.onProgress?.call(
      pending.assembly._length,
      pending.assembly._expectedLength!,
    );
    if (result != null) {
      pending.assembly = ReadChunkAssembly();
      if ((result['kind'] == 'receipt') == pending.receipt) {
        pending.result.complete(result);
      }
    }
  }

  void close() {
    ++_generation;
    final peer = _peer;
    final channel = _channel;
    _peer = null;
    _channel = null;
    connected = false;
    sessionReady = false;
    pathLabel = null;
    roundTripMs = null;
    roundTripAt = null;
    connectionMs = null;
    connecting = false;
    for (final pending in _pending.values) {
      if (!pending.result.isCompleted) {
        pending.result.completeError(StateError('webrtc_closed'));
      }
    }
    _pending.clear();
    _events.clear();
    unawaited(() async {
      try {
        await channel?.close();
      } catch (_) {}
      if (peer != null) await _disposePeer(peer);
    }());
    onChanged();
  }

  static Future<void> _disposePeer(RTCPeerConnection peer) async {
    // dispose cancels Dart event subscriptions before native teardown. Calling
    // close first removes iOS event handlers too early and leaks stream errors.
    try {
      await peer.dispose();
    } catch (_) {}
  }
}

/// Bounded, strictly ordered assembly; authenticated envelope validation follows.
class ReadChunkAssembly {
  final _parts = <String>[];
  int _length = 0;
  int? _expectedLength;
  int? _expectedTotal;

  Map<String, dynamic>? add(Map<String, dynamic> chunk) {
    final total = chunk['total'];
    final length = chunk['length'];
    final data = chunk['data'];
    if (chunk['type'] != 'chunk' ||
        chunk['index'] != _parts.length ||
        total is! int ||
        total < 1 ||
        total > 3845 ||
        length is! int ||
        length < 1 ||
        length > 44 * 1024 * 1024 ||
        total != (length / 12000).ceil() ||
        data is! String ||
        data.isEmpty ||
        data.length > 12000 ||
        (_expectedLength != null && _expectedLength != length) ||
        (_expectedTotal != null && _expectedTotal != total) ||
        _parts.length >= total) {
      throw const FormatException('webrtc_chunk_invalid');
    }
    _expectedLength = length;
    _expectedTotal = total;
    _length += data.length;
    if (_length > length) throw const FormatException('webrtc_chunk_overflow');
    _parts.add(data);
    if (_parts.length != total) return null;
    if (_length != length) {
      throw const FormatException('webrtc_chunk_incomplete');
    }
    return jsonDecode(_parts.join()) as Map<String, dynamic>;
  }
}

class _ReadAssembly {
  final result = Completer<Map<String, dynamic>>();
  ReadChunkAssembly assembly = ReadChunkAssembly();
  bool receipt = false;
  void Function(int, int)? onProgress;
}

/// Only classify the nominated route, never infer LAN/VPN from low latency.
String? selectedIcePath(List<Map<String, dynamic>> reports) {
  final byId = {for (final r in reports) r['id']: r};
  Map<String, dynamic>? pair;
  for (final r in reports) {
    if (r['type'] == 'transport' &&
        byId[r['selectedCandidatePairId']] != null) {
      pair = byId[r['selectedCandidatePairId']];
      break;
    }
  }
  pair ??= reports
      .where(
        (r) =>
            r['type'] == 'candidate-pair' &&
            r['state'] == 'succeeded' &&
            (r['selected'] == true || r['nominated'] == true),
      )
      .firstOrNull;
  if (pair == null) return null;
  final local = byId[pair['localCandidateId']];
  final remote = byId[pair['remoteCandidateId']];
  if (local == null || remote == null) return null;
  final types = [local['candidateType'], remote['candidateType']];
  if (types.contains('relay')) return 'TURN';
  if (types.contains('srflx') || types.contains('prflx')) return 'NAT';
  if (types.every((t) => t == 'host')) {
    final a = local['address'] ?? local['ip'];
    final b = remote['address'] ?? remote['ip'];
    if (a is String && b is String && a.contains(':') && b.contains(':')) {
      return 'V6';
    }
    return 'HOST';
  }
  return null;
}
