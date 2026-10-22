import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';

const maxFeedbackImages = 3;
const maxFeedbackImageBytes = 1024 * 1024;
typedef FeedbackImagePicker =
    Future<List<FeedbackImage>> Function(int remaining);

class FeedbackImage {
  const FeedbackImage(this.bytes);
  final Uint8List bytes;
  Map<String, String> toJson() => {
    'mime_type': 'image/jpeg',
    'data': base64Encode(bytes),
  };
}

Future<List<FeedbackImage>> pickFeedbackImages(int remaining) async {
  final picker = ImagePicker();
  final files = remaining == 1
      ? [
          if (await picker.pickImage(
                source: ImageSource.gallery,
                maxWidth: 2048,
                maxHeight: 2048,
                imageQuality: 85,
                requestFullMetadata: false,
              )
              case final file?)
            file,
        ]
      : await picker.pickMultiImage(
          limit: remaining,
          maxWidth: 2048,
          maxHeight: 2048,
          imageQuality: 85,
          requestFullMetadata: false,
        );
  if (files.length > remaining) {
    throw const FormatException('feedback_image_limit');
  }
  final result = <FeedbackImage>[];
  for (final file in files) {
    if (await file.length() > 12 * 1024 * 1024) {
      throw const FormatException('feedback_image_too_large');
    }
    result.add(
      FeedbackImage(
        await compute(prepareFeedbackImage, await file.readAsBytes()),
      ),
    );
  }
  return result;
}

/// Always re-encode so EXIF, location and original filenames are not submitted.
Uint8List prepareFeedbackImage(Uint8List bytes) {
  if (bytes.length < 12) throw const FormatException('feedback_image_invalid');
  final decoder = img.findDecoderForData(bytes);
  final info = decoder?.startDecode(bytes);
  if (info == null || info.width * info.height > 32 * 1024 * 1024) {
    throw const FormatException('feedback_image_invalid');
  }
  final decoded = decoder!.decodeFrame(0);
  if (decoded == null) throw const FormatException('feedback_image_invalid');
  final oriented = img.bakeOrientation(decoded);
  final scale = math.min(1.0, 2048 / math.max(oriented.width, oriented.height));
  final resized = img.copyResize(
    oriented,
    width: math.max(1, (oriented.width * scale).round()),
    height: math.max(1, (oriented.height * scale).round()),
  );
  final clean = img.Image(width: resized.width, height: resized.height);
  img.fill(clean, color: img.ColorRgb8(255, 255, 255));
  img.compositeImage(clean, resized);
  for (final quality in [85, 70, 55, 40]) {
    final encoded = Uint8List.fromList(img.encodeJpg(clean, quality: quality));
    if (encoded.length <= maxFeedbackImageBytes) return encoded;
  }
  throw const FormatException('feedback_image_too_large');
}
