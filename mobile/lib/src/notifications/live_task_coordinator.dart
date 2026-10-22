import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import '../../l10n/relayune_localizations.dart';
import '../models.dart';

abstract interface class LiveTaskGateway {
  Future<void> update(Map<String, Object?> card);
  Future<void> clear();
}

class NativeLiveTaskGateway implements LiveTaskGateway {
  const NativeLiveTaskGateway();
  static const channel = MethodChannel('cn.giraffetree.relayune/live_tasks');

  @override
  Future<void> update(Map<String, Object?> card) =>
      channel.invokeMethod<void>('update', card);

  @override
  Future<void> clear() => channel.invokeMethod<void>('clear');
}

/// Only consumes authenticated, decrypted events. Native surfaces receive a
/// bounded title and fixed status copy, never commands, replies or credentials.
/// All native writes are serialized, including sign-out and account switches.
class LiveTaskCoordinator {
  LiveTaskCoordinator({required this.gateway, DateTime Function()? now})
    : _now = now ?? DateTime.now;

  final LiveTaskGateway gateway;
  final DateTime Function() _now;
  final Map<String, _LiveTask> _tasks = {};
  final Set<String> _seen = {};
  final Map<String, DateTime> _lastFinished = {};
  Map<String, RelaySession> _sessions = {};
  AppLocalizations _l10n = relayuneLocalizationsFor(const Locale('en'));
  Future<void> _writes = Future.value();
  bool _enabled = false;
  bool _foreground = true;
  bool _connected = false;
  Set<String> _disconnectedSessionIds = {};
  bool _disposed = false;
  DateTime? _lastRefresh;
  String? _account;
  bool _accountWasKnown = false;
  bool _clearedWhileUnavailable = false;

  Future<void> get settled => _writes;

  void configure({
    required bool enabled,
    required bool connected,
    Set<String> disconnectedSessionIds = const {},
    required String? account,
    required Iterable<RelaySession> sessions,
    Set<String> runningSessionIds = const {},
    bool catalogReady = false,
    bool clearWhenUnavailable = false,
    required Locale locale,
  }) {
    if (_disposed) return;
    _sessions = {for (final session in sessions) session.id: session};
    _l10n = relayuneLocalizationsFor(locale);
    if (_account != account) {
      _account = account;
      if (account == null || _accountWasKnown) {
        _tasks.clear();
        _seen.clear();
        _lastFinished.clear();
        _enqueue(gateway.clear);
      }
      _accountWasKnown = account != null;
    }
    final changed =
        _enabled != enabled ||
        _connected != connected ||
        !setEquals(_disconnectedSessionIds, disconnectedSessionIds);
    _enabled = enabled && account != null;
    _connected = connected;
    _disconnectedSessionIds = disconnectedSessionIds;
    if (!_enabled) {
      if (changed || (clearWhenUnavailable && !_clearedWhileUnavailable)) {
        _enqueue(gateway.clear);
        _clearedWhileUnavailable = true;
      }
      return;
    }
    _clearedWhileUnavailable = false;
    if (catalogReady) {
      for (final session in _sessions.values) {
        if (!session.isSubagent &&
            runningSessionIds.contains(session.id) &&
            !_tasks.containsKey(session.id)) {
          _tasks[session.id] = _LiveTask(
            session.id,
            'restored:${session.id}',
            _now(),
            restored: true,
          );
          _publish(_tasks[session.id]!);
        }
      }
      for (final task in _tasks.values.toList()) {
        if (!runningSessionIds.contains(task.sessionId) &&
            task.approvals.values.every(
              (approval) => !approval.expiry.isAfter(_now()),
            )) {
          // A reconnect/catalog correction is not evidence of success.
          task.state = 'stale';
          task.finishedAt = _now();
          _publish(task);
          _tasks.remove(task.sessionId);
        }
      }
    }
    // Existing websocket heartbeats refresh staleDate; no background timer or
    // extra network polling is introduced for the card.
    if (changed ||
        _lastRefresh == null ||
        _now().difference(_lastRefresh!) >= const Duration(seconds: 25)) {
      refresh();
    }
  }

  void setForeground(bool value) {
    if (_foreground == value) return;
    _foreground = value;
    refresh();
  }

  void refresh() {
    if (!_enabled || _disposed) return;
    _lastRefresh = _now();
    for (final task in _tasks.values.toList()) {
      _publish(task);
    }
  }

  void handleEvent(RelayEvent record, {required bool isRootSession}) {
    if (_disposed || !_seen.add(record.eventId)) return;
    if (_seen.length > 4096) _seen.remove(_seen.first);
    final event = record.event;
    final kind = event['kind'];
    final root = event['root_session_id'] as String?;
    final sessionId = root?.isNotEmpty == true ? root! : record.sessionId;
    var task = _tasks[sessionId];
    final created = DateTime.tryParse(record.createdAt);
    if (created == null) return;
    final turnId = event['turn_id'] as String?;

    if ((kind == 'turn.started' || kind == 'turn.steered') && isRootSession) {
      if (_now().difference(created) > const Duration(minutes: 5)) return;
      final finished = _lastFinished[sessionId];
      if (finished != null && !created.isAfter(finished)) return;
      if (task != null && !task.restored && created.isBefore(task.startedAt)) {
        return;
      }
      if (task == null || (turnId != null && task.turnId != turnId)) {
        task = _LiveTask(sessionId, turnId ?? record.eventId, created);
        _tasks[sessionId] = task;
      }
      _publish(task);
      return;
    }

    if (kind == 'approval.requested') {
      final approvalId = event['approval_id'] as String?;
      final expiry = DateTime.tryParse(event['expires_at'] as String? ?? '');
      if (approvalId == null ||
          expiry == null ||
          expiry.difference(_now()) < const Duration(seconds: 15) ||
          _now().difference(created) > const Duration(minutes: 5)) {
        return;
      }
      if (task != null && !task.restored && created.isBefore(task.startedAt)) {
        return;
      }
      // A subagent's approval belongs on its root card; its turn ID must never
      // replace the root turn ID.
      task ??= _LiveTask(
        sessionId,
        isRootSession ? turnId ?? record.eventId : record.eventId,
        created,
      );
      _tasks[sessionId] = task;
      final action = event['action'];
      task.approvals[approvalId] = (
        expiry: expiry,
        question: action is Map && action['type'] == 'question.select',
      );
      _publish(task);
      return;
    }
    if (task == null) return;
    if (kind == 'approval.resolved') {
      if (task.approvals.remove(event['approval_id']) != null) _publish(task);
      return;
    }
    if (!isRootSession ||
        (!task.restored && turnId != null && turnId != task.turnId)) {
      return;
    }
    if (kind == 'turn.completed' || kind == 'turn.failed') {
      final status = event['status'];
      task.state =
          kind == 'turn.failed' || status == 'failed' || status == 'error'
          ? 'failed'
          : const {
              'aborted',
              'cancelled',
              'canceled',
              'declined',
              'interrupted',
            }.contains(status)
          ? 'stopped'
          : 'completed';
      task.finishedAt = created;
      task.lastSyncedAt = _now();
      task.approvals.clear();
      _publish(task);
      _tasks.remove(sessionId);
      _lastFinished[sessionId] = created;
      if (_lastFinished.length > 512) {
        _lastFinished.remove(_lastFinished.keys.first);
      }
    }
  }

  void _publish(_LiveTask task) {
    if (!_enabled || _disposed) return;
    final now = _now();
    if (_connected && !_disconnectedSessionIds.contains(task.sessionId)) {
      task.lastSyncedAt = now;
    }
    final pending =
        task.approvals.entries
            .where((entry) => entry.value.expiry.isAfter(now))
            .toList()
          ..sort((a, b) => a.value.expiry.compareTo(b.value.expiry));
    final approval = pending.firstOrNull;
    final state = task.finishedAt != null
        ? task.state
        : (!_connected || _disconnectedSessionIds.contains(task.sessionId))
        ? 'stale'
        : approval != null
        ? (approval.value.question ? 'question' : 'approval')
        : task.approvals.isNotEmpty
        ? 'stale'
        : 'running';
    final session = _sessions[task.sessionId];
    final provider = switch (session?.provider) {
      'claude' => 'Claude',
      'kimi' => 'Kimi',
      'opencode' => 'OpenCode',
      'mcode' => 'MiniMax Code',
      'zcode' => 'ZCode',
      'claude-cowork' => 'Claude Cowork',
      _ => 'Codex',
    };
    final label = switch (state) {
      'approval' => _l10n.liveTaskApproval,
      'question' => _l10n.liveTaskQuestion,
      'completed' => _l10n.liveTaskCompleted,
      'failed' => _l10n.liveTaskFailed,
      'stopped' => _l10n.liveTaskStopped,
      'stale' => _l10n.liveTaskStale,
      _ => _l10n.liveTaskRunning,
    };
    final validUntil = approval?.value.expiry;
    final freshness = now.add(const Duration(seconds: 75));
    final card = <String, Object?>{
      'sessionId': task.sessionId,
      'turnId': task.turnId,
      'title': liveTaskSafeTitle(session?.name) ?? _l10n.notificationMainTask,
      'provider': provider,
      'state': state,
      'statusLabel': label,
      'staleLabel': _l10n.liveTaskStale,
      'updatedLabel': _l10n.liveTaskUpdated,
      'elapsedLabel': _l10n.liveTaskElapsed,
      'actionLabel': approval != null
          ? _l10n.liveTaskReview
          : _l10n.liveTaskOpen,
      'startedAt': task.startedAt.millisecondsSinceEpoch,
      'updatedAt': task.lastSyncedAt.millisecondsSinceEpoch,
      'staleAt':
          (validUntil != null && validUntil.isBefore(freshness)
                  ? validUntil
                  : freshness)
              .millisecondsSinceEpoch,
      'finishedAt': task.finishedAt?.millisecondsSinceEpoch,
      'startKnown': !task.restored,
      'foreground': _foreground,
      'connected':
          _connected && !_disconnectedSessionIds.contains(task.sessionId),
    };
    _enqueue(() => gateway.update(card));
  }

  void _enqueue(Future<void> Function() write) {
    _writes = _writes.then((_) => write()).catchError((Object _) {
      // Optional OS UI must not interrupt task execution or encrypted sync.
    });
  }

  void dispose() {
    _disposed = true;
    _tasks.clear();
  }
}

String? liveTaskSafeTitle(String? raw) {
  if (raw == null || raw == '未命名会话') return null;
  final title = raw
      .replaceAll(
        RegExp(r'https?://\S+|(?:/Users/|/home/|/private/|/tmp/|/var/)\S+'),
        '…',
      )
      .replaceAll(
        RegExp(r'(?:bearer\s+|sk-)[a-z0-9._-]{8,}', caseSensitive: false),
        '••••',
      )
      .replaceAll(RegExp(r'\b\d{8}\b'), '••••••••')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  if (title.isEmpty) return null;
  return title.characters.take(42).toString();
}

class _LiveTask {
  _LiveTask(
    this.sessionId,
    this.turnId,
    this.startedAt, {
    this.restored = false,
  }) : lastSyncedAt = startedAt;
  DateTime lastSyncedAt;
  final bool restored;
  final String sessionId;
  final String turnId;
  final DateTime startedAt;
  String state = 'running';
  DateTime? finishedAt;
  final Map<String, ({DateTime expiry, bool question})> approvals = {};
}
