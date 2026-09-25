import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestPost, generarCodigoLote } from '../functions/api/lote-sync.js';

const ENV = { SUPABASE_SERVICE_KEY: 'service-key', GITHUB_TOKEN: 'gh', GITHUB_REPO: 'o/r' };

afterEach(() => { vi.unstubAllGlobals(); });

function b64(str) { return Buffer.from(str, 'utf-8').toString('base64'); }
function json(body, status = 200) { return new Response(JSON.stringify(body), { status }); }

// Simula Supabase + GitHub según la URL. `lotes`: filas de lotes_pedido del producto;
// `activas`: órdenes activas por id de lote; `catalog`: productos.json.
function mockBackend({ lotes = [], activas = {}, catalog = { Cat: { products: [{ id: 'a' }] } }, insertFalla = false }) {
  const m = vi.fn(async (url, opts = {}) => {
    const metodo = opts.method || 'GET';
    if (url.includes('/rest/v1/lotes_pedido?catalogo_id=')) return json(lotes);
    if (url.includes('/rest/v1/lotes_pedido?select=codigo')) return json([]);
    if (url.endsWith('/rest/v1/lotes_pedido') && metodo === 'POST') {
      return insertFalla ? new Response('Error', { status: 500 }) : json([{ id: 'nuevo' }], 201);
    }
    if (url.includes('/rest/v1/lotes_pedido?id=eq.') && metodo === 'PATCH') return new Response(null, { status: 204 });
    if (url.includes('/rest/v1/ordenes?lote_id=eq.')) {
      const id = url.match(/lote_id=eq\.([^&]+)/)[1];
      return json(Array.from({ length: activas[id] || 0 }, (_, i) => ({ id: 'o' + i })));
    }
    if (url.includes('/commits/main')) return json({ sha: 'c1' });
    if (url.includes('/contents/productos.json?ref=')) return json({ content: b64(JSON.stringify(catalog)), sha: 'f1' });
    if (url.includes('/contents/productos.json') && metodo === 'PUT') return json({ ok: true });
    throw new Error('fetch inesperado: ' + metodo + ' ' + url);
  });
  vi.stubGlobal('fetch', m);
  return m;
}
function llamadas(m, metodo, fragmento) {
  return m.mock.calls.filter(c => (c[1]?.method || 'GET') === metodo && c[0].includes(fragmento));
}
function catalogoEscrito(m) {
  const [put] = llamadas(m, 'PUT', '/contents/productos.json');
  expect(put, 'se esperaba un PUT a GitHub').toBeTruthy();
  return JSON.parse(Buffer.from(JSON.parse(put[1].body).content, 'base64').toString('utf-8'));
}
async function post(body) {
  const req = new Request('https://x/api/lote-sync', { method: 'POST', body: JSON.stringify(body) });
  const res = await onRequestPost({ request: req, env: ENV });
  return { status: res.status, body: await res.json() };
}
const BASE = { catalogo_id: 'a', producto: 'Jinx', marca: 'Hot Toys', escala: '1:6' };

describe('generarCodigoLote', () => {
  it('genera codigo de 2+2 letras mas sufijo 01', () => {
    expect(generarCodigoLote('Jinx', 'Hot Toys', [])).toBe('JIHO01');
  });
  it('incrementa el sufijo si ya existe', () => {
    expect(generarCodigoLote('Jinx', 'Hot Toys', ['JIHO01', 'JIHO02'])).toBe('JIHO03');
  });
});

describe('onRequestPost', () => {
  it('crea un lote nuevo cuando no existe uno para ese catalogo_id', async () => {
    const catalog = { Cat: { products: [{ id: 'a', cantidad: '3' }] } };
    const m = mockBackend({ catalog });
    const { body } = await post({ ...BASE, cantidad: 3, cantidad_cambiada: true, crear_lote: true });

    expect(body).toEqual({ disponibles: 3, agotado: false });
    const [insert] = llamadas(m, 'POST', '/rest/v1/lotes_pedido');
    expect(JSON.parse(insert[1].body)).toMatchObject({ producto: 'Jinx', marca: 'Hot Toys', catalogo_id: 'a', catalogo_variante: null, cantidad: 3 });
    // El catálogo ya coincide (3 disponibles, no agotado): no se escribe nada.
    expect(llamadas(m, 'PUT', '/contents/')).toHaveLength(0);
  });

  it('no crea lote si el admin no marco "Crear lote de stock" (producto subido por si se vende)', async () => {
    const m = mockBackend({});
    const { body } = await post({ ...BASE, cantidad: 2, cantidad_cambiada: true });
    expect(body).toEqual({ sin_lote: true });
    expect(llamadas(m, 'POST', '/rest/v1/lotes_pedido')).toHaveLength(0);
    expect(llamadas(m, 'PUT', '/contents/')).toHaveLength(0);
  });

  it('no crea lote si el producto no trae cantidad', async () => {
    const m = mockBackend({});
    const { body } = await post({ ...BASE, cantidad: null, cantidad_cambiada: false, crear_lote: true });
    expect(body).toEqual({ sin_lote: true });
    expect(llamadas(m, 'POST', '/rest/v1/lotes_pedido')).toHaveLength(0);
  });

  it('no crea lote para un producto con Deluxe (sus lotes van por variante, a mano)', async () => {
    const m = mockBackend({});
    const { body } = await post({ ...BASE, cantidad: 2, cantidad_cambiada: true, precio_d: true, crear_lote: true });
    expect(body).toEqual({ sin_lote: true });
    expect(llamadas(m, 'POST', '/rest/v1/lotes_pedido')).toHaveLength(0);
  });

  it('si el admin NO cambio la cantidad, no toca el lote aunque el formulario traiga otro numero', async () => {
    const catalog = { Cat: { products: [{ id: 'a', cantidad: '2' }] } };
    const m = mockBackend({ lotes: [{ id: 'L', cantidad: 3, catalogo_variante: null }], activas: { L: 1 }, catalog });
    const { body } = await post({ ...BASE, cantidad: 99, cantidad_cambiada: false });

    // 3 (lote) - 1 activa = 2. Nada derivado de 99.
    expect(body).toEqual({ disponibles: 2, agotado: false });
    expect(llamadas(m, 'PATCH', '/rest/v1/lotes_pedido')).toHaveLength(0);
    expect(llamadas(m, 'PUT', '/contents/')).toHaveLength(0);
  });

  it('si el admin cambio la cantidad, ajusta el lote para que queden exactamente esas disponibles', async () => {
    // Lote de 3 con 1 vendida (2 disponibles). El admin corrige "Disponibles" a 1.
    const catalog = { Cat: { products: [{ id: 'a', cantidad: '1' }] } };
    const m = mockBackend({ lotes: [{ id: 'L', cantidad: 3, catalogo_variante: null }], activas: { L: 1 }, catalog });
    const { body } = await post({ ...BASE, cantidad: 1, cantidad_cambiada: true });

    expect(body).toEqual({ disponibles: 1, agotado: false });
    const [patch] = llamadas(m, 'PATCH', '/rest/v1/lotes_pedido?id=eq.L');
    expect(JSON.parse(patch[1].body)).toEqual({ cantidad: 2 }); // 1 disponible + 1 vendida
  });

  it('bajar la cantidad a 0 agota el producto en el catalogo', async () => {
    const catalog = { Cat: { products: [{ id: 'a', cantidad: '0', agotado: false }] } };
    const m = mockBackend({ lotes: [{ id: 'L', cantidad: 2, catalogo_variante: null }], activas: { L: 1 }, catalog });
    const { body } = await post({ ...BASE, cantidad: 0, cantidad_cambiada: true });

    expect(body).toEqual({ disponibles: 0, agotado: true });
    expect(JSON.parse(llamadas(m, 'PATCH', '/rest/v1/lotes_pedido')[0][1].body)).toEqual({ cantidad: 1 });
    expect(catalogoEscrito(m).Cat.products[0]).toMatchObject({ cantidad: '0', agotado: true });
  });

  it('corrige un Agotado pisado por una edicion con datos viejos', async () => {
    // Lote vendido completo, pero el admin guardo el producto con agotado:false y cantidad 1 (copia vieja).
    const catalog = { Cat: { products: [{ id: 'a', cantidad: '1', agotado: false }] } };
    const m = mockBackend({ lotes: [{ id: 'L', cantidad: 2, catalogo_variante: null }], activas: { L: 2 }, catalog });
    const { body } = await post({ ...BASE, cantidad: 1, cantidad_cambiada: false });

    expect(body).toEqual({ disponibles: 0, agotado: true });
    expect(llamadas(m, 'PATCH', '/rest/v1/lotes_pedido')).toHaveLength(0);
    expect(catalogoEscrito(m).Cat.products[0]).toMatchObject({ cantidad: '0', agotado: true });
  });

  it('producto con lotes por variante: solo sincroniza los Agotado de cada variante, nunca la cantidad', async () => {
    const catalog = { Cat: { products: [{ id: 'a', cantidad: '5', precio_d: '6000', agotado_r: false, agotado_d: false }] } };
    const m = mockBackend({
      lotes: [{ id: 'R', cantidad: 1, catalogo_variante: 'regular' }, { id: 'D', cantidad: 2, catalogo_variante: 'deluxe' }],
      activas: { R: 1, D: 0 },
      catalog
    });
    await post({ ...BASE, cantidad: 5, cantidad_cambiada: true, precio_d: true });

    expect(llamadas(m, 'PATCH', '/rest/v1/lotes_pedido')).toHaveLength(0);
    expect(catalogoEscrito(m).Cat.products[0]).toMatchObject({ cantidad: '5', agotado_r: true, agotado_d: false });
  });

  it('devuelve 400 si falta un campo requerido', async () => {
    const { status } = await post({ catalogo_id: 'a' });
    expect(status).toBe(400);
  });

  it('devuelve 400 si cantidad no es un número', async () => {
    const { status, body } = await post({ ...BASE, cantidad: 'no-es-numero' });
    expect(status).toBe(400);
    expect(body).toEqual({ error: 'cantidad debe ser un número' });
  });

  it('devuelve 500 si Supabase retorna un error', async () => {
    mockBackend({ insertFalla: true });
    const { status, body } = await post({ ...BASE, cantidad: 3, cantidad_cambiada: true, crear_lote: true });
    expect(status).toBe(500);
    expect(body).toHaveProperty('error');
  });
});
