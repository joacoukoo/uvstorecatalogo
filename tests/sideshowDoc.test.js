import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { extraerTextoEml, leerFactura, agruparFilasPdf, leerOrdenVenta, detectarDocumento } from '../sideshow-doc.js';

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
  it('suma cantidades si el mismo codigo aparece dos veces', () => {
    const t = 'Invoice ID: 1\n*A (X)*\nItem: 111111\nOrder: 1\n$1.00 / Qty: 1\nTotal: $1\n*A (X)*\nItem: 111111\nOrder: 2\n$1.00 / Qty: 2\n';
    expect(leerFactura(t).items).toEqual([{ codigo: '111111', nombre: 'A (X)', cantidad: 3 }]);
  });
});

describe('extraerTextoEml', () => {
  it('decodifica quoted-printable y da lo mismo que el texto', () => {
    expect(leerFactura(extraerTextoEml(fx('sideshow-factura.eml')))).toEqual(leerFactura(fx('sideshow-factura.txt')));
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
