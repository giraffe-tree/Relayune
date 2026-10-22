part of 'startup_morph.dart';

// These are filled, connected surfaces, not a second particle renderer. Runs
// retain their horizontal mass order: letter counters close as their two banks
// meet, and the very same material opens into the destination's counters.
final _surfacesCache = Expando<_SurfacesMapping>();
const _surfacesBounds = Rect.fromLTWH(0, 0, 400, 240);
const _surfacesInk = Color(0xFFF6F8F5);
const _surfacesRadius = 308 * 170 / 1024;
const _surfacesChannelWidth = 124 * 170 / 1024;

double _surfacesEase(double value) {
  final t = value.clamp(0.0, 1.0);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

double _surfacesMix(double a, double b, double t) => a + (b - a) * t;

_SurfacesMapping _surfacesFor(StartupMorphData data) =>
    _surfacesCache[data] ??= _SurfacesMapping(data);

class _SurfacesRun {
  const _SurfacesRun(this.left, this.right, this.start, this.end);
  final double left;
  final double right;
  final double start;
  final double end;

  double at(double mass) =>
      _surfacesMix(left, right, (mass - start) / (end - start));
}

class _SurfacesGrid {
  _SurfacesGrid(StartupMorphData data, int offset) {
    // Each sample represents a 1x1 logical pixel. A one-pixel guard includes
    // low-alpha pixels omitted by the offline sampler. Exact endpoint alpha
    // is restored below; this guard also prevents thin strokes disappearing.
    final cells = Uint8List(400 * 240);
    var first = 239;
    var last = 0;
    for (var i = 0; i < data.count; i++) {
      final x = data.pairs[i * 4 + offset].floor();
      final y = data.pairs[i * 4 + offset + 1].floor();
      for (var dy = -1; dy <= 1; dy++) {
        final row = y + dy;
        if (row < 0 || row >= 240) continue;
        for (var dx = -1; dx <= 1; dx++) {
          final col = x + dx;
          if (col < 0 || col >= 400) continue;
          cells[row * 400 + col] = 1;
          first = math.min(first, row);
          last = math.max(last, row);
        }
      }
    }
    top = first.toDouble();
    bottom = (last + 1).toDouble();
    pixels = cells;
  }

  late final Uint8List pixels;
  late final double top;
  late final double bottom;

  List<_SurfacesRun> runs(double y0, double y1) {
    final occupied = Uint8List(400);
    for (var y = math.max(0, y0.floor()); y < math.min(240, y1.ceil()); y++) {
      for (var x = 0; x < 400; x++) {
        occupied[x] |= pixels[y * 400 + x];
      }
    }
    final intervals = <(double, double)>[];
    var mass = 0.0;
    var x = 0;
    while (x < 400) {
      if (occupied[x] == 0) {
        x++;
        continue;
      }
      final left = x;
      while (x < 400 && occupied[x] != 0) {
        x++;
      }
      intervals.add((left.toDouble(), x.toDouble()));
      mass += x - left;
    }
    // A zero-width run lets an empty band grow continuously, without a pop.
    if (mass == 0) return const [_SurfacesRun(200, 200, 0, 1)];
    var cumulative = 0.0;
    return [
      for (final interval in intervals)
        _SurfacesRun(
          interval.$1,
          interval.$2,
          cumulative / mass,
          (cumulative += interval.$2 - interval.$1) / mass,
        ),
    ];
  }
}

class _SurfacesBand {
  _SurfacesBand(this.y0, this.y1, this.q0, this.q1, this.runs) {
    // Cubic circular arcs, rather than rectangular stairs at the moon edge.
    // Scaling each arc's x by cumulative mass tiles the whole disc exactly.
    final a = math.asin(2 * q0 - 1);
    final b = math.asin(2 * q1 - 1);
    final h = 4 / 3 * math.tan((b - a) / 4);
    arcX = [
      math.cos(a),
      math.cos(a) - h * math.sin(a),
      math.cos(b) + h * math.sin(b),
      math.cos(b),
    ];
    arcY = [
      math.sin(a),
      math.sin(a) + h * math.cos(a),
      math.sin(b) - h * math.cos(b),
      math.sin(b),
    ];
  }

  final double y0;
  final double y1;
  final double q0;
  final double q1;
  final List<_SurfacesRun> runs;
  late final List<double> arcX;
  late final List<double> arcY;
}

class _SurfacesRibbon {
  const _SurfacesRibbon(this.a0, this.a1, this.b0, this.b1);
  final double a0;
  final double a1;
  final double b0;
  final double b1;
}

class _SurfacesRasterBand {
  _SurfacesRasterBand(this.y0, this.y1, this.z0, this.z1, this.ribbons);
  final double y0;
  final double y1;
  final double z0;
  final double z1;
  final List<_SurfacesRibbon> ribbons;
}

class _SurfacesMapping {
  _SurfacesMapping(StartupMorphData data) {
    final source = _SurfacesGrid(data, 0);
    final target = _SurfacesGrid(data, 2);
    disc = [
      for (var i = 0; i < 96; i++)
        _SurfacesBand(
          _surfacesMix(source.top, source.bottom, i / 96),
          _surfacesMix(source.top, source.bottom, (i + 1) / 96),
          i / 96,
          (i + 1) / 96,
          source.runs(
            _surfacesMix(source.top, source.bottom, i / 96),
            _surfacesMix(source.top, source.bottom, (i + 1) / 96),
          ),
        ),
    ];
    raster = [];
    for (var i = 0; i < 28; i++) {
      final y0 = _surfacesMix(source.top, source.bottom, i / 28);
      final y1 = _surfacesMix(source.top, source.bottom, (i + 1) / 28);
      final z0 = _surfacesMix(target.top, target.bottom, i / 28);
      final z1 = _surfacesMix(target.top, target.bottom, (i + 1) / 28);
      final a = source.runs(y0, y1);
      final b = target.runs(z0, z1);
      final ribbons = <_SurfacesRibbon>[];
      var ai = 0;
      var bi = 0;
      var u = 0.0;
      // Merge the two cumulative distributions once. A gap can close/open,
      // but correspondence never changes during playback or on reversal.
      while (ai < a.length && bi < b.length) {
        final end = math.min(a[ai].end, b[bi].end);
        if (end > u) {
          ribbons.add(
            _SurfacesRibbon(
              a[ai].at(u),
              a[ai].at(end),
              b[bi].at(u),
              b[bi].at(end),
            ),
          );
        }
        u = end;
        if (a[ai].end <= end) ai++;
        if (b[bi].end <= end) bi++;
      }
      raster.add(_SurfacesRasterBand(y0, y1, z0, z1, ribbons));
    }
  }

  late final List<_SurfacesBand> disc;
  late final List<_SurfacesRasterBand> raster;
}

final Path _surfacesChannel = (() {
  const s = 170 / 1024;
  return Path()
    ..moveTo(115 + 150 * s, 35 + 626 * s)
    ..cubicTo(
      115 + 298 * s,
      35 + 276 * s,
      115 + 433 * s,
      35 + 278 * s,
      200,
      120,
    )
    ..cubicTo(
      115 + 591 * s,
      35 + 746 * s,
      115 + 726 * s,
      35 + 748 * s,
      115 + 874 * s,
      35 + 398 * s,
    );
})();
final _surfacesChannelMetric = _surfacesChannel.computeMetrics().first;

double _surfacesArrival(double p) => _surfacesEase((p - .86) / .14);

void _surfacesFinish(Canvas canvas, StartupMorphData data, double p) {
  final departure = 1 - _surfacesEase(p / .15);
  final arrival = _surfacesArrival(p);
  final strength = math.max(departure, arrival);
  if (strength > 0) {
    // Only subpixel endpoint refinement, not an image-to-image dissolve.
    // PLUS makes alpha exactly 1-w+w*A (srcOver would dim opaque pixels).
    final image = departure > arrival ? data.wordmark : data.moon;
    canvas.saveLayer(_surfacesBounds, Paint()..blendMode = BlendMode.dstIn);
    canvas.drawRect(
      _surfacesBounds,
      Paint()..color = Colors.white.withValues(alpha: 1 - strength),
    );
    canvas.drawImageRect(
      image,
      Rect.fromLTWH(0, 0, image.width.toDouble(), image.height.toDouble()),
      _surfacesBounds,
      Paint()
        ..color = Colors.white.withValues(alpha: strength)
        ..blendMode = BlendMode.plus
        ..filterQuality = FilterQuality.medium,
    );
    canvas.restore();
  }
  canvas.restore();
}

void _surfacesDisc(
  Canvas canvas,
  List<_SurfacesBand> bands,
  double t,
  double ripple,
  double phase,
  double guard, {
  double? horizontalProgress,
  double seamWidth = 0,
  bool smoothLiquid = false,
}) {
  final path = Path();
  final radius = _surfacesRadius + guard;
  final horizontal = horizontalProgress ?? t;
  for (final band in bands) {
    // Eight Bezier control points per surface patch, reused across its runs.
    // A shared spatial warp keeps banks attached as the counters fuse.
    Offset point(_SurfacesRun run, bool right, int k) {
      final mass = right ? run.end : run.start;
      final x = _surfacesMix(
        right ? run.right : run.left,
        200 + (2 * mass - 1) * radius * band.arcX[k],
        horizontal,
      );
      final y = _surfacesMix(
        _surfacesMix(band.y0, band.y1, k / 3),
        120 + radius * band.arcY[k],
        t,
      );
      final v = (y - 120) / 52;
      if (smoothLiquid) {
        // A horizontal boundary must stay a straight line even when adjacent
        // bands have different run partitions. Nonlinear y(x) warped their
        // chords differently and opened the fine horizontal cracks.
        return Offset(
          x + ripple * 10 * math.sin(v * 2 + phase),
          y + ripple * .035 * (x - 200),
        );
      }
      return Offset(
        x +
            ripple *
                (9 * math.sin(v * 2.5 + phase) + 3 * math.sin(v * 5 - phase)),
        y + ripple * 3 * math.sin((x - 200) / 46 + phase),
      );
    }

    for (final run in band.runs) {
      final l0 = point(run, false, 0);
      final l1 = point(run, false, 1);
      final l2 = point(run, false, 2);
      final l3 = point(run, false, 3);
      final r0 = point(run, true, 0);
      final r1 = point(run, true, 1);
      final r2 = point(run, true, 2);
      final r3 = point(run, true, 3);
      path
        ..moveTo(l0.dx, l0.dy)
        ..lineTo(r0.dx, r0.dy)
        ..cubicTo(r1.dx, r1.dy, r2.dx, r2.dy, r3.dx, r3.dy)
        ..lineTo(l3.dx, l3.dy)
        ..cubicTo(l2.dx, l2.dy, l1.dx, l1.dy, l0.dx, l0.dy)
        ..close();
    }
  }
  canvas.drawPath(path, Paint()..color = _surfacesInk);
  if (seamWidth > 0) {
    // One shared round stroke seals subpixel coverage and softens the banks.
    // It recedes before endpoint refinement and before the final silhouette.
    canvas.drawPath(
      path,
      Paint()
        ..color = _surfacesInk
        ..style = PaintingStyle.stroke
        ..strokeJoin = StrokeJoin.round
        ..strokeCap = StrokeCap.round
        ..strokeWidth = seamWidth,
    );
  }
}

/// Viscous banks join into a breathing membrane; its S-shaped neck opens as
/// the surface tension settles. There is no blur pass or per-run saveLayer.
void _paintLiquid(
  Canvas canvas,
  StartupMorphData data,
  double p,
  Float32List buffer,
) {
  final progress = p.clamp(0.0, 1.0);
  final t = _surfacesEase(progress / .68);
  // Close the letter counters before vertical settling finishes, so the
  // middle of the animation is one cohesive membrane rather than scan bands.
  final fusion = _surfacesEase(progress / .50);
  final seal =
      1.25 *
      _surfacesEase(progress / .22) *
      (1 - _surfacesEase((progress - .68) / .16));
  final wave = math
      .pow(math.sin(math.pi * _surfacesEase(progress / .88)), 2)
      .toDouble();
  final arrival = _surfacesArrival(progress);
  canvas.saveLayer(_surfacesBounds, Paint());
  _surfacesDisc(
    canvas,
    _surfacesFor(data).disc,
    t,
    wave,
    -.7 + progress * 3.8,
    arrival * 1.25,
    horizontalProgress: fusion,
    seamWidth: seal,
    smoothLiquid: true,
  );
  final opening = _surfacesEase((progress - .43) / .51);
  if (opening > 0) {
    canvas.drawPath(
      _surfacesChannel,
      Paint()
        ..blendMode = BlendMode.dstOut
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeWidth = (_surfacesChannelWidth - 2.5 * arrival) * opening
        ..color = Colors.white,
    );
  }
  _surfacesFinish(canvas, data, progress);
}

/// Twenty-eight broad scan ribbons slide in alternating directions, expand
/// vertically and reassemble the icon. Their internal gaps follow ordered
/// interval transport; they are not faded copies of the endpoint textures.
void _paintRaster(
  Canvas canvas,
  StartupMorphData data,
  double p,
  Float32List buffer,
) {
  final progress = p.clamp(0.0, 1.0);
  final bands = _surfacesFor(data).raster;
  final path = Path();
  for (var i = 0; i < bands.length; i++) {
    final band = bands[i];
    final q = (i + .5) / bands.length;
    final delay = .10 * q;
    final t = _surfacesEase((progress - delay) / (1 - delay - .09));
    final envelope = math.pow(math.sin(math.pi * t), 2).toDouble();
    final direction = i.isEven ? 1.0 : -1.0;
    final dx = direction * envelope * (13 + 12 * math.sin(q * math.pi));
    final shear = direction * envelope * 1.8;
    final top = _surfacesMix(band.y0, band.z0, t);
    final bottom = _surfacesMix(band.y1, band.z1, t);
    // Gaps close with zero speed; at most 22% of a ribbon is ever removed.
    final inset = math.min(.38, (bottom - top) * .11) * envelope;
    for (final ribbon in band.ribbons) {
      final left = _surfacesMix(ribbon.a0, ribbon.b0, t) + dx;
      final right = _surfacesMix(ribbon.a1, ribbon.b1, t) + dx;
      path
        ..moveTo(left - shear, top + inset)
        ..lineTo(right - shear, top + inset)
        ..lineTo(right + shear, bottom - inset)
        ..lineTo(left + shear, bottom - inset)
        ..close();
    }
  }
  canvas.saveLayer(_surfacesBounds, Paint());
  canvas.drawPath(path, Paint()..color = _surfacesInk);
  _surfacesFinish(canvas, data, progress);
}

/// The lettering contracts into a full lunar disc, then an eclipse travels
/// along the original SVG's two cubics, physically cutting the open channel.
void _paintEclipse(
  Canvas canvas,
  StartupMorphData data,
  double p,
  Float32List buffer, {
  bool stableEnding = false,
}) {
  final progress = p.clamp(0.0, 1.0);
  final t = _surfacesEase(progress / .53);
  final compression = math.pow(math.sin(math.pi * t), 2).toDouble();
  // The legacy raster guard enlarged the disc and narrowed the channel
  // before masking both back down. Near tangent intersections that makes
  // the pointed ends visibly grow, then recede. New formations use the
  // original SVG dimensions throughout, including the idle endpoint.
  final arrival = stableEnding ? 0.0 : _surfacesArrival(progress);
  canvas.saveLayer(_surfacesBounds, Paint());
  canvas.save();
  canvas.translate(200, 120);
  canvas.scale(1 - .22 * compression, 1 + .09 * compression);
  canvas.translate(-200, -120);
  _surfacesDisc(canvas, _surfacesFor(data).disc, t, 0, 0, arrival * 1.25);
  canvas.restore();
  final cut = _surfacesEase((progress - .49) / .43);
  if (cut > 0) {
    final width = _surfacesEase((progress - .49) / .16);
    canvas.drawPath(
      _surfacesChannelMetric.extractPath(
        0,
        _surfacesChannelMetric.length * cut,
      ),
      Paint()
        ..blendMode = BlendMode.dstOut
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeWidth = (_surfacesChannelWidth - 2.5 * arrival) * width
        ..color = Colors.white,
    );
  }
  if (stableEnding) {
    canvas.restore();
  } else {
    _surfacesFinish(canvas, data, progress);
  }
}
