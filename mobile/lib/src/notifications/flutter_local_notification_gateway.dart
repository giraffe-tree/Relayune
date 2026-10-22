import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../../l10n/relayune_localizations.dart';
import 'notification_coordinator.dart';

const _approvalActionsCategory = 'relayune.approval.actions';
const _approvalRejectCategory = 'relayune.approval.reject';
const _questionCategory = 'relayune.question.answer';
const _completionCategory = 'relayune.task.completed';
const _attentionChannelName = 'Relayune attention';
const _attentionChannelDescription = 'Tasks that need your attention';
const _progressChannelName = 'Relayune task updates';
const _progressChannelDescription = 'Task completion updates';

class FlutterLocalNotificationGateway
    implements RelayNotificationGateway, RelayNotificationLocaleGateway {
  FlutterLocalNotificationGateway({
    FlutterLocalNotificationsPlugin? plugin,
    Locale locale = const Locale('zh', 'CN'),
  }) : _plugin = plugin ?? FlutterLocalNotificationsPlugin(),
       _l10n = relayuneLocalizationsFor(locale);

  final FlutterLocalNotificationsPlugin _plugin;
  AppLocalizations _l10n;
  RelayNotificationResponseCallback? _onResponse;
  bool _initialized = false;
  static const _settingsChannel = MethodChannel(
    'cn.giraffetree.relayune/notification_settings',
  );

  @override
  Future<String?> initialize({
    required RelayNotificationResponseCallback onResponse,
  }) async {
    _onResponse = onResponse;
    await _initializePlugin();
    _initialized = true;
    final launch = await _plugin.getNotificationAppLaunchDetails();
    if (launch?.didNotificationLaunchApp != true) return null;
    final response = launch?.notificationResponse;
    final payload = response?.payload;
    if (payload == null || payload.isEmpty) return null;
    if (response?.actionId?.isNotEmpty == true) {
      onResponse(payload, response?.actionId);
      return null;
    }
    return payload;
  }

  Future<void> _initializePlugin() async {
    const android = AndroidInitializationSettings('ic_notification');
    final ios = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
      defaultPresentAlert: true,
      defaultPresentBanner: true,
      defaultPresentList: true,
      defaultPresentSound: true,
      notificationCategories: [
        DarwinNotificationCategory(
          _approvalActionsCategory,
          actions: [
            DarwinNotificationAction.plain(
              relayNotificationApproveActionId,
              _l10n.notificationAllowOnce,
              options: {
                DarwinNotificationActionOption.authenticationRequired,
                DarwinNotificationActionOption.foreground,
              },
            ),
            DarwinNotificationAction.plain(
              relayNotificationRejectActionId,
              _l10n.commonReject,
              options: {
                DarwinNotificationActionOption.authenticationRequired,
                DarwinNotificationActionOption.foreground,
              },
            ),
          ],
        ),
        DarwinNotificationCategory(
          _approvalRejectCategory,
          actions: [
            DarwinNotificationAction.plain(
              relayNotificationRejectActionId,
              _l10n.commonReject,
              options: {
                DarwinNotificationActionOption.authenticationRequired,
                DarwinNotificationActionOption.foreground,
              },
            ),
          ],
        ),
        DarwinNotificationCategory(
          _questionCategory,
          actions: [
            DarwinNotificationAction.plain(
              relayNotificationAnswerActionId,
              _l10n.notificationAnswer,
              options: {
                DarwinNotificationActionOption.authenticationRequired,
                DarwinNotificationActionOption.foreground,
              },
            ),
          ],
        ),
        const DarwinNotificationCategory(_completionCategory),
      ],
    );
    await _plugin.initialize(
      settings: InitializationSettings(android: android, iOS: ios),
      onDidReceiveNotificationResponse: (response) {
        final payload = response.payload;
        if (payload != null && payload.isNotEmpty) {
          _onResponse?.call(payload, response.actionId);
        }
      },
    );
  }

  @override
  Future<bool> requestAuthorization() async {
    if (defaultTargetPlatform == TargetPlatform.android) {
      return await _plugin
              .resolvePlatformSpecificImplementation<
                AndroidFlutterLocalNotificationsPlugin
              >()
              ?.requestNotificationsPermission() ??
          false;
    }
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      return await _plugin
              .resolvePlatformSpecificImplementation<
                IOSFlutterLocalNotificationsPlugin
              >()
              ?.requestPermissions(alert: true, badge: true, sound: true) ??
          false;
    }
    return false;
  }

  @override
  Future<bool?> authorizationEnabled() async {
    if (defaultTargetPlatform == TargetPlatform.android) {
      return _plugin
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >()
          ?.areNotificationsEnabled();
    }
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      final options = await _plugin
          .resolvePlatformSpecificImplementation<
            IOSFlutterLocalNotificationsPlugin
          >()
          ?.checkPermissions();
      return options?.isEnabled;
    }
    return null;
  }

  @override
  Future<void> openSettings() => _settingsChannel.invokeMethod('open');

  @override
  Future<void> setLocale(Locale locale) async {
    _l10n = relayuneLocalizationsFor(locale);
    if (_initialized && defaultTargetPlatform == TargetPlatform.iOS) {
      await _initializePlugin();
    }
  }

  @override
  Future<void> show(RelayLocalNotification notification) async {
    final androidActions = notification.actions
        .map((action) {
          return switch (action) {
            RelayNotificationAction.approveOnce => AndroidNotificationAction(
              relayNotificationApproveActionId,
              _l10n.notificationAllowOnce,
              showsUserInterface: true,
              semanticAction: SemanticAction.thumbsUp,
            ),
            RelayNotificationAction.reject => AndroidNotificationAction(
              relayNotificationRejectActionId,
              _l10n.commonReject,
              showsUserInterface: true,
              semanticAction: SemanticAction.thumbsDown,
            ),
            RelayNotificationAction.answer => AndroidNotificationAction(
              relayNotificationAnswerActionId,
              _l10n.notificationAnswer,
              showsUserInterface: true,
              semanticAction: SemanticAction.reply,
            ),
          };
        })
        .toList(growable: false);
    final android = AndroidNotificationDetails(
      notification.urgent ? 'relayune_attention' : 'relayune_progress',
      notification.urgent ? _attentionChannelName : _progressChannelName,
      channelDescription: notification.urgent
          ? _attentionChannelDescription
          : _progressChannelDescription,
      icon: 'ic_notification',
      importance: notification.urgent
          ? Importance.high
          : Importance.defaultImportance,
      priority: notification.urgent ? Priority.high : Priority.defaultPriority,
      category: notification.urgent
          ? AndroidNotificationCategory.reminder
          : AndroidNotificationCategory.status,
      groupKey: 'cn.giraffetree.relayune.tasks',
      visibility: NotificationVisibility.private,
      onlyAlertOnce: true,
      subText: notification.subtitle,
      styleInformation: BigTextStyleInformation(
        notification.body,
        contentTitle: notification.title,
        summaryText: notification.subtitle,
      ),
      actions: androidActions,
    );
    final ios = DarwinNotificationDetails(
      subtitle: notification.subtitle,
      threadIdentifier: 'cn.giraffetree.relayune.tasks',
      categoryIdentifier: _categoryFor(notification),
      interruptionLevel: notification.urgent
          ? InterruptionLevel.timeSensitive
          : InterruptionLevel.active,
    );
    await _plugin.show(
      id: notification.id,
      title: notification.title,
      body: notification.body,
      notificationDetails: NotificationDetails(android: android, iOS: ios),
      payload: notification.payload,
    );
  }

  @override
  Future<void> cancel(int notificationId) => _plugin.cancel(id: notificationId);

  String _categoryFor(RelayLocalNotification notification) {
    if (notification.kind == RelayNotificationKind.question) {
      return _questionCategory;
    }
    if (notification.kind == RelayNotificationKind.completion) {
      return _completionCategory;
    }
    return notification.actions.contains(RelayNotificationAction.approveOnce)
        ? _approvalActionsCategory
        : _approvalRejectCategory;
  }
}
