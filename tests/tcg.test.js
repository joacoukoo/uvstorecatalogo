import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { esTCG } from '../functions/_lib/tcg.js';

describe('esTCG', () => {
  it('reconoce productos de cartas', () => {
    [
      'Pokémon TCG: Prismatic Evolutions - Super Premium Collection (UPC)',
      'Pokémon TCG: Mega Forces Tin - Pack de 3',
      'Star Wars Unlimited: Spark of Rebellion: Booster Box',
      'One Piece Card Game OP-09 Booster Box',
      'Pokémon Surging Sparks Elite Trainer Box',
      'Yu-Gi-Oh! Structure Deck',
      'Lata Pokémon Mega Evolución',
      'Sobres One Piece',
    ].forEach(n => expect(esTCG(n), n).toBe(true));
  });

  it('no confunde estatuas de Pokémon ni figuras', () => {
    [
      'Pokemon EMO Studio Mega Rayquaza X Groudon X Kyogre Resin Statue - Kaioland',
      'Evolution of Mewtwo Mega X & Mega Y - Pokemon Resin Statue - EGGS Studios',
      'Pokemon Alain',
      'Tintin',
      'Vitrina Detolf',
      '',
    ].forEach(n => expect(esTCG(n), n).toBe(false));
  });

  it('en el catálogo no marca ninguna figura, estatua ni vitrina', () => {
    const data = JSON.parse(readFileSync(new URL('../productos.json', import.meta.url), 'utf-8'));
    const marcados = Object.entries(data).filter(([cat]) => cat !== 'TCG')
      .flatMap(([, c]) => c.products).filter(p => esTCG(p.n)).map(p => p.n);
    expect(marcados).toEqual([]);
  });
});
