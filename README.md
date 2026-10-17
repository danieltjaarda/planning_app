# Weekzicht

Week-, dag- en klantenoverzicht voor een videografie-planning. Eén HTML-bestand,
geen build-stap, geen afhankelijkheden in de browser — plus een paar kleine
serverfuncties voor de opslag en de klantlinks. Alles rekent in
**Europe/Amsterdam**, ongeacht de tijdzone van de browser — inclusief zomer- en
wintertijd.

## Snel starten

```bash
npm start          # bouwt public/ en serveert op http://127.0.0.1:8787
```

`dev.mjs` serveert `public/` én de api-functies, zodat opslag en klantlinks ook
lokaal werken (zonder Redis-instellingen in `.env` blijft alles in het geheugen
tot je de server stopt).

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

**Muziekkeuze** — in hetzelfde klantvenster maak je met *Maak muzieklink* een
tweede link (`…/?m=token`). In een trouwfilm passen zes nummers, één per scène,
dus die pagina volgt het draaiboek van de dag in zes scènes: voorbereidingen
(haar en make-up, aankleden, familiefoto's), ceremonie, fotoshoot en borrel
(cake en champagne), diner en speeches, openingsdans en feest. Per scène staan
vier suggesties (24 in totaal, van Taylor Swift en Ed Sheeran tot Justin
Bieber, Etta James en Suzan & Freek) die de klant afspeelt in een ingebouwde
YouTube-speler en met één klik kiest, plus een invoerveld voor een eigen
YouTube-link. Is een scène gevuld, dan verdwijnen de suggesties en de invoer
van die scène; met ✕ gaat ze weer open. Een nummer is te verplaatsen naar een
nog lege scène, en een scène mag leeg blijven ("laat ik aan de videograaf
over"). Plus een opmerking. De keuze komt per scène terug in het klantvenster,
met hoesje, link naar YouTube en de scènes die nog geen nummer hebben; de
klantenlijst krijgt een chip *muzieklink gestuurd* of *muziek gekozen*. De
muziek zelf wordt nooit gedownload of opgeslagen: alleen video-ID's, titels en
de keuze. Scènes en suggesties staan in `MUZIEK_MOMENTEN` en
`MUZIEK_TEMPLATES` in `src/weekzicht.html`; het maximum in `MUZIEK_MAX` (app)
en `MAX_SONGS` (server).

**Offerte** — in het klantvenster maak je met *Maak offerte* een offerte voor
die klant. Nummer (2026-001, 2026-002, … per jaar), datum en geldigheid (30
dagen) staan er al in, net als wat over de klant bekend is: namen, e-mail en
telefoon onder *Aan*, de trouwdatum onder *Betreft*, en tijden, locaties en
gasten uit het formulier onder *Over de dag*. Daaronder zet je zoveel regels
als je wilt: een omschrijving (de eerste regel is de titel, wat eronder staat
komt er klein onder), een aantal en een prijs. De pakketten Zilver, Goud en
Diamant van mediaspot.nl staan als knop klaar. Prijzen zijn incl. of excl.
21% btw, of zonder btw; de totalen rekenen mee. *Download pdf* maakt een
A4-pdf met het Mediaspot-logo links boven, je bedrijfsgegevens rechts boven en
KvK, btw-nummer en IBAN in de voet; op de telefoon zet *Delen* hem meteen in
WhatsApp of de mail. De offerte wordt bij de klant bewaard (dus ook op je andere
apparaten), en de klantenlijst noemt het totaal. Bedrijfsgegevens, de tekst
onderaan en de btw-keuze onthoudt de app voor de volgende offerte (in
`meta/offerte`). De pdf wordt in de browser zelf geschreven, zonder
bibliotheek: Helvetica zit in elke pdf-lezer en alleen het logo gaat er als
plaatje in (`LOGO_PDF`, gemaakt van `mediaspot-logo-dark.svg` van de site).
Standaardwaarden staan in `BEDRIJF`, `PAKKETTEN` en `OFFERTE_TEKST`.

**Factuur** — van een offerte maak je met *Maak factuur* (onder in het
offertevenster, of in het klantvenster) in één klik een factuur: dezelfde regels
en btw-keuze, met een eigen doorlopend nummer (F2026-001, F2026-002, …), de
factuurdatum, een vervaldatum na 14 dagen en een betaaltekst met je IBAN en het
factuurnummer. De offerte zelf blijft staan; de factuur bewerk je los in
hetzelfde venster en download je als pdf met *Factuur* als titel en de
offerte als verwijzing. *Betaald* zet de factuur op betaald (ook terug te
draaien); de klantenlijst toont *factuur € … · open / betaald / vervallen*.
*Mail naar klant* in het factuurvenster stuurt de factuur als pdf met een
kant-en-klaar bericht (bedrag, vervaldatum, IBAN) via dezelfde Forward
Email-koppeling als de offerte (`actie: "factuur"` in `api/offerte.js`, zonder
link of opslag); staat mailen uit, dan opent je eigen mailprogramma.
Zonder offerte kan een losse factuur ook. De factuur staat bij de klant in
`factuur`; standaardwaarden in `FACTUUR_DAGEN` en `FACTUUR_TEKST`.

**Online akkoord** — onder in het offertevenster maakt *Maak akkoordlink* een
link (`?o=token`) en kopieert hem; *Mail naar klant* opent je mailprogramma
met een kant-en-klaar mailtje (aan het e-mailadres uit *Aan* of het
formulier). De klant ziet de offerte in de huisstijl van mediaspot.nl, kan hem
als pdf downloaden, en geeft akkoord met naam en een handtekening die hij met
vinger of muis zet. Elke keer dat je de offerte opslaat, ziet de klant die
nieuwe versie; tekent hij op een versie die intussen veranderd is, dan krijgt
hij eerst de nieuwe te zien. Na *Geldig tot* kan hij niet meer tekenen. Het
akkoord komt vanzelf terug (binnen een paar minuten, of meteen
met *Ververs*): de klant gaat op *Akkoord*, de offerte ligt vast, en de pdf
krijgt naast het totaal een blok *Voor akkoord* met de handtekening als echte
lijnen, de naam en het tijdstip. Wil je toch nog iets veranderen, dan haalt
*Toch wijzigen* (twee keer klikken) de handtekening weg en tekent de klant
opnieuw via dezelfde link. Offerte of klant verwijderen wist ook de link.

**Mailen** — staat Forward Email ingesteld (zie hieronder), dan verstuurt *Mail
naar klant* de mail meteen vanuit de app, vanaf daniel@mediaspot.nl: je ziet hem
eerst in een venstertje (aan, onderwerp, tekst, pdf mee of niet) en kunt hem
aanpassen. Tekent de klant, dan krijg jij een melding met de getekende pdf, en
de klant een bevestiging met dezelfde pdf als hij zijn e-mailadres invult
(dat staat er al in als het in *Aan* stond). Zonder Forward Email opent *Mail
naar klant* gewoon je eigen mailprogramma.

**Meldingen per mail** — in het ⋯-menu onder *Meldingen per mail…*: elke
ochtend een dagoverzicht (standaard 07:00: afspraken, belafspraken en geboekte
klussen van vandaag, open taken en wat te laat is, de bruiloften van morgen),
een herinnering vlak voor elke afspraak en belafspraak (standaard 30 minuten
van tevoren, met telefoon, locatie en notitie), en een bericht als een klant
het formulier invult of muziek kiest. *Stuur nu een dagoverzicht* laat meteen
zien hoe het eruitziet. De server stuurt ze ook als de app dicht is.

**Taken** met deadlines, en een staafje per dag dat laat zien hoe vol de week is.

**Op de telefoon** (tot 720 px breed, of een telefoon die dwars ligt) wordt het
een app-indeling: een smalle bovenbalk met de periode, bladeren, een
kalendertje met de datum van vandaag en een hamburgermenu dat als lade van
rechts inschuift. Onderin een tabbalk (Week, Dag, Lijst, Klanten, Overzicht).
*Overzicht* is de zijkolom van de computer: hierna, de week in cijfers, taken,
klanten en categorieën. Een ronde +-knop rechtsonder maakt een afspraak, of in
de klantenweergave een klant. In de dagweergave veeg je naar links of rechts
voor de volgende of vorige dag. De weekweergave schuift vanzelf naar vandaag.
Vensters komen als blad van onderen, en tekstvelden zijn 16 px, zodat de
iPhone niet inzoomt. Met *Zet op beginscherm* opent de app zonder
browserbalk. De schakelpunten staan in de CSS bij "telefoon" en in
`PHONE_MQ` in het script; houd die twee gelijk.

**Import** van `.ics` uit Google Agenda, Outlook of Apple Agenda: terugkerende
afspraken worden uitgerekend (dagelijks, wekelijks, maandelijks, jaarlijks,
inclusief `BYDAY`, `COUNT`, `UNTIL` en `EXDATE`), tijdzones worden omgerekend en
afspraken over middernacht worden geknipt. Dezelfde export nog eens importeren
overschrijft, in plaats van te verdubbelen.

## Opslag

Op de Vercel-deploy (en met `npm start`) bewaart `api/planning.js` de
afspraken, taken, klanten en instellingen in dezelfde Redis als de formulieren.
Zo is de planning op elk apparaat en in elke browser dezelfde. Als
Claude-artifact gebruikt de pagina in plaats daarvan de `db`-capability. Is er
geen van beide, dan blijft alles in `localStorage` van die ene browser. Het
labeltje onder in de zijkolom zegt welke van de drie het is: *online
opgeslagen*, *opgeslagen bij deze pagina* of *alleen op dit apparaat*.

Hoe de serveropslag werkt:

- **Per document.** Elke afspraak, taak en klant is een eigen veld in een
  Redis-hash (`planning:events`, `planning:tasks`, `planning:leads`,
  `planning:meta`). Twee apparaten die tegelijk iets wijzigen, overschrijven zo
  alleen hetzelfde document, nooit de hele lijst. Geen houdbaarheid: dit zijn
  de gegevens zelf.
- **Verversen.** De app kijkt elke 30 seconden, en meteen als je het tabblad
  weer opent, of er iets veranderd is. Een teller (`planning:versie`) zorgt dat
  er alleen iets wordt opgehaald als er echt iets veranderd is.
- **Offline.** Wijzigingen gaan via een wachtrij in `localStorage`
  (`weekzicht.v1.wachtrij`). Valt de verbinding weg, dan blijven ze staan en
  gaan ze mee zodra hij terug is, ook na herladen. Het labeltje zegt dan *nog
  niet online opgeslagen*. Start de pagina zonder verbinding, dan werkt hij
  lokaal; wat je dan maakt, gaat bij de volgende verbinding alsnog mee.
- **Eerste keer per browser.** Wat er al in `localStorage` stond, gaat
  eenmalig naar de server; wat de server al heeft, komt erbij. Er raakt dus
  niets kwijt, ook niet als meerdere browsers elk hun eigen klanten hadden. Een
  kopie van vóór die koppeling blijft staan in `weekzicht.v1.voor-sync`.
- **Alleen ingelogd.** Lezen en schrijven kan alleen met de sessiecookie. Op
  Vercel staat het wachtwoord altijd aan; zonder actief wachtwoord weigert de
  functie: anders kon iedereen met het adres de klantenlijst ophalen.

Als artifact en op Vercel zijn het twee aparte opslagplekken: ander adres,
andere opslag.

## Toegang: een wachtwoord op de planning

De planning staat achter een wachtwoord; de formulier-, muziek- en
offertelinks (`?f=token`, `?m=token`, `?o=token`) niet.

Het wachtwoord staat als scrypt-hash in `api/_sessie.js` (`WACHTWOORD_HASH`),
niet in Vercel. De repo is openbaar, dus de tekst zelf staat nergens. Een ander
wachtwoord instellen:

    node api/_sessie.js 'nieuw wachtwoord'

Plak de regel die dat geeft in `WACHTWOORD_HASH` en push. Daarnaast telt
`WEEKZICHT_WACHTWOORD` uit de omgeving, als die gezet is: op Vercel een tweede
wachtwoord, lokaal (`node dev.mjs`) de manier om het inloggen te testen. Zonder
die variabele staat lokaal alles open; op Vercel staat de planning altijd
achter het wachtwoord.

- `middleware.js` stuurt iedereen zonder geldige cookie van `/` naar
  `inloggen.html`; een geldige formulier-, muziek- of offertelink mag altijd door.
- `api/inloggen.js` controleert het wachtwoord en zet een ondertekende,
  HttpOnly-cookie die 30 dagen geldig is. De handtekening gebruikt de
  Redis-token en `WEEKZICHT_WACHTWOORD`, niet de hash uit de code (die is
  openbaar). Verander een van die twee, dan vervallen alle sessies.
- Links maken, klanten verwijderen en geüploade draaiboeken bekijken kan
  alleen ingelogd. Het formulier ophalen, invullen en uploaden, muziek
  kiezen en opzoeken, en een offerte bekijken en tekenen, kan de klant met
  alleen zijn link.
- *Uitloggen* staat in het ⋯-menu.

**Voorvertoning in WhatsApp.** Stuur je een formulierlink via WhatsApp, iMessage
of Slack, dan haalt die app de link op voor een kaartje. `middleware.js` herkent
die crawlers en geeft ze een klein pagina'tje met titel op naam van het
bruidspaar, een omschrijving en `og-formulier.png` (1200×630, huisstijl).
Gewone bezoekers krijgen gewoon het formulier. Een muzieklink krijgt op
dezelfde manier een eigen kaartje met `og-muziek.png`, een offertelink met
`og-offerte.png`. WhatsApp bewaart zo'n
kaartje een tijdje; een nieuwe link laat altijd de actuele versie zien. Lokaal zet je
hem in `.env`; `dev.mjs` doet dan hetzelfde als de middleware.

## Formulieren: de serverkant

Een formulier komt van het apparaat van de klant. Daarvoor is `api/formulier.js`, een Vercel-functie die per token
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

### Muziekkeuze: de serverkant

`api/muziek.js` werkt net zo, met een eigen token en eigen records
(`muziek:token`) in dezelfde Redis. Acties: `aanmaken` en `verwijderen` (alleen
ingelogd), `kiezen` (de klant stuurt zijn lijst en opmerking) en `opzoeken`: de
klant plakt een YouTube-link, de server haalt het video-ID eruit (ook `youtu.be`,
shorts, `music.youtube.com`) en vraagt titel en kanaal op via YouTube's oEmbed.
Daar is geen API-sleutel voor nodig en er wordt niets gedownload; afspelen
gebeurt in de browser van de klant via `youtube-nocookie.com`. Opzoeken is
begrensd tot 500 keer per link. Hoogstens zes nummers per klant en één per
scène; elk nummer is `{ yt, titel, artiest, moment, eigen }`, met als moment een
van de zes scène-ID's (`voorbereidingen`, `ceremonie`, `fotoshoot`, `diner`,
`openingsdans`, `feest`).

### Offerte en akkoord: de serverkant

`api/offerte.js` bewaart per token (`offerte:token`) een kopie van de offerte
en de bedrijfsgegevens, zonder houdbaarheid. Acties: `delen` (alleen ingelogd;
zet de offerte neer of werkt hem bij, en hoogt `versie` alleen op als de
inhoud echt veranderd is), `tekenen` (de klant: naam, handtekening en de
`versie` die hij zag), `intrekken` en `verwijderen` (alleen ingelogd). Is er
getekend, dan weigert `delen` met 409: de getekende versie blijft staan tot je
intrekt. Een handtekening is een lijst lijnen `[x, y, x, y, …]` in een vlak van
1000 × 500, gehele getallen; de server knipt af op dat vlak en weigert een tik
of streepje. "Verlopen" rekent met de datum in Nederland.

### Mailen: Forward Email

`api/_mail.js` verstuurt via de API van Forward Email
(`POST https://api.forwardemail.net/v1/emails`), ingelogd met de alias zelf:
het wachtwoord werkt alleen voor die ene alias, niet voor je hele account.
Forward Email stuurt ook alle mail aan @mediaspot.nl door naar je inbox, dus
antwoorden van klanten komen gewoon aan. Eenmalig:

1. In Forward Email: domein mediaspot.nl met de DNS-regels uit *Instellen* en
   *Verifiëren SMTP* (MX, SPF, DKIM, Return-Path, DMARC; bij TransIP gezet op
   12 oktober 2026), en een alias `daniel@mediaspot.nl` (doorsturen naar je
   eigen inbox).
2. Bij die alias: *Wachtwoord genereren*.
3. In Vercel (Settings → Environment Variables): `MAIL_VAN` =
   `Mediaspot <daniel@mediaspot.nl>` (staat er al) en `MAIL_WACHTWOORD` = dat
   wachtwoord, als *Secret*.
   Optioneel `MAIL_MELDINGEN`: waar de melding "getekend" heen gaat (anders naar
   de afzender zelf, die Forward Email doorstuurt). Opnieuw deployen.

De bijlage is dezelfde pdf als in de app: `api/_offertepdf.js` knipt de
pdf-schrijver uit `src/weekzicht.html` (zelfde stukken als
`tests/build-lib.mjs`); `vercel.json` neemt dat bestand mee in de functie. Een
mail die mislukt maakt een handtekening nooit ongedaan; elke poging staat in
het logboek van de offerte (`mails`).

### Meldingen: de serverkant

`api/herinneringen.js` draait elke vijf minuten via Vercel Cron (`crons` in
`vercel.json`; minder dan één keer per dag kan alleen op een Pro-team). Hij
leest de planning uit Redis, kijkt wat er binnen het ingestelde aantal
minuten begint en of het tijd is voor het dagoverzicht (tot drie uur na de
ingestelde tijd, voor als een ronde mislukt), en onthoudt in
`herinneringen:verstuurd` wat al weg is: niets gaat dubbel, ook niet als je hem
vaker aanroept. Een mislukte mail wordt nog twee keer geprobeerd. Zet je
`CRON_SECRET` in Vercel (als Secret), dan stuurt Vercel dat mee en weigert de
functie iedereen zonder. De instellingen staan als `meta/meldingen` in de
planning. Klantmeldingen komen uit `api/formulier.js` en `api/muziek.js`
(`api/_meldingen.js`); een mail die mislukt raakt nooit wat de klant instuurde.
Links in de meldingen gaan naar `APP_URL` (standaard https://app.mediaspot.nl).

## Structuur

```
src/weekzicht.html   bron: het artifact-fragment (zonder <head>)
build.mjs            zet daar de <head> omheen → public/index.html
middleware.js        wachtwoordcontrole vóór de planning (formulierlinks vrij)
api/planning.js      Vercel-functie: afspraken, taken, klanten en instellingen ophalen en bewaren
api/inloggen.js      inloggen/uitloggen, zet de sessiecookie
api/_sessie.js       cookie ondertekenen en controleren
src/inloggen.html    de inlogpagina → public/inloggen.html
api/formulier.js     Vercel-functie: formulier aanmaken, invullen, ophalen
api/muziek.js        Vercel-functie: muzieklink aanmaken, YouTube-link opzoeken, keuze bewaren en ophalen
api/offerte.js       Vercel-functie: offerte delen met de klant, akkoord met handtekening bewaren, mailen
api/_mail.js         mail versturen via Forward Email, en de mail in de huisstijl
api/_offertepdf.js   de pdf-schrijver uit de app, voor de bijlage
api/herinneringen.js Vercel Cron: dagoverzicht en herinneringen vooraf per mail
api/_meldingen.js    instellingen van de meldingen, en de mail als een klant iets doet
api/draaiboek.js     Vercel-functie: draaiboek (foto/PDF/tekst) → tijdlijn via OpenRouter, en het bestand terugkijken
api/_opslag.js       Redis-opslag (Upstash REST) of geheugen lokaal, gedeeld door de functies
api/_bestanden.js    bestandsopslag (Vercel Blob, of geheugen lokaal)
src/og-*.png         kaartjes voor WhatsApp e.d. bij formulier-, muziek- en offertelinks
src/mail-logo.png    het logo in de mails (Gmail toont geen svg)
dev.mjs              lokale server voor public/ + de api-functies
vercel.json          buildCommand + outputDirectory voor Vercel
public/              gegenereerd, niet in git
tests/               ~880 controles, zie hieronder
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
- **muziek** — `api/muziek.js` met een nep-YouTube: video-ID's uit allerlei
  linkvormen, titel en artiest uit een YouTube-titel, kiezen (opschonen,
  dubbelen, zes nummers, één per scène), opzoeken (onbekende video, YouTube
  onbereikbaar, limiet per link), verwijderen
- **toegang** — wachtwoord, cookie (Node én Web Crypto geven dezelfde
  handtekening), middleware, en welke API-acties ingelogd vereisen
- **planning** — `api/planning.js` (schrijven, verwijderen, versie, controle
  van elke wijziging, alleen ingelogd) en de app op meerdere "apparaten" met één
  server: lokale klanten gaan mee bij de eerste koppeling, een klant op het ene
  apparaat verschijnt en verdwijnt op het andere, de wachtrij bij wegvallend
  net en na herladen, offline opstarten, samenvoegen zonder verlies, en een
  offerte met bedrijfsgegevens die op het andere apparaat aankomt
- **offerte** — bedragen lezen en schrijven ("1.950,50"), totalen incl./excl.
  btw, nummering per jaar, invullen vanuit de klant, tekens en afbreken voor de
  pdf, en de pdf zelf: kloppende xref en streamlengtes, het logo links boven,
  meerdere pagina's. Plus de knoppen in de app: regels, pakketten, btw,
  download, bewaren bij de klant, verwijderen, en exporteren zonder artifact
- **akkoord** — `api/offerte.js` (versies, niets veranderd = zelfde versie,
  tekenen op een oude versie, naam en handtekening controleren, verlopen op
  Nederlandse tijd, geen tweede handtekening, intrekken, alleen ingelogd), de
  handtekening als svg en als lijnen in de pdf, de offerte als webpagina, en
  de keten: akkoordlink maken → mail → klant tekent op een eigen pagina
  (terwijl jij nog iets aanpast) → akkoord terug, status Akkoord, offerte op
  slot → toch wijzigen → verlopen → verwijderen
- **mail** — `api/_mail.js` tegen een nep-Forward Email (adres, inloggen met de
  alias, bijlage als base64, foutmeldingen), de mail in html (veilig, links,
  knop, voet), mailen vanuit de offerte (alleen ingelogd, adres controleren,
  pdf mee, logboek), melding en bevestiging na het tekenen met de getekende
  pdf (ook als mailen mislukt blijft het akkoord staan), en de knoppen in de
  app en het e-mailveld op de klantpagina, met en zonder mailen
- **herinneringen** — vooraf (precies binnen het venster, niet als het al
  begonnen is, over middernacht, twee tegelijk in één mail, niets dubbel,
  opgeven na drie pogingen), het dagoverzicht (volgorde, alleen geboekte
  klussen, taken die te laat zijn, morgen, tijdvenster, lege dag), de cron
  (Nederlandse tijd, CRON_SECRET, opruimen), de testknop, de meldingen bij
  formulier en muziek, en het instellingenvenster in de app
- **draaiboek** — `api/draaiboek.js` met een nep-OpenRouter: bestandstypen,
  groottes, de opbouw van de aanroep (foto, PDF, tekst), opschonen van het
  antwoord, fouten van het model, limiet per link
- **smoke** — de gebouwde `public/index.html` in jsdom met een bevroren klok
  (1 sep 2026): elke weergave, elk venster, de filters, het Gebeld-vinkje, de
  opslag, de hele formulierketen: link maken → klant vult in op een eigen
  pagina → antwoorden terug in de planning, en de muziekketen: muzieklink
  maken → klant luistert, kiest per scène één nummer (suggestie of eigen
  link), verplaatst en haalt weg → keuze per scène terug in het klantvenster

De tests draaien op verzonnen klanten uit `tests/fixture.js`.

## Geen gegevens in deze repository

De app start leeg. Namen en telefoonnummers van klanten horen niet in een
repository; ze leven in de opslag: Redis achter het wachtwoord op Vercel, de
`db`-capability als artifact, anders `localStorage`.

## Bekende grenzen

- **Geen live koppeling met Google Agenda.** Import is een momentopname. De
  pagina kan zelf geen URL ophalen, dus een iCal-adres werkt niet; het moet via
  een bestand of plakken.
- De offerte-pdf gebruikt Helvetica, niet het lettertype van mediaspot.nl: een
  eigen lettertype zou in elke pdf ingesloten moeten worden. Eén offerte per
  klant; het btw-tarief is 21%.
- Het online akkoord is een eenvoudige elektronische handtekening (naam,
  getekende lijnen en tijdstip bij precies die versie van de offerte), geen
  gekwalificeerde zoals bij DigiD of een notaris.
- Formulier-, muziek- en offertelinks werken alleen op de Vercel-deploy (of via
  `npm start`), niet als artifact: daar zijn geen api-functies.
- De muziekpagina speelt af via YouTube. Een video die daar privé, verwijderd of
  niet insluitbaar is, speelt ook hier niet; de klant ziet dan de melding van
  YouTube in de speler.
- Een geïmporteerde afspraak over meerdere dagen wordt per dag opgeslagen;
  bewerken raakt dan één dagdeel.
