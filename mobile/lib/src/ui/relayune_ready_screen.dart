import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/gestures.dart';

import '../../l10n/relayune_localizations.dart';
import '../state/app_controller.dart';
import '../state/computer_connections.dart';
import '../state/session_composer_drafts.dart';
import '../state/home_care.dart';
import '../state/session_reading_positions.dart';
import 'workbench_home_page.dart';
import 'workbench_screen.dart';
import '../widgets/visible_route_builder.dart';

/// Keeps the lightweight home overview separate from the full conversation
/// workbench. The workbench is pushed only when a session or navigation entry
/// is opened, so the phone never needs a persistent bottom navigation bar.
class RelayuneReadyScreen extends StatefulWidget {
  const RelayuneReadyScreen({
    super.key,
    required this.controller,
    this.connections,
  });

  final AppController controller;
  final ComputerConnections? connections;

  @override
  State<RelayuneReadyScreen> createState() => _RelayuneReadyScreenState();
}

class _RelayuneReadyScreenState extends State<RelayuneReadyScreen>
    with WidgetsBindingObserver {
  bool _workbenchOpen = false;
  final _homeKey = GlobalKey<ScaffoldState>();
  final _positions = <AppController, SessionReadingPositions>{};
  final _drafts = <AppController, SessionComposerDraftStore>{};
  final _navigationRevisions = <AppController, int>{};
  AppController? _selectedComputer;
  AppController get _homeController =>
      (widget.connections == null ||
              widget.connections!.computers.contains(_selectedComputer)
          ? _selectedComputer
          : null) ??
      widget.connections?.readyComputers.firstOrNull ??
      widget.connections?.computers.firstOrNull ??
      widget.controller;
  AppController? _workbenchController;
  HomeCareActivity _careActivity = HomeCareActivity();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // This screen stays mounted under conversation routes. Observe only touch
    // timestamps so returning home includes interaction in those conversations.
    GestureBinding.instance.pointerRouter.addGlobalRoute(_onPointer);
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    if (lifecycle != null && lifecycle != AppLifecycleState.resumed) {
      _careActivity.pause(DateTime.now());
    }
  }

  void _onPointer(PointerEvent event) {
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    if (event is PointerDownEvent &&
        (lifecycle == null || lifecycle == AppLifecycleState.resumed)) {
      _careActivity.interact(DateTime.now());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _careActivity.resume(DateTime.now());
      setState(() {});
    } else {
      _careActivity.pause(DateTime.now());
    }
  }

  @override
  void didUpdateWidget(covariant RelayuneReadyScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      _careActivity = HomeCareActivity();
      _positions.clear();
      _drafts.clear();
    }
  }

  @override
  void dispose() {
    GestureBinding.instance.pointerRouter.removeGlobalRoute(_onPointer);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.connections != null &&
        !widget.connections!.computers.contains(_selectedComputer)) {
      _selectedComputer = null;
    }
    // Once a cached directory is shown, later verification of another computer
    // must not switch the list underneath a user's first tap.
    _selectedComputer ??= widget.connections?.readyComputers
        .where((c) => c.sessions.isNotEmpty)
        .firstOrNull;
    _handleRequestedWorkbenchNavigation();
    return VisibleRouteBuilder(
      builder: (context) => RelayuneHomePage(
        scaffoldKey: _homeKey,
        controller: _homeController,
        connections: widget.connections,
        selectedComputer: _homeController,
        onSelectComputer: (c) => setState(() => _selectedComputer = c),
        onOpenComputerSession: (c, id) => _openSession(id, computer: c),
        careActivity: _careActivity,
        onOpenSession: _openSession,
        onOpenConnectionInfo: _openConnectionInfo,
        navigationDrawer: WorkbenchNavigationDrawer(
          controller: _homeController,
          connections: widget.connections,
          onSelectComputer: (c) => setState(() => _selectedComputer = c),
          homeSelected: true,
          onSelectHome: () => Navigator.of(context).pop(),
          onSelectSession: _openSessionFromDrawer,
        ),
      ),
    );
  }

  void _handleRequestedWorkbenchNavigation() {
    for (final c in widget.connections?.computers ?? [widget.controller]) {
      final revision = c.workbenchNavigationRevision;
      if (revision <= (_navigationRevisions[c] ?? 0)) continue;
      if (!_workbenchOpen && !(ModalRoute.isCurrentOf(context) ?? true)) return;
      _navigationRevisions[c] = revision;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_openWorkbench(computer: c));
      });
    }
  }

  Future<void> _openSession(String sessionId, {AppController? computer}) async {
    // Selection updates synchronously; history continues in the background so
    // the first tap opens the workbench immediately instead of waiting on the
    // desktop round trip. ConversationPage owns the branded loading state.
    final c = computer ?? _homeController;
    unawaited(c.selectSession(sessionId));
    await _openWorkbench(computer: c);
  }

  void _openSessionFromDrawer(String sessionId) {
    Navigator.of(context).pop();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_openSession(sessionId));
    });
  }

  void _openConnectionInfo() {
    Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => AnimatedBuilder(
          animation: widget.connections ?? _homeController,
          builder: (context, _) => Scaffold(
            appBar: AppBar(title: Text(context.l10n.workbenchDevice)),
            body: SafeArea(
              top: false,
              child: DevicePage(
                controller: _homeController,
                connections: widget.connections,
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _openWorkbench({AppController? computer}) async {
    final c = computer ?? _homeController;
    if (!mounted) return;
    if (_workbenchOpen) {
      if (_workbenchController == c) return;
      Navigator.of(context).popUntil((route) => route.isFirst);
      await WidgetsBinding.instance.endOfFrame;
      if (!mounted) return;
    }
    setState(() => _selectedComputer = c);
    _workbenchController = c;
    _workbenchOpen = true;
    final openedSessionId = c.activeSessionId;
    if (openedSessionId != null) {
      c.markSessionOpened(openedSessionId);
      widget.connections?.visibleSession = widget.connections?.route(
        c,
        openedSessionId,
      );
    }
    await Navigator.of(context).push<void>(
      _WorkbenchPageRoute(
        settings: const RouteSettings(name: 'workbench'),
        builder: (_) => AnimatedBuilder(
          animation: c,
          builder: (context, _) => WorkbenchScreen(
            controller: c,
            connections: widget.connections,
            onSelectComputer: (target) {
              if (target == c) return;
              Navigator.of(context).popUntil((route) => route.isFirst);
              setState(() => _selectedComputer = target);
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (mounted) _homeKey.currentState?.openDrawer();
              });
            },
            draftStore: _drafts.putIfAbsent(c, SessionComposerDraftStore.new),
            readingPositions: _positions.putIfAbsent(
              c,
              SessionReadingPositions.new,
            ),
          ),
        ),
      ),
    );
    final sessionId = c.activeSessionId;
    if (sessionId != null &&
        (widget.connections == null ||
            widget.connections!.controllers.contains(c))) {
      c.markSessionOpened(sessionId);
    }
    widget.connections?.visibleSession = null;
    if (mounted) setState(() => _workbenchOpen = false);
  }
}

/// Lets the workbench Scaffold own the leading-edge drag on iOS.
///
/// The platform page transition otherwise claims the same gesture for popping
/// back to Home before the drawer can respond. Android's predictive-back
/// gesture remains available through the inherited implementation.
class _WorkbenchPageRoute extends MaterialPageRoute<void> {
  _WorkbenchPageRoute({required super.builder, super.settings});

  // Opening a session should feel like selecting one in the workbench drawer.
  // A platform push animation adds a visible delay and competes with the first
  // conversation layout / tail positioning. Keep the route for back navigation
  // while presenting the conversation immediately, including its loading state.
  @override
  Duration get transitionDuration => Duration.zero;

  @override
  Duration get reverseTransitionDuration => Duration.zero;

  @override
  bool get popGestureEnabled {
    if (Theme.of(navigator!.context).platform == TargetPlatform.iOS) {
      return false;
    }
    return super.popGestureEnabled;
  }
}
