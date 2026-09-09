// Draaiboek → tijdlijn. De klant uploadt een foto, PDF of tekstbestand van
// het draaiboek; een model via OpenRouter zet dat om in een nette dagplanning
// die in het formulier komt te staan.
//
//   POST /api/draaiboek { t, naam, mime, data (base64) }  → { tekst, bestand }
//   GET  /api/draaiboek?t=TOKEN&i=0                       → het bewaarde bestand zelf
//
// Het bestand wordt bewaard (Blob-opslag, zie _bestanden.js) zodat de
// videograaf het originele draaiboek in het klantvenster kan openen.
//
// Sleutel: OPENROUTER_API_KEY (omgevingsvariabele, nooit in de code).
// Alleen bruikbaar met een geldig formulier-token, en per token begrensd,
// zodat de link niet als gratis AI-doorgeefluik kan dienen.

const TOKEN_RE = /^[a-z0-9]{12,40}$/;
const MAX_BYTES = 3 * 1024 * 1024;   // ruim genoeg voor een foto of een paar pagina's PDF
const MAX_CALLS = 25;                // per formulierlink
const MODEL = "google/gemini-2.5-flash"; // snel, goedkoop, leest foto's en PDF's zelf
const TTL_SEC = 60 * 60 * 24 * 730;
const bestanden = require("./_bestanden.js");
const sessie = require("./_sessie.js");

const IMAGE = /^image\/(jpeg|png|webp|gif|heic|heif)$/;
const TEXT = /^text\/(plain|markdown|csv)$/;

const PROMPT =
  "Je helpt een bruiloftsvideograaf. Je krijgt het draaiboek of de dagplanning van een bruiloft " +
  "(als foto, PDF of tekst). Zet dit om in een overzichtelijke tijdlijn in het Nederlands.\n\n" +
  "Regels:\n" +
  "- Eén regel per onderdeel, chronologisch, in dit formaat: HH:MM  onderdeel — locatie\n" +
  "- Laat ' — locatie' weg als er geen locatie bij staat.\n" +
  "- Ontbreekt een tijd, schrijf dan --:-- in plaats van de tijd.\n" +
  "- Neem alleen op wat in het document staat. Verzin niets en vul niets aan.\n" +
  "- Namen van personen, adressen en locaties letterlijk overnemen.\n" +
  "- Geen inleiding, geen afsluiting, geen opmaak: alleen de regels.\n" +
  "- Staat er geen planning in het document, antwoord dan precies: GEEN_PLANNING";

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
    async get(k) { const v = await cmd("GET", k); return v ? JSON.parse(v) : null; },
    async set(k, v) { await cmd("SET", k, JSON.stringify(v), "EX", TTL_SEC); }
  };
}

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

/** Bouwt de OpenRouter-aanroep; los van de netwerklaag zodat tests hem kunnen bekijken. */
function buildRequest(mime, data, naam) {
  const content = [{ type: "text", text: "Hier is het draaiboek" + (naam ? " (" + naam + ")" : "") + ". Zet het om in een tijdlijn." }];
  const body = {
    model: MODEL,
    temperature: 0.2,
    max_tokens: 1500,
    messages: [{ role: "system", content: PROMPT }, { role: "user", content }]
  };
  if (IMAGE.test(mime)) {
    content.push({ type: "image_url", image_url: { url: "data:" + mime + ";base64," + data } });
  } else if (mime === "application/pdf") {
    content.push({ type: "file", file: { filename: naam || "draaiboek.pdf", file_data: "data:application/pdf;base64," + data } });
    body.plugins = [{ id: "file-parser", pdf: { engine: "native" } }];
  } else if (TEXT.test(mime)) {
    const txt = Buffer.from(data, "base64").toString("utf8").slice(0, 20000);
    content[0].text += "\n\n---\n" + txt;
  } else {
    return null;
  }
  return body;
}

function cleanTimeline(text) {
  const t = String(text || "").replace(/\r/g, "").replace(/```[a-z]*\n?/g, "").trim();
  if (!t || /^GEEN_PLANNING/.test(t)) return "";
  return t.split("\n").map(l => l.replace(/^\s*[-*•]\s*/, "").trimEnd()).filter(Boolean).join("\n");
}

/** Het bewaarde bestand teruggeven — alleen met het formulier-token. */
async function serveFile(req, res, db, files) {
  if (!sessie.ingelogd(req)) {
    // niet ingelogd: naar de inlogpagina, daarna kom je hier terug
    res.statusCode = 401;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end('<meta http-equiv="refresh" content="0; url=/inloggen.html">Log eerst in.');
  }
  if (!db) return send(res, 503, { error: "geen_opslag" });
  const t = String((req.query && req.query.t) || "");
  const i = parseInt((req.query && req.query.i) || "", 10);
  if (!TOKEN_RE.test(t) || !(i >= 0)) return send(res, 400, { error: "ongeldig" });
  const rec = await db.get("formulier:" + t);
  const b = rec && Array.isArray(rec.bestanden) ? rec.bestanden[i] : null;
  if (!b) return send(res, 404, { error: "onbekend" });
  if (!files) return send(res, 503, { error: "geen_bestandsopslag", melding: "Er is geen bestandsopslag gekoppeld." });
  const buf = await files.open(b.url);
  if (!buf) return send(res, 404, { error: "weg", melding: "Het bestand is niet meer beschikbaar." });
  res.statusCode = 200;
  res.setHeader("Content-Type", b.mime || "application/octet-stream");
  res.setHeader("Content-Disposition", "inline; filename=\"" + bestanden.safeName(b.naam) + "\"");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.end(buf);
}

async function handle(req, res, db, apiKey, fetchFn, files) {
  const doFetch = fetchFn || fetch;
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET") return serveFile(req, res, db, files);
  if (method !== "POST") return send(res, 405, { error: "methode" });
  if (!apiKey && !files) return send(res, 503, { error: "geen_sleutel", melding: "Het omzetten van draaiboeken staat nog niet aan (OPENROUTER_API_KEY ontbreekt)." });
  if (!db) return send(res, 503, { error: "geen_opslag", melding: "Er is nog geen opslag gekoppeld." });

  const body = parseBody(req);
  if (body === null) return send(res, 400, { error: "ongeldige_json" });
  const t = String(body.t || "");
  if (!TOKEN_RE.test(t)) return send(res, 400, { error: "ongeldig_token" });

  const mime = String(body.mime || "").toLowerCase();
  const data = typeof body.data === "string" ? body.data.replace(/^data:[^,]*,/, "") : "";
  const naam = String(body.naam || "").replace(/[^\w .()\-]/g, "").slice(0, 80);
  if (!data) return send(res, 400, { error: "leeg" });
  if (data.length > MAX_BYTES * 4 / 3 + 4) return send(res, 413, { error: "te_groot", melding: "Het bestand is te groot (max 3 MB). Maak een kleinere foto of een lichtere PDF." });

  const orBody = buildRequest(mime, data, naam);
  if (!orBody) return send(res, 415, { error: "bestandstype", melding: "Dit bestandstype kan ik niet lezen. Stuur een foto, PDF of tekstbestand." });

  const key = "formulier:" + t;
  let rec = await db.get(key);
  if (!rec) return send(res, 404, { error: "onbekend" });
  const calls = (rec.draaiboek || 0) + 1;
  if (calls > MAX_CALLS) return send(res, 429, { error: "limiet", melding: "Je hebt dit al vaak gebruikt; typ de planning even zelf over." });
  rec = Object.assign({}, rec, { draaiboek: calls });

  // Eerst het bestand zelf bewaren: dat wil de videograaf later kunnen openen.
  let bestand = null;
  if (files) {
    try {
      const buf = Buffer.from(data, "base64");
      const url = await files.save(buf, mime, naam);
      rec = bestanden.withFile(rec, { naam: naam || "draaiboek", mime, grootte: buf.length, url, at: new Date().toISOString() });
      bestand = { naam: naam || "draaiboek", i: rec.bestanden.length - 1 };
    } catch (e) {
      bestand = null; // omzetten kan gewoon door
    }
  }
  await db.set(key, rec);

  if (!apiKey) {
    return send(res, 200, { tekst: "", bestand, bestanden: bestanden.publicFiles(rec),
      melding: "Het bestand is bewaard. Automatisch omzetten staat nog niet aan; typ de planning even zelf." });
  }

  let r, j;
  try {
    r = await doFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://planning-app-three.vercel.app",
        "X-Title": "Weekzicht draaiboek"
      },
      body: JSON.stringify(orBody)
    });
    j = await r.json();
  } catch (e) {
    return send(res, 502, { error: "ai", melding: "Het AI-model was even niet bereikbaar. Probeer het zo nog eens." });
  }
  if (!r.ok || !j || j.error) {
    const m = (j && j.error && j.error.message) || ("status " + (r && r.status));
    return send(res, 502, { error: "ai", melding: "Het omzetten lukte niet (" + String(m).slice(0, 120) + ")." });
  }
  const raw = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  const tekst = cleanTimeline(typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map(p => p.text || "").join("\n") : "");
  const lijst = bestanden.publicFiles(rec);
  if (!tekst) return send(res, 200, { tekst: "", bestand, bestanden: lijst, melding: (bestand ? "Het bestand is bewaard, maar ik" : "Ik") + " kon geen planning in dit bestand vinden. Probeer een duidelijkere foto, of typ de planning zelf." });
  return send(res, 200, { tekst, model: MODEL, bestand, bestanden: lijst });
}

module.exports = async function (req, res) {
  try {
    await handle(req, res, store(), process.env.OPENROUTER_API_KEY, null, bestanden.blobStore());
  } catch (e) {
    send(res, 502, { error: "server", melding: String(e && e.message || e) });
  }
};
module.exports.handle = handle;
module.exports.buildRequest = buildRequest;
module.exports.cleanTimeline = cleanTimeline;
module.exports.MODEL = MODEL;
