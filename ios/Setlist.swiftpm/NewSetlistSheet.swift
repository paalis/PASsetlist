import SwiftUI

struct NewSetlistSheet: View {
    var onCreate: (Setlist) -> Void

    @Environment(\.dismiss) private var dismiss

    enum Source: String, CaseIterable, Identifiable {
        case spotify = "Spotify"
        case text = "Tekst"
        case empty = "Tom liste"
        var id: Self { self }
    }

    @State private var source: Source = .spotify
    @State private var link = ""
    @State private var text = ""
    @State private var name = ""
    @State private var loading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Picker("Kilde", selection: $source) {
                    ForEach(Source.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)

                switch source {
                case .spotify:
                    Section {
                        TextField("https://open.spotify.com/playlist/…", text: $link)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    } header: {
                        Text("Lenke til spilleliste eller album")
                    } footer: {
                        Text("I Spotify: ⋯ → Del → Kopier lenke. Listen må være offentlig. Krever nett.")
                    }
                case .text:
                    Section {
                        TextEditor(text: $text)
                            .frame(minHeight: 200)
                            .font(.body.monospaced())
                    } header: {
                        Text("Én låt per linje – «Artist - Tittel» eller bare tittel")
                    }
                case .empty:
                    EmptyView()
                }

                Section {
                    TextField(source == .spotify ? "Navn (valgfritt – hentes fra Spotify)" : "Navn på setlisten", text: $name)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Ny setlist")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Avbryt") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if loading {
                        ProgressView()
                    } else {
                        Button(source == .spotify ? "Hent låter" : "Opprett") {
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
        var setlist = Setlist()

        switch source {
        case .spotify:
            guard !link.trimmed.isEmpty else {
                errorMessage = "Lim inn en Spotify-lenke."
                return
            }
            loading = true
            do {
                let result = try await Importer.fetchSpotify(link.trimmed)
                setlist.items = result.items
                if !result.name.isEmpty { setlist.name = result.name }
            } catch {
                loading = false
                errorMessage = error.localizedDescription + " Du kan også bruke «Tekst»."
                return
            }
            loading = false
        case .text:
            setlist.items = Importer.parseText(text)
            if setlist.items.isEmpty {
                errorMessage = "Skriv inn minst én låt."
                return
            }
        case .empty:
            break
        }

        if !name.trimmed.isEmpty { setlist.name = name.trimmed }
        onCreate(setlist)
        dismiss()
    }
}
