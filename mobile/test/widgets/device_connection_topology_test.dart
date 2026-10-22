import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/state/device_connection.dart';
import 'package:relayune_mobile/src/ui/theme.dart';
import 'package:relayune_mobile/src/widgets/device_connection_topology.dart';

void main() {
  test('connection topology keeps both links independent', () {
    final connected = _snapshot(
      online: true,
      websocketHeartbeatAt: '2026-09-04T02:30:00.000Z',
      websocketRoundTripMs: 42,
    );
    expect(
      webSocketConnectionLinkState(connected),
      DeviceConnectionLinkState.healthy,
    );
    expect(
      desktopConnectionLinkState(connected),
      DeviceConnectionLinkState.healthy,
    );

    final macOffline = _snapshot(
      online: false,
      websocketHeartbeatAt: '2026-09-04T02:30:00.000Z',
      websocketRoundTripMs: 42,
    );
    expect(
      webSocketConnectionLinkState(macOffline),
      DeviceConnectionLinkState.healthy,
    );
    expect(
      desktopConnectionLinkState(macOffline),
      DeviceConnectionLinkState.offline,
    );
  });

  test('connection topology distinguishes degraded and unknown states', () {
    final slow = _snapshot(
      online: true,
      websocketHeartbeatAt: '2026-09-04T02:30:00.000Z',
      websocketRoundTripMs: deviceConnectionHighLatencyThreshold,
    );
    expect(
      webSocketConnectionLinkState(slow),
      DeviceConnectionLinkState.highLatency,
    );

    final reconnecting = _snapshot(
      online: true,
      transport: RealtimeTransportState.reconnecting,
    );
    expect(
      webSocketConnectionLinkState(reconnecting),
      DeviceConnectionLinkState.reconnecting,
    );
    expect(
      desktopConnectionLinkState(reconnecting),
      DeviceConnectionLinkState.unknown,
    );

    final unconfirmed = _snapshot(online: false, realtimeConfirmed: false);
    expect(
      desktopConnectionLinkState(unconfirmed),
      DeviceConnectionLinkState.unknown,
    );
  });

  testWidgets('connection topology renders heartbeat changes safely', (
    tester,
  ) async {
    final first = _snapshot(
      online: true,
      websocketHeartbeatAt: '2026-09-04T02:30:00.000Z',
      websocketRoundTripMs: 42,
    );
    await tester.pumpWidget(_TopologyHarness(connection: first));

    expect(
      find.byKey(const ValueKey('device-connection-topology')),
      findsOneWidget,
    );

    await tester.pumpWidget(
      _TopologyHarness(
        connection: _snapshot(
          online: true,
          lastSeenAt: '2026-09-04T02:30:08.000Z',
          websocketHeartbeatAt: '2026-09-04T02:30:30.000Z',
          websocketRoundTripMs: 48,
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 450));

    expect(tester.takeException(), isNull);
  });
}

class _TopologyHarness extends StatelessWidget {
  const _TopologyHarness({required this.connection});

  final DeviceConnectionSnapshot connection;

  @override
  Widget build(BuildContext context) => MaterialApp(
    theme: RelayTheme.web,
    home: Scaffold(
      body: Center(
        child: SizedBox(
          width: 330,
          child: DeviceConnectionTopology(
            connection: connection,
            semanticLabel: 'connection status',
            webSocketStatus: 'Heartbeat healthy',
            webSocketHeartbeatLabel: 'Last heartbeat',
            webSocketHeartbeatValue: 'Just now',
            webSocketHeartbeatDetail: '2026/9/4 10:30',
            webSocketRoundTripValue: '42 ms',
            desktopStatus: 'Online',
            desktopHeartbeatLabel: 'Computer heartbeat',
            desktopHeartbeatValue: 'Just now',
            desktopHeartbeatDetail: '2026/9/4 10:30',
          ),
        ),
      ),
    ),
  );
}

DeviceConnectionSnapshot _snapshot({
  required bool online,
  RealtimeTransportState transport = RealtimeTransportState.connected,
  bool realtimeConfirmed = true,
  String lastSeenAt = '2026-09-04T02:30:00.000Z',
  String? websocketHeartbeatAt,
  int? websocketRoundTripMs,
}) => DeviceConnectionSnapshot(
  online: online,
  lastSeenAt: lastSeenAt,
  revision: realtimeConfirmed ? 1 : 0,
  transport: transport,
  realtimeConfirmed: realtimeConfirmed,
  websocketHeartbeatAt: websocketHeartbeatAt,
  websocketRoundTripMs: websocketRoundTripMs,
);
