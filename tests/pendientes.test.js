import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestGet, onRequestPost, onRequestDelete } from '../functions/api/pendientes.js';

const ENV = { SUPABASE_SERVICE_KEY: 'service-key' };
const BASE = 'https://rpaiizqttenkfbiqulng.supabase.co/rest/v1/figuras_pendientes';

afterEach(() => { vi.unstubAllGlobals(); });

const req = (method, body) => ({ env: ENV, request: new Request('https://x/api/pendientes', { method, body: body ? JSON.stringify(body) : undefined }) });

describe('/api/pendientes', () => {
  it('GET devuelve los pendientes más viejos primero', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify([{ id: 'a', clave: 'fnc:x' }])));
    vi.stubGlobal('fetch', f);
    const res = await onRequestGet(req('GET'));
    expect(await res.json()).toEqual([{ id: 'a', clave: 'fnc:x' }]);
    expect(f.mock.calls[0][0]).toBe(BASE + '?select=id,clave,origen,datos,creado_en&order=creado_en.asc');
    expect(f.mock.calls[0][1].headers.apikey).toBe('service-key');
  });

  it('POST guarda la figura y devuelve 201 con su id', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify([{ id: 'nuevo' }]), { status: 201 }));
    vi.stubGlobal('fetch', f);
    const res = await onRequestPost(req('POST', { clave: 'fnc:x', origen: 'https://o', datos: { n: 1 } }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'nuevo' });
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ clave: 'fnc:x', origen: 'https://o', datos: { n: 1 } });
    expect(f.mock.calls[0][1].headers.Prefer).toBe('return=representation');
  });

  it('POST de una clave repetida responde 409', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":"23505"}', { status: 409 })));
    const res = await onRequestPost(req('POST', { clave: 'fnc:x', origen: 'https://o', datos: {} }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Ya está en pendientes');
  });

  it('POST sin clave u origen responde 400', async () => {
    const res = await onRequestPost(req('POST', { datos: {} }));
    expect(res.status).toBe(400);
  });

  it('DELETE borra por ids', async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', f);
    const res = await onRequestDelete(req('DELETE', { ids: ['a', 'b'] }));
    expect(await res.json()).toEqual({ ok: true });
    expect(f.mock.calls[0][0]).toBe(BASE + '?id=in.(a,b)');
    expect(f.mock.calls[0][1].method).toBe('DELETE');
  });
});
