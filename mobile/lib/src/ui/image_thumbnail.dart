import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:image/image.dart' as image;

const int maxImageThumbnailBytes = 1024 * 1024;
const int imageThumbnailWidth = 1280;
const int imageThumbnailHeight = 720;
const int imageThumbnailJpegQuality = 85;

Future<Uint8List> createImageThumbnail(
  Uint8List source, {
  String? mimeType,
}) async {
  if (source.isEmpty) throw StateError('图片内容为空。');
  if (source.lengthInBytes <= maxImageThumbnailBytes) {
    final decoded = image.decodeImage(source, frame: 0);
    if (decoded == null) throw StateError('无法读取图片。');
    final landscape = decoded.width >= decoded.height;
    final maxWidth = landscape ? imageThumbnailWidth : imageThumbnailHeight;
    final maxHeight = landscape ? imageThumbnailHeight : imageThumbnailWidth;
    if (decoded.width <= maxWidth && decoded.height <= maxHeight) return source;
  }

  return compute(_createImageThumbnail, (
    source: source,
    mimeType: mimeType,
  ), debugLabel: 'image-thumbnail');
}

Uint8List _createImageThumbnail(
  ({Uint8List source, String? mimeType}) request,
) {
  final source = request.source;
  final decoded = image.decodeImage(source, frame: 0);
  if (decoded == null) throw StateError('无法读取图片。');
  final landscape = decoded.width >= decoded.height;
  final maxWidth = landscape ? imageThumbnailWidth : imageThumbnailHeight;
  final maxHeight = landscape ? imageThumbnailHeight : imageThumbnailWidth;
  final scale = math.min(
    1.0,
    math.min(maxWidth / decoded.width, maxHeight / decoded.height),
  );
  final resized = image.copyResize(
    decoded,
    width: math.max(1, (decoded.width * scale).round()),
    height: math.max(1, (decoded.height * scale).round()),
    interpolation: image.Interpolation.average,
  );
  if (_shouldPreferPng(source, request.mimeType)) {
    final png = image.encodePng(resized, singleFrame: true, level: 9);
    if (png.lengthInBytes <= maxImageThumbnailBytes) return png;
  }
  final thumbnail = image.encodeJpg(
    resized,
    quality: imageThumbnailJpegQuality,
  );
  if (thumbnail.lengthInBytes > maxImageThumbnailBytes) {
    throw StateError('图片预览压缩后超过 1MB。');
  }
  return thumbnail;
}

bool _shouldPreferPng(Uint8List source, String? mimeType) {
  if (mimeType?.toLowerCase() == 'image/png') return true;
  return source.lengthInBytes >= 8 &&
      source[0] == 0x89 &&
      source[1] == 0x50 &&
      source[2] == 0x4e &&
      source[3] == 0x47 &&
      source[4] == 0x0d &&
      source[5] == 0x0a &&
      source[6] == 0x1a &&
      source[7] == 0x0a;
}
