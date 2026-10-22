import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';

import '../support/workbench_fixture.dart';

const _listKey = ValueKey('conversation-message-list');

void main() {
  testWidgets(
    '[MOB-MSG-009][flutter] folded tool-only latest page fills older readable history after its first frame',
    (tester) async {
      final controller = _controller(_tools('latest'));
      addTearDown(controller.dispose);
      controller.gate = Completer<void>();
      controller.pages = [
        [_answer('older-answer', lines: 40)],
      ];
      await pumpWorkbench(tester, controller);
      await tester.pump();
      expect(controller.earlierReads, 1);
      expect(
        find.byKey(const ValueKey('conversation-turn-turn:latest')),
        findsOneWidget,
      );
      expect(find.text('Hidden commentary'), findsNothing);
      final loading = find.byKey(const ValueKey('history-loading-state'));
      expect(tester.getSize(loading).height, 54);
      controller.gate!.complete();
      await _frames(tester);
      expect(
        find.byKey(const ValueKey('assistant-message-older-answer')),
        findsOneWidget,
      );
      expect(controller.earlierReads, 1);
      expect(_scroll(tester).offset, closeTo(0, 1));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('short readable first page stays visible while it fills', (
    tester,
  ) async {
    final controller = _controller([_answer('short')]);
    addTearDown(controller.dispose);
    controller.gate = Completer<void>();
    await pumpWorkbench(tester, controller);
    await tester.pump();
    expect(controller.earlierReads, 1);
    expect(find.text('Readable answer short'), findsOneWidget);
    controller.gate!.complete();
    await _frames(tester);
    expect(controller.earlierReads, 2);
  });

  testWidgets('tool-only auto fill remains bounded to two pages per entry', (
    tester,
  ) async {
    final controller = _controller(_tools('latest'));
    addTearDown(controller.dispose);
    await pumpWorkbench(tester, controller);
    await _frames(tester, count: 16);
    expect(controller.earlierReads, 2);
    expect(controller.before, ['before_latest', 'before_1']);
    controller.notifyListeners();
    await _frames(tester, count: 10);
    expect(controller.earlierReads, 2);
    expect(find.byKey(const ValueKey('load-earlier-history')), findsOneWidget);
  });

  testWidgets('unchanged cursor does not repeatedly auto fetch the same page', (
    tester,
  ) async {
    final controller = _controller(_tools('latest'))..advanceCursor = false;
    addTearDown(controller.dispose);
    await pumpWorkbench(tester, controller);
    await _frames(tester, count: 12);
    expect(controller.earlierReads, 1);
  });

  for (final condition in [
    'full readable viewport',
    'offline',
    'failed history',
    'initial loading',
    'missing cursor',
    'empty cursor',
    'beginning reached',
    'local read only',
  ]) {
    testWidgets('$condition does not start automatic older history', (
      tester,
    ) async {
      final controller = _controller(
        condition == 'full readable viewport'
            ? [_answer('long', lines: 60)]
            : _tools('latest'),
        online: condition != 'offline',
      );
      addTearDown(controller.dispose);
      if (condition == 'failed history') controller.failure = 'Fixture failure';
      if (condition == 'initial loading') controller.historyLoading.add('root');
      if (condition == 'missing cursor') {
        controller.historyCursors.remove('root');
      }
      if (condition == 'empty cursor') controller.historyCursors['root'] = '';
      if (condition == 'beginning reached') {
        controller.historyHasMore['root'] = false;
      }
      if (condition == 'local read only') controller.localReadOnly = true;
      await pumpWorkbench(tester, controller);
      await _frames(tester);
      expect(controller.earlierReads, 0);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('an unexpected page failure stops automatic retries', (
    tester,
  ) async {
    final controller = _controller(_tools('latest'))..throwEarlier = true;
    addTearDown(controller.dispose);
    await pumpWorkbench(tester, controller);
    await _frames(tester, count: 10);
    expect(controller.earlierReads, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'session changed before the post-frame fill cannot read its predecessor',
    (tester) async {
      final controller = _controller(_tools('latest'));
      addTearDown(controller.dispose);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        controller.activeSessionId = 'other';
      });
      await pumpWorkbench(tester, controller);
      await _frames(tester);
      expect(controller.earlierReads, 0);
    },
  );

  testWidgets(
    'reader scroll stops further auto fill and preserves the reading offset',
    (tester) async {
      final controller = _controller(_tools('latest', separateTurns: true));
      addTearDown(controller.dispose);
      controller.gate = Completer<void>();
      await pumpWorkbench(tester, controller);
      await _frames(tester, count: 3);
      expect(controller.earlierReads, 1);
      expect(_scroll(tester).position.maxScrollExtent, greaterThan(300));
      await tester.drag(find.byKey(_listKey), const Offset(0, 80));
      await _frames(tester, count: 3);
      final readingOffset = _scroll(tester).offset;
      expect(readingOffset, greaterThan(1));
      controller.gate!.complete();
      await _frames(tester, count: 8);
      expect(controller.earlierReads, 1);
      expect(_scroll(tester).offset, closeTo(readingOffset, 1));
    },
  );
}

Future<void> _frames(WidgetTester tester, {int count = 6}) async {
  for (var i = 0; i < count; i++) {
    await tester.pump(const Duration(milliseconds: 32));
  }
}

ScrollController _scroll(WidgetTester tester) =>
    tester.widget<ScrollView>(find.byKey(_listKey)).controller!;

_InitialPagingController _controller(
  List<RelayMessage> messages, {
  bool online = true,
}) {
  final controller = _InitialPagingController();
  workbenchController(
    baseController: controller,
    online: online,
    sessions: [
      RelaySession.fromJson({...relaySession().raw, 'status': 'idle'}),
    ],
  );
  controller.messages['root'] = messages;
  controller.historyHasMore['root'] = true;
  controller.historyCursors['root'] = 'before_latest';
  return controller;
}

RelayMessage _answer(String id, {int lines = 1}) => RelayMessage(
  id: id,
  role: 'codex',
  content: List.filled(lines, 'Readable answer $id').join('\n\n'),
  createdAt: '2026-10-03T10:00:00Z',
  kind: 'message.completed',
  messagePhase: 'final_answer',
  turnId: 'answer-$id',
);

List<RelayMessage> _tools(String page, {bool separateTurns = false}) => [
  for (var i = 0; i < 22; i++)
    RelayMessage(
      id: '$page-tool-$i',
      role: 'system',
      content: 'Fixture tool activity',
      createdAt: '2026-10-03T10:00:00Z',
      kind: 'tool.activity',
      turnId: separateTurns ? '$page-$i' : page,
      toolActivityType: 'command',
      toolActivityStatus: 'completed',
    ),
  for (var i = 0; i < 2; i++)
    RelayMessage(
      id: '$page-commentary-$i',
      role: 'codex',
      content: 'Hidden commentary',
      createdAt: '2026-10-03T10:00:00Z',
      kind: 'message.completed',
      messagePhase: 'commentary',
      turnId: page,
    ),
];

class _InitialPagingController extends AppController {
  int earlierReads = 0;
  final before = <String?>[];
  List<List<RelayMessage>>? pages;
  Completer<void>? gate;
  String? failure;
  bool advanceCursor = true, throwEarlier = false;

  @override
  String? historyErrorFor(String sessionId) => failure;

  @override
  Future<void> loadHistory(
    String sessionId, {
    bool earlier = false,
    bool silent = false,
    bool localOnly = false,
  }) async {
    if (!earlier) return;
    earlierReads++;
    before.add(historyCursors[sessionId]);
    historyLoading.add(sessionId);
    historyEarlierLoading.add(sessionId);
    notifyListeners();
    try {
      await gate?.future;
      if (throwEarlier) throw StateError('fixture_page_failure');
      final page = pages == null
          ? _tools('older-$earlierReads')
          : pages!.elementAtOrNull(earlierReads - 1) ?? const <RelayMessage>[];
      messages[sessionId] = [...page, ...?messages[sessionId]];
      if (advanceCursor) historyCursors[sessionId] = 'before_$earlierReads';
    } finally {
      historyLoading.remove(sessionId);
      historyEarlierLoading.remove(sessionId);
      notifyListeners();
    }
  }
}
