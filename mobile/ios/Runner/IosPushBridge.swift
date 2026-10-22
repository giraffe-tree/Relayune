import Flutter
import UIKit
import UserNotifications

/// APNs tokens travel only through the in-process channel or the explicit
/// simulator QA loopback endpoint. They are never printed or written to disk.
final class IosPushBridge {
    private let channel: FlutterMethodChannel
    private var token: String?
    private var pendingSession: String?
    var bindingChanged: (() -> Void)?
    var activityTokens: [[String: String]] = [] { didSet { channel.invokeMethod("changed", arguments: nil); reportPreview(["activities": activityTokens]) } }

    init(messenger: FlutterBinaryMessenger) {
        channel = FlutterMethodChannel(name: "cn.giraffetree.relayune/ios_push", binaryMessenger: messenger)
        channel.setMethodCallHandler { [weak self] call, result in
            guard let self else { result(nil); return }
            switch call.method {
            case "register":
                UIApplication.shared.registerForRemoteNotifications()
                result(self.snapshot())
            case "configure":
                do {
                    if self.previewURL == nil {
                        try PushCrypto.save(call.arguments as? [String: Any])
                        self.bindingChanged?()
                    }
                    result(nil)
                } catch { result(FlutterError(code: "push_storage_unavailable", message: "Push storage unavailable", details: nil)) }
            case "snapshot": result(self.snapshot())
            case "takeOpen":
                result(self.pendingSession)
                self.pendingSession = nil
            default: result(FlutterMethodNotImplemented)
            }
        }
    }

    private func snapshot() -> [String: Any] {
        ["token": token ?? NSNull(), "activities": activityTokens,
         "environment": Bundle.main.object(forInfoDictionaryKey: "RelayAPNsEnvironment") as? String ?? "sandbox"]
    }

    func registered(_ data: Data) {
        token = data.map { String(format: "%02x", $0) }.joined()
        channel.invokeMethod("changed", arguments: nil)
        reportPreview(["registered": true, "token": token!])
    }

    func failed(_ code: Int) { reportPreview(["registered": false, "errorCode": code]) }

    func open(_ info: [AnyHashable: Any]) {
        guard let session = info["relayune_session"] as? String, session.count <= 2048 else { return }
        pendingSession = session
        channel.invokeMethod("changed", arguments: nil)
    }

    func preparePreview() {
        #if DEBUG && targetEnvironment(simulator)
        guard let url = previewURL?.deletingLastPathComponent().appendingPathComponent("fixture") else { return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data, let binding = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
            do { try PushCrypto.save(binding); self.reportPreview(["keyStored": true]) }
            catch { self.reportPreview(["keyStored": false]) }
        }.resume()
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            self.reportPreview(["permission": granted])
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
        #endif
    }

    private var previewURL: URL? {
        #if DEBUG && targetEnvironment(simulator)
        guard let argument = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--relayune-apns-preview-port=") }),
              let port = Int(argument.split(separator: "=").last ?? ""), (1024...65535).contains(port) else { return nil }
        return URL(string: "http://127.0.0.1:\(port)/registration")
        #else
        return nil
        #endif
    }

    private func reportPreview(_ data: [String: Any]) {
        guard let url = previewURL else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: data)
        URLSession.shared.dataTask(with: request).resume()
    }
}
