import SwiftUI

@MainActor
struct NewSetlistSheet: View {
    var target: Binding<Setlist>? = nil // satt = legg låter til en eksisterende setlist
    var onCreate: (Setlist) -> Void = { _ in }

    @Environment(\.dismiss) private var dismiss

    enum Source: String, CaseIterable, Identifiable {
        case spotify = "Spotify", text = "Tekst", empty = "Tom liste"
        var id: Self { self }
    }

    @State private var source: Source = .spotify
    @State private var link = ""
    @State private var text = ""
    @State private var name = ""
    @State private var loading = false
    @State private var errorMessage: String?

    private var sources: [Source] { target == nil ? Source.allCases : [.spotify, .text] }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Kilde", selection: $source) {
                    ForEach(sources) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)

                switch source {
                case .spotify:
                    Section {
                        TextField("https://open.spotify.com/playlist/…", text: $link)
                            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    } header: {
                        Text("Lenke til spilleliste eller album")
                    } footer: {
                        Text("I Spotify: ⋯ → Del → Kopier lenke. Listen må være offentlig. Krever nett.")
                    }
                case .text:
                    Section {
                        TextEditor(text: $text).frame(minHeight: 200).font(.body.monospaced())
                    } header: {
                        Text("Én låt per linje – «Artist - Tittel» eller bare tittel")
                    }
                case .empty:
                    EmptyView()
                }

                if target == nil {
                    Section {
                        TextField(source == .spotify ? "Navn (valgfritt – hentes fra Spotify)" : "F.eks. Julebord 14. desember", text: $name)
                    } header: { Text("Navn på setlisten") }
                }

                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(Theme.accent) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.surface)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    PosterText(text: target == nil ? "Opprett ny setlist" : "Legg til låter", size: 22)
                }
                ToolbarItem(placement: .cancellationAction) { Button("Avbryt") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if loading { ProgressView() } else {
                        Button(source == .spotify ? "Hent låter" : (target == nil ? "Opprett" : "Legg til")) {
                            Task { await create() }
                        }
                        .bold()
                    }
                }
            }
        }
    }

    @MainActor
    private func create() async {
        errorMessage = nil
        var items: [SetlistItem] = []
        var fetchedName = ""
        var cover = ""

        switch source {
        case .spotify:
            guard !link.trimmed.isEmpty else { errorMessage = "Lim inn en Spotify-lenke."; return }
            loading = true
            do {
                let result = try await Importer.fetchSpotify(link.trimmed)
                items = result.items
                fetchedName = result.name
                cover = result.cover
            } catch {
                loading = false
                errorMessage = error.localizedDescription + " Du kan også bruke «Tekst»."
                return
            }
            loading = false
        case .text:
            items = Importer.parseText(text)
            if items.isEmpty { errorMessage = "Skriv inn minst én låt."; return }
        case .empty:
            break
        }

        if let target {
            target.wrappedValue.items.append(contentsOf: items)
            if target.wrappedValue.cover.isEmpty && !cover.isEmpty { target.wrappedValue.cover = cover }
            if target.wrappedValue.spotifyUrl.isEmpty && source == .spotify { target.wrappedValue.spotifyUrl = link.trimmed }
        } else {
            var sl = Setlist(name: name.trimmed.isEmpty ? (fetchedName.isEmpty ? "Ny setlist" : fetchedName) : name.trimmed, items: items)
            if source == .spotify { sl.spotifyUrl = link.trimmed; sl.cover = cover }
            onCreate(sl)
        }
        dismiss()
    }
}
