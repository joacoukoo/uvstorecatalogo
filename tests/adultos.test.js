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

function elem(tag) {
  const e = { tag, children: [], clases: new Set(), style: {}, listeners: {}, textContent: '', innerHTML: '' };
  e.classList = { add: c => e.clases.add(c), remove: c => e.clases.delete(c), toggle: (c, v) => (v ?? !e.clases.has(c)) ? e.clases.add(c) : e.clases.delete(c), contains: c => e.clases.has(c) };
  Object.defineProperty(e, 'className', { get: () => [...e.clases].join(' '), set: v => { e.clases = new Set(String(v).split(/\s+/).filter(Boolean)); } });
  e.appendChild = c => (e.children.push(c), c);
  e.insertBefore = c => (e.children.unshift(c), c);
  e.addEventListener = (t, f) => { e.listeners[t] = f; };
  return e;
}

function entorno({ edadOk = false } = {}) {
  const store = edadOk ? { uv_age_ok: '1' } : {};
  const gate = elem('div');
  const abiertas = [];
  const ctx = {
    sessionStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    document: { createElement: elem, getElementById: id => (id === 'age-gate' ? gate : elem('div')), body: { style: {} }, querySelectorAll: () => [] },
    CAT_KEYS: ['Hot Toys 1:6', 'Estatuas Premium'],
    FRANCHISE_KEYS: ['Marvel', 'DC Comics', 'Star Wars', 'Anime', 'Gaming', 'Harry Potter', 'Otros', 'Adultos'],
    DATA: {
      'Hot Toys 1:6': { products: [{ id: 'd1', n: 'Draco Malfoy (Standard)', franquicia: 'Harry Potter' }] },
      'Estatuas Premium': { products: [{ id: 'd2', n: 'Draco Malfoy Female 1:4', franquicia: 'Harry Potter' }] },
      Adultos: { products: [{ id: 'a1', n: 'Draco Malfoy Female 1:6', franquicia: 'Harry Potter' }, { id: 'a2', n: 'Otra adulta', franquicia: 'Adultos' }] },
    },
    _norm: s => String(s).toLowerCase(),
    _prodSearchText: p => p.n.toLowerCase(),
    esc: s => s, fmtQ: s => s, _esAgotado: () => false,
    goFranchise: () => {},
    _abrir: (p, cat) => abiertas.push(p.id),
  };
  const codigo = ['_edadOk', '_buscarProductos', 'getFranchiseProducts', 'makeCard', '_pedirEdad', 'showAgeGate', 'ageGateConfirm', 'ageGateDeny']
    .map(fn).join('\n');
  const n = Object.keys(ctx);
  const api = new Function(...n, 'var _uvOpenedFromNav=false,_ageGateTarget=null;\n' + codigo +
    '\nreturn {_buscarProductos,getFranchiseProducts,makeCard,_pedirEdad,ageGateConfirm,ageGateDeny};')(...n.map(k => ctx[k]));
  return { api, gate, abiertas, store };
}
entorno.DATA = {
  'Hot Toys 1:6': { products: [{ id: 'd1', n: 'Draco' }] },
  'Estatuas Premium': { products: [{ id: 'd2', n: 'Draco 1:4' }] },
  Adultos: { products: [{ id: 'a1', n: 'Draco Female' }] },
};

describe('figuras de adultos en la web', () => {
  it('la búsqueda trae también las de adultos aunque no se haya confirmado la edad', () => {
    const { api } = entorno();
    expect(api._buscarProductos('malfoy').map(r => r.p.id)).toEqual(['d1', 'd2', 'a1']);
  });

  it('la franquicia incluye las figuras de adultos de esa franquicia', () => {
    const { api } = entorno();
    expect(api.getFranchiseProducts('Harry Potter').map(r => r.p.id)).toEqual(['d1', 'd2', 'a1']);
  });

  it('la tarjeta de adultos sale borrosa hasta confirmar la edad', () => {
    expect(entorno().api.makeCard({ id: 'a1', n: 'x' }, 'Adultos').classList.contains('prod-adult')).toBe(true);
    expect(entorno({ edadOk: true }).api.makeCard({ id: 'a1', n: 'x' }, 'Adultos').classList.contains('prod-adult')).toBe(false);
    expect(entorno().api.makeCard({ id: 'd1', n: 'x' }, 'Hot Toys 1:6').classList.contains('prod-adult')).toBe(false);
  });

  it('abrir una figura de adultos pide la edad y la abre recién al confirmar', () => {
    const E = entorno();
    const abrir = () => E.abiertas.push('a1');
    expect(E.api._pedirEdad('Adultos', abrir)).toBe(true);
    expect(E.gate.clases.has('open')).toBe(true);
    expect(E.abiertas).toEqual([]);
    E.api.ageGateConfirm();
    expect(E.abiertas).toEqual(['a1']);
    expect(E.store.uv_age_ok).toBe('1');
  });

  it('si dice que no, no se abre', () => {
    const E = entorno();
    E.api._pedirEdad('Adultos', () => E.abiertas.push('a1'));
    E.api.ageGateDeny();
    expect(E.abiertas).toEqual([]);
  });

  it('un link compartido encuentra también las figuras de adultos', () => {
    const buscar = new Function('DATA', 'CAT_KEYS', fn('_figuraPorId') + '\nreturn _figuraPorId;')(
      entorno.DATA, ['Hot Toys 1:6', 'Estatuas Premium']);
    expect(buscar('a1')).toEqual({ p: entorno.DATA.Adultos.products[0], cat: 'Adultos' });
    expect(buscar('d2').cat).toBe('Estatuas Premium');
    expect(buscar('nada')).toBe(null);
  });

  it('con la edad confirmada o fuera de Adultos no pide nada', () => {
    expect(entorno({ edadOk: true }).api._pedirEdad('Adultos', () => {})).toBe(false);
    expect(entorno().api._pedirEdad('Hot Toys 1:6', () => {})).toBe(false);
  });
});
