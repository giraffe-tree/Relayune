import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:crypto/crypto.dart' as hashes;
import 'package:flutter/widgets.dart';

import '../../l10n/relayune_localizations.dart';
import '../config.dart';
import '../crypto/codec.dart';
import '../crypto/e2ee.dart';
import '../crypto/pairing_pake.dart';
import '../device/client_identity.dart';
import '../device/authorization_name.dart';
import '../feedback/relay_haptics.dart';
import '../models.dart';
import '../network/relay_api.dart';
import '../network/webrtc_read_transport.dart';
import '../network/automatic_route_supervisor.dart';
import '../network/direct_connection_attempt.dart';
import '../network/realtime_client.dart';
import '../network/online_stream.dart';
import '../notifications/notification_coordinator.dart';
import '../pairing/pairing_qr.dart';
import '../storage/secure_store.dart';
import '../storage/history_store.dart';
import '../storage/image_cache_store.dart';
import 'agent_order.dart';
import 'attachment_ranges.dart';
import 'device_connection.dart';
import 'transient_thinking.dart';
import 'font_size.dart';
import 'image_load_queue.dart';
import 'history_load_progress.dart';
import 'live_reply_presentation.dart';
import 'session_projects.dart';
import 'session_directory.dart';
import 'message_order.dart';
import 'conversation_turn_status.dart';

enum AppPhase { loading, signedOut, needsPairing, ready, unavailable }

enum LoginStage { email, password, verificationSent }

enum PairingPhase { idle, deriving, waitingForDesktop, activating }

enum MessageSendOutcome { delivered, queued, rejected, failed }

extension MessageSendOutcomeState on MessageSendOutcome {
  bool get accepted =>
      this == MessageSendOutcome.delivered || this == MessageSendOutcome.queued;
}

class AppController extends ChangeNotifier {
  static const int maxUploadAttachments = 4;
  static const int maxUploadBytes = 20 * 1024 * 1024;
  static const int maxSessionNameLength = 80;
  static const int maxProjectDisplayNameLength = 80;
  static const String defaultSessionName = '新建远程会话';
  static const Duration historyRequestTimeout = Duration(seconds: 60);
  static const Duration _createdSessionCatalogProtection = Duration(
    seconds: 30,
  );
  static const int _toolActivityDetailLimit = 12000;
  static const int _attachmentCacheLimitBytes = 8 * 1024 * 1024;
  static const int _imagePreviewLimitBytes = 1024 * 1024;
  static const Duration _fileAttachmentCacheTtl = Duration(minutes: 1);
  static const Duration _imagePreviewCacheTtl = Duration(minutes: 10);
  static const Set<String> supportedUploadMimeTypes = {
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/avif',
  };

  AppController({
    RelayApi? api,
    this.historyReadTimeout = historyRequestTimeout,
    SecureStore? secureStore,
    HistoryStore? historyStore,
    ImageCacheStore? imageCacheStore,
    RelayHaptics? haptics,
    RelayCipher? cipher,
    PairingPake? pairingPake,
    RealtimeConnector? realtimeConnector,
    RelayEventNotificationSink? eventNotifications,
    RelayNotificationManager? notificationManager,
    Locale locale = const Locale('zh', 'CN'),
  }) : api = api ?? RelayApi(),
       _secureStore = secureStore ?? SecureStore(),
       _historyStore =
           historyStore ?? HistoryStore(imageCacheStore: imageCacheStore),
       _imageCacheStore = imageCacheStore ?? ImageCacheStore.shared,
       haptics = haptics ?? RelayHaptics(),
       _cipher = cipher ?? RelayCipher(),
       _pairingPake = pairingPake ?? PairingPake(),
       _eventNotifications =
           eventNotifications ?? const NoopRelayEventNotificationSink(),
       _notificationManager = notificationManager,
       _locale = relayuneResolveLocale([locale]),
       _systemLocale = relayuneResolveLocale([locale]),
       localeListenable = ValueNotifier(relayuneResolveLocale([locale])),
       _l10n = relayuneLocalizationsFor(locale) {
    _realtimeConnector =
        realtimeConnector ??
        IoRealtimeConnector(connectSocket: this.api.connectSocket);
    _historyStore.imageCacheStore = _imageCacheStore;
  }

  final RelayApi api;
  final SecureStore _secureStore;
  final Duration historyReadTimeout;
  final HistoryStore _historyStore;
  final ImageCacheStore _imageCacheStore;
  Future<void> _imageCacheWrites = Future.value();
  final Set<String> _imageCacheTouches = {};
  List<int>? _historyCacheKey;
  String? _historyCacheScope;
  Future<bool>? _historyCacheOpening;
  Future<void> _historyCacheWrites = Future.value();
  Future<void> _pendingInputWrites = Future.value();
  final Map<String, Timer> _historyCacheTimers = {};
  final Map<String, Timer> _historyCacheDeadlines = {};
  final Map<String, Map<String, HistoryPage>> _pendingHistoryPages = {};
  final Map<String, Set<String>> _pendingHistoryDeletes = {};
  int _historyDeletionGeneration = 0;
  final Set<String> _pendingHistorySessions = {};
  bool _historyDrainQueued = false;
  final Map<String, int> _sessionSourceSequences = {};
  int _applyingSourceSequence = 0;
  final List<String> _recentMemorySessions = [];
  bool localReadOnly = false;
  Future<void>? _historyMaintenance;
  void _startHistoryMaintenance() {
    if (!_directoryForeground || _disposed || _historyCacheKey == null) return;
    _historyMaintenance ??= () async {
      final keys = <List<int>>[];
      var deferred = false;
      bool shouldContinue() {
        if (_directoryForeground && !_disposed) return true;
        deferred = true;
        return false;
      }

      try {
        // Snapshot candidates before reading secure keys. Concurrently admitted
        // new namespaces cannot be mistaken for orphans by an older snapshot.
        final candidates = await _historyStore.cachedNamespaces();
        final imageCandidates = await _imageCacheStore.cachedNamespaces();
        for (final encoded in await _secureStore.allHistoryKeys()) {
          keys.add(base64Decode(encoded));
        }
        if (!shouldContinue()) return;
        await _historyStore.maintainNamespaces(
          candidates,
          keys,
          shouldContinue: shouldContinue,
        );
        if (!shouldContinue()) return;
        await _imageCacheStore.removeOrphanNamespaces(imageCandidates, keys);
        _recordHistoryPerformance({
          'stage': 'cache_storage',
          ...await _historyStore.statistics(),
        });
      } catch (_) {
        _recordHistoryPerformance({'stage': 'cache_maintenance_unavailable'});
      } finally {
        for (final key in keys) {
          key.fillRange(0, key.length, 0);
        }
        if (deferred || !_directoryForeground) {
          _historyMaintenance = null;
          if (_directoryForeground && !_disposed) {
            scheduleMicrotask(_startHistoryMaintenance);
          }
        }
      }
    }();
  }

  final Set<String> _historyCacheRestored = {};
  final Map<String, Map<String, RelayMessage>> _historyCacheVersions = {};
  int _historyCacheEpoch = 0;
  bool _historyCacheDisabled = false;
  final List<Map<String, Object?>> historyPerformance = [];
  String? _historyVisibleSession;
  final Map<String, HistoryLoadProgress> _historyLoadProgress = {};
  final Map<String, Future<void>> _historyReads = {};

  HistoryLoadProgress? historyProgressFor(String sessionId) =>
      historyLoading.contains(sessionId)
      ? _historyLoadProgress[sessionId]
      : null;

  void _setHistoryProgressPhase(
    String sessionId,
    String requestId,
    HistoryLoadPhase phase, {
    bool responseReady = false,
  }) {
    final progress = historyProgressFor(sessionId);
    if (progress == null || progress.requestId != requestId) return;
    // A read can begin on the desktop before the command POST finishes.
    if (phase == HistoryLoadPhase.waiting &&
        progress.phase != HistoryLoadPhase.sending) {
      return;
    }
    if (progress.phase != phase) _recordHistoryPhase(progress);
    _historyLoadProgress[sessionId] = progress.withPhase(
      phase,
      responseReady: responseReady || progress.responseReady,
    );
    _notify();
  }

  void _recordHistoryPhase(HistoryLoadProgress progress) {
    _recordHistoryPerformance({
      'trace_id': progress.requestId,
      'stage': 'history_load_phase',
      'phase': progress.phase.name,
      'phase_ms':
          (progress.elapsed - progress.phaseStartedAt).inMicroseconds / 1000,
      'elapsed_ms': progress.elapsed.inMicroseconds / 1000,
    });
  }

  void _setHistoryTransferProgress(
    String sessionId,
    String requestId,
    DownloadProgress download,
  ) {
    final progress = historyProgressFor(sessionId);
    if (_disposed ||
        !_directoryForeground ||
        progress == null ||
        progress.requestId != requestId ||
        progress.responseReady ||
        download.waiting ||
        download.receivedBytes < 0) {
      return;
    }
    // These are locally counted body bytes. Never subtract them from the Mac's
    // encrypted frame size: HTTP and DataChannel have different wrappers.
    final total = download.totalBytes;
    if (total != null && (total < 0 || download.receivedBytes > total)) return;
    if (progress.phase != HistoryLoadPhase.transferring) {
      _recordHistoryPhase(progress);
    }
    _historyLoadProgress[sessionId] = progress.withPhase(
      HistoryLoadPhase.transferring,
      receivedBytes: download.receivedBytes,
      receiveTotalBytes: total,
      replaceTransferProgress: true,
    );
    _notify();
  }

  void historyViewportShown(String sessionId) {
    if (_historyVisibleSession == sessionId) return;
    _historyVisibleSession = sessionId;
    if (_historyCacheKey != null) {
      _historyStore.pinSession(_historyCacheKey!, sessionId);
    }
  }

  void historyViewportHidden(String? sessionId) {
    if (_historyVisibleSession == sessionId) {
      _historyVisibleSession = null;
      _historyStore.unpinSession();
    }
  }

  final Map<String, (Stopwatch, Map<String, Object?>)> _historyFrames = {};

  void _recordHistoryPerformance(Map<String, Object?> sample) {
    historyPerformance.add(Map.unmodifiable(sample));
    if (historyPerformance.length > 100) historyPerformance.removeAt(0);
    debugPrint('Relayune history performance ${jsonEncode(sample)}');
  }

  // Called by the conversation widget after a frame containing this result.
  void historyFrameDisplayed(String sessionId) {
    if (_historyFrames[sessionId]?.$2['source'] == 'selection') return;
    final pending = _historyFrames.remove(sessionId);
    if (pending == null || _disposed) return;
    _recordHistoryPerformance({
      ...pending.$2,
      if (pending.$2.containsKey('selection_started_at_ms'))
        'selection_to_first_frame_ms':
            pending.$1.elapsedMicroseconds / 1000 +
            (pending.$2['selection_request_offset_ms'] as num? ?? 0),
      if (pending.$2['request_visible'] == true)
        'display_ms': pending.$1.elapsedMicroseconds / 1000
      else
        'deferred_display_since_request_ms':
            pending.$1.elapsedMicroseconds / 1000,
      'displayed_at_ms': DateTime.now().millisecondsSinceEpoch,
    });
  }

  void _setHistoryFrame(
    String sessionId,
    Stopwatch watch,
    Map<String, Object?> sample,
  ) {
    final pending = _historyFrames[sessionId];
    // An already visible memory snapshot belongs to this tap's first paint.
    if (pending?.$2['source'] == 'memory') return;
    _historyFrames[sessionId] = pending?.$2['source'] == 'selection'
        ? (
            watch,
            {
              ...sample,
              'selection_started_at_ms': pending!.$2['selection_started_at_ms'],
              'selection_request_offset_ms':
                  (pending.$1.elapsedMicroseconds - watch.elapsedMicroseconds) /
                  1000,
            },
          )
        : (watch, sample);
  }

  Future<bool> _ensureHistoryCache() async {
    if (_historyCacheDisabled ||
        _disposed ||
        relayKey == null ||
        bootstrap?.device.id == null ||
        email.isEmpty) {
      return false;
    }
    final scope = hashes.sha256
        .convert(
          utf8.encode('$email:${bootstrap!.device.id}:${relayKey!.keyId}'),
        )
        .toString();
    if (_historyCacheScope == scope && _historyCacheKey != null) return true;
    if (_historyCacheOpening != null) return _historyCacheOpening!;
    final epoch = _historyCacheEpoch;
    final operation = () async {
      try {
        var encoded = await _secureStore.readHistoryKey(scope);
        if (encoded == null) {
          encoded = base64Encode(
            List.generate(32, (_) => _random.nextInt(256)),
          );
          await _secureStore.saveHistoryKey(scope, encoded);
        }
        if (epoch != _historyCacheEpoch || _disposed) {
          await _secureStore.clearHistoryKey(scope);
          return false;
        }
        _historyCacheScope = scope;
        _historyCacheKey = base64Decode(encoded);
        await _historyStore.database;
        _historyStore.pinSession(_historyCacheKey!, _historyVisibleSession);
        _startHistoryMaintenance();
        return true;
      } catch (_) {
        // Cache failure must leave the encrypted network path usable.
        _recordHistoryPerformance({'stage': 'cache_unavailable'});
        return false;
      }
    }();
    _historyCacheOpening = operation;
    try {
      return await operation;
    } finally {
      _historyCacheOpening = null;
    }
  }

  void _scheduleHistoryCache(String sessionId, {bool immediate = false}) {
    if (_disposed ||
        _historyCacheDisabled ||
        relayKey == null ||
        email.isEmpty ||
        bootstrap?.device.id == null ||
        !messages.containsKey(sessionId)) {
      return;
    }
    _historyCacheTimers.remove(sessionId)?.cancel();
    if (immediate) {
      _historyCacheDeadlines.remove(sessionId)?.cancel();
      _queueHistoryCache(sessionId);
      return;
    }
    void checkpoint() {
      _historyCacheTimers.remove(sessionId)?.cancel();
      _historyCacheDeadlines.remove(sessionId)?.cancel();
      _queueHistoryCache(sessionId);
    }

    _historyCacheTimers[sessionId] = Timer(
      const Duration(milliseconds: 300),
      checkpoint,
    );
    // Continuous deltas cannot indefinitely postpone durability.
    _historyCacheDeadlines.putIfAbsent(
      sessionId,
      () => Timer(const Duration(seconds: 2), checkpoint),
    );
  }

  void _queueHistoryCache(
    String sessionId, {
    String? before,
    HistoryPage? page,
    String? deletedId,
  }) {
    if (_historyCacheDisabled) return;
    _pendingHistorySessions.add(sessionId);
    if (page != null) {
      (_pendingHistoryPages[sessionId] ??= {})[before ?? ''] = page;
    }
    if (deletedId != null) {
      (_pendingHistoryDeletes[sessionId] ??= {}).add(deletedId);
    }
    if (_historyDrainQueued) return;
    _historyDrainQueued = true;
    final epoch = _historyCacheEpoch;
    _historyCacheWrites = _historyCacheWrites.catchError((_) {}).then((
      _,
    ) async {
      try {
        if (epoch != _historyCacheEpoch ||
            (_historyCacheKey == null && !await _ensureHistoryCache())) {
          return;
        }
        final key = List<int>.of(_historyCacheKey!);
        try {
          while (_pendingHistorySessions.isNotEmpty &&
              epoch == _historyCacheEpoch) {
            final checkpointWatch = Stopwatch()..start();
            final sessionId = _pendingHistorySessions.first;
            _pendingHistorySessions.remove(sessionId);
            final pages = _pendingHistoryPages.remove(sessionId) ?? {};
            final deletions = Set<String>.of(
              _pendingHistoryDeletes[sessionId] ?? {},
            );
            // Capture at drain time. Queue depth is bounded by sessions/cursors,
            // rather than by the number of streaming tokens.
            final snapshot = List<RelayMessage>.of(
              messages[sessionId] ?? const [],
            );
            final known =
                _historyCacheVersions[sessionId] ??
                const <String, RelayMessage>{};
            final pagedIds = {
              for (final page in pages.values)
                for (final m in page.messages) m.id,
            };
            final changed = snapshot
                .where(
                  (m) => !pagedIds.contains(m.id) && !identical(known[m.id], m),
                )
                .toList();
            for (final id in deletions) {
              await _historyStore.markDeleted(key, sessionId, id);
              _pendingHistoryDeletes[sessionId]?.remove(id);
            }
            if (_pendingHistoryDeletes[sessionId]?.isEmpty == true) {
              _pendingHistoryDeletes.remove(sessionId);
            }
            if (changed.isNotEmpty) {
              await _historyStore.appendMessages(key, sessionId, changed);
            }
            final byId = {for (final m in snapshot) m.id: m};
            for (final entry in pages.entries) {
              await _historyStore.appendPage(
                key,
                sessionId,
                entry.key.isEmpty ? null : entry.key,
                HistoryPage(
                  messages: entry.value.messages
                      .map((m) => byId[m.id] ?? m)
                      .toList(),
                  nextCursor: entry.value.nextCursor,
                  hasMore: entry.value.hasMore,
                  agents: const [],
                  sessions: const [],
                ),
              );
            }
            for (final m in snapshot) {
              if (m.role == 'user' &&
                  m.kind != 'local.user.message' &&
                  m.clientMessageId != null) {
                await _historyStore.confirmPending(
                  key,
                  sessionId,
                  m.clientMessageId!,
                );
              }
            }
            _historyCacheVersions[sessionId] = byId;
            _recordHistoryPerformance({
              'stage': 'cache_checkpoint',
              'write_ms': checkpointWatch.elapsedMilliseconds,
              'changed_messages': changed.length,
              'pages': pages.length,
              'queue_sessions': _pendingHistorySessions.length,
            });
          }
          _trimHistoryMemory();
        } finally {
          key.fillRange(0, key.length, 0);
        }
      } catch (_) {
        _recordHistoryPerformance({'stage': 'cache_write_failed'});
      } finally {
        _historyDrainQueued = false;
      }
    });
  }

  void _trimHistoryMemory() {
    final retained = {
      ..._recentMemorySessions.take(4),
      if (activeSessionId != null) activeSessionId!,
    };
    for (final id in messages.keys.toList()) {
      if (retained.contains(id) ||
          _pendingHistorySessions.contains(id) ||
          _historyCacheTimers.containsKey(id)) {
        continue;
      }
      if (runningSessions.contains(id)) {
        // Background live sessions keep a bounded tail; disk keeps older text.
        final items = messages[id]!;
        if (items.length > 100) {
          messages[id] = items.skip(items.length - 100).toList();
          _historyCacheVersions[id] = {for (final m in messages[id]!) m.id: m};
        }
        continue;
      }
      if (historyLoading.contains(id)) continue;
      messages.remove(id);
      _historyCacheVersions.remove(id);
      _historyCacheRestored.remove(id);
      _historyLoaded.remove(id);
      historyCursors.remove(id);
      historyHasMore.remove(id);
      _historyFrames.remove(id);
    }
  }

  Future<void> flushHistoryCache() async {
    if (_directoryCacheTimer != null ||
        (_historyCacheKey != null &&
            _sessionDirectory.sessions.isEmpty &&
            sessions.isNotEmpty)) {
      _directoryCacheTimer?.cancel();
      _directoryCacheTimer = null;
      _persistSessionDirectory();
    }
    final dirty = {..._historyCacheTimers.keys, ..._historyCacheDeadlines.keys};
    for (final timer in [
      ..._historyCacheTimers.values,
      ..._historyCacheDeadlines.values,
    ]) {
      timer.cancel();
    }
    _historyCacheTimers.clear();
    _historyCacheDeadlines.clear();
    for (final id in dirty) {
      _queueHistoryCache(id);
    }
    await _historyCacheWrites;
    await _pendingInputWrites;
    await _imageCacheWrites;
    await _historyMaintenance;
  }

  Future<void> _invalidateHistoryCache() async {
    _historyCacheDisabled = true;
    _clearAttachmentCache();
    _historyCacheEpoch++;
    _historyLoadProgress.clear();
    _historyReads.clear();
    _persistedHistoryRefreshes.clear();
    _directoryEpoch++;
    _directoryCacheTimer?.cancel();
    _directoryCacheTimer = null;
    _sessionDirectory = SessionDirectory();
    _directoryLoadFailed = false;
    _directoryRestoration = null;
    _directoryConfirmed = false;
    _directoryCachePending = false;
    _directoryRequest = null;
    for (final timer in _historyCacheTimers.values) {
      timer.cancel();
    }
    _historyCacheTimers.clear();
    for (final timer in _historyCacheDeadlines.values) {
      timer.cancel();
    }
    _historyCacheDeadlines.clear();
    _pendingHistorySessions.clear();
    _pendingHistoryPages.clear();
    _pendingHistoryDeletes.clear();
    await _historyCacheOpening;
    await _historyCacheWrites;
    await _pendingInputWrites;
    await _historyMaintenance;
    await HistoryStore.maintenance;
    await _imageCacheWrites;
    // Authorization may be removed before this controller has displayed any
    // cached history/images. Recover its existing key for namespace cleanup.
    if (_historyCacheKey == null &&
        relayKey != null &&
        bootstrap != null &&
        email.isNotEmpty) {
      final scope = hashes.sha256
          .convert(
            utf8.encode('$email:${bootstrap!.device.id}:${relayKey!.keyId}'),
          )
          .toString();
      try {
        final encoded = await _secureStore.readHistoryKey(scope);
        if (encoded != null) {
          _historyCacheKey = base64Decode(encoded);
          _historyCacheScope = scope;
        }
      } on Object {
        // Secure-store cleanup below still destroys the authorization's key.
      }
    }
    if (_historyCacheKey != null) {
      await _historyStore
          .removeNamespace(_historyCacheKey!)
          .catchError((Object _) {});
      await _imageCacheStore
          .removeNamespace(_historyCacheKey!)
          .catchError((Object _) {});
    }
    final scope = _historyCacheScope;
    if (scope != null) await _secureStore.clearHistoryKey(scope);
    _historyCacheKey?.fillRange(0, _historyCacheKey!.length, 0);
    _historyCacheKey = null;
    _historyCacheScope = null;
    _historyMaintenance = null;
    historyLoading.clear();
    historyEarlierLoading.clear();
    _historyCacheRestored.clear();
    _historyCacheVersions.clear();
    _historyFrames.clear();
    historyPerformance.clear();
    _historyVisibleSession = null;
  }

  final RelayHaptics haptics;
  final ValueNotifier<RelayFontSize> fontSizeListenable = ValueNotifier(
    RelayFontSize.small,
  );

  List<String> _visibleAgents = defaultVisibleAgents;
  List<String> get visibleAgents => _visibleAgents;
  Future<bool> setVisibleAgents(List<String> agents) async {
    final next = normalizeVisibleAgents(agents);
    try {
      await _secureStore.saveVisibleAgents(next);
    } on Object {
      return false;
    }
    _visibleAgents = next;
    _notify();
    return true;
  }

  List<String> _agentOrder = defaultAgentOrder;
  List<String> get agentOrder => _agentOrder;
  Future<void> _agentOrderWrite = Future.value();

  Future<bool> setAgentOrder(List<String> order) {
    final next = normalizeAgentOrder(order);
    _agentOrder = next;
    _notify();
    // Serialize rapid drags so an older write cannot overwrite the latest order.
    final save = _agentOrderWrite.then(
      (_) => _secureStore.saveAgentOrder(next),
    );
    _agentOrderWrite = save.catchError((Object _) {});
    return save.then((_) => true, onError: (Object _) => false);
  }

  int _directReadEpoch = 0;
  bool directReadsEnabled = false;
  bool get _supportsOnlineStream =>
      bootstrap?.onlineTransportVersion == 1 &&
      desktopInfo?.supportsOnlineStream == true;
  OnlineStream? _onlineStream;
  Timer? _onlineRetry;
  int _onlineRetryAttempt = 0;
  bool _onlineCatalogReceived = false;
  bool _onlineRecoveryPending = true;
  bool _onlineReplaced = false;
  Future<void>? _onlineRecovery;
  String? _onlineDirectoryRevision;
  final _onlineResults =
      <String, Future<({Map<String, dynamic>? value, Object? error})>>{};
  WebRtcReadTransport? _directTransport;
  bool _directWasReady = false;
  late final _automaticRoute = AutomaticRouteSupervisor(
    canConnect: () =>
        !_disposed &&
        !_realtimePaused &&
        _directoryForeground &&
        phase == AppPhase.ready &&
        directReadsEnabled &&
        relayKey != null &&
        deviceOnline &&
        desktopInfo?.supportsAutomaticRoute == true,
    isDirect: () => _directTransport?.sessionReady == true,
    connect: () async {
      await connectDirectReads();
      return _directTransport?.sessionReady == true;
    },
    check: _checkDirectRoute,
    fallback: () => _directTransport?.close(),
    jitter: () => _random.nextDouble(),
  );

  void _syncAutomaticRoute() {
    if (!_disposed &&
        !_realtimePaused &&
        _directoryForeground &&
        phase == AppPhase.ready &&
        directReadsEnabled) {
      _automaticRoute.start();
    } else {
      _automaticRoute.stop();
    }
  }

  @visibleForTesting
  void startDirectRouteMonitoringForTesting() {
    _realtimePaused = false;
    _syncAutomaticRoute();
  }

  void retryAutomaticRoute() {
    _syncAutomaticRoute();
    _automaticRoute.retryNow();
  }

  Future<bool?> _checkDirectRoute() async {
    final transport = _directTransport;
    if (transport == null || !transport.sessionReady) return false;
    if (transport.busy) return null;
    try {
      final pong = await _directControl(transport, 'transport.ping', {
        'nonce': _randomHex(16),
      });
      return pong['active'] == true;
    } catch (_) {
      return false;
    }
  }

  final _directReadResults =
      <String, Future<({Map<String, dynamic>? value, Object? error})>>{};

  String? get directPathLabel => _directTransport?.pathLabel;

  int? get directRoundTripMs {
    final transport = _directTransport;
    final measuredAt = transport?.roundTripAt;
    if (transport?.sessionReady != true ||
        measuredAt == null ||
        DateTime.now().difference(measuredAt) > const Duration(seconds: 45)) {
      return null;
    }
    return transport?.roundTripMs;
  }

  int? get directConnectionMs => _directTransport?.sessionReady == true
      ? _directTransport?.connectionMs
      : null;

  String? get directReadFailureStage => _directTransport?.failureStage;

  String get directReadStatus => !directReadsEnabled
      ? 'server'
      : _directTransport?.sessionReady == true
      ? 'direct'
      : (_directTransport?.connecting == true ||
            _directTransport?.connected == true)
      ? 'connecting'
      : desktopInfo?.supportsAutomaticRoute != true
      ? 'unsupported'
      : 'fallback';

  Future<bool> setDirectReads(bool enabled) async {
    try {
      await _secureStore.saveDirectReads(enabled);
    } catch (_) {
      return false;
    }
    if (_disposed) return false;
    directReadsEnabled = enabled;
    if (!enabled) {
      _directTransport?.close();
    }
    _syncAutomaticRoute();
    _notify();
    return true;
  }

  Future<void> connectDirectReads() async {
    if (_disposed ||
        !directReadsEnabled ||
        _realtimePaused ||
        !_directoryForeground ||
        relayKey == null ||
        desktopInfo?.supportsAutomaticRoute != true ||
        !deviceOnline) {
      return;
    }
    if (_directTransport?.connecting == true ||
        _directTransport?.connected == true) {
      return;
    }
    final attempt = DirectConnectionAttempt();
    final connectionWatch = Stopwatch()..start();
    final key = relayKey;
    final deviceId = bootstrap?.device.id;
    // A closed attempt may still be awaiting HTTP catch-up. Never let that
    // attempt activate or close a subsequent connection after a quick switch.
    late final WebRtcReadTransport transport;
    bool current() =>
        !attempt.cancelled &&
        !_disposed &&
        !_realtimePaused &&
        _directoryForeground &&
        directReadsEnabled &&
        identical(_directTransport, transport) &&
        relayKey == key &&
        bootstrap?.device.id == deviceId;
    transport = WebRtcReadTransport(
      trickle: desktopInfo?.supportsTrickleIce == true,
      exchangeCandidates: (connectionId, candidates, cursor) async {
        if (!current()) throw StateError('webrtc_closed');
        final command = await sendEncryptedCommand('transport.offer', null, {
          'operation': 'ice',
          'connection_id': connectionId,
          'candidates': candidates,
          'cursor': cursor,
        }, ttl: const Duration(seconds: 60));
        final response = await waitForEncryptedResponse(
          command.requestId,
          timeout: const Duration(seconds: 8),
        );
        if (!current() ||
            response['type'] != 'transport.answer' ||
            response['connection_id'] != connectionId ||
            response['error'] != null) {
          throw const FormatException('webrtc_candidates_invalid');
        }
        return response;
      },
      onChanged: () {
        if (!identical(_directTransport, transport)) return;
        if (_directWasReady && !transport.sessionReady) {
          _directWasReady = false;
          if (current()) _automaticRoute.connectionLost();
        }
        _notify();
      },
      onEvent: (raw) async {
        if (!current()) {
          return;
        }
        final frame = OpaqueFrame.fromJson(raw);
        if (frame.deviceId != deviceId ||
            frame.aad.deviceId != deviceId ||
            frame.aad.direction != 'relay_to_web' ||
            frame.aad.type != 'session.event' ||
            frame.aad.sessionId != frame.sessionId ||
            frame.aad.eventSeq != raw['event_seq'] ||
            frame.eventId == null ||
            frame.aad.eventSeq == null) {
          throw const FormatException('webrtc_event_route');
        }
        final event = await _decryptEvent(frame);
        if (!current()) {
          return;
        }
        _applyEvent(event);
        _notifyEvent(event);
        await _directControl(transport, 'transport.event_ack', {
          'event_id': frame.eventId,
          'event_seq': frame.aad.eventSeq,
        }, reply: false);
      },
      signal: (sdp) async {
        final signalWatch = Stopwatch()..start();
        final command = await sendEncryptedCommand('transport.offer', null, {
          'sdp': sdp,
          'trickle': desktopInfo?.supportsTrickleIce == true,
        }, ttl: const Duration(seconds: 60));
        transport.connectionTimingsMs['offer_post'] =
            signalWatch.elapsedMilliseconds;
        signalWatch.reset();
        final answer = await waitForEncryptedResponse(
          command.requestId,
          timeout: const Duration(seconds: 18),
        );
        transport.connectionTimingsMs['answer_wait'] =
            signalWatch.elapsedMilliseconds;
        if (relayKey != key ||
            bootstrap?.device.id != deviceId ||
            answer['type'] != 'transport.answer' ||
            answer['connection_id'] != command.requestId) {
          throw const FormatException('webrtc_answer_invalid');
        }
        return answer;
      },
    );
    _directTransport = transport;
    _directWasReady = false;
    if (transport.connecting || transport.connected) return;
    var outcome = 'failed';
    try {
      await attempt.run('connect', transport.connect);
      if (!transport.connected || !current()) {
        throw StateError('direct_not_connected');
      }
      await attempt.run(
        'probe',
        () => _directControl(transport, 'transport.ping', {
          'nonce': _randomHex(16),
        }),
      );
      await attempt.run(
        'resume',
        () => _directControl(
          transport,
          'transport.resume',
          {},
          timeout: const Duration(seconds: 20),
        ),
      );
      await attempt.run('catchup', _catchUpEvents);
      if (!current() || !transport.connected) {
        transport.close();
        return;
      }
      await attempt.run(
        'activate',
        () => _directControl(
          transport,
          'transport.activate',
          {},
          timeout: const Duration(seconds: 20),
        ),
      );
      final verified = await attempt.run(
        'verify',
        () => _directControl(transport, 'transport.ping', {
          'nonce': _randomHex(16),
        }),
      );
      if (!current() || !transport.connected || verified['active'] != true) {
        transport.close();
        return;
      }
      outcome = 'ready';
      transport.connectionMs = connectionWatch.elapsedMilliseconds;
      transport.sessionReady = true;
      _directWasReady = true;
      _notify();
    } catch (_) {
      attempt.cancelled = true;
      transport.failureStage ??= attempt.stage;
      transport.close();
    } finally {
      // Fixed stage names and durations only; no IDs, network addresses or payloads.
      debugPrint(
        'Relayune direct connection ${jsonEncode({...attempt.summary(outcome), 'transport_ms': transport.connectionTimingsMs})}',
      );
    }
  }

  Future<Map<String, dynamic>> _directControl(
    WebRtcReadTransport transport,
    String type,
    Map<String, dynamic> payload, {
    bool reply = true,
    Duration timeout = const Duration(seconds: 4),
  }) async {
    final key = relayKey;
    final deviceId = bootstrap?.device.id;
    bool current() =>
        !_disposed &&
        !_realtimePaused &&
        _directoryForeground &&
        directReadsEnabled &&
        identical(_directTransport, transport) &&
        relayKey == key &&
        bootstrap?.device.id == deviceId;
    if (key == null || deviceId == null || !current()) {
      throw StateError('webrtc_cancelled');
    }
    final id = _randomId('probe');
    final now = DateTime.now().toUtc();
    final aad = RelayAad(
      direction: 'web_to_relay',
      type: type,
      deviceId: deviceId,
      sessionId: null,
      requestId: id,
      eventSeq: null,
      createdAt: now.toIso8601String(),
      expiresAt: now.add(const Duration(seconds: 30)).toIso8601String(),
    );
    final envelope = await _cipher.sealJson(key, {
      'type': type,
      'device_id': deviceId,
      'session_id': null,
      'request_id': id,
      'payload': payload,
      'issued_at': aad.createdAt,
      'expires_at': aad.expiresAt,
    }, aad);
    if (!current()) throw StateError('webrtc_cancelled');
    final frame = <String, dynamic>{
      'device_id': deviceId,
      'session_id': null,
      'request_id': id,
      'command_type': type,
      'aad': aad.toJson(),
      'envelope': envelope.toJson(),
    };
    if (!reply) {
      await transport.send(frame);
      return {};
    }
    final probeWatch = Stopwatch()..start();
    final raw = await transport.read(frame, timeout: timeout);
    final response = OpaqueFrame.fromJson(raw);
    final expected = switch (type) {
      'transport.ping' => 'transport.pong',
      'transport.resume' => 'transport.ready',
      'transport.activate' => 'transport.activated',
      _ => '',
    };
    if (!current() ||
        response.deviceId != deviceId ||
        response.requestId != id ||
        response.sessionId != null ||
        response.aad.direction != 'relay_to_web' ||
        response.aad.deviceId != deviceId ||
        response.aad.requestId != id ||
        response.aad.sessionId != null ||
        response.aad.eventSeq != null ||
        response.aad.type != expected) {
      throw const FormatException('webrtc_probe_route');
    }
    final value = await _cipher.openJson<Map<String, dynamic>>(
      key,
      response.envelope,
      response.aad,
    );
    if (!current() ||
        value['type'] != expected ||
        value['request_id'] != id ||
        value['session_id'] != null ||
        (type == 'transport.ping' && value['nonce'] != payload['nonce'])) {
      throw const FormatException('webrtc_probe_invalid');
    }
    if (type == 'transport.ping') {
      transport.roundTripMs = probeWatch.elapsedMilliseconds;
      transport.roundTripAt = DateTime.now();
      unawaited(transport.refreshPath());
      _notify();
    }
    return value;
  }

  Future<Map<String, dynamic>> _readDirectOrServer(
    String type,
    String? sessionId,
    Map<String, dynamic> payload,
    String requestId,
    Map<String, dynamic> frame, {
    DownloadProgressCallback? onProgress,
  }) async {
    final key = relayKey!;
    final transport = _directTransport!;
    final epoch = _directReadEpoch;
    final deviceId = bootstrap!.device.id;
    try {
      final receipt = !_directResponseTypes.contains(type);
      final raw = await transport.read(frame, receipt: receipt);
      final response = OpaqueFrame.fromJson(raw);
      final expectedTypes = switch (type) {
        'transport.resume' => const {'transport.ready'},
        'session.read_history' => const {
          'session.history',
          'session.history_error',
        },
        'session.web_open' || 'session.web_request' => const {
          'session.web_result',
          'session.web_error',
        },
        'session.read_attachment' => const {
          'session.attachment',
          'session.attachment_error',
        },
        'session.read_agents' => const {
          'session.agents',
          'session.agents_error',
        },
        'session.configure' => const {
          'session.configure_result',
          'session.configure_error',
        },
        'session.create' => const {
          'session.create_result',
          'session.create_error',
        },
        'session.fork' => const {'session.fork_result', 'session.fork_error'},
        'project.locations' ||
        'project.check' ||
        'project.sessions' ||
        'project.browse' ||
        'project.create' => const {'project.result'},
        _ => const {'command.ack'},
      };
      if (epoch != _directReadEpoch ||
          relayKey != key ||
          bootstrap?.device.id != deviceId ||
          response.deviceId != deviceId ||
          response.requestId != requestId ||
          (!receipt &&
              type != 'session.create' &&
              !(type == 'session.fork' &&
                  response.aad.type == 'session.fork_result') &&
              response.sessionId != sessionId) ||
          response.aad.direction != 'relay_to_web' ||
          response.aad.deviceId != deviceId ||
          response.aad.requestId != requestId ||
          response.aad.sessionId != response.sessionId ||
          !expectedTypes.contains(response.aad.type)) {
        throw const FormatException('webrtc_response_invalid');
      }
      final value = await _cipher.openJson<Map<String, dynamic>>(
        key,
        response.envelope,
        response.aad,
      );
      if (value['type'] != response.aad.type ||
          value['request_id'] != requestId ||
          (!receipt && value['session_id'] != response.sessionId)) {
        throw const FormatException('webrtc_response_invalid');
      }
      if (receipt &&
          !const {
            'accepted',
            'completed',
            'duplicate',
          }.contains(value['status'])) {
        throw const FormatException('webrtc_command_rejected');
      }
      return value;
    } catch (_) {
      transport.close();
      if (type == 'transport.resume') rethrow;
      if (_disposed ||
          epoch != _directReadEpoch ||
          relayKey != key ||
          bootstrap?.device.id != deviceId) {
        throw const RelayApiException('', 0, 'request_cancelled');
      }
      final safeRead = const {
        'session.read_history',
        'session.read_attachment',
        'session.read_agents',
        'project.locations',
        'project.check',
        'project.sessions',
        'project.browse',
      }.contains(type);
      if (safeRead && !_directoryForeground) {
        throw const RelayApiException('', 0, 'request_cancelled');
      }
      final fallback = safeRead
          ? await _sendEncryptedCommand(
              type,
              sessionId,
              payload,
              forceServer: true,
            )
          : await _sendSealedFrame(frame);
      if (!_directResponseTypes.contains(type)) {
        return {'type': 'command.ack', 'status': 'queued'};
      }
      return waitForEncryptedResponse(
        fallback.requestId,
        timeout: const Duration(seconds: 45),
        retryTransientErrors: true,
        serverOnly: true,
        preserveCompression:
            type == 'session.read_history' || onProgress != null,
        onProgress:
            onProgress ??
            (type == 'session.read_history' &&
                    payload['include_progress'] == true &&
                    sessionId != null
                ? (download) => _setHistoryTransferProgress(
                    sessionId,
                    requestId,
                    download,
                  )
                : null),
      );
    }
  }

  static const _directResponseTypes = {
    'session.web_open',
    'session.web_request',
    'transport.resume',
    'session.read_history',
    'session.read_attachment',
    'session.read_agents',
    'session.configure',
    'session.create',
    'session.fork',
    'project.locations',
    'project.check',
    'project.sessions',
    'project.browse',
    'project.create',
  };
  static const _directCommandTypes = {
    ..._directResponseTypes,
    'session.submit_message',
    'session.interrupt_turn',
    'session.create_agents',
    'approval.resolve',
  };

  Future<CommandResult> _sendSealedFrame(Map<String, dynamic> frame) {
    final aad = RelayAad.fromJson(jsonMap(frame['aad']));
    return api.sendCommand(
      deviceId: aad.deviceId,
      sessionId: aad.sessionId,
      requestId: aad.requestId!,
      commandType: aad.type,
      createdAt: aad.createdAt,
      expiresAt: aad.expiresAt!,
      aad: aad,
      envelope: SealedEnvelope.fromJson(jsonMap(frame['envelope'])),
    );
  }

  RelayFontSize get fontSize => fontSizeListenable.value;

  Future<bool> setFontSize(RelayFontSize size) async {
    fontSizeListenable.value = size;
    _notify();
    try {
      await _secureStore.saveFontSize(size.name);
      return true;
    } on Object {
      return false;
    }
  }

  final Map<String, int?> _approvalHaptics = {};
  final Map<String, (int?, String?)> _stopHaptics = {};

  Future<void> setHapticsEnabled(bool enabled) async {
    haptics.enabled = enabled;
    _notify();
    try {
      await _secureStore.saveHapticsEnabled(enabled);
    } on Object {
      // Keep the current preference even if optional storage is unavailable.
    }
  }

  final RelayCipher _cipher;
  final PairingPake _pairingPake;
  late final RealtimeConnector _realtimeConnector;
  final RelayEventNotificationSink _eventNotifications;
  final RelayNotificationManager? _notificationManager;
  Locale _locale;
  Locale _systemLocale;
  String? _preferredLocaleTag;
  final ValueNotifier<Locale> localeListenable;
  AppLocalizations _l10n;
  final Random _random = Random.secure();
  final LiveReplyRegistry _liveReplies = LiveReplyRegistry();

  AppPhase phase = AppPhase.loading;
  Future<void> Function(String origin, String? certificatePem)? changeInstance;
  InstanceCapabilities? instanceCapabilities;
  bool get instanceDiscoveryRequired =>
      api.origin != RelayConfig.officialOrigin && instanceCapabilities == null;
  bool get usernameLogin => instanceCapabilities?.usernameMode == true;
  String get accountDisplayName => bootstrap?.accountDisplayName ?? email;
  LoginStage loginStage = LoginStage.email;
  PairingPhase pairingPhase = PairingPhase.idle;
  String email = '';
  String? pendingPairingId;
  List<PendingBrowserPairing> pendingBrowserPairings = const [];
  bool discoveringPendingPairings = false;
  String error = '';
  String notice = '';
  (String, String)? _approvalNotice;
  final Map<(String, String), ({String decision, DateTime at})>
  _approvalOutcomes = {};
  bool notificationPrimerSeen = false;
  bool notificationPermissionRequested = false;
  ServerBootstrap? bootstrap;
  RelayDesktopInfo? desktopInfo;
  RelayKey? relayKey;
  List<RelaySession> sessions = const [];
  List<RelayProject> projects = const [];
  Map<String, ProviderUsageSnapshot> usageByProvider = const {};
  List<RelayApproval> approvals = const [];
  List<RelayAgent> agents = const [];
  final Map<String, List<RelayMessage>> messages = {};
  final Map<String, String?> historyCursors = {};
  final Map<String, bool> historyHasMore = {};
  final Set<String> historyLoading = {};
  final Set<String> historyEarlierLoading = {};
  bool historyLoadingVisible(String id) =>
      historyLoading.contains(id) &&
      (historyEarlierLoading.contains(id) || (messages[id]?.isEmpty ?? true));
  final Map<String, String> _historyErrors = {};
  final Set<String> _historyEarlierErrors = {};
  final Set<String> _historyFileAccessDenied = {};
  bool catalogFileAccessLimited = false;
  final Set<String> _agentActivityLoading = {};
  final Map<String, String> _agentActivityErrors = {};
  final Set<String> _historyLoaded = {};
  final Map<String, Future<void>> _persistedHistoryRefreshes = {};
  final Set<String> runningSessions = {};
  final Map<String, Timer> _stopRequests = {};

  bool isStoppingSession(String? sessionId) =>
      _stopRequests.containsKey(sessionId);
  final Set<String> _seenEvents = {};
  final Map<String, String> _activeTurns = {};
  final _transientThinking = TransientThinking();
  final Map<String, DateTime> _activeTurnObservedAt = {};
  DateTime? _latestCatalogObservedAt;
  // Only explicit catalog entries are authoritative; retained selections from
  // a partial catalog must not acquire a newer runtime timestamp.
  final Map<String, DateTime> _catalogIdleObservedAt = {};
  final Map<String, DateTime> _idleTurnObservedAt = {};
  final Map<String, String> _codexQueueStatuses = {};
  final Map<String, String> _pendingUserMessages = {};
  final Map<
    String,
    ({
      String label,
      String? clientMessageId,
      bool waitingForComputer,
      bool receivedByComputer,
    })
  >
  _sessionActivities = {};
  final Map<String, ({RelaySession session, DateTime expiresAt})>
  _recentlyCreatedSessions = {};
  final Map<String, ({Uint8List bytes, DateTime expiresAt})> _attachmentCache =
      {};
  final Map<String, _AttachmentLoad> _attachmentLoads = {};
  final _imageLoadQueue = ImageLoadQueue();
  int _attachmentCacheBytes = 0;
  int _attachmentCacheGeneration = 0;
  bool _sessionCreationInFlight = false;
  Object? _sessionCreationAttempt;
  // Retain uncertain operations for retries within this authorization. Any
  // redelivery uses the identical sealed frame, never a new creation request.
  final Map<String, _PendingSessionCreation> _pendingSessionCreations = {};
  final Map<String, _PendingSessionCreation> _pendingReplyBranches = {};
  final Set<String> configuringSessions = {};
  // Composer choices are separate from confirmed desktop state. Directory and
  // history refreshes must not roll back an unsent selection.
  final Map<String, Map<String, String>> _codexMessageSettings = {};

  bool supportsMessageModelSettings(RelaySession session) =>
      session.provider == 'codex' &&
      session.raw['supports_message_model_settings'] == true;

  bool supportsMessagePermissionSettings(RelaySession session) =>
      session.provider == 'codex' &&
      session.raw['supports_message_permission_settings'] == true;

  List<Map<String, dynamic>> sessionConfigOptions(RelaySession session) {
    final options = (session.raw['session_config_options'] as List? ?? const [])
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
    final selected = _codexMessageSettings[session.id];
    if (supportsMessagePermissionSettings(session) &&
        selected?['permissions'] != null) {
      for (final config in options.where(
        (item) => item['id'] == 'permissions',
      )) {
        config['currentValue'] = selected!['permissions'];
        config['description'] = (config['options'] as List? ?? const [])
            .whereType<Map>()
            .where((item) => item['value'] == selected['permissions'])
            .firstOrNull?['description'];
      }
    }
    if (!supportsMessageModelSettings(session) || selected?['model'] == null) {
      return options;
    }
    final modelConfig = options
        .where((item) => item['id'] == 'model')
        .firstOrNull;
    if (modelConfig == null) return options;
    final model = (modelConfig['options'] as List? ?? const [])
        .whereType<Map>()
        .where((item) => item['value'] == selected!['model'])
        .firstOrNull;
    modelConfig['currentValue'] = selected!['model'];
    options.removeWhere((item) => item['id'] == 'reasoning');
    final efforts = model?['reasoningOptions'] as List? ?? const [];
    if (efforts.isNotEmpty) {
      options.insert(options.indexOf(modelConfig) + 1, {
        'id': 'reasoning',
        'type': 'select',
        'name': 'Reasoning effort',
        'currentValue': selected['effort'],
        'options': efforts,
      });
    }
    return options;
  }

  void _selectCodexMessageSetting(
    RelaySession session,
    String id,
    Object value,
  ) {
    if (session.isSubagent || value is! String) return;
    final options = sessionConfigOptions(session);
    final config = options.where((item) => item['id'] == id).firstOrNull;
    final choice = (config?['options'] as List? ?? const [])
        .whereType<Map>()
        .where((item) => item['value'] == value)
        .firstOrNull;
    if (choice == null) return;
    if (id == 'permissions') {
      _codexMessageSettings[session.id] = {
        ...?_codexMessageSettings[session.id],
        'permissions': value,
      };
      error = '';
      notice = '';
      _notify();
      return;
    }
    final model = id == 'model' ? value : _configValue(options, 'model');
    if (model is! String) return;
    final currentEffort = _configValue(options, 'reasoning');
    String? effort = id == 'reasoning'
        ? value
        : currentEffort is String
        ? currentEffort
        : null;
    if (id == 'model') {
      final efforts = (choice['reasoningOptions'] as List? ?? const [])
          .whereType<Map>();
      if (!efforts.any((item) => item['value'] == effort)) {
        final defaultEffort = choice['defaultReasoningEffort'];
        effort =
            (efforts
                        .where((item) => item['value'] == defaultEffort)
                        .firstOrNull ??
                    efforts.firstOrNull)?['value']
                as String?;
      }
    }
    _codexMessageSettings[session.id] = {
      if (_codexMessageSettings[session.id]?['permissions']
          case final String mode)
        'permissions': mode,
      'model': model,
      if (effort != null) 'effort': effort,
    };
    error = '';
    notice = '';
    _notify();
  }

  Future<bool>? _pendingPairingDiscoveryOperation;
  String? activeSessionId;
  String? pendingWorkbenchTarget;
  int workbenchNavigationRevision = 0;
  int opaqueCursor = 0;
  bool refreshing = false;
  DeviceConnectionSnapshot _connectionSnapshot =
      const DeviceConnectionSnapshot.initial();
  final ValueNotifier<DeviceConnectionSnapshot> _connectionSnapshotNotifier =
      ValueNotifier(const DeviceConnectionSnapshot.initial());

  RealtimeConnection? _realtimeConnection;
  StreamSubscription<RealtimeSignal>? _realtimeSubscription;
  Timer? _reconnectTimer;
  Timer? _eventRetryTimer;
  int _eventRetryAttempt = 0;
  int _realtimeGeneration = 0;
  int _reconnectAttempt = 0;
  bool _realtimePaused = true;
  Future<void>? _eventCatchUp;
  int? _eventCatchUpGeneration;
  final Set<String> _pendingInvalidationScopes = {};
  final Set<Completer<void>> _responseWaiters = {};
  Map<String, String> _storedProjectAliases = const {};
  Map<String, String> _projectAliases = const {};
  String? _projectAliasAuthorizationScope;
  Map<String, String> _openedSessionVersions = const {};
  Future<void> _openedSessionVersionsWrite = Future.value();
  bool _synchronizingInvalidations = false;
  bool _synchronizingEventInvalidations = false;
  Future<void>? _refreshOperation;
  bool _disposed = false;

  RelaySession? get activeSession {
    final id = activeSessionId;
    if (id == null) {
      return sessions.where((item) => !item.isSubagent).firstOrNull;
    }
    return sessions.where((item) => item.id == id).firstOrNull;
  }

  RelaySession? get activeRootSession {
    final rootId = activeSession?.rootSessionId;
    if (rootId == null) return rootSessions.firstOrNull;
    return sessions.where((item) => item.id == rootId).firstOrNull;
  }

  List<RelaySession> get rootSessions => groupRootSessionsByProject(
    sessions,
  ).expand((group) => group.sessions).toList(growable: false);

  List<SessionProjectGroup> get projectGroups {
    final providers = {
      ...sessions.map((session) => session.provider),
      ...projects.map((project) => project.provider),
    };
    return providers.expand(projectGroupsForProvider).toList(growable: false);
  }

  List<SessionProjectGroup> projectGroupsForProvider(String provider) =>
      groupProviderSessionsByKnownProject(
        sessions,
        provider,
        projects: projects,
        aliases: _projectAliases,
      );

  SessionProjectGroup? projectGroupForSession(String? sessionId) {
    if (sessionId == null) return null;
    return projectGroups
        .where(
          (group) => group.sessions.any((session) => session.id == sessionId),
        )
        .firstOrNull;
  }

  List<RelayMessage> get activeMessages =>
      messages[activeSession?.id] ?? const [];

  Listenable get liveReplyUpdates => _liveReplies;

  bool backgroundMemoryReleased = false;
  int backgroundViewGeneration = 0;

  void setPresentationForeground(
    bool foreground, {
    bool resumeTransport = true,
  }) {
    setReplyPresentationForeground(foreground);
    if (_directoryForeground == foreground) return;
    _directoryForeground = foreground;
    if (!foreground) {
      pauseRealtime();
      _imageLoadQueue.clear();
    } else {
      backgroundMemoryReleased = false;
      _startHistoryMaintenance();
      if (resumeTransport) _startRealtime();
    }
  }

  void setReplyPresentationForeground(bool foreground) =>
      _liveReplies.setForeground(foreground);

  /// Release only durable, reconstructible bodies. Unconfirmed input and a
  /// failed/in-flight checkpoint must remain available until safely saved.
  void releaseBackgroundMemory() {
    if (_directoryForeground || _disposed) return;
    final before = messages.length;
    if (!backgroundMemoryReleased) backgroundViewGeneration++;
    backgroundMemoryReleased = true;
    _clearAttachmentCache();
    for (final id in messages.keys.toList()) {
      final items = messages[id]!;
      final known = _historyCacheVersions[id];
      if (_historyCacheKey == null ||
          historyLoading.contains(id) ||
          _pendingHistorySessions.contains(id) ||
          _historyCacheTimers.containsKey(id) ||
          _pendingUserMessages.containsKey(id) ||
          items.any((m) => m.kind == 'local.user.message') ||
          known == null ||
          items.any((m) => !identical(known[m.id], m))) {
        continue;
      }
      messages.remove(id);
      _historyCacheVersions.remove(id);
      _historyCacheRestored.remove(id);
      _historyLoaded.remove(id);
      historyCursors.remove(id);
      historyHasMore.remove(id);
      _historyFrames.remove(id);
      _liveReplies.resetSession(id);
    }
    _recordHistoryPerformance({
      'stage': 'background_memory_release',
      'released_sessions': before - messages.length,
      'retained_sessions': messages.length,
    });
    _notify();
  }

  LiveReplyPresentation? liveReplyText(String sessionId, String messageId) =>
      _liveReplies.listenableFor(sessionId, messageId);

  DeviceConnectionSnapshot get connectionSnapshot => _connectionSnapshot;

  ValueListenable<DeviceConnectionSnapshot> get connectionSnapshotListenable =>
      _connectionSnapshotNotifier;

  set connectionSnapshot(DeviceConnectionSnapshot value) {
    if (!value.online ||
        value.transport == RealtimeTransportState.reconnecting) {
      _transientThinking.invalidate();
    }
    _connectionSnapshot = value;
    if (!_disposed) _connectionSnapshotNotifier.value = value;
  }

  String? historyErrorFor(String sessionId) => _historyErrors[sessionId];

  String? sessionActivity(String sessionId) {
    final activity = _sessionActivities[sessionId];
    if (activity == null) return null;
    final awaitingAcceptedCommand = activity.clientMessageId != null;
    return _catalogSessionIsActive(sessionId) ||
            runningSessions.contains(sessionId) ||
            awaitingAcceptedCommand
        ? activity.label
        : null;
  }

  // History adapters can use different turn IDs from their live transport.
  // Display runtime evidence independently of a historical group's identity.
  bool sessionIsThinking(String sessionId) =>
      deviceOnline &&
      !realtimeReconnecting &&
      !isStoppingSession(sessionId) &&
      _transientThinking.isThinking(sessionId, _activeTurns[sessionId]);

  DateTime? sessionThinkingStartedAt(String sessionId) =>
      sessionIsThinking(sessionId)
      ? _transientThinking.startedAt(sessionId, _activeTurns[sessionId])
      : null;

  String? get activeRootSessionId => activeSession?.rootSessionId;

  List<RelayAgent> get activeSessionAgents {
    final rootSessionId = activeRootSessionId;
    if (rootSessionId == null) return const [];
    return agentsForRootSession(rootSessionId);
  }

  List<RelayAgent> agentsForRootSession(String rootSessionId) {
    final scoped = agents
        .where((agent) => agent.parentSessionId == rootSessionId)
        .toList();
    scoped.sort((left, right) {
      final leftTime = DateTime.tryParse(left.updatedAt ?? '');
      final rightTime = DateTime.tryParse(right.updatedAt ?? '');
      return (rightTime?.millisecondsSinceEpoch ?? 0).compareTo(
        leftTime?.millisecondsSinceEpoch ?? 0,
      );
    });
    return scoped;
  }

  bool sessionHasRunningAgent(String sessionId) {
    final session = sessions
        .where((session) => session.id == sessionId)
        .firstOrNull;
    if (session == null) return false;
    final rootId = session.isSubagent ? session.rootSessionId : session.id;
    final root = sessions
        .where((candidate) => !candidate.isSubagent && candidate.id == rootId)
        .firstOrNull;
    return root != null && runningSessions.contains(rootId);
  }

  bool get activeSessionAgentWaveActive {
    final rootSessionId = activeRootSessionId;
    if (rootSessionId == null || !runningSessions.contains(rootSessionId)) {
      return false;
    }
    final scoped = activeSessionAgents;
    return scoped.any((agent) => agent.isActive) ||
        (scoped.isNotEmpty && runningSessions.contains(rootSessionId));
  }

  bool get activeSessionAgentsSummarizing {
    final rootSessionId = activeRootSessionId;
    if (rootSessionId == null || !runningSessions.contains(rootSessionId)) {
      return false;
    }
    final scoped = activeSessionAgents;
    return scoped.isNotEmpty && scoped.every((agent) => !agent.isActive);
  }

  int get agentActivityCount {
    final activeCount = agents
        .where(
          (agent) =>
              agent.isActive && _catalogSessionIsActive(agent.parentSessionId),
        )
        .length;
    if (activeCount > 0) return activeCount;
    final rootsWithAgents = agents
        .map((agent) => agent.parentSessionId)
        .toSet();
    return runningSessions
        .where(
          (sessionId) =>
              rootsWithAgents.contains(sessionId) &&
              _catalogSessionIsActive(sessionId),
        )
        .length;
  }

  bool get deviceOnline => connectionSnapshot.realtimeConfirmed
      ? connectionSnapshot.online
      : bootstrap?.device.online ?? connectionSnapshot.online;

  bool get sessionCreationInFlight => _sessionCreationInFlight;

  bool get realtimeReconnecting =>
      connectionSnapshot.transport == RealtimeTransportState.reconnecting;

  RelayNotificationAuthorization get notificationAuthorization =>
      _notificationManager?.authorization ??
      RelayNotificationAuthorization.unknown;

  String get notificationStatusLabel => switch (notificationAuthorization) {
    RelayNotificationAuthorization.enabled =>
      _l10n.workbenchNotificationAllowed,
    RelayNotificationAuthorization.disabled =>
      _l10n.workbenchNotificationDisabled,
    RelayNotificationAuthorization.unknown =>
      _l10n.workbenchNotificationUnknown,
  };

  Locale get locale => _locale;

  Locale get systemLocale => _systemLocale;

  String? get preferredLocaleTag => _preferredLocaleTag;

  bool get usesSystemLocale => _preferredLocaleTag == null;

  void setLocale(Locale locale) => _applyLocale(locale);

  void updateSystemLocales(Iterable<Locale> locales) {
    _systemLocale = relayuneResolveLocale(locales);
    if (usesSystemLocale) _applyLocale(_systemLocale);
  }

  Future<bool> setPreferredLocale(String? localeTag) async {
    final selectedLocale = relayuneLocaleForTag(localeTag);
    if (localeTag != null && selectedLocale == null) return false;
    _preferredLocaleTag = selectedLocale == null
        ? null
        : relayuneLocaleTag(selectedLocale);
    _applyLocale(selectedLocale ?? _systemLocale);
    try {
      await _secureStore.savePreferredLocale(_preferredLocaleTag);
      return true;
    } on Object {
      return false;
    }
  }

  void _restoreLocalePreference(String? localeTag) {
    final selectedLocale = relayuneLocaleForTag(localeTag);
    _preferredLocaleTag = selectedLocale == null
        ? null
        : relayuneLocaleTag(selectedLocale);
    _applyLocale(selectedLocale ?? _systemLocale, notify: false);
  }

  void _applyLocale(Locale locale, {bool notify = true}) {
    _locale = relayuneResolveLocale([locale]);
    _l10n = relayuneLocalizationsFor(_locale);
    error = '';
    notice = '';
    _historyErrors.clear();
    for (final sessionId in _historyFileAccessDenied) {
      _historyErrors[sessionId] = _l10n.controllerFileAccessDenied;
    }
    _agentActivityErrors.clear();
    _sessionActivities.removeWhere(
      (_, activity) => activity.clientMessageId == null,
    );
    for (final entry in _sessionActivities.entries.toList()) {
      final activity = entry.value;
      _sessionActivities[entry.key] = (
        label: activity.waitingForComputer
            ? _l10n.controllerWaitingForComputer
            : activity.receivedByComputer
            ? _l10n.controllerPreparingAgent
            : _l10n.controllerWaitingForAgent,
        clientMessageId: activity.clientMessageId,
        waitingForComputer: activity.waitingForComputer,
        receivedByComputer: activity.receivedByComputer,
      );
    }
    _notificationManager?.setLocale(_locale);
    if (localeListenable.value != _locale) {
      localeListenable.value = _locale;
    }
    if (notify) _notify();
  }

  String _relayErrorMessage(RelayApiException exception) {
    return switch (exception.code) {
      'network_timeout' || 'response_timeout' => _l10n.apiErrorTimeout,
      'network_unavailable' => _l10n.apiErrorNetworkUnavailable,
      'invalid_response' => _l10n.apiErrorInvalidResponse,
      'invalid_credentials' => _l10n.apiErrorInvalidCredentials,
      'unauthorized' ||
      'browser_unauthorized' ||
      'session_cookie_missing' => _l10n.apiErrorAuthentication,
      'internal_error' ||
      'request_failed' ||
      'mail_delivery_failed' ||
      'rate_limited' => _l10n.apiErrorService,
      'pairing_failed' => _l10n.controllerPairingFailed,
      'pairing_used_or_expired' => _l10n.controllerPairingUsedOrExpired,
      'pairing_confirmation_timeout' =>
        _l10n.controllerPairingConfirmationTimeout,
      'pairing_confirmation_failed' =>
        _l10n.controllerPairingConfirmationFailed,
      'desktop_offline' => _l10n.controllerDesktopOffline,
      'attachment_gone' => _l10n.controllerAttachmentGone,
      'file_access_denied' => _l10n.controllerFileAccessDenied,
      'history_error' => _l10n.controllerHistoryReadFailed,
      'session_create_error' => _l10n.controllerDesktopSessionCreateFailed,
      'session_fork_outcome_unknown' => _l10n.controllerReplyBranchUnconfirmed,
      'session_fork_busy' => _l10n.controllerReplyBranchBusy,
      'session_worktree_unavailable' ||
      'session_worktree_failed' => _l10n.controllerReplyBranchWorktreeFailed,
      'session_fork_unsupported' ||
      'session_fork_cancelled' ||
      'session_fork_invalid_reply' ||
      'session_fork_latest_only' ||
      'session_not_found' => _l10n.controllerReplyBranchUnavailable,
      'session_fork_failed' => _l10n.controllerReplyBranchFailed,
      'session_configure_error' => _l10n.controllerDesktopConfigFailed,
      'pending_input_save_failed' => _l10n.controllerPendingInputSaveFailed,
      _ => _l10n.apiErrorGeneric,
    };
  }

  String _userFailure(Object exception, String fallback) =>
      exception is RelayApiException ? _relayErrorMessage(exception) : fallback;

  bool get shouldShowNotificationPrimer =>
      _notificationManager != null &&
      notificationAuthorization != RelayNotificationAuthorization.enabled &&
      !notificationPrimerSeen;

  Future<void> requestNotificationAuthorization() async {
    notificationPrimerSeen = true;
    notificationPermissionRequested = true;
    unawaited(_persistNotificationPermissionRequest());
    await _notificationManager?.requestAuthorization();
    await _notificationManager?.refreshAuthorization();
    _notify();
  }

  Future<void> dismissNotificationPrimer() async {
    if (notificationPrimerSeen) return;
    notificationPrimerSeen = true;
    unawaited(_persistNotificationPrimerSeen());
    _notify();
  }

  Future<void> _persistNotificationPermissionRequest() async {
    try {
      await Future.wait([
        _secureStore.saveNotificationPrimerSeen(),
        _secureStore.saveNotificationPermissionRequested(),
      ]);
    } on Object {
      // A local preference write must not prevent the system permission prompt.
    }
  }

  Future<void> _persistNotificationPrimerSeen() async {
    try {
      await _secureStore.saveNotificationPrimerSeen();
    } on Object {
      // The primer still stays dismissed for this process.
    }
  }

  Future<void> openNotificationSettings() async {
    await _notificationManager?.openSettings();
  }

  Future<void> refreshNotificationAuthorization() async {
    await _notificationManager?.refreshAuthorization();
    _notify();
  }

  void requestWorkbenchTarget(String target) {
    // Old local notifications may still carry the removed approvals-page
    // target. Keep those notifications useful by opening the conversation
    // where approval cards now live.
    final normalized = target == 'approvals' ? 'conversation' : target;
    if (!const {'conversation', 'agents'}.contains(normalized)) return;
    pendingWorkbenchTarget = normalized;
    workbenchNavigationRevision += 1;
    _notify();
  }

  String get deviceStatusLabel {
    return switch (connectionSnapshot.transport) {
      RealtimeTransportState.connected =>
        deviceOnline
            ? _l10n.workbenchDeviceOnlineRealtime
            : _l10n.workbenchDeviceOfflineQueued,
      RealtimeTransportState.connecting ||
      RealtimeTransportState.reconnecting =>
        deviceOnline
            ? _l10n.workbenchDeviceOnlineReconnecting
            : _l10n.workbenchDeviceOfflineReconnecting,
      RealtimeTransportState.idle =>
        deviceOnline
            ? _l10n.workbenchDeviceOnlineWaiting
            : _l10n.workbenchDeviceOfflineWaiting,
    };
  }

  @visibleForTesting
  Future<void> applyRealtimeSignalForTesting(RealtimeSignal signal) =>
      _handleRealtimeSignal(signal);

  @visibleForTesting
  void advanceRealtimeGenerationForTesting() => _advanceRealtimeGeneration();

  @visibleForTesting
  Future<void> catchUpEventsForTesting() => _catchUpEvents();

  @visibleForTesting
  void applyEventForTesting(RelayEvent event) => _applyEvent(event);

  @visibleForTesting
  void receiveLiveEventForTesting(RelayEvent event) {
    _applyEvent(event);
    _notifyEvent(event);
  }

  @visibleForTesting
  void markHistoryLoadedForTesting(String sessionId) =>
      _historyLoaded.add(sessionId);

  @visibleForTesting
  void replaceSessionsForTesting(
    List<RelaySession> next, {
    DateTime? catalogAt,
  }) {
    _replaceCatalog(sessions: next, catalogAt: catalogAt);
    _notify();
  }

  @visibleForTesting
  void replaceProjectsForTesting(List<RelayProject> next) {
    _replaceCatalog(sessions: sessions, projects: next);
    _notify();
  }

  @visibleForTesting
  ProviderUsageSnapshot? get codexUsage => usageByProvider['codex'];

  @visibleForTesting
  void replaceCodexUsageForTesting(ProviderUsageSnapshot? next) {
    usageByProvider = {...usageByProvider, if (next != null) 'codex': next};
    if (next == null) {
      usageByProvider = Map.unmodifiable(
        Map<String, ProviderUsageSnapshot>.from(usageByProvider)
          ..remove('codex'),
      );
    }
    _notify();
  }

  @visibleForTesting
  void replaceUsageByProviderForTesting(
    Map<String, ProviderUsageSnapshot> next,
  ) {
    usageByProvider = Map.unmodifiable(next);
    _notify();
  }

  @visibleForTesting
  Future<void> handleRevocationForTesting() => _handleRevokedRealtime();

  bool approvalIsPending(RelayApproval approval) {
    return approval.state == 'pending' &&
        DateTime.tryParse(approval.expiresAt)?.isAfter(DateTime.now()) == true;
  }

  int get pendingApprovalCount => approvals.where(approvalIsPending).length;

  List<RelayApproval> approvalsForSession(String sessionId) {
    final rootSessionId = _rootSessionIdFor(sessionId);
    return approvals
        .where((approval) {
          return _rootSessionIdFor(approval.sessionId) == rootSessionId;
        })
        .toList(growable: false);
  }

  int pendingApprovalCountForSession(String sessionId) =>
      approvalsForSession(sessionId).where(approvalIsPending).length;

  String? get nextPendingApprovalSessionId {
    final approval = approvals.where(approvalIsPending).firstOrNull;
    if (approval == null) return null;
    final rootSessionId = _rootSessionIdFor(approval.sessionId);
    return sessions.any((session) => session.id == rootSessionId)
        ? rootSessionId
        : approval.sessionId;
  }

  String _rootSessionIdFor(String sessionId) =>
      sessions
          .where((session) => session.id == sessionId)
          .firstOrNull
          ?.rootSessionId ??
      sessionId;

  Future<void> initialize({
    Uri? initialLink,
    StoredCredentials? credentials,
  }) async {
    phase = AppPhase.loading;
    _capturePairingLink(initialLink);
    _notify();
    try {
      final stored = credentials ?? await _secureStore.read();
      if (_disposed) return;
      _restoreLocalePreference(stored.preferredLocale);
      haptics.enabled = stored.hapticsEnabled;
      fontSizeListenable.value = RelayFontSize.fromStored(stored.fontSize);
      directReadsEnabled = stored.directReads;
      _agentOrder = normalizeAgentOrder(stored.agentOrder);
      _visibleAgents = normalizeVisibleAgents(stored.visibleAgents);
      notificationPrimerSeen = stored.notificationPrimerSeen;
      notificationPermissionRequested = stored.notificationPermissionRequested;
      api.sessionToken = stored.sessionToken;
      api.browserToken = stored.browserToken;
      _restoreProjectAliases(stored);
      _openedSessionVersions = Map.unmodifiable(stored.openedSessionVersions);
      if (stored.hasPairing) {
        relayKey = RelayKey.import(stored.contentKey!);
      }
      if (stored.sessionToken == null) {
        if (api.origin != RelayConfig.officialOrigin) {
          instanceCapabilities = await api.discoverInstance();
        }
        phase = AppPhase.signedOut;
        return;
      }
      await _restoreLocalAccount(stored);
      if (_disposed) return;
      // Capability discovery is an online check, so it must not prevent
      // read-only recovery of an already encrypted, instance-bound cache.
      if (api.origin != RelayConfig.officialOrigin) {
        instanceCapabilities = await api.discoverInstance();
      }
      if (_disposed) return;
      await _restoreAuthenticated(stored);
      if (stored.hasPairing && phase == AppPhase.ready) {
        await api.activateClientDevice().catchError((Object _) {});
      }
    } on RelayApiException catch (exception) {
      if (exception.status == 401) {
        await _invalidateHistoryCache();
        localReadOnly = false;
        if (expectedAccount == null) await _secureStore.clearSession();
        api.sessionToken = null;
        phase = AppPhase.signedOut;
      } else {
        error = _relayErrorMessage(exception);
        phase = localReadOnly ? AppPhase.ready : AppPhase.unavailable;
      }
    } catch (_) {
      error = _l10n.controllerRestoreFailed;
      phase = localReadOnly ? AppPhase.ready : AppPhase.unavailable;
    } finally {
      _notify();
    }
  }

  Future<void> _restoreLocalAccount(StoredCredentials stored) async {
    if (!stored.hasPairing || _disposed) return;
    try {
      final account = expectedAccount ?? await _secureStore.lastAccountEmail();
      if (account == null || account.isEmpty) return;
      email = account;
      bootstrap = ServerBootstrap(
        email: account,
        device: RelayDevice(
          id: stored.deviceId!,
          name: 'Relayune',
          online: false,
          agentConnected: false,
          lastSeenAt: null,
        ),
        catalog: null,
        events: const [],
        cursor: 0,
        ackSequence: 0,
        queuedCommands: 0,
      );
      final scope = hashes.sha256
          .convert(utf8.encode('$email:${stored.deviceId}:${relayKey!.keyId}'))
          .toString();
      final encoded = await _secureStore.readHistoryKey(scope);
      if (encoded == null) return;
      _historyCacheScope = scope;
      _historyCacheKey = base64Decode(encoded);
      await _restoreSessionDirectory();
      if (sessions.isEmpty || _disposed) return;
      // Cached account hints authorize only local reading until network identity
      // checks succeed. Running/approval state is never restored.
      localReadOnly = true;
      phase = AppPhase.ready;
      _notify();
      // Startup opens the directory/home, not a conversation. Restore bodies
      // on selection so an arbitrary default cannot delay online verification
      // or compete with the conversation the user actually opens.
      _startHistoryMaintenance();
    } catch (_) {
      _recordHistoryPerformance({'stage': 'offline_restore_unavailable'});
    }
  }

  Future<void> _restoreAuthenticated(StoredCredentials stored) async {
    if (expectedAccount == null && stored.hasPairing) {
      final identity = await api.bootstrap();
      final previousAccount = await _secureStore.lastAccountEmail();
      if (previousAccount != null &&
          identity.email.toLowerCase() != previousAccount.toLowerCase()) {
        await clearPairing();
        email = identity.email;
        bootstrap = identity;
        phase = AppPhase.needsPairing;
        await discoverPendingBrowserPairings();
        return;
      }
    }
    if (!stored.hasPairing) {
      final unaffiliated = await api.bootstrap();
      if (_disposed) return;
      email = unaffiliated.email;
      bootstrap = unaffiliated;
      phase = AppPhase.needsPairing;
      await discoverPendingBrowserPairings();
      return;
    }
    try {
      await refresh(deviceId: stored.deviceId);
      phase = AppPhase.ready;
      _startRealtime();
      final visible = _historyVisibleSession;
      if (visible != null) unawaited(loadHistory(visible));
    } on RelayApiException catch (exception) {
      if (exception.status == 401 && exception.code == 'browser_unauthorized') {
        await clearPairing();
        bootstrap = await api.bootstrap();
        email = bootstrap!.email;
        phase = AppPhase.needsPairing;
        notice = _l10n.controllerAuthorizationRevoked;
        await discoverPendingBrowserPairings();
        return;
      }
      if (exception.status == 404 && exception.code == 'device_not_found') {
        await clearPairing();
        bootstrap = await api.bootstrap();
        email = bootstrap!.email;
        phase = AppPhase.needsPairing;
        notice = _l10n.controllerDeviceNotConnected;
        await discoverPendingBrowserPairings();
        return;
      }
      rethrow;
    }
  }

  void _restoreProjectAliases(StoredCredentials stored) {
    browserAuthorizationId = stored.browserId;
    _storedProjectAliases = Map.unmodifiable(stored.projectAliases);
    final deviceId = stored.deviceId;
    final browserId = stored.browserId;
    if (deviceId == null || browserId == null) {
      _projectAliasAuthorizationScope = null;
      _projectAliases = const {};
      return;
    }
    final scope = _projectAliasScope(deviceId, browserId);
    _projectAliasAuthorizationScope = scope;
    _projectAliases = Map.unmodifiable({
      for (final entry in _storedProjectAliases.entries)
        if (entry.key.startsWith('$scope/'))
          entry.key.substring(scope.length + 1): entry.value,
    });
  }

  @visibleForTesting
  void restoreProjectAliasesForTesting(StoredCredentials stored) =>
      _restoreProjectAliases(stored);

  String _projectAliasScope(String deviceId, String browserId) =>
      '${Uri.encodeComponent(deviceId)}/${Uri.encodeComponent(browserId)}';

  Future<void> renameProject(
    SessionProjectGroup project,
    String displayName,
  ) async {
    final trimmed = displayName.trim();
    if (trimmed.isEmpty || trimmed.length > maxProjectDisplayNameLength) {
      error = trimmed.isEmpty
          ? _l10n.controllerProjectNameRequired
          : _l10n.controllerProjectNameTooLong(maxProjectDisplayNameLength);
      _notify();
      return;
    }
    final previousAliases = _projectAliases;
    final previousStoredAliases = _storedProjectAliases;
    final nextAliases = {...previousAliases};
    nextAliases[project.key] = trimmed;
    _projectAliases = Map.unmodifiable(nextAliases);

    final scope = _projectAliasAuthorizationScope;
    if (scope != null) {
      final stored = {..._storedProjectAliases};
      stored['$scope/${project.key}'] = trimmed;
      _storedProjectAliases = Map.unmodifiable(stored);
      try {
        await _secureStore.saveProjectAliases(_storedProjectAliases);
      } on Object {
        _projectAliases = previousAliases;
        _storedProjectAliases = previousStoredAliases;
        error = _l10n.controllerProjectNameSaveFailed;
        _notify();
        return;
      }
    }
    notice = _l10n.controllerProjectNameUpdated;
    error = '';
    _notify();
  }

  void handleIncomingLink(Uri link) {
    if (!_capturePairingLink(link)) return;
    if (phase == AppPhase.ready) {
      notice = _l10n.controllerNewPairingLinkReceived;
    }
    _notify();
  }

  bool _capturePairingLink(Uri? link) {
    if (link == null) return false;
    final candidate =
        link.queryParameters['pair'] ??
        (link.scheme == 'relayune' && link.host == 'pair'
            ? link.queryParameters['id']
            : null);
    if (candidate == null || !pairingIdPattern.hasMatch(candidate)) {
      return false;
    }
    pendingPairingId = candidate;
    return true;
  }

  void setPairingInput(String value, {bool reportInvalid = true}) {
    final trimmed = value.trim();
    final uri = Uri.tryParse(trimmed);
    final candidate =
        uri?.queryParameters['pair'] ??
        (pairingIdPattern.hasMatch(trimmed) ? trimmed : null);
    if (candidate == null || !pairingIdPattern.hasMatch(candidate)) {
      pendingPairingId = null;
      error = reportInvalid ? _l10n.controllerPairingLinkRequired : '';
      _notify();
      return;
    }
    pendingPairingId = candidate;
    error = '';
    _notify();
  }

  void setScannedPairing(PairingQrData pairing) {
    pendingPairingId = pairing.pairingId;
    error = '';
    notice = '';
    _notify();
  }

  Future<bool> discoverPendingBrowserPairings() {
    final active = _pendingPairingDiscoveryOperation;
    if (active != null) return active;
    final operation = _performPendingBrowserPairingDiscovery();
    _pendingPairingDiscoveryOperation = operation;
    return operation.whenComplete(() {
      if (identical(_pendingPairingDiscoveryOperation, operation)) {
        _pendingPairingDiscoveryOperation = null;
      }
    });
  }

  Future<bool> _performPendingBrowserPairingDiscovery() async {
    discoveringPendingPairings = true;
    error = '';
    _notify();
    try {
      final discovery = await api.pendingBrowserPairings();
      pendingBrowserPairings = List.unmodifiable(discovery.pairings);
      final selectionStillExists =
          pendingPairingId != null &&
          pendingBrowserPairings.any(
            (pairing) => pairing.pairingId == pendingPairingId,
          );
      if (!selectionStillExists) {
        pendingPairingId = pendingBrowserPairings.length == 1
            ? pendingBrowserPairings.single.pairingId
            : null;
      }
      return true;
    } on RelayApiException catch (exception) {
      error = _relayErrorMessage(exception);
      return false;
    } catch (_) {
      error = _l10n.controllerPairingDiscoveryFailed;
      return false;
    } finally {
      discoveringPendingPairings = false;
      _notify();
    }
  }

  void selectPendingBrowserPairing(String? pairingId) {
    if (pairingId == null ||
        !pendingBrowserPairings.any(
          (pairing) => pairing.pairingId == pairingId,
        )) {
      pendingPairingId = null;
    } else {
      pendingPairingId = pairingId;
    }
    error = '';
    _notify();
  }

  void resetLogin() {
    loginStage = LoginStage.email;
    error = '';
    _notify();
  }

  Future<void> continueWithEmail(String value) async {
    email = value.trim().toLowerCase();
    error = '';
    _notify();
    try {
      if (instanceDiscoveryRequired) {
        instanceCapabilities = await api.discoverInstance();
      }
      if (usernameLogin) {
        if (instanceCapabilities!.setupRequired) {
          error = locale.languageCode == 'zh'
              ? '请先由部署者在服务器本机完成初始化。'
              : 'Ask the owner to initialize this instance on the server first.';
          return;
        }
      } else {
        await api.emailStatus(email);
      }
      loginStage = LoginStage.password;
    } on RelayApiException catch (exception) {
      error = _relayErrorMessage(exception);
    } finally {
      _notify();
    }
  }

  Future<void> resendVerification() async {
    error = '';
    try {
      await api.requestMagicLink(
        email,
        pairingId: pendingPairingId,
        locale: _locale.toLanguageTag(),
      );
      notice = _l10n.controllerVerificationResent;
    } on RelayApiException catch (exception) {
      error = _relayErrorMessage(exception);
    } finally {
      _notify();
    }
  }

  Future<void> markVerificationComplete() async {
    try {
      final action = await api.emailStatus(email);
      if (action == 'password') {
        loginStage = LoginStage.password;
        error = '';
      } else {
        error = _l10n.controllerSetPasswordFirst;
      }
    } on RelayApiException catch (exception) {
      error = _relayErrorMessage(exception);
    } finally {
      _notify();
    }
  }

  Future<void> login(String password) async {
    error = '';
    _notify();
    try {
      if (instanceDiscoveryRequired) {
        instanceCapabilities = await api.discoverInstance();
      }
      if (instanceCapabilities?.setupRequired == true) {
        error = locale.languageCode == 'zh'
            ? '请先由部署者在服务器本机完成初始化。'
            : 'The owner must initialize this instance on the server first.';
        return;
      }
      final result = await api.loginWithPassword(
        email: email,
        password: password,
        pairingId: pendingPairingId,
        usernameMode: usernameLogin,
      );
      if (_disposed) return;
      await _secureStore.saveSession(result.sessionToken);
      final stored = await _secureStore.read();
      await _restoreAuthenticated(stored);
      if (phase != AppPhase.ready) phase = AppPhase.needsPairing;
    } on RelayApiException catch (exception) {
      error = _relayErrorMessage(exception);
    } finally {
      _notify();
    }
  }

  Future<void> pair(String code) async {
    final hapticTicket = haptics.begin();
    var pairingId = pendingPairingId;
    if (pairingId == null) {
      final discovered = await discoverPendingBrowserPairings();
      if (!discovered) {
        haptics.cancel(hapticTicket);
        return;
      }
      if (pendingBrowserPairings.isEmpty) {
        error = _l10n.controllerNoPendingComputer;
        _notify();
        haptics.cancel(hapticTicket);
        return;
      }
      if (pendingBrowserPairings.length > 1) {
        error = _l10n.controllerSelectComputer;
        _notify();
        haptics.cancel(hapticTicket);
        return;
      }
      pairingId = pendingPairingId;
      if (pairingId == null) {
        haptics.cancel(hapticTicket);
        return;
      }
    }
    error = '';
    pairingPhase = PairingPhase.deriving;
    _notify();
    RelayKey? candidateKey;
    try {
      final pending = await api.pairingState(pairingId);
      if (pending.protocol != pairingProtocol || pending.status != 'waiting') {
        throw const RelayApiException(
          'Pairing session is no longer waiting.',
          409,
          'pairing_used_or_expired',
        );
      }
      final result = await _pairingPake.respond(
        pairingId: pairingId,
        code: code,
        initiatorShare: pending.initiatorShare,
      );
      final browserToken = randomRelayToken();
      candidateKey = RelayKey.import(result.contentKey);
      final browserId = await api.respondToPairing(
        pairingId: pairingId,
        responderShare: result.responderShare,
        responderConfirm: result.responderConfirm,
        browserTokenHash: sha256Hex(browserToken),
        browserKeyId: candidateKey.keyId,
        browserName: await mobileAuthorizationName(),
        clientIdentity: await mobileClientIdentity(),
      );
      pairingPhase = PairingPhase.waitingForDesktop;
      _notify();
      PairingPublicState? completed;
      for (var attempt = 0; attempt < 40; attempt++) {
        await Future<void>.delayed(RelayConfig.pairingPollInterval);
        if (_disposed) return;
        final current = await api.pairingState(pairingId);
        if (current.status == 'paired') {
          completed = current;
          break;
        }
      }
      if (completed == null ||
          completed.deviceId == null ||
          completed.browserId == null ||
          completed.browserId != browserId) {
        throw const RelayApiException(
          'Desktop pairing confirmation timed out.',
          408,
          'pairing_confirmation_timeout',
        );
      }
      final received = completed.desktopConfirm;
      if (received == null ||
          !constantTimeEquals(
            decodeBase64Url(result.expectedDesktopConfirm),
            decodeBase64Url(received),
          )) {
        throw const RelayApiException(
          'Desktop pairing confirmation did not match.',
          409,
          'pairing_confirmation_failed',
        );
      }
      pairingPhase = PairingPhase.activating;
      api.browserToken = browserToken;
      _notify();
      ServerBootstrap? activated;
      for (var attempt = 0; attempt < 60; attempt++) {
        final snapshot = await api.bootstrap(deviceId: completed.deviceId);
        if (snapshot.device.online && snapshot.catalog != null) {
          await _decryptCatalog(snapshot.catalog!, candidateKey);
          activated = snapshot;
          break;
        }
        await Future<void>.delayed(RelayConfig.pairingPollInterval);
        if (_disposed) return;
      }
      if (activated == null) {
        throw const RelayApiException(
          'Desktop did not come online after pairing.',
          503,
          'desktop_offline',
        );
      }
      if (_disposed) return;
      await _secureStore.savePairing(
        contentKey: result.contentKey,
        deviceId: completed.deviceId!,
        browserId: completed.browserId!,
        browserToken: browserToken,
      );
      if (_disposed) {
        await _secureStore.clearPairing();
        return;
      }
      // Credentials are durable now; a failed cleanup is retried on startup.
      await api.activateClientDevice().catchError((Object _) {});
      _restoreProjectAliases(
        StoredCredentials(
          deviceId: completed.deviceId,
          browserId: completed.browserId,
          projectAliases: _storedProjectAliases,
        ),
      );
      relayKey?.dispose();
      _directReadEpoch++;
      _directTransport?.close();
      _directTransport = null;
      _directReadResults.clear();
      relayKey = candidateKey;
      candidateKey = null;
      await refresh(deviceId: completed.deviceId);
      if (_disposed) return;
      phase = AppPhase.ready;
      haptics.confirm(hapticTicket, RelayHapticEvent.connected);
      pendingPairingId = null;
      pendingBrowserPairings = const [];
      pairingPhase = PairingPhase.idle;
      _startRealtime();
      final visible = _historyVisibleSession;
      if (visible != null) unawaited(loadHistory(visible));
    } on RelayApiException catch (exception) {
      api.browserToken = (await _secureStore.read()).browserToken;
      error = _relayErrorMessage(exception);
      pairingPhase = PairingPhase.idle;
    } on FormatException {
      api.browserToken = (await _secureStore.read()).browserToken;
      error = _l10n.controllerPairingFailed;
      pairingPhase = PairingPhase.idle;
    } catch (_) {
      api.browserToken = (await _secureStore.read()).browserToken;
      error = _l10n.controllerPairingFailed;
      pairingPhase = PairingPhase.idle;
    } finally {
      haptics.cancel(hapticTicket);
      candidateKey?.dispose();
      _notify();
    }
  }

  Future<void> refresh({String? deviceId}) {
    final activeRefresh = _refreshOperation;
    if (activeRefresh != null) return activeRefresh;
    final operation = _performRefresh(deviceId);
    _refreshOperation = operation;
    return operation.whenComplete(() {
      if (identical(_refreshOperation, operation)) _refreshOperation = null;
    });
  }

  Future<void> _performRefresh(String? deviceId) async {
    final generation = _realtimeGeneration;
    refreshing = true;
    _notify();
    try {
      final resolvedDeviceId = deviceId ?? bootstrap?.device.id;
      final raw = await api.bootstrap(deviceId: resolvedDeviceId);
      if (_disposed || !_directoryForeground) return;
      if (expectedAccount != null &&
          raw.email.toLowerCase() != expectedAccount!.toLowerCase()) {
        throw const RelayApiException(
          'Account changed.',
          403,
          'pairing_account_mismatch',
        );
      }
      email = raw.email;
      bootstrap = raw;
      localReadOnly = false;
      if (!connectionSnapshot.realtimeConfirmed) {
        connectionSnapshot = connectionSnapshot.fromBootstrap(
          online: raw.device.online,
          lastSeenAt: raw.device.lastSeenAt,
        );
      }
      if (resolvedDeviceId == null ||
          resolvedDeviceId.isEmpty ||
          relayKey == null) {
        desktopInfo = null;
        _replaceCatalog(
          sessions: const [],
          projects: const [],
          replaceUsage: true,
        );
        return;
      }
      if (raw.device.id != resolvedDeviceId) {
        throw const FormatException('服务器返回了另一台设备。');
      }
      _historyCacheDisabled = false;
      final catalog = raw.catalog == null
          ? (
              sessions: const <RelaySession>[],
              projects: const <RelayProject>[],
              usageByProvider: const <String, ProviderUsageSnapshot>{},
              fileAccessLimited: false,
              desktopInfo: null as RelayDesktopInfo?,
            )
          : await _decryptCatalog(raw.catalog!, relayKey!);
      if (_disposed || !_directoryForeground) return;
      desktopInfo = catalog.desktopInfo;
      if (_supportsOnlineStream && !_realtimePaused) {
        final legacy = _realtimeConnection;
        _realtimeConnection = null;
        unawaited(_realtimeSubscription?.cancel());
        _realtimeSubscription = null;
        unawaited(legacy?.close());
        _connectOnline();
      }
      final fileAccessRecovered =
          catalogFileAccessLimited && !catalog.fileAccessLimited;
      catalogFileAccessLimited = catalog.fileAccessLimited;
      if (fileAccessRecovered) {
        for (final sessionId in _historyFileAccessDenied.toList()) {
          unawaited(loadHistory(sessionId, silent: true));
        }
      }
      _replaceCatalog(
        sessions: desktopInfo?.supportsSessionDirectory == true
            ? sessions
            : catalog.sessions,
        catalogAt: desktopInfo?.supportsSessionDirectory == true
            ? null
            : DateTime.tryParse(raw.catalog?.aad.createdAt ?? ''),
        projects: desktopInfo?.supportsSessionDirectory == true
            ? projects
            : catalog.projects,
        usageByProvider: catalog.usageByProvider,
        replaceUsage: true,
      );

      final eventBudget = Stopwatch()..start();
      for (final frame in raw.events) {
        final cursor = frame.cursor ?? 0;
        if (!_directoryForeground ||
            _disposed ||
            generation != _realtimeGeneration) {
          return;
        }
        if (cursor <= opaqueCursor) continue;
        final event = await _decryptEvent(frame);
        // Catalog refresh and event catch-up can decrypt the same frame.
        // Recheck after the await so a delta is never applied twice.
        if (!_directoryForeground ||
            _disposed ||
            generation != _realtimeGeneration) {
          return;
        }
        if (cursor <= opaqueCursor) continue;
        _applyEvent(event);
        opaqueCursor = cursor;
        // Small decryptions often complete in microtasks. A startup backlog
        // must yield to actual frame / timer events, not just another Future.
        if (eventBudget.elapsedMilliseconds >= 4) {
          await Future<void>.delayed(Duration.zero);
          if (_disposed) return;
          eventBudget.reset();
        }
      }
      error = '';
    } finally {
      refreshing = false;
      _notify();
    }
  }

  Future<
    ({
      List<RelaySession> sessions,
      List<RelayProject> projects,
      Map<String, ProviderUsageSnapshot> usageByProvider,
      bool fileAccessLimited,
      RelayDesktopInfo? desktopInfo,
    })
  >
  _decryptCatalog(OpaqueFrame frame, RelayKey key) async {
    final payload = await _cipher.openJson<Map<String, dynamic>>(
      key,
      frame.envelope,
      frame.aad,
    );
    if (payload['type'] != 'relay.sync_sessions') {
      throw const FormatException('加密会话目录类型无效。');
    }
    final usage = payload['usage'] is Map
        ? jsonMap(payload['usage'])
        : const <String, dynamic>{};
    final usageByProvider = <String, ProviderUsageSnapshot>{};
    for (final provider in const [
      'codex',
      'kimi',
      'claude',
      'opencode',
      'zcode',
    ]) {
      if (usage[provider] is! Map) continue;
      final snapshot = jsonMap(usage[provider]);
      if (snapshot.isEmpty) continue;
      usageByProvider[provider] = ProviderUsageSnapshot.fromJson(snapshot);
    }
    return (
      desktopInfo: payload['desktop'] is Map
          ? RelayDesktopInfo.fromJson(jsonMap(payload['desktop']))
          : null,
      fileAccessLimited: payload['file_access_limited'] == true,
      sessions: jsonMapList(
        payload['sessions'],
      ).map(RelaySession.fromJson).toList(),
      projects: jsonMapList(
        payload['projects'],
      ).map(RelayProject.fromJson).toList(),
      usageByProvider: Map<String, ProviderUsageSnapshot>.unmodifiable(
        usageByProvider,
      ),
    );
  }

  void _replaceCatalog({
    required List<RelaySession> sessions,
    List<RelayProject>? projects,
    Map<String, ProviderUsageSnapshot>? usageByProvider,
    bool replaceUsage = false,
    DateTime? catalogAt,
  }) {
    if (catalogAt != null) {
      final latest = _latestCatalogObservedAt;
      if (latest != null && catalogAt.isBefore(latest)) return;
      _latestCatalogObservedAt = catalogAt;
      for (final session in sessions) {
        if (session.status == 'active') {
          _catalogIdleObservedAt.remove(session.id);
        } else {
          _catalogIdleObservedAt[session.id] = catalogAt;
        }
      }
    }
    for (final session in sessions) {
      if (_directorySessions.containsKey(session.id)) {
        _directorySessions[session.id] = session;
      }
    }
    final selected = activeSessionId == null ? null : activeSession;
    final selectedRoot = selected?.isSubagent == true
        ? activeRootSession
        : null;
    final now = DateTime.now();
    _recentlyCreatedSessions.removeWhere(
      (_, protected) => !protected.expiresAt.isAfter(now),
    );
    final nextIds = sessions.map((session) => session.id).toSet();
    final previousById = {
      for (final session in this.sessions) session.id: session,
    };
    this.sessions = List.unmodifiable([
      for (final incoming in sessions)
        _retainClaudeChoices(incoming, previousById[incoming.id]),
      // Catalogs can lag creation or contain only a recent page of sessions.
      // Absence is not a deletion signal and must never navigate away from
      // the open conversation, even after the creation grace period expires.
      // Prefer incoming records, then the latest local selection snapshot.
      for (final session in [
        selected,
        selectedRoot,
        ..._directorySessions.values,
      ])
        if (session != null && nextIds.add(session.id)) session,
      for (final protected in _recentlyCreatedSessions.values)
        if (nextIds.add(protected.session.id)) protected.session,
    ]);
    _catalogIdleObservedAt.removeWhere((id, _) => !nextIds.contains(id));
    if (projects != null) this.projects = List.unmodifiable(projects);
    if (replaceUsage) {
      this.usageByProvider = Map<String, ProviderUsageSnapshot>.unmodifiable(
        usageByProvider ?? const {},
      );
    }
    _reconcileRuntimeStateWithCatalog(catalogAt: catalogAt);
    final selectionExists =
        activeSessionId != null &&
        this.sessions.any((session) => session.id == activeSessionId);
    if (!selectionExists) {
      activeSessionId = rootSessions.firstOrNull?.id;
    }
    final visible = _historyVisibleSession;
    if (visible != null) {
      final previous = previousById[visible];
      final incoming = this.sessions.where((s) => s.id == visible).firstOrNull;
      final before = DateTime.tryParse(previous?.updatedAt ?? '');
      final after = DateTime.tryParse(incoming?.updatedAt ?? '');
      if (incoming?.forkMode == 'latest' &&
          (previous?.forkMode != 'latest' ||
              (before != null && after != null && after.isAfter(before)))) {
        _hydrateLatestReplyHistory(visible, afterCurrentRead: true);
      }
    }
  }

  // Catalogs can still contain startup placeholders after history has loaded
  // capabilities. Keep the choices, but never restore an old runtime selection:
  // an incoming inherit/default value must still reset the selected policy.
  RelaySession _retainClaudeChoices(
    RelaySession incoming,
    RelaySession? previous,
  ) {
    final options = incoming.raw['session_config_options'];
    final known = previous?.raw['session_config_options'];
    if (incoming.provider != 'claude' ||
        options is! List ||
        known is! List ||
        options.length != 1 ||
        options.single is! Map ||
        options.single['id'] != 'permissions' ||
        options.single['currentValue'] != 'inherit' ||
        (options.single['options'] as List?)?.length != 1) {
      return incoming;
    }
    final richer = known.whereType<Map>().where(
      (config) =>
          config['id'] == 'model' ||
          (config['id'] == 'permissions' &&
              (config['options'] as List?)?.length != 1),
    );
    if (richer.isEmpty) return incoming;
    return RelaySession.fromJson({
      ...incoming.raw,
      'session_config_options': [
        for (final config in known.whereType<Map>())
          if (config['id'] == 'model')
            {...config, 'currentValue': incoming.raw['model'] ?? 'default'}
          else if (config['id'] == 'permissions')
            {...options.single as Map, 'options': config['options']},
      ],
    });
  }

  bool _catalogSessionIsActive(String sessionId) {
    final byId = {for (final session in sessions) session.id: session};
    final session = byId[sessionId];
    if (session == null || session.status != 'active') return false;
    if (!session.isSubagent) return true;
    return byId[session.rootSessionId]?.status == 'active';
  }

  void _reconcileRuntimeStateWithCatalog({DateTime? catalogAt}) {
    final byId = {for (final session in sessions) session.id: session};
    final activeIds = <String>{};
    for (final session in sessions) {
      if (session.status != 'active') continue;
      if (!session.isSubagent ||
          byId[session.rootSessionId]?.status == 'active') {
        activeIds.add(session.id);
      }
    }

    // History pages and older catalogs cannot end a confirmed live turn.
    // A newer catalog remains a recovery path if its terminal event was missed.
    for (final entry in _activeTurnObservedAt.entries) {
      if (catalogAt == null || !catalogAt.isAfter(entry.value)) {
        activeIds.add(entry.key);
      }
    }
    for (final entry in _idleTurnObservedAt.entries) {
      if (catalogAt == null || !catalogAt.isAfter(entry.value)) {
        activeIds.remove(entry.key);
      }
    }
    if (catalogAt != null) {
      _idleTurnObservedAt.removeWhere((_, at) => catalogAt.isAfter(at));
    }
    _activeTurnObservedAt.removeWhere((id, _) => !activeIds.contains(id));
    runningSessions
      ..clear()
      ..addAll(activeIds);
    for (final id in _stopRequests.keys.toList()) {
      if (!activeIds.contains(id)) _finishStopRequest(id);
    }
    _activeTurns.removeWhere((sessionId, _) => !activeIds.contains(sessionId));
    _transientThinking.retain(activeIds);
    _sessionActivities.removeWhere((sessionId, activity) {
      final awaitingAcceptedCommand =
          byId.containsKey(sessionId) && activity.clientMessageId != null;
      return !activeIds.contains(sessionId) && !awaitingAcceptedCommand;
    });
  }

  Future<RelayEvent> _decryptEvent(OpaqueFrame frame) async {
    final key = relayKey;
    if (key == null) throw StateError('配对密钥未解锁。');
    final payload = await _cipher.openJson<Map<String, dynamic>>(
      key,
      frame.envelope,
      frame.aad,
    );
    if (payload['type'] != 'session.event' ||
        payload['session_id'] != frame.sessionId) {
      throw const FormatException('加密事件路由无效。');
    }
    final event = jsonMap(payload['event']);
    if (event['kind'] == 'history.read_progress' &&
        (event['request_id'] is! String ||
            event['request_id'] != payload['request_id'] ||
            event['request_id'] != frame.requestId ||
            event['request_id'] != frame.aad.requestId)) {
      throw const FormatException('history_progress_route');
    }
    return RelayEvent(
      cursor: frame.cursor ?? 0,
      sourceSequence: frame.aad.eventSeq ?? 0,
      eventId: frame.eventId ?? _randomId('evt'),
      sessionId: payload['session_id'] as String,
      agentId: payload['agent_id'] as String?,
      createdAt: payload['created_at'] as String,
      event: event,
    );
  }

  Future<CommandResult> sendEncryptedCommand(
    String type,
    String? sessionId,
    Map<String, dynamic> payload, {
    Duration ttl = const Duration(minutes: 5),
    String? requestId,
  }) => _sendEncryptedCommand(
    type,
    sessionId,
    payload,
    ttl: ttl,
    requestId: requestId,
  );

  Future<CommandResult> _sendEncryptedCommand(
    String type,
    String? sessionId,
    Map<String, dynamic> payload, {
    Duration ttl = const Duration(minutes: 5),
    String? requestId,
    bool forceServer = false,
    void Function(Map<String, dynamic>)? onSealed,
    Future<void> Function(Map<String, dynamic>)? persistSealed,
    DownloadProgressCallback? onResponseProgress,
  }) async {
    if (phase == AppPhase.signedOut) throw StateError('请先登录。');
    if (localReadOnly) throw StateError('离线记录只读，请连接后再操作。');
    final key = relayKey;
    final deviceId = bootstrap?.device.id;
    if (key == null || deviceId == null || deviceId.isEmpty) {
      throw StateError('端到端加密密钥未解锁。');
    }
    final authorizationEpoch = _historyCacheEpoch;
    final id = requestId ?? _randomId('req');
    final now = DateTime.now().toUtc();
    final createdAt = now.toIso8601String();
    final expiresAt = now.add(ttl).toIso8601String();
    final aad = RelayAad(
      direction: 'web_to_relay',
      type: type,
      deviceId: deviceId,
      sessionId: sessionId,
      requestId: id,
      eventSeq: null,
      createdAt: createdAt,
      expiresAt: expiresAt,
    );
    final envelope = await _cipher.sealJson(key, {
      'type': type,
      'request_id': id,
      'device_id': deviceId,
      'session_id': sessionId,
      'payload': payload,
      'issued_at': createdAt,
      'expires_at': expiresAt,
    }, aad);
    final frame = <String, dynamic>{
      'device_id': deviceId,
      'session_id': sessionId,
      'request_id': id,
      'command_type': type,
      'aad': aad.toJson(),
      'envelope': envelope.toJson(),
    };
    bool current() =>
        !_disposed &&
        relayKey == key &&
        bootstrap?.device.id == deviceId &&
        authorizationEpoch == _historyCacheEpoch;
    if (!current()) throw StateError('授权已变化，请重试。');
    onSealed?.call(frame);
    if (persistSealed != null) await persistSealed(frame);
    if (!current()) throw StateError('授权已变化，请重试。');
    if (type == 'transport.event_ack' || type == 'transport.activate') {
      await _directTransport?.send(frame);
      return CommandResult(requestId: id, delivery: 'direct');
    }
    if (!forceServer &&
        directReadsEnabled &&
        _directCommandTypes.contains(type)) {
      if ((_directTransport?.sessionReady == true ||
              (type == 'transport.resume' &&
                  _directTransport?.connected == true)) &&
          _directReadResults.length < 4) {
        final future = _readDirectOrServer(
          type,
          sessionId,
          payload,
          id,
          frame,
          onProgress: onResponseProgress,
        );
        if (_directResponseTypes.contains(type)) {
          _directReadResults[id] = future
              .then<({Map<String, dynamic>? value, Object? error})>(
                (value) => (value: value, error: null),
                onError: (Object error) => (value: null, error: error),
              );
        } else {
          final result = await future;
          if (result['status'] == 'queued') {
            return CommandResult(requestId: id, delivery: 'queued');
          }
        }
        return CommandResult(requestId: id, delivery: 'direct');
      }
      _syncAutomaticRoute();
    }
    final online = _onlineStream;
    if (!forceServer &&
        online?.available == true &&
        onlineReadTypes.contains(type) &&
        _onlineResults.length < 8) {
      final future = _readOnlineOrServer(
        online!,
        type,
        sessionId,
        payload,
        id,
        frame,
      );
      final pending = future
          .then<({Map<String, dynamic>? value, Object? error})>(
            (value) => (value: value, error: null),
            onError: (Object error) => (value: null, error: error),
          );
      _onlineResults[id] = pending;
      Timer(const Duration(minutes: 1), () {
        if (identical(_onlineResults[id], pending)) _onlineResults.remove(id);
      });
      return CommandResult(requestId: id, delivery: 'delivered');
    }
    return api.sendCommand(
      deviceId: deviceId,
      sessionId: sessionId,
      requestId: id,
      commandType: type,
      createdAt: createdAt,
      expiresAt: expiresAt,
      aad: aad,
      envelope: envelope,
    );
  }

  Future<Map<String, dynamic>> waitForEncryptedResponse(
    String requestId, {
    Duration timeout = const Duration(seconds: 20),
    bool retryTransientErrors = false,
    DownloadProgressCallback? onProgress,
    bool preserveCompression = false,
    bool serverOnly = false,
  }) => _waitForEncryptedResponse(
    requestId,
    timeout: timeout,
    retryTransientErrors: retryTransientErrors,
    onProgress: onProgress,
    preserveCompression: preserveCompression,
    serverOnly: serverOnly,
  );

  Future<Map<String, dynamic>> _waitForEncryptedResponse(
    String requestId, {
    Duration timeout = const Duration(seconds: 20),
    bool retryTransientErrors = false,
    DownloadProgressCallback? onProgress,
    bool preserveCompression = false,
    bool serverOnly = false,
    bool Function()? current,
    bool Function(OpaqueFrame)? acceptsFrame,
  }) async {
    final online = serverOnly ? null : _onlineResults.remove(requestId);
    if (online != null) {
      final result = await online.timeout(timeout);
      if (result.error != null) throw result.error!;
      return result.value!;
    }
    final direct = serverOnly ? null : _directReadResults.remove(requestId);
    if (direct != null) {
      _directTransport?.setProgress(
        requestId,
        onProgress == null
            ? null
            : (received, total) =>
                  onProgress(DownloadProgress(received, total)),
      );
      final result = await direct.timeout(
        timeout,
        onTimeout: () {
          throw RelayApiException(
            _l10n.controllerEncryptedResponseTimeout,
            0,
            'response_timeout',
          );
        },
      );
      if (result.error != null) throw result.error!;
      return result.value!;
    }
    final started = DateTime.now();
    while (DateTime.now().difference(started) < timeout) {
      if (_disposed || !_directoryForeground || current?.call() == false) {
        throw const RelayApiException('', 0, 'request_cancelled');
      }
      // Register before fetching: a response notification can arrive while
      // the pending HTTP response is still in flight.
      final wake = Completer<void>();
      Timer? fallback;
      _responseWaiters.add(wake);
      try {
        try {
          final frame = await api.encryptedResponse(
            requestId,
            onProgress: onProgress,
            preserveCompression: preserveCompression,
          );
          if (_disposed || !_directoryForeground || current?.call() == false) {
            throw const RelayApiException('', 0, 'request_cancelled');
          }
          if (frame.requestId != requestId ||
              frame.aad.requestId != requestId ||
              frame.deviceId != bootstrap?.device.id ||
              frame.aad.deviceId != frame.deviceId ||
              frame.aad.direction != 'relay_to_web' ||
              acceptsFrame?.call(frame) == false) {
            throw const FormatException('response_route_invalid');
          }
          final value = await _cipher.openJson<Map<String, dynamic>>(
            relayKey!,
            frame.envelope,
            frame.aad,
          );
          if (current?.call() == false) {
            throw const RelayApiException('', 0, 'request_cancelled');
          }
          if (acceptsFrame != null &&
              (value['type'] != frame.aad.type ||
                  value['request_id'] != requestId ||
                  value['session_id'] != frame.sessionId)) {
            throw const FormatException('response_route_invalid');
          }
          if (const {
                'session.create_result',
                'session.create_error',
                'session.fork_result',
                'session.fork_error',
                'session.web_result',
                'session.web_error',
              }.contains(value['type']) &&
              (frame.sessionId != frame.aad.sessionId ||
                  value['session_id'] != frame.sessionId ||
                  value['type'] != frame.aad.type ||
                  value['request_id'] != requestId)) {
            throw const FormatException('response_route_invalid');
          }
          return value;
        } on RelayApiException catch (exception) {
          // The server already waited. Renew immediately; ordinary pending and
          // old servers still use the notification/one-second fallback below.
          if (exception.status == 404 &&
              exception.code == 'response_wait_timeout') {
            continue;
          }
          final transient =
              retryTransientErrors &&
              (const {
                    'network_timeout',
                    'network_unavailable',
                  }.contains(exception.code) ||
                  const {502, 503, 504}.contains(exception.status));
          if (!transient &&
              exception.status != 404 &&
              !const {
                'response_pending',
                'not_found',
              }.contains(exception.code)) {
            rethrow;
          }
        }
        fallback = Timer(const Duration(seconds: 1), () {
          if (!wake.isCompleted) wake.complete();
        });
        await wake.future;
      } finally {
        fallback?.cancel();
        _responseWaiters.remove(wake);
      }
    }
    throw RelayApiException(
      _l10n.controllerEncryptedResponseTimeout,
      0,
      'response_timeout',
    );
  }

  /// Opens a known child's stored history without inheriting root capabilities.
  Future<void> openAgentConversation(RelayAgent agent) async {
    if (!agent.canOpen) return;
    if (!sessions.any((session) => session.id == agent.threadId)) {
      final root = sessions
          .where((session) => session.id == agent.parentSessionId)
          .firstOrNull;
      if (root == null || root.provider != 'codex') return;
      // A read-agents response can precede the child directory entry. Register
      // only its known identity; do not inherit the parent's write capabilities.
      sessions = [
        ...sessions,
        RelaySession.fromJson({
          'id': agent.threadId,
          'name': agent.name,
          'project': root.project,
          'branch': root.branch,
          'cwd': root.cwd,
          'provider': root.provider,
          'status': agent.isActive ? 'active' : 'idle',
          'updated_at': agent.updatedAt ?? '',
          'is_subagent': true,
          'root_session_id': agent.parentSessionId,
          'supports_steering': false,
          'can_interrupt': false,
          if (agent.model != null) 'model': agent.model,
          if (agent.reasoningEffort != null)
            'reasoning_effort': agent.reasoningEffort,
        }),
      ];
    }
    await selectSession(agent.threadId, waitForHistory: false);
  }

  /// Selects immediately; navigation and notification actions can continue
  /// while cached and remote history load by setting [waitForHistory] to false.
  Future<void> selectSession(
    String sessionId, {
    bool waitForHistory = true,
  }) async {
    final selectionWatch = Stopwatch()..start();
    _selectSessionLocally(sessionId);
    if (messages[sessionId]?.isNotEmpty == true) {
      _historyFrames[sessionId] = (
        selectionWatch,
        {
          'source': 'memory',
          'request_visible': true,
          'selection_started_at_ms': DateTime.now().millisecondsSinceEpoch,
          'message_count': messages[sessionId]!.length,
        },
      );
    } else {
      _historyFrames[sessionId] = (
        selectionWatch,
        {
          'source': 'selection',
          'request_visible': true,
          'selection_started_at_ms': DateTime.now().millisecondsSinceEpoch,
        },
      );
    }
    _notify();
    if (_historyLoaded.contains(sessionId) &&
        (relayKey == null || bootstrap?.device.id == null)) {
      return; // Cached conversations remain usable before connection unlock.
    }
    // Native CLI work can finish without a Relay-owned terminal event. Keep
    // cached content visible, but reconcile durable history on every entry.
    Future<void> refreshHistory() async {
      final epoch = _historyCacheEpoch;
      await loadHistory(sessionId, silent: _historyLoaded.contains(sessionId));
      // A fresh latest page cannot repair an older-page gap. Retry that exact
      // frontier once on re-entry as well, retaining all already shown messages.
      if (!_disposed &&
          epoch == _historyCacheEpoch &&
          deviceOnline &&
          activeSessionId == sessionId &&
          _historyEarlierErrors.contains(sessionId)) {
        await retryHistory(sessionId);
      }
    }

    final loading = refreshHistory();
    if (waitForHistory) {
      await loading;
    } else {
      unawaited(loading);
    }
  }

  void _selectSessionLocally(String sessionId) {
    if (activeSessionId != sessionId) {
      notice = '';
      _approvalNotice = null;
    }
    _historyVisibleSession = sessionId;
    _recentMemorySessions.remove(sessionId);
    _recentMemorySessions.insert(0, sessionId);
    if (_recentMemorySessions.length > 4) _recentMemorySessions.removeLast();
    if (_historyCacheKey != null) {
      _historyStore.pinSession(_historyCacheKey!, sessionId);
      // Disk restoration touches the same snapshot already. Memory-only entry
      // still needs to advance its access order.
      if (_historyCacheRestored.contains(sessionId)) {
        unawaited(
          _historyStore
              .touchSession(_historyCacheKey!, sessionId)
              .catchError((Object _) {}),
        );
      }
    }
    markSessionOpened(sessionId);
    activeSessionId = sessionId;
    _liveReplies.retainSession(sessionId);
  }

  bool sessionHasUnopenedCompletion(RelaySession session) {
    if (session.status == 'active') return false;
    final version = session.updatedAt.trim();
    if (version.isEmpty) return false;
    final openedVersion = _openedSessionVersions[session.id];
    if (openedVersion == null || openedVersion.isEmpty) return true;
    final updatedAt = DateTime.tryParse(version);
    final openedAt = DateTime.tryParse(openedVersion);
    if (updatedAt != null && openedAt != null) {
      return updatedAt.isAfter(openedAt);
    }
    return version != openedVersion;
  }

  void markAllSessionsOpened() {
    final unread = sessions.where(
      (session) => !session.isSubagent && sessionHasUnopenedCompletion(session),
    );
    final versions = {
      for (final session in unread) session.id: session.updatedAt.trim(),
    };
    if (versions.isEmpty) return;
    _openedSessionVersions = Map.unmodifiable({
      ..._openedSessionVersions,
      ...versions,
    });
    final snapshot = _openedSessionVersions;
    _openedSessionVersionsWrite = _openedSessionVersionsWrite
        .catchError((_) {})
        .then((_) => _secureStore.saveOpenedSessionVersions(snapshot))
        .catchError((_) {});
    _notify();
  }

  void markSessionOpened(String sessionId) {
    final session = sessions
        .where((candidate) => candidate.id == sessionId)
        .firstOrNull;
    final version = session?.updatedAt.trim() ?? '';
    if (version.isEmpty || _openedSessionVersions[sessionId] == version) return;
    _openedSessionVersions = Map.unmodifiable({
      ..._openedSessionVersions,
      sessionId: version,
    });
    final snapshot = _openedSessionVersions;
    _openedSessionVersionsWrite = _openedSessionVersionsWrite
        .catchError((_) {})
        .then((_) => _secureStore.saveOpenedSessionVersions(snapshot))
        .catchError((_) {});
    _notify();
  }

  Future<List<RelayMessage>> _visibleHistoryMessages(
    List<int> key,
    String sessionId,
    List<RelayMessage> items,
  ) async {
    while (true) {
      final generation = _historyDeletionGeneration;
      final deleting = Set<String>.of(_pendingHistoryDeletes[sessionId] ?? {});
      final visible = await _historyStore.withoutDeleted(key, sessionId, items);
      // A deletion may finish committing after the query captured its rows.
      // Renew that authenticated query rather than keep a second tombstone cache.
      if (generation != _historyDeletionGeneration) continue;
      deleting.addAll(_pendingHistoryDeletes[sessionId] ?? {});
      return visible.where((m) => !deleting.contains(m.id)).toList();
    }
  }

  Future<void> loadHistory(
    String sessionId, {
    bool earlier = false,
    bool silent = false,
    bool localOnly = false,
  }) {
    final existing = _historyReads[sessionId];
    if (existing != null) return existing;
    final operation = _loadHistory(
      sessionId,
      earlier: earlier,
      silent: silent,
      localOnly: localOnly,
    );
    _historyReads[sessionId] = operation;
    return operation.whenComplete(() {
      if (identical(_historyReads[sessionId], operation)) {
        _historyReads.remove(sessionId);
      }
    });
  }

  Future<void> _loadHistory(
    String sessionId, {
    bool earlier = false,
    bool silent = false,
    bool localOnly = false,
  }) async {
    if (!_directoryForeground || historyLoading.contains(sessionId)) return;
    if (earlier && historyHasMore[sessionId] == false) return;
    _recentMemorySessions.remove(sessionId);
    _recentMemorySessions.insert(0, sessionId);
    if (_recentMemorySessions.length > 4) _recentMemorySessions.removeLast();
    historyLoading.add(sessionId);
    if (earlier) historyEarlierLoading.add(sessionId);
    var sourceAtRequest = _sessionSourceSequences[sessionId] ?? 0;
    final epoch = _historyCacheEpoch;
    final watch = Stopwatch()..start();
    final requestVisible = _historyVisibleSession == sessionId;
    final requestId = _randomId('history');
    final startedAt = DateTime.now().millisecondsSinceEpoch;
    _historyLoadProgress[sessionId] = HistoryLoadProgress(
      requestId: requestId,
      readElapsed: () => watch.elapsed,
      phase: localOnly ? HistoryLoadPhase.restoring : HistoryLoadPhase.sending,
    );
    var fromCache = false;
    final requestedBefore = earlier ? historyCursors[sessionId] : null;
    final preserveHistoryFrontier =
        !earlier &&
        _historyLoaded.contains(sessionId) &&
        (messages[sessionId]?.isNotEmpty ?? false) &&
        historyHasMore.containsKey(sessionId);
    var commandPostedMs = 0.0;
    var receivedMs = 0.0;
    var active = true;
    var networkApplied = false;
    bool current() =>
        active &&
        epoch == _historyCacheEpoch &&
        !_disposed &&
        _directoryForeground &&
        _historyLoadProgress[sessionId]?.requestId == requestId;
    Future<({Map<String, dynamic>? value, Object? error, StackTrace? stack})>
    fetchHistory() async {
      try {
        await sendEncryptedCommand(
          'session.read_history',
          sessionId,
          {
            'limit': 500,
            'before': requestedBefore,
            'performance_trace_id': requestId,
            'include_agent_details': false,
            'include_progress': requestVisible && !localOnly,
            'max_bytes': 1024 * 1024,
          },
          ttl: historyRequestTimeout,
          requestId: requestId,
        );
        commandPostedMs = watch.elapsedMicroseconds / 1000;
        _setHistoryProgressPhase(
          sessionId,
          requestId,
          HistoryLoadPhase.waiting,
        );
        final result = await _waitForEncryptedResponse(
          requestId,
          timeout: historyRequestTimeout,
          current: current,
          preserveCompression: true,
          onProgress: requestVisible && !localOnly
              ? (download) =>
                    _setHistoryTransferProgress(sessionId, requestId, download)
              : null,
        );
        receivedMs = watch.elapsedMicroseconds / 1000;
        if (result['type'] != 'session.history_error') {
          _setHistoryProgressPhase(
            sessionId,
            requestId,
            HistoryLoadPhase.preparing,
            responseReady: true,
          );
        }
        return (value: result, error: null, stack: null);
      } catch (error, stack) {
        // Observe failures immediately even while SQLite is still restoring.
        return (value: null, error: error, stack: stack);
      }
    }

    // Latest-page requests are independent of the disk cache. Older pages
    // remain cache-first to avoid sending a request for an already cached page.
    final pendingResponse = !localOnly && !earlier && deviceOnline
        ? fetchHistory()
        : null;
    Future<bool> restoreCache() async {
      if (((earlier && requestedBefore != null) ||
              (!earlier && !_historyCacheRestored.contains(sessionId))) &&
          await _ensureHistoryCache()) {
        if (!current()) return false;
        final cacheKey = List<int>.of(_historyCacheKey!);
        Future<void>? previewRead;
        var cacheApplied = false;
        Future<void> publishPreview(HistoryPage preview) async {
          try {
            if (!current() || networkApplied) return;
            final visible = await _visibleHistoryMessages(
              cacheKey,
              sessionId,
              preview.messages,
            );
            if (!current() || networkApplied || cacheApplied) {
              return;
            }
            (_historyCacheVersions[sessionId] ??= {}).addAll({
              for (final m in visible) m.id: m,
            });
            messages[sessionId] = _mergeHistoryMessages(
              sessionId,
              visible,
              messages[sessionId] ?? const [],
            );
            final metrics = <String, Object?>{
              'trace_id': requestId,
              'source': 'sqlite-preview',
              'request_visible': _historyVisibleSession == sessionId,
              'cache_read_ms': watch.elapsedMicroseconds / 1000,
              'message_count': visible.length,
            };
            _setHistoryFrame(sessionId, watch, metrics);
            _recordHistoryPerformance(metrics);
            _notify();
          } catch (_) {
            _recordHistoryPerformance({'stage': 'cache_read_failed'});
          }
        }

        try {
          HistoryPage? cached;
          if (earlier) {
            cached = await _historyStore.readPage(
              cacheKey,
              sessionId,
              before: requestedBefore,
            );
          } else {
            final snapshot = await _historyStore.readLatest(
              cacheKey,
              sessionId,
              // Resume can start before the route is mounted or a Home tap.
              // Keep the authenticated preview ready while the full checkpoint
              // decodes; it does not establish page coverage or replace it.
              onPreview: (preview) {
                previewRead = publishPreview(preview);
              },
            );
            await previewRead;
            cached = snapshot.page;
            final recent = snapshot.recent;
            final pageIds = cached?.messages.map((m) => m.id).toSet() ?? {};
            final newest = cached?.messages.lastOrNull?.createdAt ?? '';
            final extendsPage =
                cached != null &&
                recent != null &&
                recent.messages.any(
                  (m) =>
                      !pageIds.contains(m.id) &&
                      m.createdAt.compareTo(newest) >= 0,
                );
            cached ??= recent;
            if (cached != null && recent != null && cached != recent) {
              cached = HistoryPage(
                messages: _mergeMessages([
                  ...cached.messages,
                  ...recent.messages,
                ]),
                nextCursor: cached.nextCursor,
                hasMore: cached.hasMore || extendsPage,
                agents: const [],
                sessions: const [],
              );
            }
          }
          if (!current() || networkApplied) return false;
          _historyCacheRestored.add(sessionId);
          if (cached != null) {
            fromCache = true;
            final cachedSource = cached.messages.fold<int>(
              0,
              (value, m) => max(value, m.sourceSequence),
            );
            sourceAtRequest = max(sourceAtRequest, cachedSource);
            _sessionSourceSequences[sessionId] = max(
              _sessionSourceSequences[sessionId] ?? 0,
              cachedSource,
            );
            (_historyCacheVersions[sessionId] ??= {}).addAll({
              for (final message in cached.messages) message.id: message,
            });
            final visible = await _visibleHistoryMessages(
              cacheKey,
              sessionId,
              cached.messages,
            );
            if (!current() || networkApplied) return false;
            final existing = messages[sessionId] ?? const <RelayMessage>[];
            messages[sessionId] = _mergeHistoryMessages(
              sessionId,
              visible,
              existing,
            );
            _liveReplies.resetSession(sessionId);
            if (!preserveHistoryFrontier) {
              historyCursors[sessionId] = cached.nextCursor;
              historyHasMore[sessionId] = cached.hasMore;
            }
            final metrics = <String, Object?>{
              'trace_id': requestId,
              'source': 'sqlite',
              'request_visible': requestVisible,
              'cache_read_ms': watch.elapsedMicroseconds / 1000,
              'message_count': visible.length,
            };
            _setHistoryFrame(sessionId, watch, metrics);
            _recordHistoryPerformance(metrics);
            cacheApplied = true;
            _notify();
            return true;
          }
        } catch (_) {
          _recordHistoryPerformance({'stage': 'cache_read_failed'});
        } finally {
          await previewRead;
          cacheKey.fillRange(0, cacheKey.length, 0);
        }
      }
      return false;
    }

    final cacheRead = restoreCache();
    _notify();
    try {
      await (() async {
        if (earlier || localOnly || pendingResponse == null) {
          if (await cacheRead && earlier) return;
        } else {
          // Either source can publish the first readable frame. The cache task
          // observes its own failures and may finish after the network response.
          await Future.any<void>([
            cacheRead.then((_) {}),
            pendingResponse.then((_) {}),
          ]);
        }
        if (localOnly || !deviceOnline || !current()) {
          return;
        }
        final response = await (pendingResponse ?? fetchHistory());
        if (!current()) return;
        if (response.error != null) {
          Error.throwWithStackTrace(response.error!, response.stack!);
        }
        final result = response.value!;
        if (result['type'] == 'session.history_error') {
          throw RelayApiException(
            result['error'] as String? ?? _l10n.controllerHistoryReadFailed,
            0,
            result['error_code'] == 'file_access_denied'
                ? 'file_access_denied'
                : 'history_error',
          );
        }
        final parsed = HistoryPage.fromJson(result);
        var page = HistoryPage(
          messages: parsed.messages
              .map(
                (m) => m.copyWith(
                  sourceSequence: m.sourceSequence == 0
                      ? sourceAtRequest
                      : m.sourceSequence,
                ),
              )
              .toList(),
          nextCursor: parsed.nextCursor,
          hasMore: parsed.hasMore,
          agents: parsed.agents,
          sessions: parsed.sessions,
        );
        await _ensureHistoryCache();
        if (!current()) return;
        var pendingInput = const <RelayMessage>[];
        if (_historyCacheKey != null) {
          try {
            pendingInput = await _historyStore.readPendingMessages(
              _historyCacheKey!,
              sessionId,
            );
            final visible = await _visibleHistoryMessages(
              _historyCacheKey!,
              sessionId,
              page.messages,
            );
            page = HistoryPage(
              messages: visible,
              nextCursor: parsed.nextCursor,
              hasMore: parsed.hasMore,
              agents: parsed.agents,
              sessions: parsed.sessions,
            );
          } catch (_) {
            _recordHistoryPerformance({'stage': 'cache_read_failed'});
            // Failed authentication of a durable deletion cannot authorize the
            // network copy to resurrect the removed message.
            throw const RelayApiException('', 0, 'history_error');
          }
          if (!current()) return;
        }
        final currentIds = (messages[sessionId] ?? const <RelayMessage>[])
            .where((m) => m.kind != 'local.user.message')
            .map((m) => m.id)
            .toSet();
        final latestHasGap =
            !earlier &&
            page.hasMore &&
            page.messages.isNotEmpty &&
            currentIds.isNotEmpty &&
            !page.messages.any((m) => currentIds.contains(m.id));
        final updateHistoryFrontier = !preserveHistoryFrontier || latestHasGap;
        agents = _mergeAgents(agents, page.agents);
        sessions = _mergeSessions(sessions, page.sessions);
        _reconcileRuntimeStateWithCatalog();
        final existing = messages[sessionId] ?? const <RelayMessage>[];
        messages[sessionId] = _mergeHistoryMessages(
          sessionId,
          page.messages,
          _mergeMessages([...pendingInput, ...existing]),
        );
        if (updateHistoryFrontier) {
          historyCursors[sessionId] = page.nextCursor;
          historyHasMore[sessionId] = page.hasMore;
        }
        _liveReplies.resetSession(sessionId);
        _queueHistoryCache(sessionId, before: requestedBefore, page: page);
        final metrics = <String, Object?>{
          'trace_id': requestId,
          'source': 'network',
          'request_visible': requestVisible,
          'earlier': earlier,
          'request_started_at_ms': startedAt,
          'command_posted_ms': commandPostedMs,
          'response_received_ms': receivedMs,
          'merged_ms': watch.elapsedMicroseconds / 1000,
          'response_plaintext_bytes': utf8.encode(jsonEncode(result)).length,
          'message_count': page.messages.length,
          'cache_restored': fromCache,
          if (result['performance'] is Map)
            'desktop': {
              for (final name in [
                'desktop_received_at_ms',
                'history_ready_at_ms',
                'history_started_at_ms',
                'command_wait_ms',
                'history_read_ms',
                'message_count',
                'index_read_bytes',
                'index_parse_ms',
              ])
                if ((result['performance'] as Map)[name] is num)
                  name: (result['performance'] as Map)[name],
            },
        };
        _recordHistoryPerformance(metrics);
        networkApplied = true;
        _setHistoryFrame(sessionId, watch, metrics);
        _historyFileAccessDenied.remove(sessionId);
        // A background latest-page success does not retry a failed older page.
        if (earlier || !_historyEarlierErrors.contains(sessionId)) {
          _clearHistoryError(sessionId);
        }
        if (!earlier) _historyLoaded.add(sessionId);
      })().timeout(
        historyReadTimeout,
        onTimeout: () {
          throw RelayApiException(
            _l10n.controllerEncryptedResponseTimeout,
            0,
            'response_timeout',
          );
        },
      );
    } on RelayApiException catch (exception) {
      if (!current()) return;
      _recordHistoryPerformance({
        'trace_id': requestId,
        'source': 'network',
        'failed_ms': watch.elapsedMicroseconds / 1000,
        'cache_restored': fromCache,
      });
      final permissionDenied = exception.code == 'file_access_denied';
      if (permissionDenied) _historyFileAccessDenied.add(sessionId);
      if ((!silent && !fromCache && (messages[sessionId]?.isEmpty ?? true)) ||
          earlier ||
          permissionDenied) {
        if (earlier) {
          _historyEarlierErrors.add(sessionId);
        } else {
          _historyEarlierErrors.remove(sessionId);
        }
        // History failures belong to this conversation, including requests that
        // finish after navigation. Never overwrite an unrelated action error.
        _historyErrors[sessionId] = _relayErrorMessage(exception);
      }
    } finally {
      active = false;
      if (epoch == _historyCacheEpoch &&
          _historyLoadProgress[sessionId]?.requestId == requestId) {
        historyLoading.remove(sessionId);
        historyEarlierLoading.remove(sessionId);
        _recordHistoryPhase(_historyLoadProgress[sessionId]!);
        _historyLoadProgress.remove(sessionId);
      }
      _trimHistoryMemory();
      _notify();
    }
  }

  bool agentActivityLoadingForSession(String sessionId) =>
      _agentActivityLoading.contains(sessionId);

  String? agentActivityErrorForSession(String sessionId) =>
      _agentActivityErrors[sessionId];

  Future<void> refreshAgentActivity(String sessionId) async {
    if (_agentActivityLoading.contains(sessionId)) return;
    final readBaseline = {for (final agent in agents) agent.id: agent};
    _agentActivityLoading.add(sessionId);
    _agentActivityErrors.remove(sessionId);
    _notify();
    try {
      final requestId = _randomId('agents');
      await sendEncryptedCommand(
        'session.read_agents',
        sessionId,
        const {},
        ttl: const Duration(seconds: 20),
        requestId: requestId,
      );
      final result = await waitForEncryptedResponse(requestId);
      if (result['type'] == 'session.agents_error') {
        throw RelayApiException(
          _l10n.controllerAgentRefreshFailed,
          0,
          'agents_error',
        );
      }
      final refreshed = jsonMapList(
        result['agents'],
      ).map(RelayAgent.fromJson).toList(growable: false);
      agents = _mergeAgents(agents, refreshed, readBaseline: readBaseline);
    } on Object {
      _agentActivityErrors[sessionId] = _l10n.controllerAgentRefreshFailed;
    } finally {
      _agentActivityLoading.remove(sessionId);
      _notify();
    }
  }

  Future<void> retryHistory(String sessionId) => loadHistory(
    sessionId,
    earlier: _historyEarlierErrors.contains(sessionId),
  );

  void _clearHistoryError(String sessionId) {
    _historyEarlierErrors.remove(sessionId);
    _historyErrors.remove(sessionId);
  }

  int _conversationImagePriority(String sessionId, String attachmentId) {
    // Use message order, not widget construction order: older pages can mount
    // after the newest page and must not displace its pending thumbnails.
    final items = messages[sessionId] ?? const <RelayMessage>[];
    var rank = 0;
    for (final message in items) {
      for (final attachment in message.attachments) {
        rank += 1;
        if (attachment.id == attachmentId) {
          return (sessionId == activeSessionId ? 1000000000 : 0) + rank;
        }
      }
    }
    return 0;
  }

  Future<Map<String, dynamic>> requestLocalWeb(
    String sessionId,
    Map<String, dynamic> payload, {
    bool open = false,
    DownloadProgressCallback? onProgress,
  }) async {
    if (desktopInfo?.supportsLocalWeb != true) {
      throw const RelayApiException('', 0, 'web_desktop_update_required');
    }
    final key = relayKey;
    final deviceId = bootstrap?.device.id;
    final requestId = _randomId('web');
    // All requests, including POSTs, use existing durable mutation admission.
    // Transport fallback retains the request ID/envelope; no fresh-ID retry.
    await _sendEncryptedCommand(
      open ? 'session.web_open' : 'session.web_request',
      sessionId,
      payload,
      ttl: const Duration(seconds: 35),
      requestId: requestId,
      onResponseProgress: onProgress,
    );
    final result = await waitForEncryptedResponse(
      requestId,
      timeout: const Duration(seconds: 40),
      retryTransientErrors: true,
      onProgress: onProgress,
      preserveCompression: true,
    );
    if (_disposed || relayKey != key || bootstrap?.device.id != deviceId) {
      throw const RelayApiException('', 0, 'web_preview_expired');
    }
    if (result['request_id'] != requestId ||
        result['session_id'] != sessionId) {
      throw const FormatException('web_response_route_invalid');
    }
    if (result['type'] != 'session.web_result') {
      throw RelayApiException(
        '',
        0,
        result['error_code'] as String? ?? 'web_request_failed',
      );
    }
    return result;
  }

  Future<Uint8List> loadAttachment(
    String sessionId,
    RelayAttachment attachment, {
    RelayAttachmentVariant variant = RelayAttachmentVariant.original,
    DownloadProgressCallback? onProgress,
  }) {
    final cacheKey = jsonEncode([
      bootstrap?.device.id,
      relayKey?.keyId,
      sessionId,
      attachment.id,
      variant.name,
    ]);
    final cached = _attachmentCache.remove(cacheKey);
    if (cached != null) {
      if (DateTime.now().isBefore(cached.expiresAt)) {
        _attachmentCache[cacheKey] = cached;
        if (attachment.isImage && _imageCacheTouches.add(cacheKey)) {
          unawaited(
            _queueImageCache(
              sessionId,
              attachment,
              variant,
            ).whenComplete(() => _imageCacheTouches.remove(cacheKey)),
          );
        }
        onProgress?.call(
          DownloadProgress(cached.bytes.length, cached.bytes.length),
        );
        return Future.value(cached.bytes);
      }
      _attachmentCacheBytes -= cached.bytes.lengthInBytes;
    }
    final active = _attachmentLoads[cacheKey];
    if (active != null) {
      active.listen(onProgress);
      return active.future;
    }
    final tracked = _AttachmentLoad()..listen(onProgress);
    final cacheGeneration = _attachmentCacheGeneration;
    final authorization = relayKey;
    final deviceId = bootstrap?.device.id;
    Future<Uint8List> load() => _loadAttachment(
      sessionId,
      attachment,
      variant,
      cacheKey,
      cacheGeneration,
      tracked.report,
    );
    tracked.future =
        (() async {
          if (attachment.isImage) {
            // Disk hits bypass the network queue, including while the computer is
            // offline. The same authenticated download remains the miss fallback.
            final bytes = await _readCachedImage(
              sessionId,
              attachment,
              variant,
            );
            if (_disposed ||
                cacheGeneration != _attachmentCacheGeneration ||
                !identical(relayKey, authorization) ||
                bootstrap?.device.id != deviceId) {
              throw const FormatException('Attachment authorization changed.');
            }
            if (bytes != null) {
              _rememberAttachment(cacheKey, attachment, variant, bytes);
              tracked.report(DownloadProgress(bytes.length, bytes.length));
              return bytes;
            }
            return _imageLoadQueue.run(
              load,
              priority: () => variant == RelayAttachmentVariant.original
                  ? 2000000000
                  : _conversationImagePriority(sessionId, attachment.id),
              onWaiting: () => tracked.report(
                const DownloadProgress(0, null, waiting: true),
              ),
              onStart: () => tracked.report(const DownloadProgress(0, null)),
            );
          }
          return load();
        })().whenComplete(() {
          if (identical(_attachmentLoads[cacheKey], tracked)) {
            _attachmentLoads.remove(cacheKey);
          }
        });
    _attachmentLoads[cacheKey] = tracked;
    return tracked.future;
  }

  Future<Uint8List?> _readCachedImage(
    String sessionId,
    RelayAttachment attachment,
    RelayAttachmentVariant variant,
  ) async {
    try {
      if (!await _ensureHistoryCache()) return null;
      final key = List<int>.of(_historyCacheKey!);
      try {
        final cached = await _imageCacheStore.read(
          key,
          sessionId,
          attachment.id,
          variant,
        );
        if (cached != null || variant != RelayAttachmentVariant.preview) {
          return cached;
        }
        // Older computers may only provide originals. Reuse that cached image
        // for thumbnail generation rather than retrying an unsupported preview.
        return await _imageCacheStore.read(
          key,
          sessionId,
          attachment.id,
          RelayAttachmentVariant.original,
        );
      } finally {
        key.fillRange(0, key.length, 0);
      }
    } on Object {
      // A damaged/unavailable cache never blocks an authenticated network read.
      return null;
    }
  }

  Future<void> _queueImageCache(
    String sessionId,
    RelayAttachment attachment,
    RelayAttachmentVariant variant, {
    Uint8List? bytes,
  }) {
    final epoch = _historyCacheEpoch;
    final operation = _imageCacheWrites
        .then((_) async {
          if (_disposed ||
              _historyCacheDisabled ||
              epoch != _historyCacheEpoch ||
              _historyCacheKey == null) {
            return;
          }
          final key = List<int>.of(_historyCacheKey!);
          try {
            if (bytes == null) {
              await _imageCacheStore.touch(key, sessionId, attachment.id);
            } else {
              await _imageCacheStore.put(
                key,
                sessionId,
                attachment.id,
                variant,
                bytes,
              );
            }
          } finally {
            key.fillRange(0, key.length, 0);
          }
        })
        .catchError((Object _) {});
    _imageCacheWrites = operation;
    return operation;
  }

  Future<Uint8List> _loadAttachment(
    String sessionId,
    RelayAttachment attachment,
    RelayAttachmentVariant variant,
    String cacheKey,
    int cacheGeneration,
    DownloadProgressCallback onProgress,
  ) async {
    final ranges = AttachmentRanges();
    final deviceId = bootstrap?.device.id;
    final key = relayKey;
    while (!ranges.complete) {
      if (_disposed ||
          !_directoryForeground ||
          cacheGeneration != _attachmentCacheGeneration ||
          bootstrap?.device.id != deviceId ||
          !identical(relayKey, key)) {
        throw const FormatException('Attachment authorization changed.');
      }
      final requestId = _randomId('attachment');
      await sendEncryptedCommand(
        'session.read_attachment',
        sessionId,
        {
          'attachment_id': attachment.id,
          if (attachment.isImage) 'variant': variant.name,
          'offset': ranges.offset,
          'max_bytes': AttachmentRanges.partBytes,
        },
        ttl: const Duration(seconds: 30),
        requestId: requestId,
      );
      final result = await waitForEncryptedResponse(
        requestId,
        timeout: const Duration(seconds: 30),
        retryTransientErrors: true,
        onProgress: ranges.offset == 0
            ? onProgress
            : (progress) {
                final remaining = min(
                  AttachmentRanges.partBytes,
                  (ranges.total ?? ranges.offset) - ranges.offset,
                );
                onProgress(
                  DownloadProgress(
                    ranges.offset +
                        ((progress.fraction ?? 0) * remaining).round(),
                    ranges.total,
                  ),
                );
              },
      );
      if (_disposed ||
          !_directoryForeground ||
          cacheGeneration != _attachmentCacheGeneration ||
          bootstrap?.device.id != deviceId ||
          !identical(relayKey, key)) {
        throw const FormatException('Attachment authorization changed.');
      }
      if (result['type'] == 'session.attachment_error') {
        final code = result['error_code'] as String?;
        throw RelayApiException(
          switch (code) {
            'attachment_too_large' => _l10n.controllerAttachmentTooLarge,
            'attachment_unsupported' => _l10n.controllerAttachmentUnsupported,
            'attachment_gone' => _l10n.controllerAttachmentGone,
            _ =>
              result['error'] as String? ??
                  _l10n.controllerAttachmentReadFailed,
          },
          0,
          code ?? 'attachment_error',
        );
      }
      if (result['type'] != 'session.attachment' ||
          (result['attachment_id'] != null &&
              result['attachment_id'] != attachment.id) ||
          (result['session_id'] != null && result['session_id'] != sessionId)) {
        throw const FormatException('Attachment response route is invalid.');
      }
      ranges.append(result);
      if (result.containsKey('offset')) {
        onProgress(DownloadProgress(ranges.offset, ranges.total));
      }
    }
    final bytes = ranges.takeBytes();
    if (attachment.isImage) {
      // Cache only fully reassembled, authenticated bytes. Partial/failed reads
      // and account changes never create a persistent image entry.
      await _queueImageCache(sessionId, attachment, variant, bytes: bytes);
      if (_disposed ||
          !_directoryForeground ||
          cacheGeneration != _attachmentCacheGeneration ||
          !identical(relayKey, key) ||
          bootstrap?.device.id != deviceId) {
        throw const FormatException('Attachment authorization changed.');
      }
    }
    _rememberAttachment(cacheKey, attachment, variant, bytes);
    return bytes;
  }

  void _rememberAttachment(
    String cacheKey,
    RelayAttachment attachment,
    RelayAttachmentVariant variant,
    Uint8List bytes,
  ) {
    final cacheDuration = switch (variant) {
      _
          when attachment.isImage &&
              bytes.lengthInBytes <= _imagePreviewLimitBytes =>
        _imagePreviewCacheTtl,
      RelayAttachmentVariant.original
          when !attachment.isImage && bytes.lengthInBytes <= 1024 * 1024 =>
        _fileAttachmentCacheTtl,
      _ => null,
    };
    if (cacheDuration != null) {
      final replaced = _attachmentCache.remove(cacheKey);
      if (replaced != null) {
        _attachmentCacheBytes -= replaced.bytes.lengthInBytes;
      }
      while (_attachmentCache.isNotEmpty &&
          _attachmentCacheBytes + bytes.lengthInBytes >
              _attachmentCacheLimitBytes) {
        final oldestKey = _attachmentCache.keys.first;
        _attachmentCacheBytes -= _attachmentCache
            .remove(oldestKey)!
            .bytes
            .lengthInBytes;
      }
      _attachmentCache[cacheKey] = (
        bytes: bytes,
        expiresAt: DateTime.now().add(cacheDuration),
      );
      _attachmentCacheBytes += bytes.lengthInBytes;
    }
  }

  Future<void> _persistPendingInput(
    String session,
    RelayMessage message,
    Map<String, dynamic> frame,
  ) {
    final epoch = _historyCacheEpoch;
    final operation = _pendingInputWrites.catchError((_) {}).then((_) async {
      if (epoch != _historyCacheEpoch ||
          _historyCacheDisabled ||
          _disposed ||
          relayKey == null ||
          bootstrap?.device.id == null) {
        throw const RelayApiException('', 0, 'request_cancelled');
      }
      if (!await _ensureHistoryCache()) {
        throw const RelayApiException('', 0, 'pending_input_save_failed');
      }
      if (epoch != _historyCacheEpoch || _historyCacheDisabled) {
        throw const RelayApiException('', 0, 'request_cancelled');
      }
      final key = List<int>.of(_historyCacheKey!);
      final watch = Stopwatch()..start();
      try {
        await _historyStore.savePending(key, session, message, frame);
        _recordHistoryPerformance({
          'stage': 'pending_input_save',
          'sealed': frame.isNotEmpty,
          'write_ms': watch.elapsedMilliseconds,
          'success': true,
        });
      } catch (_) {
        _recordHistoryPerformance({
          'stage': 'pending_input_save',
          'sealed': frame.isNotEmpty,
          'write_ms': watch.elapsedMilliseconds,
          'success': false,
        });
        if (epoch != _historyCacheEpoch || _historyCacheDisabled || _disposed) {
          throw const RelayApiException('', 0, 'request_cancelled');
        }
        throw const RelayApiException('', 0, 'pending_input_save_failed');
      } finally {
        key.fillRange(0, key.length, 0);
      }
    });
    _pendingInputWrites = operation.catchError((_) {});
    return operation;
  }

  Future<MessageSendOutcome> sendMessage(
    String content, {
    List<UploadAttachment> attachments = const [],
  }) async {
    final session = activeSession;
    final text = content.trim();
    if (session == null ||
        (text.isEmpty && attachments.isEmpty) ||
        session.isSubagent ||
        configuringSessions.contains(session.id) ||
        isStoppingSession(session.id)) {
      return MessageSendOutcome.rejected;
    }
    if (!deviceOnline) {
      error = _l10n.workbenchOfflineQueued;
      _notify();
      return MessageSendOutcome.rejected;
    }
    final totalBytes = attachments.fold<int>(
      0,
      (sum, attachment) => sum + attachment.bytes.length,
    );
    if (attachments.length > maxUploadAttachments) {
      error = _l10n.controllerUploadTooMany(maxUploadAttachments);
      _notify();
      return MessageSendOutcome.rejected;
    }
    if (totalBytes > maxUploadBytes) {
      error = _l10n.controllerUploadTotalTooLarge;
      _notify();
      return MessageSendOutcome.rejected;
    }
    if (attachments.any(
      (attachment) =>
          attachment.bytes.isEmpty ||
          !supportedUploadMimeTypes.contains(attachment.mimeType),
    )) {
      error = _l10n.controllerUploadUnsupported;
      _notify();
      return MessageSendOutcome.rejected;
    }
    if (runningSessions.contains(session.id) &&
        !session.supportsSteering &&
        !session.supportsInterruptAndSend) {
      error = _l10n.controllerSteeringUnsupported;
      _notify();
      return MessageSendOutcome.rejected;
    }
    final authorizationKey = relayKey;
    final authorizationDevice = bootstrap?.device.id;
    final authorizationEpoch = _historyCacheEpoch;
    bool currentAuthorization() =>
        !_disposed &&
        relayKey == authorizationKey &&
        bootstrap?.device.id == authorizationDevice &&
        _historyCacheEpoch == authorizationEpoch;
    // Freeze the settings with this message, including transport retries.
    final selectedSettings = _codexMessageSettings[session.id];
    final runtimeSettings = <String, String>{
      if (supportsMessageModelSettings(session)) ...{
        if (selectedSettings?['model'] case final String model) 'model': model,
        if (selectedSettings?['effort'] case final String effort)
          'effort': effort,
      },
      if (supportsMessagePermissionSettings(session) &&
          selectedSettings?['permissions'] != null)
        'permissions': selectedSettings!['permissions']!,
    };
    final clientMessageId = _randomId('msg');
    _upsertMessage(
      session.id,
      RelayMessage(
        id: 'local_$clientMessageId',
        role: 'user',
        content: text,
        createdAt: DateTime.now().toUtc().toIso8601String(),
        kind: 'local.user.message',
        clientMessageId: clientMessageId,
        deliveryState: MessageDeliveryState.sending,
        attachments: attachments
            .map(
              (attachment) => RelayAttachment(
                id: attachment.id,
                type: 'image',
                name: attachment.name,
                mimeType: attachment.mimeType,
                url: '',
                localBytes: attachment.bytes,
                thumbnailBytes: attachment.thumbnailBytes,
              ),
            )
            .toList(growable: false),
      ),
    );
    _notify();
    try {
      final optimistic = messages[session.id]!.firstWhere(
        (m) => m.clientMessageId == clientMessageId,
      );
      if (email.isNotEmpty) {
        await _persistPendingInput(session.id, optimistic, {});
      }
      if (!currentAuthorization()) {
        throw const RelayApiException('', 0, 'request_cancelled');
      }
      final result = await _sendEncryptedCommand(
        'session.submit_message',
        session.id,
        {
          'content': text,
          'interrupt_running': session.supportsInterruptAndSend,
          if (runtimeSettings.isNotEmpty) 'runtime_settings': runtimeSettings,
          'client_message_id': clientMessageId,
          'attachments': attachments
              .map(
                (attachment) => {
                  'id': attachment.id,
                  'type': 'image',
                  'name': attachment.name,
                  'mime_type': attachment.mimeType,
                  'detail': attachment.detail,
                  'base64': base64Encode(attachment.bytes),
                },
              )
              .toList(growable: false),
        },
        ttl: const Duration(minutes: 5),
        persistSealed: email.isEmpty
            ? null
            : (frame) => _persistPendingInput(session.id, optimistic, frame),
      );
      if (!currentAuthorization()) {
        throw const RelayApiException('', 0, 'request_cancelled');
      }
      _setMessageDeliveryState(
        session.id,
        clientMessageId,
        MessageDeliveryState.sent,
        onlyIfSending: true,
      );
      final currentActivity = _sessionActivities[session.id];
      final receivedMessage = (messages[session.id] ?? const <RelayMessage>[])
          .any(
            (message) =>
                message.clientMessageId == clientMessageId &&
                (message.kind == 'user.message' ||
                    message.deliveryState == MessageDeliveryState.failed),
          );
      if (!receivedMessage &&
          (currentActivity == null ||
              (currentActivity.clientMessageId == clientMessageId &&
                  !currentActivity.receivedByComputer))) {
        _sessionActivities[session.id] = (
          label: deviceOnline
              ? _l10n.controllerWaitingForAgent
              : _l10n.controllerWaitingForComputer,
          clientMessageId: clientMessageId,
          waitingForComputer: !deviceOnline,
          receivedByComputer: false,
        );
      }
      // The server persists every accepted command in its transport queue,
      // including commands for an online computer. Delivery detail belongs in
      // the per-turn activity bubble; it must not masquerade as offline state.
      _notify();
      _catalogMetadataDirty = true;
      return result.delivery == 'queued'
          ? MessageSendOutcome.queued
          : MessageSendOutcome.delivered;
    } on Object catch (exception) {
      error = _userFailure(exception, _l10n.apiErrorGeneric);
      _setMessageDeliveryState(
        session.id,
        clientMessageId,
        MessageDeliveryState.failed,
        onlyIfSending: true,
      );
      if (_sessionActivities[session.id]?.clientMessageId == clientMessageId) {
        _sessionActivities.remove(session.id);
      }
      return MessageSendOutcome.failed;
    } finally {
      _notify();
    }
  }

  bool canInterruptSession(RelaySession? session) {
    if (session == null || session.isSubagent) return false;
    // Live turn events supersede the preceding idle catalog. External sessions
    // known only through the catalog retain their read-only capability.
    return session.canInterrupt ||
        (runningSessions.contains(session.id) &&
            _activeTurns.containsKey(session.id));
  }

  Future<void> interruptTurn() async {
    final session = activeSession;
    if (session == null ||
        session.isSubagent ||
        !canInterruptSession(session) ||
        !deviceOnline ||
        !runningSessions.contains(session.id) ||
        isStoppingSession(session.id)) {
      return;
    }
    // Keep feedback until the runtime confirms completion, not just delivery.
    late final Timer request;
    request = Timer(const Duration(seconds: 35), () {
      if (!identical(_stopRequests[session.id], request)) return;
      _finishStopRequest(session.id);
      error = _l10n.workbenchStopUnconfirmed;
      _notify();
    });
    _stopRequests[session.id] = request;
    _stopHaptics[session.id] = (haptics.begin(), _activeTurns[session.id]);
    _notify();
    try {
      await sendEncryptedCommand(
        'session.interrupt_turn',
        session.id,
        const {},
        ttl: const Duration(seconds: 30),
      );
    } on Object catch (exception) {
      if (identical(_stopRequests[session.id], request)) {
        _finishStopRequest(session.id);
        error = _userFailure(exception, _l10n.controllerInterruptFailed);
      }
    } finally {
      _notify();
    }
  }

  void _finishStopRequest(String sessionId) {
    _stopRequests.remove(sessionId)?.cancel();
    haptics.cancel(_stopHaptics.remove(sessionId)?.$1);
  }

  void _clearStopRequests() {
    for (final timer in _stopRequests.values) {
      timer.cancel();
    }
    _stopRequests.clear();
    for (final ticket in _stopHaptics.values) {
      haptics.cancel(ticket.$1);
    }
    _stopHaptics.clear();
  }

  void _clearApprovalNotice(String approvalId) {
    final pending = _approvalNotice;
    if (pending == null || pending.$1 != approvalId) return;
    if (notice == pending.$2) notice = '';
    _approvalNotice = null;
  }

  Future<void> decideApproval(
    RelayApproval approval,
    String decision, {
    String? optionId,
    String? answer,
    bool acknowledgeWithHaptics = true,
  }) async {
    if (!deviceOnline ||
        approval.state != 'pending' ||
        DateTime.tryParse(approval.expiresAt)?.isBefore(DateTime.now()) ==
            true) {
      error = deviceOnline
          ? _l10n.controllerApprovalExpired
          : _l10n.controllerApprovalOffline;
      _notify();
      return;
    }
    if (acknowledgeWithHaptics) {
      haptics.cancel(_approvalHaptics.remove(approval.id));
      _approvalHaptics[approval.id] = haptics.begin();
    }
    approvals = approvals
        .map(
          (item) =>
              item.id == approval.id ? item.copyWith(state: 'deciding') : item,
        )
        .toList();
    _notify();
    try {
      await sendEncryptedCommand('approval.resolve', approval.sessionId, {
        'approval_id': approval.id,
        'device_id': bootstrap!.device.id,
        'session_id': approval.targetSessionId ?? approval.sessionId,
        'decision': decision,
        'command_hash': approval.action['command_hash'],
        'expires_at': approval.expiresAt,
        'nonce': _randomHex(16),
        'option_id': optionId,
        'answer': answer,
      }, ttl: const Duration(seconds: 30));
      if (approvals.any(
        (item) => item.id == approval.id && item.state == 'deciding',
      )) {
        notice = decision == 'approved'
            ? _l10n.controllerApprovalAllowedSent
            : _l10n.controllerApprovalRejectedSent;
        _approvalNotice = (approval.id, notice);
      }
    } on Object catch (exception) {
      approvals = approvals
          .map(
            (item) => item.id == approval.id && item.state == 'deciding'
                ? item.copyWith(state: 'pending')
                : item,
          )
          .toList();
      haptics.cancel(_approvalHaptics.remove(approval.id));
      error = _userFailure(exception, _l10n.controllerApprovalProcessFailed);
    } finally {
      _notify();
    }
  }

  Future<bool> decideApprovalFromNotification(
    String approvalId,
    RelayNotificationAction action,
  ) async {
    final approval = approvals
        .where((candidate) => candidate.id == approvalId)
        .firstOrNull;
    if (approval == null || approval.action['type'] == 'question.select') {
      return false;
    }
    final options = (approval.action['options'] as List? ?? const [])
        .whereType<Map>()
        .map((option) => Map<String, dynamic>.from(option))
        .toList(growable: false);
    String? optionIdFor(String kind) => options
        .where((option) => option['kind'] == kind)
        .map((option) => option['option_id'])
        .whereType<String>()
        .firstOrNull;
    final decision = switch (action) {
      RelayNotificationAction.approveOnce when approval.riskLevel != 'high' =>
        'approved',
      RelayNotificationAction.reject => 'rejected',
      _ => null,
    };
    final optionId = switch (action) {
      RelayNotificationAction.approveOnce => optionIdFor('allow_once'),
      RelayNotificationAction.reject => optionIdFor('reject_once'),
      RelayNotificationAction.answer => null,
    };
    if (decision == null || (options.isNotEmpty && optionId == null)) {
      return false;
    }
    await decideApproval(
      approval,
      decision,
      optionId: optionId,
      acknowledgeWithHaptics: false,
    );
    return true;
  }

  Future<void> delegateAgents(String text) async {
    final session = activeSession;
    if (session == null) return;
    final tasks = text
        .split('\n')
        .map((item) => item.trim())
        .where((item) => item.isNotEmpty)
        .take(4)
        .toList();
    if (tasks.isEmpty) return;
    try {
      await sendEncryptedCommand('session.create_agents', session.id, {
        'tasks': tasks,
      }, ttl: const Duration(hours: 1));
      notice = _l10n.controllerDelegatedTasks(tasks.length);
    } on Object catch (exception) {
      error = _userFailure(exception, _l10n.apiErrorGeneric);
    } finally {
      _notify();
    }
  }

  final Map<String, RelaySession> _directorySessions = {};

  SessionDirectory _sessionDirectory = SessionDirectory();
  Timer? _directoryTimer;
  Timer? _directoryCacheTimer;
  bool _directoryForeground = true;
  bool _directoryRefreshVisible = false;

  bool get homeRefreshing => refreshing || _directoryRefreshVisible;
  bool _directoryLoadFailed = false;
  bool get homeSessionsLoading {
    if (sessions.any((session) => !session.isSubagent) ||
        _directoryConfirmed ||
        _directoryLoadFailed ||
        localReadOnly ||
        !deviceOnline ||
        phase != AppPhase.ready) {
      return false;
    }
    return refreshing ||
        _directoryRequest != null ||
        (!_realtimePaused &&
            (desktopInfo?.supportsSessionDirectory == true ||
                (!_onlineCatalogReceived &&
                    (_supportsOnlineStream ||
                        (desktopInfo == null &&
                            connectionSnapshot.transport ==
                                RealtimeTransportState.connecting)))));
  }

  Future<void>? _directoryRequest;
  Future<void>? _directoryRestoration;
  int _directoryEpoch = 0;
  bool _directoryConfirmed = false;
  bool _catalogMetadataDirty = false;

  String get _directoryScope =>
      '$email:${bootstrap?.device.id}:${relayKey?.keyId}';

  void _startDirectorySync() {
    _directoryTimer?.cancel();
    if (!_directoryForeground) return;
    unawaited(_restoreSessionDirectory());
    // Refresh the visible list immediately; subsequent work stays bounded to
    // one page per tick and one in-flight request.
    unawaited(_syncSessionDirectory(showProgress: true));
    _directoryTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_supportsOnlineStream && _onlineStream?.available != true) return;
      if (_onlineStream?.available == true &&
          desktopInfo?.supportsDirectoryPush == true &&
          _sessionDirectory.cursor == null &&
          _directoryConfirmed &&
          _sessionDirectory.revision == _onlineDirectoryRevision) {
        return;
      }
      unawaited(_syncSessionDirectory());
    });
  }

  @visibleForTesting
  void startDirectorySyncForTesting() {
    _realtimePaused = false;
    _startDirectorySync();
  }

  @visibleForTesting
  Future<void> syncDirectoryForTesting() => _syncSessionDirectory();

  Future<void> _restoreSessionDirectory() {
    return _directoryRestoration ??= () async {
      final epoch = _historyCacheEpoch;
      final scope = _directoryScope;
      try {
        if (!await _ensureHistoryCache()) return;
        final value = await _historyStore.readSessionDirectory(
          List<int>.of(_historyCacheKey!),
        );
        if (_disposed ||
            epoch != _historyCacheEpoch ||
            scope != _directoryScope ||
            value == null) {
          return;
        }
        _sessionDirectory = SessionDirectory.fromJson(value);
        _publishSessionDirectory(cached: true);
      } catch (_) {
        // A missing/corrupt optional cache falls back to the next scheduled sync.
      }
    }();
  }

  Future<void> _syncSessionDirectory({bool showProgress = false}) async {
    if (_directoryRequest != null) return _directoryRequest;
    if (_disposed ||
        _realtimePaused ||
        !_directoryForeground ||
        phase != AppPhase.ready ||
        !deviceOnline ||
        (_supportsOnlineStream && _onlineStream?.available != true) ||
        relayKey == null) {
      return;
    }
    final epoch = _directoryEpoch;
    final scope = _directoryScope;
    _directoryLoadFailed = false;
    final operation = () async {
      try {
        if (_catalogMetadataDirty) {
          _catalogMetadataDirty = false;
          unawaited(
            refresh().catchError((Object _) {
              _catalogMetadataDirty = true;
            }),
          );
        }
        if (desktopInfo?.supportsSessionDirectory != true) return;
        await _restoreSessionDirectory();
        if (_disposed || epoch != _directoryEpoch || scope != _directoryScope) {
          return;
        }
        final result = await projectRequest('project.sessions', {
          'directory_sync': true,
          'batch_size': 300,
          'revision': _sessionDirectory.revision,
          'cursor': _sessionDirectory.cursor,
        });
        if (_disposed || epoch != _directoryEpoch || scope != _directoryScope) {
          return;
        }
        final firstCheckpoint = !_directoryConfirmed;
        final changed = _sessionDirectory.apply(jsonMap(result['directory']));
        if (changed || !_directoryConfirmed) {
          _publishSessionDirectory();
          _directoryConfirmed = true;
        }
        if (changed) {
          if (firstCheckpoint) {
            // The first usable directory must survive a quick exit. Later
            // updates keep the existing debounce to avoid repeated disk work.
            _persistSessionDirectory();
          } else {
            _directoryCacheTimer ??= Timer(const Duration(seconds: 5), () {
              _directoryCacheTimer = null;
              _persistSessionDirectory();
            });
          }
        }
      } catch (_) {
        // Retain both local data and the checkpoint. Only a timer retries.
        if (epoch == _directoryEpoch && scope == _directoryScope) {
          _directoryLoadFailed = true;
        }
      }
    }();
    _directoryRequest = operation;
    if (showProgress) {
      _directoryRefreshVisible = true;
      _notify();
    }
    try {
      await operation;
    } finally {
      if (identical(_directoryRequest, operation)) {
        _directoryRequest = null;
        if (_directoryRefreshVisible) {
          _directoryRefreshVisible = false;
        }
        _notify();
      }
    }
  }

  void _publishSessionDirectory({bool cached = false}) {
    final known = {for (final session in sessions) session.id: session};
    final incoming = _sessionDirectory.sessions.values.map((summary) {
      final previous = known[summary.id];
      if (cached && previous != null) return previous;
      return RelaySession.fromJson({
        ...?previous?.raw,
        ...summary.raw,
        if (cached) 'status': 'idle',
        if (cached) 'can_interrupt': false,
      });
    }).toList();
    _directorySessions
      ..clear()
      ..addEntries(incoming.map((s) => MapEntry(s.id, s)));
    _replaceCatalog(
      sessions: incoming,
      projects: _sessionDirectory.projects,
      catalogAt: cached
          ? null
          : DateTime.tryParse(_sessionDirectory.observedAt ?? ''),
    );
    _notify();
  }

  bool _directoryWriteQueued = false, _directoryCachePending = false;
  void _persistSessionDirectory() {
    _directoryCachePending = true;
    if (_directoryWriteQueued) return;
    _directoryWriteQueued = true;
    final epoch = _historyCacheEpoch, scope = _directoryScope;
    _historyCacheWrites = _historyCacheWrites.catchError((_) {}).then((
      _,
    ) async {
      try {
        if (_historyCacheDisabled ||
            epoch != _historyCacheEpoch ||
            scope != _directoryScope ||
            (_historyCacheKey == null && !await _ensureHistoryCache())) {
          return;
        }
        final key = List<int>.of(_historyCacheKey!);
        try {
          while (_directoryCachePending &&
              epoch == _historyCacheEpoch &&
              scope == _directoryScope) {
            _directoryCachePending = false;
            await _historyStore.appendSessionDirectory(
              key,
              _cachedDirectorySnapshot(),
            );
          }
        } finally {
          key.fillRange(0, key.length, 0);
        }
      } catch (_) {
        _recordHistoryPerformance({'stage': 'directory_cache_write_failed'});
      } finally {
        _directoryWriteQueued = false;
      }
    });
  }

  Map<String, dynamic> _cachedDirectorySnapshot() {
    if (_directoryConfirmed ||
        _sessionDirectory.sessions.isNotEmpty ||
        sessions.isEmpty) {
      return _sessionDirectory.toJson();
    }
    // Bootstrap may show recent sessions before the first paged directory
    // response. Preserve that readable catalog without claiming a sync cursor.
    final fallback = SessionDirectory();
    fallback.sessions.addEntries(
      sessions.take(300).map((s) => MapEntry(s.id, s)),
    );
    fallback.projects = projects.take(2000).toList();
    return fallback.toJson();
  }

  // Compatibility for callers: this API now only pages the local directory.
  Future<Map<String, dynamic>> loadProjectSessionPage(
    RelaySession project,
    String? cursor,
  ) async {
    final matching =
        sessions
            .where(
              (s) =>
                  !s.isSubagent &&
                  s.provider == project.provider &&
                  canonicalProjectPath(s.cwd) ==
                      canonicalProjectPath(project.cwd),
            )
            .toList()
          ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    final offset = int.tryParse(cursor ?? '0') ?? -1;
    if (offset < 0 || offset > matching.length) {
      throw StateError('project_failed');
    }
    final end = min(offset + 5, matching.length);
    return {
      'sessions': matching.sublist(offset, end).map((s) => s.raw).toList(),
      'next_cursor': end < matching.length ? '$end' : null,
    };
  }

  final Map<String, String> _projectOperationIds = {};

  Future<Map<String, dynamic>> projectRequest(
    String type,
    Map<String, dynamic> payload,
  ) async {
    final deviceId = bootstrap?.device.id;
    if (!deviceOnline) throw StateError('offline');
    final command = await sendEncryptedCommand(
      type,
      null,
      payload,
      ttl: const Duration(minutes: 1),
    );
    final reply = await waitForEncryptedResponse(
      command.requestId,
      timeout: const Duration(minutes: 1),
    );
    if (bootstrap?.device.id != deviceId ||
        reply['type'] != 'project.result' ||
        reply['request_id'] != command.requestId) {
      throw StateError('project_failed');
    }
    if (reply['error_code'] is String) {
      throw StateError(reply['error_code'] as String);
    }
    return reply;
  }

  Future<RelayProject> createProject({
    required String mode,
    required String path,
    required String name,
    required String provider,
  }) async {
    final signature = jsonEncode([
      bootstrap?.device.id,
      provider,
      mode,
      path,
      name.trim(),
    ]);
    final operationId = _projectOperationIds.putIfAbsent(
      signature,
      () => _randomId('project'),
    );
    final result = await projectRequest('project.create', {
      'provider': provider,
      'operation_id': operationId,
      'mode': mode,
      'path': path,
      if (mode == 'new') 'name': name.trim(),
    });
    final project = RelayProject.fromJson(jsonMap(result['project']));
    if (project.provider != provider || project.cwd.isEmpty) {
      throw StateError('project_failed');
    }
    projects = List.unmodifiable([
      project,
      ...projects.where((p) => p.id != project.id),
    ]);
    _projectOperationIds.remove(signature);
    _notify();
    return project;
  }

  Future<void> startProjectTask(RelayProject project, String content) async {
    final previous = activeSessionId;
    await createSessionInProject(
      project.asSessionTarget(),
      _l10n.workbenchDefaultSessionName,
      provider: project.provider,
    );
    if (activeSessionId == previous ||
        activeSession?.cwd != project.cwd ||
        activeSession?.provider != project.provider ||
        error.isNotEmpty) {
      throw StateError('taskFailed');
    }
    final outcome = await sendMessage(content);
    if (outcome == MessageSendOutcome.failed ||
        outcome == MessageSendOutcome.rejected) {
      throw StateError('taskFailed');
    }
  }

  Future<void> createSessionInCurrentProject(
    String name, {
    String? provider,
  }) async {
    final project = activeRootSession;
    if (project == null) {
      error = deviceOnline
          ? _l10n.controllerSelectProject
          : _l10n.controllerCreateSessionOffline;
      _notify();
      return;
    }
    await createSessionInProject(project, name, provider: provider);
  }

  Future<void> createSessionInProject(
    RelaySession project,
    String name, {
    String? provider,
  }) async {
    final cwd = project.cwd.trim();
    final trimmedName = name.trim();
    final resolvedProvider = provider ?? project.provider;
    if (!deviceOnline) {
      error = _l10n.controllerCreateSessionOffline;
      _notify();
      return;
    }
    if (cwd.isEmpty) {
      error = _l10n.controllerSelectProject;
      _notify();
      return;
    }
    if (trimmedName.isEmpty ||
        trimmedName.runes.length > maxSessionNameLength) {
      error = _l10n.controllerSessionNameLength(maxSessionNameLength);
      _notify();
      return;
    }
    if (resolvedProvider == 'claude-cowork') {
      error = _l10n.controllerCoworkCreateOnDesktop;
      _notify();
      return;
    }
    if (_sessionCreationInFlight) {
      notice = _l10n.controllerSessionCreationBusy;
      _notify();
      return;
    }
    final key = relayKey;
    final deviceId = bootstrap?.device.id;
    if (key == null || deviceId == null) {
      error = _l10n.controllerSessionCreateFailed;
      _notify();
      return;
    }
    final epoch = _historyCacheEpoch;
    final signature = jsonEncode([
      deviceId,
      resolvedProvider,
      canonicalProjectPath(cwd),
      trimmedName,
    ]);
    _pendingSessionCreations.removeWhere(
      (_, pending) =>
          pending.key != key ||
          pending.deviceId != deviceId ||
          pending.epoch != epoch,
    );
    final pending = _pendingSessionCreations[signature];
    final operation =
        pending ??
        _PendingSessionCreation(
          requestId: _randomId('create'),
          key: key,
          deviceId: deviceId,
          epoch: epoch,
        );
    final requestId = operation.requestId;
    final attempt = Object();
    _sessionCreationAttempt = attempt;
    bool current() =>
        !_disposed &&
        relayKey == key &&
        bootstrap?.device.id == deviceId &&
        _historyCacheEpoch == epoch &&
        identical(_sessionCreationAttempt, attempt);
    _pendingSessionCreations[signature] = operation;
    _sessionCreationInFlight = true;
    error = '';
    notice = _l10n.controllerSessionCreating(trimmedName);
    _notify();
    try {
      if (pending == null) {
        try {
          await _sendEncryptedCommand(
            'session.create',
            null,
            {'cwd': cwd, 'name': trimmedName, 'provider': resolvedProvider},
            ttl: const Duration(minutes: 1),
            requestId: requestId,
            onSealed: (frame) {
              if (!current()) {
                throw const RelayApiException('', 0, 'request_cancelled');
              }
              operation.frame = frame;
            },
          );
        } on Object catch (exception) {
          // A timed-out POST may already have reached the computer. Read its
          // result without generating another ID or resealing the mutation.
          if (!_uncertainSessionCreation(exception)) {
            if (current()) _pendingSessionCreations.remove(signature);
            rethrow;
          }
          if (current()) await _redeliverSessionCreation(operation);
        }
      } else if (current()) {
        await _redeliverSessionCreation(operation);
      }
      if (!current()) return;
      final created = await _waitForSessionCreationResult(
        requestId,
        expectedCwd: cwd,
        expectedName: trimmedName,
        expectedProvider: resolvedProvider,
      );
      if (!current()) return;
      _pendingSessionCreations.remove(signature);
      await _activateCreatedSession(created);
    } on Object catch (exception) {
      if (!current()) return;
      if (exception is RelayApiException &&
          exception.code == 'session_create_error') {
        _pendingSessionCreations.remove(signature);
      }
      notice = '';
      error = _uncertainSessionCreation(exception)
          ? _l10n.controllerSessionCreateTimeout
          : _userFailure(exception, _l10n.controllerSessionCreateFailed);
    } finally {
      if (identical(_sessionCreationAttempt, attempt)) {
        _sessionCreationAttempt = null;
        _sessionCreationInFlight = false;
        _notify();
      }
    }
  }

  bool _uncertainSessionCreation(Object error) =>
      error is TimeoutException ||
      (error is RelayApiException &&
          (const {
                'network_timeout',
                'network_unavailable',
                'response_timeout',
              }.contains(error.code) ||
              error.status >= 500 ||
              error.status == 408));

  Future<void> _redeliverSessionCreation(
    _PendingSessionCreation operation,
  ) async {
    final frame = operation.frame;
    if (frame == null ||
        !DateTime.parse(
          RelayAad.fromJson(jsonMap(frame['aad'])).expiresAt!,
        ).isAfter(DateTime.now())) {
      return; // Expired writes may only recover a previously stored response.
    }
    try {
      await _sendSealedFrame(frame);
    } on RelayApiException {
      // Even rejection of a redelivery cannot disprove the first admission.
      // Recover the original authoritative result before reporting failure.
    }
  }

  Future<RelaySession> _waitForSessionCreationResult(
    String requestId, {
    required String expectedCwd,
    required String expectedName,
    required String expectedProvider,
  }) async {
    final payload = await waitForEncryptedResponse(
      requestId,
      timeout: const Duration(minutes: 1),
      retryTransientErrors: true,
    );
    if (payload['request_id'] != requestId) {
      throw const FormatException('创建会话响应路由无效。');
    }
    if (payload['type'] == 'session.create_error') {
      throw RelayApiException(
        payload['error'] as String? ??
            _l10n.controllerDesktopSessionCreateFailed,
        0,
        'session_create_error',
      );
    }
    if (payload['type'] != 'session.create_result') {
      throw const FormatException('创建会话响应类型无效。');
    }
    final created = RelaySession.fromJson(jsonMap(payload['session']));
    if (payload['session_id'] != created.id ||
        canonicalProjectPath(created.cwd) !=
            canonicalProjectPath(expectedCwd) ||
        created.name.trim() != expectedName ||
        created.provider != expectedProvider) {
      throw const FormatException('创建会话响应与请求不匹配。');
    }
    return created;
  }

  bool canBranchReply(RelaySession session, RelayMessage message) {
    if (session.isSubagent ||
        session.forkMode == null ||
        message.role != 'codex' ||
        message.content.trim().isEmpty ||
        message.toolActivityLabel != null) {
      return false;
    }
    final history = messages[session.id] ?? const <RelayMessage>[];
    final index = history.indexWhere((item) => item.id == message.id);
    if (index < 0) return false;
    final turn = message.turnId == null
        ? <RelayMessage>[message]
        : history.where((item) => item.turnId == message.turnId).toList();
    final finalReply = turn
        .where(
          (item) =>
              item.role == 'codex' &&
              item.content.trim().isNotEmpty &&
              item.toolActivityLabel == null &&
              (item.messagePhase == null ||
                  item.messagePhase == 'final_answer'),
        )
        .lastOrNull;
    if (finalReply?.id != message.id ||
        turn.any(
          (item) => const {
            'running',
            'in_progress',
            'pending',
            'queued',
            'starting',
          }.contains(item.turnStatus),
        )) {
      return false;
    }
    final lastTurn =
        history.isNotEmpty &&
        (message.turnId == null
            ? history.last.id == message.id
            : history.last.turnId == message.turnId);
    final status = conversationTurnStatus(
      turn,
      active: lastTurn && runningSessions.contains(session.id),
      online: deviceOnline,
    );
    final idle =
        !runningSessions.contains(session.id) &&
        !const {'active', 'running', 'starting'}.contains(session.status) &&
        sessionActivity(session.id) == null;
    if (session.forkMode == 'latest') {
      // ACP needs the canonical native history boundary. Live presentation IDs
      // do not identify a persisted reply, even after the turn has completed.
      final turnId = message.turnId;
      if (turnId == null ||
          turnId.trim().isEmpty ||
          message.id == 'codex_$turnId' ||
          message.id == 'agent_$turnId' ||
          message.id.startsWith('agent_${turnId}_')) {
        return false;
      }
      final noLaterActivity = history
          .skip(index + 1)
          .every(
            (item) =>
                item.kind == 'turn.completed' &&
                (item.turnStatus == null ||
                    const {'completed', 'success'}.contains(item.turnStatus)),
          );
      return lastTurn &&
          idle &&
          noLaterActivity &&
          const {
            ConversationTurnStatus.completed,
            ConversationTurnStatus.unknown,
          }.contains(status);
    }
    return status == ConversationTurnStatus.completed;
  }

  Future<void> branchFromReply(
    RelaySession source,
    RelayMessage message, {
    bool worktree = false,
  }) async {
    if (!deviceOnline) {
      notice = _l10n.controllerReplyBranchOffline;
      _notify();
      return;
    }
    final key = relayKey;
    final deviceId = bootstrap?.device.id;
    final epoch = _historyCacheEpoch;
    if (key == null || deviceId == null) {
      error = _l10n.controllerReplyBranchFailed;
      _notify();
      return;
    }
    final mode = worktree ? 'worktree' : 'same_directory';
    final signature = jsonEncode([
      deviceId,
      source.id,
      // Both supported turn-mode adapters retain their native turn identity
      // when a live reply is replaced by canonical history. The final reply
      // is unique within that turn; retain its original sealed request.
      message.turnId?.trim().isNotEmpty == true
          ? ['turn', message.turnId]
          : ['message', message.id],
      mode,
    ]);
    _pendingReplyBranches.removeWhere(
      (_, pending) =>
          pending.key != key ||
          pending.deviceId != deviceId ||
          pending.epoch != epoch,
    );
    final pending = _pendingReplyBranches[signature];
    if (pending == null &&
        (!canBranchReply(source, message) ||
            (worktree && !source.supportsForkWorktree))) {
      error = _l10n.controllerReplyBranchUnavailable;
      _notify();
      return;
    }
    if (_sessionCreationInFlight) {
      notice = _l10n.controllerReplyBranchBusy;
      _notify();
      return;
    }
    final operation =
        pending ??
        _PendingSessionCreation(
          requestId: _randomId('branch'),
          key: key,
          deviceId: deviceId,
          epoch: epoch,
        );
    final attempt = Object();
    _sessionCreationAttempt = attempt;
    bool current() =>
        !_disposed &&
        relayKey == key &&
        bootstrap?.device.id == deviceId &&
        _historyCacheEpoch == epoch &&
        identical(_sessionCreationAttempt, attempt);
    _pendingReplyBranches[signature] = operation;
    _sessionCreationInFlight = true;
    error = '';
    notice = _l10n.controllerReplyBranchCreating;
    _notify();
    try {
      if (pending == null) {
        try {
          await _sendEncryptedCommand(
            'session.fork',
            source.id,
            {'message_id': message.id, 'turn_id': message.turnId, 'mode': mode},
            ttl: const Duration(minutes: 1),
            requestId: operation.requestId,
            onSealed: (frame) {
              if (!current()) {
                throw const RelayApiException('', 0, 'request_cancelled');
              }
              operation.frame = frame;
            },
          );
        } on Object catch (exception) {
          if (!_uncertainSessionCreation(exception)) {
            if (current()) _pendingReplyBranches.remove(signature);
            rethrow;
          }
          if (current()) await _redeliverSessionCreation(operation);
        }
      } else if (current()) {
        await _redeliverSessionCreation(operation);
      }
      if (!current()) return;
      final payload = await waitForEncryptedResponse(
        operation.requestId,
        timeout: const Duration(minutes: 1),
        retryTransientErrors: true,
      );
      if (!current()) return;
      if (payload['request_id'] != operation.requestId ||
          payload['source_session_id'] != source.id) {
        throw const FormatException('reply_branch_response_invalid');
      }
      if (payload['type'] == 'session.fork_error') {
        if (payload['session_id'] != source.id) {
          throw const FormatException('reply_branch_response_invalid');
        }
        final code =
            payload['error'] as String? ?? 'session_fork_outcome_unknown';
        if (const {
          'session_fork_unsupported',
          'session_fork_cancelled',
          'session_fork_busy',
          'session_fork_invalid_reply',
          'session_fork_latest_only',
          'session_not_found',
          'session_worktree_unavailable',
          'session_worktree_failed',
          'session_fork_failed',
        }.contains(code)) {
          _pendingReplyBranches.remove(signature);
        }
        throw RelayApiException('', 0, code);
      }
      if (payload['type'] != 'session.fork_result') {
        throw const FormatException('reply_branch_response_invalid');
      }
      final created = RelaySession.fromJson(jsonMap(payload['session']));
      if (created.id.isEmpty ||
          created.id == source.id ||
          payload['session_id'] != created.id ||
          created.provider != source.provider ||
          created.cwd.trim().isEmpty ||
          (worktree
              ? canonicalProjectPath(created.cwd) ==
                    canonicalProjectPath(source.cwd)
              : canonicalProjectPath(created.cwd) !=
                    canonicalProjectPath(source.cwd))) {
        throw const FormatException('reply_branch_response_invalid');
      }
      _pendingReplyBranches.remove(signature);
      await _activateCreatedSession(
        created,
        inheritedHistory: true,
        branchWorktree: worktree,
      );
    } on Object catch (exception) {
      if (!current()) return;
      notice = '';
      error = _uncertainSessionCreation(exception)
          ? _l10n.controllerReplyBranchUnconfirmed
          : _userFailure(exception, _l10n.controllerReplyBranchFailed);
    } finally {
      if (identical(_sessionCreationAttempt, attempt)) {
        _sessionCreationAttempt = null;
        _sessionCreationInFlight = false;
        _notify();
      }
    }
  }

  Future<void> _activateCreatedSession(
    RelaySession created, {
    bool inheritedHistory = false,
    bool branchWorktree = false,
  }) async {
    sessions = List.unmodifiable([
      created,
      ...sessions.where((session) => session.id != created.id),
    ]);
    _recentlyCreatedSessions[created.id] = (
      session: created,
      expiresAt: DateTime.now().add(_createdSessionCatalogProtection),
    );
    messages[created.id] = const [];
    historyCursors[created.id] = null;
    if (inheritedHistory) {
      historyHasMore.remove(created.id);
    } else {
      historyHasMore[created.id] = false;
    }
    historyLoading.remove(created.id);
    _historyErrors.remove(created.id);
    _historyEarlierErrors.remove(created.id);
    if (inheritedHistory) {
      _historyLoaded.remove(created.id);
    } else {
      _historyLoaded.add(created.id);
    }
    // Ordinary creation establishes empty history; branches must read their
    // inherited native history. Re-entry still reconciles via selectSession.
    _selectSessionLocally(created.id);
    pendingWorkbenchTarget = 'conversation';
    workbenchNavigationRevision += 1;
    notice = inheritedHistory
        ? branchWorktree
              ? _l10n.controllerReplyBranchWorktreeCreated
              : _l10n.controllerReplyBranchCreated
        : _l10n.controllerSessionCreated(created.name);
    _notify();
    if (inheritedHistory) await loadHistory(created.id);
  }

  Future<void> configureSession(String configId, Object value) async {
    final session = activeSession;
    if (session != null &&
        ((supportsMessageModelSettings(session) &&
                const {'model', 'reasoning'}.contains(configId)) ||
            (supportsMessagePermissionSettings(session) &&
                configId == 'permissions'))) {
      _selectCodexMessageSetting(session, configId, value);
      return;
    }
    if (session == null ||
        !const {
          'codex',
          'kimi',
          'claude',
          'claude-cowork',
        }.contains(session.provider) ||
        session.isSubagent ||
        runningSessions.contains(session.id) ||
        configuringSessions.contains(session.id) ||
        !deviceOnline) {
      return;
    }
    configuringSessions.add(session.id);
    notice = '';
    error = '';
    _notify();
    try {
      final requestId = _randomId('config');
      try {
        await sendEncryptedCommand(
          'session.configure',
          session.id,
          {'config_id': configId, 'value': value},
          ttl: const Duration(seconds: 30),
          requestId: requestId,
        );
      } on RelayApiException catch (exception) {
        // A timed-out POST can already be applied by the desktop. Recover its
        // authoritative response with the same ID, never post the change twice.
        final uncertain =
            const {
              'network_timeout',
              'network_unavailable',
            }.contains(exception.code) ||
            const {502, 503, 504}.contains(exception.status);
        if (!uncertain) rethrow;
      }
      final result = await _waitForSessionConfigurationResult(
        requestId,
        sessionId: session.id,
        configId: configId,
        timeout: const Duration(seconds: 30),
      );
      if (result['type'] == 'session.configure_error') {
        throw RelayApiException(
          result['error'] as String? ?? _l10n.controllerDesktopConfigFailed,
          0,
          'session_configure_error',
        );
      }
      if (result['type'] != 'session.configure_result' ||
          result['config_options'] is! List) {
        throw const FormatException('会话设置响应类型无效。');
      }
      _applySessionConfigOptions(session.id, result['config_options']);
      notice = _l10n.controllerConfigApplied;
    } on Object catch (exception) {
      error = _userFailure(exception, _l10n.controllerConfigUpdateFailed);
    } finally {
      configuringSessions.remove(session.id);
      _notify();
    }
  }

  Future<Map<String, dynamic>> _waitForSessionConfigurationResult(
    String requestId, {
    required String sessionId,
    required String configId,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    // Direct responses are delivered to the pending read, not the server's
    // response endpoint. Consume that same authenticated result first.
    if (_directReadResults.containsKey(requestId)) {
      final payload = await waitForEncryptedResponse(
        requestId,
        timeout: timeout,
      );
      if (payload['request_id'] != requestId ||
          payload['session_id'] != sessionId ||
          payload['config_id'] != configId ||
          !const {
            'session.configure_result',
            'session.configure_error',
          }.contains(payload['type'])) {
        throw const FormatException('会话设置响应与请求不匹配。');
      }
      return payload;
    }
    final started = DateTime.now();
    while (DateTime.now().difference(started) < timeout) {
      try {
        final frame = await api.encryptedResponse(requestId);
        if (frame.deviceId != bootstrap?.device.id ||
            frame.sessionId != sessionId ||
            frame.requestId != requestId ||
            frame.aad.sessionId != sessionId ||
            frame.aad.requestId != requestId) {
          throw const FormatException('会话设置响应路由无效。');
        }
        final payload = await _cipher.openJson<Map<String, dynamic>>(
          relayKey!,
          frame.envelope,
          frame.aad,
        );
        if (payload['request_id'] != requestId ||
            payload['session_id'] != sessionId ||
            payload['config_id'] != configId ||
            payload['type'] != frame.aad.type ||
            !const {
              'session.configure_result',
              'session.configure_error',
            }.contains(payload['type'])) {
          throw const FormatException('会话设置响应与请求不匹配。');
        }
        return payload;
      } on RelayApiException catch (exception) {
        final pending =
            exception.status == 404 &&
            const {
              'response_pending',
              'response_wait_timeout',
              'not_found',
            }.contains(exception.code);
        final transient =
            const {
              'network_timeout',
              'network_unavailable',
            }.contains(exception.code) ||
            const {502, 503, 504}.contains(exception.status);
        // The command may already have applied. Retry only this read, keeping
        // the original deadline and request ID; never resend the mutation.
        if (!pending && !transient) rethrow;
      }
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }
    throw RelayApiException(
      _l10n.controllerConfigTimeout,
      0,
      'response_timeout',
    );
  }

  Future<void> Function()? beforeLogout;
  Future<void> Function()? logoutAccount;
  Future<void> Function(String password)? deleteAccountForAccount;
  String? _deletedAccountEmail;
  bool _deletingAccount = false;
  Future<void> Function()? addComputer;
  Future<void> Function()? removeComputer;
  String? expectedAccount;
  String? browserAuthorizationId;

  void copyAccountPreferences(AppController source) {
    _agentOrder = source._agentOrder;
    _visibleAgents = source._visibleAgents;
    haptics.enabled = source.haptics.enabled;
    fontSizeListenable.value = source.fontSizeListenable.value;
    notificationPrimerSeen = source.notificationPrimerSeen;
    notificationPermissionRequested = source.notificationPermissionRequested;
    _preferredLocaleTag = source._preferredLocaleTag;
    if (_locale != source._locale) _applyLocale(source._locale, notify: false);
  }

  Future<void> clearLocalHistoryKeys() async {
    await _invalidateHistoryCache();
    try {
      for (final encoded in (await _secureStore.historyKeys()).values) {
        final key = base64Decode(encoded);
        try {
          await _historyStore.removeNamespace(key);
          await _imageCacheStore.removeNamespace(key);
        } finally {
          key.fillRange(0, key.length, 0);
        }
      }
    } catch (_) {
      _recordHistoryPerformance({'stage': 'cache_cleanup_failed'});
    }
    await _secureStore.clearHistoryKeys();
  }

  Future<void> deleteAccount(String password) async {
    if (deleteAccountForAccount != null) {
      return deleteAccountForAccount!(password);
    }
    if (_deletedAccountEmail != email) {
      await api.deleteAccount(password);
      _deletedAccountEmail = email;
    }
    _deletingAccount = true;
    try {
      await logout();
      _deletedAccountEmail = null;
    } finally {
      _deletingAccount = false;
    }
  }

  Future<void> logout() async {
    if (logoutAccount != null) return logoutAccount!();
    await beforeLogout?.call().catchError((Object _) {});
    haptics.cancelAll();
    _approvalHaptics.clear();
    _approvalOutcomes.clear();
    _approvalNotice = null;
    _stopRealtime();
    await _invalidateHistoryCache();
    await api.logout().catchError((_) {});
    await _secureStore.clearSession();
    if (_deletingAccount) await _secureStore.clearDeletedAccount(email);
    phase = AppPhase.signedOut;
    loginStage = LoginStage.email;
    bootstrap = null;
    desktopInfo = null;
    sessions = const [];
    projects = const [];
    _directorySessions.clear();
    usageByProvider = const {};
    runningSessions.clear();
    _clearStopRequests();
    _activeTurns.clear();
    _activeTurnObservedAt.clear();
    _latestCatalogObservedAt = null;
    _catalogIdleObservedAt.clear();
    _idleTurnObservedAt.clear();
    messages.clear();
    _liveReplies.clear();
    _historyLoaded.clear();
    historyCursors.clear();
    historyHasMore.clear();
    _historyEarlierErrors.clear();
    _historyErrors.clear();
    _historyFileAccessDenied.clear();
    catalogFileAccessLimited = false;
    _agentActivityLoading.clear();
    _agentActivityErrors.clear();
    _pendingUserMessages.clear();
    _codexQueueStatuses.clear();
    _codexMessageSettings.clear();
    _sessionActivities.clear();
    _transientThinking.clear();
    _recentlyCreatedSessions.clear();
    _clearAttachmentCache();
    _sessionCreationInFlight = false;
    _sessionCreationAttempt = null;
    _pendingSessionCreations.clear();
    _pendingReplyBranches.clear();
    _notify();
  }

  Future<void> clearPairing() async {
    // Do not destroy the working in-memory connection if local storage fails.
    await _invalidateHistoryCache();
    await _secureStore.clearPairing();
    haptics.cancelAll();
    _approvalHaptics.clear();
    _approvalOutcomes.clear();
    _approvalNotice = null;
    _stopRealtime();
    desktopInfo = null;
    _directTransport?.close();
    _directTransport = null;
    _directReadResults.clear();
    relayKey?.dispose();
    relayKey = null;
    api.browserToken = null;
    browserAuthorizationId = null;
    _projectAliasAuthorizationScope = null;
    _projectAliases = const {};
    sessions = const [];
    projects = const [];
    _directorySessions.clear();
    usageByProvider = const {};
    runningSessions.clear();
    _clearStopRequests();
    _activeTurns.clear();
    _activeTurnObservedAt.clear();
    _latestCatalogObservedAt = null;
    _catalogIdleObservedAt.clear();
    _idleTurnObservedAt.clear();
    approvals = const [];
    agents = const [];
    messages.clear();
    _liveReplies.clear();
    _historyLoaded.clear();
    historyCursors.clear();
    historyHasMore.clear();
    _historyEarlierErrors.clear();
    _historyErrors.clear();
    _historyFileAccessDenied.clear();
    catalogFileAccessLimited = false;
    _pendingUserMessages.clear();
    _codexQueueStatuses.clear();
    _codexMessageSettings.clear();
    _sessionActivities.clear();
    _transientThinking.clear();
    _recentlyCreatedSessions.clear();
    _clearAttachmentCache();
    _sessionCreationInFlight = false;
    _sessionCreationAttempt = null;
    _pendingSessionCreations.clear();
    _pendingReplyBranches.clear();
    activeSessionId = null;
    opaqueCursor = 0;
    connectionSnapshot = const DeviceConnectionSnapshot.initial();
  }

  Future<void> disconnectAndPairAgain() async {
    await clearPairing();
    // Opening the scanner is a local transition, including while offline.
    // Manual entry discovers waiting computers when requested.
    bootstrap = null;
    pendingPairingId = null;
    pendingBrowserPairings = const [];
    pairingPhase = PairingPhase.idle;
    error = '';
    notice = '';
    phase = AppPhase.needsPairing;
    _notify();
  }

  void clearBanners() {
    error = '';
    notice = '';
    _notify();
  }

  void _clearAttachmentCache() {
    _attachmentCacheGeneration += 1;
    _imageLoadQueue.clear();
    _attachmentCache.clear();
    _attachmentLoads.clear();
    _attachmentCacheBytes = 0;
    _imageCacheTouches.clear();
  }

  Future<Map<String, dynamic>> _readOnlineOrServer(
    OnlineStream stream,
    String type,
    String? sessionId,
    Map<String, dynamic> payload,
    String requestId,
    Map<String, dynamic> frame,
  ) async {
    final key = relayKey!;
    final deviceId = bootstrap!.device.id;
    final epoch = _historyCacheEpoch;
    final directoryEpoch = _directoryEpoch;
    bool current() =>
        !_disposed &&
        _directoryForeground &&
        relayKey == key &&
        bootstrap?.device.id == deviceId &&
        epoch == _historyCacheEpoch &&
        directoryEpoch == _directoryEpoch;
    final expected = type.startsWith('project.')
        ? const {'project.result'}
        : switch (type) {
            'session.read_history' => const {
              'session.history',
              'session.history_error',
            },
            'session.read_attachment' => const {
              'session.attachment',
              'session.attachment_error',
            },
            _ => const {'session.agents', 'session.agents_error'},
          };
    Future<Map<String, dynamic>> validate(OpaqueFrame response) async {
      if (!current()) throw StateError('request_cancelled');
      if (response.deviceId != deviceId ||
          response.sessionId != sessionId ||
          response.requestId != requestId ||
          response.aad.direction != 'relay_to_web' ||
          response.aad.deviceId != deviceId ||
          response.aad.sessionId != sessionId ||
          response.aad.requestId != requestId ||
          response.aad.eventSeq != null ||
          !expected.contains(response.aad.type)) {
        throw const FormatException('online_response_route');
      }
      final value = await _cipher.openJson<Map<String, dynamic>>(
        key,
        response.envelope,
        response.aad,
      );
      if (!current() ||
          value['type'] != response.aad.type ||
          value['request_id'] != requestId ||
          value['session_id'] != sessionId) {
        throw const FormatException('online_response_invalid');
      }
      return value;
    }

    Future<Map<String, dynamic>> readOriginalResponse() async {
      final result = Completer<Map<String, dynamic>>();
      final abort = Completer<void>();
      final watch = Stopwatch()..start();
      const budget = Duration(seconds: 8);
      Timer? hedge, deadline, authorization, retry;
      var onlineFailed = false, httpFailed = false, httpStarted = false;
      void fail(Object error, StackTrace stack) {
        if (!result.isCompleted) result.completeError(error, stack);
      }

      void branchFailed(Object error, StackTrace stack, {required bool http}) {
        if (result.isCompleted) return;
        if (!current()) {
          fail(StateError('request_cancelled'), stack);
          return;
        }
        if (!http && error is OnlineRequestNotSentError) {
          fail(error, stack);
          return;
        }
        // A server denial is authoritative even if a stale WSS can still reply.
        if (error is RelayApiException &&
            (error.status == 401 || error.status == 403)) {
          fail(error, stack);
          return;
        }
        if (http) {
          httpFailed = true;
        } else {
          onlineFailed = true;
        }
        if (onlineFailed && httpFailed) fail(error, stack);
      }

      Future<void> retrieve() async {
        if (httpStarted || result.isCompleted) return;
        httpStarted = true;
        try {
          if (!current()) throw StateError('request_cancelled');
          while (!result.isCompleted) {
            if (!current()) throw StateError('request_cancelled');
            final remaining = budget - watch.elapsed;
            if (remaining <= Duration.zero) {
              throw TimeoutException('online_read_timeout');
            }
            try {
              final response = await api.encryptedResponse(
                requestId,
                preserveCompression: type == 'session.read_history',
                abortTrigger: abort.future,
                maxWait: remaining,
                onProgress:
                    type == 'session.read_history' &&
                        payload['include_progress'] == true &&
                        sessionId != null
                    ? (download) {
                        if (current() && !result.isCompleted) {
                          _setHistoryTransferProgress(
                            sessionId,
                            requestId,
                            download,
                          );
                        }
                      }
                    : null,
              );
              final value = await validate(response);
              if (!result.isCompleted) result.complete(value);
              return;
            } on RelayApiException catch (error) {
              if (error.status != 404 ||
                  !const {
                    'response_pending',
                    'not_found',
                    'response_wait_timeout',
                  }.contains(error.code)) {
                rethrow;
              }
              // New servers have already waited. Older servers return pending
              // immediately, so renew briefly within the same read deadline.
              final renew = Completer<void>();
              retry = Timer(
                error.code == 'response_wait_timeout'
                    ? Duration.zero
                    : const Duration(milliseconds: 250),
                () => renew.complete(),
              );
              await Future.any<void>([abort.future, renew.future]);
              retry?.cancel();
              retry = null;
            }
          }
        } catch (error, stack) {
          branchFailed(error, stack, http: true);
        }
      }

      // Online replies remain the fast path. The hedge only GETs the original
      // encrypted response; it never readmits or reseals the command.
      final onlineRequest = stream.request(frame);
      unawaited(() async {
        try {
          final raw = await onlineRequest;
          if (_onlineStream != stream) throw StateError('stream_cancelled');
          final value = await validate(OpaqueFrame.fromJson(raw));
          if (!result.isCompleted) result.complete(value);
        } catch (error, stack) {
          branchFailed(error, stack, http: false);
          unawaited(retrieve());
        }
      }());
      hedge = Timer(
        const Duration(milliseconds: 500),
        () => unawaited(retrieve()),
      );
      deadline = Timer(
        budget,
        () => fail(TimeoutException('online_read_timeout'), StackTrace.current),
      );
      authorization = Timer.periodic(const Duration(milliseconds: 100), (_) {
        if (!current()) {
          fail(StateError('request_cancelled'), StackTrace.current);
        }
      });
      try {
        return await result.future;
      } finally {
        hedge.cancel();
        deadline.cancel();
        authorization.cancel();
        retry?.cancel();
        abort.complete();
        stream.cancelRequest(requestId, expectedFuture: onlineRequest);
      }
    }

    try {
      final value = await readOriginalResponse();
      if (!current()) throw StateError('request_cancelled');
      return value;
    } catch (error) {
      if (!current()) {
        throw StateError('request_cancelled');
      }
      if (error is RelayApiException &&
          (error.status == 401 || error.status == 403)) {
        rethrow;
      }
      // A timed-out read may still reply on its original WSS lane. A distinct
      // authenticated request lets HTTP recover without waiting on that ID.
      // Writes never enter this read-only lane and retain their exact frame.
      final fallback = await _sendEncryptedCommand(
        type,
        sessionId,
        payload,
        forceServer: true,
        onSealed: (_) {
          if (!current()) throw StateError('request_cancelled');
        },
      );
      if (!current()) throw StateError('request_cancelled');
      final value = await _waitForEncryptedResponse(
        fallback.requestId,
        timeout: const Duration(seconds: 45),
        retryTransientErrors: true,
        serverOnly: true,
        preserveCompression: type == 'session.read_history',
        current: current,
        onProgress:
            type == 'session.read_history' &&
                payload['include_progress'] == true &&
                sessionId != null
            ? (download) {
                if (current()) {
                  _setHistoryTransferProgress(sessionId, requestId, download);
                }
              }
            : null,
        acceptsFrame: (response) =>
            response.sessionId == sessionId &&
            response.aad.sessionId == sessionId &&
            response.aad.eventSeq == null &&
            expected.contains(response.aad.type),
      );
      if (!current()) throw StateError('request_cancelled');
      if (!expected.contains(value['type']) ||
          value['request_id'] != fallback.requestId ||
          value['session_id'] != sessionId) {
        throw const FormatException('online_response_invalid');
      }
      // Callers keep waiting on the logical original request. Only this local
      // projection changes; the verified AAD and ciphertext keep the new ID.
      return {...value, 'request_id': requestId};
    }
  }

  Future<void> _onlineControl(
    OnlineStream stream,
    String type,
    Map<String, dynamic> payload, {
    bool reply = true,
  }) async {
    final key = relayKey!;
    final deviceId = bootstrap!.device.id;
    final id = _randomId('req');
    final createdAt = DateTime.now().toUtc().toIso8601String();
    final expiresAt = DateTime.now()
        .toUtc()
        .add(const Duration(seconds: 30))
        .toIso8601String();
    final connectionId = stream.connectionId;
    final aad = RelayAad(
      direction: 'web_to_relay',
      type: type,
      deviceId: deviceId,
      sessionId: null,
      requestId: id,
      eventSeq: null,
      createdAt: createdAt,
      expiresAt: expiresAt,
    );
    final envelope = await _cipher.sealJson(key, {
      'type': type,
      'device_id': deviceId,
      'session_id': null,
      'request_id': id,
      'payload': {...payload, 'connection_id': connectionId},
      'issued_at': createdAt,
      'expires_at': expiresAt,
    }, aad);
    if (_onlineStream != stream || _realtimePaused || relayKey != key) {
      throw StateError('stream_cancelled');
    }
    final frame = <String, dynamic>{
      'device_id': deviceId,
      'session_id': null,
      'request_id': id,
      'command_type': type,
      'aad': aad.toJson(),
      'envelope': envelope.toJson(),
    };
    if (!reply) {
      stream.send(frame);
      return;
    }
    final response = OpaqueFrame.fromJson(await stream.request(frame));
    if (_onlineStream != stream ||
        response.deviceId != deviceId ||
        response.requestId != id ||
        response.aad.direction != 'relay_to_web' ||
        response.aad.deviceId != deviceId ||
        response.aad.sessionId != null ||
        response.aad.requestId != id ||
        response.aad.type != 'transport.ready') {
      throw const FormatException('online_resume_route');
    }
    final value = await _cipher.openJson<Map<String, dynamic>>(
      key,
      response.envelope,
      response.aad,
    );
    if (value['type'] != 'transport.ready' ||
        value['request_id'] != id ||
        value['connection_id'] != connectionId) {
      throw const FormatException('online_resume_invalid');
    }
  }

  @visibleForTesting
  void startOnlineForTesting() {
    _realtimePaused = false;
    _connectOnline();
  }

  void _connectOnline() {
    if (_disposed ||
        _realtimePaused ||
        _onlineReplaced ||
        !_directoryForeground ||
        !_supportsOnlineStream ||
        _onlineStream != null ||
        api.sessionToken == null ||
        api.browserToken == null) {
      return;
    }
    final key = relayKey;
    final deviceId = bootstrap!.device.id;
    _onlineCatalogReceived = false;
    _onlineRecoveryPending = true;
    _onlineDirectoryRevision = null;
    late final OnlineStream stream;
    stream = OnlineStream(
      origin: api.origin,
      connectSocket: api.connectSocket,
      sessionToken: api.sessionToken!,
      browserToken: api.browserToken!,
      deviceId: deviceId,
      onOnline: () => _recoverOnline(stream),
      onPresence: (online) {
        if (!online) {
          _onlineRecoveryPending = true;
          _onlineCatalogReceived = false;
        }
        connectionSnapshot = connectionSnapshot
            .applyPresence(
              online: online,
              lastSeenAt: connectionSnapshot.lastSeenAt,
              revision: connectionSnapshot.revision + 1,
            )
            .withTransport(RealtimeTransportState.connected);
        _notify();
      },
      onClosed: () {
        if (_onlineStream != stream) return;
        if (!_onlineCatalogReceived && !_directoryConfirmed) {
          _directoryLoadFailed = true;
        }
        _onlineStream = null;
        _onlineReplaced = stream.closeCode == 4001;
        if (!_disposed && !_realtimePaused && _directoryForeground) {
          connectionSnapshot = connectionSnapshot
              .applyPresence(
                online: false,
                lastSeenAt: connectionSnapshot.lastSeenAt,
                revision: connectionSnapshot.revision + 1,
              )
              .withTransport(
                _onlineReplaced
                    ? RealtimeTransportState.idle
                    : RealtimeTransportState.reconnecting,
              );
          _notify();
          _onlineRetry?.cancel();
          _onlineRetry = null;
          // A replaced subscriber stops competing, but its stale presence must
          // not keep the phone's sending and live-sync UI in a ready state.
          if (!_onlineReplaced) {
            _onlineRetry = Timer(
              realtimeReconnectDelay(
                attempt: _onlineRetryAttempt++,
                randomValue: _random.nextDouble(),
              ),
              _connectOnline,
            );
          }
        }
      },
      onFrame: (raw) async {
        if (_disposed || _onlineStream != stream || relayKey != key) return;
        final frame = OpaqueFrame.fromJson(raw);
        if (frame.deviceId != deviceId ||
            frame.aad.deviceId != deviceId ||
            frame.aad.direction != 'relay_to_web' ||
            frame.aad.sessionId != frame.sessionId ||
            frame.aad.requestId != frame.requestId) {
          throw const FormatException('online_frame_route');
        }
        if (raw['kind'] == 'catalog' &&
            frame.aad.type == 'relay.sync_sessions') {
          final catalog = await _decryptCatalog(frame, key!);
          final value = await _cipher.openJson<Map<String, dynamic>>(
            key,
            frame.envelope,
            frame.aad,
          );
          if (_onlineStream != stream) return;
          desktopInfo = catalog.desktopInfo;
          catalogFileAccessLimited = catalog.fileAccessLimited;
          _onlineDirectoryRevision = value['directory_revision'] as String?;
          _replaceCatalog(
            sessions: desktopInfo?.supportsSessionDirectory == true
                ? sessions
                : catalog.sessions,
            projects: desktopInfo?.supportsSessionDirectory == true
                ? projects
                : catalog.projects,
            usageByProvider: catalog.usageByProvider,
            replaceUsage: true,
          );
          _onlineCatalogReceived = true;
          unawaited(_syncSessionDirectory());
          _recoverOnline(stream);
          _notify();
        } else if (raw['kind'] == 'event' &&
            frame.aad.type == 'session.event') {
          final createdAt = DateTime.tryParse(frame.aad.createdAt);
          if (frame.eventId == null ||
              frame.aad.eventSeq == null ||
              frame.aad.eventSeq != raw['event_seq'] ||
              createdAt == null ||
              createdAt.isAfter(
                DateTime.now().add(const Duration(minutes: 2)),
              ) ||
              DateTime.now().difference(createdAt) >=
                  const Duration(minutes: 10)) {
            throw const FormatException('online_event_route');
          }
          final event = await _decryptEvent(frame);
          if (_onlineStream != stream) return;
          _applyEvent(event);
          _notifyEvent(event);
          await _onlineControl(stream, 'transport.event_ack', {
            'event_id': frame.eventId,
            'event_seq': frame.aad.eventSeq,
          }, reply: false);
        } else if (raw['kind'] == 'response' &&
            frame.aad.type == 'transport.resync_required') {
          final value = await _cipher.openJson<Map<String, dynamic>>(
            key!,
            frame.envelope,
            frame.aad,
          );
          if (value['type'] != 'transport.resync_required' ||
              value['connection_id'] != stream.connectionId) {
            throw const FormatException('online_resync_invalid');
          }
          _onlineRecoveryPending = true;
          _recoverOnline(stream);
        }
      },
    );
    _onlineStream = stream;
    unawaited(
      stream.connect().catchError((Object _) {
        stream.close();
      }),
    );
  }

  Future<void> _refreshOnlineBaseline() async {
    await _syncSessionDirectory();
    // A validated complete snapshot is a baseline even if a newer catalog
    // revision arrived in transit. Push-driven directory sync catches up;
    // requiring equality would starve live delivery while any agent is active.
    if (desktopInfo?.supportsSessionDirectory == true &&
        (_directoryLoadFailed ||
            !_directoryConfirmed ||
            _sessionDirectory.cursor != null)) {
      throw StateError('directory_resync_pending');
    }
    final sessionId = activeSessionId;
    if (sessionId != null) {
      _historyLoaded.remove(sessionId);
      await _refreshPersistedHistory(sessionId, requiredForRecovery: true);
      if (!_historyLoaded.contains(sessionId)) {
        throw StateError('history_resync_pending');
      }
    }
  }

  void _recoverOnline(OnlineStream stream) {
    if (_disposed ||
        _onlineStream != stream ||
        _onlineRecovery != null ||
        !_onlineRecoveryPending ||
        !_onlineCatalogReceived ||
        !stream.available ||
        _realtimePaused) {
      return;
    }
    // Consume pending work at entry, not completion: a resync arriving during
    // either baseline stays pending and is drained by this same recovery path.
    _onlineRecoveryPending = false;
    _onlineRetry?.cancel();
    _onlineRetry = null;
    var failed = false;
    final operation = () async {
      _historyLoaded.clear();
      await _refreshOnlineBaseline();
      if (_onlineStream != stream || _realtimePaused) return;
      await _onlineControl(stream, 'transport.resume', {});
      // Close the baseline-to-resume race while new events are being accepted.
      // Resolve the visible session again in case it changed during recovery.
      await _refreshOnlineBaseline();
      if (_onlineStream != stream || _realtimePaused) return;
      _onlineRetryAttempt = 0;
    }();
    _onlineRecovery = operation;
    unawaited(
      operation
          .catchError((Object _) {
            failed = true;
            _onlineRecoveryPending = true;
            if (_onlineStream == stream && !_realtimePaused && !_disposed) {
              _onlineRetry?.cancel();
              _onlineRetry = Timer(
                realtimeReconnectDelay(
                  attempt: _onlineRetryAttempt++,
                  randomValue: _random.nextDouble(),
                ),
                () => _recoverOnline(stream),
              );
            }
          })
          .whenComplete(() {
            if (identical(_onlineRecovery, operation)) _onlineRecovery = null;
            final current = _onlineStream;
            if (current != null &&
                (current != stream || (_onlineRecoveryPending && !failed))) {
              _recoverOnline(current);
            }
          }),
    );
  }

  void _startRealtime() {
    if (phase != AppPhase.ready || _disposed || !_directoryForeground) return;
    _realtimePaused = false;
    _onlineReplaced = false;
    _startDirectorySync();
    _connectOnline();
    _syncAutomaticRoute();
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    final generation = _advanceRealtimeGeneration();
    if (!_supportsOnlineStream) unawaited(_connectRealtime(generation));
  }

  Future<void> _connectRealtime(int generation) async {
    final deviceId = bootstrap?.device.id;
    final sessionToken = api.sessionToken;
    final browserToken = api.browserToken;
    if (_realtimePaused ||
        !_directoryForeground ||
        phase != AppPhase.ready ||
        deviceId == null ||
        sessionToken == null ||
        browserToken == null) {
      return;
    }
    _setTransport(
      _reconnectAttempt == 0
          ? RealtimeTransportState.connecting
          : RealtimeTransportState.reconnecting,
    );
    try {
      final connection = await _realtimeConnector.connect(
        origin: api.origin,
        sessionToken: sessionToken,
        browserToken: browserToken,
        deviceId: deviceId,
      );
      if (generation != _realtimeGeneration || _realtimePaused || _disposed) {
        await connection.close();
        return;
      }
      _realtimeConnection = connection;
      _realtimeSubscription = connection.signals.listen(
        (signal) => unawaited(_handleRealtimeSignal(signal)),
        onError: (_) => _handleRealtimeClosed(connection, generation),
        onDone: () => _handleRealtimeClosed(connection, generation),
      );
    } catch (_) {
      if (generation == _realtimeGeneration && !_realtimePaused) {
        _scheduleRealtimeReconnect();
      }
    }
  }

  Future<void> _handleRealtimeSignal(RealtimeSignal signal) async {
    final deviceId = bootstrap?.device.id;
    if (!_directoryForeground || signal.deviceId != deviceId) return;
    if (signal.type == 'ready') {
      _reconnectAttempt = 0;
      _setTransport(RealtimeTransportState.connected);
      try {
        if (_onlineStream?.available != true) await _catchUpEvents();
      } on RelayApiException catch (exception) {
        if (exception.status == 401 &&
            exception.code == 'browser_unauthorized') {
          await _handleRevokedRealtime();
        }
      } on FormatException {
        error = _l10n.controllerInvalidEncryptedEvent;
        _notify();
      }
      return;
    }
    if (signal.type == 'presence') {
      final online = signal.online;
      final revision = signal.revision;
      if (online == null || revision == null) return;
      final next = connectionSnapshot.applyPresence(
        online: online,
        lastSeenAt: signal.lastSeenAt,
        revision: revision,
      );
      if (!identical(next, connectionSnapshot)) {
        connectionSnapshot = next;
        if (next.online) {
          for (final entry in _sessionActivities.entries.toList()) {
            if (entry.value.clientMessageId != null &&
                entry.value.waitingForComputer) {
              _sessionActivities[entry.key] = (
                label: _l10n.controllerWaitingForAgent,
                clientMessageId: entry.value.clientMessageId,
                waitingForComputer: false,
                receivedByComputer: false,
              );
            }
          }
          final session = activeSession;
          if (session != null &&
              _historyVisibleSession == session.id &&
              !_historyLoaded.contains(session.id)) {
            unawaited(loadHistory(session.id, silent: true));
          }
        }
        _notify();
      }
      return;
    }
    if (signal.type == 'heartbeat') {
      final receivedAt = signal.serverTime;
      final roundTripMs = signal.roundTripMs;
      if (receivedAt == null || roundTripMs == null || roundTripMs < 0) return;
      connectionSnapshot = connectionSnapshot.observeWebSocketHeartbeat(
        receivedAt: receivedAt,
        roundTripMs: roundTripMs,
      );
      return;
    }
    if (signal.type == 'invalidate') {
      if (signal.scopes.contains('responses')) {
        for (final waiter in _responseWaiters.toList()) {
          if (!waiter.isCompleted) waiter.complete();
        }
      }
      if (_onlineStream?.available == true) return;
      _pendingInvalidationScopes.addAll(signal.scopes);
      // Catalog/history requests can be slow, especially for a new session.
      // Drain text independently while retaining one cursor reader per lane.
      await Future.wait([
        _drainInvalidations(eventsOnly: true),
        _drainInvalidations(eventsOnly: false),
      ]);
    }
  }

  Future<void> _drainInvalidations({required bool eventsOnly}) async {
    if (eventsOnly) {
      if (_synchronizingEventInvalidations) return;
      _synchronizingEventInvalidations = true;
    } else {
      if (_synchronizingInvalidations) return;
      _synchronizingInvalidations = true;
    }
    try {
      while (true) {
        final scopes = _pendingInvalidationScopes
            .where((scope) => (scope == 'events') == eventsOnly)
            .toSet();
        if (scopes.isEmpty) break;
        _pendingInvalidationScopes.removeAll(scopes);
        if (scopes.contains('events')) await _catchUpEvents();
        if (scopes.contains('catalog')) {
          _catalogMetadataDirty = true;
        } else if (scopes.contains('queue')) {
          await _refreshQueueStatus();
        }
      }
    } on RelayApiException catch (exception) {
      if (exception.status == 401 && exception.code == 'browser_unauthorized') {
        await _handleRevokedRealtime();
      }
    } on FormatException {
      error = _l10n.controllerInvalidEncryptedEvent;
      _notify();
    } finally {
      if (eventsOnly) {
        _synchronizingEventInvalidations = false;
      } else {
        _synchronizingInvalidations = false;
      }
    }
  }

  Future<void> _catchUpEvents() async {
    if (!_directoryForeground) return;
    final generation = _realtimeGeneration;
    if (_eventCatchUp == null) _eventCatchUpGeneration = generation;
    final operation = _eventCatchUp ??= _performEventCatchUp();
    try {
      await operation;
      if (generation != _realtimeGeneration ||
          _disposed ||
          !_directoryForeground) {
        return;
      }
      if (_eventCatchUpGeneration != generation) {
        if (identical(_eventCatchUp, operation)) _eventCatchUp = null;
        await _catchUpEvents();
        return;
      }
      _eventRetryTimer?.cancel();
      _eventRetryTimer = null;
      _eventRetryAttempt = 0;
    } on RelayApiException catch (exception) {
      // Every waiting generation owns its recovery, even when it shares an
      // older in-flight read. Cursor reads themselves remain serialized.
      if (generation == _realtimeGeneration &&
          !_disposed &&
          (exception.status == 0 ||
              exception.status == 408 ||
              exception.status == 429 ||
              exception.status >= 500)) {
        _scheduleEventRetry(generation);
      }
      rethrow;
    } finally {
      if (identical(_eventCatchUp, operation)) _eventCatchUp = null;
    }
  }

  int _advanceRealtimeGeneration() {
    _eventRetryTimer?.cancel();
    _eventRetryTimer = null;
    _eventRetryAttempt = 0;
    return ++_realtimeGeneration;
  }

  void _scheduleEventRetry(int generation) {
    if (_disposed ||
        !_directoryForeground ||
        phase != AppPhase.ready ||
        _eventRetryTimer != null) {
      return;
    }
    // Keep one retry per cursor lane. No new invalidation is required to recover.
    final seconds = 1 << (_eventRetryAttempt > 5 ? 5 : _eventRetryAttempt);
    _eventRetryAttempt += 1;
    _eventRetryTimer = Timer(
      Duration(seconds: seconds > 30 ? 30 : seconds),
      () {
        _eventRetryTimer = null;
        if (_disposed ||
            generation != _realtimeGeneration ||
            !_directoryForeground ||
            phase != AppPhase.ready) {
          return;
        }
        _pendingInvalidationScopes.add('events');
        unawaited(_drainInvalidations(eventsOnly: true));
      },
    );
  }

  Future<void> _refreshQueueStatus() async {
    final deviceId = bootstrap?.device.id;
    if (deviceId == null || deviceId.isEmpty) return;
    final status = await api.queueStatus(deviceId: deviceId);
    final current = bootstrap;
    if (_disposed || current == null || current.device.id != deviceId) return;
    if (status.device.id != deviceId) {
      throw const FormatException('服务器返回了另一台设备。');
    }
    bootstrap = ServerBootstrap(
      email: current.email,
      accountDisplayName: current.accountDisplayName,
      device: current.device,
      catalog: current.catalog,
      events: current.events,
      cursor: current.cursor,
      ackSequence: status.ackSequence,
      queuedCommands: status.queuedCommands,
      onlineTransportVersion: current.onlineTransportVersion,
    );
    _notify();
  }

  Future<void> _performEventCatchUp() async {
    final deviceId = bootstrap?.device.id;
    final key = relayKey;
    if (phase != AppPhase.ready || deviceId == null) return;
    final generation = _realtimeGeneration;
    while (_directoryForeground && generation == _realtimeGeneration) {
      var changed = false;
      final startingCursor = opaqueCursor;
      final page = await api.pollEvents(
        deviceId: deviceId,
        cursor: opaqueCursor,
      );
      if (_disposed ||
          !_directoryForeground ||
          generation != _realtimeGeneration ||
          bootstrap?.device.id != deviceId ||
          !identical(relayKey, key)) {
        return;
      }
      if (page.resyncRequired) {
        if (page.nextCursor < 0) {
          throw const FormatException('invalid_event_cursor');
        }
        _historyLoaded.clear();
        final sessionId = activeSessionId;
        if (sessionId != null) {
          await _refreshPersistedHistory(sessionId, requiredForRecovery: true);
          if (_disposed ||
              !_directoryForeground ||
              generation != _realtimeGeneration ||
              bootstrap?.device.id != deviceId ||
              !identical(relayKey, key)) {
            return;
          }
          // Keep the old cursor on failure so the next catch-up retries history.
          if (!_historyLoaded.contains(sessionId)) {
            throw const RelayApiException(
              'History recovery is pending.',
              0,
              'history_resync_pending',
            );
          }
        }
        opaqueCursor = page.nextCursor;
        _notify();
        return;
      }
      for (final frame in page.events) {
        final cursor = frame.cursor ?? 0;
        if (!_directoryForeground ||
            _disposed ||
            generation != _realtimeGeneration) {
          return;
        }
        if (cursor <= opaqueCursor) continue;
        final event = await _decryptEvent(frame);
        // Catalog refresh and event catch-up can decrypt the same frame.
        // Recheck after the await so a delta is never applied twice.
        if (!_directoryForeground ||
            _disposed ||
            generation != _realtimeGeneration) {
          return;
        }
        if (cursor <= opaqueCursor) continue;
        _applyEvent(event);
        opaqueCursor = cursor;
        changed = true;
      }
      // Publish each applied page before awaiting the next network request.
      // A live turn or first reply must not wait for the entire backlog to drain.
      if (changed) _notify();
      if (!page.hasMore || opaqueCursor <= startingCursor) break;
    }
  }

  void _handleRealtimeClosed(RealtimeConnection connection, int generation) {
    if (generation != _realtimeGeneration ||
        !identical(connection, _realtimeConnection)) {
      return;
    }
    _realtimeConnection = null;
    _realtimeSubscription = null;
    if (connection.closeCode == 4401) {
      unawaited(_handleRevokedRealtime());
      return;
    }
    if (!_realtimePaused) _scheduleRealtimeReconnect();
  }

  Future<void> _handleRevokedRealtime() async {
    await clearPairing();
    try {
      bootstrap = await api.bootstrap();
      email = bootstrap!.email;
    } catch (_) {}
    phase = AppPhase.needsPairing;
    notice = _l10n.controllerAuthorizationRevoked;
    _notify();
  }

  void _scheduleRealtimeReconnect() {
    if (_realtimePaused ||
        !_directoryForeground ||
        phase != AppPhase.ready ||
        _disposed) {
      return;
    }
    _setTransport(RealtimeTransportState.reconnecting);
    _reconnectTimer?.cancel();
    final delay = realtimeReconnectDelay(
      attempt: _reconnectAttempt,
      randomValue: _random.nextDouble(),
      base: RelayConfig.realtimeReconnectBase,
      maximum: RelayConfig.realtimeReconnectMax,
    );
    _reconnectAttempt += 1;
    final generation = _advanceRealtimeGeneration();
    _reconnectTimer = Timer(
      delay,
      () => unawaited(_connectRealtime(generation)),
    );
  }

  void _setTransport(RealtimeTransportState state) {
    if (connectionSnapshot.transport == state) return;
    connectionSnapshot = connectionSnapshot.withTransport(state);
    _notify();
  }

  void pauseRealtime() {
    _stopRealtime();
    // A suspended read cannot own the next foreground entry. Request IDs guard
    // late completions; resume starts one fresh read for the visible session.
    _historyLoadProgress.clear();
    _historyReads.clear();
    _persistedHistoryRefreshes.clear();
    historyLoading.clear();
    historyEarlierLoading.clear();
  }

  Future<void> resumeRealtime({bool restoreConversation = true}) async {
    if (phase != AppPhase.ready || !_directoryForeground || _disposed) return;
    final generation = _realtimeGeneration;
    // Home keeps the last selection for navigation, but has no visible history
    // to restore. Do not make its reconnect wait behind a hidden full snapshot.
    if (restoreConversation &&
        activeSessionId != null &&
        messages[activeSessionId]?.isNotEmpty != true) {
      await loadHistory(activeSessionId!, silent: true, localOnly: true);
      if (!_directoryForeground ||
          generation != _realtimeGeneration ||
          _disposed) {
        return;
      }
    }
    if (localReadOnly) {
      await initialize();
      return;
    }
    _stopRealtime();
    connectionSnapshot = connectionSnapshot.resetRealtimeConfirmation();
    // Existing pairing credentials can read the Desktop's cached directory
    // while bootstrap catches up metadata/events. Do not restart again after
    // bootstrap: that would invalidate a newer directory response in flight.
    _startRealtime();
    final resumedGeneration = _realtimeGeneration;
    await refresh();
    if (!_directoryForeground ||
        resumedGeneration != _realtimeGeneration ||
        _disposed) {
      return;
    }
    final sessionId = activeSessionId;
    if ((restoreConversation || _historyVisibleSession == sessionId) &&
        !_disposed &&
        phase == AppPhase.ready &&
        sessionId != null) {
      // Event retention is finite. Reopening an already loaded conversation
      // must also recover final replies and tool results from durable history.
      await _refreshPersistedHistory(sessionId);
    }
  }

  void _stopRealtime() {
    _transientThinking.invalidate();
    _eventPublicationTimer?.cancel();
    _eventPublicationTimer = null;
    _realtimePaused = true;
    _onlineRetry?.cancel();
    _onlineRetry = null;
    _onlineStream?.close();
    _onlineStream = null;
    _onlineResults.clear();
    _directoryTimer?.cancel();
    _directoryTimer = null;
    _directoryEpoch++;
    _directoryRequest = null;
    _directoryRefreshVisible = false;
    _realtimePaused = true;
    _automaticRoute.stop();
    _directWasReady = false;
    _directReadEpoch++;
    _directTransport?.close();
    _directTransport = null;
    _directReadResults.clear();
    _eventRetryTimer?.cancel();
    _eventRetryTimer = null;
    _eventRetryAttempt = 0;
    _realtimePaused = true;
    _advanceRealtimeGeneration();
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    final subscription = _realtimeSubscription;
    _realtimeSubscription = null;
    unawaited(subscription?.cancel());
    final connection = _realtimeConnection;
    _realtimeConnection = null;
    unawaited(connection?.close());
    _reconnectAttempt = 0;
    _pendingInvalidationScopes.clear();
    for (final waiter in _responseWaiters.toList()) {
      if (!waiter.isCompleted) waiter.complete();
    }
    _setTransport(RealtimeTransportState.idle);
  }

  void _applyEvent(RelayEvent record) {
    if (record.event['kind'] == 'turn.thinking') {
      // Acknowledge through the normal encrypted stream, but never checkpoint
      // a phase hint into persistent history or advance its history baseline.
      _applyEventToMemory(record);
      return;
    }
    if (record.event['kind'] == 'history.read_progress') {
      final progress = historyProgressFor(record.sessionId);
      if (progress == null ||
          progress.responseReady ||
          progress.requestId != record.event['request_id'] ||
          (record.sourceSequence > 0 &&
              record.sourceSequence <= progress.sourceSequence)) {
        return;
      }
      final phase = switch (record.event['stage']) {
        'queued' => HistoryLoadPhase.waiting,
        'reading' => HistoryLoadPhase.reading,
        'preparing' => HistoryLoadPhase.preparing,
        'sending' => HistoryLoadPhase.transferring,
        _ => null,
      };
      if (phase != null) {
        final observedPhase = progress.receivedBytes == null
            ? phase
            : HistoryLoadPhase.transferring;
        if (progress.phase != observedPhase) _recordHistoryPhase(progress);
        int? bytes(String field) {
          final value = record.event[field];
          return value is int && value >= 0 && value <= 9007199254740991
              ? value
              : null;
        }

        final read = bytes('source_read_bytes');
        final total = bytes('source_total_bytes');
        final validSource = read != null && total != null && read <= total;
        _historyLoadProgress[record.sessionId] = progress.withPhase(
          observedPhase,
          sourceSequence: record.sourceSequence,
          sourceReadBytes: validSource ? read : null,
          sourceTotalBytes: validSource ? total : null,
          transferBytes: phase == HistoryLoadPhase.transferring
              ? bytes('transfer_bytes')
              : null,
        );
      }
      // This ephemeral UI hint is never history, runtime activity or a cache
      // checkpoint. Its encrypted event receipt is still acknowledged normally.
      return;
    }
    final previousSource = _applyingSourceSequence;
    _applyingSourceSequence = record.sourceSequence;
    if (record.sourceSequence >
        (_sessionSourceSequences[record.sessionId] ?? 0)) {
      _sessionSourceSequences[record.sessionId] = record.sourceSequence;
    }
    try {
      _applyEventToMemory(record);
    } finally {
      _applyingSourceSequence = previousSource;
      _scheduleHistoryCache(
        record.sessionId,
        immediate: const {
          'user.message',
          'message.completed',
          'turn.completed',
          'message.deleted',
        }.contains(record.event['kind']),
      );
    }
  }

  String? _agentEventRoot(
    RelayEvent record,
    RelayAgent? existing,
    String threadId,
    String? parentThreadId,
  ) {
    final claimed = record.event['root_session_id'] as String?;
    final provider =
        record.event['provider'] as String? ??
        sessions
            .where(
              (s) =>
                  s.id == existing?.parentSessionId ||
                  s.id == claimed ||
                  s.id == parentThreadId ||
                  s.id == record.sessionId,
            )
            .firstOrNull
            ?.provider ??
        activeSession?.provider;
    if (provider != 'codex') {
      return claimed ?? existing?.parentSessionId ?? record.sessionId;
    }
    bool rootId(String? id) =>
        id != null &&
        id.isNotEmpty &&
        id != threadId &&
        id != 'external' &&
        !sessions.any((s) => s.id == id && s.isSubagent) &&
        !agents.any((a) => a.threadId == id);
    // Runtime updates cannot move an already identified child between roots.
    // Authoritative snapshots still repair old or incomplete ownership.
    if (rootId(existing?.parentSessionId)) return existing!.parentSessionId;
    if (rootId(claimed)) return claimed;
    for (final id in [parentThreadId, record.sessionId]) {
      final parent = sessions.where((s) => s.id == id).firstOrNull;
      if (rootId(parent?.rootSessionId)) return parent!.rootSessionId;
      final parentAgent = agents.where((a) => a.threadId == id).firstOrNull;
      if (rootId(parentAgent?.parentSessionId)) {
        return parentAgent!.parentSessionId;
      }
    }
    return rootId(record.sessionId) ? record.sessionId : null;
  }

  void _applyEventToMemory(RelayEvent record) {
    if (!_seenEvents.add(record.eventId)) return;
    if (_seenEvents.length > 10000) {
      _seenEvents.remove(_seenEvents.first);
    }
    _eventNotifications.handleDecryptedEvent(
      record,
      isRootSession: _eventBelongsToRootSession(record),
    );
    final event = record.event;
    final kind = event['kind'] as String? ?? '';
    if (kind == 'message.deleted' && event['message_id'] is String) {
      _historyDeletionGeneration++;
      final id = event['message_id'] as String;
      messages[record.sessionId] = [
        for (final m in messages[record.sessionId] ?? const <RelayMessage>[])
          if (m.id != id) m,
      ];
      _queueHistoryCache(record.sessionId, deletedId: id);
      return;
    }
    final turnId = event['turn_id'] as String? ?? record.eventId;
    _transientThinking.observe(
      record,
      activeTurnId: _activeTurns[record.sessionId],
    );
    if (kind == 'turn.thinking') return;
    if (kind == 'approval.requested' && event['approval_id'] is String) {
      final outcome =
          _approvalOutcomes[(record.sessionId, event['approval_id'] as String)];
      final requestedAt = DateTime.tryParse(
        event['requested_at'] as String? ?? record.createdAt,
      );
      final replayDecision =
          outcome != null &&
              requestedAt != null &&
              !requestedAt.isAfter(outcome.at)
          ? outcome.decision
          : null;
      if (replayDecision == null) {
        _setSessionActivity(record.sessionId, _l10n.controllerApprovalNeeded);
      }
      final approval = RelayApproval(
        id: event['approval_id'] as String,
        turnId: event['turn_id'] as String?,
        sessionId: record.sessionId,
        targetSessionId: event['session_id'] as String? ?? record.sessionId,
        action: jsonMap(event['action']),
        riskLevel: event['risk_level'] as String? ?? 'high',
        state: replayDecision ?? 'pending',
        requestedAt: event['requested_at'] as String? ?? record.createdAt,
        expiresAt: event['expires_at'] as String,
        sourceAgentName: event['source_agent_name'] as String?,
        sourceThreadId: event['source_thread_id'] as String?,
        sourceAgentId: event['source_agent_id'] as String?,
      );
      approvals = [
        approval,
        ...approvals.where((item) => item.id != approval.id),
      ];
      return;
    }
    if (kind == 'approval.resolved' && event['approval_id'] is String) {
      final key = (record.sessionId, event['approval_id'] as String);
      _approvalOutcomes[key] = (
        decision: event['decision'] as String? ?? 'expired',
        at: DateTime.tryParse(record.createdAt) ?? DateTime.now(),
      );
      if (_approvalOutcomes.length > 2048) {
        _approvalOutcomes.remove(_approvalOutcomes.keys.first);
      }
      _clearApprovalNotice(event['approval_id'] as String);
      final ticket = _approvalHaptics.remove(event['approval_id']);
      if (const {'approved', 'rejected'}.contains(event['decision'])) {
        haptics.confirm(ticket, RelayHapticEvent.decisionConfirmed);
      } else {
        haptics.cancel(ticket);
      }
      approvals = approvals.map((approval) {
        if (approval.id != event['approval_id']) return approval;
        return approval.copyWith(
          state: event['decision'] as String? ?? 'expired',
        );
      }).toList();
      if (runningSessions.contains(record.sessionId)) {
        _setSessionActivity(record.sessionId, _l10n.controllerContinuing);
      }
      return;
    }
    if (kind == 'approval.failed' && event['approval_id'] is String) {
      _clearApprovalNotice(event['approval_id'] as String);
      haptics.cancel(_approvalHaptics.remove(event['approval_id']));
      approvals = approvals.map((approval) {
        if (approval.id != event['approval_id'] ||
            !const {'pending', 'deciding'}.contains(approval.state)) {
          return approval;
        }
        final stillValid =
            DateTime.tryParse(approval.expiresAt)?.isAfter(DateTime.now()) ==
            true;
        return approval.copyWith(state: stillValid ? 'pending' : 'expired');
      }).toList();
      error =
          event['error'] as String? ?? _l10n.controllerApprovalProcessFailed;
      return;
    }
    if (kind == 'session.config_updated' && event['config_options'] is List) {
      _applySessionConfigOptions(record.sessionId, event['config_options']);
      return;
    }
    if (kind.startsWith('agent.') && record.agentId != null) {
      final existing = agents
          .where((agent) => agent.id == record.agentId)
          .firstOrNull;
      final threadId =
          event['thread_id'] as String? ??
          existing?.threadId ??
          record.agentId!;
      final parentThreadId =
          event['parent_thread_id'] as String? ?? existing?.parentThreadId;
      final rootSessionId = _agentEventRoot(
        record,
        existing,
        threadId,
        parentThreadId,
      );
      if (rootSessionId == null) return;
      final status =
          event['agent_status'] as String? ??
          switch (kind) {
            'agent.completed' => 'completed',
            'agent.failed' => 'errored',
            'agent.interrupted' => 'interrupted',
            _ => 'running',
          };
      final next = RelayAgent(
        id: record.agentId!,
        threadId: threadId,
        parentSessionId: rootSessionId,
        name: event['name'] as String? ?? existing?.name ?? 'Agent',
        nickname: event['nickname'] as String? ?? existing?.nickname,
        role: event['role'] as String? ?? existing?.role,
        parentThreadId: parentThreadId,
        task: event['task'] as String? ?? existing?.task ?? '',
        status: status,
        progress:
            (event['progress'] as num?)?.toInt() ??
            (const {
                  'completed',
                  'errored',
                  'interrupted',
                  'shutdown',
                }.contains(status)
                ? 100
                : existing?.progress ?? 0),
        summary: event['summary'] as String? ?? existing?.summary,
        activity: event['current_activity'] as String? ?? existing?.activity,
        updatedAt: event['updated_at'] as String? ?? record.createdAt,
        model: event['model'] as String? ?? existing?.model,
        reasoningEffort:
            event['reasoning_effort'] as String? ?? existing?.reasoningEffort,
        tool: event['tool'] as String? ?? existing?.tool,
        toolCount:
            (event['tool_count'] as num?)?.toInt() ?? existing?.toolCount,
        tokenCount:
            (event['token_count'] as num?)?.toInt() ?? existing?.tokenCount,
        contextTokens:
            (event['context_tokens'] as num?)?.toInt() ??
            existing?.contextTokens,
        permissionMode:
            event['permission_mode'] as String? ?? existing?.permissionMode,
        swarmMode: event['swarm_mode'] as bool? ?? existing?.swarmMode,
        activityLog: event['activity_log'] is List
            ? jsonMapList(
                event['activity_log'],
              ).map(RelayAgentActivity.fromJson).toList(growable: false)
            : existing?.activityLog ?? const [],
        canOpen: event['can_open'] as bool? ?? existing?.canOpen ?? true,
        startedAt:
            event['started_at'] as String? ??
            existing?.startedAt ??
            (kind == 'agent.started' ? record.createdAt : null),
      );
      agents = _mergeAgents(agents, [next]);
      if (next.isActive) {
        _setSessionActivity(
          next.parentSessionId,
          next.activity?.trim().isNotEmpty == true
              ? '${next.name}：${next.activity}'
              : _l10n.controllerAgentProcessing(next.name),
        );
      } else if (runningSessions.contains(next.parentSessionId)) {
        _setSessionActivity(next.parentSessionId, _l10n.controllerSummarizing);
      }
      return;
    }
    if (kind == 'turn.started' || kind == 'turn.steered') {
      final idleAt = _catalogIdleObservedAt[record.sessionId];
      final eventAt = DateTime.tryParse(record.createdAt);
      if (idleAt != null && eventAt != null && eventAt.isBefore(idleAt)) {
        return;
      }
      runningSessions.add(record.sessionId);
      _idleTurnObservedAt.remove(record.sessionId);
      _activeTurns[record.sessionId] = turnId;
      _activeTurnObservedAt[record.sessionId] =
          DateTime.tryParse(record.createdAt) ?? DateTime.now().toUtc();
      _transientThinking.observe(record, activeTurnId: turnId);
      _setSessionActivity(record.sessionId, _l10n.controllerContinuing);
      messages[record.sessionId] = [
        for (final message in messages[record.sessionId] ?? const [])
          if (message.kind != 'codex.queue.waiting' ||
              message.clientMessageId != null)
            message,
      ];
      final pendingMessageId = _pendingUserMessages.remove(record.sessionId);
      if (pendingMessageId != null) {
        messages[record.sessionId] = [
          for (final message in messages[record.sessionId] ?? const [])
            if (message.id == pendingMessageId)
              message.copyWith(turnId: turnId)
            else
              message,
        ];
      }
      return;
    }
    if (kind == 'turn.completed' || kind == 'turn.failed') {
      final activeTurnId = _activeTurns[record.sessionId];
      if (activeTurnId != null && activeTurnId != turnId) return;
      final stop = _stopHaptics[record.sessionId];
      if (kind == 'turn.completed' &&
          event['status'] == 'interrupted' &&
          stop?.$2 != null &&
          stop!.$2 == turnId) {
        haptics.confirm(stop.$1, RelayHapticEvent.stopConfirmed);
      }
      _finishStopRequest(record.sessionId);
      _liveReplies.completeTurn(record.sessionId, turnId);
      runningSessions.remove(record.sessionId);
      _idleTurnObservedAt[record.sessionId] =
          DateTime.tryParse(record.createdAt) ?? DateTime.now().toUtc();
      _activeTurns.remove(record.sessionId);
      _transientThinking.forget(record.sessionId);
      _activeTurnObservedAt.remove(record.sessionId);
      _sessionActivities.remove(record.sessionId);
      messages[record.sessionId] = [
        for (final message in messages[record.sessionId] ?? const [])
          if (message.turnId == turnId &&
              message.toolActivityStatus == 'running')
            message.copyWith(
              toolActivityStatus: kind == 'turn.failed'
                  ? 'failed'
                  : 'completed',
            )
          else
            message,
      ];
      if (kind == 'turn.completed' && event['status'] == 'interrupted') {
        // Retain the terminal timestamp through history refreshes so stopping
        // does not look like a failed tool or truncate the displayed duration.
        _upsertMessage(
          record.sessionId,
          RelayMessage(
            id: 'turn_stopped_$turnId',
            role: 'system',
            content: _l10n.liveTaskStopped,
            createdAt: record.createdAt,
            kind: 'turn.stopped',
            turnId: turnId,
            turnStatus: 'interrupted',
          ),
        );
      }
      if (!(kind == 'turn.completed' && event['status'] == 'interrupted')) {
        _upsertMessage(
          record.sessionId,
          RelayMessage(
            id: 'turn-terminal:$turnId',
            role: 'system',
            content: kind == 'turn.failed'
                ? event['error'] as String? ?? _l10n.controllerLocalTaskFailed
                : '',
            createdAt: record.createdAt,
            kind: kind,
            turnId: turnId,
            turnStatus: kind == 'turn.failed'
                ? 'failed'
                : event['status'] as String? ?? 'completed',
          ),
        );
      }
      if (kind == 'turn.completed') {
        _hydrateLatestReplyHistory(record.sessionId);
      }
      return;
    }
    if (kind == 'message.failed') {
      final clientId = event['client_message_id'] as String?;
      // A rejected submission is terminal only for its own delivery activity.
      // An older failure must not clear a newer send or an active turn.
      if (clientId != null &&
          _sessionActivities[record.sessionId]?.clientMessageId == clientId) {
        _sessionActivities.remove(record.sessionId);
      }
      if (clientId != null) {
        _setMessageDeliveryState(
          record.sessionId,
          clientId,
          MessageDeliveryState.failed,
        );
      }
      _upsertMessage(
        record.sessionId,
        RelayMessage(
          id: record.eventId,
          role: 'system',
          content: event['error'] as String? ?? _l10n.controllerLocalTaskFailed,
          createdAt: record.createdAt,
          kind: kind,
        ),
      );
      return;
    }
    if (kind == 'turn.interrupt_failed') {
      _finishStopRequest(record.sessionId);
      _upsertMessage(
        record.sessionId,
        RelayMessage(
          id: record.eventId,
          role: 'system',
          content: event['error'] as String? ?? _l10n.controllerInterruptFailed,
          createdAt: record.createdAt,
          kind: kind,
          turnId: turnId,
        ),
      );
      return;
    }
    if (kind == 'user.message') {
      final activeTurnId = _activeTurns[record.sessionId];
      final eventTurnId = event['turn_id'] as String? ?? activeTurnId;
      final clientMessageId = event['client_message_id'] as String?;
      final localMessage = clientMessageId == null
          ? null
          : (messages[record.sessionId] ?? const <RelayMessage>[])
                .where((message) => message.clientMessageId == clientMessageId)
                .firstOrNull;
      if (clientMessageId != null) {
        messages[record.sessionId] = [
          for (final message in messages[record.sessionId] ?? const [])
            if (message.clientMessageId != clientMessageId) message,
        ];
      }
      // Only a matching local submission advances delivery feedback. Replayed
      // history and other clients' messages must not create a preparing state.
      final pendingActivity = _sessionActivities[record.sessionId];
      if (localMessage?.kind == 'local.user.message' &&
          !runningSessions.contains(record.sessionId) &&
          (pendingActivity == null ||
              pendingActivity.clientMessageId == clientMessageId)) {
        _sessionActivities[record.sessionId] = (
          label: _l10n.controllerPreparingAgent,
          clientMessageId: clientMessageId,
          waitingForComputer: false,
          receivedByComputer: true,
        );
      }
      final messageId = event['item_id'] as String? ?? record.eventId;
      if (eventTurnId == null) {
        _pendingUserMessages[record.sessionId] = messageId;
      }
      final incomingAttachments = jsonMapList(
        event['attachments'],
      ).map(RelayAttachment.fromJson).toList(growable: false);
      _upsertMessage(
        record.sessionId,
        RelayMessage(
          id: messageId,
          role: 'user',
          content: event['text'] as String? ?? '',
          createdAt: record.createdAt,
          kind: kind,
          turnId: eventTurnId,
          clientMessageId: clientMessageId,
          attachments: [
            for (final attachment in incomingAttachments)
              RelayAttachment(
                id: attachment.id,
                type: attachment.type,
                name: attachment.name,
                mimeType: attachment.mimeType,
                url: attachment.url,
                previewSupported: attachment.previewSupported,
                thumbnailBytes: localMessage?.attachments
                    .where((candidate) => candidate.id == attachment.id)
                    .firstOrNull
                    ?.thumbnailBytes,
              ),
          ],
        ),
      );
      return;
    }
    if (kind == 'message.delta' || kind == 'message.completed') {
      _setSessionActivity(
        record.sessionId,
        kind == 'message.delta'
            ? _l10n.controllerReplying
            : _l10n.controllerFinishing,
      );
      final itemId = event['item_id'] as String?;
      final messageId = itemId == null
          ? 'agent_$turnId'
          : 'agent_${turnId}_$itemId';
      final previous = (messages[record.sessionId] ?? const <RelayMessage>[])
          .where((m) => m.id == messageId)
          .lastOrNull;
      if (record.sourceSequence > 0 &&
          (previous?.sourceSequence ?? 0) >= record.sourceSequence) {
        return;
      }
      final text = event['text'] as String? ?? '';
      if (record.sessionId == activeSessionId) {
        if (kind == 'message.delta') {
          _liveReplies.append(
            sessionId: record.sessionId,
            turnId: turnId,
            messageId: messageId,
            text: text,
            createdAt: record.createdAt,
            initialText:
                _liveReplies.listenableFor(record.sessionId, messageId) != null
                ? ''
                : (messages[record.sessionId] ?? const <RelayMessage>[])
                          .where((message) => message.id == messageId)
                          .lastOrNull
                          ?.content ??
                      '',
          );
        } else {
          _liveReplies.complete(
            sessionId: record.sessionId,
            turnId: turnId,
            messageId: messageId,
            text: text,
            createdAt: record.createdAt,
          );
        }
      }
      _upsertMessage(
        record.sessionId,
        RelayMessage(
          id: messageId,
          role: 'codex',
          content: text,
          createdAt: record.createdAt,
          kind: kind,
          turnId: turnId,
          messagePhase: event['message_phase'] as String?,
          attachments: jsonMapList(
            event['attachments'],
          ).map(RelayAttachment.fromJson).toList(growable: false),
        ),
        append: kind == 'message.delta',
      );
      return;
    }
    if (const {
      'command.started',
      'command.output',
      'command.completed',
    }.contains(kind)) {
      _upsertToolActivity(record, turnId);
      return;
    }
    if (kind == 'file.changed') {
      _setSessionActivity(
        record.sessionId,
        _l10n.controllerOrganizingFileChanges,
      );
      final changes = jsonMapList(event['changes']);
      final count = changes.isEmpty ? 1 : changes.length;
      final subject = _compactToolActivityValue(
        changes
            .map((change) => change['path']?.toString().trim())
            .whereType<String>()
            .where((path) => path.isNotEmpty)
            .toSet()
            .join('、'),
        160,
      );
      final label = _toolActivityLabel(
        type: 'file_change',
        name: null,
        subject: subject,
        count: count,
        command: null,
        fallback: _l10n.workbenchToolChangeFile,
      );
      _upsertMessage(
        record.sessionId,
        RelayMessage(
          id: record.eventId,
          role: 'system',
          content: _l10n.controllerFilesModified(count),
          createdAt: record.createdAt,
          kind: kind,
          turnId: turnId,
          toolActivityLabel: label,
          toolActivityStatus: 'completed',
          toolActivityType: 'file_change',
          toolActivitySubject: subject,
          toolActivityCount: count,
        ),
      );
      return;
    }
    if (kind == 'plan.updated') {
      _setSessionActivity(record.sessionId, _l10n.controllerUpdatingPlan);
      final plan = jsonMapList(event['plan'])
          .map((item) {
            final marker = switch (item['status']) {
              'completed' => '✓',
              'inProgress' => '→',
              _ => '○',
            };
            return '$marker ${item['step']}';
          })
          .join('\n');
      _upsertMessage(
        record.sessionId,
        RelayMessage(
          id: event['item_id'] as String? ?? 'plan_$turnId',
          role: 'system',
          content: [
            event['explanation'],
            plan,
          ].whereType<String>().where((item) => item.isNotEmpty).join('\n'),
          createdAt: record.createdAt,
          kind: kind,
          turnId: turnId,
        ),
      );
      return;
    }
    if (kind == 'codex.queue.updated') {
      final clientId = event['client_message_id'] as String?;
      final status = event['status'] as String?;
      if (clientId == null || status == null) return;
      final key = '${record.sessionId}/$clientId';
      _codexQueueStatuses[key] = status;
      if (_codexQueueStatuses.length > 1000) {
        _codexQueueStatuses.remove(_codexQueueStatuses.keys.first);
      }
      final id = 'codex_queue_$clientId';
      if (status == 'queued' || status == 'unconfirmed') {
        _upsertMessage(
          record.sessionId,
          RelayMessage(
            id: id,
            role: 'system',
            content: status == 'queued'
                ? _l10n.controllerMessageQueued
                : _l10n.controllerQueueUnconfirmed,
            createdAt: record.createdAt,
            kind: 'codex.queue.waiting',
            clientMessageId: clientId,
          ),
        );
      } else {
        messages[record.sessionId] = [
          for (final message
              in messages[record.sessionId] ?? const <RelayMessage>[])
            if (message.id != id) message,
        ];
        unawaited(_refreshPersistedHistory(record.sessionId));
      }
      return;
    }
    if (kind == 'codex.persisted') {
      // Shared receipt: the pre-interrupt user event may inherit the old turn.
      // Rebind only the matching submission once its actual turn is known.
      final submittedTurn = event['turn_id'] as String?;
      final submittedClient = event['client_message_id'] as String?;
      if (event['operation'] == 'turn' &&
          event['mode'] != 'queued' &&
          submittedTurn != null &&
          submittedClient != null) {
        messages[record.sessionId] = [
          for (final message
              in messages[record.sessionId] ?? const <RelayMessage>[])
            if (message.role == 'user' &&
                message.clientMessageId == submittedClient)
              message.copyWith(turnId: submittedTurn)
            else
              message,
        ];
      }
      if (event['operation'] == 'turn' && event['mode'] == 'queued') {
        final clientId = event['client_message_id'] as String?;
        if (clientId != null &&
            _codexQueueStatuses.containsKey('${record.sessionId}/$clientId')) {
          return;
        }
        _upsertMessage(
          record.sessionId,
          RelayMessage(
            id: clientId == null
                ? 'codex_queue_waiting'
                : 'codex_queue_$clientId',
            clientMessageId: clientId,
            role: 'system',
            content: event['persisted'] == false
                ? _l10n.controllerQueueUnconfirmed
                : _l10n.controllerMessageQueued,
            createdAt: record.createdAt,
            kind: 'codex.queue.waiting',
          ),
        );
        return;
      }
      if (event['persisted'] != false && event['operation'] == 'thread') {
        if (record.sessionId == activeSessionId) {
          final provider =
              sessions
                  .where((session) => session.id == record.sessionId)
                  .firstOrNull
                  ?.provider ??
              event['provider'] as String? ??
              '';
          notice = _l10n.controllerSessionPersisted(
            agentProviderDisplayName(provider),
          );
        }
        unawaited(_refreshPersistedHistory(record.sessionId));
      }
    }
  }

  bool _eventBelongsToRootSession(RelayEvent record) {
    final session = sessions
        .where((candidate) => candidate.id == record.sessionId)
        .firstOrNull;
    if (session != null) return !session.isSubagent;
    if (agents.any((agent) => agent.threadId == record.sessionId)) return false;
    final rootSessionId = record.event['root_session_id'];
    return rootSessionId is! String ||
        rootSessionId.isEmpty ||
        rootSessionId == record.sessionId;
  }

  RelayMessage? _completedLiveLatestReply(String sessionId) {
    if (_historyVisibleSession != sessionId ||
        runningSessions.contains(sessionId) ||
        sessionActivity(sessionId) != null ||
        !sessions.any((s) => s.id == sessionId && s.forkMode == 'latest')) {
      return null;
    }
    final history = messages[sessionId] ?? const <RelayMessage>[];
    final reply = history
        .where((m) => m.role == 'codex' && m.content.trim().isNotEmpty)
        .lastOrNull;
    final turnId = reply?.turnId;
    if (reply == null ||
        turnId == null ||
        history.last.turnId != turnId ||
        !(reply.id == 'agent_$turnId' ||
            reply.id.startsWith('agent_${turnId}_') ||
            reply.id == 'codex_$turnId')) {
      return null;
    }
    final turn = history.where((m) => m.turnId == turnId).toList();
    if (conversationTurnStatus(turn, active: false, online: deviceOnline) !=
        ConversationTurnStatus.completed) {
      return null;
    }
    return turn.where((m) => m.kind == 'turn.completed').lastOrNull;
  }

  void _hydrateLatestReplyHistory(
    String sessionId, {
    bool afterCurrentRead = false,
  }) {
    if (_completedLiveLatestReply(sessionId) == null) return;
    final pending = _persistedHistoryRefreshes[sessionId];
    if (afterCurrentRead && pending != null) {
      final epoch = _historyCacheEpoch, generation = _realtimeGeneration;
      unawaited(
        pending.then((_) {
          if (!_disposed &&
              _directoryForeground &&
              epoch == _historyCacheEpoch &&
              generation == _realtimeGeneration) {
            _hydrateLatestReplyHistory(sessionId);
          }
        }, onError: (Object _, StackTrace __) {}),
      );
      return;
    }
    unawaited(_refreshPersistedHistory(sessionId));
  }

  Future<void> _refreshPersistedHistory(
    String sessionId, {
    bool requiredForRecovery = false,
  }) {
    if (!requiredForRecovery && _historyVisibleSession != sessionId) {
      return Future.value();
    }
    final existing = _persistedHistoryRefreshes[sessionId];
    if (existing != null) return existing;
    final epoch = _historyCacheEpoch;
    final generation = _realtimeGeneration;
    final operation = () async {
      final reading = _historyReads[sessionId];
      if (reading != null) await reading;
      if (_disposed ||
          !_directoryForeground ||
          epoch != _historyCacheEpoch ||
          generation != _realtimeGeneration ||
          relayKey == null ||
          bootstrap?.device.id == null ||
          (!requiredForRecovery && _historyVisibleSession != sessionId)) {
        return;
      }
      while (true) {
        final completedBefore =
            _completedLiveLatestReply(sessionId)?.sourceSequence ?? 0;
        try {
          await loadHistory(sessionId, silent: true);
        } catch (_) {
          // Keep the live reply when native history is not ready. A later entry
          // can retry; hydration itself never permits a presentation alias.
        }
        final completedAfter =
            _completedLiveLatestReply(sessionId)?.sourceSequence ?? 0;
        if (_disposed ||
            !_directoryForeground ||
            epoch != _historyCacheEpoch ||
            generation != _realtimeGeneration ||
            completedAfter <= completedBefore) {
          break;
        }
        // A newer successful turn finished during the coalesced read. Read its
        // boundary once; unchanged or failed native reads never start polling.
      }
    }();
    _persistedHistoryRefreshes[sessionId] = operation;
    return operation.whenComplete(() {
      if (identical(_persistedHistoryRefreshes[sessionId], operation)) {
        _persistedHistoryRefreshes.remove(sessionId);
      }
    });
  }

  void _upsertMessage(
    String sessionId,
    RelayMessage next, {
    bool append = false,
  }) {
    if (_applyingSourceSequence > 0) {
      next = next.copyWith(sourceSequence: _applyingSourceSequence);
    }
    final current = [...?messages[sessionId]];
    final index = current.lastIndexWhere((message) => message.id == next.id);
    if (index >= 0 &&
        next.sourceSequence > 0 &&
        current[index].sourceSequence >= next.sourceSequence) {
      return;
    }
    final merged = index < 0
        ? next
        : next.copyWith(
            content: append
                ? '${current[index].content}${next.content}'
                : next.content,
            attachments: next.attachments.isNotEmpty
                ? next.attachments
                : current[index].attachments,
          );
    placeMessageInOrder(current, merged, existingIndex: index);
    messages[sessionId] = current;
    _scheduleHistoryCache(sessionId, immediate: next.role == 'user');
  }

  void _upsertToolActivity(RelayEvent record, String turnId) {
    final event = record.event;
    final kind = event['kind'] as String? ?? 'command.started';
    final id = 'command_${turnId}_${event['item_id'] ?? 'legacy'}';
    final currentMessages = [...?messages[record.sessionId]];
    final index = currentMessages.lastIndexWhere((message) => message.id == id);
    final previous = index < 0 ? null : currentMessages[index];
    if (record.sourceSequence > 0 &&
        (previous?.sourceSequence ?? 0) >= record.sourceSequence) {
      return;
    }
    final status = _toolActivityStatus(kind, event['status']);
    final activityType =
        event['activity_type'] as String? ?? previous?.toolActivityType;
    final activityName =
        event['activity_name'] as String? ?? previous?.toolActivityName;
    final activitySubject =
        event['activity_subject'] as String? ?? previous?.toolActivitySubject;
    final activityCommand =
        _toolActivityCommandValue(event['command']) ??
        previous?.toolActivityCommand;
    final activityCount =
        (event['activity_count'] as num?)?.toInt() ??
        previous?.toolActivityCount;
    final incomingAttachments = jsonMapList(
      event['attachments'],
    ).map(RelayAttachment.fromJson).toList(growable: false);
    final attachments = incomingAttachments.isNotEmpty
        ? incomingAttachments
        : previous?.attachments ?? const <RelayAttachment>[];
    final label = _toolActivityLabel(
      type: activityType,
      name: activityName,
      subject: activitySubject,
      count: activityCount,
      command: activityCommand,
      fallback: previous?.toolActivityLabel ?? _l10n.workbenchLocalOperation,
    );
    final incomingDetail = event['text'] as String? ?? '';
    final previousDetail = previous?.toolActivityDetail ?? '';
    final combinedDetail = status == 'running'
        ? '$previousDetail$incomingDetail'
        : incomingDetail.isNotEmpty
        ? incomingDetail
        : previousDetail;
    final detail = combinedDetail.length <= _toolActivityDetailLimit
        ? combinedDetail
        : combinedDetail.substring(
            combinedDetail.length - _toolActivityDetailLimit,
          );
    final next = RelayMessage(
      id: id,
      role: 'system',
      content: _l10n.controllerLocalTool(label),
      createdAt: previous?.createdAt ?? record.createdAt,
      kind: kind,
      turnId: turnId,
      attachments: attachments,
      toolActivityLabel: label,
      toolActivityDetail: detail,
      toolActivityStatus: status,
      toolActivityType: activityType,
      toolActivityName: activityName,
      toolActivitySubject: activitySubject,
      toolActivityCommand: activityCommand,
      toolActivityCount: activityCount,
      sourceSequence: record.sourceSequence,
    );
    placeMessageInOrder(currentMessages, next, existingIndex: index);
    messages[record.sessionId] = currentMessages;
    _setSessionActivity(
      record.sessionId,
      status == 'running'
          ? _l10n.workbenchActivityRunning(label)
          : _l10n.controllerProcessingLocalResult,
    );
  }

  String _toolActivityLabel({
    required String? type,
    required String? name,
    required String? subject,
    required int? count,
    required String? command,
    required String fallback,
  }) {
    final compactName = _compactToolActivityValue(name, 100);
    final compactSubject = _compactToolActivityValue(subject, 160);
    return switch (type ?? (command != null ? 'command' : null)) {
      'command' => _l10n.workbenchToolCommand,
      'file_read' when count != null && count > 1 && compactSubject != null =>
        _l10n.workbenchToolReadFilesSubject(count, compactSubject),
      'file_read' when count != null && count > 1 =>
        _l10n.workbenchToolReadFiles(count),
      'file_read' when compactSubject != null =>
        _l10n.workbenchToolReadFileSubject(compactSubject),
      'file_read' => _l10n.workbenchToolReadFile,
      'file_change' when count != null && count > 1 && compactSubject != null =>
        _l10n.workbenchToolChangeFilesSubject(count, compactSubject),
      'file_change' when count != null && count > 1 =>
        _l10n.workbenchToolChangeFiles(count),
      'file_change' when compactSubject != null =>
        _l10n.workbenchToolChangeFileSubject(compactSubject),
      'file_change' => _l10n.workbenchToolChangeFile,
      'mcp_tool' || 'dynamic_tool' || 'tool_call' when compactName != null =>
        _l10n.workbenchToolCallNamed(compactName),
      'mcp_tool' || 'dynamic_tool' || 'tool_call' => _l10n.workbenchToolCall,
      'web_search' when compactSubject != null =>
        _l10n.workbenchToolWebSearchSubject(compactSubject),
      'web_search' => _l10n.workbenchToolWebSearch,
      'image_view' when compactSubject != null =>
        _l10n.workbenchToolImageViewSubject(compactSubject),
      'image_view' => _l10n.workbenchToolImageView,
      'image_generation' => _l10n.workbenchToolImageGeneration,
      'context_compaction' => _l10n.workbenchToolContextCompaction,
      'wait' => _l10n.workbenchToolWait,
      _ => _compactToolActivityValue(command, 100) ?? fallback,
    };
  }

  String? _compactToolActivityValue(Object? value, int limit) {
    final text = value?.toString().replaceAll(RegExp(r'\s+'), ' ').trim() ?? '';
    if (text.isEmpty) return null;
    return text.length <= limit ? text : '${text.substring(0, limit - 1)}…';
  }

  String? _toolActivityCommandValue(Object? value) {
    Object? command = value;
    if (value is List) {
      final parts = value
          .map((part) => part.toString())
          .toList(growable: false);
      final shellFlagIndex = parts.indexWhere(
        (part) => part == '-c' || part == '-lc',
      );
      command = shellFlagIndex >= 0 && shellFlagIndex < parts.length - 1
          ? parts[shellFlagIndex + 1]
          : parts.join(' ');
    }
    return _compactToolActivityValue(command, 2000);
  }

  String _toolActivityStatus(String kind, Object? rawStatus) {
    final status = rawStatus?.toString().toLowerCase() ?? '';
    if (const {
      'failed',
      'error',
      'errored',
      'cancelled',
      'canceled',
    }.contains(status)) {
      return 'failed';
    }
    if (kind == 'command.completed' ||
        const {'completed', 'success', 'succeeded', 'done'}.contains(status)) {
      return 'completed';
    }
    return 'running';
  }

  void _setMessageDeliveryState(
    String sessionId,
    String clientMessageId,
    MessageDeliveryState state, {
    bool onlyIfSending = false,
  }) {
    messages[sessionId] = [
      for (final message in messages[sessionId] ?? const [])
        if (message.clientMessageId == clientMessageId &&
            (!onlyIfSending ||
                message.deliveryState == MessageDeliveryState.sending))
          message.copyWith(deliveryState: state)
        else
          message,
    ];
    _scheduleHistoryCache(sessionId, immediate: true);
  }

  void _setSessionActivity(String sessionId, String label) {
    _sessionActivities[sessionId] = (
      label: label,
      clientMessageId: null,
      waitingForComputer: false,
      receivedByComputer: false,
    );
  }

  List<RelayMessage> _mergeMessages(List<RelayMessage> input) {
    final byId = <String, RelayMessage>{};
    for (final message in input) {
      byId[message.id] = message;
    }
    // Cache snapshots can overlap a newer live echo under a different item ID.
    // Correlate only stable client IDs; repeated text is a valid separate send.
    final userByClientId = <String, RelayMessage>{};
    for (final message in byId.values) {
      final clientId = message.clientMessageId;
      if (message.role != 'user' || clientId == null) continue;
      final previous = userByClientId[clientId];
      if (previous == null || message.kind != 'local.user.message') {
        userByClientId[clientId] = message;
      }
    }
    final output =
        byId.values.where((message) {
            final clientId = message.clientMessageId;
            return message.role != 'user' ||
                clientId == null ||
                identical(userByClientId[clientId], message);
          }).toList()
          ..sort((left, right) => left.createdAt.compareTo(right.createdAt));
    return output;
  }

  List<RelayMessage> _mergeHistoryMessages(
    String sessionId,
    List<RelayMessage> history,
    List<RelayMessage> current,
  ) {
    history = history.map((m) {
      final live = current.where((row) => row.id == m.id).firstOrNull;
      if (live != null &&
          live.sourceSequence > m.sourceSequence &&
          m.role == 'codex' &&
          m.content.startsWith(live.content)) {
        return m.copyWith(sourceSequence: live.sourceSequence);
      }
      return m;
    }).toList();
    final activeTurnId = runningSessions.contains(sessionId)
        ? _activeTurns[sessionId]
        : null;
    final authoritativeAssistantTurns = history
        .where((message) => message.role == 'codex' && message.turnId != null)
        .map((message) => message.turnId!)
        .toSet();
    final authoritativeAssistantMessages = history
        .where((message) => message.role == 'codex' && message.turnId != null)
        .map(_assistantMessageFingerprint)
        .toSet();
    final authoritativeUserClientIds = history
        .where(
          (message) =>
              message.role == 'user' &&
              message.kind != 'local.user.message' &&
              message.clientMessageId != null,
        )
        .map((message) => message.clientMessageId!)
        .toSet();
    final settledToolIds = history
        .where(
          (message) => const {
            'completed',
            'failed',
          }.contains(message.toolActivityStatus),
        )
        .map((message) => message.id)
        .toSet();
    final nativeTail = history.lastOrNull;
    final snapshotSequence = history.fold<int>(
      0,
      (value, message) => max(value, message.sourceSequence),
    );
    final completedLiveTurns = <String>{};
    if (sessions.any((s) => s.id == sessionId && s.forkMode == 'latest') &&
        nativeTail?.role == 'codex' &&
        nativeTail?.turnId != null &&
        (nativeTail!.turnStatus == 'completed' ||
            nativeTail.messagePhase == 'final_answer') &&
        !nativeTail.id.startsWith('agent_') &&
        snapshotSequence > 0) {
      bool canonicalReply(RelayMessage m) =>
          m.role == 'codex' &&
          m.turnId != null &&
          m.content.trim().isNotEmpty &&
          (m.messagePhase == null || m.messagePhase == 'final_answer') &&
          !(m.id == 'agent_${m.turnId}' ||
              m.id.startsWith('agent_${m.turnId}_') ||
              m.id == 'codex_${m.turnId}');
      final knownTail = current.where(canonicalReply).lastOrNull;
      final incoming = history.where(canonicalReply).toList();
      final overlap = knownTail == null
          ? -1
          : incoming.indexWhere(
              (m) => m.id == knownTail.id && m.turnId == knownTail.turnId,
            );
      final liveTurnIds = current
          .where(
            (m) =>
                m.role == 'codex' &&
                m.turnId != null &&
                (m.id == 'agent_${m.turnId}' ||
                    m.id.startsWith('agent_${m.turnId}_')),
          )
          .map((m) => m.turnId)
          .toSet();
      final emptyBaseline =
          knownTail == null &&
          _historyLoaded.contains(sessionId) &&
          historyHasMore[sessionId] == false &&
          current.every(
            (m) => m.sourceSequence > 0 && liveTurnIds.contains(m.turnId),
          );
      // A request watermark is not proof that native persistence has caught up.
      // Require the existing native boundary to overlap and then advance, or an
      // already confirmed empty history. New native turns replace live turns in
      // order, so a snapshot which advanced once cannot erase two live replies.
      if (overlap >= 0 || emptyBaseline) {
        var advanced = incoming
            .skip(overlap + 1)
            .map((m) => m.turnId)
            .toSet()
            .length;
        final terminals =
            current
                .where(
                  (m) =>
                      m.kind == 'turn.completed' &&
                      m.turnId != null &&
                      const {
                        'completed',
                        'success',
                        'end_turn',
                      }.contains(m.turnStatus) &&
                      m.sourceSequence > 0 &&
                      m.sourceSequence <= snapshotSequence,
                )
                .toList()
              ..sort((a, b) => a.sourceSequence.compareTo(b.sourceSequence));
        final seenLiveTurns = <String>{};
        for (final terminal in terminals) {
          if (advanced == 0) break;
          final turnId = terminal.turnId!;
          if (!seenLiveTurns.add(turnId)) continue;
          if (current.any(
            (m) =>
                m.turnId == turnId &&
                m.role == 'codex' &&
                (m.id == 'agent_$turnId' ||
                    m.id.startsWith('agent_${turnId}_')),
          )) {
            completedLiveTurns.add(turnId);
            advanced -= 1;
          }
        }
      }
    }
    final retainedCurrent = current.where((message) {
      // ACP history has native turn IDs distinct from live presentation IDs.
      // Its successful snapshot supersedes only completed live projections
      // covered by this request, never later inputs or running activity.
      if (completedLiveTurns.contains(message.turnId) &&
          message.sourceSequence > 0 &&
          message.sourceSequence <= snapshotSequence) {
        return false;
      }
      final persisted = history
          .where((row) => row.id == message.id)
          .firstOrNull;
      if (persisted != null &&
          persisted.sourceSequence >= message.sourceSequence &&
          (persisted.sourceSequence > 0 || message.sourceSequence > 0)) {
        return false;
      }
      if (persisted != null &&
          message.role == 'codex' &&
          persisted.content.startsWith(message.content)) {
        // A newer snapshot extends the older local prefix. Keep that snapshot;
        // conversely a live extension already received must survive a stale read.
        return false;
      }
      // Missing command.completed events leave a live preview behind. A
      // persisted terminal result for the same item must replace that preview.
      if (message.toolActivityStatus == 'running' &&
          settledToolIds.contains(message.id)) {
        return false;
      }
      if (message.role == 'user' &&
          message.clientMessageId != null &&
          authoritativeUserClientIds.contains(message.clientMessageId)) {
        return false;
      }
      final turnId = message.turnId;
      if (message.role != 'codex' || turnId == null) return true;
      if (!authoritativeAssistantTurns.contains(turnId)) return true;
      if (authoritativeAssistantMessages.contains(
        _assistantMessageFingerprint(message),
      )) {
        return false;
      }
      if (turnId == activeTurnId) return true;
      return message.id != 'agent_$turnId';
    });
    return _mergeMessages([...history, ...retainedCurrent]);
  }

  String _assistantMessageFingerprint(RelayMessage message) =>
      '${message.turnId}\u0000${message.messagePhase ?? ''}\u0000${message.content}';

  List<RelaySession> _mergeSessions(
    List<RelaySession> current,
    List<RelaySession> incoming,
  ) {
    final byId = {for (final item in current) item.id: item};
    for (final item in incoming) {
      final catalogSession = byId[item.id];
      if (catalogSession == null) {
        byId[item.id] = item;
        continue;
      }
      final catalogOptions =
          catalogSession.raw['session_config_options'] as List?;
      final bootstrapClaudeConfig =
          catalogSession.provider == 'claude' &&
          (item.raw['session_config_options'] as List?)?.isNotEmpty == true &&
          catalogOptions?.length == 1 &&
          catalogOptions!.single is Map &&
          catalogOptions.single['id'] == 'permissions' &&
          catalogOptions.single['currentValue'] == 'inherit' &&
          (catalogOptions.single['options'] as List?)?.length == 1;
      byId[item.id] = RelaySession.fromJson({
        ...item.raw,
        'status': catalogSession.status,
        'running_started_at': catalogSession.raw['running_started_at'],
        'can_interrupt': catalogSession.canInterrupt,
        if (!bootstrapClaudeConfig &&
            (catalogSession.raw['session_config_options'] as List?)
                    ?.isNotEmpty ==
                true)
          'session_config_options':
              catalogSession.raw['session_config_options'],
        if (catalogSession.raw.containsKey(
          'supports_message_permission_settings',
        ))
          'supports_message_permission_settings':
              catalogSession.raw['supports_message_permission_settings'],
        if (catalogSession.raw.containsKey('supports_message_model_settings'))
          'supports_message_model_settings':
              catalogSession.raw['supports_message_model_settings'],
        if (catalogSession.raw.containsKey('kimi_config_options'))
          'kimi_config_options': catalogSession.raw['kimi_config_options'],
      });
    }
    return byId.values.toList();
  }

  void _applySessionConfigOptions(String sessionId, Object? rawOptions) {
    if (rawOptions is! List) return;
    sessions = sessions.map((session) {
      if (session.id != sessionId) return session;
      final model = _configValue(rawOptions, 'model');
      final reasoning =
          _configValue(rawOptions, 'reasoning') ??
          _configValue(rawOptions, 'thinking');
      final speed =
          _configValue(rawOptions, 'speed') ??
          _configValue(rawOptions, 'service_tier') ??
          _configValue(rawOptions, 'serviceTier');
      final permissionMode =
          _configValue(rawOptions, 'mode') ??
          _configValue(rawOptions, 'permission_mode') ??
          _configValue(rawOptions, 'permissionMode');
      return RelaySession.fromJson({
        ...session.raw,
        'session_config_options': rawOptions,
        if (session.provider == 'kimi') 'kimi_config_options': rawOptions,
        if (model != null) 'model': model,
        if (reasoning != null) 'reasoning_effort': reasoning,
        if (speed != null) 'service_tier': speed == 'default' ? null : speed,
        if (permissionMode != null) 'permission_mode': permissionMode,
      });
    }).toList();
  }

  List<RelayAgent> _mergeAgents(
    List<RelayAgent> current,
    List<RelayAgent> incoming, {
    Map<String, RelayAgent>? readBaseline,
  }) {
    final byId = {for (final item in current) item.id: item};
    for (final item in incoming) {
      final previous = byId[item.id];
      // Fresh reads may carry an older source timestamp than a cached event's
      // receipt time. Repair unchanged rows, but preserve events received after
      // this read began. Other merge paths retain their timestamp ordering.
      if (readBaseline != null &&
          previous != null &&
          !identical(previous, readBaseline[item.id])) {
        continue;
      }
      final incomingTime = DateTime.tryParse(item.updatedAt ?? '');
      final previousTime = DateTime.tryParse(previous?.updatedAt ?? '');
      // A polling response can arrive after a newer live event.
      if (readBaseline == null &&
          incomingTime != null &&
          previousTime != null &&
          incomingTime.isBefore(previousTime)) {
        continue;
      }
      byId[item.id] = item.retainingDetails(previous);
    }
    return byId.values.toList();
  }

  String _randomId(String prefix) => '${prefix}_${_randomHex(16)}';

  String _randomHex(int bytes) => List<int>.generate(
    bytes,
    (_) => _random.nextInt(256),
  ).map((value) => value.toRadixString(16).padLeft(2, '0')).join();

  Timer? _eventPublicationTimer;

  // Receipt, decryption and acknowledgements stay immediate. Only redundant
  // workbench rebuilds for text/tool chunks are coalesced to the reveal cadence.
  void _notifyEvent(RelayEvent event) {
    if (_disposed) return;
    if (!const {
      'message.delta',
      'command.output',
    }.contains(event.event['kind'])) {
      _notify();
      return;
    }
    if (!_directoryForeground) return;
    _eventPublicationTimer ??= Timer(
      LiveReplyPresentation.frameInterval,
      _notify,
    );
  }

  void _notify() {
    _eventPublicationTimer?.cancel();
    _eventPublicationTimer = null;
    if (!_disposed) {
      _syncAutomaticRoute();
      notifyListeners();
    }
  }

  @override
  void dispose() {
    haptics.dispose();
    _historyStore.unpinSession();
    unawaited(
      flushHistoryCache().whenComplete(() async {
        _historyCacheKey?.fillRange(0, _historyCacheKey!.length, 0);
        await _historyStore.close();
      }),
    );
    _disposed = true;
    _directTransport?.close();
    _directReadResults.clear();
    for (final waiter in _responseWaiters) {
      if (!waiter.isCompleted) waiter.complete();
    }
    _clearStopRequests();
    _stopRealtime();
    _liveReplies.dispose();
    _connectionSnapshotNotifier.dispose();
    localeListenable.dispose();
    fontSizeListenable.dispose();
    _clearAttachmentCache();
    relayKey?.dispose();
    api.close();
    super.dispose();
  }
}

class _PendingSessionCreation {
  _PendingSessionCreation({
    required this.requestId,
    required this.key,
    required this.deviceId,
    required this.epoch,
  });

  final String requestId;
  final RelayKey key;
  final String deviceId;
  final int epoch;
  Map<String, dynamic>? frame;
}

class _AttachmentLoad {
  late final Future<Uint8List> future;
  DownloadProgress? progress;
  final Set<DownloadProgressCallback> _listeners = {};

  void listen(DownloadProgressCallback? listener) {
    if (listener == null) return;
    _listeners.add(listener);
    if (progress != null) listener(progress!);
  }

  void report(DownloadProgress value) {
    progress = value;
    for (final listener in _listeners.toList()) {
      listener(value);
    }
  }
}

Object? _configValue(Object? rawOptions, String id) {
  if (rawOptions is! List) return null;
  for (final option in rawOptions.whereType<Map>()) {
    if (option['id'] == id) return option['currentValue'];
  }
  return null;
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
