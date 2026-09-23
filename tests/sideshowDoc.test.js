import { describe, it, expect } from 'vitest';
import fs from 'fs';
import {
  extraerTextoEml, leerFactura, agruparFilasPdf, leerOrdenVenta, detectarDocumento,
  buscarEnCatalogo, proponerAcciones, efectoDeAccion, nombreCorto, marcaDeNombre
} from '../sideshow-doc.js';

const fx = f => fs.readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');

describe('leerFactura', () => {
  const doc = leerFactura(fx('sideshow-factura.txt'));
  it('lee numero, fecha y tipo', () => {
    expect(doc).toMatchObject({ tipo: 'factura', numero: '0005007540', fecha: '2026-09-11' });
  });
  it('lee las 21 figuras con codigo y cantidad', () => {
    expect(doc.items).toHaveLength(21);
    expect(doc.items[0]).toEqual({ codigo: '100519', nombre: 'Joel Miller Sixth Scale Figure - The Last of Us (Hot Toys)', cantidad: 2 });
  });
  it('lee codigos de 7 digitos y nombres en dos lineas', () => {
    const vader = doc.items.find(i => i.codigo === '9146252');
    expect(vader.cantidad).toBe(1);
    expect(vader.nombre).toBe('Darth Vader (Mustafar) (Artisan Edition) Sixth Scale Figure - Revenge of the Sith - Star Wars (Hot Toys)');
  });
  it('la seccion Tariff Offsets no genera items', () => {
    expect(new Set(doc.items.map(i => i.codigo)).size).toBe(21);
  });
  it('funciona con texto pegado desde la vista de Gmail (sin asteriscos)', () => {
    const pegado = 'Invoice Date: 09/11/2026\nInvoice ID: 0005007540\nBlade Sixth Scale Figure - Deadpool & Wolverine - Marvel (Hot Toys)\nItem: 913953\nOrder: 00332512\n$188.50 / Qty: 3\nShips via FedEx Ground\nTrack shipment\nTotal: $565.50\nVi Sixth Scale Figure - Arcane - Television Masterpiece Series - League of\nLegends (Hot Toys)\nItem: 914057\nOrder: 00332512\n$182.00 / Qty: 6\n';
    expect(leerFactura(pegado).items).toEqual([
      { codigo: '913953', nombre: 'Blade Sixth Scale Figure - Deadpool & Wolverine - Marvel (Hot Toys)', cantidad: 3 },
      { codigo: '914057', nombre: 'Vi Sixth Scale Figure - Arcane - Television Masterpiece Series - League of Legends (Hot Toys)', cantidad: 6 }
    ]);
  });
  it('lee el nombre aunque haya lineas en blanco antes de Item (formato real del correo)', () => {
    const t = 'Invoice ID: 0005007540\n\n*Joel Miller Sixth Scale Figure - The Last of Us (Hot Toys)*\n\nItem: 100519\nOrder: 00332512\n$185.25 / Qty: 2\n\nTotal: *$370.50*\n\n*Darth Vader (Mustafar) (Artisan Edition) Sixth Scale Figure - Revenge of\nthe Sith - Star Wars (Hot Toys)*\n\nItem: 9146252\nOrder: 1\n$1.00 / Qty: 1\n';
    expect(leerFactura(t).items.map(i => i.nombre)).toEqual([
      'Joel Miller Sixth Scale Figure - The Last of Us (Hot Toys)',
      'Darth Vader (Mustafar) (Artisan Edition) Sixth Scale Figure - Revenge of the Sith - Star Wars (Hot Toys)'
    ]);
  });
  it('suma cantidades si el mismo codigo aparece dos veces', () => {
    const t = 'Invoice ID: 1\n*A (X)*\nItem: 111111\nOrder: 1\n$1.00 / Qty: 1\nTotal: $1\n*A (X)*\nItem: 111111\nOrder: 2\n$1.00 / Qty: 2\n';
    expect(leerFactura(t).items).toEqual([{ codigo: '111111', nombre: 'A (X)', cantidad: 3 }]);
  });
});

describe('extraerTextoEml', () => {
  it('decodifica quoted-printable y da lo mismo que el texto', () => {
    expect(leerFactura(extraerTextoEml(fx('sideshow-factura.eml')))).toEqual(leerFactura(fx('sideshow-factura.txt')));
  });
  it('no corta en lineas que empiezan con "--" dentro del cuerpo (correo reenviado)', () => {
    const raw = 'Content-Type: multipart/alternative; boundary="000abc"\n\n--000abc\nContent-Type: text/plain; charset="UTF-8"\nContent-Transfer-Encoding: quoted-printable\n\n---------- Mensaje reenviado ---------\nInvoice ID: 7\n--000abc\nContent-Type: text/html\n\n<p>x</p>\n--000abc--\n';
    expect(extraerTextoEml(raw)).toBe('---------- Mensaje reenviado ---------\nInvoice ID: 7');
  });
  it('devuelve el texto tal cual si no es un correo MIME', () => {
    expect(extraerTextoEml('hola\nmundo')).toBe('hola\nmundo');
  });
  it('decodifica base64', () => {
    const b64 = Buffer.from('Invoice ID: 9 ñ', 'utf-8').toString('base64');
    const raw = 'Content-Type: multipart/mixed; boundary="B"\n\n--B\nContent-Type: text/plain; charset="UTF-8"\nContent-Transfer-Encoding: base64\n\n' + b64 + '\n--B--\n';
    expect(extraerTextoEml(raw)).toBe('Invoice ID: 9 ñ');
  });
});

describe('agruparFilasPdf', () => {
  it('agrupa por Y con tolerancia y ordena por X', () => {
    const filas = agruparFilasPdf([
      { str: 'B', x: 50, y: 100 }, { str: 'A', x: 10, y: 101 }, { str: ' ', x: 5, y: 100 },
      { str: 'C', x: 10, y: 80 }
    ]);
    expect(filas).toEqual(['A B', 'C']);
  });
});

describe('leerOrdenVenta', () => {
  const doc = leerOrdenVenta(JSON.parse(fx('sideshow-orden-filas.json')));
  it('lee numero con change order, fecha y tipo', () => {
    expect(doc).toMatchObject({ tipo: 'orden_venta', numero: '00328836-0', fecha: '2026-06-29' });
  });
  it('lee las 12 figuras y excluye MISC', () => {
    expect(doc.items).toHaveLength(12);
    expect(doc.items.some(i => i.codigo === 'MISC')).toBe(false);
    expect(doc.items[0]).toEqual({ codigo: '903739', nombre: 'Chewbacca w C3PO 1:6 SW (HT)', cantidad: 3, pedidas: 3, enviadas: 0, pendientes: 3 });
    expect(doc.items.find(i => i.codigo === '914528')).toMatchObject({ nombre: 'Stitch Collectible Figure (HOT TOYS)', pedidas: 7 });
    expect(doc.items.find(i => i.codigo === '915300')).toMatchObject({ nombre: 'Imperial Remnant AT-RT Driver 1:6 HT', pedidas: 1 });
  });
});

describe('detectarDocumento', () => {
  it('reconoce factura por texto', () => {
    expect(detectarDocumento(fx('sideshow-factura.txt')).tipo).toBe('factura');
  });
  it('reconoce orden de venta por filas', () => {
    expect(detectarDocumento(JSON.parse(fx('sideshow-orden-filas.json'))).tipo).toBe('orden_venta');
  });
  it('tira un error claro si no es de Sideshow', () => {
    expect(() => detectarDocumento('hola')).toThrow('No encontré figuras de Sideshow en este documento');
    expect(() => detectarDocumento('Invoice ID: 5\nnada')).toThrow('No encontré figuras de Sideshow en este documento');
  });
  it('tira un error claro si el PDF no tiene texto', () => {
    expect(() => detectarDocumento([])).toThrow('Este PDF es una imagen; no lo puedo leer. Pegá el texto o subí el correo.');
  });
});

// ── Decisiones por figura ─────────────────────────────────────────────
const IMG = c => `https://www.sideshow.com/storage/product-images/${c}/foto.jpg`;
const CAT = [
  { id: 'blade', n: 'Blade', i: IMG('913953'), fotos: [IMG('913953')] },
  { id: 'atrt', n: 'AT-RT Driver', precio_d: '6000', i: IMG('915300'), fotos: [IMG('915300')], fotos_d: [IMG('9153002')] },
  { id: 'nicepool', n: 'Nicepool', i: IMG('914072'), fotos: [] }
];
const lote = (o) => ({ id: 'L' + o.codigo, producto: 'x', recibidas: 0, vendidas: 0, catalogo_id: null, catalogo_variante: null, ...o });
const fac = items => ({ tipo: 'factura', numero: '1', fecha: null, items });
const ov = items => ({ tipo: 'orden_venta', numero: '1-0', fecha: null, items });

describe('nombreCorto / marcaDeNombre', () => {
  it('corta en el primer " - " y saca la marca del ultimo parentesis', () => {
    const n = 'Grand Admiral Thrawn (Imperial Armor) Sixth Scale Figure - Star Wars: Rebels (Hot Toys) EXCLUSIVE';
    expect(nombreCorto(n)).toBe('Grand Admiral Thrawn (Imperial Armor) Sixth Scale Figure');
    expect(marcaDeNombre(n)).toBe('Hot Toys');
    expect(marcaDeNombre('Sin marca')).toBe('');
  });
});

describe('buscarEnCatalogo', () => {
  it('encuentra por la foto y sin variante si no hay deluxe', () => {
    expect(buscarEnCatalogo('913953', CAT, [])).toEqual({ id: 'blade', n: 'Blade', variante: null });
  });
  it('elige regular o deluxe segun en que fotos aparece', () => {
    expect(buscarEnCatalogo('915300', CAT, [])).toMatchObject({ id: 'atrt', variante: 'regular' });
    expect(buscarEnCatalogo('9153002', CAT, [])).toMatchObject({ id: 'atrt', variante: 'deluxe' });
  });
  it('no confunde un codigo con otro que lo contiene', () => {
    expect(buscarEnCatalogo('915300', [{ id: 'x', n: 'X', i: IMG('9153002') }], [])).toBeNull();
  });
  it('descarta el producto si ya tiene un lote en conflicto', () => {
    expect(buscarEnCatalogo('913953', CAT, [lote({ codigo: 'OTRO', catalogo_id: 'blade' })])).toBeNull();
    expect(buscarEnCatalogo('9153002', CAT, [lote({ codigo: 'R', catalogo_id: 'atrt', catalogo_variante: 'regular' })])).toMatchObject({ variante: 'deluxe' });
  });
  it('null si no esta en el catalogo', () => {
    expect(buscarEnCatalogo('999999', CAT, [])).toBeNull();
  });
});

describe('proponerAcciones: factura', () => {
  it('sin lote y en el catalogo: crear y vincular por defecto', () => {
    const [f] = proponerAcciones(fac([{ codigo: '913953', nombre: 'Blade Sixth Scale Figure - Marvel (Hot Toys)', cantidad: 3 }]), [], CAT);
    expect(f).toMatchObject({ estado: 'nuevo', accion: 'crear_vincular', candidato: { id: 'blade' } });
    expect(f.opciones.map(o => o.valor)).toEqual(['crear_vincular', 'crear', 'ignorar']);
    expect(efectoDeAccion(f, 'crear_vincular')).toEqual({ crear: {
      codigo: '913953', producto: 'Blade Sixth Scale Figure', marca: 'Hot Toys', cantidad: 3, recibidas: 3,
      proveedor: 'Sideshow', catalogo_id: 'blade', catalogo_variante: null } });
    expect(efectoDeAccion(f, 'crear').crear).toMatchObject({ catalogo_id: null, catalogo_variante: null });
    expect(efectoDeAccion(f, 'ignorar')).toEqual({});
  });
  it('sin lote y fuera del catalogo: crear por defecto', () => {
    const [f] = proponerAcciones(fac([{ codigo: '999999', nombre: 'Algo (Marca)', cantidad: 1 }]), [], CAT);
    expect(f.accion).toBe('crear');
    expect(f.opciones.map(o => o.valor)).toEqual(['crear', 'ignorar']);
  });
  it('coincide: sumar recibidas', () => {
    const [f] = proponerAcciones(fac([{ codigo: '100519', nombre: 'J', cantidad: 2 }]), [lote({ codigo: '100519', cantidad: 2 })], CAT);
    expect(f).toMatchObject({ estado: 'ok', accion: 'sumar' });
    expect(efectoDeAccion(f, 'sumar')).toEqual({ update: { recibidas: 2 } });
  });
  it('vinieron menos: faltan por defecto, o bajar con aviso si quedan ventas sin cubrir', () => {
    const [f] = proponerAcciones(fac([{ codigo: '913848', nombre: 'S', cantidad: 2 }]), [lote({ codigo: '913848', cantidad: 3, vendidas: 3 })], CAT);
    expect(f).toMatchObject({ estado: 'diferencia', accion: 'faltan' });
    expect(f.opciones.map(o => o.valor)).toEqual(['faltan', 'bajar']);
    expect(efectoDeAccion(f, 'faltan')).toEqual({ update: { recibidas: 2 } });
    expect(efectoDeAccion(f, 'bajar')).toEqual({ update: { recibidas: 2, cantidad: 2 }, aviso: 'Te faltaría 1 figura para clientes' });
  });
  it('recibidas acumuladas de facturas anteriores', () => {
    const [f] = proponerAcciones(fac([{ codigo: '913848', nombre: 'S', cantidad: 1 }]), [lote({ codigo: '913848', cantidad: 3, recibidas: 2 })], CAT);
    expect(f).toMatchObject({ estado: 'ok', accion: 'sumar' });
    expect(efectoDeAccion(f, 'sumar')).toEqual({ update: { recibidas: 3 } });
  });
  it('vinieron mas: subir por defecto', () => {
    const [f] = proponerAcciones(fac([{ codigo: '1', nombre: 'S', cantidad: 4 }]), [lote({ codigo: '1', cantidad: 3 })], CAT);
    expect(f.accion).toBe('subir');
    expect(efectoDeAccion(f, 'subir')).toEqual({ update: { recibidas: 4, cantidad: 4 } });
    expect(efectoDeAccion(f, 'dejar')).toEqual({ update: { recibidas: 4 } });
  });
});

describe('proponerAcciones: orden de venta', () => {
  it('coincide: sin cambios', () => {
    const [f] = proponerAcciones(ov([{ codigo: '1', nombre: 'S', cantidad: 3, pedidas: 3 }]), [lote({ codigo: '1', cantidad: 3 })], CAT);
    expect(f).toMatchObject({ estado: 'ok', accion: 'sin_cambios' });
    expect(efectoDeAccion(f, 'sin_cambios')).toEqual({});
  });
  it('distinto: dejar igual por defecto; ajustar nunca toca recibidas', () => {
    const [f] = proponerAcciones(ov([{ codigo: '1', nombre: 'S', cantidad: 1, pedidas: 1 }]), [lote({ codigo: '1', cantidad: 3, vendidas: 2, recibidas: 3 })], CAT);
    expect(f).toMatchObject({ estado: 'diferencia', accion: 'dejar' });
    expect(efectoDeAccion(f, 'dejar')).toEqual({});
    expect(efectoDeAccion(f, 'ajustar')).toEqual({ update: { cantidad: 1 }, aviso: 'Te faltaría 1 figura para clientes' });
  });
  it('sin lote: crea con 0 recibidas y sin marca', () => {
    const [f] = proponerAcciones(ov([{ codigo: '999999', nombre: 'Carnage (Deluxe) 1:6 (HT)', cantidad: 1, pedidas: 1 }]), [], CAT);
    expect(efectoDeAccion(f, 'crear').crear).toMatchObject({ cantidad: 1, recibidas: 0, marca: '', producto: 'Carnage (Deluxe) 1:6 (HT)' });
  });
});
