// Akkoord op de offerte: de server (delen, tekenen, versies, verlopen,
// intrekken), de handtekening in svg en pdf, en de hele keten in de browser:
// link maken in de app → klant tekent op ?o=token → app haalt het akkoord op
// en zet de offerte vast.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const L = require('./_offerte-lib.js');
const api = require('../api/offerte.js');
const FIXTURE = require('./fixture.js');
const fakeApi = require('./fake-api.js');

let fail = 0, pass = 0;
function ok(name, cond, extra) {
  if (cond) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? '→ ' + extra : ''); }
}
const NB = ' ';

// ---------------------------------------------------------------- server
const db = api.memoryStore();
let klok = new Date('2026-10-12T10:00:00Z');
async function call(body, query) {
  let status = 0, out = '';
  const res = { statusCode: 200, setHeader() {}, end(s) { status = res.statusCode; out = s; } };
  await api.handle({ method: body ? 'POST' : 'GET', headers: {}, query: query || {}, body }, res, db, { nu: () => klok });
  return { status, data: out ? JSON.parse(out) : null };
}
const T = 'akkoordtest0000000001';
const OF = {
  nummer: '2026-003', datum: '2026-10-12', geldig: '2026-11-11', aan: 'Sanne & Thomas\nst@voorbeeld.nl',
  betreft: 'Bruiloftsfilm op zaterdag 6 juni 2027', details: 'Tijden: 12:00 – 22:00',
  regels: [{ oms: 'Pakket Goud — 10 uur filmen\nMet nabewerking', aantal: 1, prijs: 899 }, { oms: 'Drone', aantal: 2, prijs: 75 }, { oms: '', prijs: null }],
  btw: 'incl', tarief: 21, tekst: 'Akkoord? Teken hieronder.', gewijzigd: 123
};
const B = { naam: 'Mediaspot', juridisch: 'Tjaarda Holding B.V.', adres: 'Brandemeer 6\nJoure', kvk: '96808845' };
// een krul van 30 punten: genoeg inkt
const KRUL = [Array.from({ length: 30 }, (_, i) => [100 + i * 20, 250 + Math.round(Math.sin(i / 3) * 80)]).flat()];

(async () => {
  let r = await call(null, { t: T });
  ok('api: onbekend token → 404', r.status === 404);
  r = await call({ t: 'kort', actie: 'delen' });
  ok('api: ongeldig token', r.status === 400 && r.data.error === 'ongeldig_token');
  r = await call({ t: T, actie: 'delen', naam: 'Sanne', offerte: { regels: [] }, bedrijf: B });
  ok('api: lege offerte niet delen', r.status === 400 && r.data.error === 'leeg');

  r = await call({ t: T, actie: 'delen', naam: 'Sanne & Thomas', offerte: OF, bedrijf: B });
  ok('api: delen', r.status === 200 && r.data.versie === 1 && r.data.gedeeld === '2026-10-12T10:00:00.000Z', JSON.stringify(r.data));
  r = await call(null, { t: T });
  ok('api: ophalen zonder login', r.status === 200 && r.data.naam === 'Sanne & Thomas' && r.data.versie === 1 && r.data.akkoord === null);
  ok('api: lege regel en eigen velden eruit', r.data.offerte.regels.length === 2 && !('gewijzigd' in r.data.offerte));
  ok('api: bedrijf mee', r.data.bedrijf.kvk === '96808845' && r.data.bedrijf.iban === '');

  klok = new Date('2026-10-12T11:00:00Z');
  r = await call({ t: T, actie: 'delen', naam: 'Sanne & Thomas', offerte: Object.assign({}, OF, { gewijzigd: 456 }), bedrijf: B });
  ok('api: niets veranderd → zelfde versie', r.data.versie === 1 && r.data.gedeeld === '2026-10-12T10:00:00.000Z', JSON.stringify(r.data));
  r = await call({ t: T, actie: 'delen', naam: 'Sanne & Thomas', offerte: Object.assign({}, OF, { regels: [{ oms: 'Pakket Diamant', prijs: 1199 }] }), bedrijf: B });
  ok('api: gewijzigd → nieuwe versie', r.data.versie === 2 && r.data.gedeeld === '2026-10-12T11:00:00.000Z');

  // tekenen
  r = await call({ t: T, actie: 'tekenen', versie: 1, naam: 'Sanne de Vries', handtekening: KRUL });
  ok('api: tekenen op een oude versie → 409 gewijzigd', r.status === 409 && r.data.error === 'gewijzigd');
  r = await call({ t: T, actie: 'tekenen', versie: 2, naam: ' ', handtekening: KRUL });
  ok('api: zonder naam', r.status === 400 && r.data.error === 'naam');
  r = await call({ t: T, actie: 'tekenen', versie: 2, naam: '12', handtekening: KRUL });
  ok('api: naam zonder letters', r.status === 400 && r.data.error === 'naam');
  r = await call({ t: T, actie: 'tekenen', versie: 2, naam: 'Sanne', handtekening: [[500, 200, 502, 201]] });
  ok('api: een tikje is geen handtekening', r.status === 400 && r.data.error === 'handtekening');
  r = await call({ t: T, actie: 'tekenen', versie: 2, naam: 'Sanne', handtekening: [[1, 2, 3]] });
  ok('api: oneven lijn geweigerd', r.status === 400 && r.data.error === 'handtekening');
  r = await call({ t: T, actie: 'tekenen', versie: 2, naam: 'Sanne', handtekening: [['a', 1, 2, 3]] });
  ok('api: geen getallen geweigerd', r.status === 400);
  r = await call({ t: T, actie: 'tekenen', versie: 2, naam: 'Sanne', handtekening: Array.from({ length: 200 }, () => [1, 1, 300, 300]) });
  ok('api: te veel lijnen geweigerd', r.status === 400);
  ok('api: schoonmaken knipt af op het vlak', JSON.stringify(api.cleanHandtekening([[-50, 900, 2000.4, 10, 300, 300, 310, 320, 320, 330, 330, 340, 340, 350, 350, 360]])[0].slice(0, 4)) === '[0,500,1000,10]');

  klok = new Date('2026-10-12T12:03:00Z');
  r = await call({ t: T, actie: 'tekenen', versie: 2, naam: '  Sanne de Vries ', handtekening: KRUL });
  ok('api: getekend', r.status === 200 && r.data.akkoord.naam === 'Sanne de Vries' && r.data.akkoord.op === '2026-10-12T12:03:00.000Z' && r.data.akkoord.versie === 2, JSON.stringify(r.data));
  r = await call(null, { t: T });
  ok('api: akkoord bij het ophalen', r.data.akkoord && r.data.akkoord.handtekening.length === 1 && r.data.akkoord.handtekening[0].length === 60);
  r = await call({ t: T, actie: 'tekenen', versie: 2, naam: 'Iemand anders', handtekening: KRUL });
  ok('api: geen tweede handtekening', r.status === 409 && r.data.error === 'al_getekend' && r.data.akkoord.naam === 'Sanne de Vries');
  r = await call({ t: T, actie: 'delen', naam: 'X', offerte: OF, bedrijf: B });
  ok('api: getekende versie niet overschrijven', r.status === 409 && r.data.error === 'al_getekend' && r.data.akkoord.naam === 'Sanne de Vries');

  // intrekken: daarna weer delen en tekenen
  r = await call({ t: T, actie: 'intrekken' });
  ok('api: intrekken hoogt de versie op', r.status === 200 && r.data.versie === 3);
  r = await call(null, { t: T });
  ok('api: na intrekken geen akkoord', r.data.akkoord === null && r.data.versie === 3);
  r = await call({ t: T, actie: 'tekenen', versie: 2, naam: 'Sanne', handtekening: KRUL });
  ok('api: open pagina met de oude versie kan niet meer tekenen', r.status === 409 && r.data.error === 'gewijzigd');
  r = await call({ t: T, actie: 'delen', naam: 'Sanne & Thomas', offerte: Object.assign({}, OF, { regels: [{ oms: 'Pakket Diamant', prijs: 1199 }] }), bedrijf: B });
  ok('api: zelfde inhoud na intrekken → versie blijft', r.status === 200 && r.data.versie === 3);

  // verlopen
  klok = new Date('2026-11-11T22:30:00Z');   // 23:30 in Nederland: nog net geldig
  ok('api: Nederlandse datum', api.vandaag(klok) === '2026-11-11');
  klok = new Date('2026-11-11T23:30:00Z');   // 00:30 op 12 november
  ok('api: na middernacht in Nederland', api.vandaag(klok) === '2026-11-12');
  r = await call({ t: T, actie: 'tekenen', versie: 3, naam: 'Sanne', handtekening: KRUL });
  ok('api: verlopen offerte niet tekenen', r.status === 410 && r.data.error === 'verlopen');

  r = await call({ t: T, actie: 'onzin' });
  ok('api: onbekende actie', r.status === 400 && r.data.error === 'onbekende_actie');
  r = await call({ t: T, actie: 'verwijderen' });
  ok('api: verwijderen', r.status === 200 && (await call(null, { t: T })).status === 404);

  // alleen ingelogd: delen, intrekken, verwijderen; tekenen mag iedereen met de link
  process.env.WEEKZICHT_WACHTWOORD = 'geheim-123';
  for (const actie of ['delen', 'intrekken', 'verwijderen']) {
    r = await call({ t: T, actie, offerte: OF });
    ok('api: ' + actie + ' zonder login → 401', r.status === 401);
  }
  await db.set('offerte:' + T, { naam: 'X', offerte: api.cleanOfferte(OF), bedrijf: {}, versie: 1, akkoord: null });
  klok = new Date('2026-10-20T10:00:00Z');
  r = await call({ t: T, actie: 'tekenen', versie: 1, naam: 'Sanne', handtekening: KRUL });
  ok('api: tekenen zonder login', r.status === 200);
  delete process.env.WEEKZICHT_WACHTWOORD;

  // ---------------------------------------------------------------- handtekening
  const kd = L.sigKader(KRUL);
  ok('sig: kader om de inkt', kd.x === 100 && kd.w === 580 && kd.punten === 30, JSON.stringify(kd));
  ok('sig: genoeg inkt', L.sigGenoeg(KRUL) && !L.sigGenoeg([[10, 10, 20, 12]]) && !L.sigGenoeg([]) && !L.sigGenoeg(null));
  const st = L.sigStukken([0, 0, 10, 10, 20, 0, 30, 10]);
  ok('sig: bochten door de middens', st.map(x => x.t).join('') === 'MQQL' && st[1].p.join() === '15,5' && st[3].p.join() === '30,10', JSON.stringify(st));
  ok('sig: losse stip wordt een puntje', L.sigStukken([5, 5]).map(x => x.t).join('') === 'ML');
  const svg = L.sigSvg(KRUL);
  ok('sig: svg bijgesneden en schaalvast', /viewBox="88 \d+ 604 \d+"/.test(svg) && /vector-effect="non-scaling-stroke"/.test(svg) && /stroke="currentColor"/.test(svg), svg.slice(0, 120));
  ok('sig: lege handtekening geeft niets', L.sigSvg([]) === '');
  ok('tijd: Nederlandse tijd voluit', L.tijdVol('2026-10-12T12:03:00.000Z') === '12 oktober 2026 om 14:03', L.tijdVol('2026-10-12T12:03:00.000Z'));

  // ---------------------------------------------------------------- pdf met handtekening
  const of = api.cleanOfferte(OF);
  const akk = { naam: 'Sanne de Vries', op: '2026-10-12T12:03:00.000Z', handtekening: KRUL };
  const zonder = L.offertePdf(of, L.bedrijf()), met = L.offertePdf(of, L.bedrijf(), akk);
  ok('pdf: zonder akkoord geen tekenblok', zonder.indexOf('(VOOR AKKOORD)') < 0 && !/ c\n/.test(zonder));
  ok('pdf: met akkoord: kop, naam en tijd', met.indexOf('(VOOR AKKOORD)') > 0 && met.indexOf('(Sanne de Vries) Tj') > 0 &&
    met.indexOf('(Online getekend op 12 oktober 2026 om 14:03) Tj') > 0);
  ok('pdf: handtekening als echte lijnen', /q 0\.11 0\.11 0\.12 RG 1\.1 w 1 J 1 j\n[\d.]+ [\d.]+ m\n/.test(met) && (met.match(/ c\n/g) || []).length === 28 && /\nS Q/.test(met));
  ok('pdf: met akkoord nog steeds alleen ASCII en één pagina', !/[^\x09\x0a\x0d\x20-\x7e]/.test(met) && (met.match(/\/Type \/Page /g) || []).length === 1);
  // de handtekening past in het vak: 190 × 62 punten vanaf de linkermarge
  const xs = [], ys = [];
  met.replace(/q 0\.11[^]*?S Q/, (blok) => {
    blok.split('\n').forEach(r => { const m = /^([\d.]+) ([\d.]+) [ml]$/.exec(r) || /([\d.]+) ([\d.]+) c$/.exec(r); if (m) { xs.push(+m[1]); ys.push(+m[2]); } });
  });
  ok('pdf: handtekening binnen het vak', xs.length > 20 && Math.min(...xs) >= 59.9 && Math.max(...xs) <= 250.1 && Math.max(...ys) - Math.min(...ys) <= 62.1,
    [Math.min(...xs), Math.max(...xs), Math.max(...ys) - Math.min(...ys)].join());
  // lange offerte: het tekenblok schuift naar een nieuwe pagina in plaats van over de voet
  const lang = Object.assign({}, of, { regels: Array.from({ length: 21 }, (_, i) => ({ oms: 'Regel ' + i, aantal: 1, prijs: 10 })) });
  const pl = L.offertePdf(lang, L.bedrijf(), akk), pagina = pl.split('/Type /Page ').length - 1;
  const laatste = pl.slice(pl.lastIndexOf('stream\n', pl.indexOf('(Online getekend')));
  ok('pdf lang: tekenblok niet over de voet', pagina >= 1 && (() => {
    const m = /[\d.]+ ([\d.]+) Td \(Online getekend/.exec(pl);
    return m && +m[1] > 72;
  })(), laatste.slice(0, 40));

  // ---------------------------------------------------------------- de offerte als webpagina
  const html = L.offerteHtml(Object.assign({}, of, { aan: 'Sanne <b>&</b> Thomas' }), L.bedrijf());
  ok('html: kop', /<span class="op-lab">Offerte<\/span><b>2026-003<\/b>/.test(html) && /Geldig tot<\/span><b>11 november 2026/.test(html));
  ok('html: veilig', html.indexOf('<b>&</b>') < 0 && html.indexOf('Sanne &lt;b&gt;&amp;&lt;/b&gt; Thomas') > 0);
  ok('html: van met adres', /Mediaspot<br>Brandemeer 6<br>Joure<br>085 060 2672/.test(html));
  ok('html: regel met titel en uitleg', /<b>Pakket Goud — 10 uur filmen<\/b><span>Met nabewerking<\/span>/.test(html));
  ok('html: aantal × prijs alleen als het ertoe doet', html.indexOf('<i>2 × €' + NB + '75,00</i>') > 0 && (html.match(/<i>/g) || []).length === 1);
  ok('html: totaal', html.indexOf('Totaal incl. btw</span><b>€' + NB + '1.049,00') > 0 && html.indexOf('Waarvan 21% btw') > 0);

  // ---------------------------------------------------------------- de keten in de browser
  await browser();
  console.log(pass + ' geslaagd, ' + fail + ' gefaald');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL uitzondering', e && e.stack); process.exit(1); });

const FIXED = Date.UTC(2026, 8, 1, 10, 0, 0);   // dinsdag 1 september 2026, 12:00
const wait = ms => new Promise(r => setTimeout(r, ms));
const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

/** Een pagina in jsdom met bevroren klok, nep-server, klembord, downloads en een nep-canvas. */
function open(url, store, extra) {
  const errors = [], downloads = [], copied = [], ctxCalls = [];
  const dom = new JSDOM(page, {
    runScripts: 'dangerously', pretendToBeVisual: true, url,
    beforeParse(win) {
      const RealDate = win.Date;
      win.Date = class extends RealDate {
        constructor(...a) { if (a.length) super(...a); else super(FIXED); }
        static now() { return FIXED; }
      };
      win.fetch = fakeApi(store);
      Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async (t) => { copied.push(t); } } });
      let last = null;
      win.URL.createObjectURL = (b) => { last = b; return 'blob:test/' + downloads.length; };
      win.URL.revokeObjectURL = () => {};
      win.HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download, blob: last }); };
      // jsdom tekent niet: een canvas dat alleen bijhoudt wat er gevraagd wordt
      win.HTMLCanvasElement.prototype.getContext = function () {
        return new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => ctxCalls.push(k)), set: (o, k, v) => { o[k] = v; return true; } });
      };
      win.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 250, right: 500, bottom: 250 });
      if (extra) extra(win);
    },
    virtualConsole: new VirtualConsole().on('jsdomError', e => errors.push('jsdomError: ' + e.message))
  });
  dom.window.addEventListener('error', e => errors.push('window error: ' + e.message));
  return { w: dom.window, d: dom.window.document, errors, downloads, copied, ctxCalls };
}

async function browser() {
  const store = new Map();
  // ---- de app: offerte maken en de akkoordlink
  const app = open('https://example.test/', store, (win) => {
    win.localStorage.setItem('weekzicht.v1', JSON.stringify({ events: [], tasks: [], leads: FIXTURE, settings: { weekend: true, dayStart: 7, dayEnd: 21 } }));
    win.localStorage.setItem('weekzicht.v1.leads-seeded', '1');
  });
  await wait(1700);   // na de eerste ronde ophalen (1,5 s); daarna haalt alleen Ververs het akkoord
  const { w, d } = app;
  const $ = id => d.getElementById(id), q = s => d.querySelector(s);
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const typ = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const stored = id => JSON.parse(w.localStorage.getItem('weekzicht.v1')).leads.find(l => l.id === id);
  let mailHref = null;
  d.addEventListener('click', (e) => { if (e.target.id === 'oMail') { mailHref = e.target.getAttribute('href'); e.preventDefault(); } });

  ok('app: geen scriptfouten', app.errors.length === 0, app.errors.join(' | '));
  click(q('.viewswitch [data-view="klanten"]'));
  click(q('#canvas .k-main[data-lead="t-cas"]'));
  click($('lMakeOfferte'));
  ok('app: akkoordvak met knop', !!$('oMaakLink') && /Stuur de klant een link/.test($('oAkkoordBox').textContent));
  click($('oMaakLink'));
  await wait(30);
  ok('app: zonder regels geen link', !stored('t-cas').offerteToken && app.downloads.length === 0);
  click(q('[data-pakket="goud"]'));
  click($('oMaakLink'));
  await wait(60);
  let l = stored('t-cas');
  ok('app: link gemaakt en bewaard', /^[a-z0-9]{22}$/.test(l.offerteToken || '') && l.offerteVersie === 1 && !!l.offerteGedeeld, JSON.stringify([l.offerteToken, l.offerteVersie]));
  ok('app: link gekopieerd', app.copied[0] === 'https://example.test/?o=' + l.offerteToken, app.copied.join());
  ok('app: link in het vak', $('oLink') && $('oLink').value === app.copied[0]);
  ok('app: op de server', store.has('offerte:' + l.offerteToken) && store.get('offerte:' + l.offerteToken).includes('Pakket Goud'));
  const token = l.offerteToken;

  click($('oMail'));
  const mail = decodeURIComponent(mailHref || '');
  ok('app: mail aan de klant', /^mailto:\?subject=Offerte 2026-001 van Mediaspot&body=Hoi Cas en Dina,/.test(mail), mail.slice(0, 90));
  ok('app: mail met de link en de datum', mail.indexOf('https://example.test/?o=' + token) > 0 && mail.indexOf('op 29 mei 2026') > 0 && mail.indexOf('geldig tot 1 oktober 2026') > 0, mail);
  typ($('oAan'), 'Cas en Dina\ncas@voorbeeld.nl\n+31 6 00000004');
  click($('oMail'));
  ok('app: e-mailadres uit "Aan"', /^mailto:cas@voorbeeld\.nl\?/.test(mailHref || ''), mailHref && mailHref.slice(0, 40));

  // opslaan werkt de versie bij de klant bij
  typ(q('#oRegels .of-prijs input'), '950');
  click($('oSave'));
  await wait(60);
  const srv = JSON.parse(store.get('offerte:' + token));
  ok('app: opslaan zet de nieuwe versie klaar', srv.offerte.regels[0].prijs === 950 && srv.offerte.aan.indexOf('cas@voorbeeld.nl') > 0 &&
    srv.versie > 1 && stored('t-cas').offerteVersie === srv.versie, [srv.versie, stored('t-cas').offerteVersie].join());
  // drie keer vlak na elkaar opslaan: één voor één naar de server, nooit twee inhouden met hetzelfde nummer
  ok('app: snel achter elkaar opslaan geeft één nieuwe versie', srv.versie === 2, srv.versie);
  ok('app: vak in het klantvenster', /Akkoordlink gestuurd/.test($('lOfferteBox').textContent));
  click($('lSave'));
  ok('app: klant opslaan houdt de link', stored('t-cas').offerteToken === token);
  ok('app: kaartje zegt gestuurd', /offerte € 950,00 · gestuurd/.test(q('#canvas').textContent));

  // ---- de klant: ?o=token
  const kl = open('https://example.test/?o=' + token, store);
  await wait(300);
  const K = kl, k$ = id => K.d.getElementById(id);
  const kclick = el => el.dispatchEvent(new K.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const pen = (type, x, y) => k$('opPad').dispatchEvent(new K.w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
  ok('klant: geen scriptfouten', K.errors.length === 0, K.errors.join(' | '));
  ok('klant: alleen de offertepagina', !k$('offertePage').hidden && K.d.querySelector('.app').hidden && k$('formPage').hidden);
  ok('klant: begroeting', /Hoi Cas en Dina, hier is jullie offerte/.test(k$('opTitle').textContent), k$('opTitle').textContent);
  ok('klant: offerte zichtbaar', !k$('opOfferte').hidden && /Pakket Goud/.test(k$('opOfferte').textContent) && /950,00/.test(k$('opOfferte').textContent));
  ok('klant: tekenvak', !k$('opTeken').hidden && /offerte 2026-001 van € 950,00 incl\. btw/.test(k$('opSamen').textContent), k$('opSamen').textContent);
  ok('klant: geldig tot in de intro', /geldig tot 1 oktober 2026/.test(k$('opIntro').textContent));
  for (const key of ['n', 'k', 'ArrowRight', '4']) K.d.dispatchEvent(new K.w.KeyboardEvent('keydown', { key, bubbles: true }));
  ok('klant: geen sneltoetsen van de planning', ['evOverlay', 'ldOverlay', 'ofOverlay'].every(id => k$(id).hidden));

  kclick(k$('opSend'));
  ok('klant: eerst je naam', /Vul je naam in/.test(k$('opStatus').textContent));
  k$('opNaam').value = 'Cas Jansen';
  kclick(k$('opSend'));
  ok('klant: dan je handtekening', /handtekening/.test(k$('opStatus').textContent));
  pen('pointerdown', 50, 150); pen('pointerup', 50, 150);
  kclick(k$('opSend'));
  ok('klant: een tik is niet genoeg', /handtekening/.test(k$('opStatus').textContent) && K.w.fetch.offerte.filter(x => x === 'POST tekenen').length === 0);
  kclick(k$('opWis'));
  ok('klant: wissen toont de hint weer', !k$('opPadHint').hidden);
  pen('pointerdown', 40, 160);
  for (let i = 1; i <= 25; i++) pen('pointermove', 40 + i * 16, 160 - Math.round(Math.sin(i / 3) * 40));
  pen('pointerup', 440, 150);
  ok('klant: hint weg na tekenen', k$('opPadHint').hidden);
  ok('klant: canvas getekend', K.ctxCalls.filter(c => c === 'lineTo').length > 20 && K.ctxCalls.includes('quadraticCurveTo'));

  // intussen past de planner de offerte aan: de klant moet de nieuwe versie zien
  click(q('#canvas .k-main[data-lead="t-cas"]'));
  click($('lEditOfferte'));
  typ(q('#oRegels .of-prijs input'), '975');
  click($('oClose'));
  await wait(60);
  kclick(k$('opSend'));
  await wait(60);
  ok('klant: versie veranderd → nieuwe offerte, opnieuw tekenen', /net aangepast/.test(k$('opStatus').textContent) && /975,00/.test(k$('opOfferte').textContent) && !k$('opTeken').hidden,
    k$('opStatus').textContent);
  ok('klant: naam blijft staan', k$('opNaam').value === 'Cas Jansen');

  kclick(k$('opSend'));
  await wait(60);
  ok('klant: getekend', !k$('opDone').hidden && k$('opTeken').hidden && /Bedankt, Cas Jansen!/.test(k$('opDone').textContent), k$('opDone').textContent.slice(0, 80));
  ok('klant: handtekening op het scherm', !!K.d.querySelector('#opDone svg.op-sig path') && /Getekend op 1 september 2026 om 12:00/.test(k$('opDone').textContent));
  const rec = JSON.parse(store.get('offerte:' + token));
  ok('klant: op de server', rec.akkoord && rec.akkoord.naam === 'Cas Jansen' && rec.akkoord.versie === rec.versie && rec.akkoord.handtekening[0].length >= 40,
    JSON.stringify(rec.akkoord && rec.akkoord.handtekening[0].slice(0, 6)));
  ok('klant: in SIG-eenheden (500 px breed → 1000)', rec.akkoord.handtekening[0][0] === 80 && rec.akkoord.handtekening[0][1] === 320, rec.akkoord.handtekening[0].slice(0, 2).join());

  kclick(k$('opPdf2'));
  await wait(30);
  ok('klant: getekende pdf downloaden', K.downloads.length === 1 && K.downloads[0].name === 'Offerte 2026-001 Mediaspot (getekend).pdf', K.downloads.map(x => x.name).join());
  const kpdf = await new Promise(res => { const fr = new K.w.FileReader(); fr.onload = () => res(fr.result); fr.readAsText(K.downloads[0].blob); });
  ok('klant: pdf met naam en handtekening', kpdf.indexOf('(Cas Jansen) Tj') > 0 && / c\n/.test(kpdf) && kpdf.indexOf('(\\200\\240975,00)') > 0);

  // later opnieuw openen: getekend, geen tekenvak
  const kl2 = open('https://example.test/?o=' + token, store);
  await wait(300);
  ok('klant later: getekend, geen tekenvak', kl2.d.getElementById('opTeken').hidden && !kl2.d.getElementById('opDone').hidden &&
    /getekend door Cas Jansen/.test(kl2.d.getElementById('opIntro').textContent));

  // ---- terug in de app: het akkoord komt binnen
  click($('lEditOfferte'));
  ok('app: nog niet binnen voor Ververs', !!$('oCheck') && !stored('t-cas').offerteAkkoord);
  click($('oCheck'));
  await wait(60);
  l = stored('t-cas');
  ok('app: akkoord opgehaald', l.offerteAkkoord && l.offerteAkkoord.naam === 'Cas Jansen' && l.offerteAkkoord.bedrijf && l.offerteAkkoord.bedrijf.naam === 'Mediaspot');
  ok('app: status naar Akkoord', l.status === 'akkoord' && !!l.calledAt);
  ok('app: getekende versie bewaard', l.offerte.regels[0].prijs === 975);
  ok('app: venster op slot', $('oNummer').disabled && q('#oRegels .of-prijs input').disabled && $('ob_iban').disabled && !$('oIntrekken').disabled &&
    q('.of-modal').classList.contains('of-dicht') && $('oSave').textContent === 'Sluiten' && $('oDelete').hidden);
  ok('app: handtekening in het vak', !!q('#oAkkoordBox svg.of-sig') && /Cas Jansen/.test($('oAkkoordBox').textContent));
  click($('oPdf'));
  await wait(30);
  ok('app: pdf heet getekend', app.downloads.length === 1 && app.downloads[0].name === 'Offerte 2026-001 Cas en Dina (getekend).pdf', app.downloads.map(x => x.name).join());
  const apdf = await new Promise(res => { const fr = new w.FileReader(); fr.onload = () => res(fr.result); fr.readAsText(app.downloads[0].blob); });
  ok('app: pdf met handtekening', apdf.indexOf('(Online getekend op 1 september 2026 om 12:00) Tj') > 0);
  click($('oClose'));
  ok('app: vak in het klantvenster: getekend', /Getekend door Cas Jansen/.test($('lOfferteBox').textContent));
  ok('app: status in het klantvenster mee', q('#lStatus [aria-pressed="true"]') && /Akkoord/.test(q('#lStatus [aria-pressed="true"]').textContent));
  click($('lSave'));
  ok('app: klant opslaan houdt het akkoord', stored('t-cas').offerteAkkoord && stored('t-cas').status === 'akkoord');
  ok('app: kaartje zegt getekend', /offerte € 975,00 · getekend/.test(q('#canvas').textContent));

  // ---- toch wijzigen: in twee stappen, daarna open en opnieuw te tekenen
  click(q('#canvas .k-main[data-lead="t-cas"]'));
  click($('lEditOfferte'));
  click($('oIntrekken'));
  ok('app: intrekken vraagt eerst', /Zeker/.test($('oIntrekken').textContent) && !!stored('t-cas').offerteAkkoord);
  click($('oIntrekken'));
  await wait(60);
  ok('app: handtekening weg, venster open', !stored('t-cas').offerteAkkoord && !$('oNummer').disabled && !q('.of-modal').classList.contains('of-dicht') && !!$('oLink'));
  ok('app: server ook', JSON.parse(store.get('offerte:' + token)).akkoord === null);
  typ(q('#oRegels .of-prijs input'), '999');
  click($('oSave'));
  await wait(60);
  const kl3 = open('https://example.test/?o=' + token, store);
  await wait(300);
  ok('klant: na wijzigen weer tekenen, nieuwe prijs', !kl3.d.getElementById('opTeken').hidden && /999,00/.test(kl3.d.getElementById('opOfferte').textContent));

  // ---- verlopen: geen tekenvak, en de app waarschuwt
  click(q('#canvas .k-main[data-lead="t-cas"]'));
  click($('lEditOfferte'));
  $('oGeldig').value = '2026-08-31';
  typ($('oGeldig'), '2026-08-31');
  click($('oSave'));
  await wait(60);
  click($('lEditOfferte'));
  ok('app: waarschuwing bij verlopen', /Verlopen op 31 augustus 2026/.test($('oAkkoordBox').textContent));
  click($('oClose'));
  const kl4 = open('https://example.test/?o=' + token, store);
  await wait(300);
  ok('klant: verlopen → geen tekenvak', kl4.d.getElementById('opTeken').hidden && /was geldig tot 31 augustus 2026/.test(kl4.d.getElementById('opIntro').textContent));

  // ---- offerte verwijderen haalt de link weg
  click($('lEditOfferte'));
  click($('oDelete'));
  click($('oDelete'));
  await wait(60);
  l = stored('t-cas');
  ok('app: verwijderen haalt alle offertevelden weg', !l.offerte && !l.offerteToken && !l.offerteVersie && !l.offerteGedeeld && !l.offerteAkkoord);
  ok('app: en de link op de server', !store.has('offerte:' + token));
  const kl5 = open('https://example.test/?o=' + token, store);
  await wait(300);
  ok('klant: link niet meer geldig', /niet \(meer\) geldig/.test(kl5.d.getElementById('opIntro').textContent) && kl5.d.getElementById('opOfferte').hidden);

  ok('app: geen scriptfouten na alles', app.errors.length === 0, app.errors.join(' | '));
  ok('klant: geen scriptfouten na alles', [K, kl2, kl3, kl4, kl5].every(x => x.errors.length === 0), [K, kl2, kl3, kl4, kl5].map(x => x.errors.join()).join(' | '));
}
