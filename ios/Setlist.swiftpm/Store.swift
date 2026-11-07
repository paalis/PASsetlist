import SwiftUI
import Network

/// Holder alle setlister, lokalt først (virker uten nett) og synkronisert med bandkoden.
///
/// - Uten innlogging: setlistene lagres bare på iPaden (som nettsiden uten kode).
/// - Med bandkode: samme data som nettsiden – spaces/{hash}/setlists, files og annotations.
///   Endringer lagres lokalt med én gang og sendes når det er nett (kø som overlever omstart).
@MainActor
final class Store: ObservableObject {
    @Published private(set) var setlists: [Setlist] = []
    @Published private(set) var code: String?
    @Published private(set) var online = true
    @Published private(set) var syncing = false
    @Published var lastError: String?

    private var client: FirestoreClient? { code.map { FirestoreClient(space: Cloud.space(for: $0)) } }

    // Kø og tilstand (lagres)
    private struct SyncState: Codable {
        var pendingUpserts: Set<String> = []
        var pendingDeletes: Set<String> = []
        var knownRemote: Set<String> = []
        var pendingUploads: [FileRef] = []
        var pendingFileDeletes: Set<String> = []
    }
    private var state = SyncState()

    private let monitor = NWPathMonitor()
    private var saveTask: Task<Void, Never>?
    private var pushTask: Task<Void, Never>?
    private var syncInFlight = false
    private var prefetching = false

    static let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    static let filesFolder = documents.appendingPathComponent("Filer", isDirectory: true)
    static let notesFolder = documents.appendingPathComponent("Notater", isDirectory: true)
    private static let codeKey = "setlistlive.code"

    init() {
        for folder in [Self.filesFolder, Self.notesFolder] {
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        }
        code = UserDefaults.standard.string(forKey: Self.codeKey)
        loadCache()
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                let wasOnline = self.online
                self.online = path.status == .satisfied
                if self.online && !wasOnline { await self.sync() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "nett"))
    }

    // MARK: - Lokal lagring

    private var cacheName: String { code.map { "space-\(Cloud.space(for: $0).prefix(16))" } ?? "lokal" }
    private var cacheURL: URL { Self.documents.appendingPathComponent("\(cacheName).json") }
    private var stateURL: URL { Self.documents.appendingPathComponent("\(cacheName)-synk.json") }

    private func loadCache() {
        setlists = (try? JSONDecoder().decode([Setlist].self, from: Data(contentsOf: cacheURL))) ?? []
        state = (try? JSONDecoder().decode(SyncState.self, from: Data(contentsOf: stateURL))) ?? SyncState()
        sortLists()
    }

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            self?.saveNow()
        }
    }

    func saveNow() {
        saveTask?.cancel()
        if let data = try? JSONEncoder().encode(setlists) { try? data.write(to: cacheURL, options: .atomic) }
        if let data = try? JSONEncoder().encode(state) { try? data.write(to: stateURL, options: .atomic) }
    }

    private func sortLists() {
        setlists.sort { $0.updatedAt > $1.updatedAt }
    }

    // MARK: - Endringer

    func setlist(_ id: String) -> Setlist? { setlists.first { $0.id == id } }

    /// Binding som slår opp setlisten på id og lagrer + synker ved endring.
    func binding(for id: String) -> Binding<Setlist> {
        Binding(
            get: { self.setlist(id) ?? Setlist(id: id) },
            set: { self.update($0) }
        )
    }

    func update(_ sl: Setlist) {
        var sl = sl
        guard let i = setlists.firstIndex(where: { $0.id == sl.id }) else { return add(sl) }
        if setlists[i] == sl { return }
        sl.updatedAt = nowMs()
        setlists[i] = sl
        markChanged(sl.id)
    }

    func add(_ sl: Setlist) {
        var sl = sl
        sl.updatedAt = nowMs()
        setlists.insert(sl, at: 0)
        markChanged(sl.id)
    }

    func delete(_ id: String) {
        let removedFiles = setlist(id)?.items.flatMap(\.files) ?? []
        setlists.removeAll { $0.id == id }
        state.pendingUpserts.remove(id)
        if code != nil { state.pendingDeletes.insert(id) }
        cleanupFiles(removedFiles)
        scheduleSave()
        schedulePush()
    }

    func duplicate(_ id: String) {
        guard var copy = setlist(id) else { return }
        copy.id = makeID()
        copy.name += " (kopi)"
        copy.createdAt = nowMs()
        copy.items = copy.items.map { var i = $0; i.id = makeID(); return i }
        add(copy)
    }

    private func markChanged(_ id: String) {
        if code != nil { state.pendingUpserts.insert(id) }
        scheduleSave()
        schedulePush()
    }

    /// Sletter filer (lokalt og i skyen) som ingen låt bruker lenger.
    func cleanupFiles(_ candidates: [FileRef]) {
        let used = Set(setlists.flatMap { $0.items.flatMap { $0.files.map(\.id) } })
        for f in candidates where !used.contains(f.id) {
            try? FileManager.default.removeItem(at: fileURL(f))
            removeLocalNotes(fileID: f.id)
            state.pendingUploads.removeAll { $0.id == f.id }
            if code != nil { state.pendingFileDeletes.insert(f.id) }
        }
        scheduleSave()
    }

    // MARK: - Bandkode

    func signIn(_ raw: String) async throws {
        let normalized = Cloud.normalize(raw)
        guard normalized.count >= 6 else { throw CloudError(message: "Koden må ha minst 6 tegn.") }
        let localLists = code == nil ? setlists : []
        saveNow()
        code = normalized
        UserDefaults.standard.set(normalized, forKey: Self.codeKey)
        loadCache()
        // Som nettsiden: setlister som bare lå lokalt, flyttes over til koden
        for sl in localLists where setlist(sl.id) == nil {
            setlists.append(sl)
            state.pendingUpserts.insert(sl.id)
        }
        if !localLists.isEmpty { try? FileManager.default.removeItem(at: Self.documents.appendingPathComponent("lokal.json")) }
        sortLists()
        saveNow()
        await sync()
    }

    func signOut() {
        saveNow()
        code = nil
        UserDefaults.standard.removeObject(forKey: Self.codeKey)
        loadCache()
    }

    // MARK: - Synkronisering

    private func schedulePush() {
        guard code != nil else { return }
        pushTask?.cancel()
        pushTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            guard !Task.isCancelled else { return }
            await self?.sync()
        }
    }

    /// Sender ventende endringer og henter det bandet har endret.
    func sync() async {
        guard let client, online, !syncInFlight else { return }
        syncInFlight = true
        syncing = true
        defer { syncInFlight = false; syncing = false }
        do {
            // 1) Slettinger
            for id in state.pendingDeletes {
                try await client.delete("setlists/\(id)")
                state.pendingDeletes.remove(id)
                state.knownRemote.remove(id)
            }
            // 2) Filer som venter på opplasting / sletting
            for ref in state.pendingUploads {
                try await uploadNow(ref, client: client)
                state.pendingUploads.removeAll { $0.id == ref.id }
            }
            for id in state.pendingFileDeletes {
                try await deleteRemoteFile(id, client: client)
                state.pendingFileDeletes.remove(id)
            }
            // 3) Endrede setlister
            for id in state.pendingUpserts {
                if let sl = setlist(id) {
                    try await client.set("setlists/\(id)", try Plain.from(sl))
                    state.knownRemote.insert(id)
                }
                state.pendingUpserts.remove(id)
            }
            // 4) Notater som venter
            try await pushPendingNotes(client: client)
            // 5) Hent alt og slå sammen
            let remote = try await client.list("setlists").compactMap { try? Plain.to(Setlist.self, $0) }
            merge(remote)
            lastError = nil
            saveNow()
            prefetchFiles()
        } catch {
            lastError = error.localizedDescription
            saveNow()
        }
    }

    private func merge(_ remote: [Setlist]) {
        let remoteIDs = Set(remote.map(\.id))
        for r in remote {
            if state.pendingDeletes.contains(r.id) { continue }
            if let i = setlists.firstIndex(where: { $0.id == r.id }) {
                if !state.pendingUpserts.contains(r.id) && r.updatedAt > setlists[i].updatedAt { setlists[i] = r }
            } else {
                setlists.append(r)
            }
        }
        // Slettet av noen andre i bandet
        let removed = setlists.filter { state.knownRemote.contains($0.id) && !remoteIDs.contains($0.id) && !state.pendingUpserts.contains($0.id) }
        if !removed.isEmpty {
            setlists.removeAll { s in removed.contains { $0.id == s.id } }
        }
        state.knownRemote = remoteIDs
        sortLists()
    }

    // MARK: - Filer

    func fileURL(_ ref: FileRef) -> URL {
        let ext = (ref.name as NSString).pathExtension
        return Self.filesFolder.appendingPathComponent(ref.id + (ext.isEmpty ? "" : ".\(ext)"))
    }

    func hasLocal(_ ref: FileRef) -> Bool { FileManager.default.fileExists(atPath: fileURL(ref).path) }

    /// Lokal kopi av filen (lastes ned ved behov).
    func ensureFile(_ ref: FileRef) async throws -> URL {
        let url = fileURL(ref)
        if FileManager.default.fileExists(atPath: url.path) { return url }
        guard let client else { throw CloudError(message: "Logg inn med bandkoden for å hente filen.") }
        guard online else { throw CloudError(message: "Filen er ikke lastet ned ennå, og iPaden er uten nett.") }
        guard let info = try await client.get("files/\(ref.id)") else { throw CloudError(message: "Filen finnes ikke lenger.") }
        let chunks = (info["chunks"] as? Int) ?? 0
        var data = Data()
        for n in 0..<chunks {
            guard let chunk = try await client.get("files/\(ref.id)/chunks/\(n)"), let bytes = chunk["data"] as? Data else {
                throw CloudError(message: "Filen er ufullstendig.")
            }
            data.append(bytes)
        }
        try data.write(to: url, options: .atomic)
        return url
    }

    /// Laster ned alle filer i alle setlister i bakgrunnen, så de virker uten nett på scenen.
    private func prefetchFiles() {
        guard !prefetching, online, code != nil else { return }
        let missing = setlists.flatMap { $0.items.flatMap(\.files) }.filter { !hasLocal($0) }
        guard !missing.isEmpty else { return }
        prefetching = true
        Task {
            for ref in missing { _ = try? await ensureFile(ref) }
            prefetching = false
        }
    }

    /// Legger til en fil: lagres lokalt med én gang, lastes opp når det er nett.
    func addFile(data: Data, name: String, type: String) throws -> FileRef {
        guard data.count <= 20 * 1024 * 1024 else { throw CloudError(message: "«\(name)» er større enn 20 MB.") }
        let ref = FileRef(id: makeID(), name: name, type: type, size: data.count)
        try data.write(to: fileURL(ref), options: .atomic)
        if code != nil {
            state.pendingUploads.append(ref)
            scheduleSave()
            schedulePush()
        }
        return ref
    }

    private func uploadNow(_ ref: FileRef, client: FirestoreClient) async throws {
        let data = try Data(contentsOf: fileURL(ref))
        let chunkSize = 750_000
        let chunks = max(1, Int(ceil(Double(data.count) / Double(chunkSize))))
        for n in 0..<chunks {
            let part = data.subdata(in: (n * chunkSize)..<min(data.count, (n + 1) * chunkSize))
            try await client.set("files/\(ref.id)/chunks/\(n)", ["data": part])
        }
        // Info-dokumentet skrives sist, som på nettsiden
        try await client.set("files/\(ref.id)", ["name": ref.name, "type": ref.type, "size": data.count, "chunks": chunks, "createdAt": nowMs()])
    }

    private func deleteRemoteFile(_ id: String, client: FirestoreClient) async throws {
        let chunks = (try await client.get("files/\(id)")?["chunks"] as? Int) ?? 0
        try await client.delete("files/\(id)")
        for n in 0..<chunks { try await client.delete("files/\(id)/chunks/\(n)") }
        for noteID in (try? await client.idsWhere("annotations", field: "fileId", equals: id)) ?? [] {
            try await client.delete("annotations/\(noteID)")
        }
    }

    // MARK: - Pencil-notater (samme format som nettsiden)

    private struct NoteFile: Codable {
        var strokes: [Stroke]
        var updatedAt: Int
        var pending: Bool
    }

    private func noteURL(_ fileID: String, _ page: Int) -> URL {
        Self.notesFolder.appendingPathComponent("\(fileID)_\(page).json")
    }

    private func readNote(_ fileID: String, _ page: Int) -> NoteFile? {
        try? JSONDecoder().decode(NoteFile.self, from: Data(contentsOf: noteURL(fileID, page)))
    }

    private func writeNote(_ note: NoteFile, _ fileID: String, _ page: Int) {
        if let data = try? JSONEncoder().encode(note) { try? data.write(to: noteURL(fileID, page), options: .atomic) }
    }

    /// Notater for en side: lokalt med én gang.
    func localNotes(fileID: String, page: Int) -> [Stroke] { readNote(fileID, page)?.strokes ?? [] }

    /// Henter nyeste versjon fra bandet (nil hvis ingen endring eller uten nett).
    func refreshNotes(fileID: String, page: Int) async -> [Stroke]? {
        guard let client, online else { return nil }
        let local = readNote(fileID, page)
        if local?.pending == true { return nil } // egne endringer går foran til de er sendt
        let doc: [String: Any]?
        do {
            doc = try await client.get("annotations/\(fileID)_\(page)")
        } catch {
            return nil // nettfeil: behold det vi har
        }
        // Finnes ikke i skyen = ingen notater (kan ha blitt visket ut av noen i bandet)
        let remote = doc.flatMap { try? Plain.to(RemoteNote.self, $0) } ?? RemoteNote(strokes: [], updatedAt: 0)
        if let local, local.strokes == remote.strokes { return nil }
        if local == nil && remote.strokes.isEmpty { return nil }
        writeNote(NoteFile(strokes: remote.strokes, updatedAt: remote.updatedAt, pending: false), fileID, page)
        return remote.strokes
    }

    private struct RemoteNote: Codable {
        var strokes: [Stroke]
        var updatedAt: Int
        init(strokes: [Stroke], updatedAt: Int) { self.strokes = strokes; self.updatedAt = updatedAt }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            strokes = try c.decodeIfPresent([Stroke].self, forKey: .strokes) ?? []
            updatedAt = Int(try c.decodeIfPresent(Double.self, forKey: .updatedAt) ?? 0)
        }
    }

    func saveNotes(_ strokes: [Stroke], fileID: String, page: Int) {
        writeNote(NoteFile(strokes: strokes, updatedAt: nowMs(), pending: true), fileID, page)
        Task { await pushNote(fileID: fileID, page: page) }
    }

    private func pushNote(fileID: String, page: Int) async {
        guard let client, online, let note = readNote(fileID, page), note.pending else { return }
        do {
            if note.strokes.isEmpty {
                try await client.delete("annotations/\(fileID)_\(page)")
            } else {
                try await client.set("annotations/\(fileID)_\(page)", [
                    "fileId": fileID, "page": page,
                    "strokes": try note.strokes.map { try Plain.from($0) },
                    "updatedAt": note.updatedAt,
                ])
            }
            var sent = note
            sent.pending = false
            if readNote(fileID, page)?.updatedAt == note.updatedAt { writeNote(sent, fileID, page) }
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func pushPendingNotes(client _: FirestoreClient) async throws {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: Self.notesFolder.path)) ?? []
        for name in names where name.hasSuffix(".json") {
            let base = String(name.dropLast(5))
            guard let sep = base.lastIndex(of: "_"), let page = Int(base[base.index(after: sep)...]) else { continue }
            let fileID = String(base[..<sep])
            if readNote(fileID, page)?.pending == true { await pushNote(fileID: fileID, page: page) }
        }
    }

    private func removeLocalNotes(fileID: String) {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: Self.notesFolder.path)) ?? []
        for name in names where name.hasPrefix("\(fileID)_") {
            try? FileManager.default.removeItem(at: Self.notesFolder.appendingPathComponent(name))
        }
    }
}
