part of 'startup_morph.dart';

// Both effects transport the bundled correspondences. No frame-dependent
// randomness, extra assets, timers, or state on StartupMorphData are required.
final _ofCaches = Expando<_OfCache>('orbit / filament geometry');

double _ofEase(double p) {
  final x = p.clamp(0.0, 1.0);
  return x * x * x * (10 + x * (6 * x - 15));
}

double _ofEnvelope(double t) {
  final s = math.sin(math.pi * t);
  return s * s;
}

// Invert the monotone x coordinate of the original icon's channel, rather
// than cutting it horizontally (both moon lobes cross the horizontal centre).
double _ofLobe(double x, double y) {
  final px = (x - 115) * 1024 / 170;
  final py = (y - 35) * 1024 / 170;
  final right = px >= 512;
  var lo = 0.0;
  var hi = 1.0;
  for (var iteration = 0; iteration < 14; iteration++) {
    final t = (lo + hi) * .5;
    final u = 1 - t;
    final cx = right
        ? u * u * u * 512 +
              3 * u * u * t * 591 +
              3 * u * t * t * 726 +
              t * t * t * 874
        : u * u * u * 150 +
              3 * u * u * t * 298 +
              3 * u * t * t * 433 +
              t * t * t * 512;
    if (cx < px) {
      lo = t;
    } else {
      hi = t;
    }
  }
  final t = (lo + hi) * .5;
  final u = 1 - t;
  final cy = right
      ? u * u * u * 512 +
            3 * u * u * t * 746 +
            3 * u * t * t * 748 +
            t * t * t * 398
      : u * u * u * 626 +
            3 * u * u * t * 276 +
            3 * u * t * t * 278 +
            t * t * t * 512;
  return py < cy ? -1 : 1;
}

class _OfCache {
  _OfCache(StartupMorphData data)
    : lobes = Float32List(data.count),
      ranks = Float32List(data.count),
      orbitLines = Float32List(data.count * 4) {
    // One fibre per occupied source cell, not one disconnected dot per sample.
    // Keep nearby samples together and choose a stable representative.
    final cells = <int, int>{};
    for (var i = 0; i < data.count; i++) {
      final k = i * 4;
      final x = data.pairs[k];
      final y = data.pairs[k + 1];
      lobes[i] = _ofLobe(data.pairs[k + 2], data.pairs[k + 3]);
      ranks[i] = ((x - 115) / 172).clamp(0.0, 1.0);
      cells.putIfAbsent((x / 2.4).floor() + (y / 2.4).floor() * 256, () => i);
    }
    fibres = cells.values.toList(growable: false);
    tangents = Float32List(fibres.length * 4);
    for (var j = 0; j < fibres.length; j++) {
      final k = fibres[j] * 4;
      for (var end = 0; end < 2; end++) {
        // Local second moments orient each short endpoint fibre along ink.
        var xx = 0.0;
        var xy = 0.0;
        var yy = 0.0;
        for (final other in fibres) {
          final dx = data.pairs[other * 4 + end * 2] - data.pairs[k + end * 2];
          final dy =
              data.pairs[other * 4 + end * 2 + 1] - data.pairs[k + end * 2 + 1];
          final d2 = dx * dx + dy * dy;
          if (d2 > 0 && d2 < 36) {
            final w = 1 - d2 / 36;
            xx += dx * dx * w;
            xy += dx * dy * w;
            yy += dy * dy * w;
          }
        }
        final angle = .5 * math.atan2(2 * xy, xx - yy);
        tangents[j * 4 + end * 2] = math.cos(angle);
        tangents[j * 4 + end * 2 + 1] = math.sin(angle);
      }
    }
  }

  final Float32List lobes;
  final Float32List ranks;
  final Float32List orbitLines;
  late final List<int> fibres;
  late final Float32List tangents;
  _OfEndpointMesh? wordMesh;
  _OfEndpointMesh? moonMesh;
}

// A small textured mesh makes the limit at each endpoint the EXACT artwork.
// Its vertices follow a weighted neighbourhood of the same moving samples.
// The endpoint windows are effect-specific; the two images never overlap.
class _OfEndpointMesh {
  _OfEndpointMesh(StartupMorphData data, bool moon) {
    final offset = moon ? 2 : 0;
    final image = moon ? data.moon : data.wordmark;
    var left = 400.0;
    var top = 240.0;
    var right = 0.0;
    var bottom = 0.0;
    final bins = <int, List<int>>{};
    for (var i = 0; i < data.count; i++) {
      final x = data.pairs[i * 4 + offset];
      final y = data.pairs[i * 4 + offset + 1];
      left = math.min(left, x);
      top = math.min(top, y);
      right = math.max(right, x);
      bottom = math.max(bottom, y);
      (bins[(x / 12).floor() + (y / 12).floor() * 64] ??= []).add(i);
    }
    left = (left / 4).floor() * 4.0 - 4;
    top = (top / 4).floor() * 4.0 - 4;
    final cols = ((right + 4 - left) / 4).ceil() + 1;
    final rows = ((bottom + 4 - top) / 4).ceil() + 1;
    final count = cols * rows;
    rest = Float32List(count * 2);
    moved = Float32List(count * 2);
    texture = Float32List(count * 2);
    neighbours = Int32List(count * 4);
    weights = Float32List(count * 4);
    for (var v = 0; v < count; v++) {
      final x = left + (v % cols) * 4;
      final y = top + (v ~/ cols) * 4;
      rest[v * 2] = x;
      rest[v * 2 + 1] = y;
      texture[v * 2] = x * image.width / 400;
      texture[v * 2 + 1] = y * image.height / 240;
      final best = List<double>.filled(4, double.infinity);
      final ids = List<int>.filled(4, 0);
      final bx = (x / 12).floor();
      final by = (y / 12).floor();
      // Search just local bins. Expanding rings also cover transparent holes.
      for (var radius = 0; radius <= 34; radius++) {
        for (var dy = -radius; dy <= radius; dy++) {
          for (var dx = -radius; dx <= radius; dx++) {
            if (radius > 0 && dx.abs() != radius && dy.abs() != radius) {
              continue;
            }
            for (final i in bins[bx + dx + (by + dy) * 64] ?? const <int>[]) {
              final sx = data.pairs[i * 4 + offset] - x;
              final sy = data.pairs[i * 4 + offset + 1] - y;
              final distance = sx * sx + sy * sy;
              for (var n = 0; n < 4; n++) {
                if (distance >= best[n]) continue;
                for (var shift = 3; shift > n; shift--) {
                  best[shift] = best[shift - 1];
                  ids[shift] = ids[shift - 1];
                }
                best[n] = distance;
                ids[n] = i;
                break;
              }
            }
          }
        }
        if (radius >= 1 && best[3] < math.pow(radius * 12, 2)) break;
      }
      var sum = 0.0;
      for (var n = 0; n < 4; n++) {
        neighbours[v * 4 + n] = ids[n];
        final weight = 1 / (best[n] + 1);
        weights[v * 4 + n] = weight;
        sum += weight;
      }
      for (var n = 0; n < 4; n++) {
        weights[v * 4 + n] /= sum;
      }
    }
    indices = Uint16List((cols - 1) * (rows - 1) * 6);
    var cursor = 0;
    for (var y = 0; y < rows - 1; y++) {
      for (var x = 0; x < cols - 1; x++) {
        final a = y * cols + x;
        for (final index in [
          a,
          a + 1,
          a + cols,
          a + 1,
          a + cols + 1,
          a + cols,
        ]) {
          indices[cursor++] = index;
        }
      }
    }
    shader = ui.ImageShader(
      image,
      TileMode.clamp,
      TileMode.clamp,
      Float64List.fromList([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    );
    endpointOffset = offset;
  }

  late final Float32List rest, moved, texture, weights;
  late final Int32List neighbours;
  late final Uint16List indices;
  late final ui.ImageShader shader;
  late final int endpointOffset;

  void paint(
    Canvas canvas,
    StartupMorphData data,
    Float32List positions,
    double alpha,
  ) {
    for (var v = 0; v < rest.length ~/ 2; v++) {
      var dx = 0.0;
      var dy = 0.0;
      for (var n = 0; n < 4; n++) {
        final i = neighbours[v * 4 + n];
        final w = weights[v * 4 + n];
        dx += (positions[i * 2] - data.pairs[i * 4 + endpointOffset]) * w;
        dy +=
            (positions[i * 2 + 1] - data.pairs[i * 4 + endpointOffset + 1]) * w;
      }
      moved[v * 2] = rest[v * 2] + dx;
      moved[v * 2 + 1] = rest[v * 2 + 1] + dy;
    }
    final vertices = ui.Vertices.raw(
      ui.VertexMode.triangles,
      moved,
      textureCoordinates: texture,
      indices: indices,
    );
    canvas.drawVertices(
      vertices,
      BlendMode.modulate,
      Paint()
        ..shader = shader
        ..color = Colors.white.withValues(alpha: alpha)
        ..filterQuality = FilterQuality.low,
    );
    vertices.dispose();
  }
}

double _ofInkOpacity(double p) => _ofEase(p / .18) * _ofEase((1 - p) / .18);

// Sparse fibres need a solid backing for longer than the dense orbital flow.
// Squaring the release keeps ~92% mesh coverage at p=.12/.88, while reaching
// zero with zero velocity at .32/.68. Fibre geometry and mid-motion ink stay
// unchanged; this backing is warped by their positions, not a static overlay.
double _ofFilamentMeshOpacity(double p) {
  final release = _ofEase(math.min(p, 1 - p) / .32);
  return 1 - release * release;
}

void _ofPaintEndpoint(
  Canvas canvas,
  StartupMorphData data,
  _OfCache cache,
  double p,
  Float32List buffer, {
  double? opacity,
}) {
  final meshOpacity = opacity ?? (1 - _ofInkOpacity(p));
  if (meshOpacity <= 0) return;
  final mesh = p < .5
      ? (cache.wordMesh ??= _OfEndpointMesh(data, false))
      : (cache.moonMesh ??= _OfEndpointMesh(data, true));
  mesh.paint(canvas, data, buffer, meshOpacity);
}

void _ofOrbitPoint(
  StartupMorphData data,
  _OfCache cache,
  int i,
  double p,
  Float32List output,
  int out,
) {
  final k = i * 4;
  final rank = cache.ranks[i];
  final t = _ofEase(p + .10 * _ofEnvelope(p) * (rank - .5));
  final envelope = _ofEnvelope(t);
  final side = cache.lobes[i];
  final angle = math.pi * (.10 + .80 * t) + (rank - .5) * 1.30;
  final radial = (data.pairs[k + 3] - 120).abs() / 52;
  final orbitX = 200 + side * (78 + 12 * radial) * math.cos(angle);
  final orbitY = 120 + side * (44 + 19 * radial) * math.sin(angle);
  final mix = .94 * envelope;
  final x = data.pairs[k] * (1 - t) + data.pairs[k + 2] * t;
  final y = data.pairs[k + 1] * (1 - t) + data.pairs[k + 3] * t;
  output[out] = x + (orbitX - x) * mix;
  output[out + 1] = y + (orbitY - y) * mix;
}

/// Two counter-running, tightly braided orbital currents, one per moon lobe.
void _paintOrbit(
  Canvas canvas,
  StartupMorphData data,
  double p,
  Float32List buffer,
) {
  if (data.count == 0) return;
  p = p.clamp(0.0, 1.0);
  final cache = _ofCaches[data] ??= _OfCache(data);
  final envelope = _ofEnvelope(p);
  for (var i = 0; i < data.count; i++) {
    _ofOrbitPoint(data, cache, i, p, buffer, i * 2);
    // A short analytic shutter creates curved-flow direction without history:
    // scrubbing or reversing the animation produces exactly the same frame.
    _ofOrbitPoint(
      data,
      cache,
      i,
      (p - .018 * envelope).clamp(0.0, 1.0),
      cache.orbitLines,
      i * 4,
    );
    cache.orbitLines[i * 4 + 2] = buffer[i * 2];
    cache.orbitLines[i * 4 + 3] = buffer[i * 2 + 1];
  }
  final ink = _ofInkOpacity(p);
  if (ink > 0) {
    canvas.drawRawPoints(
      ui.PointMode.lines,
      cache.orbitLines,
      Paint()
        ..color = const Color(
          0xFFDAE7F3,
        ).withValues(alpha: .11 * ink * envelope)
        ..strokeCap = StrokeCap.round
        ..strokeWidth = 3.1,
    );
    canvas.drawRawPoints(
      ui.PointMode.lines,
      cache.orbitLines,
      Paint()
        ..color = const Color(
          0xFFF6F8F5,
        ).withValues(alpha: ink * (.86 - .28 * envelope))
        ..strokeCap = StrokeCap.round
        ..strokeWidth = 1.65 - .9 * envelope,
    );
  }
  _ofPaintEndpoint(canvas, data, cache, p, buffer);
}

/// Long, unbroken cubic fibres peel off the strokes, curl, then rewind into
/// the moon. There is deliberately no particle or point rendering in this mode.
void _paintFilaments(
  Canvas canvas,
  StartupMorphData data,
  double p,
  Float32List buffer,
) {
  if (data.count == 0) return;
  p = p.clamp(0.0, 1.0);
  final cache = _ofCaches[data] ??= _OfCache(data);
  for (var i = 0; i < data.count; i++) {
    final k = i * 4;
    final rank = cache.ranks[i];
    final t = _ofEase(p + .16 * _ofEnvelope(p) * (rank - .5));
    final e = _ofEnvelope(t);
    final turn = 2 * math.pi * t + rank * 1.8;
    buffer[i * 2] =
        data.pairs[k] * (1 - t) +
        data.pairs[k + 2] * t +
        e * (22 * math.sin(turn) + (rank - .5) * 26);
    buffer[i * 2 + 1] =
        data.pairs[k + 1] * (1 - t) +
        data.pairs[k + 3] * t +
        e * cache.lobes[i] * (16 + 14 * math.cos(turn));
  }
  final ink = _ofInkOpacity(p);
  if (ink > 0) {
    final paths = List.generate(4, (_) => Path());
    for (var j = 0; j < cache.fibres.length; j++) {
      final i = cache.fibres[j];
      final rank = cache.ranks[i];
      final t = _ofEase(p + .16 * _ofEnvelope(p) * (rank - .5));
      final e = _ofEnvelope(t);
      final k = j * 4;
      // Unwrap the tangent modulo pi so interpolation cannot flip a fibre.
      final a0 = math.atan2(cache.tangents[k + 1], cache.tangents[k]);
      var da = math.atan2(cache.tangents[k + 3], cache.tangents[k + 2]) - a0;
      if (da > math.pi / 2) da -= math.pi;
      if (da < -math.pi / 2) da += math.pi;
      final angle = a0 + da * t + cache.lobes[i] * math.pi * 1.35 * e;
      final ux = math.cos(angle);
      final uy = math.sin(angle);
      final nx = -uy;
      final ny = ux;
      final cx = buffer[i * 2];
      final cy = buffer[i * 2 + 1];
      final half = .7 + e * (7 + rank * 10);
      final curl = e * (13 + 15 * math.sin(rank * math.pi)) * cache.lobes[i];
      // Two cubic halves share both position and first derivative at the
      // waist. The curved returning tail stays attached even at maximum curl.
      final path = paths[j % paths.length];
      path.moveTo(cx - ux * half, cy - uy * half);
      path.cubicTo(
        cx - ux * (half + e * 20) + nx * curl,
        cy - uy * (half + e * 20) + ny * curl,
        cx - ux * half * .45 + nx * curl,
        cy - uy * half * .45 + ny * curl,
        cx,
        cy,
      );
      path.cubicTo(
        cx + ux * half * .45 - nx * curl,
        cy + uy * half * .45 - ny * curl,
        cx + ux * (half + e * 20) - nx * curl,
        cy + uy * (half + e * 20) - ny * curl,
        cx + ux * half,
        cy + uy * half,
      );
    }
    final envelope = _ofEnvelope(p);
    for (var group = 0; group < paths.length; group++) {
      canvas.drawPath(
        paths[group],
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round
          ..strokeWidth = 1.45 - .92 * envelope + group * .06 * envelope
          ..color = const Color(
            0xFFF6F8F5,
          ).withValues(alpha: ink * (1 - envelope * (.64 - group * .13))),
      );
    }
  }
  _ofPaintEndpoint(
    canvas,
    data,
    cache,
    p,
    buffer,
    opacity: _ofFilamentMeshOpacity(p),
  );
}
