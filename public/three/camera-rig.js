// Kamerarigg for musparallakse: kameraet glir litt sideveis og opp/ned etter pekeren
// og ser hele tiden mot et punkt langt bak i scenen. Nære objekter forskyves da mer
// enn fjerne – det gir dybde. Ekstra myk utjevning (lerp) oppå stage.state.pointer.
//
//   stage.add(createCameraRig({ strengthX: 0.8, strengthY: 0.45 }));
//
// Av på mobil/touch og ved redusert bevegelse (kameraet glir da tilbake til midten).

export function createCameraRig({ strengthX = 0.8, strengthY = 0.45, smoothing = 2.2, lookAtZ = -30 } = {}) {
  const offset = { x: 0, y: 0 };
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
      camera.position.x = base.x + offset.x;
      camera.position.y = base.y + offset.y;
      camera.lookAt(0, 0, lookAtZ);
    },
    dispose() {},
  };
}
