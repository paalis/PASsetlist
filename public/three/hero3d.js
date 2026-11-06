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

let stage = null;
let starting = null;
let generation = 0;

function cssAccent() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return value || '#ff3d3d';
}

async function ensureStage() {
  if (stage) return stage;
  if (starting) return starting;
  const promise = (starting = (async () => {
    const s = await createStage({ fov: 45, cameraZ: 10 });
    if (!s) return null; // ingen WebGL: behold bare bakgrunnsbildet
    s.add(createEqualizer(s.THREE, { accent: cssAccent() }));
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
