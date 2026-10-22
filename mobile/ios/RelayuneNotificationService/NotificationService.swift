import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
    private var handler: ((UNNotificationContent) -> Void)?
    private var fallback: UNNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        handler = contentHandler; fallback = request.content
        guard let encrypted = request.content.userInfo["relayune_push"] as? [String: Any],
              let state = try? PushCrypto.open(encrypted), let status = state["state"] as? String,
              let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            finish(request.content); return
        }
        content.title = "Relayune · " + PushCrypto.copy(status)
        content.body = PushCrypto.copy(["approval","question"].contains(status) ? "review" : "open")
        content.userInfo["relayune_session"] = state["sessionId"]
        content.categoryIdentifier = "relayune_remote_task"
        // Decrypted task details never leave this extension or enter logging.
        finish(content)
    }
    private func finish(_ content: UNNotificationContent) {
        let callback = handler; handler = nil; callback?(content)
    }
    override func serviceExtensionTimeWillExpire() {
        if let fallback { finish(fallback) }
    }
}
