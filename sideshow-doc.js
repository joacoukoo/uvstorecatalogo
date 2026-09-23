// sideshow-doc.js: lectura de documentos de Sideshow y decisiones de importación a lotes.
// Módulo puro (sin DOM ni red): lo usan sistema.html y los tests.

const ITEM_FACTURA = /^Item:\s*(\d{5,7})\b/;
const FIN_NOMBRE = /^(\*?Order Information\*?|Invoice (Date|ID):|Total:|Track shipment|Ships via|Comments:|\*?Tariff Offsets)/i;
const FILA_ITEM_PDF = /^(\d{5,7})\s+\d{3}\s+(\d+)\s+(\d+)\s+(\d+)\s+PC\b/;
const ERROR_SIN_ITEMS = 'No encontré figuras de Sideshow en este documento';
const ERROR_PDF_IMAGEN = 'Este PDF es una imagen; no lo puedo leer. Pegá el texto o subí el correo.';

function limpiar(s) {
  return s.replace(/\r/g, '').replace(/[\u00a0\u202f\t]/g, ' ');
}

function bytesAUtf8(bytes) {
  return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
}

function decodificarQP(s) {
  const sinCortes = s.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < sinCortes.length; i++) {
    const hex = sinCortes.slice(i + 1, i + 3);
    if (sinCortes[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...new TextEncoder().encode(sinCortes[i]));
    }
  }
  return bytesAUtf8(bytes);
}

// Devuelve el texto plano de un correo .eml (parte text/plain). Si no es MIME, lo devuelve igual.
export function extraerTextoEml(raw) {
  const lineas = raw.replace(/\r/g, '').split('\n');
  const ini = lineas.findIndex(l => /^Content-Type:\s*text\/plain/i.test(l));
  if (ini === -1) return raw;
  // Solo el separador declarado corta la parte: un reenvío trae "---------- Mensaje reenviado".
  const boundary = (raw.match(/boundary="?([^"\s;]+)"?/i) || [])[1];
  const esSeparador = l => boundary ? (l === '--' + boundary || l === '--' + boundary + '--') : false;
  let i = ini;
  let encoding = '';
  for (; i < lineas.length && lineas[i] !== ''; i++) {
    const m = lineas[i].match(/^Content-Transfer-Encoding:\s*(\S+)/i);
    if (m) encoding = m[1].toLowerCase();
  }
  const cuerpo = [];
  for (i++; i < lineas.length && !esSeparador(lineas[i]); i++) cuerpo.push(lineas[i]);
  const texto = cuerpo.join('\n').replace(/\n+$/, '');
  if (encoding === 'quoted-printable') return decodificarQP(texto);
  if (encoding === 'base64') return bytesAUtf8(Uint8Array.from(atob(texto.replace(/\s/g, '')), c => c.charCodeAt(0)));
  return texto;
}

function fechaISO(d, m, a) {
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function agregarItem(items, item) {
  const previo = items.find(i => i.codigo === item.codigo);
  if (previo) previo.cantidad += item.cantidad;
  else items.push(item);
}

// Factura con tracking ("Sideshow Tracking & Invoice"): unidades despachadas por figura.
export function leerFactura(texto) {
  const lineas = limpiar(texto).split('\n').map(l => l.trim());
  const todo = lineas.join('\n');
  const numero = (todo.match(/Invoice ID:\s*(\d+)/) || [])[1] || '';
  const f = todo.match(/Invoice Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const items = [];
  lineas.forEach((linea, i) => {
    const m = linea.match(ITEM_FACTURA);
    if (!m) return;
    // El nombre son las líneas anteriores a "Item:" (entre asteriscos en el correo, sin ellos si se pegó).
    const partes = [];
    for (let j = i - 1; j >= 0 && j >= i - 8 && partes.length < 4; j--) {
      const previa = lineas[j];
      if (!previa) continue; // el correo real deja líneas en blanco entre el nombre e "Item:"
      if (FIN_NOMBRE.test(previa) || ITEM_FACTURA.test(previa) || /Qty:/.test(previa)) break;
      partes.unshift(previa);
      if (previa.startsWith('*')) break;
    }
    let cantidad = null;
    for (let j = i + 1; j < Math.min(lineas.length, i + 5); j++) {
      const q = lineas[j].match(/Qty:\s*(\d+)/);
      if (q) { cantidad = parseInt(q[1], 10); break; }
    }
    if (cantidad === null) return;
    const nombre = partes.join(' ').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    agregarItem(items, { codigo: m[1], nombre, cantidad });
  });
  return { tipo: 'factura', numero, fecha: f ? fechaISO(f[2], f[1], f[3]) : null, items };
}

// Agrupa los fragmentos de texto de pdf.js ({str, x, y}) en filas, de arriba hacia abajo.
export function agruparFilasPdf(items) {
  const utiles = items.filter(it => it.str && it.str.trim()).sort((a, b) => b.y - a.y);
  const filas = [];
  for (const it of utiles) {
    const fila = filas.find(f => Math.abs(f.y - it.y) <= 2);
    if (fila) fila.items.push(it);
    else filas.push({ y: it.y, items: [it] });
  }
  return filas.map(f => f.items.sort((a, b) => a.x - b.x).map(it => it.str.trim()).join(' '));
}

// Orden de venta ("Sales Order", PDF): unidades pedidas por figura.
export function leerOrdenVenta(filas) {
  const todo = filas.join('\n');
  const orden = (todo.match(/Order Number:\s*(\d+)/) || [])[1] || '';
  const cambio = (todo.match(/Change Order:\s*(\d+)/) || [])[1] || '0';
  const f = todo.match(/Order Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const items = [];
  filas.forEach((fila, i) => {
    const m = fila.match(FILA_ITEM_PDF);
    if (!m) return;
    const siguiente = filas[i + 1] || '';
    const nombre = FILA_ITEM_PDF.test(siguiente) || /^MISC\b/.test(siguiente) ? '' : siguiente.trim();
    const pedidas = parseInt(m[2], 10);
    agregarItem(items, { codigo: m[1], nombre, cantidad: pedidas, pedidas, enviadas: parseInt(m[3], 10), pendientes: parseInt(m[4], 10) });
  });
  return { tipo: 'orden_venta', numero: orden ? `${orden}-${cambio}` : '', fecha: f ? fechaISO(f[2], f[1], f[3]) : null, items };
}

// Reconoce el tipo de documento. `entrada`: texto (correo o pegado) o filas de un PDF.
export function detectarDocumento(entrada) {
  if (Array.isArray(entrada) && entrada.length === 0) throw new Error(ERROR_PDF_IMAGEN);
  const texto = Array.isArray(entrada) ? entrada.join('\n') : limpiar(entrada);
  let doc = null;
  if (/Invoice ID:/.test(texto)) doc = leerFactura(texto);
  else if (/Sales Order/.test(texto) && /Order Number:/.test(texto)) {
    doc = leerOrdenVenta(Array.isArray(entrada) ? entrada : texto.split('\n').map(l => l.trim()));
  }
  if (!doc || !doc.items.length) throw new Error(ERROR_SIN_ITEMS);
  return doc;
}

// ── Decisiones por figura ─────────────────────────────────────────────

export function nombreCorto(nombre) {
  return nombre.split(' - ')[0].trim();
}

export function marcaDeNombre(nombre) {
  const todos = [...nombre.matchAll(/\(([^()]+)\)/g)];
  return todos.length ? todos[todos.length - 1][1].trim() : '';
}

function tieneFoto(urls, codigo) {
  const marca = `product-images/${codigo}/`;
  return (urls || []).some(u => typeof u === 'string' && u.includes(marca));
}

function chocaConLote(lotes, productoId, variante) {
  return lotes.some(l => l.catalogo_id === productoId &&
    (!l.catalogo_variante || !variante || l.catalogo_variante === variante));
}

// Busca la figura del catálogo cuyas fotos llevan el número de Sideshow (mismo criterio con el
// que se vincularon los lotes existentes). Descarta productos que ya tienen un lote en conflicto.
function figurasConCodigo(codigo, catalogo) {
  const res = [];
  for (const p of catalogo) {
    const enDeluxe = tieneFoto(p.fotos_d, codigo);
    const enRegular = tieneFoto([p.i, ...(p.fotos || [])], codigo);
    if (!enDeluxe && !enRegular) continue;
    res.push({ id: p.id, n: p.n, variante: p.precio_d ? (enDeluxe ? 'deluxe' : 'regular') : null });
  }
  return res;
}

export function buscarEnCatalogo(codigo, catalogo, lotes) {
  return figurasConCodigo(codigo, catalogo).find(f => !chocaConLote(lotes, f.id, f.variante)) || null;
}

// Lote que ya tiene la figura del catálogo con ese número de Sideshow, aunque su código sea
// otro (ej. un lote creado desde admin-app, con código generado).
function loteDeLaFigura(codigo, catalogo, lotes) {
  for (const f of figurasConCodigo(codigo, catalogo)) {
    const lote = lotes.find(l => l.catalogo_id === f.id && (l.catalogo_variante || null) === f.variante);
    if (lote) return lote;
  }
  return null;
}

const ETIQUETAS = {
  crear_vincular: c => `Crear lote y vincular a ${c.n}${c.variante ? ' (' + c.variante + ')' : ''}`,
  crear: () => 'Crear lote',
  ignorar: () => 'Ignorar',
  sumar: () => 'Sumar recibidas',
  faltan: () => 'Faltan, las completo por otro lado',
  bajar: (c, q) => `Bajar el lote a ${q}`,
  subir: (c, q) => `Subir el lote a ${q}`,
  dejar: () => 'Dejar la cantidad igual',
  sin_cambios: () => 'Sin cambios',
  ajustar: (c, q) => `Ajustar el lote a ${q}`
};

function opciones(valores, candidato, q) {
  return valores.map(v => ({ valor: v, etiqueta: ETIQUETAS[v](candidato, q) }));
}

// Una fila de revisión por figura del documento, con sus opciones y la opción por defecto.
export function proponerAcciones(doc, lotes, catalogo) {
  return doc.items.map(item => {
    const base = { tipo: doc.tipo, codigo: item.codigo, nombre: item.nombre, q: item.cantidad, lote: null, candidato: null };
    const lote = lotes.find(l => String(l.codigo) === item.codigo) || loteDeLaFigura(item.codigo, catalogo, lotes);
    if (!lote) {
      const candidato = buscarEnCatalogo(item.codigo, catalogo, lotes);
      const valores = candidato ? ['crear_vincular', 'crear', 'ignorar'] : ['crear', 'ignorar'];
      return { ...base, candidato, estado: 'nuevo', opciones: opciones(valores, candidato), accion: valores[0] };
    }
    if (doc.tipo === 'factura') {
      const r2 = (lote.recibidas || 0) + item.cantidad;
      if (r2 === lote.cantidad) return { ...base, lote, estado: 'ok', opciones: opciones(['sumar']), accion: 'sumar' };
      const valores = r2 < lote.cantidad ? ['faltan', 'bajar'] : ['subir', 'dejar'];
      return { ...base, lote, estado: 'diferencia', opciones: opciones(valores, null, r2), accion: valores[0] };
    }
    if (item.cantidad === lote.cantidad) return { ...base, lote, estado: 'ok', opciones: opciones(['sin_cambios']), accion: 'sin_cambios' };
    return { ...base, lote, estado: 'diferencia', opciones: opciones(['dejar', 'ajustar'], null, item.cantidad), accion: 'dejar' };
  });
}

function avisoFaltantes(nuevaCantidad, vendidas) {
  const faltan = (vendidas || 0) - nuevaCantidad;
  if (faltan <= 0) return null;
  return `Te faltaría${faltan === 1 ? '' : 'n'} ${faltan} figura${faltan === 1 ? '' : 's'} para clientes`;
}

// Qué cambia en la base al elegir `accion` para la fila. {} = nada.
export function efectoDeAccion(fila, accion) {
  if (accion === 'ignorar' || accion === 'sin_cambios') return {};
  if (accion === 'crear' || accion === 'crear_vincular') {
    const vincular = accion === 'crear_vincular' && fila.candidato;
    return { crear: {
      codigo: fila.codigo,
      producto: nombreCorto(fila.nombre) || fila.codigo,
      marca: fila.tipo === 'factura' ? marcaDeNombre(fila.nombre) : '',
      cantidad: fila.q,
      recibidas: fila.tipo === 'factura' ? fila.q : 0,
      proveedor: 'Sideshow',
      catalogo_id: vincular ? fila.candidato.id : null,
      catalogo_variante: vincular ? fila.candidato.variante : null
    } };
  }
  const lote = fila.lote;
  if (fila.tipo === 'factura') {
    const r2 = (lote.recibidas || 0) + fila.q;
    if (accion === 'bajar' || accion === 'subir') {
      const efecto = { update: { recibidas: r2, cantidad: r2 } };
      const aviso = avisoFaltantes(r2, lote.vendidas);
      return aviso ? { ...efecto, aviso } : efecto;
    }
    return { update: { recibidas: r2 } }; // sumar, faltan, dejar
  }
  if (accion === 'ajustar') {
    const aviso = avisoFaltantes(fila.q, lote.vendidas);
    return aviso ? { update: { cantidad: fila.q }, aviso } : { update: { cantidad: fila.q } };
  }
  return {}; // dejar (orden de venta)
}
