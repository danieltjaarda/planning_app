# Weekzicht

Week-, dag- en klantenoverzicht voor een videografie-planning. Eén HTML-bestand,
geen build-stap, geen afhankelijkheden in de browser — plus één kleine
serverfunctie voor het klantformulier. Alles rekent in
**Europe/Amsterdam**, ongeacht de tijdzone van de browser — inclusief zomer- en
wintertijd.

## Snel starten

```bash
npm start          # bouwt public/ en serveert op http://127.0.0.1:8787
```

`dev.mjs` serveert `public/` én `api/formulier`, zodat de formulierlink ook
lokaal werkt (formulieren blijven dan in het geheugen tot je de server stopt).

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

Elke klant heeft een **datum van de klus** met **begin- en eindtijd**. Met
tijden staat de klus op tijd in het weekraster; zonder tijden als hele dag. Een
eindtijd vóór de begintijd (bijv. 10:00–00:30) geldt als na middernacht.

**Klantformulier** — in het klantvenster maak je met *Maak formulierlink* een
unieke link voor die klant (`…/?f=token`). De klant ziet op die link alléén het
formulier, niet je planning: namen, e-mail, telefoon, trouwdatum, begin- en
eindtijd van het filmen, tijd van de ceremonie, aantal gasten, dagplanning,
locaties, welke momenten in de film moeten, fotograaf, sfeer en wensen. Na
versturen komen de antwoorden terug in het klantvenster; datum en begin-/eindtijd
worden meteen in de klant gezet. De app kijkt elke drie minuten of er nieuwe
antwoorden zijn; *Ververs* doet dat meteen. Een klant kan de link later opnieuw
openen en aanpassen.

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

## Toegang: een wachtwoord op de planning

De planning staat achter een wachtwoord; de formulierlinks (`?f=token`) niet.
Zet in Vercel de omgevingsvariabele `WEEKZICHT_WACHTWOORD` (Settings →
Environment Variables, Production en Preview) en deploy opnieuw. Daarna:

- `middleware.js` stuurt iedereen zonder geldige cookie van `/` naar
  `inloggen.html`; een geldige formulierlink mag altijd door.
- `api/inloggen.js` controleert het wachtwoord en zet een ondertekende,
  HttpOnly-cookie die 30 dagen geldig is. Verander je het wachtwoord, dan
  vervallen alle sessies.
- Links maken, klanten verwijderen en geüploade draaiboeken bekijken kan
  alleen ingelogd. Het formulier ophalen, invullen en uploaden kan de klant
  met alleen zijn link.
- *Uitloggen* staat in het ⋯-menu.

Zonder `WEEKZICHT_WACHTWOORD` staat alles open, zoals voorheen. Lokaal zet je
hem in `.env`; `dev.mjs` doet dan hetzelfde als de middleware.

## Formulieren: de serverkant

De planning zelf leeft in de browser, maar een formulier komt van het apparaat
van de klant. Daarvoor is `api/formulier.js`, een Vercel-functie die per token
één record bewaart in Redis (Upstash REST, twee jaar houdbaar). Eenmalig
instellen:

1. Vercel-project → **Storage** → **Create database** → **Redis** (Upstash).
2. Koppel hem aan het project. Vercel zet dan `KV_REST_API_URL` en
   `KV_REST_API_TOKEN` als omgevingsvariabelen; de functie leest die zelf.
3. Opnieuw deployen.

Zonder die store antwoordt de functie met 503 en meldt de app dat bij *Maak
formulierlink*. De formulierpagina werkt dan nog wél: de klant krijgt de
antwoorden als tekst om via WhatsApp of mail te sturen.

### Draaiboek laten omzetten door AI

Bij *Globale planning van de dag* kan de klant een foto, PDF of tekstbestand
van het draaiboek uploaden. `api/draaiboek.js` stuurt dat naar OpenRouter
(model `google/gemini-2.5-flash`: snel, goedkoop, leest foto's en PDF's zelf)
en zet het antwoord als tijdlijn in het tekstvak, waar de klant het nog kan
nakijken. Foto's worden in de browser eerst verkleind tot 1800 px; bestanden
tot 3 MB.

Zet daarvoor `OPENROUTER_API_KEY` als omgevingsvariabele in Vercel (Settings →
Environment Variables) en deploy opnieuw. Lokaal: zet hem in `.env` in de
projectmap; dat bestand staat in `.gitignore`. Zonder sleutel blijft de
uploadknop staan en meldt hij dat omzetten nog niet aanstaat.

Het bestand zelf wordt ook bewaard, in een privé Vercel Blob-store (`api/_bestanden.js`), zodat
je het originele draaiboek in het klantvenster kunt openen onder *Draaiboek van
de klant*. Daarvoor koppel je in Vercel een **Blob**-store aan het project
(Storage → Create Database → Blob); die zet `BLOB_READ_WRITE_TOKEN`. De bestanden
worden nooit rechtstreeks gelinkt: de app haalt ze op via `api/draaiboek?t=…&i=…`
met het formulier-token. Een klant verwijderen wist ook de bestanden. Lokaal
blijven ze in het geheugen tot je de server stopt.

Misbruik is begrensd: omzetten kan alleen met een geldig formulier-token en
hoogstens 25 keer per link.

Wie de link heeft, kan het formulier zien en invullen — dat is de bedoeling —
maar ziet nooit de planning of andere klanten. Tokens zijn 22 willekeurige
tekens. Een klant verwijderen wist ook het formulier op de server.

## Structuur

```
src/weekzicht.html   bron: het artifact-fragment (zonder <head>)
build.mjs            zet daar de <head> omheen → public/index.html
middleware.js        wachtwoordcontrole vóór de planning (formulierlinks vrij)
api/inloggen.js      inloggen/uitloggen, zet de sessiecookie
api/_sessie.js       cookie ondertekenen en controleren
src/inloggen.html    de inlogpagina → public/inloggen.html
api/formulier.js     Vercel-functie: formulier aanmaken, invullen, ophalen
api/draaiboek.js     Vercel-functie: draaiboek (foto/PDF/tekst) → tijdlijn via OpenRouter, en het bestand terugkijken
api/_bestanden.js    bestandsopslag (Vercel Blob, of geheugen lokaal)
dev.mjs              lokale server voor public/ + api/formulier
vercel.json          buildCommand + outputDirectory voor Vercel
public/              gegenereerd, niet in git
tests/               ~225 controles, zie hieronder
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
- **klanten** — sortering, statustellingen, klantitems in de agenda (met en
  zonder tijden), filters
- **formulier** — `api/formulier.js` met een geheugenopslag: tokens, aanmaken,
  invullen, opschonen van antwoorden, verwijderen, opslagfouten
- **toegang** — wachtwoord, cookie (Node én Web Crypto geven dezelfde
  handtekening), middleware, en welke API-acties ingelogd vereisen
- **draaiboek** — `api/draaiboek.js` met een nep-OpenRouter: bestandstypen,
  groottes, de opbouw van de aanroep (foto, PDF, tekst), opschonen van het
  antwoord, fouten van het model, limiet per link
- **smoke** — de gebouwde `public/index.html` in jsdom met een bevroren klok
  (1 sep 2026): elke weergave, elk venster, de filters, het Gebeld-vinkje, de
  opslag, en de hele formulierketen: link maken → klant vult in op een eigen
  pagina → antwoorden terug in de planning

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
- Formulierlinks werken alleen op de Vercel-deploy (of via `npm start`), niet
  als artifact: daar is geen `api/formulier`.
- Een geïmporteerde afspraak over meerdere dagen wordt per dag opgeslagen;
  bewerken raakt dan één dagdeel.
