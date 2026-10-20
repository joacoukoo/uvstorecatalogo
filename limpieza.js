// Limpieza de lo que viene de las tiendas: títulos sin nombres de tienda ni frases de venta,
// y opciones de producto que no son variantes (formas de pago, stock, email).
// Vive en la raíz para que el admin (navegador) lo importe; functions/_lib/limpieza.js lo re-exporta.

const TIENDAS = /fanatic\s*anime(?:\s*store)?|\bfnc\b|nonasea|hexapus(?:\s*acg)?|statue\s*corp/gi;
const FRASES = /pre-?\s*order|pre-?\s*sale|shipping\s*included|free\s*shipping|licen[sc]ed|\bwf\s*20\d\d\b|in\s*stock/gi;
const BASURA = /fanatic\s*anime|\bfnc\b|nonasea|hexapus|statue\s*corp|pre-?\s*order|【|】|\bship(?:ped|ping|s)?\b|licen[sc]ed|\bwf\s*20\d\d\b|in\s*stock|@|https?:\/\/|www\.|facebook|env[ií]o|deposit|payment|paypal/i;
const CONTACTO = /@|https?:\/\/|www\./i;

const ES_VENTA = new RegExp(FRASES.source + '|' + TIENDAS.source, 'i');

export function limpiarNombre(s) {
  return String(s || '')
    .replace(/【[^】]*】/g, ' ')
    // Paréntesis o corchetes que traen frases de venta: se van enteros
    .replace(/[(（\[][^)）\]]*[)）\]]/g, m => (ES_VENTA.test(m) ? ' ' : m))
    .replace(TIENDAS, ' ')
    .replace(FRASES, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—_|:·]+|[\s\-–—_|:·]+$/g, '')
    .trim();
}

export function tieneBasura(s) {
  return BASURA.test(String(s || ''));
}

// Quita las oraciones que mencionan tiendas, envíos o pagos. Una línea con email o link se va
// entera (partirla por puntos dejaría pedazos como "com").
export function sacarOracionesConBasura(texto) {
  return String(texto || '').split('\n').map(linea => CONTACTO.test(linea) ? '' :
    (linea.match(/[^.!?]+[.!?]*\s*/g) || [linea]).filter(o => !tieneBasura(o)).join('').trim()
  ).filter((l, i, arr) => l || (i > 0 && arr[i - 1])).join('\n').trim();
}

export function esTienda(s) {
  return new RegExp(TIENDAS.source, 'i').test(String(s || ''));
}

const OPCION_NO_VARIANTE = /payment|pago|stock|email|deposit/i;
const VALOR_NO_VARIANTE = /deposit|full\s*payment|payment\s*plan/i;

export function opcionesReales(opciones) {
  return (opciones || []).filter(o =>
    !OPCION_NO_VARIANTE.test(o.nombre || '') &&
    (o.valores || []).length > 1 &&
    !(o.valores || []).some(v => VALOR_NO_VARIANTE.test(v))
  );
}
