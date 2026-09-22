import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestGet, onRequestPost, verifySupabaseSession } from '../functions/api/stock-sync.js';

function b64(str) { return Buffer.from(str, 'utf-8').toString('base64'); }
const ENV = { GITHUB_TOKEN: 'gh', GITHUB_REPO: 'o/r' };

afterEach(() => { vi.unstubAllGlobals(); });

describe('verifySupabaseSession', () => {
  it('devuelve false sin token', async () => {
    expect(await verifySupabaseSession(null)).toBe(false);
  });
  it('devuelve true si Supabase responde ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 })));
    expect(await verifySupabaseSession('tok123')).toBe(true);
  });
  it('devuelve false si Supabase rechaza el token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}', { status: 401 })));
    expect(await verifySupabaseSession('tok-malo')).toBe(false);
  });
});

describe('onRequestGet', () => {
  it('devuelve 401 sin Authorization header', async () => {
    const res = await onRequestGet({ request: new Request('https://x/api/stock-sync'), env: ENV });
    expect(res.status).toBe(401);
  });

  it('devuelve la lista liviana del catalogo con sesion valida', async () => {
    const catalog = { Cat: { products: [{ id: 'a', n: 'Figura', marca: 'M', cantidad: '2', agotado: false }] } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'f1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

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

  it('marca agotado y actualiza cantidad cuando disponibles es 0', async () => {
    const catalog = { Cat: { products: [{ id: 'a', cantidad: '1', agotado: false }] } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'f1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('https://x/api/stock-sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok123', 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogo_id: 'a', catalogo_variante: null, disponibles: 0 })
    });
    const res = await onRequestPost({ request: req, env: ENV });
    const body = await res.json();

    expect(body).toEqual({ ok: true, agotado: true });
    const writeBody = JSON.parse(fetchMock.mock.calls[3][1].body);
    const written = JSON.parse(Buffer.from(writeBody.content, 'base64').toString('utf-8'));
    expect(written.Cat.products[0]).toEqual({ id: 'a', cantidad: '0', agotado: true });
  });

  it('marca agotado_r en la variante regular sin tocar cantidad', async () => {
    const catalog = { Cat: { products: [{ id: 'a', cantidad: '3', agotado_r: false, agotado_d: false }] } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'f1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('https://x/api/stock-sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok123' },
      body: JSON.stringify({ catalogo_id: 'a', catalogo_variante: 'regular', disponibles: 0 })
    });
    await onRequestPost({ request: req, env: ENV });

    const writeBody = JSON.parse(fetchMock.mock.calls[3][1].body);
    const written = JSON.parse(Buffer.from(writeBody.content, 'base64').toString('utf-8'));
    expect(written.Cat.products[0].agotado_r).toBe(true);
    expect(written.Cat.products[0].cantidad).toBe('3');
  });

  it('devuelve 500 si el producto no existe en el catalogo', async () => {
    const catalog = { Cat: { products: [] } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'f1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('https://x/api/stock-sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok123' },
      body: JSON.stringify({ catalogo_id: 'no-existe', catalogo_variante: null, disponibles: 0 })
    });
    const res = await onRequestPost({ request: req, env: ENV });
    expect(res.status).toBe(500);
  });
});
