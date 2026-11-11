import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { onRequestPost, desdeNavegador } from '../functions/api/scrape.js';

afterEach(() => vi.unstubAllGlobals());

const PC_URL = 'https://www.pokemoncenter.com/en-ca/product/10-10449-122/pokemon-tcg-30th-celebration-tech-sticker-collection-lucario';
const datos = {
  url: PC_URL,
  name: 'Pokémon TCG: 30th Celebration Tech Sticker Collection (Lucario)',
  desc: 'Includes 3 booster packs and a Lucario sticker.',
  texto: 'Pokémon TCG: 30th Celebration Tech Sticker Collection (Lucario)\nCA$19.99\nDetails...',
  price: '19.99',
  photos: ['https://www.pokemoncenter.com/images/DAMRoot/High/10000/P1.jpg', 'javascript:alert(1)', 'http://inseguro/x.jpg'],
};

describe('desdeNavegador', () => {
  it('se queda con texto y fotos https', () => {
    const r = desdeNavegador(datos);
    expect(r.name).toBe(datos.name);
    expect(r.photos).toEqual(['https://www.pokemoncenter.com/images/DAMRoot/High/10000/P1.jpg']);
    expect(r.provider).toBe('navegador');
    expect(r.texto_pagina).toContain('CA$19.99');
  });
  it('sin nombre falla con un mensaje claro', () => {
    expect(() => desdeNavegador({ photos: [] })).toThrow('nombre');
  });
});

describe('POST /api/scrape con datos del navegador', () => {
  it('no va a buscar la página de la tienda y le pasa el texto a la IA', async () => {
    const ia = { desc: 'Colección de cartas.', nombre: 'Lucario Tech Sticker Collection', marca: 'The Pokémon Company', categoria: 'TCG' };
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ text: JSON.stringify(ia) }] })));
    vi.stubGlobal('fetch', f);
    const res = await onRequestPost({ env: { ANTHROPIC_API_KEY: 'k' }, request: new Request('https://x/api/scrape', { method: 'POST', body: JSON.stringify({ url: PC_URL, datos }) }) });
    const r = await res.json();
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toContain('api.anthropic.com');
    expect(JSON.stringify(JSON.parse(f.mock.calls[0][1].body).messages)).toContain('CA$19.99');
    expect(r.origen).toBe(PC_URL);
    expect(r.nombre_limpio).toBe('Lucario Tech Sticker Collection');
    expect(r.photos).toHaveLength(1);
    expect(r.texto_pagina).toBeUndefined();
  });
});

// El código del favorito vive en admin-app.html: se lo saca de ahí y se lo corre con una página falsa.
function codigoFavorito() {
  const html = readFileSync(new URL('../admin-app.html', import.meta.url), 'utf-8');
  const m = html.match(/function _enviarAUVStore\(\)\{[\s\S]*?\n\}/);
  return m[0];
}

describe('favorito "Enviar a UV Store"', () => {
  it('no tiene comentarios de línea (rompen el link javascript:)', () => {
    expect(codigoFavorito().split('\n').some(l => /(^|[^:])\/\//.test(l))).toBe(false);
  });

  it('lee la ficha de la página y abre el admin con los datos', () => {
    const ld = { '@context': 'https://schema.org', '@type': 'Product', name: 'Lucario Tech Sticker Collection',
      description: 'Includes booster packs.', brand: { name: 'Pokémon' },
      image: ['https://www.pokemoncenter.com/images/a.jpg', 'https://www.pokemoncenter.com/images/b.jpg'],
      offers: { price: 19.99 } };
    const metas = { 'og:image': 'https://www.pokemoncenter.com/images/a.jpg' };
    const document = {
      title: 'Pokémon Center',
      querySelectorAll: () => [{ textContent: JSON.stringify(ld) }],
      querySelector: sel => {
        if (sel === 'main') return { innerText: 'Lucario Tech Sticker Collection\nCA$19.99' };
        const n = (sel.match(/"([^"]+)"/) || [])[1];
        return metas[n] ? { content: metas[n] } : null;
      },
      images: [
        { naturalWidth: 1000, naturalHeight: 1000, currentSrc: 'https://www.pokemoncenter.com/images/c.jpg' },
        { naturalWidth: 40, naturalHeight: 40, currentSrc: 'https://www.pokemoncenter.com/icono.png' },
      ],
      body: { innerText: '' },
    };
    const open = vi.fn();
    const location = { href: PC_URL + '#reviews' };
    new Function('document', 'window', 'location', 'URL', '(' + codigoFavorito() + ')()')(document, { open }, location, URL);

    const [destino, ventana] = open.mock.calls[0];
    expect(ventana).toBe('_blank');
    expect(destino.startsWith('https://uvstore.shop/admin#importar=')).toBe(true);
    const d = JSON.parse(decodeURIComponent(destino.split('#importar=')[1]));
    expect(d).toMatchObject({ url: PC_URL, name: 'Lucario Tech Sticker Collection', marca: 'Pokémon', price: '19.99',
      photos: ['https://www.pokemoncenter.com/images/a.jpg', 'https://www.pokemoncenter.com/images/b.jpg', 'https://www.pokemoncenter.com/images/c.jpg'] });
    expect(d.texto).toContain('CA$19.99');
  });
});

describe('Scrapear un link de Pokémon Center', () => {
  it('el admin lo reconoce como tienda que bloquea (con o sin www y región)', () => {
    const html = readFileSync(new URL('../admin-app.html', import.meta.url), 'utf-8');
    const src = html.match(/var BLOQUEAN_SCRAPEO=[\s\S]*?\n\}/)[0];
    const bloquea = new Function(src + '; return _bloqueaScrapeo;')();
    expect(bloquea(PC_URL)).toBe(true);
    expect(bloquea('https://pokemoncenter.com/product/x')).toBe(true);
    expect(bloquea('https://www.sideshow.com/collectibles/x-916285')).toBe(false);
    expect(bloquea('no es un link')).toBe(false);
  });
});
