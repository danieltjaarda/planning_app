// Vercel-middleware: de planning zit achter een wachtwoord, de formulier-,
// muziek- en offertelinks (?f=token, ?m=token, ?o=token) niet. Draait vóór het serveren van de statische pagina.
//
// Zelfde cookie-controle als api/_sessie.js, maar met Web Crypto omdat
// middleware in de edge-runtime draait. Geen WEEKZICHT_WACHTWOORD → open.

export const config = { matcher: ["/", "/index.html"] };

const COOKIE = "wz_sessie";
const TOKEN_RE = /^[a-z0-9]{12,40}$/;
const CRAWLER = /WhatsApp|facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|TelegramBot|Discordbot|Applebot|iMessage|Pinterest|Googlebot|bingbot|SkypeUriPreview|Snapchat/i;
const SITE = "https://planning-app-three.vercel.app";

function escHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Naam van het bruidspaar bij een token, uit dezelfde Redis als api/formulier, api/muziek en api/offerte. */
export async function lookupName(token, prefix) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const key = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !key) return "";
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify(["GET", (prefix || "formulier:") + token])
    });
    const j = await r.json();
    const rec = j && j.result ? JSON.parse(j.result) : null;
    return rec && rec.naam ? String(rec.naam).slice(0, 80) : "";
  } catch (e) { return ""; }
}

/** De kleine pagina die WhatsApp, iMessage e.d. te zien krijgen: alleen de kaart. */
const PREVIEW = {
  formulier: {
    title: (naam) => naam ? naam + ", vertel me over jullie trouwdag" : "Vertel me over jullie trouwdag",
    desc: "Vul het formulier in, dan weet ik precies wat ik op jullie dag moet vastleggen. Duurt een paar minuten.",
    img: "/og-formulier.png", link: "Open het formulier"
  },
  muziek: {
    title: (naam) => naam ? naam + ", kies de muziek voor jullie film" : "Kies de muziek voor jullie trouwfilm",
    desc: "Zes scènes, zes nummers: luister per scène onze suggesties of plak een eigen YouTube-link.",
    img: "/og-muziek.png", link: "Open de muziekpagina"
  },
  offerte: {
    title: (naam) => naam ? naam + ", jullie offerte voor de trouwfilm" : "Jullie offerte voor de trouwfilm",
    desc: "Lees de offerte rustig door en geef akkoord met je naam en handtekening.",
    img: "/og-offerte.png", link: "Open de offerte"
  }
};
const PARAM = { formulier: "f", muziek: "m", offerte: "o" };

export function previewHtml(naam, pageUrl, soort) {
  const p = PREVIEW[soort] || PREVIEW.formulier;
  const title = p.title(naam), desc = p.desc, img = SITE + p.img;
  const t = escHtml(title), d = escHtml(desc), u = escHtml(pageUrl);
  return "<!doctype html><html lang=\"nl\"><head><meta charset=\"utf-8\">" +
    "<title>" + t + " | Mediaspot</title>" +
    "<meta name=\"description\" content=\"" + d + "\">" +
    "<meta name=\"robots\" content=\"noindex, nofollow\">" +
    "<meta property=\"og:type\" content=\"website\">" +
    "<meta property=\"og:site_name\" content=\"Mediaspot\">" +
    "<meta property=\"og:title\" content=\"" + t + "\">" +
    "<meta property=\"og:description\" content=\"" + d + "\">" +
    "<meta property=\"og:url\" content=\"" + u + "\">" +
    "<meta property=\"og:image\" content=\"" + img + "\">" +
    "<meta property=\"og:image:width\" content=\"1200\"><meta property=\"og:image:height\" content=\"630\">" +
    "<meta property=\"og:locale\" content=\"nl_NL\">" +
    "<meta name=\"twitter:card\" content=\"summary_large_image\">" +
    "<meta name=\"twitter:title\" content=\"" + t + "\">" +
    "<meta name=\"twitter:description\" content=\"" + d + "\">" +
    "<meta name=\"twitter:image\" content=\"" + img + "\">" +
    "</head><body><p>" + t + ". <a href=\"" + u + "\">" + p.link + "</a>.</p></body></html>";
}

/** "formulier", "muziek" of "offerte" als de url een geldige klantlink is, anders null. */
export function linkSoort(params) {
  for (const soort of Object.keys(PARAM)) {
    if (TOKEN_RE.test(params.get(PARAM[soort]) || "")) return soort;
  }
  return null;
}

export function isCrawler(userAgent) {
  return CRAWLER.test(userAgent || "");
}

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
  // de klant met een formulier-, muziek- of offertelink mag altijd door
  const soort = linkSoort(url.searchParams);
  if (soort) {
    const param = PARAM[soort], token = url.searchParams.get(param);
    // WhatsApp e.d. halen de link op voor een voorvertoning: geef ze een
    // kleine pagina met titel, tekst en afbeelding, op naam van het bruidspaar.
    if (isCrawler(request.headers.get("user-agent"))) {
      const naam = await lookupName(token, soort + ":");
      return new Response(previewHtml(naam, url.origin + "/?" + param + "=" + token, soort), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex, nofollow" }
      });
    }
    return;
  }
  const secret = process.env.WEEKZICHT_WACHTWOORD || "";
  if (await sessieGeldig(request.headers.get("cookie"), secret)) return;
  return Response.redirect(new URL("/inloggen.html", request.url), 302);
}
