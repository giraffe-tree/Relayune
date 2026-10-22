import 'package:flutter/material.dart';

import '../state/device_connection.dart';
import 'device_connection_icon.dart';

class DeviceConnectionButton extends StatelessWidget {
  const DeviceConnectionButton({
    super.key,
    this.iconKey,
    required this.online,
    required this.transport,
    required this.statusLabel,
    required this.onPressed,
  });

  final Key? iconKey;
  final bool online;
  final RealtimeTransportState transport;
  final String statusLabel;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: statusLabel,
      onPressed: onPressed,
      icon: DeviceConnectionIcon(
        key: iconKey,
        online: online,
        transport: transport,
        semanticLabel: statusLabel,
        size: 24,
      ),
      style: IconButton.styleFrom(
        fixedSize: const Size.square(44),
        padding: const EdgeInsets.all(10),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    );
  }
}
