// Synthetic workloads enforce work bounds, not machine-dependent timing budgets.
// The tool entry point runs these same regressions with diagnostic counters.
import 'dart:collection';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/home_care.dart';
import 'package:relayune_mobile/src/ui/workbench_home_page.dart';
import 'package:relayune_mobile/src/ui/relayune_ready_screen.dart';

import '../support/workbench_fixture.dart';

class DiagnosticController extends AppController {
  void emitUnchangedUpdate() => notifyListeners();
}

class CountingSessions extends ListBase<RelaySession> {
  CountingSessions(this.source);
  final List<RelaySession> source;
  int reads = 0;
  @override
  int get length => source.length;
  @override
  set length(int value) => source.length = value;
  @override
  RelaySession operator [](int index) {
    reads++;
    return source[index];
  }

  @override
  void operator []=(int index, RelaySession value) => source[index] = value;
}

void main() {
  testWidgets('diagnostic hidden home during conversation updates', (
    tester,
  ) async {
    final notifications = DiagnosticController();
    final controller = workbenchController(baseController: notifications);
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: relayuneSupportedLocales,
        home: AnimatedBuilder(
          animation: controller,
          builder: (_, _) => RelayuneReadyScreen(controller: controller),
        ),
      ),
    );
    await tester.tap(find.byKey(const ValueKey('home-recent-session-root')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 320));
    final rebuilds = <String, int>{};
    debugOnRebuildDirtyWidget = (element, _) {
      rebuilds.update(
        element.widget.runtimeType.toString(),
        (value) => value + 1,
        ifAbsent: () => 1,
      );
    };
    notifications.emitUnchangedUpdate();
    await tester.pump();
    debugOnRebuildDirtyWidget = null;
    debugPrint(
      'PERF hidden_home visible=${find.byType(RelayuneHomePage).evaluate().length} home_rebuilds=${rebuilds['RelayuneHomePage'] ?? 0} conversation_rebuilds=${rebuilds['ConversationPage']}',
    );
    expect(rebuilds['RelayuneHomePage'] ?? 0, 0);
    controller.replaceSessionsForTesting([
      RelaySession.fromJson({
        ...controller.sessions.first.raw,
        'name': 'Updated while hidden',
      }),
    ]);
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('workbench-home-button')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 32));
    expect(find.text('Updated while hidden'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  for (final count in [100, 500, 1000]) {
    testWidgets('diagnostic home $count sessions', (tester) async {
      final sessions = CountingSessions(
        List.generate(
          count,
          (index) => RelaySession.fromJson({
            ...relaySession(id: 's-$index').raw,
            'status': 'idle',
            'updated_at': DateTime.utc(
              2026,
              9,
              8,
            ).subtract(Duration(minutes: index)).toIso8601String(),
          }),
        )..shuffle(Random(42)),
      );
      final controller = workbenchController(sessions: sessions);
      addTearDown(controller.dispose);
      Future<void> render() => tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: relayuneSupportedLocales,
          home: RelayuneHomePage(
            controller: controller,
            careActivity: HomeCareActivity(),
            onOpenSession: (_) {},
            onOpenConnectionInfo: () {},
            navigationDrawer: const SizedBox.shrink(),
          ),
        ),
      );
      await render();
      sessions.reads = 0;
      final watch = Stopwatch()..start();
      await render();
      watch.stop();
      debugPrint(
        'PERF home sessions=$count list_reads=${sessions.reads} rebuild_ms=${watch.elapsedMilliseconds}',
      );
      expect(
        sessions.reads,
        lessThan(count * 10),
        reason: 'Home work must grow linearly with its catalog.',
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
  for (final count in [20, 100, 300]) {
    testWidgets('diagnostic conversation $count turns', (tester) async {
      final notifications = DiagnosticController();
      final controller = workbenchController(baseController: notifications);
      addTearDown(controller.dispose);
      controller.messages['root'] = List.generate(
        count,
        (index) => RelayMessage(
          id: 'message-$index',
          role: 'codex',
          content:
              '## Reply $index\n\n${List.filled(5, 'A synthetic paragraph for layout.').join('\n\n')}',
          createdAt: '2026-09-08T10:00:00Z',
          kind: 'message.completed',
          turnId: 'turn-$index',
        ),
      );
      final watch = Stopwatch()..start();
      await pumpWorkbench(tester, controller);
      watch.stop();
      final mounted = find
          .byWidgetPredicate(
            (widget) => widget.runtimeType.toString() == '_MessageBubble',
            skipOffstage: false,
          )
          .evaluate()
          .length;
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 16));
      final rebuilds = <String, int>{};
      debugOnRebuildDirtyWidget = (element, _) {
        rebuilds.update(
          element.widget.runtimeType.toString(),
          (value) => value + 1,
          ifAbsent: () => 1,
        );
      };
      final update = Stopwatch()..start();
      notifications.emitUnchangedUpdate();
      await tester.pump();
      update.stop();
      debugOnRebuildDirtyWidget = null;
      debugPrint(
        'PERF conversation turns=$count mounted_bubbles=$mounted initial_ms=${watch.elapsedMilliseconds} unchanged_update_ms=${update.elapsedMilliseconds} turn_rebuilds=${rebuilds['_ConversationTurn']} bubble_rebuilds=${rebuilds['_MessageBubble']} markdown_rebuilds=${rebuilds['MarkdownBody'] ?? 0}',
      );
      expect(
        mounted,
        lessThanOrEqualTo(10),
        reason: 'Only viewport-adjacent replies should be mounted.',
      );
      expect(
        rebuilds['MarkdownBody'] ?? 0,
        0,
        reason: 'Unchanged replies must reuse their rendered Markdown.',
      );
      controller.messages['root'] = [
        ...controller.messages['root']!.take(count - 1),
        controller.messages['root']!.last.copyWith(
          content: 'Updated final reply',
        ),
      ];
      notifications.emitUnchangedUpdate();
      await tester.pump();
      expect(find.text('Updated final reply'), findsOneWidget);

      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
}
