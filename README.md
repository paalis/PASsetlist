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
- Logg inn med en kode for å lagre setlistene i Firebase – alle med samme kode deler de samme setlistene
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

## Lagring i Firebase (innlogging med kode)

Man logger inn med en kode (minst 6 tegn). Alle som bruker samme kode, ser og redigerer de
samme setlistene, for eksempel alle i et band. Koden lagres aldri: den gjøres om til en
SHA-256-hash, og setlistene ligger under `spaces/{hash}/setlists/{id}` i Firestore. Siden
ingen kan liste opp alle spaces, fungerer koden som et passord – bruk derfor en kode som er
vanskelig å gjette (appen kan lage en tilfeldig kode for deg).

Oppsett:

1. Opprett et prosjekt på <https://console.firebase.google.com> og en **Firestore Database**.
2. **Firestore Database** → **Regler** → lim inn innholdet i `firestore.rules` og publiser
   (eller `firebase deploy --only firestore:rules`).
3. Legg inn nettapp-konfigurasjonen i `public/firebase-config.js`.

Første gang man logger inn med en kode, flyttes setlister som ligger lokalt i nettleseren over
til koden. Endringer synkroniseres i sanntid mellom enheter, og fungerer også uten nett.

Firebase JS SDK (10.12.2) ligger i `public/vendor/firebase`, og fontene (Oswald og Inter, OFL)
i `public/fonts`, så appen ikke er avhengig av eksterne CDN-er.

## Publisering

Prosjektet kan publiseres direkte på Vercel: `public/` serveres som statiske filer og
`api/playlist.js` blir en serverless-funksjon. Legg eventuelt inn
`SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` som miljøvariabler i prosjektet.

## Tester

```bash
npm test
```
