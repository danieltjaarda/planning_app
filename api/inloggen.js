// Inloggen op de planning.
//
//   POST /api/inloggen  (formulier: wachtwoord=…)  → cookie + door naar /
//   GET  /api/inloggen?uit=1                        → cookie weg, door naar /
//
// Het wachtwoord staat in WEEKZICHT_WACHTWOORD. Is dat leeg, dan is er niets
// te beveiligen en sturen we gewoon door.

const sessie = require("./_sessie.js");

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

async function handle(req, res) {
  const method = (req.method || "GET").toUpperCase();
  const q = req.query || {};

  if (method === "GET") {
    if (q.uit) return redirect(res, "/inloggen.html", sessie.setCookie("", 0));
    return redirect(res, "/");
  }
  if (method !== "POST") { res.statusCode = 405; return res.end(); }

  if (!sessie.beveiligd()) return redirect(res, "/");
  const body = parseBody(req);
  const poging = String(body.wachtwoord || "");
  // even wachten bij een fout: gokken wordt traag
  if (!sessie.wachtwoordKlopt(poging)) {
    await new Promise((r) => setTimeout(r, 600));
    return redirect(res, "/inloggen.html?fout=1");
  }
  const value = sessie.maakSessie(process.env.WEEKZICHT_WACHTWOORD);
  return redirect(res, "/", sessie.setCookie(value, sessie.DAGEN * 86400));
}

module.exports = async function (req, res) {
  try { await handle(req, res); }
  catch (e) { res.statusCode = 500; res.end("fout"); }
};
module.exports.handle = handle;
