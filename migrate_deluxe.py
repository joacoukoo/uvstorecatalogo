#!/usr/bin/env python3
"""
migrate_deluxe.py — UV Store GT
Unifica productos "– Deluxe Version" con su contraparte regular.

Para cada producto cuyo nombre contiene "Deluxe Version":
  1. Busca el producto regular (mismo nombre sin el sufijo)
  2. Copia precio → precio_d y fotos → fotos_d en el regular
  3. Elimina la entrada Deluxe separada

Muestra un preview antes de modificar el JSON.
"""

import json, re, unicodedata
from pathlib import Path

CATALOG_FILE = Path(__file__).parent / "productos.json"

DELUXE_PATTERNS = [
    r"\s*[–—-]\s*deluxe version\s*$",
    r"\s*[–—-]\s*deluxe\s*$",
    r"\s*\(deluxe version\)\s*$",
    r"\s*\(deluxe\)\s*$",
]

def norm(s):
    s = s.lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s).strip()

def strip_deluxe_suffix(name):
    n = name
    for pat in DELUXE_PATTERNS:
        n = re.sub(pat, "", n, flags=re.IGNORECASE).strip()
    return n

def find_regular(products, deluxe_name):
    """Find the regular product that matches the deluxe name."""
    base = norm(strip_deluxe_suffix(deluxe_name))
    for i, p in enumerate(products):
        candidate = norm(p.get("n", ""))
        # Skip products that are themselves deluxe
        is_dlx = any(re.search(pat, p.get("n",""), re.IGNORECASE) for pat in DELUXE_PATTERNS)
        if not is_dlx and candidate == base:
            return i
    return None

def main():
    catalog = json.loads(CATALOG_FILE.read_text(encoding="utf-8"))

    pairs = []   # (cat, deluxe_idx, regular_idx, deluxe_product, regular_product)
    orphans = [] # deluxe products with no regular match

    for cat, val in catalog.items():
        products = val.get("products", [])
        for i, p in enumerate(products):
            name = p.get("n", "")
            is_dlx = any(re.search(pat, name, re.IGNORECASE) for pat in DELUXE_PATTERNS)
            if not is_dlx:
                continue
            reg_idx = find_regular(products, name)
            if reg_idx is not None:
                pairs.append((cat, i, reg_idx, p, products[reg_idx]))
            else:
                orphans.append((cat, i, p))

    if not pairs and not orphans:
        print("No se encontraron productos con sufijo Deluxe. Nada que migrar.")
        return

    print(f"\n{'='*60}")
    print(f"  PREVIEW DE MIGRACIÓN — {len(pairs)} pares encontrados")
    print(f"{'='*60}\n")

    for cat, dlx_i, reg_i, dlx, reg in pairs:
        print(f"  Categoría : {cat}")
        print(f"  Regular   : {reg.get('n')}  (precio: Q{reg.get('precio','')})")
        print(f"  Deluxe    : {dlx.get('n')}  (precio: Q{dlx.get('precio','')})")
        print(f"  Fotos Dlx : {len(dlx.get('fotos',[]))} fotos")
        print(f"  Acción    : precio_d=Q{dlx.get('precio','')}, fotos_d=[{len(dlx.get('fotos',[]))} fotos] → al Regular")
        print(f"             Deluxe separada → ELIMINADA")
        print()

    if orphans:
        print(f"  HUÉRFANOS ({len(orphans)} — no se encontró contraparte regular):")
        for cat, i, p in orphans:
            print(f"    [{cat}] {p.get('n')}")
        print()

    confirm = input("¿Ejecutar migración? (s/N): ").strip().lower()
    if confirm != "s":
        print("Cancelado. No se modificó nada.")
        return

    # Execute — process in reverse index order to avoid shifting issues
    for cat, dlx_i, reg_i, dlx, reg in pairs:
        products = catalog[cat]["products"]
        # Merge deluxe data into regular
        products[reg_i]["precio_d"] = dlx.get("precio", "")
        products[reg_i]["fotos_d"]  = list(dlx.get("fotos", []))
        products[reg_i]["agotado_r"] = False
        products[reg_i]["agotado_d"] = False

    # Remove deluxe entries (collect indices per category, remove in reverse)
    to_remove = {}
    for cat, dlx_i, reg_i, dlx, reg in pairs:
        to_remove.setdefault(cat, []).append(dlx_i)

    for cat, indices in to_remove.items():
        for i in sorted(set(indices), reverse=True):
            catalog[cat]["products"].pop(i)

    # Save
    CATALOG_FILE.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(f"\n✅ Migración completada — {len(pairs)} pares unificados.")
    print(f"   productos.json guardado. Abrí el admin y publicá en GitHub.")

if __name__ == "__main__":
    main()
