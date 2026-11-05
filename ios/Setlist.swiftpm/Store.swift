import SwiftUI
import PencilKit

/// Holder alle setlister og lagrer dem som JSON i appens dokumentmappe.
/// Filer (noter) og Pencil-notater lagres som egne filer ved siden av.
final class Store: ObservableObject {
    @Published var setlists: [Setlist] = [] {
        didSet { scheduleSave() }
    }

    static let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    static let filesFolder = documents.appendingPathComponent("Filer", isDirectory: true)
    static let drawingsFolder = documents.appendingPathComponent("Notater", isDirectory: true)
    private static let dataURL = documents.appendingPathComponent("setlister.json")

    private var saveTask: Task<Void, Never>?

    init() {
        for folder in [Self.filesFolder, Self.drawingsFolder] {
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        }
        if let data = try? Data(contentsOf: Self.dataURL),
           let saved = try? JSONDecoder().decode([Setlist].self, from: data) {
            setlists = saved
        }
    }

    // MARK: Lagring

    private func scheduleSave() {
        saveTask?.cancel()
        let snapshot = setlists
        saveTask = Task {
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            Self.write(snapshot)
        }
    }

    func saveNow() {
        saveTask?.cancel()
        Self.write(setlists)
    }

    private static func write(_ setlists: [Setlist]) {
        if let data = try? JSONEncoder().encode(setlists) {
            try? data.write(to: dataURL, options: .atomic)
        }
    }

    /// Binding som slår opp setlisten på id hver gang (trygt også når listen endres).
    func binding(for id: UUID) -> Binding<Setlist> {
        Binding(
            get: { self.setlists.first(where: { $0.id == id }) ?? Setlist(id: id) },
            set: { newValue in
                if let index = self.setlists.firstIndex(where: { $0.id == id }) {
                    self.setlists[index] = newValue
                }
            }
        )
    }

    func duplicate(_ id: UUID) {
        guard let original = setlists.first(where: { $0.id == id }) else { return }
        var copy = original
        copy.id = UUID()
        copy.name = original.name + " (kopi)"
        copy.items = original.items.map { item in
            var item = item
            item.id = UUID()
            return item
        }
        setlists.insert(copy, at: 0)
    }

    // MARK: Filer

    static func fileURL(_ attachment: Attachment) -> URL {
        filesFolder.appendingPathComponent(attachment.storedName)
    }

    /// Kopierer en fil valgt i Filer-appen inn i appens egen mappe.
    func importFile(from url: URL) throws -> Attachment {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }

        let ext = url.pathExtension.lowercased()
        let kind: AttachmentKind
        switch ext {
        case "pdf": kind = .pdf
        case "txt", "text", "pro", "cho", "chopro", "chordpro", "crd": kind = .text
        default: kind = .image
        }

        if kind == .image, let data = try? Data(contentsOf: url), let attachment = importImageData(data, name: url.lastPathComponent) {
            return attachment
        }

        let storedName = UUID().uuidString + "." + (ext.isEmpty ? "dat" : ext)
        try FileManager.default.copyItem(at: url, to: Self.filesFolder.appendingPathComponent(storedName))
        return Attachment(name: url.lastPathComponent, storedName: storedName, kind: kind)
    }

    /// Lagrer et bilde (f.eks. fra Bilder-appen) som JPEG, nedskalert til maks 2400 px.
    func importImageData(_ data: Data, name: String = "Bilde") -> Attachment? {
        guard let image = UIImage(data: data) else { return nil }
        let maxSide: CGFloat = 2400
        let scale = min(1, maxSide / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            UIColor.white.setFill()
            UIRectFill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let jpeg = resized.jpegData(compressionQuality: 0.85) else { return nil }
        let storedName = UUID().uuidString + ".jpg"
        do {
            try jpeg.write(to: Self.filesFolder.appendingPathComponent(storedName))
        } catch {
            return nil
        }
        let baseName = (name as NSString).deletingPathExtension
        return Attachment(name: baseName + ".jpg", storedName: storedName, kind: .image)
    }

    static func readText(_ url: URL) -> String {
        (try? String(contentsOf: url, encoding: .utf8))
            ?? (try? String(contentsOf: url, encoding: .isoLatin1))
            ?? ""
    }

    /// Sletter filer og notater som ingen låt bruker lenger.
    func removeUnusedFiles() {
        let attachments = setlists.flatMap { $0.items.flatMap(\.attachments) }
        let usedFiles = Set(attachments.map(\.storedName))
        let usedIDs = Set(attachments.map { $0.id.uuidString })
        let fm = FileManager.default

        for name in (try? fm.contentsOfDirectory(atPath: Self.filesFolder.path)) ?? [] where !usedFiles.contains(name) {
            try? fm.removeItem(at: Self.filesFolder.appendingPathComponent(name))
        }
        for name in (try? fm.contentsOfDirectory(atPath: Self.drawingsFolder.path)) ?? [] {
            let id = String(name.prefix(36))
            if !usedIDs.contains(id) {
                try? fm.removeItem(at: Self.drawingsFolder.appendingPathComponent(name))
            }
        }
    }

    // MARK: Pencil-notater

    /// En tegning lagres sammen med bredden den ble tegnet i, så den kan skaleres
    /// riktig når iPaden snus eller siden vises i en annen størrelse.
    struct SavedDrawing: Codable {
        var data: Data
        var width: Double
    }

    static func drawingURL(_ attachment: Attachment, page: Int) -> URL {
        drawingsFolder.appendingPathComponent("\(attachment.id.uuidString)-\(page).json")
    }

    static func loadDrawing(_ attachment: Attachment, page: Int) -> SavedDrawing? {
        guard let data = try? Data(contentsOf: drawingURL(attachment, page: page)) else { return nil }
        return try? JSONDecoder().decode(SavedDrawing.self, from: data)
    }

    static func saveDrawing(_ drawing: PKDrawing, width: CGFloat, attachment: Attachment, page: Int) {
        let url = drawingURL(attachment, page: page)
        if drawing.strokes.isEmpty {
            try? FileManager.default.removeItem(at: url)
            return
        }
        let saved = SavedDrawing(data: drawing.dataRepresentation(), width: Double(width))
        if let data = try? JSONEncoder().encode(saved) {
            try? data.write(to: url, options: .atomic)
        }
    }

    /// Tegningen skalert til en gitt bredde.
    static func drawing(_ attachment: Attachment, page: Int, width: CGFloat) -> PKDrawing? {
        guard let saved = loadDrawing(attachment, page: page),
              let drawing = try? PKDrawing(data: saved.data),
              saved.width > 0 else { return nil }
        let scale = width / CGFloat(saved.width)
        return drawing.transformed(using: CGAffineTransform(scaleX: scale, y: scale))
    }
}
