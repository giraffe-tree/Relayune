class RelayConfig {
  static const officialOrigin = 'https://relayune.giraffetree.cn';
  // A build may select a different default, without gaining official identity.
  static const productionOrigin = String.fromEnvironment(
    'RELAYUNE_ORIGIN',
    defaultValue: officialOrigin,
  );

  // Selected only after explicit instance confirmation; never used as a TLS bypass.
  static String activeOrigin = Uri.parse(productionOrigin).origin;
  static String? activeCertificatePem;
  static bool get usesOfficialService => activeOrigin == officialOrigin;

  static const requestTimeout = Duration(seconds: 15);
  static const pairingPollInterval = Duration(milliseconds: 500);
  static const realtimeReconnectBase = Duration(milliseconds: 500);
  static const realtimeReconnectMax = Duration(seconds: 30);
  static const minimumCompatibleDesktopVersion = '0.3.9';
}
