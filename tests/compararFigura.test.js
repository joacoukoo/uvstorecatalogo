import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestPost, fotoChica } from '../functions/api/comparar-figura.js';

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const req = body => new Request('https://uvstore.shop/api/comparar-figura', { method: 'POST', body: JSON.stringify(body) });
const BODY = {
  tienda: { nombre: 'Lark Studio - Resident Evil - Leon S. Kennedy 1/4 Statue', foto: 'https://hexapus.oss-us-west-1.aliyuncs.com/upload-assets/a.webp' },
  nuestras: [
    { id: 'otra', n: 'Leon', foto: 'https://cdn.shopify.com/s/files/x.jpg' },
    { id: 'leon-req', n: 'Leon Requiem Statue 1:4', foto: 'https://cdn11.bigcommerce.com/s-5s1ah0hhi7/images/stencil/1280x1280/products/20709/1/a.jpg' },
  ],
};

function stubFetch({ respuesta = '{"misma": 2}', fotoFalla = () => false } = {}) {
  const f = vi.fn(async (url, init) => {
    if (url.includes('api.anthropic.com')) return new Response(JSON.stringify({ content: [{ text: respuesta }] }));
    if (fotoFalla(url)) return new Response('no', { status: 403 });
    return new Response(JPG);
  });
  vi.stubGlobal('fetch', f);
  return f;
}

describe('/api/comparar-figura', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('devuelve el id de la nuestra que la IA dice que es la misma', async () => {
    const f = stubFetch();
    const res = await onRequestPost({ env: { ANTHROPIC_API_KEY: 'k' }, request: req(BODY) });
    expect(await res.json()).toEqual({ id: 'leon-req' });
    const content = JSON.parse(f.mock.calls.at(-1)[1].body).messages[0].content;
    expect(content.filter(c => c.type === 'image')).toHaveLength(3);
    expect(content[1].source).toMatchObject({ type: 'base64', media_type: 'image/jpeg' });
  });
  it('0 = ninguna', async () => {
    stubFetch({ respuesta: '{"misma": 0}' });
    const res = await onRequestPost({ env: { ANTHROPIC_API_KEY: 'k' }, request: req(BODY) });
    expect(await res.json()).toEqual({ id: null });
  });
  it('si una foto nuestra no baja, numera solo las que se mandaron', async () => {
    stubFetch({ respuesta: '{"misma": 1}', fotoFalla: u => u.includes('shopify') });
    const res = await onRequestPost({ env: { ANTHROPIC_API_KEY: 'k' }, request: req(BODY) });
    expect(await res.json()).toEqual({ id: 'leon-req' });
  });
  it('sin la foto de la tienda no decide', async () => {
    const f = stubFetch({ fotoFalla: u => u.includes('hexapus') });
    const res = await onRequestPost({ env: { ANTHROPIC_API_KEY: 'k' }, request: req(BODY) });
    expect(await res.json()).toMatchObject({ id: null, sinFoto: true });
    expect(f.mock.calls.some(c => c[0].includes('anthropic'))).toBe(false);
  });
});

describe('fotoChica', () => {
  it('pide la versión chica en cada CDN', () => {
    expect(fotoChica('https://hexapus.oss-us-west-1.aliyuncs.com/upload-assets/a.jfif?x=1'))
      .toBe('https://hexapus.oss-us-west-1.aliyuncs.com/upload-assets/a.jfif?x-oss-process=image/resize,m_lfit,w_500/format,jpg');
    expect(fotoChica('https://cdn11.bigcommerce.com/s-1/images/stencil/1280x1280/products/1/2/a.jpg'))
      .toBe('https://cdn11.bigcommerce.com/s-1/images/stencil/500x500/products/1/2/a.jpg');
    expect(fotoChica('https://www.sideshow.com/cdn-cgi/image/height=850,quality=90,f=auto/https://www.sideshow.com/storage/product-images/1/a.jpg'))
      .toBe('https://www.sideshow.com/cdn-cgi/image/width=500,quality=80,format=jpeg/https://www.sideshow.com/storage/product-images/1/a.jpg');
    expect(fotoChica('assets/x.png')).toBe('');
  });
});
