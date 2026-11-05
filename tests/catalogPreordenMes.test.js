import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestPut } from '../functions/api/catalog.js';

const ENV = { GITHUB_TOKEN: 'gh', GITHUB_REPO: 'o/r' };
const b64 = str => Buffer.from(str, 'utf-8').toString('base64');

afterEach(() => { vi.unstubAllGlobals(); });

function mockGitHub(catalog) {
  const puts = [];
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    if (url.includes('/commits/main')) return new Response(JSON.stringify({ sha: 'c1' }));
    if (url.includes('/contents/productos.json?ref=')) return new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'f1' }));
    if (url.includes('/contents/productos.json') && opts.method === 'PUT') {
      puts.push(JSON.parse(Buffer.from(JSON.parse(opts.body).content, 'base64').toString('utf-8')));
      return new Response(JSON.stringify({ ok: true }));
    }
    throw new Error('fetch inesperado ' + url);
  }));
  return puts;
}

const req = body => ({ env: ENV, request: new Request('https://x/api/catalog', { method: 'PUT', body: JSON.stringify(body) }) });
const marcadas = cat => Object.values(cat).flatMap(c => c.products).filter(p => p.preorden_mes).map(p => p.id);

describe('Pre orden del mes', () => {
  it('al marcar una figura en editar se desmarca la anterior (la web muestra solo una)', async () => {
    const puts = mockGitHub({
      'Hot Toys 1:6': { products: [{ id: 'profx', preorden_mes: true }] },
      'Estatuas Premium': { products: [{ id: 'link' }] },
    });
    await onRequestPut(req({ action: 'edit', productId: 'link', product: { id: 'link', preorden_mes: true } }));
    expect(marcadas(puts[0])).toEqual(['link']);
  });

  it('al agregar una figura marcada también se desmarca la anterior', async () => {
    const puts = mockGitHub({ 'Hot Toys 1:6': { products: [{ id: 'profx', preorden_mes: true }] } });
    await onRequestPut(req({ action: 'add', category: 'Hot Toys 1:6', product: { id: 'nueva', preorden_mes: true } }));
    expect(marcadas(puts[0])).toEqual(['nueva']);
  });

  it('editar otra figura sin marcar no toca la del mes', async () => {
    const puts = mockGitHub({ 'Hot Toys 1:6': { products: [{ id: 'profx', preorden_mes: true }, { id: 'otra' }] } });
    await onRequestPut(req({ action: 'edit', productId: 'otra', product: { id: 'otra', n: 'x' } }));
    expect(marcadas(puts[0])).toEqual(['profx']);
  });
});
