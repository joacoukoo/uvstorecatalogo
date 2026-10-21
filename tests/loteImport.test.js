import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { clavesDeFotos, claveDeOrigen, similitudNombre, marcarDuplicados, procesarCola, armarProducto } from '../lote-import.js';
import { leerListaBigCommerce } from '../functions/_lib/listas.js';

const FNC_FOTO = 'https://cdn11.bigcommerce.com/s-5s1ah0hhi7/images/stencil/1280x1280/products/3266/397615/x__52856.1783684099.jpg';
const helpers = { makeId: n => n.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-id', buildContent: t => (t ? [{ t: 'notion-text', x: t }] : []) };

describe('clavesDeFotos', () => {
  it('saca el id de producto de FNC aunque la foto tenga tamaño en la ruta', () => {
    expect(clavesDeFotos([FNC_FOTO])).toEqual(['fnc-img:3266']);
  });
  it('Shopify y Nonasea usan el nombre de archivo sin tamaño ni query', () => {
    expect(clavesDeFotos(['https://cdn.shopify.com/s/files/1/0216/7762/products/MAIN-IRONMAN-MK44_800x.jpg?v=1640971331']))
      .toEqual(['shopify-img:MAIN-IRONMAN-MK44.jpg']);
    expect(clavesDeFotos(['https://hexapus.oss-us-west-1.aliyuncs.com/upload-assets/iSPx1777215950164.jpg?x-oss-process=image']))
      .toEqual(['nonasea-img:iSPx1777215950164.jpg']);
  });
});

describe('claveDeOrigen', () => {
  it('da la misma clave que la lectura de lista', () => {
    const html = readFileSync(new URL('./fixtures/fnc-lista.html', import.meta.url), 'utf-8');
    const it0 = leerListaBigCommerce(html, 'https://www.fanaticanimestore.com/shop-all/pre-order/').items[0];
    expect(claveDeOrigen(it0.origen)).toBe(it0.clave);
    expect(claveDeOrigen('https://www.nonasea.com/api/customer/shop/product/32755')).toBe('nonasea:32755');
    expect(claveDeOrigen('https://statuecorp.com/products/02-mega-garchomp')).toBe('shopify:statuecorp.com:02-mega-garchomp');
  });
});

describe('marcarDuplicados', () => {
  const catalogo = {
    'Otras Figuras': { products: [
      { id: 'a', n: 'Vincent Valentine', marca: 'Joy Station', fotos: ['https://otra.com/x.jpg'] },
      { id: 'b', n: 'Superman', fotos: [FNC_FOTO] },
    ] },
  };
  it('marca "tenes" por foto del mismo producto, "quizas" por nombre y "nueva" el resto', () => {
    const items = [
      { clave: 'fnc:superman', nombre: 'Superman', foto: 'https://cdn11.bigcommerce.com/s-5s1ah0hhi7/images/stencil/500x659/products/3266/1/a.jpg' },
      { clave: 'fnc:vincent', nombre: '【PRE-ORDER】Joy Station FF7 RE Vincent Valentine', foto: '' },
      { clave: 'fnc:goku', nombre: '【PRE-ORDER】Tsume Goku Ultra Instinct', foto: '' },
    ];
    const r = marcarDuplicados(items, catalogo, []);
    expect(r.map(i => i.estado)).toEqual(['tenes', 'quizas', 'nueva']);
    expect(r.map(i => i.elegida)).toEqual([false, false, true]);
  });
  it('mismo personaje de otro estudio es figura nueva', () => {
    const cat = { X: { products: [{ id: 's', n: 'Ryomen Sukuna', marca: 'Tsume Art' }] } };
    const r = marcarDuplicados([{ clave: 'fnc:s', nombre: '【PRE-ORDER】Real World Studio 1:6 Ryomen Sukuna with LED', foto: '' }], cat, []);
    expect(r[0].estado).toBe('nueva');
  });
  it('marca "tenes" si ya está en pendientes o en el catálogo por origen', () => {
    const cat = { X: { products: [{ id: 'c', n: 'Kogenta', origen: 'https://statuecorp.com/products/kogenta' }] } };
    const r = marcarDuplicados([
      { clave: 'shopify:statuecorp.com:kogenta', nombre: 'Kogenta', foto: '' },
      { clave: 'nonasea:1', nombre: 'Algo', foto: '' },
    ], cat, [{ clave: 'nonasea:1' }]);
    expect(r.map(i => i.estado)).toEqual(['tenes', 'tenes']);
    expect(r.some(i => i.elegida)).toBe(false);
  });
});

describe('similitudNombre', () => {
  it('es la parte del nombre del catálogo que aparece en el de la tienda', () => {
    expect(similitudNombre('Joy Station FF7 RE Vincent Valentine', 'Vincent Valentine')).toBeGreaterThanOrEqual(0.8);
  });
  it('no confunde personajes que solo difieren en una letra', () => {
    expect(similitudNombre('Hot Toys - Kamen Rider - Kamen Rider W 1/6 Figure', 'Kamen Rider Amazon')).toBeLessThan(0.8);
  });
  it('ignora nombres del catálogo de una sola palabra', () => {
    expect(similitudNombre('Tsume Goku Ultra Instinct', 'Goku')).toBe(0);
  });
  it('es baja para figuras distintas', () => {
    expect(similitudNombre('Tsume Goku Ultra Instinct', 'Vincent Valentine')).toBeLessThan(0.8);
  });
});

describe('procesarCola', () => {
  it('sigue aunque una tarea falle y cuenta el avance', async () => {
    const avances = [];
    const tareas = [async () => 1, async () => { throw new Error('timeout'); }, async () => 3];
    const r = await procesarCola(tareas, 2, (hechas, total) => avances.push(`${hechas}/${total}`));
    expect(r).toEqual({ ok: 2, fallidas: [1] });
    expect(avances[avances.length - 1]).toBe('3/3');
  });
});

describe('armarProducto', () => {
  const extra = { nombre: 'Doflamingo 1/6 Statue', categoria: 'Estatuas Premium', franquicia: 'Anime', marca: 'Jimei Palace' };
  const base = { photos: ['https://f/1.jpg'], desc: 'Linda.', escala: '1:6', entrega: '2027 Q2', origen: 'https://o', variantes_ia: [] };

  it('calcula la reserva y entra como Pre-Orden', () => {
    const r = armarProducto(base, { base: '1500', variantes: [] }, extra, helpers);
    expect(r.category).toBe('Estatuas Premium');
    expect(r.product).toMatchObject({ n: 'Doflamingo 1/6 Statue', precio: '1500', reserva: '300', disp: 'Pre-Orden', estado: 'Nuevo', origen: 'https://o', entrega: '2027 Q2', marca: 'Jimei Palace', franquicia: 'Anime', i: 'https://f/1.jpg' });
    expect(r.product.content).toEqual([{ t: 'notion-text', x: 'Linda.' }]);
    expect(r.product.added_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('si la base no tiene precio, la primera variante con precio pasa a base', () => {
    const d = { ...base, variantes_ia: [{ label: '1:6', escala: '1:6' }, { label: '1:4', escala: '1:4' }] };
    const r = armarProducto(d, { base: '', variantes: ['2200'] }, extra, helpers);
    expect(r.product.precio).toBe('2200');
    expect(r.product.escala).toBe('1:4');
    expect(r.product.variantes).toBeUndefined();
  });
  it('varias escalas con precio van en variantes con label_base', () => {
    const d = { ...base, variantes_ia: [{ label: '1:6', escala: '1:6' }, { label: '1:4', escala: '1:4', fotos: ['https://f/4.jpg'] }] };
    const r = armarProducto(d, { base: '1800', variantes: ['2600'] }, extra, helpers);
    expect(r.product.label_base).toBe('1:6');
    expect(r.product.variantes).toEqual([{ label: '1:4', precio: '2600', reserva: '520', escala: '1:4', fotos: ['https://f/4.jpg', 'https://f/1.jpg'] }]);
  });
  it('Regular / Deluxe usa el sistema Deluxe', () => {
    const d = { ...base, variantes_ia: [{ label: 'Regular' }, { label: 'Deluxe', fotos: ['https://f/d.jpg'] }] };
    const r = armarProducto(d, { base: '1800', variantes: ['2100'] }, extra, helpers);
    expect(r.product).toMatchObject({ precio: '1800', precio_d: '2100', reserva_d: '420', fotos_d: ['https://f/d.jpg', 'https://f/1.jpg'] });
    expect(r.product.variantes).toBeUndefined();
  });
  it('cada versión muestra arriba de la descripción qué trae', () => {
    const d = { ...base, variantes_ia: [
      { label: 'Simple', detalle: 'Sin alas, base octagonal' },
      { label: 'Regular', detalle: 'Con alas, base octagonal' },
      { label: 'EX', detalle: 'Con alas y base escénica' },
    ] };
    const r = armarProducto(d, { base: '2800', variantes: ['3200', '4000'] }, extra, helpers);
    expect(r.product.content).toEqual([{ t: 'notion-text', x: 'Versión Simple: Sin alas, base octagonal.' }, { t: 'notion-text', x: 'Linda.' }]);
    expect(r.product.variantes.map(v => v.content[0].x)).toEqual(['Versión Regular: Con alas, base octagonal.', 'Versión EX: Con alas y base escénica.']);
    expect(r.product.variantes[1].content[1]).toEqual({ t: 'notion-text', x: 'Linda.' });
  });
  it('en Regular / Deluxe la Deluxe tiene su propia descripción con lo que trae', () => {
    const d = { ...base, variantes_ia: [{ label: 'Regular', detalle: 'Figura y base' }, { label: 'Deluxe', detalle: 'Agrega cabeza extra' }] };
    const r = armarProducto(d, { base: '1800', variantes: ['2100'] }, extra, helpers);
    expect(r.product.content[0].x).toBe('Versión Regular: Figura y base.');
    expect(r.product.content_d[0].x).toBe('Versión Deluxe: Agrega cabeza extra.');
  });
  it('la foto de cada versión va primero pero no tapa la galería', () => {
    const d = { ...base, photos: ['https://f/1.jpg', 'https://f/2.jpg', 'https://f/r.jpg'], variantes_ia: [
      { label: 'Regular', fotos: ['https://f/r.jpg'] }, { label: 'Base extendida', fotos: ['https://f/x.jpg'] },
    ] };
    const r = armarProducto(d, { base: '11500', variantes: ['13900'] }, extra, helpers);
    expect(r.product.fotos).toEqual(['https://f/r.jpg', 'https://f/1.jpg', 'https://f/2.jpg']);
    expect(r.product.i).toBe('https://f/r.jpg');
    expect(r.product.variantes[0].fotos).toEqual(['https://f/x.jpg', 'https://f/1.jpg', 'https://f/2.jpg', 'https://f/r.jpg']);
  });
  it('como mucho 10 fotos por versión', () => {
    const gal = Array.from({ length: 12 }, (_, k) => 'https://f/g' + k + '.jpg');
    const d = { ...base, photos: gal, variantes_ia: [{ label: 'A', fotos: ['https://f/a.jpg'] }, { label: 'B', fotos: ['https://f/b.jpg'] }] };
    const r = armarProducto(d, { base: '100', variantes: ['200'] }, extra, helpers);
    expect(r.product.fotos).toHaveLength(10);
    expect(r.product.fotos[0]).toBe('https://f/a.jpg');
    expect(r.product.variantes[0].fotos).toHaveLength(10);
  });
  it('sin ningún precio no arma nada', () => {
    expect(armarProducto(base, { base: '', variantes: [] }, extra, helpers)).toBeNull();
  });
});
