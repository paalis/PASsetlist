// Firebase-konfigurasjon for nettappen.
//
// Hent verdiene i Firebase-konsollen: Prosjektinnstillinger → Generelt → «Dine apper» → Nettapp.
// Disse verdiene er ikke hemmelige (de sendes uansett til nettleseren). Tilgangen styres av
// sikkerhetsreglene i firestore.rules.
//
// Så lenge apiKey er tom, lagres setlistene bare lokalt i nettleseren.
export const firebaseConfig = {
  apiKey: 'AIzaSyBXiysNb-vvjNmgPH6B3mjZmlC3U9NB-oQ',
  authDomain: 'setlist-generator-ea51f.firebaseapp.com',
  projectId: 'setlist-generator-ea51f',
  storageBucket: 'setlist-generator-ea51f.firebasestorage.app',
  messagingSenderId: '1098264014878',
  appId: '1:1098264014878:web:895dae18a8fc4be1be3e0f',
};
