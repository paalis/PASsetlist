import SwiftUI
import PDFKit
import PencilKit

/// Én side i scenemodus (en PDF-side, et bilde eller en tekstfil).
struct PerformancePage: Identifiable, Hashable {
    let id: String
    let number: Int
    let title: String
    let next: String?
    let attachment: Attachment
    let pageIndex: Int
}

enum PenTool: String, CaseIterable, Identifiable {
    case pen, marker, eraser
    var id: Self { self }

    var icon: String {
        switch self {
        case .pen: return "pencil.tip"
        case .marker: return "highlighter"
        case .eraser: return "eraser"
        }
    }

    var pkTool: PKTool {
        switch self {
        case .pen: return PKInkingTool(.pen, color: .systemRed, width: 3)
        case .marker: return PKInkingTool(.marker, color: UIColor.systemYellow.withAlphaComponent(0.6), width: 22)
        case .eraser: return PKEraserTool(.vector)
        }
    }
}

/// Fullskjerm med alle noter i setlistens rekkefølge.
/// Bla med sveip, trykk i kantene eller en Bluetooth-pedal (piltaster, mellomrom, Page Up/Down).
struct PerformanceView: View {
    let setlist: Setlist

    @Environment(\.dismiss) private var dismiss
    @State private var pages: [PerformancePage] = []
    @State private var current = 0
    @State private var penOn = false
    @State private var tool: PenTool = .pen
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if pages.isEmpty {
                ContentUnavailableView(
                    "Ingen noter",
                    systemImage: "music.note",
                    description: Text("Legg til PDF, bilder eller tekst på låtene først.")
                )
            } else if pages.indices.contains(current) {
                PageView(page: pages[current], penOn: penOn, tool: tool)
                    .id(pages[current].id)
                    .transition(.opacity)
                    .overlay {
                        if !penOn {
                            HStack(spacing: 0) {
                                Color.clear.contentShape(Rectangle()).onTapGesture { go(-1) }
                                Color.clear.allowsHitTesting(false)
                                Color.clear.contentShape(Rectangle()).onTapGesture { go(1) }
                            }
                        }
                    }
                    .gesture(
                        DragGesture(minimumDistance: 40).onEnded { value in
                            if value.translation.width < -60 { go(1) }
                            if value.translation.width > 60 { go(-1) }
                        },
                        including: penOn ? .subviews : .all
                    )
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) { header }
        .focusable()
        .focused($focused)
        .onKeyPress(keys: [.rightArrow, .downArrow, .space, .pageDown]) { _ in
            go(1)
            return .handled
        }
        .onKeyPress(keys: [.leftArrow, .upArrow, .pageUp]) { _ in
            go(-1)
            return .handled
        }
        .onAppear {
            pages = Self.pages(for: setlist)
            focused = true
            UIApplication.shared.isIdleTimerDisabled = true
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
        }
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
    }

    private var header: some View {
        HStack(spacing: 16) {
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.title3.bold())
            }

            if pages.indices.contains(current) {
                let page = pages[current]
                VStack(alignment: .leading, spacing: 0) {
                    Text("\(page.number). \(page.title)")
                        .font(.title2.bold())
                        .lineLimit(1)
                    if let next = page.next {
                        Text("Neste: \(next)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Spacer()

            if penOn {
                Picker("Verktøy", selection: $tool) {
                    ForEach(PenTool.allCases) { Image(systemName: $0.icon).tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(width: 160)
            }

            Button {
                penOn.toggle()
                focused = true
            } label: {
                Image(systemName: penOn ? "pencil.circle.fill" : "pencil.circle")
                    .font(.title)
            }
            .foregroundStyle(penOn ? Color.pink : Color.white)
            .accessibilityLabel(penOn ? "Slå av Pencil-notater" : "Skriv med Apple Pencil")

            if !pages.isEmpty {
                Text("\(current + 1)/\(pages.count)")
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }

    private func go(_ delta: Int) {
        guard !pages.isEmpty else { return }
        withAnimation(.easeInOut(duration: 0.15)) {
            current = min(max(0, current + delta), pages.count - 1)
        }
    }

    static func pages(for setlist: Setlist) -> [PerformancePage] {
        let numbers = setlist.numbers
        var result: [PerformancePage] = []
        for item in setlist.items where !item.isBreak {
            let next = setlist.nextSongTitle(after: item.id)
            for attachment in item.attachments {
                let count: Int
                if attachment.kind == .pdf {
                    count = PDFDocument(url: Store.fileURL(attachment))?.pageCount ?? 0
                } else {
                    count = 1
                }
                for index in 0..<count {
                    result.append(PerformancePage(
                        id: "\(attachment.id.uuidString)-\(index)",
                        number: numbers[item.id] ?? 0,
                        title: item.title,
                        next: next,
                        attachment: attachment,
                        pageIndex: index
                    ))
                }
            }
        }
        return result
    }
}

/// Viser én side med Pencil-lag oppå.
struct PageView: View {
    let page: PerformancePage
    let penOn: Bool
    let tool: PenTool

    @State private var image: UIImage?
    @State private var text: String?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .overlay {
                        DrawingCanvas(attachment: page.attachment, pageIndex: page.pageIndex, penOn: penOn, tool: tool)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let text {
                ScrollView {
                    Text(text)
                        .font(.system(.title3, design: .monospaced))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(32)
                }
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: page.id) {
            let url = Store.fileURL(page.attachment)
            switch page.attachment.kind {
            case .pdf:
                let index = page.pageIndex
                image = await Task.detached { PageRenderer.pdfPage(url: url, index: index) }.value
            case .image:
                image = UIImage(contentsOfFile: url.path)
            case .text:
                text = Store.readText(url)
            }
        }
    }
}

enum PageRenderer {
    /// Tegner en PDF-side som bilde i høy oppløsning.
    static func pdfPage(url: URL, index: Int, width: CGFloat = 2200) -> UIImage? {
        guard let document = PDFDocument(url: url), let page = document.page(at: index) else { return nil }
        var size = page.bounds(for: .mediaBox).size
        if page.rotation % 180 != 0 { size = CGSize(width: size.height, height: size.width) }
        guard size.width > 0 else { return nil }
        let scale = width / size.width
        return page.thumbnail(of: CGSize(width: size.width * scale, height: size.height * scale), for: .mediaBox)
    }
}

/// PencilKit-lerret over en side. Fingeren blar, pennen skriver (når Pencil-modus er på).
struct DrawingCanvas: UIViewRepresentable {
    let attachment: Attachment
    let pageIndex: Int
    let penOn: Bool
    let tool: PenTool

    func makeCoordinator() -> Coordinator {
        Coordinator(attachment: attachment, pageIndex: pageIndex)
    }

    func makeUIView(context: Context) -> SizedCanvas {
        let canvas = SizedCanvas()
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.overrideUserInterfaceStyle = .light // fargene skal se ut som på papir
        canvas.drawingPolicy = .pencilOnly
        canvas.isScrollEnabled = false
        let coordinator = context.coordinator
        canvas.delegate = coordinator
        canvas.onWidthChange = { [weak canvas, weak coordinator] width in
            guard let canvas, let coordinator else { return }
            coordinator.resize(canvas, to: width)
        }
        return canvas
    }

    func updateUIView(_ canvas: SizedCanvas, context: Context) {
        canvas.isUserInteractionEnabled = penOn
        canvas.tool = tool.pkTool
    }

    final class Coordinator: NSObject, PKCanvasViewDelegate {
        let attachment: Attachment
        let pageIndex: Int
        private var width: CGFloat = 0
        private var loaded = false
        private var applying = false

        init(attachment: Attachment, pageIndex: Int) {
            self.attachment = attachment
            self.pageIndex = pageIndex
        }

        func resize(_ canvas: PKCanvasView, to newWidth: CGFloat) {
            applying = true
            defer { applying = false }
            if !loaded {
                loaded = true
                canvas.drawing = Store.drawing(attachment, page: pageIndex, width: newWidth) ?? PKDrawing()
            } else if width > 0 {
                let scale = newWidth / width
                canvas.drawing = canvas.drawing.transformed(using: CGAffineTransform(scaleX: scale, y: scale))
            }
            width = newWidth
        }

        func canvasViewDrawingDidChange(_ canvas: PKCanvasView) {
            guard !applying, loaded, width > 0 else { return }
            Store.saveDrawing(canvas.drawing, width: width, attachment: attachment, page: pageIndex)
        }
    }
}

/// PKCanvasView som sier fra når bredden endres (rotasjon, ny sidestørrelse).
final class SizedCanvas: PKCanvasView {
    var onWidthChange: ((CGFloat) -> Void)?
    private var lastWidth: CGFloat = 0

    override func layoutSubviews() {
        super.layoutSubviews()
        if bounds.width > 0, bounds.width != lastWidth {
            lastWidth = bounds.width
            onWidthChange?(bounds.width)
        }
    }
}
