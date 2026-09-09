// Vercel-middleware: de planning zit achter een wachtwoord, de formulierlinks
// (?f=token) niet. Draait vóór het serveren van de statische pagina.
//
// Zelfde cookie-controle als api/_sessie.js, maar met Web Crypto omdat
// middleware in de edge-runtime draait. Geen WEEKZICHT_WACHTWOORD → open.

export const config = { matcher: ["/", "/index.html"] };

const COOKIE = "wz_sessie";

async function hmacHex(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode("weekzicht-sessie:" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sessieGeldig(cookieHeader, secret) {
  if (!secret) return true;
  const m = new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)").exec(cookieHeader || "");
  if (!m) return false;
  const value = decodeURIComponent(m[1]);
  const i = value.indexOf(".");
  if (i < 0) return false;
  const exp = value.slice(0, i), mac = value.slice(i + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const want = await hmacHex(secret, exp);
  if (want.length !== mac.length) return false;
  let diff = 0;
  for (let k = 0; k < want.length; k++) diff |= want.charCodeAt(k) ^ mac.charCodeAt(k);
  return diff === 0;
}

export default async function middleware(request) {
  const url = new URL(request.url);
  // de klant met een formulierlink mag altijd door
  if (/^[a-z0-9]{12,40}$/.test(url.searchParams.get("f") || "")) return;
  const secret = process.env.WEEKZICHT_WACHTWOORD || "";
  if (await sessieGeldig(request.headers.get("cookie"), secret)) return;
  return Response.redirect(new URL("/inloggen.html", request.url), 302);
}
