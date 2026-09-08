// Lokale server: serveert public/ én api/formulier, zodat je de formulierlink
// ook op je eigen computer kunt proberen. Zonder Redis-instellingen bewaart
// hij de formulieren in het geheugen (weg na herstart); mét KV_REST_API_URL
// en KV_REST_API_TOKEN praat hij tegen dezelfde Redis als de Vercel-deploy.
//
// Bindt bewust alleen op 127.0.0.1: er staan telefoonnummers van klanten in.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, "public");
const PORT = Number(process.env.PORT || 8787);

const require = createRequire(import.meta.url);
const formulier = require("./api/formulier.js");
const hasRedis = !!((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
                    (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN));
const memory = hasRedis ? null : formulier.memoryStore();

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".ico": "image/x-icon" };

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 64 * 1024) req.destroy(); });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  if (url.pathname === "/api/formulier") {
    req.query = Object.fromEntries(url.searchParams);
    req.body = req.method === "POST" ? await readBody(req) : undefined;
    if (memory) {
      try { await formulier.handle(req, res, memory); }
      catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: "server", melding: String(e) })); }
    } else {
      await formulier(req, res);
    }
    return;
  }

  let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  if (p === "/" || p === "\\") p = "/index.html";
  try {
    const data = await readFile(join(PUBLIC, p));
    res.setHeader("Content-Type", TYPES[extname(p)] || "application/octet-stream");
    res.end(data);
  } catch (e) {
    res.statusCode = 404;
    res.end("niet gevonden");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Weekzicht op http://127.0.0.1:${PORT}  (formulieren: ${hasRedis ? "Redis" : "in het geheugen"})`);
});
