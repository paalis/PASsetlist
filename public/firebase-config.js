// Firebase-konfigurasjon for nettappen.
//
// Hent verdiene i Firebase-konsollen: Prosjektinnstillinger → Generelt → «Dine apper» → Nettapp.
// Disse verdiene er ikke hemmelige (de sendes uansett til nettleseren). Tilgangen styres av
// sikkerhetsreglene i firestore.rules.
//
// Så lenge apiKey er tom, lagres setlistene bare lokalt i nettleseren.
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};
