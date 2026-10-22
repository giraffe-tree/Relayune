import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';

class ProjectController extends AppController {
  final requests = <Map<String, dynamic>>[];
  String? responseProvider, sessionProvider, startedProvider, sentContent;
  bool fail = false;

  @override
  Future<Map<String, dynamic>> projectRequest(
    String type,
    Map<String, dynamic> payload,
  ) async {
    requests.add(payload);
    if (fail) throw StateError('project_failed');
    return {
      'project': {
        'id': '${payload['provider']}-project',
        'name': 'Demo',
        'cwd': '/Projects/Demo',
        'provider': responseProvider ?? payload['provider'],
      },
    };
  }

  @override
  Future<void> createSessionInProject(
    RelaySession project,
    String name, {
    String? provider,
  }) async {
    startedProvider = provider;
    final session = RelaySession.fromJson({
      'id': 'new-session',
      'name': name,
      'cwd': project.cwd,
      'provider': sessionProvider ?? provider,
    });
    sessions = [session];
    activeSessionId = session.id;
  }

  @override
  Future<MessageSendOutcome> sendMessage(
    String content, {
    List<UploadAttachment> attachments = const [],
  }) async {
    sentContent = content;
    return MessageSendOutcome.delivered;
  }
}

class PagingController extends AppController {
  final cursors = <String?>[];
  bool fail = false;
  Completer<void>? pending;
  @override
  Future<Map<String, dynamic>> projectRequest(
    String type,
    Map<String, dynamic> payload,
  ) async {
    expect(type, 'project.sessions');
    cursors.add(payload['cursor'] as String?);
    if (pending != null) await pending!.future;
    if (fail) throw StateError('offline');
    final offset = payload['cursor'] == null ? 0 : 5;
    return {
      'sessions': [
        for (var i = offset; i < offset + 5; i++)
          {
            'id': 'old-$i',
            'provider': 'codex',
            'cwd': '/Projects/Demo',
            'name': 'Old $i',
          },
      ],
      'next_cursor': offset == 0 ? 'next' : null,
    };
  }
}

void main() {
  test(
    'project pages only read local sessions and never query the desktop',
    () async {
      final controller = PagingController();
      addTearDown(controller.dispose);
      final project = RelaySession.fromJson({
        'id': 'p',
        'provider': 'codex',
        'cwd': '/Projects/Demo',
      });
      controller.sessions = [
        for (var i = 0; i < 12; i++)
          RelaySession.fromJson({
            'id': 's$i',
            'provider': 'codex',
            'cwd': project.cwd,
            'updated_at': '2026-09-18T12:${i.toString().padLeft(2, '0')}:00Z',
          }),
      ];
      final first = await controller.loadProjectSessionPage(project, null);
      final second = await controller.loadProjectSessionPage(
        project,
        first['next_cursor'] as String,
      );
      expect((first['sessions'] as List).length, 5);
      expect((second['sessions'] as List).length, 5);
      expect(controller.cursors, isEmpty);
    },
  );

  for (final provider in ['codex', 'kimi', 'claude', 'opencode']) {
    test(
      '$provider project starts its first task with the same agent',
      () async {
        final controller = ProjectController();
        addTearDown(controller.dispose);
        final project = await controller.createProject(
          mode: 'new',
          path: '/Projects',
          name: 'Demo',
          provider: provider,
        );
        expect(controller.requests.single['provider'], provider);
        expect(controller.projects.single.provider, provider);
        await controller.startProjectTask(project, 'Build it');
        expect(controller.startedProvider, provider);
        expect(controller.sentContent, 'Build it');
      },
    );
  }
  test('retries reuse an operation only for the same agent', () async {
    final controller = ProjectController()..fail = true;
    addTearDown(controller.dispose);
    for (final provider in ['kimi', 'kimi', 'claude']) {
      await expectLater(
        controller.createProject(
          mode: 'new',
          path: '/Projects',
          name: 'Demo',
          provider: provider,
        ),
        throwsStateError,
      );
    }
    expect(
      controller.requests[0]['operation_id'],
      controller.requests[1]['operation_id'],
    );
    expect(
      controller.requests[0]['operation_id'],
      isNot(controller.requests[2]['operation_id']),
    );
  });
  test(
    'a mismatched project or session cannot route a prompt to another agent',
    () async {
      final controller = ProjectController()..responseProvider = 'codex';
      addTearDown(controller.dispose);
      await expectLater(
        controller.createProject(
          mode: 'new',
          path: '/Projects',
          name: 'Demo',
          provider: 'kimi',
        ),
        throwsStateError,
      );
      expect(controller.projects, isEmpty);
      controller.responseProvider = null;
      final project = await controller.createProject(
        mode: 'new',
        path: '/Projects',
        name: 'Demo',
        provider: 'kimi',
      );
      controller.sessionProvider = 'codex';
      await expectLater(
        controller.startProjectTask(project, 'Build it'),
        throwsStateError,
      );
      expect(controller.sentContent, isNull);
    },
  );
}
