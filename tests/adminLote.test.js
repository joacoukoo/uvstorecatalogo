import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import * as LoteImport from '../lote-import.js';

// Simulación mínima del DOM del admin: cada vez que se asigna innerHTML a un contenedor, los
// inputs/selects que trae se crean de nuevo con el value del HTML (como en el navegador).
const html = readFileSync(new URL('../admin-app.html', import.meta.url), 'utf-8');
const codigo = html.slice(html.indexOf('// ── TRAER EN LOTE ──'), html.indexOf('</script>', html.indexOf('// ── TRAER EN LOTE ──')));
const unesc = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function crearEntorno() {
  const els = {};
  const el = id => els[id] || (els[id] = mk(id));
  function mk(id) {
    const o = { id, value: '', textContent: '', style: {}, disabled: false, options: [], classList: { toggle() {} }, _html: '' };
    Object.defineProperty(o, 'innerHTML', {
      get() { return o._html; },
      set(v) {
        o._html = v;
        for (const m of v.matchAll(/<input[^>]*\bid="([^"]+)"[^>]*>/g)) {
          const val = m[0].match(/\bvalue="([^"]*)"/);
          els[m[1]] = mk(m[1]); els[m[1]].value = val ? unesc(val[1]) : '';
        }
        for (const m of v.matchAll(/<select[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
          const sel = m[2].match(/<option selected>([^<]*)</) || m[2].match(/<option[^>]*>([^<]*)</);
          els[m[1]] = mk(m[1]); els[m[1]].value = sel ? unesc(sel[1]) : '';
        }
      },
    });
    return o;
  }
  el('add-franquicia').options = [{ value: '' }, { value: 'Anime' }, { value: 'Marvel' }];
  const fetches = [];
  const ctx = {
    document: { getElementById: el },
    LoteImport,
    RESERVA_FACTOR: 0.2,
    _catalog: {}, _marcas: {},
    getField: id => (els[id] || {}).value || '',
    setField: (id, v) => { el(id).value = v || ''; },
    setStatus: () => {},
    resolverMarca: m => ({ marca: m, sugerencia: null }),
    cargarMarcas: async () => {},
    fetchFreshCatalog: async () => ({}),
    makeId: n => n.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    buildContent: t => (t ? [{ t: 'notion-text', x: t }] : []),
    confirm: () => true,
    fetch: vi.fn(async (url, opts = {}) => {
      fetches.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
      if (url === '/api/catalog') return new Response(JSON.stringify({ ok: true, agregadas: 1, omitidas: [] }));
      return new Response(JSON.stringify(url === '/api/pendientes' && !opts.method ? [] : { ok: true }));
    }),
  };
  const nombres = Object.keys(ctx);
  const api = new Function(...nombres, codigo.replace(/pendContar\(\);\s*$/, '') +
    '\nreturn {pendRender,pendPublicar,loteVer,get _pend(){return _pend},set _pend(v){_pend=v},get _lote(){return _lote},set _lote(v){_lote=v}};')(...nombres.map(k => ctx[k]));
  return { api, el, fetches, dibujado: id => id in els };
}

const fila = (id, nombre) => ({ id, clave: 'k' + id, origen: 'https://o/' + id, datos: { nombre_limpio: nombre, categoria: 'Otras Figuras', photos: [], variantes_ia: [] } });

describe('Pendientes en el admin', () => {
  let E;
  beforeEach(() => { E = crearEntorno(); });

  it('los precios escritos sobreviven a que la lista se redibuje', () => {
    E.api._pend = [fila('a', 'Goku'), fila('b', 'Vegeta')];
    E.api.pendRender();
    expect(E.dibujado('pend-p-a-0')).toBe(true);
    E.el('pend-p-a-0').value = '1500';
    E.api._pend = [fila('a', 'Goku')];
    E.api.pendRender();
    expect(E.el('pend-p-a-0').value).toBe('1500');
  });

  it('cada precio va con su figura aunque la lista cambie por detrás', async () => {
    E.api._pend = [fila('a', 'Goku'), fila('b', 'Vegeta')];
    E.api.pendRender();
    expect(E.dibujado('pend-p-b-0')).toBe(true);
    E.el('pend-p-b-0').value = '900';
    E.api._pend = [fila('b', 'Vegeta')];          // "a" se publicó desde otra pestaña
    await E.api.pendPublicar();
    const pub = E.fetches.find(f => f.url === '/api/catalog');
    expect(pub.body.items.map(i => [i.product.n, i.product.precio])).toEqual([['Vegeta', '900']]);
    expect(E.fetches.find(f => f.method === 'DELETE').body.ids).toEqual(['b']);
  });
});

describe('Pendientes muestra qué trae cada versión', () => {
  it('al lado del precio aparece el detalle de la versión', () => {
    const E = crearEntorno();
    const f = fila('a', 'Nico Robin');
    f.datos.variantes_ia = [{ label: 'Simple', detalle: 'Sin alas, base octagonal' }, { label: 'EX', detalle: 'Con alas y base escénica' }];
    E.api._pend = [f];
    E.api.pendRender();
    expect(E.el('pend-lista').innerHTML).toContain('Con alas y base escénica');
  });
});

describe('Lote en el admin', () => {
  it('no deja abrir otra página mientras está trayendo figuras', async () => {
    const E = crearEntorno();
    E.api._lote = { url: 'https://a', pagina: 1, siguiente: null, items: [{ clave: 'x' }], trayendo: true };
    E.el('lote-url').value = 'https://otra';
    await E.api.loteVer();
    expect(E.api._lote.url).toBe('https://a');
    expect(E.api._lote.items).toHaveLength(1);
  });
});
