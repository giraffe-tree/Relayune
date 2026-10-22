import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';

const _fallbackIosName = 'Relayune · iPhone / iPad';
const _fallbackAndroidName = 'Relayune · Android';

/// Builds the human-readable authorization label sent during pairing.
///
/// Only coarse model and OS information is included. Stable identifiers such
/// as serial numbers, Android IDs, vendor IDs and user-assigned device names
/// are deliberately excluded.
Future<String> mobileAuthorizationName({DeviceInfoPlugin? deviceInfo}) async {
  final plugin = deviceInfo ?? DeviceInfoPlugin();
  try {
    if (Platform.isIOS) {
      final info = await plugin.iosInfo;
      return formatIosAuthorizationName(
        machine: info.utsname.machine,
        deviceClass: info.model,
        systemVersion: info.systemVersion,
      );
    }
    if (Platform.isAndroid) {
      final info = await plugin.androidInfo;
      return formatAndroidAuthorizationName(
        manufacturer: info.manufacturer,
        model: info.model,
        systemVersion: info.version.release,
      );
    }
  } on Object {
    // Device metadata must never prevent the one-tap pairing path.
  }
  return Platform.isIOS ? _fallbackIosName : _fallbackAndroidName;
}

String formatIosAuthorizationName({
  required String machine,
  required String deviceClass,
  required String systemVersion,
}) {
  final model =
      _appleMarketingName(machine) ??
      (_cleanPart(deviceClass).toLowerCase().contains('ipad')
          ? 'iPad'
          : 'iPhone');
  return _authorizationName(
    model: model,
    osName: model.startsWith('iPad') ? 'iPadOS' : 'iOS',
    systemVersion: systemVersion,
    fallback: _fallbackIosName,
  );
}

String formatAndroidAuthorizationName({
  required String manufacturer,
  required String model,
  required String systemVersion,
}) {
  final cleanModel = _cleanPart(model);
  final cleanManufacturer = _cleanPart(manufacturer);
  final manufacturerIsUseful =
      cleanManufacturer.isNotEmpty &&
      cleanManufacturer.toLowerCase() != 'unknown' &&
      !cleanModel.toLowerCase().startsWith(cleanManufacturer.toLowerCase());
  final displayModel = _truncateUtf16(
    [
      if (manufacturerIsUseful) cleanManufacturer,
      if (cleanModel.isNotEmpty && cleanModel.toLowerCase() != 'unknown')
        cleanModel,
    ].join(' '),
    72,
  );
  return _authorizationName(
    model: displayModel,
    osName: 'Android',
    systemVersion: systemVersion,
    fallback: _fallbackAndroidName,
  );
}

String _authorizationName({
  required String model,
  required String osName,
  required String systemVersion,
  required String fallback,
}) {
  final parts = <String>['Relayune'];
  final cleanModel = _cleanPart(model);
  if (cleanModel.isNotEmpty) parts.add(cleanModel);
  final version = _majorMinorVersion(systemVersion);
  if (version.isNotEmpty) parts.add('$osName $version');
  return parts.length == 1 ? fallback : _truncateUtf16(parts.join(' · '), 110);
}

String _cleanPart(String value) => value
    .replaceAll(RegExp(r'[\u0000-\u001f\u007f]'), '')
    .replaceAll(RegExp(r'\s+'), ' ')
    .trim();

String _truncateUtf16(String value, int maxCodeUnits) {
  if (value.length <= maxCodeUnits) return value;
  var used = 0;
  final kept = <int>[];
  for (final rune in value.runes) {
    final width = rune > 0xffff ? 2 : 1;
    if (used + width > maxCodeUnits) break;
    kept.add(rune);
    used += width;
  }
  return String.fromCharCodes(kept).trimRight();
}

String _majorMinorVersion(String value) {
  final match = RegExp(r'^(\d+)(?:\.(\d+))?').firstMatch(value.trim());
  if (match == null) return '';
  final minor = match.group(2);
  return minor == null ? match.group(1)! : '${match.group(1)}.$minor';
}

String? _appleMarketingName(String machine) {
  const models = <String, String>{
    'iPhone10,1': 'iPhone 8',
    'iPhone10,4': 'iPhone 8',
    'iPhone10,2': 'iPhone 8 Plus',
    'iPhone10,5': 'iPhone 8 Plus',
    'iPhone10,3': 'iPhone X',
    'iPhone10,6': 'iPhone X',
    'iPhone11,2': 'iPhone XS',
    'iPhone11,4': 'iPhone XS Max',
    'iPhone11,6': 'iPhone XS Max',
    'iPhone11,8': 'iPhone XR',
    'iPhone12,1': 'iPhone 11',
    'iPhone12,3': 'iPhone 11 Pro',
    'iPhone12,5': 'iPhone 11 Pro Max',
    'iPhone12,8': 'iPhone SE (2nd generation)',
    'iPhone13,1': 'iPhone 12 mini',
    'iPhone13,2': 'iPhone 12',
    'iPhone13,3': 'iPhone 12 Pro',
    'iPhone13,4': 'iPhone 12 Pro Max',
    'iPhone14,2': 'iPhone 13 Pro',
    'iPhone14,3': 'iPhone 13 Pro Max',
    'iPhone14,4': 'iPhone 13 mini',
    'iPhone14,5': 'iPhone 13',
    'iPhone14,6': 'iPhone SE (3rd generation)',
    'iPhone14,7': 'iPhone 14',
    'iPhone14,8': 'iPhone 14 Plus',
    'iPhone15,2': 'iPhone 14 Pro',
    'iPhone15,3': 'iPhone 14 Pro Max',
    'iPhone15,4': 'iPhone 15',
    'iPhone15,5': 'iPhone 15 Plus',
    'iPhone16,1': 'iPhone 15 Pro',
    'iPhone16,2': 'iPhone 15 Pro Max',
    'iPhone17,1': 'iPhone 16 Pro',
    'iPhone17,2': 'iPhone 16 Pro Max',
    'iPhone17,3': 'iPhone 16',
    'iPhone17,4': 'iPhone 16 Plus',
    'iPhone17,5': 'iPhone 16e',
    'iPhone18,1': 'iPhone 17 Pro',
    'iPhone18,2': 'iPhone 17 Pro Max',
    'iPhone18,3': 'iPhone 17',
    'iPhone18,4': 'iPhone Air',
  };
  return models[machine.trim()];
}

/// Exact hardware code remains visible when a marketing name is unknown.
String iosDeviceModelLabel({
  required String machine,
  required String deviceClass,
}) {
  final name = _appleMarketingName(machine) ?? _cleanPart(deviceClass);
  final code = _cleanPart(machine);
  return code.isEmpty ? name : '$name ($code)';
}
