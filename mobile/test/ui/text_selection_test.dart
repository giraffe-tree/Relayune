import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/widgets/relay_text_selection.dart';

import '../support/workbench_fixture.dart';

void main() {
  testWidgets(
    '[MOB-TXT-001][flutter] messages copy across paragraphs without an input connection',
    (tester) async {
      final controller = workbenchController();
      addTearDown(controller.dispose);
      controller.messages['root'] = const [
        RelayMessage(
          id: 'user',
          role: 'user',
          content: 'Copy this message',
          kind: 'user.message',
          createdAt: '2026-09-05T10:00:00Z',
        ),
        RelayMessage(
          id: 'reply',
          role: 'codex',
          content:
              '**Copy** this reply\n\nSecond paragraph\n\n```text\ncode line\n```\n\nLast paragraph',
          kind: 'message.completed',
          createdAt: '2026-09-05T10:00:01Z',
        ),
      ];
      String? clipboard;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData') {
            clipboard = (call.arguments as Map)['text'] as String;
          }
          if (call.method == 'Clipboard.getData') return {'text': clipboard};
          if (call.method == 'Clipboard.hasStrings') {
            return {'value': clipboard?.isNotEmpty == true};
          }
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          null,
        ),
      );
      await pumpWorkbench(
        tester,
        controller,
        supportsShowingSystemContextMenu: true,
        disableAnimations: true,
      );
      await tester.pump(const Duration(milliseconds: 300));
      final composer = find.byKey(
        const ValueKey('conversation-composer-input'),
      );
      await tester.enterText(composer, 'Preserved draft');
      for (final expected in ['Copy this message', 'Copy this reply']) {
        final text = find.text(expected);
        expect(text, findsOneWidget);
        await tester.ensureVisible(text);
        await tester.longPress(text);
        await tester.pump();
        expect(tester.takeException(), isNull);
        expect(find.byType(SystemContextMenu), findsNothing);
        if (defaultTargetPlatform == TargetPlatform.iOS) {
          expect(find.byType(CupertinoTextSelectionToolbar), findsOneWidget);
        } else {
          expect(find.byType(AdaptiveTextSelectionToolbar), findsOneWidget);
        }
        final selection = tester
            .state<SelectionAreaState>(
              find
                  .ancestor(of: text, matching: find.byType(SelectionArea))
                  .first,
            )
            .selectableRegion;
        selection.selectAll(SelectionChangedCause.toolbar);
        await tester.pump();
        final copy = selection.contextMenuButtonItems.singleWhere(
          (item) => item.type == ContextMenuButtonType.copy,
        );
        copy.onPressed!();
        await tester.pump();
        expect(
          clipboard?.replaceAll(RegExp(r'\s+'), ' ').trim(),
          expected == 'Copy this reply'
              ? 'Copy this reply Second paragraph code line Last paragraph'
              : expected,
        );
        expect(
          tester.widget<TextField>(composer).controller!.text,
          'Preserved draft',
        );
        expect(tester.takeException(), isNull);
      }
      await tester.tap(composer);
      await tester.enterText(composer, 'Still editable');
      expect(
        tester.widget<TextField>(composer).controller!.text,
        'Still editable',
      );
      expect(tester.takeException(), isNull);
    },
    variant: TargetPlatformVariant({
      TargetPlatform.iOS,
      TargetPlatform.android,
    }),
  );

  testWidgets(
    '[MOB-APR-003][flutter] selecting an approval then closing the tray leaves no broken menu',
    (tester) async {
      final controller = workbenchController(
        approvals: [
          RelayApproval(
            id: 'selection',
            sessionId: 'root',
            action: const {
              'type': 'question.select',
              'display': 'Select a device',
              'options': [],
            },
            riskLevel: 'medium',
            state: 'pending',
            requestedAt: '2026-09-05T10:00:00Z',
            expiresAt: DateTime.now()
                .add(const Duration(hours: 1))
                .toUtc()
                .toIso8601String(),
          ),
        ],
      );
      addTearDown(controller.dispose);
      await pumpWorkbench(
        tester,
        controller,
        supportsShowingSystemContextMenu: true,
      );
      await tester.longPress(
        find.byKey(const ValueKey('conversation-approval-selection-display')),
      );
      await tester.pump();
      expect(find.byType(SystemContextMenu), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.tap(
        find.byKey(const ValueKey('conversation-activity-panel-close')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.enterText(
        find.byKey(const ValueKey('conversation-composer-input')),
        'After closing',
      );
      expect(tester.takeException(), isNull);
      expect(find.byType(SystemContextMenu), findsNothing);
      expect(controller.pendingApprovalCount, 1);
    },
    variant: TargetPlatformVariant.only(TargetPlatform.iOS),
  );

  testWidgets(
    'selection fallback preserves layout metrics and leaves Android unchanged',
    (tester) async {
      const data = MediaQueryData(
        size: Size(390, 844),
        viewInsets: EdgeInsets.only(bottom: 280),
        padding: EdgeInsets.only(bottom: 24),
        textScaler: TextScaler.linear(1.3),
        supportsShowingSystemContextMenu: true,
      );
      final platform = defaultTargetPlatform;
      {
        late MediaQueryData effective;
        await tester.pumpWidget(
          MediaQuery(
            data: data,
            child: RelayTextSelection(
              child: Builder(
                builder: (context) {
                  effective = MediaQuery.of(context);
                  return const SizedBox();
                },
              ),
            ),
          ),
        );
        expect(
          effective.supportsShowingSystemContextMenu,
          platform != TargetPlatform.iOS,
        );
        expect(effective.size, data.size);
        expect(effective.viewInsets, data.viewInsets);
        expect(effective.padding, data.padding);
        expect(effective.textScaler, data.textScaler);
      }
    },
    variant: TargetPlatformVariant({
      TargetPlatform.iOS,
      TargetPlatform.android,
    }),
  );
}
