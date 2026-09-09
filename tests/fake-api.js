// Een fetch() die rechtstreeks de Vercel-functie aanroept, met een geheugen-
// opslag in plaats van Redis. Zo test de smoketest de hele keten: app →
// api/formulier → klantpagina → api/formulier → app.
const handler = require('../api/formulier.js');
const draaiboek = require('../api/draaiboek.js');

module.exports = function fakeApi(map) {
  const store = map || new Map();
  const db = handler.memoryStore(store);
  async function fetch(url, opts) {
    opts = opts || {};
    const u = new URL(String(url), 'https://example.test/');
    const req = {
      method: opts.method || 'GET',
      query: Object.fromEntries(u.searchParams),
      body: opts.body ? JSON.parse(opts.body) : undefined
    };
    let status = 200, out = '';
    const res = { statusCode: 200, setHeader() {}, end(s) { status = res.statusCode; out = s; } };
    if (u.pathname === '/api/draaiboek') {
      // nep-OpenRouter: geeft altijd dezelfde tijdlijn terug en onthoudt wat er gevraagd is
      fetch.openrouter.push(req.body);
      await draaiboek.handle(req, res, db, 'testsleutel', async () => ({
        ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '10:00  Aankleden — Hotel De Zon\n13:30  Ceremonie — Stadhuis' } }] })
      }));
      return { ok: status >= 200 && status < 300, status, text: async () => out };
    }
    if (u.pathname !== '/api/formulier') return { ok: false, status: 404, text: async () => 'niet gevonden' };
    await handler.handle(req, res, db);
    return { ok: status >= 200 && status < 300, status, text: async () => out };
  }
  fetch.store = store;
  fetch.openrouter = [];
  return fetch;
};
