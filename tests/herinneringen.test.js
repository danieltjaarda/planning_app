// Meldingen per mail: het dagoverzicht, de herinnering vooraf, niets dubbel,
// de cron-functie zelf, de meldingen als een klant iets doet, en de
// instellingen in de app. Er gaat niets echt de deur uit.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const H = require('../api/herinneringen.js');
const M = require('../api/_meldingen.js');
const opslag = require('../api/_opslag.js');
const formulier = require('../api/formulier.js');
const muziek = require('../api/muziek.js');
const FIXTURE = require('./fixture.js');
const fakeApi = require('./fake-api.js');

let fail = 0, pass = 0;
function ok(name, cond, extra) {
  if (cond) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? '→ ' + extra : ''); }
}

function nepVerzender(o) {
  o = o || {};
  const v = {
    verstuurd: [], pogingen: 0,
    aan: () => o.aan !== false,
    van: () => 'daniel@mediaspot.nl',
    meldingen: () => 'daniel@mediaspot.nl',
    async verstuur(m) { v.pogingen++; if (o.fout) throw new Error(o.fout); v.verstuurd.push(m); return { id: 'x' }; }
  };
  return v;
}

// maandag 12 oktober 2026; Nederland zit dan in de zomertijd (UTC+2)
const op = (hhmm, dag) => new Date('2026-10-' + (dag || '12') + 'T' + hhmm + ':00+02:00');
const PLAN = {
  events: {
    e1: { title: 'Overleg trouwlocatie', date: '2026-10-12', start: '13:00', end: '14:00', allDay: false, loc: 'Kasteel X', note: 'Vragen over de drone' },
    e2: { title: 'Verjaardag oma', date: '2026-10-12', start: '00:00', end: '23:59', allDay: true },
    e3: { title: 'Nachtshoot', date: '2026-10-13', start: '00:10', end: '01:00', allDay: false },
    e4: { title: 'Andere dag', date: '2026-10-20', start: '10:00', end: '11:00', allDay: false }
  },
  leads: {
    l1: { name: 'Lisa van Duijn', phone: '06 11072589', status: 'gepland', callDate: '2026-10-12', callTime: '15:00', note: 'Wacht op een datum' },
    l2: { name: 'Afgevallen klant', status: 'af', callDate: '2026-10-12', callTime: '15:00' },
    l3: { name: 'Mathijs & Gerriette', phone: '06 51581138', status: 'akkoord', date: '2026-10-12', start: '07:00', end: '12:30' },
    l4: { name: 'Julian en Inge', status: 'akkoord', date: '2026-10-13', start: '13:30', end: '23:30' },
    l5: { name: 'Nog niet geboekt', status: 'wacht', date: '2026-10-12', start: '10:00', end: '18:00' }
  },
  tasks: {
    t1: { title: 'Factuur Ellen sturen', due: '2026-10-10', done: false },
    t2: { title: 'Draaiboek doornemen', due: '2026-10-12', done: false },
    t3: { title: 'Al gedaan', due: '2026-10-11', done: true },
    t4: { title: 'Later', due: '2026-10-30', done: false },
    t5: { title: 'Zonder datum', done: false }
  },
  meta: {}
};
const STD = M.instellingen(null);

(async () => {
  // ---------------------------------------------------------------- instellingen en tijd
  ok('standaard: dagoverzicht 07:00, 30 min vooraf, klant aan', STD.dagoverzicht && STD.dagTijd === '07:00' && STD.vooraf === 30 && STD.klant);
  const raar = M.instellingen({ dagoverzicht: 'ja', dagTijd: '25:00', vooraf: 7, klant: false });
  ok('instellingen: onzin wordt standaard, geldig blijft', raar.dagoverzicht === true && raar.dagTijd === '07:00' && raar.vooraf === 30 && raar.klant === false);
  ok('tijd: Nederland in de zomer', JSON.stringify(H.nuIn(new Date('2026-10-12T05:00:00Z'))) === '{"datum":"2026-10-12","min":420}');
  ok('tijd: Nederland in de winter', JSON.stringify(H.nuIn(new Date('2026-12-01T23:30:00Z'))) === '{"datum":"2026-12-02","min":30}');

  // ---------------------------------------------------------------- vooraf
  let p = H.plan(PLAN, STD, op('12:30'), {});
  ok('vooraf: afspraak over 30 min', p.length === 1 && p[0].onderwerp === 'Om 13:00: Overleg trouwlocatie' &&
    /Om 13:00 \(tot 14:00\): Overleg trouwlocatie\nLocatie: Kasteel X\nNotitie: Vragen over de drone/.test(p[0].tekst), JSON.stringify(p));
  ok('vooraf: 31 min is nog te vroeg', H.plan(PLAN, STD, op('12:29'), {}).length === 0);
  ok('vooraf: begonnen is te laat', H.plan(PLAN, STD, op('13:00'), {}).length === 0);
  p = H.plan(PLAN, STD, op('14:40'), {});
  ok('vooraf: belafspraak met telefoon, afgevallen klant niet', p.length === 1 && p[0].onderwerp === 'Om 15:00: Bellen met Lisa van Duijn' &&
    /Telefoon: 06 11072589/.test(p[0].tekst) && !/Afgevallen/.test(p[0].tekst), JSON.stringify(p));
  ok('vooraf: geen herinnering voor klussen of hele dagen', H.plan(PLAN, STD, op('06:45'), { 'd:2026-10-12': { op: 'x' } }).length === 0);
  p = H.plan(PLAN, STD, op('23:50'), {});
  ok('vooraf: over middernacht heen', p.length === 1 && /Nachtshoot/.test(p[0].onderwerp));
  const twee = JSON.parse(JSON.stringify(PLAN));
  twee.events.e5 = { title: 'Tweede', date: '2026-10-12', start: '13:00', end: '13:30', allDay: false };
  p = H.plan(twee, STD, op('12:45'), {});
  ok('vooraf: twee tegelijk in één mail', p.length === 1 && p[0].onderwerp === 'Om 13:00: 2 afspraken' && p[0].sleutels.length === 2);
  const al = {}; p[0].sleutels.forEach(k => { al[k] = { op: 'x' }; });
  ok('vooraf: niets dubbel', H.plan(twee, STD, op('12:50'), al).length === 0);
  ok('vooraf: na 3 mislukte pogingen opgeven', H.plan(PLAN, STD, op('12:45'), { 'v:afspraak:e1:2026-10-12T13:00': { pogingen: 3 } }).length === 0);
  ok('vooraf: 2 mislukte pogingen → nog eens', H.plan(PLAN, STD, op('12:45'), { 'v:afspraak:e1:2026-10-12T13:00': { pogingen: 2 } }).length === 1);
  ok('vooraf uit', H.plan(PLAN, M.instellingen({ vooraf: 0 }), op('12:45'), {}).length === 0);
  ok('vooraf 2 uur', H.plan(PLAN, M.instellingen({ vooraf: 120 }), op('11:05'), {}).length === 1);

  // ---------------------------------------------------------------- dagoverzicht
  ok('dag: om 06:59 nog niet', H.plan(PLAN, STD, op('06:59'), {}).filter(x => x.sleutels[0].startsWith('d:')).length === 0);
  p = H.plan(PLAN, STD, op('07:00'), {});
  const dag = p.find(x => x.sleutels[0] === 'd:2026-10-12');
  ok('dag: om 07:00', dag && dag.onderwerp === 'Vandaag: 4 afspraken, 2 taken · maandag 12 oktober', dag && dag.onderwerp);
  ok('dag: op volgorde, hele dag eerst', dag && /Hele dag · Verjaardag oma\n\n07:00–12:30 · Mathijs & Gerriette \(klus\) · 06 51581138\n\n13:00–14:00 · Overleg trouwlocatie · Kasteel X\nVragen over de drone\n\n15:00 · Bellen met Lisa van Duijn · 06 11072589/.test(dag.tekst), dag && dag.tekst);
  ok('dag: niet-geboekte klus en afgevallen klant niet', dag && !/Nog niet geboekt/.test(dag.tekst) && !/Afgevallen/.test(dag.tekst));
  ok('dag: taken van vandaag en te laat, niet gedaan of later', dag && /Taken:\n• Factuur Ellen sturen \(was voor zaterdag 10 oktober\)\n• Draaiboek doornemen$/m.test(dag.tekst) &&
    !/Al gedaan|Later|Zonder datum/.test(dag.tekst), dag && dag.tekst);
  ok('dag: bruiloft van morgen', dag && /Morgen:\n• 13:30–23:30 · Julian en Inge \(klus\)/.test(dag.tekst));
  ok('dag: drie uur later nog', H.plan(PLAN, STD, op('09:59'), {}).some(x => x.sleutels[0] === 'd:2026-10-12'));
  ok('dag: daarna niet meer', !H.plan(PLAN, STD, op('10:00'), {}).some(x => x.sleutels[0] === 'd:2026-10-12'));
  ok('dag: niet dubbel', !H.plan(PLAN, STD, op('07:05'), { 'd:2026-10-12': { op: 'x' } }).some(x => x.sleutels[0] === 'd:2026-10-12'));
  ok('dag: eigen tijd', H.plan(PLAN, M.instellingen({ dagTijd: '06:30' }), op('06:30'), {}).some(x => x.sleutels[0] === 'd:2026-10-12'));
  ok('dag: uit', !H.plan(PLAN, M.instellingen({ dagoverzicht: false }), op('07:00'), {}).some(x => x.sleutels[0].startsWith('d:')));
  const leeg = H.plan({ events: {}, leads: {}, tasks: {} }, STD, op('07:00'), {});
  ok('dag: niets te melden → geen mail, wel onthouden', leeg.length === 1 && leeg[0].leeg === true);
  ok('dag: test stuurt ook een lege', /Geen afspraken vandaag/.test(H.dagoverzicht({}, '2026-10-12', true).tekst));

  // ---------------------------------------------------------------- de cron
  const db = opslag.memoryStore();
  await db.hset('planning:events', PLAN.events);
  await db.hset('planning:leads', PLAN.leads);
  await db.hset('planning:tasks', PLAN.tasks);
  async function call(method, opts, headers, body) {
    let status = 0, out = '';
    const res = { statusCode: 200, setHeader() {}, end(s) { status = res.statusCode; out = s; } };
    await H.handle({ method, headers: headers || {}, body }, res, db, opts);
    return { status, data: out ? JSON.parse(out) : null };
  }
  let nv = nepVerzender();
  let r = await call('GET', { nu: () => op('07:00'), mail: nv });
  ok('cron: dagoverzicht verstuurd', r.status === 200 && r.data.verstuurd === 1 && nv.verstuurd[0].aan === 'daniel@mediaspot.nl' &&
    /^Vandaag: 4 afspraken/.test(nv.verstuurd[0].onderwerp) && /Open Weekzicht: https:\/\/app\.mediaspot\.nl/.test(nv.verstuurd[0].tekst) &&
    /href="https:\/\/app\.mediaspot\.nl"/.test(nv.verstuurd[0].html));
  r = await call('GET', { nu: () => op('07:05'), mail: nv });
  ok('cron: vijf minuten later niets dubbel', r.data.verstuurd === 0 && nv.verstuurd.length === 1);
  r = await call('GET', { nu: () => op('12:31'), mail: nv });
  ok('cron: herinnering vooraf', r.data.verstuurd === 1 && nv.verstuurd[1].onderwerp === 'Om 13:00: Overleg trouwlocatie');
  const stuk = nepVerzender({ fout: 'Forward Email weg' });
  r = await call('GET', { nu: () => op('14:31'), mail: stuk });
  let log = await db.get('herinneringen:verstuurd');
  ok('cron: mislukt → poging onthouden', r.data.verstuurd === 0 && log['v:bellen:l1:2026-10-12T15:00'].pogingen === 1);
  r = await call('GET', { nu: () => op('14:36'), mail: nv });
  ok('cron: daarna alsnog verstuurd', r.data.verstuurd === 1 && /Lisa van Duijn/.test(nv.verstuurd[2].onderwerp));
  r = await call('GET', { nu: () => op('07:00', '16'), mail: nv });
  log = await db.get('herinneringen:verstuurd');
  ok('cron: oude sleutels opgeruimd', !Object.keys(log).some(k => k.indexOf('2026-10-12') >= 0), Object.keys(log).join());
  r = await call('GET', { nu: () => op('07:00', '13'), mail: nepVerzender({ aan: false }) });
  ok('cron: mailen uit → niets', r.status === 200 && r.data.verstuurd === 0 && r.data.reden === 'mailen staat uit');
  await db.hset('planning:meta', { meldingen: { dagoverzicht: false, vooraf: 0 } });
  const nv2 = nepVerzender();
  r = await call('GET', { nu: () => op('07:00', '13'), mail: nv2 });
  ok('cron: instellingen uit de planning', r.data.verstuurd === 0 && nv2.verstuurd.length === 0);
  await db.hset('planning:meta', { meldingen: { dagoverzicht: true, dagTijd: '07:00', vooraf: 30, klant: true } });
  process.env.CRON_SECRET = 'cron-geheim';
  r = await call('GET', { nu: () => op('07:00', '13'), mail: nv2 });
  ok('cron: met CRON_SECRET alleen met het geheim', r.status === 401);
  r = await call('GET', { nu: () => op('07:00', '13'), mail: nv2 }, { authorization: 'Bearer cron-geheim' });
  ok('cron: met het geheim wel', r.status === 200 && r.data.verstuurd === 1 && /Julian en Inge/.test(nv2.verstuurd[0].tekst));
  delete process.env.CRON_SECRET;

  // testknop
  process.env.WEEKZICHT_WACHTWOORD = 'geheim-123';
  r = await call('POST', { nu: () => op('16:00', '20'), mail: nv2 }, {}, { actie: 'test' });
  ok('test: alleen ingelogd', r.status === 401);
  delete process.env.WEEKZICHT_WACHTWOORD;
  r = await call('POST', { nu: () => op('16:00', '20'), mail: nv2 }, {}, { actie: 'test' });
  ok('test: stuurt meteen, ook buiten de tijd', r.status === 200 && r.data.aan === 'daniel@mediaspot.nl' && /dinsdag 20 oktober/.test(nv2.verstuurd[1].onderwerp) &&
    /10:00–11:00 · Andere dag/.test(nv2.verstuurd[1].tekst));
  r = await call('POST', { nu: () => op('16:00', '20'), mail: nepVerzender({ aan: false }) }, {}, { actie: 'test' });
  ok('test: mailen uit → uitleg', r.status === 503 && /MAIL_VAN/.test(r.data.melding));
  r = await call('POST', { nu: () => op('16:00', '20'), mail: nepVerzender({ fout: 'stuk' }) }, {}, { actie: 'test' });
  ok('test: fout van Forward Email', r.status === 502 && /stuk/.test(r.data.melding));

  // ---------------------------------------------------------------- klantmeldingen
  const fdb = opslag.memoryStore();
  async function fcall(handle, body, extra, verzender) {
    let status = 0, out = '';
    const res = { statusCode: 200, setHeader() {}, end(s) { status = res.statusCode; out = s; } };
    await handle({ method: 'POST', headers: {}, body }, res, fdb, extra, { mail: verzender });
    return { status, data: out ? JSON.parse(out) : null };
  }
  const T = 'meldingtest000000000001';
  const fv = nepVerzender();
  await fcall(formulier.handle, { t: T, actie: 'aanmaken', naam: 'Sanne & Thomas' }, null, fv);
  r = await fcall(formulier.handle, { t: T, actie: 'invullen', antwoorden: { namen: 'Sanne & Thomas', datum: '2027-06-05', start: '11:00', eind: '23:00',
    locCeremonie: 'Stadhuis Joure', gasten: '120', email: 'st@voorbeeld.nl', momenten: ['ja-woord'] } }, null, fv);
  const fm = fv.verstuurd[0];
  ok('formulier: melding', r.status === 200 && fm && fm.onderwerp === 'Formulier ingevuld: Sanne & Thomas' &&
    /Datum: zaterdag 5 juni 2027\nTijden: 11:00–23:00\nCeremonie: Stadhuis Joure\nGasten: 120\nE-mail: st@voorbeeld\.nl/.test(fm.tekst), fm && fm.tekst);
  r = await fcall(formulier.handle, { t: T, actie: 'invullen', antwoorden: { namen: 'Sanne & Thomas', gasten: '130' } }, null, fv);
  ok('formulier: nog eens = aangepast', fv.verstuurd[1].onderwerp === 'Formulier aangepast: Sanne & Thomas');
  r = await fcall(formulier.handle, { t: T, actie: 'invullen', antwoorden: { namen: 'X' } }, null, nepVerzender({ fout: 'stuk' }));
  ok('formulier: mail stuk → formulier toch bewaard', r.status === 200 && (await fdb.get('formulier:' + T)).antwoorden.namen === 'X');
  await fdb.hset('planning:meta', { meldingen: { klant: false } });
  const fv2 = nepVerzender();
  r = await fcall(formulier.handle, { t: T, actie: 'invullen', antwoorden: { namen: 'Y' } }, null, fv2);
  ok('formulier: klantmeldingen uit', r.status === 200 && fv2.verstuurd.length === 0);
  await fdb.hset('planning:meta', { meldingen: { klant: true } });

  const yt = async () => ({ ok: true, status: 200, json: async () => ({ title: 'A - B', author_name: 'C' }) });
  const mv = nepVerzender();
  await fcall(muziek.handle, { t: T, actie: 'aanmaken', naam: 'Sanne & Thomas' }, yt, mv);
  r = await fcall(muziek.handle, { t: T, actie: 'kiezen', nummers: [{ yt: '2Vv-BfVoq4g', titel: 'Perfect', artiest: 'Ed Sheeran', moment: 'openingsdans' },
    { yt: 'abcdefghijk', titel: 'Kiss Me', moment: 'ceremonie' }], opmerking: 'Refrein bij de kus' }, yt, mv);
  ok('muziek: melding per scène', r.status === 200 && mv.verstuurd[0].onderwerp === 'Muziek gekozen: Sanne & Thomas' &&
    /\(2 nummers\):\n\n• Openingsdans: Perfect — Ed Sheeran\n• Ceremonie: Kiss Me\n\nOpmerking: Refrein bij de kus/.test(mv.verstuurd[0].tekst), mv.verstuurd[0] && mv.verstuurd[0].tekst);

  await browser();
  console.log(pass + ' geslaagd, ' + fail + ' gefaald');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL uitzondering', e && e.stack); process.exit(1); });

// ---------------------------------------------------------------- in de app
async function browser() {
  const FIXED = Date.UTC(2026, 8, 1, 10, 0, 0);
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const errors = [], store = new Map(), nv = nepVerzender();
  const f = fakeApi(store, { planning: true, mail: nv });
  const dom = new JSDOM(page, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/',
    beforeParse(win) {
      const RealDate = win.Date;
      win.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } };
      win.fetch = f;
      win.localStorage.setItem('weekzicht.v1', JSON.stringify({ events: [], tasks: [], leads: FIXTURE, settings: { weekend: true, dayStart: 7, dayEnd: 21 } }));
      win.localStorage.setItem('weekzicht.v1.leads-seeded', '1');
    },
    virtualConsole: new VirtualConsole().on('jsdomError', e => errors.push('jsdomError: ' + e.message))
  });
  const w = dom.window, d = w.document, $ = id => d.getElementById(id);
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await wait(400);
  click($('miMeldingen'));
  await wait(50);
  ok('app: venster met de standaard', !$('mlOverlay').hidden && $('mlDag').checked && $('mlDagTijd').value === '07:00' && $('mlVooraf').value === '30' && $('mlKlant').checked);
  ok('app: zegt waar het heen gaat', /daniel@mediaspot\.nl/.test($('mlNaar').textContent) && !$('mlTest').disabled, $('mlNaar').textContent);
  $('mlDagTijd').value = '06:45';
  $('mlVooraf').value = '15';
  $('mlKlant').checked = false;
  click($('mlSave'));
  await wait(600);   // de app stuurt wijzigingen na 300 ms in één keer
  const lokaal = JSON.parse(w.localStorage.getItem('weekzicht.v1')).meldingen;
  ok('app: bewaard', $('mlOverlay').hidden && lokaal.dagTijd === '06:45' && lokaal.vooraf === 15 && lokaal.klant === false && lokaal.at > 0, JSON.stringify(lokaal));
  const meta = JSON.parse(store.get('planning:meta') || '{}');
  ok('app: naar de server, waar de cron het leest', meta.meldingen && meta.meldingen.dagTijd === '06:45' && meta.meldingen.vooraf === 15 && meta.meldingen.klant === false,
    JSON.stringify(meta));
  click($('miMeldingen'));
  await wait(50);
  ok('app: opnieuw openen toont de keuze', $('mlDagTijd').value === '06:45' && $('mlVooraf').value === '15' && !$('mlKlant').checked);
  click($('mlTest'));
  await wait(150);
  ok('app: testknop stuurt een dagoverzicht', nv.verstuurd.length === 1 && /^Vandaag:/.test(nv.verstuurd[0].onderwerp) && /gestuurd naar daniel@mediaspot\.nl/.test($('toast').textContent),
    $('toast').textContent);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok('app: Escape sluit het venster', $('mlOverlay').hidden);
  ok('app: geen scriptfouten', errors.length === 0, errors.join(' | '));
}
