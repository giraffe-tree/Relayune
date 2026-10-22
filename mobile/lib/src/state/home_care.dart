import '../../generated/l10n/app_localizations.dart';

/// Ephemeral, on-device interaction timing. No content, storage or telemetry.
/// A running agent or an unattended foreground screen never counts as work.
class HomeCareActivity {
  static const idleGap = Duration(minutes: 5);
  DateTime? _lastInteraction;
  DateTime? _pausedAt;
  DateTime? _resumedAt;
  DateTime? _day;
  DateTime? _welcomeUntil;
  Duration _stretch = Duration.zero;
  Duration _today = Duration.zero;

  void _rollDay(DateTime now) {
    final day = DateTime(now.year, now.month, now.day);
    if (_day != day) {
      _day = day;
      _today = Duration.zero;
    }
  }

  void interact(DateTime now) {
    if (_pausedAt != null) return;
    _rollDay(now);
    final previous = _lastInteraction;
    final gap = previous == null ? null : now.difference(previous);
    if (previous == null && _resumedAt != null) {
      final sinceResume = now.difference(_resumedAt!);
      if (sinceResume > idleGap || sinceResume.isNegative) {
        _stretch = Duration.zero;
      }
    }
    if (gap != null && gap >= Duration.zero && gap <= idleGap) {
      _stretch += gap;
      // Do not carry yesterday's interval into today's activity.
      final midnight = DateTime(now.year, now.month, now.day);
      _today += now.difference(
        previous!.isBefore(midnight) ? midnight : previous,
      );
    } else if (gap != null) {
      _stretch = Duration.zero;
      if (gap >= const Duration(hours: 4)) {
        _welcomeUntil = now.add(const Duration(minutes: 10));
      }
    }
    _lastInteraction = now;
    _resumedAt = null;
  }

  void pause(DateTime now) {
    _pausedAt ??= now;
  }

  void resume(DateTime now) {
    _rollDay(now);
    final pausedAt = _pausedAt;
    if (pausedAt == null) return;
    final absence = now.difference(pausedAt);
    final last = _lastInteraction;
    if (last == null || now.difference(last) > idleGap || absence.isNegative) {
      _stretch = Duration.zero;
    }
    if (absence >= const Duration(hours: 4)) {
      _welcomeUntil = now.add(const Duration(minutes: 10));
    }
    // The next interaction starts a new interval; background time is excluded.
    _lastInteraction = null;
    _resumedAt = now;
    _pausedAt = null;
  }

  Duration stretchAt(DateTime now) {
    final last = _lastInteraction;
    if (_pausedAt != null || last == null) return Duration.zero;
    final gap = now.difference(last);
    return gap.isNegative || gap > idleGap ? Duration.zero : _stretch;
  }

  Duration todayAt(DateTime now) {
    _rollDay(now);
    return _today;
  }

  bool isReturningAt(DateTime now) =>
      _welcomeUntil != null && now.isBefore(_welcomeUntil!);
}

class HomeCareMessage {
  const HomeCareMessage(this.title, this.detail);
  final String title;
  final String detail;
}

/// Keep contextual care ahead of playful copy. Variants are stable for a
/// calendar day, so catalog refreshes and rebuilds do not shuffle the greeting.
HomeCareMessage homeCareMessage({
  required DateTime now,
  required AppLocalizations l10n,
  Duration activeStretch = Duration.zero,
  Duration activeToday = Duration.zero,
  bool returning = false,
  bool hasSessions = false,
  bool running = false,
  bool longRunning = false,
  bool pendingApproval = false,
}) {
  final hour = now.hour;
  final night = hour >= 23 || hour < 6;
  final title = night
      ? l10n.homeGreetingNight
      : hour < 12
      ? l10n.homeGreetingMorning
      : hour < 14
      ? l10n.homeGreetingNoon
      : hour < 18
      ? l10n.homeGreetingAfternoon
      : l10n.homeGreetingEvening;
  HomeCareMessage message(String detail) => HomeCareMessage(title, detail);

  if (activeStretch >= const Duration(minutes: 90)) {
    return message(l10n.homeCareLongBreak);
  }
  if (activeStretch >= const Duration(minutes: 45)) {
    return message(l10n.homeCarePause);
  }
  if (night) {
    return message(
      running ? l10n.homeCareNightWorking : l10n.homeCareNightQuiet,
    );
  }
  if (activeToday >= const Duration(hours: 3)) {
    return message(l10n.homeCareBusyDay);
  }
  if (pendingApproval) return message(l10n.homeCareDecision);
  if (longRunning) return message(l10n.homeCareLongWait);
  if (returning) return message(l10n.homeCareWelcomeBack);
  if (!hasSessions) return message(l10n.homeCareFirstIdea);
  if ((hour >= 12 && hour < 14) || (hour >= 18 && hour < 20)) {
    return message(l10n.homeCareMeal);
  }
  // One day in seven; no tap target, celebration animation or productivity score.
  final day =
      DateTime.utc(now.year, now.month, now.day).millisecondsSinceEpoch ~/
      Duration.millisecondsPerDay;
  if ((day ^ (day >> 3)) % 7 == 2) {
    return message(l10n.homeCareEasterEgg);
  }
  if (now.weekday >= DateTime.saturday) {
    return message(l10n.homeCareWeekend);
  }
  final variants = [
    l10n.homeCareDailyProgress,
    l10n.homeCareDailySpace,
    l10n.homeCareDailyPace,
  ];
  return message(variants[day % variants.length]);
}
