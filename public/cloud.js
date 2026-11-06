// Kobler appen til Firebase Firestore med innlogging via kode.
//
// Alle som skriver inn samme kode, deler de samme setlistene (f.eks. et band).
// Koden lagres aldri i databasen: den gjøres om til en SHA-256-hash, og hashen
// bestemmer hvor setlistene ligger (spaces/{hash}/setlists/{id}).
//
// Kommuniserer med app.js via hendelser på window:
//   cloud:ready  { enabled }      – om Firebase er konfigurert
//   cloud:user   { user | null }  – innlogget med kode / logget ut
//   cloud:data   { setlists }     – setlistene for koden (ved hver endring)
//   cloud:error  { message }
import { firebaseConfig } from './firebase-config.js';

const SDK = './vendor/firebase'; // Firebase JS SDK 10.12.2 (fra npm-pakken «firebase»)
const CODE_KEY = 'setlist-generator.code'; // intern nøkkel fra før navnebyttet – beholdes
const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

export function normalizeCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

async function hashCode(code) {
  // NB: «setlist-generator:» er fra det gamle navnet og MÅ beholdes – endres det, peker
  // alle bandkoder til nye, tomme områder i databasen og setlistene ser borte ut.
  const bytes = new TextEncoder().encode(`setlist-generator:${normalizeCode(code)}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readStoredCode() {
  try {
    return localStorage.getItem(CODE_KEY);
  } catch (_) {
    return null;
  }
}

function storeCode(code) {
  try {
    if (code) localStorage.setItem(CODE_KEY, code);
    else localStorage.removeItem(CODE_KEY);
  } catch (_) {}
}

async function start() {
  if (!firebaseConfig || !firebaseConfig.apiKey) {
    emit('cloud:ready', { enabled: false });
    return;
  }

  const [{ initializeApp }, fs] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const { initializeFirestore, persistentLocalCache, collection, doc, setDoc, getDoc, getDocs, deleteDoc, onSnapshot, query, where, Bytes } = fs;

  const fbApp = initializeApp(firebaseConfig);
  let db;
  try {
    db = initializeFirestore(fbApp, { localCache: persistentLocalCache() });
  } catch (_) {
    db = initializeFirestore(fbApp, {});
  }

  let space = null;
  let unsubscribe = null;
  const ref = (id) => doc(db, 'spaces', space, 'setlists', id);
  const clean = (obj) => JSON.parse(JSON.stringify(obj)); // Firestore tåler ikke undefined

  async function signIn(rawCode) {
    const code = normalizeCode(rawCode);
    if (code.length < 6) throw new Error('Koden må ha minst 6 tegn.');
    if (unsubscribe) unsubscribe();
    space = await hashCode(code);
    storeCode(code);
    emit('cloud:user', { user: { code } });
    unsubscribe = onSnapshot(
      collection(db, 'spaces', space, 'setlists'),
      (snap) => emit('cloud:data', { setlists: snap.docs.map((d) => d.data()) }),
      (err) =>
        emit('cloud:error', {
          message:
            err.code === 'permission-denied'
              ? 'Databasen nekter tilgang – sjekk sikkerhetsreglene i Firebase.'
              : err.message,
        })
    );
  }

  function signOut() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    space = null;
    storeCode(null);
    emit('cloud:user', { user: null });
  }

  window.cloud = {
    signIn,
    signOut,
    save: (sl) => (space ? setDoc(ref(sl.id), clean(sl)) : Promise.resolve()),
    remove: (id) => (space ? deleteDoc(ref(id)) : Promise.resolve()),
    get signedIn() {
      return !!space;
    },
    uploadFile,
    fetchFile,
    deleteFile,
    loadAnnotations,
    saveAnnotations,
    watchAnnotations,
  };

  /* ---------- Filer (noter, tekst, akkordskjema) ----------
     Firebase Storage krever betalingsplan, så filene lagres i Firestore,
     delt opp i biter: spaces/{hash}/files/{id} (info) + .../chunks/{n} (data). */
  const CHUNK = 750000;
  const fileRef = (id) => doc(db, 'spaces', space, 'files', id);
  const chunkRef = (id, n) => doc(db, 'spaces', space, 'files', id, 'chunks', String(n));
  const fileCache = new Map();

  async function uploadFile(id, blob, meta, onProgress) {
    if (!space) throw new Error('Logg inn med kode for å laste opp filer.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunks = Math.max(1, Math.ceil(bytes.length / CHUNK));
    for (let n = 0; n < chunks; n++) {
      await setDoc(chunkRef(id, n), { data: Bytes.fromUint8Array(bytes.subarray(n * CHUNK, (n + 1) * CHUNK)) });
      if (onProgress) onProgress((n + 1) / chunks);
    }
    // Info-dokumentet skrives sist, så en avbrutt opplasting aldri ser komplett ut
    await setDoc(fileRef(id), { name: meta.name, type: meta.type, size: bytes.length, chunks, createdAt: Date.now() });
    fileCache.set(id, new Blob([bytes], { type: meta.type }));
  }

  async function fetchFile(id) {
    if (fileCache.has(id)) return fileCache.get(id);
    if (!space) throw new Error('Logg inn med kode for å åpne filer.');
    const info = await getDoc(fileRef(id));
    if (!info.exists()) throw new Error('Filen finnes ikke lenger.');
    const { chunks, type } = info.data();
    const parts = await Promise.all(
      Array.from({ length: chunks }, (_, n) => getDoc(chunkRef(id, n)).then((d) => d.data().data.toUint8Array()))
    );
    const blob = new Blob(parts, { type });
    fileCache.set(id, blob);
    return blob;
  }

  /* ---------- Pencil-notater ----------
     Ett dokument per side: spaces/{hash}/annotations/{filId}_{side}
     { fileId, page, strokes: [{ t, c, w, p: [x, y, trykk, ...] }], updatedAt }
     Koordinatene er normalisert (0–1) til sidens bredde/høyde. */
  const annRef = (fileId, page) => doc(db, 'spaces', space, 'annotations', `${fileId}_${page}`);

  async function loadAnnotations(fileId, page) {
    if (!space) return [];
    const snap = await getDoc(annRef(fileId, page));
    return snap.exists() ? snap.data().strokes || [] : [];
  }

  async function saveAnnotations(fileId, page, strokes) {
    if (!space) throw new Error('Logg inn med kode for å lagre notater.');
    if (!strokes.length) return deleteDoc(annRef(fileId, page));
    return setDoc(annRef(fileId, page), clean({ fileId, page, strokes, updatedAt: Date.now() }));
  }

  /** Sanntid: kaller cb(strokes) når andre i bandet endrer notatene på siden. */
  function watchAnnotations(fileId, page, cb) {
    if (!space) return () => {};
    return onSnapshot(annRef(fileId, page), (snap) => cb(snap.exists() ? snap.data().strokes || [] : []), () => {});
  }

  async function deleteAnnotationsFor(fileId) {
    const snap = await getDocs(query(collection(db, 'spaces', space, 'annotations'), where('fileId', '==', fileId)));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  }

  async function deleteFile(id) {
    if (!space) return;
    fileCache.delete(id);
    deleteAnnotationsFor(id).catch(() => {});
    const info = await getDoc(fileRef(id));
    const chunks = info.exists() ? info.data().chunks : 0;
    await deleteDoc(fileRef(id));
    await Promise.all(Array.from({ length: chunks }, (_, n) => deleteDoc(chunkRef(id, n))));
  }

  emit('cloud:ready', { enabled: true });

  const saved = readStoredCode();
  if (saved) signIn(saved).catch(() => storeCode(null));
}

start().catch((e) => {
  console.error(e);
  emit('cloud:ready', { enabled: false });
  emit('cloud:error', { message: 'Kunne ikke koble til databasen. Setlistene lagres lokalt.' });
});
