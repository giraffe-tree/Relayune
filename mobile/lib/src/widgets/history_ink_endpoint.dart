part of 'history_ink_painter.dart';

// A small textured mesh makes the limit at each endpoint the EXACT artwork.
// Its vertices follow a weighted neighbourhood of the same moving samples.
// The endpoint windows are effect-specific; the two images never overlap.
class _HistoryInkWordMesh {
  _HistoryInkWordMesh(StartupMorphData data) {
    const offset = 0;
    final image = data.wordmark;
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
  }

  late final Float32List rest, moved, texture, weights;
  late final Int32List neighbours;
  late final Uint16List indices;
  late final ui.ImageShader shader;

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
        dx += (positions[i * 2] - data.pairs[i * 4]) * w;
        dy += (positions[i * 2 + 1] - data.pairs[i * 4 + 1]) * w;
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
