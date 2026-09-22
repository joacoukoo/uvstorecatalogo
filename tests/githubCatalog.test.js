import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFile, writeFile, mutateCatalog, findProducto } from '../functions/_lib/githubCatalog.js';

function b64(str) { return Buffer.from(str, 'utf-8').toString('base64'); }

afterEach(() => { vi.unstubAllGlobals(); });

describe('readFile', () => {
  it('lee el catalogo desde GitHub usando el sha del commit mas reciente', async () => {
    const catalog = { 'Entrega Inmediata': { products: [{ id: 'a', n: 'Figura A' }] } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'commitsha123' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'filesha456' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await readFile('tok', 'owner/repo');

    expect(result.catalog).toEqual(catalog);
    expect(result.sha).toBe('filesha456');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('ref=commitsha123');
  });

  it('lanza error si GitHub responde con status no-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('boom', { status: 500 })));
    await expect(readFile('tok', 'owner/repo')).rejects.toThrow('GitHub commits 500');
  });
});

describe('writeFile', () => {
  it('hace PUT con el contenido en base64 y el mensaje por defecto', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await writeFile('tok', 'owner/repo', { a: 1 }, 'sha1');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/contents/productos.json');
    expect(opts.method).toBe('PUT');
    const body = JSON.parse(opts.body);
    expect(body.sha).toBe('sha1');
    expect(body.message).toBe('Update catalog — UV Store GT Admin');
    expect(JSON.parse(Buffer.from(body.content, 'base64').toString('utf-8'))).toEqual({ a: 1 });
  });

  it('acepta un mensaje de commit custom', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await writeFile('tok', 'owner/repo', { a: 1 }, 'sha1', 'Sync stock — Sistema de Ordenes');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.message).toBe('Sync stock — Sistema de Ordenes');
  });

  it('lanza error con status adjunto si GitHub rechaza el PUT', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('conflict', { status: 409 })));
    await expect(writeFile('tok', 'owner/repo', {}, 'sha1')).rejects.toMatchObject({ status: 409 });
  });
});

describe('mutateCatalog', () => {
  it('lee, aplica la mutacion y escribe', async () => {
    const catalog = { Cat: { products: [{ id: 'a', cantidad: '1' }] } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'f1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await mutateCatalog('tok', 'owner/repo', c => { c.Cat.products[0].cantidad = '0'; });

    expect(result.Cat.products[0].cantidad).toBe('0');
    const writeBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(JSON.parse(Buffer.from(writeBody.content, 'base64').toString('utf-8')).Cat.products[0].cantidad).toBe('0');
  });

  it('reintenta ante conflicto 409 en el write', async () => {
    const catalog = { Cat: { products: [] } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'f1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('conflict', { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'f2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await mutateCatalog('tok', 'owner/repo', () => {});

    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});

describe('findProducto', () => {
  it('encuentra un producto por id en cualquier categoria', () => {
    const catalog = { A: { products: [{ id: 'x' }] }, B: { products: [{ id: 'y' }] } };
    expect(findProducto(catalog, 'y')).toEqual({ id: 'y' });
  });

  it('devuelve null si no existe', () => {
    expect(findProducto({ A: { products: [] } }, 'nope')).toBe(null);
  });
});
