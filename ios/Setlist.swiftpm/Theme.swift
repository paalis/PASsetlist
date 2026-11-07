import SwiftUI
import CoreText

// Samme uttrykk som nettsiden: nesten svart bakgrunn, rød aksent (--accent #ff3d3d),
// plakatfonten Anton med hard rød skygge, og Inter-lignende systemfont til brødtekst.

enum Theme {
    static let bg = Color(hex: 0x08070A)
    static let surface = Color(hex: 0x121015)
    static let surface2 = Color(hex: 0x1A171E)
    static let surface3 = Color(hex: 0x25212B)
    static let border = Color(hex: 0x29242F)
    static let line = Color.white.opacity(0.08)
    static let text = Color(hex: 0xF6F3EF)
    static let muted = Color(hex: 0x9A929F)
    static let faint = Color(hex: 0x5F5866)
    static let accent = Color(hex: 0xFF3D3D)
    static let ice = Color(hex: 0x9FD4FF)

    /// Registrerer Anton fra pakken og gir navnet fonten fikk.
    static let antonName: String? = {
        guard let url = Bundle.module.url(forResource: "Anton-Regular", withExtension: "ttf"),
              let data = try? Data(contentsOf: url) as CFData,
              let provider = CGDataProvider(data: data),
              let cgFont = CGFont(provider) else { return nil }
        CTFontManagerRegisterGraphicsFont(cgFont, nil)
        return cgFont.postScriptName as String?
    }()

    static func poster(_ size: CGFloat) -> Font {
        if let name = antonName { return .custom(name, size: size) }
        return .system(size: size, weight: .black, design: .default).width(.condensed)
    }

    static func posterUIFont(_ size: CGFloat) -> UIFont {
        if let name = antonName, let f = UIFont(name: name, size: size) { return f }
        return .systemFont(ofSize: size, weight: .black)
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: opacity)
    }

    init(css: String) {
        let h = UInt32(css.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x111111
        self.init(hex: h)
    }
}

/// Plakattittel: store bokstaver i Anton med hard rød skygge (som logoen på nettsiden).
struct PosterText: View {
    let text: String
    var size: CGFloat = 40
    var outline = false

    var body: some View {
        let upper = text.uppercased()
        if outline {
            ZStack {
                ForEach(0..<8, id: \.self) { i in
                    let a = Double(i) / 8 * 2 * .pi
                    Text(upper).font(Theme.poster(size)).foregroundStyle(Theme.text)
                        .offset(x: cos(a) * 1.2, y: sin(a) * 1.2)
                }
                Text(upper).font(Theme.poster(size)).foregroundStyle(Theme.bg)
            }
        } else {
            ZStack(alignment: .topLeading) {
                Text(upper).font(Theme.poster(size)).foregroundStyle(Theme.accent)
                    .offset(x: size * 0.045, y: size * 0.045)
                Text(upper).font(Theme.poster(size)).foregroundStyle(Theme.text)
            }
        }
    }
}

/// «SETLIST LIVE»-logoen.
struct Logo: View {
    var size: CGFloat = 26
    var body: some View {
        HStack(spacing: size * 0.28) {
            PosterText(text: "Setlist", size: size)
            PosterText(text: "Live", size: size, outline: true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Setlist Live")
    }
}

/// Små etiketter med sperret skrift.
struct Eyebrow: View {
    let text: String
    var color: Color = Theme.accent
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .tracking(2.4)
            .foregroundStyle(color)
    }
}

/// Knapper som på nettsiden.
struct PillButtonStyle: ButtonStyle {
    enum Kind { case primary, light, outline, square, squarePrimary }
    var kind: Kind = .primary

    func makeBody(configuration: Configuration) -> some View {
        let square = kind == .square || kind == .squarePrimary
        configuration.label
            .font(.system(size: 13, weight: .bold))
            .tracking(1.4)
            .textCase(.uppercase)
            .padding(.horizontal, 18)
            .frame(minHeight: square ? 44 : 46)
            .frame(maxWidth: square ? .infinity : nil)
            .foregroundStyle(kind == .light ? Color.black : Theme.text)
            .background(background)
            .overlay(border)
            .clipShape(RoundedRectangle(cornerRadius: square ? 4 : 999))
            .opacity(configuration.isPressed ? 0.75 : 1)
    }

    @ViewBuilder private var background: some View {
        switch kind {
        case .primary, .squarePrimary: Theme.accent
        case .light: Color.white
        case .outline, .square: Color.clear
        }
    }

    @ViewBuilder private var border: some View {
        let square = kind == .square || kind == .squarePrimary
        RoundedRectangle(cornerRadius: square ? 4 : 999)
            .stroke(kind == .outline ? Color.white.opacity(0.6) : (kind == .square ? Color.white.opacity(0.18) : Color.clear), lineWidth: 1)
    }
}
