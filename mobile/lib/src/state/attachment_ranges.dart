import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as hashes;

/// Reassembles authenticated response parts without accepting gaps, changes in
/// the source, or an unbounded allocation. Older desktops return a single body.
class AttachmentRanges {
  static const int partBytes = 128 * 1024;
  static const int maxBytes = 20 * 1024 * 1024;

  final BytesBuilder _bytes = BytesBuilder(copy: false);
  int offset = 0;
  int? total;
  String? _digest;
  String? _mimeType;
  bool complete = false;

  void append(Map<String, dynamic> response) {
    if (complete) throw const FormatException('Attachment already completed.');
    final encoded = response['base64'];
    if (encoded is! String || encoded.length > ((maxBytes + 2) ~/ 3) * 4) {
      throw const FormatException('Attachment response is too large.');
    }
    final bytes = base64Decode(encoded);
    if (offset + bytes.length > maxBytes) {
      throw const FormatException('Attachment response is too large.');
    }
    final isRange =
        response.containsKey('offset') ||
        response.containsKey('total_size') ||
        response.containsKey('has_more');
    if (!isRange) {
      if (offset != 0) throw const FormatException('Attachment range missing.');
      _bytes.add(bytes);
      offset = bytes.length;
      total = offset;
      complete = true;
      return;
    }
    final size = response['total_size'];
    final next = response['next_offset'];
    final more = response['has_more'];
    final digest = response['content_digest'];
    final mime = response['mime_type'];
    if (response['offset'] != offset ||
        size is! int ||
        size < 0 ||
        size > maxBytes ||
        next is! int ||
        next != offset + bytes.length ||
        next > size ||
        more is! bool ||
        more != (next < size) ||
        bytes.length > partBytes ||
        (more && bytes.isEmpty) ||
        digest is! String ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(digest) ||
        mime is! String ||
        (total != null && total != size) ||
        (_digest != null && _digest != digest) ||
        (_mimeType != null && _mimeType != mime)) {
      throw const FormatException('Attachment range changed or is invalid.');
    }
    total = size;
    _digest = digest;
    _mimeType = mime;
    _bytes.add(bytes);
    offset = next;
    complete = !more;
  }

  Uint8List takeBytes() {
    if (!complete) throw const FormatException('Attachment is incomplete.');
    final bytes = _bytes.takeBytes();
    if (_digest != null && hashes.sha256.convert(bytes).toString() != _digest) {
      throw const FormatException('Attachment content changed.');
    }
    return bytes;
  }
}
