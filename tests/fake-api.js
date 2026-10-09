// Een fetch() die rechtstreeks de Vercel-functie aanroept, met een geheugen-
// opslag in plaats van Redis. Zo test de smoketest de hele keten: app →
// api/formulier → klantpagina → api/formulier → app.
const handler = require('../api/formulier.js');
const draaiboek = require('../api/draaiboek.js');
const muziek = require('../api/muziek.js');
const bestanden = require('../api/_bestanden.js');

module.exports = function fakeApi(map) {
  const store = map || new Map();
  const db = handler.memoryStore(store);
  const files = bestanden.memoryFiles();
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
      }), files);
      return { ok: status >= 200 && status < 300, status, text: async () => out };
    }
    if (u.pathname === '/api/muziek') {
      // nep-YouTube (oEmbed): kent elke video behalve "weg00000000", en onthoudt wat er is opgevraagd
      await muziek.handle(req, res, db, async (url) => {
        fetch.oembed.push(url);
        const id = decodeURIComponent(url).match(/v=([A-Za-z0-9_-]{11})/)[1];
        if (id === 'weg00000000') return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ title: 'Kodaline - The One (Official Video)', author_name: 'KodalineVEVO' }) };
      });
      return { ok: status >= 200 && status < 300, status, text: async () => out };
    }
    if (u.pathname !== '/api/formulier') return { ok: false, status: 404, text: async () => 'niet gevonden' };
    await handler.handle(req, res, db, files);
    return { ok: status >= 200 && status < 300, status, text: async () => out };
  }
  fetch.store = store;
  fetch.openrouter = [];
  fetch.oembed = [];
  fetch.files = files;
  return fetch;
};
