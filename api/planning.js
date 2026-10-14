// De planning zelf — afspraken, taken, klanten en instellingen — op de server,
// zodat hij op elk apparaat en in elke browser dezelfde is. Zonder deze
// functie leeft alles in localStorage van één browser.
//
// In Redis: één hash per verzameling (planning:events, planning:tasks,
// planning:leads, planning:meta), veld = id, waarde = het document. Twee
// apparaten die tegelijk iets wijzigen overschrijven zo alleen elkaars
// documenten, nooit de hele lijst. Plus planning:versie, een teller die bij
// elke wijziging omhooggaat: verversen haalt alleen iets op als er echt iets
// veranderd is. Geen houdbaarheid — dit zijn de gegevens zelf.
//
//   GET  /api/planning                  → { versie, events: { id: doc }, tasks, leads, meta }
//   GET  /api/planning?sinds=VERSIE     → { versie, ongewijzigd: true } als er sindsdien niets veranderd is
//   POST /api/planning { ops: [{ c, id, doc } | { c, id, weg: true }] }   → { ok, versie }
//
// Alles alleen ingelogd. Op Vercel staat het wachtwoord altijd aan; zonder
// actief wachtwoord weigert de functie: dan kon iedereen met het adres de
// klantenlijst lezen.

const opslag = require("./_opslag.js");
const sessie = require("./_sessie.js");

const PREFIX = "planning:";
const VERSIE = PREFIX + "versie";
const VERZAMELINGEN = ["events", "tasks", "leads", "meta"];
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_OPS = 500;           // de app stuurt in porties van 200; een import is hoogstens 600 afspraken
const MAX_DOC = 256 * 1024;    // een klant met formulier, draaiboek en muziek past er ruim in

function parseBody(req) {
  const b = req.body;
  if (b == null || b === "") return {};
  if (typeof b === "object") return b;
  try { return JSON.parse(String(b)); } catch (e) { return null; }
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.end(JSON.stringify(obj));
}

/** Controleert één wijziging; geeft een foutmelding of null. */
function opFout(op) {
  if (!op || typeof op !== "object") return "geen object";
  if (VERZAMELINGEN.indexOf(op.c) < 0) return "onbekende verzameling";
  if (typeof op.id !== "string" || !ID_RE.test(op.id)) return "ongeldig id";
  if (op.weg === true) return null;
  if (!op.doc || typeof op.doc !== "object" || Array.isArray(op.doc)) return "geen document";
  if (JSON.stringify(op.doc).length > MAX_DOC) return "document te groot";
  return null;
}

async function handle(req, res, db, opts) {
  const eisWachtwoord = !!(opts && opts.eisWachtwoord);
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") return send(res, 405, { error: "methode" });

  if (eisWachtwoord && !sessie.beveiligd()) {
    return send(res, 403, { error: "geen_wachtwoord", melding: "Er is geen wachtwoord actief; zonder wachtwoord bewaart de server de planning niet." });
  }
  if (!sessie.ingelogd(req)) {
    return send(res, 401, { error: "niet_ingelogd", melding: "Je bent niet (meer) ingelogd. Laad de pagina opnieuw en log in." });
  }
  if (!db) return send(res, 503, { error: "geen_opslag", melding: "Er is nog geen opslag gekoppeld (KV_REST_API_URL / KV_REST_API_TOKEN)." });

  if (method === "GET") {
    // Eerst de versie, dán de gegevens: valt er een wijziging tussen, dan
    // krijg je nieuwe gegevens met een oude versie en haal je volgende keer
    // gewoon alles opnieuw. Andersom zou je oude gegevens blijven houden.
    const versie = Number(await db.get(VERSIE)) || 0;
    const sinds = req.query && req.query.sinds;
    if (versie > 0 && sinds != null && String(sinds) === String(versie)) {
      return send(res, 200, { versie, ongewijzigd: true });
    }
    const lijsten = await Promise.all(VERZAMELINGEN.map((c) => db.hgetall(PREFIX + c)));
    const out = { versie };
    VERZAMELINGEN.forEach((c, i) => { out[c] = lijsten[i] || {}; });
    return send(res, 200, out);
  }

  const body = parseBody(req);
  if (body === null) return send(res, 400, { error: "ongeldige_json" });
  const ops = body.ops;
  if (!Array.isArray(ops) || !ops.length) return send(res, 400, { error: "geen_wijzigingen" });
  if (ops.length > MAX_OPS) return send(res, 400, { error: "te_veel", melding: "Hoogstens " + MAX_OPS + " wijzigingen per keer." });
  for (let i = 0; i < ops.length; i++) {
    const fout = opFout(ops[i]);
    if (fout) return send(res, 400, { error: "ongeldige_wijziging", op: i, melding: fout });
  }

  // Per document telt de laatste wijziging in de lijst.
  const laatste = new Map();
  for (const op of ops) laatste.set(op.c + "/" + op.id, op);
  const perVerzameling = {};
  for (const op of laatste.values()) {
    const v = perVerzameling[op.c] || (perVerzameling[op.c] = { zet: {}, weg: [] });
    if (op.weg) v.weg.push(op.id); else v.zet[op.id] = op.doc;
  }
  await Promise.all(Object.keys(perVerzameling).map((c) => {
    const v = perVerzameling[c];
    return Promise.all([db.hset(PREFIX + c, v.zet), db.hdel(PREFIX + c, v.weg)]);
  }));
  // pas ophogen als de gegevens er staan (zie GET)
  const versie = await db.incr(VERSIE);
  return send(res, 200, { ok: true, versie });
}

module.exports = async function (req, res) {
  try {
    await handle(req, res, opslag.store(), { eisWachtwoord: true });
  } catch (e) {
    send(res, 502, { error: "opslag", melding: String(e && e.message || e) });
  }
};
module.exports.handle = handle;
module.exports.memoryStore = opslag.memoryStore;
module.exports.MAX_OPS = MAX_OPS;
module.exports.MAX_DOC = MAX_DOC;
