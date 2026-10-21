import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// Saca funciones sueltas del script de la web pública (index_template.html) por nombre.
const html = readFileSync(new URL('../index_template.html', import.meta.url), 'utf-8');
function fn(nombre) {
  const i = html.indexOf('function ' + nombre + '(');
  if (i < 0) throw new Error('no está ' + nombre);
  let d = 0, j = html.indexOf('{', i);
  for (let k = j; k < html.length; k++) {
    if (html[k] === '{') d++;
    else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1);
  }
}

const DATA = {
  'Entrega Inmediata': { products: [
    { id: 'e1', n: 'Captain Carter', marca: 'Hot Toys', disp: 'Entrega Inmediata' },
    { id: 'e2', n: 'Goku', marca: 'SH Figuarts', disp: 'Entrega Inmediata' },
  ] },
  'Hot Toys 1:6': { products: [
    { id: 'h1', n: 'Nicepool', marca: 'Hot Toys', disp: 'Entrega Inmediata' },
    { id: 'h2', n: 'Deadpool', marca: 'Hot Toys', disp: 'Pre Orden' },
  ] },
  'Estatuas Premium': { products: [{ id: 's1', n: 'Pikachu', marca: 'Sideshow', disp: 'Entrega Inmediata' }] },
  Adultos: { products: [{ id: 'a1', n: 'Adulta', marca: 'Hot Toys', disp: 'Entrega Inmediata' }] },
};
const CAT_KEYS = ['Entrega Inmediata', 'Hot Toys 1:6', 'Estatuas Premium'];
const productosDeCategoria = new Function('DATA', 'CAT_KEYS', fn('_productosDeCategoria') + '\nreturn _productosDeCategoria;')(DATA, CAT_KEYS);
const ids = cat => productosDeCategoria(cat).map(r => r.p.id);

describe('páginas de categoría', () => {
  it('Entrega Inmediata trae también las figuras en stock guardadas en otras categorías', () => {
    expect(ids('Entrega Inmediata')).toEqual(['e1', 'e2', 'h1', 's1']);
  });

  it('Hot Toys trae también las Hot Toys guardadas en Entrega Inmediata', () => {
    expect(ids('Hot Toys 1:6')).toEqual(['h1', 'h2', 'e1']);
  });

  it('cada figura conserva su categoría real (para badges y para abrirla)', () => {
    const r = productosDeCategoria('Entrega Inmediata').find(r => r.p.id === 'h1');
    expect(r.cat).toBe('Hot Toys 1:6');
  });

  it('las demás categorías no cambian', () => {
    expect(ids('Estatuas Premium')).toEqual(['s1']);
  });
});
