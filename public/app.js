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
  if (m && getSetlist(m[1])) renderEditor(getSetlist(m[1]));
  else renderHome();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

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

  app.innerHTML = `
    <section class="hero">
      <div class="hero-lights" aria-hidden="true"><i></i><i></i><i></i></div>
      <p class="eyebrow">Fra spilleliste til scene</p>
      <h1>Bygg kveldens <span class="grad">setlist</span></h1>
      <p class="lead">Lim inn en Spotify-spilleliste, så får du en setlist du kan stokke om, notere i og ta med på scenen.</p>
      <div class="hero-actions">
        <button class="btn primary big" id="newBtn">＋ Opprett ny setlist</button>
        ${cloudEnabled && !cloudUser ? '<button class="btn outline big" id="heroSignIn">Logg inn med kode</button>' : ''}
      </div>
      <div class="eq" aria-hidden="true">${'<span></span>'.repeat(28)}</div>
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
          <a class="card" href="#/s/${s.id}">
            <div class="stub">${stub(s)}</div>
            <div class="card-body">
              <h3>${esc(s.name || 'Uten navn')}</h3>
              <div class="meta">${songCount(s)} låter${totalMs(s) ? ` · ${fmtTotal(totalMs(s))}` : ''}</div>
              <div class="meta">${s.venue ? esc(s.venue) : `Endret ${fmtDate(s.updatedAt)}`}</div>
            </div>
            <div class="card-menu">
              <button class="icon-btn" data-dup="${s.id}" title="Dupliser" aria-label="Dupliser">⧉</button>
              <button class="icon-btn danger" data-del="${s.id}" title="Slett" aria-label="Slett">✕</button>
            </div>
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

function renderEditor(sl) {
  document.title = `${sl.name || 'Setlist'} – Setlist Generator`;

  app.innerHTML = `
    <div class="editor-head">
      <a href="#/" class="back">← Alle setlister</a>
      <p class="eyebrow">Setlist</p>
      <input class="title-input" id="slName" value="${esc(sl.name)}" placeholder="Navn på setlisten" aria-label="Navn" />
      <div class="meta-grid">
        <label>Dato<input class="plain" id="slDate" type="date" value="${esc(sl.date)}" /></label>
        <label>Sted<input class="plain" id="slVenue" value="${esc(sl.venue)}" placeholder="F.eks. Rockefeller" /></label>
        <label>Notater<input class="plain" id="slNotes" value="${esc(sl.notes)}" placeholder="Generelle notater" /></label>
      </div>
    </div>

    <div class="toolbar">
      <div class="stats" id="stats"></div>
      <div class="group">
        <button class="btn small" id="addSpotify">＋ Fra Spotify</button>
        <button class="btn small" id="copyBtn">Kopier som tekst</button>
        <button class="btn small" id="printBtn">Skriv ut</button>
      </div>
    </div>

    <div class="cols" aria-hidden="true">
      <span></span><span class="r">#</span><span>Tittel</span><span>Artist</span><span class="c">Toneart</span><span>Notat</span><span class="r">Tid</span><span class="spacer"></span>
    </div>
    <ol class="songs" id="songs"></ol>

    <div class="add-row">
      <button class="btn small" id="addSong">＋ Legg til låt</button>
      <button class="btn small" id="addBreak">＋ Pause / sett-skille</button>
      ${sl.spotifyUrl ? `<a class="btn small ghost" href="${esc(sl.spotifyUrl)}" target="_blank" rel="noopener">Åpne i Spotify ↗</a>` : ''}
    </div>

    <section class="stage" id="stage"></section>
  `;

  const bind = (id, field) => {
    document.getElementById(id).addEventListener('input', (e) => {
      sl[field] = e.target.value;
      touch(sl);
      if (field === 'name') document.title = `${sl.name || 'Setlist'} – Setlist Generator`;
    });
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

  document.getElementById('printBtn').onclick = () => {
    renderStage(sl);
    document.body.classList.toggle('print-compact', sl.items.length > 22);
    window.print();
  };

  renderSongs(sl);
}

function updateStats(sl) {
  const el = document.getElementById('stats');
  if (!el) return;
  const t = totalMs(sl);
  el.innerHTML = `<strong>${songCount(sl)}</strong> låter${t ? ` · <strong>${fmtTotal(t)}</strong>` : ''}`;
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
        <input class="key" data-f="key" value="${esc(item.key)}" placeholder="Toneart" aria-label="Toneart" />
        <input class="notes" data-f="notes" value="${esc(item.notes)}" placeholder="Notat" aria-label="Notat" />
        <input class="dur" data-f="dur" value="${esc(fmtDuration(item.durationMs))}" placeholder="m:ss" aria-label="Varighet" />
        ${rowActions()}
      </li>`;
    })
    .join('');

  if (!sl.items.length) {
    list.innerHTML = `<li class="empty" style="padding:32px">Listen er tom. Legg til låter under eller hent fra Spotify.</li>`;
  }

  updateStats(sl);
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

  if (act === 'del') {
    const [removed] = sl.items.splice(idx, 1);
    touch(sl);
    renderSongs(sl);
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

function renderStage(sl) {
  const stage = document.getElementById('stage');
  let n = 0;
  const sub = [sl.date && fmtDate(sl.date), sl.venue, sl.notes].filter(Boolean).map(esc).join(' · ');
  stage.innerHTML = `
    <h1>${esc(sl.name || 'Setlist')}</h1>
    ${sub ? `<div class="sub">${sub}</div>` : ''}
    <ol>
      ${sl.items
        .map((i) => {
          if (i.type === 'break') return `<li class="brk">${esc(i.title || 'Pause')}</li>`;
          n++;
          return `<li>
            <span class="n">${n}</span>
            <span>${esc(i.title)}</span>
            ${i.key ? `<span class="k">${esc(i.key)}</span>` : ''}
            ${i.artist ? `<span class="a">${esc(i.artist)}</span>` : ''}
            ${i.notes ? `<span class="x">${esc(i.notes)}</span>` : ''}
          </li>`;
        })
        .join('')}
    </ol>`;
}

/* ---------- Start ---------- */
route();
