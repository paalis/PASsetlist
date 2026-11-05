import SwiftUI
import PDFKit
import PencilKit

/// Lager ett samlet notehefte (PDF) med alle filene i setlistens rekkefølge,
/// inkludert Pencil-notatene.
enum Songbook {
    static let a4 = CGRect(x: 0, y: 0, width: 595.28, height: 841.89)

    static func make(for setlist: Setlist) throws -> URL {
        let safeName = setlist.name
            .components(separatedBy: CharacterSet(charactersIn: "/\\:*?\"<>|"))
            .joined()
            .trimmed
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(safeName.isEmpty ? "Setlist" : safeName) - notehefte.pdf")
        let numbers = setlist.numbers
        let renderer = UIGraphicsPDFRenderer(bounds: a4)

        try renderer.writePDF(to: url) { context in
            drawCover(setlist, numbers: numbers, context: context)

            for item in setlist.items where !item.isBreak {
                let label = "\(numbers[item.id] ?? 0). \(item.title)"
                for attachment in item.attachments {
                    let fileURL = Store.fileURL(attachment)
                    switch attachment.kind {
                    case .pdf:
                        guard let document = PDFDocument(url: fileURL) else { continue }
                        for index in 0..<document.pageCount {
                            guard let page = document.page(at: index) else { continue }
                            let box = page.bounds(for: .mediaBox)
                            let rect = CGRect(origin: .zero, size: box.size)
                            context.beginPage(withBounds: rect, pageInfo: [:])
                            let cg = context.cgContext
                            cg.saveGState()
                            cg.translateBy(x: 0, y: rect.height)
                            cg.scaleBy(x: 1, y: -1)
                            cg.translateBy(x: -box.minX, y: -box.minY)
                            page.draw(with: .mediaBox, to: cg)
                            cg.restoreGState()
                            drawNotes(attachment, page: index, in: rect)
                            drawFooter(label, in: rect)
                        }
                    case .image:
                        guard let image = UIImage(contentsOfFile: fileURL.path) else { continue }
                        context.beginPage(withBounds: a4, pageInfo: [:])
                        let frame = aspectFit(image.size, in: a4.insetBy(dx: 20, dy: 24))
                        image.draw(in: frame)
                        drawNotes(attachment, page: 0, in: frame)
                        drawFooter(label, in: a4)
                    case .text:
                        drawText(Store.readText(fileURL), title: label, context: context)
                    }
                }
            }
        }
        return url
    }

    // MARK: Forside

    private static func drawCover(_ setlist: Setlist, numbers: [UUID: Int], context: UIGraphicsPDFRendererContext) {
        context.beginPage()
        var y: CGFloat = 56
        draw(setlist.name.uppercased(), font: .boldSystemFont(ofSize: 26), color: .black, x: 50, y: &y)
        var sub: [String] = []
        if let date = setlist.date { sub.append(date.formatted(date: .long, time: .omitted)) }
        if !setlist.venue.isEmpty { sub.append(setlist.venue) }
        if !sub.isEmpty { draw(sub.joined(separator: " · "), font: .systemFont(ofSize: 12), color: .darkGray, x: 50, y: &y) }
        y += 18

        for item in setlist.items {
            if y > a4.height - 60 {
                context.beginPage()
                y = 50
            }
            if item.isBreak {
                draw("— \((item.title.isEmpty ? "Pause" : item.title).uppercased()) —", font: .boldSystemFont(ofSize: 11), color: .gray, x: 74, y: &y)
            } else {
                var line = "\(numbers[item.id] ?? 0).  \(item.title)"
                if !item.artist.isEmpty { line += "   \(item.artist)" }
                if !item.key.isEmpty { line += "   (\(item.key))" }
                if item.attachments.isEmpty { line += "   – ingen filer" }
                draw(line, font: .systemFont(ofSize: 13, weight: .semibold), color: .black, x: 50, y: &y)
            }
            y += 4
        }
    }

    // MARK: Tekstfiler

    private static func drawText(_ text: String, title: String, context: UIGraphicsPDFRendererContext) {
        context.beginPage(withBounds: a4, pageInfo: [:])
        var y: CGFloat = 50
        draw(title, font: .boldSystemFont(ofSize: 16), color: .black, x: 50, y: &y)
        y += 10
        let font = UIFont.monospacedSystemFont(ofSize: 10.5, weight: .regular)
        for line in text.replacingOccurrences(of: "\t", with: "    ").components(separatedBy: .newlines) {
            if y > a4.height - 40 {
                drawFooter(title, in: a4)
                context.beginPage(withBounds: a4, pageInfo: [:])
                y = 40
            }
            draw(line.isEmpty ? " " : line, font: font, color: .black, x: 50, y: &y)
        }
        drawFooter(title, in: a4)
    }

    // MARK: Hjelpere

    private static func draw(_ text: String, font: UIFont, color: UIColor, x: CGFloat, y: inout CGFloat) {
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
        let string = NSAttributedString(string: text, attributes: attributes)
        let rect = CGRect(x: x, y: y, width: a4.width - x - 40, height: 1000)
        let height = string.boundingRect(with: rect.size, options: [.usesLineFragmentOrigin], context: nil).height
        string.draw(with: rect, options: [.usesLineFragmentOrigin], context: nil)
        y += ceil(height) + 2
    }

    private static func drawFooter(_ text: String, in rect: CGRect) {
        let attributes: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 8), .foregroundColor: UIColor.gray]
        let size = (text as NSString).size(withAttributes: attributes)
        (text as NSString).draw(at: CGPoint(x: rect.maxX - size.width - 24, y: rect.maxY - 18), withAttributes: attributes)
    }

    /// Tegner Pencil-notatene for en side oppå i samme størrelse.
    private static func drawNotes(_ attachment: Attachment, page: Int, in frame: CGRect) {
        guard let drawing = Store.drawing(attachment, page: page, width: frame.width) else { return }
        var image: UIImage?
        UITraitCollection(userInterfaceStyle: .light).performAsCurrent {
            image = drawing.image(from: CGRect(origin: .zero, size: frame.size), scale: 2)
        }
        image?.draw(in: frame)
    }

    private static func aspectFit(_ size: CGSize, in rect: CGRect) -> CGRect {
        guard size.width > 0, size.height > 0 else { return rect }
        let scale = min(rect.width / size.width, rect.height / size.height)
        let fitted = CGSize(width: size.width * scale, height: size.height * scale)
        return CGRect(x: rect.midX - fitted.width / 2, y: rect.midY - fitted.height / 2, width: fitted.width, height: fitted.height)
    }
}

/// Viser noteheftet med knapp for å dele, lagre i Filer, skrive ut eller sende med AirDrop.
struct SongbookPreview: View {
    let url: URL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            PDFKitView(url: url)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle("Notehefte")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Lukk") { dismiss() }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        ShareLink(item: url)
                    }
                }
        }
    }
}
