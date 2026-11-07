import Foundation

enum Importer {
    /// Samme tjeneste som nettsiden bruker for å lese Spotify-spillelister.
    static let spotifyAPI = URL(string: "https://setlistlive.vercel.app/api/playlist")!

    struct SpotifyResult {
        let name: String
        let cover: String
        let items: [SetlistItem]
    }

    private struct Response: Decodable {
        struct Track: Decodable {
            let title: String
            let artist: String
            let durationMs: Double?
        }
        let name: String?
        let cover: String?
        let tracks: [Track]
    }

    private struct ErrorResponse: Decodable { let error: String }

    /// Henter tittel, artist, varighet og cover fra en Spotify-lenke. Krever nett.
    static func fetchSpotify(_ link: String) async throws -> SpotifyResult {
        var components = URLComponents(url: spotifyAPI, resolvingAgainstBaseURL: false)!
        // Lenken inneholder selv ? og & – kod alt som ikke er bokstaver/tall
        let encoded = link.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? link
        components.percentEncodedQuery = "url=\(encoded)"
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(from: components.url!)
        } catch {
            throw CloudError(message: "Fikk ikke kontakt med Spotify-tjenesten. Er iPaden på nett?")
        }
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.error
            throw CloudError(message: message ?? "Klarte ikke å hente spillelisten.")
        }
        let result = try JSONDecoder().decode(Response.self, from: data)
        let items = result.tracks.map {
            SetlistItem(title: $0.title, artist: $0.artist, durationMs: Int($0.durationMs ?? 0))
        }
        if items.isEmpty { throw CloudError(message: "Spillelisten ser ut til å være tom.") }
        let cover = result.cover ?? ""
        return SpotifyResult(name: result.name ?? "", cover: cover.hasPrefix("https://") ? cover : "", items: items)
    }

    /// Én låt per linje: «Artist - Tittel» eller bare tittel. Nummerering foran fjernes.
    static func parseText(_ text: String) -> [SetlistItem] {
        text.split(whereSeparator: \.isNewline).compactMap { raw in
            var line = String(raw).trimmed
            if let number = line.range(of: #"^\d+[.)]\s*"#, options: .regularExpression) {
                line.removeSubrange(number)
            }
            guard !line.isEmpty else { return nil }
            for separator in [" - ", " – ", " — "] {
                if let range = line.range(of: separator) {
                    return SetlistItem(title: String(line[range.upperBound...]).trimmed,
                                       artist: String(line[..<range.lowerBound]).trimmed)
                }
            }
            return SetlistItem(title: line)
        }
    }
}
