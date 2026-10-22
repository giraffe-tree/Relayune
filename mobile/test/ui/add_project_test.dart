import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/ui/add_project_screen.dart';
import 'package:relayune_mobile/src/ui/theme.dart';

class ProjectController extends AppController {
  bool isOnline = true;
  String? submittedPath, submittedMode, submittedName, submittedProvider;
  final requestProviders = <String?>[];
  final requests = <String>[];
  Future<Map<String, dynamic>> Function(Map<String, dynamic>)? check;

  List<Map<String, dynamic>> locations = [
    {
      'path': '/Projects',
      'name': 'Projects',
      'projects': ['Relayune', 'Website'],
      'available': true,
      'writable': true,
    },
    {
      'path': '/Design',
      'name': 'Design',
      'projects': ['Sketchbook'],
      'available': true,
      'writable': true,
    },
    {
      'path': '/Private',
      'name': 'Private',
      'projects': ['Old'],
      'available': false,
      'writable': false,
      'error_code': 'permission_denied',
    },
  ];
  @override
  bool get deviceOnline => isOnline;
  @override
  Future<Map<String, dynamic>> projectRequest(
    String type,
    Map<String, dynamic> payload,
  ) async {
    requests.add(type);
    requestProviders.add(payload['provider'] as String?);
    if (type == 'project.check') {
      if (check != null) return check!(payload);
      return {
        'path': '${payload['path']}/${payload['name']}',
        'can_create': true,
      };
    }
    return type == 'project.locations'
        ? {'locations': locations}
        : {
            'path': payload['path'],
            'parent': null,
            'directories': [
              {'path': '${payload['path']}/Sibling', 'name': 'Sibling'},
            ],
            'next_offset': null,
          };
  }

  @override
  Future<RelayProject> createProject({
    required String mode,
    required String path,
    required String name,
    required String provider,
  }) async {
    submittedProvider = provider;
    submittedPath = path;
    submittedMode = mode;
    submittedName = name;
    return RelayProject(
      id: 'new-project',
      name: name,
      cwd: '$path/$name',
      updatedAt: '',
      provider: provider,
    );
  }
}

Future<ProjectController> pump(
  WidgetTester tester, {
  ProjectController? fixture,
  String provider = 'codex',
}) async {
  tester.view.physicalSize = const Size(390, 1100);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final controller = fixture ?? ProjectController();
  addTearDown(controller.dispose);
  await tester.pumpWidget(
    MaterialApp(
      theme: RelayTheme.web,
      locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: AddProjectScreen(controller: controller, provider: provider),
    ),
  );
  await tester.pumpAndSettle();
  return controller;
}

void main() {
  for (final provider in [
    'codex',
    'kimi',
    'claude',
    'claude-cowork',
    'opencode',
  ]) {
    testWidgets('creates a project for $provider and preserves request routing', (
      tester,
    ) async {
      final controller = await pump(tester, provider: provider);
      await tester.enterText(
        find.byKey(const ValueKey('new-project-name')),
        'Demo',
      );
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      await tester.ensureVisible(
        find.byKey(const ValueKey('create-project-submit')),
      );
      await tester.tap(find.byKey(const ValueKey('create-project-submit')));
      await tester.pumpAndSettle();
      expect(controller.submittedProvider, provider);
      expect(controller.submittedName, 'Demo');
      expect(controller.requestProviders, isNotEmpty);
      expect(
        controller.requestProviders.every((value) => value == provider),
        isTrue,
      );
      expect(find.text('Project ready'), findsOneWidget);
      expect(
        find.text('Start task'),
        provider == 'claude-cowork' ? findsNothing : findsOneWidget,
      );
      if (provider == 'claude-cowork') {
        expect(
          find.text(
            'Create a session with this folder in Claude Desktop, then return to Relayune.',
          ),
          findsOneWidget,
        );
      }
    });
  }

  testWidgets(
    'check gates creation and ignores stale results after name changes',
    (tester) async {
      final fixture = ProjectController();
      final checks = <Completer<Map<String, dynamic>>>[];
      fixture.check = (_) {
        final check = Completer<Map<String, dynamic>>();
        checks.add(check);
        return check.future;
      };
      await pump(tester, fixture: fixture);
      final name = find.byKey(const ValueKey('new-project-name'));
      final submit = find.byKey(const ValueKey('create-project-submit'));
      bool enabled() => tester.widget<FilledButton>(submit).onPressed != null;
      await tester.enterText(name, 'Old');
      await tester.pump(const Duration(milliseconds: 350));
      expect(enabled(), false);
      await tester.enterText(name, 'Latest');
      await tester.pump(const Duration(milliseconds: 350));
      checks[0].complete({'path': '/Projects/Old', 'can_create': true});
      await tester.pump();
      expect(enabled(), false);
      expect(find.text('/Projects/Old'), findsNothing);
      checks[1].completeError(StateError('already_exists'));
      await tester.pumpAndSettle();
      expect(enabled(), false);
      expect(
        find.text(
          'A folder with this name exists. Add it using Existing folder.',
        ),
        findsOneWidget,
      );
      await tester.ensureVisible(find.text('Check again'));
      await tester.tap(find.text('Check again'));
      await tester.pump(const Duration(milliseconds: 350));
      checks[2].complete({'path': '/canonical/Latest', 'can_create': true});
      await tester.pumpAndSettle();
      expect(enabled(), true);
      expect(find.text('/canonical/Latest'), findsOneWidget);
      await tester.tap(find.text('Design'));
      await tester.pump();
      expect(enabled(), false);
      await tester.pump(const Duration(milliseconds: 350));
      checks[3].completeError(StateError('permission_denied'));
      await tester.pumpAndSettle();
      expect(enabled(), false);
    },
  );

  testWidgets(
    '[MOB-PRJ-015][flutter] select an existing project parent and create without entering a path',
    (tester) async {
      tester.view.physicalSize = const Size(390, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final controller = await pump(tester);
      await tester.enterText(
        find.byKey(const ValueKey('new-project-name')),
        'New idea',
      );
      await tester.tap(find.text('Design'));
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();
      expect(find.text('/Design/New idea'), findsOneWidget);
      final submit = find.byKey(const ValueKey('create-project-submit'));
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(controller.submittedPath, '/Design');
      expect(controller.submittedName, 'New idea');
      expect(controller.submittedMode, 'new');
      expect(find.text('Project ready'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'existing folder navigation starts from a parent shortcut and returns selected folder',
    (tester) async {
      final controller = await pump(tester);
      await tester.tap(find.text('Existing folder'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Design'));
      await tester.pumpAndSettle();
      expect(find.text('Sibling'), findsOneWidget);
      await tester.tap(find.text('Sibling'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Select this folder'));
      await tester.pumpAndSettle();
      final submit = find.byKey(const ValueKey('create-project-submit'));
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(controller.submittedPath, '/Design/Sibling');
      expect(controller.submittedMode, 'existing');
    },
  );
  testWidgets('offline and inaccessible parents cannot create a project', (
    tester,
  ) async {
    final controller = await pump(tester);
    final blocked = tester.widget<ListTile>(
      find.widgetWithText(ListTile, 'Private'),
    );
    expect(blocked.enabled, true);
    await tester.tap(find.text('Private'));
    await tester.pumpAndSettle();
    expect(
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.text('Permission unavailable. Choose another location.'),
      ),
      findsOneWidget,
    );
    expect(controller.requests, ['project.locations']);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    controller.isOnline = false;
    await tester.enterText(
      find.byKey(const ValueKey('new-project-name')),
      'New idea',
    );
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const ValueKey('create-project-submit')),
          )
          .onPressed,
      isNull,
    );
  });
  testWidgets(
    'usable locations stay visible ahead of unavailable suggestions',
    (tester) async {
      final fixture = ProjectController();
      final blocked = fixture.locations.last;
      fixture.locations = [
        for (var i = 0; i < 4; i++)
          {...blocked, 'path': '/Locked$i', 'name': 'Locked$i'},
        fixture.locations.first,
      ];
      await pump(tester, fixture: fixture);
      expect(find.text('Projects'), findsOneWidget);
      expect(find.text('Locked2'), findsNothing);
      await tester.tap(find.text('Projects'));
      await tester.enterText(
        find.byKey(const ValueKey('new-project-name')),
        'Test',
      );
      await tester.pumpAndSettle();
      expect(find.text('/Projects/Test'), findsOneWidget);
    },
  );

  testWidgets(
    'refresh after OS access is restored selects the requested folder and keeps the name',
    (tester) async {
      final controller = await pump(tester);
      await tester.enterText(
        find.byKey(const ValueKey('new-project-name')),
        'Test',
      );
      await tester.tap(find.text('Private'));
      await tester.pumpAndSettle();
      controller.locations.last = {
        ...controller.locations.last,
        'available': true,
        'writable': true,
      };
      await tester.tap(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.text('Refresh locations'),
        ),
      );
      await tester.pumpAndSettle();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();
      expect(find.text('/Private/Test'), findsOneWidget);
      expect(controller.submittedPath, isNull);
      final submit = find.byKey(const ValueKey('create-project-submit'));
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(controller.submittedPath, '/Private');
      expect(controller.submittedName, 'Test');
    },
  );

  testWidgets(
    'refresh without OS access cannot select or browse the blocked folder',
    (tester) async {
      final fixture = ProjectController();
      fixture.locations = [fixture.locations.last];
      final controller = await pump(tester, fixture: fixture);
      await tester.enterText(
        find.byKey(const ValueKey('new-project-name')),
        'Test',
      );
      await tester.tap(find.text('Private'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.text('Refresh locations'),
        ),
      );
      await tester.pumpAndSettle();
      expect(controller.requests, ['project.locations', 'project.locations']);
      expect(find.text('/Private/Test'), findsNothing);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('create-project-submit')),
            )
            .onPressed,
        isNull,
      );
      expect(controller.submittedPath, isNull);
    },
  );

  testWidgets('existing folder mode browses after OS read access is restored', (
    tester,
  ) async {
    final controller = await pump(tester);
    await tester.tap(find.text('Existing folder'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Private'));
    await tester.pumpAndSettle();
    expect(controller.requests, ['project.locations']);
    controller.locations.last = {
      ...controller.locations.last,
      'available': true,
      'writable': false,
    };
    await tester.tap(
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.text('Refresh locations'),
      ),
    );
    await tester.pumpAndSettle();
    expect(controller.requests.last, 'project.browse');
    expect(find.text('Sibling'), findsOneWidget);
    expect(controller.submittedPath, isNull);
  });
}
