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
const CODE_KEY = 'setlist-generator.code';
const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

export function normalizeCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

async function hashCode(code) {
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
  const { initializeFirestore, persistentLocalCache, collection, doc, setDoc, deleteDoc, onSnapshot } = fs;

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
  };

  emit('cloud:ready', { enabled: true });

  const saved = readStoredCode();
  if (saved) signIn(saved).catch(() => storeCode(null));
}

start().catch((e) => {
  console.error(e);
  emit('cloud:ready', { enabled: false });
  emit('cloud:error', { message: 'Kunne ikke koble til databasen. Setlistene lagres lokalt.' });
});
