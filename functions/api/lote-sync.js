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

async function buscarLotePorCatalogoId(serviceKey, catalogoId) {
  const url = `${SUPABASE_URL}/rest/v1/lotes_pedido?catalogo_id=eq.${encodeURIComponent(catalogoId)}&catalogo_variante=is.null&select=id,cantidad`;
  const res = await fetch(url, { headers: headersServicio(serviceKey) });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows[0] || null;
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

export async function onRequestPost({ request, env }) {
  try {
    const { catalogo_id, producto, marca, escala, cantidad } = await request.json();
    if (!catalogo_id || !producto) {
      return new Response(JSON.stringify({ error: 'catalogo_id y producto son requeridos' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (typeof cantidad !== 'number' || !Number.isFinite(cantidad)) {
      return new Response(JSON.stringify({ error: 'cantidad debe ser un número' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const serviceKey = env.SUPABASE_SERVICE_KEY;
    const existente = await buscarLotePorCatalogoId(serviceKey, catalogo_id);

    let loteId;
    let cantidadLote;
    if (existente) {
      // El lote ya existe: su `cantidad` es la cantidad realmente pedida al proveedor y
      // manda sobre lo que muestre el formulario del admin (que puede traer un número viejo
      // o depletado). No se toca — el lote es la fuente de verdad a partir de acá.
      loteId = existente.id;
      cantidadLote = existente.cantidad;
    } else {
      const codigo = generarCodigoLote(producto, marca, await todosLosCodigos(serviceKey));
      const res = await fetch(`${SUPABASE_URL}/rest/v1/lotes_pedido`, {
        method: 'POST',
        headers: { ...headersServicio(serviceKey), Prefer: 'return=representation' },
        body: JSON.stringify({ producto, marca, escala, cantidad, codigo, catalogo_id, catalogo_variante: null })
      });
      if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
      const [creado] = await res.json();
      loteId = creado.id;
      cantidadLote = cantidad;
    }

    const activas = await contarOrdenesActivas(serviceKey, loteId);
    const disponibles = cantidadLote - activas;
    return new Response(JSON.stringify({ disponibles, agotado: disponibles <= 0 }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
