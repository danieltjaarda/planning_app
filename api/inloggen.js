// Inloggen op de planning.
//
//   POST /api/inloggen  (formulier: wachtwoord=…)  → cookie + door naar /
//   GET  /api/inloggen?uit=1                        → cookie weg, door naar /
//
// Het wachtwoord staat als hash in _sessie.js (en eventueel in
// WEEKZICHT_WACHTWOORD). Is er lokaal geen wachtwoord actief, dan sturen we
// gewoon door.
//
// De inlogpagina is een cijferpad (code van 4 cijfers) en stuurt JSON
// (Accept: application/json) → { ok } of { ok: false, fout, over, wacht }.
// Een gewoon formulier krijgt nog steeds een redirect.
//
// Een code van 4 cijfers is in 10.000 pogingen te raden, dus er zit een
// blokkade op (tellers in Redis):
//   - per adres:  5 foute pogingen → 15 minuten op slot
//   - in totaal: 20 foute pogingen → 24 uur op slot, voor iedereen
// Wie al ingelogd is (cookie, 30 dagen) merkt daar niets van. Gaat de
// totale blokkade af terwijl jij buitengesloten bent: wis `inloggen:alles`
// in de Redis-store (Vercel → Storage), of wacht een dag.

const sessie = require("./_sessie.js");
const opslag = require("./_opslag.js");

const IP_MAX = 5, IP_SEC = 15 * 60;
const ALLES_MAX = 20, ALLES_SEC = 24 * 60 * 60;
const ALLES = "inloggen:alles";

function ipVan(req) {
  const h = req.headers || {};
  const xf = String(h["x-forwarded-for"] || "").split(",")[0].trim();
  return (xf || String(h["x-real-ip"] || "") || (req.socket && req.socket.remoteAddress) || "onbekend").slice(0, 64);
}

function wilJson(req) {
  const h = req.headers || {};
  return /application\/json/.test(String(h.accept || ""));
}

function json(res, status, obj, cookie) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (cookie) res.setHeader("Set-Cookie", cookie);
  res.end(JSON.stringify(obj));
}

/** Hoeveel seconden nog op slot, of 0. */
async function opSlot(db, ipKey) {
  const [ip, alles] = await Promise.all([db.get(ipKey), db.get(ALLES)]);
  if (Number(alles) >= ALLES_MAX) return Math.max(60, await db.ttl(ALLES));
  if (Number(ip) >= IP_MAX) return Math.max(1, await db.ttl(ipKey));
  return 0;
}

/** Telt een foute poging; geeft het aantal pogingen dat dit adres nog heeft. */
async function telFout(db, ipKey) {
  const [ip, alles] = await Promise.all([db.incr(ipKey), db.incr(ALLES)]);
  const zet = [];
  if (ip === 1) zet.push(db.expire(ipKey, IP_SEC));
  if (alles === 1) zet.push(db.expire(ALLES, ALLES_SEC));
  await Promise.all(zet);
  return Math.max(0, Math.min(IP_MAX - ip, ALLES_MAX - alles));
}

function parseBody(req) {
  const b = req.body;
  if (b == null || b === "") return {};
  if (typeof b === "object") return b;
  const s = String(b);
  try { return JSON.parse(s); } catch (e) { /* geen json: formulier */ }
  const out = {};
  for (const part of s.split("&")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[decodeURIComponent(part.slice(0, i).replace(/\+/g, " "))] = decodeURIComponent(part.slice(i + 1).replace(/\+/g, " "));
  }
  return out;
}

function redirect(res, to, cookie) {
  res.statusCode = 303;
  res.setHeader("Location", to);
  res.setHeader("Cache-Control", "no-store");
  if (cookie) res.setHeader("Set-Cookie", cookie);
  res.end();
}

async function handle(req, res, db) {
  const method = (req.method || "GET").toUpperCase();
  const q = req.query || {};

  if (method === "GET") {
    if (q.uit) return redirect(res, "/inloggen.html", sessie.setCookie("", 0));
    return redirect(res, "/");
  }
  if (method !== "POST") { res.statusCode = 405; return res.end(); }

  const alsJson = wilJson(req);
  if (!sessie.beveiligd()) return alsJson ? json(res, 200, { ok: true }) : redirect(res, "/");
  const body = parseBody(req);
  const poging = String(body.wachtwoord || "");
  const ipKey = "inloggen:ip:" + ipVan(req);

  // Op slot: niet eens kijken of de code klopt, anders blijft raden mogelijk.
  const wacht = db ? await opSlot(db, ipKey) : 0;
  if (wacht > 0) {
    return alsJson
      ? json(res, 429, { ok: false, fout: "geblokkeerd", wacht })
      : redirect(res, "/inloggen.html?blok=" + Math.ceil(wacht / 60));
  }

  if (!sessie.wachtwoordKlopt(poging)) {
    const over = db ? await telFout(db, ipKey) : null;
    // even wachten bij een fout: gokken wordt traag
    await new Promise((r) => setTimeout(r, 600));
    if (alsJson) {
      if (over === 0) return json(res, 429, { ok: false, fout: "geblokkeerd", wacht: await opSlot(db, ipKey) });
      return json(res, 401, { ok: false, fout: "fout", over });
    }
    return redirect(res, "/inloggen.html?fout=1");
  }

  if (db) await Promise.all([db.del(ipKey), db.del(ALLES)]);
  const cookie = sessie.setCookie(sessie.maakSessie(), sessie.DAGEN * 86400);
  return alsJson ? json(res, 200, { ok: true }, cookie) : redirect(res, "/", cookie);
}

module.exports = async function (req, res) {
  try { await handle(req, res, opslag.store()); }
  catch (e) { res.statusCode = 500; res.end("fout"); }
};
module.exports.handle = handle;
module.exports.IP_MAX = IP_MAX;
module.exports.ALLES_MAX = ALLES_MAX;
