import SwiftUI
import PhotosUI
import PDFKit
import UniformTypeIdentifiers

/// Tekst, noter og akkordskjema for én låt. Lagres lokalt med én gang og lastes opp
/// til bandkoden (samme format som nettsiden), så alle ser de samme filene.
@MainActor
struct AttachmentsSheet: View {
    @Binding var item: SetlistItem
    var onStartHere: (() -> Void)? = nil
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss

    @State private var importing = false
    @State private var photo: PhotosPickerItem?
    @State private var preview: FileRef?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if item.files.isEmpty {
                        Text("Ingen filer ennå.").foregroundStyle(Theme.muted)
                    }
                    ForEach(item.files) { f in
                        Button { preview = f } label: {
                            HStack(spacing: 12) {
                                Text(kindLabel(f)).font(.system(size: 10, weight: .bold)).tracking(1)
                                    .padding(.horizontal, 7).padding(.vertical, 4)
                                    .background(kindColor(f).opacity(0.2), in: RoundedRectangle(cornerRadius: 5))
                                    .foregroundStyle(kindColor(f))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(f.name).foregroundStyle(Theme.text)
                                    Text(sizeText(f.size) + (store.hasLocal(f) ? "" : " · ikke lastet ned"))
                                        .font(.caption).foregroundStyle(Theme.muted)
                                }
                            }
                        }
                    }
                    .onMove { item.files.move(fromOffsets: $0, toOffset: $1) }
                    .onDelete { offsets in
                        let removed = offsets.map { item.files[$0] }
                        item.files.remove(atOffsets: offsets)
                        Task { @MainActor in store.cleanupFiles(removed) }
                    }
                } header: {
                    Text("Filer i rekkefølge")
                } footer: {
                    Text(store.code == nil
                         ? "Filene lagres på denne iPaden. Logg inn med bandkoden for å dele dem med bandet."
                         : "Filene lagres på iPaden og deles med alle som bruker samme kode.")
                }

                if let onStartHere, !item.files.isEmpty {
                    Section {
                        Button(action: onStartHere) {
                            Label("Start scenemodus herfra", systemImage: "play.fill").font(.headline)
                        }
                        .foregroundStyle(Theme.accent)
                    }
                }

                Section {
                    Button { importing = true } label: { Label("Fra Filer (PDF, bilde eller tekst)", systemImage: "folder") }
                    PhotosPicker(selection: $photo, matching: .images) { Label("Fra Bilder", systemImage: "photo.on.rectangle") }
                }

                if let errorMessage { Text(errorMessage).foregroundStyle(Theme.accent) }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.surface)
            .toolbar {
                ToolbarItem(placement: .principal) { PosterText(text: item.title.isEmpty ? "Låt" : item.title, size: 22) }
                ToolbarItem(placement: .topBarLeading) { EditButton() }
                ToolbarItem(placement: .confirmationAction) { Button("Ferdig") { dismiss() }.bold() }
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .image, .plainText, .text], allowsMultipleSelection: true) { result in
                switch result {
                case .success(let urls): for url in urls { importFile(url) }
                case .failure(let error): errorMessage = error.localizedDescription
                }
            }
            .onChange(of: photo) { _, selected in
                guard let selected else { return }
                Task {
                    if let data = try? await selected.loadTransferable(type: Data.self) {
                        addImage(data, name: "Bilde \(item.files.count + 1).jpg")
                    } else {
                        errorMessage = "Klarte ikke å hente bildet."
                    }
                    photo = nil
                }
            }
            .sheet(item: $preview) { f in FilePreview(ref: f).environmentObject(store) }
        }
    }

    private func importFile(_ url: URL) {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            errorMessage = "Klarte ikke å lese \(url.lastPathComponent)."
            return
        }
        let name = url.lastPathComponent
        let kind = FileKind(type: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "", name: name)
        switch kind {
        case .image:
            addImage(data, name: name)
        case .pdf:
            add(data, name: name, type: "application/pdf")
        case .text:
            add(data, name: name, type: "text/plain")
        case .unknown:
            if UIImage(data: data) != nil { addImage(data, name: name) }
            else { errorMessage = "«\(name)» har et filformat som ikke støttes." }
        }
    }

    /// Bilder gjøres om til JPEG (maks 2400 px), som på nettsiden.
    private func addImage(_ data: Data, name: String) {
        guard let image = UIImage(data: data) else { errorMessage = "Klarte ikke å lese bildet."; return }
        let scale = min(1, 2400 / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            UIColor.white.setFill()
            UIRectFill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        guard let jpeg = resized.jpegData(compressionQuality: 0.85) else { return }
        add(jpeg, name: (name as NSString).deletingPathExtension + ".jpg", type: "image/jpeg")
    }

    private func add(_ data: Data, name: String, type: String) {
        do {
            item.files.append(try store.addFile(data: data, name: name, type: type))
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func kindLabel(_ f: FileRef) -> String {
        switch f.kind {
        case .pdf: return "PDF"
        case .image: return "BILDE"
        case .text: return "TEKST"
        case .unknown: return "FIL"
        }
    }

    private func kindColor(_ f: FileRef) -> Color {
        switch f.kind {
        case .pdf: return Color(hex: 0xFF8A80)
        case .image: return Color(hex: 0xFFBF80)
        default: return Theme.muted
        }
    }

    private func sizeText(_ bytes: Int) -> String {
        bytes < 1_048_576 ? "\(max(1, bytes / 1024)) kB" : String(format: "%.1f MB", Double(bytes) / 1_048_576).replacingOccurrences(of: ".", with: ",")
    }
}

/// Forhåndsvisning av én fil (lastes ned ved behov).
@MainActor
struct FilePreview: View {
    let ref: FileRef
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var url: URL?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if let url {
                    switch ref.kind {
                    case .pdf: PDFKitView(url: url)
                    case .image:
                        ScrollView { if let img = UIImage(contentsOfFile: url.path) { Image(uiImage: img).resizable().scaledToFit() } }
                    default:
                        ScrollView {
                            Text((try? String(contentsOf: url, encoding: .utf8)) ?? "")
                                .font(.body.monospaced()).frame(maxWidth: .infinity, alignment: .leading).padding()
                        }
                    }
                } else if let error {
                    ContentUnavailableView(error, systemImage: "wifi.slash")
                } else {
                    ProgressView("Henter …")
                }
            }
            .navigationTitle(ref.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Lukk") { dismiss() } } }
            .task {
                do { url = try await store.ensureFile(ref) } catch { self.error = error.localizedDescription }
            }
        }
    }
}

struct PDFKitView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.document = PDFDocument(url: url)
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        if view.document?.documentURL != url { view.document = PDFDocument(url: url) }
    }
}

/// Viser en ferdig PDF (notehefte/utskrift) med deling, lagring i Filer og utskrift.
struct PDFPreview: View {
    let url: URL
    let title: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            PDFKitView(url: url)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Lukk") { dismiss() } }
                    ToolbarItemGroup(placement: .primaryAction) {
                        Button {
                            let controller = UIPrintInteractionController.shared
                            controller.printingItem = url
                            controller.present(animated: true, completionHandler: nil)
                        } label: { Label("Skriv ut", systemImage: "printer") }
                        ShareLink(item: url)
                    }
                }
        }
    }
}
