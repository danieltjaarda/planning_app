// De centrale AI-assistent. Je stelt in gewone taal een vraag over je
// planning, klanten, taken of ideeën ("wie moet ik nog bellen?", "wat staat
// er donderdag?"), of je vraagt iets aan te passen ("verplaats het monteren
// naar vrijdagochtend", "zet Sanne op gebeld", "maak hier een idee van").
//
// De app stuurt het gesprek plus een momentopname van de gegevens mee; Claude
// antwoordt met tekst en eventueel een lijst wijzigingen. Die wijzigingen voert
// de server níet zelf uit: de app laat ze zien en voert ze pas door als jij op
// "Doorvoeren" klikt (en kan ze daarna nog ongedaan maken).
//
//   POST /api/assistent {
//     berichten: [{ rol: "jij" | "ai", tekst }],        // het gesprek, oudste eerst
//     vandaag: "2026-11-09", nu: "14:30",               // Nederlandse tijd
//     instellingen: { dayStart, dayEnd, weekend },
//     gegevens: {
//       afspraken: [{ id, titel, datum, start, eind, heleDag, categorie, locatie, notitie }],
//       taken:     [{ id, titel, deadline, klaar }],
//       klanten:   [{ id, naam, telefoon, status, datum, start, eind, belDatum, belTijd, notitie, extra }],
//       ideeen:    [{ id, titel, tekst, status, label, vast }]
//     }
//   }
//   → { antwoord, acties: [{ type, id, velden, omschrijving }] }
//
// velden gebruikt de veldnamen van de app (title, date, start, …); bij een
// wijziging staan alleen de velden erin die veranderen, null = leegmaken.
//
// Sleutel: ANTHROPIC_API_KEY (omgevingsvariabele in Vercel, nooit in de code).
// Alleen ingelogd: anders kon iedereen met het adres je klantenlijst uitvragen.

const sessie = require("./_sessie.js");

const MODEL = "claude-opus-5-5";
const API = "https://api.anthropic.com/v1/messages";

const MAX_BERICHTEN = 40;
const MAX_TEKST = 6000;
const MAX = { afspraken: 800, taken: 400, klanten: 500, ideeen: 400 };

const CATS = ["afspraak", "focus", "reizen", "prive", "overig"];
const KLANT_STATUS = ["wacht", "gepland", "gebeld", "akkoord", "af"];
const IDEE_STATUS = ["nieuw", "bezig", "gedaan"];
const TYPES = [
  "afspraak_nieuw", "afspraak_wijzig", "afspraak_weg",
  "taak_nieuw", "taak_wijzig", "taak_weg",
  "klant_nieuw", "klant_wijzig",
  "idee_nieuw", "idee_wijzig", "idee_weg"
];

const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIJD_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const DAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];

const SYSTEEM =
  "Je bent de assistent in Weekzicht, de planningsapp van een zelfstandige videograaf (Mediaspot, trouwfilms en bedrijfsvideo's). " +
  "Je kent zijn agenda, taken, klanten en ideeën (hieronder als gegevens). Hij stelt je vragen of vraagt je iets aan te passen.\n\n" +
  "Antwoorden:\n" +
  "- In het Nederlands, informeel (je/jij), kort en concreet. Gewone tekst; opsommingen met \"- \" mogen, geen kopjes of tabellen.\n" +
  "- Noem datums als \"dinsdag 11 nov\" en tijden als 09:30. Reken \"morgen\", \"volgende week\" enz. uit vanaf de huidige datum.\n" +
  "- Baseer je alleen op de gegevens. Staat iets er niet in, zeg dat dan in plaats van te gokken.\n" +
  "- Algemene vragen (een mail aan een klant schrijven, een idee uitwerken, brainstormen) mag je gewoon beantwoorden.\n\n" +
  "Wijzigingen (acties):\n" +
  "- Alleen als hij om een wijziging vraagt of duidelijk wil dat je iets vastlegt. Bij een vraag: acties leeg.\n" +
  "- Hij ziet de acties als voorstel en voert ze door met een knop. Zeg in je antwoord kort wat je klaarzet; zeg niet dat het al gebeurd is.\n" +
  "- Gebruik voor wijzigen en verwijderen altijd het id uit de gegevens. Verzin nooit een id; bij nieuw is id leeg.\n" +
  "- Verwijder alleen als hij daar expliciet om vraagt. Klanten verwijderen kan niet (verwijs naar het klantvenster); offertes, facturen, formulieren en muziekkeuzes pas je hier niet aan.\n" +
  "- Is onduidelijk welk item hij bedoelt, of mist er iets essentieels (zoals een datum), vraag het dan eerst in plaats van te gokken.\n" +
  "- Plan nieuwe of verplaatste afspraken niet over bestaande afspraken, klussen of belafspraken heen, tenzij hij dat vraagt. Blijf binnen de werktijden tenzij hij iets anders zegt.\n" +
  "- Vul per actie alleen de velden in die ertoe doen; laat de rest een lege string. Bij een wijziging: alleen wat verandert. " +
  "Wil je een veld leegmaken, zet er dan \"-\" in.\n" +
  "- Velden per soort: afspraak: titel, datum, start, eind, heleDag, categorie, locatie, notitie. " +
  "taak: titel, datum (= deadline), klaar. klant: titel (= naam), telefoon, status, datum (= dag van de klus/bruiloft), start, eind, belDatum, belTijd, notitie. " +
  "idee: titel, notitie (= de uitwerking/tekst), status, label.\n" +
  "- Categorieën afspraak: focus (geconcentreerd werk zoals monteren, administratie), afspraak (met anderen), reizen, prive, overig.\n" +
  "- Klantstatus: wacht (nog bellen), gepland (call gepland), gebeld, akkoord, af (afgevallen). Ideestatus: nieuw, bezig, gedaan.\n" +
  "- omschrijving: één korte regel per actie voor in de app, bijv. \"Monteren Jan & Lisa → vrijdag 14 nov 09:00–12:00\".\n" +
  "- Datums JJJJ-MM-DD, tijden HH:MM (24 uur). heleDag en klaar: \"ja\", \"nee\" of leeg.";

const S = { type: "string" };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["antwoord", "acties"],
  properties: {
    antwoord: S,
    acties: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "id", "omschrijving", "titel", "datum", "start", "eind", "heleDag", "categorie",
          "locatie", "notitie", "klaar", "status", "telefoon", "belDatum", "belTijd", "label"],
        properties: {
          type: { type: "string", enum: TYPES },
          id: S, omschrijving: S, titel: S, datum: S, start: S, eind: S,
          heleDag: { type: "string", enum: ["", "ja", "nee"] },
          categorie: { type: "string", enum: [""].concat(CATS) },
          locatie: S, notitie: S,
          klaar: { type: "string", enum: ["", "ja", "nee"] },
          status: { type: "string", enum: [""].concat(KLANT_STATUS, IDEE_STATUS) },
          telefoon: S, belDatum: S, belTijd: S, label: S
        }
      }
    }
  }
};

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.end(JSON.stringify(obj));
}

function parseBody(req) {
  const b = req.body;
  if (b == null || b === "") return {};
  if (typeof b === "object") return b;
  try { return JSON.parse(String(b)); } catch (e) { return null; }
}

function civ(s) { const a = s.split("-"); return Date.UTC(+a[0], +a[1] - 1, +a[2]); }
function toMin(t) { const a = t.split(":"); return +a[0] * 60 + +a[1]; }
/** Eén regel tekst: zonder stuurtekens, ingekort. */
function regel(s, max) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max); }
/** Meerdere regels mogen (notities, ideeën), stuurtekens niet. */
function tekst(s, max) { return String(s == null ? "" : s).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").trim().slice(0, max); }
function datum(s) { return DATUM_RE.test(String(s || "")) ? String(s) : ""; }
function tijd(s) { return TIJD_RE.test(String(s || "")) ? String(s) : ""; }
function id(s) { return ID_RE.test(String(s || "")) ? String(s) : ""; }

/** Controleert en verkleint wat de app meestuurt; geeft { fout } of de nette versie. */
function invoer(body) {
  const ruw = Array.isArray(body.berichten) ? body.berichten.slice(-MAX_BERICHTEN) : [];
  const berichten = [];
  for (const b of ruw) {
    if (!b || (b.rol !== "jij" && b.rol !== "ai")) continue;
    const t = tekst(b.tekst, MAX_TEKST);
    if (t) berichten.push({ rol: b.rol, tekst: t });
  }
  while (berichten.length && berichten[0].rol !== "jij") berichten.shift();
  if (!berichten.length || berichten[berichten.length - 1].rol !== "jij") return { fout: "Stel eerst een vraag." };

  const vandaag = datum(body.vandaag);
  if (!vandaag) return { fout: "Ongeldige datum." };
  const nu = tijd(body.nu) || "00:00";
  const ins = body.instellingen || {};
  const dayStart = Math.max(0, Math.min(23, parseInt(ins.dayStart, 10) || 8));
  const dayEnd = Math.max(dayStart + 1, Math.min(24, parseInt(ins.dayEnd, 10) || 18));
  const weekend = ins.weekend !== false;

  const g = body.gegevens || {};
  const lijst = (naam) => (Array.isArray(g[naam]) ? g[naam].slice(0, MAX[naam]) : []);

  const afspraken = lijst("afspraken").map((x) => x && id(x.id) && datum(x.datum) ? {
    id: x.id, titel: regel(x.titel, 120), datum: x.datum,
    heleDag: !!x.heleDag, start: x.heleDag ? "" : tijd(x.start), eind: x.heleDag ? "" : tijd(x.eind),
    categorie: CATS.indexOf(x.categorie) >= 0 ? x.categorie : "overig",
    locatie: regel(x.locatie, 120), notitie: regel(x.notitie, 300)
  } : null).filter(Boolean);

  const taken = lijst("taken").map((x) => x && id(x.id) ? {
    id: x.id, titel: regel(x.titel, 160), deadline: datum(x.deadline), klaar: !!x.klaar
  } : null).filter(Boolean);

  const klanten = lijst("klanten").map((x) => x && id(x.id) ? {
    id: x.id, naam: regel(x.naam, 100), telefoon: regel(x.telefoon, 40),
    status: KLANT_STATUS.indexOf(x.status) >= 0 ? x.status : "wacht",
    datum: datum(x.datum), start: tijd(x.start), eind: tijd(x.eind),
    belDatum: datum(x.belDatum), belTijd: tijd(x.belTijd),
    notitie: regel(x.notitie, 400), extra: regel(x.extra, 200)
  } : null).filter(Boolean);

  const ideeen = lijst("ideeen").map((x) => x && id(x.id) ? {
    id: x.id, titel: regel(x.titel, 160), tekst: tekst(x.tekst, 1500),
    status: IDEE_STATUS.indexOf(x.status) >= 0 ? x.status : "nieuw",
    label: regel(x.label, 40), vast: !!x.vast
  } : null).filter(Boolean);

  return { berichten, vandaag, nu, dayStart, dayEnd, weekend, afspraken, taken, klanten, ideeen };
}

/** Compacte JSON-regel zonder lege velden: scheelt tokens. */
function compact(o) {
  const out = {};
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v === "" || v === false || v == null) continue;
    out[k] = v;
  }
  return JSON.stringify(out);
}

/** De gegevens als tweede systeemblok. */
function gegevensTekst(v) {
  const dag = DAGEN[(new Date(civ(v.vandaag)).getUTCDay() + 6) % 7];
  const r = [];
  r.push("Nu: " + dag + " " + v.vandaag + ", " + v.nu + " (Nederlandse tijd).");
  r.push("Werktijden: " + String(v.dayStart).padStart(2, "0") + ":00–" + String(v.dayEnd).padStart(2, "0") + ":00. Weekend " + (v.weekend ? "telt mee" : "liever vrij") + ".");
  r.push("");
  r.push("AFSPRAKEN (" + v.afspraken.length + "):");
  for (const x of v.afspraken.slice().sort((a, b) => (a.datum + a.start).localeCompare(b.datum + b.start))) r.push(compact(x));
  r.push("");
  r.push("TAKEN (" + v.taken.length + "):");
  for (const x of v.taken) r.push(compact(x));
  r.push("");
  r.push("KLANTEN (" + v.klanten.length + "; datum = dag van de klus, belDatum/belTijd = geplande belafspraak, extra = offerte/factuur/formulier):");
  for (const x of v.klanten) r.push(compact(x));
  r.push("");
  r.push("IDEEËN (" + v.ideeen.length + "):");
  for (const x of v.ideeen) r.push(compact(x));
  return r.join("\n");
}

/** Het gesprek als afwisselende user/assistant-beurten. */
function gesprek(v) {
  const out = [];
  for (const b of v.berichten) {
    const role = b.rol === "jij" ? "user" : "assistant";
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += "\n\n" + b.tekst;
    else out.push({ role, content: b.tekst });
  }
  return out;
}

function buildRequest(v) {
  return {
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    fallbacks: "default",
    system: [
      { type: "text", text: SYSTEEM },
      { type: "text", text: gegevensTekst(v) }
    ],
    messages: gesprek(v)
  };
}

/** "" = niet opgegeven, "-" = leegmaken, anders de waarde (of fout als hij niet klopt). */
function veld(x, naam, check) {
  const w = x[naam] == null ? "" : String(x[naam]).trim();
  if (w === "") return { leeg: true };
  if (w === "-") return { waarde: null };
  const c = check ? check(w) : w;
  if (c === "" || c == null) return { fout: true };
  return { waarde: c };
}

/**
 * Zet de acties van Claude om naar wijzigingen in de veldnamen van de app.
 * Laat weg wat niet klopt: onbekende ids, ongeldige datums en tijden, een
 * nieuwe afspraak zonder datum. De app controleert bij het doorvoeren nog eens.
 */
function controleer(acties, v) {
  const ids = {
    afspraak: new Set(v.afspraken.map((x) => x.id)),
    taak: new Set(v.taken.map((x) => x.id)),
    klant: new Set(v.klanten.map((x) => x.id)),
    idee: new Set(v.ideeen.map((x) => x.id))
  };
  const out = [];
  const perItem = new Map();   // "soort/id" → actie, zodat één item hoogstens één wijziging krijgt
  for (const x of Array.isArray(acties) ? acties : []) {
    if (!x || TYPES.indexOf(x.type) < 0) continue;
    const [soort, wat] = x.type.split("_");
    const nieuw = wat === "nieuw";
    const doelId = nieuw ? "" : id(x.id);
    if (!nieuw && (!doelId || !ids[soort].has(doelId))) continue;
    const sleutel = soort + "/" + doelId;
    const eerder = nieuw ? null : perItem.get(sleutel);
    if (eerder && eerder.type.endsWith("_weg")) continue;   // wordt toch al verwijderd
    const omschrijving = regel(x.omschrijving, 200);
    if (wat === "weg") {
      const a = { type: x.type, id: doelId, velden: {}, omschrijving };
      if (eerder) out.splice(out.indexOf(eerder), 1);
      out.push(a); perItem.set(sleutel, a);
      continue;
    }

    const velden = {};
    let fout = false;
    const zet = (appNaam, r) => { if (r.fout) fout = true; else if (!r.leeg) velden[appNaam] = r.waarde; };
    const titel = veld(x, "titel", (w) => regel(w, 160));

    if (soort === "afspraak") {
      zet("title", titel);
      zet("date", veld(x, "datum", datum));
      zet("start", veld(x, "start", tijd));
      zet("end", veld(x, "eind", tijd));
      if (x.heleDag === "ja" || x.heleDag === "nee") velden.allDay = x.heleDag === "ja";
      if (CATS.indexOf(x.categorie) >= 0) velden.cat = x.categorie;
      zet("loc", veld(x, "locatie", (w) => regel(w, 120)));
      zet("note", veld(x, "notitie", (w) => tekst(w, 2000)));
      if (nieuw) {
        if (!velden.title || !velden.date) continue;
        if (!velden.allDay && !velden.start) continue;   // zonder eindtijd maakt de app er een uur van
        if (!velden.cat) velden.cat = "overig";
      }
      if (velden.start && velden.end && toMin(velden.end) <= toMin(velden.start) && !velden.allDay) fout = true;
      if (velden.title === null || velden.date === null) fout = true;
    } else if (soort === "taak") {
      zet("title", titel);
      zet("due", veld(x, "datum", datum));
      if (x.klaar === "ja" || x.klaar === "nee") velden.done = x.klaar === "ja";
      if (nieuw && !velden.title) continue;
      if (velden.title === null) fout = true;
    } else if (soort === "klant") {
      zet("name", titel);
      zet("phone", veld(x, "telefoon", (w) => regel(w, 40)));
      if (KLANT_STATUS.indexOf(x.status) >= 0) velden.status = x.status;
      zet("date", veld(x, "datum", datum));
      zet("start", veld(x, "start", tijd));
      zet("end", veld(x, "eind", tijd));
      zet("callDate", veld(x, "belDatum", datum));
      zet("callTime", veld(x, "belTijd", tijd));
      zet("note", veld(x, "notitie", (w) => tekst(w, 2000)));
      if (nieuw && !velden.name && !velden.phone) continue;
    } else if (soort === "idee") {
      zet("title", titel);
      zet("text", veld(x, "notitie", (w) => tekst(w, 8000)));
      if (IDEE_STATUS.indexOf(x.status) >= 0) velden.status = x.status;
      zet("label", veld(x, "label", (w) => regel(w, 40)));
      if (nieuw && !velden.title && !velden.text) continue;
      if (velden.title === null && !velden.text) fout = true;
    }
    if (fout) continue;
    if (!nieuw && !Object.keys(velden).length) continue;
    if (eerder) {
      // tweede wijziging van hetzelfde item: samenvoegen, de laatste wint
      Object.assign(eerder.velden, velden);
      if (omschrijving) eerder.omschrijving = eerder.omschrijving ? eerder.omschrijving + "; " + omschrijving : omschrijving;
      continue;
    }
    const a = { type: x.type, id: doelId, velden, omschrijving };
    out.push(a);
    if (!nieuw) perItem.set(sleutel, a);
  }
  return out.slice(0, 100);
}

/** Haalt het JSON-antwoord uit de API-respons; geeft { fout } of { antwoord, acties }. */
function leesAntwoord(j) {
  if (!j || !Array.isArray(j.content)) return { fout: "Onverwacht antwoord van Claude." };
  if (j.stop_reason === "refusal") return { fout: "Claude wilde hier niet op ingaan. Formuleer het anders en probeer het nog eens." };
  if (j.stop_reason === "max_tokens") return { fout: "Het antwoord werd te lang. Vraag om minder tegelijk." };
  const t = j.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    const data = JSON.parse(t);
    return { antwoord: tekst(data.antwoord, 20000), acties: data.acties };
  } catch (e) {
    return { fout: "Claude gaf geen leesbaar antwoord terug. Probeer het nog eens." };
  }
}

async function handle(req, res, key, opts, doFetch) {
  const eisWachtwoord = !!(opts && opts.eisWachtwoord);
  if ((req.method || "GET").toUpperCase() !== "POST") return send(res, 405, { error: "methode" });
  if (eisWachtwoord && !sessie.beveiligd()) return send(res, 403, { error: "geen_wachtwoord", melding: "Er is geen wachtwoord actief." });
  if (!sessie.ingelogd(req)) return send(res, 401, { error: "niet_ingelogd", melding: "Je bent niet (meer) ingelogd. Laad de pagina opnieuw en log in." });
  if (!key) return send(res, 503, { error: "geen_sleutel", melding: "De AI staat nog niet aan: zet ANTHROPIC_API_KEY in Vercel en deploy opnieuw." });

  const body = parseBody(req);
  if (body === null) return send(res, 400, { error: "ongeldige_json" });
  const v = invoer(body);
  if (v.fout) return send(res, 400, { error: "ongeldig", melding: v.fout });

  const r = await (doFetch || fetch)(API, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
      "content-type": "application/json"
    },
    body: JSON.stringify(buildRequest(v))
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = j && j.error && j.error.message ? j.error.message : "status " + r.status;
    const melding = r.status === 401 ? "De Claude-sleutel klopt niet (ANTHROPIC_API_KEY)."
      : r.status === 429 ? "Even te druk bij Claude. Probeer het over een minuutje nog eens."
      : r.status === 400 && /credit/i.test(msg) ? "Je Claude-tegoed is op. Waardeer op in console.anthropic.com."
      : "Claude gaf een fout: " + msg;
    return send(res, 502, { error: "claude", melding });
  }
  const a = leesAntwoord(j);
  if (a.fout) return send(res, 502, { error: "antwoord", melding: a.fout });
  return send(res, 200, { antwoord: a.antwoord, acties: controleer(a.acties, v) });
}

module.exports = async function (req, res) {
  try {
    await handle(req, res, process.env.ANTHROPIC_API_KEY, { eisWachtwoord: true });
  } catch (e) {
    send(res, 502, { error: "claude", melding: "Geen verbinding met Claude: " + String(e && e.message || e) });
  }
};
module.exports.handle = handle;
module.exports.invoer = invoer;
module.exports.gegevensTekst = gegevensTekst;
module.exports.buildRequest = buildRequest;
module.exports.controleer = controleer;
module.exports.leesAntwoord = leesAntwoord;
