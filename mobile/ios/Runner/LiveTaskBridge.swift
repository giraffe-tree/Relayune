import ActivityKit
import CryptoKit
import Flutter
import UIKit

/// Local activity UI with independently registered APNs update tokens.
@available(iOS 16.2, *)
@MainActor
final class LiveTaskBridge {
    weak var pushBridge: IosPushBridge?
    private var tokenObservers: [String: Task<Void, Never>] = [:]
    private var pushTokens: [String: [String: String]] = [:]
    private var queue: Task<Void, Never>?
    private var observers: [String: Task<Void, Never>] = [:]
    private var dismissed = Set(UserDefaults.standard.stringArray(forKey: "relayune.live.dismissed") ?? [])

    func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        let previous = queue
        queue = Task { @MainActor in
            await previous?.value
            if call.method == "clear" {
                for activity in Activity<RelayTaskAttributes>.activities {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }

                self.observers.values.forEach { $0.cancel() }
                self.observers.removeAll()
                self.tokenObservers.values.forEach { $0.cancel() }
                self.tokenObservers.removeAll()
                self.pushTokens.removeAll()
                self.pushBridge?.activityTokens = []
                result(nil)
            } else if call.method == "update", let data = call.arguments as? [String: Any] {
                await self.update(data)
                result(nil)
            } else { result(FlutterMethodNotImplemented) }
        }
    }

    private func update(_ data: [String: Any]) async {
        guard let session = data["sessionId"] as? String,
              let turn = data["turnId"] as? String,
              let state = decode(data) else { return }
        let key = SHA256.hash(data: Data((session + "\u{0}" + turn).utf8))
            .map { String(format: "%02x", $0) }.joined()
        let activities = Activity<RelayTaskAttributes>.activities
        for previous in activities where previous.attributes.sessionId == session && previous.attributes.turnId != turn {
            await previous.end(nil, dismissalPolicy: .immediate)
        }
        let existing = activities.first { $0.attributes.sessionId == session && $0.attributes.turnId == turn }
        let content = ActivityContent(state: state,
            staleDate: state.finishedAt == nil ? state.staleAt : nil,
            relevanceScore: ["approval", "question"].contains(state.state) ? 100 : 50)
        if let activity = existing {
            observe(activity, key: key)
            if state.finishedAt != nil {
                await activity.end(content, dismissalPolicy: .after(Date().addingTimeInterval(120)))
            } else {
                await activity.update(content)
            }
            return
        }
        #if DEBUG
        print("Relayune Live Activity eligibility: enabled=\(ActivityAuthorizationInfo().areActivitiesEnabled) foreground=\(UIApplication.shared.applicationState == .active) ended=\(state.finishedAt != nil) dismissed=\(dismissed.contains(key))")
        #endif
        guard state.finishedAt == nil, !dismissed.contains(key),
              ActivityAuthorizationInfo().areActivitiesEnabled,
              UIApplication.shared.applicationState == .active else { return }
        do {
            let activity = try Activity.request(
                attributes: RelayTaskAttributes(sessionId: session, turnId: turn),
                content: content, pushType: .token)
            observe(activity, key: key)
        } catch {
            #if DEBUG
            print("Relayune Live Activity request failed: \(String(describing: type(of: error))) \((error as NSError).code)")
            #endif
            // Unsupported/disabled/limited surfaces do not affect the task.
        }
    }

    func refreshPushTokens() {
        pushTokens.removeAll()
        for activity in Activity<RelayTaskAttributes>.activities {
            if let data = activity.pushToken { recordToken(data, activity: activity) }
        }
        pushBridge?.activityTokens = Array(pushTokens.values)
    }

    private func recordToken(_ data: Data, activity: Activity<RelayTaskAttributes>) {
        guard let route = PushCrypto.route(session: activity.attributes.sessionId, turn: activity.attributes.turnId) else { return }
        pushTokens[activity.id] = ["route": route, "token": data.map { String(format: "%02x", $0) }.joined(),
            "deviceId": PushCrypto.computerBinding(session: activity.attributes.sessionId)?["deviceId"] as? String ?? ""]
        pushBridge?.activityTokens = Array(pushTokens.values)
    }

    private func observe(_ activity: Activity<RelayTaskAttributes>, key: String) {
        if let data = activity.pushToken { recordToken(data, activity: activity) }
        if tokenObservers[activity.id] == nil {
            tokenObservers[activity.id] = Task { @MainActor [weak self] in
                for await data in activity.pushTokenUpdates {
                    self?.recordToken(data, activity: activity)
                }
            }
        }
        guard observers[activity.id] == nil else { return }
        observers[activity.id] = Task { @MainActor [weak self] in
            for await state in activity.activityStateUpdates {
                if state == .dismissed || state == .ended {
                    self?.dismissed.insert(key)
                    if let keys = self?.dismissed {
                        UserDefaults.standard.set(Array(keys).suffix(256).map { $0 }, forKey: "relayune.live.dismissed")
                    }
                    self?.observers.removeValue(forKey: activity.id)
                    self?.tokenObservers.removeValue(forKey: activity.id)?.cancel()
                    self?.pushTokens.removeValue(forKey: activity.id)
                    self?.pushBridge?.activityTokens = Array(self?.pushTokens.values ?? [:].values)
                    break
                }
            }
        }
    }

    private func decode(_ data: [String: Any]) -> RelayTaskAttributes.ContentState? {
        func string(_ key: String) -> String { String((data[key] as? String ?? "").prefix(100)) }
        func date(_ key: String) -> Date? {
            (data[key] as? NSNumber).map { Date(timeIntervalSince1970: $0.doubleValue / 1000) }
        }
        guard let started = date("startedAt"), let updated = date("updatedAt"), let stale = date("staleAt") else { return nil }
        return RelayTaskAttributes.ContentState(title: string("title"), provider: string("provider"),
            state: string("state"), statusLabel: string("statusLabel"), staleLabel: string("staleLabel"),
            updatedLabel: string("updatedLabel"), elapsedLabel: string("elapsedLabel"), actionLabel: string("actionLabel"),
            startedAt: started, updatedAt: updated, staleAt: stale, finishedAt: date("finishedAt"), startKnown: data["startKnown"] as? Bool ?? true)
    }
}
