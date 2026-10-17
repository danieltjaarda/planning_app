// De pdf-schrijver van de app, ook op de server: voor de bijlage bij de mails.
//
// Eén bron: we knippen dezelfde stukken uit src/weekzicht.html als
// tests/build-lib.mjs, zodat de pdf in de mail precies dezelfde is als die je
// in de app downloadt. vercel.json neemt dat bestand mee in de functie.

const fs = require("node:fs");
const path = require("node:path");

const BRON = path.join(__dirname, "..", "src", "weekzicht.html");
const TOESTAND = "/* ==========================================================\n     3. Toestand";

// wat de geknipte stukken van de rest van de app nodig hebben
const HEAD = `
var AMS="Europe/Amsterdam";
var DAYS=["maandag","dinsdag","woensdag","donderdag","vrijdag","zaterdag","zondag"];
var DAYS_S=["ma","di","wo","do","vr","za","zo"];
var MONTHS=["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];
var MONTHS_S=["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"];
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
var state={leads:[],offerteMeta:{bedrijf:null,tekst:null,btw:null,at:0}};
`;

let cache = null;

function lib() {
  if (cache) return cache;
  const html = fs.readFileSync(BRON, "utf8");
  const src = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const cut = (a, b) => {
    const i = src.indexOf(a), j = src.indexOf(b, i);
    if (i < 0 || j < 0) throw new Error("markering niet gevonden: " + (i < 0 ? a : b).slice(0, 40));
    return src.slice(i, j);
  };
  const code = HEAD + cut("function pad(n)", TOESTAND) + cut("  var OFFERTE_DAGEN", "  /* --- offertevenster") +
    "\nreturn { offertePdf: offertePdf, offerteTotalen: offerteTotalen, euro: euro, datumVol: datumVol, tijdVol: tijdVol, BEDRIJF: BEDRIJF };";
  cache = new Function(code)();
  return cache;
}

/** De offerte (of met soort "factuur" de factuur) als pdf (base64), met handtekening als er getekend is. */
function pdfBase64(offerte, bedrijf, akkoord, soort) {
  const L = lib();
  return Buffer.from(L.offertePdf(offerte, bedrijf || L.BEDRIJF, akkoord || null, soort), "latin1").toString("base64");
}

/** "Offerte 2026-001 Mediaspot (getekend).pdf" of "Factuur F2026-001 Mediaspot.pdf" */
function pdfNaam(offerte, bedrijf, getekend, soort) {
  return ((soort === "factuur" ? "Factuur " : "Offerte ") + ((offerte && offerte.nummer) || "") + " " + ((bedrijf && bedrijf.naam) || "Mediaspot") + (getekend ? " (getekend)" : ""))
    .replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim() + ".pdf";
}

module.exports = { lib, pdfBase64, pdfNaam };
