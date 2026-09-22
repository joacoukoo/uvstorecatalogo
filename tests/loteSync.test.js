import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestPost, generarCodigoLote } from '../functions/api/lote-sync.js';

const ENV = { SUPABASE_SERVICE_KEY: 'service-key' };

afterEach(() => { vi.unstubAllGlobals(); });

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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('[]', { status: 200 })) // buscar existente -> ninguno
      .mockResolvedValueOnce(new Response('[]', { status: 200 })) // todos los codigos -> ninguno
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'lote-1' }]), { status: 201 })) // insert
      .mockResolvedValueOnce(new Response('[]', { status: 200 })); // contar ordenes activas -> 0
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('https://x/api/lote-sync', {
      method: 'POST',
      body: JSON.stringify({ catalogo_id: 'a', producto: 'Jinx', marca: 'Hot Toys', escala: '1:6', cantidad: 3 })
    });
    const res = await onRequestPost({ request: req, env: ENV });
    const body = await res.json();

    expect(body).toEqual({ disponibles: 3, agotado: false });
    expect(fetchMock.mock.calls[2][1].method).toBe('POST');
    const insertBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(insertBody).toMatchObject({ producto: 'Jinx', marca: 'Hot Toys', catalogo_id: 'a', catalogo_variante: null, cantidad: 3 });
  });

  it('no toca un lote existente: calcula disponibles con la cantidad del lote, no la del request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'lote-1', cantidad: 5 }]), { status: 200 })) // buscar existente
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'o1' }, { id: 'o2' }]), { status: 200 })); // 2 ordenes activas
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('https://x/api/lote-sync', {
      method: 'POST',
      body: JSON.stringify({ catalogo_id: 'a', producto: 'Jinx', marca: 'Hot Toys', escala: '1:6', cantidad: 5 })
    });
    const res = await onRequestPost({ request: req, env: ENV });
    const body = await res.json();

    expect(body).toEqual({ disponibles: 3, agotado: false });
    expect(fetchMock.mock.calls.some(c => c[1] && c[1].method === 'PATCH')).toBe(false);
  });

  it('ignora la cantidad del request cuando el lote ya existe (no pisa la cantidad pedida)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'lote-1', cantidad: 3 }]), { status: 200 })) // lote real: 3
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'o1' }]), { status: 200 })); // 1 orden activa
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('https://x/api/lote-sync', {
      method: 'POST',
      body: JSON.stringify({ catalogo_id: 'a', producto: 'Jinx', marca: 'Hot Toys', escala: '1:6', cantidad: 99 })
    });
    const res = await onRequestPost({ request: req, env: ENV });
    const body = await res.json();

    // 3 (cantidad real del lote) - 1 activa = 2. Nada derivado de 99.
    expect(body).toEqual({ disponibles: 2, agotado: false });
    expect(fetchMock).toHaveBeenCalledTimes(2); // solo buscar lote + contar ordenes
    expect(fetchMock.mock.calls.some(c => c[1] && c[1].method === 'PATCH')).toBe(false);
  });

  it('devuelve 400 si falta un campo requerido', async () => {
    const req = new Request('https://x/api/lote-sync', { method: 'POST', body: JSON.stringify({ catalogo_id: 'a' }) });
    const res = await onRequestPost({ request: req, env: ENV });
    expect(res.status).toBe(400);
  });

  it('devuelve 400 si cantidad no es un número', async () => {
    const req = new Request('https://x/api/lote-sync', {
      method: 'POST',
      body: JSON.stringify({ catalogo_id: 'a', producto: 'Jinx', marca: 'Hot Toys', escala: '1:6', cantidad: 'no-es-numero' })
    });
    const res = await onRequestPost({ request: req, env: ENV });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: 'cantidad debe ser un número' });
  });

  it('devuelve 500 si Supabase retorna un error', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('[]', { status: 200 })) // buscar existente -> ninguno
      .mockResolvedValueOnce(new Response('[]', { status: 200 })) // todos los codigos -> ninguno
      .mockResolvedValueOnce(new Response('Error', { status: 500 })); // insert falla
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('https://x/api/lote-sync', {
      method: 'POST',
      body: JSON.stringify({ catalogo_id: 'a', producto: 'Jinx', marca: 'Hot Toys', escala: '1:6', cantidad: 3 })
    });
    const res = await onRequestPost({ request: req, env: ENV });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toHaveProperty('error');
  });
});
