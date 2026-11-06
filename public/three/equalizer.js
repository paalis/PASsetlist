// 3D-equalizer: en rad søyler (én InstancedMesh) som ekko av logoen – mørkt, blankt
// blått med kantlys, og røde topper på de høyeste søylene.
//
// Høydene kommer fra en utskiftbar kilde:  source(tid, ut: Float32Array) -> fyller 0..1
//   - staticSource(n)        stillestående mønster (redusert bevegelse)
//   - fakeSource(n)          lydløs, organisk animasjon (lagdelte sinuser + støy)
//   - analyserSource(node)   ekte lyd fra en Web Audio AnalyserNode (ikke koblet til ennå)
//
// Bytt kilde når som helst:  equalizer.setSource(analyserSource(analyser))

const MAX_BARS = 28;

/* ---------- Kilder ---------- */

const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const smooth = (t) => t * t * (3 - 2 * t);
/** 1D verdistøy, -1..1 */
const noise = (x) => {
  const i = Math.floor(x);
  const f = x - i;
  return (hash(i) + (hash(i + 1) - hash(i)) * smooth(f)) * 2 - 1;
};

/** Stillestående mønster som likevel ser ut som en equalizer. */
export function staticSource(count) {
  return (_t, out) => {
    for (let i = 0; i < count; i++) {
      out[i] = 0.32 + 0.22 * Math.sin(i * 0.9 + 0.6) + 0.14 * Math.sin(i * 2.3 + 1.1) + 0.1 * hash(i * 3.7);
    }
  };
}

/** Lydløs equalizer: tre sinuslag + støy med egen fase per søyle, og en svak felles puls. */
export function fakeSource(count, seed = 7) {
  const bars = Array.from({ length: count }, (_, i) => ({
    p1: hash(seed + i * 1.37) * Math.PI * 2,
    p2: hash(seed + i * 2.71) * Math.PI * 2,
    p3: hash(seed + i * 4.13) * Math.PI * 2,
    f1: 0.35 + hash(seed + i * 5.3) * 0.3,
    f2: 0.9 + hash(seed + i * 6.1) * 0.6,
    f3: 2.0 + hash(seed + i * 7.9) * 1.2,
    n: hash(seed + i * 9.7) * 100,
  }));
  return (t, out) => {
    // Felles «slag» som kommer og går, så det ikke gjentar seg tydelig
    const pulse = Math.pow(Math.max(0, Math.sin(t * 2.05)), 6) * (0.5 + 0.5 * noise(t * 0.21));
    for (let i = 0; i < count; i++) {
      const b = bars[i];
      let v =
        0.34 +
        0.17 * Math.sin(t * b.f1 + b.p1) +
        0.1 * Math.sin(t * b.f2 + b.p2 + i * 0.45) +
        0.05 * Math.sin(t * b.f3 + b.p3) +
        0.16 * noise(t * 0.65 + b.n) +
        0.08 * pulse;
      out[i] = Math.min(1, Math.max(0.04, v));
    }
  };
}

/**
 * Ekte lyd: fordeler frekvensbånd fra en AnalyserNode på søylene (logaritmisk).
 * Brukes slik (ikke i bruk nå):
 *   const analyser = audioCtx.createAnalyser(); analyser.fftSize = 512;
 *   kilde.connect(analyser);
 *   equalizer.setSource(analyserSource(analyser));
 */
export function analyserSource(analyser) {
  const bins = new Uint8Array(analyser.frequencyBinCount);
  return (_t, out) => {
    analyser.getByteFrequencyData(bins);
    const n = out.length;
    for (let i = 0; i < n; i++) {
      const a = Math.floor(Math.pow(i / n, 2) * bins.length);
      const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / n, 2) * bins.length));
      let sum = 0;
      for (let j = a; j < b; j++) sum += bins[j];
      out[i] = sum / (b - a) / 255;
    }
  };
}

/* ---------- Søylene ---------- */

const vertexShader = /* glsl */ `
  attribute float aAccent;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vY;
  varying float vAccent;
  void main() {
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    vY = position.y;            // 0 nederst, 1 øverst (uavhengig av høyden)
    vAccent = aAccent;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uBase;
  uniform vec3 uRim;
  uniform vec3 uAccent;
  uniform vec3 uLightDir;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vY;
  varying float vAccent;
  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vView);
    vec3 L = normalize(uLightDir);

    // Mørk, blank flate: svak diffus + smalt glanspunkt fra ett lys ovenfra/forfra
    vec3 color = mix(uDeep, uBase, smoothstep(0.0, 1.0, vY));
    color *= 0.4 + 0.6 * max(dot(N, L), 0.0);
    float spec = pow(max(dot(N, normalize(L + V)), 0.0), 48.0);

    // Rød topp på de høyeste søylene
    float cap = smoothstep(0.7, 0.97, vY) * vAccent;
    color = mix(color, uAccent, cap * 0.9);

    // Myk kantbelysning (fresnel) og lysende toppflate
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.4);
    float top = smoothstep(0.85, 1.0, N.y);
    color += uRim * rim * 1.0;
    color += mix(uRim * 0.55, uAccent * 1.1, vAccent) * top * 0.6;
    color += vec3(0.75, 0.85, 1.0) * spec * 0.4;

    gl_FragColor = vec4(color, uOpacity);
    #include <colorspace_fragment>
  }
`;

/**
 * @param THREE  Three.js-modulen (fra stage.THREE)
 * @param opts.accent  CSS-farge for aksent (hentes fra --accent)
 */
export function createEqualizer(THREE, { accent = '#ff3d3d', animated = true, cameraZ = 10 } = {}) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0); // søylene vokser oppover fra bunnen

  const accentAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BARS), 1);
  accentAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aAccent', accentAttr);

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    uniforms: {
      uDeep: { value: new THREE.Color('#030a1c') },
      uBase: { value: new THREE.Color('#14479c') },
      uRim: { value: new THREE.Color('#5aa2ff') },
      uAccent: { value: new THREE.Color(accent) },
      uLightDir: { value: new THREE.Vector3(0.3, 1, 0.8) },
      uOpacity: { value: 1 },
    },
  });

  const mesh = new THREE.InstancedMesh(geometry, material, MAX_BARS);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;

  const levels = new Float32Array(MAX_BARS); // utjevnet
  const targets = new Float32Array(MAX_BARS); // rått fra kilden
  const layout = Array.from({ length: MAX_BARS }, () => ({ x: 0, z: 0, env: 1 }));
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();

  let count = 0;
  let view = targets; // targets.subarray(0, count)
  let source = null;
  let sourceFactory = null;
  let custom = null; // egen kilde satt med setSource()
  let dims = { width: 1, depth: 1, baseY: 0, maxH: 1, halfW: 1 };
  let primed = false;

  function resize(state, camera) {
    const wanted = state.mobile ? 14 : MAX_BARS;
    const factory = state.reducedMotion || !animated ? staticSource : fakeSource;
    let rebuilt = false;
    if (wanted !== count) {
      count = wanted;
      mesh.count = count;
      view = targets.subarray(0, count);
      primed = false;
      rebuilt = true;
    }
    if (custom) source = custom;
    else if (rebuilt || factory !== sourceFactory || !source) {
      sourceFactory = factory;
      source = factory(count);
      primed = false;
    }

    // Synlig flate i dybden z = 0
    // Fast referanseavstand (kameraets startposisjon) – kameraet flytter seg ved scroll
    const visH = 2 * cameraZ * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const visW = visH * state.aspect;
    const span = visW * 1.12; // litt utenfor kantene
    const step = span / count;
    dims = {
      width: step * 0.56,
      depth: step * 0.5,
      // Bunnen står skjult bak publikummet; toppene stikker opp over hodene
      baseY: -visH / 2 + visH * (state.mobile ? 0.21 : 0.2),
      maxH: visH * (state.mobile ? 0.2 : 0.28),
      halfW: visW / 2,
    };
    for (let i = 0; i < count; i++) {
      const u = count === 1 ? 0 : (i / (count - 1)) * 2 - 1; // -1..1
      layout[i].x = u * (span / 2);
      layout[i].z = -2.2 * u * u; // lett bue: kantene ligger lenger bak
      // Demp søylene der tekst og knapper står (venstre side). På mobil går knappene
      // nesten helt ut mot høyre, så der stiger søylene bare helt ute til høyre.
      layout[i].env = state.mobile
        ? 0.12 + 0.88 * smooth(Math.min(1, Math.max(0, (u - 0.2) / 0.55)))
        : 0.28 + 0.72 * smooth(Math.min(1, Math.max(0, (u + 0.35) / 0.65)));
    }
  }

  function update(t, dt, state) {
    if (!source) return;
    source(t, view);

    // Mus: de nærmeste søylene løftes litt
    const px = state.pointer.x * dims.halfW;
    const lifting = state.pointer.active && !state.mobile && !state.reducedMotion;

    // Scroll: skaler ned og fade ut før «Mine setlister»
    const s = state.scroll;
    const fade = 1 - smooth(Math.min(1, Math.max(0, (s - 0.12) / 0.4)));
    material.uniforms.uOpacity.value = fade;
    mesh.visible = fade > 0.001;

    const k = primed && dt > 0 ? 1 - Math.exp(-dt * 7) : 1;
    primed = true;
    for (let i = 0; i < count; i++) {
      const L = layout[i];
      let target = targets[i];
      if (lifting) {
        const d = (L.x - px) / (dims.halfW * 0.16);
        target += 0.28 * Math.exp(-d * d);
      }
      levels[i] += (target - levels[i]) * k;
      const level = Math.min(1.15, levels[i]);
      const h = Math.max(0.02, dims.maxH * L.env * level * (0.35 + 0.65 * fade));
      pos.set(L.x, dims.baseY, L.z);
      scl.set(dims.width, h, dims.depth);
      m.compose(pos, quat, scl);
      mesh.setMatrixAt(i, m);
      accentAttr.array[i] = smooth(Math.min(1, Math.max(0, (level * L.env - 0.42) / 0.3)));
    }
    mesh.instanceMatrix.needsUpdate = true;
    accentAttr.needsUpdate = true;
  }

  return {
    object3d: mesh,
    resize,
    update,
    /** Bytt høydekilde, f.eks. til analyserSource(analyser). */
    setSource(fn) {
      custom = fn;
      source = fn || (sourceFactory && sourceFactory(count));
      primed = false;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose?.();
    },
  };
}
