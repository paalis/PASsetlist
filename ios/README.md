# Setlist for iPad (Swift Playgrounds)

En egen iPad-app som virker helt uten nett. Bygges og kjøres rett på iPaden i
Swift Playgrounds – ingen Mac og ingen betalt utviklerkonto.

## Funksjoner
- Setlister med dra-og-slipp, pauser, toneart, notater og varighet
- Import fra Spotify-lenke (krever nett, bruker samme tjeneste som nettappen) eller tekst
- Tekst, noter og akkordskjema per låt: PDF, bilder (fra Filer eller Bilder) og tekstfiler
- **Scenemodus** (▶): alle noter i fullskjerm i setlistens rekkefølge
  - bla med sveip, trykk i venstre/høyre kant, eller Bluetooth-pedal
    (piltaster, mellomrom, Page Up/Down)
  - viser «Neste: …», og skjermen sovner ikke
  - **Pencil-notater**: trykk på blyanten, velg penn/markør/viskelær og skriv med
    Apple Pencil. Notatene lagres per side og tegnes på et eget lag over noten.
- **Notehefte**: én PDF med forside og alle filene i rekkefølge, med Pencil-notatene,
  som kan deles, lagres i Filer, skrives ut eller sendes med AirDrop

Alt lagres på iPaden (i appens dokumentmappe). Denne versjonen synkroniserer ikke med
nettappen eller bandkoden.

## Slik får du den på iPaden
1. Installer **Swift Playgrounds** fra App Store (gratis).
2. Få mappen `Setlist.swiftpm` over på iPaden, for eksempel:
   - Åpne `Setlist-iPad.zip` (fra Claude eller fra GitHub) i Filer-appen, og trykk på den
     for å pakke ut. Legg gjerne mappen i iCloud Drive → Playgrounds.
   - Eller last ned hele repoet fra GitHub (Code → Download ZIP) og pakk ut.
3. Trykk på `Setlist.swiftpm` i Filer – den åpnes i Swift Playgrounds.
4. Trykk ▶ (Kjør). Første gang tar det litt tid å bygge.

Ikonet kan endres i Playgrounds under appinnstillinger (⋯ → App-innstillinger).

## Hvis noe ikke bygger
Koden er skrevet uten tilgang til en Mac eller Swift-kompilator. Får du en feilmelding i
Playgrounds, ta skjermbilde av den (eller kopier teksten) og send til Claude, så blir den rettet.
