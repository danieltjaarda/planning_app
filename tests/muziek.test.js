// De serverfunctie voor de muziekkeuze, zonder Redis: geheugenopslag en een nep-YouTube.
const handler = require('../api/muziek.js');

let pass = 0, fail = 0;
function eq(n, g, w) {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log('FAIL', n, '\n  kreeg   ', a, '\n  verwacht', b); }
}

function fakeRes() {
  const r = { statusCode: 200, body: '', setHeader() {}, end(s) { r.body = s; } };
  return r;
}

// Wat YouTube's oEmbed zou antwoorden, per video-ID.
const OEMBED = {
  '2Vv-BfVoq4g': { title: 'Ed Sheeran - Perfect (Official Music Video)', author_name: 'Ed Sheeran' },
  'abcdefghijk': { title: 'Kodaline - The One (Official Video)', author_name: 'KodalineVEVO' },
  'zonderstree': { title: 'Trouwlied voor Sanne', author_name: 'Opa JanVEVO' }
};
const gevraagd = [];
async function fakeYt(url) {
  gevraagd.push(url);
  const id = decodeURIComponent(url).match(/v=([A-Za-z0-9_-]{11})/)[1];
  if (id === 'kapot000000') throw new Error('netwerk');
  const j = OEMBED[id];
  if (!j) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => j };
}

async function call(db, method, query, body) {
  const res = fakeRes();
  await handler.handle({ method, query, body }, res, db, fakeYt);
  return { status: res.statusCode, data: res.body ? JSON.parse(res.body) : null };
}

(async () => {
  const T = 'muziektest0123456789ab';
  const db = handler.memoryStore();

  // video-ID uit allerlei linkvormen
  const vid = handler.videoId;
  eq('watch-link', vid('https://www.youtube.com/watch?v=2Vv-BfVoq4g'), '2Vv-BfVoq4g');
  eq('watch-link met extra parameters', vid('https://www.youtube.com/watch?list=PL123&v=2Vv-BfVoq4g&t=10s'), '2Vv-BfVoq4g');
  eq('youtu.be', vid('https://youtu.be/2Vv-BfVoq4g?si=abc'), '2Vv-BfVoq4g');
  eq('shorts', vid('https://www.youtube.com/shorts/2Vv-BfVoq4g'), '2Vv-BfVoq4g');
  eq('music.youtube', vid('https://music.youtube.com/watch?v=2Vv-BfVoq4g&feature=share'), '2Vv-BfVoq4g');
  eq('mobiel', vid('https://m.youtube.com/watch?v=2Vv-BfVoq4g'), '2Vv-BfVoq4g');
  eq('embed', vid('https://www.youtube-nocookie.com/embed/2Vv-BfVoq4g'), '2Vv-BfVoq4g');
  eq('kaal id', vid('2Vv-BfVoq4g'), '2Vv-BfVoq4g');
  eq('geen youtube', vid('https://open.spotify.com/track/abc'), null);
  eq('onzin', vid('perfect ed sheeran'), null);
  eq('id te kort', vid('https://youtu.be/abc'), null);

  // titel en artiest uit een YouTube-titel
  eq('titel splitsen', handler.splitTitle('Ed Sheeran - Perfect (Official Music Video)', 'Ed Sheeran'), { titel: 'Perfect', artiest: 'Ed Sheeran' });
  eq('officiële video weg', handler.splitTitle('Suzan & Freek - Als Het Avond Is (Officiële Video)', 'SuzanenFreekVEVO'), { titel: 'Als Het Avond Is', artiest: 'Suzan & Freek' });
  eq('zonder streep: kanaal als artiest', handler.splitTitle('Trouwlied voor Sanne', 'Opa JanVEVO'), { titel: 'Trouwlied voor Sanne', artiest: 'Opa Jan' });
  eq('topic-kanaal', handler.splitTitle('Nummer Zonder Streep', 'Artiest - Topic'), { titel: 'Nummer Zonder Streep', artiest: 'Artiest' });
  eq('lege titel', handler.splitTitle('', 'Kanaal'), { titel: 'Nummer van YouTube', artiest: 'Kanaal' });

  // zonder opslag: nette 503
  eq('geen opslag', (await call(null, 'GET', { t: T })).status, 503);

  // token-controle
  eq('geen token', (await call(db, 'GET', {})).status, 400);
  eq('vreemde tekens', (await call(db, 'GET', { t: '../muziek:x-abcdef' })).status, 400);
  eq('onbekend token', (await call(db, 'GET', { t: T })).status, 404);
  eq('andere methode', (await call(db, 'DELETE', { t: T })).status, 405);
  eq('kapotte json', (await call(db, 'POST', {}, '{niet json')).status, 400);

  // aanmaken → ophalen
  const made = await call(db, 'POST', {}, { t: T, actie: 'aanmaken', naam: 'Bram Jansen', datum: '2026-10-03' });
  eq('aanmaken ok', [made.status, made.data.ok, made.data.t], [200, true, T]);
  const got = await call(db, 'GET', { t: T });
  eq('opgehaald', [got.status, got.data.naam, got.data.datum, got.data.ingevuld, got.data.nummers, got.data.opmerking],
    [200, 'Bram Jansen', '2026-10-03', null, [], '']);

  // kiezen
  eq('kiezen zonder link', (await call(db, 'POST', {}, { t: 'zzzzzzzzzzzzzzzz', actie: 'kiezen', nummers: [{ yt: '2Vv-BfVoq4g' }] })).status, 404);
  eq('lege keuze', (await call(db, 'POST', {}, { t: T, actie: 'kiezen', nummers: [], opmerking: '  ' })).status, 400);
  const vol = await call(db, 'POST', {}, { t: T, actie: 'kiezen', opmerking: ' Refrein bij de kus ', nummers: [
    { yt: '2Vv-BfVoq4g', titel: ' Perfect ', artiest: 'Ed Sheeran', moment: 'Openingsdans', eigen: 'ja' },
    { yt: '2Vv-BfVoq4g', titel: 'dubbel' },
    { yt: 'te-kort', titel: 'fout id' },
    'geen object',
    { yt: 'abcdefghijk', titel: 'The One', artiest: 'Kodaline', moment: 'Trouwfilm', eigen: true, extra: 'weg' }
  ] });
  eq('kiezen ok', [vol.status, vol.data.ok, typeof vol.data.ingevuld], [200, true, 'string']);
  const na = (await call(db, 'GET', { t: T })).data;
  eq('nummers opgeschoond', na.nummers, [
    { yt: '2Vv-BfVoq4g', titel: 'Perfect', artiest: 'Ed Sheeran', moment: 'Openingsdans', eigen: false },
    { yt: 'abcdefghijk', titel: 'The One', artiest: 'Kodaline', moment: 'Trouwfilm', eigen: true }
  ]);
  eq('opmerking bewaard', na.opmerking, 'Refrein bij de kus');
  eq('ingevuld gezet', typeof na.ingevuld, 'string');
  eq('alleen een opmerking mag ook', (await call(db, 'POST', {}, { t: T, actie: 'kiezen', nummers: [], opmerking: 'Later meer' })).status, 200);
  const alleen = (await call(db, 'GET', { t: T })).data;
  eq('keuze leeg, opmerking gevuld', [alleen.nummers.length, alleen.opmerking], [0, 'Later meer']);
  const veel = [];
  for (let i = 0; i < 10; i++) veel.push({ yt: 'aaaaaaaaa' + String(i).padStart(2, '0'), titel: 'n' + i, moment: 'scene' + i });
  await call(db, 'POST', {}, { t: T, actie: 'kiezen', nummers: veel });
  eq('maximaal 6 nummers', [(await call(db, 'GET', { t: T })).data.nummers.length, handler.MAX_SONGS], [6, 6]);
  await call(db, 'POST', {}, { t: T, actie: 'kiezen', nummers: [
    { yt: 'bbbbbbbbb01', moment: 'feest' }, { yt: 'bbbbbbbbb02', moment: 'feest' }, { yt: 'bbbbbbbbb03', moment: 'diner' }, { yt: 'bbbbbbbbb04' }, { yt: 'bbbbbbbbb05' }
  ] });
  eq('één nummer per scène (zonder scène telt apart)', (await call(db, 'GET', { t: T })).data.nummers.map(n => n.yt), ['bbbbbbbbb01', 'bbbbbbbbb03', 'bbbbbbbbb04', 'bbbbbbbbb05']);

  // opnieuw aanmaken (naam bijwerken) gooit de keuze niet weg
  await call(db, 'POST', {}, { t: T, actie: 'aanmaken', naam: 'Bram & Lotte', datum: '2026-10-03' });
  const weer = (await call(db, 'GET', { t: T })).data;
  eq('keuze blijft na hernieuwd aanmaken', [weer.naam, weer.nummers.length, typeof weer.ingevuld], ['Bram & Lotte', 4, 'string']);

  // opzoeken via (nep-)YouTube
  eq('opzoeken zonder link', (await call(db, 'POST', {}, { t: 'zzzzzzzzzzzzzzzz', actie: 'opzoeken', url: 'https://youtu.be/2Vv-BfVoq4g' })).status, 404);
  const g = await call(db, 'POST', {}, { t: T, actie: 'opzoeken', url: 'geen link' });
  eq('geen youtube-link', [g.status, g.data.error], [400, 'geen_youtube']);
  eq('geen youtube-link → niets opgevraagd', gevraagd.length, 0);
  const z = await call(db, 'POST', {}, { t: T, actie: 'opzoeken', url: 'https://youtu.be/2Vv-BfVoq4g?si=x' });
  eq('opgezocht', [z.status, z.data.yt, z.data.titel, z.data.artiest, z.data.kanaal], [200, '2Vv-BfVoq4g', 'Perfect', 'Ed Sheeran', 'Ed Sheeran']);
  eq('oEmbed-aanroep', gevraagd[0], 'https://www.youtube.com/oembed?url=' + encodeURIComponent('https://www.youtube.com/watch?v=2Vv-BfVoq4g') + '&format=json');
  const weg = await call(db, 'POST', {}, { t: T, actie: 'opzoeken', url: 'https://www.youtube.com/watch?v=weg00000000' });
  eq('onbekende video', [weg.status, weg.data.error], [404, 'video_onbekend']);
  const kapot = await call(db, 'POST', {}, { t: T, actie: 'opzoeken', url: 'https://www.youtube.com/watch?v=kapot000000' });
  eq('youtube onbereikbaar → 502', [kapot.status, kapot.data.error], [502, 'youtube']);
  eq('aanroepen geteld', (await db.get('muziek:' + T)).opzoek, 3);
  const rec = await db.get('muziek:' + T);
  rec.opzoek = handler.MAX_LOOKUPS;
  await db.set('muziek:' + T, rec);
  eq('limiet per link', (await call(db, 'POST', {}, { t: T, actie: 'opzoeken', url: 'https://youtu.be/2Vv-BfVoq4g' })).status, 429);

  // verwijderen
  eq('verwijderen', (await call(db, 'POST', {}, { t: T, actie: 'verwijderen' })).data.ok, true);
  eq('weg na verwijderen', (await call(db, 'GET', { t: T })).status, 404);
  eq('onbekende actie', (await call(db, 'POST', {}, { t: T, actie: 'dansen' })).status, 400);

  // de echte opslag praat Upstash-REST, en een opslagfout wordt een 502
  process.env.KV_REST_API_URL = 'https://redis.test';
  process.env.KV_REST_API_TOKEN = 'x';
  const calls = [];
  global.fetch = async (url, opts) => { calls.push([url, JSON.parse(opts.body)]); return { json: async () => ({ result: null }) }; };
  await handler({ method: 'GET', query: { t: T } }, fakeRes());
  eq('redis-commando', calls[0], ['https://redis.test', ['GET', 'muziek:' + T]]);
  global.fetch = async () => ({ json: async () => ({ error: 'WRONGPASS' }) });
  const res = fakeRes();
  await handler({ method: 'GET', query: { t: T } }, res);
  eq('opslagfout → 502', [res.statusCode, JSON.parse(res.body).error], [502, 'opslag']);

  console.log('\n' + pass + ' geslaagd, ' + fail + ' gefaald');
  process.exit(fail ? 1 : 0);
})();
