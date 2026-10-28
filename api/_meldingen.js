// Meldingen per mail aan de planner: welke aan staan (meta/meldingen in de
// planning, in te stellen in de app), en de melding als een klant iets doet
// (formulier ingevuld, muziek gekozen). De herinneringen zelf staan in
// api/herinneringen.js.

const mail = require("./_mail.js");

const STANDAARD = { dagoverzicht: true, dagTijd: "07:00", vooraf: 30, klant: true };
const VOORAF = [0, 10, 15, 30, 60, 120];
// waar de links in de meldingen heen gaan: de planning zelf
const APP_URL = process.env.APP_URL || "https://app.mediaspot.nl";

/** De instellingen uit meta/meldingen, aangevuld met de standaard. */
function instellingen(doc) {
  const d = doc && typeof doc === "object" ? doc : {};
  return {
    dagoverzicht: typeof d.dagoverzicht === "boolean" ? d.dagoverzicht : STANDAARD.dagoverzicht,
    dagTijd: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(d.dagTijd || "")) ? d.dagTijd : STANDAARD.dagTijd,
    vooraf: VOORAF.indexOf(d.vooraf) >= 0 ? d.vooraf : STANDAARD.vooraf,
    klant: typeof d.klant === "boolean" ? d.klant : STANDAARD.klant
  };
}

async function leesInstellingen(db) {
  const meta = (await db.hgetall("planning:meta")) || {};
  return instellingen(meta.meldingen);
}

/**
 * Pushmelding naar Daniels iPhone via Seintje (eigen app). SEINTJE_URL is de
 * volledige webhook-URL inclusief sleutel; zonder die env gebeurt er niets.
 * Gooit nooit en wacht hooguit 4 seconden. m: { onderwerp, tekst }
 */
async function seintje(m) {
  const url = String(process.env.SEINTJE_URL || "").trim();
  if (!url) return false;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bron: "Weekzicht", titel: m.onderwerp, tekst: String(m.tekst || "").slice(0, 900), url: APP_URL }),
      signal: AbortSignal.timeout(4000)
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

/**
 * Een melding dat een klant iets gedaan heeft. Gooit nooit: wat de klant
 * instuurde is dan al bewaard, en een mail die mislukt mag dat niet raken.
 * m: { onderwerp, tekst }
 */
async function klantMelding(db, verzender, m) {
  await seintje(m); // los van de mailinstellingen
  try {
    if (!verzender || !verzender.aan()) return false;
    const inst = await leesInstellingen(db);
    if (!inst.klant) return false;
    const aan = verzender.meldingen && verzender.meldingen();
    if (!aan) return false;
    const tekst = m.tekst + "\n\nOpen Weekzicht: " + APP_URL;
    await verzender.verstuur({
      aan, onderwerp: m.onderwerp, tekst,
      html: mail.mailHtml({ tekst, knop: { tekst: "Open Weekzicht", url: APP_URL } })
    });
    return true;
  } catch (e) {
    return false;
  }
}

const MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const DAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const SCENES = { voorbereidingen: "Voorbereidingen", ceremonie: "Ceremonie", fotoshoot: "Fotoshoot en borrel",
  diner: "Diner en speeches", openingsdans: "Openingsdans", feest: "Feest" };

function tekst(v, max) {
  return typeof v === "string" || typeof v === "number" ? String(v).replace(/\s+/g, " ").trim().slice(0, max || 200) : "";
}

/** "zaterdag 6 juni 2027" */
function datumNl(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ""))) return tekst(d);
  const x = new Date(d + "T12:00:00Z");
  return DAGEN[x.getUTCDay()] + " " + x.getUTCDate() + " " + MAANDEN[x.getUTCMonth()] + " " + x.getUTCFullYear();
}

/** De melding na het formulier: wie, en de dingen die je meteen wilt weten. */
function formulierMelding(rec, aangepast) {
  const a = (rec && rec.antwoorden) || {};
  const wie = tekst(a.namen, 120) || tekst(rec && rec.naam, 120) || "Een klant";
  const regels = [];
  if (a.datum) regels.push("Datum: " + datumNl(a.datum));
  if (a.start || a.eind) regels.push("Tijden: " + (tekst(a.start) || "?") + "–" + (tekst(a.eind) || "?"));
  [["Voorbereidingen", "locVoorbereiding"], ["Ceremonie", "locCeremonie"], ["Diner en feest", "locFeest"]].forEach(([k, v]) => {
    if (tekst(a[v])) regels.push(k + ": " + tekst(a[v]));
  });
  if (tekst(a.gasten)) regels.push("Gasten: " + tekst(a.gasten));
  if (tekst(a.telefoon)) regels.push("Telefoon: " + tekst(a.telefoon));
  if (tekst(a.email)) regels.push("E-mail: " + tekst(a.email));
  return {
    onderwerp: (aangepast ? "Formulier aangepast: " : "Formulier ingevuld: ") + wie,
    tekst: wie + (aangepast ? " heeft het formulier aangepast." : " heeft het formulier ingevuld.") +
      (regels.length ? "\n\n" + regels.join("\n") : "") + "\n\nAlle antwoorden staan in Weekzicht bij de klant."
  };
}

/** De melding na de muziekkeuze: per scène het nummer. */
function muziekMelding(rec, aangepast) {
  const wie = tekst(rec && rec.naam, 120) || "Een klant";
  const nummers = Array.isArray(rec && rec.nummers) ? rec.nummers : [];
  const lijst = nummers.map((n) => "• " + (SCENES[n.moment] ? SCENES[n.moment] + ": " : "") + tekst(n.titel) + (tekst(n.artiest) ? " — " + tekst(n.artiest) : ""));
  return {
    onderwerp: (aangepast ? "Muziek aangepast: " : "Muziek gekozen: ") + wie,
    tekst: wie + (aangepast ? " heeft de muziekkeuze aangepast" : " heeft de muziek gekozen") +
      (nummers.length ? " (" + nummers.length + (nummers.length === 1 ? " nummer" : " nummers") + "):\n\n" + lijst.join("\n") : ".") +
      (tekst(rec && rec.opmerking, 2000) ? "\n\nOpmerking: " + tekst(rec.opmerking, 2000) : "")
  };
}

module.exports = { STANDAARD, VOORAF, APP_URL, instellingen, leesInstellingen, seintje, klantMelding, formulierMelding, muziekMelding, datumNl };
