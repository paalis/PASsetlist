import Foundation

enum AttachmentKind: String, Codable {
    case pdf, image, text
}

/// En fil (tekst, noter, akkordskjema) som hører til en låt.
struct Attachment: Identifiable, Codable, Hashable {
    var id = UUID()
    var name: String        // originalt filnavn
    var storedName: String  // filnavn i appens mappe
    var kind: AttachmentKind
}

struct SetlistItem: Identifiable, Codable, Hashable {
    var id = UUID()
    var isBreak = false
    var title = ""
    var artist = ""
    var key = ""
    var notes = ""
    var duration = 0 // sekunder
    var attachments: [Attachment] = []
}

struct Setlist: Identifiable, Codable, Hashable {
    var id = UUID()
    var name = "Ny setlist"
    var date: Date? = nil
    var venue = ""
    var notes = ""
    var items: [SetlistItem] = []

    var songCount: Int { items.filter { !$0.isBreak }.count }
    var totalDuration: Int { items.reduce(0) { $0 + $1.duration } }

    /// Låtnummer per låt (pauser får ikke nummer).
    var numbers: [UUID: Int] {
        var n = 0
        var result: [UUID: Int] = [:]
        for item in items where !item.isBreak {
            n += 1
            result[item.id] = n
        }
        return result
    }

    /// Tittelen på neste låt etter den med gitt id.
    func nextSongTitle(after id: UUID) -> String? {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return nil }
        return items[(index + 1)...].first(where: { !$0.isBreak })?.title
    }
}

/// «3:45» fra sekunder (tom tekst for 0).
func formatDuration(_ seconds: Int) -> String {
    guard seconds > 0 else { return "" }
    return String(format: "%d:%02d", seconds / 60, seconds % 60)
}

/// «1 t 12 min» / «38 min».
func formatTotal(_ seconds: Int) -> String {
    let minutes = Int((Double(seconds) / 60).rounded())
    return minutes >= 60 ? "\(minutes / 60) t \(minutes % 60) min" : "\(minutes) min"
}

/// «3:45» eller «4» (minutter) → sekunder. nil hvis teksten ikke kan tolkes.
func parseDuration(_ text: String) -> Int? {
    let parts = text.trimmed.split(separator: ":")
    if parts.isEmpty { return 0 }
    guard parts.count <= 2, let minutes = Int(parts[0]) else { return nil }
    let seconds = parts.count == 2 ? Int(parts[1]) : 0
    guard let seconds, seconds < 60 else { return nil }
    return minutes * 60 + seconds
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
