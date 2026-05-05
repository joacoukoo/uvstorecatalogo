// sistema-db.js
const { createClient } = supabase;

const SUPABASE_URL = 'https://rpaiizqttenkfbiqulng.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwYWlpenF0dGVua2ZiaXF1bG5nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MzA4ODksImV4cCI6MjA5MzUwNjg4OX0.bqITcQIRVLxfqTSmrwdWCo9k8l1FdJpBmT-eLmcPovw';

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

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

// ── ORDENES ───────────────────────────────────────────────────────────
async function dbGetOrdenes() {
  const { data, error } = await db
    .from('ordenes')
    .select('*, clientes(nombre), pagos(monto)')
    .order('fecha_venta', { ascending: false, nullsFirst: true })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
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

async function dbSaveOrden(orden) {
  if (orden.id) {
    const { id, created_at, clientes, ...fields } = orden;
    const { data, error } = await db.from('ordenes').update(fields).eq('id', id).select().single();
    if (error) throw error;
    return data;
  } else {
    const { id, created_at, clientes, ...fields } = orden;
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
    .select('*')
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

function fmtDate(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function dbMovePago(pagoId, newOrdenId) {
  const { error } = await db.from('pagos').update({ orden_id: newOrdenId }).eq('id', pagoId);
  if (error) throw error;
}
