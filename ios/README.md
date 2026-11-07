# Setlist Live for iPad (Swift Playgrounds / Xcode)

En egen iPad-app som virker helt uten nett. Bygges og kjøres rett på iPaden i
Swift Playgrounds – ingen Mac og ingen betalt utviklerkonto.

## Funksjoner
Samme utseende og samme data som nettsiden (setlistlive.vercel.app):
- **Bandkode:** logg inn med samme kode som på nettsiden – setlister, filer og Pencil-notater
  deles begge veier. Snakker med Firestore over REST (ingen Firebase-bibliotek nødvendig).
- **Virker uten nett:** alt lagres på iPaden først. Endringer sendes når det er nett igjen, og
  alle filer lastes ned i bakgrunnen så notene er klare på scenen.
- Konsert-tema som nettsiden: konsertfoto, plakatfonten Anton, setlister som billetter,
  vinylplate med Spotify-cover og dato.
- Setlister fra Spotify-lenke eller tekst, sortering, pauser, toneart, notater og varighet.
- Filer per låt (PDF, bilder, tekst) – lastes opp til bandet.
- **Scenemodus** med Pencil-notater: Pencil tegner, fingeren blar (sveip/trykk i kanten),
  pedal/piltaster. Penn i tre farger, markør, viskelær og angre. «Tegn med finger» for
  simulatoren eller uten Pencil. Notatene vises også på nettsiden, og omvendt.
- **Notehefte** (PDF med notatene) og **utskrift** med valg (scene/kompakt/to kolonner,
  retning, tilpass til én side, hva som vises, lys/mørk).

## Slik får du den på iPaden
1. Installer **Swift Playgrounds** fra App Store (gratis).
2. Få mappen `Setlist.swiftpm` over på iPaden, for eksempel:
   - Åpne `Setlist-iPad.zip` (fra Claude eller fra GitHub) i Filer-appen, og trykk på den
     for å pakke ut. Legg gjerne mappen i iCloud Drive → Playgrounds.
   - Eller last ned hele repoet fra GitHub (Code → Download ZIP) og pakk ut.
3. Trykk på `Setlist.swiftpm` i Filer – den åpnes i Swift Playgrounds.
4. Trykk ▶ (Kjør). Første gang tar det litt tid å bygge.

Ikonet kan endres i Playgrounds under appinnstillinger (⋯ → App-innstillinger).

## Med Xcode og gratis Apple-ID (Mac)
1. Installer **Xcode** fra App Store på Macen (gratis, stor nedlasting).
2. Xcode → Settings → **Accounts** → «+» → Apple ID. Logg inn med din vanlige Apple-ID
   (det blir et «Personal Team»).
3. Last ned repoet (eller `Setlist-iPad.zip`) og åpne mappen **`Setlist.swiftpm`** i Xcode
   (File → Open, velg mappen).
4. Velg prosjektet i venstre kolonne → **Signing & Capabilities** → **Team**: ditt Personal Team.
   Får du feil om bundle identifier, endre den til noe unikt, f.eks. `no.dittnavn.setlistlive`.
5. Koble iPaden til Macen med kabel og trykk «Stol på» på iPaden. Velg iPaden øverst i Xcode.
6. Slå på **Utviklermodus** på iPaden: Innstillinger → Personvern og sikkerhet → Utviklermodus
   (iPaden starter på nytt).
7. Trykk ▶ (Run) i Xcode.
8. Første gang: på iPaden, Innstillinger → Generelt → VPN og enhetsadministrasjon →
   velg Apple-ID-en din → **Stol på**. Trykk ▶ igjen.

Med gratis konto slutter appen å starte etter **7 dager** – koble til og trykk ▶ i Xcode igjen
(dataene beholdes). Maks 3 egne apper på enheten.

## Hvis noe ikke bygger
Koden er skrevet uten tilgang til en Mac eller Swift-kompilator. Får du en feilmelding i
Playgrounds, ta skjermbilde av den (eller kopier teksten) og send til Claude, så blir den rettet.
