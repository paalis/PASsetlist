import SwiftUI
import UIKit

/// Utskrift av setlisten med valg og forhåndsvisning – samme valg som på nettsiden.
struct PrintOptions: Codable, Equatable {
    enum Layout: String, Codable, CaseIterable { case stage = "Scene", compact = "Kompakt", columns = "To kolonner" }
    var layout = Layout.stage
    var landscape = false
    var dark = false
    var fit = true
    var size = 100.0
    var header = true
    var numbers = true
    var artist = true
    var key = true
    var notes = false
    var duration = false
    var breaks = true
    var total = false
    var upper = false

    static var saved: PrintOptions {
        get { (UserDefaults.standard.data(forKey: "print").flatMap { try? JSONDecoder().decode(PrintOptions.self, from: $0) }) ?? PrintOptions() }
        set { UserDefaults.standard.set(try? JSONEncoder().encode(newValue), forKey: "print") }
    }
}

@MainActor
struct PrintSheet: View {
    let setlist: Setlist
    @Environment(\.dismiss) private var dismiss
    @State private var options = PrintOptions.saved
    @State private var result: PrintLayout.Result?

    var body: some View {
        NavigationStack {
            HStack(spacing: 0) {
                Form {
                    Section("Oppsett") {
                        Picker("Oppsett", selection: $options.layout) {
                            ForEach(PrintOptions.Layout.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                        }.pickerStyle(.segmented)
                        Picker("Retning", selection: $options.landscape) {
                            Text("Stående").tag(false)
                            Text("Liggende").tag(true)
                        }.pickerStyle(.segmented)
                    }
                    Section("Tekststørrelse") {
                        Toggle("Tilpass til én side", isOn: $options.fit)
                        if !options.fit {
                            Slider(value: $options.size, in: 60...180, step: 5) { Text("Størrelse") }
                            Text("\(Int(options.size)) %").foregroundStyle(Theme.muted)
                        }
                    }
                    Section("Vis") {
                        Toggle("Navn, dato og sted", isOn: $options.header)
                        Toggle("Låtnummer", isOn: $options.numbers)
                        Toggle("Artist", isOn: $options.artist)
                        Toggle("Toneart", isOn: $options.key)
                        Toggle("Notater", isOn: $options.notes)
                        Toggle("Varighet", isOn: $options.duration)
                        Toggle("Pauser", isOn: $options.breaks)
                        Toggle("Total spilletid", isOn: $options.total)
                        Toggle("STORE BOKSTAVER", isOn: $options.upper)
                    }
                    Section {
                        Picker("Utseende", selection: $options.dark) {
                            Text("Lys").tag(false)
                            Text("Mørk").tag(true)
                        }.pickerStyle(.segmented)
                    } header: { Text("Utseende") } footer: { Text("Mørk passer for PDF på nettbrett på scenen, lys for papir.") }
                }
                .frame(width: 340)
                .scrollContentBackground(.hidden)
                .background(Theme.surface)

                VStack(spacing: 8) {
                    if let result {
                        PDFKitView(url: result.url).id(result.url.absoluteString + "\(result.pages)\(result.scale)")
                        Text("A4 \(options.landscape ? "liggende" : "stående") · \(result.pages) \(result.pages == 1 ? "side" : "sider")"
                             + (options.fit ? " · skrift \(Int(result.scale * 100)) %" : ""))
                            .font(.caption).foregroundStyle(Theme.muted)
                    } else {
                        ProgressView()
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(hex: 0x0D0C0F))
            }
            .toolbar {
                ToolbarItem(placement: .principal) { PosterText(text: "Skriv ut setlist", size: 22) }
                ToolbarItem(placement: .cancellationAction) { Button("Lukk") { dismiss() } }
                ToolbarItemGroup(placement: .primaryAction) {
                    if let url = result?.url {
                        ShareLink(item: url)
                        Button("Skriv ut") {
                            let controller = UIPrintInteractionController.shared
                            controller.printingItem = url
                            controller.present(animated: true, completionHandler: nil)
                        }.bold()
                    }
                }
            }
            .onAppear { rebuild() }
            .onChange(of: options) { _, new in
                PrintOptions.saved = new
                rebuild()
            }
        }
    }

    private func rebuild() {
        result = try? PrintLayout.render(setlist, options: options)
    }
}

/// Lager selve PDF-en: ekte A4-sider, en låt deles aldri mellom sider.
enum PrintLayout {
    struct Result { let url: URL; let pages: Int; let scale: Double }

    private struct Row { let text: NSAttributedString; let height: CGFloat; let isBreak: Bool }

    static func render(_ sl: Setlist, options o: PrintOptions) throws -> Result {
        let size = o.landscape ? CGSize(width: 841.89, height: 595.28) : CGSize(width: 595.28, height: 841.89)
        let margin = UIEdgeInsets(top: 40, left: 45, bottom: 40, right: 45)

        var scale = o.size / 100
        if o.fit {
            var lo = 0.3, hi = o.layout == .stage ? 2.2 : 1.8
            if paginate(sl, o, scale: hi, page: size, margin: margin).count == 1 { lo = hi }
            else {
                for _ in 0..<14 {
                    let mid = (lo + hi) / 2
                    if paginate(sl, o, scale: mid, page: size, margin: margin).count == 1 { lo = mid } else { hi = mid }
                }
            }
            scale = (lo * 100).rounded(.down) / 100
        }
        let fg: UIColor = o.dark ? UIColor(red: 0.96, green: 0.95, blue: 0.93, alpha: 1) : UIColor(white: 0.07, alpha: 1)
        let pages = paginate(sl, o, scale: scale, page: size, margin: margin, color: fg)

        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(sl.name.isEmpty ? "Setlist" : sl.name.replacingOccurrences(of: "/", with: "-")) - setlist.pdf")
        try UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: size)).writePDF(to: url) { ctx in
            for (pi, rows) in pages.enumerated() {
                ctx.beginPage()
                (o.dark ? UIColor(white: 0.04, alpha: 1) : .white).setFill()
                ctx.fill(CGRect(origin: .zero, size: size))
                var y = margin.top
                if pi == 0, o.header {
                    y = drawHeader(sl, o, scale: scale, width: size.width - margin.left - margin.right, at: CGPoint(x: margin.left, y: y), color: fg)
                } else if o.header {
                    let t = NSAttributedString(string: "\((sl.name.isEmpty ? "Setlist" : sl.name).uppercased()) – FORTSETTER",
                                               attributes: [.font: UIFont.boldSystemFont(ofSize: 9), .foregroundColor: fg.withAlphaComponent(0.5), .kern: 1.2])
                    t.draw(at: CGPoint(x: margin.left, y: y))
                    y += 18
                }
                let colGap: CGFloat = 34
                let contentW = size.width - margin.left - margin.right
                let colW = o.layout == .columns ? (contentW - colGap) / 2 : contentW
                var x = margin.left
                let bottom = size.height - margin.bottom - (pi == pages.count - 1 && o.total ? 26 : 0) - (pages.count > 1 ? 14 : 0)
                let top = y
                for row in rows {
                    if y + row.height > bottom, o.layout == .columns, x == margin.left { x += colW + colGap; y = top }
                    row.text.draw(with: CGRect(x: x, y: y, width: colW, height: row.height + 4), options: [.usesLineFragmentOrigin], context: nil)
                    y += row.height
                }
                if pi == pages.count - 1, o.total {
                    let t = NSAttributedString(string: "\(sl.songCount) låter" + (sl.totalMs > 0 ? " · \(formatTotal(sl.totalMs))" : ""),
                                               attributes: [.font: UIFont.systemFont(ofSize: 10 * scale), .foregroundColor: fg.withAlphaComponent(0.6)])
                    t.draw(at: CGPoint(x: margin.left, y: size.height - margin.bottom - 14))
                }
                if pages.count > 1 {
                    let t = NSAttributedString(string: "Side \(pi + 1) av \(pages.count)", attributes: [.font: UIFont.systemFont(ofSize: 8), .foregroundColor: fg.withAlphaComponent(0.5)])
                    t.draw(at: CGPoint(x: size.width - margin.right - t.size().width, y: size.height - 24))
                }
            }
        }
        return Result(url: url, pages: pages.count, scale: scale)
    }

    private static func drawHeader(_ sl: Setlist, _ o: PrintOptions, scale: Double, width: CGFloat, at p: CGPoint, color: UIColor) -> CGFloat {
        var y = p.y
        let title = NSAttributedString(string: o.upper ? sl.name.uppercased() : sl.name,
                                       attributes: [.font: UIFont.systemFont(ofSize: 24 * scale, weight: .heavy), .foregroundColor: color])
        let th = title.boundingRect(with: CGSize(width: width, height: 1000), options: [.usesLineFragmentOrigin], context: nil).height
        title.draw(with: CGRect(x: p.x, y: y, width: width, height: th + 4), options: [.usesLineFragmentOrigin], context: nil)
        y += ceil(th) + 2
        let sub = [sl.date, sl.venue].filter { !$0.isEmpty }.joined(separator: " · ")
        if !sub.isEmpty {
            let s = NSAttributedString(string: sub, attributes: [.font: UIFont.systemFont(ofSize: 10 * scale), .foregroundColor: color.withAlphaComponent(0.65)])
            s.draw(at: CGPoint(x: p.x, y: y))
            y += s.size().height
        }
        y += 6 * scale
        let line = UIBezierPath(rect: CGRect(x: p.x, y: y, width: width, height: 1.5))
        color.setFill(); line.fill()
        return y + 10 * scale
    }

    private static func rows(_ sl: Setlist, _ o: PrintOptions, scale: Double, width: CGFloat, color: UIColor) -> [Row] {
        let base: CGFloat = (o.layout == .stage ? 20 : o.layout == .compact ? 13 : 14) * scale
        let pad: CGFloat = (o.layout == .compact ? 1.5 : 3) * scale
        var n = 0
        var out: [Row] = []
        for item in sl.items {
            let s = NSMutableAttributedString()
            if item.isBreak {
                guard o.breaks else { continue }
                let para = NSMutableParagraphStyle(); para.alignment = .center
                s.append(NSAttributedString(string: "— \((item.title.isEmpty ? "Pause" : item.title).uppercased()) —",
                                            attributes: [.font: UIFont.boldSystemFont(ofSize: 11 * scale), .foregroundColor: color.withAlphaComponent(0.6), .kern: 3, .paragraphStyle: para]))
            } else {
                n += 1
                let small = UIFont.systemFont(ofSize: base * 0.55)
                if o.numbers { s.append(NSAttributedString(string: "\(n)  ", attributes: [.font: UIFont.systemFont(ofSize: base), .foregroundColor: color.withAlphaComponent(0.45)])) }
                s.append(NSAttributedString(string: o.upper ? item.title.uppercased() : item.title, attributes: [.font: UIFont.systemFont(ofSize: base, weight: .heavy), .foregroundColor: color]))
                if o.key, !item.key.isEmpty { s.append(NSAttributedString(string: "  [\(item.key)]", attributes: [.font: UIFont.systemFont(ofSize: base * 0.55, weight: .bold), .foregroundColor: color.withAlphaComponent(0.8)])) }
                if o.artist, !item.artist.isEmpty { s.append(NSAttributedString(string: "  \(item.artist)", attributes: [.font: small, .foregroundColor: color.withAlphaComponent(0.6)])) }
                if o.notes, !item.notes.isEmpty { s.append(NSAttributedString(string: "  \(item.notes)", attributes: [.font: UIFont.italicSystemFont(ofSize: base * 0.5), .foregroundColor: color.withAlphaComponent(0.6)])) }
                if o.duration, item.durationMs > 0 { s.append(NSAttributedString(string: "  \(formatDuration(item.durationMs))", attributes: [.font: small, .foregroundColor: color.withAlphaComponent(0.55)])) }
            }
            let h = s.boundingRect(with: CGSize(width: width, height: 2000), options: [.usesLineFragmentOrigin], context: nil).height
            out.append(Row(text: s, height: ceil(h) + pad * 2 + (item.isBreak ? 8 * scale : 0), isBreak: item.isBreak))
        }
        return out
    }

    private static func paginate(_ sl: Setlist, _ o: PrintOptions, scale: Double, page: CGSize, margin: UIEdgeInsets, color: UIColor = .black) -> [[Row]] {
        let contentW = page.width - margin.left - margin.right
        let colW = o.layout == .columns ? (contentW - 34) / 2 : contentW
        let all = rows(sl, o, scale: scale, width: colW, color: color)
        let headerH: CGFloat = o.header ? (24 * scale * 1.25 + (sl.date.isEmpty && sl.venue.isEmpty ? 0 : 14 * scale) + 18 * scale) : 0
        let contH: CGFloat = o.header ? 18 : 0
        var pages: [[Row]] = []
        var cur: [Row] = []
        var used: CGFloat = 0
        var col = 0
        var avail = page.height - margin.top - margin.bottom - headerH - 14
        for (i, r) in all.enumerated() {
            let lastReserve: CGFloat = (o.total && i == all.count - 1) ? 26 : 0
            if !cur.isEmpty && used + r.height + lastReserve > avail {
                if o.layout == .columns && col == 0 { col = 1; used = 0 }
                else {
                    pages.append(cur); cur = []; used = 0; col = 0
                    avail = page.height - margin.top - margin.bottom - contH - 14
                }
            }
            cur.append(r)
            used += r.height
        }
        pages.append(cur)
        return pages
    }
}
