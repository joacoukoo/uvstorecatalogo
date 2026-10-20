import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { limpiarNombre, tieneBasura, opcionesReales } from '../functions/_lib/limpieza.js';
import { onRequestPost } from '../functions/api/scrape.js';

const fx = f => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf-8');

afterEach(() => { vi.unstubAllGlobals(); });

describe('limpiarNombre', () => {
  it('saca envío, feria y licencia del título de Nonasea', () => {
    const n = limpiarNombre('(WF2026 Shipping Included)JIMEI PALACE X Toei Animation - One Piece - Donquixote Doflamingo 1/6  Statue -（Licensed）');
    for (const t of ['Shipping', 'WF2026', 'Licensed', '（', '(']) expect(n).not.toContain(t);
    expect(n).toContain('Donquixote Doflamingo 1/6 Statue');
  });
  it('saca el prefijo PRE-ORDER de FNC y colapsa espacios', () => {
    expect(limpiarNombre('【PRE-ORDER】Joy Station FF7 RE Vincent  Veluntine')).toBe('Joy Station FF7 RE Vincent Veluntine');
  });
  it('saca nombres de tiendas', () => {
    expect(limpiarNombre('FNC Exclusive Goku 1/6 - Nonasea')).not.toMatch(/FNC|Nonasea/);
  });
});

describe('tieneBasura', () => {
  it('detecta tiendas y envíos', () => {
    expect(tieneBasura('Envío directo desde Nonasea')).toBe(true);
    expect(tieneBasura('Contact info@hexapusacg.com')).toBe(true);
  });
  it('deja pasar un nombre limpio', () => {
    expect(tieneBasura('Figura de Goku 1/6')).toBe(false);
  });
});

describe('opcionesReales', () => {
  it('ignora pago, stock y email', () => {
    const r = opcionesReales([
      { nombre: 'figure scale', valores: ['1:6', '1:4'] },
      { nombre: 'Payment Choice', valores: ['Deposit Only(rest...)', 'Full payment(...)'] },
      { nombre: 'Current Stock', valores: ['5'] },
      { nombre: 'Email Address', valores: [] },
    ]);
    expect(r).toEqual([{ nombre: 'figure scale', valores: ['1:6', '1:4'] }]);
  });
});

describe('POST /api/scrape con ficha de Nonasea y respuesta de la IA', () => {
  function mock(iaJson) {
    return vi.fn(async (url) => {
      if (String(url).includes('nonasea.com/api/customer/shop/product/32755')) return new Response(fx('nonasea-ficha.json'));
      if (String(url).includes('api.anthropic.com')) return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(iaJson) }] }));
      throw new Error('fetch inesperado ' + url);
    });
  }
  const req = () => ({
    env: { ANTHROPIC_API_KEY: 'k' },
    request: new Request('https://x/api/scrape', { method: 'POST', body: JSON.stringify({ url: 'https://www.nonasea.com/api/customer/shop/product/32755' }) }),
  });

  it('devuelve nombre limpio, Pre-Orden, categoría válida, origen y variantes', async () => {
    vi.stubGlobal('fetch', mock({
      nombre: 'FNC Donquixote Doflamingo 1/6 Statue (Shipping Included)',
      desc: 'Una estatua imponente. Se envía desde Nonasea con envío incluido.',
      categoria: 'Entrega Inmediata', entrega: '2027 Q2', franquicia: 'Anime',
      variantes: ['Echo', 'Premium'],
    }));
    const res = await onRequestPost(req());
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.nombre_limpio).not.toMatch(/FNC|Shipping/);
    expect(d.nombre_limpio).toContain('Doflamingo');
    expect(d.disp).toBe('Pre-Orden');
    expect(d.estado).not.toBe('Entrega Inmediata');
    expect(['Hot Toys 1:6', 'Estatuas Premium', 'Otras Figuras', 'Adultos']).toContain(d.categoria);
    expect(d.entrega).toBe('2027 Q2');
    expect(d.origen).toBe('https://www.nonasea.com/api/customer/shop/product/32755');
    expect(d.marca).toMatch(/jimei palace/i);
    expect(d.opciones.map(o => o.valores).flat()).toEqual(['Echo Version', 'Premium Version']);
    expect(d.variantes_ia.map(v => v.label)).toEqual(['Echo', 'Premium']);
    expect(d.desc).toContain('imponente');
    expect(tieneBasura(d.desc)).toBe(false);
    expect(d.photos.length).toBeGreaterThan(0);
  });
});

describe('opciones de los scrapers', () => {
  it('BigCommerce lee cada grupo de opciones con sus valores', async () => {
    const { scrapeBigCommerce } = await import('../functions/_lib/scrapers.js');
    const r = scrapeBigCommerce('https://www.fanaticanimestore.com/pre-order-hess-night-wings-studio-1-6-1-4-kogenta/', fx('fnc-ficha-variantes.html'));
    expect(r.opciones[0]).toEqual({ nombre: 'figure scale', valores: ['1:6', '1:4'] });
    expect(r.opciones[1].nombre).toBe('Payment Choice');
    expect(opcionesReales(r.opciones)).toHaveLength(1);
  });
  it('Shopify lee options y las fotos de cada variante', async () => {
    const { scrapeShopify } = await import('../functions/_lib/scrapers.js');
    const product = {
      title: 'Mega Garchomp', vendor: 'StatueCorp', images: [{ src: 'https://cdn.shopify.com/a.jpg' }],
      options: [{ name: 'Color', values: ['A', 'B'] }],
      variants: [
        { option1: 'A', price: '129.00', available: true, featured_image: { src: 'https://cdn.shopify.com/va.jpg' } },
        { option1: 'B', price: '129.00', available: true, featured_image: { src: 'https://cdn.shopify.com/vb.jpg' } },
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ product }))));
    const r = await scrapeShopify('https://statuecorp.com/products/02-mega-garchomp', '');
    expect(r.opciones).toEqual([{ nombre: 'Color', valores: ['A', 'B'], fotos: [['https://cdn.shopify.com/va.jpg'], ['https://cdn.shopify.com/vb.jpg']] }]);
  });
});

describe('limpieza de lo que deja pasar la tienda', () => {
  it('saca líneas de envío y de contacto aunque no haya IA', async () => {
    const { sacarOracionesConBasura } = await import('../functions/_lib/limpieza.js');
    const t = sacarOracionesConBasura('Una estatua imponente.\nThis product will be shipped directly from China\nPlease contact us info@hexapusacg.com\nwww.facebook.com/hexapus');
    expect(t).toBe('Una estatua imponente.');
  });
  it('si la marca publicada es la tienda, usa la marca que dice la IA y normaliza la escala', async () => {
    const product = { title: '02 - Mega Garchomp 1/20', vendor: 'StatueCorp', images: [{ src: 'https://cdn.shopify.com/a.jpg' }], options: [], variants: [{ price: '1' }] };
    vi.stubGlobal('fetch', vi.fn(async url => String(url).includes('anthropic')
      ? new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ nombre: 'Mega Garchomp', marca: 'Rainbow Studio', desc: 'Linda.', categoria: 'Estatuas Premium' }) }] }))
      : new Response(JSON.stringify({ product }))));
    const res = await onRequestPost({ env: { ANTHROPIC_API_KEY: 'k' }, request: new Request('https://x', { method: 'POST', body: JSON.stringify({ url: 'https://statuecorp.com/products/02-mega-garchomp' }) }) });
    const d = await res.json();
    expect(d.marca).toBe('Rainbow Studio');
    expect(d.escala).toBe('1:20');
  });
});
