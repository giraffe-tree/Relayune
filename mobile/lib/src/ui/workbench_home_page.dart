import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../widgets/drawer_swipe_region.dart';
import '../models.dart';
import '../state/computer_connections.dart';
import 'computer_picker.dart';
import '../state/app_controller.dart';
import '../state/home_care.dart';
import '../state/home_sessions.dart';
import '../state/startup_performance.dart';
import '../state/session_projects.dart';
import '../widgets/brand_mark.dart';
import '../widgets/status_banner.dart';
import '../widgets/device_connection_button.dart';
import '../widgets/running_status_icon.dart';
import 'theme.dart';
import 'home_greeting.dart';
import 'notification_permission_sheet.dart';
import '../../l10n/relayune_localizations.dart';

class RelayuneHomePage extends StatelessWidget {
  const RelayuneHomePage({
    super.key,
    required this.controller,
    required this.onOpenSession,
    required this.onOpenConnectionInfo,
    required this.navigationDrawer,
    required this.careActivity,
    this.scaffoldKey,
    this.connections,
    this.selectedComputer,
    this.onSelectComputer,
    this.onOpenComputerSession,
  });

  final GlobalKey<ScaffoldState>? scaffoldKey;
  final AppController controller;
  final ValueChanged<String> onOpenSession;
  final VoidCallback onOpenConnectionInfo;
  final Widget navigationDrawer;
  final HomeCareActivity careActivity;
  final ComputerConnections? connections;
  final AppController? selectedComputer;
  final ValueChanged<AppController?>? onSelectComputer;
  final void Function(AppController, String)? onOpenComputerSession;

  @override
  Widget build(BuildContext context) {
    final copy = _HomeCopy.of(context);
    final overview = HomeSessions(
      sessions: controller.sessions,
      approvals: controller.approvals,
      online: controller.deviceOnline,
      isPending: controller.approvalIsPending,
      isUnread: controller.sessionHasUnopenedCompletion,
    );
    final usage = _UsageSnapshot.fromProviderUsage(controller.usageByProvider);
    if (overview.recent.isNotEmpty) {
      StartupPerformance.frame('recent_list');
    }

    return Scaffold(
      key: scaffoldKey ?? const ValueKey('relayune-home'),
      drawer: navigationDrawer,
      drawerEnableOpenDragGesture: true,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        toolbarHeight: 64,
        leadingWidth: 54,
        leading: Builder(
          builder: (context) => IconButton(
            key: const ValueKey('home-navigation-button'),
            tooltip: copy.projectsAndSessions,
            onPressed: () => Scaffold.of(context).openDrawer(),
            icon: const Icon(Icons.menu_rounded),
          ),
        ),
        titleSpacing: 0,
        title: FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.noScaling),
            child: const BrandMark(size: 34, withName: true),
          ),
        ),
        actions: [
          DeviceConnectionButton(
            key: const ValueKey('home-online-status'),
            iconKey: const ValueKey('home-device-status-svg'),
            online: controller.deviceOnline,
            transport: controller.connectionSnapshot.transport,
            statusLabel: controller.deviceStatusLabel,
            onPressed: onOpenConnectionInfo,
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: DrawerSwipeRegion(
        child: SafeArea(
          top: false,
          child: CustomScrollView(
            key: const ValueKey('home-scroll-view'),
            slivers: [
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 22, 16, 28),
                sliver: SliverList.list(
                  children: [
                    if (controller.catalogFileAccessLimited ||
                        controller.sessionCreationInFlight ||
                        controller.error.isNotEmpty ||
                        controller.notice.isNotEmpty)
                      StatusBanner(controller: controller),
                    HomeGreeting(
                      controller: controller,
                      activity: careActivity,
                    ),
                    const SizedBox(height: 24),
                    Wrap(
                      alignment: WrapAlignment.spaceBetween,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 8,
                      children: [
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Flexible(
                              child: _SectionHeading(
                                title: copy.recentSessions,
                              ),
                            ),
                            if (connections != null && onSelectComputer != null)
                              ComputerPicker(
                                connections: connections!,
                                selected: controller,
                                compact: true,
                                onChanged: onSelectComputer!,
                              ),
                            if (controller.homeRefreshing &&
                                overview.recent.isNotEmpty &&
                                (connections?.computers.length ?? 1) < 2)
                              const SizedBox.square(
                                dimension: 16,
                                child: CircularProgressIndicator(
                                  key: ValueKey('home-refresh-progress'),
                                  strokeWidth: 2,
                                ),
                              ),
                          ],
                        ),
                        _MarkAllReadButton(
                          hasUnread: overview.unreadIds.isNotEmpty,
                          onPressed: controller.markAllSessionsOpened,
                          copy: copy,
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    _RecentSessionsCard(
                      overview: overview,
                      controller: controller,
                      copy: copy,
                      onOpen: onOpenSession,
                    ),

                    if (controller.shouldShowNotificationPrimer &&
                        overview.unreadIds.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      TextButton.icon(
                        key: const ValueKey('home-notification-invitation'),
                        onPressed: () => showNotificationPermissionPrimer(
                          context,
                          controller,
                        ),
                        icon: const Icon(Icons.notifications_none_rounded),
                        label: Text(context.l10n.notificationPrimerTitle),
                      ),
                    ],
                    const SizedBox(height: 24),
                    _TokenUsageCard(snapshot: usage, copy: copy),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MarkAllReadButton extends StatelessWidget {
  const _MarkAllReadButton({
    required this.hasUnread,
    required this.onPressed,
    required this.copy,
  });

  final bool hasUnread;
  final VoidCallback onPressed;
  final _HomeCopy copy;

  @override
  Widget build(BuildContext context) => TextButton(
    key: const ValueKey('home-mark-all-read'),
    onPressed: hasUnread ? onPressed : null,
    child: AnimatedSwitcher(
      duration: MediaQuery.disableAnimationsOf(context)
          ? Duration.zero
          : const Duration(milliseconds: 350),
      transitionBuilder: (child, animation) => FadeTransition(
        opacity: animation,
        child: ScaleTransition(scale: animation, child: child),
      ),
      child: Row(
        key: ValueKey(hasUnread),
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            hasUnread ? Icons.done_all_rounded : Icons.check_circle_outline,
            size: 16,
          ),
          const SizedBox(width: 5),
          Flexible(child: Text(hasUnread ? copy.markAllRead : copy.allRead)),
        ],
      ),
    ),
  );
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) => Text(
    title,
    style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
  );
}

class _RecentSessionsCard extends StatelessWidget {
  const _RecentSessionsCard({
    required this.overview,
    required this.controller,
    required this.copy,
    required this.onOpen,
  });

  final HomeSessions overview;
  List<RelaySession> get sessions => overview.recent;
  final AppController controller;
  final _HomeCopy copy;
  final ValueChanged<String> onOpen;

  @override
  Widget build(BuildContext context) {
    if (sessions.isEmpty) {
      return _HomeCard(
        key: const ValueKey('home-recent-sessions'),
        child: controller.homeSessionsLoading
            ? _RecentSessionsSkeleton(label: copy.loadingRecentSessions)
            : Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 18,
                ),
                child: Text(
                  copy.noRecentSessions,
                  style: const TextStyle(color: RelayTheme.muted),
                ),
              ),
      );
    }
    return _HomeCard(
      key: const ValueKey('home-recent-sessions'),
      padding: EdgeInsets.zero,
      child: Column(
        children: [
          for (var index = 0; index < sessions.length; index++) ...[
            _RecentSessionTile(
              session: sessions[index],
              isRunning: sessions[index].status == 'active',
              hasUnopenedCompletion: overview.unreadIds.contains(
                sessions[index].id,
              ),
              pendingDecisionCount:
                  overview.pendingByRoot[sessions[index].rootSessionId] ?? 0,
              copy: copy,
              onTap: () => onOpen(sessions[index].id),
            ),
            if (index != sessions.length - 1)
              const Divider(indent: 54, endIndent: 12),
          ],
        ],
      ),
    );
  }
}

class _RecentSessionsSkeleton extends StatefulWidget {
  const _RecentSessionsSkeleton({required this.label});

  final String label;

  @override
  State<_RecentSessionsSkeleton> createState() =>
      _RecentSessionsSkeletonState();
}

class _RecentSessionsSkeletonState extends State<_RecentSessionsSkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    value: 1,
    duration: const Duration(milliseconds: 1200),
  );
  late final Animation<double> _opacity = _pulse.drive(
    Tween(begin: 0.5, end: 1.0).chain(CurveTween(curve: Curves.easeInOut)),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context) ||
        MediaQuery.accessibleNavigationOf(context) ||
        !TickerMode.of(context)) {
      _pulse.stop();
      _pulse.value = 1;
    } else if (!_pulse.isAnimating) {
      _pulse.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Semantics(
    label: widget.label,
    liveRegion: true,
    child: ExcludeSemantics(
      child: RepaintBoundary(
        child: FadeTransition(
          key: const ValueKey('home-recent-sessions-loading'),
          opacity: _opacity,
          child: Column(
            children: [
              for (var index = 0; index < 5; index++) ...[
                _RecentSessionSkeletonRow(index: index),
                if (index < 4) const Divider(indent: 54, endIndent: 12),
              ],
            ],
          ),
        ),
      ),
    ),
  );
}

class _RecentSessionSkeletonRow extends StatelessWidget {
  const _RecentSessionSkeletonRow({required this.index});

  final int index;

  @override
  Widget build(BuildContext context) {
    final color = RelayTheme.mutedBright.withValues(alpha: 0.22);
    final textScaler = MediaQuery.textScalerOf(context);
    Widget bar(double width, double height) => Align(
      alignment: Alignment.centerLeft,
      child: FractionallySizedBox(
        widthFactor: width,
        child: Container(
          height: height,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(3),
          ),
        ),
      ),
    );
    return Padding(
      key: ValueKey('home-recent-session-placeholder-$index'),
      padding: const EdgeInsets.fromLTRB(12, 12, 8, 12),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(9),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  height: textScaler.scale(24),
                  child: bar([0.76, 0.62, 0.88, 0.68, 0.8][index], 10),
                ),
                const SizedBox(height: 3),
                SizedBox(height: textScaler.scale(17), child: bar(0.54, 8)),
              ],
            ),
          ),
          const SizedBox(width: 24),
        ],
      ),
    );
  }
}

class _RecentSessionTile extends StatelessWidget {
  const _RecentSessionTile({
    required this.session,
    required this.isRunning,
    required this.hasUnopenedCompletion,
    required this.pendingDecisionCount,
    required this.copy,
    required this.onTap,
  });

  final RelaySession session;
  final bool isRunning;
  final bool hasUnopenedCompletion;
  final int pendingDecisionCount;
  final _HomeCopy copy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    key: ValueKey('home-recent-session-${session.id}'),
    onTap: onTap,
    borderRadius: BorderRadius.circular(13),
    child: Padding(
      padding: const EdgeInsets.fromLTRB(12, 12, 8, 12),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: RelayTheme.panelSoft,
              borderRadius: BorderRadius.circular(9),
              border: Border.all(color: RelayTheme.lineSoft),
            ),
            child: Center(
              child: pendingDecisionCount > 0
                  ? Icon(
                      Icons.shield_outlined,
                      size: 19,
                      color: RelayTheme.amber,
                      semanticLabel: context.l10n.workbenchPendingApprovals(
                        pendingDecisionCount,
                      ),
                    )
                  : isRunning
                  ? Semantics(
                      label: copy.running,
                      child: AnimatedRunningStatusIcon(
                        size: 19,
                        color: RelayTheme.greenStrong,
                        iconKey: ValueKey(
                          'home-session-running-icon-${session.id}',
                        ),
                      ),
                    )
                  : const Icon(
                      Icons.chat_bubble_outline_rounded,
                      size: 18,
                      color: RelayTheme.mutedBright,
                    ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  session.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  [
                    if (pendingDecisionCount > 0)
                      context.l10n.workbenchPendingApprovals(
                        pendingDecisionCount,
                      ),
                    session.project,
                    formatSessionTimestamp(session.updatedAt),
                  ].where((value) => value.trim().isNotEmpty).join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: RelayTheme.muted, fontSize: 12),
                ),
              ],
            ),
          ),
          if (hasUnopenedCompletion) ...[
            Semantics(
              label: copy.completedNotOpened,
              child: Container(
                key: ValueKey('home-session-unread-dot-${session.id}'),
                width: 8,
                height: 8,
                decoration: const BoxDecoration(
                  color: RelayTheme.greenStrong,
                  shape: BoxShape.circle,
                ),
              ),
            ),
            const SizedBox(width: 8),
          ],
          const Icon(Icons.chevron_right_rounded, color: RelayTheme.muted),
        ],
      ),
    ),
  );
}

class _TokenUsageCard extends StatelessWidget {
  const _TokenUsageCard({required this.snapshot, required this.copy});

  final _UsageSnapshot snapshot;
  final _HomeCopy copy;

  @override
  Widget build(BuildContext context) => _HomeCard(
    key: const ValueKey('home-token-usage'),
    padding: const EdgeInsets.all(13),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          copy.tokenUsage,
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 3),
        Text(
          copy.syncedTokenSources(snapshot.syncedProviderCount),
          key: const ValueKey('home-token-source-status'),
          style: const TextStyle(color: RelayTheme.muted, fontSize: 9.5),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _CompactMetric(
                label: copy.today,
                value: snapshot.hasSources
                    ? _compactTokens(snapshot.today)
                    : '—',
              ),
            ),
            Expanded(
              child: _CompactMetric(
                label: copy.sevenDays,
                value: snapshot.hasSources
                    ? _compactTokens(snapshot.sevenDays)
                    : '—',
              ),
            ),
            Expanded(
              child: _CompactMetric(
                label: copy.thirtyDays,
                value: snapshot.hasSources
                    ? _compactTokens(snapshot.thirtyDays)
                    : '—',
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        _TokenBars(providers: snapshot.providers),
        const SizedBox(height: 12),
        for (var index = 0; index < snapshot.providers.length; index++) ...[
          _ProviderUsageRow(provider: snapshot.providers[index], copy: copy),
          if (index != snapshot.providers.length - 1) const SizedBox(height: 8),
        ],
        if (!snapshot.hasSources) ...[
          const SizedBox(height: 10),
          Text(
            copy.waitingForTokenUsage,
            key: const ValueKey('home-token-empty'),
            style: const TextStyle(
              color: RelayTheme.muted,
              fontSize: 12,
              height: 1.35,
            ),
          ),
        ],
      ],
    ),
  );
}

class _ProviderUsageRow extends StatelessWidget {
  const _ProviderUsageRow({required this.provider, required this.copy});

  final _ProviderUsageSummary provider;
  final _HomeCopy copy;

  @override
  Widget build(BuildContext context) => Row(
    key: ValueKey('home-token-provider-${provider.id}'),
    children: [
      Container(
        width: 7,
        height: 7,
        decoration: BoxDecoration(
          color: provider.color,
          shape: BoxShape.circle,
        ),
      ),
      const SizedBox(width: 8),
      Expanded(
        child: Text(
          provider.label,
          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
        ),
      ),
      Text(
        provider.available
            ? '${_compactTokens(provider.thirtyDays)} · ${copy.thirtyDays}'
            : copy.tokenSourceUnavailable,
        style: TextStyle(
          color: provider.available ? RelayTheme.mutedBright : RelayTheme.muted,
          fontSize: 10,
          fontWeight: provider.available ? FontWeight.w700 : FontWeight.w500,
        ),
      ),
    ],
  );
}

class _CompactMetric extends StatelessWidget {
  const _CompactMetric({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: const TextStyle(color: RelayTheme.muted, fontSize: 9.5),
      ),
      const SizedBox(height: 4),
      FittedBox(
        fit: BoxFit.scaleDown,
        alignment: Alignment.centerLeft,
        child: Text(
          value,
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
        ),
      ),
    ],
  );
}

class _TokenBars extends StatelessWidget {
  const _TokenBars({required this.providers});

  final List<_ProviderUsageSummary> providers;

  @override
  Widget build(BuildContext context) {
    final totals = List<int>.generate(
      30,
      (index) => providers.fold(
        0,
        (sum, provider) => sum + provider.dailyValues[index],
      ),
      growable: false,
    );
    final maximum = totals.fold<int>(0, math.max);
    return SizedBox(
      key: const ValueKey('home-token-bars'),
      height: 54,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          for (var index = 0; index < totals.length; index++)
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 1),
                child: _StackedTokenBar(
                  total: totals[index],
                  maximum: maximum,
                  segments: [
                    for (final provider in providers)
                      (provider.dailyValues[index], provider.color),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _StackedTokenBar extends StatelessWidget {
  const _StackedTokenBar({
    required this.total,
    required this.maximum,
    required this.segments,
  });

  final int total;
  final int maximum;
  final List<(int, Color)> segments;

  @override
  Widget build(BuildContext context) {
    if (maximum == 0 || total == 0) {
      return Container(
        height: 3,
        decoration: BoxDecoration(
          color: RelayTheme.lineSoft,
          borderRadius: BorderRadius.circular(2),
        ),
      );
    }
    final height = math.max(3.0, 54 * total / maximum);
    return SizedBox(
      height: height,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(2),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.end,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final (value, color) in segments)
              if (value > 0)
                Expanded(
                  flex: math.max(1, (value / total * 1000).round()),
                  child: ColoredBox(color: color),
                ),
          ],
        ),
      ),
    );
  }
}

class _HomeCard extends StatelessWidget {
  const _HomeCard({super.key, required this.child, this.padding});

  final Widget child;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      color: RelayTheme.panelRaised,
      borderRadius: BorderRadius.circular(13),
      border: Border.all(color: RelayTheme.line),
    ),
    clipBehavior: Clip.antiAlias,
    padding: padding,
    child: child,
  );
}

class _UsageSnapshot {
  const _UsageSnapshot({
    required this.today,
    required this.sevenDays,
    required this.thirtyDays,
    required this.providers,
    required this.syncedProviderCount,
  });

  final int today;
  final int sevenDays;
  final int thirtyDays;
  final List<_ProviderUsageSummary> providers;
  final int syncedProviderCount;

  bool get hasSources => syncedProviderCount > 0;

  factory _UsageSnapshot.fromProviderUsage(
    Map<String, ProviderUsageSnapshot> usageByProvider, {
    DateTime? now,
  }) {
    final reference = _dateOnly((now ?? DateTime.now()).toLocal());
    final firstDay = reference.subtract(const Duration(days: 29));
    final providers = <_ProviderUsageSummary>[];
    for (final definition in _usageProviderDefinitions) {
      final snapshot = usageByProvider[definition.id];
      final daily = <DateTime, int>{};
      for (final bucket in snapshot?.daily ?? const <ProviderDailyUsage>[]) {
        final day = _parseUsageDate(bucket.date);
        if (day == null || bucket.totalTokens < 0) continue;
        if (day.isBefore(firstDay) || day.isAfter(reference)) continue;
        daily[day] = bucket.totalTokens;
      }
      final values = List<int>.generate(30, (index) {
        final day = firstDay.add(Duration(days: index));
        return daily[day] ?? 0;
      }, growable: false);
      providers.add(
        _ProviderUsageSummary(
          id: definition.id,
          label: definition.label,
          color: definition.color,
          available: snapshot != null,
          dailyValues: values,
          thirtyDays: values.fold(0, (sum, value) => sum + value),
        ),
      );
    }
    final combined = List<int>.generate(
      30,
      (index) => providers.fold(
        0,
        (sum, provider) => sum + provider.dailyValues[index],
      ),
      growable: false,
    );
    int sumLast(int days) =>
        combined.skip(30 - days).fold(0, (sum, value) => sum + value);
    return _UsageSnapshot(
      today: combined.last,
      sevenDays: sumLast(7),
      thirtyDays: combined.fold(0, (sum, value) => sum + value),
      providers: List.unmodifiable(providers),
      syncedProviderCount: providers
          .where((provider) => provider.available)
          .length,
    );
  }
}

class _ProviderUsageSummary {
  const _ProviderUsageSummary({
    required this.id,
    required this.label,
    required this.color,
    required this.available,
    required this.dailyValues,
    required this.thirtyDays,
  });

  final String id;
  final String label;
  final Color color;
  final bool available;
  final List<int> dailyValues;
  final int thirtyDays;
}

class _UsageProviderDefinition {
  const _UsageProviderDefinition({
    required this.id,
    required this.label,
    required this.color,
  });

  final String id;
  final String label;
  final Color color;
}

const _usageProviderDefinitions = <_UsageProviderDefinition>[
  _UsageProviderDefinition(
    id: 'codex',
    label: 'Codex',
    color: RelayTheme.greenStrong,
  ),
  _UsageProviderDefinition(
    id: 'kimi',
    label: 'Kimi Code',
    color: RelayTheme.green,
  ),
  _UsageProviderDefinition(
    id: 'claude',
    label: 'Claude Code',
    color: Color(0xFF4B7659),
  ),
];

DateTime? _parseUsageDate(String value) {
  final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(value);
  if (match == null) return null;
  final year = int.tryParse(match.group(1)!);
  final month = int.tryParse(match.group(2)!);
  final day = int.tryParse(match.group(3)!);
  if (year == null || month == null || day == null) return null;
  final parsed = DateTime(year, month, day);
  if (parsed.year != year || parsed.month != month || parsed.day != day) {
    return null;
  }
  return parsed;
}

DateTime _dateOnly(DateTime value) =>
    DateTime(value.year, value.month, value.day);

String _compactTokens(int value) {
  if (value >= 1000000000) {
    return '${(value / 1000000000).toStringAsFixed(1).replaceFirst('.0', '')}B';
  }
  if (value >= 1000000) {
    return '${(value / 1000000).toStringAsFixed(1).replaceFirst('.0', '')}M';
  }
  if (value >= 1000) {
    return '${(value / 1000).toStringAsFixed(1).replaceFirst('.0', '')}K';
  }
  return '$value';
}

class _HomeCopy {
  const _HomeCopy({required this.zh});

  final bool zh;

  factory _HomeCopy.of(BuildContext context) =>
      _HomeCopy(zh: Localizations.localeOf(context).languageCode == 'zh');

  String get projectsAndSessions => zh ? '项目与会话' : 'Projects and sessions';
  String get running => zh ? '正在运行' : 'Running';
  String get readyToContinue => zh ? '等待继续' : 'Ready to continue';
  String get waitingForSessions => zh ? '等待会话' : 'Waiting for sessions';
  String get noSessionsTitle => zh ? '还没有可用会话' : 'No sessions yet';
  String get noSessionsDetail => zh
      ? '保持桌面端在线；同步后的会话和项目会出现在这里。'
      : 'Keep desktop online. Synced sessions and projects will appear here.';
  String get projectFallback => zh ? '未命名项目' : 'Untitled project';
  String get continueSession => zh ? '继续会话' : 'Continue session';
  String get openProjects => zh ? '打开项目与会话' : 'Open projects and sessions';
  String runningMinutes(int value) =>
      zh ? '已运行 $value 分钟' : 'Running for $value min';
  String runningHours(int value) =>
      zh ? '已运行 $value 小时' : 'Running for $value hr';
  String lastUpdated(String value) => zh
      ? value.isEmpty
            ? '等待同步时间'
            : '最近更新 $value'
      : value.isEmpty
      ? 'Waiting for sync time'
      : 'Updated $value';
  String get markAllRead => zh ? '全部已读' : 'Mark all read';
  String get allRead => zh ? '已全部读完' : 'All caught up';
  String get recentSessions => zh ? '最近会话' : 'Recent sessions';
  String get loadingRecentSessions =>
      zh ? '正在加载最近会话' : 'Loading recent sessions';
  String get completedNotOpened => zh ? '已完成，尚未打开' : 'Completed, not opened';
  String get viewAll => zh ? '查看全部' : 'View all';
  String get noRecentSessions => zh ? '暂无其他最近会话' : 'No other recent sessions';
  String get tokenUsage => zh ? 'Token 消耗' : 'Token usage';
  String get today => zh ? '今日' : 'Today';
  String get sevenDays => zh ? '7 天' : '7 days';
  String get thirtyDays => zh ? '30 天' : '30 days';
  String syncedTokenSources(int value) =>
      zh ? '已同步 $value/3 个本地 Agent' : '$value/3 local agents synced';
  String get tokenSourceUnavailable => zh ? '暂无数据' : 'No data yet';
  String get waitingForTokenUsage =>
      zh ? '等待本地 Agent 同步 Token 用量' : 'Waiting for local agent usage';
  String get activityDays => zh ? '会话更新日' : 'Session update days';
  String get activityDetail =>
      zh ? '按最近更新时间统计 · 近 12 周' : 'Based on latest update time · 12 weeks';
  String get thisMonth => zh ? '本月有更新' : 'This month';
  String get lastTwelveWeeks => zh ? '近 12 周' : '12 weeks';
  String get updatedSessions => zh ? '更新会话' : 'Sessions';
  String days(int value) => zh ? '$value 天' : '$value days';
  String get less => zh ? '少' : 'Less';
  String get more => zh ? '多' : 'More';
}
