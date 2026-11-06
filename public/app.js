'use strict';

/* =========================================================
   Setlist Generator – setlister fra Spotify-spillelister
   Uten innlogging lagres data i nettleseren (localStorage).
   Med innlogging via kode (Firebase, se cloud.js) lagres alt i
   Firestore og deles mellom alle som bruker samme kode.
   ========================================================= */

const STORAGE_KEY = 'passetlist.v1';
const app = document.getElementById('app');

/* ---------- Lagring ---------- */

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

let setlists = loadLocal();
let cloudEnabled = false; // Firebase er konfigurert
let cloudUser = null; // innlogget bruker
let cloudLoading = false; // venter på første data fra Firestore
const pendingSaves = new Map(); // id -> timer

function saveLocal() {
  if (cloudUser) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(setlists));
  } catch (_) {
    toast('Kunne ikke lagre – nettleseren blokkerer lagring.');
  }
}

function cloudSave(sl) {
  window.cloud.save(sl).catch((e) => toast(`Lagring feilet: ${e.message}`));
}

// Lagre én setlist (ny eller endret)
function persist(sl) {
  saveLocal();
  if (!cloudUser || !window.cloud) return;
  clearTimeout(pendingSaves.get(sl.id));
  pendingSaves.set(
    sl.id,
    setTimeout(() => {
      pendingSaves.delete(sl.id);
      cloudSave(sl);
    }, 600)
  );
}

function persistRemove(id) {
  saveLocal();
  if (!cloudUser || !window.cloud) return;
  clearTimeout(pendingSaves.get(id));
  pendingSaves.delete(id);
  window.cloud.remove(id).catch((e) => toast(`Sletting feilet: ${e.message}`));
}

function flushSaves() {
  for (const [id, timer] of pendingSaves) {
    clearTimeout(timer);
    const sl = getSetlist(id);
    if (sl && window.cloud) cloudSave(sl);
  }
  pendingSaves.clear();
}
window.addEventListener('pagehide', flushSaves);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushSaves());

function getSetlist(id) {
  return setlists.find((s) => s.id === id);
}

function touch(sl) {
  sl.updatedAt = Date.now();
  persist(sl);
}

/* ---------- Sky (Firebase) ---------- */

const accountEl = document.getElementById('account');

function renderAccount() {
  if (!cloudEnabled) {
    accountEl.hidden = true;
    return;
  }
  accountEl.hidden = false;
  if (cloudUser) {
    accountEl.innerHTML = `
      <button class="code-chip" id="codeChip" title="Kopier koden">
        <span class="code-label">Kode</span><span class="code-value">${esc(cloudUser.code)}</span>
      </button>
      <button class="btn small ghost" id="signOutBtn">Logg ut</button>`;
    document.getElementById('codeChip').onclick = async () => {
      try {
        await navigator.clipboard.writeText(cloudUser.code);
        toast('Koden er kopiert – del den med bandet');
      } catch (_) {}
    };
    document.getElementById('signOutBtn').onclick = () => {
      flushSaves();
      window.cloud.signOut();
    };
  } else {
    accountEl.innerHTML = `<button class="btn small" id="signInBtn">Logg inn<span class="hide-sm"> med kode</span></button>`;
    document.getElementById('signInBtn').onclick = openCodeDialog;
  }
}

/* ---------- Kode-dialog ---------- */

const codeDialog = document.getElementById('codeDialog');
const codeForm = document.getElementById('codeForm');
const codeError = document.getElementById('codeError');

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // uten forvekslbare tegn (0/O, 1/I)
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

function openCodeDialog() {
  codeForm.reset();
  codeError.hidden = true;
  codeDialog.showModal();
  setTimeout(() => codeForm.code.focus(), 30);
}

document.getElementById('codeCancel').onclick = () => codeDialog.close();
document.getElementById('codeGenerate').onclick = () => {
  codeForm.code.value = randomCode();
  codeForm.code.focus();
  codeForm.code.select();
};

codeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  codeError.hidden = true;
  try {
    await window.cloud.signIn(codeForm.code.value);
    codeDialog.close();
  } catch (err) {
    codeError.textContent = err.message;
    codeError.hidden = false;
  }
});

window.addEventListener('cloud:ready', (e) => {
  cloudEnabled = !!e.detail.enabled;
  renderAccount();
  if (cloudEnabled && !location.hash.startsWith('#/s/')) renderHome();
});

window.addEventListener('cloud:user', (e) => {
  cloudUser = e.detail.user;
  if (cloudUser) {
    cloudLoading = true;
    setlists = [];
  } else {
    cloudLoading = false;
    setlists = loadLocal();
  }
  renderAccount();
  route();
});

window.addEventListener('cloud:error', (e) => {
  // Feiler første innlasting, går vi tilbake til lokal lagring i stedet for å henge
  if (cloudLoading && window.cloud) window.cloud.signOut();
  toast(`Skyfeil: ${e.detail.message}`);
});

window.addEventListener('cloud:data', (e) => {
  const remote = e.detail.setlists;
  const firstLoad = cloudLoading;
  cloudLoading = false;

  if (firstLoad) {
    setlists = remote;
    // Flytt setlister som bare finnes lokalt i nettleseren over til koden
    const local = loadLocal().filter((l) => !remote.some((r) => r.id === l.id));
    if (local.length) {
      setlists.push(...local);
      local.forEach(cloudSave);
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (_) {}
      toast(`${local.length} setlister fra denne nettleseren ble lagret på koden`);
    }
    route();
    return;
  }

  // Slå sammen endringer fra andre enheter uten å bytte ut objektene som er i bruk
  const viewing = currentSetlist();
  let viewingChanged = false;
  let changed = false;

  for (const r of remote) {
    const l = getSetlist(r.id);
    if (!l) {
      setlists.push(r);
      changed = true;
    } else if (!pendingSaves.has(r.id) && (r.updatedAt || 0) > (l.updatedAt || 0)) {
      for (const k of Object.keys(l)) if (!(k in r)) delete l[k];
      Object.assign(l, r);
      changed = true;
      if (l === viewing) viewingChanged = true;
    }
  }
  const remoteIds = new Set(remote.map((r) => r.id));
  const before = setlists.length;
  setlists = setlists.filter((s) => remoteIds.has(s.id) || pendingSaves.has(s.id));
  if (setlists.length !== before) changed = true;

  if (!changed) return;
  if (!location.hash.startsWith('#/s/')) return renderHome();
  if (viewing && !getSetlist(viewing.id)) return (location.hash = '#/');
  if (!viewingChanged) return;
  // Tegn editoren på nytt, men behold markøren i feltet brukeren står i
  const a = document.activeElement;
  const focus =
    a && app.contains(a) && a.matches('input')
      ? { row: a.closest('.song')?.dataset.id, f: a.dataset.f, id: a.id, pos: a.selectionStart }
      : null;
  const y = window.scrollY;
  renderEditor(viewing);
  window.scrollTo(0, y);
  if (focus) {
    const el = focus.id
      ? document.getElementById(focus.id)
      : document.querySelector(`.song[data-id="${focus.row}"] [data-f="${focus.f}"]`);
    if (el) {
      el.focus();
      try {
        el.setSelectionRange(focus.pos, focus.pos);
      } catch (_) {}
    }
  }
});

/* ---------- Hjelpere ---------- */

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDuration(ms) {
  if (!ms) return '';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtTotal(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h} t ${m} min` : `${m} min`;
}

function parseDuration(str) {
  const s = String(str || '').trim();
  if (!s) return 0;
  const m = s.match(/^(\d+)(?::(\d{1,2}))?$/);
  if (!m) return null;
  return (Number(m[1]) * 60 + Number(m[2] || 0)) * 1000;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
}

function songCount(sl) {
  return sl.items.filter((i) => i.type === 'song').length;
}

function totalMs(sl) {
  return sl.items.reduce((sum, i) => sum + (i.durationMs || 0), 0);
}

function newSong(data = {}) {
  return {
    id: uid(),
    type: 'song',
    title: data.title || '',
    artist: data.artist || '',
    key: data.key || '',
    notes: data.notes || '',
    durationMs: data.durationMs || 0,
  };
}

function newBreak(title = 'Pause') {
  return { id: uid(), type: 'break', title, durationMs: 0 };
}

function parseTextList(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.+?)\s+[-–—]\s+(.+)$/);
      return m ? newSong({ artist: m[1].trim(), title: m[2].trim() }) : newSong({ title: line });
    });
}

let toastTimer;
function toast(msg, action) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => {
      el.hidden = true;
      action.run();
    };
    el.appendChild(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), action ? 6000 : 2800);
}

async function fetchSpotify(url) {
  const res = await fetch(`/api/playlist?url=${encodeURIComponent(url)}`);
  let data;
  try {
    data = await res.json();
  } catch (_) {
    throw new Error('Uventet svar fra serveren.');
  }
  if (!res.ok) throw new Error(data.error || 'Klarte ikke å hente spillelisten.');
  return data;
}

/* ---------- Ruting ---------- */

function route() {
  const m = location.hash.match(/^#\/s\/([\w-]+)/);
  const editing = m && getSetlist(m[1]);
  document.body.classList.toggle('on-home', !editing);
  if (editing) {
    window.dispatchEvent(new CustomEvent('hero:leave'));
    renderEditor(getSetlist(m[1]));
  } else renderHome();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
// Toppmenyen er gjennomsiktig over scenen til man begynner å rulle
const onScroll = () => document.body.classList.toggle('scrolled', window.scrollY > 40);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---------- Oversikt ---------- */

function renderHome() {
  document.title = 'Setlist Generator';
  const sorted = [...setlists].sort((a, b) => b.updatedAt - a.updatedAt);

  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAI', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'NOV', 'DES'];
  const stub = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.date || '');
    return m
      ? `<span class="stub-day">${Number(m[3])}</span><span class="stub-month">${MONTHS[Number(m[2]) - 1]}</span><span class="stub-year">${m[1]}</span>`
      : `<span class="vinyl" aria-hidden="true"></span>`;
  };

  const next = sorted
    .filter((s) => s.date && s.date >= new Date().toISOString().slice(0, 10))
    .sort((x, y) => x.date.localeCompare(y.date))[0];
  const label = (s) => (s === next ? 'Neste' : s.date ? 'Spillejobb' : 'Setlist');

  app.innerHTML = `
    <section class="hero">
      <div class="hero-photo" aria-hidden="true"></div>
      <div class="hero-crowd-front" aria-hidden="true"></div>
      <div class="hero-grain" aria-hidden="true"></div>
      <div class="hero-content">
        <p class="hero-kicker">Setlister for band og artister</p>
        <h1><span class="solid">Setlist</span><span class="outline">Generator</span></h1>
        <p class="hero-lead">Slipp inn en Spotify-liste, så får du en setlist du kan rokke om på, rable notater i og ta med deg rett på scenen.</p>
        <div class="hero-actions">
          <button class="btn light big" id="newBtn">＋ Opprett ny setlist</button>
          ${cloudEnabled && !cloudUser ? '<button class="btn outline big" id="heroSignIn">Logg inn med kode</button>' : ''}
        </div>
      </div>
    </section>

    <section class="list-section">
      <div class="section-head">
        <h2>Mine setlister</h2>
        ${sorted.length ? `<span class="count">${sorted.length}</span>` : ''}
      </div>
    ${
      cloudLoading
        ? `<div class="empty"><p>Henter setlistene…</p></div>`
        : sorted.length
        ? `<div class="cards">${sorted
            .map(
              (s) => `
          <a class="card${s === next ? ' is-next' : ''}" href="#/s/${s.id}">
            <span class="card-tag">${label(s)}</span>
            <div class="stub">${stub(s)}</div>
            <div class="card-body">
              <span class="card-eyebrow">${s.venue ? esc(s.venue) : `Endret ${fmtDate(s.updatedAt)}`}</span>
              <h3>${esc(s.name || 'Uten navn')}</h3>
              <div class="meta">${songCount(s)} låter${totalMs(s) ? ` · ${fmtTotal(totalMs(s))}` : ''}</div>
            </div>
            <div class="card-menu">
              <button class="icon-btn" data-dup="${s.id}" title="Dupliser" aria-label="Dupliser">⧉</button>
              <button class="icon-btn danger" data-del="${s.id}" title="Slett" aria-label="Slett">✕</button>
            </div>
            <span class="card-arrow" aria-hidden="true">›</span>
          </a>`
            )
            .join('')}</div>`
        : `<div class="empty">
            <span class="vinyl big" aria-hidden="true"></span>
            <h2>Scenen er tom</h2>
            <p>Lim inn en lenke til en Spotify-spilleliste, så lager vi en setlist du kan jobbe videre med.</p>
            <button class="btn primary" id="newBtnEmpty">＋ Opprett ny</button>
          </div>`
    }
    </section>
    <div class="backup">
      <span>${
        cloudUser
          ? `Lagres på koden ${esc(cloudUser.code)} – alle som logger inn med samme kode ser de samme setlistene.`
          : cloudEnabled
          ? 'Lagres bare i denne nettleseren. Logg inn med en kode for å lagre i skyen og dele med bandet.'
          : 'Lagres i denne nettleseren.'
      }</span>
      <button class="btn small ghost" id="exportBtn">Last ned sikkerhetskopi</button>
      <label class="btn small ghost">Gjenopprett fra fil<input type="file" accept="application/json" id="importFile" hidden /></label>
    </div>
  `;

  // 3D-scenen (three/hero3d.js) flytter canvaset inn i den nye hero-seksjonen
  window.dispatchEvent(new CustomEvent('hero:render', { detail: app.querySelector('.hero') }));

  app.querySelectorAll('#newBtn, #newBtnEmpty').forEach((b) => (b.onclick = () => openCreateDialog()));
  document.getElementById('heroSignIn')?.addEventListener('click', openCodeDialog);

  app.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault();
      const idx = setlists.findIndex((s) => s.id === b.dataset.del);
      if (idx < 0) return;
      const [removed] = setlists.splice(idx, 1);
      persistRemove(removed.id);
      renderHome();
      scheduleFileCleanup(removed.items.flatMap((i) => i.files || []));
      toast(`«${removed.name || 'Uten navn'}» ble slettet`, {
        label: 'Angre',
        run: () => {
          setlists.splice(idx, 0, removed);
          persist(removed);
          renderHome();
        },
      });
    };
  });

  app.querySelectorAll('[data-dup]').forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault();
      const src = getSetlist(b.dataset.dup);
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = uid();
      copy.name = `${src.name || 'Uten navn'} (kopi)`;
      copy.createdAt = copy.updatedAt = Date.now();
      copy.items.forEach((i) => (i.id = uid()));
      setlists.push(copy);
      persist(copy);
      renderHome();
    };
  });

  document.getElementById('exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(setlists, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `setlist-generator-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  document.getElementById('importFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error();
      let added = 0;
      for (const s of data) {
        if (!s || !Array.isArray(s.items)) continue;
        if (getSetlist(s.id)) s.id = uid();
        setlists.push(s);
        persist(s);
        added++;
      }
      renderHome();
      toast(`${added} setlister gjenopprettet`);
    } catch (_) {
      toast('Ugyldig sikkerhetskopi-fil');
    }
  };
}

/* ---------- Opprett-dialog ---------- */

const dialog = document.getElementById('createDialog');
const form = document.getElementById('createForm');
const errorEl = document.getElementById('createError');
const submitBtn = document.getElementById('createSubmit');
let dialogMode = 'spotify';
let dialogTarget = null; // null = ny setlist, ellers setlist å legge til i

function setDialogMode(mode) {
  dialogMode = mode;
  form.querySelectorAll('.segmented button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  form.querySelectorAll('[data-show]').forEach((el) => (el.hidden = el.dataset.show !== mode));
  form.querySelector('[data-show-name]').hidden = !!dialogTarget;
  submitBtn.textContent =
    mode === 'spotify' ? 'Hent låter' : dialogTarget ? 'Legg til' : mode === 'empty' ? 'Opprett' : 'Opprett';
  errorEl.hidden = true;
}

form.querySelectorAll('.segmented button').forEach((b) => (b.onclick = () => setDialogMode(b.dataset.mode)));
document.getElementById('createCancel').onclick = () => dialog.close();

function openCreateDialog(target = null) {
  dialogTarget = target;
  form.reset();
  document.getElementById('createTitle').textContent = target ? 'Legg til låter' : 'Opprett ny setlist';
  form.querySelector('[data-mode="empty"]').hidden = !!target;
  setDialogMode('spotify');
  submitBtn.disabled = false;
  dialog.showModal();
  setTimeout(() => form.url.focus(), 30);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.hidden = true;

  let items = [];
  let name = form.name.value.trim();
  let spotifyUrl = '';
  let cover = '';

  if (dialogMode === 'spotify') {
    const url = form.url.value.trim();
    if (!url) {
      errorEl.textContent = 'Lim inn en Spotify-lenke.';
      errorEl.hidden = false;
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Henter…';
    try {
      const data = await fetchSpotify(url);
      items = data.tracks.map((t) => newSong(t));
      if (!name) name = data.name || '';
      spotifyUrl = url;
      cover = safeCover(data.cover);
      if (!items.length) throw new Error('Spillelisten ser ut til å være tom.');
    } catch (err) {
      errorEl.textContent = `${err.message} Du kan også bruke «Lim inn tekst».`;
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Hent låter';
      return;
    }
    submitBtn.disabled = false;
  } else if (dialogMode === 'text') {
    items = parseTextList(form.text.value);
    if (!items.length) {
      errorEl.textContent = 'Skriv inn minst én låt.';
      errorEl.hidden = false;
      return;
    }
  }

  dialog.close();

  if (dialogTarget) {
    dialogTarget.items.push(...items);
    if (!dialogTarget.cover && cover) dialogTarget.cover = cover;
    touch(dialogTarget);
    renderEditor(dialogTarget);
    toast(`${items.length} låter lagt til`);
    return;
  }

  const sl = {
    id: uid(),
    name: name || 'Ny setlist',
    date: '',
    venue: '',
    notes: '',
    spotifyUrl,
    cover,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    items,
  };
  setlists.push(sl);
  persist(sl);
  location.hash = `#/s/${sl.id}`;
  if (items.length) toast(`${items.length} låter hentet`);
});

/* ---------- Editor ---------- */

// Spotify-cover: bare https-bilder uten tegn som kan bryte CSS-en
function safeCover(url) {
  return typeof url === 'string' && /^https:\/\/[^\s"'()\\]+$/.test(url) ? url : '';
}

// Eldre setlister fra Spotify har ikke cover lagret – hent det én gang
const coverRequested = new Set();
async function ensureCover(sl) {
  if (!sl.spotifyUrl || 'cover' in sl || coverRequested.has(sl.id)) return;
  coverRequested.add(sl.id);
  try {
    const res = await fetch(`/api/playlist?cover=1&url=${encodeURIComponent(sl.spotifyUrl)}`);
    const data = res.ok ? await res.json() : {};
    sl.cover = safeCover(data.cover);
  } catch (_) {
    return; // prøv igjen neste gang (f.eks. uten nett)
  }
  touch(sl);
  if (currentSetlist() === sl) updateStats(sl);
}

// Infopanelet i redigeringen er sammenfoldet på telefon; husk valget mens appen er åpen
let deckInfoOpen = false;

function renderEditor(sl) {
  document.title = `${sl.name || 'Setlist'} – Setlist Generator`;

  app.innerHTML = `
    <div class="editor">
      <aside class="deck">
        <a href="#/" class="back">← Alle setlister</a>
        <div class="deck-vinyl" aria-hidden="true">
          <div class="vinyl xl"><span class="vinyl-label" id="deckLabel"></span></div>
        </div>
        <button type="button" class="info-toggle" id="infoToggle" aria-expanded="${deckInfoOpen}" aria-controls="deckInfo">
          <span class="info-label">Info</span>
          <span class="info-summary" id="infoSummary"></span>
          <span class="info-chevron" aria-hidden="true">▾</span>
        </button>
        <div class="deck-info${deckInfoOpen ? ' open' : ''}" id="deckInfo">
        <dl class="spec">
          <div><dt>Dato</dt><dd><input class="spec-input" id="slDate" type="date" value="${esc(sl.date)}" aria-label="Dato" /></dd></div>
          <div><dt>Sted</dt><dd><input class="spec-input" id="slVenue" value="${esc(sl.venue)}" placeholder="Legg til sted" aria-label="Sted" /></dd></div>
          <div><dt>Låter</dt><dd id="specSongs"></dd></div>
          <div><dt>Spilletid</dt><dd id="specTime"></dd></div>
          <div><dt>Åpner med</dt><dd id="specOpener"></dd></div>
          <div><dt>Noter</dt><dd id="specFiles"></dd></div>
        </dl>
        <label class="spec-notes">
          <span>Notater</span>
          <textarea class="plain" id="slNotes" rows="2" placeholder="Generelle notater">${esc(sl.notes)}</textarea>
        </label>
        </div>
        <div class="deck-actions">
          <button class="btn square primary" id="bookBtn">Notehefte (PDF)</button>
          <button class="btn square" id="printBtn">Skriv ut</button>
          <button class="btn square" id="copyBtn">Kopier som tekst</button>
          <button class="btn square" id="addSpotify">＋ Fra Spotify</button>
        </div>
      </aside>

      <section class="tracks">
        <p class="eyebrow">Setlist</p>
        <input class="title-input" id="slName" value="${esc(sl.name)}" placeholder="Navn på setlisten" aria-label="Navn" />
        <div class="toolbar"><div class="stats" id="stats"></div></div>

        <div class="cols" aria-hidden="true">
          <span></span><span class="r">#</span><span>Tittel</span><span>Artist</span><span class="c">Toneart</span><span>Notat</span><span class="r">Tid</span><span class="c">Noter</span><span class="spacer"></span>
        </div>
        <ol class="songs" id="songs"></ol>

        <div class="add-row">
          <button class="btn small" id="addSong">＋ Legg til låt</button>
          <button class="btn small" id="addBreak">＋ Pause / sett-skille</button>
          ${sl.spotifyUrl ? `<a class="btn small ghost" href="${esc(sl.spotifyUrl)}" target="_blank" rel="noopener">Åpne i Spotify ↗</a>` : ''}
        </div>
      </section>
    </div>

    <section class="stage" id="stage"></section>
  `;

  const bind = (id, field) => {
    document.getElementById(id).addEventListener('input', (e) => {
      sl[field] = e.target.value;
      touch(sl);
      if (field === 'date' || field === 'name' || field === 'venue') updateStats(sl);
      if (field === 'name') document.title = `${sl.name || 'Setlist'} – Setlist Generator`;
    });
  };
  document.getElementById('infoToggle').onclick = (e) => {
    deckInfoOpen = !deckInfoOpen;
    e.currentTarget.setAttribute('aria-expanded', deckInfoOpen);
    document.getElementById('deckInfo').classList.toggle('open', deckInfoOpen);
  };

  bind('slName', 'name');
  bind('slDate', 'date');
  bind('slVenue', 'venue');
  bind('slNotes', 'notes');

  document.getElementById('addSpotify').onclick = () => openCreateDialog(sl);

  document.getElementById('addSong').onclick = () => {
    sl.items.push(newSong());
    touch(sl);
    renderSongs(sl);
    const rows = document.querySelectorAll('#songs .song');
    rows[rows.length - 1]?.querySelector('.title')?.focus();
  };

  document.getElementById('addBreak').onclick = () => {
    sl.items.push(newBreak());
    touch(sl);
    renderSongs(sl);
  };

  document.getElementById('copyBtn').onclick = async () => {
    const text = asText(sl);
    try {
      await navigator.clipboard.writeText(text);
      toast('Kopiert til utklippstavlen');
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('Kopiert');
    }
  };

  document.getElementById('bookBtn').onclick = () => buildSongbook(sl);

  document.getElementById('printBtn').onclick = () => openPrintDialog(sl);

  renderSongs(sl);
  ensureCover(sl);
}

function updateStats(sl) {
  const el = document.getElementById('stats');
  if (!el) return;
  const t = totalMs(sl);
  el.innerHTML = `<strong>${songCount(sl)}</strong> låter${t ? ` · <strong>${fmtTotal(t)}</strong>` : ''}`;

  // Infopanelet ved vinylplaten
  const set = (id, text) => {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  };
  const songs = sl.items.filter((i) => i.type === 'song');
  const files = songs.reduce((n, i) => n + (i.files || []).length, 0);
  const withFiles = songs.filter((i) => (i.files || []).length).length;
  set('specSongs', `${songs.length}`);
  set('infoSummary', [sl.date && fmtDate(sl.date), sl.venue, `${songs.length} låter`].filter(Boolean).join(' · '));
  set('specTime', t ? fmtTotal(t) : '–');
  set('specOpener', songs[0]?.title || '–');
  set('specFiles', files ? `${files} filer · ${withFiles}/${songs.length} låter` : 'Ingen ennå');
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(sl.date || '');
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAI', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'NOV', 'DES'];
  const label = document.getElementById('deckLabel');
  if (label) {
    const cover = safeCover(sl.cover);
    label.classList.toggle('has-cover', !!cover);
    if (cover) label.style.setProperty('--cover', `url("${cover}")`);
    else label.style.removeProperty('--cover');
    label.innerHTML = m
      ? `<b>${Number(m[2])}</b><small>${months[Number(m[1]) - 1]}</small>`
      : `<b>${esc((sl.name || 'S').trim().charAt(0).toUpperCase())}</b><small>SETLIST</small>`;
  }
}

function renderSongs(sl) {
  const list = document.getElementById('songs');
  let n = 0;

  list.innerHTML = sl.items
    .map((item) => {
      if (item.type === 'break') {
        return `
        <li class="song break" data-id="${item.id}">
          <span class="handle" title="Dra for å flytte" aria-label="Flytt">⋮⋮</span>
          <span class="num">—</span>
          <input class="title" data-f="title" value="${esc(item.title)}" placeholder="Pause" aria-label="Pausetekst" />
          <input class="dur" data-f="dur" value="${esc(fmtDuration(item.durationMs))}" placeholder="m:ss" aria-label="Varighet" />
          ${rowActions()}
        </li>`;
      }
      n++;
      return `
      <li class="song" data-id="${item.id}">
        <span class="handle" title="Dra for å flytte" aria-label="Flytt">⋮⋮</span>
        <span class="num">${n}</span>
        <input class="title" data-f="title" value="${esc(item.title)}" placeholder="Tittel" aria-label="Tittel" />
        <input class="artist" data-f="artist" value="${esc(item.artist)}" placeholder="Artist" aria-label="Artist" />
        <input class="key" data-f="key" value="${esc(item.key)}" placeholder="Tone" aria-label="Toneart" />
        <input class="notes" data-f="notes" value="${esc(item.notes)}" placeholder="Notat" aria-label="Notat" />
        <input class="dur" data-f="dur" value="${esc(fmtDuration(item.durationMs))}" placeholder="m:ss" aria-label="Varighet" />
        ${filesButton(item)}
        ${rowActions()}
      </li>`;
    })
    .join('');

  if (!sl.items.length) {
    list.innerHTML = `<li class="empty" style="padding:32px">Listen er tom. Legg til låter under eller hent fra Spotify.</li>`;
  }

  updateStats(sl);
}

function filesButton(item) {
  const n = (item.files || []).length;
  return `<button class="files-btn${n ? ' has' : ''}" data-act="files" title="Tekst og noter" aria-label="Tekst og noter (${n} filer)">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>
      ${n ? `<span class="badge">${n}</span>` : ''}
    </button>`;
}

function rowActions() {
  return `
    <span class="row-actions">
      <button class="icon-btn" data-act="up" title="Flytt opp" aria-label="Flytt opp">↑</button>
      <button class="icon-btn" data-act="down" title="Flytt ned" aria-label="Flytt ned">↓</button>
      <button class="icon-btn danger" data-act="del" title="Fjern" aria-label="Fjern">✕</button>
    </span>`;
}

function currentSetlist() {
  const m = location.hash.match(/^#\/s\/([\w-]+)/);
  return m ? getSetlist(m[1]) : null;
}

// Redigering av felter (delegert)
app.addEventListener('input', (e) => {
  const input = e.target;
  const row = input.closest('.song');
  if (!row || !input.dataset.f) return;
  const sl = currentSetlist();
  const item = sl?.items.find((i) => i.id === row.dataset.id);
  if (!item) return;
  if (input.dataset.f === 'dur') {
    const ms = parseDuration(input.value);
    if (ms === null) return;
    item.durationMs = ms;
    updateStats(sl);
  } else {
    item[input.dataset.f] = input.value;
  }
  touch(sl);
});

app.addEventListener(
  'blur',
  (e) => {
    if (e.target.dataset?.f !== 'dur') return;
    const sl = currentSetlist();
    const item = sl?.items.find((i) => i.id === e.target.closest('.song')?.dataset.id);
    if (item) e.target.value = fmtDuration(item.durationMs);
  },
  true
);

// Enter i et felt hopper til samme felt på neste rad
app.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.dataset?.f) return;
  e.preventDefault();
  const row = e.target.closest('.song');
  let next = row?.nextElementSibling;
  while (next && !next.querySelector(`[data-f="${e.target.dataset.f}"]`)) next = next.nextElementSibling;
  next?.querySelector(`[data-f="${e.target.dataset.f}"]`)?.focus();
});

// Knapper på radene
app.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const sl = currentSetlist();
  const row = btn.closest('.song');
  const idx = sl.items.findIndex((i) => i.id === row.dataset.id);
  if (idx < 0) return;
  const act = btn.dataset.act;

  if (act === 'files') {
    openFilesDialog(sl, sl.items[idx]);
    return;
  }

  if (act === 'del') {
    const [removed] = sl.items.splice(idx, 1);
    touch(sl);
    renderSongs(sl);
    scheduleFileCleanup(removed.files);
    toast(`«${removed.title || 'Låt'}» fjernet`, {
      label: 'Angre',
      run: () => {
        sl.items.splice(idx, 0, removed);
        touch(sl);
        renderSongs(sl);
      },
    });
    return;
  }

  const to = act === 'up' ? idx - 1 : idx + 1;
  if (to < 0 || to >= sl.items.length) return;
  [sl.items[idx], sl.items[to]] = [sl.items[to], sl.items[idx]];
  touch(sl);
  renderSongs(sl);
  document.querySelector(`.song[data-id="${row.dataset.id}"] [data-act="${act}"]`)?.focus();
});

/* ---------- Dra og slipp (mus + touch) ---------- */

app.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.handle');
  if (!handle) return;
  const row = handle.closest('.song');
  const list = row.parentElement;
  const sl = currentSetlist();
  if (!sl) return;

  e.preventDefault();
  handle.setPointerCapture(e.pointerId);
  row.classList.add('dragging');
  const grabDy = e.clientY - row.getBoundingClientRect().top;
  let lastY = e.clientY;

  const layout = () => {
    row.style.transform = '';
    const pointerY = lastY;
    for (const sib of list.children) {
      if (sib === row) continue;
      const r = sib.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const sibIsBefore = row.compareDocumentPosition(sib) & Node.DOCUMENT_POSITION_PRECEDING;
      if (sibIsBefore && pointerY < mid) {
        list.insertBefore(row, sib);
        break;
      }
    }
    for (const sib of [...list.children].reverse()) {
      if (sib === row) continue;
      const r = sib.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const sibIsAfter = row.compareDocumentPosition(sib) & Node.DOCUMENT_POSITION_FOLLOWING;
      if (sibIsAfter && pointerY > mid) {
        list.insertBefore(row, sib.nextSibling);
        break;
      }
    }
    const naturalTop = row.getBoundingClientRect().top;
    row.style.transform = `translateY(${pointerY - grabDy - naturalTop}px)`;
  };

  let scrollTimer = null;
  const autoScroll = () => {
    // Rull når fingeren/musa er nær kanten (under de faste menyene øverst)
    const bars = [...document.querySelectorAll('.topbar, .toolbar')].filter((el) => getComputedStyle(el).position === 'sticky');
    const topEdge = Math.max(0, ...bars.map((el) => el.getBoundingClientRect().bottom)) + 40;
    const edge = lastY < topEdge ? -12 : lastY > window.innerHeight - 70 ? 12 : 0;
    if (edge) {
      window.scrollBy(0, edge);
      layout();
    }
  };

  const move = (ev) => {
    lastY = ev.clientY;
    layout();
  };

  const up = () => {
    clearInterval(scrollTimer);
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    row.classList.remove('dragging');
    row.style.transform = '';
    const order = [...list.querySelectorAll('.song')].map((r) => r.dataset.id);
    const byId = new Map(sl.items.map((i) => [i.id, i]));
    sl.items = order.map((id) => byId.get(id)).filter(Boolean);
    touch(sl);
    renderSongs(sl);
  };

  scrollTimer = setInterval(autoScroll, 16);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
});

/* ---------- Eksport / utskrift ---------- */

function asText(sl) {
  const lines = [sl.name || 'Setlist'];
  const sub = [sl.date, sl.venue].filter(Boolean).join(' · ');
  if (sub) lines.push(sub);
  lines.push('');
  let n = 0;
  for (const i of sl.items) {
    if (i.type === 'break') {
      lines.push(`— ${i.title || 'Pause'} —`);
      continue;
    }
    n++;
    let line = `${n}. ${i.title}`;
    if (i.artist) line += ` – ${i.artist}`;
    if (i.key) line += ` [${i.key}]`;
    if (i.notes) line += ` (${i.notes})`;
    lines.push(line);
  }
  return lines.join('\n');
}

/* ---------- Utskrift med valg og forhåndsvisning ---------- */

const PRINT_KEY = 'setlist-generator.print';
const PRINT_DEFAULTS = {
  layout: 'stage', // stage | compact | columns
  orientation: 'portrait', // portrait | landscape
  theme: 'light', // light | dark
  fit: true,
  size: 100,
  header: true,
  numbers: true,
  artist: true,
  key: true,
  notes: false,
  duration: false,
  breaks: true,
  total: false,
  upper: false,
};

function loadPrintOptions() {
  try {
    return { ...PRINT_DEFAULTS, ...JSON.parse(localStorage.getItem(PRINT_KEY) || '{}') };
  } catch (_) {
    return { ...PRINT_DEFAULTS };
  }
}

function savePrintOptions(o) {
  try {
    localStorage.setItem(PRINT_KEY, JSON.stringify(o));
  } catch (_) {}
}

// Radene i setlisten som HTML (nummereringen fortsetter på tvers av sider)
function sheetRows(sl, o) {
  let n = 0;
  const rows = [];
  for (const i of sl.items) {
    if (i.type === 'break') {
      if (o.breaks) rows.push(`<li class="brk"><span>${esc(i.title || 'Pause')}</span></li>`);
      continue;
    }
    n++;
    const meta = [
      o.key && i.key ? `<span class="k">${esc(i.key)}</span>` : '',
      o.artist && i.artist ? `<span class="a">${esc(i.artist)}</span>` : '',
      o.notes && i.notes ? `<span class="x">${esc(i.notes)}</span>` : '',
    ].join('');
    rows.push(`<li>
        ${o.numbers ? `<span class="n">${n}</span>` : ''}
        <span class="body"><span class="t">${esc(i.title || '–')}</span>${meta}</span>
        ${o.duration && i.durationMs ? `<span class="d">${fmtDuration(i.durationMs)}</span>` : ''}
      </li>`);
  }
  return rows;
}

// Én A4-side. Overskriften står på første side, total spilletid på siste,
// og sidetall nederst når det er flere sider.
function pageHTML(sl, o, fs, { rows, first = true, last = true, pageNo = 1, pages = 1 }) {
  const sub = [sl.date && fmtDate(sl.date), sl.venue].filter(Boolean).map(esc).join(' · ');
  const t = totalMs(sl);
  const classes = ['sheet', `layout-${o.layout}`, `theme-${o.theme}`, `orient-${o.orientation}`, o.upper ? 'upper' : '']
    .filter(Boolean)
    .join(' ');
  return `
    <div class="${classes}" style="--fs:${fs}">
      <div class="sheet-inner">
        ${
          o.header && first
            ? `<header class="sheet-head"><h1>${esc(sl.name || 'Setlist')}</h1>${sub ? `<div class="sheet-sub">${sub}</div>` : ''}</header>`
            : ''
        }
        ${!first && o.header ? `<div class="sheet-cont">${esc(sl.name || 'Setlist')} – fortsetter</div>` : ''}
        <ol class="sheet-list">${rows.join('')}</ol>
        ${o.total && last ? `<footer class="sheet-foot">${songCount(sl)} låter${t ? ` · ${fmtTotal(t)}` : ''}</footer>` : ''}
      </div>
      ${pages > 1 ? `<div class="sheet-pageno">Side ${pageNo} av ${pages}</div>` : ''}
    </div>`;
}

// Får innholdet plass på én side? (måler et ferdig tegnet ark)
function sheetFits(sheet) {
  const inner = sheet.querySelector('.sheet-inner');
  const cs = getComputedStyle(sheet);
  const roomH = sheet.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 2;
  const roomW = sheet.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + 1;
  return inner.scrollHeight <= roomH && inner.scrollWidth <= roomW;
}

// Deler radene i ekte sider: fyller hver side til neste rad ikke får plass.
// Måles i et usynlig område med samme stil, så sidene blir like i forhåndsvisning og utskrift.
function paginate(sl, o, fs) {
  const rows = sheetRows(sl, o);
  const measure = document.createElement('div');
  measure.className = 'print-measure';
  document.body.appendChild(measure);
  const fits = (slice, first, last) => {
    measure.innerHTML = pageHTML(sl, o, fs, { rows: slice, first, last, pages: 2 });
    return sheetFits(measure.firstElementChild);
  };
  const pages = [];
  let start = 0;
  do {
    let end = start;
    // Legg til rader så lenge siden har plass (minst én rad per side)
    while (end < rows.length && (end === start || fits(rows.slice(start, end + 1), start === 0, end + 1 === rows.length))) end++;
    pages.push(rows.slice(start, end));
    start = end;
  } while (start < rows.length);
  // Total spilletid på siste side – får den ikke plass, flyttes den til en egen side
  if (o.total && !fits(pages[pages.length - 1], pages.length === 1, true)) pages.push([]);
  measure.remove();
  return pages;
}

const printDialog = document.getElementById('printDialog');
const printForm = document.getElementById('printForm');
const printPreview = document.getElementById('printPreview');
let printTarget = null;
let printFs = 1;

function openPrintDialog(sl) {
  printTarget = sl;
  const o = loadPrintOptions();
  for (const el of printForm.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') el.checked = !!o[el.name];
    else if (el.type === 'radio') el.checked = o[el.name] === el.value;
    else el.value = o[el.name];
  }
  printDialog.showModal();
  updatePrintPreview();
}

function readPrintOptions() {
  const o = { ...PRINT_DEFAULTS };
  for (const el of printForm.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') {
      if (el.checked) o[el.name] = el.value;
    } else if (el.type === 'range') o[el.name] = Number(el.value);
  }
  return o;
}

let printPages = [[]];

function updatePrintPreview() {
  if (!printTarget) return;
  const o = readPrintOptions();
  savePrintOptions(o);
  printForm.querySelector('[name=size]').disabled = o.fit;
  document.getElementById('sizeValue').textContent = o.fit ? 'Automatisk' : `${o.size} %`;

  if (o.fit) {
    // Tilpass til én side: finn største skriftskala som får plass
    const rows = sheetRows(printTarget, o);
    printPreview.innerHTML = pageHTML(printTarget, o, 1, { rows });
    const sheet = printPreview.querySelector('.sheet');
    const fits = (fs) => {
      sheet.style.setProperty('--fs', fs);
      return sheetFits(sheet);
    };
    let lo = 0.3;
    let hi = o.layout === 'stage' ? 2.2 : 1.8;
    if (fits(hi)) lo = hi;
    else for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    printFs = Math.floor(lo * 100) / 100;
    printPages = [rows];
  } else {
    printFs = o.size / 100;
    printPages = paginate(printTarget, o, printFs);
  }

  // Tegn hver side som et eget A4-ark, skalert til forhåndsvisningen
  const MM = 96 / 25.4;
  const landscape = o.orientation === 'landscape';
  const pageW = (landscape ? 297 : 210) * MM;
  const pageH = (landscape ? 210 : 297) * MM;
  const box = printPreview.parentElement;
  const roomY = window.innerWidth > 760 ? window.innerHeight - 150 : Infinity; // en hel side synlig på større skjermer
  const scale = Math.min(1, (box.clientWidth - 2) / pageW, roomY / pageH);
  const count = printPages.length;
  printPreview.innerHTML = printPages
    .map(
      (rows, i) => `
      <div class="print-page" style="width:${pageW * scale}px;height:${pageH * scale}px">
        ${pageHTML(printTarget, o, printFs, { rows, first: i === 0, last: i === count - 1, pageNo: i + 1, pages: count })}
      </div>`
    )
    .join('');
  printPreview.querySelectorAll('.sheet').forEach((sh) => (sh.style.transform = `scale(${scale})`));
  printPreview.style.width = '';
  printPreview.style.height = '';

  document.getElementById('printInfo').textContent =
    `A4 ${landscape ? 'liggende' : 'stående'} · ${count} ${count === 1 ? 'side' : 'sider'}` +
    (o.fit ? ` · skrift ${Math.round(printFs * 100)} %` : '');
}

printForm.addEventListener('input', updatePrintPreview);
printForm.addEventListener('change', updatePrintPreview);
window.addEventListener('resize', () => printDialog.open && updatePrintPreview());
document.getElementById('printCancel').onclick = () => printDialog.close();

printForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const o = readPrintOptions();
  const count = printPages.length;
  // Nøyaktig de samme sidene som i forhåndsvisningen – hvert ark er én A4-side
  document.getElementById('stage').innerHTML = printPages
    .map((rows, i) => pageHTML(printTarget, o, printFs, { rows, first: i === 0, last: i === count - 1, pageNo: i + 1, pages: count }))
    .join('');
  document.getElementById('pageStyle').textContent = `@page { size: A4 ${o.orientation}; margin: 0; }`;
  printDialog.close();
  window.print();
});

/* ---------- Filer: tekst, noter og akkordskjema ---------- */

const MAX_FILE = 20 * 1024 * 1024;
const filesDialog = document.getElementById('filesDialog');
let filesTarget = null; // { sl, item }

function fmtSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

function fileKind(type, name) {
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (/^image\//.test(type)) return 'image';
  if (/^text\//.test(type) || /\.(txt|pro|cho|chopro|chordpro)$/i.test(name)) return 'text';
  return null;
}

const fileIcon = (kind) => ({ pdf: 'PDF', image: 'BILDE', text: 'TEKST' }[kind] || 'FIL');

function fileInUse(id) {
  return setlists.some((sl) => sl.items.some((i) => (i.files || []).some((f) => f.id === id)));
}

// Slett filer som ingen låt bruker lenger (etter at «Angre» har gått ut)
function scheduleFileCleanup(files) {
  const ids = (files || []).map((f) => f.id);
  if (!ids.length || !window.cloud?.signedIn) return;
  setTimeout(() => {
    for (const id of ids) if (!fileInUse(id)) window.cloud.deleteFile(id).catch(() => {});
  }, 9000);
}

// Bilder gjøres om til JPEG (maks 2400 px) – sparer plass og gjør HEIC/WebP lesbare i PDF
async function prepareImage(file) {
  if ((file.type === 'image/jpeg' || file.type === 'image/png') && file.size < 1.5 * 1024 * 1024) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Klarte ikke å lese bildet.'));
      i.src = url;
    });
    const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// iOS blokkerer vinduer som åpnes etter en await – åpne fanen først, fyll den etterpå
function openBlobLater(filename) {
  const win = window.open('', '_blank');
  if (win) {
    try {
      win.document.title = filename;
      win.document.body.style.cssText = 'background:#0b0a10;color:#9e95b0;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0';
      win.document.body.textContent = 'Henter …';
    } catch (_) {}
  }
  return {
    show(blob) {
      const url = URL.createObjectURL(blob);
      if (win && !win.closed) win.location.href = url;
      else {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
    close() {
      if (win && !win.closed) win.close();
    },
  };
}

function openFilesDialog(sl, item) {
  filesTarget = { sl, item };
  renderFilesDialog();
  filesDialog.showModal();
}

function renderFilesDialog(status = '') {
  if (!filesTarget) return;
  const { item } = filesTarget;
  const files = item.files || [];
  const signedIn = !!window.cloud?.signedIn;
  const body = document.getElementById('filesBody');
  document.getElementById('filesTitle').textContent = item.title || 'Låt';
  document.getElementById('filesSub').textContent = item.artist || '';

  body.innerHTML = !signedIn
    ? `<div class="files-login">
        <p>Filer lagres i skyen og deles med alle som bruker samme kode. Logg inn med kode for å laste opp tekst og noter.</p>
        <button type="button" class="btn primary" id="filesLogin">Logg inn med kode</button>
      </div>`
    : `${
        files.length
          ? `<ul class="file-list">${files
              .map(
                (f, i) => `
            <li data-file="${f.id}">
              <span class="file-kind ${fileKind(f.type, f.name)}">${fileIcon(fileKind(f.type, f.name))}</span>
              <button type="button" class="file-name" data-fact="open" title="Åpne">${esc(f.name)}<small>${fmtSize(f.size)}</small></button>
              <span class="file-actions">
                ${i > 0 ? '<button type="button" class="icon-btn" data-fact="up" aria-label="Flytt opp">↑</button>' : ''}
                <button type="button" class="icon-btn danger" data-fact="del" aria-label="Fjern">✕</button>
              </span>
            </li>`
              )
              .join('')}</ul>`
          : '<p class="files-empty">Ingen filer ennå. Last opp tekst, noter eller akkordskjema.</p>'
      }
      <label class="upload-zone">
        <input type="file" id="fileInput" multiple
               accept="application/pdf,image/*,text/plain,.pdf,.txt,.pro,.cho,.chopro,.chordpro" />
        <strong>＋ Last opp filer</strong>
        <span>PDF, bilde (f.eks. bilde av noter) eller tekstfil · maks 20 MB</span>
      </label>
      <p class="hint files-status" id="filesStatus">${esc(status)}</p>`;

  document.getElementById('filesLogin')?.addEventListener('click', () => {
    filesDialog.close();
    openCodeDialog();
  });
  document.getElementById('fileInput')?.addEventListener('change', (e) => uploadFiles([...e.target.files]));
}

async function uploadFiles(list) {
  const { sl, item } = filesTarget;
  const status = (t) => {
    const el = document.getElementById('filesStatus');
    if (el) el.textContent = t;
  };
  document.querySelector('.upload-zone')?.classList.add('busy');
  let done = 0;
  for (const original of list) {
    try {
      const kind = fileKind(original.type, original.name);
      if (!kind) throw new Error(`«${original.name}» har et filformat som ikke støttes.`);
      const file = kind === 'image' ? await prepareImage(original) : original;
      if (file.size > MAX_FILE) throw new Error(`«${original.name}» er større enn 20 MB.`);
      const type = file.type || (kind === 'pdf' ? 'application/pdf' : 'text/plain');
      const meta = { id: uid(), name: file.name, type, size: file.size };
      status(`Laster opp «${meta.name}» …`);
      await window.cloud.uploadFile(meta.id, file, meta, (p) =>
        status(`Laster opp «${meta.name}» … ${Math.round(p * 100)} %`)
      );
      item.files = [...(item.files || []), meta];
      touch(sl);
      done++;
    } catch (err) {
      renderFilesDialog(err.message);
      renderSongs(sl);
      return;
    }
  }
  renderFilesDialog(done ? `${done} ${done === 1 ? 'fil' : 'filer'} lastet opp` : '');
  renderSongs(sl);
}

filesDialog.addEventListener('click', async (e) => {
  if (e.target === filesDialog) return filesDialog.close(); // klikk utenfor
  const btn = e.target.closest('[data-fact]');
  if (!btn || !filesTarget) return;
  const { sl, item } = filesTarget;
  const id = btn.closest('[data-file]').dataset.file;
  const idx = item.files.findIndex((f) => f.id === id);
  const f = item.files[idx];

  if (btn.dataset.fact === 'open') {
    const view = openBlobLater(f.name);
    try {
      view.show(await window.cloud.fetchFile(f.id));
    } catch (err) {
      view.close();
      renderFilesDialog(err.message);
    }
  } else if (btn.dataset.fact === 'up' && idx > 0) {
    [item.files[idx - 1], item.files[idx]] = [item.files[idx], item.files[idx - 1]];
    touch(sl);
    renderFilesDialog();
  } else if (btn.dataset.fact === 'del') {
    item.files.splice(idx, 1);
    touch(sl);
    renderFilesDialog(`«${f.name}» fjernet`);
    renderSongs(sl);
    if (!fileInUse(f.id)) window.cloud.deleteFile(f.id).catch(() => {});
  }
});
document.getElementById('filesClose').onclick = () => filesDialog.close();

/* ---------- Notehefte: alle filer samlet i setlistens rekkefølge ---------- */

let pdfLib = null;
const loadPdfLib = () => (pdfLib ||= import('./vendor/pdf-lib/pdf-lib.esm.min.js'));

async function buildSongbook(sl) {
  const songs = [];
  let n = 0;
  for (const item of sl.items) {
    if (item.type === 'song') n++;
    if (item.type === 'song' && (item.files || []).length) songs.push({ n, item });
  }
  if (!songs.length) {
    toast('Ingen låter har filer ennå – trykk på notesymbolet på en låt for å laste opp.');
    return;
  }
  if (!window.cloud?.signedIn) {
    toast('Logg inn med kode for å lage notehefte.');
    return;
  }

  const filename = `${(sl.name || 'Setlist').replace(/[\\/:*?"<>|]+/g, '').trim()} - notehefte.pdf`;
  const view = openBlobLater(filename);
  const btn = document.getElementById('bookBtn');
  btn.disabled = true;
  btn.textContent = 'Lager notehefte …';

  try {
    const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
    const doc = await PDFDocument.create();
    doc.setTitle(`${sl.name || 'Setlist'} – notehefte`);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const mono = await doc.embedFont(StandardFonts.Courier);
    const A4 = [595.28, 841.89];
    const grey = rgb(0.45, 0.45, 0.45);

    // Standardfontene kan bare skrive WinAnsi-tegn (æøå går fint); bytt ut resten
    const MUSIC = { '♯': '#', '♭': 'b', '♮': '', '𝄪': 'x', '♪': '', '♫': '' };
    const safe = (font, text) =>
      [...String(text || '')]
        .map((ch) => (ch in MUSIC ? MUSIC[ch] : ch))
        .map((ch) => {
          try {
            font.encodeText(ch);
            return ch;
          } catch (_) {
            return '?';
          }
        })
        .join('');

    // Forside med hele setlisten
    let page = doc.addPage(A4);
    let y = A4[1] - 70;
    page.drawText(safe(bold, (sl.name || 'Setlist').toUpperCase()), { x: 50, y, size: 24, font: bold });
    y -= 22;
    const sub = [sl.date, sl.venue].filter(Boolean).join(' · ');
    if (sub) page.drawText(safe(regular, sub), { x: 50, y, size: 11, font: regular, color: grey }), (y -= 16);
    y -= 18;
    let k = 0;
    for (const item of sl.items) {
      if (y < 60) (page = doc.addPage(A4)), (y = A4[1] - 60);
      if (item.type === 'break') {
        page.drawText(safe(bold, `— ${(item.title || 'Pause').toUpperCase()} —`), { x: 70, y, size: 11, font: bold, color: grey });
      } else {
        k++;
        const hasFiles = (item.files || []).length;
        page.drawText(`${k}.`, { x: 50, y, size: 13, font: bold, color: grey });
        page.drawText(safe(bold, item.title), { x: 76, y, size: 13, font: bold });
        const extra = [item.artist, item.key && `(${item.key})`, !hasFiles && '– ingen filer'].filter(Boolean).join('  ');
        if (extra) page.drawText(safe(regular, extra), { x: 80 + bold.widthOfTextAtSize(safe(bold, item.title), 13), y, size: 10, font: regular, color: grey });
      }
      y -= 21;
    }

    const label = (p, song) => {
      const t = safe(regular, `${song.n}. ${song.item.title}`);
      const { width } = p.getSize();
      p.drawText(t, { x: width - 24 - regular.widthOfTextAtSize(t, 8), y: 12, size: 8, font: regular, color: grey });
    };

    let fileCount = 0;
    for (const [i, song] of songs.entries()) {
      for (const f of song.item.files) {
        btn.textContent = `Lager notehefte … ${i + 1}/${songs.length}`;
        let blob;
        try {
          blob = await window.cloud.fetchFile(f.id);
        } catch (_) {
          continue;
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const kind = fileKind(f.type, f.name);
        if (kind === 'pdf') {
          const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
          const pages = await doc.copyPages(src, src.getPageIndices());
          pages.forEach((p) => (doc.addPage(p), label(p, song)));
        } else if (kind === 'image') {
          const img = f.type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
          const p = doc.addPage(A4);
          const s = Math.min((A4[0] - 40) / img.width, (A4[1] - 50) / img.height);
          p.drawImage(img, { x: (A4[0] - img.width * s) / 2, y: A4[1] - 20 - img.height * s, width: img.width * s, height: img.height * s });
          label(p, song);
        } else if (kind === 'text') {
          const lines = new TextDecoder().decode(bytes).replace(/\t/g, '    ').split(/\r?\n/);
          let p = doc.addPage(A4);
          let ty = A4[1] - 60;
          p.drawText(safe(bold, `${song.n}. ${song.item.title}`), { x: 50, y: ty, size: 16, font: bold });
          ty -= 28;
          for (const line of lines) {
            if (ty < 40) label(p, song), (p = doc.addPage(A4)), (ty = A4[1] - 50);
            p.drawText(safe(mono, line).slice(0, 90), { x: 50, y: ty, size: 10.5, font: mono });
            ty -= 14;
          }
          label(p, song);
        }
        fileCount++;
      }
    }

    view.show(new Blob([await doc.save()], { type: 'application/pdf' }));
    toast(`Notehefte med ${fileCount} filer fra ${songs.length} låter`);
  } catch (err) {
    view.close();
    toast(`Klarte ikke å lage notehefte: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Notehefte (PDF)';
  }
}

/* ---------- Start ---------- */
route();
