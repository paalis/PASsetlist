// Kobler appen til Firebase (Google-innlogging + Firestore).
// Kommuniserer med app.js via hendelser på window:
//   cloud:ready  { enabled }      – om Firebase er konfigurert
//   cloud:user   { user | null }  – innlogget bruker endret seg
//   cloud:data   { setlists }     – setlistene i kontoen (ved hver endring)
//   cloud:error  { message }
import { firebaseConfig } from './firebase-config.js';

const SDK = './vendor/firebase'; // Firebase JS SDK 10.12.2 (fra npm-pakken «firebase»)
const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

async function start() {
  if (!firebaseConfig || !firebaseConfig.apiKey) {
    emit('cloud:ready', { enabled: false });
    return;
  }

  const [{ initializeApp }, authMod, fs] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut } = authMod;
  const { initializeFirestore, persistentLocalCache, collection, doc, setDoc, deleteDoc, onSnapshot } = fs;

  const fbApp = initializeApp(firebaseConfig);
  const auth = getAuth(fbApp);
  let db;
  try {
    db = initializeFirestore(fbApp, { localCache: persistentLocalCache() });
  } catch (_) {
    db = initializeFirestore(fbApp, {});
  }

  let uid = null;
  let unsubscribe = null;
  const ref = (id) => doc(db, 'users', uid, 'setlists', id);
  // Firestore tåler ikke undefined-verdier
  const clean = (obj) => JSON.parse(JSON.stringify(obj));

  window.cloud = {
    async signIn() {
      const provider = new GoogleAuthProvider();
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        if (e.code === 'auth/popup-blocked') return signInWithRedirect(auth, provider);
        throw e;
      }
    },
    signOut: () => signOut(auth),
    save: (sl) => (uid ? setDoc(ref(sl.id), clean(sl)) : Promise.resolve()),
    remove: (id) => (uid ? deleteDoc(ref(id)) : Promise.resolve()),
  };

  onAuthStateChanged(auth, (user) => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    uid = user ? user.uid : null;
    emit('cloud:user', {
      user: user && { uid: user.uid, name: user.displayName, email: user.email, photo: user.photoURL },
    });
    if (!user) return;
    unsubscribe = onSnapshot(
      collection(db, 'users', uid, 'setlists'),
      (snap) => emit('cloud:data', { setlists: snap.docs.map((d) => d.data()) }),
      (err) => emit('cloud:error', { message: err.message })
    );
  });

  emit('cloud:ready', { enabled: true });
}

start().catch((e) => {
  console.error(e);
  emit('cloud:ready', { enabled: false });
  emit('cloud:error', { message: 'Kunne ikke koble til Firebase. Setlistene lagres lokalt.' });
});
