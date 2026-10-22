import 'dart:async';

import 'package:flutter/material.dart';

import '../state/app_controller.dart';
import '../state/computer_connections.dart';
import 'pairing_screen.dart';

/// Open scanning while account preparation runs in the background. Existing
/// computers stay connected throughout this independent authorization.
Future<void> showAddComputer({
  required NavigatorState navigator,
  required ComputerConnections connections,
}) async {
  final controller = await connections.beginAdding(initialize: false);
  if (!navigator.mounted) {
    await connections.finishAdding(controller);
    return;
  }
  late final MaterialPageRoute<void> route;
  var closing = false;
  void changed() {
    if (controller.phase != AppPhase.ready || closing) return;
    closing = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (navigator.mounted && route.isCurrent) navigator.pop();
    });
  }

  controller.addListener(changed);
  final preparation = controller.initialize();
  route = MaterialPageRoute<void>(
    builder: (_) => AnimatedBuilder(
      animation: controller,
      builder: (context, _) => PopScope(
        canPop:
            controller.pairingPhase == PairingPhase.idle ||
            controller.phase == AppPhase.ready,
        child: PairingScreen(
          controller: controller,
          addingComputer: true,
          connections: connections,
          preparation: preparation,
          startWithScanner: true,
        ),
      ),
    ),
  );
  try {
    final closed = navigator.push<void>(route);
    await closed;
  } finally {
    controller.removeListener(changed);
    await connections.finishAdding(controller);
  }
}
