// Opslag voor de serverfuncties: Upstash Redis via de REST-koppeling (de
// "Redis"-store uit de Vercel-marketplace zet KV_REST_API_URL en
// KV_REST_API_TOKEN klaar). Geen npm-afhankelijkheden: een kale fetch volstaat.
// Eén plek voor formulier, draaiboek en muziek, zodat ze dezelfde records zien.

const TTL_SEC = 60 * 60 * 24 * 730; // twee jaar: bruiloften worden ver vooruit geboekt

/** De echte opslag, of null als de omgevingsvariabelen ontbreken. */
function store() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  async function cmd(...args) {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(args)
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
  }

  return {
    async get(key) { const v = await cmd("GET", key); return v ? JSON.parse(v) : null; },
    async set(key, value) { await cmd("SET", key, JSON.stringify(value), "EX", TTL_SEC); },
    async del(key) { await cmd("DEL", key); }
  };
}

/** In-memory variant voor tests en lokaal proberen. */
function memoryStore(map) {
  const m = map || new Map();
  return {
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async set(k, v) { m.set(k, JSON.stringify(v)); },
    async del(k) { m.delete(k); }
  };
}

module.exports = { store, memoryStore, TTL_SEC };
