import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';

import '../version_info.dart';
import '../device/authorization_name.dart';

/// Only these visible fields are attached; never serialize the plugin's data map.
class FeedbackInfo {
  const FeedbackInfo({this.appVersion, this.model, this.system});

  final String? appVersion;
  final String? model;
  final String? system;
}

Future<FeedbackInfo> loadFeedbackInfo() async {
  String? appVersion;
  String? model;
  String? system;
  try {
    appVersion = await loadRelayuneVersion();
  } catch (_) {
    // An unavailable field must not prevent feedback.
  }
  try {
    final plugin = DeviceInfoPlugin();
    if (Platform.isIOS) {
      final info = await plugin.iosInfo;
      model = iosDeviceModelLabel(
        machine: info.utsname.machine,
        deviceClass: info.model,
      );
      system = '${info.systemName} ${info.systemVersion}';
    } else if (Platform.isAndroid) {
      final info = await plugin.androidInfo;
      model = '${info.manufacturer} ${info.model}';
      system = 'Android ${info.version.release} (API ${info.version.sdkInt})';
    }
  } catch (_) {
    // Exclude identifiers, personal device names and raw plugin errors.
  }
  return FeedbackInfo(appVersion: appVersion, model: model, system: system);
}
