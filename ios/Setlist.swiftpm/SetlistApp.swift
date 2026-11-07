import SwiftUI

@main
struct SetlistApp: App {
    @StateObject private var store = Store()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
                .task {
                    // Synk jevnlig mens appen er åpen, så endringer fra bandet dukker opp
                    while !Task.isCancelled {
                        await store.sync()
                        try? await Task.sleep(nanoseconds: 20_000_000_000)
                    }
                }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await store.sync() } } else { store.saveNow() }
        }
    }
}
