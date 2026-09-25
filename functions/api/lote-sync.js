import { readFile, mutateCatalog, findProducto, aplicarStock } from '../_lib/githubCatalog.js';

const SUPABASE_URL = 'https://rpaiizqttenkfbiqulng.supabase.co';

function limpiarCodigo(s) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase();
}

export function generarCodigoLote(producto, marca, codigosExistentes) {
  const prefijo = limpiarCodigo(producto).slice(0, 2) + limpiarCodigo(marca).slice(0, 2);
  const existentesSet = new Set(codigosExistentes.map(c => (c || '').toUpperCase()));
  let n = 1;
  let codigo;
  do {
    codigo = prefijo + String(n).padStart(2, '0');
    n++;
  } while (existentesSet.has(codigo));
  return codigo;
}

function headersServicio(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };
}

// Todos los lotes vinculados al producto: el del producto completo y/o los de sus variantes.
async function buscarLotesPorCatalogoId(serviceKey, catalogoId) {
  const url = `${SUPABASE_URL}/rest/v1/lotes_pedido?catalogo_id=eq.${encodeURIComponent(catalogoId)}&select=id,cantidad,catalogo_variante`;
  const res = await fetch(url, { headers: headersServicio(serviceKey) });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

async function actualizarCantidadLote(serviceKey, loteId, cantidad) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/lotes_pedido?id=eq.${loteId}`, {
    method: 'PATCH',
    headers: headersServicio(serviceKey),
    body: JSON.stringify({ cantidad })
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
}

async function contarOrdenesActivas(serviceKey, loteId) {
  const url = `${SUPABASE_URL}/rest/v1/ordenes?lote_id=eq.${loteId}&estado=neq.cancelada&select=id`;
  const res = await fetch(url, { headers: headersServicio(serviceKey) });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows.length;
}

async function todosLosCodigos(serviceKey) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/lotes_pedido?select=codigo`, { headers: headersServicio(serviceKey) });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows.map(r => r.codigo);
}

// Lo llama admin-app.html después de guardar un producto (alta o edición). El lote es la
// fuente de verdad del stock:
//  - Sin lote: solo si el admin marcó "Crear lote de stock" (`crear_lote`), el producto trae una
//    cantidad numérica y no es Deluxe, se crea su lote. Los productos que se suben "por si se
//    venden" (sin pedirlos) quedan sin lote y su cantidad es solo informativa.
//  - Con lote del producto completo y `cantidad_cambiada`: el admin corrigió "Disponibles" a
//    mano, así que se ajusta el lote para que le queden exactamente esas unidades
//    (cantidad del lote = disponibles pedidas + órdenes activas). Si el admin no tocó la
//    cantidad, se ignora: el formulario puede traer un número viejo.
//  - Siempre: se deja el producto del catálogo coherente con sus lotes (Agotado y Disponibles),
//    lo que también corrige un "Agotado" pisado por una edición con datos viejos.
export async function onRequestPost({ request, env }) {
  try {
    const { catalogo_id, producto, marca, escala, cantidad, cantidad_cambiada, precio_d, crear_lote } = await request.json();
    if (!catalogo_id || !producto) {
      return new Response(JSON.stringify({ error: 'catalogo_id y producto son requeridos' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const hayCantidad = cantidad !== null && cantidad !== undefined;
    if (hayCantidad && (typeof cantidad !== 'number' || !Number.isFinite(cantidad) || cantidad < 0)) {
      return new Response(JSON.stringify({ error: 'cantidad debe ser un número' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const serviceKey = env.SUPABASE_SERVICE_KEY;
    let lotes = await buscarLotesPorCatalogoId(serviceKey, catalogo_id);

    if (lotes.length === 0) {
      if (crear_lote !== true || precio_d || !hayCantidad) {
        return new Response(JSON.stringify({ sin_lote: true }), { headers: { 'Content-Type': 'application/json' } });
      }
      const codigo = generarCodigoLote(producto, marca, await todosLosCodigos(serviceKey));
      const res = await fetch(`${SUPABASE_URL}/rest/v1/lotes_pedido`, {
        method: 'POST',
        headers: { ...headersServicio(serviceKey), Prefer: 'return=representation' },
        body: JSON.stringify({ producto, marca, escala, cantidad, codigo, catalogo_id, catalogo_variante: null })
      });
      if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
      const [creado] = await res.json();
      lotes = [{ id: creado.id, cantidad, catalogo_variante: null }];
    }

    const stock = [];
    for (const lote of lotes) {
      const activas = await contarOrdenesActivas(serviceKey, lote.id);
      let cantidadLote = lote.cantidad;
      // Solo el lote del producto completo: el campo "Disponibles" es uno solo para ambas variantes.
      if (!lote.catalogo_variante && cantidad_cambiada && hayCantidad && cantidad + activas !== cantidadLote) {
        cantidadLote = cantidad + activas;
        await actualizarCantidadLote(serviceKey, lote.id, cantidadLote);
      }
      stock.push({ variante: lote.catalogo_variante || null, disponibles: cantidadLote - activas });
    }

    await reflejarEnCatalogo(env, catalogo_id, stock);

    const principal = stock.find(s => !s.variante) || stock[0];
    return new Response(JSON.stringify({ disponibles: principal.disponibles, agotado: principal.disponibles <= 0 }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// Lo usa admin-app.html al abrir un producto para saber si ya tiene lote (y no ofrecer crear otro).
export async function onRequestGet({ request, env }) {
  const catalogoId = new URL(request.url).searchParams.get('catalogo_id');
  if (!catalogoId) {
    return new Response(JSON.stringify({ error: 'catalogo_id es requerido' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const url = `${SUPABASE_URL}/rest/v1/lotes_pedido?catalogo_id=eq.${encodeURIComponent(catalogoId)}&select=codigo,catalogo_variante`;
    const res = await fetch(url, { headers: headersServicio(env.SUPABASE_SERVICE_KEY) });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    return new Response(JSON.stringify({ lotes: await res.json() }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// Escribe en productos.json solo si algo no coincide (evita commits y deploys de más).
async function reflejarEnCatalogo(env, catalogoId, stock) {
  const { catalog } = await readFile(env.GITHUB_TOKEN, env.GITHUB_REPO);
  const actual = findProducto(catalog, catalogoId);
  if (!actual) return;
  const copia = { ...actual };
  if (!stock.map(s => aplicarStock(copia, s.variante, s.disponibles)).some(Boolean)) return;
  await mutateCatalog(env.GITHUB_TOKEN, env.GITHUB_REPO, cat => {
    const p = findProducto(cat, catalogoId);
    if (p) stock.forEach(s => aplicarStock(p, s.variante, s.disponibles));
  }, { message: 'Sync stock — Admin' });
}
