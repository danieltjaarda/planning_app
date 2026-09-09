// Bestandsopslag voor geüploade draaiboeken.
//
// Op Vercel: een privé Blob-store (BLOB_READ_WRITE_TOKEN wordt gezet zodra je
// hem aan het project koppelt). Privé betekent: alleen de server kan de
// bestanden lezen. De app haalt ze op via api/draaiboek met het
// formulier-token, zodat alleen wie de link heeft erbij kan.
//
// Zonder token (lokaal, tests): een geheugenvariant.
//
// Bestanden die met een _ beginnen ziet Vercel niet als losse functie.

const MAX_PER_FORM = 10;

function safeName(naam) {
  return String(naam || "bestand").replace(/[^\w.\-]+/g, "-").replace(/^[.\-]+|-+$/g, "").slice(0, 80) || "bestand";
}

function blobStore() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const { put, get, del } = require("@vercel/blob");
  return {
    async save(buf, mime, naam) {
      // Privé: alleen te lezen met het token van de server, nooit via een losse URL.
      const r = await put("draaiboek/" + safeName(naam), buf, {
        access: "private", addRandomSuffix: true, contentType: mime
      });
      return r.url;
    },
    async open(url) {
      const r = await get(url, { access: "private", useCache: false });
      if (!r || r.statusCode !== 200 || !r.stream) return null;
      return Buffer.from(await new Response(r.stream).arrayBuffer());
    },
    async remove(urls) {
      if (urls && urls.length) await del(urls);
    }
  };
}

function memoryFiles(map) {
  const m = map || new Map();
  let n = 0;
  return {
    map: m,
    async save(buf, mime, naam) { const url = "mem://" + (++n) + "/" + safeName(naam); m.set(url, buf); return url; },
    async open(url) { return m.has(url) ? m.get(url) : null; },
    async remove(urls) { for (const u of urls || []) m.delete(u); }
  };
}

/** Voegt een bestand toe aan een formulierrecord en geeft het nieuwe record terug. */
function withFile(rec, info) {
  const lijst = Array.isArray(rec.bestanden) ? rec.bestanden.slice() : [];
  lijst.push(info);
  return Object.assign({}, rec, { bestanden: lijst.slice(-MAX_PER_FORM) });
}

/** Wat de buitenwereld mag zien: geen opslag-URL's. */
function publicFiles(rec) {
  return (Array.isArray(rec.bestanden) ? rec.bestanden : []).map((b) => ({
    naam: b.naam, mime: b.mime, grootte: b.grootte, at: b.at
  }));
}

module.exports = { blobStore, memoryFiles, withFile, publicFiles, safeName, MAX_PER_FORM };
