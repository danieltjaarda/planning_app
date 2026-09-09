// Klantformulier — één Vercel-functie voor aanmaken, invullen en ophalen.
//
// De app maakt per klant een link met een willekeurig token. De klant opent
// die link, vult het bruiloftsformulier in, en de antwoorden landen hier.
// De app haalt ze daarna op met hetzelfde token.
//
// Opslag: Upstash Redis via de REST-koppeling (de "Redis"-store uit de
// Vercel-marketplace zet KV_REST_API_URL en KV_REST_API_TOKEN klaar).
// Geen npm-afhankelijkheden: een kale fetch volstaat.
//
//   GET  /api/formulier?t=TOKEN               → { naam, datum, ingevuld, antwoorden }
//   POST /api/formulier { t, actie: "aanmaken", naam, datum }
//   POST /api/formulier { t, actie: "invullen", antwoorden }
//   POST /api/formulier { t, actie: "verwijderen" }

const bestanden = require("./_bestanden.js");
const sessie = require("./_sessie.js");
const TOKEN_RE = /^[a-z0-9]{12,40}$/;
const TTL_SEC = 60 * 60 * 24 * 730; // twee jaar: bruiloften worden ver vooruit geboekt
const MAX_TEXT = 4000;
const MAX_LIST = 40;

function store() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  async function cmd(...args) {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(args)
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
  }

  return {
    async get(key) { const v = await cmd("GET", key); return v ? JSON.parse(v) : null; },
    async set(key, value) { await cmd("SET", key, JSON.stringify(value), "EX", TTL_SEC); },
    async del(key) { await cmd("DEL", key); }
  };
}

/** In-memory variant voor tests en lokaal proberen. */
function memoryStore(map) {
  const m = map || new Map();
  return {
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async set(k, v) { m.set(k, JSON.stringify(v)); },
    async del(k) { m.delete(k); }
  };
}

function clean(v, max) {
  return String(v == null ? "" : v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").slice(0, max || MAX_TEXT).trim();
}

/** Alleen strings, booleans en lijsten van strings; alles begrensd. */
function cleanAnswers(a) {
  const out = {};
  if (!a || typeof a !== "object" || Array.isArray(a)) return out;
  const keys = Object.keys(a).slice(0, 60);
  for (const k of keys) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(k)) continue;
    const v = a[k];
    if (typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, MAX_LIST).map(x => clean(x, 200)).filter(Boolean);
    else if (typeof v === "string" || typeof v === "number") out[k] = clean(v);
  }
  return out;
}

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

function tokenOf(req, body) {
  const q = req.query && req.query.t;
  const t = clean(q != null ? q : body && body.t, 40);
  return TOKEN_RE.test(t) ? t : null;
}

async function handle(req, res, db, files) {
  if (!db) return send(res, 503, { error: "geen_opslag", melding: "Er is nog geen opslag gekoppeld (KV_REST_API_URL / KV_REST_API_TOKEN)." });

  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") return send(res, 405, { error: "methode" });

  const body = method === "POST" ? parseBody(req) : {};
  if (body === null) return send(res, 400, { error: "ongeldige_json" });

  const t = tokenOf(req, body);
  if (!t) return send(res, 400, { error: "ongeldig_token" });
  const key = "formulier:" + t;

  if (method === "GET") {
    const rec = await db.get(key);
    if (!rec) return send(res, 404, { error: "onbekend" });
    return send(res, 200, {
      naam: rec.naam || "", datum: rec.datum || "",
      aangemaakt: rec.aangemaakt || null,
      ingevuld: rec.ingevuld || null,
      antwoorden: rec.antwoorden || null,
      bestanden: bestanden.publicFiles(rec)
    });
  }

  const actie = clean(body.actie, 20);

  // Links maken en klanten verwijderen doet alleen de planner zelf.
  if ((actie === "aanmaken" || actie === "verwijderen") && !sessie.ingelogd(req)) {
    return send(res, 401, { error: "niet_ingelogd", melding: "Je bent niet (meer) ingelogd. Laad de pagina opnieuw en log in." });
  }

  if (actie === "aanmaken") {
    const old = await db.get(key);
    const rec = {
      naam: clean(body.naam, 200),
      datum: /^\d{4}-\d{2}-\d{2}$/.test(String(body.datum || "")) ? body.datum : "",
      aangemaakt: old && old.aangemaakt ? old.aangemaakt : new Date().toISOString(),
      ingevuld: old ? old.ingevuld || null : null,
      antwoorden: old ? old.antwoorden || null : null,
      bestanden: old && old.bestanden ? old.bestanden : [],
      draaiboek: old && old.draaiboek ? old.draaiboek : 0
    };
    await db.set(key, rec);
    return send(res, 200, { ok: true, t });
  }

  if (actie === "invullen") {
    const old = await db.get(key);
    if (!old) return send(res, 404, { error: "onbekend" });
    const antwoorden = cleanAnswers(body.antwoorden);
    if (!Object.keys(antwoorden).length) return send(res, 400, { error: "leeg" });
    const rec = Object.assign({}, old, { antwoorden, ingevuld: new Date().toISOString() });
    await db.set(key, rec);
    return send(res, 200, { ok: true, ingevuld: rec.ingevuld });
  }

  if (actie === "verwijderen") {
    const old = await db.get(key);
    if (files && old && Array.isArray(old.bestanden) && old.bestanden.length) {
      try { await files.remove(old.bestanden.map((b) => b.url)); } catch (e) { /* opslag opruimen mag mislukken */ }
    }
    await db.del(key);
    return send(res, 200, { ok: true });
  }

  return send(res, 400, { error: "onbekende_actie" });
}

module.exports = async function (req, res) {
  try {
    await handle(req, res, store(), bestanden.blobStore());
  } catch (e) {
    send(res, 502, { error: "opslag", melding: String(e && e.message || e) });
  }
};
module.exports.handle = handle;
module.exports.memoryStore = memoryStore;
module.exports.cleanAnswers = cleanAnswers;
