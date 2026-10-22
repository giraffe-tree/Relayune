part of 'history_ink_painter.dart';

// Disc patches and stable SVG ending retained from the approved Eclipse.
// Raster and liquid formation geometry are intentionally not included.
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

_SurfacesMapping _surfacesFor(StartupMorphData data) => _surfacesCache[data]!;

class _SurfacesRun {
  const _SurfacesRun(this.left, this.right, this.start, this.end);
  final double left;
  final double right;
  final double start;
  final double end;
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

class _SurfacesMapping {
  _SurfacesMapping(StartupMorphData data) {
    final source = _SurfacesGrid(data, 0);
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
  }

  late final List<_SurfacesBand> disc;
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

void _surfacesDisc(Canvas canvas, List<_SurfacesBand> bands, double t) {
  final path = Path();
  const radius = _surfacesRadius;
  for (final band in bands) {
    // Eight Bezier control points per surface patch, reused across its runs.
    // A shared spatial warp keeps banks attached as the counters fuse.
    Offset point(_SurfacesRun run, bool right, int k) {
      final mass = right ? run.end : run.start;
      final x = _surfacesMix(
        right ? run.right : run.left,
        200 + (2 * mass - 1) * radius * band.arcX[k],
        t,
      );
      final y = _surfacesMix(
        _surfacesMix(band.y0, band.y1, k / 3),
        120 + radius * band.arcY[k],
        t,
      );
      return Offset(x, y);
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
}

// Approved Eclipse second act: retain disc patches and the original SVG's
// two-cubic cut. Match preview 67ec278's stableEnding: fixed SVG radius and
// channel width, no raster guard/mask and no last-frame artwork swap.
void _paintEclipse(Canvas canvas, StartupMorphData data, double p) {
  final progress = p.clamp(0.0, 1.0);
  final t = _surfacesEase(progress / .53);
  final compression = math.pow(math.sin(math.pi * t), 2).toDouble();
  canvas.saveLayer(_surfacesBounds, Paint());
  canvas.save();
  canvas.translate(200, 120);
  canvas.scale(1 - .22 * compression, 1 + .09 * compression);
  canvas.translate(-200, -120);
  _surfacesDisc(canvas, _surfacesFor(data).disc, t);
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
        ..strokeWidth = _surfacesChannelWidth * width
        ..color = Colors.white,
    );
  }
  canvas.restore();
}
