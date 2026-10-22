import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/feedback/relay_haptics.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import '../support/workbench_fixture.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  for (final terminal in ['completed', 'interrupted']) {
    test(
      'stop haptic requires matching interrupted turn, not $terminal delivery',
      () async {
        final events = <RelayHapticEvent>[];
        final base = _Controller(
          haptics: RelayHaptics(play: (event) async => events.add(event)),
        );
        final controller = workbenchController(baseController: base);
        addTearDown(controller.dispose);
        controller.applyEventForTesting(
          _event('start', {'kind': 'turn.started', 'turn_id': 'current'}),
        );
        await controller.interruptTurn();
        expect(events, isEmpty);
        controller.applyEventForTesting(
          _event('done', {
            'kind': 'turn.completed',
            'turn_id': 'current',
            'status': terminal,
          }),
        );
        controller.applyEventForTesting(
          _event('duplicate', {
            'kind': 'turn.completed',
            'turn_id': 'current',
            'status': terminal,
          }),
        );
        expect(
          events,
          terminal == 'interrupted'
              ? [RelayHapticEvent.stopConfirmed]
              : isEmpty,
        );
      },
    );
  }

  test('an unrelated completed turn cannot acknowledge a stop', () async {
    final events = <RelayHapticEvent>[];
    final controller = workbenchController(
      baseController: _Controller(
        haptics: RelayHaptics(play: (event) async => events.add(event)),
      ),
    );
    addTearDown(controller.dispose);
    controller.applyEventForTesting(
      _event('start', {'kind': 'turn.started', 'turn_id': 'current'}),
    );
    await controller.interruptTurn();
    controller.applyEventForTesting(
      _event('old', {
        'kind': 'turn.completed',
        'turn_id': 'old',
        'status': 'interrupted',
      }),
    );
    expect(events, isEmpty);
  });

  test(
    'decision haptic waits for runtime confirmation and ignores duplicates and failures',
    () async {
      final events = <RelayHapticEvent>[];
      final controller = workbenchController(
        baseController: _Controller(
          haptics: RelayHaptics(play: (event) async => events.add(event)),
        ),
      );
      addTearDown(controller.dispose);
      final approval = RelayApproval(
        id: 'approval',
        sessionId: 'root',
        action: const {},
        riskLevel: 'medium',
        state: 'pending',
        requestedAt: DateTime.now().toIso8601String(),
        expiresAt: DateTime.now()
            .add(const Duration(minutes: 5))
            .toIso8601String(),
      );
      controller.approvals = [approval];
      await controller.decideApproval(approval, 'approved');
      expect(events, isEmpty);
      controller.applyEventForTesting(
        _event('approved', {
          'kind': 'approval.resolved',
          'approval_id': 'approval',
          'decision': 'approved',
        }),
      );
      controller.applyEventForTesting(
        _event('repeated', {
          'kind': 'approval.resolved',
          'approval_id': 'approval',
          'decision': 'approved',
        }),
      );
      expect(events, [RelayHapticEvent.decisionConfirmed]);
      controller.approvals = [approval];
      await controller.decideApproval(approval, 'rejected');
      controller.applyEventForTesting(
        _event('failed', {
          'kind': 'approval.failed',
          'approval_id': 'approval',
        }),
      );
      controller.applyEventForTesting(
        _event('late', {
          'kind': 'approval.resolved',
          'approval_id': 'approval',
          'decision': 'rejected',
        }),
      );
      expect(events, [RelayHapticEvent.decisionConfirmed]);
    },
  );
}

RelayEvent _event(String id, Map<String, dynamic> event) => RelayEvent(
  cursor: 0,
  agentId: null,
  eventId: id,
  sessionId: 'root',
  createdAt: DateTime.now().toUtc().toIso8601String(),
  event: event,
);

class _Controller extends AppController {
  _Controller({required super.haptics});
  @override
  Future<CommandResult> sendEncryptedCommand(
    String type,
    String? sessionId,
    Map<String, dynamic> payload, {
    Duration ttl = const Duration(minutes: 5),
    String? requestId,
  }) async => const CommandResult(requestId: 'queued', delivery: 'queued');
}
