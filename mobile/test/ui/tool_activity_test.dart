import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';

import '../support/workbench_fixture.dart';

void main() {
  for (final textScale in [1.0, 1.6]) {
    testWidgets(
      'turn header scrolls with its content and remains collapsible ($textScale)',
      (tester) async {
        final controller = workbenchController();
        addTearDown(controller.dispose);
        controller.messages['root'] = [
          const RelayMessage(
            id: 'sticky-user',
            role: 'user',
            content: '检查长时间线',
            createdAt: '2026-08-10T10:00:00Z',
            kind: 'user.message',
            turnId: 'sticky',
          ),
          RelayMessage(
            id: 'sticky-progress',
            role: 'codex',
            content: List.filled(40, '这是处理过程中的一段进展，继续检查界面和交互。').join('\n\n'),
            createdAt: '2026-08-10T10:00:01Z',
            kind: 'message.delta',
            messagePhase: 'commentary',
            turnId: 'sticky',
          ),
        ];
        controller.applyEventForTesting(
          _event('sticky-started', {
            'kind': 'turn.started',
            'turn_id': 'sticky',
          }),
        );
        await pumpWorkbench(tester, controller, textScale: textScale);
        for (var frame = 0; frame < 8; frame += 1) {
          await tester.pump(const Duration(milliseconds: 32));
        }
        final list = find.byKey(const ValueKey('conversation-message-list'));
        final scroll = tester.widget<ScrollView>(list).controller!;
        final header = find.byKey(
          const ValueKey('turn-activity-header-turn:sticky'),
        );
        final timeline = find.byKey(
          const ValueKey('turn-activity-timeline-turn:sticky'),
        );
        final viewportTop = tester.getTopLeft(list).dy;
        await tester.ensureVisible(header);
        await tester.pump();
        final naturalHeaderTop = tester.getTopLeft(header).dy;
        expect(naturalHeaderTop, greaterThan(viewportTop));
        final previousBodyTop = tester.getTopLeft(timeline).dy;
        scroll.jumpTo(scroll.offset - 160);
        await tester.pump();
        expect(
          tester.getTopLeft(header).dy,
          closeTo(naturalHeaderTop - 160, 1),
        );
        expect(
          tester.getTopLeft(timeline).dy,
          closeTo(previousBodyTop - 160, 1),
        );
        expect(find.byType(PinnedHeaderSliver), findsNothing);
        await tester.ensureVisible(header);
        await tester.pump();

        await tester.tap(header);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 250));
        expect(timeline, findsNothing);
        expect(header.hitTestable(), findsOneWidget);
        await tester.tap(header);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 250));
        expect(timeline, findsOneWidget);
        expect(header.hitTestable(), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }

  test('legacy Codex history reuses its command label as the preview', () {
    final message = RelayMessage.fromHistory({
      'id': 'legacy-command',
      'role': 'system',
      'content': '',
      'created_at': '2026-08-30T10:00:00Z',
      'turn_id': 'turn-legacy',
      'kind': 'tool_activity',
      'tool_activity_label': 'npm run mobile:check',
      'tool_activity_type': 'command',
      'tool_activity_status': 'completed',
    });

    expect(message.toolActivityCommand, 'npm run mobile:check');
  });

  test('legacy shell command arrays keep only the readable command', () {
    final message = RelayMessage.fromHistory({
      'id': 'legacy-command-array',
      'role': 'system',
      'content': '',
      'created_at': '2026-08-30T10:00:00Z',
      'turn_id': 'turn-legacy',
      'kind': 'tool_activity',
      'tool_activity_label': ['/bin/zsh', '-lc', 'npm run mobile:check'],
      'tool_activity_type': 'command',
      'tool_activity_status': 'completed',
    });

    expect(message.toolActivityLabel, 'npm run mobile:check');
    expect(message.toolActivityCommand, 'npm run mobile:check');
  });

  for (final fixture in const [
    (provider: 'codex', agent: 'Codex', completedKind: 'command.output'),
    (
      provider: 'claude',
      agent: 'Claude Code',
      completedKind: 'command.completed',
    ),
  ]) {
    testWidgets(
      '${fixture.agent} tool lifecycle stays visible in the active turn timeline',
      (tester) async {
        final controller = workbenchController(
          sessions: [relaySession(provider: fixture.provider)],
        );
        addTearDown(controller.dispose);
        controller.messages['root'] = const [
          RelayMessage(
            id: 'user-1',
            role: 'user',
            content: '运行检查',
            createdAt: '2026-08-10T10:00:00Z',
            kind: 'user.message',
            turnId: 'turn-1',
          ),
        ];
        controller.applyEventForTesting(
          _event('turn-started', {'kind': 'turn.started', 'turn_id': 'turn-1'}),
        );

        await pumpWorkbench(tester, controller);
        expect(find.byKey(const ValueKey('assistant-live-activity')), findsNothing);

        controller.applyEventForTesting(
          _event('tool-started', {
            'kind': 'command.started',
            'turn_id': 'turn-1',
            'item_id': 'tool-1',
            'activity_type': 'command',
            'command': ['/bin/zsh', '-lc', 'npm test'],
            'status': 'in_progress',
          }),
        );
        controller.replaceSessionsForTesting(controller.sessions);
        await tester.pump();
        expect(find.byKey(const ValueKey('tool-activity-running-icon-command_turn-1_tool-1')), findsOneWidget);
        expect(find.text('正在执行命令'), findsOneWidget);
        expect(find.text(' · npm test'), findsOneWidget);
        expect(
          tester
              .widget<Text>(
                find.byKey(
                  const ValueKey(
                    'tool-activity-command-preview-command_turn-1_tool-1',
                  ),
                ),
              )
              .textDirection,
          TextDirection.ltr,
        );
        expect(
          find.byKey(
            const ValueKey('tool-activity-running-icon-command_turn-1_tool-1'),
          ),
          findsOneWidget,
        );
        expect(
          find.byKey(
            const ValueKey(
              'tool-activity-completed-icon-command_turn-1_tool-1',
            ),
          ),
          findsNothing,
        );
        expect(
          find.byKey(const ValueKey('turn-activity-timeline-turn:turn-1')),
          findsOneWidget,
        );
        expect(
          tester
              .widget<Container>(
                find.byKey(
                  const ValueKey('tool-activity-command_turn-1_tool-1'),
                ),
              )
              .decoration,
          isNull,
        );
        final timelineDecoration =
            tester
                    .widget<Container>(
                      find.byKey(
                        const ValueKey('turn-activity-timeline-turn:turn-1'),
                      ),
                    )
                    .decoration
                as BoxDecoration;
        expect(
          (timelineDecoration.border! as Border).left.style,
          BorderStyle.solid,
        );
        expect(
          tester
              .getSize(
                find.byKey(
                  const ValueKey('tool-activity-command_turn-1_tool-1'),
                ),
              )
              .height,
          lessThanOrEqualTo(44),
        );
        expect(
          controller.messages['root']!.where(
            (message) => message.toolActivityLabel != null,
          ),
          hasLength(1),
        );

        controller.applyEventForTesting(
          _event('tool-output', {
            'kind': fixture.completedKind,
            'turn_id': 'turn-1',
            'item_id': 'tool-1',
            'activity_type': 'command',
            'text': 'All checks passed.',
            'status': 'completed',
          }),
        );
        controller.replaceSessionsForTesting(controller.sessions);
        await tester.pump();
        expect(find.text('正在执行命令'), findsNothing);
        expect(find.text('已执行命令'), findsOneWidget);
        expect(
          find.byKey(
            const ValueKey('tool-activity-running-icon-command_turn-1_tool-1'),
          ),
          findsNothing,
        );
        expect(
          find.byKey(
            const ValueKey(
              'tool-activity-completed-icon-command_turn-1_tool-1',
            ),
          ),
          findsOneWidget,
        );
        expect(
          controller.messages['root']!.where(
            (message) => message.toolActivityLabel != null,
          ),
          hasLength(1),
        );
        expect(find.text('All checks passed.'), findsNothing);

        final outputTile = find.descendant(
          of: find.byKey(
            const ValueKey('tool-activity-output-command_turn-1_tool-1'),
          ),
          matching: find.byType(ListTile),
        );
        await tester.ensureVisible(outputTile);
        tester.widget<ListTile>(outputTile).onTap!();
        await tester.pump(const Duration(milliseconds: 350));
        expect(find.text('All checks passed.'), findsOneWidget);
        expect(
          tester
              .widget<SelectableText>(
                find.byKey(
                  const ValueKey('tool-activity-detail-command_turn-1_tool-1'),
                ),
              )
              .textDirection,
          TextDirection.ltr,
        );

        controller.applyEventForTesting(
          _event('turn-completed', {
            'kind': 'turn.completed',
            'turn_id': 'turn-1',
          }),
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
      },
    );
  }

  testWidgets('consecutive mobile commands collapse into one previewable group', (
    tester,
  ) async {
    final controller = workbenchController(
      sessions: [relaySession(provider: 'codex')],
    );
    addTearDown(controller.dispose);
    controller.applyEventForTesting(
      _event('turn-grouped', {
        'kind': 'turn.started',
        'turn_id': 'turn-grouped',
      }),
    );
    for (final command in const [
      (id: 'command-1', text: 'flutter analyze'),
      (id: 'command-2', text: 'flutter test'),
    ]) {
      controller.applyEventForTesting(
        _event('${command.id}-completed', {
          'kind': 'command.completed',
          'turn_id': 'turn-grouped',
          'item_id': command.id,
          'activity_type': 'command',
          'command': command.text,
          'status': 'completed',
        }),
      );
    }
    controller.applyEventForTesting(
      _event('command-3-started', {
        'kind': 'command.started',
        'turn_id': 'turn-grouped',
        'item_id': 'command-3',
        'activity_type': 'command',
        'command': 'flutter build ios',
        'status': 'in_progress',
      }),
    );

    await pumpWorkbench(tester, controller);

    expect(find.text('正在执行 3 个命令'), findsOneWidget);
    expect(
      find.byKey(
        const ValueKey(
          'command-activity-group-running-icon-command_turn-grouped_command-1',
        ),
      ),
      findsOneWidget,
    );
    expect(
      find.byKey(
        const ValueKey(
          'command-activity-group-completed-icon-command_turn-grouped_command-1',
        ),
      ),
      findsNothing,
    );

    controller.applyEventForTesting(
      _event('command-3-completed', {
        'kind': 'command.completed',
        'turn_id': 'turn-grouped',
        'item_id': 'command-3',
        'activity_type': 'command',
        'command': 'flutter build ios',
        'status': 'completed',
      }),
    );
    controller.applyEventForTesting(
      _event('search-completed', {
        'kind': 'command.completed',
        'turn_id': 'turn-grouped',
        'item_id': 'search-1',
        'activity_type': 'web_search',
        'activity_subject': 'Relayune docs',
        'status': 'completed',
      }),
    );
    controller.replaceSessionsForTesting(controller.sessions);
    await tester.pump();

    expect(find.text('已执行 3 个命令'), findsOneWidget);
    expect(find.text(' · flutter build ios'), findsOneWidget);
    expect(find.text('已执行命令'), findsNothing);
    expect(
      find.byKey(
        const ValueKey(
          'command-activity-group-running-icon-command_turn-grouped_command-1',
        ),
      ),
      findsNothing,
    );
    expect(
      find.byKey(
        const ValueKey(
          'command-activity-group-completed-icon-command_turn-grouped_command-1',
        ),
      ),
      findsOneWidget,
    );
    expect(find.text('已搜索网页：Relayune docs'), findsOneWidget);

    final groupTitleLeft = tester.getTopLeft(find.text('已执行 3 个命令')).dx;
    final siblingTitleLeft = tester
        .getTopLeft(find.text('已搜索网页：Relayune docs'))
        .dx;
    expect(groupTitleLeft, closeTo(siblingTitleLeft, 0.1));

    final groupTile = find.descendant(
      of: find.byKey(
        const ValueKey(
          'command-activity-group-output-command_turn-grouped_command-1',
        ),
      ),
      matching: find.byType(ListTile),
    );
    tester.widget<ListTile>(groupTile).onTap!();
    await tester.pump(const Duration(milliseconds: 350));

    expect(find.text('已执行命令'), findsNWidgets(3));
    expect(find.text(' · flutter analyze'), findsOneWidget);
    expect(find.text(' · flutter test'), findsOneWidget);
    expect(find.text(' · flutter build ios'), findsNWidgets(2));
  });

  testWidgets('file change events merge with adjacent command activity', (
    tester,
  ) async {
    final controller = workbenchController(
      sessions: [relaySession(provider: 'codex')],
    );
    addTearDown(controller.dispose);
    controller.applyEventForTesting(
      _event('turn-mixed', {'kind': 'turn.started', 'turn_id': 'turn-mixed'}),
    );
    controller.applyEventForTesting(
      _event('command-1-completed', {
        'kind': 'command.completed',
        'turn_id': 'turn-mixed',
        'item_id': 'command-1',
        'activity_type': 'command',
        'command': 'git diff --check',
        'status': 'completed',
      }),
    );
    controller.applyEventForTesting(
      _event('files-changed', {
        'kind': 'file.changed',
        'turn_id': 'turn-mixed',
        'changes': [
          {'path': 'mobile/lib/src/state/app_controller.dart', 'kind': 'edit'},
          {'path': 'mobile/test/ui/tool_activity_test.dart', 'kind': 'edit'},
        ],
      }),
    );
    controller.applyEventForTesting(
      _event('command-2-started', {
        'kind': 'command.started',
        'turn_id': 'turn-mixed',
        'item_id': 'command-2',
        'activity_type': 'command',
        'command': 'flutter test',
        'status': 'in_progress',
      }),
    );

    await pumpWorkbench(tester, controller);

    expect(find.text('正在处理 3 项文件与命令操作'), findsOneWidget);
    expect(find.text('已执行命令'), findsNothing);
    expect(find.textContaining('修改 2 个文件：'), findsNothing);

    final groupTile = find.descendant(
      of: find.byKey(
        const ValueKey(
          'tool-activity-group-output-command_turn-mixed_command-1',
        ),
      ),
      matching: find.byType(ListTile),
    );
    tester.widget<ListTile>(groupTile).onTap!();
    await tester.pump(const Duration(milliseconds: 350));

    expect(find.text('已执行命令'), findsOneWidget);
    expect(
      find.text(
        '已修改 2 个文件：mobile/lib/src/state/app_controller.dart、'
        'mobile/test/ui/tool_activity_test.dart',
      ),
      findsOneWidget,
    );
    expect(find.text('正在执行命令'), findsOneWidget);
  });

  testWidgets(
    'file reads and edits collapse together and reveal their file names',
    (tester) async {
      final controller = workbenchController(
        sessions: [relaySession(provider: 'codex')],
      );
      addTearDown(controller.dispose);
      controller.applyEventForTesting(
        _event('turn-files', {'kind': 'turn.started', 'turn_id': 'turn-files'}),
      );
      for (final activity in const [
        (id: 'read-1', type: 'file_read', subject: 'workbench_screen.dart'),
        (id: 'change-1', type: 'file_change', subject: 'app_controller.dart'),
        (id: 'change-2', type: 'file_change', subject: 'workbench-page.tsx'),
      ]) {
        controller.applyEventForTesting(
          _event('${activity.id}-completed', {
            'kind': 'command.completed',
            'turn_id': 'turn-files',
            'item_id': activity.id,
            'activity_type': activity.type,
            'activity_subject': activity.subject,
            'activity_count': 1,
            'status': 'completed',
          }),
        );
      }

      await pumpWorkbench(tester, controller);

      expect(find.text('已完成 3 项文件与命令操作'), findsOneWidget);
      expect(
        find.text(
          ' · workbench_screen.dart、app_controller.dart、workbench-page.tsx',
        ),
        findsOneWidget,
      );
      expect(find.text('已读取文件：workbench_screen.dart'), findsNothing);
      expect(find.text('已修改文件：app_controller.dart'), findsNothing);

      final groupTile = find.descendant(
        of: find.byKey(
          const ValueKey(
            'tool-activity-group-output-command_turn-files_read-1',
          ),
        ),
        matching: find.byType(ListTile),
      );
      tester.widget<ListTile>(groupTile).onTap!();
      await tester.pump(const Duration(milliseconds: 350));

      expect(find.text('已读取文件：workbench_screen.dart'), findsOneWidget);
      expect(find.text('已修改文件：app_controller.dart'), findsOneWidget);
      expect(find.text('已修改文件：workbench-page.tsx'), findsOneWidget);
    },
  );

  testWidgets(
    'structured Codex tools show the current action, not only a spinner',
    (tester) async {
      final controller = workbenchController(
        sessions: [relaySession(provider: 'codex')],
      );
      addTearDown(controller.dispose);
      controller.applyEventForTesting(
        _event('turn-structured', {
          'kind': 'turn.started',
          'turn_id': 'turn-structured',
        }),
      );
      controller.applyEventForTesting(
        _event('search-started', {
          'kind': 'command.started',
          'turn_id': 'turn-structured',
          'item_id': 'search-1',
          'activity_type': 'web_search',
          'activity_subject': 'Relayune docs',
        }),
      );

      await pumpWorkbench(tester, controller);
      expect(find.byKey(const ValueKey('tool-activity-running-icon-command_turn-structured_search-1')), findsOneWidget);
      expect(find.text('正在搜索网页：Relayune docs'), findsOneWidget);
    },
  );

  for (final provider in ['codex', 'claude']) {
  testWidgets(
    '[MOB-ATT-010][flutter] $provider tool images expand to an on-demand preview',
    (tester) async {
      final controller = workbenchController(
        sessions: [relaySession(provider: provider)],
      );
      addTearDown(controller.dispose);
      controller.applyEventForTesting(
        _event('turn-image', {'kind': 'turn.started', 'turn_id': 'turn-image'}),
      );
      controller.applyEventForTesting(
        _event('image-completed', {
          'kind': 'command.completed',
          'turn_id': 'turn-image',
          'item_id': 'image-1',
          'activity_type': provider == 'codex' ? 'image_view' : 'command',
          'activity_subject': 'workbench.png',
          'status': 'completed',
          'attachments': [
            {
              'id': 'viewed-workbench',
              'type': 'image',
              'name': 'workbench.png',
              'mime_type': 'image/png',
              'url': '/api/sessions/root/attachments/viewed-workbench',
            },
          ],
        }),
      );
      final activity = controller.messages['root']!.singleWhere(
        (message) => message.attachments.isNotEmpty,
      );
      expect(activity.attachments.single.name, 'workbench.png');
      controller.messages['root'] = [
        activity.copyWith(
          attachments: [
            RelayAttachment(
              id: 'viewed-workbench',
              type: 'image',
              name: 'workbench.png',
              mimeType: 'image/png',
              url: '/api/sessions/root/attachments/viewed-workbench',
              localBytes: base64Decode(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC'
                'AAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
              ),
            ),
          ],
        ),
      ];

      await pumpWorkbench(tester, controller);

      if (provider == 'codex') expect(find.text('已查看图像：workbench.png'), findsOneWidget);
      expect(find.text('执行命令失败'), findsNothing);
      expect(
        find.byKey(const ValueKey('message-image-thumbnail-viewed-workbench')),
        findsNothing,
      );

      final imageTile = find.descendant(
        of: find.byKey(
          const ValueKey('tool-activity-output-command_turn-image_image-1'),
        ),
        matching: find.byType(ListTile),
      );
      tester.widget<ListTile>(imageTile).onTap!();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pump();

      final thumbnail = find.byKey(
        const ValueKey('message-image-thumbnail-viewed-workbench'),
      );
      expect(thumbnail, findsOneWidget);
      expect(tester.getSize(thumbnail), const Size.square(120));

      final previewInkWell = tester
          .widgetList<InkWell>(
            find.ancestor(of: thumbnail, matching: find.byType(InkWell)),
          )
          .firstWhere(
            (inkWell) => inkWell.borderRadius == BorderRadius.circular(9),
          );
      previewInkWell.onTap!();
      await tester.pump(const Duration(milliseconds: 250));
      expect(find.byType(InteractiveViewer), findsOneWidget);
      expect(
        find.byKey(
          const ValueKey('message-image-dialog-preview-viewed-workbench'),
        ),
        findsOneWidget,
      );
      expect(
        find.byKey(
          const ValueKey('message-image-load-original-viewed-workbench'),
        ),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('message-image-original-viewed-workbench')),
        findsNothing,
      );
    },
  );
  }
}

RelayEvent _event(String eventId, Map<String, dynamic> event) => RelayEvent(
  cursor: 0,
  eventId: eventId,
  sessionId: 'root',
  agentId: null,
  createdAt: '2026-08-10T10:00:01Z',
  event: event,
);
