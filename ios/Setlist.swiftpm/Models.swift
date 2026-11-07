import Foundation

// Datamodellen er i NØYAKTIG samme format som nettsiden (public/app.js), så
// setlister, filer og notater kan deles via bandkoden i Firestore.

/// En fil (tekst, noter, akkordskjema) knyttet til en låt.
struct FileRef: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var type: String // MIME-type, f.eks. application/pdf, image/jpeg, text/plain
    var size: Int

    var kind: FileKind { FileKind(type: type, name: name) }
}

enum FileKind {
    case pdf, image, text, unknown

    init(type: String, name: String) {
        let lower = name.lowercased()
        if type == "application/pdf" || lower.hasSuffix(".pdf") { self = .pdf }
        else if type.hasPrefix("image/") { self = .image }
        else if type.hasPrefix("text/") || [".txt", ".pro", ".cho", ".chopro", ".chordpro"].contains(where: lower.hasSuffix) { self = .text }
        else { self = .unknown }
    }
}

struct SetlistItem: Codable, Hashable, Identifiable {
    var id: String
    var type: String // "song" eller "break"
    var title: String
    var artist: String
    var key: String
    var notes: String
    var durationMs: Int
    var files: [FileRef]

    var isBreak: Bool { type == "break" }

    init(id: String = makeID(), type: String = "song", title: String = "", artist: String = "",
         key: String = "", notes: String = "", durationMs: Int = 0, files: [FileRef] = []) {
        self.id = id; self.type = type; self.title = title; self.artist = artist
        self.key = key; self.notes = notes; self.durationMs = durationMs; self.files = files
    }

    static func pause(_ title: String = "Pause") -> SetlistItem { SetlistItem(type: "break", title: title) }

    // Tåler manglende felter (nettsiden utelater noen for pauser)
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? makeID()
        type = try c.decodeIfPresent(String.self, forKey: .type) ?? "song"
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        artist = try c.decodeIfPresent(String.self, forKey: .artist) ?? ""
        key = try c.decodeIfPresent(String.self, forKey: .key) ?? ""
        notes = try c.decodeIfPresent(String.self, forKey: .notes) ?? ""
        durationMs = Int(try c.decodeIfPresent(Double.self, forKey: .durationMs) ?? 0)
        files = try c.decodeIfPresent([FileRef].self, forKey: .files) ?? []
    }
}

struct Setlist: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var date: String // "YYYY-MM-DD" eller ""
    var venue: String
    var notes: String
    var spotifyUrl: String
    var cover: String
    /// Eget bilde i vinylen (fil i bandets filer). Går foran Spotify-coveret. Nettsiden beholder feltet uendret.
    var coverFile: FileRef?
    var createdAt: Int // millisekunder
    var updatedAt: Int
    var items: [SetlistItem]

    init(id: String = makeID(), name: String = "Ny setlist", items: [SetlistItem] = []) {
        self.id = id; self.name = name; date = ""; venue = ""; notes = ""; spotifyUrl = ""; cover = ""
        createdAt = nowMs(); updatedAt = nowMs(); self.items = items
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        venue = try c.decodeIfPresent(String.self, forKey: .venue) ?? ""
        notes = try c.decodeIfPresent(String.self, forKey: .notes) ?? ""
        spotifyUrl = try c.decodeIfPresent(String.self, forKey: .spotifyUrl) ?? ""
        cover = try c.decodeIfPresent(String.self, forKey: .cover) ?? ""
        coverFile = try? c.decodeIfPresent(FileRef.self, forKey: .coverFile)
        createdAt = Int(try c.decodeIfPresent(Double.self, forKey: .createdAt) ?? 0)
        updatedAt = Int(try c.decodeIfPresent(Double.self, forKey: .updatedAt) ?? 0)
        items = try c.decodeIfPresent([SetlistItem].self, forKey: .items) ?? []
    }

    var songs: [SetlistItem] { items.filter { !$0.isBreak } }
    /// Alle filer setlisten bruker (låtfiler + vinylbilde).
    var allFiles: [FileRef] { items.flatMap(\.files) + (coverFile.map { [$0] } ?? []) }
    var songCount: Int { songs.count }
    var totalMs: Int { items.reduce(0) { $0 + $1.durationMs } }

    /// Låtnummer per låt (pauser får ikke nummer).
    var numbers: [String: Int] {
        var n = 0
        var out: [String: Int] = [:]
        for item in items where !item.isBreak { n += 1; out[item.id] = n }
        return out
    }

    func nextSongTitle(after id: String) -> String? {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return nil }
        return items[(i + 1)...].first(where: { !$0.isBreak })?.title
    }

    var dateValue: Date? { Self.dayFormatter.date(from: date) }

    static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}

/// Én Pencil-strek, samme format som nettsiden: koordinater normalisert 0–1.
/// p = [x, y, trykk, x, y, trykk, ...]
struct Stroke: Codable, Hashable {
    var t: String // "pen" eller "marker"
    var c: String // farge #rrggbb
    var w: Double // bredde som andel av sidebredden
    var p: [Double]
}

/* ---------- Hjelpere ---------- */

/// Kort tilfeldig id som på nettsiden.
func makeID() -> String {
    let chars = Array("abcdefghijklmnopqrstuvwxyz0123456789")
    return String((0..<12).map { _ in chars.randomElement()! })
}

func nowMs() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

/// «3:45» fra millisekunder (tom for 0).
func formatDuration(_ ms: Int) -> String {
    let s = Int((Double(ms) / 1000).rounded())
    guard s > 0 else { return "" }
    return String(format: "%d:%02d", s / 60, s % 60)
}

/// «1 t 12 min» / «38 min».
func formatTotal(_ ms: Int) -> String {
    let minutes = Int((Double(ms) / 60000).rounded())
    return minutes >= 60 ? "\(minutes / 60) t \(minutes % 60) min" : "\(minutes) min"
}

/// «3:45» eller «4» → millisekunder. nil hvis teksten ikke kan tolkes.
func parseDuration(_ text: String) -> Int? {
    let parts = text.trimmed.split(separator: ":")
    if parts.isEmpty { return 0 }
    guard parts.count <= 2, let m = Int(parts[0]) else { return nil }
    let s = parts.count == 2 ? Int(parts[1]) : 0
    guard let s, s < 60 else { return nil }
    return (m * 60 + s) * 1000
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

/* ---------- Tekstfiler: samme sideoppsett som nettsiden (textLayout i app.js) ---------- */

enum TextLayout {
    static let a4 = CGSize(width: 595.28, height: 841.89)

    struct Row { let text: String; let y: Double } // y i PDF-koordinater (fra bunnen)
    struct Page { let title: Bool; let rows: [Row] }

    static func pages(_ text: String) -> [Page] {
        let lines = text.replacingOccurrences(of: "\t", with: "    ")
            .replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var pages: [Page] = []
        var rows: [Row] = []
        var title = true
        var y = a4.height - 60 - 28
        for line in lines {
            if y < 40 {
                pages.append(Page(title: title, rows: rows))
                rows = []; title = false; y = a4.height - 50
            }
            rows.append(Row(text: line, y: y))
            y -= 14
        }
        pages.append(Page(title: title, rows: rows))
        return pages
    }
}
