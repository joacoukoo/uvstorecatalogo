import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestPut } from '../functions/api/catalog.js';

const ENV = { GITHUB_TOKEN: 'gh', GITHUB_REPO: 'o/r' };
function b64(str) { return Buffer.from(str, 'utf-8').toString('base64'); }

afterEach(() => { vi.unstubAllGlobals(); });

function mockGitHub(catalog) {
  const puts = [];
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    if (url.includes('/commits/main')) return new Response(JSON.stringify({ sha: 'c1' }));
    if (url.includes('/contents/productos.json?ref=')) return new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'f1' }));
    if (url.includes('/contents/productos.json') && opts.method === 'PUT') {
      const body = JSON.parse(opts.body);
      puts.push({ message: body.message, catalog: JSON.parse(Buffer.from(body.content, 'base64').toString('utf-8')) });
      return new Response(JSON.stringify({ ok: true }));
    }
    throw new Error('fetch inesperado ' + url);
  }));
  return puts;
}

const req = body => ({ env: ENV, request: new Request('https://x/api/catalog', { method: 'PUT', body: JSON.stringify(body) }) });

describe('PUT /api/catalog add_many', () => {
  it('agrega varias figuras en un solo cambio, al principio de cada categoría', async () => {
    const puts = mockGitHub({ 'Otras Figuras': { products: [{ id: 'vieja' }] }, 'Estatuas Premium': { products: [] } });
    const res = await onRequestPut(req({ action: 'add_many', items: [
      { category: 'Otras Figuras', product: { id: 'n1' } },
      { category: 'Estatuas Premium', product: { id: 'n2' } },
    ] }));
    expect(await res.json()).toEqual({ ok: true, agregadas: 2, omitidas: [] });
    expect(puts).toHaveLength(1);
    expect(puts[0].message).toBe('Add batch — UV Store GT Admin');
    expect(puts[0].catalog['Otras Figuras'].products.map(p => p.id)).toEqual(['n1', 'vieja']);
    expect(puts[0].catalog['Estatuas Premium'].products.map(p => p.id)).toEqual(['n2']);
  });

  it('omite las que ya están publicadas (doble clic o publicada por otro)', async () => {
    const puts = mockGitHub({ 'Otras Figuras': { products: [{ id: 'n1' }] } });
    const res = await onRequestPut(req({ action: 'add_many', items: [
      { category: 'Otras Figuras', product: { id: 'n1' } },
      { category: 'Otras Figuras', product: { id: 'n2' } },
    ] }));
    expect(await res.json()).toEqual({ ok: true, agregadas: 1, omitidas: ['n1'] });
    expect(puts[0].catalog['Otras Figuras'].products.map(p => p.id)).toEqual(['n2', 'n1']);
  });

  it('omite una figura cuyo origen ya está publicado aunque traiga otro id', async () => {
    const puts = mockGitHub({ 'Otras Figuras': { products: [{ id: 'viejo-id', origen: 'https://statuecorp.com/products/kogenta' }] } });
    const res = await onRequestPut(req({ action: 'add_many', items: [
      { category: 'Otras Figuras', product: { id: 'nuevo-id', origen: 'https://statuecorp.com/products/kogenta' } },
    ] }));
    expect(await res.json()).toEqual({ ok: true, agregadas: 0, omitidas: ['nuevo-id'] });
    expect(puts[0].catalog['Otras Figuras'].products).toHaveLength(1);
  });

  it('sin items responde 400', async () => {
    mockGitHub({});
    expect((await onRequestPut(req({ action: 'add_many', items: [] }))).status).toBe(400);
  });

  it('una categoría que no existe responde 400 sin escribir', async () => {
    const puts = mockGitHub({ 'Otras Figuras': { products: [] } });
    const res = await onRequestPut(req({ action: 'add_many', items: [{ category: 'Inventada', product: { id: 'x' } }] }));
    expect(res.status).toBe(400);
    expect(puts).toHaveLength(0);
  });
});
