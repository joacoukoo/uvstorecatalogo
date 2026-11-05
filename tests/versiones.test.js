import { describe, it, expect } from 'vitest';
import { aplicarVersiones } from '../versiones.js';

const fila = (o = {}) => ({ idx: -1, label: '', precio: '', reserva: '', escala: '', agotado: false, ...o });

describe('aplicarVersiones', () => {
  it('guarda precio, reserva y escala editados y conserva fotos/descripción de la variante', () => {
    const anteriores = [{ label: '1:4', precio: '8000', reserva: '1600', escala: '1:4', fotos: ['a.jpg'], content: [{ t: 'x' }] }];
    const p = { precio: '5800', variantes: anteriores };
    aplicarVersiones(p, anteriores, { label: '1:6', agotado: false },
      [fila({ idx: 0, label: '1:4', precio: '9600', reserva: '1920', escala: '1:4' })]);
    expect(p.label_base).toBe('1:6');
    expect(p.variantes).toEqual([{ label: '1:4', precio: '9600', reserva: '1920', escala: '1:4', fotos: ['a.jpg'], content: [{ t: 'x' }] }]);
  });

  it('calcula la reserva al 20% si quedó vacía', () => {
    const p = {};
    aplicarVersiones(p, [], { label: '1:6' }, [fila({ label: '1:4', precio: '9600' })]);
    expect(p.variantes[0].reserva).toBe('1920');
  });

  it('con versiones borra los campos Deluxe para que no salgan dos selectores', () => {
    const p = { precio_d: '9600', reserva_d: '1920', fotos_d: ['d.jpg'], content_d: [], agotado_d: true };
    aplicarVersiones(p, [], { label: '1:6' }, [fila({ label: '1:4', precio: '9600' })]);
    for (const k of ['precio_d', 'reserva_d', 'fotos_d', 'content_d', 'agotado_d']) expect(p).not.toHaveProperty(k);
  });

  it('ignora filas vacías y si no queda ninguna versión quita variantes y label_base', () => {
    const anteriores = [{ label: '1:4', precio: '8000' }];
    const p = { variantes: anteriores, label_base: '1:6' };
    aplicarVersiones(p, anteriores, { label: '1:6' }, [fila()]);
    expect(p).not.toHaveProperty('variantes');
    expect(p).not.toHaveProperty('label_base');
  });

  it('sin versiones no toca un Deluxe existente', () => {
    const p = { precio_d: '9600' };
    aplicarVersiones(p, [], { label: '' }, []);
    expect(p.precio_d).toBe('9600');
  });

  it('exige precio y nombre en cada versión', () => {
    expect(() => aplicarVersiones({}, [], { label: '1:6' }, [fila({ label: '1:4' })])).toThrow(/precio/);
    expect(() => aplicarVersiones({}, [], { label: '1:6' }, [fila({ precio: '9600' })])).toThrow(/nombre/);
  });

  it('agotadas por versión: base en agotado_r, variante en agotado, y todas agotadas => figura agotada', () => {
    const p = {};
    aplicarVersiones(p, [], { label: '1:6', agotado: true }, [fila({ label: '1:4', precio: '9600', agotado: false })]);
    expect(p.agotado_r).toBe(true);
    expect(p.variantes[0]).not.toHaveProperty('agotado');
    expect(p.agotado).toBeFalsy();
    aplicarVersiones(p, [], { label: '1:6', agotado: true }, [fila({ label: '1:4', precio: '9600', agotado: true })]);
    expect(p.variantes[0].agotado).toBe(true);
    expect(p.agotado).toBe(true);
  });
});
