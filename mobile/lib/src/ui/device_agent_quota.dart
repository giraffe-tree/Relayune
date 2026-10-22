import 'package:flutter/material.dart';
import '../../l10n/relayune_localizations.dart';
import '../models.dart';
import '../widgets/foreground_periodic_timer.dart';
import 'theme.dart';

class DeviceAgentQuota extends StatefulWidget {
  const DeviceAgentQuota({
    super.key,
    required this.provider,
    required this.usage,
    required this.online,
  });
  final String provider;
  final ProviderUsageSnapshot? usage;
  final bool online;
  @override
  State<DeviceAgentQuota> createState() => _DeviceAgentQuotaState();
}

class _DeviceAgentQuotaState extends State<DeviceAgentQuota> {
  late final ForegroundPeriodicTimer _timer;
  @override
  void initState() {
    super.initState();
    _timer = ForegroundPeriodicTimer(
      const Duration(minutes: 1),
      () => setState(() {}),
    );
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final copy = context.l10n;
    final now = DateTime.now();
    return Wrap(
      alignment: WrapAlignment.end,
      spacing: 10,
      runSpacing: 8,
      children: [
        for (final id in ['five_hour', 'seven_day'])
          _window(context, id, now, copy),
      ],
    );
  }

  Widget _window(
    BuildContext context,
    String id,
    DateTime now,
    AppLocalizations copy,
  ) {
    final window = widget.usage?.quotaWindows
        .where((item) => item.id == id)
        .firstOrNull;
    final expired = window?.resetsAt != null && !window!.resetsAt!.isAfter(now);
    final stale =
        !widget.online ||
        window?.asOf == null ||
        now.difference(window!.asOf!) > const Duration(minutes: 15);
    final used = expired ? null : window?.usedPercent;
    final duration = id == 'five_hour' ? '5h' : '7d';
    final value = used == null ? '—' : copy.quotaUsed(used.round().toString());
    final hint = expired
        ? copy.quotaExpired
        : used == null
        ? copy.quotaPending
        : stale
        ? copy.quotaSnapshot
        : value;
    return Tooltip(
      message:
          '${id == 'five_hour' ? copy.quotaFiveHour : copy.quotaSevenDay} · $hint',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            '$duration $value',
            key: ValueKey('quota-${widget.provider}-$id'),
            style: TextStyle(
              fontSize: 12,
              color: used == null || stale
                  ? RelayTheme.muted
                  : used >= 90
                  ? const Color(0xFFE5A15D)
                  : const Color(0xFF8DCEAB),
            ),
          ),
          if (!expired && window?.resetsAt != null) ...[
            const SizedBox(height: 2),
            Text(
              copy.quotaResets(_resetTime(context, window!.resetsAt!)),
              textAlign: TextAlign.end,
              style: const TextStyle(fontSize: 10, color: RelayTheme.muted),
            ),
          ],
        ],
      ),
    );
  }

  String _resetTime(BuildContext context, DateTime reset) {
    final local = reset.toLocal();
    final material = MaterialLocalizations.of(context);
    final offset = local.timeZoneOffset;
    final minutes = offset.inMinutes.abs();
    final hoursLabel = (minutes ~/ 60).toString().padLeft(2, '0');
    final minutesLabel = (minutes % 60).toString().padLeft(2, '0');
    final zone = 'UTC${offset.isNegative ? '-' : '+'}$hoursLabel:$minutesLabel';
    return '${material.formatShortMonthDay(local)} ${material.formatTimeOfDay(TimeOfDay.fromDateTime(local), alwaysUse24HourFormat: true)} $zone';
  }
}
