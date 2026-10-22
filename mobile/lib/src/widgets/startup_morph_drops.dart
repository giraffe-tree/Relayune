part of 'startup_morph.dart';

// Soft contact (Vincent Schwenk) and coherent, living motion (Universal
// Everything): whole glyph contours become eight bodies, never scanlines.
// Only this first act is painted here; the approved S-cut stays with Eclipse.
final _effCaches = Expando<_EffCache>();
const _effBounds = Rect.fromLTWH(0, 0, 400, 240);
const _effInk = Color(0xFFF6F8F5);

double _effLerp(double a, double b, double t) => a + (b - a) * t;

class _EffLoop {
  _EffLoop(List<Offset> vertices, this.hole, Offset center) {
    final count = hole ? 48 : 128;
    final lengths = <double>[0];
    for (var i = 0; i < vertices.length; i++) {
      lengths.add(
        lengths.last +
            (vertices[(i + 1) % vertices.length] - vertices[i]).distance,
      );
    }
    final sampled = <Offset>[];
    var edge = 0;
    for (var i = 0; i < count; i++) {
      final distance = lengths.last * i / count;
      while (edge + 1 < vertices.length && lengths[edge + 1] < distance) {
        edge++;
      }
      final fraction =
          (distance - lengths[edge]) / (lengths[edge + 1] - lengths[edge]);
      sampled.add(
        Offset.lerp(
              vertices[edge],
              vertices[(edge + 1) % vertices.length],
              fraction,
            )! -
            center,
      );
    }
    // A single cached neighbour pass removes one-pixel staircase corners.
    // The moving endpoint mask preserves the exact original at departure.
    rest = [
      for (var i = 0; i < count; i++)
        sampled[i] * .6 +
            (sampled[(i + count - 1) % count] + sampled[(i + 1) % count]) * .2,
    ];
    final angle = math.atan2(rest.first.dy, rest.first.dx);
    unit = [
      for (var i = 0; i < count; i++)
        Offset(
          math.cos(angle + 2 * math.pi * i / count),
          math.sin(angle + 2 * math.pi * i / count),
        ),
    ];
    moved = List<Offset>.filled(count, Offset.zero);
  }

  final bool hole;
  late final List<Offset> rest, unit, moved;
}

class _EffGlyph {
  _EffGlyph(this.cells) {
    var left = 400, right = 0, top = 240, bottom = 0;
    for (final cell in cells) {
      left = math.min(left, cell % 400);
      right = math.max(right, cell % 400 + 1);
      top = math.min(top, cell ~/ 400);
      bottom = math.max(bottom, cell ~/ 400 + 1);
    }
    center = Offset((left + right) / 2, (top + bottom) / 2);
    radius = math.sqrt(cells.length / math.pi) * 1.22;
    final edges = <int, List<int>>{};
    void edge(int ax, int ay, int bx, int by) {
      (edges[ay * 401 + ax] ??= []).add(by * 401 + bx);
    }

    for (final cell in cells) {
      final x = cell % 400, y = cell ~/ 400;
      if (!cells.contains(cell - 400)) edge(x, y, x + 1, y);
      if (x == 399 || !cells.contains(cell + 1)) edge(x + 1, y, x + 1, y + 1);
      if (!cells.contains(cell + 400)) edge(x + 1, y + 1, x, y + 1);
      if (x == 0 || !cells.contains(cell - 1)) edge(x, y + 1, x, y);
    }
    loops = [];
    while (edges.isNotEmpty) {
      final start = edges.keys.first;
      var current = start;
      var incoming = -1;
      final vertices = <Offset>[];
      do {
        vertices.add(
          Offset((current % 401).toDouble(), (current ~/ 401).toDouble()),
        );
        final options = edges[current]!;
        var best = 0;
        var bestRank = 5;
        for (var i = 0; i < options.length; i++) {
          final delta = options[i] - current;
          final direction = delta == 1
              ? 0
              : delta == 401
              ? 1
              : delta == -1
              ? 2
              : 3;
          final turn = (direction - incoming + 4) % 4;
          // Right-turn priority separates touching corners deterministically.
          final rank = incoming < 0 ? 0 : (const [1, 0, 3, 2])[turn];
          if (rank < bestRank) {
            bestRank = rank;
            best = i;
          }
        }
        final next = options.removeAt(best);
        final delta = next - current;
        incoming = delta == 1
            ? 0
            : delta == 401
            ? 1
            : delta == -1
            ? 2
            : 3;
        if (options.isEmpty) edges.remove(current);
        current = next;
      } while (current != start);
      var area = 0.0;
      for (var i = 0; i < vertices.length; i++) {
        final a = vertices[i], b = vertices[(i + 1) % vertices.length];
        area += a.dx * b.dy - b.dx * a.dy;
      }
      if (vertices.length >= 3 && area != 0) {
        loops.add(_EffLoop(vertices, area < 0, center));
      }
    }
  }

  final Set<int> cells;
  late final Offset center;
  late final double radius;
  late final List<_EffLoop> loops;
}

class _EffCache {
  _EffCache(Float32List pairs) {
    final count = pairs.length ~/ 4;
    final pending = <int>{};
    for (var i = 0; i < count; i++) {
      pending.add(pairs[i * 4 + 1].floor() * 400 + pairs[i * 4].floor());
    }
    glyphs = [];
    while (pending.isNotEmpty) {
      final seed = pending.first;
      pending.remove(seed);
      final cells = <int>{seed};
      final queue = <int>[seed];
      for (var head = 0; head < queue.length; head++) {
        final cell = queue[head], x = cell % 400;
        for (final next in [
          cell - 400,
          cell + 400,
          if (x > 0) cell - 1,
          if (x < 399) cell + 1,
        ]) {
          if (pending.remove(next)) {
            cells.add(next);
            queue.add(next);
          }
        }
      }
      glyphs.add(_EffGlyph(cells));
    }
    glyphs.sort((a, b) => a.center.dx.compareTo(b.center.dx));
    final owners = <int, int>{};
    for (var g = 0; g < glyphs.length; g++) {
      for (final cell in glyphs[g].cells) {
        owners[cell] = g;
      }
    }
    sampleGlyph = Uint8List(count);
    for (var i = 0; i < count; i++) {
      sampleGlyph[i] =
          owners[pairs[i * 4 + 1].floor() * 400 + pairs[i * 4].floor()]!;
    }
  }

  late final List<_EffGlyph> glyphs;
  late final Uint8List sampleGlyph;
  _OfEndpointMesh? wordMesh;
}

class _EffPose {
  _EffPose(this.center, this.radius, this.angle, this.sx, this.sy)
    : cosine = math.cos(angle),
      sine = math.sin(angle);
  final Offset center;
  final double radius, angle, sx, sy, cosine, sine;

  Offset move(Offset local) => Offset(
    center.dx + local.dx * sx * cosine - local.dy * sy * sine,
    center.dy + local.dx * sx * sine + local.dy * sy * cosine,
  );
}

void _effClosedSpline(Path path, List<Offset> points) {
  path.moveTo(points.first.dx, points.first.dy);
  for (var i = 0; i < points.length; i++) {
    final previous = points[(i + points.length - 1) % points.length];
    final current = points[i];
    final next = points[(i + 1) % points.length];
    final after = points[(i + 2) % points.length];
    final a = current + (next - previous) / 6;
    final b = next - (after - current) / 6;
    path.cubicTo(a.dx, a.dy, b.dx, b.dy, next.dx, next.dy);
  }
  path.close();
}

void _effGlyphPath(Path path, _EffGlyph glyph, _EffPose pose, double round) {
  for (final loop in glyph.loops) {
    if (loop.hole && round >= 1) continue;
    for (var i = 0; i < loop.rest.length; i++) {
      final local = loop.hole
          ? loop.rest[i] * (1 - round) * (1 - round)
          : Offset.lerp(loop.rest[i], loop.unit[i] * pose.radius, round)!;
      loop.moved[i] = pose.move(local);
    }
    _effClosedSpline(path, loop.moved);
  }
}

// An analytic neck grows from zero area at first contact. Cubic tangents
// match the soft bodies; no field rasterization, blur, or fragment shader.
void _effBridge(Path path, _EffPose a, _EffPose b, double gain, double reach) {
  if (gain <= 0) return;
  final delta = b.center - a.center;
  final distance = delta.distance;
  final ra = a.radius * math.min(a.sx, a.sy);
  final rb = b.radius * math.min(b.sx, b.sy);
  if (distance < (ra - rb).abs() + .001 || distance >= ra + rb + reach) return;
  final contact = _surfacesEase((ra + rb + reach - distance) / reach) * gain;
  final theta = .34 * math.pi * contact;
  final axis = delta / distance;
  final normal = Offset(-axis.dy, axis.dx);
  final ca = math.cos(theta), sa = math.sin(theta);
  final p1 = a.center + axis * (ra * ca) + normal * (ra * sa);
  final p2 = b.center - axis * (rb * ca) + normal * (rb * sa);
  final p3 = b.center - axis * (rb * ca) - normal * (rb * sa);
  final p4 = a.center + axis * (ra * ca) - normal * (ra * sa);
  final handle = math.min(
    math.max(0.0, distance - (ra + rb) * ca) * .5,
    math.min(ra, rb) * 1.2,
  );
  final c1 = p1 + (axis * sa - normal * ca) * handle;
  final c2 = p2 - (axis * sa + normal * ca) * handle;
  final c3 = p3 + (normal * ca - axis * sa) * handle;
  final c4 = p4 + (normal * ca + axis * sa) * handle;
  // Reverse the construction so its winding agrees with the outer glyphs.
  path
    ..moveTo(p1.dx, p1.dy)
    ..lineTo(p4.dx, p4.dy)
    ..cubicTo(c4.dx, c4.dy, c3.dx, c3.dy, p3.dx, p3.dy)
    ..lineTo(p2.dx, p2.dy)
    ..cubicTo(c2.dx, c2.dy, c1.dx, c1.dy, p1.dx, p1.dy)
    ..close();
}

bool _effExactEndpoint(Canvas canvas, StartupMorphData data, double q) {
  if (q <= 0) {
    canvas.drawImageRect(
      data.wordmark,
      Rect.fromLTWH(
        0,
        0,
        data.wordmark.width.toDouble(),
        data.wordmark.height.toDouble(),
      ),
      _effBounds,
      Paint()..filterQuality = FilterQuality.medium,
    );
    return true;
  }
  if (q >= 1) {
    canvas.drawCircle(
      const Offset(200, 120),
      _surfacesRadius,
      Paint()..color = _effInk,
    );
    return true;
  }
  return false;
}

void _effPaint(
  Canvas canvas,
  StartupMorphData data,
  _EffCache cache,
  List<_EffPose> poses,
  double q,
  double round,
  Float32List buffer, {
  required bool tide,
}) {
  final bodies = <Path>[];
  for (var g = 0; g < cache.glyphs.length; g++) {
    final body = Path();
    _effGlyphPath(body, cache.glyphs[g], poses[g], round);
    bodies.add(body);
  }
  final path = Path();
  for (var a = 0; a < poses.length; a++) {
    for (var b = a + 1; b < poses.length; b++) {
      final sameBank =
          (cache.glyphs[a].center.dx < 200) ==
          (cache.glyphs[b].center.dx < 200);
      final gain = tide && sameBank && b == a + 1
          ? _surfacesEase((q - .32) / .20)
          : _surfacesEase((q - (tide ? .62 : .44)) / .18);
      _effBridge(path, poses[a], poses[b], gain, tide ? 24 : 12);
    }
  }
  final departure = 1 - _surfacesEase(q / .20);
  if (departure > 0) canvas.saveLayer(_effBounds, Paint());
  // Composite bodies as a union. A bridge can reverse its winding after
  // deep overlap; putting it in the glyph path would cancel filled regions.
  for (final body in bodies) {
    canvas.drawPath(body, Paint()..color = _effInk);
  }
  canvas.drawPath(path, Paint()..color = _effInk);
  if (departure > 0) {
    // The source guard covers the sampler's omitted antialias fringe. It
    // moves with the glyphs and vanishes along with endpoint refinement.
    for (final body in bodies) {
      canvas.drawPath(
        body,
        Paint()
          ..color = _effInk
          ..style = PaintingStyle.stroke
          ..strokeJoin = StrokeJoin.round
          ..strokeWidth = 2.4 * departure,
      );
    }
    for (var i = 0; i < data.count; i++) {
      final g = cache.sampleGlyph[i];
      final point = poses[g].move(
        Offset(data.pairs[i * 4], data.pairs[i * 4 + 1]) -
            cache.glyphs[g].center,
      );
      buffer[i * 2] = point.dx;
      buffer[i * 2 + 1] = point.dy;
    }
    // The original alpha is transported with its glyph, never left behind
    // as a fading word. PLUS gives alpha 1-w+w*A without dimming solid ink.
    canvas.saveLayer(_effBounds, Paint()..blendMode = BlendMode.dstIn);
    canvas.drawRect(
      _effBounds,
      Paint()..color = Colors.white.withValues(alpha: 1 - departure),
    );
    canvas.saveLayer(_effBounds, Paint()..blendMode = BlendMode.plus);
    cache.wordMesh!.paint(canvas, data, buffer, departure);
    canvas.restore();
    canvas.restore();
    canvas.restore();
  }
}

/// Eight legible glyphs soften into ink drops. Their alternating little
/// lifts precede attraction, soft contact and a shared, settled round body.
void _paintFormationDrops(
  Canvas canvas,
  StartupMorphData data,
  double q,
  Float32List buffer,
) {
  final p = q.clamp(0.0, 1.0);
  if (_effExactEndpoint(canvas, data, p)) return;
  final cache = _effCaches[data]!;
  final soften = _surfacesEase((p - .04) / .42);
  final lift = _surfacesEase(p / .42);
  final pull = _surfacesEase((p - .34) / .66);
  final grow = _surfacesEase((p - .50) / .50);
  final contact = math.pow(math.sin(math.pi * pull), 2).toDouble();
  final poses = <_EffPose>[];
  for (var i = 0; i < cache.glyphs.length; i++) {
    final glyph = cache.glyphs[i];
    final dx = glyph.center.dx - 200;
    final liftY = (i.isEven ? -1.0 : 1.0) * (15 + 8 * math.sin(i * 1.3));
    final center = Offset(
      200 + dx * (1 - .12 * lift) * (1 - pull),
      120 + _effLerp(glyph.center.dy - 120, liftY, lift) * (1 - pull),
    );
    poses.add(
      _EffPose(
        center,
        _effLerp(glyph.radius, _surfacesRadius, grow),
        .18 * math.sin(i * 1.7) * math.sin(math.pi * soften) +
            .12 * contact * (i.isEven ? 1 : -1),
        1 + .12 * contact,
        1 - .09 * contact,
      ),
    );
  }
  _effPaint(canvas, data, cache, poses, p, soften, buffer, tide: false);
}
