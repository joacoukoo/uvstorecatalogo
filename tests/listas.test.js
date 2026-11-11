import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { detectarLista, leerListaBigCommerce, leerListaNonasea, leerListaShopify, consultaSideshow, leerListaSideshow, fabricanteSideshow } from '../functions/_lib/listas.js';
import { onRequestPost } from '../functions/api/scrape-lista.js';

const fx = f => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf-8');
const FNC_URL = 'https://www.fanaticanimestore.com/shop-all/pre-order/?sort=newest';

afterEach(() => { vi.unstubAllGlobals(); });

describe('detectarLista', () => {
  it('reconoce FNC como bigcommerce', () => {
    expect(detectarLista(FNC_URL).tipo).toBe('bigcommerce');
  });
  it('reconoce Nonasea con su código de clasificación', () => {
    expect(detectarLista('https://www.nonasea.com/mall/NEWPRODUCTS?ordering=-id&page=1&page_size=50'))
      .toMatchObject({ tipo: 'nonasea', codigo: 'NEWPRODUCTS' });
  });
  it('reconoce una colección Shopify', () => {
    expect(detectarLista('https://statuecorp.com/collections/all?page=2'))
      .toMatchObject({ tipo: 'shopify', coleccion: 'all', origin: 'https://statuecorp.com' });
  });
  it('devuelve null para sitios no soportados', () => {
    expect(detectarLista('https://www.bigbadtoystore.com/Search')).toBeNull();
  });
});

describe('leerListaBigCommerce', () => {
  const { items, siguiente } = leerListaBigCommerce(fx('fnc-lista.html'), FNC_URL);
  it('lee las 3 figuras con nombre, clave y foto', () => {
    expect(items).toHaveLength(3);
    expect(items[0].nombre.startsWith('【PRE-ORDER】QuesQ Studio')).toBe(true);
    expect(items[0].clave).toBe('fnc:pre-order-quesq-studio-1-7-priest-space-sibuna-licensed');
    expect(items[0].origen).toBe('https://www.fanaticanimestore.com/pre-order-quesq-studio-1-7-priest-space-sibuna-licensed/');
    expect(items[0].foto).toContain('cdn11.bigcommerce.com');
  });
  it('encuentra la página siguiente', () => {
    expect(siguiente).toMatch(/page=2$/);
  });
});

describe('leerListaNonasea', () => {
  it('lee id, foto y ficha', () => {
    const { items, total } = leerListaNonasea(JSON.parse(fx('nonasea-lista.json')));
    expect(items[0].clave).toBe('nonasea:32755');
    expect(items[0].foto).toContain('hexapus');
    expect(items[0].origen).toBe('https://www.nonasea.com/api/customer/shop/product/32755');
    expect(total).toBeGreaterThan(0);
  });
});

describe('leerListaShopify', () => {
  it('arma el link del producto', () => {
    const { items } = leerListaShopify(JSON.parse(fx('shopify-lista.json')), 'https://statuecorp.com');
    expect(items[0].origen).toBe('https://statuecorp.com/products/02-mega-garchomp');
    expect(items[0].clave).toBe('shopify:statuecorp.com:02-mega-garchomp');
    expect(items[0].foto).toContain('cdn.shopify.com');
  });
});

describe('POST /api/scrape-lista', () => {
  const req = body => ({ request: new Request('https://x/api/scrape-lista', { method: 'POST', body: JSON.stringify(body) }), env: {} });
  it('rechaza sitios no soportados con el mensaje para el admin', async () => {
    const res = await onRequestPost(req({ url: 'https://www.bigbadtoystore.com/Search' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Este sitio no está soportado para lote; usá el link individual');
  });
  it('lee FNC y devuelve el número de la página siguiente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(fx('fnc-lista.html'), { status: 200 })));
    const res = await onRequestPost(req({ url: FNC_URL }));
    const data = await res.json();
    expect(data.items).toHaveLength(3);
    expect(data.siguiente).toBe(2);
  });
  it('resuelve el código de Nonasea al id de clasificación y pide la lista igual que su web', async () => {
    const f = vi.fn(async (url, init) => {
      // Sin este header Nonasea devuelve un catálogo reducido y en otro orden.
      if (init?.headers?.['server-code'] !== 'nonasea') throw new Error('falta server-code ' + url);
      if (url.includes('classification_list')) return new Response(JSON.stringify({ data: [{ id: 32, ename: 'NEW PRODUCTS' }] }));
      if (url.includes('/shop/product?class_id=32&ordering=-id&page=1&page_size=20')) return new Response(fx('nonasea-lista.json'));
      throw new Error('fetch inesperado ' + url);
    });
    vi.stubGlobal('fetch', f);
    const res = await onRequestPost(req({ url: 'https://www.nonasea.com/mall/NEWPRODUCTS?ordering=-id&page=1&page_size=50' }));
    const data = await res.json();
    expect(data.items[0].clave).toBe('nonasea:32755');
  });
  it('respeta el orden elegido en la URL de Nonasea', async () => {
    const f = vi.fn(async url => url.includes('classification_list')
      ? new Response(JSON.stringify({ data: [{ id: 32, ename: 'NEW PRODUCTS' }] }))
      : new Response(fx('nonasea-lista.json')));
    vi.stubGlobal('fetch', f);
    await onRequestPost(req({ url: 'https://www.nonasea.com/mall/NEWPRODUCTS?ordering=-sales' }));
    expect(f.mock.calls[1][0]).toContain('ordering=-sales');
  });
});

describe('Sideshow', () => {
  const req = body => ({ request: new Request('https://x/api/scrape-lista', { method: 'POST', body: JSON.stringify(body) }), env: {} });
  const GODZILLA = 'https://www.sideshow.com/brands/godzilla';
  const html = `<script>document.br_search_grid = new BloomreachSearchGrid('#br-search-container', { q : 'brand_138', page : 1, search_type : 'category', list_name :  "Godzilla (brand)" });</script>`;
  const doc = (pid, url, extra = {}) => ({ pid, sc_sku: pid, title: 'Godzilla vs. Shinsei-maru', url,
    thumb_image: `https://www.sideshow.com/cdn-cgi/image/height=350/https://www.sideshow.com/storage/product-images/${pid}/x-silo_sm.png`, ...extra });

  it('detecta sideshow.com', () => {
    expect(detectarLista(GODZILLA)).toEqual({ tipo: 'sideshow' });
  });

  it('saca la consulta de Bloomreach de la página', () => {
    expect(consultaSideshow(html, GODZILLA)).toEqual({ q: 'brand_138', search_type: 'category' });
  });

  it('en una búsqueda usa la palabra de la URL', () => {
    const busq = `new BloomreachSearchGrid('#br-search-container', {\n q : '*', page : 1, search_type : 'keyword' })`;
    expect(consultaSideshow(busq, 'https://www.sideshow.com/search?q=godzilla')).toEqual({ q: 'godzilla', search_type: 'keyword' });
  });

  it('sin grilla devuelve null', () => {
    expect(consultaSideshow('<html></html>', GODZILLA)).toBeNull();
  });

  it('Regular y Deluxe del mismo artículo son una sola figura, con el link sin ?var', () => {
    const base = 'https://www.sideshow.com/collectibles/godzilla-godzilla-vs-shinsei-maru-prime-1-studio-916289';
    const { items, total } = leerListaSideshow({ response: { numFound: 2, docs: [
      doc('916289', base + '?var=916289', { sc_parent_sku: '916289' }),
      doc('9162892', base + '?var=9162892', { sc_parent_sku: '916289' }),
    ] } });
    expect(total).toBe(2);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ origen: base, clave: 'sideshow:916289', nombre: 'Godzilla vs. Shinsei-maru by Prime 1 Studio' });
  });

  it('pide solo disponibles y pre-orden, y pagina por el total', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ response: { numFound: 35, docs: [doc('916285', 'https://www.sideshow.com/collectibles/godzilla-godzilla-2001-acro-916285')] } })));
    vi.stubGlobal('fetch', f);
    const r = await (await onRequestPost(req({ url: GODZILLA }))).json();
    const pedida = decodeURIComponent(f.mock.calls[1][0]).replace(/\+/g, ' ');
    expect(pedida).toContain('q=brand_138');
    expect(pedida).toContain('sc_combined_facet:("Pre-Order" OR "Available Now")');
    expect(r.items[0].clave).toBe('sideshow:916285');
    expect(r.siguiente).toBe(2);
  });
});

describe('fabricanteSideshow', () => {
  it('saca el fabricante que sigue al título en el link', () => {
    expect(fabricanteSideshow('https://www.sideshow.com/collectibles/godzilla-king-ghidorah-acro-916223', 'King Ghidorah')).toBe('Acro');
    expect(fabricanteSideshow('https://www.sideshow.com/collectibles/godzilla-godzilla-2026-spiral-studio-916291', 'Godzilla (2026)')).toBe('Spiral Studio');
  });
  it('vacío si el título no está en el link', () => {
    expect(fabricanteSideshow('https://www.sideshow.com/collectibles/godzilla-otra-cosa-x-plus-916000', 'King Ghidorah')).toBe('');
  });
});
