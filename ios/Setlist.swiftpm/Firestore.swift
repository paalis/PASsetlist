import Foundation
import CryptoKit

// Snakker med den samme Firestore-databasen som nettsiden via REST (ingen Firebase-bibliotek).
// Sikkerhetsreglene (firestore.rules) gir tilgang til spaces/{hash} for den som kjenner koden.

enum Cloud {
    static let projectID = "setlist-generator-ea51f"
    static let apiKey = "AIzaSyBXiysNb-vvjNmgPH6B3mjZmlC3U9NB-oQ"
    static let base = "https://firestore.googleapis.com/v1/projects/\(projectID)/databases/(default)/documents"

    /// Samme normalisering og hash som nettsiden (public/cloud.js).
    /// NB: «setlist-generator:» er fra det gamle navnet og må beholdes.
    static func normalize(_ code: String) -> String {
        code.trimmed.uppercased().components(separatedBy: .whitespacesAndNewlines).joined()
    }

    static func space(for code: String) -> String {
        let digest = SHA256.hash(data: Data("setlist-generator:\(normalize(code))".utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

struct CloudError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Minimal Firestore REST-klient for ett «space» (én bandkode).
struct FirestoreClient {
    let space: String

    private func url(_ path: String, query: [String: String] = [:]) -> URL {
        var comps = URLComponents(string: "\(Cloud.base)/spaces/\(space)\(path.isEmpty ? "" : "/" + path)")!
        comps.queryItems = [URLQueryItem(name: "key", value: Cloud.apiKey)] + query.map { URLQueryItem(name: $0.key, value: $0.value) }
        return comps.url!
    }

    private func send(_ request: URLRequest, allow404: Bool = false) async throws -> [String: Any]? {
        var req = request
        req.timeoutInterval = 30
        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 404 && allow404 { return nil }
        guard (200..<300).contains(status) else {
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let msg = ((json?["error"] as? [String: Any])?["message"] as? String) ?? "HTTP \(status)"
            if status == 403 { throw CloudError(message: "Databasen nekter tilgang (sjekk sikkerhetsreglene i Firebase).") }
            throw CloudError(message: msg)
        }
        if data.isEmpty { return [:] }
        return (try JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    /// Henter ett dokument som vanlige verdier (nil hvis det ikke finnes).
    func get(_ path: String) async throws -> [String: Any]? {
        guard let doc = try await send(URLRequest(url: url(path)), allow404: true) else { return nil }
        return FirestoreValue.decodeFields(doc["fields"] as? [String: Any] ?? [:])
    }

    /// Alle dokumenter i en samling (med sideinndeling).
    func list(_ collection: String) async throws -> [[String: Any]] {
        var out: [[String: Any]] = []
        var token: String?
        repeat {
            var q = ["pageSize": "300"]
            if let token { q["pageToken"] = token }
            let res = try await send(URLRequest(url: url(collection, query: q))) ?? [:]
            for doc in res["documents"] as? [[String: Any]] ?? [] {
                out.append(FirestoreValue.decodeFields(doc["fields"] as? [String: Any] ?? [:]))
            }
            token = res["nextPageToken"] as? String
        } while token != nil
        return out
    }

    /// Oppretter eller erstatter et dokument.
    func set(_ path: String, _ fields: [String: Any]) async throws {
        var req = URLRequest(url: url(path))
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["fields": FirestoreValue.encodeFields(fields)])
        _ = try await send(req)
    }

    func delete(_ path: String) async throws {
        var req = URLRequest(url: url(path))
        req.httpMethod = "DELETE"
        _ = try await send(req, allow404: true)
    }

    /// Dokument-id-er i en samling der feltet er lik verdien (brukes for notater per fil).
    func idsWhere(_ collection: String, field: String, equals value: String) async throws -> [String] {
        var req = URLRequest(url: URL(string: "\(Cloud.base)/spaces/\(space):runQuery?key=\(Cloud.apiKey)")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["structuredQuery": [
            "from": [["collectionId": collection]],
            "where": ["fieldFilter": ["field": ["fieldPath": field], "op": "EQUAL", "value": ["stringValue": value]]],
        ]]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        req.timeoutInterval = 30
        let (data, response) = try await URLSession.shared.data(for: req)
        guard ((response as? HTTPURLResponse)?.statusCode ?? 0) < 300 else { throw CloudError(message: "Søk feilet") }
        let rows = (try JSONSerialization.jsonObject(with: data)) as? [[String: Any]] ?? []
        return rows.compactMap { ($0["document"] as? [String: Any])?["name"] as? String }.map { String($0.split(separator: "/").last ?? "") }
    }
}

/// Oversetter mellom vanlige verdier (som fra JSONSerialization) og Firestores verdiformat.
enum FirestoreValue {
    static func encodeFields(_ dict: [String: Any]) -> [String: Any] {
        dict.mapValues(encode)
    }

    static func encode(_ value: Any) -> [String: Any] {
        switch value {
        case is NSNull:
            return ["nullValue": NSNull()]
        case let data as Data:
            return ["bytesValue": data.base64EncodedString()]
        case let s as String:
            return ["stringValue": s]
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return ["booleanValue": n.boolValue] }
            let d = n.doubleValue
            if !CFNumberIsFloatType(n as CFNumber) || (d.rounded() == d && abs(d) < 9e15) {
                return ["integerValue": String(Int64(d))]
            }
            return ["doubleValue": d]
        case let arr as [Any]:
            return ["arrayValue": arr.isEmpty ? [:] : ["values": arr.map(encode)]]
        case let dict as [String: Any]:
            return ["mapValue": ["fields": encodeFields(dict)]]
        default:
            return ["nullValue": NSNull()]
        }
    }

    static func decodeFields(_ fields: [String: Any]) -> [String: Any] {
        fields.compactMapValues { decode($0 as? [String: Any] ?? [:]) }
    }

    static func decode(_ v: [String: Any]) -> Any? {
        if let s = v["stringValue"] as? String { return s }
        if let i = v["integerValue"] as? String { return Int(i) ?? 0 }
        if let i = v["integerValue"] as? NSNumber { return i.intValue }
        if let d = v["doubleValue"] as? NSNumber { return d.doubleValue }
        if let b = v["booleanValue"] as? Bool { return b }
        if v["nullValue"] != nil { return NSNull() }
        if let b = v["bytesValue"] as? String { return Data(base64Encoded: b) ?? Data() }
        if let a = v["arrayValue"] as? [String: Any] {
            return (a["values"] as? [[String: Any]] ?? []).compactMap(decode)
        }
        if let m = v["mapValue"] as? [String: Any] {
            return decodeFields(m["fields"] as? [String: Any] ?? [:])
        }
        if let t = v["timestampValue"] as? String { return t }
        return nil
    }
}

/// Codable <-> vanlige verdier (via JSON).
enum Plain {
    static func from<T: Encodable>(_ value: T) throws -> [String: Any] {
        let data = try JSONEncoder().encode(value)
        return (try JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    static func to<T: Decodable>(_ type: T.Type, _ dict: [String: Any]) throws -> T {
        let clean = sanitize(dict)
        let data = try JSONSerialization.data(withJSONObject: clean)
        return try JSONDecoder().decode(type, from: data)
    }

    /// Fjerner verdier JSON ikke kan uttrykke (Data, NSNull beholdes).
    private static func sanitize(_ v: Any) -> Any {
        switch v {
        case let d as [String: Any]: return d.mapValues(sanitize)
        case let a as [Any]: return a.map(sanitize)
        case is Data: return NSNull()
        default: return v
        }
    }
}
