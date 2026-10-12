// Mailen via Forward Email: het verzoek aan de API, de mail in de huisstijl,
// mailen vanuit de offerte, de melding en bevestiging na het tekenen (met de
// getekende pdf), en de knoppen in de app en op de klantpagina. Er gaat niets
// echt de deur uit: de verzender is overal nagemaakt.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const mail = require('../api/_mail.js');
const api = require('../api/offerte.js');
const pdfLib = require('../api/_offertepdf.js');
const FIXTURE = require('./fixture.js');
const fakeApi = require('./fake-api.js');

let fail = 0, pass = 0;
function ok(name, cond, extra) {
  if (cond) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? '→ ' + extra : ''); }
}
const pdfVan = (b64) => Buffer.from(b64, 'base64').toString('latin1');
const KRUL = [Array.from({ length: 30 }, (_, i) => [100 + i * 20, 250 + Math.round(Math.sin(i / 3) * 80)]).flat()];

/** Een verzender die alleen onthoudt wat hij had moeten versturen. */
function nepVerzender(opties) {
  const o = opties || {};
  const v = {
    verstuurd: [],
    aan: () => o.aan !== false,
    van: () => 'info@mediaspot.nl',
    meldingen: () => o.meldingen === undefined ? 'info@mediaspot.nl' : o.meldingen,
    async verstuur(m) {
      if (o.fout) throw new Error(o.fout);
      v.verstuurd.push(m);
      return { id: 'nep' + v.verstuurd.length };
    }
  };
  return v;
}

(async () => {
  // ---------------------------------------------------------------- _mail.js
  ok('geldig adres', mail.geldig('a@b.nl') && !mail.geldig('a@b') && !mail.geldig('a@b.nl, c@d.nl') && !mail.geldig('Naam <a@b.nl>') && !mail.geldig(''));
  ok('adres uit "Naam <adres>"', mail.adresVan('Mediaspot <info@mediaspot.nl>') === 'info@mediaspot.nl' && mail.adresVan('info@mediaspot.nl') === 'info@mediaspot.nl' && mail.adresVan('onzin') === '');

  delete process.env.MAIL_VAN; delete process.env.MAIL_WACHTWOORD; delete process.env.MAIL_MELDINGEN;
  ok('zonder instellingen staat mailen uit', mail.forwardEmail().aan() === false);
  process.env.MAIL_VAN = 'Mediaspot <info@mediaspot.nl>';
  ok('zonder wachtwoord ook uit', mail.forwardEmail().aan() === false);
  process.env.MAIL_WACHTWOORD = 'geheim-alias';
  ok('met afzender en wachtwoord aan', mail.forwardEmail().aan() === true && mail.forwardEmail().van() === 'info@mediaspot.nl');
  ok('meldingen standaard naar de afzender', mail.forwardEmail().meldingen() === 'info@mediaspot.nl');
  process.env.MAIL_MELDINGEN = 'daniel@voorbeeld.nl';
  ok('meldingen naar een eigen adres', mail.forwardEmail().meldingen() === 'daniel@voorbeeld.nl');

  const verzoeken = [];
  const fe = mail.forwardEmail(async (url, opts) => { verzoeken.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ id: 'abc' }) }; });
  const r1 = await fe.verstuur({ aan: 'klant@voorbeeld.nl', onderwerp: 'Offerte', tekst: 'Hoi', html: '<p>Hoi</p>', antwoordAan: 'klant2@voorbeeld.nl',
    bijlagen: [{ naam: 'Offerte.pdf', base64: 'JVBERi0=' }] });
  const v = verzoeken[0], body = JSON.parse(v.opts.body);
  ok('api: juiste adres en methode', v.url === 'https://api.forwardemail.net/v1/emails' && v.opts.method === 'POST');
  ok('api: inloggen met alias en wachtwoord', v.opts.headers.Authorization === 'Basic ' + Buffer.from('info@mediaspot.nl:geheim-alias').toString('base64'));
  ok('api: van, aan, onderwerp, tekst, html', body.from === 'Mediaspot <info@mediaspot.nl>' && body.to === 'klant@voorbeeld.nl' && body.subject === 'Offerte' &&
    body.text === 'Hoi' && body.html === '<p>Hoi</p>' && body.replyTo === 'klant2@voorbeeld.nl');
  ok('api: bijlage als base64', body.attachments.length === 1 && body.attachments[0].filename === 'Offerte.pdf' && body.attachments[0].content === 'JVBERi0=' &&
    body.attachments[0].encoding === 'base64' && body.attachments[0].contentType === 'application/pdf');
  ok('api: id terug', r1.id === 'abc');
  const feFout = mail.forwardEmail(async () => ({ ok: false, status: 403, json: async () => ({ message: 'Alias does not exist' }) }));
  let fout = '';
  try { await feFout.verstuur({ aan: 'a@b.nl', onderwerp: 'x', tekst: 'x' }); } catch (e) { fout = e.message; }
  ok('api: foutmelding van Forward Email komt door', fout === 'Alias does not exist', fout);
  delete process.env.MAIL_VAN; delete process.env.MAIL_WACHTWOORD; delete process.env.MAIL_MELDINGEN;

  const th = mail.tekstHtml('Hoi <Sanne>,\n\nKijk: https://x.test/?o=abc&d=1\nGroet');
  ok('html: veilig, alinea\'s, link klikbaar', th.indexOf('&lt;Sanne&gt;') > 0 && (th.match(/<p /g) || []).length === 2 &&
    th.indexOf('<a href="https://x.test/?o=abc&amp;d=1"') > 0 && th.indexOf('<br>Groet') > 0, th);
  const mh = mail.mailHtml({ tekst: 'Hoi', knop: { tekst: 'Bekijk', url: 'https://x.test/?o=a' }, logo: 'https://x.test/mail-logo.png',
    bedrijf: { naam: 'Mediaspot', adres: 'Brandemeer 6\nJoure', telefoon: '085 060 2672' } });
  ok('html: logo, knop en voet', mh.indexOf('src="https://x.test/mail-logo.png"') > 0 && mh.indexOf('href="https://x.test/?o=a"') > 0 &&
    mh.indexOf('>Bekijk</a>') > 0 && mh.indexOf('Mediaspot &middot; Brandemeer 6, Joure &middot; 085 060 2672') > 0);

  // ---------------------------------------------------------------- de offerte-api met mail
  const db = api.memoryStore();
  const klok = () => new Date('2026-10-12T12:03:00Z');
  async function call(body, query, verzender, headers) {
    let status = 0, out = '';
    const res = { statusCode: 200, setHeader() {}, end(s) { status = res.statusCode; out = s; } };
    await api.handle({ method: body ? 'POST' : 'GET', headers: headers || {}, query: query || {}, body }, res, db, { nu: klok, mail: verzender });
    return { status, data: out ? JSON.parse(out) : null };
  }
  const T = 'mailtest00000000000001';
  const OF = { nummer: '2026-007', datum: '2026-10-12', geldig: '2026-11-11', aan: 'Sanne & Thomas\nsanne@voorbeeld.nl', betreft: 'Bruiloftsfilm',
    regels: [{ oms: 'Pakket Goud', aantal: 1, prijs: 899 }], btw: 'incl', tarief: 21, tekst: '' };
  const B = { naam: 'Mediaspot', adres: 'Brandemeer 6\nJoure', telefoon: '085 060 2672', kvk: '96808845' };
  const nv = nepVerzender();

  let r = await call(null, { mail: '1' }, nv);
  ok('status: mailen aan, met afzender', r.status === 200 && r.data.mail === true && r.data.van === 'info@mediaspot.nl');
  r = await call(null, { mail: '1' }, nepVerzender({ aan: false }));
  ok('status: mailen uit, geen afzender', r.data.mail === false && r.data.van === '');
  await call({ t: T, actie: 'delen', naam: 'Sanne & Thomas', offerte: OF, bedrijf: B }, null, nv);
  r = await call(null, { t: T }, nv);
  ok('ophalen zegt of mailen aan staat', r.data.mail === true);

  r = await call({ t: T, actie: 'mailen', aan: 'sanne@voorbeeld.nl', onderwerp: 'x', tekst: 'x' }, null, nepVerzender({ aan: false }));
  ok('mailen: uit → 503 met uitleg', r.status === 503 && /MAIL_VAN/.test(r.data.melding));
  r = await call({ t: T, actie: 'mailen', aan: 'sanne@', onderwerp: 'x', tekst: 'x' }, null, nv);
  ok('mailen: ongeldig adres', r.status === 400 && r.data.error === 'email');
  r = await call({ t: T, actie: 'mailen', aan: 'sanne@voorbeeld.nl', onderwerp: '', tekst: 'x' }, null, nv);
  ok('mailen: leeg onderwerp', r.status === 400 && r.data.error === 'leeg');
  r = await call({ t: 'onbekendtoken000000001', actie: 'mailen', aan: 'sanne@voorbeeld.nl', onderwerp: 'x', tekst: 'x' }, null, nv);
  ok('mailen: onbekende link', r.status === 404);
  r = await call({ t: T, actie: 'mailen', aan: 'sanne@voorbeeld.nl', onderwerp: 'Offerte 2026-007', tekst: 'Hoi Sanne,\n\nhttps://x/?o=' + T, pdf: true }, null, nv,
    { host: 'planning.voorbeeld.nl', 'x-forwarded-proto': 'https' });
  const m1 = nv.verstuurd[0];
  ok('mailen: verstuurd', r.status === 200 && r.data.aan === 'sanne@voorbeeld.nl' && r.data.op && m1 && m1.aan === 'sanne@voorbeeld.nl' && m1.onderwerp === 'Offerte 2026-007');
  ok('mailen: knop naar de link op deze deploy', m1.html.indexOf('href="https://planning.voorbeeld.nl/?o=' + T + '"') > 0 && m1.html.indexOf('Bekijk en teken de offerte') > 0 &&
    m1.html.indexOf('https://planning.voorbeeld.nl/mail-logo.png') > 0);
  ok('mailen: pdf in de bijlage', m1.bijlagen.length === 1 && m1.bijlagen[0].naam === 'Offerte 2026-007 Mediaspot.pdf' &&
    pdfVan(m1.bijlagen[0].base64).startsWith('%PDF-1.4') && pdfVan(m1.bijlagen[0].base64).indexOf('(Pakket Goud)') > 0);
  ok('mailen: logboek', JSON.parse(JSON.stringify((await db.get('offerte:' + T)).mails)).length === 1);
  r = await call({ t: T, actie: 'mailen', aan: 'sanne@voorbeeld.nl', onderwerp: 'x', tekst: 'x', pdf: false }, null, nv);
  ok('mailen: zonder pdf', r.status === 200 && !nv.verstuurd[1].bijlagen);
  r = await call({ t: T, actie: 'mailen', aan: 'sanne@voorbeeld.nl', onderwerp: 'x', tekst: 'x' }, null, nepVerzender({ fout: 'Alias does not exist' }));
  ok('mailen: fout van Forward Email', r.status === 502 && /Alias does not exist/.test(r.data.melding));
  const log = (await db.get('offerte:' + T)).mails;
  ok('mailen: mislukte poging in het logboek', log.length === 3 && log[2].ok === false && /Alias/.test(log[2].fout));
  process.env.WEEKZICHT_WACHTWOORD = 'geheim-123';
  r = await call({ t: T, actie: 'mailen', aan: 'sanne@voorbeeld.nl', onderwerp: 'x', tekst: 'x' }, null, nv);
  ok('mailen: alleen ingelogd', r.status === 401);
  delete process.env.WEEKZICHT_WACHTWOORD;
  ok('delen houdt het logboek', (await call({ t: T, actie: 'delen', naam: 'Sanne & Thomas', offerte: Object.assign({}, OF, { tekst: 'nieuw' }), bedrijf: B }, null, nv)).status === 200 &&
    (await db.get('offerte:' + T)).mails.length === 3);

  // tekenen: melding en bevestiging
  const versie = (await call(null, { t: T }, nv)).data.versie;
  r = await call({ t: T, actie: 'tekenen', versie, naam: 'Sanne de Vries', email: 'sanne@', handtekening: KRUL }, null, nv);
  ok('tekenen: ongeldig e-mailadres', r.status === 400 && r.data.error === 'email' && !(await db.get('offerte:' + T)).akkoord);
  const nv2 = nepVerzender({ meldingen: 'daniel@voorbeeld.nl' });
  r = await call({ t: T, actie: 'tekenen', versie, naam: 'Sanne de Vries', email: 'sanne@voorbeeld.nl', handtekening: KRUL }, null, nv2);
  ok('tekenen: gelukt, bevestiging verstuurd', r.status === 200 && r.data.bevestiging === true && r.data.akkoord.email === 'sanne@voorbeeld.nl');
  const melding = nv2.verstuurd.find(m => m.aan === 'daniel@voorbeeld.nl'), bev = nv2.verstuurd.find(m => m.aan === 'sanne@voorbeeld.nl');
  ok('tekenen: melding aan de planner', melding && /^Getekend: offerte 2026-007 \(Sanne & Thomas\)$/.test(melding.onderwerp) &&
    /Sanne de Vries heeft offerte 2026-007 van € 899,00 getekend op 12 oktober 2026 om 14:03/.test(melding.tekst) && melding.antwoordAan === 'sanne@voorbeeld.nl',
    melding && melding.tekst);
  ok('tekenen: bevestiging aan de klant', bev && bev.onderwerp === 'Bevestiging: offerte 2026-007 van Mediaspot' && /^Hoi Sanne de Vries,/.test(bev.tekst) && /085 060 2672/.test(bev.tekst));
  const getekend = pdfVan(bev.bijlagen[0].base64);
  ok('tekenen: getekende pdf in de bijlage', bev.bijlagen[0].naam === 'Offerte 2026-007 Mediaspot (getekend).pdf' && getekend.indexOf('(Sanne de Vries) Tj') > 0 &&
    getekend.indexOf('(Online getekend op 12 oktober 2026 om 14:03) Tj') > 0 && / c\n/.test(getekend) && melding.bijlagen[0].base64 === bev.bijlagen[0].base64);
  ok('tekenen: logboek', (await db.get('offerte:' + T)).mails.filter(x => x.soort !== 'offerte').length === 2);

  // zonder e-mailadres: alleen de melding; mail die mislukt maakt het akkoord niet ongedaan
  const T2 = 'mailtest00000000000002';
  await call({ t: T2, actie: 'delen', naam: 'X', offerte: OF, bedrijf: B }, null, nv);
  const nv3 = nepVerzender();
  r = await call({ t: T2, actie: 'tekenen', versie: 1, naam: 'Thomas', handtekening: KRUL }, null, nv3);
  ok('tekenen zonder e-mail: alleen een melding', r.status === 200 && r.data.bevestiging === false && nv3.verstuurd.length === 1 && nv3.verstuurd[0].aan === 'info@mediaspot.nl' && !nv3.verstuurd[0].antwoordAan);
  const T3 = 'mailtest00000000000003';
  await call({ t: T3, actie: 'delen', naam: 'X', offerte: OF, bedrijf: B }, null, nv);
  r = await call({ t: T3, actie: 'tekenen', versie: 1, naam: 'Thomas', email: 'thomas@voorbeeld.nl', handtekening: KRUL }, null, nepVerzender({ fout: 'stuk' }));
  const rec3 = await db.get('offerte:' + T3);
  ok('tekenen: mail stuk → akkoord staat toch', r.status === 200 && r.data.bevestiging === false && rec3.akkoord && rec3.akkoord.naam === 'Thomas' &&
    rec3.mails.length === 2 && rec3.mails.every(x => !x.ok));
  const T4 = 'mailtest00000000000004';
  await call({ t: T4, actie: 'delen', naam: 'X', offerte: OF, bedrijf: B }, null, nv);
  const nv4 = nepVerzender({ aan: false });
  r = await call({ t: T4, actie: 'tekenen', versie: 1, naam: 'Thomas', email: 'thomas@voorbeeld.nl', handtekening: KRUL }, null, nv4);
  ok('tekenen met mailen uit: geen mail, wel akkoord', r.status === 200 && r.data.bevestiging === false && nv4.verstuurd.length === 0 && !(await db.get('offerte:' + T4)).mails);

  // adres van de deploy
  ok('basis: host en proto', api.basis({ headers: { 'x-forwarded-host': 'a.vercel.app', 'x-forwarded-proto': 'https' } }) === 'https://a.vercel.app');
  ok('basis: lokaal http', api.basis({ headers: { host: '127.0.0.1:8787' } }) === 'http://127.0.0.1:8787');
  ok('basis: rare host → vaste site', api.basis({ headers: { host: 'a b"<' } }) === 'https://planning-app-three.vercel.app' && api.basis({}) === 'https://planning-app-three.vercel.app');

  // de pdf op de server is dezelfde als in de app
  const L = require('./_offerte-lib.js');
  const akk = { naam: 'Sanne', op: '2026-10-12T12:03:00Z', handtekening: KRUL };
  ok('server-pdf gelijk aan de app', pdfVan(pdfLib.pdfBase64(api.cleanOfferte(OF), B, akk)) === L.offertePdf(api.cleanOfferte(OF), B, akk));

  await browser();
  console.log(pass + ' geslaagd, ' + fail + ' gefaald');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL uitzondering', e && e.stack); process.exit(1); });

// ---------------------------------------------------------------- in de browser
const FIXED = Date.UTC(2026, 8, 1, 10, 0, 0);
const wait = ms => new Promise(r => setTimeout(r, ms));
const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function open(url, fetchFn, extra) {
  const errors = [];
  const dom = new JSDOM(page, {
    runScripts: 'dangerously', pretendToBeVisual: true, url,
    beforeParse(win) {
      const RealDate = win.Date;
      win.Date = class extends RealDate {
        constructor(...a) { if (a.length) super(...a); else super(FIXED); }
        static now() { return FIXED; }
      };
      win.fetch = fetchFn;
      Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async () => {} } });
      win.HTMLCanvasElement.prototype.getContext = function () {
        return new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
      };
      win.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 250, right: 500, bottom: 250 });
      if (extra) extra(win);
    },
    virtualConsole: new VirtualConsole().on('jsdomError', e => errors.push('jsdomError: ' + e.message))
  });
  dom.window.addEventListener('error', e => errors.push('window error: ' + e.message));
  return { w: dom.window, d: dom.window.document, errors };
}

async function browser() {
  const store = new Map(), nv = nepVerzender();
  const f = fakeApi(store, { mail: nv });
  const app = open('https://example.test/', f, (win) => {
    win.localStorage.setItem('weekzicht.v1', JSON.stringify({ events: [], tasks: [], leads: FIXTURE, settings: { weekend: true, dayStart: 7, dayEnd: 21 } }));
    win.localStorage.setItem('weekzicht.v1.leads-seeded', '1');
  });
  await wait(1700);
  const { w, d } = app, $ = id => d.getElementById(id), q = s => d.querySelector(s);
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const typ = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const stored = id => JSON.parse(w.localStorage.getItem('weekzicht.v1')).leads.find(l => l.id === id);

  click(q('.viewswitch [data-view="klanten"]'));
  click(q('#canvas .k-main[data-lead="t-cas"]'));
  click($('lMakeOfferte'));
  await wait(30);
  click(q('[data-pakket="goud"]'));
  typ($('oAan'), 'Cas en Dina\ncas@voorbeeld.nl');
  click($('oMaakLink'));
  await wait(60);
  ok('app: met mailen aan een knop i.p.v. je mailprogramma', !!$('oMailNu') && !$('oMail'));
  click($('oMailNu'));
  ok('app: mailvenster ingevuld', !$('oMailForm').hidden && $('omAan').value === 'cas@voorbeeld.nl' &&
    $('omOnderwerp').value === 'Offerte 2026-001 van Mediaspot' && /^Hoi Cas en Dina,/.test($('omTekst').value) && $('omTekst').value.indexOf('?o=' + stored('t-cas').offerteToken) > 0);
  ok('app: afzender genoemd', /info@mediaspot\.nl/.test($('omVan').textContent));
  typ($('omTekst'), $('omTekst').value + '\n\nPS: tot zaterdag!');
  $('omAan').value = 'cas@';
  click($('omVerstuur'));
  await wait(30);
  ok('app: ongeldig adres niet versturen', nv.verstuurd.length === 0 && !$('oMailForm').hidden);
  $('omAan').value = 'cas@voorbeeld.nl';
  click($('omVerstuur'));
  await wait(80);
  const m = nv.verstuurd[0];
  ok('app: mail verstuurd met pdf', m && m.aan === 'cas@voorbeeld.nl' && /PS: tot zaterdag!$/.test(m.tekst) && m.bijlagen && m.bijlagen.length === 1, nv.verstuurd.length);
  ok('app: venster dicht, stand in het vak', $('oMailForm').hidden && /gemaild naar cas@voorbeeld\.nl/.test($('oAkkoordBox').textContent));
  ok('app: bewaard bij de klant', stored('t-cas').offerteGemaild && stored('t-cas').offerteGemaild.aan === 'cas@voorbeeld.nl');
  click($('oClose'));
  ok('app: klantvenster noemt het', /Gemaild naar cas@voorbeeld\.nl/.test($('lOfferteBox').textContent));

  // de klant tekent en geeft zijn e-mailadres
  const token = stored('t-cas').offerteToken;
  const kl = open('https://example.test/?o=' + token, f);
  await wait(300);
  const k$ = id => kl.d.getElementById(id), kclick = el => el.dispatchEvent(new kl.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const pen = (type, x, y) => k$('opPad').dispatchEvent(new kl.w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
  ok('klant: e-mailveld, al ingevuld uit de offerte', !k$('opMailVeld').hidden && k$('opMail').value === 'cas@voorbeeld.nl');
  k$('opNaam').value = 'Cas Jansen';
  pen('pointerdown', 40, 160);
  for (let i = 1; i <= 25; i++) pen('pointermove', 40 + i * 16, 160 - Math.round(Math.sin(i / 3) * 40));
  pen('pointerup', 440, 150);
  k$('opMail').value = 'cas@@';
  kclick(k$('opSend'));
  ok('klant: ongeldig adres', /klopt niet/.test(k$('opStatus').textContent));
  k$('opMail').value = 'cas.jansen@voorbeeld.nl';
  kclick(k$('opSend'));
  await wait(80);
  ok('klant: getekend, bevestiging per mail genoemd', !k$('opDone').hidden && /ook per mail op cas\.jansen@voorbeeld\.nl/.test(k$('opDone').textContent), k$('opDone').textContent.slice(0, 160));
  const bev = nv.verstuurd.find(x => x.aan === 'cas.jansen@voorbeeld.nl'), mel = nv.verstuurd.find(x => x.aan === 'info@mediaspot.nl');
  ok('klant: bevestiging en melding met de getekende pdf', bev && mel && pdfVan(bev.bijlagen[0].base64).indexOf('(Cas Jansen) Tj') > 0);

  // klantpagina zonder mailen: geen e-mailveld
  const store2 = new Map();
  const f2 = fakeApi(store2);
  await f2('https://example.test/api/offerte', { method: 'POST', body: JSON.stringify({ t: 'zondermail0000000000001', actie: 'delen', naam: 'X',
    offerte: { nummer: '1', regels: [{ oms: 'x', prijs: 1 }], geldig: '2026-12-01' }, bedrijf: {} }) });
  const kl2 = open('https://example.test/?o=zondermail0000000000001', f2);
  await wait(300);
  ok('klant zonder mailen: geen e-mailveld', !kl2.d.getElementById('opTeken').hidden && kl2.d.getElementById('opMailVeld').hidden);

  // app zonder mailen: gewoon je mailprogramma
  const app2 = open('https://example.test/', fakeApi(new Map()), (win) => {
    win.localStorage.setItem('weekzicht.v1', JSON.stringify({ events: [], tasks: [], leads: FIXTURE, settings: { weekend: true, dayStart: 7, dayEnd: 21 } }));
    win.localStorage.setItem('weekzicht.v1.leads-seeded', '1');
  });
  await wait(1700);
  const a$ = id => app2.d.getElementById(id), aq = s => app2.d.querySelector(s), aclick = el => el.dispatchEvent(new app2.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  aclick(aq('.viewswitch [data-view="klanten"]'));
  aclick(aq('#canvas .k-main[data-lead="t-cas"]'));
  aclick(a$('lMakeOfferte'));
  aclick(aq('[data-pakket="goud"]'));
  aclick(a$('oMaakLink'));
  await wait(60);
  ok('app zonder mailen: link naar je mailprogramma', !!a$('oMail') && !a$('oMailNu'));

  ok('geen scriptfouten', [app, kl, kl2, app2].every(x => x.errors.length === 0), [app, kl, kl2, app2].map(x => x.errors.join()).join(' | '));
}
