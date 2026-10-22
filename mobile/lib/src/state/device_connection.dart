enum RealtimeTransportState { idle, connecting, connected, reconnecting }

Duration realtimeReconnectDelay({
  required int attempt,
  required double randomValue,
  Duration base = const Duration(milliseconds: 500),
  Duration maximum = const Duration(seconds: 30),
}) {
  final boundedAttempt = attempt.clamp(0, 6);
  final boundedRandom = randomValue.clamp(0.0, 1.0);
  final exponential = base.inMilliseconds * (1 << boundedAttempt);
  final bounded = exponential.clamp(0, maximum.inMilliseconds);
  return Duration(
    milliseconds: (bounded * (0.75 + boundedRandom * 0.5)).round(),
  );
}

class DeviceConnectionSnapshot {
  const DeviceConnectionSnapshot({
    required this.online,
    required this.lastSeenAt,
    required this.revision,
    required this.transport,
    required this.realtimeConfirmed,
    this.websocketHeartbeatAt,
    this.websocketRoundTripMs,
  });

  const DeviceConnectionSnapshot.initial()
    : online = false,
      lastSeenAt = null,
      revision = 0,
      transport = RealtimeTransportState.idle,
      realtimeConfirmed = false,
      websocketHeartbeatAt = null,
      websocketRoundTripMs = null;

  final bool online;
  final String? lastSeenAt;
  final int revision;
  final RealtimeTransportState transport;
  final bool realtimeConfirmed;
  final String? websocketHeartbeatAt;
  final int? websocketRoundTripMs;

  DeviceConnectionSnapshot fromBootstrap({
    required bool online,
    required String? lastSeenAt,
  }) => DeviceConnectionSnapshot(
    online: online,
    lastSeenAt: lastSeenAt,
    revision: realtimeConfirmed ? revision : 0,
    transport: transport,
    realtimeConfirmed: realtimeConfirmed,
    websocketHeartbeatAt: websocketHeartbeatAt,
    websocketRoundTripMs: websocketRoundTripMs,
  );

  DeviceConnectionSnapshot withTransport(RealtimeTransportState next) =>
      DeviceConnectionSnapshot(
        online: online,
        lastSeenAt: lastSeenAt,
        revision: revision,
        transport: next,
        realtimeConfirmed: realtimeConfirmed,
        websocketHeartbeatAt: websocketHeartbeatAt,
        websocketRoundTripMs: websocketRoundTripMs,
      );

  DeviceConnectionSnapshot observeWebSocketHeartbeat({
    required String receivedAt,
    required int roundTripMs,
  }) => DeviceConnectionSnapshot(
    online: online,
    lastSeenAt: lastSeenAt,
    revision: revision,
    transport: transport,
    realtimeConfirmed: realtimeConfirmed,
    websocketHeartbeatAt: receivedAt,
    websocketRoundTripMs: roundTripMs,
  );

  DeviceConnectionSnapshot applyPresence({
    required bool online,
    required String? lastSeenAt,
    required int revision,
  }) {
    if (realtimeConfirmed && revision <= this.revision) return this;
    return DeviceConnectionSnapshot(
      online: online,
      lastSeenAt: lastSeenAt,
      revision: revision,
      transport: transport,
      realtimeConfirmed: true,
      websocketHeartbeatAt: websocketHeartbeatAt,
      websocketRoundTripMs: websocketRoundTripMs,
    );
  }

  DeviceConnectionSnapshot resetRealtimeConfirmation() =>
      DeviceConnectionSnapshot(
        online: online,
        lastSeenAt: lastSeenAt,
        revision: 0,
        transport: transport,
        realtimeConfirmed: false,
        websocketHeartbeatAt: websocketHeartbeatAt,
        websocketRoundTripMs: websocketRoundTripMs,
      );
}
