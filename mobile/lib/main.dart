import 'src/notifications/ios_push_coordinator.dart';
import 'src/config.dart';
import 'src/ui/instance_settings_page.dart';
import 'dart:async';
import 'dart:io';

import 'package:app_links/app_links.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/material.dart';

import 'l10n/relayune_localizations.dart';
import 'src/notifications/flutter_local_notification_gateway.dart';
import 'src/notifications/notification_coordinator.dart';
import 'src/state/app_controller.dart';
import 'src/state/startup_performance.dart';
import 'src/state/computer_connections.dart';
import 'src/state/background_lifecycle.dart';
import 'src/ui/auth_screen.dart';
import 'src/ui/font_size_scope.dart';
import 'src/ui/pairing_screen.dart';
import 'src/ui/add_computer_route.dart';
import 'src/ui/relayune_ready_screen.dart';
import 'src/ui/theme.dart';
import 'src/update/android_auto_update.dart';
import 'src/notifications/live_task_coordinator.dart';
import 'src/notifications/android_push_coordinator.dart';
import 'src/state/device_connection.dart';
import 'src/widgets/brand_mark.dart';
import 'src/widgets/startup_loading_screen.dart';
import 'src/widgets/relay_text_selection.dart';

void main() {
  StartupPerformance.start();
  WidgetsFlutterBinding.ensureInitialized();
  StartupPerformance.frame('first_frame');
  final links = AppLinks();
  final initialLocale = relayuneResolveLocale(
    WidgetsBinding.instance.platformDispatcher.locales,
  );
  final notifications = RelayNotificationCoordinator(
    gateway: FlutterLocalNotificationGateway(locale: initialLocale),
    liveTasks: LiveTaskCoordinator(gateway: const NativeLiveTaskGateway()),
    locale: initialLocale,
  );
  runApp(
    RelayuneApp(
      links: links,
      notifications: notifications,
      usesIosSimulatorEmojiFallback: false,
    ),
  );
}

Future<bool> _usesIosSimulatorEmojiFallback() async {
  if (!Platform.isIOS) return false;
  try {
    return !(await DeviceInfoPlugin().iosInfo).isPhysicalDevice;
  } on Object {
    return false;
  }
}

class RelayuneApp extends StatefulWidget {
  const RelayuneApp({
    super.key,
    required this.links,
    required this.notifications,
    required this.usesIosSimulatorEmojiFallback,
    this.initialLink,
  });

  final AppLinks links;
  final RelayNotificationCoordinator notifications;
  final bool usesIosSimulatorEmojiFallback;
  final Uri? initialLink;

  @override
  State<RelayuneApp> createState() => _RelayuneAppState();
}

class _RelayuneAppState extends State<RelayuneApp> with WidgetsBindingObserver {
  final _navigatorKey = GlobalKey<NavigatorState>();
  late final ComputerConnections _connections;
  AppController get _controller => _connections.account;
  StreamSubscription<Uri>? _linkSubscription;
  RelayNotificationOpenRequest? _pendingNotificationOpen;
  RelayNotificationActionRequest? _pendingNotificationAction;
  AndroidAutoUpdateCoordinator? _androidUpdater;
  IosPushCoordinator? _iosPush;
  AndroidPushCoordinator? _androidPush;
  late bool _usesSimulatorEmojiFallback;
  bool _receivedStreamLink = false;
  Future<void>? _accountInitialization;
  AppController? _lastController;
  late final BackgroundLifecycle _backgroundLifecycle;

  @override
  void initState() {
    super.initState();
    _usesSimulatorEmojiFallback = widget.usesIosSimulatorEmojiFallback;
    WidgetsBinding.instance.addObserver(this);
    _connections = ComputerConnections(
      notifications: widget.notifications,
      locale: relayuneResolveLocale(
        WidgetsBinding.instance.platformDispatcher.locales,
      ),
    );
    _controller.addComputer = _addComputer;
    _lastController = _controller;
    _connections.beforeRemove = (c) async {
      _navigatorKey.currentState?.popUntil((route) => route.isFirst);
      await WidgetsBinding.instance.endOfFrame;
      await _androidPush?.remove(_connections.deviceId(c));
      await _iosPush?.remove(_connections.deviceId(c));
    };
    _connections.beforeLogout = () async {
      _androidUpdater?.dispose();
      _androidUpdater = null;
      await _androidPush?.stop();
      await _iosPush?.stop();
      _androidPush?.dispose();
      _androidPush = null;
      _iosPush?.dispose();
      _iosPush = null;
      _navigatorKey.currentState?.popUntil((route) => route.isFirst);
      _pendingNotificationAction = null;
      _pendingNotificationOpen = null;
    };
    _createPushCoordinators();
    _backgroundLifecycle = BackgroundLifecycle(
      onBackground: () {
        _androidUpdater?.setForeground(false);
        _iosPush?.setForeground(false);
        _androidPush?.setForeground(false);
        _connections.setForeground(false);
        for (final c in _connections.controllers) {
          unawaited(c.flushHistoryCache());
        }
      },
      onReleaseMemory: () {
        _connections.releaseBackgroundMemory();
        PaintingBinding.instance.imageCache.clear();
        PaintingBinding.instance.imageCache.clearLiveImages();
      },
      onResume: (_) {
        _androidUpdater?.setForeground(RelayConfig.usesOfficialService);
        _syncNotifications();
        _iosPush?.setForeground(true);
        _androidPush?.setForeground(true);
        _connections.setForeground(true);
        unawaited(_connections.resumeRealtime());
      },
    );
    _backgroundLifecycle.handle(
      WidgetsBinding.instance.lifecycleState ?? AppLifecycleState.resumed,
    );
    _connections.addListener(_syncNotifications);
    widget.notifications.onOpenRequest = _handleNotificationOpen;
    widget.notifications.onActionRequest = _handleNotificationAction;
    widget.notifications.setForeground(
      _isForeground(WidgetsBinding.instance.lifecycleState),
    );
    _linkSubscription = widget.links.uriLinkStream.listen((link) {
      _receivedStreamLink = true;
      _handleIncomingLink(link);
    }, onError: (_) {});
    _accountInitialization = _connections.initialize(
      initialLink: widget.initialLink,
    );
    unawaited(_accountInitialization);
    unawaited(_restoreInitialLink());
    // Native plugin setup must not hold the first Flutter frame or account
    // restoration. Keep the link subscription early so cold-start links survive.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      unawaited(_initializeNotifications());
      unawaited(_resolveRenderingCapabilities());
      unawaited(_initializeAndroidUpdater());
    });
  }

  void _createPushCoordinators() {
    if (!RelayConfig.usesOfficialService) return;
    if (Platform.isIOS && _iosPush == null) {
      _iosPush = IosPushCoordinator(
        api: _controller.api,
        onOpen: (id) => _handleNotificationOpen(
          RelayNotificationOpenRequest(
            sessionId: id,
            target: RelayNotificationTarget.conversation,
          ),
        ),
      );
    }
    if (Platform.isAndroid && _androidPush == null) {
      _androidPush = AndroidPushCoordinator(
        onBindingChanged: (active) {
          widget.notifications.remoteBackgroundDeliveryActive = active;
        },
      );
    }
  }

  void _handleIncomingLink(Uri link) {
    if (link.scheme == 'relayune' && link.host == 'task') {
      final id = link.queryParameters['session'];
      if (id != null && id.isNotEmpty && id.length <= 2048) {
        _handleNotificationOpen(
          RelayNotificationOpenRequest(
            sessionId: id,
            target: RelayNotificationTarget.conversation,
          ),
        );
      }
      return;
    }
    _controller.handleIncomingLink(link);
  }

  void _syncLiveTasks() {
    final l10n = relayuneLocalizationsFor(_controller.localeListenable.value);
    final enabled =
        RelayConfig.usesOfficialService &&
        _connections.phase == AppPhase.ready &&
        _controller.notificationAuthorization ==
            RelayNotificationAuthorization.enabled;
    _iosPush?.configureComputers(
      enabled: enabled,
      clear:
          {AppPhase.signedOut}.contains(_connections.phase) ||
          (_connections.phase == AppPhase.ready && !enabled),
      computers: [
        for (final c in _connections.readyComputers)
          if (c.relayKey != null && c.browserAuthorizationId != null)
            IosPushComputer(
              api: c.api,
              deviceId: _connections.deviceId(c),
              browserId: c.browserAuthorizationId!,
              key: c.relayKey!,
            ),
      ],
      labels: {
        'running': l10n.liveTaskRunning,
        'approval': l10n.liveTaskApproval,
        'question': l10n.liveTaskQuestion,
        'completed': l10n.liveTaskCompleted,
        'failed': l10n.liveTaskFailed,
        'stopped': l10n.liveTaskStopped,
        'stale': l10n.liveTaskStale,
        'open': l10n.liveTaskOpen,
        'review': l10n.liveTaskReview,
        'elapsed': l10n.liveTaskElapsed,
        'updated': l10n.liveTaskUpdated,
      },
    );
    widget.notifications.liveTasks?.configure(
      enabled: enabled,
      connected: _connections.readyComputers.any((c) => c.deviceOnline),
      disconnectedSessionIds: {
        for (final c in _connections.readyComputers)
          if (!c.deviceOnline ||
              c.connectionSnapshot.transport !=
                  RealtimeTransportState.connected)
            for (final s in c.sessions) _connections.route(c, s.id),
      },
      account: _controller.email,
      sessions: _connections.notificationSessions,
      runningSessionIds: {
        for (final c in _connections.readyComputers)
          for (final id in c.runningSessions) _connections.route(c, id),
      },
      catalogReady: _connections.phase == AppPhase.ready,
      clearWhenUnavailable: {AppPhase.signedOut}.contains(_connections.phase),
      locale: _controller.localeListenable.value,
    );
  }

  bool _addingComputer = false;
  Future<void> _addComputer() async {
    if (_addingComputer) return;
    _addingComputer = true;
    try {
      await _showAddComputer();
    } finally {
      _addingComputer = false;
    }
  }

  Future<void> _showAddComputer() async {
    final navigator = _navigatorKey.currentState;
    if (navigator == null) return;
    await showAddComputer(navigator: navigator, connections: _connections);
  }

  Future<void> _restoreInitialLink() async {
    if (widget.initialLink != null) return;
    try {
      final link = await widget.links.getInitialLink();
      if (mounted && !_receivedStreamLink && link != null) {
        _handleIncomingLink(link);
      }
    } on Object {
      // A failed optional link lookup must not prevent normal startup.
    }
  }

  Future<void> _initializeNotifications() async {
    await widget.notifications.initialize();
    if (!mounted) return;
    await _controller.refreshNotificationAuthorization();
  }

  Future<void> _resolveRenderingCapabilities() async {
    final fallback = await _usesIosSimulatorEmojiFallback();
    if (!mounted || fallback == _usesSimulatorEmojiFallback) return;
    setState(() => _usesSimulatorEmojiFallback = fallback);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    widget.notifications.setForeground(_isForeground(state));
    _backgroundLifecycle.handle(state);
    for (final c in _connections.controllers) {
      c.setReplyPresentationForeground(state == AppLifecycleState.resumed);
    }
    if (state == AppLifecycleState.resumed) {
      unawaited(_controller.refreshNotificationAuthorization());
      unawaited(_resumeAndroidUpdater());
    }
  }

  @override
  void didHaveMemoryPressure() => _backgroundLifecycle.memoryPressure();

  @override
  void didChangeLocales(List<Locale>? locales) {
    for (final c in _connections.controllers) {
      c.updateSystemLocales(locales ?? const []);
    }
  }

  Future<void> _initializeAndroidUpdater() async {
    await _accountInitialization;
    if (!RelayConfig.usesOfficialService || !Platform.isAndroid) return;
    try {
      final updater = await createAndroidAutoUpdateCoordinator(
        prompt: _showAndroidUpdatePrompt,
      );
      if (!mounted) return;
      _androidUpdater = updater;
      if (_isForeground(WidgetsBinding.instance.lifecycleState)) {
        await _resumeAndroidUpdater();
      }
    } on Object {
      // Update support must never block startup or normal Relayune use.
    }
  }

  Future<void> _resumeAndroidUpdater() async {
    if (!RelayConfig.usesOfficialService) return;
    try {
      await _androidUpdater?.onForeground();
    } on Object {
      if (!mounted) return;
      final dialogContext = _navigatorKey.currentState?.overlay?.context;
      if (dialogContext == null || !dialogContext.mounted) return;
      ScaffoldMessenger.of(dialogContext).showSnackBar(
        SnackBar(content: Text(dialogContext.l10n.updateInstallerUnavailable)),
      );
    }
  }

  Future<AndroidUpdatePromptAction> _showAndroidUpdatePrompt(
    VerifiedAndroidUpdate update,
  ) async {
    if (!mounted) return AndroidUpdatePromptAction.later;
    await WidgetsBinding.instance.endOfFrame;
    final dialogContext = _navigatorKey.currentState?.overlay?.context;
    if (dialogContext == null || !dialogContext.mounted) {
      return AndroidUpdatePromptAction.later;
    }
    return await showDialog<AndroidUpdatePromptAction>(
          context: dialogContext,
          barrierDismissible: false,
          builder: (context) => AlertDialog(
            title: Text(context.l10n.updateReadyTitle),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    context.l10n.updateDownloaded(update.manifest.versionName),
                  ),
                  if (update.manifest
                      .notesForLocale(Localizations.localeOf(context))
                      .isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(
                      update.manifest.notesForLocale(
                        Localizations.localeOf(context),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () =>
                    Navigator.pop(context, AndroidUpdatePromptAction.later),
                child: Text(context.l10n.updateLater),
              ),
              FilledButton(
                onPressed: () =>
                    Navigator.pop(context, AndroidUpdatePromptAction.install),
                child: Text(context.l10n.updateInstall),
              ),
            ],
          ),
        ) ??
        AndroidUpdatePromptAction.later;
  }

  bool _isForeground(AppLifecycleState? state) =>
      state == null ||
      state == AppLifecycleState.resumed ||
      state == AppLifecycleState.inactive;

  void _syncNotifications() {
    if (!identical(_lastController, _controller)) {
      _lastController = _controller;
      if (RelayConfig.usesOfficialService) {
        _createPushCoordinators();
      } else {
        _iosPush?.dispose();
        _iosPush = null;
        _androidPush?.dispose();
        _androidPush = null;
      }
      if (mounted) setState(() {});
      if (!RelayConfig.usesOfficialService) {
        _androidUpdater?.dispose();
        _androidUpdater = null;
      } else if (_androidUpdater == null) {
        unawaited(_initializeAndroidUpdater());
      }
    }
    if (_backgroundLifecycle.background) return;
    if (_connections.phase == AppPhase.ready) _createPushCoordinators();
    _syncLiveTasks();
    if (_connections.phase != AppPhase.loading &&
        _connections.phase != AppPhase.unavailable) {
      final enabled =
          RelayConfig.usesOfficialService &&
          _connections.phase == AppPhase.ready &&
          _controller.notificationPermissionRequested &&
          _controller.notificationAuthorization ==
              RelayNotificationAuthorization.enabled;
      _androidPush?.updateAll([
        for (final c in _connections.readyComputers)
          if (c.api.sessionToken != null && c.api.browserToken != null)
            AndroidPushAccount(
              origin: c.api.origin,
              deviceId: _connections.deviceId(c),
              sessionToken: c.api.sessionToken!,
              browserToken: c.api.browserToken!,
              locale: _controller.locale.toLanguageTag(),
            ),
      ], enabled: enabled);
    }
    widget.notifications.setSessionCatalog(_connections.notificationSessions);
    widget.notifications.setActiveSession(_connections.visibleSession);
    _runPendingNotificationAction();
    _openPendingNotification();
  }

  void _handleNotificationOpen(RelayNotificationOpenRequest request) {
    _pendingNotificationOpen = request;
    _openPendingNotification();
  }

  void _handleNotificationAction(RelayNotificationActionRequest request) {
    _pendingNotificationAction = request;
    _runPendingNotificationAction();
  }

  void _runPendingNotificationAction() {
    final request = _pendingNotificationAction;
    if (request == null || _connections.phase != AppPhase.ready) return;
    final target = _connections.resolve(request.sessionId);
    if (target == null) return;
    final parsedApproval = parseComputerRoute(request.approvalId);
    final parsedSession = parseComputerRoute(request.sessionId);
    if (parsedSession != null &&
        (parsedApproval == null ||
            parsedApproval.device != parsedSession.device ||
            parsedApproval.authorization != parsedSession.authorization)) {
      _pendingNotificationAction = null;
      return;
    }
    final approval = target.controller.approvals
        .where(
          (candidate) =>
              candidate.id == (parsedApproval?.id ?? request.approvalId),
        )
        .firstOrNull;
    if (approval == null) {
      _pendingNotificationAction = null;
      _pendingNotificationOpen = RelayNotificationOpenRequest(
        sessionId: request.sessionId,
        target: RelayNotificationTarget.conversation,
        approvalId: request.approvalId,
      );
      _openPendingNotification();
      return;
    }
    _pendingNotificationAction = null;
    unawaited(_executeNotificationAction(request));
  }

  Future<void> _executeNotificationAction(
    RelayNotificationActionRequest request,
  ) async {
    // Navigation and approval actions must not wait for history catch-up.
    final target = _connections.resolve(request.sessionId);
    if (target == null) return;
    await target.controller.selectSession(
      target.sessionId,
      waitForHistory: false,
    );
    final handled = await target.controller.decideApprovalFromNotification(
      parseComputerRoute(request.approvalId)?.id ?? request.approvalId,
      request.action,
    );
    if (!handled) {
      await _openNotificationRequest(
        RelayNotificationOpenRequest(
          sessionId: request.sessionId,
          target: RelayNotificationTarget.conversation,
          approvalId: request.approvalId,
        ),
      );
    }
  }

  void _openPendingNotification() {
    final request = _pendingNotificationOpen;
    if (request == null || _connections.phase != AppPhase.ready) return;
    final target = _connections.resolve(request.sessionId);
    if (target == null ||
        !target.controller.sessions.any(
          (session) => session.id == target.sessionId,
        )) {
      return;
    }
    _pendingNotificationOpen = null;
    unawaited(_openNotificationRequest(request));
  }

  Future<void> _openNotificationRequest(
    RelayNotificationOpenRequest request,
  ) async {
    // Navigation and approval actions must not wait for history catch-up.
    final target = _connections.resolve(request.sessionId);
    if (target == null) return;
    await target.controller.selectSession(
      target.sessionId,
      waitForHistory: false,
    );
    target.controller.requestWorkbenchTarget(request.target.name);
  }

  @override
  void dispose() {
    _backgroundLifecycle.dispose();
    _iosPush?.dispose();
    WidgetsBinding.instance.removeObserver(this);
    widget.notifications.onOpenRequest = null;
    widget.notifications.onActionRequest = null;
    _connections.removeListener(_syncNotifications);
    _linkSubscription?.cancel();
    _androidUpdater?.dispose();
    _androidPush?.dispose();
    _connections.dispose();
    widget.notifications.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<Locale>(
    valueListenable: _controller.localeListenable,
    builder: (context, locale, _) => MaterialApp(
      navigatorKey: _navigatorKey,
      locale: locale,
      onGenerateTitle: (context) => context.l10n.appTitle,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: relayuneSupportedLocales,
      localeListResolutionCallback: relayuneLocaleListResolution,
      debugShowCheckedModeBanner: false,
      theme: RelayTheme.webFor(
        usesIosSimulatorEmojiFallback: _usesSimulatorEmojiFallback,
      ),
      darkTheme: RelayTheme.webFor(
        usesIosSimulatorEmojiFallback: _usesSimulatorEmojiFallback,
      ),
      themeMode: ThemeMode.dark,
      builder: (context, child) => FontSizeScope(
        fontSize: _controller.fontSizeListenable,
        child: ListenableBuilder(
          listenable: _backgroundLifecycle,
          child: RelayTextSelection(child: child!),
          builder: (context, child) =>
              TickerMode(enabled: _backgroundLifecycle.visible, child: child!),
        ),
      ),
      home: AnimatedBuilder(
        animation: _connections,
        builder: (context, _) {
          if (_connections.phase == AppPhase.ready) {
            StartupPerformance.frame('home_interactive');
          }
          return StartupLoadingScreen(
            loading: _connections.phase == AppPhase.loading,
            bypass: _connections.phase == AppPhase.unavailable,
            child: KeyedSubtree(
              key: ValueKey('app-phase-${_connections.phase.name}'),
              child: switch (_connections.phase) {
                AppPhase.loading => const SizedBox.expand(),
                AppPhase.signedOut => AuthScreen(controller: _controller),
                AppPhase.needsPairing => PairingScreen(
                  controller: _controller,
                  connections: _connections,
                ),
                AppPhase.ready => RelayuneReadyScreen(
                  controller: _controller,
                  connections: _connections,
                ),
                AppPhase.unavailable => _UnavailableScreen(
                  controller: _controller,
                ),
              },
            ),
          );
        },
      ),
    ),
  );
}

class _UnavailableScreen extends StatelessWidget {
  const _UnavailableScreen({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const BrandMark(size: 58),
                const SizedBox(height: 20),
                Text(
                  context.l10n.unavailableTitle,
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 10),
                Text(controller.error, textAlign: TextAlign.center),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: controller.initialize,
                  child: Text(context.l10n.commonRetry),
                ),
                TextButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) =>
                          InstanceSettingsPage(controller: controller),
                    ),
                  ),
                  child: Text(
                    Localizations.localeOf(context).languageCode == 'zh'
                        ? '更换服务实例'
                        : 'Change server instance',
                  ),
                ),
                TextButton(
                  onPressed: controller.logout,
                  child: Text(context.l10n.clearLoginSession),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
