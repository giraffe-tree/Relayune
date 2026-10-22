import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import 'startup_morph.dart';

part 'history_ink_drops.dart';
part 'history_ink_endpoint.dart';
part 'history_ink_surfaces.dart';

/// Prepares the approved ink-gathering geometry once per asset instance.
///
/// Call after [StartupMorphData.load] completes, before starting the entrance
/// animation. This synchronously samples glyph contours, endpoint neighbours,
/// disc bands and the Eclipse channel; painting only deforms cached geometry.
/// Repeated calls are inexpensive. The cache does not retain [data] as a key
/// after it is otherwise unreachable.
void prepareHistoryInk(StartupMorphData data) {
  _effCaches[data] ??= _EffCache(data);
  _surfacesCache[data] ??= _SurfacesMapping(data);
  // Top-level Dart initializers are lazy; force the path metric before paint.
  _surfacesChannelMetric.length;
}

/// History's approved wordmark → ink drops → Eclipse → breathing moon.
///
/// Geometry uses the preview's 400×240 coordinates. A 260×156 full canvas
/// produces an approximately 66px moon. [compact] shows only the final moon,
/// filling a 38px square with an approximately 26px breathing icon. The final
/// SVG geometry stays fixed; breathing changes only opacity, by at most 6%.
class HistoryInkPainter extends CustomPainter {
  HistoryInkPainter({
    required this.data,
    required this.entrance,
    required this.idle,
    required this.positionsBuffer,
    this.compact = false,
  }) : assert(positionsBuffer.length == data.count * 2),
       super(repaint: Listenable.merge([entrance, idle])) {
    // Also safe for callers which have not explicitly prewarmed after loading:
    // never defer contour sampling or neighbourhood searches to paint().
    prepareHistoryInk(data);
  }

  final StartupMorphData data;
  final Animation<double> entrance;
  final Animation<double> idle;

  /// Caller-owned scratch space with exactly `data.count * 2` entries.
  final Float32List positionsBuffer;
  final bool compact;
  final Paint _endpointPaint = Paint()..filterQuality = FilterQuality.medium;

  /// Compact mode is already at the final moon, independent of entrance.
  double get progress =>
      compact ? 1.0 : ((entrance.value - .16) / .78).clamp(0.0, 1.0);

  @override
  void paint(Canvas canvas, Size size) {
    final p = progress;
    final breathing = p == 1 ? math.pow(math.sin(math.pi * idle.value), 2) : 0;
    final scale = compact
        ? math.min(size.width, size.height) * (26 / 38) / (2 * _surfacesRadius)
        : math.min(size.width / 400, size.height / 240);
    canvas.save();
    canvas.translate(size.width / 2, size.height / 2);
    canvas.scale(scale);
    canvas.translate(-200, -120);
    final dimMoon = breathing > 0;
    if (dimMoon) {
      canvas.saveLayer(
        _surfacesBounds,
        Paint()..color = Colors.white.withValues(alpha: 1 - .06 * breathing),
      );
    }
    if (p == 0) {
      final image = data.wordmark;
      canvas.drawImageRect(
        image,
        Rect.fromLTWH(0, 0, image.width.toDouble(), image.height.toDouble()),
        _surfacesBounds,
        _endpointPaint,
      );
    } else if (p >= .53 - 1e-12) {
      _paintEclipse(canvas, data, p);
    } else {
      _paintFormationDrops(canvas, data, p / .53, positionsBuffer);
    }
    if (dimMoon) canvas.restore();
    canvas.restore();
  }

  @override
  bool shouldRepaint(HistoryInkPainter oldDelegate) =>
      data != oldDelegate.data ||
      entrance != oldDelegate.entrance ||
      idle != oldDelegate.idle ||
      positionsBuffer != oldDelegate.positionsBuffer ||
      compact != oldDelegate.compact;
}
