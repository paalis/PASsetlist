// Notevisning / scenemodus med Pencil-notater.
//
// Viser alle filene (PDF, bilde, tekst) i setlistens rekkefølge i fullskjerm.
//  - Apple Pencil tegner alltid. Fingeren blar (sveip, eller trykk i venstre/høyre kant).
//  - Med mus/styreflate: slå på «Tegn» for å tegne, ellers blar man med pilknappene.
//  - Taster/pedal: → ↓ mellomrom PageDown = neste, ← ↑ PageUp = forrige, Esc = lukk.
// Notatene lagres per side i Firestore (window.cloud) og synkroniseres med bandet.
//
// Koordinatene i notatene er normalisert (0–1) til siden, så de passer uansett
// skjermstørrelse – og i noteheftet (se buildSongbook i app.js).

const PDFJS = '/vendor/pdfjs/';
const A4 = [595.28, 841.89];
const PEN_WIDTH = 0.0032; // andel av sidebredden
const MARKER_WIDTH = 0.022;
const MARKER_COLOR = '#ffd400';
const COLORS = [
  { name: 'Rød', value: '#e5243b' },
  { name: 'Blå', value: '#1f6feb' },
  { name: 'Svart', value: '#111111' },
];

let pdfjsLib = null;
async function loadPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import(`${PDFJS}pdf.min.mjs`);
    pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.mjs`;
  }
  return pdfjsLib;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/* ---------- Tegning av streker (brukes for både lagrede og pågående streker) ---------- */

function drawStroke(ctx, st, W, H) {
  const p = st.p;
  if (!p || p.length < 3) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (st.t === 'marker') {
    ctx.globalAlpha = 0.38;
    ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = st.c || MARKER_COLOR;
    ctx.lineWidth = st.w * W;
    ctx.beginPath();
    ctx.moveTo(p[0] * W, p[1] * H);
    for (let i = 3; i < p.length; i += 3) ctx.lineTo(p[i] * W, p[i + 1] * H);
    if (p.length === 3) ctx.lineTo(p[0] * W + 0.01, p[1] * H);
    ctx.stroke();
  } else {
    ctx.strokeStyle = st.c;
    ctx.fillStyle = st.c;
    if (p.length === 3) {
      ctx.beginPath();
      ctx.arc(p[0] * W, p[1] * H, (st.w * W * (0.4 + 0.8 * p[2])) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 3; i < p.length; i += 3) {
      ctx.lineWidth = st.w * W * (0.4 + 0.8 * ((p[i - 1] + p[i + 2]) / 2));
      ctx.beginPath();
      ctx.moveTo(p[i - 3] * W, p[i - 2] * H);
      ctx.lineTo(p[i] * W, p[i + 1] * H);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/* ---------- Visningen ---------- */

/**
 * @param opts.sl          setlisten
 * @param opts.startFileId åpne på denne filen (valgfritt)
 * @param opts.fileKind    (type, navn) -> 'pdf' | 'image' | 'text' | null
 * @param opts.textLayout  (tekst) -> sider med linjer (samme oppsett som noteheftet)
 */
export async function openViewer({ sl, startFileId = null, startItemId = null, fileKind, textLayout }) {
  const cloud = window.cloud;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  const root = document.createElement('div');
  root.className = 'viewer';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Notevisning');
  root.innerHTML = `
    <header class="viewer-bar">
      <button type="button" class="vbtn" data-v="close" aria-label="Lukk">✕</button>
      <button type="button" class="viewer-title" data-v="songs" aria-haspopup="true" aria-expanded="false" title="Hopp til en annen låt">
        <b></b><small></small>
      </button>
      <div class="viewer-tools" role="toolbar" aria-label="Notatverktøy">
        ${fine ? '<button type="button" class="vbtn draw-toggle" data-v="draw" aria-pressed="false" title="Tegn med musen">✎ Tegn</button>' : ''}
        ${COLORS.map((c, i) => `<button type="button" class="vbtn swatch${i === 0 ? ' on' : ''}" data-color="${c.value}" style="--c:${c.value}" aria-label="Penn ${c.name}" title="Penn – ${c.name.toLowerCase()}"></button>`).join('')}
        <button type="button" class="vbtn tool" data-tool="marker" title="Markør" aria-label="Markør">▮</button>
        <button type="button" class="vbtn tool" data-tool="eraser" title="Viskelær" aria-label="Viskelær">⌫</button>
        <button type="button" class="vbtn" data-v="undo" title="Angre" aria-label="Angre">↶</button>
      </div>
      <span class="viewer-count"></span>
    </header>
    <div class="viewer-stage">
      <div class="viewer-page">
        <canvas class="vc-page"></canvas>
        <canvas class="vc-ink"></canvas>
        <canvas class="vc-live"></canvas>
      </div>
      <button type="button" class="viewer-nav prev" data-v="prev" aria-label="Forrige side">‹</button>
      <button type="button" class="viewer-nav next" data-v="next" aria-label="Neste side">›</button>
      <p class="viewer-msg">Henter noter …</p>
      <button type="button" class="viewer-back" data-v="back" hidden></button>
      <div class="viewer-songs" role="dialog" aria-label="Låter i setlisten" hidden>
        <p class="viewer-songs-head">Hopp til låt</p>
        <ol></ol>
      </div>
    </div>`;
  document.body.appendChild(root);
  document.body.classList.add('viewer-open');

  const $ = (sel) => root.querySelector(sel);
  const stage = $('.viewer-stage');
  const pageEl = $('.viewer-page');
  const cPage = $('.vc-page');
  const cInk = $('.vc-ink');
  const cLive = $('.vc-live');
  const msg = $('.viewer-msg');

  let pages = [];
  let current = 0;
  let strokes = [];
  let undo = [];
  let tool = 'pen';
  let color = COLORS[0].value;
  let mouseDraw = false;
  let drawing = null; // pågående strek
  let erasing = false;
  let saveTimer = 0;
  let dirty = false;
  let unwatch = () => {};
  let renderToken = 0;
  let renderTask = null; // pågående PDF-tegning (avbrytes ved ny side)
  let loaded = false; // notatene for siden er lastet – før det kan man ikke tegne (ellers kan lagrede notater overskrives)
  let size = { w: 1, h: 1, dpr: 1 };
  let closed = false;
  let wakeLock = null;

  /* ----- Bygg sidelisten i setlistens rekkefølge ----- */
  const pdfDocs = new Map();
  const images = new Map();
  const texts = new Map();

  async function buildPages() {
    let n = 0;
    const songs = [];
    for (const item of sl.items) {
      if (item.type !== 'song') continue;
      n++;
      if ((item.files || []).length) songs.push({ n, item });
    }
    const total = songs.reduce((t, s) => t + s.item.files.length, 0);
    let done = 0;
    for (const [si, song] of songs.entries()) {
      const nextSong = sl.items.slice(sl.items.indexOf(song.item) + 1).find((i) => i.type === 'song');
      for (const f of song.item.files) {
        msg.textContent = `Henter noter … ${++done}/${total}`;
        const kind = fileKind(f.type, f.name);
        let count = 0;
        try {
          const blob = await cloud.fetchFile(f.id);
          if (kind === 'pdf') {
            const lib = await loadPdfJs();
            const pdf = await lib.getDocument({
              data: new Uint8Array(await blob.arrayBuffer()),
              cMapUrl: `${PDFJS}cmaps/`,
              cMapPacked: true,
              standardFontDataUrl: `${PDFJS}standard_fonts/`,
              isEvalSupported: false,
            }).promise;
            pdfDocs.set(f.id, pdf);
            count = pdf.numPages;
          } else if (kind === 'image') {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.src = url;
            await img.decode();
            images.set(f.id, img);
            count = 1;
          } else if (kind === 'text') {
            const layout = textLayout(await blob.text());
            texts.set(f.id, layout);
            count = layout.length;
          }
        } catch (err) {
          console.warn('Kunne ikke laste', f.name, err);
        }
        for (let i = 0; i < count; i++) {
          pages.push({ song: song.n, itemId: song.item.id, title: song.item.title || '–', next: nextSong?.title || '', file: f, kind, index: i });
        }
      }
      if (closed) return;
      void si;
    }
  }

  /* ----- Størrelse og tegning av siden ----- */

  function aspectOf(pg) {
    if (pg.kind === 'pdf') return pg.aspect || 1 / Math.SQRT2;
    if (pg.kind === 'image') {
      const img = images.get(pg.file.id);
      return img.naturalWidth / img.naturalHeight;
    }
    return A4[0] / A4[1];
  }

  async function render() {
    const pg = pages[current];
    if (!pg) return;
    const token = ++renderToken;
    if (renderTask) {
      renderTask.cancel();
      try {
        await renderTask.promise;
      } catch (_) {}
    }
    if (token !== renderToken) return;
    $('.viewer-title b').textContent = `${pg.song}. ${pg.title} ▾`;
    $('.viewer-title small').textContent = pg.next ? `Neste: ${pg.next}` : 'Siste låt';
    $('.viewer-count').textContent = `${current + 1}/${pages.length}`;
    root.querySelector('[data-v="prev"]').disabled = current === 0;
    root.querySelector('[data-v="next"]').disabled = current === pages.length - 1;

    let pdfPage = null;
    if (pg.kind === 'pdf') {
      pdfPage = await pdfDocs.get(pg.file.id).getPage(pg.index + 1);
      const vp = pdfPage.getViewport({ scale: 1 });
      pg.aspect = vp.width / vp.height;
    }
    if (token !== renderToken) return;

    // Tilpass siden til skjermen
    const r = stage.getBoundingClientRect();
    const a = aspectOf(pg);
    const w = Math.max(1, Math.min(r.width - 16, (r.height - 16) * a));
    const h = w / a;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = { w, h, dpr };
    pageEl.style.width = `${w}px`;
    pageEl.style.height = `${h}px`;
    for (const c of [cPage, cInk, cLive]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }

    const ctx = cPage.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cPage.width, cPage.height);
    if (pg.kind === 'pdf') {
      const vp = pdfPage.getViewport({ scale: cPage.width / pdfPage.getViewport({ scale: 1 }).width });
      renderTask = pdfPage.render({ canvasContext: ctx, viewport: vp });
      try {
        await renderTask.promise;
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') console.warn(err);
        return;
      } finally {
        renderTask = null;
      }
    } else if (pg.kind === 'image') {
      ctx.drawImage(images.get(pg.file.id), 0, 0, cPage.width, cPage.height);
    } else {
      drawTextPage(ctx, texts.get(pg.file.id)[pg.index], pg, cPage.width / A4[0]);
    }
    if (token !== renderToken) return;
    redrawInk();
  }

  // Samme oppsett som tekstsidene i noteheftet (textLayout i app.js)
  function drawTextPage(ctx, layout, pg, k) {
    ctx.save();
    ctx.scale(k, k);
    ctx.fillStyle = '#111';
    if (layout.title) {
      ctx.font = 'bold 16px Helvetica, Arial, sans-serif';
      ctx.fillText(`${pg.song}. ${pg.title}`, 50, A4[1] - (A4[1] - 60));
    }
    ctx.font = '10.5px "Courier New", Courier, monospace';
    for (const row of layout.rows) ctx.fillText(row.text.slice(0, 90), 50, A4[1] - row.y);
    ctx.restore();
  }

  function redrawInk() {
    const ctx = cInk.getContext('2d');
    ctx.clearRect(0, 0, cInk.width, cInk.height);
    for (const st of strokes) drawStroke(ctx, st, cInk.width, cInk.height);
  }

  /* ----- Laste og lagre notater for siden ----- */

  async function showPage(i) {
    await flushSave();
    unwatch();
    current = Math.max(0, Math.min(pages.length - 1, i));
    strokes = [];
    undo = [];
    loaded = false;
    const pg = pages[current];
    try {
      await render();
    } catch (err) {
      console.warn(err);
    }
    let remote;
    try {
      remote = await cloud.loadAnnotations(pg.file.id, pg.index);
    } catch (_) {
      remote = null; // ikke lastet – tegning forblir sperret så ingenting overskrives
    }
    if (pages[current] !== pg) return;
    if (remote) {
      strokes = remote;
      loaded = true;
    }
    redrawInk();
    unwatch = cloud.watchAnnotations(pg.file.id, pg.index, (remote) => {
      if (pages[current] !== pg || drawing || dirty) return; // egne endringer går foran
      strokes = remote;
      loaded = true;
      redrawInk();
    });
  }

  function scheduleSave() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 700);
  }

  async function flushSave() {
    clearTimeout(saveTimer);
    if (!dirty) return;
    dirty = false;
    const pg = pages[current];
    try {
      await cloud.saveAnnotations(pg.file.id, pg.index, strokes);
    } catch (err) {
      dirty = true;
      msg.textContent = `Notatene ble ikke lagret: ${err.message}`;
      msg.hidden = false;
      setTimeout(() => (msg.hidden = true), 4000);
    }
  }

  function go(delta) {
    const to = current + delta;
    if (to < 0 || to >= pages.length || drawing) return;
    showPage(to);
  }

  /* ----- Låtoversikt: hopp til en annen låt ----- */

  const songsPanel = $('.viewer-songs');
  const backBtn = $('.viewer-back');
  let backTo = null;
  let backTimer = 0;

  function renderSongList() {
    const pg = pages[current];
    let n = 0;
    songsPanel.querySelector('ol').innerHTML = sl.items
      .map((item) => {
        if (item.type === 'break') return `<li class="vs-break">${esc(item.title || 'Pause')}</li>`;
        n++;
        const has = pages.some((p) => p.itemId === item.id);
        const cur = pg && pg.itemId === item.id;
        return `<li><button type="button" class="vs-song${cur ? ' current' : ''}" data-jump="${esc(item.id)}" ${has ? '' : 'disabled'}>
            <span class="vs-n">${n}</span><span class="vs-t">${esc(item.title || '–')}</span>
            ${item.key ? `<span class="vs-k">${esc(item.key)}</span>` : ''}
            ${has ? '' : '<span class="vs-none">ingen noter</span>'}
          </button></li>`;
      })
      .join('');
  }

  function toggleSongs(open = songsPanel.hidden) {
    songsPanel.hidden = !open;
    $('.viewer-title').setAttribute('aria-expanded', open);
    if (open) {
      renderSongList();
      songsPanel.querySelector('.current')?.scrollIntoView({ block: 'center' });
      songsPanel.querySelector('.current, [data-jump]:not([disabled])')?.focus();
    }
  }

  function jumpToItem(itemId) {
    const to = pages.findIndex((p) => p.itemId === itemId);
    if (to < 0) return;
    const from = pages[current];
    toggleSongs(false);
    if (from && from.itemId !== itemId) {
      backTo = current;
      backBtn.textContent = `↩ Tilbake til ${from.song}. ${from.title}`;
      backBtn.hidden = false;
      clearTimeout(backTimer);
      backTimer = setTimeout(() => (backBtn.hidden = true), 7000);
    }
    showPage(to);
  }

  /* ----- Penn, markør og viskelær ----- */

  const point = (e) => {
    const r = cInk.getBoundingClientRect();
    return [
      round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), 4),
      round(Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)), 4),
      round(e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5, 2),
    ];
  };

  function eraseAt(e) {
    const [x, y] = point(e);
    const W = size.w;
    const H = size.h;
    const radius = 14; // piksler
    const before = strokes.length;
    const keep = strokes.filter((st) => {
      for (let i = 0; i < st.p.length; i += 3) {
        if (Math.hypot((st.p[i] - x) * W, (st.p[i + 1] - y) * H) < radius + (st.w * W) / 2) return false;
      }
      return true;
    });
    if (keep.length !== before) {
      strokes = keep;
      redrawInk();
      scheduleSave();
    }
  }

  function drawLive() {
    const ctx = cLive.getContext('2d');
    ctx.clearRect(0, 0, cLive.width, cLive.height);
    if (drawing) drawStroke(ctx, drawing, cLive.width, cLive.height);
  }

  let nav = null; // sveip med finger/mus

  pageEl.addEventListener('pointerdown', (e) => {
    const draws = e.pointerType === 'pen' || (e.pointerType === 'mouse' && mouseDraw && e.button === 0);
    if (draws) {
      e.preventDefault();
      if (!loaded) return;
      pageEl.setPointerCapture(e.pointerId);
      undo.push(strokes.slice());
      if (undo.length > 50) undo.shift();
      if (tool === 'eraser') {
        erasing = true;
        eraseAt(e);
        return;
      }
      drawing = tool === 'marker'
        ? { t: 'marker', c: MARKER_COLOR, w: MARKER_WIDTH, p: point(e) }
        : { t: 'pen', c: color, w: PEN_WIDTH, p: point(e) };
      drawLive();
      return;
    }
    if (drawing || erasing) return; // håndflate mens pennen tegner
    nav = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });

  pageEl.addEventListener('pointermove', (e) => {
    if (erasing) return eraseAt(e);
    if (!drawing) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) drawing.p.push(...point(ev));
    drawLive();
  });

  function endDraw() {
    if (erasing) {
      erasing = false;
      if (undo.length && undo[undo.length - 1].length === strokes.length) undo.pop(); // ingenting ble visket
      return;
    }
    if (!drawing) return;
    strokes = [...strokes, drawing];
    drawing = null;
    drawLive();
    redrawInk();
    scheduleSave();
  }
  pageEl.addEventListener('pointerup', endDraw);
  pageEl.addEventListener('pointercancel', endDraw);

  // Sveip og trykk i kantene for å bla (finger, og mus når «Tegn» er av)
  stage.addEventListener('pointerup', (e) => {
    if (!nav || nav.id !== e.pointerId) return;
    const dx = e.clientX - nav.x;
    const dy = e.clientY - nav.y;
    nav = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) return go(dx < 0 ? 1 : -1);
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && e.target.closest('.viewer-page')) {
      const r = stage.getBoundingClientRect();
      const rel = (e.clientX - r.left) / r.width;
      if (rel < 0.3) go(-1);
      else if (rel > 0.7) go(1);
    }
  });
  // Trykk utenfor låtoversikten lukker den (uten å bla eller tegne)
  root.addEventListener(
    'pointerdown',
    (e) => {
      if (songsPanel.hidden || e.target.closest('.viewer-songs') || e.target.closest('[data-v="songs"]')) return;
      toggleSongs(false);
      e.stopPropagation();
      e.preventDefault();
    },
    true
  );

  stage.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.viewer-page') && !e.target.closest('button')) nav = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });

  /* ----- Verktøylinje ----- */

  function setTool(t, c) {
    tool = t;
    if (c) color = c;
    root.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('on', tool === 'pen' && b.dataset.color === color));
    root.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.color) return setTool('pen', b.dataset.color);
    if (b.dataset.tool) return setTool(b.dataset.tool);
    if (b.dataset.jump) return jumpToItem(b.dataset.jump);
    switch (b.dataset.v) {
      case 'songs':
        return toggleSongs();
      case 'back':
        backBtn.hidden = true;
        if (backTo !== null) showPage(backTo);
        backTo = null;
        return;
      case 'close':
        return close();
      case 'prev':
        return go(-1);
      case 'next':
        return go(1);
      case 'undo':
        if (undo.length) {
          strokes = undo.pop();
          redrawInk();
          scheduleSave();
        }
        return;
      case 'draw':
        mouseDraw = !mouseDraw;
        b.setAttribute('aria-pressed', mouseDraw);
        b.classList.toggle('on', mouseDraw);
        pageEl.classList.toggle('drawing', mouseDraw);
        return;
    }
  });

  function onKey(e) {
    if (e.target.closest?.('input, textarea')) return;
    if (!songsPanel.hidden && e.key !== 'Escape') return; // piltaster i låtlisten styrer fokus
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) (e.preventDefault(), go(1));
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) (e.preventDefault(), go(-1));
    else if (e.key === 'Escape') (songsPanel.hidden ? close() : toggleSongs(false));
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') (e.preventDefault(), root.querySelector('[data-v="undo"]').click());
  }
  document.addEventListener('keydown', onKey);

  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 120);
  };
  window.addEventListener('resize', onResize);

  async function close() {
    if (closed) return;
    closed = true;
    await flushSave();
    unwatch();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    for (const img of images.values()) URL.revokeObjectURL(img.src);
    for (const pdf of pdfDocs.values()) pdf.destroy?.();
    try {
      wakeLock?.release();
    } catch (_) {}
    if (document.fullscreenElement === root) document.exitFullscreen?.().catch(() => {});
    root.remove();
    document.body.classList.remove('viewer-open');
  }

  /* ----- Start ----- */

  try {
    root.requestFullscreen?.().catch(() => {});
  } catch (_) {}
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch (_) {}

  await buildPages();
  if (closed) return;
  if (!pages.length) {
    msg.textContent = 'Ingen noter å vise. Legg til PDF, bilde eller tekst på låtene først.';
    return;
  }
  msg.hidden = true;
  const start = startItemId
    ? pages.findIndex((p) => p.itemId === startItemId)
    : startFileId
      ? pages.findIndex((p) => p.file.id === startFileId)
      : 0;
  await showPage(Math.max(0, start));

  return { close };
}
