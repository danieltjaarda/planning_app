// Toegang tot de planning: wachtwoord, cookie, middleware en de beveiligde
// API-acties. ESM omdat middleware.js een ES-module is.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sessie = require("../api/_sessie.js");
const inloggen = require("../api/inloggen.js");
const formulier = require("../api/formulier.js");
const draaiboek = require("../api/draaiboek.js");
const muziek = require("../api/muziek.js");
const bestanden = require("../api/_bestanden.js");
const middleware = (await import("../middleware.js")).default;
const { sessieGeldig, previewHtml, isCrawler } = await import("../middleware.js");

let pass = 0, fail = 0;
function eq(n, g, w) {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log("FAIL", n, "\n  kreeg   ", a, "\n  verwacht", b); }
}
function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: "", setHeader(k, v) { r.headers[k.toLowerCase()] = v; }, end(s) { r.body = s || ""; } };
  return r;
}
const T = "toegangstest00000001";

// ---- lokaal zonder wachtwoord: alles open ----
delete process.env.WEEKZICHT_WACHTWOORD;
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
eq("open zonder wachtwoord", sessie.ingelogd({ headers: {} }), true);
eq("middleware laat door zonder wachtwoord", await middleware(new Request("https://x.test/")), undefined);
{
  const r = fakeRes();
  await inloggen.handle({ method: "POST", body: "wachtwoord=x" }, r);
  eq("inloggen zonder wachtwoord → gewoon door", [r.statusCode, r.headers.location], [303, "/"]);
}

// ---- met wachtwoord ----
process.env.WEEKZICHT_WACHTWOORD = "geheim-123";
eq("niet ingelogd zonder cookie", sessie.ingelogd({ headers: {} }), false);
eq("verkeerd wachtwoord", sessie.wachtwoordKlopt("geheim-124"), false);
eq("goed wachtwoord", sessie.wachtwoordKlopt("geheim-123"), true);

// het vaste wachtwoord staat als scrypt-hash in de code; de tekst zelf nergens
eq("hash heeft vorm scrypt$N$zout$hash", /^scrypt\$16384\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(sessie.WACHTWOORD_HASH), true);
const th = sessie.maakHash("test-456");
eq("hash: goed wachtwoord", sessie.hashKlopt("test-456", th), true);
eq("hash: fout wachtwoord", sessie.hashKlopt("test-457", th), false);
eq("hash: kapotte hash", [sessie.hashKlopt("test-456", "onzin"), sessie.hashKlopt("test-456", "scrypt$16384$zz$zz"), sessie.hashKlopt("test-456", "")], [false, false, false]);
eq("hash: zelfde zout, zelfde hash", sessie.maakHash("test-456", Buffer.from(th.split("$")[2], "hex")), th);
eq("vast wachtwoord: niet het testwachtwoord", sessie.wachtwoordKlopt("test-456"), false);

// de cookie is ondertekend met de Redis-token + het omgevingswachtwoord, niet met de hash
const S = sessie.sleutel();
eq("sleutel bevat het omgevingswachtwoord", /\|geheim-123$/.test(S), true);
const cookie = sessie.maakSessie();
eq("cookie heeft vorm exp.hmac", /^\d+\.[0-9a-f]{64}$/.test(cookie), true);
eq("cookie geldig (node)", sessie.controleer(cookie, S), true);
eq("cookie ongeldig met ander wachtwoord", sessie.controleer(cookie, "anders"), false);
eq("cookie geknoeid", sessie.controleer(cookie.slice(0, -1) + (cookie.endsWith("0") ? "1" : "0"), S), false);
const verlopen = (Date.now() - 1000) + "." + sessie.sign(Date.now() - 1000, S);
eq("verlopen cookie", sessie.controleer(verlopen, S), false);
eq("ingelogd met cookie", sessie.ingelogd({ headers: { cookie: "a=b; wz_sessie=" + cookie + "; c=d" } }), true);

// middleware (Web Crypto) rekent dezelfde handtekening uit als node
eq("middleware: zelfde hmac", await sessieGeldig("wz_sessie=" + cookie, S), true);
eq("middleware: fout wachtwoord", await sessieGeldig("wz_sessie=" + cookie, "anders"), false);
eq("middleware: geen cookie", await sessieGeldig("", S), false);
{
  const r = await middleware(new Request("https://x.test/"));
  eq("middleware: zonder cookie → inloggen", [r.status, r.headers.get("location")], [302, "https://x.test/inloggen.html"]);
  const r2 = await middleware(new Request("https://x.test/?f=abcdefghijklmnopqrstuv"));
  eq("middleware: formulierlink altijd door", r2, undefined);
  const r3 = await middleware(new Request("https://x.test/?f=kort"));
  eq("middleware: ongeldig token telt niet", r3 && r3.status, 302);
  const r4 = await middleware(new Request("https://x.test/index.html", { headers: { cookie: "wz_sessie=" + cookie } }));
  eq("middleware: met cookie door", r4, undefined);
  const r5 = await middleware(new Request("https://x.test/?m=abcdefghijklmnopqrstuv"));
  eq("middleware: muzieklink altijd door", r5, undefined);
  const r6 = await middleware(new Request("https://x.test/?m=kort"));
  eq("middleware: ongeldig muziektoken telt niet", r6 && r6.status, 302);
  const r7 = await middleware(new Request("https://x.test/?o=abcdefghijklmnopqrstuv"));
  eq("middleware: offertelink altijd door", r7, undefined);
  const r8 = await middleware(new Request("https://x.test/?o=KORT"));
  eq("middleware: ongeldig offertetoken telt niet", r8 && r8.status, 302);
}

// op Vercel altijd beveiligd, ook zonder WEEKZICHT_WACHTWOORD; dan telt alleen het vaste wachtwoord
{
  delete process.env.WEEKZICHT_WACHTWOORD;
  process.env.VERCEL = "1";
  eq("vercel: beveiligd zonder omgevingswachtwoord", [sessie.beveiligd(), sessie.sleutel()], [true, "|"]);
  eq("vercel: niet ingelogd zonder cookie", sessie.ingelogd({ headers: {} }), false);
  eq("vercel: omgevingswachtwoord telt niet", sessie.wachtwoordKlopt("geheim-123"), false);
  const c = sessie.maakSessie();
  eq("vercel: ingelogd met cookie", sessie.ingelogd({ headers: { cookie: "wz_sessie=" + c } }), true);
  eq("vercel: cookie van ervoor telt niet (andere sleutel)", sessie.ingelogd({ headers: { cookie: "wz_sessie=" + cookie } }), false);
  const r = await middleware(new Request("https://x.test/"));
  eq("vercel: middleware zonder cookie → inloggen", r && r.status, 302);
  const r2 = await middleware(new Request("https://x.test/", { headers: { cookie: "wz_sessie=" + c } }));
  eq("vercel: middleware met cookie door", r2, undefined);
  const r3 = fakeRes();
  await inloggen.handle({ method: "POST", body: "wachtwoord=geheim-123" }, r3);
  eq("vercel: inloggen met omgevingswachtwoord → fout", r3.headers.location, "/inloggen.html?fout=1");
  delete process.env.VERCEL;
  process.env.WEEKZICHT_WACHTWOORD = "geheim-123";
}

// inloggen: goed en fout
{
  const r = fakeRes();
  await inloggen.handle({ method: "POST", body: "wachtwoord=geheim-123" }, r);
  eq("inloggen goed → cookie + /", [r.statusCode, r.headers.location, /^wz_sessie=\d+\.[0-9a-f]{64}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/.test(r.headers["set-cookie"])], [303, "/", true]);
  const r2 = fakeRes();
  await inloggen.handle({ method: "POST", body: { wachtwoord: "fout" } }, r2);
  eq("inloggen fout → terug met melding", [r2.statusCode, r2.headers.location, r2.headers["set-cookie"]], [303, "/inloggen.html?fout=1", undefined]);
  const r3 = fakeRes();
  await inloggen.handle({ method: "GET", query: { uit: "1" } }, r3);
  eq("uitloggen wist cookie", [r3.headers.location, r3.headers["set-cookie"]], ["/inloggen.html", "wz_sessie=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"]);
}

// beveiligde API-acties
const db = formulier.memoryStore();
const files = bestanden.memoryFiles();
async function fcall(req) { const r = fakeRes(); await formulier.handle(req, r, db, files); return { status: r.statusCode, data: r.body ? JSON.parse(r.body) : null }; }
eq("aanmaken zonder cookie → 401", (await fcall({ method: "POST", headers: {}, body: { t: T, actie: "aanmaken", naam: "X" } })).status, 401);
eq("aanmaken met cookie", (await fcall({ method: "POST", headers: { cookie: "wz_sessie=" + cookie }, body: { t: T, actie: "aanmaken", naam: "X" } })).status, 200);
eq("klant mag ophalen zonder cookie", (await fcall({ method: "GET", headers: {}, query: { t: T } })).status, 200);
eq("klant mag invullen zonder cookie", (await fcall({ method: "POST", headers: {}, body: { t: T, actie: "invullen", antwoorden: { namen: "X" } } })).status, 200);
eq("verwijderen zonder cookie → 401", (await fcall({ method: "POST", headers: {}, body: { t: T, actie: "verwijderen" } })).status, 401);

// bestanden bekijken alleen ingelogd; uploaden mag de klant
{
  const up = fakeRes();
  await draaiboek.handle({ method: "POST", headers: {}, body: { t: T, mime: "image/png", naam: "d.png", data: Buffer.from("x").toString("base64") } }, up, db, "", null, files);
  eq("klant mag uploaden zonder cookie", up.statusCode, 200);
  const g = fakeRes();
  await draaiboek.handle({ method: "GET", headers: {}, query: { t: T, i: "0" } }, g, db, "", null, files);
  eq("bestand bekijken zonder cookie → 401", g.statusCode, 401);
  const g2 = fakeRes();
  await draaiboek.handle({ method: "GET", headers: { cookie: "wz_sessie=" + cookie }, query: { t: T, i: "0" } }, g2, db, "", null, files);
  eq("bestand bekijken met cookie", g2.statusCode, 200);
}
eq("verwijderen met cookie", (await fcall({ method: "POST", headers: { cookie: "wz_sessie=" + cookie }, body: { t: T, actie: "verwijderen" } })).status, 200);

// muziek: links maken en verwijderen alleen ingelogd; kiezen en opzoeken mag de klant
const ytFake = async () => ({ ok: true, status: 200, json: async () => ({ title: "A - B", author_name: "C" }) });
async function mcall(req) { const r = fakeRes(); await muziek.handle(req, r, db, ytFake); return { status: r.statusCode, data: r.body ? JSON.parse(r.body) : null }; }
eq("muziek: aanmaken zonder cookie → 401", (await mcall({ method: "POST", headers: {}, body: { t: T, actie: "aanmaken", naam: "X" } })).status, 401);
eq("muziek: aanmaken met cookie", (await mcall({ method: "POST", headers: { cookie: "wz_sessie=" + cookie }, body: { t: T, actie: "aanmaken", naam: "X" } })).status, 200);
eq("muziek: klant mag ophalen zonder cookie", (await mcall({ method: "GET", headers: {}, query: { t: T } })).status, 200);
eq("muziek: klant mag opzoeken zonder cookie", (await mcall({ method: "POST", headers: {}, body: { t: T, actie: "opzoeken", url: "https://youtu.be/2Vv-BfVoq4g" } })).status, 200);
eq("muziek: klant mag kiezen zonder cookie", (await mcall({ method: "POST", headers: {}, body: { t: T, actie: "kiezen", nummers: [{ yt: "2Vv-BfVoq4g" }] } })).status, 200);
eq("muziek: verwijderen zonder cookie → 401", (await mcall({ method: "POST", headers: {}, body: { t: T, actie: "verwijderen" } })).status, 401);
eq("muziek: verwijderen met cookie", (await mcall({ method: "POST", headers: { cookie: "wz_sessie=" + cookie }, body: { t: T, actie: "verwijderen" } })).status, 200);

// voorvertoning voor WhatsApp e.d.
eq("crawler herkend", [isCrawler("WhatsApp/2.23.20.0 A"), isCrawler("facebookexternalhit/1.1"), isCrawler("Mozilla/5.0 (iPhone) Safari")], [true, true, false]);
{
  const r = await middleware(new Request("https://x.test/?f=abcdefghijklmnopqrstuv", { headers: { "user-agent": "WhatsApp/2.23.20.0 A" } }));
  const html = await r.text();
  eq("crawler krijgt voorvertoning zonder wachtwoord/cookie", [r.status, r.headers.get("content-type")], [200, "text/html; charset=utf-8"]);
  eq("voorvertoning: og-tags", [/og:title" content="Vertel me over jullie trouwdag"/.test(html), /og:image" content="https:\/\/planning-app-three\.vercel\.app\/og-formulier\.png"/.test(html), /og:url" content="https:\/\/x\.test\/\?f=abcdefghijklmnopqrstuv"/.test(html)], [true, true, true]);
  eq("voorvertoning: geen formulier-inhoud", /fpForm|ms-nav/.test(html), false);
  const r2 = await middleware(new Request("https://x.test/?f=abcdefghijklmnopqrstuv", { headers: { "user-agent": "Mozilla/5.0 Safari" } }));
  eq("gewone bezoeker met link gaat gewoon door", r2, undefined);
  const r3 = await middleware(new Request("https://x.test/", { headers: { "user-agent": "WhatsApp/2.23" } }));
  eq("crawler zonder link → inloggen, geen voorvertoning", r3 && r3.status, 302);
  const r4 = await middleware(new Request("https://x.test/?m=abcdefghijklmnopqrstuv", { headers: { "user-agent": "WhatsApp/2.23.20.0 A" } }));
  const html4 = await r4.text();
  eq("voorvertoning muzieklink", [r4.status, /og:title" content="Kies de muziek voor jullie trouwfilm"/.test(html4), /og:image" content="https:\/\/planning-app-three\.vercel\.app\/og-muziek\.png"/.test(html4), /og:url" content="https:\/\/x\.test\/\?m=abcdefghijklmnopqrstuv"/.test(html4), /Open de muziekpagina/.test(html4)], [200, true, true, true, true]);
}
eq("voorvertoning op naam", /og:title" content="Sanne &amp; Thomas, vertel me over jullie trouwdag"/.test(previewHtml("Sanne & Thomas", "https://x.test/?f=a")), true);
eq("voorvertoning muziek op naam", /og:title" content="Sanne &amp; Thomas, kies de muziek voor jullie film"/.test(previewHtml("Sanne & Thomas", "https://x.test/?m=a", "muziek")), true);
{
  const r = await middleware(new Request("https://x.test/?o=abcdefghijklmnopqrstuv", { headers: { "user-agent": "WhatsApp/2.23.20.0 A" } }));
  const html = await r.text();
  eq("voorvertoning offertelink", [r.status, /og:title" content="Jullie offerte voor de trouwfilm"/.test(html), /og:image" content="https:\/\/planning-app-three\.vercel\.app\/og-offerte\.png"/.test(html), /og:url" content="https:\/\/x\.test\/\?o=abcdefghijklmnopqrstuv"/.test(html), /Open de offerte/.test(html)], [200, true, true, true, true]);
}
eq("voorvertoning offerte op naam", /og:title" content="Sanne &amp; Thomas, jullie offerte voor de trouwfilm"/.test(previewHtml("Sanne & Thomas", "https://x.test/?o=a", "offerte")), true);
eq("voorvertoning: html-veilig", /<script>/.test(previewHtml("<script>alert(1)</script>", "https://x.test/?f=a")), false);

console.log("\n" + pass + " geslaagd, " + fail + " gefaald");
process.exit(fail ? 1 : 0);
