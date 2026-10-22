import 'package:flutter/material.dart';

import '../../l10n/relayune_localizations.dart';
import '../state/app_controller.dart';
import '../ui/theme.dart';

class StatusBanner extends StatelessWidget {
  const StatusBanner({
    super.key,
    required this.controller,
    this.showFileAccess = true,
    this.historySessionId,
  });

  final AppController controller;
  final bool showFileAccess;
  final String? historySessionId;

  @override
  Widget build(BuildContext context) {
    final historyError = historySessionId == null
        ? null
        : controller.historyErrorFor(historySessionId!);
    final showHistoryError = controller.error.isEmpty && historyError != null;
    final fileAccessLimited =
        showFileAccess &&
        controller.deviceOnline &&
        controller.catalogFileAccessLimited &&
        controller.error.isEmpty &&
        !showHistoryError;
    final isError =
        controller.error.isNotEmpty || showHistoryError || fileAccessLimited;
    final text = controller.error.isNotEmpty
        ? controller.error
        : showHistoryError
        ? historyError
        : fileAccessLimited
        ? context.l10n.controllerFileAccessDenied
        : controller.notice;
    if (text.isEmpty) return const SizedBox.shrink();
    return Semantics(
      liveRegion: true,
      child: Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsetsDirectional.fromSTEB(14, 11, 8, 11),
        decoration: BoxDecoration(
          color: isError
              ? RelayTheme.redBackground
              : RelayTheme.greenBackground,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: (isError ? RelayTheme.ember : RelayTheme.fern).withValues(
              alpha: .48,
            ),
          ),
        ),
        child: Row(
          children: [
            if (controller.sessionCreationInFlight && !isError)
              const SizedBox.square(
                dimension: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            else
              Icon(
                isError ? Icons.error_outline : Icons.check_circle_outline,
                size: 20,
                color: isError ? RelayTheme.ember : RelayTheme.fern,
              ),
            const SizedBox(width: 10),
            Expanded(child: Text(text)),
            if (showHistoryError)
              TextButton(
                key: const ValueKey('retry-history-banner'),
                style: TextButton.styleFrom(minimumSize: const Size(48, 44)),
                onPressed:
                    !controller.deviceOnline ||
                        controller.historyLoading.contains(historySessionId)
                    ? null
                    : () => controller.retryHistory(historySessionId!),
                child: Text(context.l10n.commonRetry),
              )
            else if (!fileAccessLimited && !controller.sessionCreationInFlight)
              IconButton(
                visualDensity: VisualDensity.compact,
                tooltip: context.l10n.commonClose,
                onPressed: controller.clearBanners,
                icon: const Icon(Icons.close, size: 18),
              ),
          ],
        ),
      ),
    );
  }
}
