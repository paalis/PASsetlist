import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: Store
    @State private var selection: UUID?
    @State private var showingNew = false

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                ForEach(store.setlists) { setlist in
                    NavigationLink(value: setlist.id) {
                        SetlistRow(setlist: setlist)
                    }
                    .swipeActions {
                        Button(role: .destructive) { delete(setlist.id) } label: {
                            Label("Slett", systemImage: "trash")
                        }
                    }
                    .contextMenu {
                        Button { store.duplicate(setlist.id) } label: {
                            Label("Dupliser", systemImage: "plus.square.on.square")
                        }
                        Button(role: .destructive) { delete(setlist.id) } label: {
                            Label("Slett", systemImage: "trash")
                        }
                    }
                }
            }
            .navigationTitle("Setlister")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showingNew = true } label: {
                        Label("Ny setlist", systemImage: "plus")
                    }
                }
            }
            .overlay {
                if store.setlists.isEmpty {
                    ContentUnavailableView(
                        "Scenen er tom",
                        systemImage: "music.note.list",
                        description: Text("Trykk + for å lage en setlist fra Spotify eller tekst.")
                    )
                }
            }
        } detail: {
            if let id = selection, store.setlists.contains(where: { $0.id == id }) {
                SetlistEditor(setlist: store.binding(for: id))
                    .id(id)
            } else {
                ContentUnavailableView("Velg en setlist", systemImage: "music.mic")
            }
        }
        .sheet(isPresented: $showingNew) {
            NewSetlistSheet { newSetlist in
                store.setlists.insert(newSetlist, at: 0)
                selection = newSetlist.id
            }
        }
    }

    private func delete(_ id: UUID) {
        if selection == id { selection = nil }
        store.setlists.removeAll { $0.id == id }
        store.removeUnusedFiles()
    }
}

struct SetlistRow: View {
    let setlist: Setlist

    var body: some View {
        HStack(spacing: 12) {
            if let date = setlist.date {
                VStack(spacing: 0) {
                    Text(date.formatted(.dateTime.day()))
                        .font(.title2.bold())
                        .foregroundStyle(.pink)
                    Text(date.formatted(.dateTime.month(.abbreviated)).uppercased())
                        .font(.caption2.bold())
                }
                .frame(width: 44)
            } else {
                Image(systemName: "opticaldisc")
                    .font(.title2)
                    .foregroundStyle(.pink)
                    .frame(width: 44)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(setlist.name.isEmpty ? "Uten navn" : setlist.name)
                    .font(.headline)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private var subtitle: String {
        var parts = ["\(setlist.songCount) låter"]
        if setlist.totalDuration > 0 { parts.append(formatTotal(setlist.totalDuration)) }
        if !setlist.venue.isEmpty { parts.append(setlist.venue) }
        return parts.joined(separator: " · ")
    }
}
