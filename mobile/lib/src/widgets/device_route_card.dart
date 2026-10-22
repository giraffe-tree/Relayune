import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../ui/theme.dart';
import '../state/device_connection.dart';

Color serverNodeColor(DeviceConnectionSnapshot connection) =>
    switch (connection.transport) {
      RealtimeTransportState.connected => RelayTheme.greenStrong,
      RealtimeTransportState.reconnecting => RelayTheme.red,
      RealtimeTransportState.connecting => RelayTheme.muted,
      RealtimeTransportState.idle =>
        connection.websocketHeartbeatAt == null
            ? RelayTheme.muted
            : RelayTheme.red,
    };

const routeNegotiatingColor = Color(0xFF9AAEC6);

class DeviceRouteCard extends StatelessWidget {
  const DeviceRouteCard({
    super.key,
    required this.status,
    required this.online,
    required this.automatic,
    this.roundTripMs,
    this.connectionMs,
    this.pathLabel,
    this.webSocketColor = RelayTheme.muted,
    this.desktopColor = RelayTheme.muted,
    this.serverColor = RelayTheme.muted,
    this.webSocketLines = const ['WebSocket', '—', '—', '', '—', ''],
    this.desktopLines = const ['Desktop Relay', '—', '', '', '—', ''],
    this.webSocketConnected = false,
    this.desktopConnected = false,
    this.realtimeSemanticLabel = '',
  });
  final String status;
  final String? pathLabel;
  final bool online, automatic;
  final int? roundTripMs, connectionMs;
  final Color webSocketColor, desktopColor;
  final Color serverColor;
  final List<String> webSocketLines, desktopLines;
  final bool webSocketConnected, desktopConnected;
  final String realtimeSemanticLabel;

  @override
  Widget build(BuildContext context) {
    final zh = Localizations.localeOf(context).languageCode == 'zh';
    String text(String chinese, String english) => zh ? chinese : english;
    final direct = online && status == 'direct';
    final checking = online && status == 'connecting';
    final title = direct
        ? text('直连已建立', 'Direct connected')
        : checking
        ? text('连接中', 'Connecting')
        : !online
        ? text('等待电脑上线', 'Waiting for your computer')
        : text('服务器中转', 'Server relay');
    final route = direct
        ? text('WebRTC 直连', 'WebRTC direct')
        : online && webSocketConnected
        ? text('服务器中转', 'Server relay')
        : text('等待连接', 'Waiting for connection');
    final rtt = direct && roundTripMs != null ? '$roundTripMs ms' : '—';
    final setup = direct && connectionMs != null
        ? '${(connectionMs! / 1000).toStringAsFixed(1)} s'
        : '—';
    final upperColor = direct
        ? RelayTheme.greenStrong
        : checking
        ? routeNegotiatingColor
        : RelayTheme.muted;
    return Card(
      key: const ValueKey('device-route-card'),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    text('实时连接', 'Realtime connection'),
                    style: const TextStyle(
                      color: RelayTheme.mutedBright,
                      fontSize: 12,
                    ),
                  ),
                ),
                Text(
                  automatic
                      ? text('自动选择', 'Automatic')
                      : text('服务器模式', 'Server mode'),
                  style: const TextStyle(color: RelayTheme.muted, fontSize: 11),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text(
              title,
              key: const ValueKey('device-route-status'),
              style: const TextStyle(
                fontSize: 25,
                fontWeight: FontWeight.w600,
                color: RelayTheme.text,
              ),
            ),
            const SizedBox(height: 24),
            Semantics(
              key: const ValueKey('device-route-svg'),
              image: true,
              label:
                  '$title. $route. ${text('往返延迟', 'Round trip')} $rtt. ${text('建立耗时', 'Connection setup')} $setup. $realtimeSemanticLabel',
              child: ExcludeSemantics(
                child: LayoutBuilder(
                  builder: (context, bounds) {
                    final scale = bounds.maxWidth / 320;
                    const lineStyle = TextStyle(fontSize: 11, height: 1.45);
                    double measure(String value, double width) {
                      final painter = TextPainter(
                        text: TextSpan(
                          text: value,
                          style: DefaultTextStyle.of(
                            context,
                          ).style.merge(lineStyle),
                        ),
                        textDirection: Directionality.of(context),
                        textScaler: MediaQuery.textScalerOf(context),
                      )..layout(maxWidth: width);
                      final result = painter.height;
                      painter.dispose();
                      return result;
                    }

                    final directLabel = checking
                        ? text('WebRTC · 连接中', 'WebRTC · connecting')
                        : direct && pathLabel != null
                        ? 'WebRTC · $pathLabel'
                        : 'WebRTC';
                    final directHeight =
                        measure(directLabel, bounds.maxWidth) +
                        (direct
                            ? measure(
                                    '${text('往返', 'RTT')} · $rtt',
                                    bounds.maxWidth,
                                  ) +
                                  measure(
                                    '${text('建连', 'Setup')} · $setup',
                                    bounds.maxWidth,
                                  )
                            : 0);
                    final labelWidth = 106 * scale;
                    final leftLines = [webSocketLines[0], webSocketLines[2]];
                    final leftHeartbeat =
                        '${text('心跳', 'Heartbeat')} · ${webSocketLines[4]}';
                    final rightHeartbeat =
                        '${text('心跳', 'Heartbeat')} · ${desktopLines[4]}';
                    double labelHeight(List<String> lines) =>
                        lines.fold<double>(
                          0,
                          (height, line) => height + measure(line, labelWidth),
                        );
                    final labelsHeight = labelHeight(leftLines);
                    final labelTop = directHeight + 64 * scale;
                    final railY = labelTop + labelsHeight + 22 * scale;
                    final arcTop = directHeight + 5 * scale;
                    final annotationHeight = math.max(
                      measure(leftHeartbeat, labelWidth),
                      measure(rightHeartbeat, labelWidth),
                    );
                    final diagramHeight =
                        railY +
                        math.max(34 * scale, annotationHeight + 16 * scale);
                    Widget labels(List<String> lines, Color color) => Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        for (final line in lines)
                          Text(
                            line,
                            textAlign: TextAlign.center,
                            style: lineStyle.copyWith(color: color),
                          ),
                      ],
                    );
                    return SizedBox(
                      key: const ValueKey('device-connection-topology'),
                      height: diagramHeight,
                      child: Stack(
                        children: [
                          Positioned.fill(
                            child: SvgPicture.string(
                              deviceRouteSvg(
                                direct: direct,
                                checking: checking,
                                online: online,
                                railY: railY / scale,
                                canvasHeight: diagramHeight / scale,
                                arcTop: arcTop / scale,
                                webSocketColor: webSocketColor,
                                desktopColor: desktopColor,
                                serverColor: serverColor,
                              ),
                            ),
                          ),
                          Positioned.fill(
                            child: RepaintBoundary(
                              child: _RouteMotion(
                                direct: direct,
                                checking: checking,
                                webSocketConnected: webSocketConnected,
                                desktopConnected: desktopConnected,
                                railY: railY,
                                arcTop: arcTop,
                                scale: scale,
                                webSocketColor: webSocketColor,
                                desktopColor: desktopColor,
                              ),
                            ),
                          ),
                          Positioned(
                            top: 18 * scale,
                            left: 0,
                            right: 0,
                            child: Column(
                              key: const ValueKey('device-route-line-metrics'),
                              children: [
                                Text(
                                  directLabel,
                                  textAlign: TextAlign.center,
                                  style: lineStyle.copyWith(color: upperColor),
                                ),
                                if (direct) ...[
                                  Text(
                                    '${text('往返', 'RTT')} · $rtt',
                                    style: lineStyle.copyWith(
                                      color: upperColor,
                                    ),
                                  ),
                                  Text(
                                    '${text('建连', 'Setup')} · $setup',
                                    style: lineStyle.copyWith(
                                      color: RelayTheme.mutedBright,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                          Positioned(
                            top: labelTop,
                            left: 34 * scale,
                            width: labelWidth,
                            child: labels(
                              leftLines,
                              direct && webSocketColor == RelayTheme.greenStrong
                                  ? RelayTheme.mutedBright
                                  : webSocketColor,
                            ),
                          ),
                          Positioned(
                            top: railY + 8 * scale,
                            left: 34 * scale,
                            width: labelWidth,
                            child: labels([
                              leftHeartbeat,
                            ], RelayTheme.mutedBright),
                          ),
                          Positioned(
                            top: railY + 8 * scale,
                            right: 34 * scale,
                            width: labelWidth,
                            child: labels([
                              rightHeartbeat,
                            ], RelayTheme.mutedBright),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ),
            Row(
              children: [
                Expanded(
                  child: Text(
                    text('此手机', 'This phone'),
                    style: const TextStyle(fontSize: 11),
                  ),
                ),
                Expanded(
                  child: Text(
                    text('服务器', 'Server'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 11),
                  ),
                ),
                Expanded(
                  child: Text(
                    text('你的电脑', 'Your computer'),
                    textAlign: TextAlign.end,
                    style: const TextStyle(fontSize: 11),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 22),
            Divider(color: RelayTheme.muted.withValues(alpha: .18), height: 1),
            const SizedBox(height: 14),
            Center(
              child: Text(
                '${text('当前', 'Current')}: $route',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: direct || online && webSocketConnected
                      ? RelayTheme.greenStrong
                      : RelayTheme.mutedBright,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

Path _bridgePath(double railY, double arcTop, double scale) => Path()
  ..moveTo(20 * scale, railY - 24 * scale)
  ..cubicTo(
    52 * scale,
    arcTop,
    268 * scale,
    arcTop,
    300 * scale,
    railY - 24 * scale,
  );

String deviceRouteSvg({
  required bool direct,
  required bool checking,
  required bool online,
  double railY = 190,
  double? canvasHeight,
  double arcTop = 40,
  Color webSocketColor = RelayTheme.muted,
  Color desktopColor = RelayTheme.muted,
  Color serverColor = RelayTheme.muted,
}) {
  String hex(Color color) =>
      '#${color.toARGB32().toRadixString(16).padLeft(8, '0').substring(2)}';
  final upper = direct
      ? '#A6E3B9'
      : checking
      ? '#9AAEC6'
      : '#555B63';
  final opacity = direct ? '.42' : '1';
  final dash = direct ? '' : 'stroke-dasharray="3 7"';
  return '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 ${canvasHeight ?? railY + 34}" fill="none">
  <path d="M20 ${railY - 24}C52 $arcTop 268 $arcTop 300 ${railY - 24}" stroke="$upper" stroke-width="1.5" stroke-linecap="round" $dash/>
  <path d="M39 $railY H142" stroke="${hex(webSocketColor)}" stroke-opacity="$opacity" stroke-width="1.5"/>
  <path d="M178 $railY H281" stroke="${hex(desktopColor)}" stroke-opacity="$opacity" stroke-width="1.5"/>
  <g transform="translate(0 $railY)" stroke="#C3CCD2" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <g id="phone-node" stroke="${hex(RelayTheme.greenStrong)}">
  <rect x="8" y="-20" width="24" height="40" rx="5" fill="#181818"/>
  <path d="M16 -15 H24 M18 15 H22"/>
  </g>
  <g id="server-node" stroke="${hex(serverColor)}">
  <rect x="146" y="-22" width="28" height="12" rx="3" fill="#181818"/>
  <rect x="146" y="-6" width="28" height="12" rx="3" fill="#181818"/>
  <rect x="146" y="10" width="28" height="12" rx="3" fill="#181818"/>
  <circle cx="152" cy="-16" r="1"/><circle cx="152" cy="0" r="1"/><circle cx="152" cy="16" r="1"/>
  </g>
  <g id="computer-node" stroke="${hex(direct ? RelayTheme.greenStrong : desktopColor)}">
  <rect x="286" y="-15" width="28" height="24" rx="3" fill="#181818"/>
  <path d="M282 17 H318 L314 10 H286 Z" fill="#181818"/>
  </g></g></svg>''';
}

class _RouteMotion extends StatefulWidget {
  const _RouteMotion({
    required this.direct,
    required this.checking,
    required this.webSocketConnected,
    required this.desktopConnected,
    required this.railY,
    required this.arcTop,
    required this.scale,
    required this.webSocketColor,
    required this.desktopColor,
  });
  final bool direct, checking, webSocketConnected, desktopConnected;
  final double railY, arcTop, scale;
  final Color webSocketColor, desktopColor;
  @override
  State<_RouteMotion> createState() => _RouteMotionState();
}

class _RouteMotionState extends State<_RouteMotion>
    with TickerProviderStateMixin {
  // A shared visual cadence represents link availability, not packet frequency.
  // Heartbeat intervals differ across transports and must not bias the diagram.
  late final _flow = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 6),
  );
  bool get _reduceMotion =>
      MediaQuery.disableAnimationsOf(context) ||
      MediaQuery.accessibleNavigationOf(context) ||
      !TickerMode.of(context);
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sync();
  }

  void _sync() {
    if (!_reduceMotion &&
        (widget.direct ||
            widget.checking ||
            widget.webSocketConnected ||
            widget.desktopConnected)) {
      if (!_flow.isAnimating) _flow.repeat();
    } else {
      _flow.stop();
    }
  }

  @override
  void didUpdateWidget(covariant _RouteMotion old) {
    super.didUpdateWidget(old);
    _sync();
  }

  @override
  void dispose() {
    _flow.dispose();
    super.dispose();
  }

  double? phase(double offset, double duration) {
    final value = (_flow.value + offset) % 1;
    return value < duration ? value / duration : null;
  }

  @override
  Widget build(BuildContext context) => IgnorePointer(
    child: AnimatedBuilder(
      animation: _flow,
      builder: (context, _) => CustomPaint(
        key: const ValueKey('device-route-motion'),
        painter: RouteTrafficPainter(
          railY: widget.railY,
          arcTop: widget.arcTop,
          scale: widget.scale,
          negotiation: !_reduceMotion && widget.checking ? phase(0, .6) : null,
          directProgress: !_reduceMotion && widget.direct ? phase(0, .6) : null,
          webProgress: !_reduceMotion && widget.webSocketConnected
              ? phase(.2, .4)
              : null,
          desktopProgress: !_reduceMotion && widget.desktopConnected
              ? phase(.2, .4)
              : null,
          webColor: widget.webSocketColor,
          desktopColor: widget.desktopColor,
        ),
      ),
    ),
  );
}

class RouteTrafficPainter extends CustomPainter {
  const RouteTrafficPainter({
    required this.railY,
    required this.arcTop,
    required this.scale,
    this.negotiation,
    this.directProgress,
    this.webProgress,
    this.desktopProgress,
    required this.webColor,
    required this.desktopColor,
  });
  final double railY, arcTop, scale;
  final double? negotiation, directProgress, webProgress, desktopProgress;
  final Color webColor, desktopColor;
  void _trace(
    Canvas canvas,
    Path path,
    double? progress,
    Color color, {
    bool subtle = false,
  }) {
    if (progress == null) return;
    final metric = path.computeMetrics().first;
    final distance = metric.length * progress;
    final fade = math.sin(progress * math.pi).clamp(0.0, 1.0);
    for (var i = 9; i >= 0; i--) {
      final end = math.max(0.0, distance - i * 2.0 * scale);
      final start = math.max(0.0, end - 2.5 * scale);
      canvas.drawPath(
        metric.extractPath(start, end),
        Paint()
          ..color = color.withValues(
            alpha: fade * (1 - i / 10) * (subtle ? .3 : .65),
          )
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2 * scale
          ..strokeCap = StrokeCap.round,
      );
    }
    final position = metric.getTangentForOffset(distance)?.position;
    if (position == null) return;
    canvas.drawCircle(
      position,
      4 * scale,
      Paint()..color = color.withValues(alpha: fade * .09),
    );
    canvas.drawCircle(
      position,
      1.8 * scale,
      Paint()..color = color.withValues(alpha: fade * (subtle ? .5 : .95)),
    );
  }

  @override
  void paint(Canvas canvas, Size size) {
    final bridge = _bridgePath(railY, arcTop, scale);
    _trace(canvas, bridge, negotiation, routeNegotiatingColor, subtle: true);
    _trace(canvas, bridge, directProgress, RelayTheme.greenStrong);
    _trace(
      canvas,
      Path()
        ..moveTo(39 * scale, railY)
        ..lineTo(142 * scale, railY),
      webProgress,
      webColor,
    );
    _trace(
      canvas,
      Path()
        ..moveTo(178 * scale, railY)
        ..lineTo(281 * scale, railY),
      desktopProgress,
      desktopColor,
    );
  }

  @override
  bool shouldRepaint(covariant RouteTrafficPainter oldDelegate) => true;
}
