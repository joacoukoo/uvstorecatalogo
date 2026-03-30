#!/usr/bin/env python3
"""
UV Store GT — Admin Tool v4
- Agregar figuras nuevas desde URL de proveedor
- Editar figuras existentes (precio, reserva, entrega, descripción, fotos, etc.)
- Subir fotos desde computadora (vía Imgur)
- Deploy automático a GitHub → Cloudflare Pages
Requiere: pip install requests beautifulsoup4 Pillow deep-translator
"""

import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import threading, json, re, os, sys, subprocess, base64, shutil, datetime, unicodedata
from pathlib import Path
from io import BytesIO
from urllib.parse import urljoin, unquote, urlparse

try:
    import requests
    from bs4 import BeautifulSoup
    from PIL import Image, ImageTk
    from deep_translator import GoogleTranslator
except ImportError:
    print("Instalando dependencias...")
    os.system(f"{sys.executable} -m pip install requests beautifulsoup4 Pillow deep-translator")
    import requests
    from bs4 import BeautifulSoup
    from PIL import Image, ImageTk
    from deep_translator import GoogleTranslator

# ─── CONFIG ───────────────────────────────────────────────────────────────────

CATALOG_FILE  = Path(__file__).parent / "productos.json"   # datos del catálogo
TEMPLATE_FILE = Path(__file__).parent / "index_template.html"  # diseño sin datos
OUTPUT_FILE   = Path(__file__).parent / "index.html"       # resultado final
CONFIG_FILE   = Path(__file__).parent / "uv_config.json"

CAT_KEYS = [
    "Entrega Inmediata",
    "Hot Toys 1:6",
    "Estatuas Premium",
    "Otras Figuras",
    "Vitrinas Para Figuras",
    "Adultos",
]
CAT_DISP = {
    "Entrega Inmediata":    "Entrega Inmediata",
    "Hot Toys 1:6":         "Pre Orden",
    "Estatuas Premium":     "Pre Orden",
    "Otras Figuras":        "Pre Orden",
    "Vitrinas Para Figuras":"Solo Bajo Pedido",
    "Adultos":              "Pre Orden",
}
WA_NUMBER = "50230261622"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

PROVIDER_PLATFORMS = {
    "sideshow.com":          "sideshow",
    "nonasea.com":           "spa",
    "lionrocktoyz.com":      "shopify",
    "fanaticanimestore.com": "bigcommerce",
    "statuecorp.com":        "shopify",
    "tnsfigures.com":        "shopify",
    "mondoshop.com":         "shopify",
    "specfictionshop.com":   "shopify",
    "onesixthkit.com":       "opencart",
    "entertainmentearth.com":"generic",
    "bigbadtoystore.com":    "generic",
    "hottoys.com.hk":        "generic",
}

BG="#111111"; BG2="#1a1a1a"; BG3="#0a0a0a"; BG4="#222"
PURPLE="#7B2FBE"; GREEN="#4ade80"; ORANGE="#f4a261"; RED="#ef4444"
TEXT="#f0f0f0"; MUTED="#aaaaaa"

# ─── CONFIG HELPERS ───────────────────────────────────────────────────────────

def load_config():
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except: pass
    return {"imgur_client_id": "", "github_repo": "", "github_token": "", "github_branch": "main", "anthropic_api_key": ""}

def save_config(cfg):
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")

# ─── IMGUR UPLOAD ─────────────────────────────────────────────────────────────

def upload_to_imgur(image_path_or_bytes, client_id):
    """Upload image to Imgur. Returns URL or raises exception."""
    if not client_id:
        raise ValueError("Falta el Imgur Client ID. Configuralo en ⚙ Configuración.")
    if isinstance(image_path_or_bytes, (str, Path)):
        with open(image_path_or_bytes, "rb") as f:
            data = f.read()
    else:
        data = image_path_or_bytes
    b64 = base64.b64encode(data).decode("utf-8")
    r = requests.post(
        "https://api.imgur.com/3/image",
        headers={"Authorization": f"Client-ID {client_id}"},
        data={"image": b64, "type": "base64"},
        timeout=30,
    )
    r.raise_for_status()
    result = r.json()
    if not result.get("success"):
        raise ValueError(f"Imgur error: {result.get('data',{}).get('error','desconocido')}")
    return result["data"]["link"]

# ─── GITHUB DEPLOY ────────────────────────────────────────────────────────────

def git_deploy(repo_path, commit_msg="Update catalog", status_cb=None):
    """Run git add + commit + push in repo_path. Returns (success, message)."""
    def log(m):
        if status_cb: status_cb(m)
        print(m)
    try:
        # Check git is available
        result = subprocess.run(["git", "--version"], capture_output=True, text=True)
        if result.returncode != 0:
            return False, "Git no está instalado. Instalalo desde https://git-scm.com"
        
        cwd = str(repo_path)
        
        # git add — include all relevant files
        r = subprocess.run(
            ["git", "add", "index.html", "productos.json", "index_template.html", "functions/", "assets/"],
            cwd=cwd, capture_output=True, text=True)
        if r.returncode != 0:
            return False, f"git add falló: {r.stderr}"
        
        # git commit
        r = subprocess.run(["git", "commit", "-m", commit_msg], cwd=cwd, capture_output=True, text=True)
        if r.returncode != 0:
            if "nothing to commit" in r.stdout.lower() or "nothing to commit" in r.stderr.lower():
                return True, "Sin cambios nuevos para subir."
            return False, f"git commit falló: {r.stderr}"
        
        log("📤 Subiendo a GitHub...")
        
        # git push
        r = subprocess.run(["git", "push"], cwd=cwd, capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            return False, f"git push falló: {r.stderr}\n\nAsegurate de haber configurado git con tu usuario y token."
        
        return True, "✅ Subido a GitHub. Cloudflare desplegará en ~30 segundos."
    except subprocess.TimeoutExpired:
        return False, "Timeout — verificá tu conexión a internet."
    except FileNotFoundError:
        return False, "Git no está instalado. Descargalo en https://git-scm.com/downloads"
    except Exception as e:
        return False, str(e)

# ─── TRANSLATION ──────────────────────────────────────────────────────────────

def translate_es(text, max_chars=4500):
    if not text or not text.strip(): return text
    spanish_words = ["figura","escala","incluye","coleccionista","articulado","altura","disponible","nuevo","edición"]
    if any(w in text.lower() for w in spanish_words): return text
    try:
        translator = GoogleTranslator(source="auto", target="es")
        if len(text) <= max_chars: return translator.translate(text)
        chunks = []
        while text:
            chunk = text[:max_chars]
            last_period = chunk.rfind(". ")
            if last_period > max_chars * 0.6: chunk = text[:last_period+1]
            chunks.append(translator.translate(chunk))
            text = text[len(chunk):].strip()
        return " ".join(chunks)
    except Exception as e:
        print(f"Translation error: {e}"); return text

def translate_list(items):
    if not items: return items
    try:
        translator = GoogleTranslator(source="auto", target="es")
        result = []
        for item in items:
            try: result.append(translator.translate(item) if item.strip() else item)
            except: result.append(item)
        return result
    except: return items

def clean_features(raw_text):
    """Toma texto pegado y lo convierte en lineas limpias."""
    import re as _re
    NL = "\n"
    if not raw_text or not raw_text.strip(): return ""
    text = raw_text.strip()
    text = _re.sub(r"[ \t]*[\-\*][ \t]+", NL, text)
    text = _re.sub(r"[ \t]*\d+[\.\)][ \t]+", NL, text)
    if NL not in text or text.count(NL) < 2:
        text = _re.sub(r"\.( +)([A-Z])", "." + NL + "\\2", text)
    lines = []
    for line in text.splitlines():
        line = line.strip().strip("-* ")
        if line and len(line) > 3:
            lines.append(line)
    return NL.join(lines)

# ─── PLATFORM SCRAPERS ────────────────────────────────────────────────────────

def detect_platform(url, html_text):
    domain = urlparse(url).netloc.replace("www.", "")
    for known_domain, platform in PROVIDER_PLATFORMS.items():
        if known_domain in domain: return platform
    if "cdn.shopify.com" in html_text or "shopify" in html_text.lower()[:2000]: return "shopify"
    if "woocommerce" in html_text.lower()[:2000] or "wc-block" in html_text: return "woocommerce"
    if "index.php?route=product" in url or "opencart" in html_text.lower(): return "opencart"
    return "generic"

def scrape_shopify(url, html, soup):
    parsed = urlparse(url)
    json_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path.rstrip('/')}.json"
    photos, name, desc, features, price, escala, marca = [], "", "", [], "", "", ""
    try:
        r = requests.get(json_url, headers=HEADERS, timeout=10)
        if r.status_code == 200:
            data = r.json().get("product", {})
            name = data.get("title", "")
            desc_soup = BeautifulSoup(data.get("body_html",""), "html.parser")
            desc = desc_soup.get_text(" ", strip=True)
            for ul in desc_soup.find_all(["ul","ol"]):
                items = [li.get_text(strip=True) for li in ul.find_all("li") if li.get_text(strip=True)]
                if len(items) > 2: features = items[:20]; break
            for img in data.get("images", [])[:8]:
                src = img.get("src","")
                if src: photos.append(re.sub(r'_\d+x\d*(?:@\d+x)?(\.\w+)(\?.*)?$', r'\1', src))
            variants = data.get("variants", [])
            if variants:
                p = variants[0].get("price","")
                if p:
                    try: price = str(round(float(p)))
                    except: price = p
    except: pass
    if not name: name = _get_name(soup)
    if not photos: photos = _get_photos_generic(url, soup, html)
    if not desc: desc = _get_desc(soup)
    if not features: features = _get_features(soup)
    escala = _get_escala(html); marca = _get_marca(name, html, urlparse(url).netloc)
    return _build_result(name, desc, features, photos, escala, marca, price, url)

def scrape_sideshow(url, html, soup):
    # Try SKU from URL slug first
    sku_m = re.search(r'-(\d{6,})\/?(?:\?.*)?$', url)
    sku = sku_m.group(1) if sku_m else ""
    # If URL has ?sku= or ?var= param, use that (variant pages — Sideshow uses ?var= for deluxe/special editions)
    sku_q = re.search(r'[?&](?:sku|var)=(\d{5,})', url)
    if sku_q: sku = sku_q.group(1)
    # Also scan HTML for the actual product SKU in JSON-LD or data attributes
    if not sku:
        sku_html = re.search(r'"sku"\s*:\s*"(\d{5,})"', html)
        if sku_html: sku = sku_html.group(1)
    # Try data-product-id or similar
    if not sku:
        sku_data = re.search(r'product[_-]id["\'\s]*[=:]["\'\s]*(\d{5,})', html, re.I)
        if sku_data: sku = sku_data.group(1)
    photos = []; seen = set()
    if sku:
        for img in soup.find_all("img"):
            for attr in ["src","data-src","data-lazy-src"]:
                src = img.get(attr,"")
                if "product-images" in src and f"/{sku}/" in src and src not in seen:
                    if not src.startswith("http"): src = urljoin(url, src)
                    cdn = f"https://www.sideshow.com/cdn-cgi/image/quality=90,f=auto/{src}" if "cdn-cgi" not in src else src
                    photos.append(cdn); seen.add(src)
        pattern = rf'https://www\.sideshow\.com/storage/product-images/{sku}/[^"\'\s\)>]+\.(?:jpg|webp|png)'
        for img_url in re.findall(pattern, html):
            img_url = unquote(img_url).split("?")[0]
            if img_url not in seen:
                photos.append(f"https://www.sideshow.com/cdn-cgi/image/quality=90,f=auto/{img_url}"); seen.add(img_url)
    unique, fnames = [], set()
    for p in photos:
        fn = p.split("/")[-1].split("?")[0]
        if fn not in fnames: unique.append(p); fnames.add(fn)
    _feats = _get_features(soup)
    return _build_result(_get_name(soup), _get_desc(soup), _feats, unique[:8], _get_escala(html), _get_marca(_get_name(soup), html, "sideshow.com", _feats), "", url)

def scrape_opencart(url, html, soup):
    photos = []; seen = set()
    for img in soup.select(".thumbnail img, #product-images img, .image-additional img, #image img"):
        src = img.get("src") or img.get("data-src","")
        if src and src not in seen:
            if not src.startswith("http"): src = urljoin(url, src)
            photos.append(re.sub(r'-\d+x\d+(\.\w+)$', r'\1', src)); seen.add(src)
    for a in soup.select("a[data-fancybox], a[rel='lightBox']"):
        href = a.get("href","")
        if href and any(ext in href.lower() for ext in [".jpg",".jpeg",".png",".webp"]):
            if href not in seen:
                if not href.startswith("http"): href = urljoin(url, href)
                photos.insert(0, href); seen.add(href)
    if not photos: photos = _get_photos_generic(url, soup, html)
    price = ""
    price_el = soup.select_one(".price, #product-price .price-normal, .product-price")
    if price_el:
        m = re.search(r'[\d,]+\.?\d*', price_el.get_text())
        if m: price = m.group().replace(",","")
    return _build_result(_get_name(soup), _get_desc(soup), _get_features(soup), photos[:8], _get_escala(html), _get_marca(_get_name(soup), html, urlparse(url).netloc), price, url)

def scrape_woocommerce(url, html, soup):
    photos = []; seen = set()
    for img in soup.select(".woocommerce-product-gallery img, .product-gallery img"):
        for attr in ["data-large_image","data-src","src"]:
            src = img.get(attr,"")
            if src and src not in seen and not src.endswith("-100x100.jpg"):
                if not src.startswith("http"): src = urljoin(url, src)
                photos.append(src); seen.add(src); break
    if not photos: photos = _get_photos_generic(url, soup, html)
    price = ""
    price_el = soup.select_one(".price .amount, .woocommerce-Price-amount")
    if price_el:
        m = re.search(r'[\d,]+\.?\d*', price_el.get_text())
        if m: price = m.group().replace(",","")
    return _build_result(_get_name(soup), _get_desc(soup), _get_features(soup), photos[:8], _get_escala(html), _get_marca(_get_name(soup), html, urlparse(url).netloc), price, url)

def scrape_bigcommerce(url, html, soup):
    photos = []; seen = set()
    for img in soup.find_all("img"):
        for attr in ["data-zoom-image", "data-src", "src"]:
            src = img.get(attr, "")
            if not src: continue
            if not src.startswith("http"): src = urljoin(url, src)
            # Solo URLs de CDN de BigCommerce (cdn*.bigcommerce.com), no tracking pixels
            if not re.search(r'cdn\d*\.bigcommerce\.com', src): continue
            # Upscale cualquier thumbnail stencil a 1280x1280
            src = re.sub(r'stencil/\d+x\d+/', 'stencil/1280x1280/', src)
            if src not in seen:
                seen.add(src); photos.append(src)
            if len(photos) >= 8: break
        if len(photos) >= 8: break
    if not photos: photos = _get_photos_generic(url, soup, html)
    name, desc, price = "", "", ""
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            d = json.loads(script.string or "{}")
            if d.get("@type") == "Product":
                name = name or d.get("name", "")
                desc = desc or d.get("description", "")
                offers = d.get("offers", {})
                if isinstance(offers, list): offers = offers[0] if offers else {}
                price = price or str(offers.get("price", ""))
        except: pass
    if not name: name = _get_name(soup)
    if not desc: desc = _get_desc(soup)
    features = _get_features(soup)
    escala = _get_escala(html)
    marca = _get_marca(name, html, urlparse(url).netloc, features)
    return _build_result(name, desc, features, photos[:8], escala, marca, price, url)

def scrape_generic(url, html, soup):
    name, desc, photos, price = "", "", [], ""
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            d = json.loads(script.string or "{}")
            if d.get("@type") in ["Product","product"]:
                name = name or d.get("name",""); desc = desc or d.get("description","")
                imgs = d.get("image",[])
                if isinstance(imgs, str): imgs = [imgs]
                photos.extend([i for i in imgs if i not in photos])
                offers = d.get("offers",{})
                if isinstance(offers, list): offers = offers[0] if offers else {}
                price = price or str(offers.get("price",""))
        except: pass
    if not photos: photos = _get_photos_generic(url, soup, html)
    if not name: name = _get_name(soup)
    if not desc: desc = _get_desc(soup)
    return _build_result(name, desc, _get_features(soup), photos[:8], _get_escala(html), _get_marca(name, html, urlparse(url).netloc), price, url)

def _get_name(soup):
    for sel in ["h1.product-title","h1.product_title","h1[itemprop='name']","h1"]:
        el = soup.select_one(sel)
        if el: return el.get_text(strip=True)
    return ""

def _get_desc(soup):
    for sel in [".product-description","#tab-description",".product-details","[itemprop='description']",".description"]:
        el = soup.select_one(sel)
        if el:
            for tag in el.find_all(["ul","ol","h2","h3","h4"]): tag.extract()
            text = el.get_text(" ", strip=True)
            if len(text) > 60: return text[:1000]
    for p in soup.find_all("p"):
        t = p.get_text(strip=True)
        if len(t) > 80: return t[:800]
    return ""

def _get_features(soup):
    for sel in [".product-description ul","#tab-description ul",".description ul",".product-details ul","article ul"]:
        ul = soup.select_one(sel)
        if ul:
            items = [li.get_text(strip=True) for li in ul.find_all("li") if len(li.get_text(strip=True)) > 4]
            if len(items) > 2: return items[:20]
    return []

def _get_photos_generic(url, soup, html):
    photos = []; seen = set()
    og = soup.find("meta", property="og:image")
    if og and og.get("content"): photos.append(og["content"]); seen.add(og["content"])
    for img in soup.find_all("img"):
        for attr in ["data-large_image","data-zoom-image","data-src","src"]:
            src = img.get(attr,"")
            if not src: continue
            if not src.startswith("http"): src = urljoin(url, src)
            if src in seen: continue
            w = img.get("width","999")
            try:
                if int(str(w)) < 200: continue
            except: pass
            if any(x in src.lower() for x in ["logo","icon","banner","sprite","placeholder"]): continue
            if any(ext in src.lower() for ext in [".jpg",".jpeg",".png",".webp"]):
                photos.append(src); seen.add(src)
                if len(photos) >= 8: break
        if len(photos) >= 8: break
    return photos[:8]

def _get_escala(html):
    escala = ""
    m = re.search(r"(1[:/]6|1[:/]4|1[:/]12|1[:/]3|Sixth Scale|Quarter Scale|1/6|1/12|1/4)", html, re.I)
    if m: escala = m.group(1).replace("Sixth Scale","1:6").replace("Quarter Scale","1:4").replace("/",":")
    m2 = re.search(r"(\d+(?:\.\d+)?)\s*(?:cm|CM)\b", html)
    if m2: escala = (escala + f" - {m2.group(1)}CM").strip(" -")
    return escala[:40]

def _get_marca(name, html, domain, features=None):
    # 1. Buscar campo "Brand:" explícito en las features scrapeadas (ej: páginas de Sideshow)
    if features:
        for f in features:
            m = re.match(r'(?:brand|manufacturer|fabricante|marca)\s*[:\-]\s*(.+)', f, re.I)
            if m:
                return m.group(1).strip()
    # 2. Buscar campo "Brand:" en el HTML (tablas de especificaciones)
    m = re.search(r'(?:Brand|Manufacturer)\s*[:\-<>/\s]+([A-Z][A-Za-z0-9 &\'.]+?)(?:<|\\n|\|)', html)
    if m:
        candidate = m.group(1).strip()
        # Evitar que devuelva palabras genéricas o el propio retailer como marca
        if len(candidate) > 2 and candidate.lower() not in ("inc","llc","ltd","the","and"):
            return candidate
    # 3. Lista de marcas conocidas — buscar en nombre y HTML
    brands = ["Hot Toys","Iron Studios","Prime 1 Studio","Threezero","SH Figuarts",
              "Mondo","Beast Kingdom","NECA","Mezco","First 4 Figures","PCS","Kotobukiya",
              "Bandai","Hasbro","Funko","McFarlane","Asmus Toys","Toys Era","JoyToy",
              "Robosen","PureArts","Tsume Art","Infinite Statue","Trick or Treat Studios",
              "Factory Entertainment","Gentle Giant","XM Studios","Blitzway","Weta Workshop",
              "Chronicle Collectibles","Quantum Mechanix","Sideshow"]
    for b in brands:
        if b.lower() in name.lower() or b.lower() in html.lower()[:3000]: return b
    return ""

def _build_result(name, desc, features, photos, escala, marca, price, url):
    return {"nombre":name,"descripcion":desc,"features":features,"fotos":photos,
            "escala":escala,"marca":marca,"precio_sugerido":price,"url_origen":url,"traducido":False}

def scrape_url(url, translate=True, status_cb=None):
    if not url.startswith("http"): url = "https://" + url
    def log(msg):
        if status_cb: status_cb(msg)
        print(msg)
    log("Descargando página...")
    r = requests.get(url, headers=HEADERS, timeout=15)
    r.raise_for_status()
    html = r.text; soup = BeautifulSoup(html, "html.parser")
    platform = detect_platform(url, html)
    log(f"Plataforma: {platform}")
    if platform == "spa":
        raise ValueError("Esta tienda carga sus productos con JavaScript (SPA). El scraper automático no puede leerla. Copiá los datos manualmente o usá la URL directa de la imagen del producto.")
    scrapers = {"shopify":scrape_shopify,"sideshow":scrape_sideshow,"opencart":scrape_opencart,"woocommerce":scrape_woocommerce,"bigcommerce":scrape_bigcommerce,"generic":scrape_generic}
    data = scrapers.get(platform, scrape_generic)(url, html, soup)
    if not data["fotos"]: data["fotos"] = _get_photos_generic(url, soup, html)
    if translate and data.get("descripcion"):
        log("Traduciendo..."); data["descripcion"] = translate_es(data["descripcion"])
        if data.get("features"): data["features"] = translate_list(data["features"])
        data["traducido"] = True
    log(f"OK {len(data['fotos'])} fotos — {platform}")
    return data

# ─── CATALOG HELPERS ──────────────────────────────────────────────────────────

def load_catalog(path):
    """Carga el catálogo desde productos.json"""
    if str(path).endswith(".json"):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    # Legacy: leer desde HTML (fallback)
    with open(path, encoding="utf-8") as f: content = f.read()
    m = re.search(r'<script type="application/json" id="uv-data">(.*?)</script>', content, re.DOTALL)
    if not m: raise ValueError("No se encontró uv-data en el HTML")
    return json.loads(m.group(1))

def save_catalog(path, data):
    """Guarda el catálogo en productos.json"""
    if str(path).endswith(".json"):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return
    # Legacy: guardar en HTML (fallback)
    with open(path, encoding="utf-8") as f: content = f.read()
    new_json = json.dumps(data, ensure_ascii=False, separators=(",",":"))
    new_content = re.sub(
        r'(<script type="application/json" id="uv-data">)(.*?)(</script>)',
        lambda m: m.group(1) + new_json + m.group(3), content, flags=re.DOTALL)
    with open(path, "w", encoding="utf-8") as f: f.write(new_content)

def _detect_entrega(features, html=""):
    """Intenta extraer la fecha/trimestre de entrega desde las features o el HTML."""
    patterns = [
        r'(?:expected\s+ship(?:ping)?|ship(?:ping)?\s+date|estimated\s+delivery|pre.?order\s+ship[a-z]*|arrives?|release\s+date)\s*[:\-]?\s*([^\n<]{4,50})',
        r'\b(Q[1-4]\s*\d{4}|\d{4}\s*Q[1-4])\b',
        r'\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b',
        r'\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{4})\b',
    ]
    sources = list(features or []) + ([html[:3000]] if html else [])
    for src in sources:
        for pat in patterns:
            m = re.search(pat, src, re.I)
            if m:
                return m.group(1).strip()[:60]
    return ""

def search_product(catalog, query):
    q = query.lower().strip(); results = []
    for cat, info in catalog.items():
        for i, p in enumerate(info.get("products",[])):
            name = p.get("n","").lower()
            if q in name or all(w in name for w in q.split()):
                results.append({"cat":cat,"idx":i,"product":p})
    return results

def _make_product_id(nombre, catalog_all):
    """Genera un slug estable y único para el ID del producto."""
    # Normalizar: bajar a minúsculas, quitar acentos, reemplazar espacios y caracteres raros
    s = nombre.lower().strip()
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")  # quitar diacríticos
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    s = re.sub(r"-+", "-", s)
    base = s[:60]
    # Verificar unicidad global
    existing = set()
    for cat_data in catalog_all.values():
        for prod in (cat_data.get("products", []) if isinstance(cat_data, dict) else []):
            if prod.get("id"):
                existing.add(prod["id"])
    candidate = base
    counter = 2
    while candidate in existing:
        candidate = f"{base}-{counter}"
        counter += 1
    return candidate

def add_product(path, data, categoria, precio, precio_d, reserva, entrega, cantidad, estado, youtube=""):
    catalog = load_catalog(path)
    if data.get("ai_blocks"):
        blocks = data["ai_blocks"]
    else:
        blocks = []
        if data.get("descripcion"): blocks.append({"t":"notion-text","x":data["descripcion"][:800]})
        for f in data.get("features",[]): blocks.append({"t":"notion-bulleted-list","x":f})
    p = {
        "id":_make_product_id(data["nombre"], catalog),
        "n":data["nombre"],"i":data["fotos"][0] if data["fotos"] else "",
        "l":data["url_origen"],"marca":data["marca"],"escala":data["escala"],
        "franquicia":data.get("franquicia",""),
        "estado":estado,"disp":CAT_DISP.get(categoria,"Entrega Inmediata"),
        "precio":precio,"precio_d":precio_d,"precio_orig":data.get("precio_orig",""),
        "reserva":reserva,"entrega":entrega,"cantidad":cantidad,
        "fotos":data["fotos"],"content":blocks,"yt":youtube,
        "destacado":data.get("destacado",False),"oferta":data.get("oferta",False),
        "added_at":datetime.datetime.now().isoformat(),
    }
    if categoria not in catalog:
        catalog[categoria] = {"slug":categoria.lower().replace(" ","-"),"products":[]}
    catalog[categoria]["products"].insert(0, p)
    save_catalog(path, catalog)
    return p

def _call_claude(api_key, prompt, foto_url=None):
    """Llama a Claude Haiku. Si foto_url está dado, intenta con visión; si falla, reintenta sin imagen."""
    system_prompt = (
        "Eres un asistente que responde ÚNICAMENTE con JSON válido. "
        "Nunca agregues texto explicativo, nunca te niegues, nunca uses markdown. "
        "Si los datos son escasos, inventa contenido plausible basado en el nombre del producto. "
        "Tu respuesta debe comenzar con '[' y terminar con ']'."
    )

    def _make_messages(with_img):
        if with_img and foto_url:
            return [{"role": "user", "content": [
                {"type": "image", "source": {"type": "url", "url": foto_url}},
                {"type": "text", "text": prompt},
            ]}]
        return [{"role": "user", "content": prompt}]
    attempts = [True, False] if foto_url else [False]
    last_err = None
    for use_img in attempts:
        try:
            r = requests.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json={"model": "claude-haiku-4-5-20251001", "max_tokens": 2400, "system": system_prompt, "messages": _make_messages(use_img)},
                timeout=40,
            )
            r.raise_for_status()
            rj = r.json()
            if not rj.get("content"):
                raise ValueError(f"Claude devolvio content vacio. stop_reason={rj.get('stop_reason')}")
            text = rj["content"][0]["text"].strip()
            if not text:
                raise ValueError(f"Claude devolvio texto vacio. stop_reason={rj.get('stop_reason')}")
            m = re.search(r'\[[\s\S]*\]', text)
            return json.loads(m.group() if m else text)
        except Exception as e:
            last_err = e
            if not use_img:
                raise last_err
    raise last_err


def generate_ai_description(data, api_key):
    """Llama a Claude Haiku y devuelve una lista de content blocks estructurados."""
    source_domain = urlparse(data.get('url_origen','')).netloc.replace('www.','')
    retailer_note = (
        f"IMPORTANTE: la URL origen es de '{source_domain}', que es un RETAILER/tienda, NO el fabricante. "
        f"El fabricante real puede aparecer en las características como 'Brand:' o 'Manufacturer:'. "
        f"No uses '{source_domain}' como fabricante en ningún campo.\n"
    ) if source_domain and source_domain not in ("", data.get('marca','').lower()) else ""

    desc_scrapeada = data.get('descripcion','').strip()
    features = data.get('features',[])
    fotos = data.get('fotos') or ([data['i']] if data.get('i') else [])
    is_sparse = len(desc_scrapeada) < 100 and len(features) < 3
    foto_url = next((f for f in fotos if isinstance(f, str) and f.startswith('http')), None)
    use_vision = is_sparse and foto_url is not None

    if is_sparse:
        invent_rule = (
            "- La página de origen tiene poco texto. DEBES generar la descripción de todas formas. "
            "Usá el nombre del personaje, el fabricante, la franquicia y " +
            ("la imagen adjunta" if use_vision else "tu conocimiento general del personaje/franquicia") +
            " para escribir contenido atractivo. Para specs que no tenés (altura, materiales), "
            "omití esos bullets específicos pero completá los párrafos narrativos y las secciones "
            "que sí podés inferir (Línea, Fabricante, Tipo, Género). NUNCA respondas con texto "
            "explicativo — solo el JSON array."
        )
    else:
        invent_rule = "- No inventes datos específicos (altura exacta, materiales) si no están en la info"

    prompt = (
        "Sos redactor para UV Store GT, tienda guatemalteca de coleccionables premium.\n"
        "Generá una descripción profesional en español para esta figura.\n"
        f"{retailer_note}\n"
        f"PRODUCTO:\n"
        f"Nombre: {data.get('nombre','')}\n"
        f"Fabricante detectado: {data.get('marca','') or '(buscar en características)'}\n"
        f"Escala: {data.get('escala','')}\n"
        f"Descripción scrapeada: {desc_scrapeada[:800]}\n"
        f"Franquicia/universo: {data.get('franquicia','')}\n\n"
        f"Características/specs scrapeadas (LEER COMPLETO — accesorios, vestuario, manos, display están acá):\n"
        + "\n".join(f"  {i+1}. {f}" for i,f in enumerate(features[:40]))
        + "\n\n"
        "Devolvé SOLO un JSON array con bloques de contenido. Formato exacto:\n"
        '[\n'
        '  {"t":"notion-heading-2","x":"Descripción"},\n'
        '  {"t":"notion-text","x":"Párrafo narrativo sobre el personaje y contexto."},\n'
        '  {"t":"notion-text","x":"Párrafo sobre detalles artísticos o de manufactura."},\n'
        '  {"t":"notion-text","x":"Párrafo sobre materiales y propuesta de colección."},\n'
        '  {"t":"notion-heading-2","x":"Detalles"},\n'
        '  {"t":"notion-bulleted-list","x":"Línea: ..."},\n'
        '  {"t":"notion-bulleted-list","x":"Fabricante: (el fabricante real, no el retailer)"},\n'
        '  {"t":"notion-bulleted-list","x":"Tipo: ..."},\n'
        '  {"t":"notion-bulleted-list","x":"Género: ..."},\n'
        '  {"t":"notion-bulleted-list","x":"Afiliación: ..."},\n'
        '  {"t":"notion-heading-2","x":"Especificaciones"},\n'
        '  {"t":"notion-bulleted-list","x":"Altura: ..."},\n'
        '  {"t":"notion-bulleted-list","x":"Escala: ..."},\n'
        '  {"t":"notion-bulleted-list","x":"Materiales: ..."},\n'
        '  {"t":"notion-bulleted-list","x":"Articulación: ..."},\n'
        '  {"t":"notion-heading-2","x":"Incluye"},\n'
        '  {"t":"notion-bulleted-list","x":"Cabeza esculpida con likeness de ..."},\n'
        '  {"t":"notion-bulleted-list","x":"Vestuario: camisa ..., pantalón ..., etc."},\n'
        '  {"t":"notion-bulleted-list","x":"Accesorios: espada, escudo, etc."},\n'
        '  {"t":"notion-bulleted-list","x":"Manos intercambiables: X pares"},\n'
        '  {"t":"notion-bulleted-list","x":"Base de exhibición"},\n'
        '  {"t":"notion-heading-2","x":"Características"},\n'
        '  {"t":"notion-bulleted-list","x":"..."}\n'
        ']\n\n'
        "REGLAS:\n"
        "- Descripción: 2-3 párrafos narrativos, atractivos, en español de Latinoamérica\n"
        "- Omití secciones enteras si no hay datos suficientes para llenarlas\n"
        "- Incluye: es la sección MÁS IMPORTANTE para coleccionistas. Listá TODOS los accesorios,\n"
        "  prendas de vestuario, opciones de cabeza, manos intercambiables, bases y fondos escénicos\n"
        "  que aparezcan en las características. No omitir ninguno. Si el scrape tiene sub-categorías\n"
        "  (Vestuario, Accesorios, Manos, Display) conservalas como bullets separados con ese prefijo.\n"
        "- Características: 5-7 bullets con lo más destacado de la pieza\n"
        f"{invent_rule}\n"
        "- Respondé SOLO con el JSON array, sin markdown, sin texto adicional"
    )
    return _call_claude(api_key, prompt, foto_url if use_vision else None)


def try_scrape_listing(url):
    """Detecta si la URL es una página de catálogo/listado y devuelve lista de productos, o None."""
    parsed = urlparse(url)
    # Intento 1: API JSON directa (nonasea y similares con DRF/REST)
    try:
        r = requests.get(url, headers={**HEADERS, "Accept": "application/json"}, timeout=10)
        if r.status_code == 200 and "json" in r.headers.get("content-type", ""):
            data = r.json()
            items = data.get("results") or data.get("products") or []
            if isinstance(items, list) and len(items) > 1:
                products = []
                for item in items[:40]:
                    title = item.get("name") or item.get("title") or item.get("product_name", "?")
                    handle = item.get("handle") or item.get("slug") or str(item.get("id", ""))
                    img = ""
                    imgs = item.get("images", [])
                    if imgs:
                        first = imgs[0]
                        img = first.get("src", first) if isinstance(first, dict) else str(first)
                    elif item.get("image"):
                        img_field = item["image"]
                        img = img_field.get("src", "") if isinstance(img_field, dict) else str(img_field)
                    # Build product URL — nonasea usa /mall/{slug}
                    if "nonasea" in parsed.netloc:
                        prod_url = f"{parsed.scheme}://{parsed.netloc}/mall/{handle}"
                    else:
                        prod_url = f"{parsed.scheme}://{parsed.netloc}/products/{handle}"
                    if handle:
                        products.append({"title": title, "url": prod_url, "image": img})
                if products:
                    return products
    except Exception:
        pass
    # Intento 2: Shopify collection .../products.json
    try:
        col_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path.rstrip('/')}/products.json?limit=40"
        r = requests.get(col_url, headers=HEADERS, timeout=10)
        if r.status_code == 200:
            items = r.json().get("products", [])
            if len(items) > 1:
                return [{"title": p["title"],
                         "url": f"{parsed.scheme}://{parsed.netloc}/products/{p['handle']}",
                         "image": p["images"][0]["src"] if p.get("images") else ""}
                        for p in items[:40]]
    except Exception:
        pass
    # Intento 3: BigCommerce — extraer links de productos del HTML
    # Solo si el path tiene 2+ segmentos (categoría), no para páginas de producto (1 segmento)
    path_segs = [p for p in parsed.path.split("/") if p]
    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        if len(path_segs) >= 2 and "bigcommerce" in r.text[:8000].lower():
            from bs4 import BeautifulSoup as _BS
            _soup = _BS(r.text, "html.parser")
            base = f"{parsed.scheme}://{parsed.netloc}/"
            skip = {"contact","about","shipping","policy","faq","terms","cart","login",
                    "looking","blog","account","categories","products","shop-all","wishlist"}
            seen_u = set(); products = []
            for a in _soup.find_all("a", href=True):
                h = a["href"]
                if not h.startswith(base): continue
                path = h[len(base):].strip("/")
                if "/" in path or len(path) < 8: continue
                if any(s in path for s in skip): continue
                if h not in seen_u:
                    seen_u.add(h)
                    label = a.get_text(strip=True)
                    img_tag = a.find("img")
                    img = ""
                    if img_tag:
                        src = img_tag.get("src","")
                        if "bigcommerce" in src:
                            img = re.sub(r'stencil/\d+x\d+/', 'stencil/1280x1280/', src)
                    products.append({"title": label or path, "url": h, "image": img})
            # Filtrar entradas sin título útil y duplicar-deduplicar por URL
            products = [p for p in products if len(p["title"]) > 4]
            if len(products) > 2:
                return products[:40]
    except Exception:
        pass
    return None

def needs_optimization(product):
    """Devuelve True si el producto tiene contenido mal formateado que vale la pena optimizar."""
    if product.get("content_ok"):
        return False
    content = product.get("content", [])
    if not content:
        return False
    for b in content:
        t, x = b.get("t", ""), b.get("x", "")
        # notion-text muy corto o con artefactos de scraping
        if t == "notion-text":
            if len(x) < 80:
                return True
            if re.search(r'incluye\s*:|disfraz\s*:|armas\s*:|accesorios\s*:', x, re.I):
                return True
        # bullet muy largo = items concatenados sin separación
        if t == "notion-bulleted-list" and len(x) > 250:
            return True
    return False

def optimize_content_blocks(product, api_key):
    """Toma los bloques content existentes de un producto y los reformatea con Claude."""
    name = product.get("n", "")
    current_text = blocks_to_preview_raw(product.get("content", []))
    prompt = (
        "Sos redactor para UV Store GT, tienda guatemalteca de coleccionables premium.\n"
        "Te doy el contenido actual de una figura en el catálogo. Está mal formateado: "
        "puede tener bullets concatenados sin separación, descripción cortada, o texto desordenado.\n\n"
        f"FIGURA: {name}\n\n"
        f"CONTENIDO ACTUAL:\n{current_text}\n\n"
        "Reorganizá y mejorá este contenido en español de Latinoamérica. "
        "Usá SOLO la información que ya está en el contenido — no inventes datos.\n\n"
        "Devolvé SOLO un JSON array con bloques. Formato:\n"
        '[\n'
        '  {"t":"notion-heading-2","x":"Descripción"},\n'
        '  {"t":"notion-text","x":"Párrafo narrativo sobre el personaje y contexto."},\n'
        '  {"t":"notion-heading-2","x":"Especificaciones"},\n'
        '  {"t":"notion-bulleted-list","x":"Altura: ..."},\n'
        '  {"t":"notion-bulleted-list","x":"Escala: ..."},\n'
        '  {"t":"notion-heading-2","x":"Incluye"},\n'
        '  {"t":"notion-bulleted-list","x":"Un item por bullet — separar cada accesorio"},\n'
        '  {"t":"notion-heading-2","x":"Características"},\n'
        '  {"t":"notion-bulleted-list","x":"..."}\n'
        ']\n\n'
        "REGLAS:\n"
        "- Cada bullet = UN solo item (si el original tiene muchos concatenados, separalos)\n"
        "- Omití secciones si no hay datos suficientes\n"
        "- No agregues información que no esté en el contenido original\n"
        "- Respondé SOLO con el JSON array, sin markdown, sin texto adicional"
    )
    r = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 2400,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=40,
    )
    r.raise_for_status()
    text = r.json()["content"][0]["text"].strip()
    m = re.search(r'\[[\s\S]*\]', text)
    return json.loads(m.group() if m else text)

def blocks_to_preview_raw(blocks):
    """Convierte content blocks a texto plano para enviar como contexto a la IA."""
    lines = []
    for b in blocks:
        t, x = b.get("t", ""), b.get("x", "")
        if t == "notion-heading-2":
            lines.append(f"\n[{x}]")
        elif t == "notion-text":
            lines.append(x)
        elif t in ("notion-bulleted-list", "notion-numbered-list"):
            lines.append(f"• {x}")
    return "\n".join(lines).strip()

def blocks_to_preview(blocks):
    """Convierte content blocks a texto legible para mostrar en la UI."""
    lines = []
    for b in blocks:
        t, x = b.get("t", ""), b.get("x", "")
        if t == "notion-heading-2":
            if lines: lines.append("")
            lines.append(f"{x}")
            lines.append("─" * max(len(x), 4))
        elif t == "notion-text":
            lines.append(x)
            lines.append("")
        elif t in ("notion-bulleted-list", "notion-numbered-list"):
            lines.append(f"  • {x}")
    return "\n".join(lines).strip()

def update_product(path, cat, idx, fields):
    """Update arbitrary fields on a product. fields is a dict."""
    catalog = load_catalog(path)
    p = catalog[cat]["products"][idx]
    for k, v in fields.items():
        p[k] = v
    if "fotos" in fields and fields["fotos"]:
        p["i"] = fields["fotos"][0]
    save_catalog(path, catalog)
    return p

# ─── PHOTO PREVIEW WIDGET ─────────────────────────────────────────────────────

class PhotoPreview(tk.Frame):
    def __init__(self, parent, w=300, h=240, **kwargs):
        super().__init__(parent, bg=BG, **kwargs)
        self._photos=[]; self._idx=0; self._tk_img=None
        self.canvas = tk.Label(self, bg="#0f0f0f", width=w, height=h,
                               text="Sin foto", fg="#444", font=("Helvetica",11))
        self.canvas.pack()
        nav = tk.Frame(self, bg=BG); nav.pack(pady=4)
        tk.Button(nav,text="◀",command=self.prev,bg="#222",fg="white",font=("Helvetica",12),relief="flat",bd=0,padx=10,pady=3).pack(side="left",padx=2)
        self.counter = tk.Label(nav,text="0 / 0",bg=BG,fg="#777",font=("Helvetica",10))
        self.counter.pack(side="left",padx=8)
        tk.Button(nav,text="▶",command=self.next,bg="#222",fg="white",font=("Helvetica",12),relief="flat",bd=0,padx=10,pady=3).pack(side="left",padx=2)
        tk.Button(nav,text="🗑",command=self.delete_current,bg="#3a1a1a",fg="#f87171",font=("Helvetica",11),relief="flat",bd=0,padx=8,pady=3).pack(side="left",padx=(8,2))

    def set_photos(self, photos):
        self._photos=photos; self._idx=0
        if photos: self._load(0)
        else: self.canvas.config(image="",text="Sin foto"); self.counter.config(text="0 / 0")

    def get_photos(self): return list(self._photos)

    def _load(self, idx):
        if not self._photos: return
        self.counter.config(text=f"{idx+1} / {len(self._photos)}")
        self.canvas.config(text="Cargando...",image="")
        threading.Thread(target=self._fetch,args=(self._photos[idx],),daemon=True).start()

    def _fetch(self, url):
        try:
            r = requests.get(url,headers=HEADERS,timeout=10)
            img = Image.open(BytesIO(r.content)); img.thumbnail((300,240),Image.LANCZOS)
            tk_img = ImageTk.PhotoImage(img)
            self.after(0, lambda: self._show(tk_img))
        except Exception:
            self.after(0, lambda: self.canvas.config(text="Error al cargar",image=""))

    def _show(self, tk_img): self._tk_img=tk_img; self.canvas.config(image=tk_img,text="")
    def prev(self):
        if not self._photos: return
        self._idx=(self._idx-1)%len(self._photos); self._load(self._idx)
    def next(self):
        if not self._photos: return
        self._idx=(self._idx+1)%len(self._photos); self._load(self._idx)

    def delete_current(self):
        if not self._photos: return
        del self._photos[self._idx]
        if not self._photos:
            self.canvas.config(image="",text="Sin foto"); self.counter.config(text="0 / 0")
            return
        self._idx=min(self._idx,len(self._photos)-1)
        self._load(self._idx)

# ─── MAIN APP ─────────────────────────────────────────────────────────────────

class UVAdminApp:
    def __init__(self, root):
        self.root = root
        self.root.title("UV Store GT — Admin v4")
        self.root.geometry("1080x860")
        self.root.configure(bg=BG3)
        self.root.resizable(True, True)
        self.cfg = load_config()
        self._scraped_add = None
        self._edit_selected = None   # {"cat":, "idx":, "product":}
        self._edit_photos = []
        self._upd_selected = None
        self._upd_photos = []
        self._ef_destacado  = tk.BooleanVar(value=False)
        self._ef_oferta     = tk.BooleanVar(value=False)
        self._ef_adulto18   = tk.BooleanVar(value=False)
        self._add_destacado = tk.BooleanVar(value=False)
        self._add_oferta    = tk.BooleanVar(value=False)
        self._add_adulto18  = tk.BooleanVar(value=False)
        self._build_ui()
        self._check_catalog()

    # ── UI BUILD ──────────────────────────────────────────────────────────────

    def _build_ui(self):
        style = ttk.Style(); style.theme_use("clam")
        style.configure("TNotebook", background=BG3, borderwidth=0)
        style.configure("TNotebook.Tab", background=BG2, foreground=MUTED, padding=[14,6], font=("Helvetica",11))
        style.map("TNotebook.Tab", background=[("selected",BG)], foreground=[("selected",TEXT)])

        # Header
        hdr = tk.Frame(self.root, bg=BG3, pady=12)
        hdr.pack(fill="x", padx=20)
        tk.Label(hdr, text="UV STORE GT", bg=BG3, fg=PURPLE,
                 font=("Helvetica",18,"bold")).pack(side="left")
        tk.Label(hdr, text="  Admin Tool v4 — Multi-Proveedor", bg=BG3, fg=MUTED,
                 font=("Helvetica",11)).pack(side="left")

        # Notebook
        self.nb = ttk.Notebook(self.root)
        self.nb.pack(fill="both", expand=True, padx=12, pady=(0,8))

        self._build_add_tab()
        self._build_edit_tab()
        # Photos tab merged into Edit tab
        self._build_config_tab()

        # Status bar
        bar = tk.Frame(self.root, bg=BG2, pady=8)
        bar.pack(fill="x", padx=12, pady=(0,8))
        self._status_var = tk.StringVar(value="Iniciando...")
        self._status_lbl = tk.Label(bar, textvariable=self._status_var,
                                    bg=BG2, fg=GREEN, font=("Helvetica",10), anchor="w")
        self._status_lbl.pack(side="left", padx=12)
        self._deploy_btn = tk.Button(bar, text="🚀  Publicar en GitHub", command=self._deploy,
                                     bg=PURPLE, fg="white", font=("Helvetica",10,"bold"),
                                     relief="flat", padx=16, pady=6)
        self._deploy_btn.pack(side="right", padx=8)

    # ── TAB 1: AGREGAR FIGURA ─────────────────────────────────────────────────

    def _build_add_tab(self):
        tab = tk.Frame(self.nb, bg=BG); self.nb.add(tab, text="  + Agregar Figura  ")
        tab.columnconfigure(1, weight=1)

        # URL row
        url_frame = tk.Frame(tab, bg=BG, pady=12, padx=16); url_frame.pack(fill="x")
        tk.Label(url_frame,text="URL del producto:",bg=BG,fg=MUTED,font=("Helvetica",10)).pack(side="left")
        self.add_url_var = tk.StringVar()
        tk.Entry(url_frame,textvariable=self.add_url_var,bg=BG2,fg=TEXT,font=("Helvetica",11),
                 relief="flat",bd=8,insertbackground=TEXT,width=70).pack(side="left",padx=8,fill="x",expand=True)
        self.add_translate_var = tk.BooleanVar(value=True)
        tk.Checkbutton(url_frame,text="Traducir",variable=self.add_translate_var,
                       bg=BG,fg=MUTED,selectcolor=BG2,activebackground=BG).pack(side="left",padx=4)
        tk.Button(url_frame,text="Cargar",command=self._add_scrape,
                  bg=PURPLE,fg="white",font=("Helvetica",11,"bold"),relief="flat",padx=14,pady=6).pack(side="left",padx=4)

        # Main layout
        main = tk.Frame(tab, bg=BG); main.pack(fill="both", expand=True, padx=16)
        left = tk.Frame(main, bg=BG); left.pack(side="left", fill="y", padx=(0,16))
        right = tk.Frame(main, bg=BG); right.pack(side="left", fill="both", expand=True)

        self.add_preview = PhotoPreview(left)
        self.add_preview.pack()

        # Fields
        def field(parent, label, var, row):
            tk.Label(parent,text=label,bg=BG,fg=MUTED,font=("Helvetica",9),anchor="w").grid(row=row,column=0,sticky="nw",pady=(6,2))
            e = tk.Entry(parent,textvariable=var,bg=BG2,fg=TEXT,font=("Helvetica",11),relief="flat",bd=6,insertbackground=TEXT)
            e.grid(row=row,column=1,sticky="ew",pady=(6,2),padx=(8,0))
            return e

        right.columnconfigure(1, weight=1)
        self.add_nombre_var  = tk.StringVar()
        self.add_precio_var  = tk.StringVar()
        self.add_entrega_var = tk.StringVar()
        self.add_cantidad_var= tk.StringVar()
        self.add_youtube_var = tk.StringVar()

        field(right,"Nombre (editable):",self.add_nombre_var,0)

        # Precio + label de reserva automática
        tk.Label(right,text="Precio (Q):",bg=BG,fg=MUTED,font=("Helvetica",9),anchor="w").grid(row=1,column=0,sticky="nw",pady=(6,2))
        precio_row = tk.Frame(right, bg=BG)
        precio_row.grid(row=1,column=1,sticky="ew",pady=(6,2),padx=(8,0))
        precio_row.columnconfigure(0, weight=1)
        tk.Entry(precio_row,textvariable=self.add_precio_var,bg=BG2,fg=TEXT,font=("Helvetica",11),relief="flat",bd=6,insertbackground=TEXT).grid(row=0,column=0,sticky="ew")
        self.add_reserva_lbl = tk.Label(precio_row,text="Reserva: —",bg=BG,fg=MUTED,font=("Helvetica",9))
        self.add_reserva_lbl.grid(row=0,column=1,sticky="w",padx=(8,0))
        def _update_reserva_lbl(*_):
            try:
                v = float(self.add_precio_var.get().replace(",","").replace("Q","").strip())
                self.add_reserva_lbl.config(text=f"Reserva: Q {v*0.20:.0f} (20%)")
            except: self.add_reserva_lbl.config(text="Reserva: —")
        self.add_precio_var.trace_add("write", _update_reserva_lbl)

        field(right,"Entrega Estimada:",self.add_entrega_var,2)
        field(right,"Cantidad disponible:",self.add_cantidad_var,3)
        field(right,"YouTube URL:",self.add_youtube_var,4)

        # Category & Estado
        tk.Label(right,text="Categoría:",bg=BG,fg=MUTED,font=("Helvetica",9)).grid(row=5,column=0,sticky="w",pady=(6,2))
        self.add_cat_var = tk.StringVar(value=CAT_KEYS[0])
        ttk.Combobox(right,textvariable=self.add_cat_var,values=CAT_KEYS,state="readonly",
                     font=("Helvetica",11)).grid(row=5,column=1,sticky="ew",pady=(6,2),padx=(8,0))

        tk.Label(right,text="Franquicia:",bg=BG,fg=MUTED,font=("Helvetica",9)).grid(row=6,column=0,sticky="w",pady=(6,2))
        self.add_franquicia_var = tk.StringVar(value="")
        ttk.Combobox(right,textvariable=self.add_franquicia_var,values=["","Marvel","DC Comics","Star Wars","Anime","Gaming","Otros","Adultos"],
                     state="readonly",font=("Helvetica",11)).grid(row=6,column=1,sticky="ew",pady=(6,2),padx=(8,0))

        # Precio original + checkboxes Destacado/Oferta
        tk.Label(right,text="Precio Orig (Q):",bg=BG,fg=MUTED,font=("Helvetica",9)).grid(row=7,column=0,sticky="w",pady=(6,2))
        self.add_precio_orig_var = tk.StringVar()
        tk.Entry(right,textvariable=self.add_precio_orig_var,bg=BG2,fg=TEXT,font=("Helvetica",11),
                 relief="flat",bd=6,insertbackground=TEXT).grid(row=7,column=1,sticky="ew",pady=(6,2),padx=(8,0))
        add_chk = tk.Frame(right, bg=BG)
        add_chk.grid(row=7,column=2,columnspan=1,sticky="w",pady=(6,2),padx=(12,0))
        tk.Checkbutton(add_chk,text="★ Destacado",variable=self._add_destacado,
                       bg=BG,fg="#b97aff",selectcolor=BG2,activebackground=BG,
                       font=("Helvetica",9,"bold")).pack(side="left",padx=(0,8))
        tk.Checkbutton(add_chk,text="% Oferta",variable=self._add_oferta,
                       bg=BG,fg="#f87171",selectcolor=BG2,activebackground=BG,
                       font=("Helvetica",9,"bold")).pack(side="left",padx=(0,8))
        tk.Checkbutton(add_chk,text="🔞 18+",variable=self._add_adulto18,
                       bg=BG,fg="#e91e8c",selectcolor=BG2,activebackground=BG,
                       font=("Helvetica",9,"bold"),
                       command=self._on_add_adulto18_toggle).pack(side="left")

        tk.Label(right,text="Estado:",bg=BG,fg=MUTED,font=("Helvetica",9)).grid(row=8,column=0,sticky="w",pady=(6,2))
        self.add_estado_var = tk.StringVar(value="Nuevo")
        ttk.Combobox(right,textvariable=self.add_estado_var,values=["Nuevo","Usado - Como Nuevo","Vendido"],
                     state="readonly",font=("Helvetica",11)).grid(row=8,column=1,sticky="ew",pady=(6,2),padx=(8,0))

        # Meta info label
        self.add_meta_lbl = tk.Label(right,text="",bg=BG,fg=MUTED,font=("Helvetica",10))
        self.add_meta_lbl.grid(row=9,column=0,columnspan=2,sticky="w",pady=4)

        # AI description area
        ai_hdr = tk.Frame(right, bg=BG)
        ai_hdr.grid(row=10,column=0,columnspan=3,sticky="ew",pady=(8,2))
        tk.Label(ai_hdr,text="Descripción:",bg=BG,fg=MUTED,font=("Helvetica",9)).pack(side="left")
        self.add_ai_btn = tk.Button(ai_hdr,text="✨ Generar con IA",
                  command=self._add_gen_ai,
                  bg="#2d1a4a",fg="#b97aff",font=("Helvetica",9,"bold"),relief="flat",padx=10,pady=3)
        self.add_ai_btn.pack(side="left",padx=(10,0))
        self.add_ai_txt = tk.Text(right,height=13,bg=BG2,fg=TEXT,font=("Helvetica",10),
                                   relief="flat",bd=6,wrap="word",insertbackground=TEXT)
        self.add_ai_txt.grid(row=11,column=0,columnspan=3,sticky="ew",pady=(2,2))

        # Platforms info
        info = tk.Label(tab,
            text="Proveedores soportados: Sideshow · Shopify (nonasea, lionrocktoyz, fanaticanimestore, statuecorp...) · OpenCart (onesixthkit) · WooCommerce · Entertainment Earth · BigBadToyStore · Genérico",
            bg=BG,fg="#555",font=("Helvetica",9),anchor="w",wraplength=900,justify="left")
        info.pack(fill="x",padx=16,pady=(4,0))

        # Add button
        tk.Button(tab,text="  + Agregar al Catálogo  ",command=self._add_confirm,
                  bg=PURPLE,fg="white",font=("Helvetica",12,"bold"),relief="flat",
                  padx=20,pady=10).pack(pady=12)

    # ── TAB 2: EDITAR FIGURA ──────────────────────────────────────────────────

    def _build_edit_tab(self):
        tab = tk.Frame(self.nb, bg=BG); self.nb.add(tab, text="  ✏  Editar Figura  ")

        # Search row
        search_frame = tk.Frame(tab, bg=BG, pady=12, padx=16); search_frame.pack(fill="x")
        tk.Label(search_frame,text="Buscar figura:",bg=BG,fg=MUTED,font=("Helvetica",10)).pack(side="left")
        self.edit_search_var = tk.StringVar()
        self.edit_search_var.trace_add("write", lambda *_: self._edit_search())
        tk.Entry(search_frame,textvariable=self.edit_search_var,bg=BG2,fg=TEXT,
                 font=("Helvetica",11),relief="flat",bd=8,insertbackground=TEXT,width=40).pack(side="left",padx=8)

        # Save/Deploy buttons — FUERA del canvas, siempre visibles
        save_frame = tk.Frame(tab,bg=BG2,pady=8); save_frame.pack(fill="x",padx=16,side="bottom")
        tk.Button(save_frame,text="💾  Guardar Cambios",command=self._edit_save,
                  bg="#2563eb",fg="white",font=("Helvetica",11,"bold"),relief="flat",
                  padx=16,pady=8).pack(side="left",padx=(8,0))
        tk.Button(save_frame,text="🗑  Eliminar",command=self._edit_delete,
                  bg=RED,fg="white",font=("Helvetica",11),relief="flat",
                  padx=12,pady=8).pack(side="left",padx=8)
        tk.Button(save_frame,text="🚀  Publicar en GitHub",command=self._deploy,
                  bg=PURPLE,fg="white",font=("Helvetica",11,"bold"),relief="flat",
                  padx=16,pady=8).pack(side="left",padx=(0,8))

        # Layout: list left, form right
        paned = tk.Frame(tab, bg=BG); paned.pack(fill="both",expand=True,padx=16,pady=(0,0))

        # Left: lista compacta con altura fija
        list_frame = tk.Frame(paned, bg=BG); list_frame.pack(side="left",fill="y",padx=(0,12))
        tk.Label(list_frame,text="Resultados:",bg=BG,fg=MUTED,font=("Helvetica",9)).pack(anchor="w")
        self.edit_listbox = tk.Listbox(list_frame,bg=BG2,fg=TEXT,font=("Helvetica",10),
                                       relief="flat",bd=4,width=28,height=18,
                                       selectbackground=PURPLE,selectforeground="white")
        self.edit_listbox.pack(side="left",fill="y",expand=True)
        self.edit_listbox.bind("<<ListboxSelect>>", self._edit_select)
        scrollbar = tk.Scrollbar(list_frame,orient="vertical",command=self.edit_listbox.yview)
        self.edit_listbox.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="left",fill="y")

        # Right: form scrolleable
        right_outer = tk.Frame(paned, bg=BG); right_outer.pack(side="left",fill="both",expand=True)
        canvas = tk.Canvas(right_outer, bg=BG, highlightthickness=0)
        vsb = tk.Scrollbar(right_outer, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=vsb.set)
        vsb.pack(side="right", fill="y")
        canvas.pack(side="left", fill="both", expand=True)
        form_frame = tk.Frame(canvas, bg=BG)
        form_win = canvas.create_window((0,0), window=form_frame, anchor="nw")
        def _on_form_configure(e): canvas.configure(scrollregion=canvas.bbox("all"))
        def _on_canvas_configure(e): canvas.itemconfig(form_win, width=e.width)
        form_frame.bind("<Configure>", _on_form_configure)
        canvas.bind("<Configure>", _on_canvas_configure)
        def _on_mousewheel(e): canvas.yview_scroll(int(-1*(e.delta/120)), "units")
        canvas.bind_all("<MouseWheel>", _on_mousewheel)
        form_frame.columnconfigure(1,weight=1)

        self.edit_title_lbl = tk.Label(form_frame,text="Seleccioná una figura",
                                       bg=BG,fg=MUTED,font=("Helvetica",12,"bold"),anchor="w")
        self.edit_title_lbl.grid(row=0,column=0,columnspan=3,sticky="w",pady=(0,12))

        def efield(label, var, row, col=0):
            tk.Label(form_frame,text=label,bg=BG,fg=MUTED,font=("Helvetica",9),anchor="w").grid(
                row=row,column=col*2,sticky="nw",pady=(6,2),padx=(0 if col==0 else 12,0))
            e = tk.Entry(form_frame,textvariable=var,bg=BG2,fg=TEXT,font=("Helvetica",11),
                         relief="flat",bd=6,insertbackground=TEXT)
            e.grid(row=row,column=col*2+1,sticky="ew",pady=(6,2),padx=(8,0))
            return e

        self.ef_nombre    = tk.StringVar(); self.ef_precio     = tk.StringVar()
        self.ef_precio_d  = tk.StringVar(); self.ef_precio_orig= tk.StringVar()
        self.ef_reserva   = tk.StringVar(); self.ef_entrega    = tk.StringVar()
        self.ef_cantidad  = tk.StringVar(); self.ef_marca      = tk.StringVar()
        self.ef_escala    = tk.StringVar(); self.ef_youtube    = tk.StringVar()

        efield("Nombre:",       self.ef_nombre,   1, 0); form_frame.columnconfigure(1,weight=1)
        efield("Precio (Q):",   self.ef_precio,   2, 0)
        efield("Precio Deluxe:",self.ef_precio_d, 2, 1)
        efield("Reserva (Q):",  self.ef_reserva,  3, 0)
        efield("Entrega Est.:", self.ef_entrega,  3, 1)
        efield("Cantidad:",     self.ef_cantidad, 4, 0)
        efield("Marca:",        self.ef_marca,    4, 1)
        efield("Escala:",       self.ef_escala,   5, 0)
        efield("YouTube URL:",  self.ef_youtube,  5, 1)
        form_frame.columnconfigure(3,weight=1)

        # Disponibilidad
        tk.Label(form_frame,text="Disponibilidad:",bg=BG,fg=MUTED,font=("Helvetica",9)).grid(row=6,column=0,sticky="w",pady=(6,2))
        self.ef_disp = tk.StringVar()
        ttk.Combobox(form_frame,textvariable=self.ef_disp,
                     values=["Entrega Inmediata","Pre Orden","Vendido","Reservado"],
                     state="normal",font=("Helvetica",11)).grid(row=6,column=1,sticky="ew",pady=(6,2),padx=(8,0))

        # Estado
        tk.Label(form_frame,text="Estado:",bg=BG,fg=MUTED,font=("Helvetica",9)).grid(row=6,column=2,sticky="w",pady=(6,2),padx=(12,0))
        self.ef_estado = tk.StringVar()
        ttk.Combobox(form_frame,textvariable=self.ef_estado,
                     values=["Nuevo","Usado - Como Nuevo","Vendido"],
                     state="normal",font=("Helvetica",11)).grid(row=6,column=3,sticky="ew",pady=(6,2),padx=(8,0))

        # Franquicia (row 7 col 0-1) | Precio Orig (row 7 col 2-3)
        tk.Label(form_frame,text="Franquicia:",bg=BG,fg=MUTED,font=("Helvetica",9)).grid(row=7,column=0,sticky="w",pady=(6,2))
        self.ef_franquicia = tk.StringVar()
        ttk.Combobox(form_frame,textvariable=self.ef_franquicia,
                     values=["","Marvel","DC Comics","Star Wars","Anime","Gaming","Otros","Adultos"],
                     state="readonly",font=("Helvetica",11)).grid(row=7,column=1,sticky="ew",pady=(6,2),padx=(8,0))
        efield("Precio Orig (Q):", self.ef_precio_orig, 7, 1)

        # Destacado / Oferta checkboxes (row 8)
        chk_frame = tk.Frame(form_frame, bg=BG)
        chk_frame.grid(row=8,column=0,columnspan=4,sticky="w",pady=(6,2))
        tk.Checkbutton(chk_frame,text="★ Destacado",variable=self._ef_destacado,
                       bg=BG,fg="#b97aff",selectcolor=BG2,activebackground=BG,
                       font=("Helvetica",9,"bold")).pack(side="left",padx=(0,16))
        tk.Checkbutton(chk_frame,text="% Oferta",variable=self._ef_oferta,
                       bg=BG,fg="#f87171",selectcolor=BG2,activebackground=BG,
                       font=("Helvetica",9,"bold")).pack(side="left",padx=(0,16))
        tk.Checkbutton(chk_frame,text="🔞 18+",variable=self._ef_adulto18,
                       bg=BG,fg="#e91e8c",selectcolor=BG2,activebackground=BG,
                       font=("Helvetica",9,"bold"),
                       command=self._on_ef_adulto18_toggle).pack(side="left")

        # Category (row 9)
        tk.Label(form_frame,text="Categoría:",bg=BG,fg=MUTED,font=("Helvetica",9)).grid(row=9,column=0,sticky="w",pady=(6,2))
        self.ef_cat_var = tk.StringVar()
        self.ef_cat_combo = ttk.Combobox(form_frame,textvariable=self.ef_cat_var,
                                          values=CAT_KEYS,state="readonly",font=("Helvetica",11))
        self.ef_cat_combo.grid(row=9,column=1,sticky="ew",pady=(6,2),padx=(8,0))

        # Photo management
        photo_lbl = tk.Label(form_frame,text="Fotos actuales:",bg=BG,fg=MUTED,font=("Helvetica",9))
        photo_lbl.grid(row=10,column=0,sticky="nw",pady=(10,2))
        self.edit_fotos_lbl = tk.Label(form_frame,text="—",bg=BG,fg=MUTED,font=("Helvetica",10))
        self.edit_fotos_lbl.grid(row=10,column=1,sticky="w",pady=(10,2),padx=(8,0))

        photo_btn_frame = tk.Frame(form_frame,bg=BG)
        photo_btn_frame.grid(row=11,column=0,columnspan=4,sticky="w",pady=(4,0))
        tk.Button(photo_btn_frame,text="📁 Subir fotos desde PC",command=self._edit_upload_local,
                  bg=BG4,fg=TEXT,font=("Helvetica",10),relief="flat",padx=10,pady=5).pack(side="left",padx=(0,8))
        tk.Button(photo_btn_frame,text="🔗 Cargar fotos desde URL",command=self._edit_load_url_photos,
                  bg=BG4,fg=TEXT,font=("Helvetica",10),relief="flat",padx=10,pady=5).pack(side="left",padx=(0,8))
        self.edit_photo_url_var = tk.StringVar()
        tk.Entry(photo_btn_frame,textvariable=self.edit_photo_url_var,bg=BG2,fg=TEXT,
                 font=("Helvetica",10),relief="flat",bd=6,insertbackground=TEXT,width=40).pack(side="left",padx=(0,8))

        # Description
        tk.Label(form_frame,text="Descripción:",bg=BG,fg=MUTED,font=("Helvetica",9)).grid(row=12,column=0,sticky="nw",pady=(10,2))
        self.ef_desc_txt = tk.Text(form_frame,height=4,bg=BG2,fg=TEXT,font=("Helvetica",10),
                                    relief="flat",bd=6,wrap="word",insertbackground=TEXT)
        self.ef_desc_txt.grid(row=12,column=1,columnspan=3,sticky="ew",pady=(10,2),padx=(8,0))

        feat_hdr_edit = tk.Frame(form_frame, bg=BG)
        feat_hdr_edit.grid(row=13,column=0,columnspan=4,sticky="ew",pady=(8,0))
        tk.Label(feat_hdr_edit,text="Características (una por línea):",bg=BG,fg=MUTED,font=("Helvetica",9)).pack(side="left")
        tk.Button(feat_hdr_edit,text="🧹 Limpiar formato",
                  command=lambda: self._clean_features_field(self.ef_features_txt),
                  bg=BG4,fg=MUTED,font=("Helvetica",8),relief="flat",padx=8,pady=2).pack(side="left",padx=(8,0))
        self.ef_features_txt = tk.Text(form_frame,height=4,bg=BG2,fg=TEXT,font=("Helvetica",10),
                                        relief="flat",bd=6,wrap="word",insertbackground=TEXT)
        self.ef_features_txt.grid(row=14,column=0,columnspan=4,sticky="ew",pady=(2,2))

        # Preview
        self.edit_preview = PhotoPreview(form_frame, w=280, h=220)
        self.edit_preview.grid(row=15,column=0,columnspan=4,sticky="w",pady=(8,8))

        # Load all products on start
        self._edit_all_results = []
        self._edit_load_all()

    # ── TAB 3: CONFIGURACIÓN ──────────────────────────────────────────────────

    def _build_config_tab(self):
        tab = tk.Frame(self.nb, bg=BG); self.nb.add(tab, text="  ⚙  Configuración  ")

        content = tk.Frame(tab,bg=BG,padx=32,pady=24); content.pack(fill="both",expand=True)
        content.columnconfigure(1,weight=1)

        def cfg_field(label, var, row, show=""):
            tk.Label(content,text=label,bg=BG,fg=MUTED,font=("Helvetica",10),anchor="w").grid(
                row=row,column=0,sticky="w",pady=8,padx=(0,16))
            e = tk.Entry(content,textvariable=var,bg=BG2,fg=TEXT,font=("Helvetica",11),
                         relief="flat",bd=8,insertbackground=TEXT,show=show)
            e.grid(row=row,column=1,sticky="ew",pady=8)
            return e

        # Anthropic / IA
        tk.Label(content,text="── Anthropic (para generar descripciones con IA) ──",
                 bg=BG,fg=PURPLE,font=("Helvetica",10,"bold")).grid(row=0,column=0,columnspan=3,sticky="w",pady=(0,4))
        self.cfg_anthropic_var = tk.StringVar(value=self.cfg.get("anthropic_api_key",""))
        cfg_field("Anthropic API Key:", self.cfg_anthropic_var, 1, show="*")
        tk.Label(content,
            text="Obtené tu key gratis en: console.anthropic.com → API Keys\nCosto: ~$0.002 por figura (Claude Haiku)",
            bg=BG,fg="#555",font=("Helvetica",9)).grid(row=2,column=1,sticky="w")

        # Imgur
        tk.Label(content,text="── Imgur (para fotos desde PC) ──",
                 bg=BG,fg=PURPLE,font=("Helvetica",10,"bold")).grid(row=3,column=0,columnspan=3,sticky="w",pady=(16,4))

        self.cfg_imgur_var = tk.StringVar(value=self.cfg.get("imgur_client_id",""))
        cfg_field("Imgur Client ID:", self.cfg_imgur_var, 4)
        tk.Label(content,
            text="Obtenelo gratis en: https://api.imgur.com/oauth2/addclient\n(elegí 'Anonymous usage without user authorization')",
            bg=BG,fg="#555",font=("Helvetica",9)).grid(row=5,column=1,sticky="w")
        tk.Button(content,text="🧪 Probar conexión Imgur",command=self._test_imgur,
                  bg=BG4,fg=MUTED,font=("Helvetica",9),relief="flat",padx=10,pady=4).grid(row=6,column=1,sticky="w",pady=(0,8))

        # GitHub
        tk.Label(content,text="── GitHub (para publicar automáticamente) ──",
                 bg=BG,fg=PURPLE,font=("Helvetica",10,"bold")).grid(row=7,column=0,columnspan=3,sticky="w",pady=(16,4))

        self.cfg_repo_var   = tk.StringVar(value=self.cfg.get("github_repo",""))
        self.cfg_branch_var = tk.StringVar(value=self.cfg.get("github_branch","main"))
        cfg_field("Carpeta del repo (path local):", self.cfg_repo_var, 8)
        cfg_field("Branch:", self.cfg_branch_var, 9)

        tk.Label(content,
            text="La carpeta local del repo debe tener el index.html.\nSi no tenés Git instalado: https://git-scm.com/downloads\nSi no tenés repo en GitHub, crealo en https://github.com/new",
            bg=BG,fg="#555",font=("Helvetica",9)).grid(row=10,column=1,sticky="w",pady=(0,8))

        # Setup instructions
        instruct = tk.Text(content,height=8,bg=BG2,fg=MUTED,font=("Helvetica",9),
                           relief="flat",bd=8,wrap="word")
        instruct.grid(row=11,column=0,columnspan=2,sticky="ew",pady=8)
        instruct.insert("1.0",
            "SETUP INICIAL (una sola vez):\n\n"
            "1. Instalá Git desde https://git-scm.com/downloads\n"
            "2. Creá un repo en https://github.com/new (puede ser privado)\n"
            "3. En esa carpeta, abrí una terminal y corré:\n"
            "     git init\n"
            "     git remote add origin https://github.com/TUUSUARIO/TUREPO.git\n"
            "     git add index.html\n"
            "     git commit -m 'Initial commit'\n"
            "     git push -u origin main\n"
            "4. En Cloudflare Pages → conectá el repo de GitHub\n"
            "5. Configurá la carpeta aquí arriba\n\n"
            "Desde ahí, cada vez que guardés una figura y clickeés '🚀 Publicar en GitHub',\nel sitio se actualiza solo en ~30 segundos.")
        instruct.config(state="disabled")

        tk.Button(content,text="💾  Guardar Configuración",command=self._save_config,
                  bg=PURPLE,fg="white",font=("Helvetica",11,"bold"),relief="flat",
                  padx=16,pady=8).grid(row=12,column=0,columnspan=2,sticky="w",pady=12)

        # ── Batch optimizer ──
        tk.Label(content,text="── Optimización en lote ──",
                 bg=BG,fg=PURPLE,font=("Helvetica",10,"bold")).grid(row=13,column=0,columnspan=3,sticky="w",pady=(16,4))
        tk.Label(content,
            text="Detecta figuras con descripción/características mal formateadas y las mejora con IA.\nSalta automáticamente las que ya están bien (marcadas como content_ok).",
            bg=BG,fg="#555",font=("Helvetica",9)).grid(row=14,column=0,columnspan=2,sticky="w")
        tk.Button(content,text="✨  Optimizar Catálogo con IA",command=self._batch_optimize,
                  bg="#1a3a2a",fg=GREEN,font=("Helvetica",11,"bold"),relief="flat",
                  padx=16,pady=8).grid(row=15,column=0,columnspan=2,sticky="w",pady=(8,4))

    # ── STATUS ────────────────────────────────────────────────────────────────

    def _status(self, msg, color=GREEN):
        self._status_var.set(msg); self._status_lbl.config(fg=color)

    def _clean_features_field(self, txt_widget):
        raw = txt_widget.get("1.0", "end").strip()
        if not raw: return
        cleaned = clean_features(raw)
        txt_widget.delete("1.0", "end")
        txt_widget.insert("1.0", cleaned)
        self._status("✅ Características formateadas — revisá y ajustá si hace falta.", GREEN)

    def _check_catalog(self):
        if not CATALOG_FILE.exists():
            self._status(f"⚠️  No se encontró productos.json en {CATALOG_FILE.parent}", ORANGE)
        else:
            try:
                cat = load_catalog(CATALOG_FILE)
                total = sum(len(v.get("products",[])) for v in cat.values())
                self._status(f"✅  Catálogo cargado — {total} figuras", GREEN)
                self._edit_load_all()
            except Exception as e:
                self._status(f"❌  Error leyendo catálogo: {e}", RED)

    # ── TAB 1 LOGIC ───────────────────────────────────────────────────────────

    def _add_scrape(self):
        url = self.add_url_var.get().strip()
        if not url: return
        if not url.startswith("http"): url = "https://" + url
        self._status("⏳  Cargando...", ORANGE)
        threading.Thread(target=self._run_scrape_add, args=(url,), daemon=True).start()

    def _run_scrape_add(self, url, skip_listing=False):
        try:
            if not skip_listing:
                listing = try_scrape_listing(url)
                if listing:
                    self.root.after(0, lambda lst=listing: self._show_listing_picker(lst))
                    return
            data = scrape_url(url, translate=self.add_translate_var.get(),
                              status_cb=lambda m: self.root.after(0, lambda msg=m: self._status(msg, ORANGE)))
            self.root.after(0, lambda d=data: self._on_scraped_add(d))
        except Exception as e:
            msg = str(e)
            self.root.after(0, lambda m=msg: self._status(f"❌  {m}", RED))

    def _show_listing_picker(self, products):
        dlg = tk.Toplevel(self.root)
        dlg.title("Elegir producto del catálogo")
        dlg.geometry("620x440")
        dlg.configure(bg=BG)
        dlg.grab_set()
        tk.Label(dlg, text=f"Se encontraron {len(products)} productos. Elegí uno para cargarlo:",
                 bg=BG, fg=TEXT, font=("Helvetica", 11)).pack(pady=(16, 8), padx=16, anchor="w")
        frm = tk.Frame(dlg, bg=BG)
        frm.pack(fill="both", expand=True, padx=16, pady=(0, 8))
        sb = tk.Scrollbar(frm)
        sb.pack(side="right", fill="y")
        lb = tk.Listbox(frm, bg=BG2, fg=TEXT, font=("Helvetica", 10), selectbackground=PURPLE,
                        yscrollcommand=sb.set, activestyle="none", relief="flat", bd=0)
        lb.pack(side="left", fill="both", expand=True)
        sb.config(command=lb.yview)
        for p in products:
            lb.insert("end", f"  {p['title']}")
        def on_select():
            sel = lb.curselection()
            if not sel:
                return
            prod_url = products[sel[0]]["url"]
            dlg.destroy()
            self.add_url_var.set(prod_url)
            self._status("⏳  Cargando producto...", ORANGE)
            threading.Thread(target=self._run_scrape_add, args=(prod_url, True), daemon=True).start()
        tk.Button(dlg, text="Cargar producto seleccionado →", bg=PURPLE, fg="white",
                  font=("Helvetica", 10, "bold"), relief="flat", pady=10,
                  command=on_select).pack(pady=(0, 16), padx=16, fill="x")

    def _on_scraped_add(self, data):
        self._scraped_add = data
        self.add_nombre_var.set(data["nombre"])
        parsed = urlparse(data["url_origen"])
        self.add_meta_lbl.config(text=f"🌐 {parsed.netloc.replace('www.','')}  ·  {data['marca']}  ·  {data['escala']}")
        if data.get("precio_sugerido"):
            self._status(f"Precio detectado: USD {data['precio_sugerido']} → poné el precio en Q", ORANGE)
        self.add_preview.set_photos(data["fotos"])
        self.add_ai_txt.delete("1.0","end")
        # Auto-detectar entrega estimada
        entrega_det = _detect_entrega(data.get("features",[]))
        if entrega_det:
            self.add_entrega_var.set(entrega_det)
        translated = " · Traducido ✓" if data.get("traducido") else ""
        self._status(f"✅  {len(data['fotos'])} fotos encontradas{translated}", GREEN)
        # Auto-generar descripción con IA si hay API key
        if self.cfg.get("anthropic_api_key","").strip():
            self._add_gen_ai()

    def _add_gen_ai(self):
        if not self._scraped_add:
            self._status("⚠️  Cargá una URL primero.", ORANGE); return
        api_key = self.cfg.get("anthropic_api_key","").strip()
        if not api_key:
            self._status("⚠️  Configurá tu API key de Anthropic en ⚙ Configuración.", ORANGE); return
        self.add_ai_btn.config(state="disabled", text="⏳ Generando...")
        self._status("Generando descripcion con IA...", ORANGE)
        data = dict(self._scraped_add)
        data["nombre"] = self.add_nombre_var.get().strip() or data["nombre"]
        threading.Thread(target=self._run_ai_gen, args=(data, api_key), daemon=True).start()

    def _run_ai_gen(self, data, api_key):
        try:
            blocks = generate_ai_description(data, api_key)
            preview = blocks_to_preview(blocks)
            self.root.after(0, lambda b=blocks, p=preview: self._on_ai_done(b, p))
        except Exception as e:
            import traceback; traceback.print_exc()
            msg = str(e)
            self.root.after(0, lambda m=msg: self._on_ai_error(m))

    def _on_add_adulto18_toggle(self):
        if self._add_adulto18.get():
            self.add_cat_var.set("Adultos")
        else:
            self.add_cat_var.set(CAT_KEYS[0])

    def _on_ef_adulto18_toggle(self):
        if self._ef_adulto18.get():
            self.ef_cat_var.set("Adultos")
        else:
            self.ef_cat_var.set(CAT_KEYS[0])

    def _on_ai_done(self, blocks, preview):
        self._scraped_add["ai_blocks"] = blocks
        self.add_ai_txt.delete("1.0","end")
        self.add_ai_txt.insert("1.0", preview)
        self.add_ai_btn.config(state="normal", text="🔄 Regenerar")
        self._status("✅ Descripción generada con IA. Revisá y ajustá si hace falta.", GREEN)

    def _on_ai_error(self, err):
        self.add_ai_btn.config(state="normal", text="✨ Generar con IA")
        self._status(f"❌ Error IA: {err}", RED)

    def _add_confirm(self):
        if not self._scraped_add:
            messagebox.showwarning("Falta data","Cargá una URL primero."); return
        nombre = self.add_nombre_var.get().strip()
        if not nombre:
            messagebox.showwarning("Falta nombre","Ingresá el nombre de la figura."); return
        self._scraped_add["nombre"] = nombre
        try:
            # ai_blocks ya están en self._scraped_add si se generaron; si no, fallback al texto plano
            self._scraped_add["franquicia"]  = self.add_franquicia_var.get()
            self._scraped_add["precio_orig"] = self.add_precio_orig_var.get().strip()
            self._scraped_add["destacado"]   = self._add_destacado.get()
            self._scraped_add["oferta"]      = self._add_oferta.get()
            precio_str = self.add_precio_var.get().strip()
            try:
                reserva_auto = str(round(float(precio_str.replace(",","").replace("Q","")) * 0.20))
            except:
                reserva_auto = ""
            p = add_product(
                CATALOG_FILE, self._scraped_add,
                self.add_cat_var.get(),
                precio_str,
                "",
                reserva_auto,
                self.add_entrega_var.get().strip(),
                self.add_cantidad_var.get().strip(),
                self.add_estado_var.get(),
                self.add_youtube_var.get().strip(),
            )
            self._status(f"✅  '{p['n']}' agregada. Publicá en GitHub para actualizar el sitio.", GREEN)
            messagebox.showinfo("✅ Listo", f"'{p['n']}' agregada al catálogo.\n\nClickeá '🚀 Publicar en GitHub' para actualizar el sitio.")
            self._scraped_add = None
            self.add_url_var.set(""); self.add_nombre_var.set(""); self.add_precio_var.set("")
            self.add_entrega_var.set(""); self.add_cantidad_var.set("")
            self.add_youtube_var.set(""); self.add_preview.set_photos([])
            self.add_ai_txt.delete("1.0","end"); self.add_franquicia_var.set("")
            self.add_ai_btn.config(text="✨ Generar con IA")
            self._check_catalog()
        except Exception as e:
            messagebox.showerror("Error", str(e)); self._status(f"❌  {e}", RED)

    # ── TAB 2 LOGIC: EDITAR ───────────────────────────────────────────────────

    def _edit_load_all(self):
        try:
            cat = load_catalog(CATALOG_FILE)
            results = []
            for c, info in cat.items():
                for i, p in enumerate(info.get("products",[])):
                    results.append({"cat":c,"idx":i,"product":p})
            self._edit_all_results = results
            self._edit_populate_list(results)
        except: pass

    def _edit_populate_list(self, results):
        self.edit_listbox.delete(0,"end")
        for r in results:
            self.edit_listbox.insert("end", f"  {r['product'].get('n','?')[:28]}")

    def _edit_search(self):
        q = self.edit_search_var.get().strip().lower()
        if not q:
            self._edit_populate_list(self._edit_all_results); return
        filtered = [r for r in self._edit_all_results if q in r["product"].get("n","").lower()]
        self._edit_populate_list(filtered)
        self._edit_filtered = filtered

    def _edit_select(self, event=None):
        sel = self.edit_listbox.curselection()
        if not sel: return
        q = self.edit_search_var.get().strip().lower()
        results = [r for r in self._edit_all_results if q in r["product"].get("n","").lower()] if q else self._edit_all_results
        if sel[0] >= len(results): return
        r = results[sel[0]]
        self._edit_selected = r
        p = r["product"]
        self.edit_title_lbl.config(text=f"✏  {p.get('n','?')}", fg=TEXT)
        self.ef_nombre.set(p.get("n",""))
        self.ef_precio.set(p.get("precio",""))
        self.ef_precio_d.set(p.get("precio_d",""))
        self.ef_reserva.set(p.get("reserva",""))
        self.ef_entrega.set(p.get("entrega",""))
        self.ef_cantidad.set(p.get("cantidad",""))
        self.ef_marca.set(p.get("marca",""))
        self.ef_escala.set(p.get("escala",""))
        self.ef_youtube.set(p.get("yt",""))
        self.ef_disp.set(p.get("disp",""))
        self.ef_estado.set(p.get("estado","Nuevo"))
        self.ef_franquicia.set(p.get("franquicia",""))
        self.ef_precio_orig.set(p.get("precio_orig",""))
        self._ef_destacado.set(bool(p.get("destacado",False)))
        self._ef_oferta.set(bool(p.get("oferta",False)))
        self._ef_adulto18.set(r["cat"] == "Adultos")
        self.ef_cat_var.set(r["cat"])
        # Description
        self.ef_desc_txt.delete("1.0","end")
        desc = ""
        features = []
        for block in p.get("content",[]):
            t = block.get("t",""); x = block.get("x","")
            if t == "notion-text": desc += x + " "
            elif t in ("notion-bulleted-list","notion-numbered-list"): features.append(x)
        self.ef_desc_txt.insert("1.0", desc.strip()[:1000])
        self.ef_features_txt.delete("1.0","end")
        self.ef_features_txt.insert("1.0", "\n".join(features))
        fotos = p.get("fotos",[])
        self.edit_fotos_lbl.config(text=f"{len(fotos)} fotos" if fotos else "Sin fotos")
        self._edit_photos = list(fotos)
        self.edit_preview.set_photos(self._edit_photos)

    def _edit_upload_local(self):
        """Upload local images to Imgur and add to current edit."""
        client_id = self.cfg.get("imgur_client_id","")
        if not client_id:
            messagebox.showwarning("Sin Imgur Client ID",
                "Configurá tu Imgur Client ID en la pestaña ⚙ Configuración primero.")
            return
        paths = filedialog.askopenfilenames(
            title="Seleccioná imágenes",
            filetypes=[("Imágenes","*.jpg *.jpeg *.png *.webp *.gif"),("Todos los archivos","*.*")])
        if not paths: return
        self._status(f"⏳ Subiendo {len(paths)} imágenes a Imgur...", ORANGE)
        threading.Thread(target=self._run_imgur_upload, args=(paths, "edit"), daemon=True).start()

    def _run_imgur_upload(self, paths, target):
        uploaded = []
        for i, path in enumerate(paths):
            try:
                self.root.after(0, lambda i=i: self._status(f"⏳ Subiendo {i+1}/{len(paths)}...", ORANGE))
                url = upload_to_imgur(path, self.cfg.get("imgur_client_id",""))
                uploaded.append(url)
            except Exception as e:
                self.root.after(0, lambda e=e: self._status(f"❌ Error subiendo imagen: {e}", RED))
        if uploaded:
            def finish():
                if target == "edit":
                    self._edit_photos.extend(uploaded)
                    self.edit_preview.set_photos(self._edit_photos)
                    self.edit_fotos_lbl.config(text=f"{len(self._edit_photos)} fotos")
                else:
                    self._upd_photos.extend(uploaded)
                    self.upd_preview.set_photos(self._upd_photos)
                    self.upd_fotos_lbl.config(text=f"{len(self._upd_photos)} fotos nuevas")
                self._status(f"✅ {len(uploaded)} imágenes subidas a Imgur", GREEN)
            self.root.after(0, finish)

    def _edit_load_url_photos(self):
        url = self.edit_photo_url_var.get().strip()
        if not url: return
        if not url.startswith("http"): url = "https://" + url
        self._status("⏳ Cargando fotos desde URL...", ORANGE)
        threading.Thread(target=self._run_scrape_photos, args=(url, "edit"), daemon=True).start()

    def _run_scrape_photos(self, url, target):
        try:
            data = scrape_url(url, translate=False,
                              status_cb=lambda m: self.root.after(0, lambda msg=m: self._status(msg, ORANGE)))
            photos = data.get("fotos", [])
            def finish():
                if target == "edit":
                    self._edit_photos.extend(photos)
                    self.edit_preview.set_photos(self._edit_photos)
                    self.edit_fotos_lbl.config(text=f"{len(self._edit_photos)} fotos")
                else:
                    self._upd_photos = photos
                    self.upd_preview.set_photos(photos)
                    self.upd_fotos_lbl.config(text=f"{len(photos)} fotos nuevas")
                self._status(f"✅ {len(photos)} fotos cargadas", GREEN)
            self.root.after(0, finish)
        except Exception as e:
            self.root.after(0, lambda: self._status(f"❌ {e}", RED))

    def _edit_save(self):
        if not self._edit_selected:
            messagebox.showwarning("Nada seleccionado","Buscá y seleccioná una figura primero."); return
        r = self._edit_selected
        nombre = self.ef_nombre.get().strip()
        if not nombre: messagebox.showwarning("Falta nombre","El nombre no puede estar vacío."); return

        new_cat = self.ef_cat_var.get()
        old_cat = r["cat"]
        idx = r["idx"]

        # Build content blocks from description + features
        desc_text = self.ef_desc_txt.get("1.0","end").strip()
        features_raw = self.ef_features_txt.get("1.0","end").strip()
        blocks = []
        if desc_text: blocks.append({"t":"notion-text","x":desc_text[:1000]})
        for line in features_raw.splitlines():
            line = line.strip()
            if line: blocks.append({"t":"notion-bulleted-list","x":line})

        fields = {
            "n":          nombre,
            "precio":     self.ef_precio.get().strip(),
            "precio_d":   self.ef_precio_d.get().strip(),
            "precio_orig":self.ef_precio_orig.get().strip(),
            "reserva":    self.ef_reserva.get().strip(),
            "entrega":    self.ef_entrega.get().strip(),
            "cantidad":   self.ef_cantidad.get().strip(),
            "marca":      self.ef_marca.get().strip(),
            "escala":     self.ef_escala.get().strip(),
            "yt":         self.ef_youtube.get().strip(),
            "disp":       self.ef_disp.get().strip(),
            "estado":     self.ef_estado.get().strip(),
            "franquicia": self.ef_franquicia.get().strip(),
            "destacado":  self._ef_destacado.get(),
            "oferta":     self._ef_oferta.get(),
            "content":    blocks,
        }
        if self._edit_photos:
            fields["fotos"] = self._edit_photos
            fields["i"] = self._edit_photos[0]

        try:
            if new_cat != old_cat:
                # Move product to different category
                catalog = load_catalog(CATALOG_FILE)
                p = catalog[old_cat]["products"].pop(idx)
                for k, v in fields.items(): p[k] = v
                if new_cat not in catalog:
                    catalog[new_cat] = {"slug":new_cat.lower().replace(" ","-"),"products":[]}
                catalog[new_cat]["products"].insert(0, p)
                save_catalog(CATALOG_FILE, catalog)
            else:
                update_product(CATALOG_FILE, old_cat, idx, fields)

            self._status(f"✅ '{nombre}' guardado. Publicá en GitHub para actualizar.", GREEN)
            messagebox.showinfo("✅ Guardado", f"'{nombre}' actualizado correctamente.\n\nClickeá '🚀 Publicar en GitHub' para actualizar el sitio.")
            self._check_catalog()
        except Exception as e:
            messagebox.showerror("Error", str(e)); self._status(f"❌ {e}", RED)

    def _edit_delete(self):
        if not self._edit_selected:
            messagebox.showwarning("Nada seleccionado","Seleccioná una figura primero."); return
        r = self._edit_selected
        nombre = r["product"].get("n","?")
        if not messagebox.askyesno("Confirmar", f"¿Eliminar '{nombre}' del catálogo?\n\nEsta acción no se puede deshacer."): return
        try:
            catalog = load_catalog(CATALOG_FILE)
            catalog[r["cat"]]["products"].pop(r["idx"])
            save_catalog(CATALOG_FILE, catalog)
            self._status(f"✅ '{nombre}' eliminado.", GREEN)
            self._edit_selected = None
            self.edit_title_lbl.config(text="Seleccioná una figura", fg=MUTED)
            self._check_catalog()
        except Exception as e:
            messagebox.showerror("Error", str(e))

    # ── CONFIG LOGIC ──────────────────────────────────────────────────────────

    def _test_imgur(self):
        cid = self.cfg_imgur_var.get().strip()
        if not cid:
            messagebox.showwarning("Sin Client ID","Primero ingresá tu Imgur Client ID."); return
        self._status("Probando Imgur...", ORANGE)
        def run():
            try:
                r = requests.get("https://api.imgur.com/3/credits",
                                  headers={"Authorization":f"Client-ID {cid}"},timeout=10)
                data = r.json()
                if data.get("success"):
                    cr = data.get("data",{})
                    msg = f"✅ Imgur OK — {cr.get('ClientRemaining','?')} requests restantes"
                    self.root.after(0,lambda:self._status(msg,GREEN))
                    self.root.after(0,lambda:messagebox.showinfo("✅ Imgur conectado",msg))
                else:
                    err = data.get("data",{}).get("error","desconocido")
                    self.root.after(0,lambda:self._status(f"❌ Imgur: {err}",RED))
                    self.root.after(0,lambda:messagebox.showerror("Error Imgur",f"Client ID inválido: {err}"))
            except Exception as e:
                self.root.after(0,lambda:self._status(f"❌ {e}",RED))
                self.root.after(0,lambda:messagebox.showerror("Error",str(e)))
        import threading as _t; _t.Thread(target=run,daemon=True).start()

    def _batch_optimize(self):
        api_key = self.cfg.get("anthropic_api_key", "").strip()
        if not api_key:
            messagebox.showwarning("Sin API Key", "Configurá tu API Key de Anthropic primero.")
            return
        catalog = load_catalog(CATALOG_FILE)
        # Recolectar todos los productos que necesitan optimización
        to_optimize = []
        for cat, val in catalog.items():
            for idx, p in enumerate(val.get("products", [])):
                if needs_optimization(p):
                    to_optimize.append((cat, idx, p))
        total = len(to_optimize)
        if total == 0:
            messagebox.showinfo("Todo en orden", "No hay figuras que necesiten optimización.")
            return
        if not messagebox.askyesno("Optimizar catálogo",
            f"Se encontraron {total} figuras con contenido para mejorar.\n\n"
            f"¿Querés continuar? (puede tardar ~{total//2} minutos)"):
            return

        # Ventana de progreso
        win = tk.Toplevel(self.root)
        win.title("Optimizando catálogo..."); win.configure(bg=BG)
        win.geometry("520x280"); win.resizable(False, False)
        tk.Label(win,text="✨ Optimizando descripciones con IA",bg=BG,fg=TEXT,
                 font=("Helvetica",13,"bold")).pack(pady=(20,8))
        prog_var = tk.StringVar(value="Iniciando...")
        tk.Label(win,textvariable=prog_var,bg=BG,fg=MUTED,font=("Helvetica",10)).pack()
        import tkinter.ttk as ttk
        bar = ttk.Progressbar(win,length=460,mode="determinate",maximum=total)
        bar.pack(pady=12,padx=20)
        log_var = tk.StringVar(value="")
        tk.Label(win,textvariable=log_var,bg=BG,fg="#555",font=("Helvetica",9),
                 wraplength=480,justify="left").pack(padx=20)
        close_btn = tk.Button(win,text="Cerrar",command=win.destroy,
                              bg=BG2,fg=MUTED,relief="flat",padx=12,pady=4,state="disabled")
        close_btn.pack(pady=(12,0))

        def run():
            done = 0; errors = 0
            for cat, idx, p in to_optimize:
                name = p.get("n","?")
                win.after(0, lambda n=name, d=done: (
                    prog_var.set(f"Procesando {d+1}/{total}: {n}"),
                    bar.configure(value=d)
                ))
                try:
                    new_blocks = optimize_content_blocks(p, api_key)
                    fresh = load_catalog(CATALOG_FILE)
                    fresh[cat]["products"][idx]["content"] = new_blocks
                    fresh[cat]["products"][idx]["content_ok"] = True
                    save_catalog(CATALOG_FILE, fresh)
                    done += 1
                    win.after(0, lambda n=name: log_var.set(f"✅ {n}"))
                except Exception as e:
                    errors += 1
                    win.after(0, lambda n=name, err=e: log_var.set(f"❌ {n}: {err}"))
                import time; time.sleep(0.3)  # evitar rate limit
            win.after(0, lambda: (
                prog_var.set(f"Listo — {done} optimizadas, {errors} errores"),
                bar.configure(value=total),
                close_btn.configure(state="normal"),
                self._edit_load_all(),
                self._status(f"✅ {done} figuras optimizadas.", GREEN)
            ))
        import threading; threading.Thread(target=run, daemon=True).start()

    def _save_config(self):
        self.cfg["anthropic_api_key"] = self.cfg_anthropic_var.get().strip()
        self.cfg["imgur_client_id"]   = self.cfg_imgur_var.get().strip()
        self.cfg["github_repo"]       = self.cfg_repo_var.get().strip()
        self.cfg["github_branch"]     = self.cfg_branch_var.get().strip() or "main"
        save_config(self.cfg)
        self._status("✅ Configuración guardada.", GREEN)
        messagebox.showinfo("✅ Guardado","Configuración guardada correctamente.")

    # ── DEPLOY ────────────────────────────────────────────────────────────────

    def _deploy(self):
        repo_path = self.cfg.get("github_repo","").strip()
        if not repo_path:
            messagebox.showwarning("Sin repo configurado",
                "Configurá la carpeta del repo de GitHub en ⚙ Configuración.")
            return

        repo = Path(repo_path)

        # Step 1: Run inject_data.py to build index.html from template + productos.json
        inject_script = repo / "inject_data.py"
        template_file = repo / "index_template.html"
        data_file     = repo / "productos.json"
        output_file   = repo / "index.html"

        # Copy productos.json to repo if different path
        if CATALOG_FILE.resolve() != data_file.resolve():
            try:
                import shutil
                shutil.copy2(CATALOG_FILE, data_file)
                self._status("📋 productos.json copiado al repo...", ORANGE)
            except Exception as e:
                messagebox.showerror("Error copiando productos.json", str(e)); return

        # Run inject
        if inject_script.exists() and template_file.exists():
            self._status("⚙️  Generando index.html...", ORANGE)
            r = subprocess.run(
                [sys.executable, str(inject_script),
                 "--template", str(template_file),
                 "--data",     str(data_file),
                 "--output",   str(output_file)],
                capture_output=True, text=True
            )
            if r.returncode != 0:
                messagebox.showerror("Error en inject_data.py", r.stderr or r.stdout)
                self._status(f"❌ Error generando index.html", RED); return
            self._status("✅ index.html generado, subiendo...", ORANGE)
        else:
            # Fallback: copy index.html directly (legacy)
            if CATALOG_FILE.resolve() != (repo / "index.html").resolve():
                try:
                    import shutil
                    shutil.copy2(CATALOG_FILE, repo / "index.html")
                except Exception as e:
                    messagebox.showerror("Error copiando archivo", str(e)); return

        self._deploy_btn.config(state="disabled")
        threading.Thread(target=self._run_deploy, args=(repo,), daemon=True).start()

    def _run_deploy(self, repo_path):
        ok, msg = git_deploy(
            repo_path,
            commit_msg="Update catalog — UV Store GT Admin",
            status_cb=lambda m: self.root.after(0, lambda x=m: self._status(x, ORANGE))
        )
        def finish():
            self._deploy_btn.config(state="normal")
            if ok:
                self._status(msg, GREEN)
                messagebox.showinfo("🚀 Publicado", msg)
            else:
                self._status(f"❌ {msg}", RED)
                messagebox.showerror("Error al publicar", msg)
        self.root.after(0, finish)


# ─── ENTRY POINT ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    root = tk.Tk()
    app = UVAdminApp(root)
    root.mainloop()
