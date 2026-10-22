import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../state/device_connection.dart';
import '../ui/theme.dart';

enum DeviceConnectionVisualState { online, reconnecting, offline }

DeviceConnectionVisualState deviceConnectionVisualState({
  required bool online,
  required RealtimeTransportState transport,
}) {
  if (transport != RealtimeTransportState.connected) {
    return DeviceConnectionVisualState.reconnecting;
  }
  return online
      ? DeviceConnectionVisualState.online
      : DeviceConnectionVisualState.offline;
}

Color deviceConnectionColor(DeviceConnectionVisualState state) =>
    switch (state) {
      DeviceConnectionVisualState.online => RelayTheme.greenStrong,
      DeviceConnectionVisualState.reconnecting => RelayTheme.amber,
      DeviceConnectionVisualState.offline => RelayTheme.muted,
    };

Color deviceConnectionBackground(DeviceConnectionVisualState state) =>
    switch (state) {
      DeviceConnectionVisualState.online => RelayTheme.greenBackground,
      DeviceConnectionVisualState.reconnecting => RelayTheme.amberBackground,
      DeviceConnectionVisualState.offline => RelayTheme.panelRaised,
    };

/// Scheme A: a quiet device silhouette with a separate status badge.
/// The transparent cutout lets the SVG sit on any device-card background.
class DeviceConnectionIcon extends StatelessWidget {
  const DeviceConnectionIcon({
    super.key,
    required this.online,
    required this.transport,
    required this.semanticLabel,
    this.size = 24,
  });

  final bool online;
  final RealtimeTransportState transport;
  final String semanticLabel;
  final double size;

  @override
  Widget build(BuildContext context) {
    final state = deviceConnectionVisualState(
      online: online,
      transport: transport,
    );
    return Semantics(
      label: semanticLabel,
      image: true,
      child: SvgPicture.string(
        _deviceSvg(state),
        width: size,
        height: size,
        excludeFromSemantics: true,
      ),
    );
  }
}

String _deviceSvg(DeviceConnectionVisualState state) {
  final bodyColor = state == DeviceConnectionVisualState.offline
      ? '#747e79'
      : '#e4e8e6';
  final badge = switch (state) {
    DeviceConnectionVisualState.online =>
      '<circle cx="19" cy="19" r="2.6" fill="#93e1bc"/>',
    DeviceConnectionVisualState.reconnecting =>
      '<path d="M16.5 19a2.5 2.5 0 1 1 2.5 2.5" fill="none" '
          'stroke="#e2bc79" stroke-width="1.7" stroke-linecap="round"/>',
    DeviceConnectionVisualState.offline =>
      '<circle cx="19" cy="19" r="2.5" fill="none" '
          'stroke="#747e79" stroke-width="1.6"/>'
          '<path d="M17.8 19h2.4" stroke="#747e79" stroke-width="1.3"/>',
  };
  return '''
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <mask id="device-body" x="0" y="0" width="24" height="24" maskUnits="userSpaceOnUse">
      <rect width="24" height="24" fill="#fff"/>
      <circle cx="19" cy="19" r="4" fill="#000"/>
    </mask>
  </defs>
  <g mask="url(#device-body)" fill="none" stroke="$bodyColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="4.5" width="17" height="12" rx="2.3"/>
    <path d="M8 20h6M11.5 16.5V20"/>
  </g>
  $badge
</svg>
''';
}
