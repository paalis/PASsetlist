import SwiftUI

struct SetlistEditor: View {
    @Binding var setlist: Setlist
    @EnvironmentObject private var store: Store

    @State private var editMode: EditMode = .inactive
    @State private var filesFor: ItemRef?
    @State private var performing = false
    @State private var songbookURL: URL?
    @State private var showingSongbook = false
    @State private var errorMessage: String?

    struct ItemRef: Identifiable {
        let id: UUID
    }

    var body: some View {
        let numbers = setlist.numbers

        List {
            Section {
                TextField("Navn på setlisten", text: $setlist.name)
                    .font(.largeTitle.bold())
                Toggle("Dato", isOn: hasDate)
                if setlist.date != nil {
                    DatePicker("Når", selection: dateValue, displayedComponents: .date)
                }
                TextField("Sted", text: $setlist.venue)
                TextField("Notater", text: $setlist.notes, axis: .vertical)
            } footer: {
                Text("\(setlist.songCount) låter · \(formatTotal(setlist.totalDuration))")
                    .font(.headline)
            }

            Section {
                ForEach($setlist.items) { $item in
                    ItemRow(item: $item, number: numbers[item.id]) {
                        filesFor = ItemRef(id: item.id)
                    }
                }
                .onMove { setlist.items.move(fromOffsets: $0, toOffset: $1) }
                .onDelete { offsets in
                    setlist.items.remove(atOffsets: offsets)
                    store.removeUnusedFiles()
                }

                Button {
                    setlist.items.append(SetlistItem())
                } label: {
                    Label("Legg til låt", systemImage: "plus")
                }
                Button {
                    setlist.items.append(SetlistItem(isBreak: true, title: "Pause"))
                } label: {
                    Label("Pause / sett-skille", systemImage: "pause.circle")
                }
            } header: {
                Text("Låter")
            } footer: {
                Text("Trykk «Sorter» for å dra låtene i ny rekkefølge. Sveip mot venstre for å slette.")
            }
        }
        .environment(\.editMode, $editMode)
        .navigationTitle(setlist.name.isEmpty ? "Setlist" : setlist.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    withAnimation { editMode = editMode.isEditing ? .inactive : .active }
                } label: {
                    Label(editMode.isEditing ? "Ferdig" : "Sorter", systemImage: "arrow.up.arrow.down")
                }
                Button {
                    makeSongbook()
                } label: {
                    Label("Notehefte", systemImage: "book")
                }
                Button {
                    performing = true
                } label: {
                    Label("Spill", systemImage: "play.fill")
                }
            }
        }
        .sheet(item: $filesFor) { ref in
            if let index = setlist.items.firstIndex(where: { $0.id == ref.id }) {
                AttachmentsSheet(item: $setlist.items[index])
                    .environmentObject(store)
            }
        }
        .fullScreenCover(isPresented: $performing) {
            PerformanceView(setlist: setlist)
        }
        .sheet(isPresented: $showingSongbook) {
            if let songbookURL {
                SongbookPreview(url: songbookURL)
            }
        }
        .alert("Noe gikk galt", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var hasDate: Binding<Bool> {
        Binding(
            get: { setlist.date != nil },
            set: { setlist.date = $0 ? (setlist.date ?? Date()) : nil }
        )
    }

    private var dateValue: Binding<Date> {
        Binding(get: { setlist.date ?? Date() }, set: { setlist.date = $0 })
    }

    private func makeSongbook() {
        guard setlist.items.contains(where: { !$0.attachments.isEmpty }) else {
            errorMessage = "Ingen låter har filer ennå. Trykk på notesymbolet på en låt for å legge til tekst eller noter."
            return
        }
        do {
            songbookURL = try Songbook.make(for: setlist)
            showingSongbook = true
        } catch {
            errorMessage = "Klarte ikke å lage notehefte: \(error.localizedDescription)"
        }
    }
}

struct ItemRow: View {
    @Binding var item: SetlistItem
    let number: Int?
    let onFiles: () -> Void

    var body: some View {
        if item.isBreak {
            HStack {
                Image(systemName: "pause.circle.fill")
                    .foregroundStyle(.pink)
                TextField("Pause", text: $item.title)
                    .font(.headline)
                    .foregroundStyle(.pink)
                DurationField(seconds: $item.duration)
                    .frame(width: 64)
            }
            .listRowBackground(Color.pink.opacity(0.12))
        } else {
            HStack(spacing: 12) {
                Text(number.map { "\($0)" } ?? "")
                    .font(.title3.bold().monospacedDigit())
                    .foregroundStyle(.pink)
                    .frame(width: 34, alignment: .trailing)

                VStack(alignment: .leading, spacing: 4) {
                    TextField("Tittel", text: $item.title)
                        .font(.headline)
                    HStack {
                        TextField("Artist", text: $item.artist)
                        TextField("Notat", text: $item.notes)
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }

                TextField("Tone", text: $item.key)
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .frame(width: 56)

                DurationField(seconds: $item.duration)
                    .frame(width: 56)

                Button(action: onFiles) {
                    HStack(spacing: 3) {
                        Image(systemName: item.attachments.isEmpty ? "music.note" : "music.note.list")
                        if !item.attachments.isEmpty {
                            Text("\(item.attachments.count)").font(.caption.bold())
                        }
                    }
                    .foregroundStyle(item.attachments.isEmpty ? Color.secondary : Color.pink)
                    .frame(minWidth: 40, minHeight: 36)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Tekst og noter")
            }
        }
    }
}

/// Tekstfelt for varighet i formatet m:ss.
struct DurationField: View {
    @Binding var seconds: Int
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField("m:ss", text: $text)
            .keyboardType(.numbersAndPunctuation)
            .multilineTextAlignment(.trailing)
            .font(.body.monospacedDigit())
            .foregroundStyle(.secondary)
            .focused($focused)
            .onAppear { text = formatDuration(seconds) }
            .onChange(of: focused) { _, isFocused in
                if !isFocused {
                    if let parsed = parseDuration(text) { seconds = parsed }
                    text = formatDuration(seconds)
                }
            }
            .onChange(of: seconds) { _, newValue in
                if !focused { text = formatDuration(newValue) }
            }
    }
}
