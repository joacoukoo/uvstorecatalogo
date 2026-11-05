// Versiones de una figura (escalas 1:6/1:4, EX, etc.) como las arma el lote: la base es el producto
// mismo (precio, reserva, escala, fotos, descripción) y p.variantes trae solo las opciones extra.
// Es el otro sistema del Regular/Deluxe (precio_d): una figura usa uno u otro, nunca los dos,
// porque la web mostraría dos selectores con precios cruzados.

const RESERVA_FACTOR = 0.2;
const reserva = precio => String(Math.round(parseFloat(precio) * RESERVA_FACTOR));
const CAMPOS_DELUXE = ['precio_d', 'reserva_d', 'fotos_d', 'content_d', 'agotado_d'];
const limpiarDetalle = s => String(s || '').trim().replace(/[.\s]+$/, '');

// La descripción es una sola (p.content); cada opción guarda solo qué la diferencia (detalle_base,
// v.detalle) y la web lo muestra arriba. Las copias completas viejas (v.content) se reemplazan.
//
// p = producto a guardar (se modifica); anteriores = p.variantes antes de editar (de ahí salen las
// fotos de cada variante, que el formulario no edita); base = {label, agotado, detalle} de la opción
// principal; filas = lo que quedó en el formulario, {idx: posición en anteriores o -1 si es nueva,
// label, precio, reserva, escala, agotado, detalle}. Las filas sin nombre ni precio se descartan.
export function aplicarVersiones(p, anteriores, base, filas) {
  const vars = [];
  for (const f of filas) {
    const label = String(f.label || '').trim(), precio = String(f.precio || '').trim();
    if (!label && !precio) continue;
    if (!(parseFloat(precio) > 0)) throw new Error('Falta el precio de la versión ' + (label || 'sin nombre'));
    if (!label) throw new Error('Falta el nombre de la versión de Q' + precio);
    const v = { ...(anteriores[f.idx] || {}), label, precio, reserva: String(f.reserva || '').trim() || reserva(precio) };
    const escala = String(f.escala || '').trim();
    if (escala) v.escala = escala; else delete v.escala;
    if (f.agotado) v.agotado = true; else delete v.agotado;
    const detalle = limpiarDetalle(f.detalle);
    if (detalle) v.detalle = detalle; else delete v.detalle;
    delete v.content;
    delete v.desc;
    vars.push(v);
  }
  if (!vars.length) {
    delete p.variantes;
    delete p.label_base;
    delete p.detalle_base;
    return p;
  }
  p.variantes = vars;
  const lb = String(base.label || '').trim();
  if (lb) p.label_base = lb; else delete p.label_base;
  const detBase = limpiarDetalle(base.detalle);
  if (detBase) p.detalle_base = detBase; else delete p.detalle_base;
  p.agotado_r = !!base.agotado;
  for (const k of CAMPOS_DELUXE) delete p[k];
  if (p.agotado_r && vars.every(v => v.agotado)) p.agotado = true;
  return p;
}
