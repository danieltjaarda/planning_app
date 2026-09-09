// Bouwt public/index.html uit src/weekzicht.html.
//
// De bron is een fragment: claude.ai zet er als artifact zelf een <head>
// omheen. Om de pagina buiten dat platform identiek te laten werken plakken
// we diezelfde omhulling eromheen. [hidden] is daarbij niet optioneel —
// menu-items staan op display:flex en zouden zonder die regel zichtbaar
// blijven zodra de code ze verbergt.
//
// Node, geen Python: dit draait ook op een kale Vercel-build.

import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, "src", "weekzicht.html");
const OUT_DIR = join(ROOT, "public");
const OUT = join(OUT_DIR, "index.html");

const HEAD = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Weekzicht</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="Mediaspot">
<meta property="og:title" content="Vertel me over jullie trouwdag">
<meta property="og:description" content="Vul het formulier in, dan weet ik precies wat ik op jullie dag moet vastleggen. Duurt een paar minuten.">
<meta property="og:image" content="https://planning-app-three.vercel.app/og-formulier.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="nl_NL">
<meta name="twitter:card" content="summary_large_image">
<style>
  :root { color-scheme: light; }
  body { margin: 0; font: 14px system-ui, -apple-system, sans-serif; background: #faf9f7; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, HEAD + readFileSync(SRC, "utf8") + "\n</body>\n</html>\n", "utf8");
writeFileSync(join(OUT_DIR, "inloggen.html"), readFileSync(join(ROOT, "src", "inloggen.html"), "utf8"), "utf8");
writeFileSync(join(OUT_DIR, "og-formulier.png"), readFileSync(join(ROOT, "src", "og-formulier.png")));
console.log(`public/index.html gebouwd (${statSync(OUT).size} bytes)`);
