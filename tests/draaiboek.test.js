// Draaiboek → tijdlijn: de serverfunctie met een nep-OpenRouter en geheugenopslag.
const handler = require('../api/draaiboek.js');
const formulier = require('../api/formulier.js');
const bestanden = require('../api/_bestanden.js');

let pass = 0, fail = 0;
function eq(n, g, w) {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log('FAIL', n, '\n  kreeg   ', a, '\n  verwacht', b); }
}
function fakeRes() { const r = { statusCode: 200, body: '', setHeader() {}, end(s) { r.body = s; } }; return r; }
async function call(db, key, body, fetchFn, method, files, query) {
  const res = fakeRes();
  await handler.handle({ method: method || 'POST', body, query }, res, db, key, fetchFn, files);
  let data = null;
  try { data = res.body ? JSON.parse(res.body) : null; } catch (e) { data = res.body; }
  return { status: res.statusCode, data, res };
}
const b64 = s => Buffer.from(s).toString('base64');

(async () => {
  const T = 'abcdefghij0123456789xy';
  const db = formulier.memoryStore();
  await db.set('formulier:' + T, { naam: 'Bram', datum: '2026-10-03', aangemaakt: 'x', ingevuld: null, antwoorden: null });

  // aanroepen die OpenRouter nabootsen
  const calls = [];
  const okFetch = (text) => async (url, opts) => {
    calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }) };
  };

  eq('geen sleutel → 503', (await call(db, '', { t: T, mime: 'image/jpeg', data: b64('x') })).status, 503);
  eq('geen opslag → 503', (await call(null, 'k', { t: T, mime: 'image/jpeg', data: b64('x') })).status, 503);
  eq('alleen GET en POST', (await call(db, 'k', {}, null, 'PUT')).status, 405);
  eq('GET zonder token', (await call(db, 'k', null, null, 'GET', null, {})).status, 400);
  eq('ongeldig token', (await call(db, 'k', { t: 'abc', mime: 'image/jpeg', data: b64('x') })).status, 400);
  eq('onbekend token', (await call(db, 'k', { t: 'zzzzzzzzzzzzzzzz', mime: 'image/jpeg', data: b64('x') })).status, 404);
  eq('leeg bestand', (await call(db, 'k', { t: T, mime: 'image/jpeg', data: '' })).status, 400);
  eq('vreemd bestandstype', (await call(db, 'k', { t: T, mime: 'application/msword', data: b64('x') })).status, 415);
  eq('te groot', (await call(db, 'k', { t: T, mime: 'image/jpeg', data: 'a'.repeat(4.2 * 1024 * 1024) })).status, 413);

  // foto → image_url, netjes opgeschoond antwoord
  const r1 = await call(db, 'sleutel', { t: T, mime: 'image/jpeg', naam: 'draaiboek.jpg', data: 'data:image/jpeg;base64,' + b64('foto') },
    okFetch('```\n- 10:00  Aankleden — Hotel De Zon\n* 13:30  Ceremonie — Stadhuis\n\n17:00  Borrel\n```'));
  eq('foto → tijdlijn', [r1.status, r1.data.tekst], [200, '10:00  Aankleden — Hotel De Zon\n13:30  Ceremonie — Stadhuis\n17:00  Borrel']);
  eq('model gekozen', [r1.data.model, calls[0].body.model], [handler.MODEL, handler.MODEL]);
  eq('sleutel in header', calls[0].headers.Authorization, 'Bearer sleutel');
  eq('openrouter-adres', calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  const user = calls[0].body.messages[1].content;
  eq('foto als image_url', [user[1].type, user[1].image_url.url.slice(0, 23)], ['image_url', 'data:image/jpeg;base64,']);
  eq('systeemprompt vraagt om tijdlijn', /HH:MM/.test(calls[0].body.messages[0].content), true);

  // pdf → file + parser-plugin
  await call(db, 'sleutel', { t: T, mime: 'application/pdf', naam: 'plan.pdf', data: b64('%PDF') }, okFetch('09:00  Start'));
  const u2 = calls[1].body.messages[1].content;
  eq('pdf als file', [u2[1].type, u2[1].file.filename, u2[1].file.file_data.slice(0, 28)], ['file', 'plan.pdf', 'data:application/pdf;base64,']);
  eq('pdf-plugin', calls[1].body.plugins, [{ id: 'file-parser', pdf: { engine: 'native' } }]);

  // tekstbestand → gewoon in de prompt
  await call(db, 'sleutel', { t: T, mime: 'text/plain', data: b64('12:00 lunch') }, okFetch('12:00  Lunch'));
  eq('tekst in de prompt', /12:00 lunch/.test(calls[2].body.messages[1].content[0].text), true);

  // geen planning gevonden
  const r4 = await call(db, 'sleutel', { t: T, mime: 'image/png', data: b64('x') }, okFetch('GEEN_PLANNING'));
  eq('geen planning → lege tekst met melding', [r4.status, r4.data.tekst, /geen planning/i.test(r4.data.melding)], [200, '', true]);

  // fouten van OpenRouter
  const r5 = await call(db, 'sleutel', { t: T, mime: 'image/png', data: b64('x') },
    async () => ({ ok: false, status: 402, json: async () => ({ error: { message: 'Insufficient credits' } }) }));
  eq('fout van het model → 502 met melding', [r5.status, /Insufficient credits/.test(r5.data.melding)], [502, true]);
  const r6 = await call(db, 'sleutel', { t: T, mime: 'image/png', data: b64('x') }, async () => { throw new Error('netwerk'); });
  eq('netwerkfout → 502', r6.status, 502);

  // teller per link
  const rec = await db.get('formulier:' + T);
  eq('aanroepen geteld', rec.draaiboek, 6);
  await db.set('formulier:' + T, Object.assign({}, rec, { draaiboek: 25 }));
  eq('limiet per link', (await call(db, 'sleutel', { t: T, mime: 'image/png', data: b64('x') }, okFetch('x'))).status, 429);

  eq('cleanTimeline strip', handler.cleanTimeline('  • 10:00  A  \n\n- 11:00 B\r\n'), '10:00  A\n11:00 B');

  // ---- het bestand zelf bewaren en terugkijken ----
  const T2 = 'bestandentest0000001';
  await db.set('formulier:' + T2, { naam: 'Eva', datum: '', aangemaakt: 'x', ingevuld: null, antwoorden: null });
  const files = bestanden.memoryFiles();
  const foto = Buffer.from([255, 216, 255, 224, 1, 2, 3, 4]);
  const r7 = await call(db, 'sleutel', { t: T2, mime: 'image/jpeg', naam: 'mijn draaiboek (1).jpg', data: foto.toString('base64') }, okFetch('10:00  Start'), 'POST', files);
  eq('bestand bewaard: antwoord', [r7.status, r7.data.bestand, r7.data.bestanden.length], [200, { naam: 'mijn draaiboek (1).jpg', i: 0 }, 1]);
  const rec7 = await db.get('formulier:' + T2);
  eq('bestand in record', [rec7.bestanden[0].naam, rec7.bestanden[0].mime, rec7.bestanden[0].grootte, /^mem:\/\//.test(rec7.bestanden[0].url), typeof rec7.bestanden[0].at], ['mijn draaiboek (1).jpg', 'image/jpeg', 8, true, 'string']);
  eq('lijst naar buiten zonder url', Object.keys(r7.data.bestanden[0]).sort(), ['at', 'grootte', 'mime', 'naam']);

  const g1 = await call(db, 'sleutel', null, null, 'GET', files, { t: T2, i: '0' });
  eq('bestand ophalen', [g1.status, Buffer.isBuffer(g1.res.body) && g1.res.body.equals(foto)], [200, true]);
  eq('bestand ophalen: index bestaat niet', (await call(db, 'sleutel', null, null, 'GET', files, { t: T2, i: '3' })).status, 404);
  eq('bestand ophalen: verkeerd token', (await call(db, 'sleutel', null, null, 'GET', files, { t: 'zzzzzzzzzzzzzzzz', i: '0' })).status, 404);
  eq('bestand ophalen: geen index', (await call(db, 'sleutel', null, null, 'GET', files, { t: T2 })).status, 400);

  // zonder AI-sleutel wordt het bestand tóch bewaard
  const r8 = await call(db, '', { t: T2, mime: 'application/pdf', naam: 'plan.pdf', data: b64('%PDF') }, null, 'POST', files);
  eq('zonder sleutel: bewaard, geen tekst', [r8.status, r8.data.tekst, r8.data.bestand.i, /bewaard/.test(r8.data.melding)], [200, '', 1, true]);

  // formulier ophalen noemt de bestanden; verwijderen ruimt ze op
  const fres = fakeRes();
  await formulier.handle({ method: 'GET', query: { t: T2 } }, fres, db, files);
  eq('formulier noemt bestanden', JSON.parse(fres.body).bestanden.map(b => b.naam), ['mijn draaiboek (1).jpg', 'plan.pdf']);
  eq('twee bestanden in opslag', files.map.size, 2);
  const dres = fakeRes();
  await formulier.handle({ method: 'POST', body: { t: T2, actie: 'verwijderen' } }, dres, db, files);
  eq('verwijderen ruimt bestanden op', [JSON.parse(dres.body).ok, files.map.size], [true, 0]);
  eq('veilige bestandsnaam', bestanden.safeName('../raar naam?.pdf'), 'raar-naam-.pdf');

  console.log('\n' + pass + ' geslaagd, ' + fail + ' gefaald');
  process.exit(fail ? 1 : 0);
})();
