part of 'workbench_screen.dart';

// A snapshot describes work; only a real, unexpired request asks for a decision.
List<RelayApproval> _agentRequests(
  AppController controller,
  RelayAgent agent,
) => controller.approvalsForSession(agent.parentSessionId).where((request) {
  final belongs =
      request.sessionId == agent.threadId ||
      request.sourceThreadId == agent.threadId ||
      request.sourceAgentId == agent.id;
  return belongs &&
      (controller.approvalIsPending(request) || request.state == 'deciding');
}).toList();

bool _agentEnded(RelayAgent agent) => const {
  'completed',
  'shutdown',
  'interrupted',
  'errored',
  'notFound',
}.contains(agent.status);

String _agentTitle(RelayAgent agent) =>
    (agent.name.trim().isEmpty ? 'Agent' : agent.name).trim().split('\n').first;

String _agentStatus(
  RelayAgent agent,
  AppController controller,
  AppLocalizations copy,
) {
  final requests = _agentRequests(controller, agent);
  if (requests.any((r) => r.state == 'deciding')) {
    return copy.workbenchStateDeciding;
  }
  if (requests.any((r) => r.action['type'] == 'question.select')) {
    return copy.agentTaskAnswer;
  }
  if (requests.isNotEmpty) return copy.agentTaskApprove;
  if (!_agentEnded(agent) &&
      (!controller.deviceOnline ||
          controller.agentActivityErrorForSession(agent.parentSessionId) !=
              null)) {
    return copy.agentTaskUnknown;
  }
  return switch (agent.status) {
    'pendingInit' => copy.agentTaskPreparing,
    'running' => copy.workbenchRunning,
    'completed' => copy.agentTaskCompleted,
    'shutdown' || 'interrupted' => copy.agentTaskStopped,
    'errored' || 'notFound' => copy.agentTaskFailed,
    _ => copy.agentTaskUnknown,
  };
}

Color _agentColor(RelayAgent agent, AppController controller) =>
    _agentRequests(controller, agent).isNotEmpty ||
        const {'errored', 'notFound'}.contains(agent.status)
    ? RelayTheme.amber
    : agent.status == 'running' || agent.status == 'completed'
    ? RelayTheme.greenStrong
    : RelayTheme.mutedBright;

String? _agentCurrentActivity(RelayAgent agent) {
  if (_agentEnded(agent)) {
    return agent.summary?.trim().isNotEmpty == true
        ? agent.summary!.trim()
        : null;
  }
  if (agent.activity?.trim().isNotEmpty == true) return agent.activity!.trim();
  return agent.activityLog.lastOrNull?.label;
}

String? _agentPreview(RelayAgent agent) {
  return _agentEnded(agent) ? null : _agentCurrentActivity(agent);
}

String _agentSummary(List<RelayAgent> agents, AppLocalizations copy) {
  final running = agents.where((a) => a.status == 'running').length;
  final completed = agents.where((a) => a.status == 'completed').length;
  final stopped = agents
      .where((a) => const {'shutdown', 'interrupted'}.contains(a.status))
      .length;
  final failed = agents
      .where((a) => const {'errored', 'notFound'}.contains(a.status))
      .length;
  final preparing = agents.where((a) => a.status == 'pendingInit').length;
  final unknown =
      agents.length - running - completed - stopped - failed - preparing;
  return [
    copy.agentTasksCount(agents.length),
    if (running > 0) copy.agentTasksRunning(running),
    if (completed > 0) copy.agentTasksCompletedCount(completed),
    if (stopped > 0) copy.agentTasksStoppedCount(stopped),
    if (failed > 0) copy.agentTasksFailedCount(failed),
    if (preparing > 0) copy.agentTasksPreparingCount(preparing),
    if (unknown > 0) copy.agentTasksUnknownCount(unknown),
  ].join(' · ');
}

int _agentRank(RelayAgent agent, AppController controller) =>
    _agentRequests(controller, agent).isNotEmpty
    ? 0
    : const {'errored', 'notFound'}.contains(agent.status)
    ? 1
    : agent.isActive
    ? 2
    : !_agentEnded(agent)
    ? 3
    : 4;

List<RelayAgent> _prioritizedAgents(
  List<RelayAgent> agents,
  AppController controller,
) => [
  for (var rank = 0; rank <= 4; rank++)
    ...agents.where((agent) => _agentRank(agent, controller) == rank),
];

String _agentIdentity(RelayAgent agent) => [
  if (agent.model?.trim().isNotEmpty == true) agent.model,
  if (agent.reasoningEffort?.trim().isNotEmpty == true) agent.reasoningEffort,
].join(' · ');

// Prioritize once on entry, then append new tasks. Activity updates never shuffle
// rows under a reader's finger.
void _rememberAgentOrder(
  List<String> order,
  List<RelayAgent> agents,
  AppController controller,
) {
  if (order.isEmpty) {
    final ranked = [...agents]
      ..sort((a, b) {
        return _agentRank(a, controller).compareTo(_agentRank(b, controller));
      });
    order.addAll(ranked.map((a) => a.id));
  } else {
    order.addAll(agents.where((a) => !order.contains(a.id)).map((a) => a.id));
  }
}

List<RelayAgent> _orderedAgents(List<String> order, List<RelayAgent> agents) =>
    [
      for (final id in order)
        if (agents.any((a) => a.id == id)) agents.firstWhere((a) => a.id == id),
    ];

void _refreshAgentTasks(AppController controller, String rootId) {
  if (controller.relayKey != null && controller.deviceOnline) {
    unawaited(controller.refreshAgentActivity(rootId));
  }
}

void _openAgentTask(
  BuildContext context,
  AppController controller,
  RelayAgent agent,
) {
  Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => _AgentTaskPage(
        controller: controller,
        rootId: agent.parentSessionId,
        agentId: agent.id,
      ),
    ),
  );
}

class _ConversationActivityDock extends StatefulWidget {
  const _ConversationActivityDock({
    required this.controller,
    required this.maxPanelHeight,
    required this.answerDrafts,
    required this.agents,
    required this.approvals,
    this.loading = false,
    this.error,
    this.openRequest = 0,
    this.approvalOpenRequest = 0,
    this.onInspectAgent,
  });
  final AppController controller;
  final double maxPanelHeight;
  final Map<String, String> answerDrafts;
  final List<RelayAgent> agents;
  final List<RelayApproval> approvals;
  final bool loading;
  final String? error;
  final int openRequest;
  final int approvalOpenRequest;
  final ValueChanged<RelayAgent>? onInspectAgent;
  @override
  State<_ConversationActivityDock> createState() =>
      _ConversationActivityDockState();
}

class _ConversationActivityDockState extends State<_ConversationActivityDock> {
  final _answerDrafts = <String, TextEditingController>{};
  final _order = <String>[];
  final _requestScroll = ScrollController();
  String? _visibleQuestionId;
  bool _expanded = false;
  bool _tall = false;
  double _dragDistance = 0;
  String _section = 'agents';
  String? _selectedQuestionId;
  ForegroundPeriodicTimer? _refreshTimer;
  String _approvalSection(RelayApproval approval) =>
      approval.action['type'] == 'question.select' ? 'questions' : 'approvals';

  @override
  void initState() {
    super.initState();
    _expanded = widget.openRequest > 0 || widget.approvals.isNotEmpty;
    if (widget.approvals.isNotEmpty) {
      _section = _approvalSection(widget.approvals.first);
    }
    _rememberAgentOrder(_order, widget.agents, widget.controller);
    // Events update immediately; polling repairs missed external activity.
    _refreshTimer = ForegroundPeriodicTimer(const Duration(seconds: 3), () {
      if (mounted &&
          TickerMode.of(context) &&
          (ModalRoute.of(context)?.isCurrent ?? true) &&
          widget.agents.any((a) => !_agentEnded(a))) {
        widget.onInspectAgent?.call(widget.agents.first);
      }
    });
  }

  @override
  void didUpdateWidget(covariant _ConversationActivityDock oldWidget) {
    super.didUpdateWidget(oldWidget);
    _rememberAgentOrder(_order, widget.agents, widget.controller);
    if (_visibleQuestionId != null &&
        !widget.approvals.any((a) => a.id == _visibleQuestionId)) {
      _resetQuestionScroll();
    }
    final newRequest = widget.approvals
        .where((a) => !oldWidget.approvals.any((old) => old.id == a.id))
        .firstOrNull;
    if (newRequest != null ||
        widget.approvalOpenRequest > oldWidget.approvalOpenRequest &&
            widget.approvals.isNotEmpty) {
      _section = _approvalSection(newRequest ?? widget.approvals.first);
      _expanded = true;
    } else if (widget.openRequest > oldWidget.openRequest) {
      _section = 'agents';
      _expanded = true;
    }
    if (_section != 'agents' &&
        !widget.approvals.any((a) => _approvalSection(a) == _section)) {
      _section = widget.approvals.isNotEmpty
          ? _approvalSection(widget.approvals.first)
          : 'agents';
    }
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    for (final draft in _answerDrafts.values) {
      draft.dispose();
    }
    _requestScroll.dispose();
    super.dispose();
  }

  void _resetQuestionScroll() {
    FocusManager.instance.primaryFocus?.unfocus();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _requestScroll.hasClients) _requestScroll.jumpTo(0);
    });
  }

  void _selectSection(String section) => setState(() {
    _expanded = _section == section ? !_expanded : true;
    _section = section;
  });

  @override
  Widget build(BuildContext context) {
    final copy = context.l10n;
    final agents = _prioritizedAgents(
      _orderedAgents(_order, widget.agents),
      widget.controller,
    );
    final media = MediaQuery.of(context);
    final textScale = MediaQuery.textScalerOf(context).scale(1).clamp(1.0, 2.0);
    final heightLimit = math.min(
      widget.maxPanelHeight,
      _tall
          ? 560.0
          : math.max(
              100.0,
              (media.size.height - media.viewInsets.bottom) * .42,
            ),
    );
    final previewCount = ((heightLimit - 96 * textScale) / (84 * textScale))
        .floor()
        .clamp(1, agents.any((a) => !_agentEnded(a)) ? 3 : 2);
    final previews = agents.take(previewCount).toList();
    final scoped = widget.approvals
        .where((a) => _approvalSection(a) == _section)
        .toList();
    if (_section == 'questions') {
      scoped.sort((a, b) {
        final time = a.requestedAt.compareTo(b.requestedAt);
        return time != 0
            ? time
            : ((a.action['question_index'] as int?) ?? 0).compareTo(
                (b.action['question_index'] as int?) ?? 0,
              );
      });
    }
    final selectedQuestion =
        scoped.where((a) => a.id == _selectedQuestionId).firstOrNull ??
        scoped.firstOrNull;
    _visibleQuestionId = _section == 'questions' ? selectedQuestion?.id : null;
    final displayedRequests = _section == 'questions'
        ? [if (selectedQuestion != null) selectedQuestion]
        : scoped;
    final hasRequests = widget.approvals.isNotEmpty;
    final featured = agents.firstOrNull;
    final title = _section == 'agents'
        ? copy.agentTasksTitle
        : _section == 'questions'
        ? copy.workbenchApprovalChoice
        : copy.workbenchKimiApprovals;
    final options = (selectedQuestion?.action['options'] as List?)?.length ?? 0;
    final desired = _section == 'agents'
        ? (96.0 + previews.length * 84) * textScale
        : _section == 'questions'
        ? math.min(
            380.0,
            (options == 0 ? 300.0 : 184.0 + options * 54) * textScale,
          )
        : 252.0;
    final height = math.min(
      widget.maxPanelHeight,
      _tall
          ? 560.0
          : math.min(
              desired,
              math.max(
                100.0,
                (media.size.height - media.viewInsets.bottom) * .42,
              ),
            ),
    );
    final tabs = <Widget>[
      for (final section in ['approvals', 'questions', 'agents'])
        if (section == 'agents'
            ? agents.isNotEmpty
            : widget.approvals.any((a) => _approvalSection(a) == section))
          Expanded(
            child: TextButton(
              key: ValueKey('conversation-activity-tab-$section'),
              onPressed: () => _selectSection(section),
              child: Text(
                '${section == 'agents'
                    ? copy.agentTasksTitle
                    : section == 'questions'
                    ? copy.workbenchApprovalChoice
                    : copy.workbenchKimiApprovals} ${section == 'agents' ? agents.length : widget.approvals.where((a) => _approvalSection(a) == section).length}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 12),
              ),
            ),
          ),
    ];
    return Container(
      key: const ValueKey('composer-agent-status'),
      margin: const EdgeInsets.only(bottom: 8),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: const Color(0xFF202321),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFF363B37)),
      ),
      child: AnimatedSize(
        key: const ValueKey('conversation-activity-panel-animation'),
        duration: MediaQuery.disableAnimationsOf(context)
            ? Duration.zero
            : const Duration(milliseconds: 240),
        alignment: Alignment.bottomCenter,
        child: !_expanded
            ? Material(
                color: Colors.transparent,
                child: hasRequests
                    ? Row(children: tabs)
                    : InkWell(
                        key: const ValueKey('composer-agent-status-toggle'),
                        onTap: () => _selectSection('agents'),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 10,
                          ),
                          child: Row(
                            children: [
                              const Icon(
                                Icons.account_tree_outlined,
                                size: 20,
                                color: RelayTheme.greenStrong,
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      widget.controller.deviceOnline
                                          ? _agentSummary(agents, copy)
                                          : copy.agentTaskOffline,
                                      style: const TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    if (featured != null)
                                      Text(
                                        '${_agentTitle(featured)} · ${_agentStatus(featured, widget.controller, copy)}',
                                        key: const ValueKey(
                                          'inline-agent-activity-ticker',
                                        ),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                          fontSize: 12,
                                          color: RelayTheme.mutedBright,
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                              const Icon(
                                Icons.keyboard_arrow_up_rounded,
                                size: 20,
                              ),
                            ],
                          ),
                        ),
                      ),
              )
            : SizedBox(
                key: const ValueKey('conversation-activity-panel'),
                height: height,
                child: LayoutBuilder(
                  builder: (context, panelConstraints) => Column(
                    children: [
                      ConstrainedBox(
                        constraints: BoxConstraints(
                          maxHeight: panelConstraints.maxHeight,
                        ),
                        child: GestureDetector(
                          key: const ValueKey(
                            'conversation-activity-drag-handle',
                          ),
                          behavior: HitTestBehavior.opaque,
                          onVerticalDragStart: (_) => _dragDistance = 0,
                          onVerticalDragUpdate: (d) =>
                              _dragDistance += d.delta.dy,
                          onVerticalDragEnd: (_) => setState(() {
                            if (_dragDistance > 30) {
                              _expanded = false;
                              _tall = false;
                            }
                            if (_dragDistance < -30) _tall = true;
                          }),
                          child: Row(
                            children: [
                              if (tabs.length > 1)
                                Expanded(child: Row(children: tabs))
                              else
                                Expanded(
                                  child: Padding(
                                    padding: const EdgeInsetsDirectional.only(
                                      start: 14,
                                    ),
                                    child: Text(
                                      '$title · ${_section == 'agents' ? agents.length : scoped.length}',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                ),
                              IconButton(
                                key: const ValueKey(
                                  'conversation-activity-panel-close',
                                ),
                                tooltip: copy.commonClose,
                                onPressed: () => setState(() {
                                  _expanded = false;
                                  _tall = false;
                                }),
                                icon: const Icon(
                                  Icons.keyboard_arrow_down_rounded,
                                  size: 20,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      Expanded(
                        child: _section == 'agents'
                            ? Column(
                                key: const ValueKey(
                                  'composer-agent-status-list',
                                ),
                                children: [
                                  Expanded(
                                    child: ListView(
                                      key: const ValueKey(
                                        'composer-agent-list-scroll',
                                      ),
                                      padding: EdgeInsets.zero,
                                      children: [
                                        for (final agent in previews)
                                          _AgentTaskRow(
                                            agent: agent,
                                            controller: widget.controller,
                                            compact: true,
                                            onTap: () => _openAgentTask(
                                              context,
                                              widget.controller,
                                              agent,
                                            ),
                                          ),
                                        // At keyboard-constrained heights the
                                        // header and fixed footer cannot both fit.
                                        if (height < 96)
                                          TextButton(
                                            key: const ValueKey(
                                              'agent-tasks-view-all',
                                            ),
                                            onPressed: () =>
                                                Navigator.of(context).push(
                                                  MaterialPageRoute<void>(
                                                    builder: (_) =>
                                                        _AgentTaskPage(
                                                          controller:
                                                              widget.controller,
                                                          rootId: agents
                                                              .first
                                                              .parentSessionId,
                                                        ),
                                                  ),
                                                ),
                                            child: Text(
                                              copy.agentTasksViewAll(
                                                agents.length,
                                              ),
                                            ),
                                          ),
                                      ],
                                    ),
                                  ),
                                  if (height >= 96)
                                    TextButton(
                                      key: const ValueKey(
                                        'agent-tasks-view-all',
                                      ),
                                      onPressed: () =>
                                          Navigator.of(context).push(
                                            MaterialPageRoute<void>(
                                              builder: (_) => _AgentTaskPage(
                                                controller: widget.controller,
                                                rootId: agents
                                                    .first
                                                    .parentSessionId,
                                              ),
                                            ),
                                          ),
                                      child: Text(
                                        copy.agentTasksViewAll(agents.length),
                                      ),
                                    ),
                                ],
                              )
                            : LayoutBuilder(
                                builder: (context, constraints) => SingleChildScrollView(
                                  controller: _requestScroll,
                                  key: ValueKey(
                                    'conversation-activity-$_section-scroll',
                                  ),
                                  child: Column(
                                    children: [
                                      if (_section == 'questions' &&
                                          scoped.length > 1)
                                        Padding(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 14,
                                          ),
                                          child: Wrap(
                                            spacing: 8,
                                            children: [
                                              for (
                                                var i = 0;
                                                i < scoped.length;
                                                i++
                                              )
                                                ChoiceChip(
                                                  key: ValueKey(
                                                    'question-select-${scoped[i].id}',
                                                  ),
                                                  label: Text(
                                                    '${(scoped[i].action['question_index'] as int? ?? i) + 1}',
                                                  ),
                                                  tooltip:
                                                      scoped[i]
                                                              .action['display']
                                                          as String?,
                                                  selected:
                                                      scoped[i].id ==
                                                      selectedQuestion?.id,
                                                  onSelected: (_) {
                                                    setState(
                                                      () =>
                                                          _selectedQuestionId =
                                                              scoped[i].id,
                                                    );
                                                    _resetQuestionScroll();
                                                  },
                                                ),
                                            ],
                                          ),
                                        ),
                                      if (_section == 'questions' &&
                                          (selectedQuestion
                                                          ?.action['question_count']
                                                      as int? ??
                                                  0) >
                                              1)
                                        Padding(
                                          padding: const EdgeInsets.fromLTRB(
                                            14,
                                            4,
                                            14,
                                            8,
                                          ),
                                          child: Align(
                                            alignment: AlignmentDirectional
                                                .centerStart,
                                            child: Text(
                                              '${(selectedQuestion!.action['question_index'] as int? ?? 0) + 1} / ${selectedQuestion.action['question_count']}',
                                              key: const ValueKey(
                                                'question-progress',
                                              ),
                                              style: const TextStyle(
                                                color: RelayTheme.mutedBright,
                                                fontSize: 12,
                                              ),
                                            ),
                                          ),
                                        ),
                                      for (final approval in displayedRequests)
                                        _ApprovalCard(
                                          key: ValueKey(
                                            'conversation-approval-${approval.id}',
                                          ),
                                          controller: widget.controller,
                                          approval: approval,
                                          panelHeight: math.max(
                                            160,
                                            constraints.maxHeight,
                                          ),
                                          answerController: _answerDrafts
                                              .putIfAbsent(approval.id, () {
                                                final draft = TextEditingController(
                                                  text:
                                                      widget
                                                          .answerDrafts[approval
                                                          .id] ??
                                                      '',
                                                );
                                                draft.addListener(() {
                                                  widget.answerDrafts[approval
                                                          .id] =
                                                      draft.text;
                                                });
                                                return draft;
                                              }),
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
      ),
    );
  }
}

class _AgentTaskRow extends StatelessWidget {
  const _AgentTaskRow({
    required this.agent,
    required this.controller,
    required this.onTap,
    this.compact = false,
  });
  final RelayAgent agent;
  final AppController controller;
  final VoidCallback onTap;
  final bool compact;
  @override
  Widget build(BuildContext context) {
    final copy = context.l10n;
    final status = _agentStatus(agent, controller, copy);
    final activity = _agentPreview(agent);
    final identity = _agentIdentity(agent);
    final parent = controller.agents
        .where((a) => a.threadId == agent.parentThreadId)
        .firstOrNull;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        key: ValueKey('composer-agent-status-agent-${agent.id}'),
        onTap: onTap,
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: compact ? 14 : 16,
            vertical: compact ? 8 : 10,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 3),
                child: Icon(
                  _agentRequests(controller, agent).isNotEmpty
                      ? Icons.help_outline
                      : agent.status == 'completed'
                      ? Icons.check_circle_outline
                      : const {'errored', 'notFound'}.contains(agent.status)
                      ? Icons.error_outline
                      : Icons.circle_outlined,
                  size: 17,
                  color: _agentColor(agent, controller),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _agentTitle(agent),
                      maxLines: compact ? 1 : 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    if (compact)
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              status,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 12,
                                color: _agentColor(agent, controller),
                              ),
                            ),
                          ),
                          if (activity?.isNotEmpty == true) ...[
                            const Text(
                              ' · ',
                              style: TextStyle(color: RelayTheme.muted),
                            ),
                            Expanded(
                              flex: 2,
                              child: Text(
                                activity!,
                                key: ValueKey('agent-live-command-${agent.id}'),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: RelayTheme.mutedBright,
                                ),
                              ),
                            ),
                          ],
                        ],
                      )
                    else ...[
                      Text(
                        status,
                        style: TextStyle(
                          fontSize: 12,
                          color: _agentColor(agent, controller),
                        ),
                      ),
                      if (activity?.isNotEmpty == true)
                        Text(
                          activity!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 12,
                            color: RelayTheme.mutedBright,
                          ),
                        ),
                    ],
                    if (!compact && parent != null)
                      Text(
                        copy.agentTaskParent(_agentTitle(parent)),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    if (identity.isNotEmpty)
                      Text(
                        identity,
                        key: ValueKey('agent-identity-${agent.id}'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 11,
                          color: RelayTheme.muted,
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 6),
              const Icon(
                Icons.chevron_right,
                size: 18,
                color: RelayTheme.mutedBright,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AgentTaskPage extends StatefulWidget {
  const _AgentTaskPage({
    required this.controller,
    required this.rootId,
    this.agentId,
  });
  final AppController controller;
  final String rootId;
  final String? agentId;
  @override
  State<_AgentTaskPage> createState() => _AgentTaskPageState();
}

class _AgentTaskPageState extends State<_AgentTaskPage> {
  final _order = <String>[];
  String _query = '';
  ForegroundPeriodicTimer? _timer;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _refreshAgentTasks(widget.controller, widget.rootId);
    });
    _timer = ForegroundPeriodicTimer(const Duration(seconds: 3), () {
      if (mounted &&
          (ModalRoute.of(context)?.isCurrent ?? false) &&
          widget.controller
              .agentsForRootSession(widget.rootId)
              .any((a) => !_agentEnded(a))) {
        _refreshAgentTasks(widget.controller, widget.rootId);
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.controller,
    builder: (context, _) {
      final controller = widget.controller;
      final copy = context.l10n;
      final all = controller.agentsForRootSession(widget.rootId);
      _rememberAgentOrder(_order, all, controller);
      final agents = _orderedAgents(_order, all);
      final matches = agents
          .where(
            (a) => '${a.name} ${a.nickname ?? ''} ${_agentIdentity(a)}'
                .toLowerCase()
                .contains(_query.toLowerCase()),
          )
          .toList();
      final selected = agents.where((a) => a.id == widget.agentId).firstOrNull;
      final error = controller.agentActivityErrorForSession(widget.rootId);
      return Scaffold(
        key: ValueKey(
          selected == null
              ? 'agent-tasks-overview'
              : 'composer-agent-detail-${selected.id}',
        ),
        appBar: AppBar(
          title: Text(
            selected == null ? copy.agentTasksTitle : _agentTitle(selected),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          leading: BackButton(
            key: const ValueKey('composer-agent-detail-back'),
          ),
          actions: [
            IconButton(
              tooltip: copy.commonRetry,
              onPressed:
                  controller.agentActivityLoadingForSession(widget.rootId)
                  ? null
                  : () => _refreshAgentTasks(controller, widget.rootId),
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: SafeArea(
          top: false,
          child: ListView(
            key: ValueKey(
              selected == null
                  ? 'agent-tasks-overview-scroll'
                  : 'composer-agent-detail-scroll',
            ),
            padding: const EdgeInsets.only(bottom: 24),
            children: [
              if (!controller.deviceOnline || error != null)
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    !controller.deviceOnline ? copy.agentTaskOffline : error!,
                    style: const TextStyle(color: RelayTheme.amber),
                  ),
                ),
              if (controller.agentActivityLoadingForSession(widget.rootId))
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Text(
                    copy.workbenchAgentSyncing,
                    style: const TextStyle(color: RelayTheme.mutedBright),
                  ),
                ),
              if (selected != null)
                ..._detail(context, selected)
              else if (agents.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(copy.agentTaskEmpty),
                )
              else ...[
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(_agentSummary(agents, copy)),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: TextField(
                    key: const ValueKey('agent-tasks-search'),
                    decoration: InputDecoration(
                      hintText: copy.agentTasksSearch,
                      prefixIcon: const Icon(Icons.search),
                    ),
                    onChanged: (value) => setState(() => _query = value.trim()),
                  ),
                ),
                if (matches.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(copy.agentTasksNoMatches),
                  ),
                for (final group in [0, 1, 2, 3, 4])
                  if (matches.any((a) => _group(a) == group)) ...[
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 20, 16, 6),
                      child: Text(
                        [
                          copy.agentTasksAttention,
                          copy.agentTasksInProgress,
                          copy.agentTaskUnknown,
                          copy.agentTaskCompleted,
                          copy.agentTaskStopped,
                        ][group],
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: RelayTheme.mutedBright,
                        ),
                      ),
                    ),
                    for (final agent in matches.where(
                      (a) => _group(a) == group,
                    ))
                      _AgentTaskRow(
                        agent: agent,
                        controller: controller,
                        onTap: () => _openAgentTask(context, controller, agent),
                      ),
                  ],
              ],
            ],
          ),
        ),
      );
    },
  );

  int _group(RelayAgent agent) =>
      _agentRequests(widget.controller, agent).isNotEmpty ||
          const {'errored', 'notFound'}.contains(agent.status)
      ? 0
      : agent.isActive
      ? 1
      : !_agentEnded(agent)
      ? 2
      : agent.status == 'completed'
      ? 3
      : 4;

  List<Widget> _detail(BuildContext context, RelayAgent agent) {
    final controller = widget.controller;
    final copy = context.l10n;
    final session = controller.sessions
        .where((s) => s.id == agent.threadId)
        .firstOrNull;
    final root = controller.sessions
        .where((s) => s.id == widget.rootId)
        .firstOrNull;
    final parent = controller.agents
        .where((a) => a.threadId == agent.parentThreadId)
        .firstOrNull;
    final result = agent.summary?.trim();
    return [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
        child: Text(
          _agentStatus(agent, controller, copy),
          style: TextStyle(color: _agentColor(agent, controller)),
        ),
      ),
      if (agent.nickname?.trim().isNotEmpty == true &&
          agent.nickname != agent.name)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: Text(
            agent.nickname!,
            style: const TextStyle(color: RelayTheme.mutedBright),
          ),
        ),
      if (_agentIdentity(agent).isNotEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          child: Text(
            '${copy.agentTaskModelConfiguration}: ${_agentIdentity(agent)}',
            key: ValueKey('agent-detail-identity-${agent.id}'),
            style: const TextStyle(color: RelayTheme.mutedBright),
          ),
        ),
      if (parent != null)
        TextButton(
          onPressed: () => _openAgentTask(context, controller, parent),
          child: Text(copy.agentTaskParent(_agentTitle(parent))),
        ),
      if (agent.canOpen && (session != null || root?.provider == 'codex'))
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: OutlinedButton.icon(
            key: const ValueKey('agent-task-open-conversation'),
            icon: const Icon(Icons.chat_bubble_outline, size: 18),
            label: Text(copy.agentTaskOpenConversation),
            onPressed: () {
              unawaited(controller.openAgentConversation(agent));
              Navigator.of(context).popUntil(
                (route) => route.settings.name == 'workbench' || route.isFirst,
              );
            },
          ),
        ),
      for (final request in _agentRequests(controller, agent))
        _ApprovalCard(
          key: ValueKey('agent-detail-approval-${request.id}'),
          controller: controller,
          approval: request,
          panelHeight: 400,
        ),
      Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              _agentEnded(agent)
                  ? copy.agentTaskFinishedResult
                  : copy.workbenchLatestResult,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 10),
            if (result?.isNotEmpty == true && (session ?? root) != null)
              _MessageContent(
                content: result!,
                user: false,
                system: false,
                referencedAttachments: const [],
                session: session ?? root!,
                controller: controller,
              )
            else
              SelectableText(
                result?.isNotEmpty == true ? result! : copy.agentTaskNoResult,
              ),
            if (!_agentEnded(agent) &&
                _agentCurrentActivity(agent)?.isNotEmpty == true) ...[
              const SizedBox(height: 16),
              Text(
                copy.workbenchCurrentActivity(_agentCurrentActivity(agent)!),
              ),
            ],
          ],
        ),
      ),
    ];
  }
}
