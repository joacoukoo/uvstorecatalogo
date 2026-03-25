#!/usr/bin/env python3
"""
UV Store GT — Data Injector
Toma data.js (generado por uv_admin.py o exportado desde Super.so)
y lo inyecta dentro del index.html como bloques <script type="application/json">.

Uso:
    python inject_data.py                         # usa index.html y data.js en la misma carpeta
    python inject_data.py --html mi.html --data mi_data.js

El script es idempotente: si ya existen los bloques uv-data / uv-covers los reemplaza.
"""

import json, re, sys, argparse
from pathlib import Path


def load_uv_data(data_path: Path) -> dict:
    """Soporta data.js (window.UV_DATA = {...};) y data.json puro."""
    raw = data_path.read_text(encoding="utf-8").strip()
    # Strip window.UV_DATA = prefix if present
    raw = re.sub(r'^window\.UV_DATA\s*=\s*', '', raw)
    raw = raw.rstrip(';').strip()
    return json.loads(raw)


def build_covers(uv_data: dict) -> dict:
    """Usa la imagen del primer producto de cada categoría como cover."""
    covers = {}
    for cat, val in uv_data.items():
        prods = val.get("products", [])
        covers[cat] = prods[0]["i"] if prods else ""
    return covers


def normalize_products(uv_data: dict) -> dict:
    """
    Asegura que todos los productos tengan los campos que espera el JS del catálogo.
    Campos requeridos: n, i, precio, marca, escala, disp, fotos, content, yt
    """
    for cat, val in uv_data.items():
        for p in val.get("products", []):
            p.setdefault("precio",  "")
            p.setdefault("marca",   "")
            p.setdefault("escala",  "")
            p.setdefault("disp",    "")      # "" = ni stock ni pre-orden (consultar)
            p.setdefault("fotos",   [p["i"]] if p.get("i") else [])
            p.setdefault("content", [])
            p.setdefault("yt",      "")
    return uv_data


def inject_into_html(html: str, uv_data: dict, uv_covers: dict) -> str:
    """
    Inyecta (o reemplaza) los bloques JSON en el HTML.
    Estrategia:
      1. Si ya existen los bloques → los reemplaza.
      2. Si no → los inserta justo antes del primer <script> sin src (el bloque JS principal).
    """
    data_json   = json.dumps(uv_data,   ensure_ascii=False, separators=(",", ":"))
    covers_json = json.dumps(uv_covers, ensure_ascii=False, separators=(",", ":"))

    covers_block = f'<script type="application/json" id="uv-covers">{covers_json}</script>'
    data_block   = f'<script type="application/json" id="uv-data">{data_json}</script>'

    # Replace existing uv-covers block
    if 'id="uv-covers"' in html:
        html = re.sub(
            r'<script[^>]+id="uv-covers"[^>]*>.*?</script>',
            covers_block,
            html, flags=re.DOTALL
        )
    # Replace existing uv-data block
    if 'id="uv-data"' in html:
        html = re.sub(
            r'<script[^>]+id="uv-data"[^>]*>.*?</script>',
            data_block,
            html, flags=re.DOTALL
        )

    # If neither existed, inject before the first inline <script> (the main JS block)
    if 'id="uv-data"' not in html:
        injection = f"\n{covers_block}\n{data_block}\n"
        # Find first <script> without a src= attribute
        match = re.search(r'<script(?![^>]*\bsrc\b)[^>]*>', html)
        if match:
            pos = match.start()
            html = html[:pos] + injection + html[pos:]
        else:
            # Fallback: inject before </body>
            html = html.replace("</body>", injection + "</body>")

    return html


def main():
    parser = argparse.ArgumentParser(description="Inyecta data.js en index.html")
    parser.add_argument("--html",   default="index.html",  help="Ruta al index.html")
    parser.add_argument("--data",   default="data.js",     help="Ruta al data.js o data.json")
    parser.add_argument("--output", default=None,          help="Archivo de salida (default: sobreescribe --html)")
    args = parser.parse_args()

    html_path = Path(args.html)
    data_path = Path(args.data)
    out_path  = Path(args.output) if args.output else html_path

    if not html_path.exists():
        print(f"❌  No se encontró: {html_path}"); sys.exit(1)
    if not data_path.exists():
        print(f"❌  No se encontró: {data_path}"); sys.exit(1)

    print(f"📂  HTML:   {html_path}")
    print(f"📂  Datos:  {data_path}")

    uv_data   = load_uv_data(data_path)
    uv_data   = normalize_products(uv_data)
    uv_covers = build_covers(uv_data)

    total = sum(len(v.get("products", [])) for v in uv_data.values())
    print(f"✅  {total} figuras en {len(uv_data)} categorías")
    for cat, val in uv_data.items():
        print(f"    {cat}: {len(val.get('products', []))}")

    html = html_path.read_text(encoding="utf-8")
    html = inject_into_html(html, uv_data, uv_covers)

    out_path.write_text(html, encoding="utf-8")
    print(f"\n✅  Guardado en: {out_path}")
    print(f"    Tamaño: {out_path.stat().st_size / 1024:.1f} KB")
    print("\n🚀  Listo para subir a Cloudflare Pages.")


if __name__ == "__main__":
    main()
