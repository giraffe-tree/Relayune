part of 'startup_morph.dart';

// Spatial typography, then material growth. The original texture and the
// growing ink share ONE continuous parameter surface. No image crossfade,
// scan-line transport, random fibres, blur, or offscreen layer is involved.
final _erFormationCaches = Expando<_ErFormationMesh>('formation ribbons');
const _erFormationInk = Color(0xFFF6F8F5);

class _ErFormationMesh {
  _ErFormationMesh(StartupMorphData data) {
    var left = 400.0;
    var right = 0.0;
    var top = 240.0;
    var bottom = 0.0;
    for (var i = 0; i < data.count; i++) {
      left = math.min(left, data.pairs[i * 4]);
      right = math.max(right, data.pairs[i * 4]);
      top = math.min(top, data.pairs[i * 4 + 1]);
      bottom = math.max(bottom, data.pairs[i * 4 + 1]);
    }
    // Transparent guard includes the antialiasing omitted by asset sampling.
    bounds = Rect.fromLTRB(left - 2, top - 2, right + 2, bottom + 2);
    final count = columns * rows;
    positions = Float32List(count * 2);
    texture = Float32List(count * 2);
    field = Float32List(count);
    final occupied = Uint8List(count);
    for (var i = 0; i < data.count; i++) {
      final x =
          ((data.pairs[i * 4] - bounds.left) / bounds.width * (columns - 1))
              .round()
              .clamp(0, columns - 1);
      final y =
          ((data.pairs[i * 4 + 1] - bounds.top) / bounds.height * (rows - 1))
              .round()
              .clamp(0, rows - 1);
      occupied[y * columns + x] = 1;
    }
    final inkDistance = _distance(occupied, true);
    final emptyDistance = _distance(occupied, false);
    var deepest = 0.0;
    var farthest = 0.0;
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < columns; x++) {
        final i = y * columns + x;
        final d = occupied[i] == 1 ? -emptyDistance[i] : inkDistance[i];
        field[i] = d;
        deepest = math.min(deepest, d);
        farthest = math.max(farthest, d);
        texture[i * 2] =
            (bounds.left + x * bounds.width / (columns - 1)) *
            data.wordmark.width /
            400;
        texture[i * 2 + 1] =
            (bounds.top + y * bounds.height / (rows - 1)) *
            data.wordmark.height /
            240;
      }
    }
    minimum = deepest - .01;
    maximum = farthest + .01;
    indices = Uint16List((columns - 1) * (rows - 1) * 6);
    var cursor = 0;
    for (var y = 0; y < rows - 1; y++) {
      for (var x = 0; x < columns - 1; x++) {
        final a = y * columns + x;
        indices[cursor++] = a;
        indices[cursor++] = a + 1;
        indices[cursor++] = a + columns;
        indices[cursor++] = a + 1;
        indices[cursor++] = a + columns + 1;
        indices[cursor++] = a + columns;
      }
    }
    shader = ui.ImageShader(
      data.wordmark,
      TileMode.clamp,
      TileMode.clamp,
      Float64List.fromList([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    );
  }

  // Angular resolution keeps the final circumference within .01 logical px
  // for the ring and .03 px for the two-turn coil. Only 4,825 mesh vertices.
  static const columns = 193;
  static const rows = 25;
  late final Rect bounds;
  late final Float32List positions, texture, field;
  late final Uint16List indices;
  late final ui.ImageShader shader;
  late final double minimum, maximum;

  Float32List _distance(Uint8List cells, bool toInk) {
    final result = Float32List(cells.length);
    for (var i = 0; i < cells.length; i++) {
      result[i] = (cells[i] == 1) == toInk ? 0 : 1000;
    }
    final sx = bounds.width / (columns - 1);
    final sy = bounds.height / (rows - 1);
    final diagonal = math.sqrt(sx * sx + sy * sy);
    // A cached chamfer distance front; no distance transform runs per frame.
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < columns; x++) {
        final i = y * columns + x;
        var d = result[i];
        if (x > 0) d = math.min(d, result[i - 1] + sx);
        if (y > 0) {
          d = math.min(d, result[i - columns] + sy);
          if (x > 0) d = math.min(d, result[i - columns - 1] + diagonal);
          if (x + 1 < columns)
            d = math.min(d, result[i - columns + 1] + diagonal);
        }
        result[i] = d;
      }
    }
    for (var y = rows - 1; y >= 0; y--) {
      for (var x = columns - 1; x >= 0; x--) {
        final i = y * columns + x;
        var d = result[i];
        if (x + 1 < columns) d = math.min(d, result[i + 1] + sx);
        if (y + 1 < rows) {
          d = math.min(d, result[i + columns] + sy);
          if (x > 0) d = math.min(d, result[i + columns - 1] + diagonal);
          if (x + 1 < columns)
            d = math.min(d, result[i + columns + 1] + diagonal);
        }
        result[i] = d;
      }
    }
    return result;
  }

  void paint(Canvas canvas, _ErFormationSurface surface, double growth) {
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < columns; x++) {
        final point = surface.at(x / (columns - 1), y / (rows - 1));
        final i = (y * columns + x) * 2;
        positions[i] = point.dx;
        positions[i + 1] = point.dy;
      }
    }
    if (growth > 0) {
      final fill = Path();
      if (growth >= 1) {
        // Walk the boundary of the strip: a solid annulus for ring, and one
        // wide, overlapping spiral for ribbon. No per-cell seams remain.
        for (var x = 0; x < columns; x++) {
          final p = surface.at(x / (columns - 1), 0);
          if (x == 0) {
            fill.moveTo(p.dx, p.dy);
          } else {
            fill.lineTo(p.dx, p.dy);
          }
        }
        for (var x = columns - 1; x >= 0; x--) {
          final p = surface.at(x / (columns - 1), 1);
          fill.lineTo(p.dx, p.dy);
        }
        fill.close();
      } else {
        final level = minimum + (maximum - minimum) * growth;
        // Clip triangles against a single signed-distance level. Its boundary
        // advances from stroke interiors through counters and letter spaces;
        // material gains AREA rather than fading into a pre-existing shape.
        // All pieces are one nonzero-winding path and one native fill draw.
        for (var tri = 0; tri < indices.length; tri += 3) {
          var started = false;
          for (var edge = 0; edge < 3; edge++) {
            final a = indices[tri + edge];
            final b = indices[tri + (edge + 1) % 3];
            final fa = field[a];
            final fb = field[b];
            if (fa <= level) {
              final p = Offset(positions[a * 2], positions[a * 2 + 1]);
              if (!started) {
                fill.moveTo(p.dx, p.dy);
                started = true;
              } else {
                fill.lineTo(p.dx, p.dy);
              }
            }
            if ((fa <= level) != (fb <= level)) {
              final t = (level - fa) / (fb - fa);
              final u =
                  ((a % columns) + ((b % columns) - (a % columns)) * t) /
                  (columns - 1);
              final v =
                  ((a ~/ columns) + ((b ~/ columns) - (a ~/ columns)) * t) /
                  (rows - 1);
              final p = surface.at(u, v);
              if (!started) {
                fill.moveTo(p.dx, p.dy);
                started = true;
              } else {
                fill.lineTo(p.dx, p.dy);
              }
            }
          }
          if (started) fill.close();
        }
      }
      canvas.drawPath(fill, Paint()..color = _erFormationInk);
    }
    if (growth < 1) {
      final mesh = ui.Vertices.raw(
        ui.VertexMode.triangles,
        positions,
        textureCoordinates: texture,
        indices: indices,
      );
      canvas.drawVertices(
        mesh,
        BlendMode.modulate,
        Paint()
          ..shader = shader
          ..filterQuality = FilterQuality.low,
      );
      mesh.dispose();
    }
  }
}

class _ErFormationSurface {
  _ErFormationSurface(this.bounds, this.q, {required this.ribbon}) {
    if (ribbon) {
      bend = _surfacesEase(q / .74);
      settle = _surfacesEase((q - .73) / .27);
      angle = 4 * math.pi * bend;
      final base = bounds.height * (1 - bend) + 14 * bend;
      thickness = base + (_surfacesRadius - base) * settle;
    } else {
      bend = _surfacesEase(q / .62);
      settle = _surfacesEase((q - .78) / .22);
      angle = 2 * math.pi * bend;
      final base = bounds.height * (1 - bend) + 32 * bend;
      thickness = base + (_surfacesRadius - base) * settle;
    }
  }

  final Rect bounds;
  final double q;
  final bool ribbon;
  late final double bend, settle, angle, thickness;

  Offset at(double u, double v) {
    final along = u - .5;
    // Removable curvature singularity at zero: use a sinc expansion, not a
    // different endpoint image. Texture positions tend exactly to identity.
    final theta = along * angle;
    final sinc = theta.abs() < .001
        ? 1 - theta * theta / 6 + theta * theta * theta * theta / 120
        : math.sin(theta) / theta;
    final halfSin = math.sin(theta * .5);
    final oneMinusCosOverAngle = angle < .000001
        ? along * along * angle * .5
        : 2 * halfSin * halfSin / angle;
    final centreX = bounds.center.dx * (1 - bend) + 200 * bend;
    final centreY = bounds.center.dy * (1 - bend) + 120 * bend;
    final sin = math.sin(theta);
    final cos = math.cos(theta);
    final transverse = (.5 - v) * thickness;
    if (!ribbon) {
      final middleRadius = _surfacesRadius - thickness * .5;
      // The two word ends describe opposite sides of the same circular bend.
      // The outside settles at R first; then only the inside contracts to 0.
      final x =
          bounds.width * along * sinc * (1 - bend) +
          middleRadius * sin * bend +
          transverse * sin;
      final y =
          bounds.width * oneMinusCosOverAngle * (1 - bend) -
          middleRadius * cos * bend -
          transverse * cos;
      return Offset(centreX + x, centreY + y);
    }
    // One continuous two-turn belt, with a visible gap between adjacent turns
    // before settling. The second turn finally expands to cover radii 0..R;
    // the first remains inside it. Nothing is added on top to fake a disc.
    final spiralRadius = 4 + 40 * u;
    final finalRadius = _surfacesRadius * .5 * math.min(1.0, 2 * u);
    final radius = spiralRadius + (finalRadius - spiralRadius) * settle;
    final x =
        bounds.width * along * sinc * (1 - bend) +
        radius * sin * bend +
        transverse * sin;
    final y =
        bounds.width * oneMinusCosOverAngle * (1 - bend) -
        radius * cos * bend -
        transverse * cos;
    // A modest oblique sweep gives the coil a different spatial gesture from
    // the symmetric ring. It is identity at both endpoints, with zero speed.
    final tilt = -.24 * math.pow(math.sin(math.pi * bend), 2);
    return Offset(
      centreX + x * math.cos(tilt) - y * math.sin(tilt),
      centreY + x * math.sin(tilt) + y * math.cos(tilt),
    );
  }
}

void _erPaintFormation(
  Canvas canvas,
  StartupMorphData data,
  double q,
  Float32List buffer, {
  required bool ribbon,
}) {
  if (data.count == 0) return;
  q = q.clamp(0.0, 1.0);
  final cache = _erFormationCaches[data] ??= _ErFormationMesh(data);
  final surface = _ErFormationSurface(cache.bounds, q, ribbon: ribbon);
  for (var i = 0; i < data.count; i++) {
    final p = surface.at(
      (data.pairs[i * 4] - cache.bounds.left) / cache.bounds.width,
      (data.pairs[i * 4 + 1] - cache.bounds.top) / cache.bounds.height,
    );
    buffer[i * 2] = p.dx;
    buffer[i * 2 + 1] = p.dy;
  }
  if (q == 1) {
    // Exact analytic endpoint; the preceding surface is already a filled disc
    // (its tessellation error is below .03 logical pixels).
    canvas.drawCircle(
      const Offset(200, 120),
      _surfacesRadius,
      Paint()..color = _erFormationInk,
    );
    return;
  }
  final growth = ribbon
      ? _surfacesEase((q - .12) / .40)
      : _surfacesEase((q - .54) / .24);
  cache.paint(canvas, surface, growth);
}

/// The entire word bends into a closed typographic ring; the inner bank then
/// contracts. Left-to-right letter order is retained around the circumference.
void _paintFormationRing(
  Canvas canvas,
  StartupMorphData data,
  double q,
  Float32List buffer,
) {
  _erPaintFormation(canvas, data, q, buffer, ribbon: false);
}

/// The word becomes one broad soft belt, winds into two visible turns, and
/// fills the disc by closing the gap between its adjacent banks.
void _paintFormationRibbon(
  Canvas canvas,
  StartupMorphData data,
  double q,
  Float32List buffer,
) {
  _erPaintFormation(canvas, data, q, buffer, ribbon: true);
}
