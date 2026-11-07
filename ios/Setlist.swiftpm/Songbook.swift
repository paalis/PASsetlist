import UIKit
import PDFKit

/// Notehefte: én PDF med forside og alle filene i setlistens rekkefølge, med Pencil-notatene
/// (fra både nettsiden og iPaden). Samme oppsett som nettsidens notehefte.
@MainActor
enum Songbook {
    static let a4 = CGRect(origin: .zero, size: TextLayout.a4)

    static func make(for setlist: Setlist, store: Store) async throws -> URL {
        // Hent filer og ferske notater først (ikke mulig inne i PDF-tegningen)
        struct Part { let number: Int; let item: SetlistItem; let file: FileRef; let source: PageSource; let notes: [[Stroke]] }
        let numbers = setlist.numbers
        var parts: [Part] = []
        for item in setlist.items where !item.isBreak {
            for f in item.files {
                guard let url = try? await store.ensureFile(f), let source = PageSource(url: url, ref: f) else { continue }
                var notes: [[Stroke]] = []
                for i in 0..<source.pageCount {
                    let fresh = await store.refreshNotes(fileID: f.id, page: i)
                    notes.append(fresh ?? store.localNotes(fileID: f.id, page: i))
                }
                parts.append(Part(number: numbers[item.id] ?? 0, item: item, file: f, source: source, notes: notes))
            }
        }

        let safeName = setlist.name.components(separatedBy: CharacterSet(charactersIn: "/\\:*?\"<>|")).joined().trimmed
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(safeName.isEmpty ? "Setlist" : safeName) - notehefte.pdf")

        try UIGraphicsPDFRenderer(bounds: a4).writePDF(to: url) { context in
            drawCover(setlist, numbers: numbers, context: context)
            for part in parts {
                let label = "\(part.number). \(part.item.title)"
                for i in 0..<part.source.pageCount {
                    switch part.source {
                    case .pdf(let doc):
                        guard let page = doc.page(at: i) else { continue }
                        var box = page.bounds(for: .cropBox)
                        if page.rotation % 180 != 0 { box.size = CGSize(width: box.height, height: box.width) }
                        let rect = CGRect(origin: .zero, size: box.size)
                        context.beginPage(withBounds: rect, pageInfo: [:])
                        let cg = context.cgContext
                        cg.saveGState()
                        cg.translateBy(x: 0, y: rect.height)
                        cg.scaleBy(x: 1, y: -1)
                        page.draw(with: .cropBox, to: cg)
                        cg.restoreGState()
                        Ink.draw(part.notes[i], in: rect, context: cg)
                        drawFooter(label, in: rect)
                    case .image(let img):
                        context.beginPage(withBounds: a4, pageInfo: [:])
                        let s = min((a4.width - 40) / img.size.width, (a4.height - 50) / img.size.height)
                        let rect = CGRect(x: (a4.width - img.size.width * s) / 2, y: 20, width: img.size.width * s, height: img.size.height * s)
                        img.draw(in: rect)
                        Ink.draw(part.notes[i], in: rect, context: context.cgContext)
                        drawFooter(label, in: a4)
                    case .text(_, let pages):
                        context.beginPage(withBounds: a4, pageInfo: [:])
                        PageSource.drawTextPage(pages[i], song: part.number, title: part.item.title)
                        Ink.draw(part.notes[i], in: a4, context: context.cgContext)
                        drawFooter(label, in: a4)
                    }
                }
            }
        }
        return url
    }

    private static func drawCover(_ setlist: Setlist, numbers: [String: Int], context: UIGraphicsPDFRendererContext) {
        context.beginPage()
        var y: CGFloat = 56
        draw(setlist.name.uppercased(), font: Theme.posterUIFont(28), color: .black, x: 50, y: &y)
        let sub = [setlist.date, setlist.venue].filter { !$0.isEmpty }.joined(separator: " · ")
        if !sub.isEmpty { draw(sub, font: .systemFont(ofSize: 12), color: .darkGray, x: 50, y: &y) }
        y += 18
        for item in setlist.items {
            if y > a4.height - 60 { context.beginPage(); y = 50 }
            if item.isBreak {
                draw("— \((item.title.isEmpty ? "Pause" : item.title).uppercased()) —", font: .boldSystemFont(ofSize: 11), color: .gray, x: 74, y: &y)
            } else {
                var line = "\(numbers[item.id] ?? 0).  \(item.title)"
                if !item.artist.isEmpty { line += "   \(item.artist)" }
                if !item.key.isEmpty { line += "   (\(item.key))" }
                if item.files.isEmpty { line += "   – ingen filer" }
                draw(line, font: .systemFont(ofSize: 13, weight: .semibold), color: .black, x: 50, y: &y)
            }
            y += 4
        }
    }

    static func draw(_ text: String, font: UIFont, color: UIColor, x: CGFloat, y: inout CGFloat, width: CGFloat? = nil) {
        let string = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color])
        let rect = CGRect(x: x, y: y, width: width ?? (a4.width - x - 40), height: 1000)
        let h = string.boundingRect(with: rect.size, options: [.usesLineFragmentOrigin], context: nil).height
        string.draw(with: rect, options: [.usesLineFragmentOrigin], context: nil)
        y += ceil(h) + 2
    }

    static func drawFooter(_ text: String, in rect: CGRect) {
        let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 8), .foregroundColor: UIColor.gray]
        let size = (text as NSString).size(withAttributes: attrs)
        (text as NSString).draw(at: CGPoint(x: rect.maxX - size.width - 24, y: rect.maxY - 18), withAttributes: attrs)
    }
}
