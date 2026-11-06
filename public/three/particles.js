// Partikkelfelt: tusenvis av små lyspunkter i et dypt volum, som lys i luften i en
// mørk konsertsal. Ett THREE.Points-objekt med egen shader for størrelse, lysstyrke,
// flimring og sakte drift (alt regnes på GPU-en, ingenting per partikkel i JS).
//
//   const field = createParticleField(THREE, { count: 4000 });
//   stage.add(field);                 // tegnes før søylene (renderOrder -1)
//   field.setOpacity(0.5);            // f.eks. ved scroll

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uScale;      // piksler per verdensenhet ved avstand 1
  uniform float uPixelRatio;
  attribute float aSize;
  attribute float aBright;
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aTint;
  attribute float aSpan;     // høyden partikkelen kan drive innenfor før den går rundt
  varying float vAlpha;
  varying float vTint;

  void main() {
    vec3 p = position;
    // Veldig sakte drift: litt sideveis bølging og en langsom stigning oppover
    float t = uTime;
    p.x += sin(t * 0.06 + aPhase * 6.2831) * 0.35;
    p.z += cos(t * 0.045 + aPhase * 4.1) * 0.35;
    p.y += sin(t * 0.05 + aPhase * 3.7) * 0.25 + t * 0.035 * (0.5 + aSpeed * 0.25);
    p.y = mod(p.y + aSpan * 0.5, aSpan) - aSpan * 0.5;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = -mv.z;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * uScale / dist, 1.2, 10.0) * uPixelRatio;

    // Flimring: hver partikkel pulserer i sitt eget tempo, noen glimter innimellom
    float tw = 0.62 + 0.38 * sin(t * aSpeed + aPhase * 6.2831);
    float sparkle = pow(max(0.0, sin(t * aSpeed * 0.37 + aPhase * 17.0)), 24.0) * 0.9;
    // Svinn i dybden: svakere langt borte, og borte helt nær kameraet
    float far = 1.0 - smoothstep(30.0, 58.0, dist);
    float near = smoothstep(0.6, 2.5, dist);
    vAlpha = aBright * (tw + sparkle) * far * near;
    vTint = aTint;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uBlue;
  uniform vec3 uIce;
  uniform vec3 uWhite;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vTint;

  void main() {
    // Myk, rund prikk med lysere kjerne
    float d = length(gl_PointCoord - 0.5);
    float glow = smoothstep(0.5, 0.0, d);
    float core = smoothstep(0.16, 0.0, d);
    float a = (glow * glow * 0.9 + core * 0.7) * vAlpha * uOpacity;
    if (a < 0.003) discard;
    vec3 color = mix(uBlue, uIce, smoothstep(0.0, 0.7, vTint));
    color = mix(color, uWhite, smoothstep(0.75, 1.0, vTint) + core * 0.35);
    gl_FragColor = vec4(color, a); // additiv blending ganger selv med alfa
    #include <colorspace_fragment>
  }
`;

// Enkel, deterministisk tilfeldighet så feltet ser likt ut hver gang
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createParticleField(THREE, { count = 4000, cameraZ = 10, fov = 45, seed = 42 } = {}) {
  const rand = random(seed);
  const position = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const bright = new Float32Array(count);
  const phase = new Float32Array(count);
  const speed = new Float32Array(count);
  const tint = new Float32Array(count);
  const span = new Float32Array(count);

  const tanHalf = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const nearZ = cameraZ - 1.5;   // nærmeste partikler
  const farZ = -48;              // dypeste partikler
  const maxAspect = 2.3;         // dekker også brede skjermer

  for (let i = 0; i < count; i++) {
    // Flere partikler i dybden (volumet vokser bakover), så det ikke blir et flatt teppe
    const z = farZ + (nearZ - farZ) * Math.pow(rand(), 0.75);
    const dist = cameraZ - z;
    const halfH = dist * tanHalf * 1.15;
    const halfW = halfH * maxAspect;
    position[i * 3] = (rand() * 2 - 1) * halfW;
    position[i * 3 + 1] = (rand() * 2 - 1) * halfH;
    position[i * 3 + 2] = z;
    span[i] = halfH * 2;

    // De fleste er små og svake, noen få er større og klarere
    const r = rand();
    size[i] = 0.06 + Math.pow(r, 3) * 0.2;
    bright[i] = 0.45 + Math.pow(rand(), 1.4) * 0.55;
    phase[i] = rand();
    speed[i] = 0.6 + rand() * 2.2;
    tint[i] = rand();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geometry.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
  geometry.setAttribute('aSpan', new THREE.BufferAttribute(span, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false, // tegnes som bakgrunnslag; søylene legger seg alltid foran
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 400 },
      uPixelRatio: { value: 1 },
      uOpacity: { value: 1 },
      uBlue: { value: new THREE.Color('#2f7dff') },
      uIce: { value: new THREE.Color('#9fd4ff') },
      uWhite: { value: new THREE.Color('#eef7ff') },
    },
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -1;

  return {
    object3d: points,
    get visibleCount() {
      return geometry.drawRange.count === Infinity ? count : Math.min(count, geometry.drawRange.count);
    },
    resize(state, camera) {
      // Mobil/smal skjerm: tegn bare halvparten (første halvdel er et jevnt, tilfeldig utvalg)
      geometry.setDrawRange(0, state.mobile ? Math.floor(count / 2) : count);
      // Piksler per verdensenhet ved avstand 1 – gir riktig perspektivstørrelse
      material.uniforms.uScale.value = state.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2);
    },
    update(t) {
      material.uniforms.uTime.value = t;
    },
    setOpacity(value) {
      material.uniforms.uOpacity.value = value;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
