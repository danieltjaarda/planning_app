# Weekzicht

Week-, dag- en klantenoverzicht voor een videografie-planning. Eén HTML-bestand,
geen build-stap, geen afhankelijkheden in de browser. Alles rekent in
**Europe/Amsterdam**, ongeacht de tijdzone van de browser — inclusief zomer- en
wintertijd.

## Snel starten

```bash
python3 build.py
python3 -m http.server 8787 --bind 127.0.0.1
# → http://localhost:8787
```

Of via npm: `npm start`.

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
build.py             zet daar de <head> omheen → index.html
index.html           gegenereerd; gecommit zodat je 'm direct kunt openen
tests/               149 controles, zie hieronder
```

`src/weekzicht.html` is de bron. `index.html` niet met de hand bewerken —
`build.py` overschrijft hem.

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
- **smoke** — de hele pagina in jsdom: elke weergave, elk venster, de filters,
  het Gebeld-vinkje en de opslag

## Bekende grenzen

- **Geen live koppeling met Google Agenda.** Import is een momentopname. De
  pagina kan zelf geen URL ophalen, dus een iCal-adres werkt niet; het moet via
  een bestand of plakken.
- Export naar `.csv` en `.json` werkt alleen als artifact — lokaal ontbreekt de
  `downloads`-capability.
- Een geïmporteerde afspraak over meerdere dagen wordt per dag opgeslagen;
  bewerken raakt dan één dagdeel.
