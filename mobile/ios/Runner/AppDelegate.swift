import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate {
  private var liveTaskBridge: Any?
  private var iosPushBridge: IosPushBridge?

  @available(iOS 16.0, *)
  private func notificationSettingsURL() -> URL? {
    URL(string: UIApplication.openNotificationSettingsURLString)
  }

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    if let controller = window?.rootViewController as? FlutterViewController {
      let push = IosPushBridge(messenger: controller.binaryMessenger)
      iosPushBridge = push
      push.preparePreview()
      if #available(iOS 16.2, *) {
        let bridge = LiveTaskBridge()
        liveTaskBridge = bridge
        bridge.pushBridge = push
        push.bindingChanged = { [weak bridge] in bridge?.refreshPushTokens() }
        #if DEBUG && targetEnvironment(simulator)
        // Explicit, simulator-only design fixture. Never runs in a device build.
        if let argument = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--relayune-live-card-preview=") }) {
          let state = String(argument.split(separator: "=").last ?? "running")
          DispatchQueue.main.asyncAfter(deadline: .now() + 12) {
            let now = Date().timeIntervalSince1970 * 1000
            let labels = ["running": "正在工作", "approval": "等待确认", "question": "等待回答", "completed": "已完成", "failed": "任务失败", "stale": "状态待同步"]
            let finished = ["completed", "failed"].contains(state)
            let data: [String: Any] = [
              "sessionId": "design-preview", "turnId": PushCrypto.binding()?["previewTurnId"] as? String ?? "design-preview-" + UUID().uuidString,
              "title": "优化搜索体验", "provider": "Claude", "state": state,
              "statusLabel": labels[state] ?? "正在工作", "staleLabel": "状态待同步",
              "updatedLabel": "最近同步", "elapsedLabel": "已用时",
              "actionLabel": state == "approval" ? "前往处理" : "查看任务",
              "startedAt": now - 243000, "updatedAt": now,
              "staleAt": now + (state == "stale" ? -1000 : 75000), "startKnown": true,
              "finishedAt": finished ? now : NSNull()
            ]
            bridge.handle(FlutterMethodCall(methodName: "update", arguments: data)) { _ in }
          }
        }
        #endif

        let liveChannel = FlutterMethodChannel(
          name: "cn.giraffetree.relayune/live_tasks",
          binaryMessenger: controller.binaryMessenger
        )
        liveChannel.setMethodCallHandler { call, result in
          #if DEBUG && targetEnvironment(simulator)
          // A screenshot scenario must not mutate the restored account's cards.
          if ProcessInfo.processInfo.arguments.contains(where: { $0.hasPrefix("--relayune-apns-preview-port=") }) {
            result(nil)
            return
          }
          #endif
          bridge.handle(call, result: result)
        }
      }

      let channel = FlutterMethodChannel(
        name: "cn.giraffetree.relayune/notification_settings",
        binaryMessenger: controller.binaryMessenger
      )
      channel.setMethodCallHandler { call, result in
        guard call.method == "open" else {
          result(FlutterMethodNotImplemented)
          return
        }
        let url: URL?
        if #available(iOS 16.0, *) {
          url = self.notificationSettingsURL()
        } else {
          url = URL(string: UIApplication.openSettingsURLString)
        }
        guard let url else {
          result(
            FlutterError(
              code: "settings_unavailable",
              message: "Notification settings are unavailable.",
              details: nil
            )
          )
          return
        }
        UIApplication.shared.open(url) { opened in
          if opened {
            result(nil)
          } else {
            result(
              FlutterError(
                code: "settings_unavailable",
                message: "Notification settings could not be opened.",
                details: nil
              )
            )
          }
        }
      }
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
  override func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    iosPushBridge?.registered(deviceToken)
    super.application(application, didRegisterForRemoteNotificationsWithDeviceToken: deviceToken)
  }

  override func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    iosPushBridge?.failed((error as NSError).code)
    // Do not include provider error descriptions or tokens in application logs.
  }

  override func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
      withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    if notification.request.content.userInfo["relayune_push"] != nil {
      completionHandler([]) // Foreground WebSocket events own the existing alert UI.
    } else {
      super.userNotificationCenter(center, willPresent: notification, withCompletionHandler: completionHandler)
    }
  }

  override func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
      withCompletionHandler completionHandler: @escaping () -> Void) {
    if response.notification.request.content.userInfo["relayune_push"] != nil {
      iosPushBridge?.open(response.notification.request.content.userInfo)
      completionHandler()
    } else {
      super.userNotificationCenter(center, didReceive: response, withCompletionHandler: completionHandler)
    }
  }

}
