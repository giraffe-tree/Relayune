import 'dart:typed_data';

import 'crypto/e2ee.dart';

Map<String, dynamic> jsonMap(Object? value) =>
    Map<String, dynamic>.from(value as Map);

List<Map<String, dynamic>> jsonMapList(Object? value) =>
    (value as List? ?? const []).map(jsonMap).toList();

String agentProviderDisplayName(String provider) => switch (provider) {
  'codex' => 'Codex',
  'claude' => 'Claude Code',
  'claude-cowork' => 'Claude Cowork',
  'kimi' => 'Kimi Code',
  'opencode' => 'OpenCode',
  'mcode' => 'MiniMax Code',
  'zcode' => 'ZCode',
  'pi' => 'Pi',
  _ => provider.isEmpty ? 'Agent' : provider,
};

class RelayRelease {
  const RelayRelease({
    required this.locale,
    required this.version,
    required this.publishedAt,
    required this.title,
    required this.items,
    required this.platforms,
  });

  final String locale;
  final String version;
  final String publishedAt;
  final String title;
  final List<String> items;
  final List<String> platforms;

  factory RelayRelease.fromJson(Map<String, dynamic> json) => RelayRelease(
    locale: json['locale'] as String? ?? 'en',
    version: json['version'] as String? ?? '',
    publishedAt: json['publishedAt'] as String? ?? '',
    title: json['title'] as String? ?? '',
    items: (json['items'] as List? ?? const [])
        .whereType<String>()
        .where((item) => item.trim().isNotEmpty)
        .toList(growable: false),
    platforms: (json['platforms'] as List? ?? const [])
        .whereType<String>()
        .where((item) => item.trim().isNotEmpty)
        .toList(growable: false),
  );
}

class PairingPublicState {
  const PairingPublicState({
    required this.pairingId,
    required this.protocol,
    required this.mode,
    required this.initiatorShare,
    required this.status,
    required this.expiresAt,
    this.responderShare,
    this.responderConfirm,
    this.desktopConfirm,
    this.deviceId,
    this.browserId,
  });

  final String pairingId;
  final String protocol;
  final String mode;
  final String initiatorShare;
  final String? responderShare;
  final String? responderConfirm;
  final String? desktopConfirm;
  final String? deviceId;
  final String? browserId;
  final String status;
  final String expiresAt;

  factory PairingPublicState.fromJson(Map<String, dynamic> json) =>
      PairingPublicState(
        pairingId: json['pairing_id'] as String,
        protocol: json['protocol'] as String,
        mode: json['mode'] as String,
        initiatorShare: json['initiator_share'] as String,
        responderShare: json['responder_share'] as String?,
        responderConfirm: json['responder_confirm'] as String?,
        desktopConfirm: json['desktop_confirm'] as String?,
        deviceId: json['device_id'] as String?,
        browserId: json['browser_id'] as String?,
        status: json['status'] as String,
        expiresAt: json['expires_at'] as String,
      );
}

class PendingBrowserPairing {
  const PendingBrowserPairing({
    required this.pairingId,
    required this.deviceId,
    required this.deviceName,
    required this.expiresAt,
  });

  final String pairingId;
  final String deviceId;
  final String deviceName;
  final String expiresAt;

  factory PendingBrowserPairing.fromJson(Map<String, dynamic> json) =>
      PendingBrowserPairing(
        pairingId: json['pairing_id'] as String,
        deviceId: json['device_id'] as String,
        deviceName: json['device_name'] as String,
        expiresAt: json['expires_at'] as String,
      );
}

class PendingBrowserPairingDiscovery {
  const PendingBrowserPairingDiscovery({
    required this.hasBoundComputer,
    required this.pairings,
  });

  final bool hasBoundComputer;
  final List<PendingBrowserPairing> pairings;

  factory PendingBrowserPairingDiscovery.fromJson(Map<String, dynamic> json) =>
      PendingBrowserPairingDiscovery(
        hasBoundComputer: json['has_bound_computer'] as bool? ?? false,
        pairings: jsonMapList(
          json['pairings'],
        ).map(PendingBrowserPairing.fromJson).toList(growable: false),
      );
}

class OpaqueFrame {
  const OpaqueFrame({
    required this.deviceId,
    required this.sessionId,
    required this.requestId,
    required this.aad,
    required this.envelope,
    this.cursor,
    this.eventId,
    this.eventSeq,
    this.agentId,
    this.createdAt,
  });

  final int? cursor;
  final String? eventId;
  final int? eventSeq;
  final String deviceId;
  final String? sessionId;
  final String? agentId;
  final String? requestId;
  final String? createdAt;
  final RelayAad aad;
  final SealedEnvelope envelope;

  factory OpaqueFrame.fromJson(Map<String, dynamic> json) => OpaqueFrame(
    cursor: (json['cursor'] as num?)?.toInt(),
    eventId: json['event_id'] as String?,
    eventSeq: (json['event_seq'] as num?)?.toInt(),
    deviceId: json['device_id'] as String,
    sessionId: json['session_id'] as String?,
    agentId: json['agent_id'] as String?,
    requestId: json['request_id'] as String?,
    createdAt: json['created_at'] as String?,
    aad: RelayAad.fromJson(jsonMap(json['aad'])),
    envelope: SealedEnvelope.fromJson(jsonMap(json['envelope'])),
  );
}

class RelayAgentRuntimeInfo {
  const RelayAgentRuntimeInfo({
    required this.provider,
    this.version,
    this.status = 'unknown',
  });
  final String provider;
  final String? version;
  final String status;

  factory RelayAgentRuntimeInfo.fromJson(Map<String, dynamic> json) =>
      RelayAgentRuntimeInfo(
        provider: json['provider'] is String ? json['provider'] as String : '',
        version: json['version'] is String ? json['version'] as String : null,
        status: json['status'] is String ? json['status'] as String : 'unknown',
      );
}

class RelayDesktopInfo {
  const RelayDesktopInfo({
    this.version,
    this.platform,
    this.agents = const [],
    this.supportsDirectReads = false,
    this.supportsAutomaticRoute = false,
    this.supportsTrickleIce = false,
    this.supportsSessionDirectory = false,
    this.supportsDirectoryPush = false,
    this.supportsOnlineStream = false,
    this.supportsLocalWeb = false,
  });

  final bool supportsDirectReads;
  final bool supportsAutomaticRoute;
  final bool supportsTrickleIce;
  final bool supportsSessionDirectory;
  final bool supportsDirectoryPush;
  final bool supportsOnlineStream;
  final bool supportsLocalWeb;

  final List<RelayAgentRuntimeInfo> agents;

  final String? version;
  final String? platform;

  factory RelayDesktopInfo.fromJson(Map<String, dynamic> json) {
    final version = json['version'];
    return RelayDesktopInfo(
      supportsLocalWeb: json['local_web_version'] == 1,
      supportsSessionDirectory: json['session_directory_version'] == 1,
      supportsDirectoryPush: json['directory_push_version'] == 1,
      supportsOnlineStream:
          json['transports'] is List &&
          (json['transports'] as List).contains('online-stream-v1'),
      version: version is String && version.trim().isNotEmpty
          ? version.trim()
          : null,
      platform: json['platform'] is String ? json['platform'] as String : null,
      supportsTrickleIce:
          json['transports'] is List &&
          (json['transports'] as List).contains('webrtc-trickle-v1'),
      supportsAutomaticRoute:
          json['transports'] is List &&
          (json['transports'] as List).contains('webrtc-auto-v1'),
      supportsDirectReads:
          json['transports'] is List &&
          (json['transports'] as List).contains('webrtc-session-v2'),
      agents: jsonMapList(
        json['agents'],
      ).map(RelayAgentRuntimeInfo.fromJson).toList(),
    );
  }

  String? get platformLabel => switch (platform) {
    'darwin' => 'macOS',
    'win32' => 'Windows',
    'linux' => 'Linux',
    _ => null,
  };
}

class RelayDevice {
  const RelayDevice({
    required this.id,
    required this.name,
    required this.online,
    required this.agentConnected,
    required this.lastSeenAt,
  });

  final String id;
  final String name;
  final bool online;
  final bool agentConnected;
  final String? lastSeenAt;

  factory RelayDevice.fromJson(Map<String, dynamic> json) => RelayDevice(
    id: json['id'] as String? ?? '',
    name: json['name'] as String? ?? 'Relayune',
    online: json['online'] as bool? ?? false,
    agentConnected: json['codex_connected'] as bool? ?? false,
    lastSeenAt: json['last_seen_at'] as String?,
  );
}

class ServerBootstrap {
  const ServerBootstrap({
    required this.email,
    required this.device,
    required this.catalog,
    required this.events,
    required this.cursor,
    required this.ackSequence,
    required this.queuedCommands,
    this.onlineTransportVersion = 0,
    this.accountDisplayName,
  });

  // Historical property name; username mode stores immutable account_id.
  final String email;
  final String? accountDisplayName;
  final RelayDevice device;
  final OpaqueFrame? catalog;
  final List<OpaqueFrame> events;
  final int onlineTransportVersion;
  final int cursor;
  final int ackSequence;
  final int queuedCommands;

  factory ServerBootstrap.fromJson(Map<String, dynamic> json) =>
      ServerBootstrap(
        onlineTransportVersion: (json['online_transport_version'] as num? ?? 0)
            .toInt(),
        email:
            (jsonMap(json['user'])['auth_mode'] == 'username'
                    ? jsonMap(json['user'])['account_id']
                    : jsonMap(json['user'])['email'])
                as String,
        accountDisplayName:
            jsonMap(json['user'])['display_name'] as String? ??
            jsonMap(json['user'])['username'] as String?,
        device: RelayDevice.fromJson(jsonMap(json['device'])),
        catalog: json['catalog'] == null
            ? null
            : OpaqueFrame.fromJson(jsonMap(json['catalog'])),
        events: jsonMapList(json['events']).map(OpaqueFrame.fromJson).toList(),
        cursor: (json['cursor'] as num? ?? 0).toInt(),
        ackSequence: (json['ack_seq'] as num? ?? 0).toInt(),
        queuedCommands: (json['queued_commands'] as num? ?? 0).toInt(),
      );
}

class ProviderUsageSnapshot {
  const ProviderUsageSnapshot({
    required this.asOf,
    required this.daily,
    this.source,
    this.complete,
    this.quotaWindows = const [],
  });

  final String asOf;
  final List<ProviderDailyUsage> daily;
  final String? source;
  final bool? complete;
  final List<ProviderQuotaWindow> quotaWindows;

  factory ProviderUsageSnapshot.fromJson(Map<String, dynamic> json) =>
      ProviderUsageSnapshot(
        asOf: json['as_of'] as String? ?? '',
        daily: jsonMapList(
          json['daily'],
        ).map(ProviderDailyUsage.fromJson).toList(growable: false),
        source: json['source'] as String?,
        complete: json['complete'] as bool?,
        quotaWindows: jsonMapList(
          json['quota_windows'],
        ).map(ProviderQuotaWindow.fromJson).toList(growable: false),
      );
}

class ProviderQuotaWindow {
  const ProviderQuotaWindow({
    required this.id,
    this.usedPercent,
    this.resetsAt,
    this.asOf,
    this.status,
  });
  final String id;
  final double? usedPercent;
  final DateTime? resetsAt;
  final DateTime? asOf;
  final String? status;
  factory ProviderQuotaWindow.fromJson(Map<String, dynamic> json) {
    final value = json['used_percent'];
    return ProviderQuotaWindow(
      id: json['id'] as String? ?? '',
      usedPercent: value is num && value.isFinite && value >= 0
          ? value.toDouble().clamp(0, 100)
          : null,
      resetsAt: DateTime.tryParse(json['resets_at'] as String? ?? ''),
      asOf: DateTime.tryParse(json['as_of'] as String? ?? ''),
      status: json['status'] as String?,
    );
  }
}

class ProviderDailyUsage {
  const ProviderDailyUsage({required this.date, required this.totalTokens});

  final String date;
  final int totalTokens;

  factory ProviderDailyUsage.fromJson(Map<String, dynamic> json) =>
      ProviderDailyUsage(
        date: json['date'] as String? ?? '',
        totalTokens: (json['total_tokens'] as num? ?? -1).toInt(),
      );
}

class RelaySession {
  const RelaySession({
    required this.id,
    required this.name,
    required this.project,
    required this.branch,
    required this.cwd,
    required this.status,
    required this.updatedAt,
    required this.provider,
    required this.isSubagent,
    required this.rootSessionId,
    required this.supportsSteering,
    required this.canInterrupt,
    required this.raw,
  });

  final String id;
  final String name;
  final String project;
  final String branch;
  final String cwd;
  final String status;
  final String updatedAt;
  final String provider;
  final bool isSubagent;
  final String rootSessionId;
  final bool supportsSteering;
  bool get supportsInterruptAndSend =>
      provider == 'codex' || raw['supports_interrupt_and_send'] == true;
  final bool canInterrupt;
  String? get continueTurnId {
    final value = raw['continue_turn_id'];
    return value is String && value.trim().isNotEmpty ? value : null;
  }

  bool get supportsContinue {
    final capabilities = raw['capabilities'];
    return provider == 'codex' &&
        !isSubagent &&
        capabilities is Map &&
        capabilities['continue_supported'] == true;
  }

  String? get forkMode => const {'turn', 'latest'}.contains(raw['fork_mode'])
      ? raw['fork_mode'] as String
      : null;
  bool get supportsForkWorktree => raw['supports_fork_worktree'] == true;
  final Map<String, dynamic> raw;

  factory RelaySession.fromJson(Map<String, dynamic> json) => RelaySession(
    id: json['id'] as String,
    name: json['name'] as String? ?? '未命名会话',
    project: json['project'] as String? ?? '',
    branch: json['branch'] as String? ?? '',
    cwd: json['cwd'] as String? ?? '',
    status: json['status'] as String? ?? 'idle',
    updatedAt: json['updated_at'] as String? ?? '',
    provider: json['provider'] as String? ?? 'codex',
    isSubagent: json['is_subagent'] as bool? ?? false,
    rootSessionId: json['root_session_id'] as String? ?? json['id'] as String,
    supportsSteering:
        json['supports_steering'] as bool? ?? json['provider'] == 'codex',
    canInterrupt: json['can_interrupt'] as bool? ?? true,
    raw: json,
  );
}

class RelayProject {
  const RelayProject({
    required this.id,
    required this.name,
    required this.cwd,
    required this.updatedAt,
    required this.provider,
  });

  final String id;
  final String name;
  final String cwd;
  final String updatedAt;
  final String provider;

  factory RelayProject.fromJson(Map<String, dynamic> json) => RelayProject(
    id: json['id'] as String,
    name: json['name'] as String? ?? '',
    cwd: json['cwd'] as String? ?? '',
    updatedAt: json['updated_at'] as String? ?? '',
    provider: json['provider'] as String? ?? 'codex',
  );

  RelaySession asSessionTarget() => RelaySession.fromJson({
    'id': 'project:$provider:$id',
    'name': name,
    'project': name,
    'cwd': cwd,
    'updated_at': updatedAt,
    'provider': provider,
  });
}

enum MessageDeliveryState { sent, sending, failed, unconfirmed }

class RelayMessage {
  const RelayMessage({
    required this.id,
    required this.role,
    required this.content,
    required this.createdAt,
    required this.kind,
    this.turnId,
    this.messagePhase,
    this.turnStatus,
    this.clientMessageId,
    this.deliveryState = MessageDeliveryState.sent,
    this.attachments = const [],
    this.toolActivityLabel,
    this.toolActivityDetail,
    this.toolActivityStatus,
    this.toolActivityType,
    this.toolActivityName,
    this.toolActivitySubject,
    this.toolActivityCommand,
    this.toolActivityCount,
    this.sourceSequence = 0,
  });

  final String id;
  final String role;
  final String content;
  final String createdAt;
  final String kind;
  final String? turnId;
  final String? messagePhase;
  final String? turnStatus;
  final String? clientMessageId;
  final MessageDeliveryState deliveryState;
  final List<RelayAttachment> attachments;
  final String? toolActivityLabel;
  final String? toolActivityDetail;
  final String? toolActivityStatus;
  final String? toolActivityType;
  final String? toolActivityName;
  final String? toolActivitySubject;
  final String? toolActivityCommand;
  final int? toolActivityCount;
  final int sourceSequence;

  factory RelayMessage.fromHistory(Map<String, dynamic> json) => RelayMessage(
    id: json['id'] as String,
    role: json['role'] as String? ?? 'system',
    content: json['content'] as String? ?? '',
    createdAt: json['created_at'] as String? ?? '',
    turnId: json['turn_id'] as String?,
    messagePhase: json['message_phase'] as String?,
    turnStatus: json['turn_status'] as String?,
    clientMessageId: json['client_message_id'] as String?,
    kind: json['kind'] as String? ?? 'message',
    attachments: jsonMapList(
      json['attachments'],
    ).map(RelayAttachment.fromJson).toList(),
    toolActivityLabel: _historyToolActivityText(
      json['tool_activity_label'],
      command: json['tool_activity_type'] == 'command',
    ),
    toolActivityDetail: json['tool_activity_detail'] as String?,
    toolActivityStatus: json['tool_activity_status'] as String?,
    toolActivityType: json['tool_activity_type'] as String?,
    toolActivityName: json['tool_activity_name'] as String?,
    toolActivitySubject: json['tool_activity_subject'] as String?,
    toolActivityCommand: _historyToolActivityCommand(json),
    toolActivityCount: (json['tool_activity_count'] as num?)?.toInt(),
    sourceSequence: (json['source_sequence'] as num?)?.toInt() ?? 0,
  );

  RelayMessage copyWith({
    String? content,
    String? turnId,
    String? messagePhase,
    String? turnStatus,
    MessageDeliveryState? deliveryState,
    List<RelayAttachment>? attachments,
    String? toolActivityLabel,
    String? toolActivityDetail,
    String? toolActivityStatus,
    String? toolActivityType,
    String? toolActivityName,
    String? toolActivitySubject,
    String? toolActivityCommand,
    int? toolActivityCount,
    int? sourceSequence,
  }) => RelayMessage(
    id: id,
    role: role,
    content: content ?? this.content,
    createdAt: createdAt,
    kind: kind,
    turnId: turnId ?? this.turnId,
    messagePhase: messagePhase ?? this.messagePhase,
    turnStatus: turnStatus ?? this.turnStatus,
    clientMessageId: clientMessageId,
    deliveryState: deliveryState ?? this.deliveryState,
    attachments: attachments ?? this.attachments,
    toolActivityLabel: toolActivityLabel ?? this.toolActivityLabel,
    toolActivityDetail: toolActivityDetail ?? this.toolActivityDetail,
    toolActivityStatus: toolActivityStatus ?? this.toolActivityStatus,
    toolActivityType: toolActivityType ?? this.toolActivityType,
    toolActivityName: toolActivityName ?? this.toolActivityName,
    toolActivitySubject: toolActivitySubject ?? this.toolActivitySubject,
    toolActivityCommand: toolActivityCommand ?? this.toolActivityCommand,
    toolActivityCount: toolActivityCount ?? this.toolActivityCount,
    sourceSequence: sourceSequence ?? this.sourceSequence,
  );
}

String? _historyToolActivityCommand(Map<String, dynamic> json) {
  final command = _historyToolActivityText(
    json['tool_activity_command'],
    command: true,
  );
  if (command != null) return command;
  if (json['tool_activity_type'] != 'command') return null;
  final legacyLabel = _historyToolActivityText(
    json['tool_activity_label'],
    command: true,
  );
  if (legacyLabel == null) return null;
  return const {'执行命令', 'Run command'}.contains(legacyLabel.trim())
      ? null
      : legacyLabel;
}

String? _historyToolActivityText(Object? value, {bool command = false}) {
  Object? textValue = value;
  if (command && value is List) {
    final parts = value.map((part) => part.toString()).toList(growable: false);
    final shellFlagIndex = parts.indexWhere(
      (part) => part == '-c' || part == '-lc',
    );
    textValue = shellFlagIndex >= 0 && shellFlagIndex < parts.length - 1
        ? parts[shellFlagIndex + 1]
        : parts.join(' ');
  }
  final text =
      textValue?.toString().replaceAll(RegExp(r'\s+'), ' ').trim() ?? '';
  if (text.isEmpty) return null;
  return text.length <= 2000 ? text : '${text.substring(0, 1999)}…';
}

enum RelayAttachmentVariant { original, preview }

class RelayAttachment {
  const RelayAttachment({
    required this.id,
    required this.type,
    required this.name,
    required this.mimeType,
    required this.url,
    this.previewSupported = false,
    this.localBytes,
    this.thumbnailBytes,
  });

  final String id;
  final String type;
  final String name;
  final String mimeType;
  final String url;
  final bool previewSupported;
  final Uint8List? localBytes;
  final Uint8List? thumbnailBytes;

  bool get isImage =>
      type == 'image' && mimeType.toLowerCase().startsWith('image/');

  factory RelayAttachment.fromJson(Map<String, dynamic> json) =>
      RelayAttachment(
        id: json['id'] as String,
        type: json['type'] as String? ?? 'image',
        name: json['name'] as String? ?? '附件',
        mimeType: json['mime_type'] as String? ?? 'application/octet-stream',
        url: json['url'] as String? ?? '',
        previewSupported: json['preview_supported'] as bool? ?? false,
      );
}

class UploadAttachment {
  const UploadAttachment({
    required this.id,
    required this.name,
    required this.mimeType,
    required this.bytes,
    this.thumbnailBytes,
    this.detail = 'auto',
  });

  final String id;
  final String name;
  final String mimeType;
  final Uint8List bytes;
  final Uint8List? thumbnailBytes;
  final String detail;
}

class RelayApproval {
  const RelayApproval({
    required this.id,
    required this.sessionId,
    required this.action,
    required this.riskLevel,
    required this.state,
    required this.requestedAt,
    required this.expiresAt,
    this.targetSessionId,
    this.turnId,
    this.sourceAgentName,
    this.sourceThreadId,
    this.sourceAgentId,
  });

  final String id;
  final String sessionId;
  // Routing/display use the root; the signed approval targets its native session.
  final String? targetSessionId;
  final String? turnId;
  final Map<String, dynamic> action;
  final String riskLevel;
  final String state;
  final String requestedAt;
  final String expiresAt;
  final String? sourceAgentName;
  final String? sourceThreadId;
  final String? sourceAgentId;

  RelayApproval copyWith({String? state}) => RelayApproval(
    id: id,
    sessionId: sessionId,
    targetSessionId: targetSessionId,
    turnId: turnId,
    action: action,
    riskLevel: riskLevel,
    state: state ?? this.state,
    requestedAt: requestedAt,
    expiresAt: expiresAt,
    sourceAgentName: sourceAgentName,
    sourceThreadId: sourceThreadId,
    sourceAgentId: sourceAgentId,
  );
}

class RelayAgent {
  const RelayAgent({
    required this.id,
    required this.threadId,
    required this.parentSessionId,
    required this.name,
    required this.task,
    required this.status,
    required this.progress,
    this.role,
    this.nickname,
    this.parentThreadId,
    this.summary,
    this.activity,
    this.updatedAt,
    this.model,
    this.reasoningEffort,
    this.tool,
    this.toolCount,
    this.tokenCount,
    this.contextTokens,
    this.permissionMode,
    this.swarmMode,
    this.activityLog = const [],
    this.canOpen = true,
    this.startedAt,
  });

  final String id;
  final String threadId;
  final String parentSessionId;
  final String name;
  final String? role;
  final String? nickname;
  final String? parentThreadId;
  final String task;
  final String status;
  final int progress;
  final String? summary;
  final String? activity;
  final String? updatedAt;
  final String? model;
  final String? reasoningEffort;
  final String? tool;
  final int? toolCount;
  final int? tokenCount;
  final int? contextTokens;
  final String? permissionMode;
  final bool? swarmMode;
  final List<RelayAgentActivity> activityLog;
  final bool canOpen;
  final String? startedAt;

  bool get isActive => const {'pendingInit', 'running'}.contains(status);

  factory RelayAgent.fromJson(Map<String, dynamic> json) => RelayAgent(
    id: json['id'] as String,
    threadId: json['thread_id'] as String? ?? json['id'] as String,
    parentSessionId: json['parent_session_id'] as String? ?? '',
    name: json['name'] as String? ?? 'Agent',
    role: json['role'] as String?,
    nickname: json['nickname'] as String?,
    parentThreadId: json['parent_thread_id'] as String?,
    task: json['task'] as String? ?? '',
    status: json['status'] as String? ?? 'unknown',
    progress: (json['progress'] as num? ?? 0).toInt(),
    summary: json['summary'] as String?,
    activity: json['current_activity'] as String?,
    updatedAt: json['updated_at'] as String?,
    model: json['model'] as String?,
    reasoningEffort: json['reasoning_effort'] as String?,
    tool: json['tool'] as String?,
    toolCount: (json['tool_count'] as num?)?.toInt(),
    tokenCount: (json['token_count'] as num?)?.toInt(),
    contextTokens: (json['context_tokens'] as num?)?.toInt(),
    permissionMode: json['permission_mode'] as String?,
    swarmMode: json['swarm_mode'] as bool?,
    activityLog: jsonMapList(
      json['activity_log'],
    ).map(RelayAgentActivity.fromJson).toList(growable: false),
    canOpen: json['can_open'] as bool? ?? true,
    startedAt: json['started_at'] as String?,
  );

  RelayAgent retainingDetails(RelayAgent? previous) => RelayAgent(
    id: id,
    threadId: threadId,
    parentSessionId: parentSessionId,
    name: name,
    task: task,
    status: status,
    progress: progress,
    canOpen: canOpen,
    parentThreadId: parentThreadId ?? previous?.parentThreadId,
    role: role ?? previous?.role,
    nickname: nickname ?? previous?.nickname,
    summary: summary ?? previous?.summary,
    activity: activity ?? previous?.activity,
    updatedAt: updatedAt ?? previous?.updatedAt,
    startedAt: startedAt ?? previous?.startedAt,
    model: model ?? previous?.model,
    reasoningEffort: reasoningEffort ?? previous?.reasoningEffort,
    tool: tool ?? previous?.tool,
    toolCount: toolCount ?? previous?.toolCount,
    tokenCount: tokenCount ?? previous?.tokenCount,
    contextTokens: contextTokens ?? previous?.contextTokens,
    permissionMode: permissionMode ?? previous?.permissionMode,
    swarmMode: swarmMode ?? previous?.swarmMode,
    activityLog: activityLog.isNotEmpty
        ? activityLog
        : previous?.activityLog ?? const [],
  );

  RelayAgent copyWith({
    String? status,
    int? progress,
    String? summary,
    String? activity,
    String? updatedAt,
  }) => RelayAgent(
    id: id,
    threadId: threadId,
    parentSessionId: parentSessionId,
    name: name,
    role: role,
    nickname: nickname,
    parentThreadId: parentThreadId,
    task: task,
    status: status ?? this.status,
    progress: progress ?? this.progress,
    summary: summary ?? this.summary,
    activity: activity ?? this.activity,
    updatedAt: updatedAt ?? this.updatedAt,
    model: model,
    reasoningEffort: reasoningEffort,
    tool: tool,
    toolCount: toolCount,
    tokenCount: tokenCount,
    contextTokens: contextTokens,
    permissionMode: permissionMode,
    swarmMode: swarmMode,
    activityLog: activityLog,
    canOpen: canOpen,
    startedAt: startedAt,
  );
}

class RelayAgentActivity {
  const RelayAgentActivity({
    required this.id,
    required this.kind,
    required this.label,
    required this.occurredAt,
    this.code,
    this.completed,
    this.total,
  });

  final String id;
  final String kind;
  final String? code;
  final String label;
  final int? completed;
  final int? total;
  final String occurredAt;

  factory RelayAgentActivity.fromJson(Map<String, dynamic> json) =>
      RelayAgentActivity(
        id: json['id'] as String? ?? '',
        kind: json['kind'] as String? ?? 'status',
        code: json['code'] as String?,
        label: json['label'] as String? ?? '',
        completed: (json['completed'] as num?)?.toInt(),
        total: (json['total'] as num?)?.toInt(),
        occurredAt: json['occurred_at'] as String? ?? '',
      );
}

class RelayEvent {
  const RelayEvent({
    required this.cursor,
    required this.eventId,
    required this.sessionId,
    required this.agentId,
    required this.createdAt,
    required this.event,
    this.sourceSequence = 0,
  });

  final int cursor;
  final String eventId;
  final String sessionId;
  final String? agentId;
  final String createdAt;
  final Map<String, dynamic> event;
  final int sourceSequence;
}

class HistoryPage {
  const HistoryPage({
    required this.messages,
    required this.nextCursor,
    required this.hasMore,
    required this.agents,
    required this.sessions,
  });

  final List<RelayMessage> messages;
  final String? nextCursor;
  final bool hasMore;
  final List<RelayAgent> agents;
  final List<RelaySession> sessions;

  factory HistoryPage.fromJson(Map<String, dynamic> json) {
    final messages = jsonMapList(
      json['messages'],
    ).map(RelayMessage.fromHistory).toList();
    final metadata = json['metadata_attachment'];
    if (messages.isEmpty && metadata is Map<String, dynamic>) {
      final attachment = RelayAttachment.fromJson(metadata);
      messages.add(
        RelayMessage(
          id: 'metadata:${attachment.id}',
          role: 'system',
          content: '',
          createdAt: '',
          kind: 'session_metadata',
          attachments: [attachment],
        ),
      );
    }
    return HistoryPage(
      messages: messages,
      nextCursor: json['next_cursor'] as String?,
      hasMore: json['has_more'] as bool? ?? false,
      agents: jsonMapList(json['agents']).map(RelayAgent.fromJson).toList(),
      sessions: jsonMapList(
        json['sessions'],
      ).map(RelaySession.fromJson).toList(),
    );
  }
}
