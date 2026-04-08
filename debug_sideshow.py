#!/usr/bin/env python3
"""
debug_sideshow.py — UV Store GT
Corre esto con: python debug_sideshow.py <url-de-sideshow>
Muestra qué HTML encuentra el scraper en las secciones de contenido.
"""
import sys, re, requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse
import io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
os.environ["PYTHONIOENCODING"] = "utf-8"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xhtml+xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

def sep(title): print(f"\n{'='*60}\n  {title}\n{'='*60}")

url = sys.argv[1] if len(sys.argv) > 1 else input("URL de Sideshow: ").strip()
print(f"Descargando {url} ...")
r = requests.get(url, headers=HEADERS, timeout=20)
html = r.text
soup = BeautifulSoup(html, "html.parser")
print(f"OK — {len(html)} bytes")

# ── 1. JSON-LD ──
sep("JSON-LD scripts")
for i, s in enumerate(soup.find_all("script", type="application/ld+json")):
    print(f"[{i}] {(s.string or '')[:300]}\n")

# ── 2. Embedded product JSON ──
sep("Embedded JS patterns (description, body_html, features)")
for pattern, label in [
    (r'"description"\s*:\s*"(.{30,300})"', "description"),
    (r'"body"\s*:\s*"(.{30,300})"', "body"),
    (r'"features"\s*:\s*\[', "features array"),
    (r'productDetails\s*[:=]\s*\{', "productDetails"),
    (r'window\.__[A-Z_]+\s*=', "window.__VAR__"),
]:
    matches = re.findall(pattern, html[:30000], re.I)
    if matches:
        print(f"  [{label}]: {matches[0][:200]}")

# ── 3. All unique class names that mention accordion/tab/panel/detail ──
sep("Classes containing accordion / tab / panel / detail / spec / box")
found_classes = set()
for el in soup.find_all(True):
    for cls in el.get("class", []):
        c = cls.lower()
        if any(k in c for k in ["accordion","tab","panel","detail","spec","box","feature","section","content","description"]):
            found_classes.add(cls)
for c in sorted(found_classes):
    print(f"  .{c}")

# ── 4. Find headers with section names ──
sep("Headers containing Details / Box / Features / Specifications")
for tag in soup.find_all(["h1","h2","h3","h4","h5","button","span","div","strong","li","a"]):
    t = tag.get_text(strip=True).lower()
    if any(k in t for k in ["what's in the box","what is in","additional detail","in the box","specifications","features","details"]):
        print(f"  <{tag.name} class='{' '.join(tag.get('class',[]))}'>: {tag.get_text(strip=True)[:100]}")

# ── 5. All <ul> elements with content ──
sep("All <ul> with 3+ items (showing class, parent class, first 2 items)")
for ul in soup.find_all("ul"):
    items = [li.get_text(strip=True) for li in ul.find_all("li",recursive=False) if li.get_text(strip=True)]
    if len(items) >= 3:
        cls = " ".join(ul.get("class",[]))
        pcls = " ".join(ul.parent.get("class",[]) if ul.parent else [])
        print(f"  ul.'{cls}' inside .'{pcls}'")
        print(f"    → {items[0][:80]}")
        print(f"    → {items[1][:80]}")
        print(f"    ({len(items)} items total)\n")

# ── 6. data-* attributes ──
sep("Unique data-* attributes on elements")
data_attrs = set()
for el in soup.find_all(True):
    for attr in el.attrs:
        if attr.startswith("data-"):
            data_attrs.add(attr)
for a in sorted(data_attrs):
    print(f"  {a}")

# ── 7. Edition / variant selector links ──
sep("Links with ?var= (edition selectors)")
for a in soup.find_all("a", href=re.compile(r'\?var=\d+')):
    print(f"  href={a.get('href','')}  text={repr(a.get_text(strip=True)[:60])}  class={a.get('class','')}")

# ── 8. pdp-info__details sections ──
sep("pdp-info__details sections (visible/hidden)")
for div in soup.find_all("div", class_=re.compile(r'pdp-info__details')):
    classes = " ".join(div.get("class", []))
    # Find edition label inside
    label_el = div.select_one(".pdp-info__edition-label, .edition-label, [class*='edition']")
    label = label_el.get_text(strip=True) if label_el else "(no label found)"
    # Find any ?var= link inside
    var_link = div.find("a", href=re.compile(r'\?var='))
    var_href = var_link.get("href") if var_link else "(no var link)"
    # First 100 chars of text
    snippet = div.get_text(" ", strip=True)[:100]
    print(f"\n  .{classes}")
    print(f"    label_el: {label}")
    print(f"    var_link: {var_href}")
    print(f"    snippet:  {snippet}")

# ── 9. JSON with var/sku/edition data ──
sep("JS patterns: var/sku/edition in scripts")
for pattern, label in [
    (r'"var"\s*:\s*"?(\d{5,})"?', "var"),
    (r'"sku"\s*:\s*"(\d{5,})"', "sku"),
    (r'"edition"\s*:\s*"([^"]{3,50})"', "edition"),
    (r'\?var=(\d{5,})', "?var= in JS"),
    (r'"variants"\s*:\s*\[', "variants array"),
]:
    matches = re.findall(pattern, html)
    if matches:
        print(f"  [{label}]: {matches[:10]}")
