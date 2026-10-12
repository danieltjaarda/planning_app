// Muziekkeuze — één Vercel-functie voor aanmaken, kiezen, opzoeken en ophalen.
//
// De app maakt per klant een muzieklink met een willekeurig token (?m=token).
// De klant luistert de suggesties, kiest wat past en voegt eigen nummers toe
// met een YouTube-link; de keuze landt hier en de app haalt hem op.
//
// De muziek zelf wordt nooit gedownload of opgeslagen: afspelen gebeurt met de
// ingebouwde YouTube-speler op de pagina van de klant. Hier staan alleen
// video-ID's, titels en de keuze van de klant.
//
//   GET  /api/muziek?t=TOKEN                                 → { naam, datum, ingevuld, nummers, opmerking }
//   POST /api/muziek { t, actie: "aanmaken", naam, datum }   (alleen ingelogd)
//   POST /api/muziek { t, actie: "kiezen", nummers, opmerking }   nummers: [{ yt, titel, artiest, moment, eigen }]
//   POST /api/muziek { t, actie: "opzoeken", url }           → { yt, titel, artiest, kanaal }
//   POST /api/muziek { t, actie: "verwijderen" }             (alleen ingelogd)

const opslag = require("./_opslag.js");
const sessie = require("./_sessie.js");
const mail = require("./_mail.js");
const meldingen = require("./_meldingen.js");
const TOKEN_RE = /^[a-z0-9]{12,40}$/;
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_SONGS = 6; // in een trouwfilm passen zes nummers: één per scène (zelfde grens als MUZIEK_MAX in de app)
const MAX_LOOKUPS = 500; // per link: ruim voor een bruidspaar, te weinig om als gratis doorgeefluik te dienen
const MAX_NOTE = 2000;

function clean(v, max) {
  return String(v == null ? "" : v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").slice(0, max || 200).trim();
}

/** Haalt het video-ID uit een YouTube-link; ook youtu.be, shorts, embed en music.youtube. */
function videoId(input) {
  const s = String(input || "").trim();
  if (YT_ID.test(s)) return s;
  const m = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/i.exec(s);
  return m ? m[1] : null;
}

/** "Ed Sheeran - Perfect (Official Music Video)" → { titel: "Perfect", artiest: "Ed Sheeran" }. */
function splitTitle(title, channel) {
  const raw = clean(title, 200);
  let t = raw
    .replace(/\s*[(\[][^)\]]*(official|officiële|officiele|video|audio|lyric|lyrics|visualizer|clip|hd|4k)[^)\]]*[)\]]/gi, " ")
    .replace(/\s+/g, " ").trim();
  let artiest = "";
  const m = /^(.{1,80}?)\s+[-–—|]\s+(.+)$/.exec(t);
  if (m) { artiest = m[1].trim(); t = m[2].trim(); }
  else artiest = clean(channel, 200).replace(/\s*VEVO$/i, "").replace(/\s*-\s*Topic$/i, "").trim();
  return { titel: t || raw || "Nummer van YouTube", artiest };
}

/** Alleen geldige video-ID's, zonder dubbelen, één per scène, alles begrensd. */
function cleanSongs(list) {
  const out = [], seen = {}, scenes = {};
  if (!Array.isArray(list)) return out;
  for (const n of list.slice(0, 200)) {
    if (!n || typeof n !== "object") continue;
    const yt = String(n.yt || "");
    if (!YT_ID.test(yt) || seen[yt]) continue;
    const moment = clean(n.moment, 40);
    if (moment && scenes[moment]) continue;
    seen[yt] = true;
    if (moment) scenes[moment] = true;
    out.push({ yt, titel: clean(n.titel, 200), artiest: clean(n.artiest, 200), moment, eigen: n.eigen === true });
    if (out.length >= MAX_SONGS) break;
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

/** Titel en kanaal van een video via YouTube's oEmbed: geen sleutel nodig, geen download. */
async function lookup(doFetch, yt) {
  const url = "https://www.youtube.com/oembed?url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + yt) + "&format=json";
  const r = await doFetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) return null;
  const j = await r.json();
  const parts = splitTitle(j && j.title, j && j.author_name);
  return { yt, titel: parts.titel, artiest: parts.artiest, kanaal: clean(j && j.author_name, 200) };
}

async function handle(req, res, db, fetchFn, opts) {
  const doFetch = fetchFn || fetch;
  if (!db) return send(res, 503, { error: "geen_opslag", melding: "Er is nog geen opslag gekoppeld (KV_REST_API_URL / KV_REST_API_TOKEN)." });

  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") return send(res, 405, { error: "methode" });

  const body = method === "POST" ? parseBody(req) : {};
  if (body === null) return send(res, 400, { error: "ongeldige_json" });

  const t = tokenOf(req, body);
  if (!t) return send(res, 400, { error: "ongeldig_token" });
  const key = "muziek:" + t;

  if (method === "GET") {
    const rec = await db.get(key);
    if (!rec) return send(res, 404, { error: "onbekend" });
    return send(res, 200, {
      naam: rec.naam || "", datum: rec.datum || "",
      aangemaakt: rec.aangemaakt || null,
      ingevuld: rec.ingevuld || null,
      nummers: Array.isArray(rec.nummers) ? rec.nummers : [],
      opmerking: rec.opmerking || ""
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
      nummers: old && Array.isArray(old.nummers) ? old.nummers : [],
      opmerking: old ? old.opmerking || "" : "",
      opzoek: old && old.opzoek ? old.opzoek : 0
    };
    await db.set(key, rec);
    return send(res, 200, { ok: true, t });
  }

  if (actie === "kiezen") {
    const old = await db.get(key);
    if (!old) return send(res, 404, { error: "onbekend" });
    const nummers = cleanSongs(body.nummers);
    const opmerking = clean(body.opmerking, MAX_NOTE);
    if (!nummers.length && !opmerking) return send(res, 400, { error: "leeg", melding: "Kies minstens één nummer, of laat een opmerking achter." });
    const rec = Object.assign({}, old, { nummers, opmerking, ingevuld: new Date().toISOString() });
    await db.set(key, rec);
    await meldingen.klantMelding(db, (opts && opts.mail) || mail.forwardEmail(), meldingen.muziekMelding(rec, !!old.ingevuld));
    return send(res, 200, { ok: true, ingevuld: rec.ingevuld, nummers });
  }

  if (actie === "opzoeken") {
    const old = await db.get(key);
    if (!old) return send(res, 404, { error: "onbekend" });
    const yt = videoId(body.url);
    if (!yt) return send(res, 400, { error: "geen_youtube", melding: "Dat lijkt geen YouTube-link. Plak een link zoals https://www.youtube.com/watch?v=… of https://youtu.be/…" });
    const calls = (old.opzoek || 0) + 1;
    if (calls > MAX_LOOKUPS) return send(res, 429, { error: "limiet", melding: "Je hebt al heel veel links opgezocht; stuur de rest even via WhatsApp." });
    await db.set(key, Object.assign({}, old, { opzoek: calls }));
    let info;
    try { info = await lookup(doFetch, yt); }
    catch (e) { return send(res, 502, { error: "youtube", melding: "YouTube was even niet bereikbaar. Probeer het zo nog eens." }); }
    if (!info) return send(res, 404, { error: "video_onbekend", melding: "Deze video kan ik niet vinden. Controleer de link; misschien is de video privé of verwijderd." });
    return send(res, 200, Object.assign({ ok: true }, info));
  }

  if (actie === "verwijderen") {
    await db.del(key);
    return send(res, 200, { ok: true });
  }

  return send(res, 400, { error: "onbekende_actie" });
}

module.exports = async function (req, res) {
  try {
    await handle(req, res, opslag.store(), null);
  } catch (e) {
    send(res, 502, { error: "opslag", melding: String(e && e.message || e) });
  }
};
module.exports.handle = handle;
module.exports.memoryStore = opslag.memoryStore;
module.exports.videoId = videoId;
module.exports.splitTitle = splitTitle;
module.exports.cleanSongs = cleanSongs;
module.exports.MAX_LOOKUPS = MAX_LOOKUPS;
module.exports.MAX_SONGS = MAX_SONGS;
