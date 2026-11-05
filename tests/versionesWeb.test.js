import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// Saca una función suelta del script de la web pública (index_template.html) por nombre.
const html = readFileSync(new URL('../index_template.html', import.meta.url), 'utf-8');
function fn(nombre) {
  const i = html.indexOf('function ' + nombre + '(');
  if (i < 0) throw new Error('no está ' + nombre);
  let d = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) {
    if (html[k] === '{') d++;
    else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1);
  }
}
const contenidoVersion = new Function(fn('_contenidoVersion') + '; return _contenidoVersion;')();

const base = [{ t: 'notion-text', x: 'Linda.' }];
const p = { content: base, label_base: 'Regular', detalle_base: 'Base sencilla', variantes: [] };

describe('descripción de cada versión en la web', () => {
  it('la variante muestra su diferencia arriba de la descripción principal', () => {
    expect(contenidoVersion(p, { label: 'EX', detalle: 'Base escénica.' })).toEqual([{ t: 'notion-text', x: 'Versión EX: Base escénica.' }, ...base]);
  });
  it('la versión principal muestra su propia diferencia', () => {
    expect(contenidoVersion(p, null)).toEqual([{ t: 'notion-text', x: 'Versión Regular: Base sencilla.' }, ...base]);
  });
  it('una escala más grande sin diferencia usa la descripción principal tal cual', () => {
    expect(contenidoVersion(p, { label: '1:4' })).toEqual(base);
  });
  it('las variantes viejas con descripción completa propia la siguen mostrando', () => {
    const propia = [{ t: 'notion-text', x: 'Otra.' }];
    expect(contenidoVersion(p, { label: 'EX', content: propia })).toBe(propia);
    expect(contenidoVersion(p, { label: 'EX', desc: 'Texto' })).toEqual([{ t: 'notion-text', x: 'Texto' }]);
  });
});
