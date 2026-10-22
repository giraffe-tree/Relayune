import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/state/live_reply_presentation.dart';

void main() {
  test('detached reply text does not accumulate an unbounded reveal queue', () {
    final presentation = LiveReplyPresentation();
    addTearDown(presentation.dispose);
    for (var i = 0; i < 20; i++) {
      presentation.append('字' * 5000);
      expect(presentation.value, '字' * (5000 * (i + 1)));
    }
  });

  test('large detached completed replies do not retain reveal frames', () {
    final registry = LiveReplyRegistry();
    addTearDown(registry.dispose);
    registry.complete(
      sessionId: 's',
      turnId: 't',
      messageId: 'm',
      text: '字' * 100000,
      createdAt: DateTime.now().toIso8601String(),
    );
    expect(registry.listenableFor('s', 'm'), isNull);
  });

  testWidgets(
    'fast one-character deltas cannot bypass the presentation cadence',
    (tester) async {
      var now = DateTime(2026, 9, 10);
      final presentation = LiveReplyPresentation(now: () => now);
      addTearDown(presentation.dispose);
      var publications = 0;
      presentation.addListener(() => publications++);
      for (var i = 0; i < 40; i++) {
        presentation.append('字', eventCreatedAt: now);
        now = now.add(const Duration(milliseconds: 1));
        await tester.pump(const Duration(milliseconds: 1));
      }
      expect(
        publications,
        2,
      ); // First character plus one 40ms presentation frame.
      expect(presentation.value.length, lessThan(40));
      presentation.complete('字' * 40, eventCreatedAt: now);
      await _advance(tester, () => now, (value) => now = value, frames: 8);
      expect(presentation.value, '字' * 40);
      expect(presentation.isSettled, isTrue);
    },
  );

  testWidgets('completion-only desktop text still reveals progressively', (
    tester,
  ) async {
    var now = DateTime(2026, 9, 10);
    final presentation = LiveReplyPresentation(now: () => now);
    addTearDown(presentation.dispose);
    presentation.complete('桌面会话模拟逐字输出', eventCreatedAt: now);
    await _pumpPresentation(tester, presentation);
    expect(presentation.value, '桌');
    await _advance(tester, () => now, (value) => now = value, frames: 2);
    expect(presentation.value.length, inExclusiveRange(1, 10));
    await _advance(tester, () => now, (value) => now = value, frames: 6);
    expect(presentation.value, '桌面会话模拟逐字输出');
    expect(presentation.isSettled, isTrue);
  });

  testWidgets(
    'background reply updates skip reveal timers and resume at latest text',
    (tester) async {
      final presentation = LiveReplyPresentation();
      addTearDown(presentation.dispose);
      var publications = 0;
      presentation.addListener(() => publications += 1);
      presentation.append('first partial reply');
      presentation.setForeground(false);
      final beforeBackground = publications;
      presentation.append(' with background content');
      await tester.pump(const Duration(seconds: 1));
      expect(publications, beforeBackground);
      expect(presentation.value, 'first partial reply with background content');
      presentation.setForeground(true);
      expect(publications, beforeBackground + 1);
      presentation.append(' and resumed content');
      // Foreground publication counts as a frame; the next delta is batched.
      expect(publications, beforeBackground + 1);
      await tester.pump(LiveReplyPresentation.frameInterval);
      expect(publications, greaterThan(beforeBackground + 1));
      presentation.setForeground(false);
    },
  );

  testWidgets('live reply reveals whole Unicode graphemes and catches up', (
    tester,
  ) async {
    var now = DateTime(2026, 8, 31, 12);
    const family = '👨‍👩‍👧‍👦';
    final presentation = LiveReplyPresentation(now: () => now)
      ..append('$family中文输出完成', eventCreatedAt: now);
    addTearDown(presentation.dispose);

    await _pumpPresentation(tester, presentation);

    expect(presentation.value, family);
    expect(presentation.value.codeUnits, family.codeUnits);

    await _advance(tester, () => now, (value) => now = value, frames: 3);
    expect(presentation.value, isNot('$family中文输出完成'));

    await _advance(tester, () => now, (value) => now = value, frames: 6);
    expect(presentation.value, '$family中文输出完成');
  });

  testWidgets(
    'one fetched page of deltas is smoothed within a bounded window',
    (tester) async {
      var now = DateTime(2026, 8, 31, 12);
      final registry = LiveReplyRegistry(now: () => now);
      addTearDown(registry.dispose);
      for (var index = 0; index < 100; index += 1) {
        registry.append(
          sessionId: 'root',
          turnId: 'turn-1',
          messageId: 'answer-1',
          text: '${index % 10}',
          createdAt: now.toIso8601String(),
        );
      }
      final presentation = registry.listenableFor('root', 'answer-1')!;
      const target =
          '01234567890123456789012345678901234567890123456789'
          '01234567890123456789012345678901234567890123456789';

      await _pumpPresentation(tester, presentation);
      expect(presentation.value.length, 1);

      await _advance(tester, () => now, (value) => now = value, frames: 3);
      expect(presentation.value.length, inExclusiveRange(1, target.length));

      await _advance(tester, () => now, (value) => now = value, frames: 6);
      expect(presentation.value, target);
    },
  );

  testWidgets('completed text replaces a divergent partial exactly', (
    tester,
  ) async {
    var now = DateTime(2026, 8, 31, 12);
    final presentation = LiveReplyPresentation(now: () => now)
      ..append('草稿内容', eventCreatedAt: now);
    addTearDown(presentation.dispose);
    await _pumpPresentation(tester, presentation);
    expect(presentation.value, '草');

    presentation.complete('最终内容', eventCreatedAt: now);
    await tester.pump();

    expect(presentation.value, '最终内容');
  });

  testWidgets('unchanged completion publishes the settled state', (
    tester,
  ) async {
    var now = DateTime(2026, 8, 31, 12);
    final presentation = LiveReplyPresentation(now: () => now)
      ..append('完整回复', eventCreatedAt: now);
    addTearDown(presentation.dispose);
    await _pumpPresentation(tester, presentation);
    await _advance(tester, () => now, (value) => now = value, frames: 8);
    expect(presentation.value, '完整回复');
    expect(presentation.isSettled, isFalse);

    var settledPublications = 0;
    void listener() {
      if (presentation.isSettled) settledPublications += 1;
    }

    presentation.addListener(listener);
    addTearDown(() => presentation.removeListener(listener));
    presentation.complete('完整回复', eventCreatedAt: now);

    expect(presentation.isSettled, isTrue);
    expect(settledPublications, 1);
  });

  testWidgets('stale recovery text does not replay its animation', (
    tester,
  ) async {
    final now = DateTime(2026, 8, 31, 12);
    final presentation = LiveReplyPresentation(now: () => now)
      ..append(
        '恢复后直接显示完整内容',
        eventCreatedAt: now.subtract(const Duration(seconds: 31)),
      );
    addTearDown(presentation.dispose);

    await _pumpPresentation(tester, presentation);

    expect(presentation.value, '恢复后直接显示完整内容');
  });
}

Future<void> _pumpPresentation(
  WidgetTester tester,
  ValueListenable<String> presentation,
) async {
  await tester.pumpWidget(
    MaterialApp(
      home: ValueListenableBuilder<String>(
        valueListenable: presentation,
        builder: (context, value, _) => Text(value),
      ),
    ),
  );
}

Future<void> _advance(
  WidgetTester tester,
  DateTime Function() readNow,
  ValueChanged<DateTime> writeNow, {
  required int frames,
}) async {
  for (var frame = 0; frame < frames; frame += 1) {
    writeNow(readNow().add(LiveReplyPresentation.frameInterval));
    await tester.pump(LiveReplyPresentation.frameInterval);
  }
}
