// AI-weekplanner. Je typt wat je deze week gedaan wilt hebben en ongeveer
// hoeveel tijd het kost; Claude legt dat als blokken in de vrije tijd van de
// week, om wat er al in de agenda staat heen. De app laat het voorstel eerst
// zien; pas als jij op "Zet in agenda" klikt, worden het afspraken.
//
//   POST /api/ai-planning {
//     wens: "tekst",
//     weekStart: "2026-11-09",            // maandag van de week
//     vandaag: "2026-11-08", nu: "14:30", // Nederlandse tijd, voor "niet in het verleden"
//     instellingen: { dayStart: 7, dayEnd: 21, weekend: true },
//     bestaand: [{ datum, start, eind, heleDag, titel }]   // wat al vastligt
//   }
//   → { voorstel: [{ titel, datum, start, eind, categorie, notitie, taak }], uitleg }
//
// In twee stappen, zoals de app het doet:
//   1. stap: "vragen" — Claude haalt de losse taken uit je wens en stelt per
//      taak een vraag: hoeveel uur denk je nodig te hebben? Met een eigen
//      inschatting, en een deadline/voorkeur als je die al noemde.
//      → { taken: [{ titel, vraag, uren, deadline, voorkeur, toelichting }], opmerking }
//   2. zonder stap, met taken: [{ titel, uren, deadline, voorkeur }] — jouw
//      antwoorden; Claude plant elke taak voor precies dat aantal uren.
//      taak in het voorstel = het nummer van de taak (1, 2, …), 0 = geen.
//
// Sleutel: ANTHROPIC_API_KEY (omgevingsvariabele in Vercel, nooit in de code).
// Alleen ingelogd: anders kon iedereen met het adres op jouw kosten Claude gebruiken.

const sessie = require("./_sessie.js");

const MODEL = "claude-opus-5-5";
const API = "https://api.anthropic.com/v1/messages";
const MAX_WENS = 4000;
const MAX_BESTAAND = 300;
const MAX_TAKEN = 40;
const CATS = ["afspraak", "focus", "reizen", "prive", "overig"];
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIJD_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const SYSTEEM =
  "Je bent de planningsassistent in Weekzicht, de agenda van een zelfstandige videograaf. " +
  "De gebruiker vertelt wat hij deze week gedaan wil hebben en ongeveer hoeveel tijd dat kost. " +
  "Jij maakt daar een concrete weekplanning van: blokken met datum, begin- en eindtijd.\n\n" +
  "Regels:\n" +
  "- Plan alleen binnen de opgegeven week, en nooit vóór het huidige moment.\n" +
  "- Plan nooit over iets heen dat al in de agenda staat (afspraken, klussen, belafspraken). " +
  "Houd een kwartier lucht rond bestaande afspraken. Een dag met een hele-dag-klus (bijv. een bruiloft) is vol.\n" +
  "- Blijf binnen de werktijden, tenzij de gebruiker iets anders vraagt. Weekend alleen als dat aanstaat of gevraagd wordt.\n" +
  "- Hak lang werk op in blokken van hoogstens 2 à 3 uur, en plan pauzes (lunch rond 12:00–13:00) vrij.\n" +
  "- Volg wat de gebruiker zegt over deadlines, volgorde en voorkeuren (\"ochtend\", \"vóór woensdag\").\n" +
  "- Past niet alles, plan dan wat het belangrijkst lijkt en zeg in de uitleg wat er niet in paste.\n" +
  "- Tijden in 24-uursnotatie HH:MM, op hele kwartieren. Datums als JJJJ-MM-DD.\n" +
  "- Categorie: focus voor geconcentreerd werk (monteren, edit, administratie), afspraak voor afspraken met anderen, " +
  "reizen voor reistijd, prive voor privézaken (sporten, boodschappen), overig voor de rest.\n" +
  "- Titels kort en in het Nederlands, zoals de gebruiker het noemt. Zet details in de notitie (mag leeg).\n" +
  "- Uitleg: twee à drie korte zinnen in het Nederlands, aan de gebruiker gericht (je/jij), over de keuzes die je maakte.\n" +
  "- Staat er een genummerde takenlijst met uren bij, plan dan per taak precies dat aantal uren (verdeeld over blokken), " +
  "klaar op of vóór de deadline, en houd rekening met de voorkeur. Zet in elk blok bij taak het nummer van de taak; " +
  "blokken die niet bij een taak horen krijgen taak 0. Past een taak niet helemaal, plan dan wat past en zeg het in de uitleg.";

const VRAGEN_SYSTEEM =
  "Je bent de planningsassistent in Weekzicht, de agenda van een zelfstandige videograaf. " +
  "De gebruiker vertelt wat hij deze week gedaan wil hebben. Voordat er gepland wordt, loop je zijn lijst met hem door.\n\n" +
  "Jouw taak nu: haal er de losse taken uit en stel per taak één vraag: hoeveel uur denkt hij er deze week voor nodig te hebben.\n" +
  "- Eén taak per ding dat hij wil doen, in de volgorde waarin hij ze noemt. Voeg geen taken toe die hij niet noemt. " +
  "Vaste afspraken met een tijdstip (\"dinsdag 14:00 tandarts\") zijn ook taken; zet het tijdstip dan in voorkeur.\n" +
  "- titel: kort, in zijn woorden (\"Bruiloft Jan & Lisa monteren\").\n" +
  "- vraag: een korte, vriendelijke vraag aan hem (je/jij) over het aantal uur voor deze taak. " +
  "Noemde hij zelf al een tijd, vraag dan of dat klopt (\"Je noemde ongeveer 8 uur voor het monteren. Klopt dat, of wil je er wat ruimte bij?\").\n" +
  "- uren: jouw beste inschatting in uren (veelvoud van 0,25). Noemde hij een tijd, neem die over. Anders een realistische schatting voor een videograaf.\n" +
  "- toelichting: één korte zin waarom je dat inschat (of leeg als hij het zelf noemde).\n" +
  "- deadline: de dag (JJJJ-MM-DD, binnen de week) waarop het uiterlijk af moet als hij dat noemt (\"vóór donderdag\" = woensdag), anders leeg.\n" +
  "- voorkeur: wat hij zegt over moment of manier (\"ochtend\", \"dinsdagmiddag\", \"in één keer\"), anders leeg.\n" +
  "- opmerking: leeg, of één korte zin als iets onduidelijk is of niet in de week past.\n" +
  "Alles in het Nederlands.";

const VRAGEN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["taken", "opmerking"],
  properties: {
    taken: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["titel", "vraag", "uren", "toelichting", "deadline", "voorkeur"],
        properties: {
          titel: { type: "string" },
          vraag: { type: "string" },
          uren: { type: "number" },
          toelichting: { type: "string" },
          deadline: { type: "string", description: "JJJJ-MM-DD of leeg" },
          voorkeur: { type: "string" }
        }
      }
    },
    opmerking: { type: "string" }
  }
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["voorstel", "uitleg"],
  properties: {
    voorstel: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["titel", "datum", "start", "eind", "categorie", "notitie", "taak"],
        properties: {
          titel: { type: "string" },
          datum: { type: "string", description: "JJJJ-MM-DD" },
          start: { type: "string", description: "HH:MM" },
          eind: { type: "string", description: "HH:MM" },
          categorie: { type: "string", enum: CATS },
          notitie: { type: "string" },
          taak: { type: "integer", description: "nummer van de taak, 0 = geen" }
        }
      }
    },
    uitleg: { type: "string" }
  }
};

const DAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];

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
function dstr(ms) { return new Date(ms).toISOString().slice(0, 10); }
function addD(s, n) { return dstr(civ(s) + n * 86400000); }
function toMin(t) { const a = t.split(":"); return +a[0] * 60 + +a[1]; }
function schoon(s, max) { return String(s == null ? "" : s).replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max); }
/** Uren als veelvoud van een kwartier, tussen een kwartier en 60 uur; null als het geen getal is. */
function uren(x) {
  const n = typeof x === "number" ? x : parseFloat(String(x == null ? "" : x).replace(",", "."));
  if (!isFinite(n) || n <= 0) return null;
  return Math.min(60, Math.max(0.25, Math.round(n * 4) / 4));
}
function urenTekst(n) { return String(n).replace(".", ",") + " uur"; }

/** Controleert de invoer van de app; geeft { fout } of de nette versie. */
function invoer(body) {
  const wens = schoon(body.wens, MAX_WENS);
  if (!wens) return { fout: "Vertel eerst wat je deze week gedaan wilt hebben." };
  const weekStart = String(body.weekStart || "");
  if (!DATUM_RE.test(weekStart)) return { fout: "Ongeldige week." };
  const vandaag = DATUM_RE.test(String(body.vandaag || "")) ? body.vandaag : weekStart;
  const nu = TIJD_RE.test(String(body.nu || "")) ? body.nu : "00:00";
  const ins = body.instellingen || {};
  const dayStart = Math.max(0, Math.min(23, parseInt(ins.dayStart, 10) || 8));
  const dayEnd = Math.max(dayStart + 1, Math.min(24, parseInt(ins.dayEnd, 10) || 18));
  const weekend = ins.weekend !== false;
  const lijst = Array.isArray(body.bestaand) ? body.bestaand.slice(0, MAX_BESTAAND) : [];
  const bestaand = [];
  for (const x of lijst) {
    if (!x || !DATUM_RE.test(String(x.datum))) continue;
    const heleDag = !!x.heleDag;
    if (!heleDag && !(TIJD_RE.test(String(x.start)) && TIJD_RE.test(String(x.eind)))) continue;
    bestaand.push({ datum: x.datum, start: heleDag ? "" : x.start, eind: heleDag ? "" : x.eind, heleDag, titel: schoon(x.titel, 80) });
  }
  const weekEind = addD(weekStart, 6);
  const taken = [];
  for (const t of Array.isArray(body.taken) ? body.taken.slice(0, MAX_TAKEN) : []) {
    const titel = t ? schoon(t.titel, 120) : "";
    const u = t ? uren(t.uren) : null;
    if (!titel || u == null) continue;
    const dl = DATUM_RE.test(String(t.deadline || "")) && t.deadline >= weekStart && t.deadline <= weekEind ? t.deadline : "";
    taken.push({ titel, uren: u, deadline: dl, voorkeur: schoon(t.voorkeur, 120) });
  }
  const stap = body.stap === "vragen" ? "vragen" : "plannen";
  return { stap, wens, weekStart, weekEind, vandaag, nu, dayStart, dayEnd, weekend, bestaand, taken };
}

/** Het bericht aan Claude: de week, wat er al staat, en de wens. */
function bericht(v) {
  const regels = [];
  regels.push("Week: maandag " + v.weekStart + " t/m zondag " + v.weekEind + ".");
  regels.push("Nu is het " + DAGEN[(new Date(civ(v.vandaag)).getUTCDay() + 6) % 7] + " " + v.vandaag + ", " + v.nu + " (Nederlandse tijd).");
  regels.push("Werktijden: " + String(v.dayStart).padStart(2, "0") + ":00–" + String(v.dayEnd).padStart(2, "0") + ":00. Weekend " + (v.weekend ? "mag" : "liever niet") + ".");
  regels.push("");
  regels.push("Staat al in de agenda (hier niet overheen plannen):");
  const perDag = {};
  for (const b of v.bestaand) (perDag[b.datum] = perDag[b.datum] || []).push(b);
  for (let i = 0; i < 7; i++) {
    const d = addD(v.weekStart, i);
    const items = (perDag[d] || []).sort((a, b) => (a.start || "").localeCompare(b.start || ""));
    const txt = items.length
      ? items.map((b) => (b.heleDag ? "hele dag" : b.start + "–" + b.eind) + " " + (b.titel || "bezet")).join("; ")
      : "niets";
    regels.push("- " + DAGEN[i] + " " + d + ": " + txt);
  }
  regels.push("");
  regels.push("Wat ik deze week gedaan wil hebben:");
  regels.push(v.wens);
  if (v.taken.length) {
    regels.push("");
    regels.push("De taken met mijn eigen inschatting van de tijd (plan per taak precies dit aantal uren):");
    v.taken.forEach((t, i) => {
      const dl = t.deadline ? " — uiterlijk af op " + DAGEN[(new Date(civ(t.deadline)).getUTCDay() + 6) % 7] + " " + t.deadline : "";
      regels.push((i + 1) + ". " + t.titel + " — " + urenTekst(t.uren) + dl + (t.voorkeur ? " — voorkeur: " + t.voorkeur : ""));
    });
  }
  return regels.join("\n");
}

function buildRequest(v) {
  if (v.stap === "vragen") {
    return {
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "low", format: { type: "json_schema", schema: VRAGEN_SCHEMA } },
      fallbacks: "default",
      system: VRAGEN_SYSTEEM,
      messages: [{ role: "user", content: bericht(v) }]
    };
  }
  return {
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    fallbacks: "default",
    system: SYSTEEM,
    messages: [{ role: "user", content: bericht(v) }]
  };
}

/** Houdt alleen blokken over die in de week vallen, kloppen en nergens overheen gaan. */
function controleer(voorstel, v) {
  const bezet = {};
  for (const b of v.bestaand) {
    (bezet[b.datum] = bezet[b.datum] || []).push(b.heleDag ? [0, 1440] : [toMin(b.start), toMin(b.eind) || 1440]);
  }
  const out = [];
  for (const x of Array.isArray(voorstel) ? voorstel : []) {
    if (!x || !DATUM_RE.test(String(x.datum)) || !TIJD_RE.test(String(x.start)) || !TIJD_RE.test(String(x.eind))) continue;
    if (x.datum < v.weekStart || x.datum > v.weekEind) continue;
    const s = toMin(x.start), e = toMin(x.eind);
    if (e <= s) continue;
    if (x.datum < v.vandaag || (x.datum === v.vandaag && s < toMin(v.nu))) continue;
    const dag = bezet[x.datum] || (bezet[x.datum] = []);
    if (dag.some((r) => s < r[1] && e > r[0])) continue;
    dag.push([s, e]);
    out.push({
      titel: schoon(x.titel, 120) || "Blok",
      datum: x.datum, start: x.start, eind: x.eind,
      categorie: CATS.indexOf(x.categorie) >= 0 ? x.categorie : "focus",
      notitie: schoon(x.notitie, 500),
      taak: Number.isInteger(x.taak) && x.taak >= 1 && x.taak <= v.taken.length ? x.taak : 0
    });
  }
  out.sort((a, b) => (a.datum + a.start).localeCompare(b.datum + b.start));
  return out;
}

/** De vragenlijst: alleen taken met een titel; uren en deadline netjes gemaakt. */
function controleerTaken(taken, v) {
  const out = [];
  for (const t of Array.isArray(taken) ? taken.slice(0, MAX_TAKEN) : []) {
    const titel = t ? schoon(t.titel, 120) : "";
    if (!titel) continue;
    const dl = DATUM_RE.test(String(t.deadline || "")) && t.deadline >= v.weekStart && t.deadline <= v.weekEind ? t.deadline : "";
    out.push({
      titel,
      vraag: schoon(t.vraag, 300) || "Hoeveel uur denk je nodig te hebben voor " + titel + "?",
      uren: uren(t.uren) || 1,
      toelichting: schoon(t.toelichting, 300),
      deadline: dl,
      voorkeur: schoon(t.voorkeur, 120)
    });
  }
  return out;
}

/** Haalt het JSON-antwoord uit de API-respons; geeft { fout } of { voorstel, uitleg }. */
function leesAntwoord(j) {
  if (!j || !Array.isArray(j.content)) return { fout: "Onverwacht antwoord van Claude." };
  if (j.stop_reason === "refusal") return { fout: "Claude wilde dit niet plannen. Formuleer het anders en probeer het nog eens." };
  if (j.stop_reason === "max_tokens") return { fout: "Het antwoord werd te lang. Vraag om minder tegelijk." };
  const tekst = j.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    const data = JSON.parse(tekst);
    if (Array.isArray(data.taken)) return { taken: data.taken, opmerking: schoon(data.opmerking, 400) };
    return { voorstel: data.voorstel, uitleg: schoon(data.uitleg, 1000) };
  } catch (e) {
    return { fout: "Claude gaf geen leesbare planning terug. Probeer het nog eens." };
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
  if (v.stap === "vragen") return send(res, 200, { taken: controleerTaken(a.taken, v), opmerking: a.opmerking || "" });
  return send(res, 200, { voorstel: controleer(a.voorstel, v), uitleg: a.uitleg });
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
module.exports.bericht = bericht;
module.exports.buildRequest = buildRequest;
module.exports.controleer = controleer;
module.exports.controleerTaken = controleerTaken;
module.exports.leesAntwoord = leesAntwoord;
