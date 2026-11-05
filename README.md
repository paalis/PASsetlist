# Setlist Generator

Lag setlister fra Spotify-spillelister. Lim inn en lenke, så hentes tittel og artist
for alle låtene, og du kan jobbe videre med listen.

## Funksjoner

- **Opprett ny** → lim inn lenke til en Spotify-spilleliste (eller et album), eller lim inn tekst / start med tom liste
- Rediger tittel, artist, toneart, notat og varighet direkte i listen
- Endre rekkefølge med dra-og-slipp (fungerer også på mobil) eller pilknapper
- Legg til låter, pauser / sett-skiller, og flere låter fra en annen Spotify-liste
- Total spilletid, dato og sted for spillejobben
- Skriv ut en scenevennlig setlist med store bokstaver, eller kopier som tekst
- Angre sletting, dupliser setlister, sikkerhetskopi til/fra fil
- Logg inn med Google for å lagre setlistene i Firebase og bruke dem på flere enheter
- Uten innlogging lagres alt lokalt i nettleseren (localStorage)

## Kjør lokalt

Krever Node.js 18 eller nyere. Ingen avhengigheter må installeres.

```bash
npm start
```

Åpne <http://localhost:3000>.

## Hvordan låtene hentes

Serveren (`/api/playlist`) henter den offentlige embed-siden til spillelisten og leser
ut tittel og artist. Det krever ingen innlogging, men listen må være offentlig, og
embed-siden viser normalt maks ca. 100 spor.

For lengre lister kan du bruke Spotify Web API ved å opprette en app på
<https://developer.spotify.com/dashboard> og sette miljøvariablene:

```bash
SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=... npm start
```

Faller API-et gjennom, brukes embed-siden automatisk.

## Lagring i Firebase

Uten oppsett lagres setlistene bare i nettleseren. Slik kobler du til Firebase:

1. Gå til <https://console.firebase.google.com> og opprett et prosjekt.
2. **Authentication** → Kom i gang → **Sign-in method** → slå på **Google**.
3. **Authentication** → **Settings** → **Authorized domains** → legg til `setlistgenerator.vercel.app`
   (og eventuelt `passetlist.vercel.app`). `localhost` er med fra før.
4. **Firestore Database** → Opprett database (produksjonsmodus, f.eks. region `eur3`).
5. **Firestore Database** → **Regler** → lim inn innholdet i `firestore.rules` og publiser.
   (Eller med Firebase CLI: `firebase deploy --only firestore:rules`.)
6. **Prosjektinnstillinger** → Generelt → «Dine apper» → legg til en **nettapp** og kopier
   `firebaseConfig`-verdiene inn i `public/firebase-config.js`.
7. Commit og push til `main` – Vercel publiserer automatisk.

Data lagres som `users/{uid}/setlists/{id}`, og reglene sørger for at hver bruker bare
får tilgang til sine egne setlister. Første gang man logger inn, flyttes setlister som
ligger lokalt i nettleseren over til kontoen. Endringer synkroniseres i sanntid mellom
enheter, og fungerer også uten nett (synkroniseres når nettet er tilbake).

## Publisering

Prosjektet kan publiseres direkte på Vercel: `public/` serveres som statiske filer og
`api/playlist.js` blir en serverless-funksjon. Legg eventuelt inn
`SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` som miljøvariabler i prosjektet.

## Tester

```bash
npm test
```
