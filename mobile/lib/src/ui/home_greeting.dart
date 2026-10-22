import 'package:flutter/material.dart';

import '../../l10n/relayune_localizations.dart';
import '../state/app_controller.dart';
import '../state/home_care.dart';
import '../widgets/foreground_periodic_timer.dart';
import 'theme.dart';
import '../widgets/visible_route_builder.dart';

class HomeGreeting extends StatefulWidget {
  const HomeGreeting({
    super.key,
    required this.controller,
    required this.activity,
    this.clock = DateTime.now,
  });

  final AppController controller;
  final HomeCareActivity activity;
  final DateTime Function() clock;

  @override
  State<HomeGreeting> createState() => _HomeGreetingState();
}

class _HomeGreetingState extends State<HomeGreeting>
    with WidgetsBindingObserver {
  late final ForegroundPeriodicTimer _timer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _timer = ForegroundPeriodicTimer(const Duration(minutes: 1), () {
      if (mounted && (ModalRoute.of(context)?.isCurrent ?? true)) {
        setState(() {});
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) setState(() {});
  }

  @override
  void dispose() {
    _timer.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => VisibleRouteBuilder(
    listenable: widget.controller,
    builder: (context) {
      final now = widget.clock();
      final locale = Localizations.localeOf(context);
      final needsScriptSpacing = const {
        'ar',
        'ur',
        'hi',
        'bn',
      }.contains(locale.languageCode);
      // Preserve natural ascenders/descenders in connected and stacked scripts
      // (especially Urdu Nastaliq) while keeping room between interior lines.
      final textHeightBehavior = needsScriptSpacing
          ? const TextHeightBehavior(
              applyHeightToFirstAscent: false,
              applyHeightToLastDescent: false,
            )
          : null;
      final controller = widget.controller;
      final sessions = controller.sessions.where((s) => !s.isSubagent);
      // Offline catalog state cannot establish that a task is still running.
      final running = controller.deviceOnline
          ? sessions.where((s) => s.status == 'active').toList()
          : const [];
      final message = homeCareMessage(
        now: now,
        l10n: context.l10n,
        activeStretch: widget.activity.stretchAt(now),
        activeToday: widget.activity.todayAt(now),
        returning: widget.activity.isReturningAt(now),
        hasSessions: sessions.isNotEmpty,
        running: running.isNotEmpty,
        longRunning: running.any((session) {
          final value = session.raw['running_started_at'];
          final start = value is String ? DateTime.tryParse(value) : null;
          return start != null &&
              now.difference(start) >= const Duration(minutes: 45);
        }),
        pendingApproval:
            controller.deviceOnline && controller.pendingApprovalCount > 0,
      );
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            message.title,
            key: const ValueKey('home-greeting'),
            textHeightBehavior: textHeightBehavior,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w800,
              letterSpacing: needsScriptSpacing ? 0 : -.55,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            message.detail,
            key: const ValueKey('home-care-message'),
            textHeightBehavior: textHeightBehavior,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: RelayTheme.mutedBright,
              fontSize: 14,
              letterSpacing: 0,
              height: needsScriptSpacing ? 1.65 : 1.5,
            ),
          ),
        ],
      );
    },
  );
}
