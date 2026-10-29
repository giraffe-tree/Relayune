import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:image_picker/image_picker.dart';
import 'package:pdfrx/pdfrx.dart';
import 'package:url_launcher/url_launcher.dart';

import '../widgets/drawer_swipe_region.dart';
import '../widgets/photo_deck.dart';
import 'attachment_copy.dart';
import '../../l10n/relayune_localizations.dart';
import '../config.dart';
import '../models.dart';
import '../network/relay_api.dart';
import '../state/app_controller.dart';
import '../state/computer_connections.dart';
import 'computer_picker.dart';
import '../state/agent_order.dart';
import '../state/conversation_turn_status.dart';
import '../state/device_connection.dart';
import '../state/live_reply_presentation.dart';
import '../state/session_composer_drafts.dart';
import '../state/session_reading_positions.dart';
import '../state/session_projects.dart';
import '../widgets/brand_mark.dart';
import '../widgets/incremental_markdown_body.dart';
import '../widgets/mermaid_diagram.dart';
import '../widgets/visible_route_builder.dart';
import '../widgets/image_loading_placeholder.dart';
import '../widgets/conversation_scroll_controller.dart';
import '../widgets/device_connection_icon.dart';
import '../widgets/device_connection_button.dart';
import '../widgets/device_connection_topology.dart';
import '../widgets/device_route_card.dart';
import '../widgets/running_status_icon.dart';
import '../widgets/waiting_status_icon.dart';
import '../widgets/foreground_periodic_timer.dart';
import '../widgets/status_banner.dart';
import '../version_info.dart';
import 'image_thumbnail.dart';
import 'save_image_button.dart';
import 'markdown_style.dart';
import 'secure_svg_preview.dart';
import 'secure_html_preview.dart';
import 'local_web_preview.dart';
import '../network/local_web_gateway.dart';
import 'settings_page.dart';
import 'theme.dart';
import 'history_loading_progress.dart';
import 'device_agent_quota.dart';
import 'visualization_reference.dart';
import 'add_project_screen.dart';
import 'project_copy.dart';
import 'session_model_settings.dart';

part 'agent_task_views.dart';
part 'message_attachments.dart';

class WorkbenchScreen extends StatefulWidget {
  const WorkbenchScreen({
    super.key,
    required this.controller,
    this.connections,
    this.onSelectComputer,
    this.draftStore,
    this.readingPositions,
  });

  final AppController controller;
  final ComputerConnections? connections;
  final ValueChanged<AppController>? onSelectComputer;
  final SessionComposerDraftStore? draftStore;
  final SessionReadingPositions? readingPositions;

  @override
  State<WorkbenchScreen> createState() => _WorkbenchScreenState();
}

class _WorkbenchScreenState extends State<WorkbenchScreen> {
  late final SessionReadingPositions _readingPositions;
  late final SessionComposerDraftStore _draftStore;

  @override
  void initState() {
    super.initState();
    _draftStore = widget.draftStore ?? SessionComposerDraftStore();
    _readingPositions = widget.readingPositions ?? SessionReadingPositions();
  }

  Widget get _conversationPage {
    final sessionId = widget.controller.activeSession?.id ?? 'none';
    final revision = widget.controller.workbenchNavigationRevision;
    final forceLatest =
        widget.controller.pendingWorkbenchTarget == 'conversation' &&
        revision > _readingPositions.handledNavigationRevision;
    _readingPositions.handledNavigationRevision = revision;
    return ConversationPage(
      key: ValueKey(
        'conversation:$sessionId:${widget.controller.backgroundViewGeneration}',
      ),
      controller: widget.controller,
      draft: _draftStore.forSession(sessionId),
      readingPositions: _readingPositions,
      forceLatestOnEntry: forceLatest,
      tailEntryRevision:
          widget.controller.pendingWorkbenchTarget == 'conversation'
          ? widget.controller.workbenchNavigationRevision
          : 0,
      agentWindowOpenRequest:
          widget.controller.pendingWorkbenchTarget == 'agents'
          ? widget.controller.workbenchNavigationRevision
          : 0,
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    if (controller.backgroundMemoryReleased) return const SizedBox.expand();
    final activeSession = controller.activeSession;
    final activeProject = controller.projectGroupForSession(
      controller.activeRootSession?.id,
    );
    final projectTitle = activeProject?.title.trim().isNotEmpty == true
        ? activeProject!.title.trim()
        : activeSession?.project.trim().isNotEmpty == true
        ? activeSession!.project.trim()
        : 'Relayune';
    final executionTitle = projectTitle;
    final sessionTitle = activeSession?.name.trim().isNotEmpty == true
        ? activeSession!.name.trim()
        : context.l10n.workbenchTitle;
    return Scaffold(
      key: const ValueKey('workbench-scaffold'),
      drawer: WorkbenchNavigationDrawer(
        controller: controller,
        connections: widget.connections,
        onSelectComputer: widget.onSelectComputer,
        homeSelected: false,
        onSelectHome: _openHomeFromDrawer,
        onSelectSession: (sessionId) {
          Navigator.of(context).pop();
          _selectSession(sessionId);
        },
      ),
      drawerEnableOpenDragGesture: true,
      appBar: AppBar(
        key: const ValueKey('workbench-context-header'),
        toolbarHeight: 64,
        leadingWidth: 54,
        titleSpacing: 0,
        scrolledUnderElevation: 0,
        leading: Builder(
          builder: (context) => IconButton(
            key: const ValueKey('workbench-navigation-button'),
            tooltip: context.l10n.workbenchOpenNavigation,
            onPressed: () => Scaffold.of(context).openDrawer(),
            icon: const Icon(Icons.menu_rounded),
          ),
        ),
        title: _WorkbenchContextTitle(
          projectTitle: executionTitle,
          sessionTitle: sessionTitle,
        ),
        actions: [
          if (controller.pendingApprovalCount > 0)
            IconButton(
              key: const ValueKey('workbench-pending-approval-button'),
              tooltip: context.l10n.workbenchPendingApprovals(
                controller.pendingApprovalCount,
              ),
              onPressed: _openPendingApproval,
              icon: Badge(
                label: Text('${controller.pendingApprovalCount}'),
                child: const Icon(Icons.shield_outlined),
              ),
            ),
          if (Navigator.of(context).canPop())
            IconButton(
              key: const ValueKey('workbench-home-button'),
              tooltip: context.l10n.workbenchReturnHome,
              onPressed: () => Navigator.of(context).maybePop(),
              icon: const Icon(Icons.home_outlined),
            ),
          DeviceConnectionButton(
            key: const ValueKey('workbench-online-status'),
            iconKey: const ValueKey('workbench-device-status-svg'),
            online: controller.deviceOnline,
            transport: controller.connectionSnapshot.transport,
            statusLabel: controller.deviceStatusLabel,
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (context) => Scaffold(
                  appBar: AppBar(title: Text(context.l10n.workbenchDevice)),
                  body: SafeArea(
                    top: false,
                    child: DevicePage(
                      controller: controller,
                      connections: widget.connections,
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: DiagramScrollRegion(
        child: DrawerSwipeRegion(
          child: SafeArea(top: false, child: _conversationPage),
        ),
      ),
    );
  }

  void _openPendingApproval() {
    final sessionId = widget.controller.nextPendingApprovalSessionId;
    if (sessionId != null && sessionId != widget.controller.activeSessionId) {
      _selectSession(sessionId);
    }
    if (!mounted) return;
    widget.controller.requestWorkbenchTarget('conversation');
  }

  void _openHomeFromDrawer() {
    final navigator = Navigator.of(context);
    navigator.pop();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) navigator.maybePop();
    });
  }

  void _selectSession(String sessionId) {
    final currentSessionId = widget.controller.activeSessionId;
    if (currentSessionId != null) {
      widget.controller.markSessionOpened(currentSessionId);
    }
    unawaited(widget.controller.selectSession(sessionId));
  }
}

class _WorkbenchContextTitle extends StatelessWidget {
  const _WorkbenchContextTitle({
    required this.projectTitle,
    required this.sessionTitle,
  });

  final String projectTitle;
  final String sessionTitle;

  @override
  Widget build(BuildContext context) => Semantics(
    label: '$projectTitle，$sessionTitle',
    child: Row(
      children: [
        const BrandMark(key: ValueKey('workbench-brand-mark'), size: 36),
        const SizedBox(width: 9),
        Expanded(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Tooltip(
                message: projectTitle,
                child: Text(
                  projectTitle,
                  key: const ValueKey('workbench-project-name'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 15.5,
                    height: 1.12,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.3,
                  ),
                ),
              ),
              const SizedBox(height: 3),
              Tooltip(
                message: sessionTitle,
                child: Text(
                  sessionTitle,
                  key: const ValueKey('workbench-session-name'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: RelayTheme.muted,
                    fontSize: 11.5,
                    height: 1.15,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class WorkbenchNavigationDrawer extends StatefulWidget {
  const WorkbenchNavigationDrawer({
    super.key,
    required this.controller,
    required this.homeSelected,
    required this.onSelectHome,
    required this.onSelectSession,
    this.connections,
    this.onSelectComputer,
  });

  final AppController controller;
  final ComputerConnections? connections;
  final ValueChanged<AppController>? onSelectComputer;
  final bool homeSelected;
  final VoidCallback onSelectHome;
  final ValueChanged<String> onSelectSession;

  @override
  State<WorkbenchNavigationDrawer> createState() =>
      _WorkbenchNavigationDrawerState();
}

class _WorkbenchNavigationDrawerState extends State<WorkbenchNavigationDrawer> {
  static const _agents = [
    (
      id: 'mcode',
      label: 'MiniMax Code',
      shortLabel: 'MiniMax',
      icon: 'terminal',
    ),
    (id: 'pi', label: 'Pi', shortLabel: 'Pi', icon: 'terminal'),
    (id: 'zcode', label: 'ZCode', shortLabel: 'ZCode', icon: 'terminal'),
    (
      id: 'opencode',
      label: 'OpenCode',
      shortLabel: 'OpenCode',
      icon: 'terminal',
    ),
    (id: 'codex', label: 'Codex', shortLabel: 'Codex', icon: 'codex'),
    (id: 'kimi', label: 'Kimi Code', shortLabel: 'Kimi', icon: 'kimi'),
    (
      id: 'claude',
      label: 'Claude Code',
      shortLabel: 'Claude Code',
      icon: 'claude',
    ),
    (
      id: 'claude-cowork',
      label: 'Claude Cowork',
      shortLabel: 'Cowork',
      icon: 'claude',
    ),
  ];

  late String _provider = _defaultProvider();

  AppController get controller => widget.controller;

  Future<void> _saveAgentOrder(List<String> order) async {
    final saved = await controller.setAgentOrder(order);
    if (!saved && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.workbenchAgentOrderSaveFailed)),
      );
    }
  }

  String _defaultProvider() {
    final active = controller.activeRootSession;
    if (active != null) return active.provider;
    final groups = controller.projectGroups;
    if (groups.isNotEmpty) return groups.first.projectSession.provider;
    return 'codex';
  }

  @override
  void didUpdateWidget(WorkbenchNavigationDrawer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != controller) _provider = _defaultProvider();
  }

  @override
  Widget build(BuildContext context) => VisibleRouteBuilder(
    listenable: controller,
    builder: (context) {
      final orderedAgents = [
        for (final id in controller.agentOrder.where(
          controller.visibleAgents.contains,
        ))
          _agents.firstWhere((agent) => agent.id == id),
      ];
      final groups = controller.projectGroupsForProvider(_provider);
      final activeSessionId = controller.activeRootSession?.id;
      final groupIndices = {
        for (var index = 0; index < groups.length; index++)
          PageStorageKey(groups[index].key): index,
      };
      final drawerWidth = math.min(
        MediaQuery.sizeOf(context).width - 12,
        360.0,
      );
      return Drawer(
        width: drawerWidth,
        backgroundColor: const Color(0xFF101010),
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadiusDirectional.only(
            topEnd: Radius.circular(20),
            bottomEnd: Radius.circular(20),
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: SafeArea(
          child: Column(
            children: [
              SizedBox(
                key: const ValueKey('drawer-computer-header'),
                height: 64,
                child: Row(
                  children: [
                    const SizedBox(
                      width: 76,
                      child: Center(
                        child: BrandMark(
                          key: ValueKey('drawer-brand-mark'),
                          size: 30,
                        ),
                      ),
                    ),
                    if (widget.connections != null &&
                        widget.onSelectComputer != null)
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(right: 12),
                          child: ComputerPicker(
                            connections: widget.connections!,
                            selected: controller,
                            onChanged: widget.onSelectComputer!,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              Expanded(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Container(
                      key: const ValueKey('drawer-agent-rail'),
                      width: 76,
                      decoration: const BoxDecoration(
                        color: Color(0xFF151515),
                        border: BorderDirectional(
                          end: BorderSide(color: Color(0xFF292929)),
                        ),
                      ),
                      child: Column(
                        children: [
                          const SizedBox(height: 8),
                          _DrawerRailButton(
                            key: const ValueKey('workbench-section-home'),
                            selected: widget.homeSelected,
                            compact: true,
                            label:
                                Localizations.localeOf(context).languageCode ==
                                    'zh'
                                ? '首页'
                                : 'Home',
                            onTap: widget.onSelectHome,
                            child: const Icon(Icons.home_outlined, size: 22),
                          ),
                          const Divider(
                            key: ValueKey('drawer-home-divider'),
                            height: 24,
                            indent: 14,
                            endIndent: 14,
                            color: Color(0xFF303030),
                          ),
                          Expanded(
                            child: ReorderableListView(
                              key: const ValueKey('drawer-agent-order'),
                              buildDefaultDragHandles: false,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 7,
                              ),
                              onReorder: (oldIndex, newIndex) {
                                if (newIndex > oldIndex) newIndex--;
                                if (newIndex == oldIndex) return;
                                final visible = orderedAgents
                                    .map((agent) => agent.id)
                                    .toList();
                                visible.insert(
                                  newIndex,
                                  visible.removeAt(oldIndex),
                                );
                                var index = 0;
                                final order = [
                                  for (final id in controller.agentOrder)
                                    controller.visibleAgents.contains(id)
                                        ? visible[index++]
                                        : id,
                                ];
                                unawaited(_saveAgentOrder(order));
                              },
                              children: [
                                for (final (index, agent)
                                    in orderedAgents.indexed)
                                  ReorderableDelayedDragStartListener(
                                    key: ValueKey(
                                      'drawer-agent-order-${agent.id}',
                                    ),
                                    index: index,
                                    child: Padding(
                                      padding: const EdgeInsets.only(bottom: 8),
                                      child: _DrawerRailButton(
                                        key: ValueKey(
                                          'drawer-agent-${agent.id}',
                                        ),
                                        selected: _provider == agent.id,
                                        label: agent.label,
                                        shortLabel:
                                            [
                                              'codex',
                                              'claude',
                                              'kimi',
                                            ].contains(agent.id)
                                            ? agent.shortLabel
                                            : '${agent.shortLabel} · Beta',
                                        hint: context
                                            .l10n
                                            .workbenchAgentOrderHint,
                                        onTap: () => setState(
                                          () => _provider = agent.id,
                                        ),
                                        child: SvgPicture.asset(
                                          'assets/agents/${agent.icon}.svg',
                                          width: 24,
                                          height: 24,
                                          colorFilter: ColorFilter.mode(
                                            _provider == agent.id
                                                ? RelayTheme.greenStrong
                                                : RelayTheme.mutedBright,
                                            BlendMode.srcIn,
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Padding(
                            padding: const EdgeInsetsDirectional.fromSTEB(
                              16,
                              10,
                              8,
                              8,
                            ),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        _agents
                                                .where(
                                                  (agent) =>
                                                      agent.id == _provider,
                                                )
                                                .firstOrNull
                                                ?.label ??
                                            _provider,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w800,
                                          fontSize: 17,
                                          letterSpacing: -0.35,
                                        ),
                                      ),
                                      Text(
                                        context.l10n.workbenchProjectsSessions,
                                        style: const TextStyle(
                                          color: RelayTheme.muted,
                                          fontSize: 11.5,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                IconButton(
                                  tooltip: context.l10n.commonClose,
                                  onPressed: () => Navigator.of(context).pop(),
                                  icon: const Icon(
                                    Icons.close_rounded,
                                    size: 22,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 12),
                            child: OutlinedButton.icon(
                              key: const ValueKey('add-project'),
                              icon: const Icon(
                                Icons.create_new_folder_outlined,
                                size: 18,
                              ),
                              label: Text(
                                projectText(context.l10n.localeName, 'title'),
                              ),
                              onPressed: () async {
                                final started = await Navigator.of(context)
                                    .push<bool>(
                                      MaterialPageRoute(
                                        builder: (_) => AddProjectScreen(
                                          controller: controller,
                                          provider: _provider,
                                        ),
                                      ),
                                    );
                                if (started == true && context.mounted) {
                                  Navigator.of(context).pop();
                                }
                              },
                            ),
                          ),
                          Expanded(
                            child: groups.isEmpty
                                ? Center(
                                    child: Text(
                                      context.l10n.workbenchNoSessionsSynced,
                                    ),
                                  )
                                : ListView.builder(
                                    padding: const EdgeInsets.fromLTRB(
                                      12,
                                      10,
                                      12,
                                      20,
                                    ),
                                    itemCount: groups.length,
                                    findChildIndexCallback: (key) =>
                                        groupIndices[key],
                                    itemBuilder: (context, index) {
                                      final group = groups[index];
                                      return _ProjectGroupCard(
                                        key: PageStorageKey(group.key),
                                        controller: controller,
                                        group: group,
                                        activeSessionId: activeSessionId,
                                        onConfigure: () =>
                                            _showProjectConfiguration(
                                              context,
                                              group,
                                            ),
                                        onCreate:
                                            _provider != 'claude-cowork' &&
                                                controller.deviceOnline &&
                                                !controller
                                                    .sessionCreationInFlight
                                            ? () =>
                                                  _createSession(context, group)
                                            : null,
                                        createUnavailableReason:
                                            _provider == 'claude-cowork'
                                            ? context
                                                  .l10n
                                                  .workbenchCoworkCreateOnDesktop
                                            : null,
                                        onSelectSession: widget.onSelectSession,
                                      );
                                    },
                                  ),
                          ),
                          _DrawerAccountPanel(
                            email: controller.accountDisplayName,
                            onSettings: () => _openSettings(context),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      );
    },
  );

  void _openSettings(BuildContext context) {
    final navigator = Navigator.of(context);
    navigator.pop();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      navigator.push(
        MaterialPageRoute<void>(
          builder: (_) => SettingsPage(
            controller: controller,
            devicePageBuilder: (context) => Scaffold(
              appBar: AppBar(title: Text(context.l10n.workbenchDevice)),
              body: SafeArea(
                top: false,
                child: DevicePage(
                  controller: controller,
                  connections: widget.connections,
                ),
              ),
            ),
          ),
        ),
      );
    });
  }

  Future<void> _showProjectConfiguration(
    BuildContext context,
    SessionProjectGroup project,
  ) async {
    final result = await showDialog<String>(
      context: context,
      builder: (context) => _ProjectConfigurationDialog(project: project),
    );
    if (result != null) await controller.renameProject(project, result);
  }

  Future<void> _createSession(
    BuildContext context,
    SessionProjectGroup project,
  ) async {
    final activeRootId = controller.activeRootSession?.id;
    final target = project.sessions.firstWhere(
      (session) => session.id == activeRootId,
      orElse: () => project.projectSession,
    );
    final name = context.l10n.workbenchDefaultSessionName;
    final provider = _provider;
    final creation = controller.createSessionInProject(
      target,
      name,
      provider: provider,
    );
    if (context.mounted) Navigator.of(context).pop();
    await creation;
  }
}

class _DrawerAccountPanel extends StatelessWidget {
  const _DrawerAccountPanel({required this.email, required this.onSettings});

  final String email;
  final VoidCallback onSettings;

  @override
  Widget build(BuildContext context) => Container(
    key: const ValueKey('drawer-account-panel'),
    margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
    decoration: BoxDecoration(
      color: const Color(0xFF171717),
      borderRadius: BorderRadius.circular(13),
      border: Border.all(color: const Color(0xFF292929)),
    ),
    clipBehavior: Clip.antiAlias,
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 9),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFF202020),
                  border: Border.all(color: const Color(0xFF373737)),
                ),
                child: Text(
                  email.characters.firstOrNull?.toUpperCase() ?? 'R',
                  style: const TextStyle(
                    color: RelayTheme.greenStrong,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (email.isEmpty)
                      Text(
                        context.l10n.workbenchSignedInAccount,
                        key: const ValueKey('drawer-account-label'),
                        style: const TextStyle(
                          fontSize: 11,
                          color: RelayTheme.muted,
                        ),
                      ),
                    Tooltip(
                      message: email.isEmpty ? '' : '\u2066$email\u2069',
                      child: Text(
                        email.isEmpty
                            ? context.l10n.workbenchNotSignedIn
                            : email,
                        key: const ValueKey('drawer-account-email'),
                        textDirection: email.isEmpty ? null : TextDirection.ltr,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 6),
              IconButton(
                key: const ValueKey('drawer-settings-entry'),
                onPressed: onSettings,
                icon: const Icon(Icons.settings_outlined, size: 18),
                tooltip: context.l10n.commonSettings,
                style: IconButton.styleFrom(
                  foregroundColor: RelayTheme.mutedBright,
                  minimumSize: const Size(44, 44),
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _ProjectGroupCard extends StatelessWidget {
  const _ProjectGroupCard({
    super.key,
    required this.controller,
    required this.group,
    required this.activeSessionId,
    required this.onConfigure,
    required this.onCreate,
    required this.createUnavailableReason,
    required this.onSelectSession,
  });

  final AppController controller;
  final SessionProjectGroup group;
  final String? activeSessionId;
  final VoidCallback onConfigure;
  final VoidCallback? onCreate;
  final String? createUnavailableReason;
  final ValueChanged<String> onSelectSession;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Material(
      color: const Color(0xFF151515),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: Color(0xFF292929)),
      ),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        key: PageStorageKey('project-group-${group.key}'),
        // Collapsed projects must not build or lay out hidden session rows.
        maintainState: false,
        minTileHeight: 52,
        tilePadding: const EdgeInsetsDirectional.fromSTEB(10, 0, 8, 0),
        childrenPadding: const EdgeInsets.fromLTRB(8, 0, 8, 6),
        iconColor: RelayTheme.greenStrong,
        collapsedIconColor: RelayTheme.muted,
        shape: const Border(),
        collapsedShape: const Border(),
        leading: Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
            color: const Color(0xFF202020),
            borderRadius: BorderRadius.circular(9),
          ),
          alignment: Alignment.center,
          child: const Icon(Icons.folder_outlined, size: 19),
        ),
        title: Text(
          group.title,
          key: ValueKey('project-group-title-${group.key}'),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
        ),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(2, 0, 2, 2),
            child: Align(
              alignment: AlignmentDirectional.centerEnd,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox.square(
                    dimension: 44,
                    child: IconButton(
                      key: ValueKey('project-configuration-${group.key}'),
                      tooltip: context.l10n.workbenchProjectConfiguration,
                      onPressed: onConfigure,
                      padding: EdgeInsets.zero,
                      icon: Container(
                        key: ValueKey(
                          'project-configuration-visual-${group.key}',
                        ),
                        width: 34,
                        height: 34,
                        decoration: BoxDecoration(
                          color: const Color(0xFF202020),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: const Color(0xFF303030)),
                        ),
                        alignment: Alignment.center,
                        child: const Icon(
                          Icons.tune_rounded,
                          size: 16,
                          color: RelayTheme.muted,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  SizedBox(
                    height: 44,
                    child: TextButton(
                      key: ValueKey('project-create-session-${group.key}'),
                      onPressed: onCreate,
                      style: TextButton.styleFrom(
                        minimumSize: Size.zero,
                        padding: const EdgeInsets.symmetric(horizontal: 2),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: Container(
                        key: ValueKey(
                          'project-create-session-visual-${group.key}',
                        ),
                        height: 34,
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        decoration: BoxDecoration(
                          color: onCreate == null
                              ? const Color(0xFF1B1B1B)
                              : const Color(0xFF183829),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                            color: onCreate == null
                                ? const Color(0xFF292929)
                                : const Color(0xFF315B43),
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.add_rounded,
                              size: 16,
                              color: onCreate == null
                                  ? RelayTheme.muted
                                  : RelayTheme.greenStrong,
                            ),
                            const SizedBox(width: 5),
                            Text(
                              context.l10n.workbenchNewSession,
                              style: TextStyle(
                                color: onCreate == null
                                    ? RelayTheme.muted
                                    : RelayTheme.greenStrong,
                                fontSize: 11.5,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (createUnavailableReason != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 0, 10, 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(
                    Icons.info_outline,
                    size: 15,
                    color: RelayTheme.muted,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      createUnavailableReason!,
                      key: const ValueKey('cowork-create-on-desktop-help'),
                      style: const TextStyle(
                        color: RelayTheme.muted,
                        fontSize: 10.5,
                        height: 1.3,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          _ProjectSessionList(
            key: PageStorageKey(
              'project-sessions-${controller.email}-${controller.bootstrap?.device.id}-${controller.relayKey?.keyId}-${group.projectSession.provider}-${group.key}',
            ),
            controller: controller,
            groupKey: group.key,
            project: group.projectSession,
            sessions: group.sessions,
            activeSessionId: activeSessionId,
            onSelect: onSelectSession,
          ),
        ],
      ),
    ),
  );
}

class _ProjectSessionList extends StatefulWidget {
  const _ProjectSessionList({
    super.key,
    required this.controller,
    required this.groupKey,
    required this.project,
    required this.sessions,
    required this.activeSessionId,
    required this.onSelect,
  });

  static const previewCount = 5;

  final AppController controller;
  final String groupKey;
  final RelaySession project;
  final List<RelaySession> sessions;
  final String? activeSessionId;
  final ValueChanged<String> onSelect;

  @override
  State<_ProjectSessionList> createState() => _ProjectSessionListState();
}

class _ProjectSessionListState extends State<_ProjectSessionList> {
  int _visibleCount = _ProjectSessionList.previewCount;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _visibleCount =
        PageStorage.maybeOf(context)?.readState(context) as int? ??
        _ProjectSessionList.previewCount;
  }

  @override
  Widget build(BuildContext context) {
    final sessions = widget.sessions;
    final visibleCount = _visibleCount < sessions.length
        ? _visibleCount
        : sessions.length;
    final hidden = sessions.length - visibleCount;
    final visible = sessions.sublist(0, visibleCount);
    return Column(
      children: [
        for (final session in visible)
          _DrawerSessionTile(
            key: ValueKey('drawer-session-${session.id}'),
            session: session,
            selected: session.id == widget.activeSessionId,
            isRunning: widget.controller.sessionHasRunningAgent(session.id),
            pendingApprovals: widget.controller.pendingApprovalCountForSession(
              session.id,
            ),
            onTap: () => widget.onSelect(session.id),
          ),
        if (hidden > 0)
          InkWell(
            key: ValueKey('project-more-sessions-${widget.groupKey}'),
            borderRadius: BorderRadius.circular(7),
            onTap: () {
              setState(() {
                _visibleCount += _ProjectSessionList.previewCount;
                PageStorage.maybeOf(
                  context,
                )?.writeState(context, _visibleCount);
              });
            },
            child: SizedBox(
              height: 30,
              child: Center(
                child: Text(
                  projectText(context.l10n.localeName, 'loadMore'),
                  style: const TextStyle(
                    color: RelayTheme.muted,
                    fontSize: 11.5,
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _DrawerSessionTile extends StatelessWidget {
  const _DrawerSessionTile({
    super.key,
    required this.session,
    required this.selected,
    required this.isRunning,
    required this.pendingApprovals,
    required this.onTap,
  });

  final RelaySession session;
  final bool selected;
  final bool isRunning;
  final int pendingApprovals;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final branch = session.branch.trim();
    final time = formatSessionTimestamp(session.updatedAt);
    final metadata = [
      branch,
      time,
    ].where((item) => item.isNotEmpty).join(' · ');
    return Padding(
      padding: const EdgeInsets.only(bottom: 3),
      child: Material(
        color: selected ? const Color(0xFF1B2B22) : Colors.transparent,
        borderRadius: BorderRadius.circular(10),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            height: 54,
            width: double.infinity,
            child: Row(
              children: [
                AnimatedContainer(
                  duration: MediaQuery.disableAnimationsOf(context)
                      ? Duration.zero
                      : const Duration(milliseconds: 180),
                  width: 3,
                  height: selected ? 30 : 0,
                  decoration: BoxDecoration(
                    color: RelayTheme.greenStrong,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
                const SizedBox(width: 9),
                Badge(
                  key: ValueKey('drawer-session-approval-badge-${session.id}'),
                  isLabelVisible: pendingApprovals > 0,
                  label: Text('$pendingApprovals'),
                  backgroundColor: RelayTheme.greenStrong,
                  textColor: const Color(0xFF0B1710),
                  child: _SessionAgentStatusIcon(
                    sessionId: session.id,
                    isRunning: isRunning,
                    selected: selected,
                  ),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        session.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 13,
                          height: 1.18,
                          fontWeight: selected
                              ? FontWeight.w600
                              : FontWeight.w500,
                          color: selected
                              ? RelayTheme.greenStrong
                              : RelayTheme.text,
                        ),
                      ),
                      if (metadata.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          metadata,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 10.5,
                            height: 1,
                            color: RelayTheme.muted,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 10),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SessionAgentStatusIcon extends StatelessWidget {
  const _SessionAgentStatusIcon({
    required this.sessionId,
    required this.isRunning,
    required this.selected,
  });

  final String sessionId;
  final bool isRunning;
  final bool selected;
  static const _idleSvg = '''
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path d="M5.5 5h13A2.5 2.5 0 0 1 21 7.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-5.5 3v-3.5A2.5 2.5 0 0 1 3 14V7.5A2.5 2.5 0 0 1 5.5 5Z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M8 11h8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
</svg>
''';

  @override
  Widget build(BuildContext context) {
    final color = isRunning
        ? RelayTheme.greenStrong
        : selected
        ? RelayTheme.green
        : RelayTheme.muted;
    final iconKey = ValueKey(
      'drawer-session-${isRunning ? 'running' : 'idle'}-icon-$sessionId',
    );
    final icon = isRunning
        ? AnimatedRunningStatusIcon(size: 22, color: color, iconKey: iconKey)
        : SvgPicture.string(
            _idleSvg,
            key: iconKey,
            width: 22,
            height: 22,
            colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
          );
    return Semantics(
      label: isRunning
          ? context.l10n.workbenchAgentRunning
          : context.l10n.workbenchAgentNotRunning,
      child: SizedBox.square(dimension: 26, child: Center(child: icon)),
    );
  }
}

class _ProjectConfigurationDialog extends StatefulWidget {
  const _ProjectConfigurationDialog({required this.project});

  final SessionProjectGroup project;

  @override
  State<_ProjectConfigurationDialog> createState() =>
      _ProjectConfigurationDialogState();
}

class _ProjectConfigurationDialogState
    extends State<_ProjectConfigurationDialog> {
  late final TextEditingController _name;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: widget.project.title);
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final trimmed = _name.text.trim();
    final valid =
        trimmed.isNotEmpty &&
        trimmed.length <= AppController.maxProjectDisplayNameLength;
    return AlertDialog(
      title: Text(context.l10n.workbenchProjectConfigurationTitle),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              key: const ValueKey('project-display-name-field'),
              controller: _name,
              autofocus: true,
              maxLength: AppController.maxProjectDisplayNameLength,
              textInputAction: TextInputAction.done,
              onChanged: (_) => setState(() {}),
              onSubmitted: (_) {
                if (valid) Navigator.pop(context, trimmed);
              },
              decoration: InputDecoration(
                labelText: context.l10n.workbenchProjectName,
              ),
            ),
            Text(
              context.l10n.workbenchProjectNameHelp,
              style: const TextStyle(color: RelayTheme.muted, fontSize: 12),
            ),
            const SizedBox(height: 20),
            Text(
              context.l10n.workbenchFullPath,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Container(
              key: const ValueKey('project-full-path'),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: RelayTheme.panelRaised,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: RelayTheme.lineSoft),
              ),
              child: SelectableText(
                widget.project.path.isEmpty
                    ? context.l10n.workbenchProjectPathUnavailable
                    : widget.project.path,
                textDirection: widget.project.path.isEmpty
                    ? null
                    : TextDirection.ltr,
                style: const TextStyle(color: RelayTheme.muted, fontSize: 12),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(context.l10n.commonCancel),
        ),
        FilledButton(
          key: const ValueKey('project-display-name-save'),
          onPressed: valid ? () => Navigator.pop(context, trimmed) : null,
          child: Text(context.l10n.commonSave),
        ),
      ],
    );
  }
}

class _DrawerRailButton extends StatelessWidget {
  const _DrawerRailButton({
    super.key,
    required this.selected,
    required this.label,
    required this.onTap,
    required this.child,
    this.shortLabel,
    this.compact = false,
    this.hint,
  });

  final bool selected;
  final String label;
  final VoidCallback onTap;
  final Widget child;
  final String? shortLabel;
  final bool compact;
  final String? hint;

  @override
  Widget build(BuildContext context) => Semantics(
    label: label,
    hint: hint,
    button: true,
    selected: selected,
    child: Tooltip(
      message: label,
      triggerMode: TooltipTriggerMode.manual,
      excludeFromSemantics: true,
      child: Material(
        color: selected ? const Color(0xFF203329) : const Color(0xFF202020),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(
            color: selected
                ? RelayTheme.green.withValues(alpha: .4)
                : Colors.transparent,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Container(
            width: 62,
            constraints: BoxConstraints(minHeight: compact ? 58 : 72),
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
            child: Center(
              child: ExcludeSemantics(
                child: IconTheme(
                  data: IconThemeData(
                    color: selected ? RelayTheme.greenStrong : RelayTheme.muted,
                  ),
                  child: DefaultTextStyle(
                    style: Theme.of(context).textTheme.labelSmall!.copyWith(
                      color: selected
                          ? RelayTheme.greenStrong
                          : RelayTheme.text,
                      fontSize: 11,
                      height: 1.2,
                      fontWeight: FontWeight.w600,
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        child,
                        const SizedBox(height: 5),
                        Text(shortLabel ?? label, textAlign: TextAlign.center),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

class ConversationPage extends StatefulWidget {
  const ConversationPage({
    super.key,
    required this.controller,
    required this.draft,
    required this.tailEntryRevision,
    this.agentWindowOpenRequest = 0,
    this.readingPositions,
    this.forceLatestOnEntry = false,
  });

  final AppController controller;
  final SessionComposerDraft draft;
  final int tailEntryRevision;
  final int agentWindowOpenRequest;
  final bool forceLatestOnEntry;
  final SessionReadingPositions? readingPositions;

  @override
  State<ConversationPage> createState() => _ConversationPageState();
}

class _ConversationPageState extends State<ConversationPage> {
  late final TextEditingController _draft;
  late final ConversationScrollController _scroll;
  late final String? _readingSessionId;
  final _showBackToLatest = ValueNotifier(false);
  bool _sending = false;
  bool _pickingAttachments = false;
  bool _kimiPanelOpen = false;
  bool _coworkSettingsOpen = false;
  String _kimiPanelView = 'commands';
  late final List<UploadAttachment> _pendingAttachments;
  bool _atMessageTail = true;
  bool _initialTailPending = true;
  bool _tailScrollScheduled = false;
  bool _liveTailScrollScheduled = false;
  bool _earlierHistoryScheduled = false;
  bool _historyUserScrollActive = false;
  bool _initialHistoryFillStopped = false;
  int _initialEarlierPages = 0;
  String? _lastInitialEarlierCursor;
  int _localAgentWindowOpenRequest = 0;
  int? _messageTailRevision;
  bool _liveActivityVisible = false;
  double? _lastInitialTailExtent;
  int _initialTailAttempts = 0;
  List<RelayMessage>? _groupedMessageSource;
  int _groupedMessageLength = -1;
  RelayMessage? _groupedMessageFirst;
  RelayMessage? _groupedMessageLast;
  List<_ConversationGroup> _groupedMessages = const [];
  final _messageViewportKey = GlobalKey();
  final _rowAnchors = <String, GlobalKey>{};

  @override
  void initState() {
    super.initState();
    _readingSessionId = widget.controller.activeSessionId;
    final saved = _readingSessionId == null
        ? null
        : widget.readingPositions?.forSession(_readingSessionId);
    _atMessageTail = widget.forceLatestOnEntry || (saved?.atTail ?? true);
    _initialHistoryFillStopped = !_atMessageTail;
    _initialTailPending = _atMessageTail;
    _scroll = ConversationScrollController(
      initialScrollOffset: saved?.offset ?? 0,
      followsLatest: _atMessageTail,
      tailAtStart: true,
    );
    _draft = TextEditingController(text: widget.draft.text);
    _pendingAttachments = [...widget.draft.attachments];
    _draft.addListener(_handleDraftChanged);
    widget.draft.addListener(_handleFailedDraftRestored);
    _scroll.addListener(_handleMessageScroll);
    widget.controller.liveReplyUpdates.addListener(_handleLiveReplyUpdate);
    // History intentionally omits expensive child details. Discover them after
    // the first frame even when no live event has created the task dock yet.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final session = widget.controller.activeSession;
      if (session != null &&
          !session.isSubagent &&
          session.id == _readingSessionId) {
        _refreshAgentTasks(widget.controller, session.id);
      }
    });
  }

  @override
  void didUpdateWidget(ConversationPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.controller, widget.controller)) {
      oldWidget.controller.historyViewportHidden(_readingSessionId);
      oldWidget.controller.liveReplyUpdates.removeListener(
        _handleLiveReplyUpdate,
      );
      widget.controller.liveReplyUpdates.addListener(_handleLiveReplyUpdate);
    }
    if (widget.tailEntryRevision > oldWidget.tailEntryRevision) {
      _initialTailPending = true;
      _scroll.followsLatest = true;
      _lastInitialTailExtent = null;
      _initialTailAttempts = 0;
      _scheduleTailScroll();
    }
  }

  @override
  void dispose() {
    widget.controller.historyViewportHidden(_readingSessionId);
    _draft.removeListener(_handleDraftChanged);
    widget.draft.removeListener(_handleFailedDraftRestored);
    _scroll.removeListener(_handleMessageScroll);
    widget.controller.liveReplyUpdates.removeListener(_handleLiveReplyUpdate);
    _draft.dispose();
    _scroll.dispose();
    _showBackToLatest.dispose();
    super.dispose();
  }

  void _handleFailedDraftRestored() {
    final current = _draft.value;
    final restored = widget.draft.text;
    final prefixLength = restored.length - current.text.length;
    // Restoring prepends failed text; retain the new writing's caret and IME.
    _draft.value = current.copyWith(
      text: restored,
      selection: current.selection.isValid
          ? TextSelection(
              baseOffset: current.selection.baseOffset + prefixLength,
              extentOffset: current.selection.extentOffset + prefixLength,
              affinity: current.selection.affinity,
              isDirectional: current.selection.isDirectional,
            )
          : TextSelection.collapsed(offset: restored.length),
      composing: current.composing.isValid
          ? TextRange(
              start: current.composing.start + prefixLength,
              end: current.composing.end + prefixLength,
            )
          : TextRange.empty,
    );
    setState(() {
      _pendingAttachments
        ..clear()
        ..addAll(widget.draft.attachments);
    });
  }

  void _handleDraftChanged() {
    widget.draft.text = _draft.text;
    if (widget.controller.activeSession?.provider != 'kimi') return;
    final wantsCommands = _draft.text.startsWith('/');
    if (wantsCommands) {
      setState(() {
        _kimiPanelOpen = true;
        _kimiPanelView = 'commands';
      });
    } else if (_kimiPanelOpen && _kimiPanelView == 'commands') {
      setState(() => _kimiPanelOpen = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final session = controller.activeSession;
    if (session != null) {
      controller.historyViewportShown(session.id);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && widget.controller.activeSessionId == session.id) {
          controller.historyFrameDisplayed(session.id);
        }
      });
    }
    final running =
        session != null && controller.runningSessions.contains(session.id);
    final activeAgents = session == null || session.isSubagent
        ? const <RelayAgent>[]
        : controller.activeSessionAgents;
    final pendingApprovals = session == null
        ? const <RelayApproval>[]
        : controller
              .approvalsForSession(session.id)
              .where(
                (approval) =>
                    controller.approvalIsPending(approval) ||
                    approval.state == 'deciding',
              )
              .toList();
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 0),
          child: StatusBanner(
            controller: controller,
            historySessionId:
                (controller.messages[session?.id]?.isNotEmpty ?? false)
                ? session?.id
                : null,
            showFileAccess:
                controller.historyErrorFor(session?.id ?? '') == null,
          ),
        ),
        if (session != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 2, 10, 2),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    [
                      switch (session.provider) {
                        'kimi' => 'Kimi',
                        'claude' => 'Claude',
                        'mcode' => 'MiniMax Code',
                        'zcode' => 'ZCode',
                        'opencode' => 'OpenCode',
                        'claude-cowork' => 'Claude Cowork',
                        'pi' => 'Pi',
                        _ => 'Codex',
                      },
                      session.branch,
                    ].where((part) => part.isNotEmpty).join(' · '),
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(
                      context,
                    ).textTheme.bodySmall?.copyWith(color: RelayTheme.muted),
                  ),
                ),
                if (running)
                  Text(
                    context.l10n.workbenchRunning,
                    style: const TextStyle(
                      color: RelayTheme.fern,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                if (session.provider == 'kimi')
                  IconButton(
                    tooltip: context.l10n.workbenchKimiSettings,
                    onPressed: () => setState(() {
                      _kimiPanelOpen = true;
                      _kimiPanelView = 'settings';
                    }),
                    icon: const Icon(Icons.tune, size: 20),
                  ),
                if (session.provider == 'claude-cowork')
                  IconButton(
                    key: const ValueKey('cowork-session-settings-button'),
                    tooltip: context.l10n.workbenchSessionSettings,
                    onPressed: () => setState(
                      () => _coworkSettingsOpen = !_coworkSettingsOpen,
                    ),
                    icon: const Icon(Icons.tune, size: 20),
                  ),
              ],
            ),
          ),
        Expanded(
          child: LayoutBuilder(
            builder: (context, constraints) => Column(
              children: [
                Expanded(
                  child: Stack(
                    children: [
                      Positioned.fill(
                        child: session == null
                            ? _EmptyConversation(onCreate: null)
                            : controller.deviceOnline
                            ? RefreshIndicator(
                                onRefresh: () =>
                                    controller.loadHistory(session.id),
                                child: _messageList(
                                  controller,
                                  session,
                                  running,
                                ),
                              )
                            : _messageList(controller, session, running),
                      ),
                      PositionedDirectional(
                        bottom: 12,
                        end: 14,
                        child: ValueListenableBuilder<bool>(
                          valueListenable: _showBackToLatest,
                          builder: (context, visible, _) => visible
                              ? IconButton.filledTonal(
                                  key: const ValueKey(
                                    'conversation-back-to-latest',
                                  ),
                                  tooltip: context.l10n.workbenchBackToLatest,
                                  style: IconButton.styleFrom(
                                    minimumSize: const Size(40, 40),
                                    tapTargetSize: MaterialTapTargetSize.padded,
                                  ),
                                  onPressed: () {
                                    _atMessageTail = true;
                                    _scroll.followsLatest = true;
                                    _initialTailPending = true;
                                    _lastInitialTailExtent = null;
                                    _initialTailAttempts = 0;
                                    _scheduleTailScroll();
                                  },
                                  icon: SvgPicture.string(
                                    '<svg xmlns="http://www.w3.org/2000/svg" '
                                    'viewBox="0 0 24 24" fill="none" '
                                    'stroke="currentColor" stroke-width="2" '
                                    'stroke-linecap="round" stroke-linejoin="round">'
                                    '<path d="M12 5v14m-6-6 6 6 6-6"/></svg>',
                                    width: 18,
                                    height: 18,
                                    colorFilter: ColorFilter.mode(
                                      Theme.of(
                                        context,
                                      ).colorScheme.onSecondaryContainer,
                                      BlendMode.srcIn,
                                    ),
                                    excludeFromSemantics: true,
                                  ),
                                )
                              : const SizedBox.shrink(),
                        ),
                      ),
                    ],
                  ),
                ),
                if ((activeAgents.isNotEmpty || pendingApprovals.isNotEmpty) &&
                    !_coworkSettingsOpen &&
                    !_kimiPanelOpen)
                  ConstrainedBox(
                    constraints: BoxConstraints(
                      maxHeight: constraints.maxHeight,
                    ),
                    child: Container(
                      key: ValueKey('composer-agent-status-${session!.id}'),
                      padding: const EdgeInsets.fromLTRB(8, 6, 8, 0),
                      child: _ConversationActivityDock(
                        controller: controller,
                        answerDrafts: widget.draft.approvalAnswers,
                        maxPanelHeight: math.max(
                          60.0,
                          constraints.maxHeight -
                              (View.of(context).viewInsets.bottom > 0 &&
                                      pendingApprovals.any(
                                        (approval) =>
                                            approval.action['type'] ==
                                            'question.select',
                                      )
                                  ? 14
                                  : 110),
                        ),
                        approvals: pendingApprovals,
                        approvalOpenRequest: widget.tailEntryRevision,
                        agents: activeAgents,
                        loading: controller.agentActivityLoadingForSession(
                          session.id,
                        ),
                        error: controller.agentActivityErrorForSession(
                          session.id,
                        ),
                        openRequest:
                            widget.agentWindowOpenRequest +
                            _localAgentWindowOpenRequest,
                        onInspectAgent: (_) {
                          if (controller.relayKey != null &&
                              controller.deviceOnline) {
                            unawaited(
                              controller.refreshAgentActivity(session.id),
                            );
                          }
                        },
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
        if (session?.provider == 'kimi')
          _KimiSessionStrip(
            session: session!,
            onTap: () => setState(() {
              _kimiPanelOpen = true;
              _kimiPanelView = 'settings';
            }),
          ),
        if (session?.provider == 'kimi' && _kimiPanelOpen)
          _KimiCommandPanel(
            controller: controller,
            session: session!,
            draft: _draft.text,
            view: _kimiPanelView,
            running: running,
            onViewChanged: (value) => setState(() => _kimiPanelView = value),
            onClose: () => setState(() => _kimiPanelOpen = false),
            onOpenAgentWindow: () {
              setState(() {
                _kimiPanelOpen = false;
                _localAgentWindowOpenRequest += 1;
              });
            },
            onRunCommand: _runKimiCommand,
            onConfigure: _configureKimi,
          ),
        if (session?.provider == 'claude-cowork' && _coworkSettingsOpen)
          _CoworkSettingsPanel(
            controller: controller,
            session: session!,
            running: running,
            onClose: () => setState(() => _coworkSettingsOpen = false),
            onConfigure: _configureCowork,
          ),
        if (session != null &&
            !session.isSubagent &&
            const {'codex', 'claude'}.contains(session.provider))
          SessionModelSettings(
            key: ValueKey('model-settings-${session.id}'),
            controller: controller,
            session: session,
          ),
        _Composer(
          controller: _draft,
          attachments: _pendingAttachments,
          supportsImages: session?.provider != 'mcode',
          showTopBorder: activeAgents.isEmpty && pendingApprovals.isEmpty,
          enabled: session != null && !session.isSubagent,
          deviceOnline: controller.deviceOnline,
          running: running,
          canInterrupt: controller.canInterruptSession(session),
          canSteer:
              (session?.supportsSteering ?? false) ||
              (session?.supportsInterruptAndSend ?? false),
          stopping: controller.isStoppingSession(session?.id),
          canContinue: controller.canContinueSession(session),
          continuing: controller.isContinuingSession(session?.id),
          pickingAttachments: _pickingAttachments,
          sending:
              _sending ||
              controller.configuringSessions.contains(session?.id) ||
              controller.isContinuingSession(session?.id),
          onStop: controller.interruptTurn,
          onSend: _send,
          onContinue: () {
            if (session != null) {
              unawaited(controller.continueSession(session.id));
            }
          },
          onAttachment: _requestAttachment,
          onRemoveAttachment: (attachment) => setState(() {
            _pendingAttachments.removeWhere((item) => item.id == attachment.id);
            _syncPendingAttachments();
          }),
        ),
      ],
    );
  }

  Widget _messageList(
    AppController controller,
    RelaySession session,
    bool running,
  ) {
    final items = controller.messages[session.id] ?? const <RelayMessage>[];
    final thinkingStartedAt = controller.sessionThinkingStartedAt(session.id);
    final showLiveActivity =
        thinkingStartedAt != null &&
        running &&
        controller.deviceOnline &&
        !controller.realtimeReconnecting &&
        !controller.isStoppingSession(session.id) &&
        !controller
            .approvalsForSession(session.id)
            .any(
              (approval) =>
                  controller.approvalIsPending(approval) ||
                  approval.state == 'deciding',
            );
    if (!identical(items, _groupedMessageSource) ||
        items.length != _groupedMessageLength ||
        !identical(items.lastOrNull, _groupedMessageLast) ||
        _liveActivityVisible != showLiveActivity) {
      _preserveReadingAnchor();
    }
    _liveActivityVisible = showLiveActivity;
    _rowAnchors.removeWhere((_, key) => key.currentContext == null);
    final groups = _conversationGroups(items);
    final approvals = [
      ...controller
          .approvalsForSession(session.id)
          .where(
            (approval) =>
                !controller.approvalIsPending(approval) &&
                approval.state != 'deciding',
          ),
    ]..sort((left, right) => left.requestedAt.compareTo(right.requestedAt));
    final loading =
        controller.deviceOnline && controller.historyLoadingVisible(session.id);
    final historyError = controller.historyErrorFor(session.id);
    final canLoadMore =
        controller.deviceOnline &&
        (controller.historyHasMore[session.id] ?? false);
    final activity = controller.sessionActivity(session.id);
    _followMessageTailWhenAppropriate(
      items,
      approvals,
      running || activity != null,
      liveActivityVisible: showLiveActivity,
    );
    final approvalsByGroup = <String, List<RelayApproval>>{};
    for (final approval in approvals) {
      var group = groups
          .where((g) => approval.turnId != null && g.turnId == approval.turnId)
          .firstOrNull;
      // Legacy requests have no turn id. Only place them within loaded history;
      // never append old requests to the newest answer.
      if (approval.turnId == null) {
        final requested = DateTime.tryParse(approval.requestedAt);
        if (requested != null) {
          group = groups
              .where(
                (g) => g.messages.any((m) {
                  final at = DateTime.tryParse(m.createdAt);
                  return at != null && !at.isAfter(requested);
                }),
              )
              .lastOrNull;
        }
      }
      if (group != null) (approvalsByGroup[group.id] ??= []).add(approval);
    }
    // Thinking belongs to the latest turn, after its tools and before its divider.
    // A turn with no loaded messages still gets a transient presentation row.
    final standaloneThinking = showLiveActivity && groups.isEmpty;
    final rowCount = 1 + groups.length + (standaloneThinking ? 1 : 0);
    final rowIndices = <Key, int>{
      if (standaloneThinking) const ValueKey('conversation-live-activity'): 0,
      for (var i = 0; i < groups.length; i++)
        ValueKey('conversation-turn-${groups[i].id}'): rowCount - 2 - i,
    };
    _scheduleInitialHistoryFill(controller, session, groups, running);
    return LayoutBuilder(
      key: _messageViewportKey,
      builder: (context, constraints) => NotificationListener<ScrollMetricsNotification>(
        onNotification: (notification) {
          if (notification.depth == 0) _updateBackToLatestVisibility();
          return false;
        },
        child: NotificationListener<ScrollNotification>(
          onNotification: _handleHistoryScroll,
          child: Align(
            alignment: Alignment.topCenter,
            child: ListView.builder(
              key: const ValueKey('conversation-message-list'),
              controller: _scroll,
              // The latest row is at offset zero: entering a long conversation never
              // has to lay out historical rows to estimate its bottom.
              reverse: true,
              // Let short conversations occupy only their content height so the
              // outer alignment keeps the first message at the viewport top.
              shrinkWrap: true,
              padding: const EdgeInsets.fromLTRB(14, 10, 14, 22),
              itemCount: rowCount,
              findChildIndexCallback: (key) => rowIndices[key],
              itemBuilder: (context, index) {
                final chronologicalIndex = rowCount - 1 - index;
                if (standaloneThinking && index == 0) {
                  return Padding(
                    key: const ValueKey('conversation-live-activity'),
                    padding: const EdgeInsetsDirectional.only(start: 24),
                    child: _AssistantActivityBubble(
                      startedAt: thinkingStartedAt,
                    ),
                  );
                }
                if (chronologicalIndex == 0) {
                  if (loading && historyError == null) {
                    final firstPage = items.isEmpty;
                    return ConstrainedBox(
                      key: const ValueKey('history-loading-state'),
                      constraints: firstPage
                          ? BoxConstraints(
                              minHeight: math.max(
                                220.0,
                                constraints.maxHeight * .62,
                              ),
                            )
                          : const BoxConstraints.tightFor(height: 54),
                      child: Center(
                        child: HistoryLoadingProgress(
                          progress: controller.historyProgressFor(session.id),
                          compact: !firstPage,
                        ),
                      ),
                    );
                  }
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Center(
                      child: !controller.deviceOnline
                          ? Text(
                              context.l10n.workbenchDeviceOfflineQueued,
                              textAlign: TextAlign.center,
                              style: Theme.of(context).textTheme.bodySmall
                                  ?.copyWith(color: RelayTheme.muted),
                            )
                          : historyError != null
                          ? Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(historyError, textAlign: TextAlign.center),
                                TextButton(
                                  key: const ValueKey('retry-history-load'),
                                  onPressed: loading
                                      ? null
                                      : () =>
                                            controller.retryHistory(session.id),
                                  child: Text(context.l10n.commonRetry),
                                ),
                              ],
                            )
                          : canLoadMore
                          ? TextButton(
                              key: const ValueKey('load-earlier-history'),
                              onPressed: () => controller.loadHistory(
                                session.id,
                                earlier: true,
                              ),
                              child: Text(context.l10n.workbenchLoadEarlier),
                            )
                          : Text(
                              items.isEmpty
                                  ? context.l10n.workbenchSendFirst
                                  : context.l10n.workbenchAtBeginning,
                              style: Theme.of(context).textTheme.bodySmall
                                  ?.copyWith(color: RelayTheme.muted),
                            ),
                    ),
                  );
                }
                if (chronologicalIndex <= groups.length) {
                  final groupIndex = chronologicalIndex - 1;
                  _rowAnchors.removeWhere(
                    (_, key) => key.currentContext == null,
                  );
                  return KeyedSubtree(
                    key: ValueKey('conversation-turn-${groups[groupIndex].id}'),
                    child: _ConversationTurn(
                      key: _rowAnchors.putIfAbsent(
                        groups[groupIndex].id,
                        GlobalKey.new,
                      ),
                      onToggleActivity: (anchor, removedHeight) {
                        _atMessageTail = false;
                        _initialTailPending = false;
                        _scroll.preserveAnchor(
                          anchor,
                          removedHeight: removedHeight,
                        );
                        WidgetsBinding.instance.addPostFrameCallback((_) {
                          if (mounted) _handleMessageScroll();
                        });
                      },
                      group: groups[groupIndex],
                      approvals:
                          approvalsByGroup[groups[groupIndex].id] ?? const [],
                      session: session,
                      controller: controller,
                      active: running && groupIndex == groups.length - 1,
                      latest: groupIndex == groups.length - 1,
                      thinkingStartedAt:
                          showLiveActivity && groupIndex == groups.length - 1
                          ? thinkingStartedAt
                          : null,
                      waitingLabel: !running && groupIndex == groups.length - 1
                          ? activity
                          : null,
                    ),
                  );
                }
                return const SizedBox.shrink();
              },
            ),
          ),
        ),
      ),
    );
  }

  void _scheduleInitialHistoryFill(
    AppController controller,
    RelaySession session,
    List<_ConversationGroup> groups,
    bool running,
  ) {
    final sessionId = session.id;
    final cursor = controller.historyCursors[sessionId];
    bool available() =>
        !_initialHistoryFillStopped &&
        _initialEarlierPages < 2 &&
        _atMessageTail &&
        controller.deviceOnline &&
        !controller.localReadOnly &&
        controller.historyHasMore[sessionId] == true &&
        !controller.historyLoading.contains(sessionId) &&
        controller.historyErrorFor(sessionId) == null &&
        cursor?.isNotEmpty == true &&
        controller.historyCursors[sessionId] == cursor &&
        cursor != _lastInitialEarlierCursor;
    if (_earlierHistoryScheduled || !available()) return;
    _earlierHistoryScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _earlierHistoryScheduled = false;
      if (!mounted ||
          controller != widget.controller ||
          sessionId != _readingSessionId ||
          sessionId != controller.activeSessionId ||
          !_scroll.hasClients ||
          !_scroll.position.hasContentDimensions ||
          !available()) {
        return;
      }
      final readable = groups.any((group) {
        if (group.messages.any(
          (message) =>
              message.role == 'user' &&
              (message.content.trim().isNotEmpty ||
                  message.attachments.isNotEmpty),
        )) {
          return true;
        }
        final active = running && identical(group, groups.last);
        if (active &&
            group.messages.any(
              (message) =>
                  message.role == 'codex' && message.content.trim().isNotEmpty,
            )) {
          return true;
        }
        return _finalAssistantMessageIndex(
              group.messages
                  .where((message) => message.role != 'user')
                  .toList(),
              active: active,
            ) >=
            0;
      });
      if (_scroll.position.maxScrollExtent > 1 && readable) return;
      // First paint stays immediate. Fill at most two older pages when the
      // small latest page folds into tool rows or does not fill the viewport.
      _lastInitialEarlierCursor = cursor;
      _initialEarlierPages += 1;
      unawaited(
        controller
            .loadHistory(sessionId, earlier: true)
            .then<void>(
              (_) {
                if (mounted &&
                    controller == widget.controller &&
                    sessionId == controller.activeSessionId &&
                    !_initialHistoryFillStopped) {
                  setState(() {});
                }
              },
              onError: (Object _, StackTrace __) {
                _initialHistoryFillStopped = true;
              },
            ),
      );
    });
  }

  bool _handleHistoryScroll(ScrollNotification notification) {
    // The message list is reversed: increasing pixels means older records.
    // Only react to movement toward history, not initial layout, anchor
    // compensation, nested tool scrolling, or the back-to-latest action.
    if (notification.depth != 0) return false;
    if (notification is ScrollStartNotification) {
      _historyUserScrollActive = notification.dragDetails != null;
      if (_historyUserScrollActive) {
        _initialHistoryFillStopped = true;
        // User intent takes precedence even before a small drag leaves the
        // near-tail threshold. Pending frames must not undo finger movement.
        _initialTailPending = false;
        _atMessageTail = false;
        _scroll.followsLatest = false;
      }
    } else if (notification is ScrollEndNotification) {
      _historyUserScrollActive = false;
      _handleMessageScroll();
    }
    final towardHistory = notification is ScrollUpdateNotification
        ? (notification.scrollDelta ?? 0) > 0
        : notification is OverscrollNotification && notification.overscroll > 0;
    if (!_historyUserScrollActive ||
        !towardHistory ||
        notification.metrics.extentAfter > 160 ||
        _earlierHistoryScheduled) {
      return false;
    }
    final controller = widget.controller;
    final sessionId = controller.activeSessionId;
    if (sessionId == null ||
        !controller.deviceOnline ||
        controller.historyHasMore[sessionId] != true ||
        controller.historyLoading.contains(sessionId) ||
        controller.historyErrorFor(sessionId) != null) {
      return false;
    }
    _earlierHistoryScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _earlierHistoryScheduled = false;
      if (!mounted ||
          controller != widget.controller ||
          sessionId != controller.activeSessionId ||
          controller.historyErrorFor(sessionId) != null) {
        return;
      }
      unawaited(controller.loadHistory(sessionId, earlier: true));
    });
    return false;
  }

  List<_ConversationGroup> _conversationGroups(List<RelayMessage> messages) {
    final first = messages.firstOrNull;
    final last = messages.lastOrNull;
    if (identical(messages, _groupedMessageSource) &&
        messages.length == _groupedMessageLength &&
        identical(first, _groupedMessageFirst) &&
        identical(last, _groupedMessageLast)) {
      return _groupedMessages;
    }
    _groupedMessageSource = messages;
    _groupedMessageLength = messages.length;
    _groupedMessageFirst = first;
    _groupedMessageLast = last;
    return _groupedMessages = _groupMessagesByTurn(messages);
  }

  void _preserveReadingAnchor() {
    if (_atMessageTail ||
        _initialTailPending ||
        _historyUserScrollActive ||
        !_scroll.hasClients) {
      return;
    }
    final viewport = _messageViewportKey.currentContext?.findRenderObject();
    if (viewport is! RenderBox || !viewport.hasSize) return;
    final top = viewport.localToGlobal(Offset.zero).dy;
    final bottom = top + viewport.size.height;
    for (final key in _rowAnchors.values) {
      final box = key.currentContext?.findRenderObject();
      if (box is! RenderBox || !box.attached || !box.hasSize) continue;
      final before = box.localToGlobal(Offset.zero).dy;
      if (before >= bottom || before + box.size.height <= top) continue;
      // New replies enter below the reader in the reversed list. Compensate
      // their layout displacement, keeping the same text at the same height.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted ||
            _atMessageTail ||
            _historyUserScrollActive ||
            !_scroll.hasClients) {
          return;
        }
        final updated = key.currentContext?.findRenderObject();
        if (updated is! RenderBox || !updated.attached || !updated.hasSize) {
          return;
        }
        final shift = before - updated.localToGlobal(Offset.zero).dy;
        if (shift.abs() < .5) return;
        _scroll.jumpTo(
          (_scroll.offset + shift).clamp(
            _scroll.position.minScrollExtent,
            _scroll.position.maxScrollExtent,
          ),
        );
      });
      break;
    }
  }

  void _handleMessageScroll() {
    if (!_scroll.hasClients) return;
    if (!_historyUserScrollActive) {
      // Once the reader leaves the tail, only actually reaching it resumes
      // following. Remaining within 72 pixels after a drag is not consent.
      _atMessageTail = _scroll.distanceFromLatest <= (_atMessageTail ? 72 : 1);
    }
    _scroll.followsLatest = _atMessageTail;
    _updateBackToLatestVisibility();
    final sessionId = _readingSessionId;
    if (sessionId != null) {
      widget.readingPositions?.save(
        sessionId,
        offset: _scroll.offset,
        atTail: _atMessageTail,
      );
    }
  }

  void _updateBackToLatestVisibility() {
    if (!_scroll.hasClients || !_scroll.position.hasContentDimensions) return;
    // One screen of history is easy to return from with a gesture. Keep this
    // visibility threshold independent of the stricter live-follow threshold.
    _showBackToLatest.value =
        _scroll.distanceFromLatest > _scroll.position.viewportDimension;
  }

  void _handleLiveReplyUpdate() {
    if (!_atMessageTail || _initialTailPending || _liveTailScrollScheduled) {
      return;
    }
    _liveTailScrollScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _liveTailScrollScheduled = false;
      if (!mounted || !_atMessageTail || !_scroll.hasClients) return;
      final target = _scroll.latestOffset;
      if ((_scroll.offset - target).abs() > .5) _scroll.jumpTo(target);
    });
  }

  void _followMessageTailWhenAppropriate(
    List<RelayMessage> items,
    List<RelayApproval> approvals,
    bool running, {
    required bool liveActivityVisible,
  }) {
    final last = items.isEmpty ? null : items.last;
    final lastApproval = approvals.isEmpty ? null : approvals.last;
    final latestAssistant = items
        .where((message) => message.role == 'codex')
        .lastOrNull;
    final revision = Object.hash(
      running,
      liveActivityVisible,
      items.length,
      last?.id,
      last?.kind,
      last?.content,
      last?.attachments.length,
      latestAssistant?.id,
      latestAssistant?.content,
      approvals.length,
      lastApproval?.id,
      lastApproval?.state,
    );
    if (_messageTailRevision == revision) return;
    _messageTailRevision = revision;
    if (_initialTailPending || _atMessageTail) {
      _scheduleTailScroll();
    }
  }

  void _scheduleTailScroll() {
    if (_tailScrollScheduled) return;
    _tailScrollScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _tailScrollScheduled = false;
      if (!mounted || !_scroll.hasClients) return;
      final target = _scroll.latestOffset;
      if (_initialTailPending) {
        _scroll.jumpTo(target);
        _atMessageTail = true;
        _initialTailAttempts += 1;
        final stable =
            _lastInitialTailExtent != null &&
            (target - _lastInitialTailExtent!).abs() < .5;
        _lastInitialTailExtent = target;
        if (stable || _initialTailAttempts >= 8) {
          _initialTailPending = false;
        } else {
          WidgetsBinding.instance.scheduleFrame();
          _scheduleTailScroll();
        }
        return;
      }
      if (!_atMessageTail || _historyUserScrollActive) return;
      // Layout already anchors a followed tail. Avoid starting zero-distance
      // animations that the next character publication would immediately stop.
      if ((_scroll.offset - target).abs() <= .5) return;
      if (MediaQuery.disableAnimationsOf(context)) {
        _scroll.jumpTo(target);
      } else {
        _scroll.animateTo(
          target,
          duration: const Duration(milliseconds: 160),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _syncPendingAttachments() {
    widget.draft.replaceAttachments(_pendingAttachments);
  }

  Future<void> _send() async {
    final sentText = _draft.text;
    final content = sentText.trim();
    if ((content.isEmpty && _pendingAttachments.isEmpty) ||
        _sending ||
        _pickingAttachments) {
      return;
    }
    final attachments = [..._pendingAttachments];
    final draft = widget.draft;
    setState(() {
      _sending = true;
      _draft.clear();
      _pendingAttachments.clear();
      _syncPendingAttachments();
    });
    var accepted = false;
    try {
      final outcome = await widget.controller.sendMessage(
        content,
        attachments: attachments,
      );
      accepted = outcome.accepted;
    } finally {
      if (!accepted) draft.restoreFailedSubmission(sentText, attachments);
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _runKimiCommand(_KimiQuickCommand command) async {
    if (command.inputHint?.isNotEmpty == true) {
      _draft.text = '/${command.name} ';
      _draft.selection = TextSelection.collapsed(offset: _draft.text.length);
      setState(() => _kimiPanelOpen = false);
      return;
    }
    setState(() => _kimiPanelOpen = false);
    _draft.text = '/${command.name}';
    await _send();
  }

  Future<void> _configureKimi(String configId, Object value) async {
    if (const {'auto', 'yolo'}.contains(value)) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          icon: const Icon(
            Icons.warning_amber_rounded,
            color: RelayTheme.ember,
          ),
          title: Text(
            value == 'yolo'
                ? context.l10n.workbenchEnableYoloTitle
                : context.l10n.workbenchEnableAutoTitle,
          ),
          content: Text(
            value == 'yolo'
                ? context.l10n.workbenchYoloWarning
                : context.l10n.workbenchAutoWarning,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(context.l10n.commonCancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(context.l10n.workbenchConfirmEnable),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
    }
    await widget.controller.configureSession(configId, value);
  }

  Future<void> _configureCowork(String configId, Object value) async {
    if (configId == 'mode' && _isElevatedCoworkMode(value)) {
      final session = widget.controller.activeSession;
      final optionDescription = session == null
          ? null
          : _configOptionDescription(session, configId, value);
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          icon: const Icon(
            Icons.warning_amber_rounded,
            color: RelayTheme.ember,
          ),
          title: Text(context.l10n.workbenchUnrestrictedPermissionsTitle),
          content: Text(
            optionDescription ??
                context.l10n.workbenchUnrestrictedPermissionsWarning,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(context.l10n.commonCancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(context.l10n.workbenchConfirmEnable),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
    }
    await widget.controller.configureSession(configId, value);
  }

  Future<void> _requestAttachment() async {
    if (_pickingAttachments || _sending) return;
    setState(() => _pickingAttachments = true);
    try {
      await _pickAttachments();
    } on Object {
      if (mounted) {
        _showAttachmentMessage(context.l10n.workbenchImagePickFailed);
      }
    } finally {
      if (mounted) setState(() => _pickingAttachments = false);
    }
  }

  Future<void> _pickAttachments() async {
    final remaining =
        AppController.maxUploadAttachments - _pendingAttachments.length;
    if (remaining <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.workbenchUploadTooManyImages)),
      );
      return;
    }
    final picker = ImagePicker();
    // The platform multi-picker requires a limit greater than one.
    final images = remaining == 1
        ? [
            if (await picker.pickImage(
                  source: ImageSource.gallery,
                  requestFullMetadata: false,
                )
                case final image?)
              image,
          ]
        : await picker.pickMultiImage(
            requestFullMetadata: false,
            limit: remaining,
          );
    if (images.isEmpty || !mounted) return;
    final candidates = <({XFile image, String mimeType, int length})>[];
    final unsupportedNames = <String>[];
    for (final image in images.take(remaining)) {
      final mimeType = _supportedImageMimeType(image);
      if (mimeType == null) {
        unsupportedNames.add(image.name);
        continue;
      }
      candidates.add((
        image: image,
        mimeType: mimeType,
        length: await image.length(),
      ));
    }
    if (!mounted) return;
    if (unsupportedNames.isNotEmpty) {
      _showAttachmentMessage(
        context.l10n.workbenchUploadUnsupportedImages(
          unsupportedNames.join(', '),
        ),
      );
    }
    final pendingBytes = _pendingAttachments.fold<int>(
      0,
      (sum, attachment) => sum + attachment.bytes.length,
    );
    final selectedBytes = candidates.fold<int>(
      0,
      (sum, candidate) => sum + candidate.length,
    );
    if (pendingBytes + selectedBytes > AppController.maxUploadBytes) {
      _showAttachmentMessage(context.l10n.workbenchUploadTooLarge);
      return;
    }
    final selected = <UploadAttachment>[];
    for (var index = 0; index < candidates.length; index += 1) {
      final candidate = candidates[index];
      Uint8List bytes;
      Uint8List thumbnailBytes;
      try {
        bytes = await candidate.image.readAsBytes();
        thumbnailBytes = await createImageThumbnail(
          bytes,
          mimeType: candidate.mimeType,
        );
      } on Object {
        if (mounted) {
          _showAttachmentMessage(
            context.l10n.workbenchPreviewGenerateFailed(candidate.image.name),
          );
        }
        continue;
      }
      selected.add(
        UploadAttachment(
          id: 'mobile_${DateTime.now().microsecondsSinceEpoch}_$index',
          name: candidate.image.name,
          mimeType: candidate.mimeType,
          bytes: bytes,
          thumbnailBytes: thumbnailBytes,
        ),
      );
    }
    if (!mounted) return;
    if (selected.isEmpty) return;
    setState(() {
      _pendingAttachments.addAll(selected);
      _syncPendingAttachments();
    });
  }

  void _showAttachmentMessage(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }
}

String? _mimeTypeForImageName(String name) {
  final lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.avif')) return 'image/avif';
  return null;
}

String? _supportedImageMimeType(XFile image) {
  final reported = image.mimeType?.trim().toLowerCase();
  final normalized = switch (reported) {
    'image/jpg' || 'image/pjpeg' => 'image/jpeg',
    null ||
    '' ||
    'application/octet-stream' => _mimeTypeForImageName(image.name),
    _ => reported,
  };
  return AppController.supportedUploadMimeTypes.contains(normalized)
      ? normalized
      : null;
}

class _KimiQuickCommand {
  const _KimiQuickCommand({
    required this.name,
    required this.label,
    required this.description,
    required this.badge,
    this.advertised = false,
    this.inputHint,
  });

  final String name;
  final String label;
  final String description;
  final String badge;
  final bool advertised;
  final String? inputHint;
}

List<_KimiQuickCommand> _kimiQuickCommands(
  RelaySession session,
  String draft,
  AppLocalizations copy,
) {
  final builtIns = [
    _KimiQuickCommand(
      name: 'tasks',
      label: copy.workbenchKimiViewAgents,
      description: copy.workbenchKimiViewAgentsDescription,
      badge: copy.workbenchKimiOpenNow,
    ),
    _KimiQuickCommand(
      name: 'status',
      label: copy.workbenchKimiSessionStatus,
      description: copy.workbenchKimiSessionStatusDescription,
      badge: copy.workbenchKimiLocalStatus,
    ),
    _KimiQuickCommand(
      name: 'model',
      label: copy.workbenchKimiModel,
      description: copy.workbenchKimiModelDescription,
      badge: copy.workbenchKimiSessionSettings,
    ),
    _KimiQuickCommand(
      name: 'permission',
      label: copy.workbenchKimiPermissionMode,
      description: copy.workbenchKimiPermissionModeDescription,
      badge: copy.workbenchKimiSecuritySettings,
    ),
    _KimiQuickCommand(
      name: 'plan',
      label: copy.workbenchKimiPlanMode,
      description: copy.workbenchKimiPlanModeDescription,
      badge: copy.workbenchKimiSessionSettings,
    ),
    _KimiQuickCommand(
      name: 'yolo',
      label: copy.workbenchKimiYoloMode,
      description: copy.workbenchKimiYoloModeDescription,
      badge: copy.workbenchKimiConfirmationRequired,
    ),
    _KimiQuickCommand(
      name: 'settings',
      label: copy.workbenchKimiSettings,
      description: copy.workbenchKimiSettingsDescription,
      badge: copy.commonSettings,
    ),
  ];
  final builtInNames = builtIns.map((item) => item.name).toSet();
  final advertised = (session.raw['kimi_commands'] as List? ?? const [])
      .whereType<Map>()
      .map((item) => Map<String, dynamic>.from(item))
      .where((item) {
        final name = item['name'] as String? ?? '';
        return name.isNotEmpty && !builtInNames.contains(name);
      })
      .map(
        (item) => _KimiQuickCommand(
          name: item['name'] as String,
          label: item['description'] as String? ?? item['name'] as String,
          description: (item['input_hint'] as String?)?.isNotEmpty == true
              ? copy.workbenchKimiInputRequired('${item['input_hint']}')
              : copy.workbenchKimiNativeCommandDescription,
          badge: copy.workbenchKimiNativeCommand,
          advertised: true,
          inputHint: item['input_hint'] as String?,
        ),
      );
  final query = draft.startsWith('/')
      ? draft.substring(1).trim().toLowerCase()
      : '';
  return [...builtIns, ...advertised]
      .where((item) {
        if (query.isEmpty) return true;
        return '${item.name} ${item.label} ${item.description}'
            .toLowerCase()
            .contains(query);
      })
      .toList(growable: false);
}

Object? _kimiConfigValue(RelaySession session, String id) {
  final option = _sessionConfigOption(session, id);
  if (option != null) return option['currentValue'];
  return switch (id) {
    'model' => session.raw['model'],
    'thinking' => session.raw['reasoning_effort'],
    'mode' => session.raw['permission_mode'],
    _ => null,
  };
}

Map<String, dynamic>? _sessionConfigOption(RelaySession session, String id) {
  final rawOptions =
      session.raw['session_config_options'] ??
      session.raw['kimi_config_options'];
  final options = (rawOptions as List? ?? const []).whereType<Map>().map(
    (item) => Map<String, dynamic>.from(item),
  );
  for (final option in options) {
    if (option['id'] == id) return option;
  }
  return null;
}

String _compactMetric(Object? value) {
  final amount = value is num ? value.toDouble() : double.tryParse('$value');
  if (amount == null) return '—';
  if (amount >= 1000000) {
    return '${(amount / 1000000).toStringAsFixed(amount % 1000000 == 0 ? 0 : 1)}m';
  }
  if (amount >= 1000) {
    return '${(amount / 1000).toStringAsFixed(amount % 1000 == 0 ? 0 : 1)}k';
  }
  return amount.round().toString();
}

String _kimiUsageLabel(
  RelaySession session,
  AppLocalizations copy, {
  bool includeContext = true,
}) {
  final usage = session.raw['usage'];
  if (usage is! Map) {
    return includeContext
        ? copy.workbenchKimiContextSyncing
        : copy.workbenchKimiWaitingForSync;
  }
  final used = usage['used'] as num?;
  final size = usage['size'] as num?;
  if (used == null) {
    return includeContext
        ? copy.workbenchKimiContextSyncing
        : copy.workbenchKimiWaitingForSync;
  }
  if (size != null && size > 0) {
    final percent = ((used / size) * 100).round().clamp(0, 100);
    final usage = copy.workbenchKimiContextUsage(
      percent,
      _compactMetric(used),
      _compactMetric(size),
    );
    return includeContext
        ? usage
        : usage.replaceFirst('${copy.workbenchKimiContext} ', '');
  }
  final label = copy.workbenchKimiContextUsed(_compactMetric(used));
  return includeContext
      ? label
      : label.replaceFirst('${copy.workbenchKimiContext} ', '');
}

class _KimiSessionStrip extends StatelessWidget {
  const _KimiSessionStrip({required this.session, required this.onTap});

  final RelaySession session;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final copy = context.l10n;
    final mode = '${_kimiConfigValue(session, 'mode') ?? 'default'}';
    return Material(
      color: const Color(0xFF202321),
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 9),
            child: Row(
              children: [
                const _KimiStripChip(label: 'Kimi', live: true),
                _KimiStripChip(
                  label:
                      '${_kimiConfigValue(session, 'model') ?? copy.workbenchKimiModelSyncing}',
                ),
                _KimiStripChip(
                  label:
                      'Thinking ${_kimiConfigValue(session, 'thinking') ?? '—'}',
                ),
                _KimiStripChip(
                  label: _kimiModeLabel(mode, copy),
                  warning: const {'auto', 'yolo'}.contains(mode),
                ),
                if (session.raw['swarm_mode'] == true)
                  const _KimiStripChip(label: 'Swarm'),
                _KimiStripChip(label: _kimiUsageLabel(session, copy)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _KimiStripChip extends StatelessWidget {
  const _KimiStripChip({
    required this.label,
    this.live = false,
    this.warning = false,
  });

  final String label;
  final bool live;
  final bool warning;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsetsDirectional.only(end: 8),
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
    decoration: BoxDecoration(
      color: warning
          ? RelayTheme.ember.withValues(alpha: .22)
          : Colors.white.withValues(alpha: .08),
      borderRadius: BorderRadius.circular(99),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (live) ...[
          const _ConnectionDot(online: true),
          const SizedBox(width: 6),
        ],
        Text(
          label,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}

class _KimiCommandPanel extends StatelessWidget {
  const _KimiCommandPanel({
    required this.controller,
    required this.session,
    required this.draft,
    required this.view,
    required this.running,
    required this.onViewChanged,
    required this.onClose,
    required this.onOpenAgentWindow,
    required this.onRunCommand,
    required this.onConfigure,
  });

  final AppController controller;
  final RelaySession session;
  final String draft;
  final String view;
  final bool running;
  final ValueChanged<String> onViewChanged;
  final VoidCallback onClose;
  final VoidCallback onOpenAgentWindow;
  final Future<void> Function(_KimiQuickCommand) onRunCommand;
  final Future<void> Function(String, Object) onConfigure;

  @override
  Widget build(BuildContext context) {
    final copy = context.l10n;
    final availableHeight =
        MediaQuery.sizeOf(context).height -
        MediaQuery.viewInsetsOf(context).bottom;
    final panelHeight = (availableHeight * .36).clamp(156.0, 310.0);
    return Container(
      key: const ValueKey('kimi-command-panel'),
      height: panelHeight,
      decoration: const BoxDecoration(
        color: RelayTheme.surface,
        border: Border(top: BorderSide(color: RelayTheme.line)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              const SizedBox(width: 10),
              Expanded(
                child: SegmentedButton<String>(
                  showSelectedIcon: false,
                  segments: [
                    ButtonSegment(
                      value: 'commands',
                      label: Text(copy.workbenchKimiQuickCommands),
                    ),
                    ButtonSegment(
                      value: 'settings',
                      label: Text(copy.workbenchKimiSessionSettings),
                    ),
                  ],
                  selected: {view},
                  onSelectionChanged: (value) => onViewChanged(value.first),
                ),
              ),
              IconButton(
                tooltip: copy.commonClose,
                onPressed: onClose,
                icon: const Icon(Icons.close),
              ),
            ],
          ),
          const Divider(height: 1),
          Expanded(
            child: view == 'commands'
                ? _KimiCommandList(
                    commands: _kimiQuickCommands(session, draft, copy),
                    deviceOnline: controller.deviceOnline,
                    onOpenAgentWindow: onOpenAgentWindow,
                    onOpenSettings: () => onViewChanged('settings'),
                    onRun: onRunCommand,
                  )
                : _KimiSettingsBody(
                    controller: controller,
                    session: session,
                    running: running,
                    onConfigure: onConfigure,
                  ),
          ),
        ],
      ),
    );
  }
}

class _KimiCommandList extends StatelessWidget {
  const _KimiCommandList({
    required this.commands,
    required this.deviceOnline,
    required this.onOpenAgentWindow,
    required this.onOpenSettings,
    required this.onRun,
  });

  final List<_KimiQuickCommand> commands;
  final bool deviceOnline;
  final VoidCallback onOpenAgentWindow;
  final VoidCallback onOpenSettings;
  final Future<void> Function(_KimiQuickCommand) onRun;

  @override
  Widget build(BuildContext context) => commands.isEmpty
      ? Center(child: Text(context.l10n.workbenchKimiNoMatchingCommands))
      : ListView.builder(
          padding: const EdgeInsets.fromLTRB(8, 6, 8, 10),
          itemCount: commands.length,
          itemBuilder: (context, index) {
            final command = commands[index];
            return ListTile(
              minTileHeight: 54,
              leading: Text(
                '/${command.name}',
                style: const TextStyle(
                  fontFamily: 'monospace',
                  color: RelayTheme.fern,
                  fontWeight: FontWeight.w800,
                ),
              ),
              title: Text(command.label),
              subtitle: Text(
                command.description,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              trailing: Text(
                command.badge,
                style: Theme.of(context).textTheme.labelSmall,
              ),
              onTap: command.advertised && !deviceOnline
                  ? null
                  : () {
                      if (command.name == 'tasks' && !command.advertised) {
                        onOpenAgentWindow();
                      } else if (!command.advertised) {
                        onOpenSettings();
                      } else {
                        onRun(command);
                      }
                    },
            );
          },
        );
}

class _KimiSettingsBody extends StatelessWidget {
  const _KimiSettingsBody({
    required this.controller,
    required this.session,
    required this.running,
    required this.onConfigure,
  });

  final AppController controller;
  final RelaySession session;
  final bool running;
  final Future<void> Function(String, Object) onConfigure;

  @override
  Widget build(BuildContext context) {
    final copy = context.l10n;
    final options = (session.raw['kimi_config_options'] as List? ?? const [])
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList(growable: false);
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 18),
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            final width = (constraints.maxWidth - 8) / 2;
            return Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _KimiStatusMetric(
                  width: width,
                  label: copy.workbenchKimiTask,
                  value: running
                      ? copy.workbenchRunning
                      : copy.workbenchKimiIdle,
                ),
                _KimiStatusMetric(
                  width: width,
                  label: copy.workbenchKimiSubagents,
                  value: copy.workbenchKimiActiveCount(
                    controller.activeSessionAgents
                        .where((item) => item.isActive)
                        .length,
                  ),
                ),
                _KimiStatusMetric(
                  width: width,
                  label: copy.workbenchKimiApprovals,
                  value: copy.workbenchKimiPendingCount(
                    controller.pendingApprovalCountForSession(session.id),
                  ),
                ),
                _KimiStatusMetric(
                  width: width,
                  label: copy.workbenchKimiContext,
                  value: _kimiUsageLabel(session, copy, includeContext: false),
                ),
              ],
            );
          },
        ),
        if (!controller.deviceOnline || running) ...[
          const SizedBox(height: 10),
          Text(
            !controller.deviceOnline
                ? copy.workbenchKimiSettingsOffline
                : copy.workbenchKimiSettingsRunning,
            style: const TextStyle(
              color: RelayTheme.ember,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
        const SizedBox(height: 10),
        if (options.isEmpty)
          Padding(
            padding: const EdgeInsets.all(14),
            child: Text(copy.workbenchKimiNoOptions),
          ),
        ...options.map(
          (config) => _SessionConfigTile(
            config: config,
            enabled: controller.deviceOnline && !running,
            onSelected: (value) =>
                onConfigure(config['id'] as String? ?? '', value),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          copy.workbenchKimiEncryptedSettings,
          style: const TextStyle(color: RelayTheme.muted, fontSize: 12),
        ),
      ],
    );
  }
}

class _CoworkSettingsPanel extends StatelessWidget {
  const _CoworkSettingsPanel({
    required this.controller,
    required this.session,
    required this.running,
    required this.onClose,
    required this.onConfigure,
  });

  final AppController controller;
  final RelaySession session;
  final bool running;
  final VoidCallback onClose;
  final Future<void> Function(String, Object) onConfigure;

  @override
  Widget build(BuildContext context) {
    final copy = context.l10n;
    final options = (session.raw['session_config_options'] as List? ?? const [])
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList(growable: false);
    final availableHeight =
        MediaQuery.sizeOf(context).height -
        MediaQuery.viewInsetsOf(context).bottom;
    final panelHeight = (availableHeight * .42).clamp(190.0, 360.0);
    return Container(
      key: const ValueKey('cowork-session-settings-panel'),
      height: panelHeight,
      decoration: const BoxDecoration(
        color: RelayTheme.surface,
        border: Border(top: BorderSide(color: RelayTheme.line)),
      ),
      child: Column(
        children: [
          SizedBox(
            height: 48,
            child: Row(
              children: [
                const SizedBox(width: 14),
                const Icon(Icons.tune, size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Claude Cowork · ${copy.workbenchSessionSettings}',
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
                IconButton(
                  tooltip: copy.commonClose,
                  onPressed: onClose,
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(14, 10, 14, 18),
              children: [
                if (!controller.deviceOnline || running) ...[
                  Text(
                    !controller.deviceOnline
                        ? copy.workbenchSessionSettingsOffline
                        : copy.workbenchSessionSettingsRunning,
                    style: const TextStyle(
                      color: RelayTheme.ember,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 10),
                ],
                if (options.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: Text(copy.workbenchNoConfigOptions),
                  ),
                ...options.map(
                  (config) => _SessionConfigTile(
                    config: config,
                    enabled: controller.deviceOnline && !running,
                    onSelected: (value) =>
                        onConfigure(config['id'] as String? ?? '', value),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  copy.workbenchEncryptedSessionSettings('Claude Cowork'),
                  style: const TextStyle(color: RelayTheme.muted, fontSize: 12),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

bool _isElevatedCoworkMode(Object? value) => const {
  'acceptEdits',
  'auto',
  'dontAsk',
  'bypassPermissions',
}.contains(value);

String? _configOptionDescription(
  RelaySession session,
  String configId,
  Object value,
) {
  final configs = session.raw['session_config_options'];
  if (configs is! List) return null;
  for (final rawConfig in configs.whereType<Map>()) {
    if (rawConfig['id'] != configId || rawConfig['options'] is! List) continue;
    for (final rawOption in (rawConfig['options'] as List).whereType<Map>()) {
      if (rawOption['value'] != value) continue;
      final description = rawOption['description'] as String?;
      if (description?.trim().isNotEmpty == true) return description!.trim();
    }
  }
  return null;
}

bool _isRiskyConfigValue(Object? value) =>
    value == 'yolo' || _isElevatedCoworkMode(value);

class _KimiStatusMetric extends StatelessWidget {
  const _KimiStatusMetric({
    required this.width,
    required this.label,
    required this.value,
  });

  final double width;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Container(
    width: width,
    padding: const EdgeInsets.all(9),
    decoration: BoxDecoration(
      color: RelayTheme.panelSoft,
      borderRadius: BorderRadius.circular(7),
      border: Border.all(color: RelayTheme.lineSoft),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.labelSmall),
        const SizedBox(height: 2),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
      ],
    ),
  );
}

String _kimiModeLabel(String mode, AppLocalizations copy) => switch (mode) {
  'plan' => 'Plan',
  'auto' => 'Auto',
  'yolo' => 'YOLO',
  'manual' => copy.workbenchKimiManualApproval,
  _ => copy.workbenchDefault,
};

class _Composer extends StatefulWidget {
  const _Composer({
    required this.controller,
    required this.attachments,
    required this.showTopBorder,
    required this.supportsImages,
    required this.enabled,
    required this.deviceOnline,
    required this.running,
    required this.canInterrupt,
    required this.canSteer,
    required this.stopping,
    required this.canContinue,
    required this.continuing,
    required this.pickingAttachments,
    required this.sending,
    required this.onSend,
    required this.onContinue,
    required this.onStop,
    required this.onAttachment,
    required this.onRemoveAttachment,
  });

  final TextEditingController controller;
  final List<UploadAttachment> attachments;
  final bool showTopBorder;
  final bool supportsImages;
  final bool enabled;
  final bool deviceOnline;
  final bool running;
  final bool canInterrupt;
  final bool canSteer;
  final bool stopping;
  final bool canContinue;
  final bool continuing;
  final bool pickingAttachments;
  final bool sending;
  final VoidCallback onSend;
  final VoidCallback onContinue;
  final VoidCallback onStop;
  final VoidCallback onAttachment;
  final ValueChanged<UploadAttachment> onRemoveAttachment;

  @override
  State<_Composer> createState() => _ComposerState();
}

class _ComposerState extends State<_Composer> {
  final _focusNode = FocusNode();
  final _inputKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(_refresh);
    widget.controller.addListener(_refresh);
  }

  void _refresh() => setState(() {});

  @override
  void didUpdateWidget(covariant _Composer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_refresh);
      widget.controller.addListener(_refresh);
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_refresh);
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final canCompose = widget.enabled && widget.deviceOnline;
    final canEditImages =
        canCompose &&
        widget.supportsImages &&
        !widget.sending &&
        !widget.pickingAttachments;
    final showStop =
        widget.enabled &&
        ((widget.running && widget.canInterrupt) || widget.stopping);
    final hasContent =
        widget.controller.text.trim().isNotEmpty ||
        widget.attachments.isNotEmpty;
    final showContinue =
        !hasContent && (widget.canContinue || widget.continuing);
    final input = KeyedSubtree(
      key: _inputKey,
      child: TextField(
        key: const ValueKey('conversation-composer-input'),
        focusNode: _focusNode,
        controller: widget.controller,
        style: const TextStyle(fontSize: 15),
        enabled: canCompose,
        minLines: 1,
        maxLines: 6,
        textCapitalization: TextCapitalization.sentences,
        decoration: InputDecoration(
          filled: false,
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          disabledBorder: InputBorder.none,
          hintText: !widget.deviceOnline
              ? context.l10n.workbenchOfflineQueued
              : !widget.enabled
              ? context.l10n.workbenchReadOnly
              : widget.running
              ? context.l10n.workbenchSteerPlaceholder
              : context.l10n.workbenchSendPlaceholder,
          hintMaxLines: 1,
          contentPadding: const EdgeInsets.fromLTRB(12, 13, 12, 13),
        ),
      ),
    );
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
        decoration: BoxDecoration(
          color: RelayTheme.background,
          border: widget.showTopBorder
              ? const Border(top: BorderSide(color: RelayTheme.line))
              : null,
        ),
        child: Container(
          key: const ValueKey('composer-surface'),
          decoration: BoxDecoration(
            color: RelayTheme.panelRaised,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: RelayTheme.line),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (widget.attachments.isNotEmpty)
                SizedBox(
                  height: 104,
                  child: ListView.separated(
                    key: const ValueKey('composer-attachment-strip'),
                    padding: const EdgeInsetsDirectional.fromSTEB(12, 8, 12, 0),
                    scrollDirection: Axis.horizontal,
                    itemCount: widget.attachments.length,
                    separatorBuilder: (_, _) => const SizedBox(width: 4),
                    itemBuilder: (context, index) => _ComposerAttachmentTile(
                      attachment: widget.attachments[index],
                      onRemove: !widget.sending && !widget.pickingAttachments
                          ? () => widget.onRemoveAttachment(
                              widget.attachments[index],
                            )
                          : null,
                    ),
                  ),
                ),
              if (widget.pickingAttachments)
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                  child: Semantics(
                    liveRegion: true,
                    child: Text(
                      context.l10n.workbenchPreparingImages,
                      style: const TextStyle(
                        fontSize: 12,
                        color: RelayTheme.mutedBright,
                      ),
                    ),
                  ),
                ),
              Padding(
                padding: const EdgeInsets.fromLTRB(2, 2, 4, 2),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    IconButton(
                      key: const ValueKey('attachment-picker-button'),
                      tooltip: context.l10n.workbenchAddAttachment,
                      constraints: const BoxConstraints.tightFor(
                        width: 48,
                        height: 48,
                      ),
                      onPressed: canEditImages ? widget.onAttachment : null,
                      color: RelayTheme.mutedBright,
                      icon: widget.pickingAttachments
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(
                              Icons.add_photo_alternate_outlined,
                              size: 22,
                            ),
                    ),
                    Expanded(child: input),
                    if (!showStop || (widget.canSteer && hasContent))
                      ValueListenableBuilder<TextEditingValue>(
                        valueListenable: widget.controller,
                        builder: (context, value, _) => _ComposerSendButton(
                          enabled:
                              canCompose &&
                              (!widget.running || widget.canSteer) &&
                              !widget.stopping &&
                              !widget.sending &&
                              !widget.pickingAttachments &&
                              (value.text.trim().isNotEmpty ||
                                  widget.attachments.isNotEmpty ||
                                  widget.canContinue),
                          interactive:
                              canCompose &&
                              (!widget.running || widget.canSteer) &&
                              !widget.stopping &&
                              !widget.sending &&
                              !widget.pickingAttachments,
                          sending: widget.sending,
                          continuing: widget.continuing,
                          continueAction: showContinue,
                          onPressed: showContinue
                              ? widget.onContinue
                              : widget.onSend,
                        ),
                      ),
                    if (showStop && widget.canSteer && hasContent)
                      const SizedBox(width: 8),
                    if (showStop)
                      Semantics(
                        liveRegion: widget.stopping,
                        child: IconButton(
                          key: const ValueKey('composer-stop-button'),
                          tooltip: widget.stopping
                              ? context.l10n.workbenchStoppingTask
                              : context.l10n.workbenchStopTask,
                          constraints: const BoxConstraints.tightFor(
                            width: 48,
                            height: 48,
                          ),
                          color: RelayTheme.red,
                          onPressed: widget.deviceOnline && !widget.stopping
                              ? widget.onStop
                              : null,
                          icon: widget.stopping
                              ? const SizedBox.square(
                                  key: ValueKey('composer-stop-progress'),
                                  dimension: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: RelayTheme.mutedBright,
                                  ),
                                )
                              : const _ComposerActionIcon(
                                  glyph: _ComposerActionGlyph.stop,
                                ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ComposerAttachmentTile extends StatelessWidget {
  const _ComposerAttachmentTile({
    required this.attachment,
    required this.onRemove,
  });

  final UploadAttachment attachment;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 92,
    child: Stack(
      children: [
        PositionedDirectional(
          start: 0,
          bottom: 8,
          child: Semantics(
            button: true,
            label: context.l10n.workbenchImageThumbnailLabel(attachment.name),
            child: Material(
              color: RelayTheme.panelSoft,
              borderRadius: BorderRadius.circular(16),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                key: ValueKey('composer-attachment-${attachment.id}'),
                onTap: () => _preview(context),
                child: Image(
                  image: ResizeImage(
                    MemoryImage(attachment.thumbnailBytes ?? attachment.bytes),
                    width: 248,
                    height: 248,
                    policy: ResizeImagePolicy.fit,
                  ),
                  width: 82,
                  height: 82,
                  fit: BoxFit.cover,
                  excludeFromSemantics: true,
                  errorBuilder: (_, _, _) => const SizedBox.square(
                    dimension: 82,
                    child: Icon(
                      Icons.broken_image_outlined,
                      color: RelayTheme.muted,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        PositionedDirectional(
          end: 0,
          top: 0,
          child: IconButton(
            tooltip: context.l10n.workbenchRemoveAttachment(attachment.name),
            constraints: const BoxConstraints.tightFor(width: 48, height: 48),
            padding: const EdgeInsets.all(12),
            onPressed: onRemove,
            icon: Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                color: const Color(0xE6222222),
                shape: BoxShape.circle,
                border: Border.all(color: const Color(0x55FFFFFF)),
              ),
              child: const Icon(
                Icons.close_rounded,
                size: 15,
                color: RelayTheme.text,
              ),
            ),
          ),
        ),
      ],
    ),
  );

  Future<void> _preview(BuildContext context) => showDialog<void>(
    context: context,
    builder: (context) => Dialog.fullscreen(
      key: ValueKey('composer-attachment-preview-${attachment.id}'),
      backgroundColor: RelayTheme.background,
      child: ScaffoldMessenger(
        child: Scaffold(
          backgroundColor: RelayTheme.background,
          body: SafeArea(
            child: Column(
              children: [
                Row(
                  children: [
                    const SizedBox(width: 16),
                    Expanded(
                      child: Text(
                        attachment.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    SaveImageButton(
                      key: ValueKey('composer-image-save-${attachment.id}'),
                      loadBytes: () async => attachment.bytes,
                      name: attachment.name,
                    ),
                    IconButton(
                      tooltip: context.l10n.commonClose,
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ],
                ),
                Expanded(
                  child: InteractiveViewer(
                    minScale: 1,
                    maxScale: 5,
                    child: Center(
                      child: Image.memory(
                        attachment.bytes,
                        fit: BoxFit.contain,
                        semanticLabel: attachment.name,
                        errorBuilder: (_, _, _) => Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text(
                            context.l10n.workbenchImageReadFailed(
                              attachment.name,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

enum _ComposerActionGlyph { send, continueTask, stop }

/// One optical grid for the composer's task controls. The enclosing buttons
/// retain their independent 48 dp touch targets and accessibility labels.
class _ComposerActionIcon extends StatelessWidget {
  const _ComposerActionIcon({super.key, required this.glyph, this.color});

  final _ComposerActionGlyph glyph;
  final Color? color;

  @override
  Widget build(BuildContext context) => SvgPicture.string(
    '''<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${switch (glyph) {
      _ComposerActionGlyph.send => '<path d="M12 18V6M7 11L12 6L17 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
      _ComposerActionGlyph.continueTask => '<path d="M9 6.5Q8 5.9 8 7.1V16.9Q8 18.1 9 17.5L17.3 12.7Q18.5 12 17.3 11.3Z" fill="currentColor"/>',
      _ComposerActionGlyph.stop => '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/>',
    }}</svg>''',
    width: 24,
    height: 24,
    excludeFromSemantics: true,
    colorFilter: ColorFilter.mode(
      color ?? IconTheme.of(context).color ?? RelayTheme.text,
      BlendMode.srcIn,
    ),
  );
}

class _ComposerSendButton extends StatelessWidget {
  const _ComposerSendButton({
    required this.enabled,
    required this.interactive,
    required this.sending,
    required this.continuing,
    required this.continueAction,
    required this.onPressed,
  });

  final bool enabled;
  final bool interactive;
  final bool sending;
  final bool continuing;
  final bool continueAction;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final duration = reduceMotion
        ? Duration.zero
        : const Duration(milliseconds: 180);
    final background = sending
        ? RelayTheme.greenBackground
        : enabled
        ? RelayTheme.greenStrong
        : const Color(0xFF252525);
    final foreground = enabled ? const Color(0xFF102419) : RelayTheme.muted;
    final label = continuing
        ? context.l10n.workbenchContinuingSession
        : continueAction
        ? context.l10n.workbenchContinueSession
        : sending
        ? context.l10n.workbenchSending
        : context.l10n.workbenchSend;
    return Semantics(
      button: true,
      enabled: enabled,
      label: label,
      child: Tooltip(
        message: label,
        child: AnimatedContainer(
          key: const ValueKey('composer-send-button'),
          duration: duration,
          curve: Curves.easeOutCubic,
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: background,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(
              color: sending
                  ? RelayTheme.green.withValues(alpha: .7)
                  : enabled
                  ? RelayTheme.greenStrong
                  : const Color(0xFF353535),
            ),
          ),
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              borderRadius: BorderRadius.circular(24),
              onTap: interactive ? onPressed : null,
              child: Center(
                child: AnimatedSwitcher(
                  duration: duration,
                  switchInCurve: Curves.easeOutBack,
                  switchOutCurve: Curves.easeIn,
                  transitionBuilder: (child, animation) => FadeTransition(
                    opacity: animation,
                    child: ScaleTransition(scale: animation, child: child),
                  ),
                  child: sending
                      ? const SizedBox.square(
                          key: ValueKey('composer-send-progress'),
                          dimension: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: RelayTheme.greenStrong,
                          ),
                        )
                      : continueAction
                      ? _ComposerActionIcon(
                          glyph: _ComposerActionGlyph.continueTask,
                          key: const ValueKey('composer-continue-icon'),
                          color: foreground,
                        )
                      : _ComposerActionIcon(
                          glyph: _ComposerActionGlyph.send,
                          key: ValueKey(
                            enabled
                                ? 'composer-send-icon-enabled'
                                : 'composer-send-icon-disabled',
                          ),
                          color: foreground,
                        ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ConversationGroup {
  const _ConversationGroup({
    required this.id,
    required this.turnId,
    required this.messages,
  });

  final String id;
  final String? turnId;
  final List<RelayMessage> messages;
}

class _ConversationGroupBuffer {
  _ConversationGroupBuffer({required this.id, required this.turnId});

  final String id;
  final String? turnId;
  final List<RelayMessage> messages = [];
}

List<_ConversationGroup> _groupMessagesByTurn(List<RelayMessage> messages) {
  final buffers = <_ConversationGroupBuffer>[];
  final indices = <String, int>{};
  for (final message in messages) {
    // Local commands retain their delivery state without becoming chat bubbles.
    if (message.kind == 'local.user.action') continue;
    final key = message.turnId == null
        ? 'message:${message.id}'
        : 'turn:${message.turnId}';
    final existing = indices[key];
    if (existing == null) {
      indices[key] = buffers.length;
      final buffer = _ConversationGroupBuffer(id: key, turnId: message.turnId)
        ..messages.add(message);
      buffers.add(buffer);
    } else {
      buffers[existing].messages.add(message);
    }
  }
  return [
    for (final buffer in buffers)
      _ConversationGroup(
        id: buffer.id,
        turnId: buffer.turnId,
        messages: List.unmodifiable(buffer.messages),
      ),
  ];
}

class _ConversationTurn extends StatefulWidget {
  const _ConversationTurn({
    super.key,
    required this.group,
    required this.onToggleActivity,
    required this.session,
    required this.controller,
    required this.active,
    required this.latest,
    this.waitingLabel,
    this.thinkingStartedAt,
    this.approvals = const [],
  });

  final _ConversationGroup group;
  final List<RelayApproval> approvals;
  final void Function(ConversationAnchorBox anchor, double removedHeight)
  onToggleActivity;
  final RelaySession session;
  final AppController controller;
  final bool active;
  final String? waitingLabel;
  final bool latest;
  final DateTime? thinkingStartedAt;

  @override
  State<_ConversationTurn> createState() => _ConversationTurnState();
}

class _ConversationTurnState extends State<_ConversationTurn> {
  final _activitySizeKey = GlobalKey();
  final _activityBodyKey = GlobalKey();
  bool _activityOpen = false;
  bool _restoredActivity = false;
  ForegroundPeriodicTimer? _elapsedTimer;

  String get _activityStorageId =>
      'turn-activity:${widget.session.id}:${widget.group.id}:${widget.active}';

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_restoredActivity) return;
    _restoredActivity = true;
    _activityOpen =
        PageStorage.maybeOf(
              context,
            )?.readState(context, identifier: _activityStorageId)
            as bool? ??
        widget.active;
  }

  @override
  void initState() {
    super.initState();
    _activityOpen = widget.active;
    _syncElapsedTimer();
  }

  @override
  void didUpdateWidget(covariant _ConversationTurn oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.active != widget.active) {
      _activityOpen = widget.active;
    }
    if (oldWidget.active != widget.active ||
        oldWidget.group.messages.length != widget.group.messages.length) {
      _syncElapsedTimer();
    }
  }

  @override
  void dispose() {
    _elapsedTimer?.cancel();
    super.dispose();
  }

  void _syncElapsedTimer() {
    _elapsedTimer?.cancel();
    _elapsedTimer =
        !widget.session.isSubagent &&
            widget.active &&
            _turnHasActivity(widget.group.messages)
        ? ForegroundPeriodicTimer(const Duration(seconds: 1), () {
            if (mounted) setState(() {});
          })
        : null;
  }

  @override
  Widget build(BuildContext context) {
    final userMessages = widget.group.messages
        .where((message) => message.role == 'user')
        .toList();
    final assistantMessages = widget.group.messages
        .where((message) => message.role != 'user')
        .toList();
    final finalIndex = _finalAssistantMessageIndex(
      assistantMessages,
      active: widget.active,
    );
    final finalMessage = finalIndex < 0 ? null : assistantMessages[finalIndex];
    final activities = <RelayMessage>[
      for (var index = 0; index < assistantMessages.length; index += 1)
        if (index != finalIndex &&
            !(assistantMessages[index].kind == 'turn.completed' &&
                assistantMessages[index].content.isEmpty))
          assistantMessages[index],
    ];
    final pending = widget.latest
        ? widget.approvals
              .where(widget.controller.approvalIsPending)
              .firstOrNull
        : null;
    final status = conversationTurnStatus(
      widget.group.messages,
      active: widget.active,
      online: widget.controller.deviceOnline,
      pendingAction: pending?.action['type'] as String?,
    );
    final copy = context.l10n;
    final label = switch (status) {
      ConversationTurnStatus.running => copy.turnStatusRunning,
      ConversationTurnStatus.completed => copy.turnStatusCompleted,
      ConversationTurnStatus.approval => copy.liveTaskApproval,
      ConversationTurnStatus.question => copy.liveTaskQuestion,
      ConversationTurnStatus.stopped => copy.liveTaskStopped,
      ConversationTurnStatus.interrupted => copy.turnStatusInterrupted,
      ConversationTurnStatus.stale => copy.liveTaskStale,
      ConversationTurnStatus.unknown => copy.turnStatusUnknown,
    };
    final icon = switch (status) {
      ConversationTurnStatus.completed => Icons.check_rounded,
      ConversationTurnStatus.interrupted => Icons.error_outline_rounded,
      ConversationTurnStatus.stopped => Icons.stop_circle_outlined,
      ConversationTurnStatus.approval ||
      ConversationTurnStatus.question => Icons.pause_circle_outline_rounded,
      _ => Icons.history_rounded,
    };
    final statusColor = switch (status) {
      ConversationTurnStatus.completed => RelayTheme.fern,
      ConversationTurnStatus.interrupted => RelayTheme.ember,
      _ => RelayTheme.mutedBright,
    };
    final elapsed = widget.session.isSubagent
        ? null
        : _turnElapsed(
            widget.group.messages,
            copy: context.l10n,
            active: widget.active,
            startedAt: widget.session.raw['running_started_at'] as String?,
          );
    final content = Column(
      key: ValueKey(widget.group.id),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ...userMessages.map(
              (message) => _MessageBubble(
                message: message,
                session: widget.session,
                controller: widget.controller,
              ),
            ),
          ],
        ),
        if (activities.isNotEmpty ||
            widget.approvals.isNotEmpty ||
            finalMessage != null ||
            widget.group.messages.any((m) => m.kind == 'turn.completed'))
          Column(
            key: ValueKey('turn-activity-${widget.group.id}'),
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Material(
                color: Theme.of(context).scaffoldBackgroundColor,
                child: Semantics(
                  expanded: _activityOpen,
                  child: ListTile(
                    key: ValueKey('turn-activity-header-${widget.group.id}'),
                    onTap: _toggleActivity,
                    dense: true,
                    visualDensity: const VisualDensity(vertical: -3),
                    minTileHeight: 44,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 2),
                    leading: status == ConversationTurnStatus.running
                        ? AnimatedRunningStatusIcon(
                            size: 19,
                            color: RelayTheme.greenStrong,
                            iconKey: ValueKey(
                              'turn-activity-running-icon-${widget.group.id}',
                            ),
                          )
                        : Icon(icon, color: statusColor, size: 19),
                    title: Row(
                      children: [
                        Text(
                          label,
                          maxLines: 1,
                          style: TextStyle(
                            color: widget.active
                                ? RelayTheme.greenStrong
                                : RelayTheme.mutedBright,
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        if (elapsed != null)
                          Flexible(
                            child: Text(
                              ' · $elapsed',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: RelayTheme.muted,
                                fontFamily: 'monospace',
                                fontSize: 10,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                      ],
                    ),
                    trailing: AnimatedRotation(
                      turns: _activityOpen ? .5 : 0,
                      duration: MediaQuery.disableAnimationsOf(context)
                          ? Duration.zero
                          : const Duration(milliseconds: 180),
                      child: const Icon(Icons.expand_more),
                    ),
                  ),
                ),
              ),
              _activityOpen
                  ? KeyedSubtree(
                      key: _activityBodyKey,
                      child: Container(
                        key: ValueKey(
                          'turn-activity-timeline-${widget.group.id}',
                        ),
                        width: double.infinity,
                        margin: const EdgeInsetsDirectional.fromSTEB(
                          8,
                          0,
                          0,
                          8,
                        ),
                        padding: const EdgeInsetsDirectional.only(start: 16),
                        decoration: BoxDecoration(
                          border: _startBorder(
                            context,
                            const BorderSide(color: RelayTheme.line),
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            ..._activityChildren(activities),
                            for (final approval in widget.approvals)
                              _ApprovalCard(
                                key: ValueKey(
                                  'conversation-approval-${approval.id}',
                                ),
                                controller: widget.controller,
                                approval: approval,
                              ),
                            if (widget.thinkingStartedAt != null &&
                                (activities.isNotEmpty ||
                                    widget.approvals.isNotEmpty))
                              _AssistantActivityBubble(
                                startedAt: widget.thinkingStartedAt!,
                              ),
                          ],
                        ),
                      ),
                    )
                  : const SizedBox.shrink(),
            ],
          ),
        if (widget.thinkingStartedAt != null &&
            (activities.isEmpty && widget.approvals.isEmpty || !_activityOpen))
          Padding(
            padding: const EdgeInsetsDirectional.only(start: 24),
            child: _AssistantActivityBubble(
              startedAt: widget.thinkingStartedAt!,
            ),
          ),
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (activities.isNotEmpty || widget.approvals.isNotEmpty)
              const Padding(
                padding: EdgeInsets.only(bottom: 10),
                child: Divider(height: 1, color: RelayTheme.lineSoft),
              ),
            if (finalMessage != null)
              _MessageBubble(
                message: finalMessage,
                session: widget.session,
                controller: widget.controller,
              ),
            if (widget.waitingLabel != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  children: [
                    const WaitingStatusIcon(color: RelayTheme.muted),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        widget.waitingLabel!,
                        key: const ValueKey('conversation-waiting-status'),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: RelayTheme.muted,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 4),
          ],
        ),
      ],
    );
    return ConversationSizeAnchor(key: _activitySizeKey, child: content);
  }

  void _toggleActivity() {
    final anchor = _activitySizeKey.currentContext?.findRenderObject();
    final body = _activityBodyKey.currentContext?.findRenderObject();
    if (anchor is ConversationAnchorBox) {
      widget.onToggleActivity(
        anchor,
        _activityOpen && body is RenderBox && body.hasSize
            ? body.size.height
            : 0,
      );
    }
    setState(() => _activityOpen = !_activityOpen);
    PageStorage.maybeOf(
      context,
    )?.writeState(context, _activityOpen, identifier: _activityStorageId);
  }

  List<Widget> _activityChildren(List<RelayMessage> activities) {
    final children = <Widget>[];
    var index = 0;
    while (index < activities.length) {
      final message = activities[index];
      if (!_isCollapsibleLocalActivity(message)) {
        children.add(
          _MessageBubble(
            message: message,
            session: widget.session,
            controller: widget.controller,
            compact: true,
          ),
        );
        index += 1;
        continue;
      }
      final localActivities = <RelayMessage>[message];
      index += 1;
      while (index < activities.length &&
          _isCollapsibleLocalActivity(activities[index])) {
        localActivities.add(activities[index]);
        index += 1;
      }
      children.add(
        localActivities.length == 1
            ? _MessageBubble(
                message: localActivities.single,
                session: widget.session,
                controller: widget.controller,
                compact: true,
              )
            : _CompactToolActivityGroup(
                messages: localActivities,
                session: widget.session,
                controller: widget.controller,
              ),
      );
    }
    return children;
  }
}

bool _isCollapsibleLocalActivity(RelayMessage message) => const {
  'command',
  'file_read',
  'file_change',
}.contains(message.toolActivityType);

bool _turnHasActivity(List<RelayMessage> messages) {
  return messages.any((message) => message.role != 'user');
}

int _finalAssistantMessageIndex(
  List<RelayMessage> messages, {
  required bool active,
}) {
  if (active) return -1;
  final explicitFinal = messages.lastIndexWhere(
    (message) =>
        message.role == 'codex' &&
        message.messagePhase == 'final_answer' &&
        message.content.trim().isNotEmpty,
  );
  if (explicitFinal >= 0) return explicitFinal;
  final hasExplicitPhase = messages.any(
    (message) => message.role == 'codex' && message.messagePhase != null,
  );
  if (hasExplicitPhase) return -1;
  return messages.lastIndexWhere(
    (message) => message.role == 'codex' && message.content.trim().isNotEmpty,
  );
}

String? _turnElapsed(
  List<RelayMessage> messages, {
  required AppLocalizations copy,
  required bool active,
  String? startedAt,
}) {
  final runningStartedAt = DateTime.tryParse(startedAt ?? '');
  final timestamps = <DateTime>[
    ...messages
        .map((message) => DateTime.tryParse(message.createdAt))
        .whereType<DateTime>(),
  ];
  if (timestamps.isEmpty && (!active || runningStartedAt == null)) return null;
  timestamps.sort();
  // A session catalog may still carry the previous turn's start. Prefer the
  // visible turn's own messages; use the catalog only for an empty live turn.
  final started = timestamps.isNotEmpty ? timestamps.first : runningStartedAt!;
  final finished = active ? DateTime.now() : timestamps.last;
  final elapsed = finished.difference(started);
  if (elapsed.inSeconds < 1) return null;
  return elapsed.inMinutes > 0
      ? copy.workbenchDurationMinutesSeconds(
          elapsed.inMinutes,
          elapsed.inSeconds.remainder(60),
        )
      : copy.workbenchDurationSeconds(elapsed.inSeconds);
}

String _displayMessageContent(BuildContext context, RelayMessage message) {
  if (message.kind == 'turn.failed' &&
      RegExp(
        r'^Session \S+ is not available in any configured local agent\.$',
      ).hasMatch(message.content.trim())) {
    return context.l10n.controllerSessionUnavailable;
  }
  return message.content;
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({
    required this.message,
    required this.session,
    required this.controller,
    this.compact = false,
  });

  final RelayMessage message;
  final RelaySession session;
  final AppController controller;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    if (message.toolActivityLabel != null) {
      return _ToolActivityMessage(
        message: message,
        session: session,
        controller: controller,
      );
    }
    if (compact) {
      return _TurnActivityMessage(
        message: message,
        session: session,
        controller: controller,
      );
    }
    final user = message.role == 'user';
    final system = message.role == 'system';
    final messageTimestamp = user
        ? formatMessageTimestamp(
            message.createdAt,
            localizations: context.l10n,
            material: MaterialLocalizations.of(context),
          )
        : null;
    if (!user && !system) {
      return Align(
        alignment: AlignmentDirectional.centerStart,
        child: Container(
          key: ValueKey('assistant-message-${message.id}'),
          width: double.infinity,
          margin: const EdgeInsets.only(bottom: 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _messageAuthor(message, session, context.l10n),
                style: const TextStyle(
                  color: RelayTheme.fern,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                ),
              ),
              if (message.content.isNotEmpty) ...[
                const SizedBox(height: 7),
                _MessageContent(
                  content: _displayMessageContent(context, message),
                  user: false,
                  system: false,
                  liveContent: controller.liveReplyText(session.id, message.id),
                  referencedAttachments: message.attachments,
                  session: session,
                  controller: controller,
                ),
              ],
              if (message.attachments.isNotEmpty)
                _MessageAttachments(
                  key: ValueKey('attachments-${session.id}-${message.id}'),
                  attachments: message.attachments,
                  session: session,
                  controller: controller,
                ),
              if (controller.canBranchReply(session, message))
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: TextButton.icon(
                    key: ValueKey('reply-branch-${message.id}'),
                    onPressed: controller.sessionCreationInFlight
                        ? null
                        : () => _branchFromReply(context),
                    style: TextButton.styleFrom(
                      foregroundColor: controller.deviceOnline
                          ? RelayTheme.mutedBright
                          : RelayTheme.muted,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 0,
                        vertical: 6,
                      ),
                      textStyle: const TextStyle(fontSize: 11),
                    ),
                    icon: const Icon(Icons.call_split, size: 15),
                    label: Text(context.l10n.replyBranchLabel),
                  ),
                ),
            ],
          ),
        ),
      );
    }
    return Align(
      alignment: user
          ? AlignmentDirectional.centerEnd
          : AlignmentDirectional.centerStart,
      child: Container(
        key: ValueKey('message-bubble-${message.id}'),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * .88,
        ),
        margin: EdgeInsets.only(bottom: compact ? 6 : 10),
        padding: EdgeInsets.all(compact ? 11 : 14),
        decoration: BoxDecoration(
          color: user
              ? const Color(0xFF292929)
              : system
              ? const Color(0xFF211C14)
              : RelayTheme.panel,
          borderRadius: BorderRadiusDirectional.only(
            topStart: const Radius.circular(12),
            topEnd: const Radius.circular(12),
            bottomStart: Radius.circular(user ? 12 : 3),
            bottomEnd: Radius.circular(user ? 3 : 12),
          ),
          border: Border.all(
            color: system ? const Color(0xFF31291C) : const Color(0xFF343434),
          ),
        ),
        child: Stack(
          children: [
            Padding(
              padding: EdgeInsetsDirectional.only(end: user ? 18 : 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        _messageAuthor(message, session, context.l10n),
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          color: system
                              ? RelayTheme.amber
                              : user
                              ? RelayTheme.muted
                              : RelayTheme.fern,
                        ),
                      ),
                      if (messageTimestamp != null &&
                          messageTimestamp.isNotEmpty) ...[
                        const SizedBox(width: 5),
                        Text(
                          '· $messageTimestamp',
                          key: ValueKey('message-created-time-${message.id}'),
                          style: const TextStyle(
                            color: RelayTheme.muted,
                            fontFamily: 'monospace',
                            fontSize: 10,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ],
                  ),
                  if (message.content.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    _MessageContent(
                      content: _displayMessageContent(context, message),
                      user: user,
                      system: system,
                      liveContent: user || system
                          ? null
                          : controller.liveReplyText(session.id, message.id),
                      referencedAttachments: message.attachments,
                      session: session,
                      controller: controller,
                    ),
                  ],
                  if (message.attachments.isNotEmpty)
                    _MessageAttachments(
                      key: ValueKey('attachments-${session.id}-${message.id}'),
                      attachments: message.attachments,
                      session: session,
                      controller: controller,
                    ),
                ],
              ),
            ),
            if (user)
              PositionedDirectional(
                key: const ValueKey('message-delivery-indicator'),
                end: 0,
                bottom: 0,
                child: _MessageDeliveryIndicator(state: message.deliveryState),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _branchFromReply(BuildContext context) async {
    if (!controller.deviceOnline) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.controllerReplyBranchOffline)),
      );
      return;
    }
    var worktree = false;
    if (session.supportsForkWorktree) {
      final mode = await showModalBottomSheet<String>(
        context: context,
        useSafeArea: true,
        showDragHandle: true,
        builder: (sheetContext) => Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                key: const ValueKey('reply-branch-same-directory'),
                leading: const Icon(Icons.folder_outlined),
                title: Text(context.l10n.replyBranchSameDirectory),
                subtitle: Text(
                  context.l10n.replyBranchSameDirectoryDescription,
                ),
                onTap: () => Navigator.pop(sheetContext, 'same_directory'),
              ),
              ListTile(
                key: const ValueKey('reply-branch-worktree'),
                leading: const Icon(Icons.account_tree_outlined),
                title: Text(context.l10n.replyBranchWorktree),
                subtitle: Text(context.l10n.replyBranchWorktreeDescription),
                onTap: () => Navigator.pop(sheetContext, 'worktree'),
              ),
            ],
          ),
        ),
      );
      if (mode == null || !context.mounted) return;
      worktree = mode == 'worktree';
    }
    await controller.branchFromReply(session, message, worktree: worktree);
  }
}

class _TurnActivityMessage extends StatelessWidget {
  const _TurnActivityMessage({
    required this.message,
    required this.session,
    required this.controller,
  });

  final RelayMessage message;
  final RelaySession session;
  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: ValueKey('turn-activity-message-${message.id}'),
      margin: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (message.content.isNotEmpty)
            _MessageContent(
              content: _displayMessageContent(context, message),
              user: false,
              system: message.role == 'system',
              liveContent: message.role == 'codex'
                  ? controller.liveReplyText(session.id, message.id)
                  : null,
              referencedAttachments: message.attachments,
              session: session,
              controller: controller,
            ),
          if (message.attachments.isNotEmpty)
            _MessageAttachments(
              key: ValueKey('attachments-${session.id}-${message.id}'),
              attachments: message.attachments,
              session: session,
              controller: controller,
            ),
        ],
      ),
    );
  }
}

String _messageAuthor(
  RelayMessage message,
  RelaySession session,
  AppLocalizations copy,
) {
  if (message.role == 'user') return copy.workbenchYou;
  if (message.role == 'system') return copy.workbenchLocalActivity;
  return switch (session.provider) {
    'kimi' => 'Kimi',
    'claude' => 'Claude',
    'mcode' => 'MiniMax Code',
    'zcode' => 'ZCode',
    'opencode' => 'OpenCode',
    'claude-cowork' => 'Claude Cowork',
    'pi' => 'Pi',
    _ => 'Codex',
  };
}

String? formatMessageTimestamp(
  String value, {
  DateTime? now,
  AppLocalizations? localizations,
  MaterialLocalizations? material,
}) {
  final parsed = DateTime.tryParse(value)?.toLocal();
  if (parsed == null) return null;
  final copy =
      localizations ?? relayuneLocalizationsFor(const Locale('zh', 'CN'));
  final reference = (now ?? DateTime.now()).toLocal();
  String two(int part) => part.toString().padLeft(2, '0');
  final time =
      '${two(parsed.hour)}:${two(parsed.minute)}:${two(parsed.second)}';
  final parsedDay = DateTime.utc(parsed.year, parsed.month, parsed.day);
  final referenceDay = DateTime.utc(
    reference.year,
    reference.month,
    reference.day,
  );
  final daysAgo = referenceDay.difference(parsedDay).inDays;
  final dateLabel = switch (daysAgo) {
    0 => copy.workbenchToday,
    1 => copy.workbenchYesterday,
    2 => copy.workbenchDayBeforeYesterday,
    _ when parsed.year == reference.year =>
      material?.formatShortMonthDay(parsed) ??
          copy.workbenchMonthDay(parsed.month, parsed.day),
    _ =>
      material?.formatCompactDate(parsed) ??
          copy.workbenchYearMonthDay(parsed.year, parsed.month, parsed.day),
  };
  return '$dateLabel $time';
}

class _AttachmentDownloadProgress extends StatelessWidget {
  const _AttachmentDownloadProgress({
    required this.progress,
    required this.indicatorKey,
  });

  final ValueListenable<DownloadProgress?> progress;
  final Key indicatorKey;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<DownloadProgress?>(
      valueListenable: progress,
      builder: (context, download, _) {
        if (download?.waiting ?? false) {
          return Padding(
            padding: const EdgeInsets.all(8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const ImageWaitSymbol(size: 22),
                const SizedBox(width: 8),
                Flexible(child: Text(context.l10n.workbenchImageWaiting)),
              ],
            ),
          );
        }
        final fraction = download?.fraction;
        final label = fraction != null
            ? '${(fraction * 100).floor()}%'
            : download == null || download.receivedBytes == 0
            ? '0%'
            : '${(download.receivedBytes / 1024).toStringAsFixed(1)} KB';
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            LinearProgressIndicator(
              key: indicatorKey,
              value: fraction ?? 0,
              minHeight: 4,
              color: RelayTheme.green,
              backgroundColor: RelayTheme.line,
              semanticsLabel: context.l10n.workbenchLoadingOriginal,
              semanticsValue: label,
            ),
            const SizedBox(height: 6),
            Text(
              fraction == 1
                  ? '$label · ${context.l10n.workbenchProcessing}'
                  : label,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: RelayTheme.mutedBright,
                fontSize: 11,
              ),
            ),
          ],
        );
      },
    );
  }
}

class _ToolActivityMessage extends StatelessWidget {
  const _ToolActivityMessage({
    required this.message,
    required this.session,
    required this.controller,
  });

  final RelayMessage message;
  final RelaySession session;
  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final copy = context.l10n;
    final status = message.toolActivityStatus ?? 'running';
    final label = _toolActivityMessageLabel(message, copy);
    final detail = message.toolActivityDetail?.trim() ?? '';
    final imageAttachments = message.attachments
        .where((attachment) => attachment.isImage)
        .toList(growable: false);
    final hasExpandableContent =
        detail.isNotEmpty || imageAttachments.isNotEmpty;
    final commandPreview = message.toolActivityType == 'command'
        ? _compactToolActivityText(message.toolActivityCommand, 180)
        : null;
    final title = switch (status) {
      'failed' => copy.workbenchActivityFailed(label),
      'completed' => copy.workbenchActivityCompleted(label),
      _ => copy.workbenchActivityRunning(label),
    };
    final stateIcon = status == 'running'
        ? AnimatedRunningStatusIcon(
            size: 17,
            color: RelayTheme.greenStrong,
            iconKey: ValueKey('tool-activity-running-icon-${message.id}'),
          )
        : Icon(
            key: ValueKey(
              'tool-activity-${status == 'failed' ? 'failed' : 'completed'}-icon-${message.id}',
            ),
            status == 'failed'
                ? Icons.error_outline_rounded
                : Icons.check_rounded,
            size: 17,
            color: status == 'failed' ? RelayTheme.ember : RelayTheme.fern,
          );
    final titleText = Text(
      title,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: const TextStyle(
        color: Color(0xFFA4A49F),
        fontSize: 12,
        fontWeight: FontWeight.w600,
        height: 1.4,
      ),
    );
    final titleWidget = Semantics(
      liveRegion: true,
      label: [
        title,
        if (commandPreview != null) commandPreview,
        if (detail.isNotEmpty) copy.workbenchViewOutput,
        if (imageAttachments.isNotEmpty) copy.workbenchViewThumbnail,
      ].join(copy.workbenchSemanticSeparator),
      excludeSemantics: true,
      child: commandPreview == null
          ? titleText
          : Row(
              children: [
                titleText,
                Expanded(
                  child: Text(
                    ' · $commandPreview',
                    key: ValueKey(
                      'tool-activity-command-preview-${message.id}',
                    ),
                    maxLines: 1,
                    textDirection: TextDirection.ltr,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: RelayTheme.muted,
                      fontFamily: 'monospace',
                      fontSize: 10,
                      height: 1.4,
                    ),
                  ),
                ),
              ],
            ),
    );

    return Container(
      key: ValueKey('tool-activity-${message.id}'),
      margin: const EdgeInsets.only(bottom: 3),
      child: !hasExpandableContent
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                children: [
                  stateIcon,
                  const SizedBox(width: 8),
                  Expanded(child: titleWidget),
                ],
              ),
            )
          : Theme(
              data: _toolActivityTileTheme(context),
              child: ExpansionTile(
                key: ValueKey('tool-activity-output-${message.id}'),
                initiallyExpanded: false,
                shape: const Border(),
                collapsedShape: const Border(),
                dense: true,
                visualDensity: const VisualDensity(vertical: -3),
                minTileHeight: 42,
                tilePadding: EdgeInsets.zero,
                childrenPadding: const EdgeInsetsDirectional.fromSTEB(
                  23,
                  0,
                  0,
                  10,
                ),
                leading: stateIcon,
                title: titleWidget,
                children: [
                  for (final imageAttachment in imageAttachments)
                    Align(
                      key: ValueKey(
                        'tool-activity-image-preview-${message.id}-${imageAttachment.id}',
                      ),
                      alignment: AlignmentDirectional.centerStart,
                      child: _MessageAttachmentPreview(
                        attachment: imageAttachment,
                        session: session,
                        controller: controller,
                      ),
                    ),
                  if (imageAttachments.isNotEmpty && detail.isNotEmpty)
                    const SizedBox(height: 8),
                  if (detail.isNotEmpty)
                    Container(
                      width: double.infinity,
                      constraints: const BoxConstraints(maxHeight: 220),
                      padding: const EdgeInsets.all(9),
                      decoration: BoxDecoration(
                        color: RelayTheme.surface,
                        border: Border.all(color: RelayTheme.lineSoft),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: SingleChildScrollView(
                        child: SelectableText(
                          detail,
                          key: ValueKey('tool-activity-detail-${message.id}'),
                          textDirection: TextDirection.ltr,
                          style: const TextStyle(
                            color: Color(0xFF898984),
                            fontFamily: 'monospace',
                            fontSize: 11,
                            height: 1.45,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}

class _CompactToolActivityGroup extends StatefulWidget {
  const _CompactToolActivityGroup({
    required this.messages,
    required this.session,
    required this.controller,
  });

  final List<RelayMessage> messages;
  final RelaySession session;
  final AppController controller;

  @override
  State<_CompactToolActivityGroup> createState() =>
      _CompactToolActivityGroupState();
}

class _CompactToolActivityGroupState extends State<_CompactToolActivityGroup> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final copy = context.l10n;
    final running = widget.messages.any(
      (message) => (message.toolActivityStatus ?? 'running') == 'running',
    );
    final failed = widget.messages.any(
      (message) => message.toolActivityStatus == 'failed',
    );
    final types = widget.messages
        .map((message) => message.toolActivityType)
        .toSet();
    final allCommands = types.length == 1 && types.single == 'command';
    final allReads = types.length == 1 && types.single == 'file_read';
    final allChanges = types.length == 1 && types.single == 'file_change';
    final fileCount = widget.messages.fold<int>(
      0,
      (total, message) => total + (message.toolActivityCount ?? 1),
    );
    final preview = allCommands
        ? widget.messages
              .map(
                (message) =>
                    _compactToolActivityText(message.toolActivityCommand, 180),
              )
              .whereType<String>()
              .lastOrNull
        : _compactToolActivityText(
            widget.messages
                .map((message) => message.toolActivitySubject)
                .whereType<String>()
                .toSet()
                .join('、'),
            180,
          );
    final title = allCommands
        ? running
              ? copy.workbenchCommandsRunning(widget.messages.length)
              : copy.workbenchCommandsCompleted(widget.messages.length)
        : allReads
        ? running
              ? copy.workbenchFilesReading(fileCount)
              : failed
              ? copy.workbenchFilesReadFailed(fileCount)
              : copy.workbenchFilesRead(fileCount)
        : allChanges
        ? running
              ? copy.workbenchFilesChanging(fileCount)
              : failed
              ? copy.workbenchFilesChangeFailed(fileCount)
              : copy.workbenchFilesChanged(fileCount)
        : running
        ? copy.workbenchOperationsRunning(widget.messages.length)
        : failed
        ? copy.workbenchOperationsFailed(widget.messages.length)
        : copy.workbenchOperationsCompleted(widget.messages.length);
    final firstId = widget.messages.first.id;
    final keyPrefix = allCommands
        ? 'command-activity-group'
        : 'tool-activity-group';
    final stateIcon = running
        ? AnimatedRunningStatusIcon(
            size: 17,
            color: RelayTheme.greenStrong,
            iconKey: ValueKey('$keyPrefix-running-icon-$firstId'),
          )
        : Icon(
            key: ValueKey(
              '$keyPrefix-${failed && !allCommands ? 'failed' : 'completed'}-icon-$firstId',
            ),
            allCommands
                ? Icons.terminal_rounded
                : failed
                ? Icons.error_outline_rounded
                : Icons.check_rounded,
            size: 17,
            color: allCommands
                ? RelayTheme.mutedBright
                : failed
                ? RelayTheme.ember
                : RelayTheme.fern,
          );
    final titleWidget = Semantics(
      liveRegion: true,
      label: [
        title,
        if (preview != null) preview,
      ].join(copy.workbenchSemanticSeparator),
      excludeSemantics: true,
      child: Row(
        children: [
          Flexible(
            child: Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Color(0xFFA4A49F),
                fontSize: 12,
                fontWeight: FontWeight.w700,
                height: 1.4,
              ),
            ),
          ),
          if (preview != null)
            Expanded(
              child: Text(
                ' · $preview',
                key: ValueKey('$keyPrefix-preview-$firstId'),
                maxLines: 1,
                textDirection: TextDirection.ltr,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: RelayTheme.muted,
                  fontFamily: 'monospace',
                  fontSize: 10,
                  height: 1.4,
                ),
              ),
            ),
        ],
      ),
    );

    return Container(
      key: ValueKey('$keyPrefix-$firstId'),
      margin: const EdgeInsets.only(bottom: 3),
      child: Theme(
        data: _toolActivityTileTheme(context),
        child: ExpansionTile(
          key: ValueKey('$keyPrefix-output-$firstId'),
          initiallyExpanded: _open,
          onExpansionChanged: (value) => _open = value,
          shape: const Border(),
          collapsedShape: const Border(),
          dense: true,
          visualDensity: const VisualDensity(vertical: -3),
          minTileHeight: 42,
          tilePadding: EdgeInsets.zero,
          childrenPadding: const EdgeInsetsDirectional.fromSTEB(23, 0, 0, 4),
          leading: stateIcon,
          title: titleWidget,
          children: [
            for (final message in widget.messages)
              _ToolActivityMessage(
                message: message,
                session: widget.session,
                controller: widget.controller,
              ),
          ],
        ),
      ),
    );
  }
}

ThemeData _toolActivityTileTheme(BuildContext context) {
  final theme = Theme.of(context);
  return theme.copyWith(
    dividerColor: Colors.transparent,
    listTileTheme: theme.listTileTheme.copyWith(
      horizontalTitleGap: 8,
      minLeadingWidth: 17,
    ),
  );
}

String _toolActivityMessageLabel(RelayMessage message, AppLocalizations copy) {
  final name = _compactToolActivityText(message.toolActivityName, 100);
  final subject = _compactToolActivityText(message.toolActivitySubject, 160);
  return switch (message.toolActivityType) {
    'command' => copy.workbenchToolCommand,
    'file_read'
        when message.toolActivityCount != null &&
            message.toolActivityCount! > 1 &&
            subject != null =>
      copy.workbenchToolReadFilesSubject(message.toolActivityCount!, subject),
    'file_read'
        when message.toolActivityCount != null &&
            message.toolActivityCount! > 1 =>
      copy.workbenchToolReadFiles(message.toolActivityCount!),
    'file_read' when subject != null => copy.workbenchToolReadFileSubject(
      subject,
    ),
    'file_read' => copy.workbenchToolReadFile,
    'file_change'
        when message.toolActivityCount != null &&
            message.toolActivityCount! > 1 &&
            subject != null =>
      copy.workbenchToolChangeFilesSubject(message.toolActivityCount!, subject),
    'file_change'
        when message.toolActivityCount != null &&
            message.toolActivityCount! > 1 =>
      copy.workbenchToolChangeFiles(message.toolActivityCount!),
    'file_change' when subject != null => copy.workbenchToolChangeFileSubject(
      subject,
    ),
    'file_change' => copy.workbenchToolChangeFile,
    'mcp_tool' ||
    'dynamic_tool' ||
    'tool_call' when name != null => copy.workbenchToolCallNamed(name),
    'mcp_tool' || 'dynamic_tool' || 'tool_call' => copy.workbenchToolCall,
    'web_search' when subject != null => copy.workbenchToolWebSearchSubject(
      subject,
    ),
    'web_search' => copy.workbenchToolWebSearch,
    'image_view' when subject != null => copy.workbenchToolImageViewSubject(
      subject,
    ),
    'image_view' => copy.workbenchToolImageView,
    'image_generation' => copy.workbenchToolImageGeneration,
    'context_compaction' => copy.workbenchToolContextCompaction,
    'wait' => copy.workbenchToolWait,
    _ => message.toolActivityLabel ?? copy.workbenchLocalOperation,
  };
}

String? _compactToolActivityText(String? value, int limit) {
  final text = value?.replaceAll(RegExp(r'\s+'), ' ').trim() ?? '';
  if (text.isEmpty) return null;
  return text.length <= limit ? text : '${text.substring(0, limit - 1)}…';
}

class _MessageDeliveryIndicator extends StatelessWidget {
  const _MessageDeliveryIndicator({required this.state});

  final MessageDeliveryState state;

  @override
  Widget build(BuildContext context) => switch (state) {
    MessageDeliveryState.sent => Semantics(
      label: context.l10n.workbenchDeliverySent,
      excludeSemantics: true,
      child: const Icon(
        Icons.check_rounded,
        key: ValueKey('message-delivery-sent'),
        size: 15,
        color: RelayTheme.fern,
      ),
    ),
    MessageDeliveryState.sending => Semantics(
      label: context.l10n.workbenchDeliverySending,
      excludeSemantics: true,
      child: const SizedBox.square(
        key: ValueKey('message-delivery-sending'),
        dimension: 12,
        child: CircularProgressIndicator(strokeWidth: 1.7),
      ),
    ),
    MessageDeliveryState.unconfirmed => Tooltip(
      message: context.l10n.controllerQueueUnconfirmed,
      child: Semantics(
        label: context.l10n.controllerQueueUnconfirmed,
        excludeSemantics: true,
        child: const Text(
          '?',
          key: ValueKey('message-delivery-unconfirmed'),
          style: TextStyle(
            color: RelayTheme.amber,
            fontSize: 15,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
    ),
    MessageDeliveryState.failed => Semantics(
      label: context.l10n.workbenchDeliveryFailed,
      excludeSemantics: true,
      child: const Text(
        '!',
        key: ValueKey('message-delivery-failed'),
        style: TextStyle(
          color: RelayTheme.ember,
          fontSize: 15,
          fontWeight: FontWeight.w900,
        ),
      ),
    ),
  };
}

class _AssistantActivityBubble extends StatefulWidget {
  const _AssistantActivityBubble({required this.startedAt});

  final DateTime startedAt;

  @override
  State<_AssistantActivityBubble> createState() =>
      _AssistantActivityBubbleState();
}

class _AssistantActivityBubbleState extends State<_AssistantActivityBubble> {
  ForegroundPeriodicTimer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = ForegroundPeriodicTimer(const Duration(seconds: 1), () {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final copy = context.l10n;
    final seconds = DateTime.now().difference(widget.startedAt).inSeconds;
    final label =
        '${copy.controllerThinking}… (${copy.workbenchDurationSeconds(math.max(0, seconds))})';
    return Padding(
      key: const ValueKey('assistant-live-activity'),
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Text(
        label,
        key: const ValueKey('assistant-running-label'),
        style: const TextStyle(
          color: Color(0xFF82BD99),
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _MessageSegment {
  const _MessageSegment({required this.content, required this.reminder});

  final String content;
  final bool reminder;
}

List<_MessageSegment> _splitSystemReminders(String content) {
  final expression = RegExp(
    r'<(system-reminder|notification)\b[^>]*>([\s\S]*?)<\/\1\s*>',
    caseSensitive: false,
  );
  final segments = <_MessageSegment>[];
  var offset = 0;
  for (final match in expression.allMatches(content)) {
    if (match.start > offset) {
      segments.add(
        _MessageSegment(
          content: content.substring(offset, match.start),
          reminder: false,
        ),
      );
    }
    segments.add(
      _MessageSegment(content: match.group(2) ?? '', reminder: true),
    );
    offset = match.end;
  }
  if (offset < content.length) {
    segments.add(
      _MessageSegment(content: content.substring(offset), reminder: false),
    );
  }
  return segments.isEmpty
      ? [_MessageSegment(content: content, reminder: false)]
      : segments;
}

final _markdownListLine = RegExp(r'^(\s*(?:(?:[-+*])|(?:\d+[.)]))\s+)(.*)$');

String _withoutUnsupportedLeadingEmoji(String markdown) => markdown
    .split('\n')
    .map((line) {
      final match = _markdownListLine.firstMatch(line);
      final remainder = match?.group(2);
      if (match == null || remainder == null || remainder.isEmpty) return line;
      final first = remainder.characters.firstOrNull;
      if (first == null || !_containsEmojiCodePoint(first)) return line;
      return '${match.group(1)}${remainder.substring(first.length).trimLeft()}';
    })
    .join('\n');

bool _containsEmojiCodePoint(String grapheme) => grapheme.runes.any(
  (codePoint) =>
      (codePoint >= 0x1F000 && codePoint <= 0x1FAFF) ||
      (codePoint >= 0x2600 && codePoint <= 0x27BF),
);

class _MessageContent extends StatefulWidget {
  const _MessageContent({
    required this.content,
    required this.user,
    required this.system,
    required this.referencedAttachments,
    required this.session,
    required this.controller,
    this.liveContent,
  });

  final String content;
  final bool user;
  final bool system;
  final List<RelayAttachment> referencedAttachments;
  final RelaySession session;
  final AppController controller;
  final LiveReplyPresentation? liveContent;

  @override
  State<_MessageContent> createState() => _MessageContentState();
}

class _MessageContentState extends State<_MessageContent> {
  String? _renderedText;
  bool _renderedStreaming = false;
  Widget? _renderedContent;
  MarkdownStyleSheet? _assistantMarkdownStyle;
  String get content => widget.content;
  bool get user => widget.user;
  bool get system => widget.system;
  List<RelayAttachment> get referencedAttachments =>
      widget.referencedAttachments;
  RelaySession get session => widget.session;
  AppController get controller => widget.controller;
  LiveReplyPresentation? get liveContent => widget.liveContent;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _renderedContent = null;
    _assistantMarkdownStyle = null;
  }

  @override
  void didUpdateWidget(_MessageContent oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.user != user ||
        oldWidget.system != system ||
        oldWidget.session != session ||
        oldWidget.controller != controller ||
        !listEquals(oldWidget.referencedAttachments, referencedAttachments)) {
      _renderedContent = null;
      _assistantMarkdownStyle = null;
    }
  }

  Widget _buildContent(
    BuildContext context,
    String value, {
    bool streaming = false,
  }) {
    if (_renderedContent == null ||
        _renderedText != value ||
        _renderedStreaming != streaming) {
      _renderedText = value;
      _renderedStreaming = streaming;
      _renderedContent = _renderContent(
        this.context,
        value,
        streaming: streaming,
      );
    }
    return _renderedContent!;
  }

  @override
  Widget build(BuildContext context) {
    final presentation = MediaQuery.disableAnimationsOf(context)
        ? null
        : liveContent;
    if (presentation != null) {
      return RepaintBoundary(
        child: ValueListenableBuilder<String>(
          valueListenable: presentation,
          builder: (context, value, _) => KeyedSubtree(
            key: const ValueKey('live-reply-markdown'),
            child: _buildContent(
              context,
              value,
              streaming: !presentation.isSettled,
            ),
          ),
        ),
      );
    }
    return _buildContent(context, content);
  }

  Widget _renderContent(
    BuildContext context,
    String value, {
    required bool streaming,
  }) {
    if (!user && !system) {
      value = displayVisualizationReferences(
        value,
        label: context.l10n.workbenchVisualization,
      );
    }
    final segments = _splitSystemReminders(value);
    final usesEmojiFallback =
        Theme.of(context)
            .extension<RelayRenderingCapabilities>()
            ?.usesIosSimulatorEmojiFallback ??
        false;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: segments
          .asMap()
          .entries
          .where((entry) => entry.value.content.trim().isNotEmpty)
          .map(
            (entry) => entry.value.reminder
                ? _SubtleSystemReminder(
                    key: ValueKey('system-reminder:${entry.key}'),
                    content: entry.value.content.trim(),
                  )
                : Padding(
                    padding: const EdgeInsets.symmetric(vertical: 1),
                    child: system
                        ? SelectableText(
                            entry.value.content.trim(),
                            style: TextStyle(
                              color: user
                                  ? const Color(0xFFCECECA)
                                  : system
                                  ? const Color(0xFFAAA59A)
                                  : RelayTheme.ink,
                              height: 1.45,
                              fontFamily: system ? 'monospace' : null,
                              fontSize: system ? 12 : null,
                            ),
                          )
                        : IncrementalMarkdownBody(
                            streaming: streaming,
                            data: usesEmojiFallback
                                ? _withoutUnsupportedLeadingEmoji(
                                    entry.value.content.trim(),
                                  )
                                : entry.value.content.trim(),
                            onTapLink: (text, href, title) => unawaited(
                              _openMessageLink(
                                context,
                                href,
                                referencedAttachments: referencedAttachments,
                                session: session,
                                controller: controller,
                              ),
                            ),
                            styleSheet: _assistantMarkdownStyle ??=
                                relayMarkdownStyle(context).copyWith(
                                  p: TextStyle(
                                    height: 1.5,
                                    color: user
                                        ? const Color(0xFFCECECA)
                                        : RelayTheme.ink,
                                  ),
                                  code: const TextStyle(
                                    fontFamily: 'monospace',
                                    fontSize: 12,
                                  ),
                                  blockquote: const TextStyle(
                                    height: 1.5,
                                    color: RelayTheme.ink,
                                  ),
                                  blockquotePadding:
                                      const EdgeInsetsDirectional.fromSTEB(
                                        12,
                                        2,
                                        0,
                                        2,
                                      ).resolve(Directionality.of(context)),
                                  blockquoteDecoration: BoxDecoration(
                                    color: Colors.transparent,
                                    border:
                                        Directionality.of(context) ==
                                            TextDirection.rtl
                                        ? const Border(
                                            right: BorderSide(
                                              color: RelayTheme.line,
                                              width: 3,
                                            ),
                                          )
                                        : const Border(
                                            left: BorderSide(
                                              color: RelayTheme.line,
                                              width: 3,
                                            ),
                                          ),
                                  ),
                                ),
                          ),
                  ),
          )
          .toList(),
    );
  }
}

String? _localFileName(String? href) {
  if (href == null || href.isEmpty) return null;
  String target;
  try {
    target = Uri.decodeFull(href);
  } on FormatException {
    return null;
  }
  if (!target.startsWith('/') && !RegExp(r'^[A-Za-z]:[\\/]').hasMatch(target)) {
    return null;
  }
  target = target
      .replaceFirst(RegExp(r'#L\d+(?:C\d+)?$', caseSensitive: false), '')
      .replaceFirst(RegExp(r':\d+(?::\d+)?$'), '');
  final parts = target.split(RegExp(r'[\\/]')).where((part) => part.isNotEmpty);
  return parts.isEmpty ? null : parts.last;
}

Future<void> _openMessageLink(
  BuildContext context,
  String? href, {
  required List<RelayAttachment> referencedAttachments,
  required RelaySession session,
  required AppController controller,
}) async {
  final localWeb = localWebUri(href ?? '');
  if (localWeb != null) {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => LocalWebPreview(
          controller: controller,
          sessionId: session.id,
          url: localWeb,
        ),
      ),
    );
    return;
  }
  final fileName = _localFileName(href);
  if (fileName != null) {
    RelayAttachment? attachment;
    for (final candidate in referencedAttachments) {
      if (candidate.name == fileName && candidate.previewSupported) {
        attachment = candidate;
        break;
      }
    }
    if (attachment != null) {
      await _showFilePreview(
        context,
        controller: controller,
        session: session,
        attachment: attachment,
      );
    } else if (context.mounted &&
        RegExp(r'\.html?$', caseSensitive: false).hasMatch(fileName)) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.workbenchVisualizationUnavailable)),
      );
    }
    return;
  }

  final uri = Uri.tryParse(href ?? '');
  if (uri == null || !const {'http', 'https'}.contains(uri.scheme)) return;
  await launchUrl(uri, mode: LaunchMode.externalApplication);
}

Future<void> _showFilePreview(
  BuildContext context, {
  required AppController controller,
  required RelaySession session,
  required RelayAttachment attachment,
}) => showDialog<void>(
  context: context,
  builder: (dialogContext) => _FilePreviewDialog(
    controller: controller,
    session: session,
    attachment: attachment,
  ),
);

class _FilePreviewDialog extends StatefulWidget {
  const _FilePreviewDialog({
    required this.controller,
    required this.session,
    required this.attachment,
  });

  final AppController controller;
  final RelaySession session;
  final RelayAttachment attachment;

  @override
  State<_FilePreviewDialog> createState() => _FilePreviewDialogState();
}

class _FilePreviewDialogState extends State<_FilePreviewDialog> {
  late Future<Uint8List> _bytes;

  @override
  void initState() {
    super.initState();
    _bytes = _read();
  }

  Future<Uint8List> _read() => widget.attachment.localBytes != null
      ? Future.value(widget.attachment.localBytes!)
      : widget.controller.loadAttachment(widget.session.id, widget.attachment);

  void _retry() {
    final bytes = _read();
    setState(() {
      _bytes = bytes;
    });
  }

  @override
  Widget build(BuildContext context) {
    final copy = context.l10n;
    final attachment = widget.attachment;
    final transitionDuration = MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 180);
    return Dialog(
      key: ValueKey('message-file-preview-${attachment.id}'),
      insetPadding: const EdgeInsets.all(12),
      child: ScaffoldMessenger(
        child: Scaffold(
          body: SafeArea(
            child: Column(
              children: [
                SizedBox(
                  height: 52,
                  child: Row(
                    children: [
                      const SizedBox(width: 16),
                      Expanded(
                        child: Text(
                          attachment.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                      ),
                      if (attachment.mimeType.toLowerCase().startsWith(
                            'image/',
                          ) &&
                          attachment.mimeType.toLowerCase() != 'image/svg+xml')
                        SaveImageButton(
                          key: ValueKey('file-image-save-${attachment.id}'),
                          loadBytes: () => _bytes,
                          name: attachment.name,
                        ),
                      IconButton(
                        tooltip: copy.workbenchCloseFilePreview,
                        onPressed: () => Navigator.of(context).pop(),
                        icon: const Icon(Icons.close),
                      ),
                      const SizedBox(width: 4),
                    ],
                  ),
                ),
                const Divider(height: 1),
                Expanded(
                  child: FutureBuilder<Uint8List>(
                    future: _bytes,
                    builder: (context, snapshot) {
                      final Widget child;
                      if (snapshot.connectionState != ConnectionState.done) {
                        child = _FilePreviewLoading(
                          key: ValueKey(
                            'file-preview-loading-${attachment.id}',
                          ),
                          attachment: attachment,
                        );
                      } else if (snapshot.hasError) {
                        child = _FilePreviewError(
                          key: ValueKey('file-preview-error-${attachment.id}'),
                          message: _filePreviewErrorMessage(
                            snapshot.error!,
                            copy,
                          ),
                          onRetry: _retry,
                        );
                      } else {
                        child = Semantics(
                          key: ValueKey(
                            'file-preview-content-${attachment.id}',
                          ),
                          liveRegion: true,
                          label: copy.workbenchFileReadCompleted(
                            attachment.name,
                          ),
                          child: _filePreviewBody(
                            context,
                            attachment,
                            snapshot.data!,
                          ),
                        );
                      }
                      return AnimatedSwitcher(
                        duration: transitionDuration,
                        switchInCurve: Curves.easeOut,
                        switchOutCurve: Curves.easeIn,
                        child: child,
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _FilePreviewLoading extends StatelessWidget {
  const _FilePreviewLoading({super.key, required this.attachment});

  final RelayAttachment attachment;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    label: context.l10n.workbenchFileReading(attachment.name),
    excludeSemantics: true,
    child: Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const AnimatedRunningStatusIcon(size: 30, color: RelayTheme.green),
            const SizedBox(height: 16),
            Text(
              context.l10n.workbenchSecureFileReading,
              style: const TextStyle(
                color: RelayTheme.mutedBright,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              attachment.name,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: RelayTheme.muted,
                fontFamily: 'monospace',
                fontSize: 10,
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _FilePreviewError extends StatelessWidget {
  const _FilePreviewError({
    super.key,
    required this.message,
    required this.onRetry,
  });

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    label: context.l10n.workbenchFileReadFailed(message),
    child: Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.error_outline_rounded,
              color: RelayTheme.red,
              size: 30,
            ),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: RelayTheme.mutedBright),
            ),
            const SizedBox(height: 14),
            OutlinedButton.icon(
              key: const ValueKey('file-preview-retry'),
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded, size: 18),
              label: Text(context.l10n.commonRetry),
            ),
          ],
        ),
      ),
    ),
  );
}

String _filePreviewErrorMessage(Object error, AppLocalizations copy) =>
    error is RelayApiException
    ? error.message
    : copy.workbenchFilePreviewFailed;

String _fileExtension(String name) {
  final normalized = name.toLowerCase();
  final index = normalized.lastIndexOf('.');
  return index < 0 ? '' : normalized.substring(index);
}

String _filePreviewKindLabel(
  RelayAttachment attachment,
  AppLocalizations copy,
) {
  final mimeType = attachment.mimeType.toLowerCase();
  final extension = _fileExtension(attachment.name);
  if (mimeType == 'text/html') return copy.workbenchVisualization;
  if (mimeType == 'application/pdf') return 'PDF';
  if (mimeType == 'text/markdown') return 'Markdown';
  if (mimeType == 'image/svg+xml') return 'SVG';
  if (mimeType.startsWith('image/')) return mimeType.substring(6).toUpperCase();
  if (mimeType == 'application/json' || mimeType == 'application/x-ndjson') {
    return 'JSON';
  }
  if (mimeType == 'text/csv' || mimeType == 'text/tab-separated-values') {
    return copy.workbenchFileKindTableText;
  }
  if (extension == '.log') return copy.workbenchFileKindLog;
  if (const {'.txt', '.text'}.contains(extension)) {
    return copy.workbenchFileKindPlainText;
  }
  return copy.workbenchFileKindCodeOrConfig;
}

bool _wrapFilePreviewText(RelayAttachment attachment) =>
    const {'.txt', '.text', '.rst'}.contains(_fileExtension(attachment.name)) ||
    const {
      'readme',
      'changelog',
      'license',
      'notice',
    }.contains(attachment.name.toLowerCase());

String _formattedFilePreviewText(RelayAttachment attachment, Uint8List bytes) {
  final text = utf8.decode(bytes, allowMalformed: true);
  if (attachment.mimeType.toLowerCase() != 'application/json') return text;
  try {
    return const JsonEncoder.withIndent('  ').convert(jsonDecode(text));
  } on FormatException {
    return text;
  }
}

Widget _filePreviewBody(
  BuildContext context,
  RelayAttachment attachment,
  Uint8List bytes,
) {
  final mimeType = attachment.mimeType.toLowerCase();
  if (mimeType == 'text/html') {
    return SecureHtmlPreview(
      key: ValueKey('file-preview-html-${attachment.id}'),
      bytes: bytes,
    );
  }
  if (mimeType == 'application/pdf') {
    return KeyedSubtree(
      key: ValueKey('file-preview-pdf-${attachment.id}'),
      child: PdfViewer.data(bytes, sourceName: attachment.name),
    );
  }
  if (mimeType == 'image/svg+xml') {
    return Padding(
      key: ValueKey('file-preview-svg-${attachment.id}'),
      padding: const EdgeInsets.all(20),
      child: InteractiveViewer(
        minScale: .5,
        maxScale: 8,
        child: SizedBox.expand(
          child: SecureSvgPreview(
            bytes: bytes,
            disableAnimations: MediaQuery.disableAnimationsOf(context),
          ),
        ),
      ),
    );
  }
  if (mimeType.startsWith('image/')) {
    return InteractiveViewer(
      key: ValueKey('file-preview-image-${attachment.id}'),
      minScale: .5,
      maxScale: 8,
      child: Center(
        child: Image.memory(
          bytes,
          fit: BoxFit.contain,
          semanticLabel: attachment.name,
          errorBuilder: (context, error, stackTrace) => Padding(
            padding: const EdgeInsets.all(20),
            child: Text(
              context.l10n.workbenchImageReadFailed(attachment.name),
              textAlign: TextAlign.center,
            ),
          ),
        ),
      ),
    );
  }
  final text = _formattedFilePreviewText(attachment, bytes);
  if (mimeType == 'text/markdown') {
    return Scrollbar(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: MarkdownBody(
          key: ValueKey('file-preview-markdown-${attachment.id}'),
          data: text,
          selectable: true,
          styleSheet: relayMarkdownStyle(context).copyWith(
            p: const TextStyle(height: 1.55, color: RelayTheme.ink),
            blockquote: const TextStyle(
              height: 1.55,
              color: RelayTheme.mutedBright,
            ),
            blockquotePadding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
            blockquoteDecoration: BoxDecoration(
              color: RelayTheme.panelSoft,
              border: Directionality.of(context) == TextDirection.rtl
                  ? const Border(
                      right: BorderSide(color: RelayTheme.green, width: 3),
                    )
                  : const Border(
                      left: BorderSide(color: RelayTheme.green, width: 3),
                    ),
              borderRadius: const BorderRadius.all(Radius.circular(6)),
            ),
          ),
        ),
      ),
    );
  }
  return _TextFilePreview(
    key: ValueKey('file-preview-text-${attachment.id}'),
    text: text,
    wrap: _wrapFilePreviewText(attachment),
  );
}

class _TextFilePreview extends StatefulWidget {
  const _TextFilePreview({super.key, required this.text, required this.wrap});

  final String text;
  final bool wrap;

  @override
  State<_TextFilePreview> createState() => _TextFilePreviewState();
}

class _TextFilePreviewState extends State<_TextFilePreview> {
  final ScrollController _verticalController = ScrollController();
  final ScrollController _horizontalController = ScrollController();

  @override
  void dispose() {
    _verticalController.dispose();
    _horizontalController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final minimumWidth = math.max(0.0, constraints.maxWidth - 40);
      final text = SelectableText(
        widget.text,
        style: const TextStyle(
          color: RelayTheme.ink,
          height: 1.55,
          fontFamily: 'monospace',
          fontSize: 12,
        ),
      );
      final content = widget.wrap
          ? ConstrainedBox(
              constraints: BoxConstraints(minWidth: minimumWidth),
              child: text,
            )
          : Scrollbar(
              controller: _horizontalController,
              scrollbarOrientation: ScrollbarOrientation.bottom,
              notificationPredicate: (notification) =>
                  notification.metrics.axis == Axis.horizontal,
              child: SingleChildScrollView(
                key: const ValueKey('file-preview-horizontal-scroll'),
                controller: _horizontalController,
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.only(bottom: 8),
                child: ConstrainedBox(
                  constraints: BoxConstraints(minWidth: minimumWidth),
                  child: text,
                ),
              ),
            );
      return Scrollbar(
        controller: _verticalController,
        scrollbarOrientation: ScrollbarOrientation.right,
        notificationPredicate: (notification) =>
            notification.metrics.axis == Axis.vertical,
        child: SingleChildScrollView(
          controller: _verticalController,
          padding: const EdgeInsets.all(20),
          child: content,
        ),
      );
    },
  );
}

class _SubtleSystemReminder extends StatefulWidget {
  const _SubtleSystemReminder({super.key, required this.content});

  final String content;

  @override
  State<_SubtleSystemReminder> createState() => _SubtleSystemReminderState();
}

class _SubtleSystemReminderState extends State<_SubtleSystemReminder> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) => Theme(
    data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
    child: ExpansionTile(
      shape: const Border(),
      collapsedShape: const Border(),
      dense: true,
      visualDensity: const VisualDensity(vertical: -4),
      minTileHeight: 44,
      tilePadding: EdgeInsets.zero,
      childrenPadding: const EdgeInsets.only(bottom: 6),
      expandedAlignment: Directionality.of(context) == ui.TextDirection.rtl
          ? Alignment.centerRight
          : Alignment.centerLeft,
      expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
      onExpansionChanged: (expanded) => setState(() => _expanded = expanded),
      title: Text(
        context.l10n.workbenchSystemNotice,
        style: const TextStyle(
          color: Color(0xFF777773),
          fontSize: 10,
          fontWeight: FontWeight.w400,
          letterSpacing: .1,
        ),
      ),
      trailing: AnimatedRotation(
        turns: _expanded ? .5 : 0,
        duration: MediaQuery.disableAnimationsOf(context)
            ? Duration.zero
            : const Duration(milliseconds: 160),
        child: const Icon(
          Icons.keyboard_arrow_down_rounded,
          size: 16,
          color: Color(0xFF696965),
        ),
      ),
      children: [
        Container(
          margin: const EdgeInsets.only(left: 3, right: 3),
          padding: const EdgeInsetsDirectional.fromSTEB(10, 1, 2, 2),
          decoration: BoxDecoration(
            border: _startBorder(
              context,
              const BorderSide(color: RelayTheme.lineSoft),
            ),
          ),
          child: MarkdownBody(
            data: widget.content,
            selectable: true,
            styleSheet: relayMarkdownStyle(context).copyWith(
              p: const TextStyle(
                color: Color(0xFF8F8F8C),
                height: 1.4,
                fontSize: 11,
              ),
              blockquote: const TextStyle(
                color: Color(0xFF8F8F8C),
                height: 1.4,
                fontSize: 11,
              ),
              blockquotePadding: const EdgeInsetsDirectional.fromSTEB(
                10,
                2,
                0,
                2,
              ).resolve(Directionality.of(context)),
              blockquoteDecoration: BoxDecoration(
                color: Colors.transparent,
                border: _startBorder(
                  context,
                  const BorderSide(color: RelayTheme.lineSoft, width: 2),
                ),
              ),
            ),
          ),
        ),
      ],
    ),
  );
}

Border _startBorder(BuildContext context, BorderSide side) =>
    Directionality.of(context) == TextDirection.rtl
    ? Border(right: side)
    : Border(left: side);

class _ApprovalCard extends StatefulWidget {
  const _ApprovalCard({
    super.key,
    required this.controller,
    required this.approval,
    this.answerController,
    this.panelHeight,
  });

  final AppController controller;
  final RelayApproval approval;
  final TextEditingController? answerController;
  final double? panelHeight;

  @override
  State<_ApprovalCard> createState() => _ApprovalCardState();
}

class _ApprovalCardState extends State<_ApprovalCard> {
  late final TextEditingController _answer;
  bool _answerOpen = false;
  bool _detailsOpen = false;

  @override
  void initState() {
    super.initState();
    _answer = widget.answerController ?? TextEditingController();
    _answerOpen =
        _answer.text.isNotEmpty ||
        (widget.approval.action['allows_freeform'] == true &&
            (widget.approval.action['options'] as List? ?? const []).isEmpty);
  }

  AppController get controller => widget.controller;
  RelayApproval get approval => widget.approval;

  @override
  void dispose() {
    if (widget.answerController == null) _answer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final action = approval.action;
    final pending = controller.approvalIsPending(approval);
    final sourceAgentName =
        approval.sourceAgentName ??
        controller.sessions
            .where(
              (session) =>
                  session.id == approval.sessionId && session.isSubagent,
            )
            .firstOrNull
            ?.name;
    final options = (action['options'] as List? ?? const [])
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
    final question = action['type'] == 'question.select';
    final allowsFreeform = action['allows_freeform'] == true;
    final enabled = pending && controller.deviceOnline;
    final display =
        action['display'] as String? ??
        context.l10n.workbenchApprovalPermission;
    final cwd = action['cwd'] as String? ?? '';
    final title = _approvalTitle(context, action['type'] as String? ?? '');
    final state = approval.state == 'pending' && !pending
        ? 'expired'
        : approval.state;
    final primaryStyle = FilledButton.styleFrom(
      backgroundColor: RelayTheme.greenStrong,
      foregroundColor: const Color(0xFF102419),
      minimumSize: const Size(44, 44),
      textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    );
    Widget directory() => Text(
      context.l10n.workbenchApprovalDirectory('\u2066$cwd\u2069'),
      key: ValueKey('conversation-approval-${approval.id}-directory'),
      style: const TextStyle(fontSize: 12, color: RelayTheme.mutedBright),
    );
    Widget displayText() => SelectableText(
      display,
      key: ValueKey('conversation-approval-${approval.id}-display'),
      textDirection: question ? null : TextDirection.ltr,
      style: TextStyle(
        fontSize: question ? 16 : 13,
        fontWeight: question ? FontWeight.w600 : FontWeight.w400,
        fontFamily: question ? null : 'monospace',
        color: RelayTheme.text,
      ),
    );
    // Settled requests remain readable without leaving disabled forms in chat.
    if (widget.panelHeight == null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: ExpansionTile(
          key: ValueKey('conversation-approval-${approval.id}-history'),
          tilePadding: const EdgeInsets.symmetric(horizontal: 8),
          childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          dense: true,
          leading: Icon(
            state == 'approved'
                ? Icons.check_circle_outline
                : state == 'rejected'
                ? Icons.block
                : Icons.schedule,
            size: 18,
            color: state == 'approved' ? RelayTheme.green : RelayTheme.muted,
          ),
          title: Text(
            display,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 13),
          ),
          trailing: _StateChip(
            state: question && state == 'approved' ? 'answered' : state,
          ),
          children: [
            displayText(),
            if (sourceAgentName != null)
              Text(
                context.l10n.workbenchApprovalSource(sourceAgentName),
                style: const TextStyle(
                  fontSize: 12,
                  color: RelayTheme.mutedBright,
                ),
              ),
            if (cwd.isNotEmpty) directory(),
          ],
        ),
      );
    }
    final details = <Widget>[
      if (!question ||
          sourceAgentName != null ||
          approval.state == 'deciding') ...[
        Row(
          children: [
            Expanded(
              child: Text(
                sourceAgentName == null
                    ? title
                    : context.l10n.workbenchApprovalSource(sourceAgentName),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 12,
                  color: RelayTheme.mutedBright,
                ),
              ),
            ),
            if (approval.riskLevel == 'high')
              const Icon(
                Icons.shield_outlined,
                color: RelayTheme.amber,
                size: 16,
              ),
            if (approval.state == 'deciding') _StateChip(state: state),
          ],
        ),
        const SizedBox(height: 8),
      ],
      if (question)
        displayText()
      else
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: RelayTheme.field,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: RelayTheme.line),
          ),
          child: displayText(),
        ),
      if (cwd.isNotEmpty && !question) ...[
        const SizedBox(height: 2),
        InkWell(
          key: ValueKey('conversation-approval-${approval.id}-details-toggle'),
          onTap: () => setState(() => _detailsOpen = !_detailsOpen),
          borderRadius: BorderRadius.circular(8),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 44),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    cwd
                            .split(RegExp(r'[/\\]'))
                            .where((part) => part.isNotEmpty)
                            .lastOrNull ??
                        cwd,
                    textDirection: TextDirection.ltr,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 12,
                      color: RelayTheme.mutedBright,
                    ),
                  ),
                ),
                Icon(
                  _detailsOpen ? Icons.expand_less : Icons.chevron_right,
                  size: 18,
                  color: RelayTheme.muted,
                ),
              ],
            ),
          ),
        ),
        if (_detailsOpen) directory(),
      ],
    ];
    Widget optionRow(Map<String, dynamic> option) => Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: OutlinedButton(
        key: ValueKey(
          'conversation-approval-${approval.id}-option-${option['option_id']}',
        ),
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(double.infinity, 48),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          alignment: AlignmentDirectional.centerStart,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(11),
          ),
          side: const BorderSide(color: RelayTheme.line),
          foregroundColor: RelayTheme.text,
        ),
        onPressed: enabled ? () => _decideOption(option) : null,
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _optionLabel(context, option),
                    style: const TextStyle(fontSize: 14),
                  ),
                  if ((option['description'] as String? ?? '').isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(
                      option['description'] as String,
                      style: const TextStyle(
                        fontSize: 12,
                        color: RelayTheme.mutedBright,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            Icon(
              question ? Icons.radio_button_unchecked : Icons.chevron_right,
              size: 18,
              color: RelayTheme.muted,
            ),
          ],
        ),
      ),
    );
    final choices = <Widget>[
      ...options.map(optionRow),
      if (allowsFreeform && options.isNotEmpty)
        TextButton.icon(
          key: ValueKey('conversation-approval-${approval.id}-freeform'),
          onPressed: enabled
              ? () => setState(() => _answerOpen = !_answerOpen)
              : null,
          icon: Icon(
            _answerOpen ? Icons.expand_less : Icons.edit_outlined,
            size: 17,
          ),
          label: Text(context.l10n.workbenchOtherAnswer),
        ),
      if (allowsFreeform && _answerOpen) ...[
        if (action['freeform_delivery'] == 'followup')
          Text(context.l10n.workbenchSteerPlaceholder),
        TextField(
          key: ValueKey('conversation-approval-${approval.id}-answer-input'),
          controller: _answer,
          enabled: enabled,
          obscureText: action['is_secret'] == true,
          maxLength: 4000,
          minLines: 1,
          maxLines: action['is_secret'] == true ? 1 : 3,
          decoration: InputDecoration(
            labelText: context.l10n.workbenchAnswerLabel,
          ),
        ),
        ValueListenableBuilder<TextEditingValue>(
          valueListenable: _answer,
          builder: (context, value, _) => FilledButton(
            key: ValueKey('conversation-approval-${approval.id}-answer-submit'),
            style: primaryStyle,
            onPressed: enabled && value.text.trim().isNotEmpty
                ? () => controller.decideApproval(
                    approval,
                    'approved',
                    answer: action['is_secret'] == true
                        ? value.text
                        : value.text.trim(),
                  )
                : null,
            child: Text(context.l10n.commonSubmit),
          ),
        ),
      ],
    ];
    final actions = question
        ? TextButton(
            key: ValueKey('conversation-approval-${approval.id}-reject'),
            onPressed: enabled
                ? () => controller.decideApproval(approval, 'rejected')
                : null,
            child: Text(context.l10n.workbenchSkipAnswer),
          )
        : options.isNotEmpty
        ? Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (options.any(
                (option) =>
                    (option['kind'] as String? ?? '').contains('always') ||
                    (option['kind'] as String? ?? '').endsWith('policy'),
              ))
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(
                    context.l10n.workbenchSaveDecisionMessage.replaceAll(
                      'Codex',
                      agentLabels[controller.sessions
                              .where(
                                (session) => session.id == approval.sessionId,
                              )
                              .firstOrNull
                              ?.provider] ??
                          'Agent',
                    ),
                    style: const TextStyle(
                      fontSize: 12,
                      color: RelayTheme.mutedBright,
                    ),
                  ),
                ),
              ...choices,
            ],
          )
        : Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  key: ValueKey('conversation-approval-${approval.id}-reject'),
                  onPressed: enabled
                      ? () => controller.decideApproval(approval, 'rejected')
                      : null,
                  child: Text(context.l10n.commonReject),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton(
                  key: ValueKey('conversation-approval-${approval.id}-allow'),
                  style: primaryStyle,
                  onPressed: enabled
                      ? () => controller.decideApproval(approval, 'approved')
                      : null,
                  child: Text(context.l10n.commonAllow),
                ),
              ),
            ],
          );
    // Questions form one continuous document in the dock's scroll view.
    // Fixed sub-panels used to hide the answer behind a pinned skip button.
    if (question) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            ...details,
            const SizedBox(height: 12),
            ...choices,
            actions,
          ],
        ),
      );
    }
    return SizedBox(
      height: widget.panelHeight,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
        child: LayoutBuilder(
          builder: (context, constraints) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: SingleChildScrollView(
                  key: ValueKey(
                    'conversation-approval-${approval.id}-details-scroll',
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      ...details,
                      if (question) ...[const SizedBox(height: 8), ...choices],
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 6),
              ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight: math.max(0, (constraints.maxHeight - 6) * .65),
                ),
                child: SingleChildScrollView(child: actions),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _decideOption(Map<String, dynamic> option) async {
    final kind = option['kind'] as String? ?? '';
    final rejecting = kind.startsWith('reject');
    await controller.decideApproval(
      approval,
      rejecting ? 'rejected' : 'approved',
      optionId: option['option_id'] as String?,
    );
  }

  String _approvalTitle(BuildContext context, String type) => switch (type) {
    'command.execute' => context.l10n.workbenchApprovalCommand,
    'file.change' => context.l10n.workbenchApprovalFileChange,
    'question.select' => context.l10n.workbenchApprovalChoice,
    _ => context.l10n.workbenchApprovalTool,
  };

  String _optionLabel(BuildContext context, Map<String, dynamic> option) {
    if (approval.action['type'] == 'question.select') {
      return option['name'] as String? ?? context.l10n.workbenchSelect;
    }
    return switch (option['kind']) {
      'allow_once' => context.l10n.workbenchAllowOnce,
      'allow_always' => context.l10n.workbenchAlwaysAllowSession,
      'allow_policy' => context.l10n.workbenchAllowAndRemember,
      'reject_once' => context.l10n.commonReject,
      'reject_cancel' => context.l10n.workbenchRejectAndStop,
      'reject_always' => context.l10n.workbenchAlwaysRejectSession,
      'reject_policy' => context.l10n.workbenchRejectAndRemember,
      _ => option['name'] as String? ?? context.l10n.workbenchSelect,
    };
  }
}

class DevicePage extends StatefulWidget {
  const DevicePage({
    super.key,
    required this.controller,
    this.loadVersion,
    this.connections,
  });

  final AppController controller;
  final ComputerConnections? connections;
  final AppVersionLoader? loadVersion;

  @override
  State<DevicePage> createState() => _DevicePageState();
}

class _DevicePageState extends State<DevicePage> {
  late Future<String> _version;
  bool _disconnecting = false;

  @override
  void initState() {
    super.initState();
    _version = (widget.loadVersion ?? loadRelayuneVersion)();
  }

  @override
  void didUpdateWidget(DevicePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.loadVersion != widget.loadVersion) {
      _version = (widget.loadVersion ?? loadRelayuneVersion)();
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([
      widget.controller,
      if (widget.connections != null) widget.connections!,
      widget.controller.connectionSnapshotListenable,
    ]),
    builder: (context, _) =>
        _buildPage(context, widget.controller.connectionSnapshot),
  );

  Widget _buildPage(BuildContext context, DeviceConnectionSnapshot connection) {
    final controller = widget.controller;
    if (widget.connections case final connections?) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    computerText(context, '已添加的电脑', 'Your computers'),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                Text(
                  '${connections.computers.where((c) => c.deviceOnline).length}/${connections.computers.length} ${computerText(context, '台在线', 'online')}',
                  style: const TextStyle(color: RelayTheme.muted),
                ),
              ],
            ),
          ),
          Card(
            child: Column(
              children: [
                for (final (index, c) in connections.computers.indexed) ...[
                  if (index > 0) const Divider(height: 1),
                  ListTile(
                    key: ValueKey('device-list-${connections.deviceId(c)}'),
                    contentPadding: const EdgeInsets.all(16),
                    leading: Container(
                      width: 64,
                      height: 64,
                      decoration: BoxDecoration(
                        color: Color(
                          connections.colorOf(c),
                        ).withValues(alpha: .12),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      padding: const EdgeInsets.all(10),
                      child: SvgPicture.asset(
                        'assets/pairing/computer.svg',
                        colorFilter: ColorFilter.mode(
                          Color(connections.colorOf(c)),
                          BlendMode.srcIn,
                        ),
                      ),
                    ),
                    title: Text(connections.name(c)),
                    subtitle: Text(
                      '${c.deviceStatusLabel}${c == controller ? computerText(context, ' · 当前使用', ' · Current') : ''}',
                    ),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context).push<void>(
                      MaterialPageRoute(
                        builder: (context) => Scaffold(
                          appBar: AppBar(
                            title: Text(context.l10n.workbenchDevice),
                          ),
                          body: SafeArea(
                            top: false,
                            child: DevicePage(controller: c),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            key: const ValueKey('connect-another-computer'),
            onPressed: connections.account.addComputer,
            icon: const Icon(Icons.add),
            label: Text(computerText(context, '添加电脑', 'Add computer')),
          ),
        ],
      );
    }
    final snapshot = controller.bootstrap;
    final desktop = controller.desktopInfo;
    final desktopPlatform = desktop?.platformLabel;
    final visualState = deviceConnectionVisualState(
      online: connection.online,
      transport: connection.transport,
    );
    final connectionColor = deviceConnectionColor(visualState);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        StatusBanner(controller: controller),
        Card(
          key: const ValueKey('device-identity-card'),
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              children: [
                Row(
                  children: [
                    AnimatedContainer(
                      duration: MediaQuery.disableAnimationsOf(context)
                          ? Duration.zero
                          : const Duration(milliseconds: 320),
                      curve: Curves.easeOutCubic,
                      width: 58,
                      height: 58,
                      decoration: BoxDecoration(
                        color: deviceConnectionBackground(visualState),
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(
                          color: connectionColor.withValues(alpha: .34),
                        ),
                      ),
                      alignment: Alignment.center,
                      child: DeviceConnectionIcon(
                        key: const ValueKey('device-page-status-svg'),
                        online: connection.online,
                        transport: connection.transport,
                        semanticLabel: controller.deviceStatusLabel,
                        size: 32,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            snapshot?.device.name ??
                                context.l10n.workbenchLocalRelay,
                            style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 17,
                            ),
                          ),
                          Text(
                            controller.deviceStatusLabel,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: connectionColor,
                              fontSize: 12.5,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Relayune Desktop'
                            '${desktopPlatform == null ? '' : ' ($desktopPlatform)'}'
                            ' · ${desktop?.version ?? context.l10n.workbenchDesktopVersionUnknown}',
                            key: const ValueKey('device-desktop-version'),
                            style: const TextStyle(
                              color: RelayTheme.muted,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        _RealtimeHealthCard(connection: connection, controller: controller),
        const SizedBox(height: 14),
        _DeviceAgentsCard(
          desktop: desktop,
          online: connection.online,
          usage: controller.usageByProvider,
        ),
        const SizedBox(height: 14),
        Card(
          key: const ValueKey('device-technical-details-card'),
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  context.l10n.workbenchTechnicalDetails,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 16,
                  ),
                ),
                const SizedBox(height: 10),
                _MetricRow(
                  label: context.l10n.workbenchEncryptionProtocol,
                  value: 'A256GCM · v2',
                ),
                _MetricRow(
                  label: context.l10n.workbenchPairingProtocol,
                  value: 'SPAKE2 P-256 · RFC 9382',
                ),
                _MetricRow(
                  label: context.l10n.workbenchStateVersion,
                  value: connection.realtimeConfirmed
                      ? '${connection.revision}'
                      : context.l10n.workbenchAwaitingConfirmation,
                ),
                _MetricRow(
                  label: context.l10n.workbenchEventAck,
                  value: '${snapshot?.ackSequence ?? 0}',
                ),
                _MetricRow(
                  label: context.l10n.workbenchOfflineQueue,
                  value: '${snapshot?.queuedCommands ?? 0}',
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  context.l10n.workbenchSecurityBoundary,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 16,
                  ),
                ),
                const SizedBox(height: 10),
                _SecurityLine(
                  icon: Icons.phone_iphone,
                  text: context.l10n.workbenchPhonePlaintextEndpoint,
                ),
                _SecurityLine(
                  icon: Icons.storage_outlined,
                  text: context.l10n.workbenchServerCiphertextOnly,
                ),
                _SecurityLine(
                  icon: Icons.key_outlined,
                  text: context.l10n.workbenchKeyInSecureStorage,
                ),
                _SecurityLine(
                  icon: Icons.password_outlined,
                  text: context.l10n.workbenchCodeNeverUploaded,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        Card(
          child: ListTile(
            key: const ValueKey('connect-another-computer'),
            leading: _disconnecting
                ? const SizedBox.square(
                    dimension: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.link_off),
            title: Text(
              controller.addComputer == null
                  ? context.l10n.workbenchConnectAnother
                  : computerText(context, '添加电脑', 'Add computer'),
            ),
            subtitle: controller.addComputer == null
                ? Text(context.l10n.workbenchConnectAnotherSubtitle)
                : null,
            onTap: _disconnecting
                ? null
                : controller.addComputer ?? () => _confirmDisconnect(context),
          ),
        ),
        if (controller.removeComputer != null)
          TextButton.icon(
            icon: const Icon(Icons.link_off),
            label: Text(
              computerText(context, '移除此电脑连接', 'Remove this computer'),
            ),
            onPressed: _disconnecting
                ? null
                : () => _confirmDisconnect(context),
          ),
        const SizedBox(height: 20),
        FutureBuilder<String>(
          future: _version,
          builder: (context, snapshot) => Column(
            key: const ValueKey('device-app-version'),
            children: [
              Text(
                'Relayune Mobile ${snapshot.data ?? (snapshot.hasError ? '—' : '…')}',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12, color: RelayTheme.muted),
              ),
              const SizedBox(height: 3),
              Text(
                '${context.l10n.pairingMinimumDesktop(RelayConfig.minimumCompatibleDesktopVersion)} '
                '· https://relayune.giraffetree.cn',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: RelayTheme.muted),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _confirmDisconnect(BuildContext context) async {
    if (_disconnecting) return;
    setState(() => _disconnecting = true);
    final navigator = Navigator.of(context);
    try {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(
            widget.controller.removeComputer == null
                ? context.l10n.workbenchConnectAnotherTitle
                : computerText(context, '移除这台电脑？', 'Remove this computer?'),
          ),
          content: Text(
            widget.controller.removeComputer == null
                ? context.l10n.workbenchConnectAnotherMessage
                : computerText(
                    context,
                    '将清除此电脑在手机上的连接和缓存。其他电脑不受影响，需要时可重新授权连接。',
                    'This clears the connection and local cache for this computer. Other computers stay connected. You can authorize it again later.',
                  ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(context.l10n.commonCancel),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(context.l10n.commonContinue),
            ),
          ],
        ),
      );
      if (confirmed == true && mounted) {
        if (widget.controller.removeComputer != null) {
          await widget.controller.removeComputer!();
        } else {
          await widget.controller.disconnectAndPairAgain();
        }
        // The phase switch replaces home, not the routes pushed above it.
        // Remove device/settings/conversation routes to reveal the pairing page.
        if (mounted) navigator.popUntil((route) => route.isFirst);
      }
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(context.l10n.apiErrorGeneric)));
      }
    } finally {
      if (mounted) setState(() => _disconnecting = false);
    }
  }
}

class _DeviceAgentsCard extends StatelessWidget {
  const _DeviceAgentsCard({
    required this.desktop,
    required this.online,
    required this.usage,
  });
  final Map<String, ProviderUsageSnapshot> usage;
  final RelayDesktopInfo? desktop;
  final bool online;
  static const names = {
    'codex': 'Codex',
    'kimi': 'Kimi Code',
    'claude': 'Claude Code',
    'claude-cowork': 'Claude Cowork',
    'opencode': 'OpenCode',
    'mcode': 'MiniMax Code',
    'zcode': 'ZCode',
    'pi': 'Pi',
  };

  @override
  Widget build(BuildContext context) {
    final copy = context.l10n;
    final agents = {
      for (final agent in desktop?.agents ?? <RelayAgentRuntimeInfo>[])
        agent.provider: agent,
    };
    final providers = {
      ...names.keys,
      ...agents.keys.where((id) => id.isNotEmpty),
    };
    return Card(
      key: const ValueKey('device-agents-card'),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              copy.deviceAgents,
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
            ),
            if (!online)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  copy.deviceAgentOffline,
                  style: const TextStyle(color: RelayTheme.muted, fontSize: 12),
                ),
              ),
            const SizedBox(height: 8),
            for (final provider in providers)
              Padding(
                key: ValueKey('device-agent-$provider'),
                padding: const EdgeInsets.symmetric(vertical: 7),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                names[provider] ?? provider,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              Text(
                                agents[provider]?.version ??
                                    copy.workbenchDesktopVersionUnknown,
                                style: const TextStyle(
                                  color: RelayTheme.muted,
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child:
                              ['codex', 'claude', 'kimi'].contains(provider) &&
                                  (usage[provider]?.quotaWindows.isNotEmpty ??
                                      false) &&
                                  [
                                    'ready',
                                    'running',
                                    null,
                                    'unknown',
                                  ].contains(agents[provider]?.status)
                              ? DeviceAgentQuota(
                                  provider: provider,
                                  usage: usage[provider],
                                  online: online,
                                )
                              : Text(
                                  switch (agents[provider]?.status) {
                                    'ready' => copy.deviceAgentReady,
                                    'running' => copy.deviceAgentRunning,
                                    'not_installed' =>
                                      copy.deviceAgentNotInstalled,
                                    'unavailable' =>
                                      copy.deviceAgentUnavailable,
                                    'not_enabled' => copy.deviceAgentNotEnabled,
                                    _ => copy.deviceAgentUnknown,
                                  },
                                  textAlign: TextAlign.end,
                                  style: TextStyle(
                                    color:
                                        online &&
                                            [
                                              'ready',
                                              'running',
                                            ].contains(agents[provider]?.status)
                                        ? const Color(0xFF25845B)
                                        : RelayTheme.muted,
                                    fontSize: 12,
                                  ),
                                ),
                        ),
                      ],
                    ),
                    if (provider != providers.last) ...[
                      const SizedBox(height: 12),
                      const Divider(height: 1),
                    ],
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _RealtimeHealthCard extends StatelessWidget {
  const _RealtimeHealthCard({
    required this.connection,
    required this.controller,
  });

  final AppController controller;

  final DeviceConnectionSnapshot connection;

  @override
  Widget build(BuildContext context) {
    final heartbeatConfirmed = connection.websocketHeartbeatAt != null;
    final desktopState = desktopConnectionLinkState(connection);
    final heartbeatLabel =
        connection.transport == RealtimeTransportState.connected
        ? heartbeatConfirmed
              ? context.l10n.workbenchHeartbeatHealthy
              : context.l10n.workbenchHeartbeatWaiting
        : _realtimeTransportLabel(context, connection.transport);
    final desktopStatusLabel = switch (desktopState) {
      DeviceConnectionLinkState.healthy => context.l10n.workbenchOnline,
      DeviceConnectionLinkState.offline => context.l10n.workbenchOffline,
      DeviceConnectionLinkState.unknown =>
        context.l10n.workbenchNotificationUnknown,
      DeviceConnectionLinkState.waiting ||
      DeviceConnectionLinkState.reconnecting =>
        context.l10n.workbenchAwaitingConfirmation,
      DeviceConnectionLinkState.highLatency => context.l10n.workbenchOnline,
    };
    final webSocketRelative = _relativeConnectionTime(
      context,
      connection.websocketHeartbeatAt,
    );
    final desktopRelative = _relativeConnectionTime(
      context,
      connection.lastSeenAt,
    );
    final roundTrip = connection.websocketRoundTripMs == null
        ? '—'
        : '${connection.websocketRoundTripMs} ms';
    final webColor = deviceConnectionLinkColor(
      webSocketConnectionLinkState(connection),
    );
    final desktopColor = deviceConnectionLinkColor(desktopState);
    return DeviceRouteCard(
      status: controller.directReadStatus,
      online: connection.online,
      automatic: controller.directReadsEnabled,
      roundTripMs: controller.directRoundTripMs,
      connectionMs: controller.directConnectionMs,
      pathLabel: controller.directPathLabel,
      webSocketColor: webColor,
      serverColor: serverNodeColor(connection),
      desktopColor: desktopColor,
      realtimeSemanticLabel:
          'WebSocket: $heartbeatLabel, $roundTrip, $webSocketRelative; Desktop Relay: $desktopStatusLabel, $desktopRelative',
      webSocketConnected:
          connection.transport == RealtimeTransportState.connected,
      desktopConnected: desktopState == DeviceConnectionLinkState.healthy,
      webSocketLines: [
        'WebSocket',
        heartbeatLabel,
        roundTrip,
        context.l10n.workbenchLastHeartbeat,
        webSocketRelative,
        _formatDeviceTime(context, connection.websocketHeartbeatAt),
      ],
      desktopLines: [
        'Desktop Relay',
        desktopStatusLabel,
        '',
        context.l10n.workbenchDesktopHeartbeat,
        desktopRelative,
        _formatDeviceTime(context, connection.lastSeenAt),
      ],
    );
  }
}

String _realtimeTransportLabel(
  BuildContext context,
  RealtimeTransportState state,
) => switch (state) {
  RealtimeTransportState.connected => context.l10n.workbenchRealtimeConnected,
  RealtimeTransportState.connecting => context.l10n.workbenchRealtimeConnecting,
  RealtimeTransportState.reconnecting =>
    context.l10n.workbenchRealtimeReconnecting,
  RealtimeTransportState.idle => context.l10n.workbenchRealtimeIdle,
};

String _formatDeviceTime(BuildContext context, String? value) {
  final parsed = DateTime.tryParse(value ?? '')?.toLocal();
  if (parsed == null) return context.l10n.workbenchNotConfirmed;
  final material = MaterialLocalizations.of(context);
  return '${material.formatCompactDate(parsed)} ${material.formatTimeOfDay(TimeOfDay.fromDateTime(parsed), alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context))}';
}

String _relativeConnectionTime(BuildContext context, String? value) {
  final parsed = DateTime.tryParse(value ?? '')?.toLocal();
  if (parsed == null) return context.l10n.workbenchNotConfirmed;
  final difference = DateTime.now().difference(parsed);
  if (difference.isNegative || difference < const Duration(seconds: 15)) {
    return context.l10n.workbenchJustNow;
  }
  if (difference < const Duration(minutes: 1)) {
    return context.l10n.workbenchSecondsAgo(difference.inSeconds);
  }
  if (difference < const Duration(hours: 1)) {
    return context.l10n.workbenchMinutesAgo(difference.inMinutes);
  }
  return _formatDeviceTime(context, value);
}

class _SessionConfigTile extends StatelessWidget {
  const _SessionConfigTile({
    required this.config,
    required this.enabled,
    required this.onSelected,
  });

  final Map<String, dynamic> config;
  final bool enabled;
  final ValueChanged<Object> onSelected;

  @override
  Widget build(BuildContext context) {
    final options = (config['options'] as List? ?? const [])
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
    if (config['type'] == 'boolean') {
      return SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: Text(config['name'] as String? ?? config['id'] as String),
        subtitle: Text(config['description'] as String? ?? ''),
        value: config['currentValue'] as bool? ?? false,
        onChanged: enabled ? onSelected : null,
      );
    }
    final current = config['currentValue'];
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            config['name'] as String? ?? config['id'] as String,
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          if ((config['description'] as String? ?? '').isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              config['description'] as String,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
          const SizedBox(height: 7),
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: options.map((option) {
              final value = option['value'];
              final selected = current == value;
              final dangerous = _isRiskyConfigValue(value);
              return OutlinedButton(
                style: OutlinedButton.styleFrom(
                  foregroundColor: dangerous && !selected
                      ? RelayTheme.ember
                      : null,
                  backgroundColor: selected ? RelayTheme.greenBackground : null,
                  side: dangerous && !selected
                      ? const BorderSide(color: RelayTheme.ember)
                      : null,
                ),
                onPressed: enabled && !selected
                    ? () => onSelected(value as Object)
                    : null,
                child: Text(option['name'] as String? ?? '$value'),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }
}

class _EmptyConversation extends StatelessWidget {
  const _EmptyConversation({this.onCreate});

  final VoidCallback? onCreate;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const BrandMark(size: 64),
          const SizedBox(height: 16),
          Text(
            context.l10n.workbenchNoSessions,
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 7),
          Text(
            context.l10n.workbenchNoSessionsHelp,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          FilledButton.tonal(
            onPressed: onCreate,
            child: Text(context.l10n.workbenchNewSession),
          ),
        ],
      ),
    ),
  );
}

class _StateChip extends StatelessWidget {
  const _StateChip({required this.state});

  final String state;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
    decoration: BoxDecoration(
      color: state == 'pending'
          ? RelayTheme.amberBackground
          : const Color(0xFF242424),
      borderRadius: BorderRadius.circular(99),
    ),
    child: Text(switch (state) {
      'pending' => context.l10n.workbenchStatePending,
      'deciding' => context.l10n.workbenchStateDeciding,
      'approved' => context.l10n.workbenchStateApproved,
      'answered' => context.l10n.workbenchStateAnswered,
      'rejected' => context.l10n.workbenchStateRejected,
      _ => context.l10n.workbenchStateExpired,
    }, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700)),
  );
}

class _MetricRow extends StatelessWidget {
  const _MetricRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final labelWidth = (constraints.maxWidth * .32).clamp(88.0, 104.0);
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 7),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: labelWidth,
              child: Text(
                label,
                style: const TextStyle(
                  color: RelayTheme.muted,
                  fontSize: 13,
                  height: 1.35,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                value,
                softWrap: true,
                style: const TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w700,
                  height: 1.35,
                ),
              ),
            ),
          ],
        ),
      );
    },
  );
}

class _SecurityLine extends StatelessWidget {
  const _SecurityLine({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Row(
      children: [
        Icon(icon, size: 19, color: RelayTheme.fern),
        const SizedBox(width: 10),
        Expanded(child: Text(text)),
      ],
    ),
  );
}

class _ConnectionDot extends StatelessWidget {
  const _ConnectionDot({required this.online});

  final bool online;

  @override
  Widget build(BuildContext context) => Container(
    width: 10,
    height: 10,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color: online ? RelayTheme.green : const Color(0xFF50504D),
      boxShadow: online
          ? const [
              BoxShadow(
                color: Color(0x552B9B71),
                blurRadius: 6,
                spreadRadius: 2,
              ),
            ]
          : null,
    ),
  );
}

extension _CharactersFirstOrNull on Characters {
  String? get firstOrNull => isEmpty ? null : first;
}
