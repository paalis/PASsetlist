// Subtil 3D-tilt etter musepekeren – ren CSS + litt vanilla JS.
//
//   initTilt('.hero h1', { area: '.hero', max: 7 });   // tilt når pekeren er over hero
//   initTilt('.card', { max: 5 });                      // tilt når pekeren er over kortet
//
// Funksjonen skriver bare CSS-variabler på elementet, og CSS bestemmer utseendet:
//   --tilt-x, --tilt-y   -1..1  pekerens posisjon (myk)
//   --tilt-on            0..1   hvor «aktivt» elementet er (for løft og lysglimt)
//   --tilt-mx, --tilt-my 0..100% pekerens posisjon i elementet (for lysglimt)
//   --tilt-max           maks vinkel i grader (fra options.max)
// Klassen .is-tilting settes mens elementet beveger seg (brukes til will-change).
//
// Én lytter på dokumentet (delegering), så det virker også på elementer som
// tegnes på nytt med innerHTML. Kun på enheter med hover og fin peker, og ikke
// når brukeren har bedt om redusert bevegelse.

export function initTilt(selector, { area = null, max = 6, ease = 0.14 } = {}) {
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const enabled = () => fine.matches && !reduce.matches;

  const states = new Map(); // element -> { x, y, on, tx, ty, ton, mx, my }
  let raf = 0;
  let last = 0;

  const stateFor = (el) => {
    let s = states.get(el);
    if (!s) {
      s = { x: 0, y: 0, on: 0, tx: 0, ty: 0, ton: 0, mx: 50, my: 50 };
      states.set(el, s);
      el.classList.add('is-tilting');
      el.style.setProperty('--tilt-max', max);
    }
    return s;
  };

  function release(except = null) {
    for (const [el, s] of states) {
      if (el === except) continue;
      s.tx = 0;
      s.ty = 0;
      s.ton = 0;
    }
    schedule();
  }

  function onMove(e) {
    if (!enabled()) return;
    const zone = e.target.closest?.(area || selector);
    if (!zone) return release();
    const el = area ? zone.querySelector(selector) : zone;
    if (!el) return release();

    const r = zone.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const s = stateFor(el);
    s.tx = px * 2 - 1;
    s.ty = py * 2 - 1;
    s.ton = 1;
    if (el !== zone) {
      // Lysglimtet følger pekeren i selve elementet
      const er = el.getBoundingClientRect();
      s.mx = ((e.clientX - er.left) / er.width) * 100;
      s.my = ((e.clientY - er.top) / er.height) * 100;
    } else {
      s.mx = px * 100;
      s.my = py * 100;
    }
    release(el);
  }

  function frame(now) {
    raf = 0;
    // Utjevning uavhengig av bildefrekvens (ease er andelen per 60-dels sekund)
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    const k = 1 - Math.pow(1 - ease, dt * 60);
    let moving = false;
    for (const [el, s] of states) {
      s.x += (s.tx - s.x) * k;
      s.y += (s.ty - s.y) * k;
      s.on += (s.ton - s.on) * k;
      const settled = Math.abs(s.x) + Math.abs(s.y) + s.on < 0.002 && s.ton === 0;
      if (settled || !el.isConnected) {
        for (const p of ['--tilt-x', '--tilt-y', '--tilt-on', '--tilt-mx', '--tilt-my', '--tilt-max']) el.style.removeProperty(p);
        el.classList.remove('is-tilting');
        states.delete(el);
        continue;
      }
      el.style.setProperty('--tilt-x', s.x.toFixed(4));
      el.style.setProperty('--tilt-y', s.y.toFixed(4));
      el.style.setProperty('--tilt-on', s.on.toFixed(4));
      el.style.setProperty('--tilt-mx', `${s.mx.toFixed(1)}%`);
      el.style.setProperty('--tilt-my', `${s.my.toFixed(1)}%`);
      moving = true;
    }
    if (moving) schedule();
    else last = 0;
  }

  function schedule() {
    if (!raf && states.size) raf = requestAnimationFrame(frame);
  }

  const onLeave = () => release();
  const onChange = () => !enabled() && release();

  document.addEventListener('pointermove', onMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', onLeave);
  fine.addEventListener('change', onChange);
  reduce.addEventListener('change', onChange);

  return function destroy() {
    document.removeEventListener('pointermove', onMove);
    document.documentElement.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('blur', onLeave);
    fine.removeEventListener('change', onChange);
    reduce.removeEventListener('change', onChange);
    cancelAnimationFrame(raf);
    for (const el of states.keys()) {
      el.classList.remove('is-tilting');
      for (const p of ['--tilt-x', '--tilt-y', '--tilt-on', '--tilt-mx', '--tilt-my', '--tilt-max']) el.style.removeProperty(p);
    }
    states.clear();
  };
}
