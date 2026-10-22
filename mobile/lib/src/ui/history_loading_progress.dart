import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../l10n/relayune_localizations.dart';
import '../state/history_load_progress.dart';
import '../widgets/foreground_periodic_timer.dart';
import '../widgets/history_text_light.dart';
import 'theme.dart';

/// Shows only observed request stages; timing never advances the stage itself.
class HistoryLoadingProgress extends StatefulWidget {
  const HistoryLoadingProgress({
    super.key,
    required this.progress,
    required this.compact,
  });

  final HistoryLoadProgress? progress;
  final bool compact;

  @override
  State<HistoryLoadingProgress> createState() => _HistoryLoadingProgressState();
}

class _HistoryLoadingProgressState extends State<HistoryLoadingProgress>
    with WidgetsBindingObserver {
  ForegroundPeriodicTimer? _timer;
  bool _visible = true;
  bool _foreground = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    _foreground = lifecycle == null || lifecycle == AppLifecycleState.resumed;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _visible = TickerMode.of(context);
    _syncTimer();
  }

  @override
  void didUpdateWidget(HistoryLoadingProgress oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncTimer();
  }

  void _syncTimer() {
    if (widget.progress == null || !_visible || !_foreground) {
      _timer?.cancel();
      _timer = null;
    } else {
      _timer ??= ForegroundPeriodicTimer(const Duration(seconds: 1), () {
        if (mounted) setState(() {});
      });
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _syncTimer();
    if (_foreground && mounted) setState(() {});
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final copy = context.l10n;
    final progress = widget.progress;
    final title = widget.compact
        ? copy.workbenchHistoryLoadingOlder
        : copy.workbenchHistoryLoading;
    final stage = progress == null
        ? null
        : switch (progress.phase) {
            HistoryLoadPhase.sending => copy.workbenchHistoryRequestSending,
            HistoryLoadPhase.waiting => copy.workbenchHistoryWaitingComputer,
            HistoryLoadPhase.restoring => copy.workbenchHistoryReadingCache,
            HistoryLoadPhase.reading => copy.workbenchHistoryReadingComputer,
            HistoryLoadPhase.transferring => copy.workbenchHistoryTransferring,
            HistoryLoadPhase.preparing => copy.workbenchHistoryPreparing,
          };
    final visual = HistoryTextLight(
      compact: widget.compact,
      phase: progress?.phase,
    );
    final elapsed = progress == null
        ? null
        : copy.workbenchHistoryElapsed(progress.elapsed.inSeconds);
    final data = <String>[
      if (progress?.sourceReadBytes != null &&
          (progress?.sourceTotalBytes ?? 0) > 0)
        copy.workbenchHistorySourceRead(
          _bytes(progress!.sourceReadBytes!, copy.localeName),
          _bytes(progress.sourceTotalBytes!, copy.localeName),
        ),
      if (progress?.receivedBytes != null)
        copy.workbenchHistoryReceived(
          _bytes(progress!.receivedBytes!, copy.localeName),
        ),
      if (progress?.pendingReceiveBytes != null)
        copy.workbenchHistoryPendingReceive(
          _bytes(progress!.pendingReceiveBytes!, copy.localeName),
        )
      else if (progress?.receivedBytes == null &&
          progress?.transferBytes != null)
        copy.workbenchHistoryPendingTransfer(
          _bytes(progress!.transferBytes!, copy.localeName),
        ),
    ];
    // Older-page loading remains two lines even with large fonts. Prefer the
    // active transfer measurement there; the first-page layout can show both.
    final compactData = data.isEmpty ? null : data.last;

    Widget heading() => Semantics(
      key: const ValueKey('history-loading-status'),
      container: true,
      liveRegion: true,
      label: stage == null ? title : '$title · $stage',
      child: ExcludeSemantics(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (!widget.compact || stage == null)
              Text(
                title,
                textAlign: TextAlign.center,
                maxLines: widget.compact ? 1 : null,
                overflow: widget.compact ? TextOverflow.ellipsis : null,
                style: widget.compact
                    ? const TextStyle(
                        color: RelayTheme.mutedBright,
                        fontSize: 12,
                        height: 1.2,
                      )
                    : Theme.of(context).textTheme.titleMedium?.copyWith(
                        color: RelayTheme.text,
                        fontWeight: FontWeight.w600,
                      ),
              ),
            if (stage != null) ...[
              if (!widget.compact) const SizedBox(height: 7),
              Text(
                stage,
                key: const ValueKey('history-loading-stage'),
                textAlign: TextAlign.center,
                maxLines: widget.compact ? 1 : null,
                overflow: widget.compact ? TextOverflow.ellipsis : null,
                style: TextStyle(
                  color: RelayTheme.mutedBright,
                  fontSize: 12,
                  height: widget.compact ? 1.1 : 1.2,
                ),
              ),
            ],
          ],
        ),
      ),
    );

    Widget timing() => widget.compact
        ? Text(
            [elapsed, compactData].whereType<String>().join(' · '),
            key: const ValueKey('history-loading-timing'),
            textAlign: TextAlign.center,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: RelayTheme.muted,
              fontSize: 11,
              height: 1.1,
            ),
          )
        : Wrap(
            key: const ValueKey('history-loading-timing'),
            alignment: WrapAlignment.center,
            spacing: 8,
            runSpacing: 2,
            children: [
              Text(elapsed!, style: _timingStyle),
              for (final label in data) Text(label, style: _timingStyle),
            ],
          );

    return widget.compact
        ? Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              visual,
              const SizedBox(width: 10),
              Flexible(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    heading(),
                    if (progress != null) ...[
                      const SizedBox(height: 1),
                      timing(),
                    ],
                  ],
                ),
              ),
            ],
          )
        : Padding(
            padding: const EdgeInsets.symmetric(horizontal: 18),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                visual,
                SizedBox(height: progress == null ? 22 : 14),
                heading(),
                if (progress != null) ...[const SizedBox(height: 5), timing()],
                const SizedBox(height: 7),
                Text(
                  copy.workbenchHistoryLimit,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: RelayTheme.muted,
                    fontSize: 12,
                    height: 1.5,
                  ),
                ),
              ],
            ),
          );
  }

  static const _timingStyle = TextStyle(
    color: RelayTheme.muted,
    fontSize: 11,
    height: 1.3,
  );

  static String _bytes(int bytes, String locale) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var value = bytes.toDouble(), unit = 0;
    while (value >= 1000 && unit < units.length - 1) {
      value /= 1000;
      unit++;
    }
    final format = NumberFormat.decimalPattern(locale)
      ..maximumFractionDigits = unit == 0 ? 0 : 1;
    return '${format.format(value)} ${units[unit]}';
  }
}
