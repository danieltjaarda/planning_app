// Offerte: bedragen, nummering, de pdf zelf (geldige opbouw, juiste tekst) en
// de knoppen in het klantvenster. Draait op de gebouwde pagina en op de pure
// functies uit _offerte-lib.js (zie build-lib.mjs).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { JSDOM, VirtualConsole } = require('jsdom');
const L = require('./_offerte-lib.js');
const FIXTURE = require('./fixture.js');
const fakeApi = require('./fake-api.js');

let fail = 0, pass = 0;
function ok(name, cond, extra) {
  if (cond) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? '→ ' + extra : ''); }
}
const NB = '\u00a0';

// ---------------------------------------------------------------- bedragen
ok('bedrag: komma als decimaal', L.parseBedrag('1.950,50') === 1950.5);
ok('bedrag: kaal getal', L.parseBedrag('1950') === 1950);
ok('bedrag: met euroteken', L.parseBedrag('€ 899') === 899);
ok('bedrag: punt als duizendtal', L.parseBedrag('1.950') === 1950);
ok('bedrag: punt als decimaal', L.parseBedrag('12.5') === 12.5);
ok('bedrag: negatief', L.parseBedrag('-50,00') === -50);
ok('bedrag: leeg is null', L.parseBedrag('  ') === null);
ok('bedrag: onzin is NaN', isNaN(L.parseBedrag('abc')) && isNaN(L.parseBedrag('1,2,3')));
ok('bedrag: afronden op centen', L.parseBedrag('10,005') === 10.01 || L.parseBedrag('10,005') === 10);
ok('bedragtekst', L.bedragTekst(1950.5) === '1.950,50' && L.bedragTekst(1234567) === '1.234.567,00');
ok('euro', L.euro(899) === '€' + NB + '899,00', L.euro(899));
ok('euro negatief', L.euro(-50) === '-€' + NB + '50,00', L.euro(-50));
ok('getal', L.getal(1) === '1' && L.getal(2.5) === '2,5');

// ---------------------------------------------------------------- totalen
let t = L.offerteTotalen({ regels: [{ aantal: 1, prijs: 899 }], btw: 'incl' });
ok('incl: totaal is de som', t.totaal === 89900 && t.sub === 89900);
ok('incl: btw eruit gerekend', t.btw === 15602, t.btw);
t = L.offerteTotalen({ regels: [{ aantal: 1, prijs: 1000 }], btw: 'excl' });
ok('excl: btw erbij', t.btw === 21000 && t.totaal === 121000, JSON.stringify(t));
t = L.offerteTotalen({ regels: [{ aantal: 1, prijs: 1000 }], btw: 'geen' });
ok('zonder btw', t.btw === 0 && t.totaal === 100000);
t = L.offerteTotalen({ regels: [{ aantal: 2.5, prijs: 120 }, { aantal: 1, prijs: null }, { aantal: 1, prijs: -50 }], btw: 'incl' });
ok('aantal × prijs, tekstregel telt niet mee, korting eraf', t.regels.join() === '30000,0,-5000' && t.totaal === 25000, t.regels.join());
ok('standaard incl. 21%', L.offerteTotalen({ regels: [] }).modus === 'incl' && L.offerteTotalen({ regels: [] }).tarief === 21);

// ---------------------------------------------------------------- nummering en invullen
L.state.leads = [
  { id: 'a', offerte: { nummer: '2026-001' } },
  { id: 'b', offerte: { nummer: '2026-007' } },
  { id: 'c', offerte: { nummer: '2025-010' } },
  { id: 'd', offerte: { nummer: 'eigen' } }
];
ok('volgend nummer in het jaar', L.volgendNummer('2026-10-11', 'x') === '2026-008');
ok('eigen offerte telt niet mee', L.volgendNummer('2026-10-11', 'b') === '2026-002');
ok('nieuw jaar begint bij 001', L.volgendNummer('2027-01-02', 'x') === '2027-001');

const klant = {
  id: 'k1', name: 'David en Veerle', phone: '+31 6 00000009', date: '2027-05-29', start: '13:00', end: '00:30',
  form: { namen: 'David & Veerle', email: 'dv@voorbeeld.nl', locVoorbereiding: 'Landgoed X, Vorden',
          locCeremonie: 'landgoed x, vorden', locFeest: 'Kasteel Y', gasten: '120' }
};
ok('aan: namen en e-mail uit het formulier', L.offerteAan(klant) === 'David & Veerle\ndv@voorbeeld.nl\n+31 6 00000009', L.offerteAan(klant));
ok('aan: zonder formulier de klant zelf', L.offerteAan({ name: 'Eva', phone: '06' }) === 'Eva\n06');
ok('betreft met de datum', L.offerteBetreft(klant) === 'Bruiloftsfilm op zaterdag 29 mei 2027', L.offerteBetreft(klant));
ok('betreft zonder datum', L.offerteBetreft({}) === 'Bruiloftsfilm');
const det = L.offerteDetails(klant);
ok('details: tijden over middernacht', det.indexOf('Tijden: 13:00 – 00:30 (11,5 uur)') === 0, det);
ok('details: dubbele locatie één keer', det.split('\n').length === 4 && /Diner en feest: Kasteel Y/.test(det) && /Gasten: ongeveer 120/.test(det), det);

L.state.leads = [];
L.state.offerteMeta = { bedrijf: { naam: 'Mijn zaak' }, tekst: '', btw: 'excl', at: 1 };
let nieuw = L.nieuweOfferte(klant);
ok('nieuwe offerte: btw-keuze en tekst onthouden', nieuw.btw === 'excl' && nieuw.tekst === '', JSON.stringify([nieuw.btw, nieuw.tekst]));
ok('nieuwe offerte: één lege regel', nieuw.regels.length === 1 && nieuw.regels[0].prijs === null);
ok('nieuwe offerte: 30 dagen geldig', Date.parse(nieuw.geldig) - Date.parse(nieuw.datum) === 30 * 86400000, nieuw.datum + ' → ' + nieuw.geldig);
ok('bedrijf: eigen naam, de rest standaard', L.bedrijf().naam === 'Mijn zaak' && L.bedrijf().kvk === '96808845');
L.state.offerteMeta = { bedrijf: null, tekst: null, btw: null, at: 0 };
nieuw = L.nieuweOfferte(klant);
ok('standaard: incl. btw en de standaardtekst', nieuw.btw === 'incl' && /Akkoord met deze offerte/.test(nieuw.tekst));
ok('bestandsnaam zonder rare tekens', L.offerteNaam({ nummer: '2026-003' }, { name: 'A/B: "C"' }) === 'Offerte 2026-003 AB C.pdf');

// ---------------------------------------------------------------- tekens en afbreken
ok('winAnsi: euro, é, gedachtestreepje, krul-apostrof',
  L.winAnsi('€é—’').join() === '128,233,151,146', L.winAnsi('€é—’').join());
ok('winAnsi: emoji wordt één vraagteken', L.winAnsi('a😀b').join() === '97,63,98');
ok('winAnsi: losse accenten samengevoegd', L.winAnsi('é').join() === '233');
ok('pdf-tekst ontsnapt haakjes en hoge tekens', L.pdfStr(L.winAnsi('(€)\\')) === '(\\(\\200\\)\\\\)', L.pdfStr(L.winAnsi('(€)\\')));
const lang = 'Bijvoorbeeld tot en met het diner. 1 videograaf, trouwfilm van circa 7–8 minuten, professionele nabewerking.';
const af = L.pdfAfbreken(lang, false, 10, 150);
ok('afbreken: meerdere regels', af.length > 2, af.length);
ok('afbreken: elke regel past', af.every(r => L.pdfBreedte(r, false, 10) <= 150));
ok('afbreken: geen woord kwijt', af.join(' ') === lang);
ok('afbreken: te lang woord op letters', L.pdfAfbreken('x'.repeat(200), false, 10, 100).every(r => L.pdfBreedte(r, false, 10) <= 100));
ok('afbreken: lege regel blijft', L.pdfAfbreken('a\n\nb', false, 10, 100).join('|') === 'a||b');
ok('ascii85 volgens het boekje', L.ascii85('Man ') === '9jqo^~>' && L.ascii85('\0\0\0\0') === 'z~>' && L.ascii85('.') === '/c~>');

// ascii85 terug + inflate: het logo moet precies breedte × hoogte × 3 bytes zijn
function unA85(s) {
  s = s.replace(/\s/g, '').replace(/~>$/, '');
  const out = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === 'z') { out.push(0, 0, 0, 0); i++; continue; }
    const g = s.slice(i, i + 5); i += 5;
    const n = g.length, p = (g + 'uuuu').slice(0, 5);
    let v = 0;
    for (const ch of p) v = v * 85 + (ch.charCodeAt(0) - 33);
    const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...b.slice(0, n - 1));
  }
  return Buffer.from(out);
}
const logoRaw = zlib.inflateSync(unA85(L.ascii85(Buffer.from(L.LOGO_PDF.z, 'base64').toString('latin1'))));
ok('logo: ascii85 + zlib geeft de pixels terug', logoRaw.length === L.LOGO_PDF.w * L.LOGO_PDF.h * 3, logoRaw.length);
ok('logo: links boven is wit, er staat wel iets donkers in', logoRaw[0] > 240 && logoRaw.some(b => b < 60));

// ---------------------------------------------------------------- de pdf
/** Controleert de opbouw: xref-plekken, streamlengtes, paginatelling. */
function checkPdf(pdf) {
  const fouten = [];
  if (!pdf.startsWith('%PDF-1.4\n')) fouten.push('kop');
  if (!pdf.endsWith('%%EOF\n')) fouten.push('slot');
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(pdf)) fouten.push('niet-ASCII');
  const sx = +/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)[1];
  if (pdf.slice(sx, sx + 5) !== 'xref\n') fouten.push('startxref wijst mis');
  const m = /^xref\n0 (\d+)\n/.exec(pdf.slice(sx));
  const n = +m[1];
  const rijen = pdf.slice(sx + m[0].length).split('\n').slice(0, n);
  if (rijen[0] !== '0000000000 65535 f ') fouten.push('eerste xref-rij');
  for (let i = 1; i < n; i++) {
    if (!/^\d{10} 00000 n $/.test(rijen[i])) { fouten.push('xref-rij ' + i); continue; }
    const off = +rijen[i].slice(0, 10);
    if (!pdf.startsWith(i + ' 0 obj\n', off)) fouten.push('object ' + i + ' niet op ' + off);
  }
  const re = /<< \/Length (\d+)[^]*?>>\nstream\n/g;
  let s;
  while ((s = re.exec(pdf))) {
    const start = s.index + s[0].length, len = +s[1];
    if (pdf.slice(start + len, start + len + 10) !== '\nendstream') fouten.push('streamlengte bij ' + s.index);
  }
  const telling = +/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(pdf)[1];
  const paginas = (pdf.match(/\/Type \/Page /g) || []).length;
  if (telling !== paginas) fouten.push('Count ' + telling + ' ≠ ' + paginas);
  return { fouten, paginas, objecten: n - 1 };
}

const of = {
  nummer: '2026-004', datum: '2026-10-11', geldig: '2026-11-10',
  aan: 'David & Veerle\ndv@voorbeeld.nl', betreft: 'Bruiloftsfilm op zaterdag 29 mei 2027', details: 'Tijden: 13:00 – 23:30',
  regels: [{ oms: L.PAKKETTEN[1].oms, aantal: 1, prijs: 899 }, { oms: 'Drone (extra)', aantal: 1, prijs: 150 }],
  btw: 'incl', tarief: 21, tekst: 'Akkoord? Laat het me weten.'
};
const pdf = L.offertePdf(of, L.bedrijf());
const c = checkPdf(pdf);
ok('pdf: geldige opbouw', c.fouten.length === 0, c.fouten.join(', '));
ok('pdf: één pagina', c.paginas === 1);
ok('pdf: Helvetica met eigen breedtes', /\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding \/FirstChar 32 \/LastChar 255 \/Widths \[278 /.test(pdf));
ok('pdf: logo als plaatje op de pagina', /\/Subtype \/Image \/Width 1383 \/Height 205/.test(pdf) && /cm \/Logo Do Q/.test(pdf));
ok('pdf: logo links boven', (() => {
  const m = /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Logo Do Q/.exec(pdf);
  return m && +m[3] < 80 && +m[4] + +m[2] > 760;
})());
ok('pdf: titel', pdf.indexOf('(Offerte) Tj') > 0);
ok('pdf: nummer en datum', pdf.indexOf('(2026-004)') > 0 && pdf.indexOf('(11 oktober 2026)') > 0 && pdf.indexOf('(10 november 2026)') > 0);
ok('pdf: klant', pdf.indexOf('(David & Veerle)') > 0 && pdf.indexOf('(dv@voorbeeld.nl)') > 0);
ok('pdf: regel met euroteken', pdf.indexOf('(\\200\\240899,00)') > 0);
ok('pdf: totaal incl. btw', pdf.indexOf('(Totaal incl. btw)') > 0 && pdf.indexOf('(\\200\\2401.049,00)') > 0);
ok('pdf: btw erin', pdf.indexOf('(Waarvan 21% btw)') > 0 && pdf.indexOf('(\\200\\240182,06)') > 0);
ok('pdf: zonder aantallen geen aantalkolom', pdf.indexOf('(AANTAL)') < 0);
ok('pdf: bedrijf en KvK in de voet', pdf.indexOf('(Mediaspot)') > 0 && pdf.indexOf('KvK 96808845') > 0);
ok('pdf: tekst onderaan', pdf.indexOf('(Akkoord? Laat het me weten.)') > 0);
ok('pdf: titel in de eigenschappen', pdf.indexOf('/Title <FEFF004f') > 0);

const pdf2 = L.offertePdf(Object.assign({}, of, { btw: 'excl', regels: of.regels.concat([{ oms: 'Extra uur', aantal: 2, prijs: 95 }]) }), L.bedrijf());
ok('pdf excl: geldig', checkPdf(pdf2).fouten.length === 0);
ok('pdf excl: subtotaal en btw-regel', pdf2.indexOf('(Subtotaal)') > 0 && pdf2.indexOf('(Btw 21%)') > 0 && pdf2.indexOf('(Totaal)') > 0);
ok('pdf excl: aantalkolom zodra er een aantal ≠ 1 is', pdf2.indexOf('(AANTAL)') > 0 && pdf2.indexOf('(\\200\\240190,00)') > 0);

const veel = Object.assign({}, of, { regels: Array.from({ length: 60 }, (_, i) => ({ oms: 'Regel ' + (i + 1) + '\nmet uitleg', aantal: 1, prijs: 10 })) });
const pdf3 = L.offertePdf(veel, L.bedrijf());
const c3 = checkPdf(pdf3);
ok('pdf lang: geldig', c3.fouten.length === 0, c3.fouten.join(', '));
ok('pdf lang: meerdere pagina\'s met nummer', c3.paginas >= 3 && pdf3.indexOf('(1 / ' + c3.paginas + ')') > 0, c3.paginas);
ok('pdf lang: vervolgpagina noemt de offerte', pdf3.indexOf('(Offerte 2026-004 \\(vervolg\\))') > 0);
ok('pdf lang: alle regels erin', pdf3.indexOf('(Regel 60)') > 0 && pdf3.indexOf('(\\200\\240600,00)') > 0);

if (process.env.OFFERTE_PDF) fs.writeFileSync(process.env.OFFERTE_PDF, pdf, 'latin1');

// ---------------------------------------------------------------- in de app
const FIXED = Date.UTC(2026, 8, 1, 10, 0, 0);   // dinsdag 1 september 2026, 12:00
function freezeClock(win) {
  const RealDate = win.Date;
  win.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(FIXED); }
    static now() { return FIXED; }
  };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const doc = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const errors = [];
const downloads = [];
const dom = new JSDOM(doc, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/',
  beforeParse(win) {
    freezeClock(win);
    win.fetch = fakeApi();
    win.localStorage.setItem('weekzicht.v1', JSON.stringify({
      events: [], tasks: [], leads: FIXTURE, settings: { weekend: true, dayStart: 7, dayEnd: 21 }
    }));
    win.localStorage.setItem('weekzicht.v1.leads-seeded', '1');
    // downloads opvangen: jsdom kan geen blob-URL's en navigeert niet
    let last = null;
    win.URL.createObjectURL = (b) => { last = b; return 'blob:test/' + downloads.length; };
    win.URL.revokeObjectURL = () => {};
    win.HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download, blob: last }); };
  },
  virtualConsole: new VirtualConsole().on('jsdomError', e => errors.push('jsdomError: ' + e.message))
});
const w = dom.window, d = w.document;
w.addEventListener('error', e => errors.push('window error: ' + e.message));
const $ = id => d.getElementById(id);
const q = sel => d.querySelector(sel);
const qa = sel => Array.from(d.querySelectorAll(sel));
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const typ = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
const change = el => el.dispatchEvent(new w.Event('change', { bubbles: true }));
const key = k => d.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
const readBlob = b => new Promise(res => { const fr = new w.FileReader(); fr.onload = () => res(fr.result); fr.readAsText(b); });
const stored = id => JSON.parse(w.localStorage.getItem('weekzicht.v1')).leads.find(l => l.id === id);
const regels = () => qa('#oRegels .of-regel');

setTimeout(async () => {
  try {
    ok('app: geen scriptfouten', errors.length === 0, errors.join(' | '));
    click(q('.viewswitch [data-view="klanten"]'));
    click(q('#canvas .k-main[data-lead="t-cas"]'));
    ok('app: klantvenster open met offertevak', !$('ldOverlay').hidden && !!$('lMakeOfferte'));

    click($('lMakeOfferte'));
    ok('app: offertevenster boven het klantvenster', !$('ofOverlay').hidden && !$('ldOverlay').hidden);
    ok('app: nummer, datum en geldigheid ingevuld',
      $('oNummer').value === '2026-001' && $('oDatum').value === '2026-09-01' && $('oGeldig').value === '2026-10-01',
      [$('oNummer').value, $('oDatum').value, $('oGeldig').value].join());
    ok('app: klant ingevuld', $('oAan').value === 'Cas en Dina\n+31 6 00000004', JSON.stringify($('oAan').value));
    ok('app: betreft met de trouwdatum', $('oBetreft').value === 'Bruiloftsfilm op vrijdag 29 mei 2026', $('oBetreft').value);
    ok('app: één lege regel om te beginnen', regels().length === 1);
    ok('app: drie pakketknoppen', qa('#oPakketten [data-pakket]').length === 3);
    ok('app: delen alleen waar het kan', $('oShare').hidden);
    ok('app: nog niets bewaard', !stored('t-cas').offerte);

    typ(q('#oRegels .of-oms'), 'Trouwfilm van de hele dag');
    typ(q('#oRegels .of-prijs input'), '1250');
    ok('app: bedrag per regel', q('#oRegels .of-bedrag').textContent === '€' + NB + '1.250,00', q('#oRegels .of-bedrag').textContent);
    change(q('#oRegels .of-prijs input'));
    ok('app: prijs netjes geschreven', q('#oRegels .of-prijs input').value === '1.250,00');

    click(q('[data-pakket="goud"]'));
    ok('app: pakket als regel erbij', regels().length === 2 &&
      regels()[1].querySelector('.of-prijs input').value === '899,00' &&
      /^Pakket Goud — 10 uur filmen\n/.test(regels()[1].querySelector('.of-oms').value));
    ok('app: totaal incl. btw', /Totaal incl\. btw€\u00a02\.149,00/.test($('oTotaal').textContent), $('oTotaal').textContent);

    click($('oAddRegel'));
    ok('app: + Regel', regels().length === 3);
    typ(regels()[2].querySelector('.of-prijs input'), 'abc');
    ok('app: onzin in de prijs valt op', regels()[2].querySelector('.of-prijs input').classList.contains('bad'));
    click(regels()[2].querySelector('.of-weg'));
    ok('app: regel weg', regels().length === 2);

    // pakket vult een lege laatste regel in plaats van eronder
    click($('oAddRegel'));
    click(q('[data-pakket="zilver"]'));
    ok('app: pakket vult de lege regel', regels().length === 3 && regels()[2].querySelector('.of-prijs input').value === '799,00');
    click(regels()[2].querySelector('.of-weg'));

    click(q('#oBtw [data-btw="excl"]'));
    ok('app: excl. btw toont subtotaal en btw', /Subtotaal€\u00a02\.149,00/.test($('oTotaal').textContent) &&
      /Btw 21%€\u00a0451,29/.test($('oTotaal').textContent) && /Totaal€\u00a02\.600,29/.test($('oTotaal').textContent), $('oTotaal').textContent);

    click($('oPdf'));
    await wait(30);
    ok('app: pdf gedownload', downloads.length === 1 && downloads[0].name === 'Offerte 2026-001 Cas en Dina.pdf', JSON.stringify(downloads.map(x => x.name)));
    ok('app: als pdf', downloads[0] && downloads[0].blob.type === 'application/pdf');
    const tekst = downloads[0] ? await readBlob(downloads[0].blob) : '';
    ok('app: geldige pdf uit de browser', tekst && checkPdf(tekst).fouten.length === 0, tekst && checkPdf(tekst).fouten.join());
    ok('app: pdf met de regels en het totaal', tekst.indexOf('(Trouwfilm van de hele dag)') > 0 && tekst.indexOf('(\\200\\2402.600,29)') > 0);
    let sv = stored('t-cas').offerte;
    ok('app: offerte bewaard bij de klant', sv && sv.nummer === '2026-001' && sv.regels.length === 2 && sv.btw === 'excl' && sv.regels[0].prijs === 1250,
      JSON.stringify(sv && sv.regels));
    ok('app: venster blijft open na download', !$('ofOverlay').hidden);
    ok('app: nu ook verwijderen', !$('oDelete').hidden);
    ok('app: vak in het klantvenster toont de offerte', /2026-001/.test($('lOfferteBox').textContent) && /2\.600,29/.test($('lOfferteBox').textContent),
      $('lOfferteBox').textContent);

    // Escape sluit alleen de offerte
    key('Escape');
    ok('app: Escape sluit alleen de offerte', $('ofOverlay').hidden && !$('ldOverlay').hidden);

    // weer openen, aanpassen, sluiten met ✕: wordt bewaard
    click($('lEditOfferte'));
    ok('app: bewerken toont de regels', regels().length === 2 && $('oNummer').value === '2026-001');
    ok('app: btw-keuze terug', q('#oBtw [data-btw="excl"]').getAttribute('aria-pressed') === 'true');
    typ(regels()[0].querySelector('.of-prijs input'), '1300');
    click($('oClose'));
    sv = stored('t-cas').offerte;
    ok('app: sluiten bewaart de wijziging', $('ofOverlay').hidden && sv.regels[0].prijs === 1300, sv.regels[0].prijs);

    // de klant opslaan houdt de offerte vast
    click($('lSave'));
    ok('app: klant opslaan houdt de offerte', stored('t-cas').offerte && stored('t-cas').offerte.regels[0].prijs === 1300);
    ok('app: kaartje noemt de offerte', /offerte €\u00a02\.660,79/.test(q('#canvas').textContent), q('#canvas').textContent.match(/offerte[^a-z]{0,20}/));

    // tweede klant: volgend nummer, onthouden btw-keuze
    click(q('#canvas .k-main[data-lead="t-eva"]'));
    click($('lMakeOfferte'));
    ok('app: volgend nummer', $('oNummer').value === '2026-002', $('oNummer').value);
    ok('app: btw-keuze van de vorige offerte', q('#oBtw [data-btw="excl"]').getAttribute('aria-pressed') === 'true');
    ok('app: niets gewijzigd → niets bewaard bij sluiten', (click($('oClose')), !stored('t-eva').offerte));

    // bedrijfsgegevens aanpassen komt op de pdf en blijft bewaard
    click($('lMakeOfferte'));
    typ(q('#oRegels .of-oms'), 'Bedrijfsfilm');
    typ(q('#oRegels .of-prijs input'), '500');
    $('ob_iban').value = 'NL00TEST0123456789';
    typ($('ob_naam'), 'Mediaspot Video');
    click($('oPdf'));
    await wait(30);
    const t2 = await readBlob(downloads[1].blob);
    ok('app: eigen gegevens op de pdf', t2.indexOf('(Mediaspot Video)') > 0 && t2.indexOf('IBAN NL00TEST0123456789') > 0);
    const meta = JSON.parse(w.localStorage.getItem('weekzicht.v1')).offerte;
    ok('app: gegevens onthouden voor de volgende keer', meta && meta.bedrijf && meta.bedrijf.iban === 'NL00TEST0123456789' && meta.at > 0, JSON.stringify(meta));

    // verwijderen in twee stappen
    click($('oDelete'));
    ok('app: eerst bevestigen', !$('ofOverlay').hidden && /Echt/.test($('oDelete').textContent) && !!stored('t-eva').offerte);
    click($('oDelete'));
    ok('app: offerte verwijderd', $('ofOverlay').hidden && !stored('t-eva').offerte && !!$('lMakeOfferte'));
    click(q('#ldOverlay [data-close]'));

    // downloaden uit het vak, zonder het venster te openen
    click(q('#canvas .k-main[data-lead="t-cas"]'));
    click($('lPdfOfferte'));
    await wait(30);
    ok('app: download vanuit het klantvenster', downloads.length === 3 && downloads[2].name === 'Offerte 2026-001 Cas en Dina.pdf');
    click(q('#ldOverlay [data-close]'));

    // exporteren werkte buiten claude.ai niet; nu een gewone download
    click($('miKlantCsv'));
    await wait(30);
    ok('app: klantenlijst als csv', downloads.length === 4 && downloads[3].name === 'weekzicht-klanten.csv', JSON.stringify(downloads.map(x => x.name)));
    click($('miJson'));
    await wait(30);
    ok('app: back-up als json', downloads.length === 5 && downloads[4].name === 'weekzicht-backup.json');
    const backup = JSON.parse(await readBlob(downloads[4].blob));
    ok('app: back-up bevat de offerte', backup.leads.find(l => l.id === 't-cas').offerte.nummer === '2026-001');

    ok('app: geen scriptfouten na alles', errors.length === 0, errors.join(' | '));
  } catch (e) {
    fail++;
    console.log('FAIL uitzondering', e && e.stack);
  }
  console.log(pass + ' geslaagd, ' + fail + ' gefaald');
  process.exit(fail ? 1 : 0);
}, 300);
