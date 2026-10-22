import 'dart:async';

import 'package:flutter/material.dart';

import '../../l10n/relayune_localizations.dart';
import '../models.dart';
import '../state/app_controller.dart';
import 'theme.dart';

String _permissionLabel(BuildContext context, Map config) {
  final current = config['currentValue'];
  final option = (config['options'] as List? ?? const [])
      .whereType<Map>()
      .where((item) => item['value'] == current)
      .firstOrNull;
  if (option?['name'] != null) return '${option!['name']}';
  final chinese = Localizations.localeOf(context).languageCode == 'zh';
  return current == 'custom'
      ? (chinese ? '自定义权限' : 'Custom permissions')
      : (chinese ? '权限待确认' : 'Permissions unconfirmed');
}

/// A compact entry stays beside the composer; choices come from the desktop.
class SessionModelSettings extends StatelessWidget {
  const SessionModelSettings({
    super.key,
    required this.controller,
    required this.session,
  });

  final AppController controller;
  final RelaySession session;

  @override
  Widget build(BuildContext context) {
    final options = controller.sessionConfigOptions(session);
    final labels = <String>[];
    for (final id in ['model', 'reasoning', 'permissions']) {
      final config = options
          .whereType<Map>()
          .where((item) => item['id'] == id)
          .firstOrNull;
      if (config == null) continue;
      if (id == 'permissions') {
        final current = config['currentValue'];
        if (current == null || current == '' || current == 'unknown') continue;
        labels.add(_permissionLabel(context, config));
        continue;
      }
      final current = config['currentValue'];
      final option = (config['options'] as List? ?? const [])
          .whereType<Map>()
          .where((item) => item['value'] == current)
          .firstOrNull;
      labels.add(
        '${option?['name'] ?? (current == null || current == '' ? context.l10n.workbenchDefault : current)}',
      );
    }
    final configurationLabel = labels.isEmpty
        ? session.raw['model'] as String? ??
              context.l10n.workbenchSessionSettings
        : labels.join(' · ');
    final busy = controller.configuringSessions.contains(session.id);
    return InkWell(
      key: const ValueKey('session-model-settings-button'),
      onTap: () {
        FocusScope.of(context).unfocus();
        showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          useSafeArea: true,
          showDragHandle: true,
          builder: (_) =>
              _SessionModelPanel(controller: controller, session: session),
        );
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(
          children: [
            const Icon(Icons.tune, size: 16, color: RelayTheme.mutedBright),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '${agentProviderDisplayName(session.provider)} · $configurationLabel',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w400,
                  color: RelayTheme.mutedBright,
                ),
              ),
            ),
            if (busy)
              const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            else
              const Icon(Icons.expand_more, size: 20),
          ],
        ),
      ),
    );
  }
}

class _SessionModelPanel extends StatefulWidget {
  const _SessionModelPanel({required this.controller, required this.session});
  final AppController controller;
  final RelaySession session;

  @override
  State<_SessionModelPanel> createState() => _SessionModelPanelState();
}

class _SessionModelPanelState extends State<_SessionModelPanel> {
  @override
  void initState() {
    super.initState();
    // A restored conversation can have only the startup catalog placeholder.
    // Selecting an already loaded conversation does not fetch history again.
    final configs = options;
    final incompleteClaude =
        session.provider == 'claude' &&
        (configs.isEmpty ||
            (configs.length == 1 &&
                configs.single['id'] == 'permissions' &&
                configs.single['currentValue'] == 'inherit' &&
                values(configs.single).length <= 1));
    final incompleteCodex =
        session.provider == 'codex' &&
        (configs.isEmpty ||
            configs.any(
              (option) =>
                  option['id'] == 'permissions' &&
                  option['currentValue'] == 'unknown',
            ));
    if ((incompleteClaude || incompleteCodex) &&
        widget.controller.deviceOnline) {
      scheduleMicrotask(() async {
        if (!mounted) return;
        try {
          await widget.controller.loadHistory(widget.session.id, silent: true);
        } catch (_) {
          if (mounted) {
            setState(
              () => _failure = copy(
                '无法刷新会话设置，请稍后重试。',
                'Could not refresh conversation settings. Please try again.',
              ),
            );
          }
        }
      });
    }
  }

  bool _applying = false;
  String? _failure;
  RelaySession get session =>
      widget.controller.sessions
          .where((item) => item.id == widget.session.id)
          .firstOrNull ??
      widget.session;
  bool get running => widget.controller.runningSessions.contains(session.id);

  String copy(String zh, String en) =>
      Localizations.localeOf(context).languageCode == 'zh' ? zh : en;

  List<Map<String, dynamic>> get options => widget.controller
      .sessionConfigOptions(session)
      .where(
        (item) => const {
          'model',
          'reasoning',
          'speed',
          'permissions',
        }.contains(item['id']),
      )
      .toList();

  String label(Map<String, dynamic> config) => switch (config['id']) {
    'model' => copy('模型', 'Model'),
    'reasoning' => copy('推理强度', 'Reasoning effort'),
    'speed' => copy('速度', 'Speed'),
    'permissions' => copy('权限', 'Permissions'),
    _ => '${config['name']}',
  };

  List<Map> values(Map config) =>
      (config['options'] as List? ?? const []).whereType<Map>().toList();

  bool localChoice(String id) =>
      (widget.controller.supportsMessageModelSettings(session) &&
          const {'model', 'reasoning'}.contains(id)) ||
      (widget.controller.supportsMessagePermissionSettings(session) &&
          id == 'permissions');

  Future<void> configure(String id, Object value) async {
    final local = localChoice(id);
    if ((!local && (_applying || running || !widget.controller.deviceOnline)) ||
        session.isSubagent ||
        widget.controller.activeSessionId != widget.session.id) {
      return;
    }
    if (id == 'permissions' && value == 'full') {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(copy('开启完全访问？', 'Enable full access?')),
          content: Text(
            copy(
              '取消沙箱限制并关闭审批提示，只作用于当前会话的后续消息。',
              'Disables sandbox restrictions and approval prompts for future messages in this conversation.',
            ),
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
      if (!mounted ||
          confirmed != true ||
          (!local && (running || !widget.controller.deviceOnline)) ||
          widget.controller.activeSessionId != widget.session.id) {
        return;
      }
    }
    if (local) {
      setState(() => _failure = null);
      await widget.controller.configureSession(id, value);
      return;
    }
    setState(() {
      _applying = true;
      _failure = null;
    });
    try {
      await widget.controller.configureSession(id, value);
      if (mounted && widget.controller.error.isNotEmpty) {
        setState(() => _failure = widget.controller.error);
      }
    } finally {
      if (mounted) setState(() => _applying = false);
    }
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.controller,
    builder: (context, _) {
      final configs = options;
      final busy =
          _applying ||
          widget.controller.configuringSessions.contains(session.id);
      final enabled =
          !busy &&
          !running &&
          widget.controller.deviceOnline &&
          widget.controller.activeSessionId == session.id;
      final provider = agentProviderDisplayName(session.provider);
      return SafeArea(
        top: false,
        child: SizedBox(
          key: const ValueKey('session-model-settings-panel'),
          height: MediaQuery.sizeOf(context).height * .6,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsetsDirectional.only(start: 20, end: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '$provider · ${context.l10n.workbenchSessionSettings}',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                    IconButton(
                      tooltip: context.l10n.commonClose,
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
                  children: [
                    if (_failure != null) ...[
                      Text(
                        _failure!,
                        style: const TextStyle(color: RelayTheme.ember),
                      ),
                      const SizedBox(height: 8),
                    ],
                    Text(
                      widget.controller.supportsMessagePermissionSettings(
                            session,
                          )
                          ? copy(
                              '模型、推理强度与权限将在下一条消息发送时应用。',
                              'Model, effort and permissions apply when you send your next message.',
                            )
                          : widget.controller.supportsMessageModelSettings(
                              session,
                            )
                          ? copy(
                              '模型与推理强度将在下一条消息发送时应用。',
                              'Model and effort apply when you send your next message.',
                            )
                          : !widget.controller.deviceOnline
                          ? context.l10n.workbenchSessionSettingsOffline
                          : running
                          ? context.l10n.workbenchSessionSettingsRunning
                          : busy
                          ? copy('正在应用设置…', 'Applying settings…')
                          : copy(
                              '对后续消息生效，保留当前会话。',
                              'Applies to future messages in this conversation.',
                            ),
                      style: const TextStyle(
                        color: RelayTheme.muted,
                        fontSize: 12,
                      ),
                    ),
                    if (configs.isEmpty)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        child: Text(
                          copy(
                            '暂未获取到模型选项，请刷新会话；若仍无选项，请更新电脑版。',
                            'Model choices are unavailable. Refresh the conversation or update the desktop app.',
                          ),
                        ),
                      ),
                    for (final config in configs) ...[
                      const SizedBox(height: 16),
                      Text(
                        label(config),
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 6),
                      if (config['id'] == 'permissions') ...[
                        Text(
                          (localChoice('permissions')
                                  ? copy(
                                      '下一条消息采用：',
                                      'Permissions for your next message: ',
                                    )
                                  : copy(
                                      '电脑端后续消息采用：',
                                      'Desktop permissions for future messages: ',
                                    )) +
                              _permissionLabel(context, config),
                        ),
                        if (config['description'] != null)
                          Text(
                            '${config['description']}',
                            style: const TextStyle(
                              color: RelayTheme.muted,
                              fontSize: 12,
                            ),
                          ),
                        const SizedBox(height: 6),
                      ],
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        children: [
                          for (final value in values(config))
                            ChoiceChip(
                              key: ValueKey(
                                'session-config-${config['id']}-${value['value']}',
                              ),
                              selected:
                                  value['value'] == config['currentValue'],
                              label: Text('${value['name'] ?? value['value']}'),
                              tooltip:
                                  '${value['description'] ?? value['value']}',
                              onSelected:
                                  (localChoice('${config['id']}')
                                          ? widget.controller.activeSessionId ==
                                                    session.id &&
                                                !session.isSubagent
                                          : enabled) &&
                                      value['value'] != config['currentValue']
                                  ? (_) => configure(
                                      '${config['id']}',
                                      value['value'] as Object,
                                    )
                                  : null,
                            ),
                        ],
                      ),
                    ],
                    if (session.provider == 'claude' && configs.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Text(
                        copy(
                          '电脑端重启后需重新选择 Claude Code 设置。',
                          'Choose Claude Code settings again after restarting the desktop relay.',
                        ),
                        style: const TextStyle(
                          color: RelayTheme.muted,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
}
