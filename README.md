# Weekzicht

Week-, dag- en klantenoverzicht voor een videografie-planning. Eén HTML-bestand,
geen build-stap, geen afhankelijkheden in de browser. Alles rekent in
**Europe/Amsterdam**, ongeacht de tijdzone van de browser — inclusief zomer- en
wintertijd.

## Snel starten

```bash
npm start          # bouwt public/ en serveert op http://localhost:8787
```

Of los: `node build.mjs` en dan een willekeurige statische server op `public/`.

De server bindt bewust alleen op `127.0.0.1`; er staan telefoonnummers van
klanten in.

## Wat erin zit

**Agenda** — weekraster met uurgoot en ISO-weeknummer, dagweergave, en een
lijstweergave met zoekfunctie. Overlappende afspraken komen naast elkaar te
staan; een rode lijn markeert het huidige moment.

**Klanten** — je aanvragen op datum onder elkaar, met een belpijplijn van vijf
statussen. Elke status heeft een eigen icoon én label, zodat de kleur nooit de
enige drager van de betekenis is:

| Status | Icoon | Betekenis |
|---|---|---|
| Nog bellen | zandloper | nog geen call ingepland |
| Call gepland | telefoon | call staat in de agenda |
| Gebeld | vinkje | gesproken, uitkomst open |
| Akkoord | ster | geboekt |
| Afgevallen | kruisje | gaat niet door |

Het **Gebeld**-vinkje op elke regel verzet de status en noteert de datum. De
status blijft de enige waarheid; het vinkje is een snelkoppeling. Klanten met
een datum verschijnen ook in de agenda, mét hun statusicoon.

**Taken** met deadlines, en een staafje per dag dat laat zien hoe vol de week is.

**Import** van `.ics` uit Google Agenda, Outlook of Apple Agenda: terugkerende
afspraken worden uitgerekend (dagelijks, wekelijks, maandelijks, jaarlijks,
inclusief `BYDAY`, `COUNT`, `UNTIL` en `EXDATE`), tijdzones worden omgerekend en
afspraken over middernacht worden geknipt. Dezelfde export nog eens importeren
overschrijft, in plaats van te verdubbelen.

## Opslag

Als de pagina als Claude-artifact draait, gebruikt hij de `db`-capability: de
gegevens leven bij de pagina en zijn op elk apparaat beschikbaar. Lokaal is er
geen `window.claude`, dus valt de app terug op `localStorage` van die ene
browser. **De twee delen hun gegevens niet** — ander adres, andere opslag.

## Structuur

```
src/weekzicht.html   bron: het artifact-fragment (zonder <head>)
build.mjs            zet daar de <head> omheen → public/index.html
vercel.json          buildCommand + outputDirectory voor Vercel
public/              gegenereerd, niet in git
tests/               156 controles, zie hieronder
```

`src/weekzicht.html` is de enige bron. `public/index.html` niet met de hand
bewerken — de build overschrijft hem. De build draait op Node, niet op Python,
zodat een kale Vercel-build hem zonder meer kan uitvoeren.

## Deployen

Vercel pakt `vercel.json` vanzelf op: build `node build.mjs`, output `public`.
Zonder die twee instellingen zoekt Vercel na de build naar een map `public` die
er niet is en faalt de deploy met *"No Output Directory named 'public' found"*.

De deploy krijgt `X-Robots-Tag: noindex` mee. Dat houdt zoekmachines weg, maar
maakt de URL niet geheim: iedereen die hem heeft, kan de pagina openen.

## Tests

```bash
npm install   # jsdom, alleen voor de smoketest
npm test
```

- **datum-en-ics** — ISO-weeknummers (ook 53-weekjaren en jaargrenzen),
  zomer-/wintertijd, omrekening vanuit andere tijdzones, ICS-parsing,
  RRULE-uitrekening, knippen over middernacht
- **import** — kolomindeling bij overlap, volledige ICS-import van begin tot eind
- **klanten** — sortering, statustellingen, klantitems in de agenda, filters
- **smoke** — de gebouwde `public/index.html` in jsdom: elke weergave, elk
  venster, de filters, het Gebeld-vinkje en de opslag

De tests draaien op verzonnen klanten uit `tests/fixture.js`.

## Geen gegevens in deze repository

De app start leeg. Namen en telefoonnummers van klanten horen niet in een
repository en al helemaal niet op een openbare deploy; ze leven in de opslag van
de pagina zelf — de `db`-capability als artifact, anders `localStorage`.

## Bekende grenzen

- **Geen live koppeling met Google Agenda.** Import is een momentopname. De
  pagina kan zelf geen URL ophalen, dus een iCal-adres werkt niet; het moet via
  een bestand of plakken.
- Export naar `.csv` en `.json` werkt alleen als artifact — lokaal ontbreekt de
  `downloads`-capability.
- Een geïmporteerde afspraak over meerdere dagen wordt per dag opgeslagen;
  bewerken raakt dan één dagdeel.
