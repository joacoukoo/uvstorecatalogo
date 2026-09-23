import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestGet, onRequestPost, verifySupabaseSession } from '../functions/api/stock-sync.js';

function b64(str) { return Buffer.from(str, 'utf-8').toString('base64'); }
const ENV = { GITHUB_TOKEN: 'gh', GITHUB_REPO: 'o/r' };
const ADMIN_ID = '902668dd-2f20-4d1e-a56a-dce062f98afc';

// Sesion valida del unico admin del sitio.
function authOk() { return new Response(JSON.stringify({ id: ADMIN_ID }), { status: 200 }); }
// Las dos llamadas que hace readFile(): commit sha + contenido del archivo.
function ghRead(catalog) {
  return [
    new Response(JSON.stringify({ sha: 'c1' }), { status: 200 }),
    new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'f1' }), { status: 200 })
  ];
}
function mockFetch(responses) {
  const m = vi.fn();
  for (const r of responses) m.mockResolvedValueOnce(r);
  vi.stubGlobal('fetch', m);
  return m;
}
// El body escrito en el PUT a GitHub, decodificado.
function catalogoEscrito(fetchMock) {
  const put = fetchMock.mock.calls.find(c => c[1] && c[1].method === 'PUT');
  expect(put, 'se esperaba un PUT a GitHub').toBeTruthy();
  return JSON.parse(Buffer.from(JSON.parse(put[1].body).content, 'base64').toString('utf-8'));
}
function huboPut(fetchMock) {
  return fetchMock.mock.calls.some(c => c[1] && c[1].method === 'PUT');
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('verifySupabaseSession', () => {
  it('devuelve false sin token', async () => {
    expect(await verifySupabaseSession(null)).toBe(false);
  });
  it('devuelve true si Supabase responde ok con el id del admin', async () => {
    mockFetch([authOk()]);
    expect(await verifySupabaseSession('tok123')).toBe(true);
  });
  it('devuelve false si Supabase rechaza el token', async () => {
    mockFetch([new Response('{}', { status: 401 })]);
    expect(await verifySupabaseSession('tok-malo')).toBe(false);
  });
  it('devuelve false si el token es valido pero de otro usuario', async () => {
    mockFetch([new Response(JSON.stringify({ id: 'otro-usuario-cualquiera' }), { status: 200 })]);
    expect(await verifySupabaseSession('tok-de-otro')).toBe(false);
  });
});

describe('onRequestGet', () => {
  it('devuelve 401 sin Authorization header', async () => {
    const res = await onRequestGet({ request: new Request('https://x/api/stock-sync'), env: ENV });
    expect(res.status).toBe(401);
  });

  it('devuelve la lista liviana del catalogo con sesion valida', async () => {
    const catalog = { Cat: { products: [{ id: 'a', n: 'Figura', marca: 'M', cantidad: '2', agotado: false }] } };
    mockFetch([authOk(), ...ghRead(catalog)]);

    const req = new Request('https://x/api/stock-sync', { headers: { Authorization: 'Bearer tok123' } });
    const res = await onRequestGet({ request: req, env: ENV });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([{ id: 'a', n: 'Figura', marca: 'M', cantidad: '2', agotado: false }]);
  });
});

describe('onRequestPost', () => {
  it('devuelve 401 sin Authorization header', async () => {
    const res = await onRequestPost({ request: new Request('https://x/api/stock-sync', { method: 'POST', body: '{}' }), env: ENV });
    expect(res.status).toBe(401);
  });

  it('marca agotado y pone Disponibles en 0 cuando disponibles es 0', async () => {
    const catalog = { Cat: { products: [{ id: 'a', cantidad: '1', agotado: false }] } };
    const fetchMock = mockFetch([
      authOk(),
      ...ghRead(catalog), // chequeo previo
      ...ghRead(catalog), // lectura de mutateCatalog
      new Response(JSON.stringify({ ok: true }), { status: 200 }) // PUT
    ]);

    const req = new Request('https://x/api/stock-sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok123', 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogo_id: 'a', catalogo_variante: null, disponibles: 0 })
    });
    const res = await onRequestPost({ request: req, env: ENV });
    const body = await res.json();

    expect(body).toEqual({ ok: true, agotado: true });
    // El lote del producto completo maneja tambien el "Disponibles" que ve el cliente.
    expect(catalogoEscrito(fetchMock).Cat.products[0]).toEqual({ id: 'a', cantidad: '0', agotado: true });
  });

  it('no escribe nada si el catalogo ya refleja el stock del lote', async () => {
    const catalog = { Cat: { products: [{ id: 'a', cantidad: '0', agotado: true }] } };
    const fetchMock = mockFetch([authOk(), ...ghRead(catalog)]);

    const req = new Request('https://x/api/stock-sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok123' },
      body: JSON.stringify({ catalogo_id: 'a', catalogo_variante: null, disponibles: 0 })
    });
    const res = await onRequestPost({ request: req, env: ENV });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, agotado: true, skipped: true });
    expect(huboPut(fetchMock)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3); // auth + los 2 GET del chequeo previo
  });

  it('actualiza Disponibles aunque la figura siga sin agotarse', async () => {
    const catalog = { Cat: { products: [{ id: 'a', cantidad: '3', agotado: false }] } };
    const fetchMock = mockFetch([
      authOk(),
      ...ghRead(catalog),
      ...ghRead(catalog),
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    ]);

    const req = new Request('https://x/api/stock-sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok123' },
      body: JSON.stringify({ catalogo_id: 'a', catalogo_variante: null, disponibles: 2 })
    });
    const res = await onRequestPost({ request: req, env: ENV });

    expect(await res.json()).toEqual({ ok: true, agotado: false });
    expect(catalogoEscrito(fetchMock).Cat.products[0]).toEqual({ id: 'a', cantidad: '2', agotado: false });
  });

  it('marca agotado_r en la variante regular sin tocar cantidad', async () => {
    const catalog = { Cat: { products: [{ id: 'a', cantidad: '3', agotado_r: false, agotado_d: false }] } };
    const fetchMock = mockFetch([
      authOk(),
      ...ghRead(catalog),
      ...ghRead(catalog),
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    ]);

    const req = new Request('https://x/api/stock-sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok123' },
      body: JSON.stringify({ catalogo_id: 'a', catalogo_variante: 'regular', disponibles: 0 })
    });
    await onRequestPost({ request: req, env: ENV });

    const written = catalogoEscrito(fetchMock);
    expect(written.Cat.products[0].agotado_r).toBe(true);
    expect(written.Cat.products[0].cantidad).toBe('3');
  });

  it('devuelve 500 si el producto no existe en el catalogo', async () => {
    const catalog = { Cat: { products: [] } };
    mockFetch([authOk(), ...ghRead(catalog), ...ghRead(catalog)]);

    const req = new Request('https://x/api/stock-sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok123' },
      body: JSON.stringify({ catalogo_id: 'no-existe', catalogo_variante: null, disponibles: 0 })
    });
    const res = await onRequestPost({ request: req, env: ENV });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Producto no encontrado/);
  });

  it('devuelve 400 si disponibles no es un número', async () => {
    mockFetch([authOk()]);

    const req = new Request('https://x/api/stock-sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok123' },
      body: JSON.stringify({ catalogo_id: 'a', catalogo_variante: null, disponibles: 'no-es-numero' })
    });
    const res = await onRequestPost({ request: req, env: ENV });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: 'disponibles debe ser un número' });
  });

  it('devuelve 400 si disponibles falta', async () => {
    mockFetch([authOk()]);

    const req = new Request('https://x/api/stock-sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok123' },
      body: JSON.stringify({ catalogo_id: 'a', catalogo_variante: null })
    });
    const res = await onRequestPost({ request: req, env: ENV });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: 'disponibles debe ser un número' });
  });

  it('devuelve 400 si disponibles es NaN', async () => {
    mockFetch([authOk()]);

    const req = new Request('https://x/api/stock-sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok123' },
      body: JSON.stringify({ catalogo_id: 'a', catalogo_variante: null, disponibles: NaN })
    });
    const res = await onRequestPost({ request: req, env: ENV });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: 'disponibles debe ser un número' });
  });
});
