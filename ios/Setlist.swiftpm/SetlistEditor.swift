import SwiftUI
import PhotosUI

@MainActor
struct SetlistEditor: View {
    @Binding var setlist: Setlist
    @EnvironmentObject private var store: Store
    @Environment(\.horizontalSizeClass) private var sizeClass

    @State private var editMode: EditMode = .inactive
    @State private var filesFor: ItemRef?
    @State private var performFrom: StageStart?
    @State private var showingPrint = false
    @State private var showingAdd = false
    @State private var songbookURL: URL?
    @State private var makingBook = false
    @State private var toast: String?
    @State private var infoOpen = false
    @State private var coverImage: UIImage?
    @State private var coverMenu = false
    @State private var pickingCover = false
    @State private var coverPick: PhotosPickerItem?

    struct ItemRef: Identifiable { let id: String }
    struct StageStart: Identifiable { let id = UUID(); let itemID: String? }

    var body: some View {
        trackList
        .background(Theme.bg)
        .environment(\.editMode, $editMode)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    withAnimation { editMode = editMode.isEditing ? .inactive : .active }
                } label: {
                    Label(editMode.isEditing ? "Ferdig" : "Sorter", systemImage: "arrow.up.arrow.down")
                }
            }
        }
        .toolbarBackground(Theme.bg, for: .navigationBar)
        .sheet(item: $filesFor) { ref in
            if let i = setlist.items.firstIndex(where: { $0.id == ref.id }) {
                AttachmentsSheet(item: $setlist.items[i], onStartHere: {
                    filesFor = nil
                    let id = ref.id
                    Task {
                        try? await Task.sleep(nanoseconds: 450_000_000) // la arket lukke seg først
                        performFrom = StageStart(itemID: id)
                    }
                })
                .environmentObject(store)
            }
        }
        .fullScreenCover(item: $performFrom) { start in
            PerformanceView(setlist: setlist, startItemID: start.itemID).environmentObject(store)
        }
        .sheet(isPresented: $showingPrint) { PrintSheet(setlist: setlist) }
        .sheet(isPresented: $showingAdd) { NewSetlistSheet(target: $setlist) }
        .sheet(item: Binding(get: { songbookURL.map { URLItem(url: $0) } }, set: { songbookURL = $0?.url })) { item in
            PDFPreview(url: item.url, title: "Notehefte")
        }
        .task(id: setlist.coverFile?.id) { await loadCover() }
        .onChange(of: coverPick) { _, pick in
            guard let pick else { return }
            Task {
                if let data = try? await pick.loadTransferable(type: Data.self) { setCover(data) }
                else { show("Klarte ikke å hente bildet.") }
                coverPick = nil
            }
        }
        .overlay(alignment: .bottom) {
            if let toast {
                Text(toast).font(.subheadline.bold()).foregroundStyle(.black)
                    .padding(.horizontal, 18).padding(.vertical, 11)
                    .background(Color(hex: 0xF6F3EF), in: Capsule())
                    .padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }

    private func show(_ message: String) {
        withAnimation { toast = message }
        Task {
            try? await Task.sleep(nanoseconds: 2_800_000_000)
            withAnimation { if toast == message { toast = nil } }
        }
    }

    // MARK: - Venstre: vinyl, infotabell og knapper

    // MARK: - Info (folder ut under tittelen)

    /// «Info»-knapp med kort oppsummering; folder ut dato, sted, låter, spilletid, åpningslåt, noter og notater.
    private var infoSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { infoOpen.toggle() }
            } label: {
                HStack(spacing: 12) {
                    Eyebrow(text: "Info")
                    Text(infoSummary).font(.system(size: 14)).foregroundStyle(Theme.muted).lineLimit(1)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
                        .rotationEffect(.degrees(infoOpen ? 180 : 0))
                }
                .padding(.horizontal, 14).frame(minHeight: 48)
                .background(Color.white.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.line))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(infoOpen ? "Skjul info" : "Vis info")

            if infoOpen {
                infoTable.padding(.top, 6).transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    private var infoSummary: String {
        let date = setlist.dateValue.map { $0.formatted(.dateTime.day().month(.abbreviated).year()) } ?? ""
        return [date, setlist.venue, "\(setlist.songCount) låter"].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var vinylLabel: (big: String, small: String) {
        let parts = setlist.date.split(separator: "-")
        let months = ["JAN", "FEB", "MAR", "APR", "MAI", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DES"]
        if parts.count == 3, let m = Int(parts[1]), let d = Int(parts[2]), (1...12).contains(m) { return ("\(d)", months[m - 1]) }
        return (String((setlist.name.trimmed.first ?? "S")).uppercased(), "SETLIST")
    }

    private var infoTable: some View {
        VStack(spacing: 0) {
            specRow("Dato") {
                HStack {
                    if setlist.dateValue != nil {
                        DatePicker("", selection: dateBinding, displayedComponents: .date).labelsHidden()
                        Button { setlist.date = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.faint) }
                            .buttonStyle(.plain)
                    } else {
                        Button("Legg til dato") { setlist.date = Setlist.dayFormatter.string(from: Date()) }
                            .foregroundStyle(Theme.muted)
                    }
                }
            }
            specRow("Sted") {
                TextField("Legg til sted", text: $setlist.venue).multilineTextAlignment(.trailing)
            }
            specRow("Låter") { Text("\(setlist.songCount)") }
            specRow("Spilletid") { Text(setlist.totalMs > 0 ? formatTotal(setlist.totalMs) : "–") }
            specRow("Åpner med") { Text(setlist.songs.first?.title ?? "–").lineLimit(1) }
            specRow("Noter") {
                let files = setlist.songs.reduce(0) { $0 + $1.files.count }
                let with = setlist.songs.filter { !$0.files.isEmpty }.count
                Text(files > 0 ? "\(files) filer · \(with)/\(setlist.songCount) låter" : "Ingen ennå")
            }
            VStack(alignment: .leading, spacing: 8) {
                Eyebrow(text: "Notater", color: Theme.muted)
                TextField("Generelle notater", text: $setlist.notes, axis: .vertical)
                    .lineLimit(2...6)
                    .padding(10)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.border))
            }
            .padding(.top, 16)
        }
        .font(.system(size: 15))
    }

    private func specRow<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        HStack {
            Eyebrow(text: label, color: Theme.muted)
            Spacer(minLength: 12)
            content().foregroundStyle(Theme.text)
        }
        .frame(minHeight: 46)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private var dateBinding: Binding<Date> {
        Binding(get: { setlist.dateValue ?? Date() },
                set: { setlist.date = Setlist.dayFormatter.string(from: $0) })
    }

    /// Knappene over setlist-tittelen: på én rad når det er plass, ellers to.
    private var actions: some View {
        let stage = Button("▶ Scenemodus") { openStage() }.buttonStyle(PillButtonStyle(kind: .squarePrimary))
        let book = Button(makingBook ? "Lager …" : "Notehefte") { makeSongbook() }.disabled(makingBook).buttonStyle(PillButtonStyle(kind: .square))
        let printBtn = Button("Skriv ut") { showingPrint = true }.buttonStyle(PillButtonStyle(kind: .square))
        let copy = Button("Kopier tekst") { copyText() }.buttonStyle(PillButtonStyle(kind: .square))
        let spotify = Button("＋ Fra Spotify") { showingAdd = true }.buttonStyle(PillButtonStyle(kind: .square))
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                stage.frame(minWidth: 170)
                book.fixedSize()
                printBtn.fixedSize()
                copy.fixedSize()
                spotify.fixedSize()
            }
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    stage
                    book
                    printBtn
                }
                HStack(spacing: 8) {
                    copy
                    spotify
                }
            }
        }
    }

    // MARK: - Høyre: tittel og låtliste

    private var trackList: some View {
        let numbers = setlist.numbers
        return List {
            Section {
                actions
                    .padding(.top, 8)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)

                // Vinylplaten til venstre for tittelen, som et albumcover
                HStack(alignment: .center, spacing: sizeClass == .regular ? 28 : 16) {
                    Button { coverMenu = true } label: {
                        Vinyl(size: sizeClass == .regular ? 150 : 96, spinning: true, coverURL: setlist.cover, coverImage: coverImage, label: vinylLabel)
                    }
                    .buttonStyle(.plain)
                    .padding(.vertical, 6)
                    .accessibilityLabel("Vinylbilde")
                    .accessibilityHint("Velg eller fjern bilde i vinylen")
                    .confirmationDialog("Bilde i vinylen", isPresented: $coverMenu, titleVisibility: .visible) {
                        Button("Velg bilde …") { pickingCover = true }
                        if setlist.coverFile != nil {
                            Button("Fjern bilde", role: .destructive) { removeCover() }
                        }
                    } message: {
                        Text(setlist.cover.isEmpty ? "Bildet vises midt på vinylplaten." : "Bildet vises i stedet for Spotify-coveret.")
                    }
                    .photosPicker(isPresented: $pickingCover, selection: $coverPick, matching: .images)
                    VStack(alignment: .leading, spacing: 6) {
                        Eyebrow(text: "Setlist")
                        PosterTitleField(text: $setlist.name)
                        (Text("\(setlist.songCount)").bold() + Text(" låter").foregroundColor(Theme.muted)
                            + Text(setlist.totalMs > 0 ? " · " : "").foregroundColor(Theme.muted)
                            + Text(setlist.totalMs > 0 ? formatTotal(setlist.totalMs) : "").bold())
                            .font(.system(size: 14))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)

                infoSection
                    .frame(maxWidth: sizeClass == .regular ? 560 : .infinity, alignment: .leading)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            Section {
                ForEach($setlist.items) { $item in
                    ItemRow(item: $item, number: numbers[item.id]) { filesFor = ItemRef(id: item.id) }
                        .contextMenu {
                            if !item.isBreak {
                                Button { startHere(item) } label: { Label("Start scenemodus herfra", systemImage: "play.fill") }
                                    .disabled(item.files.isEmpty)
                                Button { filesFor = ItemRef(id: item.id) } label: { Label("Tekst og noter", systemImage: "music.note") }
                            }
                        }
                        .listRowBackground(item.isBreak ? Theme.accent.opacity(0.08) : Color.clear)
                        .listRowSeparatorTint(Theme.line)
                }
                .onMove { setlist.items.move(fromOffsets: $0, toOffset: $1) }
                .onDelete { offsets in
                    let removed = offsets.flatMap { setlist.items[$0].files }
                    setlist.items.remove(atOffsets: offsets)
                    store.cleanupFiles(removed)
                }

                HStack(spacing: 10) {
                    Button("＋ Legg til låt") { setlist.items.append(SetlistItem()) }
                    Button("＋ Pause / sett-skille") { setlist.items.append(.pause()) }
                }
                .buttonStyle(PillButtonStyle(kind: .outline))
                .controlSize(.small)
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .padding(.top, 8)
            } footer: {
                Text("Trykk «Sorter» for å dra låtene i ny rekkefølge. Sveip mot venstre for å slette.")
                    .foregroundStyle(Theme.faint)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    // MARK: - Handlinger

    private func openStage() {
        guard setlist.songs.contains(where: { !$0.files.isEmpty }) else {
            show("Ingen låter har noter ennå – trykk på notesymbolet på en låt.")
            return
        }
        performFrom = StageStart(itemID: nil)
    }

    // MARK: - Bilde i vinylen

    private func loadCover() async {
        guard let ref = setlist.coverFile else { coverImage = nil; return }
        if let url = try? await store.ensureFile(ref) { coverImage = UIImage(contentsOfFile: url.path) }
    }

    /// Beskjærer til kvadrat (maks 800 px), lagrer som fil og deler den med bandet.
    private func setCover(_ data: Data) {
        guard let image = UIImage(data: data) else { show("Klarte ikke å lese bildet."); return }
        let side = min(image.size.width, image.size.height)
        let out = min(800, side)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let square = UIGraphicsImageRenderer(size: CGSize(width: out, height: out), format: format).image { _ in
            let k = out / side
            image.draw(in: CGRect(x: -(image.size.width - side) / 2 * k, y: -(image.size.height - side) / 2 * k,
                                  width: image.size.width * k, height: image.size.height * k))
        }
        guard let jpeg = square.jpegData(compressionQuality: 0.85) else { return }
        do {
            let old = setlist.coverFile
            let ref = try store.addFile(data: jpeg, name: "vinyl.jpg", type: "image/jpeg")
            setlist.coverFile = ref
            coverImage = square
            if let old { store.cleanupFiles([old]) }
        } catch {
            show(error.localizedDescription)
        }
    }

    private func removeCover() {
        guard let old = setlist.coverFile else { return }
        setlist.coverFile = nil
        coverImage = nil
        store.cleanupFiles([old])
    }

    private func startHere(_ item: SetlistItem) {
        guard !item.files.isEmpty else {
            show("«\(item.title)» har ingen noter ennå – trykk på notesymbolet for å legge til.")
            return
        }
        performFrom = StageStart(itemID: item.id)
    }

    private func makeSongbook() {
        guard setlist.songs.contains(where: { !$0.files.isEmpty }) else {
            show("Ingen låter har filer ennå.")
            return
        }
        makingBook = true
        Task {
            do {
                songbookURL = try await Songbook.make(for: setlist, store: store)
            } catch {
                show("Klarte ikke å lage notehefte: \(error.localizedDescription)")
            }
            makingBook = false
        }
    }

    private func copyText() {
        var lines = [setlist.name.isEmpty ? "Setlist" : setlist.name]
        let sub = [setlist.date, setlist.venue].filter { !$0.isEmpty }.joined(separator: " · ")
        if !sub.isEmpty { lines.append(sub) }
        lines.append("")
        var n = 0
        for i in setlist.items {
            if i.isBreak { lines.append("— \(i.title.isEmpty ? "Pause" : i.title) —"); continue }
            n += 1
            var line = "\(n). \(i.title)"
            if !i.artist.isEmpty { line += " – \(i.artist)" }
            if !i.key.isEmpty { line += " [\(i.key)]" }
            if !i.notes.isEmpty { line += " (\(i.notes))" }
            lines.append(line)
        }
        UIPasteboard.general.string = lines.joined(separator: "\n")
        show("Kopiert til utklippstavlen")
    }
}

struct URLItem: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

/// Setlistnavnet i plakatstil. Trykk for å redigere (lagres slik det skrives).
struct PosterTitleField: View {
    @Binding var text: String
    @FocusState private var focused: Bool

    var body: some View {
        ZStack(alignment: .leading) {
            TextField("Navn på setlisten", text: $text)
                .font(Theme.poster(48))
                .foregroundStyle(Theme.text)
                .focused($focused)
                .opacity(focused ? 1 : 0.011)
            if !focused {
                PosterText(text: text.isEmpty ? "Uten navn" : text, size: 48)
                    .lineLimit(2)
                    .allowsHitTesting(false)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { focused = true }
    }
}

/* ---------- Én rad i låtlisten ---------- */

struct ItemRow: View {
    @Binding var item: SetlistItem
    let number: Int?
    let onFiles: () -> Void

    var body: some View {
        if item.isBreak {
            HStack {
                Text("—").font(.system(size: 17, weight: .heavy)).foregroundStyle(Theme.accent).frame(width: 34, alignment: .trailing)
                TextField("PAUSE", text: $item.title)
                    .font(.system(size: 13, weight: .bold)).tracking(3)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Theme.accent)
                DurationField(ms: $item.durationMs).frame(width: 60)
            }
            .padding(.vertical, 4)
        } else {
            HStack(spacing: 12) {
                Text(number.map { "\($0)" } ?? "")
                    .font(.system(size: 18, weight: .heavy).monospacedDigit())
                    .foregroundStyle(Theme.accent)
                    .frame(width: 34, alignment: .trailing)

                VStack(alignment: .leading, spacing: 4) {
                    TextField("Tittel", text: $item.title).font(.system(size: 16, weight: .semibold))
                    HStack {
                        TextField("Artist", text: $item.artist)
                        TextField("Notat", text: $item.notes)
                    }
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.muted)
                }

                TextField("Tone", text: $item.key)
                    .font(.system(size: 16, weight: .bold))
                    .multilineTextAlignment(.center)
                    .frame(width: 56)

                DurationField(ms: $item.durationMs).frame(width: 56)

                Button(action: onFiles) {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "music.note")
                            .font(.system(size: 16))
                            .frame(width: 38, height: 36)
                            .foregroundStyle(item.files.isEmpty ? Theme.faint : Theme.accent)
                            .background(item.files.isEmpty ? Color.clear : Theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                        if !item.files.isEmpty {
                            Text("\(item.files.count)").font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
                                .frame(minWidth: 15, minHeight: 15).background(Theme.accent, in: Capsule())
                                .offset(x: 4, y: -4)
                        }
                    }
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Tekst og noter")
            }
            .padding(.vertical, 4)
        }
    }
}

/// Tekstfelt for varighet i formatet m:ss (lagres i millisekunder, som på nettsiden).
struct DurationField: View {
    @Binding var ms: Int
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField("m:ss", text: $text)
            .keyboardType(.numbersAndPunctuation)
            .multilineTextAlignment(.trailing)
            .font(.system(size: 15).monospacedDigit())
            .foregroundStyle(Theme.muted)
            .focused($focused)
            .onAppear { text = formatDuration(ms) }
            .onChange(of: focused) { _, isFocused in
                if !isFocused {
                    if let parsed = parseDuration(text) { ms = parsed }
                    text = formatDuration(ms)
                }
            }
            .onChange(of: ms) { _, newValue in
                if !focused { text = formatDuration(newValue) }
            }
    }
}
