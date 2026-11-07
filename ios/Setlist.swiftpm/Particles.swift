import SwiftUI
import CoreMotion

// Lysprikker i forsidens bakgrunn, som på nettsiden: tusenvis av små lys i et dypt
// rom som driver sakte oppover og flimrer. Når iPaden vippes, glir «kameraet» litt
// til siden og opp/ned, så nære prikker flytter seg mer enn fjerne (parallakse).
// Bevegelsessensoren krever ingen tillatelse i en app.

/// Leser vippingen fra bevegelsessensoren, målt mot en nullstilling som sakte følger
/// hvordan iPaden holdes – det er bevegelsen, ikke vinkelen, som flytter scenen.
@MainActor
final class TiltSensor {
    private let manager = CMMotionManager()
    private var base: CGPoint?
    /// Mål for kameraet, -1…1 i hver retning.
    private(set) var target = CGPoint.zero
    /// Kameraets myke posisjon (oppdateres i tick).
    private(set) var offset = CGPoint.zero
    private var lastTick: Date?

    func start() {
        guard manager.isDeviceMotionAvailable, !manager.isDeviceMotionActive else { return }
        manager.deviceMotionUpdateInterval = 1 / 60
        manager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let self, let g = motion?.gravity else { return }
            MainActor.assumeIsolated { self.update(gravity: g) }
        }
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
        base = nil
        target = .zero
    }

    private func update(gravity g: CMAcceleration) {
        // Tyngdekraften i skjermens retning (tar hensyn til stående/liggende)
        let orientation = (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.effectiveGeometry.interfaceOrientation ?? .portrait
        var x = g.x, y = g.y
        switch orientation {
        case .landscapeLeft: (x, y) = (-g.y, g.x)
        case .landscapeRight: (x, y) = (g.y, -g.x)
        case .portraitUpsideDown: (x, y) = (-g.x, -g.y)
        default: break
        }
        let p = CGPoint(x: x, y: y)
        guard var b = base else { base = p; return }
        // Nullstillingen glir etter på ca. 4 sekunder
        let k = (1.0 / 60) / 4
        b.x += (p.x - b.x) * k
        b.y += (p.y - b.y) * k
        base = b
        let clamp = { (v: Double) in max(-1, min(1, v)) }
        target = CGPoint(x: clamp((p.x - b.x) / 0.3), y: clamp((p.y - b.y) / 0.3))
    }

    /// Myk utjevning, uavhengig av bildefrekvens.
    func tick(_ now: Date) -> CGPoint {
        let dt = min(0.05, lastTick.map { now.timeIntervalSince($0) } ?? 0)
        lastTick = now
        let k = 1 - exp(-dt * 3)
        offset.x += (target.x - offset.x) * k
        offset.y += (target.y - offset.y) * k
        return offset
    }
}

@MainActor
struct ParticleField: View {
    var count = 900
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var sensor = TiltSensor()
    @State private var particles: [Particle] = []
    @State private var start = Date()

    struct Particle {
        var nx, ny: Double      // posisjon i skjermens retning, -1.2…1.2
        var depth: Double       // avstand fra kameraet
        var size, bright, phase, speed: Double
        var color: Color
    }

    // Samme farger som nettsiden: blått, isblått og nesten hvitt
    private static let colors = [Color(red: 0.18, green: 0.49, blue: 1), Color(red: 0.62, green: 0.83, blue: 1), Color(red: 0.93, green: 0.97, blue: 1)]
    private static let focal = 1 / tan(22.5 * Double.pi / 180) // fov 45°

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { timeline in
            Canvas { ctx, size in
                draw(ctx, size: size, now: timeline.date)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear {
            if particles.isEmpty { particles = Self.make(count) }
            if !reduceMotion { sensor.start() }
        }
        .onDisappear { sensor.stop() }
        .onChange(of: reduceMotion) { _, reduce in reduce ? sensor.stop() : sensor.start() }
    }

    private func draw(_ ctx: GraphicsContext, size: CGSize, now: Date) {
        var ctx = ctx
        ctx.blendMode = .plusLighter
        let t = reduceMotion ? 0 : now.timeIntervalSince(start)
        let cam: CGPoint = reduceMotion ? .zero : sensor.tick(now)
        let W = Double(size.width), H = Double(size.height)
        let f: Double = H / 2 * Self.focal  // punkter per enhet ved avstand 1
        let camX: Double = Double(cam.x) * 0.6
        let camY: Double = -Double(cam.y) * 0.4

        for p in particles {
            // Sakte drift: litt sideveis bølging og en langsom stigning oppover
            var ny = p.ny - t * 0.012 * (0.5 + p.speed * 0.25) - sin(t * 0.05 + p.phase * 3.7) * 0.02
            ny = (ny + 1.25).truncatingRemainder(dividingBy: 2.5)
            if ny < 0 { ny += 2.5 }
            ny -= 1.25
            let nx = p.nx + sin(t * 0.06 + p.phase * 6.2831) * 0.015

            let x: Double = W / 2 + nx * W / 2 - camX * f / p.depth
            let y: Double = H / 2 + ny * H / 2 - camY * f / p.depth
            guard x > -10, x < W + 10, y > -10, y < H + 10 else { continue }

            // Flimring og svinn i dybden
            let twinkle = 0.62 + 0.38 * sin(t * p.speed + p.phase * 6.2831)
            let sparkle = pow(max(0, sin(t * p.speed * 0.37 + p.phase * 17)), 24) * 0.9
            let far = 1 - smooth(30, 58, p.depth)
            let alpha = p.bright * (twinkle + sparkle) * far
            guard alpha > 0.02 else { continue }

            let r: Double = min(5, max(0.6, p.size * f / p.depth / 2))
            ctx.fill(Path(ellipseIn: CGRect(x: x - r * 1.8, y: y - r * 1.8, width: r * 3.6, height: r * 3.6)),
                     with: .color(p.color.opacity(alpha * 0.22)))
            ctx.fill(Path(ellipseIn: CGRect(x: x - r * 0.6, y: y - r * 0.6, width: r * 1.2, height: r * 1.2)),
                     with: .color(p.color.opacity(min(1, alpha))))
        }
    }

    private func smooth(_ a: Double, _ b: Double, _ x: Double) -> Double {
        let t = max(0, min(1, (x - a) / (b - a)))
        return t * t * (3 - 2 * t)
    }

    private static func make(_ count: Int) -> [Particle] {
        (0..<count).map { _ in
            let tint = Double.random(in: 0...1)
            return Particle(
                nx: .random(in: -1.25...1.25),
                ny: .random(in: -1.25...1.25),
                depth: 3 + pow(Double.random(in: 0...1), 0.8) * 50,
                size: .random(in: 0.025...0.09),
                bright: .random(in: 0.25...0.95),
                phase: .random(in: 0...1),
                speed: .random(in: 0.6...2.6),
                color: colors[tint < 0.55 ? 0 : tint < 0.85 ? 1 : 2]
            )
        }
    }
}
