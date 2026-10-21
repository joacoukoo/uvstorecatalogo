#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UV Store GT -- Data Injector v3
Lee productos.json e index_template.html y genera index.html.

Uso:
    python inject_data.py
    python inject_data.py --template index_template.html --data productos.json --output index.html
"""

import json, re, sys, argparse, unicodedata
from datetime import date
from pathlib import Path


def inject(template_path, data_path, output_path):
    if not template_path.exists():
        print("ERROR: No se encontro: " + str(template_path)); sys.exit(1)
    if not data_path.exists():
        print("ERROR: No se encontro: " + str(data_path)); sys.exit(1)

    data = json.loads(data_path.read_text(encoding="utf-8"))
    total = sum(len(v.get("products", [])) for v in data.values())
    print(str(total) + " figuras en " + str(len(data)) + " categorias")

    # ensure_ascii=True evita problemas de encoding en Windows
    data_json = json.dumps(data, ensure_ascii=True, separators=(",", ":"))

    html = template_path.read_text(encoding="utf-8")

    # Encontrar el bloque uv-data y reemplazarlo con str.replace (no regex)
    start_tag = '<script type="application/json" id="uv-data">'
    end_tag   = '</script>'

    idx_start = html.find(start_tag)
    if idx_start == -1:
        print("ERROR: No se encontro el bloque uv-data en el template"); sys.exit(1)

    idx_data_start = idx_start + len(start_tag)
    idx_end = html.find(end_tag, idx_data_start)
    if idx_end == -1:
        print("ERROR: No se encontro el cierre del bloque uv-data"); sys.exit(1)

    new_html = html[:idx_data_start] + data_json + html[idx_end:]

    output_path.write_text(new_html, encoding="utf-8")
    size_kb = output_path.stat().st_size // 1024
    print("index.html generado: " + str(size_kb) + " KB")
    print("Listo para publicar.")


SITIO = "https://uvstore.shop"


def slug(s):
    # Igual que toSlug() en functions/categoria y functions/marca
    s = unicodedata.normalize("NFD", str(s).lower())
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def build_sitemap(data_path, sitemap_path):
    """sitemap.xml para Google: portada, categorias, marcas y cada figura (sin Adultos)."""
    data = json.loads(data_path.read_text(encoding="utf-8"))
    hoy = date.today().isoformat()
    urls = [(SITIO + "/", hoy)]
    marcas, figuras = [], []
    for cat, v in data.items():
        if cat == "Adultos":
            continue
        urls.append((SITIO + "/categoria/" + slug(cat), hoy))
        for p in v.get("products", []):
            m = slug(p.get("marca") or "")
            if m and m not in marcas:
                marcas.append(m)
            if p.get("id"):
                figuras.append((SITIO + "/p/" + p["id"], (p.get("added_at") or "")[:10]))
    urls += [(SITIO + "/marca/" + m, hoy) for m in marcas] + figuras
    filas = ["  <url><loc>" + u + "</loc>" + ("<lastmod>" + f + "</lastmod>" if f else "") + "</url>"
             for u, f in urls]
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           + "\n".join(filas) + "\n</urlset>\n")
    sitemap_path.write_text(xml, encoding="utf-8")
    print("sitemap.xml: " + str(len(urls)) + " URLs")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", default="index_template.html")
    parser.add_argument("--data",     default="productos.json")
    parser.add_argument("--output",   default="index.html")
    parser.add_argument("--sitemap",  default="sitemap.xml")
    args = parser.parse_args()

    inject(Path(args.template), Path(args.data), Path(args.output))
    build_sitemap(Path(args.data), Path(args.sitemap))


if __name__ == "__main__":
    main()
