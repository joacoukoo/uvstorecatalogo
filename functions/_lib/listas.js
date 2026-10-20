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
