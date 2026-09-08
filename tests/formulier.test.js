// De serverfunctie voor het klantformulier, zonder Redis: geheugenopslag.
const handler = require('../api/formulier.js');

let pass = 0, fail = 0;
function eq(n, g, w) {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log('FAIL', n, '\n  kreeg   ', a, '\n  verwacht', b); }
}

function fakeRes() {
  const r = { statusCode: 200, body: '', setHeader() {}, end(s) { r.body = s; } };
  return r;
}

async function call(db, method, query, body) {
  const res = fakeRes();
  await handler.handle({ method, query, body }, res, db);
  return { status: res.statusCode, data: res.body ? JSON.parse(res.body) : null };
}

(async () => {
  const T = 'abcdefghij0123456789xy';
  const db = handler.memoryStore();

  // zonder opslag: nette 503
  eq('geen opslag', (await call(null, 'GET', { t: T })).status, 503);

  // token-controle
  eq('geen token', (await call(db, 'GET', {})).status, 400);
  eq('te kort token', (await call(db, 'GET', { t: 'abc' })).status, 400);
  eq('vreemde tekens', (await call(db, 'GET', { t: '../formulier:x-abcdef' })).status, 400);
  eq('onbekend token', (await call(db, 'GET', { t: T })).status, 404);
  eq('andere methode', (await call(db, 'DELETE', { t: T })).status, 405);
  eq('kapotte json', (await call(db, 'POST', {}, '{niet json')).status, 400);

  // aanmaken → ophalen
  const made = await call(db, 'POST', {}, { t: T, actie: 'aanmaken', naam: 'Bram Jansen', datum: '2026-10-03' });
  eq('aanmaken ok', [made.status, made.data.ok, made.data.t], [200, true, T]);
  const got = await call(db, 'GET', { t: T });
  eq('opgehaald', [got.status, got.data.naam, got.data.datum, got.data.ingevuld, got.data.antwoorden],
    [200, 'Bram Jansen', '2026-10-03', null, null]);
  await call(db, 'POST', {}, { t: T, actie: 'aanmaken', naam: 'X', datum: '3 okt' });
  eq('ongeldige datum genegeerd', (await call(db, 'GET', { t: T })).data.datum, '');

  // invullen op een onbekend token / leeg
  eq('invullen zonder link', (await call(db, 'POST', {}, { t: 'zzzzzzzzzzzzzzzz', actie: 'invullen', antwoorden: { namen: 'x' } })).status, 404);
  eq('leeg formulier', (await call(db, 'POST', {}, { t: T, actie: 'invullen', antwoorden: {} })).status, 400);

  // invullen: alleen nette waarden blijven over
  const vol = await call(db, 'POST', {}, { t: T, actie: 'invullen', antwoorden: {
    namen: '  Bram & Lotte ', start: '10:00', eind: '00:30', gasten: 80,
    momenten: ['Ceremonie', 'Feest', 42, ''], akkoord: true,
    tekst: 'regelmetrommel\nen een regel', 'raar sleutel': 'nee', obj: { diep: 1 }
  } });
  eq('invullen ok', [vol.status, vol.data.ok, typeof vol.data.ingevuld], [200, true, 'string']);
  const na = (await call(db, 'GET', { t: T })).data;
  eq('antwoorden opgeschoond', na.antwoorden, {
    namen: 'Bram & Lotte', start: '10:00', eind: '00:30', gasten: '80',
    momenten: ['Ceremonie', 'Feest', '42'], akkoord: true, tekst: 'regelmetrommel\nen een regel'
  });
  eq('ingevuld gezet', typeof na.ingevuld, 'string');
  eq('naam en datum bewaard', [na.naam, na.datum], ['X', '']);

  // opnieuw aanmaken (naam bijwerken) gooit de antwoorden niet weg
  await call(db, 'POST', {}, { t: T, actie: 'aanmaken', naam: 'Bram Jansen', datum: '2026-10-03' });
  const weer = (await call(db, 'GET', { t: T })).data;
  eq('antwoorden blijven na hernieuwd aanmaken', [weer.naam, weer.antwoorden.start, weer.ingevuld], ['Bram Jansen', '10:00', na.ingevuld]);

  // lange tekst wordt afgekapt
  await call(db, 'POST', {}, { t: T, actie: 'invullen', antwoorden: { wensen: 'a'.repeat(9000) } });
  eq('tekst begrensd', (await call(db, 'GET', { t: T })).data.antwoorden.wensen.length, 4000);

  // verwijderen
  eq('verwijderen', (await call(db, 'POST', {}, { t: T, actie: 'verwijderen' })).data.ok, true);
  eq('weg na verwijderen', (await call(db, 'GET', { t: T })).status, 404);
  eq('onbekende actie', (await call(db, 'POST', {}, { t: T, actie: 'dansen' })).status, 400);

  // een echte opslagfout (Redis antwoordt met een fout) wordt een 502, geen crash
  process.env.KV_REST_API_URL = 'https://redis.test';
  process.env.KV_REST_API_TOKEN = 'x';
  global.fetch = async () => ({ json: async () => ({ error: 'WRONGPASS' }) });
  const res = fakeRes();
  await handler({ method: 'GET', query: { t: T } }, res);
  eq('opslagfout → 502', [res.statusCode, JSON.parse(res.body).error], [502, 'opslag']);

  // en de echte opslag praat Upstash-REST: één POST met het commando als lijst
  const calls = [];
  global.fetch = async (url, opts) => { calls.push([url, JSON.parse(opts.body)]); return { json: async () => ({ result: null }) }; };
  await handler({ method: 'GET', query: { t: T } }, fakeRes());
  eq('redis-commando', calls[0], ['https://redis.test', ['GET', 'formulier:' + T]]);

  console.log('\n' + pass + ' geslaagd, ' + fail + ' gefaald');
  process.exit(fail ? 1 : 0);
})();
