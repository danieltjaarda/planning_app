// Herinneringen per mail: elke ochtend een dagoverzicht, en vlak voor een
// afspraak of belafspraak een herinnering. Vercel Cron roept deze functie elke
// vijf minuten aan (zie vercel.json). Wat al verstuurd is, onthouden we in
// Redis (herinneringen:verstuurd), zodat niets dubbel gaat, ook niet als de
// functie vaker wordt aangeroepen.
//
//   GET  /api/herinneringen                      Vercel Cron; met CRON_SECRET in de omgeving alleen met dat geheim
//   POST /api/herinneringen { actie: "test" }    (alleen ingelogd) stuurt nu meteen een dagoverzicht
//
// De instellingen (dagoverzicht aan/uit en hoe laat, hoeveel minuten vooraf)
// staan in de planning zelf, in meta/meldingen; zie api/_meldingen.js.
// Alle tijden zijn Nederlandse tijd.

const opslag = require("./_opslag.js");
const sessie = require("./_sessie.js");
const mail = require("./_mail.js");
const meldingen = require("./_meldingen.js");

const TZ = "Europe/Amsterdam";
const VERSTUURD = "herinneringen:verstuurd";
const BEWAAR_MS = 3 * 86400000;      // daarna mag een sleutel weg
const DAGVENSTER = 180;              // een gemist dagoverzicht sturen we tot 3 uur na de ingestelde tijd
const MAX_POGINGEN = 3;
const DAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

/* --- tijd in Nederland ------------------------------------------- */

/** { datum: "JJJJ-MM-DD", min: minuten sinds middernacht } in Nederland. */
function nuIn(nu) {
  const p = {};
  for (const x of new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(nu)) p[x.type] = x.value;
  return { datum: p.year + "-" + p.month + "-" + p.day, min: Number(p.hour) * 60 + Number(p.minute) };
}

function plusDagen(datum, n) {
  const d = new Date(datum + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function minuten(t) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(t || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** "maandag 12 oktober" */
function dagNaam(datum) {
  const d = new Date(datum + "T12:00:00Z");
  return DAGEN[d.getUTCDay()] + " " + d.getUTCDate() + " " + MAANDEN[d.getUTCMonth()];
}

/* --- wat er gepland staat ------------------------------------------ */

function naam(l) {
  return String(l.name || "").trim() || String(l.phone || "").trim() || "klant zonder naam";
}

function kort(s, max) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Alles op één dag, als regels met een begintijd om op te sorteren. */
function opDag(data, datum) {
  const uit = [];
  for (const [id, e] of Object.entries(data.events || {})) {
    if (!e || e.date !== datum) continue;
    uit.push({ soort: "afspraak", id, heleDag: !!e.allDay, start: e.allDay ? null : e.start, eind: e.allDay ? null : e.end,
      titel: e.title || "Afspraak", plek: e.loc || "", notitie: e.note || "" });
  }
  for (const [id, l] of Object.entries(data.leads || {})) {
    if (!l || l.status === "af") continue;
    if (l.callDate === datum) {
      uit.push({ soort: "bellen", id, heleDag: !l.callTime, start: l.callTime || null, eind: null,
        titel: "Bellen met " + naam(l), plek: l.phone || "", notitie: l.note || "" });
    }
    // een klus telt pas als hij geboekt is
    if (l.date === datum && l.status === "akkoord") {
      const tijden = minuten(l.start) != null && minuten(l.end) != null;
      uit.push({ soort: "klus", id, heleDag: !tijden, start: tijden ? l.start : null, eind: tijden ? l.end : null,
        titel: naam(l) + " (klus)", plek: l.phone || "", notitie: "" });
    }
  }
  uit.sort((a, b) => (a.heleDag !== b.heleDag ? (a.heleDag ? -1 : 1) : (minuten(a.start) || 0) - (minuten(b.start) || 0)));
  return uit;
}

function regel(it) {
  const tijd = it.heleDag ? "Hele dag" : it.start + (it.eind ? "–" + it.eind : "");
  return tijd + " · " + it.titel + (it.plek ? " · " + it.plek : "") + (it.notitie ? "\n" + kort(it.notitie, 160) : "");
}

/** Open taken met een einddatum vandaag of eerder. */
function takenVoor(data, datum) {
  return Object.values(data.tasks || {}).filter((t) => t && !t.done && /^\d{4}-\d{2}-\d{2}$/.test(String(t.due || "")) && t.due <= datum)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
}

/* --- de mails ---------------------------------------------------- */

function dagoverzicht(data, datum, altijd) {
  const vandaag = opDag(data, datum);
  const taken = takenVoor(data, datum);
  const morgen = opDag(data, plusDagen(datum, 1)).filter((x) => x.soort === "klus");
  if (!vandaag.length && !taken.length && !morgen.length && !altijd) return null;
  const n = vandaag.length;
  const delen = ["Goedemorgen! Dit staat er vandaag, " + dagNaam(datum) + ", op de planning:"];
  delen.push(n ? vandaag.map(regel).join("\n\n") : "Geen afspraken vandaag.");
  if (taken.length) {
    delen.push("Taken:\n" + taken.map((t) => "• " + kort(t.title, 120) + (t.due < datum ? " (was voor " + dagNaam(t.due) + ")" : "")).join("\n"));
  }
  if (morgen.length) delen.push("Morgen:\n" + morgen.map((x) => "• " + regel(x)).join("\n"));
  return {
    onderwerp: "Vandaag: " + (n ? n + (n === 1 ? " afspraak" : " afspraken") : "geen afspraken") +
      (taken.length ? ", " + taken.length + (taken.length === 1 ? " taak" : " taken") : "") + " · " + dagNaam(datum),
    tekst: delen.join("\n\n")
  };
}

function voorafMail(items) {
  const eerste = items[0];
  const onderwerp = "Om " + eerste.start + ": " + (items.length === 1 ? eerste.titel : items.length + " afspraken");
  const tekst = items.map((it) => "Om " + it.start + (it.eind ? " (tot " + it.eind + ")" : "") + ": " + it.titel +
    (it.plek ? "\n" + (it.soort === "bellen" ? "Telefoon: " : "Locatie: ") + it.plek : "") +
    (it.notitie ? "\nNotitie: " + kort(it.notitie, 300) : "")).join("\n\n");
  return { onderwerp, tekst };
}

/**
 * Wat er nu verstuurd moet worden. Puur: geen opslag, geen mail.
 * Geeft [{ sleutels: [...], onderwerp, tekst }].
 */
function plan(data, inst, nu, verstuurd) {
  const t = nuIn(nu), uit = [], al = verstuurd || {};
  const klaar = (k) => al[k] && (al[k].op || (al[k].pogingen || 0) >= MAX_POGINGEN);

  // herinnering vooraf: afspraken en belafspraken die binnen `vooraf` minuten beginnen
  if (inst.vooraf > 0) {
    const zo = [];
    for (const [datum, extra] of [[t.datum, 0], [plusDagen(t.datum, 1), 1440]]) {
      for (const it of opDag(data, datum)) {
        if (it.heleDag || it.soort === "klus") continue;
        const over = minuten(it.start) + extra - t.min;
        if (over <= 0 || over > inst.vooraf) continue;
        const k = "v:" + it.soort + ":" + it.id + ":" + datum + "T" + it.start;
        if (!klaar(k)) zo.push(Object.assign({ sleutel: k }, it));
      }
    }
    if (zo.length) {
      const m = voorafMail(zo);
      uit.push({ sleutels: zo.map((x) => x.sleutel), onderwerp: m.onderwerp, tekst: m.tekst });
    }
  }

  // dagoverzicht: vanaf de ingestelde tijd, hoogstens drie uur later
  if (inst.dagoverzicht) {
    const vanaf = minuten(inst.dagTijd), k = "d:" + t.datum;
    if (t.min >= vanaf && t.min < vanaf + DAGVENSTER && !klaar(k)) {
      const m = dagoverzicht(data, t.datum, false);
      // niets te melden: wel onthouden, zodat we niet blijven kijken
      uit.push(m ? { sleutels: [k], onderwerp: m.onderwerp, tekst: m.tekst } : { sleutels: [k], leeg: true });
    }
  }
  return uit;
}

/* --- de functie -------------------------------------------------- */

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

function parseBody(req) {
  const b = req.body;
  if (b == null || b === "") return {};
  if (typeof b === "object") return b;
  try { return JSON.parse(String(b)); } catch (e) { return null; }
}

async function leesPlanning(db) {
  const [events, tasks, leads, meta] = await Promise.all(["events", "tasks", "leads", "meta"].map((c) => db.hgetall("planning:" + c)));
  return { events: events || {}, tasks: tasks || {}, leads: leads || {}, meta: meta || {} };
}

async function verstuur(verzender, m) {
  const tekst = m.tekst + "\n\nOpen Weekzicht: " + meldingen.APP_URL;
  await verzender.verstuur({
    aan: verzender.meldingen(), onderwerp: m.onderwerp, tekst,
    html: mail.mailHtml({ tekst, knop: { tekst: "Open Weekzicht", url: meldingen.APP_URL } })
  });
}

async function handle(req, res, db, opts) {
  const nu = (opts && opts.nu) || (() => new Date());
  const verzender = (opts && opts.mail) || mail.forwardEmail();
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") return send(res, 405, { error: "methode" });
  if (!db) return send(res, 503, { error: "geen_opslag" });

  if (method === "POST") {
    const body = parseBody(req);
    if (body === null) return send(res, 400, { error: "ongeldige_json" });
    if (!sessie.ingelogd(req)) return send(res, 401, { error: "niet_ingelogd", melding: "Je bent niet (meer) ingelogd. Laad de pagina opnieuw en log in." });
    if (body.actie !== "test") return send(res, 400, { error: "onbekende_actie" });
    if (!verzender.aan()) return send(res, 503, { error: "geen_mail", melding: "Mailen staat nog niet aan: zet MAIL_VAN en MAIL_WACHTWOORD in Vercel." });
    const data = await leesPlanning(db);
    const m = dagoverzicht(data, nuIn(nu()).datum, true);
    try { await verstuur(verzender, m); }
    catch (e) { return send(res, 502, { error: "mail", melding: "Versturen lukte niet: " + String((e && e.message) || e).slice(0, 200) }); }
    return send(res, 200, { ok: true, aan: verzender.meldingen() });
  }

  // GET: de cron. Met CRON_SECRET stuurt Vercel dat mee; zonder is aanroepen onschuldig (niets gaat dubbel).
  const geheim = process.env.CRON_SECRET || "";
  const auth = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || "");
  if (geheim && auth !== "Bearer " + geheim) return send(res, 401, { error: "niet_toegestaan" });
  if (!verzender.aan()) return send(res, 200, { ok: true, verstuurd: 0, reden: "mailen staat uit" });

  const data = await leesPlanning(db);
  const inst = meldingen.instellingen(data.meta.meldingen);
  const al = (await db.get(VERSTUURD)) || {};
  const todo = plan(data, inst, nu(), al);
  let verstuurd = 0;
  const stamp = nu().toISOString();
  for (const m of todo) {
    let ok = true;
    if (!m.leeg) {
      try { await verstuur(verzender, m); verstuurd++; } catch (e) { ok = false; }
    }
    for (const k of m.sleutels) al[k] = ok ? { op: stamp } : { pogingen: ((al[k] && al[k].pogingen) || 0) + 1, laatst: stamp };
  }
  // oude sleutels opruimen
  const grens = nu().getTime() - BEWAAR_MS;
  for (const k of Object.keys(al)) {
    const tijd = Date.parse((al[k] && (al[k].op || al[k].laatst)) || "");
    if (!(tijd > grens)) delete al[k];
  }
  if (todo.length || Object.keys(al).length) await db.set(VERSTUURD, al);
  return send(res, 200, { ok: true, verstuurd });
}

module.exports = async function (req, res) {
  try {
    await handle(req, res, opslag.store(), null);
  } catch (e) {
    send(res, 502, { error: "opslag", melding: String((e && e.message) || e) });
  }
};
module.exports.handle = handle;
module.exports.plan = plan;
module.exports.dagoverzicht = dagoverzicht;
module.exports.nuIn = nuIn;
module.exports.opDag = opDag;
