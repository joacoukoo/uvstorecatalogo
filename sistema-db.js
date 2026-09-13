// sistema-db.js
const { createClient } = supabase;

const SUPABASE_URL = 'https://rpaiizqttenkfbiqulng.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwYWlpenF0dGVua2ZiaXF1bG5nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MzA4ODksImV4cCI6MjA5MzUwNjg4OX0.bqITcQIRVLxfqTSmrwdWCo9k8l1FdJpBmT-eLmcPovw';

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

db.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
    document.dispatchEvent(new CustomEvent('session-changed', { detail: session }));
  }
});

// ── AUTH ──────────────────────────────────────────────────────────────
async function dbSignIn(email, password) {
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

async function dbSignOut() {
  await db.auth.signOut();
}

async function dbGetSession() {
  const { data } = await db.auth.getSession();
  return data.session;
}

// ── CLIENTES ──────────────────────────────────────────────────────────
async function dbGetClientes() {
  const { data, error } = await db.from('clientes').select('*').order('nombre');
  if (error) throw error;
  return data;
}

async function dbGetCliente(id) {
  const { data, error } = await db.from('clientes').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

async function dbSaveCliente(cliente) {
  if (cliente.id) {
    const { id, created_at, ...fields } = cliente;
    const { data, error } = await db.from('clientes').update(fields).eq('id', id).select().single();
    if (error) throw error;
    return data;
  } else {
    const { id, created_at, ...fields } = cliente;
    const { data, error } = await db.from('clientes').insert(fields).select().single();
    if (error) throw error;
    return data;
  }
}

async function dbDeleteCliente(id) {
  const { error } = await db.from('clientes').delete().eq('id', id);
  if (error) throw error;
}

async function dbGetOrCreateClienteToken(clienteId) {
  const token = crypto.randomUUID();
  // Update only if token is currently null (atomic check-and-set)
  const { data: updated } = await db
    .from('clientes')
    .update({ token })
    .eq('id', clienteId)
    .is('token', null)
    .select('token')
    .single();
  if (updated?.token) return updated.token;
  // Token was already set by another request — fetch it
  const { data, error } = await db.from('clientes').select('token').eq('id', clienteId).single();
  if (error) throw error;
  return data.token;
}

// ── ORDENES ───────────────────────────────────────────────────────────
async function dbGetOrdenes() {
  const PAGE = 1000;
  let all = [], from = 0;
  while (true) {
    const { data, error } = await db
      .from('ordenes')
      .select('*, clientes(nombre), pagos(monto)')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function dbGetOrden(id) {
  const { data, error } = await db
    .from('ordenes')
    .select('*, clientes(nombre, whatsapp)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

function _cleanOrdenFields(fields) {
  if (fields.fecha_venta === '') fields.fecha_venta = null;
  if (fields.cliente_id === '') fields.cliente_id = null;
  if (fields.lote_id === '') fields.lote_id = null;
  delete fields.sort_index;
  delete fields._abonado;
  delete fields._saldo;
  delete fields.pagos;
  return fields;
}

async function dbSaveOrden(orden) {
  if (orden.id) {
    const { id, created_at, clientes, ...fields } = orden;
    _cleanOrdenFields(fields);
    const { data, error } = await db.from('ordenes').update(fields).eq('id', id).select().single();
    if (error) throw error;
    return data;
  } else {
    const { id, created_at, clientes, ...fields } = orden;
    _cleanOrdenFields(fields);
    const { data, error } = await db.from('ordenes').insert(fields).select().single();
    if (error) throw error;
    return data;
  }
}

async function dbDeleteOrden(id) {
  const { error } = await db.from('ordenes').delete().eq('id', id);
  if (error) throw error;
}

async function dbGetOrdenesByCliente(clienteId) {
  const { data, error } = await db
    .from('ordenes')
    .select('*, pagos(monto)')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// ── PAGOS ─────────────────────────────────────────────────────────────
async function dbGetPagosByOrden(ordenId) {
  const { data, error } = await db
    .from('pagos')
    .select('*')
    .eq('orden_id', ordenId)
    .order('fecha', { ascending: false });
  if (error) throw error;
  return data;
}

async function dbSavePago(pago) {
  const { id, created_at, ...fields } = pago;
  const { data, error } = await db.from('pagos').insert(fields).select().single();
  if (error) throw error;
  return data;
}

async function dbDeletePago(id) {
  const { error } = await db.from('pagos').delete().eq('id', id);
  if (error) throw error;
}

async function dbGetUltimosPagos(limit = 10) {
  const { data, error } = await db
    .from('pagos')
    .select('*, ordenes(producto, clientes(nombre))')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// ── HELPERS ───────────────────────────────────────────────────────────
function calcCostoEstimado(orden) {
  return (
    (orden.precio_original || 0) +
    (orden.envio || 0) +
    (orden.envio_mbe || 0) +
    (orden.impuesto || 0) +
    (orden.aduana || 0) +
    (orden.arancel || 0)
  );
}

function calcAbonado(pagos) {
  return pagos.reduce((sum, p) => sum + (p.monto || 0), 0);
}

function calcSaldo(orden, pagos) {
  return (orden.precio_venta_gtq || 0) - calcAbonado(pagos);
}

function fmtQ(n) {
  return 'Q' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUSD(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalize(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function fmtDate(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function dbMovePago(pagoId, newOrdenId) {
  const { error } = await db.from('pagos').update({ orden_id: newOrdenId }).eq('id', pagoId);
  if (error) throw error;
}

async function dbUpdateEstadoOrden(id, estado) {
  const { error } = await db.from('ordenes').update({ estado }).eq('id', id);
  if (error) throw error;
}

async function dbSetEntregado(id, entregado) {
  const { error } = await db.from('ordenes').update({ entregado }).eq('id', id);
  if (error) throw error;
}

async function dbSetPedidaProveedor(id, value) {
  const { error } = await db.from('ordenes').update({ pedida_proveedor: value }).eq('id', id);
  if (error) throw error;
}

async function dbSetPedido(id, pedido) {
  const { error } = await db.from('ordenes').update({ pedido }).eq('id', id);
  if (error) throw error;
}

async function dbMarcarPedidasPorMarca(marca) {
  const { data, error } = await db.from('ordenes')
    .update({ pedida_proveedor: true })
    .ilike('marca', `%${marca}%`)
    .eq('pedida_proveedor', false)
    .select('id');
  if (error) throw error;
  return data.length;
}

// ── LOTES DE PEDIDO ───────────────────────────────────────────────────
function generarCodigoLote(producto, marca, codigosExistentes) {
  const limpiar = (s) => (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase();
  const prefijo = limpiar(producto).slice(0, 2) + limpiar(marca).slice(0, 2);
  const existentesSet = new Set(codigosExistentes.map(c => (c || '').toUpperCase()));
  let n = 1;
  let codigo;
  do {
    codigo = prefijo + String(n).padStart(2, '0');
    n++;
  } while (existentesSet.has(codigo));
  return codigo;
}

async function dbCreateLote(lote) {
  let codigo = (lote.codigo || '').trim().toUpperCase();
  if (!codigo) {
    const { data: existentes, error: errBusq } = await db.from('lotes_pedido').select('codigo');
    if (errBusq) throw errBusq;
    codigo = generarCodigoLote(lote.producto, lote.marca, existentes.map(l => l.codigo));
  }
  const { id, ...fields } = lote;
  const { data, error } = await db.from('lotes_pedido').insert({ ...fields, codigo }).select().single();
  if (error) throw error;
  return data;
}

function _conDisponibilidad(lote) {
  const activas = (lote.ordenes || []).filter(o => o.estado !== 'cancelada');
  const tieneOrdenes = (lote.ordenes || []).length > 0;
  const clientes = activas.map(o => o.clientes?.nombre).filter(Boolean);
  const { ordenes, ...resto } = lote;
  return { ...resto, vendidas: activas.length, disponibles: lote.cantidad - activas.length, tieneOrdenes, clientes };
}

async function dbGetLotes() {
  const { data, error } = await db
    .from('lotes_pedido')
    .select('*, ordenes(id, estado, clientes(nombre))')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(_conDisponibilidad);
}

async function dbGetLote(id) {
  const { data, error } = await db
    .from('lotes_pedido')
    .select('*, ordenes(id, estado, clientes(nombre))')
    .eq('id', id)
    .single();
  if (error) throw error;
  return _conDisponibilidad(data);
}

function _distanciaEdicion(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 1) return 2; // no puede ser <=1, cortamos temprano
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function _coincideParecido(a, b) {
  if (!a || !b) return false;
  const na = normalize(a), nb = normalize(b);
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  return _distanciaEdicion(na, nb) <= 1;
}

function _normalizaEscala(s) {
  return normalize(s).replace(/[\s/]+/g, ':').replace(/:+/g, ':').replace(/^:|:$/g, '');
}

function _coincideEscala(a, b) {
  if (!a || !b) return false;
  return _normalizaEscala(a) === _normalizaEscala(b);
}

async function dbBuscarOrdenesSimilares(lote) {
  const { data, error } = await db
    .from('ordenes')
    .select('*, clientes(nombre)')
    .is('lote_id', null);
  if (error) throw error;
  if (!lote || !lote.producto) return [];

  const sinEntregarNiCancelada = data.filter(o => o.estado !== 'cancelada' && o.entregado !== true);

  const campos = [
    { clave: 'nombre', valorLote: lote.producto, coincide: _coincideParecido, valorOrden: o => o.producto },
    { clave: 'marca', valorLote: lote.marca, coincide: _coincideParecido, valorOrden: o => o.marca },
    { clave: 'escala', valorLote: lote.escala, coincide: _coincideEscala, valorOrden: o => o.escala },
  ].filter(c => c.valorLote);
  const requeridos = Math.min(2, campos.length);

  const conScore = sinEntregarNiCancelada.map(o => {
    const motivo = campos.filter(c => c.coincide(c.valorLote, c.valorOrden(o))).map(c => c.clave);
    return { ...o, _motivo: motivo };
  });

  if (typeof alert === 'function') {
    const lineas = conScore.slice(0, 15).map(o =>
      `- "${o.producto}" | marca:"${o.marca||''}" | escala:"${o.escala||''}" | estado:${o.estado} | entregado:${o.entregado} -> coincide: [${o._motivo.join(', ')||'ninguno'}]`
    );
    alert(
      `DEBUG buscar-vincular\n` +
      `Lote: "${lote.producto}" | marca:"${lote.marca||''}" | escala:"${lote.escala||''}"\n` +
      `Ordenes sin lote_id: ${data.length} | sin cancelar/entregar: ${sinEntregarNiCancelada.length} | requeridos: ${requeridos}\n\n` +
      (lineas.length ? lineas.join('\n') : '(no hay ordenes sin lote_id para comparar)')
    );
  }

  return conScore
    .filter(o => o._motivo.length >= requeridos)
    .sort((a, b) => b._motivo.length - a._motivo.length);
}

async function dbVincularOrdenesALote(ordenIds, loteId) {
  const { error } = await db.from('ordenes').update({ lote_id: loteId }).in('id', ordenIds);
  if (error) throw error;
}

async function dbDeleteLote(id) {
  const { error } = await db.from('lotes_pedido').delete().eq('id', id);
  if (error) throw error;
}
