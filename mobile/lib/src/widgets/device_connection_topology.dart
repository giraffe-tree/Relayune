import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../state/device_connection.dart';
import '../ui/theme.dart';

enum DeviceConnectionLinkState {
  healthy,
  waiting,
  highLatency,
  reconnecting,
  offline,
  unknown,
}

const deviceConnectionHighLatencyThreshold = 250;

DeviceConnectionLinkState webSocketConnectionLinkState(
  DeviceConnectionSnapshot connection,
) => switch (connection.transport) {
  RealtimeTransportState.connected
      when connection.websocketHeartbeatAt == null =>
    DeviceConnectionLinkState.waiting,
  RealtimeTransportState.connected
      when (connection.websocketRoundTripMs ?? 0) >=
          deviceConnectionHighLatencyThreshold =>
    DeviceConnectionLinkState.highLatency,
  RealtimeTransportState.connected => DeviceConnectionLinkState.healthy,
  RealtimeTransportState.connecting ||
  RealtimeTransportState.reconnecting => DeviceConnectionLinkState.reconnecting,
  RealtimeTransportState.idle => DeviceConnectionLinkState.offline,
};

DeviceConnectionLinkState desktopConnectionLinkState(
  DeviceConnectionSnapshot connection,
) {
  if (connection.transport != RealtimeTransportState.connected) {
    return DeviceConnectionLinkState.unknown;
  }
  if (!connection.realtimeConfirmed) {
    return DeviceConnectionLinkState.unknown;
  }
  return connection.online
      ? DeviceConnectionLinkState.healthy
      : DeviceConnectionLinkState.offline;
}

Color deviceConnectionLinkColor(DeviceConnectionLinkState state) =>
    switch (state) {
      DeviceConnectionLinkState.healthy => RelayTheme.greenStrong,
      DeviceConnectionLinkState.highLatency ||
      DeviceConnectionLinkState.reconnecting => RelayTheme.amber,
      DeviceConnectionLinkState.offline => RelayTheme.red,
      DeviceConnectionLinkState.waiting => RelayTheme.mutedBright,
      DeviceConnectionLinkState.unknown => RelayTheme.muted,
    };

class DeviceConnectionTopology extends StatefulWidget {
  const DeviceConnectionTopology({
    super.key,
    required this.connection,
    required this.semanticLabel,
    required this.webSocketStatus,
    required this.webSocketHeartbeatLabel,
    required this.webSocketHeartbeatValue,
    required this.webSocketHeartbeatDetail,
    required this.webSocketRoundTripValue,
    required this.desktopStatus,
    required this.desktopHeartbeatLabel,
    required this.desktopHeartbeatValue,
    required this.desktopHeartbeatDetail,
  });

  final DeviceConnectionSnapshot connection;
  final String semanticLabel;
  final String webSocketStatus;
  final String webSocketHeartbeatLabel;
  final String webSocketHeartbeatValue;
  final String webSocketHeartbeatDetail;
  final String webSocketRoundTripValue;
  final String desktopStatus;
  final String desktopHeartbeatLabel;
  final String desktopHeartbeatValue;
  final String desktopHeartbeatDetail;

  @override
  State<DeviceConnectionTopology> createState() =>
      _DeviceConnectionTopologyState();
}

class _DeviceConnectionTopologyState extends State<DeviceConnectionTopology>
    with SingleTickerProviderStateMixin {
  late final AnimationController _flow = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2600),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncMotion();
  }

  @override
  void didUpdateWidget(DeviceConnectionTopology oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncMotion();
  }

  bool get _motionDisabled {
    final media = MediaQuery.maybeOf(context);
    return (media?.disableAnimations ?? false) ||
        (media?.accessibleNavigation ?? false);
  }

  void _syncMotion() {
    if (_motionDisabled) {
      _flow
        ..stop()
        ..value = .34;
    } else if (!_flow.isAnimating) {
      _flow.repeat();
    }
  }

  @override
  void dispose() {
    _flow.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final webSocketState = webSocketConnectionLinkState(widget.connection);
    final desktopState = desktopConnectionLinkState(widget.connection);
    final diagramSvg = _connectionTopologySvg(
      webSocketState: webSocketState,
      desktopState: desktopState,
    );
    return Semantics(
      key: const ValueKey('device-connection-topology'),
      container: true,
      image: true,
      label: widget.semanticLabel,
      child: ExcludeSemantics(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final canvasWidth = math.min(constraints.maxWidth, 390.0);
            final scale = canvasWidth / _diagramWidth;
            return Align(
              alignment: Alignment.topCenter,
              child: SizedBox(
                width: canvasWidth,
                height: _canvasHeight * scale,
                child: AnimatedBuilder(
                  animation: _flow,
                  builder: (context, _) => Stack(
                    clipBehavior: Clip.none,
                    children: [
                      _LinkCaption(
                        left: 40 * scale,
                        top: 0,
                        width: 103 * scale,
                        title: 'WebSocket',
                        status: widget.webSocketStatus,
                        metric: widget.webSocketRoundTripValue,
                        color: deviceConnectionLinkColor(webSocketState),
                      ),
                      _LinkCaption(
                        left: 157 * scale,
                        top: 0,
                        width: 103 * scale,
                        title: 'Desktop Relay',
                        status: widget.desktopStatus,
                        color: deviceConnectionLinkColor(desktopState),
                      ),
                      Positioned(
                        left: 0,
                        top: _topologyTop * scale,
                        width: canvasWidth,
                        height: _diagramHeight * scale,
                        child: AnimatedSwitcher(
                          duration: const Duration(milliseconds: 260),
                          switchInCurve: Curves.easeOutCubic,
                          switchOutCurve: Curves.easeInCubic,
                          child: SvgPicture.string(
                            diagramSvg,
                            key: ValueKey('$webSocketState-$desktopState'),
                            fit: BoxFit.fill,
                            excludeFromSemantics: true,
                          ),
                        ),
                      ),
                      if (_linkCarriesTraffic(webSocketState))
                        _FlowDot(
                          progress: _linkProgress(_flow.value, webSocketState),
                          startX: 55,
                          endX: 128,
                          y: _topologyTop + _linkY,
                          scaleX: scale,
                          scaleY: scale,
                          color: deviceConnectionLinkColor(webSocketState),
                        ),
                      if (_linkCarriesTraffic(desktopState))
                        _FlowDot(
                          progress: _linkProgress(
                            (_flow.value + .48) % 1,
                            desktopState,
                          ),
                          startX: 172,
                          endX: 245,
                          y: _topologyTop + _linkY,
                          scaleX: scale,
                          scaleY: scale,
                          color: deviceConnectionLinkColor(desktopState),
                        ),
                      _PositionedNodeLabel(
                        left: 0,
                        top: (_topologyTop + 72) * scale,
                        width: 64 * scale,
                        label: 'iPhone',
                      ),
                      _PositionedNodeLabel(
                        left: 118 * scale,
                        top: (_topologyTop + 72) * scale,
                        width: 64 * scale,
                        label: 'Server',
                      ),
                      _PositionedNodeLabel(
                        left: 236 * scale,
                        top: (_topologyTop + 72) * scale,
                        width: 64 * scale,
                        label: 'Mac',
                      ),
                      _HeartbeatCaption(
                        key: const ValueKey('device-last-websocket-heartbeat'),
                        left: 40 * scale,
                        top: _heartbeatTop * scale,
                        width: 103 * scale,
                        label: widget.webSocketHeartbeatLabel,
                        value: widget.webSocketHeartbeatValue,
                        detail: widget.webSocketHeartbeatDetail,
                        color: deviceConnectionLinkColor(webSocketState),
                      ),
                      _HeartbeatCaption(
                        key: const ValueKey('device-desktop-heartbeat'),
                        left: 157 * scale,
                        top: _heartbeatTop * scale,
                        width: 103 * scale,
                        label: widget.desktopHeartbeatLabel,
                        value: widget.desktopHeartbeatValue,
                        detail: widget.desktopHeartbeatDetail,
                        color: deviceConnectionLinkColor(desktopState),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _LinkCaption extends StatelessWidget {
  const _LinkCaption({
    required this.left,
    required this.top,
    required this.width,
    required this.title,
    required this.status,
    required this.color,
    this.metric,
  });

  final double left;
  final double top;
  final double width;
  final String title;
  final String status;
  final String? metric;
  final Color color;

  @override
  Widget build(BuildContext context) => Positioned(
    left: left,
    top: top,
    width: width,
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: RelayTheme.text,
            fontSize: 10,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 2),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Flexible(
              child: Text(
                status,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: color,
                  fontSize: 9,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            if (metric != null && metric != '—') ...[
              const Text(
                ' · ',
                style: TextStyle(color: RelayTheme.muted, fontSize: 9),
              ),
              Text(
                metric!,
                style: TextStyle(
                  color: color,
                  fontSize: 9,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ],
        ),
      ],
    ),
  );
}

class _PositionedNodeLabel extends StatelessWidget {
  const _PositionedNodeLabel({
    required this.left,
    required this.top,
    required this.width,
    required this.label,
  });

  final double left;
  final double top;
  final double width;
  final String label;

  @override
  Widget build(BuildContext context) => Positioned(
    left: left,
    top: top,
    width: width,
    child: Text(
      label,
      textAlign: TextAlign.center,
      style: const TextStyle(
        color: RelayTheme.mutedBright,
        fontSize: 10.5,
        fontWeight: FontWeight.w700,
        letterSpacing: .1,
      ),
    ),
  );
}

class _HeartbeatCaption extends StatelessWidget {
  const _HeartbeatCaption({
    super.key,
    required this.left,
    required this.top,
    required this.width,
    required this.label,
    required this.value,
    required this.detail,
    required this.color,
  });

  final double left;
  final double top;
  final double width;
  final String label;
  final String value;
  final String detail;
  final Color color;

  @override
  Widget build(BuildContext context) => Positioned(
    left: left,
    top: top,
    width: width,
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          textAlign: TextAlign.center,
          style: const TextStyle(color: RelayTheme.muted, fontSize: 9),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: color,
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          detail,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          textAlign: TextAlign.center,
          style: const TextStyle(color: RelayTheme.muted, fontSize: 8.5),
        ),
      ],
    ),
  );
}

class _FlowDot extends StatelessWidget {
  const _FlowDot({
    required this.progress,
    required this.startX,
    required this.endX,
    required this.y,
    required this.scaleX,
    required this.scaleY,
    required this.color,
  });

  final double progress;
  final double startX;
  final double endX;
  final double y;
  final double scaleX;
  final double scaleY;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final dotSize = math.max(5.5, 5.5 * math.min(scaleX, scaleY));
    final x = (startX + (endX - startX) * progress) * scaleX;
    return Positioned(
      left: x - dotSize / 2,
      top: y * scaleY - dotSize / 2,
      child: Container(
        width: dotSize,
        height: dotSize,
        decoration: BoxDecoration(
          color: color,
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(color: color.withValues(alpha: .45), blurRadius: 7),
          ],
        ),
      ),
    );
  }
}

bool _linkCarriesTraffic(DeviceConnectionLinkState state) =>
    state == DeviceConnectionLinkState.healthy ||
    state == DeviceConnectionLinkState.highLatency ||
    state == DeviceConnectionLinkState.reconnecting;

double _linkProgress(double progress, DeviceConnectionLinkState state) {
  if (state == DeviceConnectionLinkState.highLatency) {
    return Curves.easeInOutSine.transform(progress);
  }
  return progress;
}

const _diagramWidth = 300.0;
const _diagramHeight = 82.0;
const _canvasHeight = 164.0;
const _topologyTop = 28.0;
const _heartbeatTop = 125.0;
const _linkY = 41.0;

String _connectionTopologySvg({
  required DeviceConnectionLinkState webSocketState,
  required DeviceConnectionLinkState desktopState,
}) {
  final webSocketColor = _svgColor(deviceConnectionLinkColor(webSocketState));
  final desktopColor = _svgColor(deviceConnectionLinkColor(desktopState));
  final lineSoft = _svgColor(RelayTheme.lineSoft);
  final panelSoft = _svgColor(RelayTheme.panelSoft);
  final mutedBright = _svgColor(RelayTheme.mutedBright);
  final webSocketDash = _svgDash(webSocketState);
  final desktopDash = _svgDash(desktopState);
  return '''
<svg viewBox="0 0 300 82" xmlns="http://www.w3.org/2000/svg" fill="none">
  <path d="M55 41H128" stroke="$lineSoft" stroke-width="6" stroke-linecap="round"/>
  <path d="M172 41H245" stroke="$lineSoft" stroke-width="6" stroke-linecap="round"/>
  <path d="M55 41H128" stroke="$webSocketColor" stroke-width="3" stroke-linecap="round"$webSocketDash/>
  <path d="M172 41H245" stroke="$desktopColor" stroke-width="3" stroke-linecap="round"$desktopDash/>

  <circle cx="32" cy="41" r="24" fill="$panelSoft" stroke="$webSocketColor" stroke-width="2"/>
  <rect x="24" y="28" width="16" height="25" rx="4" stroke="$mutedBright" stroke-width="2"/>
  <path d="M29 31H35M30 49H34" stroke="$mutedBright" stroke-width="1.8" stroke-linecap="round"/>

  <circle cx="150" cy="41" r="27" fill="$panelSoft" stroke="$webSocketColor" stroke-width="2"/>
  <circle cx="150" cy="41" r="10" stroke="$mutedBright" stroke-width="2"/>
  <circle cx="150" cy="41" r="3.5" fill="$mutedBright"/>
  <path d="M150 25V31M150 51V57M134 41H140M160 41H166" stroke="$mutedBright" stroke-width="2" stroke-linecap="round"/>
  <circle cx="150" cy="25" r="2" fill="$mutedBright"/>
  <circle cx="150" cy="57" r="2" fill="$mutedBright"/>
  <circle cx="134" cy="41" r="2" fill="$mutedBright"/>
  <circle cx="166" cy="41" r="2" fill="$mutedBright"/>

  <circle cx="268" cy="41" r="24" fill="$panelSoft" stroke="$desktopColor" stroke-width="2"/>
  <rect x="257" y="30" width="22" height="16" rx="3" stroke="$mutedBright" stroke-width="2"/>
  <path d="M253 51H283M263 51L264.5 46H271.5L273 51" stroke="$mutedBright" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
''';
}

String _svgColor(Color color) =>
    '#${(color.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';

String _svgDash(DeviceConnectionLinkState state) => switch (state) {
  DeviceConnectionLinkState.healthy ||
  DeviceConnectionLinkState.highLatency => '',
  DeviceConnectionLinkState.waiting => ' stroke-dasharray="3 7"',
  DeviceConnectionLinkState.reconnecting => ' stroke-dasharray="7 7"',
  DeviceConnectionLinkState.offline => ' stroke-dasharray="13 9"',
  DeviceConnectionLinkState.unknown => ' stroke-dasharray="2 9"',
};
