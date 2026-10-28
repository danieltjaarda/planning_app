// Offerte ter ondertekening — één Vercel-functie voor delen, bekijken en tekenen.
//
// De app zet een kopie van de offerte hier neer onder een willekeurig token
// (?o=token). De klant opent die link, leest de offerte en geeft akkoord met
// naam en handtekening; de app haalt dat akkoord daarna op. Na het tekenen
// ligt die versie vast: de planner kan hem pas weer wijzigen na "intrekken".
//
// Elke inhoudelijke wijziging hoogt `versie` op. De klant tekent altijd voor
// de versie die hij op het scherm had; is die intussen aangepast, dan weigert
// de server en ziet de klant eerst de nieuwe versie.
//
//   GET  /api/offerte?t=TOKEN                                   → { naam, offerte, bedrijf, versie, gedeeld, akkoord }
//   POST /api/offerte { t, actie: "delen", naam, offerte, bedrijf }   (alleen ingelogd) → { ok, versie, gedeeld }
//   POST /api/offerte { t, actie: "tekenen", versie, naam, handtekening }   → { ok, akkoord }
//   POST /api/offerte { t, actie: "intrekken" }                 (alleen ingelogd)
//   POST /api/offerte { t, actie: "verwijderen" }               (alleen ingelogd)
//   POST /api/offerte { t, actie: "mailen", aan, onderwerp, tekst, pdf }   (alleen ingelogd) → { ok, aan, op }
//   POST /api/offerte { actie: "factuur", aan, onderwerp, tekst, pdf, factuur, bedrijf }   (alleen ingelogd) → { ok, aan, op }
//        de factuur gaat als pdf mee en wordt nergens bewaard: er is geen link en geen token
//   GET  /api/offerte?mail=1                                    → { mail, van } staat mailen aan, en vanaf welk adres (zie _mail.js)
//
// Staat mailen aan, dan stuurt "tekenen" meteen een melding (met de getekende
// pdf) naar jou, en een bevestiging naar de klant als die een e-mailadres gaf.
//
// handtekening: lijnen als [[x, y, x, y, …], …] in een vlak van PAD_W × PAD_H.

const opslag = require("./_opslag.js");
const sessie = require("./_sessie.js");
const mail = require("./_mail.js");
const meldingen = require("./_meldingen.js");
const offertePdf = require("./_offertepdf.js");
const TOKEN_RE = /^[a-z0-9]{12,40}$/;
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAD_W = 1000, PAD_H = 500;    // zelfde vlak als SIG_W/SIG_H in de app
const MAX_LIJNEN = 120;
const MAX_PUNTEN = 10000;
const MAX_REGELS = 100;
const MAX_OFFERTE = 120 * 1024;     // de offerte als JSON
const BTW = ["incl", "excl", "geen"];
const BEDRIJF_VELDEN = ["naam", "juridisch", "adres", "telefoon", "email", "web", "kvk", "btw", "iban"];
const SITE = "https://planning-app-three.vercel.app";
const MAX_MAILS = 20;               // logboek per offerte

function clean(v, max) {
  return String(v == null ? "" : v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").slice(0, max || 200).trim();
}

function getal(v, min, max) {
  const n = typeof v === "number" ? v : NaN;
  return isFinite(n) && n >= min && n <= max ? n : null;
}

/** Alleen de velden die de offerte toont, allemaal begrensd. */
function cleanOfferte(of) {
  if (!of || typeof of !== "object" || Array.isArray(of)) return null;
  const regels = (Array.isArray(of.regels) ? of.regels : []).slice(0, MAX_REGELS).map((r) => {
    r = r && typeof r === "object" ? r : {};
    const aantal = getal(r.aantal, -1e6, 1e6);
    return { oms: clean(r.oms, 4000), aantal: aantal == null ? 1 : aantal, prijs: getal(r.prijs, -1e8, 1e8) };
  }).filter((r) => r.oms || r.prijs != null);
  if (!regels.length) return null;
  const tarief = getal(of.tarief, 0, 100);
  return {
    nummer: clean(of.nummer, 40),
    datum: DATUM_RE.test(String(of.datum || "")) ? of.datum : "",
    geldig: DATUM_RE.test(String(of.geldig || "")) ? of.geldig : null,
    aan: clean(of.aan, 1000),
    betreft: clean(of.betreft, 300),
    details: clean(of.details, 3000),
    regels,
    btw: BTW.indexOf(of.btw) >= 0 ? of.btw : "incl",
    tarief: tarief == null ? 21 : tarief,
    tekst: clean(of.tekst, 4000)
  };
}

/** Een factuur is een offerte met een verwijzing en een betaaldatum. */
function cleanFactuur(f) {
  const of = cleanOfferte(f);
  if (!of) return null;
  of.offerteNummer = clean(f.offerteNummer, 40);
  const b = clean(f.betaald, 40);
  of.betaald = /^\d{4}-\d{2}-\d{2}/.test(b) ? b : null;
  return of;
}

function cleanBedrijf(b) {
  const out = {};
  b = b && typeof b === "object" ? b : {};
  for (const k of BEDRIJF_VELDEN) out[k] = clean(b[k], k === "adres" ? 500 : 200);
  return out;
}

/** Lijnen van gehele punten binnen het vlak; null als het geen handtekening is. */
function cleanHandtekening(lijnen) {
  if (!Array.isArray(lijnen) || !lijnen.length || lijnen.length > MAX_LIJNEN) return null;
  const out = [];
  let punten = 0, x0 = PAD_W, x1 = 0, y0 = PAD_H, y1 = 0;
  for (const l of lijnen) {
    if (!Array.isArray(l) || l.length < 2 || l.length % 2) return null;
    const lijn = [];
    for (let i = 0; i < l.length; i += 2) {
      const x = l[i], y = l[i + 1];
      if (typeof x !== "number" || typeof y !== "number" || !isFinite(x) || !isFinite(y)) return null;
      const px = Math.max(0, Math.min(PAD_W, Math.round(x))), py = Math.max(0, Math.min(PAD_H, Math.round(y)));
      lijn.push(px, py);
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    punten += lijn.length / 2;
    if (punten > MAX_PUNTEN) return null;
    out.push(lijn);
  }
  // een tik of een streepje is geen handtekening
  if (punten < 8 || Math.max(x1 - x0, y1 - y0) < 60) return null;
  return out;
}

/** De datum van vandaag in Nederland, als JJJJ-MM-DD. */
function vandaag(nu) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(nu);
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

/** Het adres van deze deploy, voor de link en het logo in de mail. */
function basis(req) {
  const h = (req && req.headers) || {};
  const host = String(h["x-forwarded-host"] || h.host || "").split(",")[0].trim();
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return SITE;
  const proto = String(h["x-forwarded-proto"] || "").split(",")[0].trim() || (/^(127\.0\.0\.1|localhost)(:|$)/.test(host) ? "http" : "https");
  return (proto === "http" ? "http" : "https") + "://" + host;
}

/** Eén mail versturen; geeft een regel voor het logboek, gooit nooit. */
async function probeer(verzender, soort, m) {
  const op = new Date().toISOString();
  try {
    await verzender.verstuur(m);
    return { soort, aan: m.aan, op, ok: true };
  } catch (e) {
    return { soort, aan: m.aan, op, ok: false, fout: String((e && e.message) || e).slice(0, 300) };
  }
}

function logboek(old, regels) {
  return (Array.isArray(old) ? old : []).concat(regels).slice(-MAX_MAILS);
}

/** Na het tekenen: melding aan de planner en bevestiging aan de klant, met de getekende pdf. */
async function mailsNaTekenen(verzender, rec, akkoord, link, logo) {
  const L = offertePdf.lib(), of = rec.offerte || {}, b = rec.bedrijf || {};
  const bijlage = { naam: offertePdf.pdfNaam(of, b, true), base64: offertePdf.pdfBase64(of, b, akkoord), type: "application/pdf" };
  const totaal = L.euro(L.offerteTotalen(of).totaal / 100), wanneer = L.tijdVol(akkoord.op), bedrijf = b.naam || "Mediaspot";
  const taken = [];
  const meldingen = verzender.meldingen && verzender.meldingen();
  if (meldingen) {
    const tekst = akkoord.naam + " heeft offerte " + of.nummer + " van " + totaal + " getekend op " + wanneer + "." +
      (of.betreft ? "\n\n" + of.betreft : "") + (akkoord.email ? "\n\nE-mail van de klant: " + akkoord.email : "") +
      "\n\nDe getekende offerte zit als pdf in de bijlage. In Weekzicht gaat de klant op Akkoord zodra de app het akkoord ophaalt." +
      "\n\n" + link;
    taken.push(probeer(verzender, "melding", {
      aan: meldingen, onderwerp: "Getekend: offerte " + of.nummer + (rec.naam ? " (" + rec.naam + ")" : ""), tekst,
      html: mail.mailHtml({ tekst, knop: { tekst: "Bekijk de getekende offerte", url: link }, bedrijf: b, logo }),
      bijlagen: [bijlage], antwoordAan: akkoord.email || ""
    }));
  }
  if (akkoord.email) {
    const tekst = "Hoi " + akkoord.naam + ",\n\nBedankt voor je akkoord op offerte " + of.nummer + " van " + totaal + "." +
      " In de bijlage vind je de getekende offerte. Je kunt hem ook altijd terugzien via deze link:\n\n" + link +
      "\n\nIk neem snel contact met jullie op om alles verder af te stemmen. Vragen? Beantwoord gerust deze mail" +
      (b.telefoon ? " of bel " + b.telefoon : "") + ".\n\nGroet,\n" + bedrijf;
    taken.push(probeer(verzender, "bevestiging", {
      aan: akkoord.email, onderwerp: "Bevestiging: offerte " + of.nummer + " van " + bedrijf, tekst,
      html: mail.mailHtml({ tekst, knop: { tekst: "Bekijk de getekende offerte", url: link }, bedrijf: b, logo }),
      bijlagen: [bijlage]
    }));
  }
  return Promise.all(taken);
}

function publiek(rec) {
  return {
    naam: rec.naam || "",
    offerte: rec.offerte || null,
    bedrijf: rec.bedrijf || null,
    versie: rec.versie || 0,
    gedeeld: rec.gedeeld || null,
    akkoord: rec.akkoord || null
  };
}

async function handle(req, res, db, opts) {
  const nu = (opts && opts.nu) || (() => new Date());
  const verzender = (opts && opts.mail) || mail.forwardEmail();
  const method = (req.method || "GET").toUpperCase();
  // staat mailen aan? (de app kiest dan tussen versturen en je mailprogramma)
  if (method === "GET" && req.query && req.query.mail != null && !req.query.t) {
    return send(res, 200, { mail: verzender.aan(), van: verzender.aan() && verzender.van ? verzender.van() : "" });
  }
  if (!db) return send(res, 503, { error: "geen_opslag", melding: "Er is nog geen opslag gekoppeld (KV_REST_API_URL / KV_REST_API_TOKEN)." });

  if (method !== "GET" && method !== "POST") return send(res, 405, { error: "methode" });

  const body = method === "POST" ? parseBody(req) : {};
  if (body === null) return send(res, 400, { error: "ongeldige_json" });

  // de factuur mailen hoort bij geen link: geen token, geen opslag
  if (method === "POST" && clean(body.actie, 20) === "factuur") {
    if (!sessie.ingelogd(req)) return send(res, 401, { error: "niet_ingelogd", melding: "Je bent niet (meer) ingelogd. Laad de pagina opnieuw en log in." });
    if (!verzender.aan()) return send(res, 503, { error: "geen_mail", melding: "Mailen staat nog niet aan: zet MAIL_VAN en MAIL_WACHTWOORD in Vercel." });
    const factuur = cleanFactuur(body.factuur);
    if (!factuur) return send(res, 400, { error: "leeg", melding: "Zet eerst minstens één regel in de factuur." });
    if (JSON.stringify(factuur).length > MAX_OFFERTE) return send(res, 413, { error: "te_groot", melding: "De factuur is te lang om te mailen." });
    const aan = clean(body.aan, 200), onderwerp = clean(body.onderwerp, 200), tekst = clean(body.tekst, 10000);
    if (!mail.geldig(aan)) return send(res, 400, { error: "email", melding: "Vul een geldig e-mailadres in." });
    if (!onderwerp || !tekst) return send(res, 400, { error: "leeg", melding: "Onderwerp en bericht mogen niet leeg zijn." });
    const bedrijf = cleanBedrijf(body.bedrijf);
    const m = { aan, onderwerp, tekst, html: mail.mailHtml({ tekst, bedrijf, logo: basis(req) + "/mail-logo.png" }) };
    if (body.pdf !== false) {
      try {
        m.bijlagen = [{ naam: offertePdf.pdfNaam(factuur, bedrijf, false, "factuur"), base64: offertePdf.pdfBase64(factuur, bedrijf, null, "factuur"), type: "application/pdf" }];
      } catch (e) {
        return send(res, 500, { error: "pdf", melding: "De pdf voor de bijlage kon niet gemaakt worden. Stuur de mail zonder pdf, of probeer het later nog eens." });
      }
    }
    const regel = await probeer(verzender, "factuur", m);
    if (!regel.ok) return send(res, 502, { error: "mail", melding: "Versturen lukte niet: " + regel.fout });
    return send(res, 200, { ok: true, aan, op: regel.op });
  }

  const t = tokenOf(req, body);
  if (!t) return send(res, 400, { error: "ongeldig_token" });
  const key = "offerte:" + t;

  if (method === "GET") {
    const rec = await db.get(key);
    if (!rec) return send(res, 404, { error: "onbekend" });
    return send(res, 200, Object.assign(publiek(rec), { mail: verzender.aan() }));
  }

  const actie = clean(body.actie, 20);

  // Delen, intrekken en verwijderen doet alleen de planner zelf.
  if (actie !== "tekenen" && !sessie.ingelogd(req)) {
    return send(res, 401, { error: "niet_ingelogd", melding: "Je bent niet (meer) ingelogd. Laad de pagina opnieuw en log in." });
  }

  if (actie === "delen") {
    const offerte = cleanOfferte(body.offerte);
    if (!offerte) return send(res, 400, { error: "leeg", melding: "Zet eerst minstens één regel in de offerte." });
    if (JSON.stringify(offerte).length > MAX_OFFERTE) return send(res, 413, { error: "te_groot", melding: "De offerte is te lang om te delen." });
    const bedrijf = cleanBedrijf(body.bedrijf);
    const old = await db.get(key);
    if (old && old.akkoord) return send(res, 409, { error: "al_getekend", akkoord: old.akkoord, melding: "De klant heeft deze offerte al getekend." });
    const naam = clean(body.naam, 200);
    // niets veranderd: zelfde versie, dan kan een klant die de pagina open heeft gewoon tekenen
    if (old && JSON.stringify([old.offerte, old.bedrijf]) === JSON.stringify([offerte, bedrijf])) {
      if (old.naam !== naam) await db.set(key, Object.assign({}, old, { naam }));
      return send(res, 200, { ok: true, versie: old.versie, gedeeld: old.gedeeld });
    }
    const rec = {
      naam, offerte, bedrijf,
      versie: (old && old.versie ? old.versie : 0) + 1,
      gedeeld: nu().toISOString(),
      aangemaakt: old && old.aangemaakt ? old.aangemaakt : nu().toISOString(),
      akkoord: null
    };
    if (old && old.mails) rec.mails = old.mails;
    await db.set(key, rec);
    return send(res, 200, { ok: true, versie: rec.versie, gedeeld: rec.gedeeld });
  }

  if (actie === "tekenen") {
    const old = await db.get(key);
    if (!old) return send(res, 404, { error: "onbekend", melding: "Deze link is niet (meer) geldig." });
    if (old.akkoord) return send(res, 409, { error: "al_getekend", akkoord: old.akkoord, melding: "Deze offerte is al getekend." });
    if (body.versie !== old.versie) {
      return send(res, 409, { error: "gewijzigd", melding: "De offerte is net aangepast. Bekijk de nieuwe versie en teken opnieuw." });
    }
    if (old.offerte && old.offerte.geldig && old.offerte.geldig < vandaag(nu())) {
      return send(res, 410, { error: "verlopen", melding: "Deze offerte is verlopen. Neem even contact op voor een nieuwe." });
    }
    const naam = clean(body.naam, 120);
    if (naam.length < 2 || !/\p{L}/u.test(naam)) return send(res, 400, { error: "naam", melding: "Vul je naam in." });
    const handtekening = cleanHandtekening(body.handtekening);
    if (!handtekening) return send(res, 400, { error: "handtekening", melding: "Zet je handtekening in het vak." });
    const email = clean(body.email, 200);
    if (email && !mail.geldig(email)) return send(res, 400, { error: "email", melding: "Dat e-mailadres klopt niet helemaal." });
    const akkoord = { naam, handtekening, op: nu().toISOString(), versie: old.versie };
    if (email) akkoord.email = email;
    const rec = Object.assign({}, old, { akkoord });
    await db.set(key, rec);
    // eerst vastleggen, dan pas mailen: een mail die mislukt maakt het akkoord niet ongedaan
    await meldingen.seintje({
      onderwerp: "Offerte getekend: " + naam,
      tekst: naam + " heeft offerte " + ((old.offerte && old.offerte.nummer) || "") + " getekend." + (email ? "\n" + email : "")
    });
    let bevestiging = false;
    if (verzender.aan()) {
      const b = basis(req);
      let log;
      try { log = await mailsNaTekenen(verzender, rec, akkoord, b + "/?o=" + t, b + "/mail-logo.png"); }
      catch (e) { log = [{ soort: "melding", aan: "", op: new Date().toISOString(), ok: false, fout: String((e && e.message) || e).slice(0, 300) }]; }
      try {
        if (log.length) await db.set(key, Object.assign({}, rec, { mails: logboek(rec.mails, log) }));
      } catch (e) { /* het logboek mag mislukken; het akkoord staat er al */ }
      bevestiging = log.some((x) => x.soort === "bevestiging" && x.ok);
    }
    return send(res, 200, { ok: true, akkoord, bevestiging });
  }

  if (actie === "mailen") {
    if (!verzender.aan()) return send(res, 503, { error: "geen_mail", melding: "Mailen staat nog niet aan: zet MAIL_VAN en MAIL_WACHTWOORD in Vercel." });
    const old = await db.get(key);
    if (!old) return send(res, 404, { error: "onbekend", melding: "Deze offerte staat nog niet klaar bij de link." });
    const aan = clean(body.aan, 200), onderwerp = clean(body.onderwerp, 200), tekst = clean(body.tekst, 10000);
    if (!mail.geldig(aan)) return send(res, 400, { error: "email", melding: "Vul een geldig e-mailadres in." });
    if (!onderwerp || !tekst) return send(res, 400, { error: "leeg", melding: "Onderwerp en bericht mogen niet leeg zijn." });
    const b = basis(req), link = b + "/?o=" + t, bedrijf = old.bedrijf || {};
    const m = {
      aan, onderwerp, tekst,
      html: mail.mailHtml({ tekst, knop: { tekst: old.akkoord ? "Bekijk de getekende offerte" : "Bekijk en teken de offerte", url: link }, bedrijf, logo: b + "/mail-logo.png" })
    };
    if (body.pdf === true) {
      try {
        m.bijlagen = [{ naam: offertePdf.pdfNaam(old.offerte, bedrijf, !!old.akkoord), base64: offertePdf.pdfBase64(old.offerte, bedrijf, old.akkoord), type: "application/pdf" }];
      } catch (e) {
        return send(res, 500, { error: "pdf", melding: "De pdf voor de bijlage kon niet gemaakt worden. Stuur de mail zonder pdf, of probeer het later nog eens." });
      }
    }
    const regel = await probeer(verzender, "offerte", m);
    await db.set(key, Object.assign({}, old, { mails: logboek(old.mails, [regel]) }));
    if (!regel.ok) return send(res, 502, { error: "mail", melding: "Versturen lukte niet: " + regel.fout });
    return send(res, 200, { ok: true, aan, op: regel.op });
  }

  if (actie === "intrekken") {
    const old = await db.get(key);
    if (!old) return send(res, 404, { error: "onbekend" });
    // nieuwe versie: een pagina die nog open staat kan de oude niet meer tekenen
    await db.set(key, Object.assign({}, old, { akkoord: null, versie: (old.versie || 0) + 1 }));
    return send(res, 200, { ok: true, versie: (old.versie || 0) + 1 });
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
module.exports.basis = basis;
module.exports.memoryStore = opslag.memoryStore;
module.exports.cleanOfferte = cleanOfferte;
module.exports.cleanFactuur = cleanFactuur;
module.exports.cleanHandtekening = cleanHandtekening;
module.exports.vandaag = vandaag;
module.exports.PAD_W = PAD_W;
module.exports.PAD_H = PAD_H;
