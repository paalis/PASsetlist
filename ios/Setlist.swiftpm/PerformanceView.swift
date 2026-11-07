import SwiftUI
import UIKit

/// Scenemodus: alle noter i setlistens rekkefølge i fullskjerm, med Pencil-notater
/// som deles med bandet (samme format som nettsiden).
///  - Apple Pencil tegner alltid. Fingeren blar (sveip eller trykk i venstre/høyre kant).
///  - «Tegn med finger» lar fingeren (og musen i simulatoren) tegne.
///  - Pedal/tastatur: → ↓ mellomrom = neste, ← ↑ = forrige.
@MainActor
struct PerformanceView: View {
    let setlist: Setlist
    var startItemID: String? = nil
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss

    @State private var pages: [NotePage] = []
    @State private var loadingText = "Henter noter …"
    @State private var current = 0
    @State private var strokes: [Stroke] = []
    @State private var loaded = false
    @State private var undo: [[Stroke]] = []
    @State private var tool = "pen"
    @State private var color = Ink.colors[0].hex
    @State private var fingerDraws = false
    @State private var drawingNow = false
    @State private var saveTask: Task<Void, Never>?
    @State private var pageImage: UIImage?
    @State private var hint: String?
    @State private var showingSongs = false
    @State private var backTo: Int?
    @State private var pencilSeen = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            header
            GeometryReader { geo in
                ZStack {
                    Color(hex: 0x050407)
                    if pages.indices.contains(current) {
                        let pg = pages[current]
                        let a = pg.source.aspect(pg.index)
                        let w = min(geo.size.width - 16, (geo.size.height - 16) * a)
                        let size = CGSize(width: w, height: w / a)
                        ZStack {
                            if let pageImage { Image(uiImage: pageImage).resizable() } else { Color.white }
                            InkCanvas(strokes: strokes, tool: tool, color: color, fingerDraws: fingerDraws, enabled: loaded,
                                      onStroke: commit, onErase: erase, onBegin: beginEdit, onDrawingChange: { drawingNow = $0 },
                                      onSwipe: { go($0) }, onTap: { x in if x < 0.3 { go(-1) } else if x > 0.7 { go(1) } else { toolHint() } },
                                      onPencil: { pencilSeen = true })
                        }
                        .frame(width: size.width, height: size.height)
                        .shadow(color: .black.opacity(0.6), radius: 20, y: 8)
                        .task(id: "\(pg.id)-\(Int(w))") { await renderPage(pg, width: w) }
                    } else {
                        Text(loadingText).foregroundStyle(Theme.muted)
                    }
                    HStack {
                        navButton("chevron.left", disabled: current == 0) { go(-1) }
                        Spacer()
                        navButton("chevron.right", disabled: current >= pages.count - 1) { go(1) }
                    }
                    .padding(.horizontal, 10)
                }
            }
        }
        .overlay(alignment: .topLeading) {
            if showingSongs {
                ZStack(alignment: .topLeading) {
                    Color.black.opacity(0.001).ignoresSafeArea() // trykk utenfor lukker
                        .onTapGesture { withAnimation { showingSongs = false } }
                    songList.padding(.top, 62).padding(.leading, 14)
                }
                .transition(.opacity)
            }
        }
        .overlay(alignment: .bottom) {
            if let backTo, pages.indices.contains(backTo) {
                let from = pages[backTo]
                Button { jumpBack() } label: {
                    Text("↩ Tilbake til \(from.song). \(from.title)").font(.subheadline.bold()).foregroundStyle(.black)
                        .padding(.horizontal, 18).padding(.vertical, 11)
                        .background(Color(hex: 0xF6F3EF), in: Capsule())
                }
                .buttonStyle(.plain)
                .padding(.bottom, hint == nil ? 28 : 84)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .overlay(alignment: .bottom) {
            if let hint {
                Text(hint).font(.subheadline.bold()).foregroundStyle(.black)
                    .padding(.horizontal, 18).padding(.vertical, 11)
                    .background(Color(hex: 0xF6F3EF), in: Capsule())
                    .padding(.bottom, 28)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .background(Color(hex: 0x050407))
        .preferredColorScheme(.dark)
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        .focusable()
        .focused($focused)
        .onKeyPress(keys: [.rightArrow, .downArrow, .space, .pageDown]) { _ in go(1); return .handled }
        .onKeyPress(keys: [.leftArrow, .upArrow, .pageUp]) { _ in go(-1); return .handled }
        .onKeyPress(.escape) {
            if showingSongs { withAnimation { showingSongs = false } } else { close() }
            return .handled
        }
        .task { await buildPages() }
        .task(id: current) { await pollRemote() }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true; focused = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }

    // MARK: - Toppfelt og verktøy

    private var header: some View {
        HStack(spacing: 12) {
            Button { close() } label: { Image(systemName: "xmark").font(.headline).frame(width: 40, height: 40) }
                .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 10))
            if pages.indices.contains(current) {
                let pg = pages[current]
                // Trykk på tittelen for å hoppe til en annen låt
                Button { withAnimation(.easeOut(duration: 0.15)) { showingSongs.toggle() } } label: {
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(spacing: 6) {
                            Text("\(pg.song). \(pg.title)".uppercased()).font(Theme.poster(22)).lineLimit(1)
                            Image(systemName: "chevron.down").font(.system(size: 12, weight: .bold))
                                .rotationEffect(.degrees(showingSongs ? 180 : 0))
                        }
                        Text(pg.next.map { "Neste: \($0)" } ?? "Siste låt").font(.system(size: 13)).foregroundStyle(Theme.muted).lineLimit(1)
                    }
                    .padding(.horizontal, 8).padding(.vertical, 2)
                    .background(showingSongs ? Theme.surface2 : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                    .foregroundStyle(Theme.text)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Vis alle låtene og hopp til en annen")
            }
            Spacer()
            HStack(spacing: 6) {
                Button {
                    fingerDraws.toggle()
                    showHint(fingerDraws ? "Tegning med finger/mus er på – bla med pilene eller piltastene." : "Fingeren blar igjen. Apple Pencil tegner alltid.")
                } label: {
                    Label("Tegn", systemImage: "hand.draw")
                        .font(.system(size: 13, weight: .bold)).textCase(.uppercase)
                        .padding(.horizontal, 12).frame(height: 40)
                        .background(fingerDraws ? Theme.accent.opacity(0.18) : Theme.surface2, in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(fingerDraws ? Theme.accent : Theme.border))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Tegn med finger")
                ForEach(Ink.colors, id: \.hex) { c in
                    toolButton(active: tool == "pen" && color == c.hex, label: "Penn \(c.name)") {
                        Circle().fill(Color(css: c.hex)).frame(width: 16, height: 16).overlay(Circle().stroke(.white.opacity(0.85), lineWidth: 2))
                    } action: { tool = "pen"; color = c.hex; toolHint() }
                }
                toolButton(active: tool == "marker", label: "Markør") {
                    Image(systemName: "highlighter").foregroundStyle(Color(hex: 0xFFD400))
                } action: { tool = "marker"; toolHint() }
                toolButton(active: tool == "eraser", label: "Viskelær") { Image(systemName: "eraser") } action: { tool = "eraser"; toolHint() }
                toolButton(active: false, label: "Angre") { Image(systemName: "arrow.uturn.backward") } action: { undoLast() }
            }
            Text(pages.isEmpty ? "" : "\(current + 1)/\(pages.count)")
                .font(.system(size: 14, weight: .bold).monospacedDigit()).foregroundStyle(Theme.muted).frame(minWidth: 48, alignment: .trailing)
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(Theme.surface.opacity(0.96))
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private func toolButton<L: View>(active: Bool, label: String, @ViewBuilder icon: () -> L, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            icon().frame(width: 40, height: 40)
                .background(active ? Theme.accent.opacity(0.18) : Theme.surface2, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(active ? Theme.accent : Theme.border))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func navButton(_ icon: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 28, weight: .semibold))
                .frame(width: 46, height: 72)
                .background(Color(hex: 0x141218, opacity: 0.55), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .opacity(disabled ? 0.12 : 0.6)
        .disabled(disabled)
    }

    // MARK: - Sider

    private func buildPages() async {
        let numbers = setlist.numbers
        let songs = setlist.items.filter { !$0.isBreak && !$0.files.isEmpty }
        let total = songs.reduce(0) { $0 + $1.files.count }
        var done = 0
        var result: [NotePage] = []
        for item in songs {
            for f in item.files {
                done += 1
                loadingText = "Henter noter … \(done)/\(total)"
                guard let url = try? await store.ensureFile(f), let source = PageSource(url: url, ref: f) else { continue }
                for i in 0..<source.pageCount {
                    result.append(NotePage(id: "\(f.id)_\(i)", itemID: item.id, song: numbers[item.id] ?? 0, title: item.title,
                                           next: setlist.nextSongTitle(after: item.id), file: f, index: i, source: source))
                }
            }
        }
        pages = result
        if pages.isEmpty { loadingText = "Ingen noter å vise (er filene lastet ned?)." }
        else {
            let start = startItemID.flatMap { id in pages.firstIndex { $0.itemID == id } } ?? 0
            await showPage(start)
        }
    }

    private func renderPage(_ pg: NotePage, width: CGFloat) async {
        let scale = UIScreen.main.scale
        pageImage = pg.source.render(pg.index, width: width * scale, song: pg.song, title: pg.title)
    }

    private func showPage(_ i: Int) async {
        flushSave()
        current = max(0, min(pages.count - 1, i))
        undo = []
        loaded = false
        pageImage = nil
        let pg = pages[current]
        strokes = store.localNotes(fileID: pg.file.id, page: pg.index)
        loaded = true
        if let remote = await store.refreshNotes(fileID: pg.file.id, page: pg.index), pages[current].id == pg.id, !drawingNow {
            strokes = remote
        }
    }

    private func go(_ delta: Int) {
        let to = current + delta
        guard to >= 0, to < pages.count, !drawingNow else { return }
        Task { await showPage(to) }
    }

    /// Henter endringer fra bandet jevnlig mens siden vises.
    private func pollRemote() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            guard !Task.isCancelled, pages.indices.contains(current), !drawingNow, saveTask == nil else { continue }
            let pg = pages[current]
            if let remote = await store.refreshNotes(fileID: pg.file.id, page: pg.index), pages[current].id == pg.id, !drawingNow {
                strokes = remote
            }
        }
    }

    // MARK: - Notater

    private func beginEdit() {
        undo.append(strokes)
        if undo.count > 50 { undo.removeFirst() }
    }

    private func commit(_ stroke: Stroke) {
        strokes.append(stroke)
        scheduleSave()
    }

    private func erase(_ remaining: [Stroke]) {
        guard remaining.count != strokes.count else { return }
        strokes = remaining
        scheduleSave()
    }

    private func undoLast() {
        guard let previous = undo.popLast() else { return }
        strokes = previous
        scheduleSave()
    }

    private func scheduleSave() {
        saveTask?.cancel()
        let pg = pages[current]
        let snapshot = strokes
        saveTask = Task {
            try? await Task.sleep(nanoseconds: 700_000_000)
            guard !Task.isCancelled else { return }
            store.saveNotes(snapshot, fileID: pg.file.id, page: pg.index)
            saveTask = nil
        }
    }

    private func flushSave() {
        guard let task = saveTask, pages.indices.contains(current) else { return }
        task.cancel()
        saveTask = nil
        let pg = pages[current]
        store.saveNotes(strokes, fileID: pg.file.id, page: pg.index)
    }

    // MARK: - Låtoversikt

    private var songList: some View {
        let numbers = setlist.numbers
        let currentItem = pages.indices.contains(current) ? pages[current].itemID : nil
        return VStack(alignment: .leading, spacing: 0) {
            Eyebrow(text: "Hopp til låt", color: Theme.muted).padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 6)
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 2) {
                        ForEach(setlist.items) { item in
                            if item.isBreak {
                                Text((item.title.isEmpty ? "Pause" : item.title).uppercased())
                                    .font(.system(size: 10.5, weight: .bold)).tracking(2.4).foregroundStyle(Theme.accent)
                                    .frame(maxWidth: .infinity).padding(.vertical, 6)
                                    .overlay(alignment: .top) { Rectangle().fill(Theme.accent.opacity(0.35)).frame(height: 1) }
                                    .overlay(alignment: .bottom) { Rectangle().fill(Theme.accent.opacity(0.35)).frame(height: 1) }
                                    .padding(.horizontal, 10).padding(.vertical, 4)
                            } else {
                                let has = pages.contains { $0.itemID == item.id }
                                let isCurrent = item.id == currentItem
                                Button { jump(to: item.id) } label: {
                                    HStack(spacing: 12) {
                                        Text("\(numbers[item.id] ?? 0)").font(.system(size: 16, weight: .heavy).monospacedDigit())
                                            .foregroundStyle(Theme.accent).frame(minWidth: 26, alignment: .trailing)
                                        Text(item.title.isEmpty ? "–" : item.title).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                                        Spacer(minLength: 8)
                                        if !item.key.isEmpty { Text(item.key).font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.muted) }
                                        if !has { Text("ingen noter").font(.system(size: 11)).foregroundStyle(Theme.muted) }
                                    }
                                    .foregroundStyle(Theme.text)
                                    .padding(.horizontal, 10).frame(minHeight: 46)
                                    .background(isCurrent ? Theme.accent.opacity(0.14) : Color.clear, in: RoundedRectangle(cornerRadius: 10))
                                    .overlay(alignment: .leading) { if isCurrent { Rectangle().fill(Theme.accent).frame(width: 3) } }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .disabled(!has)
                                .opacity(has ? 1 : 0.4)
                                .id(item.id)
                            }
                        }
                    }
                    .padding(.horizontal, 6).padding(.bottom, 8)
                }
                .onAppear { if let currentItem { proxy.scrollTo(currentItem, anchor: .center) } }
            }
        }
        .frame(width: 400, height: min(560, CGFloat(setlist.items.count) * 48 + 64))
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border))
        .shadow(color: .black.opacity(0.7), radius: 30, y: 16)
    }

    private func jump(to itemID: String) {
        guard let to = pages.firstIndex(where: { $0.itemID == itemID }) else { return }
        withAnimation { showingSongs = false }
        if pages[current].itemID != itemID {
            let from = current
            withAnimation { backTo = from }
            Task {
                try? await Task.sleep(nanoseconds: 7_000_000_000)
                withAnimation { if backTo == from { backTo = nil } }
            }
        }
        Task { await showPage(to) }
    }

    private func jumpBack() {
        guard let target = backTo else { return }
        withAnimation { backTo = nil }
        Task { await showPage(target) }
    }

    private func showHint(_ text: String) {
        withAnimation { hint = text }
        Task {
            try? await Task.sleep(nanoseconds: 3_200_000_000)
            withAnimation { if hint == text { hint = nil } }
        }
    }

    private func toolHint() {
        if !fingerDraws && !pencilSeen {
            showHint("Tegn med Apple Pencil – eller trykk «Tegn» for å tegne med fingeren/musen.")
        }
    }

    private func close() {
        flushSave()
        dismiss()
    }
}

/* ---------- Tegneflaten (UIKit for presis Pencil-håndtering) ---------- */

struct InkCanvas: UIViewRepresentable {
    var strokes: [Stroke]
    var tool: String
    var color: String
    var fingerDraws: Bool
    var enabled: Bool
    var onStroke: (Stroke) -> Void
    var onErase: ([Stroke]) -> Void
    var onBegin: () -> Void
    var onDrawingChange: (Bool) -> Void
    var onSwipe: (Int) -> Void
    var onTap: (CGFloat) -> Void
    var onPencil: () -> Void = {}

    func makeUIView(context: Context) -> InkView {
        let v = InkView()
        v.backgroundColor = .clear
        v.isMultipleTouchEnabled = false
        return v
    }

    func updateUIView(_ v: InkView, context: Context) {
        v.config = self
        if v.strokes != strokes { v.strokes = strokes; v.setNeedsDisplay() }
    }
}

final class InkView: UIView {
    var config: InkCanvas?
    var strokes: [Stroke] = []
    private var current: Stroke?
    private var erasing = false
    private var swipeStart: CGPoint?

    private func draws(_ touch: UITouch) -> Bool {
        guard let config, config.enabled else { return false }
        return touch.type == .pencil || config.fingerDraws
    }

    private func point(_ t: UITouch) -> [Double] {
        let p = t.location(in: self)
        let w = Double(max(1, bounds.width))
        let h = Double(max(1, bounds.height))
        let x: Double = min(1.0, max(0.0, Double(p.x) / w))
        let y: Double = min(1.0, max(0.0, Double(p.y) / h))
        var pressure: Double = 0.5
        if t.type == .pencil, t.maximumPossibleForce > 0 {
            let f = Double(t.force) / Double(t.maximumPossibleForce)
            pressure = min(1.0, max(0.05, f))
        }
        let rx: Double = (x * 10000).rounded() / 10000
        let ry: Double = (y * 10000).rounded() / 10000
        let rp: Double = (pressure * 100).rounded() / 100
        return [rx, ry, rp]
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = touches.first, let config else { return }
        if t.type == .pencil { config.onPencil() }
        if draws(t) {
            config.onBegin()
            config.onDrawingChange(true)
            if config.tool == "eraser" { erasing = true; eraseAt(t); return }
            current = config.tool == "marker"
                ? Stroke(t: "marker", c: Ink.markerColor, w: Ink.markerWidth, p: point(t))
                : Stroke(t: "pen", c: config.color, w: Ink.penWidth, p: point(t))
            setNeedsDisplay()
        } else {
            swipeStart = t.location(in: self)
        }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = touches.first else { return }
        if erasing { eraseAt(t); return }
        guard current != nil else { return }
        for c in event?.coalescedTouches(for: t) ?? [t] { current?.p.append(contentsOf: point(c)) }
        setNeedsDisplay()
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = touches.first, let config else { return }
        if erasing || current != nil {
            if let s = current { strokes.append(s); config.onStroke(s) }
            current = nil
            erasing = false
            config.onDrawingChange(false)
            setNeedsDisplay()
            return
        }
        if let start = swipeStart {
            let end = t.location(in: self)
            let dx = end.x - start.x, dy = end.y - start.y
            if abs(dx) > 50 && abs(dx) > abs(dy) { config.onSwipe(dx < 0 ? 1 : -1) }
            else if abs(dx) < 10 && abs(dy) < 10 { config.onTap(end.x / max(CGFloat(1), bounds.width)) }
        }
        swipeStart = nil
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        current = nil
        erasing = false
        swipeStart = nil
        config?.onDrawingChange(false)
        setNeedsDisplay()
    }

    private func eraseAt(_ t: UITouch) {
        let p = t.location(in: self)
        let W = Double(bounds.width), H = Double(bounds.height)
        let px = Double(p.x), py = Double(p.y)
        let keep = strokes.filter { st in
            var i = 0
            while i < st.p.count {
                let dx: Double = st.p[i] * W - px
                let dy: Double = st.p[i + 1] * H - py
                let limit: Double = 14 + st.w * W / 2
                if (dx * dx + dy * dy).squareRoot() < limit { return false }
                i += 3
            }
            return true
        }
        if keep.count != strokes.count {
            strokes = keep
            config?.onErase(keep)
            setNeedsDisplay()
        }
    }

    override func draw(_ rect: CGRect) {
        guard let ctx = UIGraphicsGetCurrentContext() else { return }
        Ink.draw(strokes, in: bounds, context: ctx)
        if let current { Ink.draw(current, in: bounds, context: ctx) }
    }
}
