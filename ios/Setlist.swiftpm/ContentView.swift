import SwiftUI

@MainActor
struct ContentView: View {
    @EnvironmentObject private var store: Store
    @State private var selection: String?
    @State private var showingNew = false
    @State private var showingCode = false
    @State private var columns: NavigationSplitViewVisibility = .all

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            sidebar
        } detail: {
            if let id = selection, store.setlist(id) != nil {
                SetlistEditor(setlist: store.binding(for: id))
                    .id(id)
            } else {
                HeroView(onNew: { showingNew = true }, onCode: { showingCode = true })
            }
        }
        .navigationSplitViewStyle(.balanced)
        .sheet(isPresented: $showingNew) {
            NewSetlistSheet { sl in
                store.add(sl)
                selection = sl.id
            }
        }
        .sheet(isPresented: $showingCode) { CodeSheet() }
    }

    private var nextGig: String? {
        let today = Setlist.dayFormatter.string(from: Date())
        return store.setlists.filter { !$0.date.isEmpty && $0.date >= today }.min { $0.date < $1.date }?.id
    }

    private var sidebar: some View {
        List(selection: $selection) {
            Section {
                ForEach(store.setlists) { sl in
                    TicketRow(setlist: sl, isNext: sl.id == nextGig, selected: selection == sl.id)
                        .tag(sl.id)
                        .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .contextMenu {
                            Button { store.duplicate(sl.id) } label: { Label("Dupliser", systemImage: "plus.square.on.square") }
                            Button(role: .destructive) { delete(sl.id) } label: { Label("Slett", systemImage: "trash") }
                        }
                        .swipeActions {
                            Button(role: .destructive) { delete(sl.id) } label: { Label("Slett", systemImage: "trash") }
                        }
                }
            } header: {
                HStack {
                    Eyebrow(text: "Mine setlister", color: Theme.text.opacity(0.8))
                    if !store.setlists.isEmpty {
                        Text("\(store.setlists.count)").font(.caption2.bold()).foregroundStyle(Theme.muted)
                            .padding(.horizontal, 7).padding(.vertical, 2).background(Theme.surface3, in: Capsule())
                    }
                }
                .padding(.top, 4)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        .overlay {
            if store.setlists.isEmpty {
                VStack(spacing: 12) {
                    Vinyl(size: 90, spinning: true)
                    Text("Scenen er tom").font(.headline)
                    Text("Trykk + for å lage en setlist fra Spotify eller tekst.")
                        .font(.subheadline).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
                }
                .padding()
            }
        }
        .safeAreaInset(edge: .bottom) { accountBar }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { Logo(size: 22) }
            ToolbarItem(placement: .primaryAction) {
                Button { showingNew = true } label: { Label("Ny setlist", systemImage: "plus") }
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.bg, for: .navigationBar)
    }

    private var accountBar: some View {
        HStack(spacing: 10) {
            if let code = store.code {
                HStack(spacing: 6) {
                    Text("KODE").font(.system(size: 10, weight: .bold)).tracking(1.5)
                        .padding(.horizontal, 7).padding(.vertical, 3).background(Theme.accent, in: Capsule())
                    Text(code).font(.system(size: 13, design: .monospaced)).tracking(1)
                }
                .padding(.vertical, 4).padding(.leading, 4).padding(.trailing, 10)
                .background(Theme.surface2, in: Capsule())
                Spacer()
                if store.syncing { ProgressView().controlSize(.small) }
                else if !store.online { Image(systemName: "wifi.slash").foregroundStyle(Theme.muted) }
                else if store.lastError != nil { Image(systemName: "exclamationmark.triangle").foregroundStyle(Theme.accent) }
                Button("Logg ut") { store.signOut(); selection = nil }
                    .font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.muted)
            } else {
                Text("Lagres bare på denne iPaden.").font(.caption).foregroundStyle(Theme.muted)
                Spacer()
                Button("Logg inn med kode") { showingCode = true }.buttonStyle(PillButtonStyle(kind: .outline)).controlSize(.small)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }

    private func delete(_ id: String) {
        if selection == id { selection = nil }
        store.delete(id)
    }
}

/* ---------- Billett-kort (som «Mine setlister» på nettsiden) ---------- */

struct TicketRow: View {
    let setlist: Setlist
    var isNext = false
    var selected = false

    private static let months = ["JAN", "FEB", "MAR", "APR", "MAI", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DES"]

    var body: some View {
        HStack(spacing: 0) {
            Text(isNext ? "NESTE" : setlist.date.isEmpty ? "SETLIST" : "SPILLEJOBB")
                .font(.system(size: 9, weight: .semibold)).tracking(1.6)
                .foregroundStyle(isNext ? .white : Theme.muted)
                .fixedSize()
                .rotationEffect(.degrees(-90))
                .frame(width: 26)
                .frame(maxHeight: .infinity)
                .background(isNext ? Theme.accent : Color.clear)

            stub.frame(width: 70).frame(maxHeight: .infinity).background(Color.white.opacity(0.02))

            Rectangle().fill(Color.clear).frame(width: 1)
                .overlay(Rectangle().stroke(style: StrokeStyle(lineWidth: 1.5, dash: [4, 4])).foregroundStyle(Color.white.opacity(0.14)))

            VStack(alignment: .leading, spacing: 3) {
                Text((setlist.venue.isEmpty ? "Setlist" : setlist.venue).uppercased())
                    .font(.system(size: 9, weight: .semibold)).tracking(1.8).foregroundStyle(Theme.muted).lineLimit(1)
                Text(setlist.name.isEmpty ? "Uten navn" : setlist.name)
                    .font(.system(size: 17, weight: .bold)).foregroundStyle(Theme.text).lineLimit(2)
                Text("\(setlist.songCount) låter" + (setlist.totalMs > 0 ? " · \(formatTotal(setlist.totalMs))" : ""))
                    .font(.system(size: 13)).foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: 96)
        .background(Theme.surface.opacity(0.95))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(selected ? Theme.accent : Color.white.opacity(0.1), lineWidth: selected ? 1.5 : 1))
        .contentShape(Rectangle())
    }

    @ViewBuilder private var stub: some View {
        let parts = setlist.date.split(separator: "-")
        if parts.count == 3, let m = Int(parts[1]), let d = Int(parts[2]), (1...12).contains(m) {
            VStack(spacing: 2) {
                Text("\(d)").font(.system(size: 30, weight: .heavy)).foregroundStyle(Theme.accent)
                Text(Self.months[m - 1]).font(.system(size: 11, weight: .bold)).tracking(2)
                Text(parts[0]).font(.system(size: 10)).foregroundStyle(Theme.muted)
            }
        } else {
            Vinyl(size: 46)
        }
    }
}

/* ---------- Vinylplate ---------- */

struct Vinyl: View {
    var size: CGFloat
    var spinning = false
    var coverURL: String = ""
    var coverImage: UIImage? = nil
    var label: (big: String, small: String)? = nil
    @State private var angle = 0.0

    var body: some View {
        ZStack {
            Circle().fill(Color(hex: 0x0B0A0C))
            ForEach(0..<Int(size / 6), id: \.self) { i in
                Circle().stroke(Color.white.opacity(0.035), lineWidth: 1)
                    .padding(CGFloat(i) * 3 + size * 0.04)
            }
            AngularGradient(colors: [.clear, .white.opacity(0.06), .clear, .clear, .white.opacity(0.05), .clear], center: .center)
                .clipShape(Circle())
            labelView.frame(width: size * 0.48, height: size * 0.48)
                .rotationEffect(.degrees(-angle)) // etiketten står stille, platen snurrer
            Circle().fill(Theme.bg).frame(width: max(3, size * 0.03))
        }
        .frame(width: size, height: size)
        .rotationEffect(.degrees(angle))
        .shadow(color: .black.opacity(0.6), radius: size * 0.08, y: size * 0.05)
        .onAppear {
            guard spinning else { return }
            withAnimation(.linear(duration: 18).repeatForever(autoreverses: false)) { angle = 360 }
        }
    }

    @ViewBuilder private var labelView: some View {
        ZStack {
            if let coverImage {
                Image(uiImage: coverImage).resizable().scaledToFill().overlay(Color.black.opacity(0.28))
            } else if let url = URL(string: coverURL), !coverURL.isEmpty {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill().overlay(Color.black.opacity(0.28))
                } placeholder: { redLabel }
            } else {
                redLabel
            }
            if let label {
                VStack(spacing: size * 0.07) { // hullet i midten havner mellom dag og måned
                    Text(label.big).font(.system(size: size * 0.17, weight: .heavy)).minimumScaleFactor(0.5).lineLimit(1)
                    Text(label.small).font(.system(size: size * 0.06, weight: .heavy)).tracking(size * 0.012)
                }
                .foregroundStyle(.white).shadow(color: .black.opacity(0.8), radius: 4)
            }
        }
        .clipShape(Circle())
    }

    private var redLabel: some View {
        RadialGradient(colors: [Color(hex: 0xFF6A5A), Theme.accent, Color(hex: 0xA3141F)], center: UnitPoint(x: 0.35, y: 0.3), startRadius: 0, endRadius: size * 0.25)
    }
}

/* ---------- Forside (når ingen setlist er valgt) ---------- */

@MainActor
struct HeroView: View {
    @EnvironmentObject private var store: Store
    var onNew: () -> Void
    var onCode: () -> Void

    private static let photo: UIImage? = Bundle.module.url(forResource: "concert", withExtension: "webp").flatMap { UIImage(contentsOfFile: $0.path) }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottomLeading) {
                Color(hex: 0x02040C)
                if let photo = Self.photo {
                    Image(uiImage: photo).resizable().scaledToFill()
                        .frame(width: geo.size.width, height: geo.size.height).clipped()
                }
                LinearGradient(colors: [Color(hex: 0x02040C, opacity: 0.8), Color(hex: 0x02040C, opacity: 0.4), .clear], startPoint: .leading, endPoint: .trailing)
                LinearGradient(colors: [.clear, .clear, Theme.bg.opacity(0.9)], startPoint: .top, endPoint: .bottom)

                VStack(alignment: .leading, spacing: 0) {
                    Eyebrow(text: "Setlister for band og artister", color: Theme.ice).padding(.bottom, 14)
                    PosterText(text: "Setlist", size: min(130, geo.size.width * 0.16))
                    PosterText(text: "Live", size: min(130, geo.size.width * 0.16), outline: true)
                    Text("Slipp inn en Spotify-liste, så får du en setlist du kan rokke om på, rable notater i og ta med deg rett på scenen.")
                        .font(.system(size: 18)).foregroundStyle(Theme.text.opacity(0.86))
                        .frame(maxWidth: 520, alignment: .leading).padding(.top, 18)
                    HStack(spacing: 12) {
                        Button("＋ Opprett ny setlist", action: onNew).buttonStyle(PillButtonStyle(kind: .light))
                        if store.code == nil {
                            Button("Logg inn med kode", action: onCode).buttonStyle(PillButtonStyle(kind: .outline))
                        }
                    }
                    .padding(.top, 28)
                }
                .padding(40)
                .padding(.bottom, 40)
            }
        }
        .ignoresSafeArea()
    }
}

/* ---------- Logg inn med kode ---------- */

@MainActor
struct CodeSheet: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("F.eks. K7QM-4XPA", text: $code)
                        .font(.system(size: 22, design: .monospaced))
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .multilineTextAlignment(.center)
                    Button("Lag en ny, tilfeldig kode") { code = Self.randomCode() }
                } footer: {
                    Text("Alle som logger inn med samme kode – på nettsiden eller i appen – ser og redigerer de samme setlistene, filene og notatene. Bruk en kode som er vanskelig å gjette.")
                }
                if let error { Section { Text(error).foregroundStyle(Theme.accent) } }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.surface)
            .toolbar {
                ToolbarItem(placement: .principal) { PosterText(text: "Logg inn med kode", size: 22) }
                ToolbarItem(placement: .cancellationAction) { Button("Avbryt") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Logg inn") {
                            busy = true
                            Task {
                                do {
                                    try await store.signIn(code)
                                    dismiss()
                                } catch {
                                    self.error = error.localizedDescription
                                }
                                busy = false
                            }
                        }
                        .bold()
                    }
                }
            }
        }
    }

    static func randomCode() -> String {
        let chars = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        let s = String((0..<8).map { _ in chars.randomElement()! })
        return "\(s.prefix(4))-\(s.suffix(4))"
    }
}
