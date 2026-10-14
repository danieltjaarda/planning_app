// Toegang tot de planning: een wachtwoord en een ondertekende cookie.
//
// Het wachtwoord staat als scrypt-hash in WACHTWOORD_HASH hieronder, niet in
// Vercel. De repo is openbaar, dus nooit de tekst zelf: een nieuw wachtwoord
// maak je met `node api/_sessie.js 'nieuw wachtwoord'` en plak je hier.
// Daarnaast telt WEEKZICHT_WACHTWOORD uit de omgeving, als die gezet is.
//
// Op Vercel staat de planning altijd achter het wachtwoord. Lokaal (node
// dev.mjs, tests) is alles open, tenzij WEEKZICHT_WACHTWOORD in .env staat.
//
// De cookie is "<vervaldatum>.<hmac>", ondertekend met een sleutel die niet in
// de code mag staan (anders kan iedereen een sessie maken): de Redis-token
// plus WEEKZICHT_WACHTWOORD. Verander een van beide en alle sessies vervallen.
// middleware.js doet dezelfde controle met Web Crypto; houd de twee gelijk.

const crypto = require("node:crypto");

const COOKIE = "wz_sessie";
const DAGEN = 30;
const WACHTWOORD_HASH = "scrypt$16384$2c6788c13592a990ad8435ffc7b3498b$2652aa17ac739f7461fbff79c61263da2fec4784a8a4ddab68d6ce3f2d474ae7";

function envWachtwoord() { return process.env.WEEKZICHT_WACHTWOORD || ""; }
/** Op Vercel altijd; lokaal alleen met WEEKZICHT_WACHTWOORD. */
function beveiligd() { return !!(process.env.VERCEL || process.env.VERCEL_ENV || envWachtwoord()); }
/** Sleutel voor de cookie-handtekening; zelfde formule in middleware.js. */
function sleutel() {
  return (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "") + "|" + envWachtwoord();
}

/** "scrypt$N$zout$hash" voor een wachtwoord; `zout` alleen voor de tests. */
function maakHash(wachtwoord, zout) {
  const N = 16384, s = zout || crypto.randomBytes(16);
  const h = crypto.scryptSync(String(wachtwoord), s, 32, { N, r: 8, p: 1 });
  return "scrypt$" + N + "$" + s.toString("hex") + "$" + h.toString("hex");
}

function hashKlopt(poging, hash) {
  try {
    const [soort, n, zout, h] = String(hash || "").split("$");
    if (soort !== "scrypt" || !zout || !h) return false;
    const want = Buffer.from(h, "hex");
    const got = crypto.scryptSync(String(poging), Buffer.from(zout, "hex"), want.length, { N: Number(n), r: 8, p: 1 });
    return want.length > 0 && crypto.timingSafeEqual(got, want);
  } catch (e) { return false; }
}

function sign(exp, secret) {
  return crypto.createHmac("sha256", "weekzicht-sessie:" + secret).update(String(exp)).digest("hex");
}

/** Maakt een cookiewaarde die `dagen` dagen geldig is; zonder `secret` met de sleutel van nu. */
function maakSessie(secret, dagen) {
  const exp = Date.now() + (dagen || DAGEN) * 86400000;
  return exp + "." + sign(exp, secret == null ? sleutel() : secret);
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

/** Ingelogd, of er is geen wachtwoord actief (lokaal). */
function ingelogd(req) {
  if (!beveiligd()) return true;
  return controleer(cookieVan(req), sleutel());
}

/** Het vaste wachtwoord uit de code, of dat uit WEEKZICHT_WACHTWOORD. */
function wachtwoordKlopt(poging) {
  if (!beveiligd() || typeof poging !== "string") return false;
  const vast = hashKlopt(poging, WACHTWOORD_HASH);
  const w = envWachtwoord();
  const a = Buffer.from(poging), b = Buffer.from(w);
  const env = !!w && a.length === b.length && crypto.timingSafeEqual(a, b);
  return vast || env;
}

function setCookie(value, maxAge) {
  return COOKIE + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge;
}

module.exports = { COOKIE, DAGEN, WACHTWOORD_HASH, beveiligd, sleutel, maakHash, hashKlopt, maakSessie, controleer, cookieVan, ingelogd, wachtwoordKlopt, setCookie, sign };

// `node api/_sessie.js 'wachtwoord'` → de hash voor in WACHTWOORD_HASH
if (require.main === module) {
  const w = process.argv[2];
  if (!w) { console.error("gebruik: node api/_sessie.js 'nieuw wachtwoord'"); process.exit(1); }
  console.log(maakHash(w));
}
