// Lectura de páginas de lista (muchas figuras) de las tiendas soportadas para traer en lote.
// Cada ítem: {origen, clave, nombre, foto}. `clave` identifica el producto en su tienda y
// sirve para saber si ya lo tenemos; `origen` es lo que después se pasa a /api/scrape.

function decodeHtml(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, ' ').trim();
}

export function detectarLista(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'fanaticanimestore.com') return { tipo: 'bigcommerce' };
  if (host === 'sideshow.com') return { tipo: 'sideshow' };
  if (host === 'nonasea.com') {
    const m = u.pathname.match(/^\/mall\/([^/?#]+)/);
    return m ? { tipo: 'nonasea', codigo: decodeURIComponent(m[1]) } : null;
  }
  const col = u.pathname.match(/\/collections\/([^/?#]+)/);
  if (col) return { tipo: 'shopify', coleccion: col[1], origin: u.origin };
  return null;
}

export function leerListaBigCommerce(html, url) {
  const items = [];
  const cards = html.match(/<article class="card"[\s\S]*?<\/article>/g) || [];
  for (const c of cards) {
    const t = c.match(/card-title[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!t) continue;
    const origen = decodeHtml(t[1]);
    const slug = new URL(origen).pathname.replace(/^\/|\/$/g, '');
    const foto = (c.match(/https?:\/\/cdn\d*\.bigcommerce\.com\/[^"'\s]+?\.(?:jpe?g|png|webp)/i) || [''])[0];
    items.push({ origen, clave: 'fnc:' + slug, nombre: decodeHtml(t[2].replace(/<[^>]+>/g, '')), foto });
  }
  const actual = +(new URL(url).searchParams.get('page') || 1);
  const hrefs = [...html.matchAll(/href="([^"]*[?&](?:amp;)?page=(\d+)[^"]*)"/g)];
  const sig = hrefs.find(h => +h[2] === actual + 1);
  return { items, siguiente: sig ? decodeHtml(sig[1]) : null };
}

export function leerListaNonasea(json) {
  const list = json?.data?.list || [];
  const items = list.map(p => ({
    origen: `https://www.nonasea.com/api/customer/shop/product/${p.id}`,
    clave: 'nonasea:' + p.id,
    nombre: decodeHtml(p.title),
    foto: (Array.isArray(p.img) ? p.img[0] : p.img) || '',
  }));
  return { items, total: json?.data?.total || 0 };
}

// Sideshow arma sus grillas (marca, franquicia, búsqueda) en el navegador con Bloomreach: la página
// trae `new BloomreachSearchGrid('#...', { q : 'brand_138', search_type : 'category', ... })` y los
// productos salen de /ajax/bloomreach-search. Devuelve {q, search_type} para pedir esa lista.
export function consultaSideshow(html, url) {
  const m = String(html || '').match(/new BloomreachSearchGrid\(\s*'[^']*'\s*,\s*\{([\s\S]*?)\}\s*\)/);
  if (!m) return null;
  const q = (m[1].match(/\bq\s*:\s*'([^']*)'/) || [])[1];
  const tipo = (m[1].match(/\bsearch_type\s*:\s*'([^']*)'/) || [])[1] || 'category';
  if (!q) return null;
  if (q !== '*') return { q, search_type: tipo };
  // Búsqueda por palabra (/search?q=godzilla): la palabra viene en la URL de la página.
  const palabra = new URL(url).searchParams.get('q') || new URL(url).searchParams.get('keywords');
  return palabra ? { q: palabra, search_type: 'keyword' } : { q: 'brg_dyn_nwf9is3a73', search_type: 'category' };
}

// Solo lo que se puede vender: en stock y pre-orden (no lista de espera ni agotadas).
export const FILTRO_SIDESHOW = 'sc_combined_facet:("Pre-Order" OR "Available Now")';

// El link es franquicia-título-fabricante-número ("godzilla-king-ghidorah-acro-916223"): lo que
// sigue al título es el fabricante. '' si el título no aparece tal cual en el link.
export function fabricanteSideshow(url, titulo) {
  const slug = (String(url).split('/').pop() || '').replace(/-\d{6,}$/, '');
  const t = String(titulo).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const i = t ? slug.lastIndexOf(t) : -1;
  if (i < 0) return '';
  return slug.slice(i + t.length).replace(/^-/, '').split('-').filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

export function leerListaSideshow(json) {
  const docs = json?.response?.docs || [];
  const vistos = new Set();
  const items = [];
  for (const d of docs) {
    // Regular y Deluxe pueden venir como dos filas del mismo artículo (?var=916289 / ?var=9162892):
    // es una sola figura, el scrape del link base ya trae la Deluxe.
    const sku = String(d.sc_parent_sku || d.pid || d.sc_sku || '');
    if (!sku || vistos.has(sku)) continue;
    vistos.add(sku);
    const origen = String(d.url || '').split('?')[0];
    const nombre = decodeHtml(d.title);
    const fabricante = fabricanteSideshow(origen, nombre);
    // "King Ghidorah by Acro", como Sideshow nombra sus figuras: sin el fabricante no se puede
    // reconocer la misma figura subida desde otra tienda (ver marcarDuplicados en lote-import.js).
    items.push({ origen, clave: 'sideshow:' + sku, nombre: fabricante ? `${nombre} by ${fabricante}` : nombre, foto: d.thumb_image || '' });
  }
  return { items, total: json?.response?.numFound || 0 };
}

export function leerListaShopify(json, origin) {
  const host = new URL(origin).hostname.replace(/^www\./, '');
  const items = (json?.products || []).map(p => ({
    origen: `${origin}/products/${p.handle}`,
    clave: `shopify:${host}:${p.handle}`,
    nombre: decodeHtml(p.title),
    foto: p.images?.[0]?.src || '',
  }));
  return { items };
}
