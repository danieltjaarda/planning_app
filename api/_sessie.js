// Toegang tot de planning: een wachtwoord (WEEKZICHT_WACHTWOORD) en een
// ondertekende cookie. De cookie is "<vervaldatum>.<hmac>", ondertekend met
// een sleutel die uit het wachtwoord is afgeleid: verander het wachtwoord en
// alle sessies vervallen vanzelf.
//
// Zonder wachtwoord in de omgeving staat alles open (lokaal, artifact).
// middleware.js doet dezelfde controle met Web Crypto; houd de twee gelijk.

const crypto = require("node:crypto");

const COOKIE = "wz_sessie";
const DAGEN = 30;

function wachtwoord() { return process.env.WEEKZICHT_WACHTWOORD || ""; }
function beveiligd() { return !!wachtwoord(); }

function sign(exp, secret) {
  return crypto.createHmac("sha256", "weekzicht-sessie:" + secret).update(String(exp)).digest("hex");
}

/** Maakt een cookiewaarde die `dagen` dagen geldig is. */
function maakSessie(secret, dagen) {
  const exp = Date.now() + (dagen || DAGEN) * 86400000;
  return exp + "." + sign(exp, secret);
}

function controleer(value, secret) {
  if (!value || !secret) return false;
  const i = value.indexOf(".");
  if (i < 0) return false;
  const exp = value.slice(0, i), mac = value.slice(i + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const want = sign(exp, secret);
  if (want.length !== mac.length) return false;
  return crypto.timingSafeEqual(Buffer.from(want, "hex"), Buffer.from(mac, "hex"));
}

function cookieVan(req) {
  const raw = (req.headers && (req.headers.cookie || req.headers.Cookie)) || "";
  const m = new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)").exec(raw);
  return m ? decodeURIComponent(m[1]) : "";
}

/** Ingelogd, of er is geen wachtwoord ingesteld. */
function ingelogd(req) {
  if (!beveiligd()) return true;
  return controleer(cookieVan(req), wachtwoord());
}

function wachtwoordKlopt(poging) {
  const w = wachtwoord();
  if (!w || typeof poging !== "string") return false;
  const a = Buffer.from(poging), b = Buffer.from(w);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function setCookie(value, maxAge) {
  return COOKIE + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge;
}

module.exports = { COOKIE, DAGEN, beveiligd, maakSessie, controleer, cookieVan, ingelogd, wachtwoordKlopt, setCookie, sign };
