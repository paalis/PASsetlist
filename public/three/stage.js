// Felles Three.js-scene: én canvas, én renderer, én scene, ett kamera og én render-loop.
// Flere 3D-elementer kan legges til med stage.add({ object3d, update, resize, dispose }).
//
//   const stage = await createStage();          // null hvis WebGL ikke støttes
//   stage.mount(heroElement, beforeNode);        // flytter canvaset inn i en (ny) vert
//   stage.add(element);                          // element.update(t, dt, stage.state)
//   stage.unmount(); stage.dispose();
//
// stage.state inneholder pekerposisjon (myk), scroll-fremdrift og flagg for mobil og
// redusert bevegelse, slik at alle elementer kan reagere likt.

let THREE = null;
export async function loadThree() {
  THREE ||= await import('../vendor/three/three.module.min.js');
  return THREE;
}

export function webglSupported() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (_) {
    return false;
  }
}

export async function createStage({ fov = 45, cameraZ = 10 } = {}) {
  if (!webglSupported()) return null;
  const T = await loadThree();

  let renderer;
  try {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (_) {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = T.SRGBColorSpace;

  const canvas = renderer.domElement;
  canvas.className = 'stage-canvas';
  canvas.setAttribute('aria-hidden', 'true');

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(fov, 1, 0.1, 200);
  camera.position.set(0, 0, cameraZ);

  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fineQuery = window.matchMedia('(hover: hover) and (pointer: fine)');

  const state = {
    width: 1,
    height: 1,
    aspect: 1,
    mobile: false,
    reducedMotion: reduceQuery.matches,
    pointer: { x: 0, y: 0, active: false }, // -1..1, myk (lerp)
    pointerTarget: { x: 0, y: 0 },
    scroll: 0, // 0 = toppen, 1 = effekten er fullført (se updateScroll)
    scrollable: false,
    time: 0,
  };

  const elements = new Set();
  let host = null;
  let running = false;
  let visible = true;
  let inView = true;
  let raf = 0;
  let last = 0;

  const updateFlags = () => {
    state.reducedMotion = reduceQuery.matches;
    state.mobile = !fineQuery.matches || window.innerWidth < 760;
  };

  function resize() {
    if (!host) return;
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    updateFlags();
    updateScroll();
    state.width = w;
    state.height = h;
    state.aspect = w / h;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = state.aspect;
    camera.updateProjectionMatrix();
    for (const el of elements) el.resize?.(state, camera);
    renderOnce();
  }

  // Scroll-fremdrift 0..1, tilpasset hvor langt siden faktisk kan rulles: med få
  // setlister er siden kort, så effekten fullføres over den avstanden som finnes
  // (men aldri over mer enn 60 % av vertens høyde).
  function updateScroll() {
    if (!host) return;
    const r = host.getBoundingClientRect();
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    state.scrollable = maxScroll >= 24;
    if (!state.scrollable) {
      state.scroll = 0;
      return;
    }
    const distance = Math.max(1, Math.min(r.height * 0.6, maxScroll));
    state.scroll = Math.min(1, Math.max(0, -r.top / distance));
  }

  const onPointer = (e) => {
    if (state.mobile) return;
    state.pointerTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
    state.pointerTarget.y = -((e.clientY / window.innerHeight) * 2 - 1);
    state.pointer.active = true;
  };
  const onPointerLeave = () => {
    state.pointerTarget.x = 0;
    state.pointerTarget.y = 0;
    state.pointer.active = false;
  };
  const onScroll = () => {
    updateScroll();
    if (!running) renderOnce();
  };
  const onVisibility = () => {
    visible = document.visibilityState === 'visible';
    syncLoop();
  };
  const onMotionChange = () => {
    updateFlags();
    syncLoop();
    renderOnce();
  };

  const resizeObserver = new ResizeObserver(() => resize());
  const intersection = new IntersectionObserver((entries) => {
    inView = entries.some((e) => e.isIntersecting);
    syncLoop();
  });

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    tick(dt);
  }

  function tick(dt) {
    state.time += dt;
    // Myk pekerbevegelse (lerp) – uavhengig av bildefrekvens
    const k = 1 - Math.pow(0.001, dt);
    state.pointer.x += (state.pointerTarget.x - state.pointer.x) * k;
    state.pointer.y += (state.pointerTarget.y - state.pointer.y) * k;
    for (const el of elements) el.update?.(state.time, dt, state, camera);
    renderer.render(scene, camera);
  }

  function renderOnce() {
    if (!host || running) return;
    for (const el of elements) el.update?.(state.time, 0, state, camera);
    renderer.render(scene, camera);
  }

  function syncLoop() {
    const shouldRun = !!host && visible && inView && !state.reducedMotion && elements.size > 0;
    if (shouldRun && !running) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else if (!shouldRun && running) {
      running = false;
      cancelAnimationFrame(raf);
      renderOnce();
    }
  }

  const stage = {
    THREE: T,
    renderer,
    scene,
    camera,
    canvas,
    state,

    /** Flytt canvaset inn i en vert (f.eks. en ny hero etter at siden er tegnet på nytt). */
    mount(newHost, before = null) {
      if (host !== newHost) {
        if (host) {
          resizeObserver.unobserve(host);
          intersection.unobserve(host);
        }
        host = newHost;
        resizeObserver.observe(host);
        intersection.observe(host);
      }
      if (canvas.parentNode !== host || canvas.nextSibling !== before) host.insertBefore(canvas, before);
      updateScroll();
      resize();
      syncLoop();
    },

    unmount() {
      if (host) {
        resizeObserver.unobserve(host);
        intersection.unobserve(host);
      }
      host = null;
      canvas.remove();
      syncLoop();
    },

    add(element) {
      elements.add(element);
      if (element.object3d) scene.add(element.object3d);
      element.resize?.(state, camera);
      syncLoop();
      renderOnce();
      return element;
    },

    remove(element) {
      elements.delete(element);
      if (element.object3d) scene.remove(element.object3d);
      element.dispose?.();
      syncLoop();
    },

    /** Rydder alt: elementer, GPU-ressurser og lyttere. */
    dispose() {
      stage.unmount();
      for (const el of [...elements]) stage.remove(el);
      resizeObserver.disconnect();
      intersection.disconnect();
      window.removeEventListener('pointermove', onPointer);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
      reduceQuery.removeEventListener('change', onMotionChange);
      fineQuery.removeEventListener('change', onMotionChange);
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };

  window.addEventListener('pointermove', onPointer, { passive: true });
  document.documentElement.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  reduceQuery.addEventListener('change', onMotionChange);
  fineQuery.addEventListener('change', onMotionChange);
  updateFlags();

  return stage;
}
