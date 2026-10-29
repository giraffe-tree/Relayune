import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../config.dart';
import '../../l10n/relayune_localizations.dart';
import '../pairing/pairing_qr.dart';
import '../state/app_controller.dart';
import '../version_info.dart';
import '../widgets/brand_mark.dart';
import '../widgets/status_banner.dart';
import 'pairing_scanner_screen.dart';
import 'theme.dart';
import '../state/computer_connections.dart';
import 'computer_picker.dart';

class PairingScreen extends StatefulWidget {
  const PairingScreen({
    super.key,
    required this.controller,
    this.loadVersion,
    this.addingComputer = false,
    this.connections,
    this.preparation,
    this.startWithScanner = false,
  });

  final AppController controller;
  final AppVersionLoader? loadVersion;
  final bool addingComputer;
  final ComputerConnections? connections;
  final Future<void>? preparation;
  final bool startWithScanner;

  @override
  State<PairingScreen> createState() => _PairingScreenState();
}

class _PairingScreenState extends State<PairingScreen> {
  final _code = TextEditingController();
  bool _busy = false;
  bool _showManual = false;
  late Future<String> _version;

  @override
  void initState() {
    super.initState();
    _version = (widget.loadVersion ?? loadRelayuneVersion)();
    if (widget.startWithScanner) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && (ModalRoute.isCurrentOf(context) ?? false)) {
          _scanAndPair();
        }
      });
    }
  }

  @override
  void didUpdateWidget(PairingScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.loadVersion != widget.loadVersion) {
      _version = (widget.loadVersion ?? loadRelayuneVersion)();
    }
  }

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final pairing = controller.pairingPhase != PairingPhase.idle;
    return Scaffold(
      appBar: AppBar(
        title: const BrandMark(size: 32, withName: true),
        actions: [
          if (!widget.addingComputer)
            TextButton(
              onPressed: pairing ? null : controller.logout,
              child: Text(context.l10n.pairingExit),
            ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 500),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    context.l10n.pairingTitle,
                    style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                      letterSpacing: -1,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    context.l10n.pairingSubtitle,
                    style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      color: RelayTheme.mutedBright,
                      height: 1.45,
                    ),
                  ),
                  const SizedBox(height: 24),
                  if (!_showManual) StatusBanner(controller: controller),
                  if (widget.connections case final connections?) ...[
                    ComputerColorPicker(
                      value: connections.colorOf(controller),
                      onChanged: (color) async {
                        await connections.setColor(controller, color);
                        if (mounted) setState(() {});
                      },
                    ),
                    const SizedBox(height: 16),
                  ],
                  if (controller.phase == AppPhase.unavailable)
                    TextButton(
                      onPressed: controller.initialize,
                      child: Text(context.l10n.commonRetry),
                    ),
                  SvgPicture.asset(
                    'assets/pairing/scan-desktop.svg',
                    key: const ValueKey('pairing-scan-guide'),
                    height: MediaQuery.sizeOf(context).height < 700 ? 140 : 190,
                    excludeFromSemantics: true,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    context.l10n.pairingScanTitle,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    context.l10n.pairingScanHelp,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: RelayTheme.mutedBright,
                      height: 1.6,
                    ),
                  ),
                  const SizedBox(height: 24),
                  FilledButton.icon(
                    key: const ValueKey('scan-pairing-qr'),
                    onPressed: _busy || pairing ? null : _scanAndPair,
                    icon: const Icon(Icons.qr_code_scanner),
                    label: Text(context.l10n.pairingOpenCamera),
                  ),
                  if (pairing && !_showManual) _pairingProgress(),
                  const SizedBox(height: 8),
                  TextButton.icon(
                    key: const ValueKey('toggle-manual-pairing'),
                    onPressed: _busy || pairing
                        ? null
                        : () {
                            FocusScope.of(context).unfocus();
                            setState(() => _showManual = !_showManual);
                          },
                    icon: Icon(
                      _showManual ? Icons.expand_less : Icons.keyboard_outlined,
                      size: 18,
                    ),
                    label: Text(context.l10n.pairingEnterCodeTitle),
                  ),
                  if (_showManual)
                    Card(
                      key: const ValueKey('manual-pairing'),
                      child: Padding(
                        padding: const EdgeInsets.all(20),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Row(
                              children: [
                                const Icon(Icons.keyboard_outlined),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Text(
                                    context.l10n.pairingCodeLabel,
                                    style: const TextStyle(
                                      fontSize: 18,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text(
                              context.l10n.pairingEnterCodeHelp,
                              style: TextStyle(
                                color: RelayTheme.mutedBright,
                                height: 1.45,
                              ),
                            ),
                            const SizedBox(height: 16),
                            if (controller.discoveringPendingPairings) ...[
                              const LinearProgressIndicator(minHeight: 3),
                              const SizedBox(height: 12),
                              Text(
                                context.l10n.pairingSearching,
                                textAlign: TextAlign.center,
                                style: TextStyle(color: RelayTheme.mutedBright),
                              ),
                              const SizedBox(height: 12),
                            ] else if (controller
                                    .pendingBrowserPairings
                                    .length >
                                1) ...[
                              DropdownButtonFormField<String>(
                                key: const ValueKey('pending-pairing-device'),
                                value: controller.pendingPairingId,
                                decoration: InputDecoration(
                                  labelText: context.l10n.pairingComputerLabel,
                                  prefixIcon: const Icon(
                                    Icons.computer_outlined,
                                  ),
                                ),
                                items: controller.pendingBrowserPairings
                                    .map(
                                      (item) => DropdownMenuItem(
                                        value: item.pairingId,
                                        child: Text(item.deviceName),
                                      ),
                                    )
                                    .toList(growable: false),
                                onChanged: pairing
                                    ? null
                                    : controller.selectPendingBrowserPairing,
                              ),
                              const SizedBox(height: 14),
                            ] else if (controller
                                    .pendingBrowserPairings
                                    .length ==
                                1) ...[
                              Text(
                                context.l10n.pairingWillConnect(
                                  controller
                                      .pendingBrowserPairings
                                      .single
                                      .deviceName,
                                ),
                                textAlign: TextAlign.center,
                                style: const TextStyle(
                                  color: RelayTheme.mutedBright,
                                ),
                              ),
                              const SizedBox(height: 14),
                            ] else ...[
                              Text(
                                context.l10n.pairingStartOnDesktop,
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  color: RelayTheme.mutedBright,
                                  height: 1.45,
                                ),
                              ),
                              const SizedBox(height: 10),
                              TextButton.icon(
                                key: const ValueKey('refresh-pending-pairings'),
                                onPressed: pairing
                                    ? null
                                    : controller.discoverPendingBrowserPairings,
                                icon: const Icon(Icons.refresh),
                                label: Text(context.l10n.pairingSearchAgain),
                              ),
                              const SizedBox(height: 4),
                            ],
                            TextField(
                              key: const ValueKey('manual-pairing-code'),
                              controller: _code,
                              enabled: !pairing,
                              textCapitalization: TextCapitalization.characters,
                              keyboardType: TextInputType.visiblePassword,
                              textDirection: TextDirection.ltr,
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                fontSize: 24,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 4,
                                fontFamily: 'monospace',
                              ),
                              inputFormatters: [
                                FilteringTextInputFormatter.allow(
                                  RegExp(r'[A-Za-z2-9-]'),
                                ),
                                LengthLimitingTextInputFormatter(9),
                              ],
                              decoration: InputDecoration(
                                labelText: context.l10n.pairingCodeLabel,
                                hintText: 'ABCD-EFGH',
                                counterText: '',
                              ),
                              onSubmitted: (_) => _pair(),
                            ),
                            if (pairing) _pairingProgress(),
                            const SizedBox(height: 14),
                            StatusBanner(controller: controller),
                            FilledButton.icon(
                              onPressed: !pairing && !_busy ? _pair : null,
                              icon: const Icon(Icons.lock_outline),
                              label: Text(context.l10n.pairingSecureConnect),
                            ),
                          ],
                        ),
                      ),
                    ),
                  const SizedBox(height: 18),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.lock_outline, size: 16),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          context.l10n.pairingPrivacyNote,
                          style: const TextStyle(
                            height: 1.45,
                            color: RelayTheme.muted,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  FutureBuilder<String>(
                    future: _version,
                    builder: (context, snapshot) => Text(
                      key: const ValueKey('pairing-app-version'),
                      'Relayune Mobile '
                      '${snapshot.data ?? (snapshot.hasError ? '—' : '…')} '
                      '· ${context.l10n.pairingMinimumDesktop(RelayConfig.minimumCompatibleDesktopVersion)}',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 12,
                        color: RelayTheme.muted,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _pairingProgress() => Padding(
    padding: const EdgeInsets.only(top: 14),
    child: Column(
      children: [
        const LinearProgressIndicator(minHeight: 3),
        const SizedBox(height: 10),
        Semantics(
          liveRegion: true,
          child: Text(
            '${_phaseLabel(widget.controller.pairingPhase)}\n${_phaseDetail(widget.controller.pairingPhase)}',
            textAlign: TextAlign.center,
            style: const TextStyle(color: RelayTheme.mutedBright, height: 1.5),
          ),
        ),
      ],
    ),
  );

  Future<void> _scanAndPair() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final pairing = await Navigator.of(context).push<PairingQrData>(
        MaterialPageRoute(
          builder: (_) => PairingScannerScreen(
            initialColor: widget.connections?.colorOf(widget.controller),
            onColorChanged: widget.connections == null
                ? null
                : (color) {
                    widget.connections!.setColor(widget.controller, color);
                  },
          ),
        ),
      );
      if (!mounted) return;
      if (pairing == null) {
        setState(() => _showManual = true);
        return;
      }
      await widget.preparation;
      if (!mounted) return;
      widget.controller.setScannedPairing(pairing);
      await widget.controller.pair(pairing.code);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pair() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await widget.preparation;
      if (!mounted) return;
      await widget.controller.pair(_code.text);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _phaseLabel(PairingPhase phase) => switch (phase) {
    PairingPhase.deriving => context.l10n.pairingDeriving,
    PairingPhase.waitingForDesktop => context.l10n.pairingWaitingDesktop,
    PairingPhase.activating => context.l10n.pairingActivating,
    PairingPhase.idle => context.l10n.pairingSecureConnect,
  };

  String _phaseDetail(PairingPhase phase) => switch (phase) {
    PairingPhase.deriving => context.l10n.pairingDerivingDetail,
    PairingPhase.waitingForDesktop => context.l10n.pairingWaitingDesktopDetail,
    PairingPhase.activating => context.l10n.pairingActivatingDetail,
    PairingPhase.idle => '',
  };
}
