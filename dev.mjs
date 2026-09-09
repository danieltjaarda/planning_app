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

// .env inlezen (alleen lokaal; op Vercel staan de variabelen in het project)
try {
  const env = await readFile(join(ROOT, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (e) { /* geen .env — prima */ }
const PUBLIC = join(ROOT, "public");
const PORT = Number(process.env.PORT || 8787);

const require = createRequire(import.meta.url);
const formulier = require("./api/formulier.js");
const draaiboek = require("./api/draaiboek.js");
const bestanden = require("./api/_bestanden.js");
const inloggen = require("./api/inloggen.js");
const { previewHtml, isCrawler } = await import("./middleware.js");
const sessie = require("./api/_sessie.js");
const files = bestanden.blobStore() || bestanden.memoryFiles();
const hasRedis = !!((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
                    (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN));
const memory = hasRedis ? null : formulier.memoryStore();

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".ico": "image/x-icon", ".png": "image/png" };

function readBody(req, limit) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > (limit || 64 * 1024)) req.destroy(); });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  if (url.pathname === "/api/inloggen") {
    req.query = Object.fromEntries(url.searchParams);
    req.body = req.method === "POST" ? await readBody(req) : undefined;
    await inloggen.handle(req, res);
    return;
  }

  // wat middleware.js op Vercel doet: planning alleen ingelogd, formulierlink vrij
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const f = url.searchParams.get("f") || "";
    if (/^[a-z0-9]{12,40}$/.test(f) && isCrawler(req.headers["user-agent"])) {
      const rec = memory ? await memory.get("formulier:" + f) : null;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(previewHtml(rec && rec.naam ? rec.naam : "", "http://127.0.0.1:" + PORT + "/?f=" + f));
      return;
    }
    if (!/^[a-z0-9]{12,40}$/.test(f) && !sessie.ingelogd(req)) {
      res.statusCode = 302;
      res.setHeader("Location", "/inloggen.html");
      res.end();
      return;
    }
  }

  if (url.pathname === "/api/formulier") {
    req.query = Object.fromEntries(url.searchParams);
    req.body = req.method === "POST" ? await readBody(req) : undefined;
    if (memory) {
      try { await formulier.handle(req, res, memory, files); }
      catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: "server", melding: String(e) })); }
    } else {
      await formulier(req, res);
    }
    return;
  }

  if (url.pathname === "/api/draaiboek") {
    req.query = Object.fromEntries(url.searchParams);
    req.body = req.method === "POST" ? await readBody(req, 6 * 1024 * 1024) : undefined;
    try { await draaiboek.handle(req, res, memory || null, process.env.OPENROUTER_API_KEY, null, files); }
    catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: "server", melding: String(e) })); }
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
  console.log(`Weekzicht op http://127.0.0.1:${PORT}  (formulieren: ${hasRedis ? "Redis" : "in het geheugen"}, draaiboek-AI: ${process.env.OPENROUTER_API_KEY ? "aan" : "uit — zet OPENROUTER_API_KEY in .env"}, bestanden: ${process.env.BLOB_READ_WRITE_TOKEN ? "Vercel Blob" : "in het geheugen"}, wachtwoord: ${sessie.beveiligd() ? "aan" : "uit — zet WEEKZICHT_WACHTWOORD in .env"})`);
});
