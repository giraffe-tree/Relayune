import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:relayune_mobile/src/crypto/e2ee.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/state/session_composer_drafts.dart';
import 'package:relayune_mobile/src/ui/workbench_screen.dart';

import '../support/workbench_fixture.dart';

void main() {
  testWidgets('MiniMax Code beta accepts text but disables image input', (tester) async {
    final controller = workbenchController(sessions: [relaySession(provider: 'mcode')]);
    addTearDown(controller.dispose);
    await pumpWorkbench(tester, controller);
    final button = tester.widget<IconButton>(find.byKey(const ValueKey('attachment-picker-button')));
    expect(button.onPressed, isNull);
    expect(tester.widget<TextField>(find.byType(TextField).last).enabled, isTrue);
    expect(tester.takeException(), isNull);
  });

  for (final provider in ['codex', 'claude', 'kimi', 'pi']) {
    testWidgets('$provider live start exposes stop before catalog refresh', (tester) async {
      final deferred = _DeferredStopController();
      final idle = RelaySession.fromJson({
        ...relaySession().raw, 'provider': provider,
        'status': 'idle', 'can_interrupt': false,
        'supports_interrupt_and_send': true,
      });
      final controller = workbenchController(baseController: deferred, sessions: [idle]);
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      final stop = find.byKey(const ValueKey('composer-stop-button'));
      expect(stop, findsNothing);
      controller.applyEventForTesting(_event('live-start', {
        'kind': 'turn.started', 'turn_id': 'live',
      }));
      controller.replaceSessionsForTesting([idle]);
      await tester.pump();
      expect(stop, findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('conversation-composer-input')), 'next message');
      await tester.pump();
      expect(stop, findsOneWidget);
      expect(find.byKey(const ValueKey('composer-send-button')), findsOneWidget);
      await tester.tap(stop);
      await tester.pump();
      expect(deferred.calls, 1);
      expect(controller.isStoppingSession('root'), isTrue);
      deferred.result.complete(const CommandResult(requestId: 'stop', delivery: 'queued'));
      controller.applyEventForTesting(_event('live-end', {
        'kind': 'turn.completed', 'turn_id': 'live', 'status': 'interrupted',
      }));
      await tester.pump();
      expect(stop, findsNothing);
      expect(controller.canInterruptSession(controller.activeSession), isFalse);
      expect(_composerText(tester), 'next message');
    });
  }

  testWidgets('catalog-only external running session cannot stop', (tester) async {
    final controller = workbenchController(sessions: [RelaySession.fromJson({
      ...relaySession().raw, 'provider': 'kimi', 'status': 'active', 'can_interrupt': false,
    })])..runningSessions.add('root');
    addTearDown(controller.dispose);
    await pumpWorkbench(tester, controller);
    expect(find.byKey(const ValueKey('composer-stop-button')), findsNothing);
    expect(controller.canInterruptSession(controller.activeSession), isFalse);
  });

  testWidgets('active turn ignores an older catalog start time', (tester) async {
    final current = DateTime.now();
    final controller = workbenchController(sessions: [RelaySession.fromJson({
      ...relaySession().raw, 'running_started_at': current.subtract(const Duration(minutes: 87)).toIso8601String(),
    })])..runningSessions.add('root');
    addTearDown(controller.dispose);
    controller.messages['root'] = [
      RelayMessage(id: 'new-user', role: 'user', content: 'new wait', createdAt: current.subtract(const Duration(seconds: 6)).toIso8601String(), kind: 'user.message', turnId: 'new'),
      RelayMessage(id: 'new-tool', role: 'codex', content: 'waiting', createdAt: current.toIso8601String(), kind: 'command.started', turnId: 'new'),
    ];
    await pumpWorkbench(tester, controller);
    expect(find.text(' · 6 秒'), findsOneWidget);
    expect(find.textContaining('87 分'), findsNothing);
  });

  testWidgets('waiting for first activity ignores previous turn start', (tester) async {
    final current = DateTime.now();
    final controller = workbenchController(sessions: [RelaySession.fromJson({
      ...relaySession().raw, 'running_started_at': current.subtract(const Duration(minutes: 87)).toIso8601String(),
    })])..runningSessions.add('root');
    addTearDown(controller.dispose);
    controller.messages['root'] = [
      RelayMessage(id: 'new-user', role: 'user', content: 'new wait', createdAt: current.subtract(const Duration(seconds: 6)).toIso8601String(), kind: 'user.message', turnId: 'new'),
    ];
    await pumpWorkbench(tester, controller);
    expect(find.byKey(const ValueKey('assistant-live-activity')), findsNothing);
    expect(find.textContaining('87 分'), findsNothing);
    expect(find.textContaining('思考中'), findsNothing);
  });

  testWidgets('session switch clears previous conversation notice', (tester) async {
    final controller = workbenchController(sessions: [relaySession(), relaySession(id: 'other')]);
    addTearDown(controller.dispose);
    controller.notice = 'Old Kimi session created';
    await controller.selectSession('other');
    expect(controller.notice, isEmpty);
  });

  testWidgets('new turn start does not change a completed turn duration', (tester) async {
    final controller = workbenchController(sessions: [RelaySession.fromJson({
      ...relaySession().raw, 'running_started_at': '2026-09-10T10:05:00Z',
    })])..runningSessions.add('root');
    addTearDown(controller.dispose);
    controller.messages['root'] = [
      const RelayMessage(id: 'old-user', role: 'user', content: 'old wait', createdAt: '2026-09-10T10:00:00Z', kind: 'user.message', turnId: 'old'),
      const RelayMessage(id: 'old-tool', role: 'codex', content: 'old output', createdAt: '2026-09-10T10:00:06Z', kind: 'message.completed', turnId: 'old', messagePhase: 'commentary'),
      const RelayMessage(id: 'new-user', role: 'user', content: 'new wait', createdAt: '2026-09-10T10:05:00Z', kind: 'user.message', turnId: 'new'),
    ];
    await pumpWorkbench(tester, controller);
    expect(find.text(' · 6 秒'), findsOneWidget);
    expect(find.text(' · 5 分 0 秒'), findsNothing);
  });

  testWidgets('[MOB-MSG-005][flutter] recovered interruption stops status and elapsed timer', (tester) async {
    final controller = workbenchController(sessions: [RelaySession.fromJson({
      ...relaySession().raw, 'status': 'active',
      'running_started_at': '2026-09-10T10:00:00Z',
    })])..runningSessions.add('root');
    addTearDown(controller.dispose);
    controller.messages['root'] = [
      const RelayMessage(id: 'user', role: 'user', content: 'test task', createdAt: '2026-09-10T10:00:00Z', kind: 'user.message', turnId: 'orphan'),
      const RelayMessage(id: 'progress', role: 'codex', content: 'checking', createdAt: '2026-09-10T10:00:06Z', kind: 'message.completed', turnId: 'orphan', messagePhase: 'commentary'),
    ];
    await pumpWorkbench(tester, controller);
    expect(find.text('处理中'), findsOneWidget);
    controller.applyEventForTesting(_event('recovered-end', {
      'kind': 'turn.completed', 'turn_id': 'orphan', 'status': 'interrupted',
    }, createdAt: '2026-09-10T10:00:06Z'));
    controller.replaceSessionsForTesting([RelaySession.fromJson({
      ...controller.sessions.single.raw, 'status': 'idle', 'running_started_at': null,
    })]);
    await tester.pump();
    expect(controller.runningSessions, isNot(contains('root')));
    expect(find.text('处理中'), findsNothing);
    expect(find.text('运行中'), findsNothing);
    expect(find.text(' · 6 秒'), findsOneWidget);
    await tester.pump(const Duration(seconds: 10));
    expect(find.text(' · 6 秒'), findsOneWidget);
    expect(find.byKey(const ValueKey('assistant-running-elapsed')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('running Codex can submit steering while retaining stop', (tester) async {
    final recording = _RecordingSteerController();
    final controller = workbenchController(baseController: recording)
      ..runningSessions.add('root');
    addTearDown(controller.dispose);
    await pumpWorkbench(tester, controller, size: const Size(320, 700), textScale: 1.6);
    final input = find.byKey(const ValueKey('conversation-composer-input'));
    final surface = find.byKey(const ValueKey('composer-surface'));
    final compactHeight = tester.getSize(surface).height;
    expect(find.byKey(const ValueKey('composer-send-button')), findsNothing);
    expect(find.text('停止任务'), findsNothing);
    expect(tester.getBottomLeft(input).dy, closeTo(tester.getBottomLeft(find.byKey(const ValueKey('attachment-picker-button'))).dy, 1));
    await tester.tap(input);
    await tester.pump();
    expect(tester.getSize(surface).height, closeTo(compactHeight, 1));
    expect(tester.widget<TextField>(input).focusNode!.hasFocus, isTrue);
    await tester.enterText(find.byKey(const ValueKey('conversation-composer-input')), 'STEER_R2_OK');
    await tester.pump();
    final send = find.byKey(const ValueKey('composer-send-button'));
    final stop = find.byKey(const ValueKey('composer-stop-button'));
    expect(send, findsOneWidget);
    expect(stop, findsOneWidget);
    expect(tester.getRect(send).overlaps(tester.getRect(stop)), isFalse);
    await tester.tap(send);
    await tester.pump();
    expect(recording.sent, ['STEER_R2_OK']);
    expect(controller.runningSessions, contains('root'));
    expect(_composerText(tester), isEmpty);
    expect(stop, findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('[MOB-MSG-005][flutter] running timer survives stale catalog after turn start', (tester) async {
    final controller = workbenchController();
    addTearDown(controller.dispose);
    final idle = [RelaySession.fromJson({...controller.sessions.single.raw, 'status': 'idle'})];
    controller.applyEventForTesting(_event('user-live', {
      'kind': 'user.message', 'text': 'run this task',
    }));
    controller.applyEventForTesting(_event('start-live', {
      'kind': 'turn.started', 'turn_id': 'live',
    }));
    await pumpWorkbench(tester, controller);
    controller.applyEventForTesting(_event('think-live', {
      'kind': 'turn.thinking', 'turn_id': 'live', 'active': true,
    }));
    controller.notifyListeners();
    await tester.pump();
    final timer = find.byKey(const ValueKey('assistant-live-activity'));
    expect(timer, findsOneWidget);
    controller.replaceSessionsForTesting(idle);
    await tester.pump(const Duration(seconds: 3));
    expect(timer, findsOneWidget);
    controller.applyEventForTesting(_event('old-done', {
      'kind': 'turn.completed', 'turn_id': 'old',
    }));
    await tester.pump();
    expect(timer, findsOneWidget);
    controller.applyEventForTesting(_event('live-done', {
      'kind': 'turn.completed', 'turn_id': 'live',
    }));
    controller.clearBanners();
    await tester.pump();
    expect(timer, findsNothing);
  });

  for (final provider in [
    'codex',
    'claude',
    'claude-cowork',
    'kimi',
    'opencode',
    'zcode',
    'mcode',
  ]) {
    for (final layout in [
      (size: const Size(402, 874), textScale: 1.0),
      (size: const Size(320, 700), textScale: 1.6),
    ]) {
      testWidgets(
        'stop stays aligned with send for $provider at ${layout.size.width}px / ${layout.textScale}x',
        (tester) async {
          final controller = workbenchController(
            sessions: [relaySession(provider: provider)],
          );
          addTearDown(controller.dispose);
          await pumpWorkbench(
            tester,
            controller,
            size: layout.size,
            textScale: layout.textScale,
          );
          final sendRight = tester
              .getRect(find.byKey(const ValueKey('composer-send-button')))
              .right;
          controller.runningSessions.add('root');
          await pumpWorkbench(
            tester,
            controller,
            size: layout.size,
            textScale: layout.textScale,
          );
          final stop = tester.getRect(
            find.byKey(const ValueKey('composer-stop-button')),
          );
          final attachment = tester.getRect(
            find.byKey(const ValueKey('attachment-picker-button')),
          );
          expect(stop.right, closeTo(sendRight, 0.01));
          expect(stop.center.dy, closeTo(attachment.center.dy, 0.01));
          expect(stop.left, greaterThanOrEqualTo(attachment.right));
          expect(stop.height, greaterThanOrEqualTo(48));
          expect(tester.takeException(), isNull);
        },
      );
    }
  }

  testWidgets(
    'reading position survives a session round trip and latest is explicit',
    (tester) async {
      final controller = workbenchController(
        sessions: [
          relaySession(),
          relaySession(id: 'other'),
        ],
      );
      addTearDown(controller.dispose);
      controller.messages['root'] = List.generate(
        40,
        (index) => _message('long-$index'),
      );
      controller.messages['other'] = List.generate(
        24,
        (index) => _message('other-$index'),
      );
      await _pumpWorkbench(tester, controller);
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 32));
      }
      ScrollController scroll() => tester
          .widget<ScrollView>(
            find.byKey(const ValueKey('conversation-message-list')),
          )
          .controller!;
      scroll().jumpTo(scroll().position.maxScrollExtent / 2);
      await tester.pump();
      final offset = scroll().offset;
      expect(
        find.byKey(const ValueKey('conversation-back-to-latest')),
        findsOneWidget,
      );
      final latestButton = find.byKey(
        const ValueKey('conversation-back-to-latest'),
      );
      expect(
        find.descendant(of: latestButton, matching: find.byType(Text)),
        findsNothing,
      );
      expect(
        find.descendant(of: latestButton, matching: find.byType(SvgPicture)),
        findsOneWidget,
      );
      expect(tester.widget<IconButton>(latestButton).tooltip, isNotEmpty);
      expect(tester.getSize(latestButton).width, lessThanOrEqualTo(48));
      await controller.selectSession('other');
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 32));
      }
      await controller.selectSession('root');
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 32));
      }
      expect(scroll().offset, closeTo(offset, 1));
      await tester.tap(
        find.byKey(const ValueKey('conversation-back-to-latest')),
      );
      await tester.pump();
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 32));
      }
      expect(scroll().position.extentBefore, lessThanOrEqualTo(1));
      expect(
        find.byKey(const ValueKey('conversation-back-to-latest')),
        findsNothing,
      );
    },
  );

  for (final existingCount in [0, 3]) {
    testWidgets(
      '[MOB-ATT-006][flutter] photo picker with $existingCount existing images locks duplicates and recovers from cancellation',
      (tester) async {
        final controller = workbenchController();
        addTearDown(controller.dispose);
        final store = SessionComposerDraftStore();
        store.forSession('root')
          ..text = '图片说明'
          ..replaceAttachments(
            List.generate(
              existingCount,
              (index) => UploadAttachment(
                id: 'draft-$index',
                name: 'draft-$index.png',
                mimeType: 'image/png',
                bytes: _attachment().bytes,
              ),
            ),
          );
        final selection = Completer<Object?>();
        final calls = <MethodCall>[];
        const channel = MethodChannel('plugins.flutter.io/image_picker');
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          channel,
          (call) {
            calls.add(call);
            return selection.future;
          },
        );
        addTearDown(
          () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
            channel,
            null,
          ),
        );
        await _pumpWorkbench(tester, controller, draftStore: store);
        final picker = find.byKey(const ValueKey('attachment-picker-button'));
        await tester.tap(picker);
        await tester.pump();
        expect(
          calls.single.method,
          existingCount == 3 ? 'pickImage' : 'pickMultiImage',
        );
        expect(find.text('正在准备图片…'), findsOneWidget);
        expect(tester.widget<IconButton>(picker).onPressed, isNull);
        await tester.tap(picker);
        expect(calls, hasLength(1));
        selection.complete(null);
        await tester.pump();
        expect(tester.widget<IconButton>(picker).onPressed, isNotNull);
        expect(find.text('正在准备图片…'), findsNothing);
        expect(store.forSession('root').attachments, hasLength(existingCount));
        expect(_composerText(tester), '图片说明');
      },
    );
  }

  testWidgets(
    '[MOB-ATT-006][flutter] photo picker errors are visible and allow retry',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      const channel = MethodChannel('plugins.flutter.io/image_picker');
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (
        _,
      ) async {
        throw PlatformException(code: 'photo_access_denied');
      });
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          channel,
          null,
        ),
      );
      await _pumpWorkbench(tester, controller);
      final picker = find.byKey(const ValueKey('attachment-picker-button'));
      await tester.tap(picker);
      await tester.pump();
      expect(find.text('无法打开相册，请重试。'), findsOneWidget);
      expect(tester.widget<IconButton>(picker).onPressed, isNotNull);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-MSG-005][flutter] stop waits for runtime confirmation and survives session switching',
    (tester) async {
      final deferred = _DeferredStopController();
      final controller = workbenchController(
        baseController: deferred,
        sessions: [
          relaySession(),
          relaySession(id: 'other'),
        ],
      )..runningSessions.add('root');
      addTearDown(controller.dispose);
      await pumpWorkbench(
        tester,
        controller,
        size: const Size(320, 700),
        textScale: 1.6,
      );
      await tester.enterText(
        find.byKey(const ValueKey('conversation-composer-input')),
        '保留草稿',
      );
      final stop = find.byKey(const ValueKey('composer-stop-button'));
      final stopRight = tester.getRect(stop).right;
      expect(tester.getSize(stop).height, greaterThanOrEqualTo(48));
      await tester.tap(stop);
      await tester.pump();
      expect(controller.isStoppingSession('root'), isTrue);
      expect(find.byKey(const ValueKey('composer-stop-progress')), findsOneWidget);
      expect(tester.getRect(stop).right, closeTo(stopRight, 0.01));
      expect(tester.widget<IconButton>(stop).onPressed, isNull);
      await controller.interruptTurn();
      expect(deferred.calls, 1);
      deferred.result.complete(
        const CommandResult(requestId: 'stop', delivery: 'queued'),
      );
      await tester.pump();
      expect(controller.isStoppingSession('root'), isTrue);
      await controller.selectSession('other');
      await tester.pump();
      expect(find.byKey(const ValueKey('composer-stop-progress')), findsNothing);
      await controller.selectSession('root');
      await tester.pump();
      expect(find.byKey(const ValueKey('composer-stop-progress')), findsOneWidget);
      controller.applyEventForTesting(
        _event('stopped', {'kind': 'turn.completed', 'turn_id': 'turn'}),
      );
      controller.clearBanners();
      await tester.pump();
      expect(controller.isStoppingSession('root'), isFalse);
      expect(
        find.byKey(const ValueKey('composer-send-button')),
        findsOneWidget,
      );
      expect(_composerText(tester), '保留草稿');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-MSG-005][flutter] failed and unconfirmed stops restore retry without marking the task complete',
    (tester) async {
      final deferred = _DeferredStopController();
      final controller = workbenchController(baseController: deferred)
        ..runningSessions.add('root');
      addTearDown(controller.dispose);
      await pumpWorkbench(tester, controller);
      final request = controller.interruptTurn();
      deferred.result.completeError(StateError('stop unavailable'));
      await request;
      expect(controller.isStoppingSession('root'), isFalse);
      expect(controller.runningSessions, contains('root'));
      expect(controller.error, isNotEmpty);
      controller.clearBanners();
      deferred.result = Completer<CommandResult>();
      final retry = controller.interruptTurn();
      deferred.result.complete(
        const CommandResult(requestId: 'retry', delivery: 'queued'),
      );
      await retry;
      await tester.pump(const Duration(seconds: 35));
      expect(controller.isStoppingSession('root'), isFalse);
      expect(controller.runningSessions, contains('root'));
      expect(controller.error, contains('还未确认停止'));
      await tester.pump();
      expect(
        tester
            .widget<IconButton>(
              find.byKey(const ValueKey('composer-stop-button')),
            )
            .onPressed,
        isNotNull,
      );
    },
  );

  testWidgets(
    '[MOB-MSG-005][flutter] runtime rejection and idle catalog clear stop feedback',
    (tester) async {
      final deferred = _DeferredStopController();
      final controller = workbenchController(baseController: deferred)
        ..runningSessions.add('root');
      addTearDown(controller.dispose);
      deferred.result.complete(
        const CommandResult(requestId: 'stop', delivery: 'queued'),
      );
      await controller.interruptTurn();
      controller.applyEventForTesting(
        _event('rejected', {'kind': 'turn.interrupt_failed'}),
      );
      expect(controller.isStoppingSession('root'), isFalse);
      expect(controller.runningSessions, contains('root'));
      await controller.interruptTurn();
      controller.replaceSessionsForTesting([
        RelaySession.fromJson({'id': 'root', 'status': 'idle'}),
      ]);
      expect(controller.isStoppingSession('root'), isFalse);
      await tester.pump(const Duration(seconds: 36));
      expect(controller.error, isEmpty);
    },
  );

  testWidgets(
    '[MOB-MSG-002][flutter] conversation starts at latest and only follows while at tail',
    (tester) async {
      final controller = workbenchController(
        sessions: [
          relaySession(id: 'root', name: 'Root'),
          relaySession(id: 'other', name: 'Other'),
        ],
      );
      addTearDown(controller.dispose);
      controller.messages['root'] = List.generate(
        36,
        (index) => RelayMessage(
          id: 'message-$index',
          role: 'codex',
          content: '第 $index 条足够长的历史消息，用于验证长会话的滚动位置。',
          createdAt: '2026-08-10T10:${index.toString().padLeft(2, '0')}:00Z',
          kind: 'message.completed',
          turnId: 'turn-$index',
        ),
      );
      controller.messages['other'] = List.generate(
        24,
        (index) => RelayMessage(
          id: 'other-message-$index',
          role: 'codex',
          content: 'Other 会话的第 $index 条长历史消息。',
          createdAt: '2026-08-10T09:${index.toString().padLeft(2, '0')}:00Z',
          kind: 'message.completed',
          turnId: 'other-turn-$index',
        ),
      );
      await _pumpWorkbench(tester, controller);
      for (var frame = 0; frame < 6; frame += 1) {
        await tester.pump(const Duration(milliseconds: 32));
      }

      ScrollController messageScroll() => tester
          .widget<ScrollView>(
            find.byKey(const ValueKey('conversation-message-list')),
          )
          .controller!;
      var scroll = messageScroll();
      expect(scroll.offset, closeTo(scroll.position.minScrollExtent, 1));

      scroll.jumpTo(scroll.position.maxScrollExtent / 2);
      await tester.pump();
      final viewport = tester.getRect(
        find.byKey(const ValueKey('conversation-message-list')),
      );
      final anchor = find
          .byWidgetPredicate(
            (widget) =>
                widget.key is ValueKey<String> &&
                (widget.key! as ValueKey<String>).value.startsWith(
                  'assistant-message-',
                ),
          )
          .evaluate()
          .firstWhere((element) {
            final box = element.renderObject! as RenderBox;
            final rect = box.localToGlobal(Offset.zero) & box.size;
            return rect.overlaps(viewport);
          })
          .widget
          .key!;
      final readingTop = tester.getTopLeft(find.byKey(anchor)).dy;
      controller.messages['root']!.add(_message('new-while-reading'));
      controller.replaceSessionsForTesting(controller.sessions);
      await tester.pump(const Duration(milliseconds: 250));
      scroll = messageScroll();
      await tester.pump();
      expect(tester.getTopLeft(find.byKey(anchor)).dy, closeTo(readingTop, 1));
      expect(scroll.position.extentBefore, greaterThan(72));
      controller.messages['root']!.insert(0, _message('earlier-history'));
      controller.replaceSessionsForTesting(controller.sessions);
      await tester.pump();
      await tester.pump();
      expect(tester.getTopLeft(find.byKey(anchor)).dy, closeTo(readingTop, 1));

      controller.requestWorkbenchTarget('conversation');
      for (var frame = 0; frame < 6; frame += 1) {
        await tester.pump(const Duration(milliseconds: 32));
      }
      scroll = messageScroll();
      expect(scroll.offset, closeTo(scroll.position.minScrollExtent, 1));

      await controller.selectSession('other');
      for (var frame = 0; frame < 6; frame += 1) {
        await tester.pump(const Duration(milliseconds: 32));
      }
      scroll = messageScroll();
      expect(scroll.offset, closeTo(scroll.position.minScrollExtent, 1));

      controller.messages['root']!.add(_message('new-at-tail'));
      controller.replaceSessionsForTesting(controller.sessions);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 16));
      await tester.pump(const Duration(milliseconds: 200));
      scroll = messageScroll();
      expect(scroll.offset, closeTo(scroll.position.minScrollExtent, 1));
    },
  );

  testWidgets(
    '[MOB-MSG-003][flutter] multiple system reminders in one message use unique render keys',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = const [
        RelayMessage(
          id: 'multiple-reminders',
          role: 'codex',
          content:
              '已完成第一步。\n'
              '<system-reminder>第一条内部状态。</system-reminder>\n'
              '继续处理。\n'
              '<notification>第二条内部状态。</notification>',
          createdAt: '2026-08-10T11:00:00Z',
          kind: 'message.completed',
          turnId: 'turn-multiple-reminders',
        ),
      ];

      await _pumpWorkbench(tester, controller);
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.byKey(const ValueKey('system-reminder:1')), findsOneWidget);
      expect(find.byKey(const ValueKey('system-reminder:3')), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    '[MOB-MSG-002][flutter] the top of a fully loaded conversation identifies the first message',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = List.generate(
        24,
        (index) => RelayMessage(
          id: 'history-$index',
          role: 'codex',
          content: '第 $index 条历史消息，用于验证滚动到会话顶部后的终点提示。',
          createdAt: '2026-08-10T10:${index.toString().padLeft(2, '0')}:00Z',
          kind: 'message.completed',
          turnId: 'history-turn-$index',
        ),
      );

      await _pumpWorkbench(tester, controller);
      for (var frame = 0; frame < 6; frame += 1) {
        await tester.pump(const Duration(milliseconds: 32));
      }

      final scroll = tester
          .widget<ScrollView>(
            find.byKey(const ValueKey('conversation-message-list')),
          )
          .controller!;
      await tester.scrollUntilVisible(
        find.text('已经是第一条了'),
        500,
        scrollable: find
            .descendant(
              of: find.byKey(const ValueKey('conversation-message-list')),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      expect(scroll.offset, greaterThan(0));
      expect(find.text('已经是第一条了'), findsOneWidget);
      expect(find.text('会话历史按需从电脑读取'), findsNothing);
    },
  );

  testWidgets(
    '[MOB-MSG-006][flutter] optimistic messages and truthful Kimi activity update immediately',
    (tester) async {
      final api = _DeferredSendApi();
      final controller = workbenchController(
        api: api,
        sessions: [relaySession(provider: 'kimi')],
      )..relayKey = RelayKey.import(_testKey());
      addTearDown(controller.dispose);
      await _pumpWorkbench(tester, controller);

      await tester.enterText(find.byType(TextField).last, '检查发送状态');
      await tester.tap(find.byTooltip('发送'));
      await tester.pump();

      expect(
        find.descendant(
          of: find.byKey(const ValueKey('conversation-message-list')),
          matching: find.text('检查发送状态'),
        ),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('message-delivery-sending')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('message-delivery-sent')), findsNothing);
      final sendingIndicator = find.byKey(
        const ValueKey('message-delivery-sending'),
      );
      final pendingMessage = controller.messages['root']!.single;
      final messageBubble = find.byKey(
        ValueKey('message-bubble-${pendingMessage.id}'),
      );
      final bubbleRect = tester.getRect(messageBubble);
      final indicatorRect = tester.getRect(sendingIndicator);
      expect(indicatorRect.right, lessThanOrEqualTo(bubbleRect.right));
      expect(indicatorRect.bottom, lessThanOrEqualTo(bubbleRect.bottom));
      expect(indicatorRect.center.dx, greaterThan(bubbleRect.center.dx));
      expect(indicatorRect.center.dy, greaterThan(bubbleRect.center.dy));
      final createdAt = DateTime.parse(pendingMessage.createdAt).toLocal();
      String two(int value) => value.toString().padLeft(2, '0');
      expect(
        tester
            .widget<Text>(
              find.byKey(ValueKey('message-created-time-${pendingMessage.id}')),
            )
            .data,
        '· 今天 ${two(createdAt.hour)}:${two(createdAt.minute)}:${two(createdAt.second)}',
      );
      final clientMessageId = pendingMessage.clientMessageId!;

      api.succeed();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 20));

      expect(
        find.byKey(const ValueKey('message-delivery-sending')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('message-delivery-sent')),
        findsOneWidget,
      );
      expect(
        find.ancestor(
          of: find.byKey(const ValueKey('message-delivery-sent')),
          matching: find.byWidgetPredicate(
            (widget) =>
                widget is Semantics && widget.properties.label == '发送成功',
          ),
        ),
        findsOneWidget,
      );
      expect(controller.notice, isEmpty);
      expect(find.text('正在等待本机 Agent 接收'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('assistant-live-activity')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('assistant-running-elapsed')),
        findsNothing,
      );

      controller.applyEventForTesting(
        _event('evt_user', {
          'kind': 'user.message',
          'text': '检查发送状态',
          'client_message_id': clientMessageId,
        }),
      );
      controller.replaceSessionsForTesting([
        RelaySession.fromJson({...controller.sessions.single.raw, 'status': 'idle'}),
      ]);
      await tester.pump();
      expect(controller.sessionActivity('root'), '本机已收到，正在准备 Agent');
      expect(find.text('本机已收到，正在准备 Agent'), findsOneWidget);
      expect(find.text('正在等待本机 Agent 接收'), findsNothing);
      expect(find.byKey(const ValueKey('assistant-running-elapsed')), findsNothing);

      controller.applyEventForTesting(
        _event('evt_turn', {'kind': 'turn.started', 'turn_id': 'turn_1'}),
      );
      controller.replaceSessionsForTesting(controller.sessions);
      await tester.pump();

      expect(controller.messages['root'], hasLength(1));
      expect(controller.messages['root']!.single.id, 'evt_user');
      expect(
        find.byKey(const ValueKey('message-delivery-sent')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('assistant-live-activity')), findsNothing);

      controller.applyEventForTesting(
        _event('evt_command', {
          'kind': 'command.started',
          'turn_id': 'turn_1',
          'activity_type': 'command',
          'command': 'flutter test',
        }),
      );
      controller.replaceSessionsForTesting(controller.sessions);
      await tester.pump();
      expect(find.text('处理中'), findsOneWidget);
      expect(find.text('正在执行命令'), findsOneWidget);

      controller.applyEventForTesting(
        _event('evt_done', {'kind': 'turn.completed', 'turn_id': 'turn_1'}),
      );
      controller.replaceSessionsForTesting([
        RelaySession.fromJson({
          ...controller.sessions.single.raw,
          'status': 'idle',
        }),
      ]);
      await tester.pump();
      expect(
        find.byKey(const ValueKey('assistant-live-activity')),
        findsNothing,
      );
      expect(find.text('本轮完成'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('turn-activity-header-turn:turn_1')));
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.text('已执行命令'), findsOneWidget);
    },
  );

  testWidgets(
    '[MOB-MSG-006][flutter] receipt before HTTP response keeps preparing and replay does not revive it',
    (tester) async {
      final api = _DeferredSendApi();
      final controller = workbenchController(api: api)
        ..relayKey = RelayKey.import(_testKey());
      addTearDown(controller.dispose);
      await _pumpWorkbench(tester, controller);
      await tester.enterText(find.byType(TextField).last, '早到的回执');
      await tester.tap(find.byTooltip('发送'));
      await tester.pump();
      final clientId = controller.messages['root']!.single.clientMessageId;
      final receipt = _event('early_receipt', {
        'kind': 'user.message',
        'text': '早到的回执',
        'client_message_id': clientId,
      });
      controller.applyEventForTesting(receipt);
      controller.replaceSessionsForTesting([
        RelaySession.fromJson({...controller.sessions.single.raw, 'status': 'idle'}),
      ]);
      await tester.pump();
      expect(controller.sessionActivity('root'), '本机已收到，正在准备 Agent');
      expect(find.text('本机已收到，正在准备 Agent'), findsOneWidget);
      api.succeed();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 20));
      expect(controller.sessionActivity('root'), '本机已收到，正在准备 Agent');
      expect(find.text('本机已收到，正在准备 Agent'), findsOneWidget);
      expect(find.text('正在等待本机 Agent 接收'), findsNothing);
      controller.applyEventForTesting(
        _event('early_start', {'kind': 'turn.started', 'turn_id': 't'}),
      );
      controller.applyEventForTesting(
        _event('early_end', {'kind': 'turn.completed', 'turn_id': 't'}),
      );
      controller.applyEventForTesting(_event('replayed_receipt', receipt.event));
      controller.replaceSessionsForTesting([
        RelaySession.fromJson({...controller.sessions.single.raw, 'status': 'idle'}),
      ]);
      await tester.pump();
      expect(find.text('本机已收到，正在准备 Agent'), findsNothing);
    },
  );

  testWidgets(
    '[MOB-MSG-006][flutter] rejected receipt clears preparation and survives late HTTP success',
    (tester) async {
      final api = _DeferredSendApi();
      final controller = workbenchController(api: api)
        ..relayKey = RelayKey.import(_testKey());
      addTearDown(controller.dispose);
      await _pumpWorkbench(tester, controller);
      await tester.enterText(find.byType(TextField).last, 'rejected submission');
      await tester.tap(find.byTooltip('发送'));
      await tester.pump();
      final clientId = controller.messages['root']!.single.clientMessageId;
      controller.applyEventForTesting(_event('receipt', {
        'kind': 'user.message', 'text': 'rejected submission',
        'client_message_id': clientId,
      }));
      expect(controller.sessionActivity('root'), '本机已收到，正在准备 Agent');
      controller.applyEventForTesting(_event('older_failure', {
        'kind': 'message.failed', 'client_message_id': 'older', 'error': 'old failure',
      }));
      expect(controller.sessionActivity('root'), '本机已收到，正在准备 Agent');
      controller.applyEventForTesting(_event('failure', {
        'kind': 'message.failed', 'client_message_id': clientId, 'error': 'start rejected',
      }));
      await tester.pump();
      expect(find.text('本机已收到，正在准备 Agent'), findsNothing);
      api.succeed();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 20));
      expect(find.text('本机已收到，正在准备 Agent'), findsNothing);
      expect(find.text('正在等待本机 Agent 接收'), findsNothing);
      expect(controller.messages['root']!.firstWhere(
        (message) => message.clientMessageId == clientId,
      ).deliveryState, MessageDeliveryState.failed);
    },
  );

  test('message timestamps use calendar language before absolute dates', () {
    final now = DateTime(2026, 9, 2, 12);

    expect(
      formatMessageTimestamp('2026-09-02T08:46:23', now: now),
      '今天 08:46:23',
    );
    expect(
      formatMessageTimestamp('2026-09-01T22:18:05', now: now),
      '昨天 22:18:05',
    );
    expect(
      formatMessageTimestamp('2026-08-31T09:12:59', now: now),
      '前天 09:12:59',
    );
    expect(
      formatMessageTimestamp('2026-01-05T18:30:00', now: now),
      '1月5日 18:30:00',
    );
    expect(
      formatMessageTimestamp('2025-12-31T23:59:00', now: now),
      '2025年12月31日 23:59:00',
    );
  });

  for (final provider in const ['codex', 'kimi', 'claude', 'claude-cowork']) {
    testWidgets(
      '[MOB-MSG-006][flutter] accepted $provider activity survives a briefly idle catalog',
      (tester) async {
        final api = _DeferredSendApi();
        final controller = workbenchController(
          api: api,
          sessions: [relaySession(provider: provider)],
        )..relayKey = RelayKey.import(_testKey());
        addTearDown(controller.dispose);
        await _pumpWorkbench(tester, controller);

        await tester.enterText(find.byType(TextField).last, '检查运行状态');
        await tester.tap(find.byTooltip('发送'));
        await tester.pump();
        api.succeed();
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 20));

        controller.replaceSessionsForTesting([
          RelaySession.fromJson({
            ...controller.sessions.single.raw,
            'status': 'idle',
            'running_started_at': null,
          }),
        ]);
        await tester.pump(const Duration(seconds: 2));

        expect(find.text('正在等待本机 Agent 接收'), findsOneWidget);
        expect(
          find.byKey(const ValueKey('assistant-running-elapsed')),
          findsNothing,
        );
      },
    );
  }

  testWidgets(
    '[MOB-MSG-006][flutter] a failed optimistic message keeps its bubble and shows an exclamation mark',
    (tester) async {
      final api = _DeferredSendApi();
      final controller = workbenchController(api: api)
        ..relayKey = RelayKey.import(_testKey());
      addTearDown(controller.dispose);
      await _pumpWorkbench(tester, controller);

      await tester.enterText(find.byType(TextField).last, '这条需要重试');
      await tester.tap(find.byTooltip('发送'));
      await tester.pump();
      api.fail();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 20));

      expect(
        find.descendant(
          of: find.byKey(const ValueKey('conversation-message-list')),
          matching: find.text('这条需要重试'),
        ),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('message-delivery-failed')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('message-delivery-sending')),
        findsNothing,
      );
      expect(find.byKey(const ValueKey('message-delivery-sent')), findsNothing);
      expect(
        find.ancestor(
          of: find.byKey(const ValueKey('message-delivery-failed')),
          matching: find.byWidgetPredicate(
            (widget) =>
                widget is Semantics && widget.properties.label == '发送失败',
          ),
        ),
        findsOneWidget,
      );
      final failedMessage = controller.messages['root']!.single;
      final failedBubbleRect = tester.getRect(
        find.byKey(ValueKey('message-bubble-${failedMessage.id}')),
      );
      final failedIndicatorRect = tester.getRect(
        find.byKey(const ValueKey('message-delivery-failed')),
      );
      expect(
        failedIndicatorRect.right,
        lessThanOrEqualTo(failedBubbleRect.right),
      );
      expect(
        failedIndicatorRect.bottom,
        lessThanOrEqualTo(failedBubbleRect.bottom),
      );
      expect(
        failedIndicatorRect.center.dx,
        greaterThan(failedBubbleRect.center.dx),
      );
      expect(
        failedIndicatorRect.center.dy,
        greaterThan(failedBubbleRect.center.dy),
      );
      expect(_composerText(tester), '这条需要重试');
      expect(
        find.byKey(const ValueKey('assistant-live-activity')),
        findsNothing,
      );
    },
  );

  testWidgets(
    '[MOB-ATT-006][flutter] text and attachments restore per session with a 48dp remove target',
    (tester) async {
      final controller = workbenchController(
        sessions: [
          relaySession(id: 'root', name: 'Root'),
          relaySession(id: 'other', name: 'Other'),
        ],
      );
      addTearDown(controller.dispose);
      final store = SessionComposerDraftStore();
      store.forSession('root')
        ..text = 'Root 尚未发送的说明'
        ..replaceAttachments([_attachment()]);
      await _pumpWorkbench(tester, controller, draftStore: store);
      await tester.pump(const Duration(milliseconds: 250));

      expect(_composerText(tester), 'Root 尚未发送的说明');
      final remove = find.byTooltip('移除 draft.png');
      expect(remove, findsOneWidget);
      expect(tester.getSize(remove).width, greaterThanOrEqualTo(48));
      expect(tester.getSize(remove).height, greaterThanOrEqualTo(48));

      await tester.tap(
        find.byKey(const ValueKey('composer-attachment-draft-image')),
        warnIfMissed: false,
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(
        find.byKey(const ValueKey('composer-attachment-preview-draft-image')),
        findsOneWidget,
      );
      await tester.tap(find.byTooltip('关闭'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(store.forSession('root').attachments, hasLength(1));

      await controller.selectSession('other');
      await tester.pump(const Duration(milliseconds: 250));
      expect(_composerText(tester), isEmpty);
      await tester.enterText(find.byType(TextField).last, 'Other 的独立草稿');

      await controller.selectSession('root');
      await tester.pump(const Duration(milliseconds: 250));
      expect(_composerText(tester), 'Root 尚未发送的说明');
      expect(find.byTooltip('移除 draft.png'), findsOneWidget);

      await controller.selectSession('other');
      await tester.pump(const Duration(milliseconds: 250));
      expect(_composerText(tester), 'Other 的独立草稿');
      expect(find.byTooltip('移除 draft.png'), findsNothing);
    },
  );

  for (final accepted in [true, false]) {
    for (final sent in ['First message', 'Next thought', '']) {
      testWidgets(
        'pending send keeps focus and preserves subsequent edits on ${accepted ? "success" : "failure"} (sent=$sent)',
        (tester) async {
          final controller = _PendingComposerSendController();
          _prepareController(controller, [relaySession()]);
          addTearDown(controller.dispose);
          final store = SessionComposerDraftStore();
          store.forSession('root')
            ..text = sent
            ..replaceAttachments([_attachment()]);
          await _pumpWorkbench(tester, controller, draftStore: store);
          await tester.pump(const Duration(milliseconds: 250));
          final input = find.byKey(const ValueKey('conversation-composer-input'));
          await tester.tap(input);
          await tester.pump();
          await tester.tap(find.byKey(const ValueKey('composer-send-button')));
          await tester.pump();

          expect(tester.widget<TextField>(input).enabled, isTrue);
          expect(tester.widget<TextField>(input).focusNode!.hasFocus, isTrue);
          expect(tester.testTextInput.isVisible, isTrue);
          expect(_composerText(tester), isEmpty);
          expect(store.forSession('root').attachments, isEmpty);
          await tester.enterText(input, 'Next thought');
          await tester.pump();
          expect(controller.calls, 1);
          final editing = tester.widget<TextField>(input).controller!;
          editing.value = editing.value.copyWith(
            selection: const TextSelection.collapsed(offset: 4),
            composing: const TextRange(start: 0, end: 4),
          );
          controller.result.complete(accepted
              ? MessageSendOutcome.delivered
              : MessageSendOutcome.failed);
          await tester.pump();

          final prefix = accepted || sent.isEmpty ? '' : '$sent\n\n';
          final expectedText = '${prefix}Next thought';
          expect(editing.selection.baseOffset, 4 + prefix.length);
          expect(editing.value.composing, TextRange(start: prefix.length, end: 4 + prefix.length));
          expect(_composerText(tester), expectedText);
          expect(store.forSession('root').text, expectedText);
          expect(store.forSession('root').attachments, hasLength(accepted ? 0 : 1));
          expect(tester.widget<TextField>(input).focusNode!.hasFocus, isTrue);
          expect(tester.testTextInput.isVisible, isTrue);
        },
      );
    }
  }

  testWidgets('late failed send restores into a reopened session composer', (tester) async {
    final controller = _PendingComposerSendController();
    _prepareController(controller, [relaySession(), relaySession(id: 'other')]);
    addTearDown(controller.dispose);
    final store = SessionComposerDraftStore();
    store.forSession('root').text = 'First message';
    await _pumpWorkbench(tester, controller, draftStore: store);
    await tester.pump(const Duration(milliseconds: 250));
    await tester.tap(find.byKey(const ValueKey('composer-send-button')));
    await tester.pump();
    controller.activeSessionId = 'other';
    controller.notifyListeners();
    await tester.pump(const Duration(milliseconds: 250));
    controller.activeSessionId = 'root';
    controller.notifyListeners();
    await tester.pump(const Duration(milliseconds: 250));
    final input = find.byKey(const ValueKey('conversation-composer-input'));
    await tester.enterText(input, 'New draft');
    controller.result.complete(MessageSendOutcome.failed);
    await tester.pump();
    expect(_composerText(tester), 'First message\n\nNew draft');
    final editing = tester.widget<TextField>(input).controller!;
    editing.text += '!';
    expect(store.forSession('root').text, 'First message\n\nNew draft!');
    expect(tester.takeException(), isNull);
  });

  testWidgets('failed send restores stored draft after leaving conversation', (tester) async {
    final controller = _PendingComposerSendController();
    _prepareController(controller, [relaySession()]);
    addTearDown(controller.dispose);
    final store = SessionComposerDraftStore();
    store.forSession('root')
      ..text = 'First message'
      ..replaceAttachments([_attachment()]);
    await _pumpWorkbench(tester, controller, draftStore: store);
    await tester.pump(const Duration(milliseconds: 250));
    await tester.tap(find.byKey(const ValueKey('composer-send-button')));
    await tester.pump();
    await tester.pumpWidget(const SizedBox.shrink());
    store.forSession('root').text = 'Later thought';
    controller.result.complete(MessageSendOutcome.failed);
    await tester.pump();
    expect(store.forSession('root').text, 'First message\n\nLater thought');
    expect(store.forSession('root').attachments, hasLength(1));
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    '[MOB-ATT-007][flutter] failed send preserves composer text and attachment',
    (tester) async {
      final controller = _FailedSendController();
      _prepareController(controller, [relaySession()]);
      addTearDown(controller.dispose);
      final store = SessionComposerDraftStore();
      store.forSession('root')
        ..text = '发送失败后仍需保留'
        ..replaceAttachments([_attachment()]);
      await _pumpWorkbench(tester, controller, draftStore: store);
      await tester.pump(const Duration(milliseconds: 250));

      await tester.tap(find.byTooltip('发送'));
      await tester.pump(const Duration(milliseconds: 250));

      expect(_composerText(tester), '发送失败后仍需保留');
      expect(find.byTooltip('移除 draft.png'), findsOneWidget);
      expect(store.forSession('root').text, '发送失败后仍需保留');
      expect(store.forSession('root').attachments, hasLength(1));
    },
  );

  testWidgets(
    '[MOB-ATT-008][flutter] unsupported attachment rejection is visible',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      final outcome = await controller.sendMessage(
        '',
        attachments: [
          UploadAttachment(
            id: 'unsupported-image',
            name: 'photo.heic',
            mimeType: 'image/heic',
            bytes: base64Decode('AQ=='),
          ),
        ],
      );
      await _pumpWorkbench(tester, controller);
      await tester.pump(const Duration(milliseconds: 100));

      expect(outcome, MessageSendOutcome.rejected);
      expect(find.text('请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片。'), findsOneWidget);
    },
  );
}

RelayMessage _message(String id) => RelayMessage(
  id: id,
  role: 'codex',
  content: '刚同步的最新消息 $id',
  createdAt: '2026-08-10T11:00:00Z',
  kind: 'message.completed',
  turnId: 'turn-$id',
);

UploadAttachment _attachment() => UploadAttachment(
  id: 'draft-image',
  name: 'draft.png',
  mimeType: 'image/png',
  bytes: base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC'
    'AAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  ),
);

String _composerText(WidgetTester tester) =>
    tester.widget<TextField>(find.byType(TextField).last).controller!.text;

Future<void> _pumpWorkbench(
  WidgetTester tester,
  AppController controller, {
  SessionComposerDraftStore? draftStore,
}) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      home: AnimatedBuilder(
        animation: controller,
        builder: (context, _) =>
            WorkbenchScreen(controller: controller, draftStore: draftStore),
      ),
    ),
  );
}

void _prepareController(AppController controller, List<RelaySession> sessions) {
  controller
    ..phase = AppPhase.ready
    ..bootstrap = const ServerBootstrap(
      email: 'owner@example.com',
      device: RelayDevice(
        id: 'device',
        name: 'Test Mac',
        online: true,
        agentConnected: true,
        lastSeenAt: '2026-08-10T10:00:00Z',
      ),
      catalog: null,
      events: [],
      cursor: 0,
      ackSequence: 0,
      queuedCommands: 0,
    )
    ..sessions = sessions
    ..activeSessionId = sessions.first.id;
  for (final session in sessions) {
    controller.messages[session.id] = [];
  }
}

class _FailedSendController extends AppController {
  @override
  Future<MessageSendOutcome> sendMessage(
    String content, {
    List<UploadAttachment> attachments = const [],
  }) async => MessageSendOutcome.failed;
}

class _DeferredSendApi extends RelayApi {
  final Completer<CommandResult> _result = Completer<CommandResult>();

  void succeed() => _result.complete(
    const CommandResult(requestId: 'request_1', delivery: 'queued'),
  );

  void fail() => _result.completeError(StateError('simulated send failure'));

  @override
  Future<CommandResult> sendCommand({
    required String deviceId,
    required String? sessionId,
    required String requestId,
    required String commandType,
    required String createdAt,
    required String expiresAt,
    required RelayAad aad,
    required SealedEnvelope envelope,
  }) => _result.future;

  @override
  Future<ServerBootstrap> bootstrap({String? deviceId}) =>
      Future.error(StateError('refresh unavailable in the widget fixture'));
}

RelayEvent _event(String eventId, Map<String, dynamic> event, {
  String createdAt = '2026-08-10T12:00:00Z',
}) => RelayEvent(
  cursor: 0,
  eventId: eventId,
  sessionId: 'root',
  agentId: null,
  createdAt: createdAt,
  event: event,
);

String _testKey() => base64Url
    .encode(List<int>.generate(32, (index) => index))
    .replaceAll('=', '');

class _DeferredStopController extends AppController {
  var result = Completer<CommandResult>();
  int calls = 0;

  @override
  Future<CommandResult> sendEncryptedCommand(
    String type,
    String? sessionId,
    Map<String, dynamic> payload, {
    Duration ttl = const Duration(minutes: 5),
    String? requestId,
  }) {
    expect(type, 'session.interrupt_turn');
    expect(ttl, const Duration(seconds: 30));
    calls += 1;
    return result.future;
  }
}

class _RecordingSteerController extends AppController {
  final List<String> sent = [];
  @override
  Future<MessageSendOutcome> sendMessage(String content, {List<UploadAttachment> attachments = const []}) async {
    sent.add(content);
    return MessageSendOutcome.delivered;
  }
}

class _PendingComposerSendController extends AppController {
  final result = Completer<MessageSendOutcome>();
  int calls = 0;

  @override
  Future<MessageSendOutcome> sendMessage(
    String content, {
    List<UploadAttachment> attachments = const [],
  }) {
    calls += 1;
    return result.future;
  }
}
