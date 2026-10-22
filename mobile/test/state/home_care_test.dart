import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/widgets.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/state/home_care.dart';

void main() {
  final chinese = relayuneLocalizationsFor(const Locale('zh', 'CN'));
  final english = relayuneLocalizationsFor(const Locale('en'));
  final start = DateTime(2026, 9, 8, 14);

  test('idle screens and long absences do not count as continuous use', () {
    final activity = HomeCareActivity();
    activity.interact(start);
    expect(
      activity.stretchAt(start.add(const Duration(hours: 2))),
      Duration.zero,
    );
    activity.interact(start.add(const Duration(hours: 2)));
    expect(activity.todayAt(start), Duration.zero);

    for (var minute = 1; minute <= 45; minute++) {
      activity.interact(start.add(Duration(hours: 2, minutes: minute)));
    }
    expect(
      activity.stretchAt(start.add(const Duration(hours: 2, minutes: 45))),
      const Duration(minutes: 45),
    );
    activity.interact(start.add(const Duration(hours: 3)));
    expect(
      activity.stretchAt(start.add(const Duration(hours: 3))),
      Duration.zero,
    );
    expect(activity.todayAt(start), const Duration(minutes: 45));
  });

  test('background time is excluded, short interruptions preserve focus', () {
    final activity = HomeCareActivity();
    for (var minute = 0; minute <= 45; minute++) {
      activity.interact(start.add(Duration(minutes: minute)));
    }
    activity.pause(start.add(const Duration(minutes: 45)));
    activity.interact(start.add(const Duration(minutes: 46)));
    activity.resume(start.add(const Duration(minutes: 47)));
    activity.interact(start.add(const Duration(minutes: 47)));
    expect(
      activity.stretchAt(start.add(const Duration(minutes: 47))),
      const Duration(minutes: 45),
    );
    expect(activity.todayAt(start), const Duration(minutes: 45));
    activity.pause(start.add(const Duration(minutes: 48)));
    activity.resume(start.add(const Duration(hours: 5)));
    activity.interact(start.add(const Duration(hours: 5)));
    expect(
      activity.stretchAt(start.add(const Duration(hours: 5))),
      Duration.zero,
    );
    expect(activity.todayAt(start), const Duration(minutes: 45));
    expect(activity.isReturningAt(start.add(const Duration(hours: 5))), isTrue);
    expect(
      activity.isReturningAt(start.add(const Duration(hours: 5, minutes: 10))),
      isFalse,
    );
  });

  test('midnight resets daily activity without inventing a break', () {
    final activity = HomeCareActivity();
    final midnight = DateTime(2026, 9, 9);
    for (var minute = -45; minute <= 1; minute++) {
      activity.interact(midnight.add(Duration(minutes: minute)));
    }
    expect(activity.todayAt(midnight), const Duration(minutes: 1));
    expect(
      activity.stretchAt(midnight.add(const Duration(minutes: 1))),
      const Duration(minutes: 46),
    );
  });

  test('idle time after a brief resume resets the earlier stretch', () {
    final activity = HomeCareActivity();
    for (var minute = 0; minute <= 45; minute++) {
      activity.interact(start.add(Duration(minutes: minute)));
    }
    activity.pause(start.add(const Duration(minutes: 45)));
    activity.resume(start.add(const Duration(minutes: 46)));
    activity.interact(start.add(const Duration(hours: 2)));
    expect(
      activity.stretchAt(start.add(const Duration(hours: 2))),
      Duration.zero,
    );
    expect(activity.todayAt(start), const Duration(minutes: 45));
  });

  test('clock rollback cannot add negative activity', () {
    final activity = HomeCareActivity();
    activity.interact(start);
    activity.interact(start.subtract(const Duration(minutes: 1)));
    expect(activity.todayAt(start), Duration.zero);
    expect(activity.stretchAt(start), Duration.zero);
  });

  test('45 and 90 minute care overrides tasks and playful copy', () {
    for (final zh in [true, false]) {
      final before = homeCareMessage(
        now: start,
        l10n: zh ? chinese : english,
        hasSessions: true,
        activeStretch: const Duration(minutes: 44),
      );
      final care = homeCareMessage(
        now: start,
        l10n: zh ? chinese : english,
        hasSessions: true,
        running: true,
        activeStretch: const Duration(minutes: 45),
      );
      final rest = homeCareMessage(
        now: start,
        l10n: zh ? chinese : english,
        activeStretch: const Duration(minutes: 90),
      );
      expect(before.detail, isNot(care.detail));
      expect(care.detail, contains(zh ? '喝口水' : 'water'));
      expect(rest.detail, contains(zh ? '多休息一会儿' : 'longer break'));
    }
  });

  test(
    'late-night copy covers both sides of midnight without praising overwork',
    () {
      for (final hour in [23, 0, 5]) {
        final message = homeCareMessage(
          now: DateTime(2026, 9, 8, hour),
          l10n: chinese,
          running: true,
        );
        expect(message.title, '夜深了');
        expect(message.detail, contains('如果还在忙'));
      }
      expect(
        homeCareMessage(now: DateTime(2026, 9, 8, 6), l10n: chinese).title,
        '早上好',
      );
      expect(
        homeCareMessage(now: DateTime(2026, 9, 8, 12), l10n: chinese).title,
        '中午好',
      );
      expect(
        homeCareMessage(now: DateTime(2026, 9, 8, 23), l10n: english).title,
        'A quiet night',
      );
    },
  );

  test(
    'daily use, approvals, long waits, return and meals have distinct care',
    () {
      expect(
        homeCareMessage(
          now: start,
          l10n: chinese,
          activeToday: const Duration(hours: 3),
        ).detail,
        contains('留一点时间给自己'),
      );
      expect(
        homeCareMessage(
          now: start,
          l10n: chinese,
          pendingApproval: true,
          longRunning: true,
        ).detail,
        contains('想好了再继续'),
      );
      expect(
        homeCareMessage(
          now: start,
          l10n: chinese,
          running: true,
          longRunning: true,
        ).detail,
        contains('等得有点久了'),
      );
      expect(
        homeCareMessage(now: start, l10n: chinese, returning: true).detail,
        contains('欢迎回来'),
      );
      expect(
        homeCareMessage(now: start, l10n: chinese).detail,
        contains('准备好了'),
      );
      expect(
        homeCareMessage(
          now: DateTime(2026, 9, 8, 12),
          l10n: chinese,
          hasSessions: true,
        ).detail,
        contains('如果还没吃饭'),
      );
    },
  );

  test(
    'daily variants stay stable; occasional eggs yield to relevant care',
    () {
      var eggs = 0;
      for (var day = 0; day < 60; day++) {
        final now = start.add(Duration(days: day));
        final first = homeCareMessage(
          now: now,
          l10n: chinese,
          hasSessions: true,
        );
        expect(
          homeCareMessage(
            now: now.add(const Duration(minutes: 30)),
            l10n: chinese,
            hasSessions: true,
          ).detail,
          first.detail,
        );
        if (first.detail.contains('隐藏成就')) {
          eggs++;
          expect(
            homeCareMessage(
              now: now,
              l10n: chinese,
              hasSessions: true,
              activeStretch: const Duration(minutes: 45),
            ).detail,
            contains('喝口水'),
          );
        }
      }
      expect(eggs, greaterThan(0));
      expect(eggs, lessThan(20));
    },
  );
}
