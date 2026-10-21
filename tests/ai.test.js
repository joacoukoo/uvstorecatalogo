import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestPost } from '../functions/api/ai.js';

// Qué imagen le llega a Anthropic según la foto que manda el admin.
async function imagenEnviada(image_url) {
  const f = vi.fn(async () => new Response(JSON.stringify({ content: [{ text: 'ok' }] })));
  vi.stubGlobal('fetch', f);
  const request = new Request('https://uvstore.shop/api/ai', { method: 'POST', body: JSON.stringify({ prompt: 'describí', image_url }) });
  const res = await onRequestPost({ env: { ANTHROPIC_API_KEY: 'k' }, request });
  expect(res.status).toBe(200);
  const content = JSON.parse(f.mock.calls[0][1].body).messages[0].content;
  return Array.isArray(content) ? content.find(c => c.type === 'image')?.source.url : null;
}

describe('/api/ai con fotos que no son https', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('foto https se manda tal cual', async () => {
    expect(await imagenEnviada('https://cdn.x/a.jpg')).toBe('https://cdn.x/a.jpg');
  });
  it('foto propia con ruta relativa se completa con el sitio', async () => {
    expect(await imagenEnviada('assets/vitrinas/uv3.png')).toBe('https://uvstore.shop/assets/vitrinas/uv3.png');
    expect(await imagenEnviada('/assets/vitrinas/uv3.png')).toBe('https://uvstore.shop/assets/vitrinas/uv3.png');
  });
  it('foto http pasa a https', async () => {
    expect(await imagenEnviada('http://img.staticdj.com/a.jpg')).toBe('https://img.staticdj.com/a.jpg');
  });
  it('si Anthropic no puede usar la foto, reintenta solo con el texto', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"Unable to download the file"}}', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: [{ text: 'sin foto' }] })));
    vi.stubGlobal('fetch', f);
    const request = new Request('https://uvstore.shop/api/ai', { method: 'POST', body: JSON.stringify({ prompt: 'p', image_url: 'https://sideshow.com/x.jpg' }) });
    const res = await onRequestPost({ env: { ANTHROPIC_API_KEY: 'k' }, request });
    expect((await res.json()).text).toBe('sin foto');
    expect(JSON.parse(f.mock.calls[1][1].body).messages[0].content).toBe('p');
  });
  it('foto que no es una dirección (data:, blob:) no se manda y se genera solo con el texto', async () => {
    expect(await imagenEnviada('data:image/png;base64,AAAA')).toBe(null);
    expect(await imagenEnviada('blob:https://uvstore.shop/123')).toBe(null);
  });
});
