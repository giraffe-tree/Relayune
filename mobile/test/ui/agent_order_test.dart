import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/state/agent_order.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/storage/secure_store.dart';

import '../support/workbench_fixture.dart';

void main() {
  test(
    'visibility preserves empty selections and excludes future agents by default',
    () {
      expect(normalizeVisibleAgents(null), ['codex', 'claude', 'kimi']);
      expect(normalizeVisibleAgents([]), isEmpty);
      expect(normalizeVisibleAgents(['pi', 'codex']), ['pi', 'codex']);
      expect(normalizeVisibleAgents(['unknown']), defaultVisibleAgents);
      expect(isBetaAgent('pi'), isTrue);
      expect(isBetaAgent('mcode'), isTrue);
      expect(normalizeVisibleAgents(['mcode']), ['mcode']);
      expect(isBetaAgent('claude'), isFalse);
    },
  );

  test('saved order retains positions and fills missing agents safely', () {
    expect(normalizeAgentOrder(null), defaultAgentOrder);
    expect(normalizeAgentOrder('invalid'), defaultAgentOrder);
    expect(normalizeAgentOrder(['kimi', 'unknown', 'kimi', 1, 'claude']), [
      'kimi',
      'claude',
      'codex',
      'mcode',
      'zcode',
      'opencode',
      'claude-cowork',
      'pi',
    ]);
  });

  testWidgets(
    'long press reorders agents and restores after restart',
    (tester) async {
      final store = _OrderStore();
      final controller = workbenchController(
        baseController: AppController(secureStore: store),
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      Finder agent(String id) => find.byKey(ValueKey('drawer-agent-$id'));
      for (final id in ['mcode', 'zcode', 'opencode', 'claude-cowork', 'pi']) {
        expect(agent(id), findsNothing);
      }
      double y(String id) => tester.getCenter(agent(id)).dy;
      for (var index = 1; index < defaultVisibleAgents.length; index++) {
        expect(
          y(defaultVisibleAgents[index - 1]),
          lessThan(y(defaultVisibleAgents[index])),
        );
      }
      final home = tester.getCenter(
        find.byKey(const ValueKey('workbench-section-home')),
      );
      final start = tester.getCenter(agent('kimi'));
      final end = tester.getCenter(agent('codex'));
      final gesture = await tester.startGesture(start);
      await tester.pump(const Duration(milliseconds: 600));
      await gesture.moveTo(end);
      await tester.pump(const Duration(milliseconds: 300));
      await gesture.up();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      expect(controller.agentOrder.take(3), ['kimi', 'codex', 'claude']);
      expect(y('kimi'), lessThan(y('codex')));
      expect(store.saved, controller.agentOrder);
      expect(
        tester.getCenter(find.byKey(const ValueKey('workbench-section-home'))),
        home,
      );
      // Dragging never selects the dragged provider or displays its tooltip.
      expect(find.text('Kimi Code'), findsNothing);
      await tester.tap(agent('claude'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      final selected = tester.getSemantics(agent('claude')).getSemanticsData();
      expect(selected.label, contains('Claude Code'));
      expect(find.text('Claude Code'), findsNWidgets(2));

      await tester.tap(find.byTooltip('关闭'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      await tester.tap(
        find.byKey(const ValueKey('workbench-navigation-button')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(y('kimi'), lessThan(y('codex')));
      final restored = AppController(secureStore: store);
      addTearDown(restored.dispose);
      await restored.initialize();
      expect(restored.agentOrder, controller.agentOrder);
      expect(tester.takeException(), isNull);
    },
    variant: TargetPlatformVariant({
      TargetPlatform.iOS,
      TargetPlatform.android,
    }),
  );

  test(
    'rapid reorders save in sequence and recover after a failed write',
    () async {
      final store = _OrderStore()..pending = Completer<void>();
      final controller = AppController(secureStore: store);
      addTearDown(controller.dispose);
      final first = controller.setAgentOrder(['kimi']);
      final second = controller.setAgentOrder(['claude']);
      await Future<void>.delayed(Duration.zero);
      expect(store.writes, 1);
      store.pending!.completeError(StateError('storage unavailable'));
      expect(await first, isFalse);
      expect(await second, isTrue);
      expect(store.saved, controller.agentOrder);
      expect(store.saved.first, 'claude');
    },
  );
}

class _OrderStore extends SecureStore {
  List<String> saved = defaultAgentOrder;
  Completer<void>? pending;
  int writes = 0;

  @override
  Future<StoredCredentials> read() async =>
      StoredCredentials(agentOrder: saved);

  @override
  Future<void> saveAgentOrder(List<String> order) async {
    writes++;
    if (writes == 1 && pending != null) await pending!.future;
    saved = [...order];
  }
}
