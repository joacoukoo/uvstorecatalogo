// Detecta productos de cartas coleccionables (TCG) por el nombre, para sugerir la categoría TCG.
// Solo mira el tipo de producto (booster, tin, ETB...), no el juego: "Pokémon" o "Mega" solos
// también son estatuas, y "Magic the Gathering" también son FigPins o YouTooz.
// Vive en la raíz para que el admin lo importe; functions/_lib/tcg.js lo re-exporta.

export const CATEGORIA_TCG = 'TCG';

const TCG = /\btcg\b|\bccg\b|trading\s*card|card\s*game|booster|\betb\b|elite\s*trainer|\bupc\b|premium\s*collection|poster\s*collection|\btins?\b|\blatas?\b|\bsobres?\b|secret\s*lair|\bbundles?\b|starter\s*deck|structure\s*deck|\bblister\b/i;

export function esTCG(nombre) {
  return TCG.test(String(nombre || ''));
}
