import SwiftUI
import PhotosUI
import PDFKit
import UniformTypeIdentifiers

/// Tekst, noter og akkordskjema for én låt.
struct AttachmentsSheet: View {
    @Binding var item: SetlistItem
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss

    @State private var importing = false
    @State private var photo: PhotosPickerItem?
    @State private var preview: Attachment?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if item.attachments.isEmpty {
                        Text("Ingen filer ennå.").foregroundStyle(.secondary)
                    }
                    ForEach(item.attachments) { attachment in
                        Button { preview = attachment } label: {
                            Label(attachment.name, systemImage: icon(for: attachment.kind))
                        }
                    }
                    .onMove { item.attachments.move(fromOffsets: $0, toOffset: $1) }
                    .onDelete { offsets in
                        item.attachments.remove(atOffsets: offsets)
                        DispatchQueue.main.async { store.removeUnusedFiles() }
                    }
                } header: {
                    Text("Filer i rekkefølge")
                } footer: {
                    Text("Filene lagres på denne iPaden og virker uten nett.")
                }

                Section {
                    Button { importing = true } label: {
                        Label("Fra Filer (PDF, bilde eller tekst)", systemImage: "folder")
                    }
                    PhotosPicker(selection: $photo, matching: .images) {
                        Label("Fra Bilder", systemImage: "photo.on.rectangle")
                    }
                }

                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
            .navigationTitle(item.title.isEmpty ? "Låt" : item.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { EditButton() }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Ferdig") { dismiss() }.bold()
                }
            }
            .fileImporter(
                isPresented: $importing,
                allowedContentTypes: [.pdf, .image, .plainText, .text],
                allowsMultipleSelection: true
            ) { result in
                switch result {
                case .success(let urls):
                    for url in urls {
                        do {
                            item.attachments.append(try store.importFile(from: url))
                        } catch {
                            errorMessage = "Klarte ikke å importere \(url.lastPathComponent)."
                        }
                    }
                case .failure(let error):
                    errorMessage = error.localizedDescription
                }
            }
            .onChange(of: photo) { _, selected in
                guard let selected else { return }
                Task {
                    if let data = try? await selected.loadTransferable(type: Data.self),
                       let attachment = store.importImageData(data, name: "Bilde \(item.attachments.count + 1)") {
                        item.attachments.append(attachment)
                    } else {
                        errorMessage = "Klarte ikke å hente bildet."
                    }
                    photo = nil
                }
            }
            .sheet(item: $preview) { attachment in
                AttachmentPreview(attachment: attachment)
            }
        }
    }

    private func icon(for kind: AttachmentKind) -> String {
        switch kind {
        case .pdf: return "doc.richtext"
        case .image: return "photo"
        case .text: return "doc.text"
        }
    }
}

/// Forhåndsvisning av én fil.
struct AttachmentPreview: View {
    let attachment: Attachment
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                let url = Store.fileURL(attachment)
                switch attachment.kind {
                case .pdf:
                    PDFKitView(url: url)
                case .image:
                    if let image = UIImage(contentsOfFile: url.path) {
                        ScrollView {
                            Image(uiImage: image).resizable().scaledToFit()
                        }
                    }
                case .text:
                    ScrollView {
                        Text(Store.readText(url))
                            .font(.body.monospaced())
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding()
                    }
                }
            }
            .navigationTitle(attachment.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Lukk") { dismiss() }
                }
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
        if view.document?.documentURL != url {
            view.document = PDFDocument(url: url)
        }
    }
}
