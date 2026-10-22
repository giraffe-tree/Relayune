import 'dart:math' as math;
import 'dart:io';
import 'package:flutter/services.dart';

import 'package:flutter/material.dart';

import '../../l10n/relayune_localizations.dart';
import '../notifications/notification_coordinator.dart';
import '../state/app_controller.dart';

Future<void> showNotificationPermissionPrimer(
  BuildContext context,
  AppController controller,
) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (context) => _NotificationPermissionSheet(controller: controller),
  );
  await controller.dismissNotificationPrimer();
}

class _NotificationPermissionSheet extends StatefulWidget {
  const _NotificationPermissionSheet({required this.controller});

  final AppController controller;

  @override
  State<_NotificationPermissionSheet> createState() =>
      _NotificationPermissionSheetState();
}

class _NotificationPermissionSheetState
    extends State<_NotificationPermissionSheet> {
  static const _push = MethodChannel('cn.giraffetree.relayune/push');
  bool _pushConsented = !Platform.isAndroid;
  @override
  void initState() {
    super.initState();
    if (Platform.isAndroid) {
      _push
          .invokeMethod<bool>('consented')
          .then((value) {
            if (mounted) setState(() => _pushConsented = value == true);
          })
          .catchError((Object _) {});
    }
  }

  bool _busy = false;
  bool _requestRejected = false;

  AppController get controller => widget.controller;

  bool get _enabled =>
      controller.notificationAuthorization ==
      RelayNotificationAuthorization.enabled;

  bool get _openSettings =>
      !_enabled &&
      (controller.notificationPermissionRequested || _requestRejected);

  Future<void> _handlePrimaryAction() async {
    if (_busy) return;
    if (_enabled && _pushConsented) {
      Navigator.of(context).pop();
      return;
    }
    setState(() => _busy = true);
    try {
      if (Platform.isAndroid && !_pushConsented) {
        await _push.invokeMethod<void>('consent');
        _pushConsented = true;
      }
      if (_openSettings) {
        await controller.openNotificationSettings();
        if (mounted) Navigator.of(context).pop();
        return;
      }
      await controller.requestNotificationAuthorization();
      if (!mounted) return;
      if (_enabled) {
        Navigator.of(context).pop();
      } else {
        setState(() => _requestRejected = true);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final sheetHeight = math.min(
      MediaQuery.sizeOf(context).height * 0.9,
      620.0,
    );
    return Container(
      height: sheetHeight,
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: Column(
        children: [
          const SizedBox(height: 10),
          Container(
            width: 38,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(999),
            ),
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    _enabled
                        ? context.l10n.notificationEnabledTitle
                        : context.l10n.notificationPrimerTitle,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w900,
                      height: 1.12,
                    ),
                  ),
                  const SizedBox(height: 7),
                  Text(
                    _enabled
                        ? context.l10n.notificationEnabledBody
                        : context.l10n.notificationPrimerBody,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                      height: 1.35,
                    ),
                  ),
                  const SizedBox(height: 14),
                  const _RealNotificationPreview(),
                  const SizedBox(height: 10),
                  _BenefitLine(
                    icon: Icons.touch_app_outlined,
                    text: context.l10n.notificationBenefitAction,
                  ),
                  const SizedBox(height: 8),
                  _BenefitLine(
                    icon: Icons.subject_rounded,
                    text: context.l10n.notificationBenefitCompletion,
                  ),
                  const SizedBox(height: 9),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        Icons.lock_outline_rounded,
                        size: 15,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          context.l10n.notificationBenefitPrivacy,
                          style: TextStyle(fontSize: 12, height: 1.3),
                        ),
                      ),
                    ],
                  ),
                  if (Platform.isAndroid) ...[
                    const SizedBox(height: 10),
                    Text(
                      context.l10n.androidPushDisclosure,
                      style: const TextStyle(fontSize: 12, height: 1.35),
                    ),
                  ],
                  if (_requestRejected) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.errorContainer.withValues(
                          alpha: 0.55,
                        ),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        context.l10n.notificationPermissionRejected,
                        style: TextStyle(
                          color: theme.colorScheme.onErrorContainer,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                FilledButton.icon(
                  key: const ValueKey('notification-primer-primary'),
                  onPressed: _busy ? null : _handlePrimaryAction,
                  icon: _busy
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Icon(
                          _enabled
                              ? Icons.check_rounded
                              : _openSettings
                              ? Icons.settings_outlined
                              : Icons.notifications_active_outlined,
                        ),
                  label: Text(
                    _enabled && _pushConsented
                        ? context.l10n.notificationGotIt
                        : _openSettings
                        ? context.l10n.notificationOpenSettings
                        : context.l10n.notificationEnable,
                  ),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(50),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                  ),
                ),
                if (!_enabled)
                  SizedBox(
                    height: 36,
                    child: TextButton(
                      key: const ValueKey('notification-primer-later'),
                      onPressed: _busy
                          ? null
                          : () => Navigator.of(context).pop(),
                      child: Text(context.l10n.notificationNotNow),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _RealNotificationPreview extends StatelessWidget {
  const _RealNotificationPreview();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: context.l10n.notificationSemanticsExample,
      child: ExcludeSemantics(
        child: ClipRRect(
          borderRadius: BorderRadius.circular(20),
          child: SizedBox(
            height: 156,
            child: Image.asset(
              'assets/notifications/task-completion-ios.png',
              key: const ValueKey('notification-primer-real-image'),
              fit: BoxFit.fitWidth,
              alignment: Alignment.topCenter,
            ),
          ),
        ),
      ),
    );
  }
}

class _BenefitLine extends StatelessWidget {
  const _BenefitLine({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(13),
    ),
    child: Row(
      children: [
        Icon(icon, size: 18, color: Theme.of(context).colorScheme.primary),
        const SizedBox(width: 9),
        Expanded(
          child: Text(text, style: const TextStyle(fontSize: 13, height: 1.3)),
        ),
      ],
    ),
  );
}
