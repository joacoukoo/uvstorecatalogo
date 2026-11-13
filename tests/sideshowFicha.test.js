import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { scrapeSideshow, extractSideshowSlideouts } from '../functions/_lib/scrapers.js';

// Fichas reales de Sideshow (nov. 2026) recortadas: la info está en paneles <dialog>
// "Description", "What's In The Box" y "Specs & Details" en vez de los acordeones viejos.
const fx = f => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf-8');
const URL_SUPERMAN = 'https://www.sideshow.com/collectibles/dc-comics-superman-absolute-iron-studios-915157';
const URL_WOLFFE = 'https://www.sideshow.com/collectibles/star-wars-clone-commander-wolffe-hot-toys-914065';

describe('scrapeSideshow — diseño con paneles laterales', () => {
  it('lee la descripción del panel Description', async () => {
    const r = await scrapeSideshow(URL_SUPERMAN, fx('sideshow-ficha-915157.html'));
    expect(r.desc).toContain('[About]');
    expect(r.desc).toContain('limited edition, highly detailed, and hand-painted');
  });

  it('lee materiales y medidas de Specs & Details y descarta SKU/UPC/límites', async () => {
    const r = await scrapeSideshow(URL_SUPERMAN, fx('sideshow-ficha-915157.html'));
    expect(r.desc).toContain('- Materials: Polystone');
    expect(r.desc).toContain('Height: 9.6" (24 cm)');
    expect(r.desc).toContain('- Edición: Limited Edition');
    expect(r.desc).not.toMatch(/UPC|Vendor ID|Purchase Limits|Shipping Weight/);
  });

  it('no mete textos de envío/devoluciones de Sideshow como Details', async () => {
    const r = await scrapeSideshow(URL_WOLFFE, fx('sideshow-ficha-914065.html'));
    expect(r.desc).not.toMatch(/double boxing|30 day guarantee|return policy/i);
  });

  it('toma la escala de la figura, no de los productos relacionados del pie', async () => {
    const superman = await scrapeSideshow(URL_SUPERMAN, fx('sideshow-ficha-915157.html'));
    expect(superman.escala).toBe('1:10');
    const wolffe = await scrapeSideshow(URL_WOLFFE, fx('sideshow-ficha-914065.html'));
    expect(wolffe.escala).toBe('1:6');
  });

  it("lee What's In The Box separando las listas anidadas y los subtítulos", () => {
    const { secciones } = extractSideshowSlideouts(fx('sideshow-ficha-914065.html'), '914065');
    const caja = secciones.find(s => s.label === "What's In The Box").text;
    expect(caja).toContain('- Seven (7) pieces of interchangeable gloved hands including:\n- One (1) pair of relaxed hands');
    expect(caja).toContain('Weapons:\n- One (1) blaster rifle');
  });
});
