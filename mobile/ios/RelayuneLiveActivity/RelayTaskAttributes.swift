import ActivityKit
import Foundation

@available(iOS 16.2, *)
struct RelayTaskAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var title: String
        var provider: String
        var state: String
        var statusLabel: String
        var staleLabel: String
        var updatedLabel: String
        var elapsedLabel: String
        var actionLabel: String
        var startedAt: Date
        var updatedAt: Date
        var staleAt: Date
        var finishedAt: Date?
        var startKnown: Bool
    }
    var sessionId: String
    var turnId: String
}

@available(iOS 16.2, *)
extension RelayTaskAttributes.ContentState {
    enum CodingKeys: String, CodingKey {
        case title, provider, state, statusLabel, staleLabel, updatedLabel, elapsedLabel, actionLabel
        case startedAt, updatedAt, staleAt, finishedAt, startKnown, sealed
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if c.contains(.sealed) {
            let envelope = try c.decode(PushEnvelope.self, forKey: .sealed)
            let data = try JSONEncoder().encode(envelope)
            let object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
            let remote = try PushCrypto.open(object, allowHistorical: true)
            let state = remote["state"] as! String
            func time(_ field: String) -> Date { Date(timeIntervalSince1970: ((remote[field] as? NSNumber)?.doubleValue ?? 0) / 1000) }
            self.init(title: "Relayune", provider: "", state: state, statusLabel: PushCrypto.copy(state),
                staleLabel: PushCrypto.copy("stale"), updatedLabel: PushCrypto.copy("updated"),
                elapsedLabel: PushCrypto.copy("elapsed"), actionLabel: PushCrypto.copy(["approval", "question"].contains(state) ? "review" : "open"),
                startedAt: time("startedAt"), updatedAt: time("updatedAt"), staleAt: time("staleAt"),
                finishedAt: remote["finishedAt"] is NSNumber ? time("finishedAt") : nil,
                startKnown: remote["startKnown"] as? Bool ?? false)
        } else {
            self.init(title: try c.decode(String.self, forKey: .title), provider: try c.decode(String.self, forKey: .provider),
                state: try c.decode(String.self, forKey: .state), statusLabel: try c.decode(String.self, forKey: .statusLabel),
                staleLabel: try c.decode(String.self, forKey: .staleLabel), updatedLabel: try c.decode(String.self, forKey: .updatedLabel),
                elapsedLabel: try c.decode(String.self, forKey: .elapsedLabel), actionLabel: try c.decode(String.self, forKey: .actionLabel),
                startedAt: try c.decode(Date.self, forKey: .startedAt), updatedAt: try c.decode(Date.self, forKey: .updatedAt),
                staleAt: try c.decode(Date.self, forKey: .staleAt), finishedAt: try c.decodeIfPresent(Date.self, forKey: .finishedAt),
                startKnown: try c.decode(Bool.self, forKey: .startKnown))
        }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(title, forKey: .title); try c.encode(provider, forKey: .provider)
        try c.encode(state, forKey: .state); try c.encode(statusLabel, forKey: .statusLabel)
        try c.encode(staleLabel, forKey: .staleLabel); try c.encode(updatedLabel, forKey: .updatedLabel)
        try c.encode(elapsedLabel, forKey: .elapsedLabel); try c.encode(actionLabel, forKey: .actionLabel)
        try c.encode(startedAt, forKey: .startedAt); try c.encode(updatedAt, forKey: .updatedAt)
        try c.encode(staleAt, forKey: .staleAt); try c.encodeIfPresent(finishedAt, forKey: .finishedAt)
        try c.encode(startKnown, forKey: .startKnown)
    }
}
struct PushEnvelope: Codable {
    let v: Int
    let alg: String
    let kid: String
    let iv: String
    let aad: String
    let ciphertext: String
}
