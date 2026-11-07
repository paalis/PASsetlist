import UIKit
import PDFKit

// Felles for scenemodus og notehefte: hvilke sider en fil har, hvordan de tegnes,
// og hvordan Pencil-streker tegnes (samme formler som nettsiden, notes/viewer.js).

/// Én side i notevisningen.
struct NotePage: Identifiable {
    let id: String
    let song: Int
    let title: String
    let next: String?
    let file: FileRef
    let index: Int
    let source: PageSource
}

/// Innholdet i en fil, klart til å tegnes.
enum PageSource {
    case pdf(PDFDocument)
    case image(UIImage)
    case text(String, [TextLayout.Page])

    init?(url: URL, ref: FileRef) {
        switch ref.kind {
        case .pdf:
            guard let doc = PDFDocument(url: url) else { return nil }
            self = .pdf(doc)
        case .image:
            guard let img = UIImage(contentsOfFile: url.path) else { return nil }
            self = .image(img)
        case .text:
            let text = (try? String(contentsOf: url, encoding: .utf8)) ?? (try? String(contentsOf: url, encoding: .isoLatin1)) ?? ""
            self = .text(text, TextLayout.pages(text))
        case .unknown:
            return nil
        }
    }

    var pageCount: Int {
        switch self {
        case .pdf(let doc): return doc.pageCount
        case .image: return 1
        case .text(_, let pages): return pages.count
        }
    }

    /// Bredde/høyde for siden (PDF: synlig område med rotasjon, som pdf.js).
    func aspect(_ index: Int) -> CGFloat {
        switch self {
        case .pdf(let doc):
            guard let page = doc.page(at: index) else { return 1 / sqrt(2) }
            var size = page.bounds(for: .cropBox).size
            if page.rotation % 180 != 0 { size = CGSize(width: size.height, height: size.width) }
            return size.height > 0 ? size.width / size.height : 1
        case .image(let img):
            return img.size.height > 0 ? img.size.width / img.size.height : 1
        case .text:
            return TextLayout.a4.width / TextLayout.a4.height
        }
    }

    /// Tegner siden som bilde i gitt bredde (piksler).
    func render(_ index: Int, width: CGFloat, song: Int, title: String) -> UIImage {
        let size = CGSize(width: width, height: width / aspect(index))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            switch self {
            case .pdf(let doc):
                if let page = doc.page(at: index) {
                    page.thumbnail(of: size, for: .cropBox).draw(in: CGRect(origin: .zero, size: size))
                }
            case .image(let img):
                img.draw(in: CGRect(origin: .zero, size: size))
            case .text(_, let pages):
                let k = size.width / TextLayout.a4.width
                ctx.cgContext.scaleBy(x: k, y: k)
                Self.drawTextPage(pages[index], song: song, title: title)
            }
        }
    }

    /// Tekstside i A4-punkter, samme plassering som nettsiden og noteheftet.
    static func drawTextPage(_ page: TextLayout.Page, song: Int, title: String) {
        let h = TextLayout.a4.height
        if page.title {
            let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: 16), .foregroundColor: UIColor.black]
            ("\(song). \(title)" as NSString).draw(at: CGPoint(x: 50, y: h - (h - 60) - 16 * 0.93), withAttributes: attrs)
        }
        let mono = UIFont(name: "Courier", size: 10.5) ?? .monospacedSystemFont(ofSize: 10.5, weight: .regular)
        let attrs: [NSAttributedString.Key: Any] = [.font: mono, .foregroundColor: UIColor(white: 0.07, alpha: 1)]
        for row in page.rows {
            // y er grunnlinjen fra bunnen (PDF); draw(at:) bruker øvre kant
            (String(row.text.prefix(90)) as NSString).draw(at: CGPoint(x: 50, y: h - row.y - mono.ascender), withAttributes: attrs)
        }
    }
}

enum Ink {
    static let penWidth = 0.0032
    static let markerWidth = 0.022
    static let markerColor = "#ffd400"
    static let colors: [(name: String, hex: String)] = [("Rød", "#e5243b"), ("Blå", "#1f6feb"), ("Svart", "#111111")]

    static func uiColor(_ css: String) -> UIColor {
        let v = UInt32(css.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x111111
        return UIColor(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }

    /// Tegner streker i et rektangel (koordinatene er normalisert 0–1).
    static func draw(_ strokes: [Stroke], in rect: CGRect, context ctx: CGContext) {
        for st in strokes { draw(st, in: rect, context: ctx) }
    }

    static func draw(_ st: Stroke, in rect: CGRect, context ctx: CGContext) {
        let p = st.p
        guard p.count >= 3 else { return }
        let W = rect.width, H = rect.height
        func pt(_ i: Int) -> CGPoint { CGPoint(x: rect.minX + p[i] * W, y: rect.minY + p[i + 1] * H) }
        ctx.saveGState()
        ctx.setLineCap(.round)
        ctx.setLineJoin(.round)
        if st.t == "marker" {
            ctx.setBlendMode(.multiply)
            ctx.setAlpha(0.38)
            ctx.setStrokeColor(uiColor(st.c.isEmpty ? markerColor : st.c).cgColor)
            ctx.setLineWidth(st.w * W)
            ctx.beginPath()
            ctx.move(to: pt(0))
            var i = 3
            while i < p.count { ctx.addLine(to: pt(i)); i += 3 }
            if p.count == 3 { ctx.addLine(to: CGPoint(x: pt(0).x + 0.01, y: pt(0).y)) }
            ctx.strokePath()
        } else {
            let color = uiColor(st.c).cgColor
            ctx.setStrokeColor(color)
            ctx.setFillColor(color)
            if p.count == 3 {
                let r = st.w * W * (0.4 + 0.8 * p[2]) / 2
                ctx.fillEllipse(in: CGRect(x: pt(0).x - r, y: pt(0).y - r, width: r * 2, height: r * 2))
            }
            var i = 3
            while i < p.count {
                ctx.setLineWidth(st.w * W * (0.4 + 0.8 * ((p[i - 1] + p[i + 2]) / 2)))
                ctx.beginPath()
                ctx.move(to: pt(i - 3))
                ctx.addLine(to: pt(i))
                ctx.strokePath()
                i += 3
            }
        }
        ctx.restoreGState()
    }
}
