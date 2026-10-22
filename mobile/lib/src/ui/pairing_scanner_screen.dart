import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../l10n/relayune_localizations.dart';
import '../pairing/pairing_qr.dart';
import 'computer_picker.dart';

class PairingScannerScreen extends StatefulWidget {
  const PairingScannerScreen({
    super.key,
    this.initialColor,
    this.onColorChanged,
  });
  final int? initialColor;
  final ValueChanged<int>? onColorChanged;

  @override
  State<PairingScannerScreen> createState() => _PairingScannerScreenState();
}

@visibleForTesting
bool scannerMustStopForLifecycle(
  AppLifecycleState state, {
  required bool hasCameraPermission,
}) => switch (state) {
  // The OS permission sheet temporarily makes the app inactive before the
  // first permission result exists. Do not cover a denial error with a resume
  // overlay whose action cannot run without permission.
  AppLifecycleState.inactive => hasCameraPermission,
  AppLifecycleState.paused ||
  AppLifecycleState.hidden ||
  AppLifecycleState.detached => true,
  AppLifecycleState.resumed => false,
};

class _PairingScannerScreenState extends State<PairingScannerScreen>
    with WidgetsBindingObserver {
  late final MobileScannerController _scannerController;
  StreamSubscription<BarcodeCapture>? _barcodeSubscription;
  bool _accepted = false;
  late int? _color = widget.initialColor;
  bool _invalidCodeSeen = false;
  bool _requiresExplicitResume = false;
  bool _scanningRequested = true;
  Future<void> _cameraTransition = Future<void>.value();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _scannerController = MobileScannerController(
      autoStart: false,
      formats: const [BarcodeFormat.qrCode],
    );
    _scheduleCameraTransition(_listenAndStart);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Never restart the camera or re-request permission merely because the app
    // returned from the background. The user explicitly resumes scanning.
    if (!scannerMustStopForLifecycle(
      state,
      hasCameraPermission: _scannerController.value.hasCameraPermission,
    )) {
      return;
    }
    _scanningRequested = false;
    _scheduleCameraTransition(_stopScanning);
    if (mounted) setState(() => _requiresExplicitResume = true);
  }

  void _scheduleCameraTransition(Future<void> Function() transition) {
    _cameraTransition = _cameraTransition
        .catchError((Object _) {})
        .then((_) => transition())
        .catchError((Object _) {});
  }

  Future<void> _listenAndStart() async {
    _barcodeSubscription ??= _scannerController.barcodes.listen(_onDetect);
    await _scannerController.start();
    // Permission prompts and native camera startup can finish after the app
    // has already moved to the background. Re-check the requested state after
    // the asynchronous start so a late completion cannot leave the camera on.
    if (!_scanningRequested ||
        !mounted ||
        WidgetsBinding.instance.lifecycleState != AppLifecycleState.resumed) {
      await _scannerController.stop();
    }
  }

  Future<void> _stopScanning() async {
    await _barcodeSubscription?.cancel();
    _barcodeSubscription = null;
    await _scannerController.stop();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _scanningRequested = false;
    _scheduleCameraTransition(() async {
      await _stopScanning();
      await _scannerController.dispose();
    });
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: Colors.black,
    appBar: AppBar(
      backgroundColor: Colors.black,
      foregroundColor: Colors.white,
      title: Text(context.l10n.scannerTitle),
    ),
    body: Stack(
      fit: StackFit.expand,
      children: [
        MobileScanner(
          controller: _scannerController,
          errorBuilder: (context, _) => PairingCameraUnavailable(
            onClose: () => Navigator.of(context).pop(),
          ),
        ),
        const _ScanFrame(),
        if (_requiresExplicitResume)
          ColoredBox(
            color: Colors.black.withValues(alpha: 0.86),
            child: Center(
              child: FilledButton.icon(
                key: const ValueKey('resume-pairing-scanner'),
                onPressed: _resumeScanning,
                icon: const Icon(Icons.qr_code_scanner),
                label: Text(context.l10n.scannerResume),
              ),
            ),
          ),
        Align(
          alignment: Alignment.bottomCenter,
          child: SafeArea(
            minimum: const EdgeInsets.all(24),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.72),
                borderRadius: BorderRadius.circular(18),
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 18,
                  vertical: 14,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _invalidCodeSeen
                          ? context.l10n.scannerInvalid
                          : context.l10n.scannerHelp,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white, height: 1.4),
                    ),
                    if (_color != null) ...[
                      const SizedBox(height: 16),
                      ComputerColorPicker(
                        value: _color!,
                        onChanged: (color) {
                          setState(() => _color = color);
                          widget.onColorChanged?.call(color);
                        },
                      ),
                    ],
                    TextButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: Text(
                        computerText(context, '手动输入连接码', 'Enter code manually'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    ),
  );

  void _onDetect(BarcodeCapture capture) {
    if (_accepted) return;
    for (final barcode in capture.barcodes) {
      final rawValue = barcode.rawValue;
      if (barcode.format != BarcodeFormat.qrCode || rawValue == null) continue;
      final pairing = PairingQrData.tryParse(rawValue);
      if (pairing != null) {
        _accepted = true;
        _scanningRequested = false;
        _scheduleCameraTransition(_stopScanning);
        Navigator.of(context).pop(pairing);
        return;
      }
    }
    if (!_invalidCodeSeen && mounted) {
      setState(() => _invalidCodeSeen = true);
    }
  }

  void _resumeScanning() {
    if (!_scannerController.value.hasCameraPermission) return;
    _scanningRequested = true;
    setState(() => _requiresExplicitResume = false);
    _scheduleCameraTransition(_listenAndStart);
  }
}

class _ScanFrame extends StatelessWidget {
  const _ScanFrame();

  @override
  Widget build(BuildContext context) => Center(
    child: IgnorePointer(
      child: Container(
        width: 272,
        height: 272,
        decoration: BoxDecoration(
          border: Border.all(color: const Color(0xFF9BE6C9), width: 3),
          borderRadius: BorderRadius.circular(28),
        ),
      ),
    ),
  );
}

class PairingCameraUnavailable extends StatelessWidget {
  const PairingCameraUnavailable({super.key, required this.onClose});

  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: Colors.black,
    child: Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.no_photography_outlined,
              color: Colors.white,
              size: 46,
            ),
            const SizedBox(height: 16),
            Text(
              context.l10n.scannerUnavailable,
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white, height: 1.5),
            ),
            const SizedBox(height: 18),
            OutlinedButton(
              onPressed: onClose,
              child: Text(context.l10n.commonBack),
            ),
          ],
        ),
      ),
    ),
  );
}
