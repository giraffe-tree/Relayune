part of 'startup_morph.dart';

// Independent first acts only. The caller owns the original Eclipse S-cut.
// References: lucaszanotto.com (round sculptural balance, without faces),
// works.jonobr1.com/Typatone (letter-by-letter timing, not its artwork).
final _softFormationCaches = Expando<_SoftFormationCache>('soft first acts');

class _SoftFormationInk {
  _SoftFormationInk(this.points) {
    var left = 400.0;
    var top = 240.0;
    var right = 0.0;
    var bottom = 0.0;
    for (final point in points) {
      left = math.min(left, point.dx);
      top = math.min(top, point.dy);
      right = math.max(right, point.dx);
      bottom = math.max(bottom, point.dy);
      // These fixed, overlapping ink seeds never fly independently. Sweeping
      // their round strokes is a continuous dilation of the actual letter.
      // A nonzero short segment avoids zero-length stroke backend differences.
      veins
        ..moveTo(point.dx - .08, point.dy)
        ..lineTo(point.dx + .08, point.dy);
    }
    bounds = Rect.fromLTRB(left - 2, top - 2, right + 2, bottom + 2);
    final anchor = points.first;
    coverageRadius =
        [
          bounds.topLeft,
          bounds.topRight,
          bounds.bottomLeft,
          bounds.bottomRight,
        ].map((corner) => (corner - anchor).distance).reduce(math.max) +
        2;
  }

  final List<Offset> points;
  final Path veins = Path();
  late final Rect bounds;
  late final double coverageRadius;
  Path? sourceClip;
}

class _SoftFormationCache {
  _SoftFormationCache(StartupMorphData data) {
    // Recover connected glyphs, not arbitrary x slices. The a and y overlap
    // in x, so splitting the wordmark into rectangular strips would cut ink.
    final cells = <int, List<int>>{};
    for (var i = 0; i < data.count; i++) {
      final x = data.pairs[i * 4].floor();
      final y = data.pairs[i * 4 + 1].floor();
      (cells[y * 400 + x] ??= []).add(i);
    }
    final pending = cells.keys.toSet();
    final groups = <List<int>>[];
    while (pending.isNotEmpty) {
      final stack = [pending.first];
      pending.remove(stack.first);
      final group = <int>[];
      while (stack.isNotEmpty) {
        final cell = stack.removeLast();
        group.add(cell);
        final x = cell % 400;
        final y = cell ~/ 400;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            final nx = x + dx;
            final ny = y + dy;
            if (nx < 0 || nx >= 400 || ny < 0 || ny >= 240) continue;
            final next = ny * 400 + nx;
            if (pending.remove(next)) stack.add(next);
          }
        }
      }
      groups.add(group);
    }
    groups.sort((a, b) {
      final ax = a.map((cell) => cell % 400).reduce(math.min);
      final bx = b.map((cell) => cell % 400).reduce(math.min);
      return ax.compareTo(bx);
    });
    owners = Int32List(data.count);
    letters = [];
    for (var index = 0; index < groups.length; index++) {
      final points = <Offset>[];
      for (final cell in groups[index]) {
        final ids = cells[cell]!;
        // Deduplicate resampled cells, retaining a true artwork sample as the
        // dilation centre rather than an enlarged binary-mask boundary.
        final first = ids.first;
        points.add(Offset(data.pairs[first * 4], data.pairs[first * 4 + 1]));
        for (final id in ids) {
          owners[id] = index;
        }
      }
      letters.add(_SoftFormationInk(points));
    }
    whole = _SoftFormationInk([for (final letter in letters) ...letter.points]);

    // Piecewise Voronoi dividers stay in the transparent gutters, including
    // the diagonal gap between a and y. The disjoint clips reproduce the
    // original texture; their edges are NOT contours used for the animation.
    final top = whole.bounds.top.floor() - 2;
    final bottom = whole.bounds.bottom.ceil() + 2;
    final dividers = <List<Offset>>[];
    for (var i = 0; i + 1 < letters.length; i++) {
      final a = letters[i];
      final b = letters[i + 1];
      final divider = <Offset>[];
      for (var y = top; y <= bottom; y++) {
        var lo = a.bounds.center.dx;
        var hi = b.bounds.center.dx;
        for (var step = 0; step < 12; step++) {
          final x = (lo + hi) * .5;
          final point = Offset(x, y.toDouble());
          if (_softFormationDistance(point, a.points) <
              _softFormationDistance(point, b.points)) {
            lo = x;
          } else {
            hi = x;
          }
        }
        divider.add(Offset((lo + hi) * .5, y.toDouble()));
      }
      dividers.add(divider);
    }
    for (var i = 0; i < letters.length; i++) {
      final left = i == 0
          ? [Offset(0, top.toDouble()), Offset(0, bottom.toDouble())]
          : dividers[i - 1];
      final right = i == letters.length - 1
          ? [Offset(400, top.toDouble()), Offset(400, bottom.toDouble())]
          : dividers[i];
      letters[i].sourceClip = Path()
        ..addPolygon([...left, ...right.reversed], true);
    }
  }

  late final List<_SoftFormationInk> letters;
  late final _SoftFormationInk whole;
  late final Int32List owners;
}

double _softFormationDistance(Offset point, List<Offset> samples) {
  var distance = double.infinity;
  for (final sample in samples) {
    distance = math.min(distance, (point - sample).distanceSquared);
  }
  return distance;
}

void _softFormationWordmark(Canvas canvas, StartupMorphData data) {
  canvas.drawImageRect(
    data.wordmark,
    Rect.fromLTWH(
      0,
      0,
      data.wordmark.width.toDouble(),
      data.wordmark.height.toDouble(),
    ),
    _surfacesBounds,
    Paint()..filterQuality = FilterQuality.medium,
  );
}

/// Grow opaque material out of the original strokes, without dissolving the
/// artwork. Its texture and the round dilation share the same affine motion.
/// Once one seed's radius covers every corner, the clipped body is provably
/// opaque; drawing that identical filled body then is only a rendering shortcut.
void _softFormationMaterial(
  Canvas canvas,
  StartupMorphData data,
  _SoftFormationInk ink,
  Rect body,
  double roundness,
  double swelling,
) {
  final shape = RRect.fromRectAndRadius(
    body,
    Radius.circular(math.min(body.width, body.height) * .5 * roundness),
  );
  if (swelling >= 1) {
    canvas.drawRRect(shape, Paint()..color = _surfacesInk);
    return;
  }
  canvas.save();
  // Clip before the dilation: this is the soft outside skin, not scan bands.
  canvas.clipRRect(shape);
  canvas.translate(body.center.dx, body.center.dy);
  canvas.scale(body.width / ink.bounds.width, body.height / ink.bounds.height);
  canvas.translate(-ink.bounds.center.dx, -ink.bounds.center.dy);
  canvas.save();
  if (ink.sourceClip case final clip?) {
    canvas.clipPath(clip, doAntiAlias: false);
  }
  _softFormationWordmark(canvas, data);
  canvas.restore();
  if (swelling > 0) {
    canvas.drawPath(
      ink.veins,
      Paint()
        ..color = _surfacesInk
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..strokeWidth = 2 * ink.coverageRadius * swelling,
    );
  }
  canvas.restore();
}

class _SoftFormationPose {
  const _SoftFormationPose(this.center, this.width, this.height, this.angle);
  final Offset center;
  final double width;
  final double height;
  final double angle;

  Offset map(Offset source, Rect bounds) {
    final x = (source.dx - bounds.center.dx) * width / bounds.width;
    final y = (source.dy - bounds.center.dy) * height / bounds.height;
    final c = math.cos(angle);
    final s = math.sin(angle);
    return center + Offset(x * c - y * s, x * s + y * c);
  }
}

_SoftFormationPose _softFormationRollPose(
  _SoftFormationInk ink,
  int index,
  int count,
  double q,
) {
  final rank = index / math.max(1, count - 1);
  final delay = .16 * rank;
  final local = ((q - delay) / (.90 - delay)).clamp(0.0, 1.0);
  final tip = _surfacesEase(local / .43);
  final travel = _surfacesEase((local - .12) / .76);
  final soften = _surfacesEase((local - .30) / .53);
  final settle = _surfacesEase((local - .62) / .38);
  final direction = ink.bounds.center.dx < 200 ? 1.0 : -1.0;
  // Rotate around the original foot first, then let that same body roll in.
  final angle = direction * (1.05 * tip + 2.1 * travel) * (1 - settle);
  final foot = ink.bounds.bottom;
  final dy = ink.bounds.center.dy - foot;
  final tipped = Offset(
    ink.bounds.center.dx - math.sin(angle) * dy,
    foot + math.cos(angle) * dy,
  );
  final hop = math.sin(math.pi * travel);
  final center = Offset(
    _surfacesMix(tipped.dx, 200, travel),
    _surfacesMix(tipped.dy, 120, travel) - 17 * hop * hop,
  );
  // The first letter becomes the receiving body. The others remain distinct
  // small rolls until they enter it; their visible mass never vanishes by alpha.
  final radius = index == 0 ? _surfacesRadius : 12.0 + 2 * (index % 3);
  return _SoftFormationPose(
    center,
    _surfacesMix(ink.bounds.width, 2 * radius, soften),
    _surfacesMix(ink.bounds.height, 2 * radius, soften),
    angle,
  );
}

void _paintFormationRoll(
  Canvas canvas,
  StartupMorphData data,
  double q,
  Float32List buffer,
) {
  q = q.clamp(0.0, 1.0);
  if (data.count == 0) return;
  if (q == 0) {
    _softFormationWordmark(canvas, data);
    for (var i = 0; i < data.count; i++) {
      buffer[i * 2] = data.pairs[i * 4];
      buffer[i * 2 + 1] = data.pairs[i * 4 + 1];
    }
    return;
  }
  final cache = _softFormationCaches[data] ??= _SoftFormationCache(data);
  final poses = [
    for (var i = 0; i < cache.letters.length; i++)
      _softFormationRollPose(cache.letters[i], i, cache.letters.length, q),
  ];
  for (var i = 0; i < data.count; i++) {
    final owner = cache.owners[i];
    final point = poses[owner].map(
      Offset(data.pairs[i * 4], data.pairs[i * 4 + 1]),
      cache.letters[owner].bounds,
    );
    buffer[i * 2] = point.dx;
    buffer[i * 2 + 1] = point.dy;
  }
  // All bodies have settled by .90; the smaller ones lie strictly inside the
  // first. Use the original disc tessellation for the exact handoff pixels.
  if (q >= .94) {
    _surfacesDisc(canvas, _surfacesFor(data).disc, 1, 0, 0, 0);
    return;
  }
  for (var i = cache.letters.length - 1; i >= 0; i--) {
    final rank = i / math.max(1, cache.letters.length - 1);
    final delay = .16 * rank;
    final local = ((q - delay) / (.90 - delay)).clamp(0.0, 1.0);
    final swelling = _surfacesEase((local - .24) / .38);
    final rounded = _surfacesEase((local - .24) / .48);
    final pose = poses[i];
    canvas.save();
    canvas.translate(pose.center.dx, pose.center.dy);
    canvas.rotate(pose.angle);
    _softFormationMaterial(
      canvas,
      data,
      cache.letters[i],
      Rect.fromCenter(
        center: Offset.zero,
        width: pose.width,
        height: pose.height,
      ),
      rounded,
      swelling,
    );
    canvas.restore();
  }
}

void _paintFormationElastic(
  Canvas canvas,
  StartupMorphData data,
  double q,
  Float32List buffer,
) {
  q = q.clamp(0.0, 1.0);
  if (data.count == 0) return;
  if (q == 0) {
    _softFormationWordmark(canvas, data);
    for (var i = 0; i < data.count; i++) {
      buffer[i * 2] = data.pairs[i * 4];
      buffer[i * 2 + 1] = data.pairs[i * 4 + 1];
    }
    return;
  }
  final cache = _softFormationCaches[data] ??= _SoftFormationCache(data);
  final ink = cache.whole;
  final pillow = _surfacesEase(q / .46);
  final circular = _surfacesEase((q - .43) / .51);
  final springTime = ((q - .43) / .51).clamp(0.0, 1.0);
  // One readable compression/rebound, gated to zero displacement AND velocity
  // at both ends. Reciprocal scaling keeps the pillow's elastic area stable.
  final envelope = math.sin(math.pi * springTime);
  final rebound =
      .16 * envelope * envelope * math.sin(2 * math.pi * springTime);
  final stretch = 1 + rebound;
  final width =
      _surfacesMix(
        _surfacesMix(ink.bounds.width, 146, pillow),
        2 * _surfacesRadius,
        circular,
      ) *
      stretch;
  final height =
      _surfacesMix(
        _surfacesMix(ink.bounds.height, 57, pillow),
        2 * _surfacesRadius,
        circular,
      ) /
      stretch;
  final lift = math.sin(math.pi * pillow);
  final center = Offset(
    _surfacesMix(ink.bounds.center.dx, 200, pillow),
    _surfacesMix(ink.bounds.center.dy, 120, pillow) - 7 * lift * lift,
  );
  final angle = -.055 * math.sin(math.pi * circular);
  final pose = _SoftFormationPose(center, width, height, angle);
  for (var i = 0; i < data.count; i++) {
    final point = pose.map(
      Offset(data.pairs[i * 4], data.pairs[i * 4 + 1]),
      ink.bounds,
    );
    buffer[i * 2] = point.dx;
    buffer[i * 2 + 1] = point.dy;
  }
  if (q >= .96) {
    _surfacesDisc(canvas, _surfacesFor(data).disc, 1, 0, 0, 0);
    return;
  }
  canvas.save();
  canvas.translate(center.dx, center.dy);
  canvas.rotate(angle);
  _softFormationMaterial(
    canvas,
    data,
    ink,
    Rect.fromCenter(center: Offset.zero, width: width, height: height),
    _surfacesEase(q / .40),
    _surfacesEase((q - .16) / .38),
  );
  canvas.restore();
}
