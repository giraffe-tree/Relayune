import 'dart:convert';
import 'dart:typed_data';

String base64UrlNoPadding(List<int> bytes) =>
    base64Url.encode(bytes).replaceAll('=', '');

Uint8List decodeBase64Url(String value) {
  if (!RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(value)) {
    throw const FormatException('base64url 编码无效。');
  }
  final padded = value.padRight((value.length + 3) ~/ 4 * 4, '=');
  return Uint8List.fromList(base64Url.decode(padded));
}

Uint8List concatBytes(Iterable<List<int>> parts) {
  final length = parts.fold<int>(0, (sum, part) => sum + part.length);
  final output = Uint8List(length);
  var offset = 0;
  for (final part in parts) {
    output.setAll(offset, part);
    offset += part.length;
  }
  return output;
}

Uint8List leb128(int input) {
  if (input < 0) throw const FormatException('LEB128 不接受负数。');
  var value = input;
  final output = <int>[];
  do {
    var byte = value & 0x7f;
    value >>= 7;
    if (value != 0) byte |= 0x80;
    output.add(byte);
  } while (value != 0);
  return Uint8List.fromList(output);
}

Uint8List lvCat(Iterable<List<int>> parts) =>
    concatBytes(parts.expand((part) => <List<int>>[leb128(part.length), part]));

String canonicalJson(Object? value) {
  if (value is List) {
    return '[${value.map(canonicalJson).join(',')}]';
  }
  if (value is Map) {
    final keys = value.keys.map((key) => key.toString()).toList()..sort();
    return '{${keys.map((key) => '${jsonEncode(key)}:${canonicalJson(value[key])}').join(',')}}';
  }
  return jsonEncode(value);
}

bool constantTimeEquals(List<int> left, List<int> right) {
  if (left.length != right.length) return false;
  var difference = 0;
  for (var index = 0; index < left.length; index++) {
    difference |= left[index] ^ right[index];
  }
  return difference == 0;
}
