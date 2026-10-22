import 'package:package_info_plus/package_info_plus.dart';

typedef AppVersionLoader = Future<String> Function();

Future<String> loadRelayuneVersion() async {
  final info = await PackageInfo.fromPlatform();
  final buildNumber = info.buildNumber.trim();
  return buildNumber.isEmpty ? info.version : '${info.version}+$buildNumber';
}
