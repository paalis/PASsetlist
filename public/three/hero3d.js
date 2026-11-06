// Kobler den felles 3D-scenen til hero-seksjonen på forsiden.
//
// app.js sender «hero:render» hver gang forsiden tegnes (detail = hero-elementet)
// og «hero:leave» når man går til redigeringen. Siden forsiden tegnes på nytt med
// innerHTML, flyttes det eksisterende canvaset inn i den nye hero-seksjonen i stedet
// for å lage et nytt. Alt ryddes bort når man forlater forsiden.
//
// Lag i hero:  bilde (-1) → canvas (0) → publikum foran (1) → korn (2) → tekst (3)

import { createStage } from './stage.js';
import { createEqualizer } from './equalizer.js';
import { createParticleField } from './particles.js';
import { createCameraRig } from './camera-rig.js';

let stage = null;
let starting = null;
let generation = 0;

function cssAccent() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return value || '#ff3d3d';
}

// Toner ut hele canvaset (bare opacity) i siste del av scroll-effekten
function createScrollFade(canvas) {
  let last = -1;
  return {
    update(_t, _dt, state) {
      const p = Math.min(1, Math.max(0, (state.scroll - 0.35) / 0.55));
      const opacity = Math.round((1 - p * p * (3 - 2 * p)) * 1000) / 1000;
      if (opacity !== last) {
        canvas.style.opacity = opacity;
        last = opacity;
      }
    },
  };
}

async function ensureStage() {
  if (stage) return stage;
  if (starting) return starting;
  const promise = (starting = (async () => {
    const s = await createStage({ fov: 45, cameraZ: 10 });
    if (!s) return null; // ingen WebGL: behold bare bakgrunnsbildet
    s.add(createParticleField(s.THREE, { count: 4000, cameraZ: 10, fov: 45 })); // bakerst (2000 på mobil)
    s.add(createEqualizer(s.THREE, { accent: cssAccent() }));
    s.add(createCameraRig({ strengthX: 0.8, strengthY: 0.45, travel: 6 })); // musparallakse + scroll
    s.add(createScrollFade(s.canvas)); // canvaset tones ut mot «Mine setlister»
    if (starting === promise) stage = s;
    return s;
  })());
  return promise;
}

async function mount(hero) {
  if (!hero) return;
  const mine = ++generation;
  const s = await ensureStage();
  if (!s || mine !== generation || !hero.isConnected) return;
  s.mount(hero, hero.querySelector('.hero-crowd-front'));
  hero.classList.add('has-3d');
  // Mistet grafikkontekst: fjern 3D-laget og behold bare bildet
  s.onContextLost = () => {
    document.querySelector('.hero')?.classList.remove('has-3d');
    leave();
  };
}

function leave() {
  generation++;
  const current = stage;
  const pending = starting;
  stage = null;
  starting = null;
  if (current) current.dispose();
  else if (pending) {
    // Scenen var fortsatt under oppstart – rydd den når den er klar
    pending.then((s) => {
      if (s && s !== stage) s.dispose();
    });
  }
}

window.addEventListener('hero:render', (e) => mount(e.detail));
window.addEventListener('hero:leave', leave);

// app.js kan ha tegnet forsiden før denne modulen ble lastet
mount(document.querySelector('.hero'));

// For testing/feilsøking: gir tilgang til scenen (null når den ikke finnes)
export function debugStage() {
  return stage;
}
