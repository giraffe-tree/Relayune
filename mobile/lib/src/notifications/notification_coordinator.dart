import 'dart:async';
import 'dart:convert';

import 'package:flutter/widgets.dart';

import '../../l10n/relayune_localizations.dart';
import '../models.dart';
import 'live_task_coordinator.dart';

enum RelayNotificationTarget { conversation, agents }

enum RelayNotificationAuthorization { unknown, enabled, disabled }

enum RelayNotificationKind { approval, question, completion }

enum RelayNotificationAction { approveOnce, reject, answer }

const relayNotificationApproveActionId = 'relayune.approval.approve_once';
const relayNotificationRejectActionId = 'relayune.approval.reject';
const relayNotificationAnswerActionId = 'relayune.question.answer';

typedef RelayNotificationResponseCallback =
    void Function(String payload, String? actionId);

class RelayNotificationOpenRequest {
  const RelayNotificationOpenRequest({
    required this.sessionId,
    required this.target,
    this.approvalId,
  });

  final String sessionId;
  final RelayNotificationTarget target;
  final String? approvalId;
}

class RelayNotificationActionRequest {
  const RelayNotificationActionRequest({
    required this.sessionId,
    required this.approvalId,
    required this.action,
  });

  final String sessionId;
  final String approvalId;
  final RelayNotificationAction action;
}

class RelayLocalNotification {
  const RelayLocalNotification({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.body,
    required this.sessionId,
    required this.target,
    required this.kind,
    required this.actions,
    required this.urgent,
    this.approvalId,
  });

  final int id;
  final String title;
  final String subtitle;
  final String body;
  final String sessionId;
  final RelayNotificationTarget target;
  final RelayNotificationKind kind;
  final List<RelayNotificationAction> actions;
  final bool urgent;
  final String? approvalId;

  String get payload => jsonEncode({
    'session_id': sessionId,
    'target': target.name,
    'kind': kind.name,
    if (approvalId != null) 'approval_id': approvalId,
  });
}

abstract class RelayNotificationGateway {
  /// Returns the notification payload that launched the app, if any.
  Future<String?> initialize({
    required RelayNotificationResponseCallback onResponse,
  });

  Future<bool> requestAuthorization();

  Future<bool?> authorizationEnabled();

  Future<void> openSettings();

  Future<void> show(RelayLocalNotification notification);

  Future<void> cancel(int notificationId);
}

abstract interface class RelayNotificationLocaleGateway {
  Future<void> setLocale(Locale locale);
}

abstract class RelayEventNotificationSink {
  void handleDecryptedEvent(RelayEvent record, {bool isRootSession = true});
}

abstract class RelayNotificationManager {
  RelayNotificationAuthorization get authorization;

  void setLocale(Locale locale);

  Future<RelayNotificationAuthorization> refreshAuthorization();

  Future<RelayNotificationAuthorization> requestAuthorization();

  Future<void> openSettings();
}

class NoopRelayEventNotificationSink implements RelayEventNotificationSink {
  const NoopRelayEventNotificationSink();

  @override
  void handleDecryptedEvent(RelayEvent record, {bool isRootSession = true}) {}
}

/// Converts selected, already-decrypted relay events into device-local alerts.
///
/// No event body, command, path, key, or credential is passed to a remote push
/// provider. Notification text is intentionally generic because the operating
/// system may display it on the lock screen.
class RelayNotificationCoordinator
    implements RelayEventNotificationSink, RelayNotificationManager {
  RelayNotificationCoordinator({
    required RelayNotificationGateway gateway,
    this.liveTasks,
    Locale locale = const Locale('zh', 'CN'),
    DateTime Function()? now,
    this.maximumEventAge = const Duration(minutes: 5),
    this.minimumApprovalTimeRemaining = const Duration(seconds: 15),
  }) : _gateway = gateway,
       _l10n = relayuneLocalizationsFor(locale),
       _now = now ?? DateTime.now;

  final RelayNotificationGateway _gateway;
  final LiveTaskCoordinator? liveTasks;
  AppLocalizations _l10n;
  final DateTime Function() _now;
  final Duration maximumEventAge;
  final Duration minimumApprovalTimeRemaining;
  final Set<String> _handledEventIds = {};
  final Map<String, Timer> _approvalExpiryTimers = {};
  final Map<String, String> _completedMessagePreviews = {};
  final List<({RelayEvent event, bool isRootSession})> _startupEvents = [];

  bool _initialized = false;
  bool _initializationFinished = false;
  bool _disposed = false;
  bool _foreground = true;
  // Enabled only after the authenticated server accepted an Android binding.
  bool remoteBackgroundDeliveryActive = false;
  String? _activeSessionId;
  RelayNotificationOpenRequest? _pendingOpenRequest;
  RelayNotificationActionRequest? _pendingActionRequest;
  void Function(RelayNotificationOpenRequest request)? _onOpenRequest;
  void Function(RelayNotificationActionRequest request)? _onActionRequest;
  Map<String, RelaySession> _sessionsById = const {};

  @override
  RelayNotificationAuthorization authorization =
      RelayNotificationAuthorization.unknown;

  bool get initialized => _initialized;

  @override
  void setLocale(Locale locale) {
    _l10n = relayuneLocalizationsFor(locale);
    final gateway = _gateway;
    if (gateway is RelayNotificationLocaleGateway) {
      unawaited((gateway as RelayNotificationLocaleGateway).setLocale(locale));
    }
  }

  set onOpenRequest(
    void Function(RelayNotificationOpenRequest request)? callback,
  ) {
    _onOpenRequest = callback;
    final pending = _pendingOpenRequest;
    if (callback != null && pending != null) {
      _pendingOpenRequest = null;
      callback(pending);
    }
  }

  set onActionRequest(
    void Function(RelayNotificationActionRequest request)? callback,
  ) {
    _onActionRequest = callback;
    final pending = _pendingActionRequest;
    if (callback != null && pending != null) {
      _pendingActionRequest = null;
      callback(pending);
    }
  }

  void setSessionCatalog(Iterable<RelaySession> sessions) {
    _sessionsById = {for (final session in sessions) session.id: session};
  }

  Future<void> initialize() async {
    if (_initialized || _disposed) return;
    try {
      final payload = await _gateway.initialize(onResponse: _handleResponse);
      if (_disposed) return;
      _initialized = true;
      for (final pending in _startupEvents) {
        handleDecryptedEvent(
          pending.event,
          isRootSession: pending.isRootSession,
        );
      }
      _startupEvents.clear();
      await refreshAuthorization();
      if (_disposed) return;
      if (payload != null && payload.isNotEmpty) _handleResponse(payload, null);
    } catch (_) {
      // Notifications are additive. A platform plugin failure must never stop
      // the encrypted relay, authentication, or pairing flows from starting.
    } finally {
      _initializationFinished = true;
      _startupEvents.clear();
    }
  }

  @override
  Future<RelayNotificationAuthorization> requestAuthorization() async {
    if (!_initialized) return authorization;
    try {
      final enabled = await _gateway.requestAuthorization();
      authorization = enabled
          ? RelayNotificationAuthorization.enabled
          : RelayNotificationAuthorization.disabled;
    } catch (_) {
      authorization = RelayNotificationAuthorization.disabled;
    }
    return authorization;
  }

  @override
  Future<RelayNotificationAuthorization> refreshAuthorization() async {
    if (!_initialized) return authorization;
    try {
      final enabled = await _gateway.authorizationEnabled();
      authorization = switch (enabled) {
        true => RelayNotificationAuthorization.enabled,
        false => RelayNotificationAuthorization.disabled,
        null => RelayNotificationAuthorization.unknown,
      };
    } catch (_) {
      authorization = RelayNotificationAuthorization.unknown;
    }
    return authorization;
  }

  @override
  Future<void> openSettings() => _gateway.openSettings();

  void setForeground(bool foreground) {
    _foreground = foreground;
    liveTasks?.setForeground(foreground);
  }

  void setActiveSession(String? sessionId) => _activeSessionId = sessionId;

  @override
  void handleDecryptedEvent(RelayEvent record, {bool isRootSession = true}) {
    if (_disposed) return;
    if (!_initialized) {
      if (!_initializationFinished) {
        // Account restoration can finish before the optional native plugin.
        // Bound this in-memory backlog just like the handled-event history.
        if (_startupEvents.length == 4096) _startupEvents.removeAt(0);
        _startupEvents.add((event: record, isRootSession: isRootSession));
      }
      return;
    }
    if (!_handledEventIds.add(record.eventId)) return;
    if (_handledEventIds.length > 4096) {
      _handledEventIds.remove(_handledEventIds.first);
    }

    liveTasks?.handleEvent(record, isRootSession: isRootSession);
    final event = record.event;
    final kind = event['kind'] as String? ?? '';
    if (kind == 'message.completed') {
      _rememberCompletedMessage(record);
      return;
    }
    if (kind == 'turn.completed' && !isRootSession) {
      _takeCompletedMessagePreview(record);
    }
    if (event['kind'] == 'approval.resolved') {
      final approvalId = event['approval_id'];
      if (approvalId is String && approvalId.isNotEmpty) {
        _cancelApprovalNotification(approvalId);
      }
      return;
    }

    final definition = _definitionFor(record, isRootSession: isRootSession);
    if (definition == null) return;
    final createdAt = DateTime.tryParse(record.createdAt);
    if (createdAt != null &&
        _now().toUtc().difference(createdAt.toUtc()) > maximumEventAge) {
      return;
    }
    if (_foreground && _activeSessionId == definition.sessionId) return;
    if (!_foreground && remoteBackgroundDeliveryActive) return;

    if (definition.approvalId case final approvalId?) {
      final expiresAt = definition.expiresAt;
      if (expiresAt == null) return;
      _scheduleApprovalExpiry(approvalId, expiresAt);
    }

    unawaited(
      _gateway
          .show(
            RelayLocalNotification(
              id: definition.notificationId,
              title: definition.title,
              subtitle: definition.subtitle,
              body: definition.body,
              sessionId: definition.sessionId,
              target: definition.target,
              kind: definition.kind,
              actions: definition.actions,
              urgent: definition.urgent,
              approvalId: definition.approvalId,
            ),
          )
          .catchError((_) {}),
    );
  }

  _NotificationDefinition? _definitionFor(
    RelayEvent record, {
    required bool isRootSession,
  }) {
    final event = record.event;
    final kind = event['kind'] as String? ?? '';
    final rootSessionId = event['root_session_id'] as String?;
    final sessionId = rootSessionId?.isNotEmpty == true
        ? rootSessionId!
        : record.sessionId;
    return switch (kind) {
      'approval.requested' => _approvalDefinition(event, sessionId),
      'turn.completed' when isRootSession => _completedTurnDefinition(
        event,
        record,
        sessionId,
      ),
      _ => null,
    };
  }

  _NotificationDefinition? _approvalDefinition(
    Map<String, dynamic> event,
    String sessionId,
  ) {
    final approvalId = event['approval_id'];
    final expiresAt = DateTime.tryParse(event['expires_at'] as String? ?? '');
    if (approvalId is! String || approvalId.isEmpty || expiresAt == null) {
      return null;
    }
    if (expiresAt.toUtc().difference(_now().toUtc()) <
        minimumApprovalTimeRemaining) {
      return null;
    }
    final action = event['action'];
    final question = action is Map && action['type'] == 'question.select';
    final provider = _providerLabel(
      _sessionsById[sessionId]?.provider ?? event['provider'] as String?,
    );
    final remaining = expiresAt.toUtc().difference(_now().toUtc());
    final remainingMinutes = remaining.inMinutes.clamp(1, 99);
    return _NotificationDefinition(
      notificationId: _approvalNotificationId(approvalId),
      title: question
          ? _l10n.notificationQuestionTitle
          : _l10n.notificationApprovalTitle,
      subtitle: _l10n.notificationTaskPaused(provider),
      body: question
          ? _l10n.notificationQuestionBody(remainingMinutes)
          : _l10n.notificationApprovalBody(remainingMinutes),
      sessionId: sessionId,
      target: RelayNotificationTarget.conversation,
      kind: question
          ? RelayNotificationKind.question
          : RelayNotificationKind.approval,
      actions: _approvalActions(event, question: question),
      urgent: true,
      approvalId: approvalId,
      expiresAt: expiresAt,
    );
  }

  _NotificationDefinition? _completedTurnDefinition(
    Map<String, dynamic> event,
    RelayEvent record,
    String sessionId,
  ) {
    final status = (event['status'] as String? ?? '').toLowerCase();
    final preview = _takeCompletedMessagePreview(record);
    if (const {
      'aborted',
      'cancelled',
      'canceled',
      'declined',
      'interrupted',
    }.contains(status)) {
      return null;
    }
    final turnId = event['turn_id'];
    final notificationKey = turnId is String && turnId.isNotEmpty
        ? turnId
        : record.eventId;
    final session = _sessionsById[sessionId];
    final provider = _providerLabel(
      session?.provider ?? event['provider'] as String?,
    );
    final sessionName = _safeSessionName(session?.name);
    return _NotificationDefinition(
      notificationId: stableNotificationId('turn:$notificationKey:completed'),
      title: _l10n.notificationTaskCompleted(provider),
      subtitle: sessionName ?? _l10n.notificationMainTask,
      body: sessionName == null
          ? preview ?? _l10n.notificationMainResultReady
          : preview ?? _l10n.notificationNamedResultReady(sessionName),
      sessionId: sessionId,
      target: RelayNotificationTarget.conversation,
      kind: RelayNotificationKind.completion,
      actions: const [],
      urgent: false,
    );
  }

  List<RelayNotificationAction> _approvalActions(
    Map<String, dynamic> event, {
    required bool question,
  }) {
    if (question) return const [RelayNotificationAction.answer];
    final action = event['action'];
    final options = action is Map && action['options'] is List
        ? (action['options'] as List).whereType<Map>()
        : const Iterable<Map>.empty();
    final hasOptions = options.isNotEmpty;
    final kinds = options
        .map((option) => option['kind'])
        .whereType<String>()
        .toSet();
    final lowEnoughRisk = event['risk_level'] != 'high';
    return [
      if (lowEnoughRisk && (!hasOptions || kinds.contains('allow_once')))
        RelayNotificationAction.approveOnce,
      if (!hasOptions || kinds.contains('reject_once'))
        RelayNotificationAction.reject,
    ];
  }

  String _providerLabel(String? provider) => switch (provider) {
    'kimi' => 'Kimi',
    'claude' => 'Claude',
    'mcode' => 'MiniMax Code',
    'zcode' => 'ZCode',
    'opencode' => 'OpenCode',
    'claude-cowork' => 'Claude Cowork',
    _ => 'Codex',
  };

  String? _safeSessionName(String? value) {
    final normalized = value?.replaceAll(RegExp(r'\s+'), ' ').trim() ?? '';
    if (normalized.isEmpty || normalized == '未命名会话') return null;
    return normalized.length <= 42
        ? normalized
        : '${normalized.substring(0, 41)}…';
  }

  void _rememberCompletedMessage(RelayEvent record) {
    final preview = _safeMessagePreview(record.event['text'] as String?);
    if (preview == null) return;
    _completedMessagePreviews[_completionKey(record)] = preview;
    while (_completedMessagePreviews.length > 256) {
      _completedMessagePreviews.remove(_completedMessagePreviews.keys.first);
    }
  }

  String? _takeCompletedMessagePreview(RelayEvent record) =>
      _completedMessagePreviews.remove(_completionKey(record));

  String _completionKey(RelayEvent record) {
    final turnId = record.event['turn_id'] as String? ?? record.eventId;
    return '${record.sessionId}\u0000$turnId';
  }

  String? _safeMessagePreview(String? value) {
    if (value == null || value.trim().isEmpty) return null;
    var cleaned = value
        .replaceAll(RegExp(r'```[\s\S]*?```'), ' ')
        .replaceAll(RegExp(r'<[^>]+>'), ' ')
        .replaceAllMapped(
          RegExp(r'\[([^\]]+)\]\([^\)]+\)'),
          (match) => match.group(1) ?? '',
        )
        .replaceAll(RegExp(r'https?://\S+'), _l10n.notificationRedactedLink)
        .replaceAll(
          RegExp(r'/(?:Users|home|private|var|tmp)/\S+'),
          _l10n.notificationRedactedPath,
        )
        .replaceAll(
          RegExp(r'(?:bearer\s+|sk-)[a-z0-9._-]{8,}', caseSensitive: false),
          _l10n.notificationRedactedSecret,
        )
        .replaceAll(RegExp(r'\b\d{8}\b'), '••••••••');
    final paragraphs = cleaned
        .split(RegExp(r'\n\s*\n'))
        .map((paragraph) => paragraph.replaceAll(RegExp(r'\s+'), ' ').trim())
        .where((paragraph) => paragraph.isNotEmpty);
    if (paragraphs.isEmpty) return null;
    cleaned = paragraphs.first.replaceFirst(RegExp(r'^[#>*_~\-\s]+'), '');
    if (cleaned.isEmpty) return null;
    const maximumCharacters = 96;
    final characters = cleaned.characters;
    return characters.length <= maximumCharacters
        ? cleaned
        : '${characters.take(maximumCharacters)}…';
  }

  void _scheduleApprovalExpiry(String approvalId, DateTime expiresAt) {
    _approvalExpiryTimers.remove(approvalId)?.cancel();
    final delay = expiresAt.toUtc().difference(_now().toUtc());
    if (delay <= Duration.zero) {
      _cancelApprovalNotification(approvalId);
      return;
    }
    _approvalExpiryTimers[approvalId] = Timer(
      delay,
      () => _cancelApprovalNotification(approvalId),
    );
  }

  void _cancelApprovalNotification(String approvalId) {
    _approvalExpiryTimers.remove(approvalId)?.cancel();
    unawaited(
      _gateway.cancel(_approvalNotificationId(approvalId)).catchError((_) {}),
    );
  }

  int _approvalNotificationId(String approvalId) =>
      stableNotificationId('approval:$approvalId');

  void dispose() {
    _disposed = true;
    liveTasks?.dispose();
    _startupEvents.clear();
    for (final timer in _approvalExpiryTimers.values) {
      timer.cancel();
    }
    _approvalExpiryTimers.clear();
  }

  void _handleResponse(String payload, String? actionId) {
    try {
      final decoded = jsonDecode(payload);
      if (decoded is! Map) return;
      final sessionId = decoded['session_id'];
      final targetValue = decoded['target'];
      final approvalId = decoded['approval_id'];
      if (sessionId is! String || sessionId.isEmpty) return;
      final target = RelayNotificationTarget.values.firstWhere(
        (candidate) => candidate.name == targetValue,
        orElse: () => RelayNotificationTarget.conversation,
      );
      final action = switch (actionId) {
        relayNotificationApproveActionId => RelayNotificationAction.approveOnce,
        relayNotificationRejectActionId => RelayNotificationAction.reject,
        relayNotificationAnswerActionId => RelayNotificationAction.answer,
        _ => null,
      };
      if (action != null &&
          action != RelayNotificationAction.answer &&
          approvalId is String &&
          approvalId.isNotEmpty) {
        final request = RelayNotificationActionRequest(
          sessionId: sessionId,
          approvalId: approvalId,
          action: action,
        );
        final callback = _onActionRequest;
        if (callback == null) {
          _pendingActionRequest = request;
        } else {
          callback(request);
        }
        return;
      }
      final request = RelayNotificationOpenRequest(
        sessionId: sessionId,
        target: target,
        approvalId: approvalId is String ? approvalId : null,
      );
      final callback = _onOpenRequest;
      if (callback == null) {
        _pendingOpenRequest = request;
      } else {
        callback(request);
      }
    } catch (_) {
      // Ignore malformed OS-owned payloads rather than trusting them as input.
    }
  }
}

class _NotificationDefinition {
  const _NotificationDefinition({
    required this.notificationId,
    required this.title,
    required this.subtitle,
    required this.body,
    required this.sessionId,
    required this.target,
    required this.kind,
    required this.actions,
    required this.urgent,
    this.approvalId,
    this.expiresAt,
  });

  final int notificationId;
  final String title;
  final String subtitle;
  final String body;
  final String sessionId;
  final RelayNotificationTarget target;
  final RelayNotificationKind kind;
  final List<RelayNotificationAction> actions;
  final bool urgent;
  final String? approvalId;
  final DateTime? expiresAt;
}

int stableNotificationId(String eventId) {
  var hash = 0x811c9dc5;
  for (final byte in utf8.encode(eventId)) {
    hash ^= byte;
    hash = (hash * 0x01000193) & 0x7fffffff;
  }
  return hash;
}
