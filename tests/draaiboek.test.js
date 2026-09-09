// Draaiboek → tijdlijn: de serverfunctie met een nep-OpenRouter en geheugenopslag.
const handler = require('../api/draaiboek.js');
const formulier = require('../api/formulier.js');

let pass = 0, fail = 0;
function eq(n, g, w) {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) pass++; else { fail++; console.log('FAIL', n, '\n  kreeg   ', a, '\n  verwacht', b); }
}
function fakeRes() { const r = { statusCode: 200, body: '', setHeader() {}, end(s) { r.body = s; } }; return r; }
async function call(db, key, body, fetchFn, method) {
  const res = fakeRes();
  await handler.handle({ method: method || 'POST', body }, res, db, key, fetchFn);
  return { status: res.statusCode, data: res.body ? JSON.parse(res.body) : null };
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
  eq('alleen POST', (await call(db, 'k', {}, null, 'GET')).status, 405);
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

  console.log('\n' + pass + ' geslaagd, ' + fail + ' gefaald');
  process.exit(fail ? 1 : 0);
})();
