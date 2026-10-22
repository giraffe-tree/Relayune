import CryptoKit
import Foundation
import Security

enum PushCrypto {
    static let service = "cn.giraffetree.relayune.push"
    static var group: String { Bundle.main.object(forInfoDictionaryKey: "RelayPushKeychainGroup") as? String ?? "" }
    static func query() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: "active", kSecAttrAccessGroup as String: group]
    }
    static func save(_ binding: [String: Any]?) throws {
        let q = query()
        guard let binding else { SecItemDelete(q as CFDictionary); return }
        let bytes = try JSONSerialization.data(withJSONObject: binding)
        let attributes: [String: Any] = [kSecValueData as String: bytes,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let updated = SecItemUpdate(q as CFDictionary, attributes as CFDictionary)
        if updated == errSecItemNotFound {
            guard SecItemAdd(q.merging(attributes) { _, new in new } as CFDictionary, nil) == errSecSuccess else { throw Failure.unavailable }
        } else if updated != errSecSuccess { throw Failure.unavailable }
    }
    static func binding() -> [String: Any]? {
        var q = query(); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &value) == errSecSuccess, let bytes = value as? Data else { return nil }
        return (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any]
    }
    static func decode64(_ s: String) -> Data? {
        guard s.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { return nil }
        let base = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        return Data(base64Encoded: base + String(repeating: "=", count: (4 - base.count % 4) % 4))
    }
    static func bindings() -> [[String: Any]] {
        guard let stored = binding() else { return [] }
        return stored["bindings"] as? [[String: Any]] ?? [stored]
    }
    static func identity(_ session: String) -> (device: String, browser: String, session: String)? {
        guard session.hasPrefix("computer:"), let data = decode64(String(session.dropFirst(9))),
              let parts = try? JSONSerialization.jsonObject(with: data) as? [String], parts.count == 3 else { return nil }
        return (parts[0], parts[1], parts[2])
    }
    static func sessionRoute(_ session: String, binding: [String: Any]) -> String {
        guard let device = binding["deviceId"] as? String, let browser = binding["browserId"] as? String,
              !browser.isEmpty, let data = try? JSONSerialization.data(withJSONObject: [device, browser, session], options: [.withoutEscapingSlashes]) else { return session }
        return "computer:" + data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    static func computerBinding(session: String) -> [String: Any]? {
        if let target = identity(session) {
            return bindings().first { $0["deviceId"] as? String == target.device && $0["browserId"] as? String == target.browser }
        }
        let all = bindings()
        return all.count == 1 ? all.first : nil
    }
    static func route(session: String, turn: String) -> String? {
        guard let b = computerBinding(session: session), let text = b["key"] as? String, let key = decode64(text), key.count == 32 else { return nil }
        let original = identity(session)?.session ?? session
        return HMAC<SHA256>.authenticationCode(for: Data((original + "\0" + turn).utf8), using: SymmetricKey(data: key))
            .map { String(format: "%02x", $0) }.joined()
    }
    static func open(_ envelope: [String: Any], now: Date = Date(), allowHistorical: Bool = false) throws -> [String: Any] {
        guard let kid = envelope["kid"] as? String, let b = bindings().first(where: { $0["kid"] as? String == kid }) else { throw Failure.unavailable }
        var state = try decrypt(envelope, binding: b, now: now, allowHistorical: allowHistorical)
        if let session = state["sessionId"] as? String { state["sessionId"] = sessionRoute(session, binding: b) }
        return state
    }
    static func decrypt(_ envelope: [String: Any], binding b: [String: Any], now: Date, allowHistorical: Bool = false) throws -> [String: Any] {
        guard envelope["v"] as? Int == 2, envelope["alg"] as? String == "A256GCM",
              let kid = b["kid"] as? String, envelope["kid"] as? String == kid,
              let keyText = b["key"] as? String, let key = decode64(keyText), key.count == 32,
              let ivText = envelope["iv"] as? String, let iv = decode64(ivText), iv.count == 12,
              let aadText = envelope["aad"] as? String, let aad = decode64(aadText), aad.count < 2048,
              let ctText = envelope["ciphertext"] as? String, let ct = decode64(ctText), ct.count > 16, ct.count < 3000 else { throw Failure.invalid }
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: ct.dropLast(16), tag: ct.suffix(16))
        let clear = try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: aad)
        guard let a = try JSONSerialization.jsonObject(with: aad) as? [String: Any],
              a["type"] as? String == "ios.push", a["direction"] as? String == "relay_to_web",
              a["device_id"] as? String == b["deviceId"] as? String,
              let expiry = a["expires_at"] as? String, let expires = isoDate(expiry), (allowHistorical || expires > now),
              let createdText = a["created_at"] as? String, let created = isoDate(createdText),
              created <= now.addingTimeInterval(30), (allowHistorical || created > now.addingTimeInterval(-300)),
              let state = try JSONSerialization.jsonObject(with: clear) as? [String: Any],
              let session = state["sessionId"] as? String, !session.isEmpty, session.count <= 512,
              let status = state["state"] as? String,
              ["running","approval","question","completed","failed","stopped"].contains(status) else { throw Failure.invalid }
        return state
    }
    static func isoDate(_ text: String) -> Date? {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: text)
    }
    static func copy(_ state: String) -> String {
        let b = bindings().first; let labels = b?["labels"] as? [String: String]
        return labels?[state] ?? ["running":"Working", "approval":"Confirmation needed", "question":"Answer needed",
            "completed":"Task completed", "failed":"Task failed", "stopped":"Task stopped", "stale":"Waiting to sync",
            "open":"View task", "review":"Review task", "elapsed":"Elapsed", "updated":"Last synced"] [state] ?? "Relayune"
    }
    enum Failure: Error { case invalid, unavailable }
}
