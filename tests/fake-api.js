// Een fetch() die rechtstreeks de Vercel-functie aanroept, met een geheugen-
// opslag in plaats van Redis. Zo test de smoketest de hele keten: app →
// api/formulier → klantpagina → api/formulier → app.
const handler = require('../api/formulier.js');

module.exports = function fakeApi(map) {
  const store = map || new Map();
  const db = handler.memoryStore(store);
  async function fetch(url, opts) {
    opts = opts || {};
    const u = new URL(String(url), 'https://example.test/');
    if (u.pathname !== '/api/formulier') return { ok: false, status: 404, text: async () => 'niet gevonden' };
    const req = {
      method: opts.method || 'GET',
      query: Object.fromEntries(u.searchParams),
      body: opts.body ? JSON.parse(opts.body) : undefined
    };
    let status = 200, out = '';
    const res = { statusCode: 200, setHeader() {}, end(s) { status = res.statusCode; out = s; } };
    await handler.handle(req, res, db);
    return { ok: status >= 200 && status < 300, status, text: async () => out };
  }
  fetch.store = store;
  return fetch;
};
