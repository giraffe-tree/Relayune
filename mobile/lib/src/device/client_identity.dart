import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/services.dart';

/// Used only to group independently authorized connections, never to log in.
String? deriveClientIdentity(String platform, String? source) {
  if (!['android', 'ios'].contains(platform) ||
      source == null ||
      source.trim().isEmpty) {
    return null;
  }
  final normalized = source.trim().toLowerCase();
  if (normalized == 'unknown' ||
      normalized == '9774d56d682e549c' ||
      normalized.replaceAll(RegExp(r'[-0]'), '').isEmpty) {
    return null;
  }
  final digest = sha256.convert(
    utf8.encode('relayune:$platform:v1:$normalized'),
  );
  return '$platform:$digest';
}

Future<String?> mobileClientIdentity() async {
  try {
    if (Platform.isIOS) {
      return deriveClientIdentity(
        'ios',
        (await DeviceInfoPlugin().iosInfo).identifierForVendor,
      );
    }
    if (Platform.isAndroid) {
      const channel = MethodChannel('cn.giraffetree.relayune/client_identity');
      return deriveClientIdentity(
        'android',
        await channel.invokeMethod<String>('androidId'),
      );
    }
  } on Object {
    // No common fallback ID: unavailable identifiers must not merge devices.
  }
  return null;
}
