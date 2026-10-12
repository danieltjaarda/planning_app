// De planning op de server (api/planning): eerst de functie zelf, dan de app
// op twee "apparaten" die dezelfde server delen. Elk JSDOM-venster heeft zijn
// eigen localStorage, net als twee browsers.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const handler = require('../api/planning.js');
const FIXTURE = require('./fixture.js');
const fakeApi = require('./fake-api.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? '→ ' + extra : ''); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

function fakeRes() {
  const r = { statusCode: 200, body: '', setHeader() {}, end(s) { r.body = s; } };
  return r;
}
async function call(db, method, query, body, opts, headers) {
  const res = fakeRes();
  await handler.handle({ method, query: query || {}, body, headers: headers || {} }, res, db, opts);
  return { status: res.statusCode, data: res.body ? JSON.parse(res.body) : null };
}

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const windows = [];
function boot(api, storage) {
  const errors = [];
  const dom = new JSDOM(PAGE, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://example.test/',
    beforeParse(win) {
      win.fetch = api;
      for (const k of Object.keys(storage || {})) win.localStorage.setItem(k, storage[k]);
    },
    virtualConsole: new VirtualConsole().on('jsdomError', e => errors.push(e.message))
  });
  dom.window.addEventListener('error', e => errors.push(e.message));
  windows.push(dom.window);
  return { w: dom.window, d: dom.window.document, errors };
}
function local(win) { return JSON.parse(win.localStorage.getItem('weekzicht.v1') || '{}'); }
function dump(win) {
  const out = {};
  for (let i = 0; i < win.localStorage.length; i++) { const k = win.localStorage.key(i); out[k] = win.localStorage.getItem(k); }
  return out;
}
function hash(api, c) { return JSON.parse(api.store.get('planning:' + c) || '{}'); }
function click(w, el) { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }
function namesShown(dev) {
  click(dev.w, dev.d.querySelector('.viewswitch [data-view="klanten"]'));
  return Array.from(dev.d.querySelectorAll('#canvas .k-name')).map(e => e.textContent.trim());
}
function addLead(dev, name) {
  click(dev.w, dev.d.querySelector('.viewswitch [data-view="klanten"]'));
  click(dev.w, dev.d.getElementById('newLeadBtn'));
  dev.d.getElementById('lName').value = name;
  click(dev.w, dev.d.getElementById('lSave'));
}
function deleteLead(dev, name) {
  click(dev.w, dev.d.querySelector('.viewswitch [data-view="klanten"]'));
  const row = Array.from(dev.d.querySelectorAll('#canvas .klant')).find(r => r.querySelector('.k-name').textContent.trim() === name);
  click(dev.w, row.querySelector('.k-main'));
  click(dev.w, dev.d.getElementById('lDelete'));
}
function addTask(dev, title) {
  dev.d.getElementById('tkInput').value = title;
  click(dev.w, dev.d.getElementById('tkAdd'));
}
function sync(dev) { return dev.d.getElementById('syncDot').textContent; }
function focus(dev) { dev.w.dispatchEvent(new dev.w.Event('focus')); }

(async () => {
  // ================= de functie =================
  const db = handler.memoryStore();
  const ID = 'l123abc';

  ok('geen opslag → 503', (await call(null, 'GET')).status === 503);
  ok('PUT → 405', (await call(db, 'PUT')).status === 405);

  let r = await call(db, 'GET');
  ok('leeg begin', r.status === 200 && r.data.versie === 0 && JSON.stringify(r.data.leads) === '{}' && JSON.stringify(r.data.meta) === '{}', JSON.stringify(r.data));

  r = await call(db, 'POST', {}, { ops: [
    { c: 'leads', id: ID, doc: { name: 'Anna', phone: '06' } },
    { c: 'events', id: 'e1', doc: { title: 'Klus' } },
    { c: 'leads', id: ID, doc: { name: 'Anna de Vries', phone: '06' } }
  ] });
  ok('schrijven', r.status === 200 && r.data.versie === 1, JSON.stringify(r.data));
  r = await call(db, 'GET');
  ok('laatste wijziging per document telt', r.data.leads[ID].name === 'Anna de Vries' && Object.keys(r.data.leads).length === 1, JSON.stringify(r.data.leads));
  ok('andere verzameling apart', r.data.events.e1.title === 'Klus');
  ok('versie meegegeven', r.data.versie === 1);

  r = await call(db, 'GET', { sinds: '1' });
  ok('niets veranderd → kort antwoord', r.data.ongewijzigd === true && !r.data.leads, JSON.stringify(r.data));
  r = await call(db, 'GET', { sinds: '0' });
  ok('oude versie → alles', !r.data.ongewijzigd && !!r.data.leads[ID]);

  r = await call(db, 'POST', {}, { ops: [{ c: 'events', id: 'e1', weg: true }] });
  ok('verwijderen', r.data.versie === 2 && !(await call(db, 'GET')).data.events.e1);
  ok('verwijderen raakt de rest niet', !!(await call(db, 'GET')).data.leads[ID]);

  const bad = async (ops) => (await call(db, 'POST', {}, { ops })).data;
  ok('onbekende verzameling', (await bad([{ c: 'users', id: 'x', doc: {} }])).melding === 'onbekende verzameling');
  ok('ongeldig id', (await bad([{ c: 'leads', id: '../x', doc: {} }])).error === 'ongeldige_wijziging');
  ok('geen document', (await bad([{ c: 'leads', id: 'x', doc: [1] }])).melding === 'geen document');
  const groot = await bad([{ c: 'leads', id: 'ok', doc: {} }, { c: 'leads', id: 'x', doc: { s: 'x'.repeat(handler.MAX_DOC) } }]);
  ok('te groot document, met nummer', groot.melding === 'document te groot' && groot.op === 1, JSON.stringify(groot));
  ok('ongeldig verzoek schrijft niets', !(await call(db, 'GET')).data.leads.ok);
  ok('lege lijst', (await call(db, 'POST', {}, { ops: [] })).status === 400);
  ok('te veel', (await call(db, 'POST', {}, { ops: Array.from({ length: handler.MAX_OPS + 1 }, (_, i) => ({ c: 'tasks', id: 't' + i, doc: {} })) })).data.error === 'te_veel');
  ok('kapotte json', (await call(db, 'POST', {}, '{kapot')).status === 400);
  ok('json als tekst mag', (await call(db, 'POST', {}, JSON.stringify({ ops: [{ c: 'tasks', id: 't1', doc: { title: 'x' } }] }))).status === 200);

  // toegang
  process.env.WEEKZICHT_WACHTWOORD = 'geheim';
  ok('zonder cookie → 401', (await call(db, 'GET')).status === 401);
  ok('schrijven zonder cookie → 401', (await call(db, 'POST', {}, { ops: [{ c: 'tasks', id: 't2', doc: {} }] })).status === 401);
  const sessie = require('../api/_sessie.js');
  const cookie = { cookie: 'wz_sessie=' + encodeURIComponent(sessie.maakSessie('geheim')) };
  ok('met cookie → 200', (await call(db, 'GET', {}, undefined, { eisWachtwoord: true }, cookie)).status === 200);
  ok('verkeerde cookie → 401', (await call(db, 'GET', {}, undefined, {}, { cookie: 'wz_sessie=1.abc' })).status === 401);
  delete process.env.WEEKZICHT_WACHTWOORD;
  ok('Vercel zonder wachtwoord → 403', (await call(db, 'GET', {}, undefined, { eisWachtwoord: true })).status === 403);
  ok('lokaal zonder wachtwoord → open', (await call(db, 'GET', {}, undefined, { eisWachtwoord: false })).status === 200);

  // ================= de app op twee apparaten =================
  const api = fakeApi(null, { planning: true });

  // A: de browser waar de klanten nu lokaal staan (zoals de laptop)
  const A = boot(api, {
    'weekzicht.v1': JSON.stringify({ events: [], tasks: [], leads: FIXTURE, settings: { weekend: false, dayStart: 8, dayEnd: 20 } }),
    'weekzicht.v1.leads-seeded': '1'
  });
  await wait(600);
  ok('A: geen scriptfouten', A.errors.length === 0, A.errors.join(' | '));
  ok('A: online', sync(A) === 'online opgeslagen', sync(A));
  ok('A: lokale klanten naar de server', Object.keys(hash(api, 'leads')).length === 5, Object.keys(hash(api, 'leads')).length);
  ok('A: klanten lokaal niet kwijt', local(A.w).leads.length === 5, local(A.w).leads && local(A.w).leads.length);
  ok('A: id hoort niet in het document', !('id' in Object.values(hash(api, 'leads'))[0]));
  ok('A: kopie van vóór de koppeling', JSON.parse(A.w.localStorage.getItem('weekzicht.v1.voor-sync')).leads.length === 5);
  ok('A: startlijst niet opnieuw ingeladen', !hash(api, 'leads')['ld-lisa-van-duijn'] && !!hash(api, 'meta').seeded);
  ok('A: instellingen mee', hash(api, 'meta').settings && hash(api, 'meta').settings.dayStart === 8, JSON.stringify(hash(api, 'meta').settings));
  ok('A: wachtrij leeg', !A.w.localStorage.getItem('weekzicht.v1.wachtrij'));

  // B: een lege browser (telefoon, ander apparaat)
  const B = boot(api, {});
  await wait(200);
  ok('B: geen scriptfouten', B.errors.length === 0, B.errors.join(' | '));
  ok('B: ziet de klanten van A', namesShown(B).length === 5, JSON.stringify(namesShown(B)));
  ok('B: bewaart ze ook lokaal', local(B.w).leads.length === 5);
  ok('B: geen startlijst', !namesShown(B).includes('Lisa van Duijn'));
  ok('B: instellingen van A', local(B.w).settings.dayStart === 8 && local(B.w).settings.weekend === false, JSON.stringify(local(B.w).settings));

  addLead(B, 'Nieuw via telefoon');
  ok('B: meteen in de lijst', namesShown(B).includes('Nieuw via telefoon'));
  await wait(500);
  ok('B: klant op de server', Object.values(hash(api, 'leads')).some(l => l.name === 'Nieuw via telefoon'));

  const polls = api.planning.length;
  focus(A);
  await wait(100);
  ok('A: ziet de klant van B na terugkomen', namesShown(A).includes('Nieuw via telefoon'), JSON.stringify(namesShown(A)));
  ok('A: haalde maar één keer op', api.planning.length === polls + 1, api.planning.slice(polls).join(', '));

  deleteLead(A, 'Nieuw via telefoon');
  await wait(500);
  ok('A: weg van de server', !Object.values(hash(api, 'leads')).some(l => l.name === 'Nieuw via telefoon'));
  focus(B);
  await wait(100);
  ok('B: ook weg', !namesShown(B).includes('Nieuw via telefoon') && namesShown(B).length === 5, JSON.stringify(namesShown(B)));

  // niets veranderd: kort antwoord, niets opnieuw ophalen
  focus(B);
  await wait(100);
  ok('B: verversen zonder wijziging', /sinds=\d+$/.test(api.planning[api.planning.length - 1]));

  // ---- het net valt weg terwijl A open staat ----
  api.offline = true;
  addTask(A, 'Offline taak');
  await wait(500);
  ok('A: zegt dat het nog niet online staat', sync(A) === 'nog niet online opgeslagen', sync(A));
  ok('A: wachtrij bewaard', Object.keys(JSON.parse(A.w.localStorage.getItem('weekzicht.v1.wachtrij'))).length === 1);
  ok('A: taak wel zichtbaar', /Offline taak/.test(A.d.getElementById('taskCard').textContent));
  api.offline = false;
  A.w.dispatchEvent(new A.w.Event('online'));
  await wait(200);
  ok('A: na herstel op de server', Object.values(hash(api, 'tasks')).some(t => t.title === 'Offline taak'));
  ok('A: wachtrij leeg', !A.w.localStorage.getItem('weekzicht.v1.wachtrij'));
  ok('A: weer online', sync(A) === 'online opgeslagen', sync(A));

  // ---- wijziging in de wachtrij, pagina dicht, later weer open ----
  api.offline = true;
  addLead(A, 'Vlak voor sluiten');
  await wait(400);
  const opgeslagen = dump(A.w);
  A.w.close();
  api.offline = false;
  const A2 = boot(api, opgeslagen);
  await wait(700);
  ok('A2: wachtrij alsnog verstuurd', Object.values(hash(api, 'leads')).some(l => l.name === 'Vlak voor sluiten'));
  ok('A2: klant staat er', namesShown(A2).includes('Vlak voor sluiten'));

  // ---- offline opstarten, iets maken, dicht, later online weer open ----
  api.offline = true;
  const C = boot(api, dump(B.w));
  await wait(200);
  ok('C: offline → alleen op dit apparaat', sync(C) === 'alleen op dit apparaat', sync(C));
  ok('C: lokale gegevens zichtbaar', namesShown(C).length >= 5);
  addLead(C, 'Offline gemaakt');
  ok('C: onthouden voor later', JSON.parse(C.w.localStorage.getItem('weekzicht.v1.pending')).ids.leads);
  const cOpgeslagen = dump(C.w);
  C.w.close();
  api.offline = false;
  const C2 = boot(api, cOpgeslagen);
  await wait(700);
  ok('C2: offline klant alsnog op de server', Object.values(hash(api, 'leads')).some(l => l.name === 'Offline gemaakt'));
  ok('C2: en verder alles van de server', namesShown(C2).includes('Vlak voor sluiten'), JSON.stringify(namesShown(C2)));
  ok('C2: lijst opgeruimd', JSON.stringify(JSON.parse(C2.w.localStorage.getItem('weekzicht.v1.pending')).ids.leads) === '{}');

  // ---- een tweede browser die zélf al klanten had: samenvoegen, niets kwijt ----
  const eigen = { id: 'l-eigen-1', name: 'Alleen in deze browser', phone: '', date: null, status: 'wacht', calledAt: null, callDate: null, callTime: null, note: '' };
  const D = boot(api, { 'weekzicht.v1': JSON.stringify({ events: [], tasks: [], leads: [eigen], settings: { weekend: true, dayStart: 7, dayEnd: 21 } }), 'weekzicht.v1.leads-seeded': '1' });
  await wait(600);
  ok('D: eigen klant toegevoegd', !!hash(api, 'leads')['l-eigen-1']);
  ok('D: én die van de server', namesShown(D).includes('Alleen in deze browser') && namesShown(D).includes('Offline gemaakt'), JSON.stringify(namesShown(D)));
  ok('D: instellingen van de server blijven', hash(api, 'meta').settings.dayStart === 8);

  // ---- offerte: zit in de klant, bedrijfsgegevens in meta/offerte ----
  const inp = (dev, el, v) => { el.value = v; el.dispatchEvent(new dev.w.Event('input', { bubbles: true })); };
  click(A2.w, A2.d.querySelector('.viewswitch [data-view="klanten"]'));
  click(A2.w, A2.d.querySelector('#canvas .k-main[data-lead="t-cas"]'));
  click(A2.w, A2.d.getElementById('lMakeOfferte'));
  inp(A2, A2.d.querySelector('#oRegels .of-oms'), 'Trouwfilm');
  inp(A2, A2.d.querySelector('#oRegels .of-prijs input'), '1250');
  inp(A2, A2.d.getElementById('ob_naam'), 'Mediaspot Sync');
  click(A2.w, A2.d.getElementById('oSave'));
  click(A2.w, A2.d.querySelector('#ldOverlay [data-close]'));
  await wait(500);
  const opServer = hash(api, 'leads')['t-cas'];
  ok('offerte: met de klant op de server', opServer && opServer.offerte && opServer.offerte.regels[0].prijs === 1250, JSON.stringify(opServer && opServer.offerte));
  ok('offerte: bedrijfsgegevens op de server', hash(api, 'meta').offerte && hash(api, 'meta').offerte.bedrijf.naam === 'Mediaspot Sync');
  focus(B);
  await wait(150);
  const opB = local(B.w);
  ok('offerte: B ziet de offerte', (opB.leads.find(l => l.id === 't-cas') || {}).offerte && opB.leads.find(l => l.id === 't-cas').offerte.nummer.endsWith('-001'));
  ok('offerte: B kent de bedrijfsgegevens', opB.offerte && opB.offerte.bedrijf && opB.offerte.bedrijf.naam === 'Mediaspot Sync', JSON.stringify(opB.offerte));

  ok('geen scriptfouten later', [A, B, A2, C2, D].every(x => x.errors.length === 0), [A, B, A2, C2, D].map(x => x.errors.join('|')).join(' / '));

  console.log(`\n${pass} geslaagd, ${fail} gefaald`);
  for (const w of windows) { try { w.close(); } catch (e) {} }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FOUT', e); process.exit(1); });
