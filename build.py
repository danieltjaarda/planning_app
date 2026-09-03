#!/usr/bin/env python3
"""Bouwt index.html uit src/weekzicht.html.

Het artifact is een fragment: claude.ai zet er zelf een <head> omheen.
Om de pagina lokaal identiek te laten werken plakken we diezelfde
omhulling eromheen. [hidden] is daarbij niet optioneel — menu-items staan
op display:flex en zouden zonder die regel zichtbaar blijven.
"""
import io, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src", "weekzicht.html")
OUT = os.path.join(ROOT, "index.html")

HEAD = """<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light; }
  body { margin: 0; font: 14px system-ui, -apple-system, sans-serif; background: #faf9f7; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
"""

def main():
    frag = io.open(SRC, encoding="utf-8").read()
    io.open(OUT, "w", encoding="utf-8").write(HEAD + frag + "\n</body>\n</html>\n")
    print("index.html gebouwd (%d bytes)" % os.path.getsize(OUT))

if __name__ == "__main__":
    sys.exit(main())
