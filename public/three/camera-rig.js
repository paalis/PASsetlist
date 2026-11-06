// Kamerarigg for musparallakse: kameraet glir litt sideveis og opp/ned etter pekeren
// og ser hele tiden mot et punkt langt bak i scenen. Nære objekter forskyves da mer
// enn fjerne – det gir dybde. Ekstra myk utjevning (lerp) oppå stage.state.pointer.
//
//   stage.add(createCameraRig({ strengthX: 0.8, strengthY: 0.45 }));
//
// Ved scroll flyr kameraet fremover (travel). Musparallaksen er av på mobil/touch,
// og ved redusert bevegelse står kameraet helt stille.

const smoothstep = (t) => t * t * (3 - 2 * t);

export function createCameraRig({ strengthX = 0.8, strengthY = 0.45, smoothing = 2.2, lookAtZ = -30, travel = 6 } = {}) {
  const offset = { x: 0, y: 0, z: 0 };
  let base = null;

  return {
    object3d: null,
    resize(_state, camera) {
      base ||= { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    },
    update(_t, dt, state, camera) {
      if (!base) base = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
      const allowed = !state.mobile && !state.reducedMotion;
      const tx = allowed ? state.pointer.x * strengthX : 0;
      const ty = allowed ? state.pointer.y * strengthY : 0;
      // Rolig, bildefrekvensuavhengig utjevning
      const k = dt > 0 ? 1 - Math.exp(-dt * smoothing) : 1;
      offset.x += (tx - offset.x) * k;
      offset.y += (ty - offset.y) * k;
      // Scroll: kameraet flyr fremover gjennom partiklene (ikke ved redusert bevegelse)
      const tz = state.reducedMotion ? 0 : -smoothstep(state.scroll) * travel;
      const kz = dt > 0 ? 1 - Math.exp(-dt * 6) : 1;
      offset.z += (tz - offset.z) * kz;
      camera.position.x = base.x + offset.x;
      camera.position.y = base.y + offset.y;
      camera.position.z = base.z + offset.z;
      camera.lookAt(0, 0, lookAtZ);
    },
    dispose() {},
  };
}
