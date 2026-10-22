// Lógica de "Traer en lote" del admin (sin DOM, testeable): saber qué figuras ya tenemos,
// procesar la cola de scrapeos de a pocas, y armar el producto del catálogo con precios y variantes.
import { limpiarNombre } from './limpieza.js';
export { limpiarNombre };

const RESERVA_FACTOR = 0.2;

export function clavesDeFotos(urls) {
  const out = [];
  for (const u of urls || []) {
    const s = String(u || '');
    let m = s.match(/cdn\d*\.bigcommerce\.com\/s-5s1ah0hhi7\/.*?\/products\/(\d+)\//);
    if (m) { out.push('fnc-img:' + m[1]); continue; }
    const archivo = (s.split('?')[0].split('/').pop() || '').replace(/_\d+x\d*(?:@\d+x)?(\.\w+)$/, '$1');
    if (/cdn\.shopify\.com\//.test(s) && archivo) out.push('shopify-img:' + archivo);
    else if (/hexapus.*aliyuncs\.com\/upload-assets\//.test(s) && archivo) out.push('nonasea-img:' + archivo);
  }
  return out;
}

// Misma clave que arma functions/_lib/listas.js para cada ítem de lista.
export function claveDeOrigen(url) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'fanaticanimestore.com') return 'fnc:' + u.pathname.replace(/^\/|\/$/g, '');
  const nona = u.pathname.match(/\/api\/customer\/shop\/product\/(\d+)/);
  if (host === 'nonasea.com' && nona) return 'nonasea:' + nona[1];
  const prod = u.pathname.match(/\/products\/([^/?#]+)/);
  return prod ? `shopify:${host}:${prod[1]}` : '';
}

// Palabras que no dicen qué figura es: tipo, escala ("Sixth Scale Figure by Hot Toys" de Sideshow),
// estudio y lo que las tiendas le pegan al título ("Early bird", "Deposit").
const RELLENO = new Set(['statue', 'figure', 'figura', 'estatua', 'scale', 'escala', 'edition', 'version', 'ver',
  'the', 'of', 'de', 'la', 'el', 'and', 'y', 'with', 'by', 'sixth', 'quarter', 'half', 'bust', 'action',
  'studio', 'studios', 'early', 'bird', 'deposit', 'reserve', 'shipping', 'included']);
function tokens(s, sinMarca) {
  const marca = sinMarca ? new Set(tokens(sinMarca)) : null;
  return limpiarNombre(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b1\s*[:/]\s*\d+\b/g, ' ').split(/[^a-z0-9]+/).filter(t => t && !RELLENO.has(t) && !marca?.has(t));
}

// El personaje en un título "Marca - Obra - Personaje 1/6 Figure" (Nonasea) es el último tramo;
// sin guiones (FNC) es el título entero. Sin la marca de nuestra figura.
function tokensPersonaje(nombreTienda, marca) {
  const tramos = limpiarNombre(nombreTienda).split(/\s[-–—|]\s/).map(t => tokens(t, marca)).filter(t => t.length);
  return new Set(tramos.length ? tramos[tramos.length - 1] : []);
}

// Qué parte del nombre de nuestra figura (b) aparece en el de la tienda (a), de 0 a 1. El de la
// tienda trae de más (marca, obra, código); la marca de la nuestra no cuenta, si no dos Hot Toys
// distintas se parecerían. Nombres de una sola palabra ("Goku") no alcanzan para sospechar.
export function similitudNombre(a, b, marca) {
  const ta = new Set(tokens(a, marca)), tb = new Set(tokens(b, marca));
  if (tb.size < 2) return 0;
  let n = 0;
  for (const t of tb) if (ta.has(t)) n++;
  return n / tb.size;
}

// El personaje de la tienda es exactamente el nuestro: "Steve Rogers" = "Steve Rogers Sixth Scale
// Figure by Hot Toys", "Hulk" = "Hulk" (pero no "Red Hulk").
function mismoPersonaje(nombreTienda, nuestro, marca) {
  const tp = tokensPersonaje(nombreTienda, marca), tn = new Set(tokens(nuestro, marca));
  return tn.size > 0 && tp.size === tn.size && [...tn].every(t => tp.has(t));
}

// Al revés: el personaje de la tienda entra entero en nuestro nombre, que trae de más
// ("Le Malin" de Nonasea = "Cake Rabbit Le Malin" subida desde FNC). Solo con la misma marca.
function personajeDentro(nombreTienda, nuestro, marca) {
  const tp = tokensPersonaje(nombreTienda, marca), tn = new Set(tokens(nuestro, marca));
  return tp.size > 0 && [...tp].every(t => tn.has(t));
}

export function marcarDuplicados(items, catalogo, pendientes) {
  const claves = new Set((pendientes || []).map(p => p.clave));
  const fotos = new Set();
  const nombres = [];
  for (const cat in catalogo || {}) {
    for (const p of catalogo[cat].products || []) {
      if (p.origen) claves.add(claveDeOrigen(p.origen));
      clavesDeFotos([p.i, ...(p.fotos || [])]).forEach(k => fotos.add(k));
      nombres.push({ n: p.n || '', marca: p.marca || '' });
    }
  }
  for (const p of pendientes || []) nombres.push({ n: p.datos?.nombre_limpio || '', marca: p.datos?.marca || '' });
  // Mismo personaje de otro estudio es otra figura: si sabemos la marca, tiene que aparecer en el nombre.
  const mismaMarca = (nombreTienda, marca) => {
    const tm = tokens(marca).filter(t => !['studio', 'studios', 'toys', 'collectibles'].includes(t));
    if (!tm.length) return true;
    const tn = new Set(tokens(nombreTienda));
    return tm.some(t => tn.has(t));
  };
  // Por nombre: mismo personaje y marca = "tenes" (se puede marcar igual, por si es otra versión);
  // nombre muy parecido = "quizas". `coincide` dice con cuál de las nuestras.
  return items.map(it => {
    if (claves.has(it.clave) || clavesDeFotos([it.foto]).some(k => fotos.has(k))) return { ...it, estado: 'tenes', elegida: false };
    const candidatas = nombres.filter(x => x.n && mismaMarca(it.nombre, x.marca));
    const igual = candidatas.find(x => x.marca && mismoPersonaje(it.nombre, x.n, x.marca))
      || candidatas.find(x => !x.marca && mismoPersonaje(it.nombre, x.n));
    const seguro = igual && igual.marca;
    const parecida = igual || candidatas.find(x => similitudNombre(it.nombre, x.n, x.marca) >= 0.8)
      || candidatas.find(x => x.marca && personajeDentro(it.nombre, x.n, x.marca));
    const estado = seguro ? 'tenes' : parecida ? 'quizas' : 'nueva';
    return { ...it, estado, elegida: estado === 'nueva', ...(parecida ? { coincide: parecida.n, porNombre: true } : {}) };
  });
}

export async function procesarCola(tareas, paralelo = 2, onAvance = () => {}) {
  let siguiente = 0, hechas = 0, ok = 0;
  const fallidas = [];
  async function trabajador() {
    while (siguiente < tareas.length) {
      const i = siguiente++;
      try { await tareas[i](); ok++; onAvance(++hechas, tareas.length); }
      catch (e) { fallidas.push(i); onAvance(++hechas, tareas.length, e); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(paralelo, tareas.length) }, trabajador));
  return { ok, fallidas: fallidas.sort((a, b) => a - b) };
}

const reserva = precio => String(Math.round(parseFloat(precio) * RESERVA_FACTOR));

// datos = resultado de /api/scrape guardado en pendientes; precios = {base, variantes: [...]} (texto
// del input, '' = no se publica); extra = lo que el dueño ajustó en la fila.
export function armarProducto(datos, precios, extra, { makeId, buildContent }) {
  const fotosBase = datos.photos || [];
  const vars = datos.variantes_ia || [];
  const opciones = vars.length
    ? vars.map((v, i) => ({ ...v, precio: (i === 0 ? precios.base : precios.variantes?.[i - 1]) || '' }))
    : [{ label: '', escala: datos.escala, precio: precios.base || '' }];
  const conPrecio = opciones.filter(o => parseFloat(o.precio) > 0);
  if (!conPrecio.length) return null;

  const [b, ...resto] = conPrecio;
  // La foto propia de la versión va primero, seguida de la galería (sin repetir).
  const fotosDe = o => [...new Set([...(o.fotos || []), ...fotosBase])].slice(0, 10);
  // Arriba de la descripción, qué trae la versión elegida (la web la cambia al tocar el botón).
  const conVersion = o => [
    ...(o.detalle && o.label ? [{ t: 'notion-text', x: 'Versión ' + o.label + ': ' + o.detalle.replace(/[.\s]+$/, '') + '.' }] : []),
    ...buildContent(datos.desc || ''),
  ];
  const product = {
    id: makeId(extra.nombre || datos.nombre_limpio || 'figura'),
    n: extra.nombre || datos.nombre_limpio || '',
    i: fotosDe(b)[0] || '',
    fotos: fotosDe(b),
    franquicia: extra.franquicia || datos.franquicia || '',
    marca: extra.marca || datos.marca || '',
    escala: b.escala || datos.escala || '',
    disp: 'Pre-Orden',
    estado: 'Nuevo',
    precio: String(b.precio),
    reserva: reserva(b.precio),
    content: conVersion(b),
    destacado: false, oferta: false, agotado: false, agotado_r: false, agotado_d: false,
    added_at: new Date().toISOString().slice(0, 10),
    origen: datos.origen || '',
  };
  if (datos.entrega) product.entrega = datos.entrega;

  const esDeluxe = resto.length === 1 && vars.length === 2 && /deluxe|exclusive/i.test(resto[0].label);
  if (esDeluxe) {
    product.precio_d = String(resto[0].precio);
    product.reserva_d = reserva(resto[0].precio);
    if (resto[0].fotos?.length) product.fotos_d = fotosDe(resto[0]);
    if (resto[0].detalle) product.content_d = conVersion(resto[0]);
  } else if (resto.length) {
    product.label_base = b.label;
    product.variantes = resto.map(v => ({
      label: v.label, precio: String(v.precio), reserva: reserva(v.precio),
      ...(v.escala ? { escala: v.escala } : {}), ...(v.fotos?.length ? { fotos: fotosDe(v) } : {}),
      ...(v.detalle ? { content: conVersion(v) } : {}),
    }));
  }
  return { category: extra.categoria || datos.categoria || 'Otras Figuras', product };
}
