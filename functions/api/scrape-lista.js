import { detectarLista, leerListaBigCommerce, leerListaNonasea, leerListaShopify, consultaSideshow, leerListaSideshow, FILTRO_SIDESHOW } from '../_lib/listas.js';
import { fetchPage, FETCH_HEADERS } from '../_lib/fetchPage.js';

// POST {url, pagina?} → {items, siguiente}. Solo la lista liviana (sin IA ni fichas):
// el admin después pide /api/scrape por cada figura elegida.
const NO_SOPORTADO = 'Este sitio no está soportado para lote; usá el link individual';
const NONASEA_API = 'https://www.nonasea.com/api/customer';
// Las tiendas suben pocas figuras nuevas por vez: 20 alcanza y se compara más rápido.
const POR_PAGINA = 20;

export async function onRequestPost({ request }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'JSON invalido' }, 400); }
  const { url } = body;
  const pagina = Math.max(1, parseInt(body.pagina, 10) || 1);
  const tipo = detectarLista(url || '');
  if (!tipo) return json({ error: NO_SOPORTADO }, 400);

  try {
    if (tipo.tipo === 'bigcommerce') {
      const u = new URL(url);
      if (pagina > 1) u.searchParams.set('page', String(pagina));
      const html = await (await fetchPage(u.toString())).text();
      const { items, siguiente } = leerListaBigCommerce(html, u.toString());
      return json({ items, siguiente: siguiente ? pagina + 1 : null });
    }

    if (tipo.tipo === 'sideshow') {
      const consulta = consultaSideshow(await (await fetchPage(url)).text(), url);
      if (!consulta) return json({ error: 'No encontré una lista de figuras en esa página de Sideshow' }, 422);
      const qs = new URLSearchParams({ ...consulta, page: String(pagina), per_page: String(POR_PAGINA), efq: FILTRO_SIDESHOW });
      const res = await fetch('https://www.sideshow.com/ajax/bloomreach-search?' + qs, {
        headers: { 'User-Agent': FETCH_HEADERS['User-Agent'], 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Referer': url },
      });
      if (!res.ok) throw new Error(`Sideshow respondió ${res.status}`);
      const { items, total } = leerListaSideshow(await res.json());
      return json({ items, siguiente: pagina * POR_PAGINA < total ? pagina + 1 : null });
    }

    if (tipo.tipo === 'nonasea') {
      // Igual que su web: sin el header `server-code` la API devuelve un catálogo reducido, y la
      // grilla de /mall sale de /shop/product (class_product_list mezcla las destacadas primero).
      const init = { headers: { 'server-code': 'nonasea' } };
      const clases = await (await fetch(`${NONASEA_API}/index/classification_list`, init)).json();
      const norm = s => String(s || '').replace(/\s+/g, '').toUpperCase();
      const clase = (clases?.data || []).find(c => norm(c.ename) === norm(tipo.codigo));
      if (!clase) return json({ error: 'No encontré esa sección de Nonasea' }, 422);
      const orden = encodeURIComponent(new URL(url).searchParams.get('ordering') || '-id');
      const res = await fetch(`${NONASEA_API}/shop/product?class_id=${clase.id}&ordering=${orden}&page=${pagina}&page_size=${POR_PAGINA}`, init);
      const { items, total } = leerListaNonasea(await res.json());
      return json({ items, siguiente: pagina * POR_PAGINA < total ? pagina + 1 : null });
    }

    const res = await fetchPage(`${tipo.origin}/collections/${tipo.coleccion}/products.json?limit=${POR_PAGINA}&page=${pagina}`);
    const { items } = leerListaShopify(JSON.parse(await res.text()), tipo.origin);
    return json({ items, siguiente: items.length === POR_PAGINA ? pagina + 1 : null });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
