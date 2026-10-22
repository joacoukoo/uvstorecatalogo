import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { detectarLista, leerListaBigCommerce, leerListaNonasea, leerListaShopify } from '../functions/_lib/listas.js';
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
    expect(detectarLista('https://www.sideshow.com/collectibles')).toBeNull();
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
    const res = await onRequestPost(req({ url: 'https://www.sideshow.com/collectibles' }));
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
