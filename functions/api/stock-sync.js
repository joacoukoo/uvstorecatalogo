import { readFile, mutateCatalog, findProducto } from '../_lib/githubCatalog.js';

// Misma clave publica ("anon") ya usada del lado del cliente en sistema-db.js:5 — no es secreta.
const SUPABASE_URL = 'https://rpaiizqttenkfbiqulng.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwYWlpenF0dGVua2ZiaXF1bG5nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MzA4ODksImV4cCI6MjA5MzUwNjg4OX0.bqITcQIRVLxfqTSmrwdWCo9k8l1FdJpBmT-eLmcPovw';

export async function verifySupabaseSession(accessToken) {
  if (!accessToken) return false;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` }
  });
  return res.ok;
}

function getBearerToken(request) {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function unauthorized() {
  return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet({ request, env }) {
  if (!(await verifySupabaseSession(getBearerToken(request)))) return unauthorized();
  try {
    const { catalog } = await readFile(env.GITHUB_TOKEN, env.GITHUB_REPO);
    const lista = [];
    for (const cat in catalog) {
      for (const p of (catalog[cat].products || [])) {
        lista.push({
          id: p.id, n: p.n, marca: p.marca, escala: p.escala, disp: p.disp,
          cantidad: p.cantidad, estado: p.estado, agotado: !!p.agotado,
          agotado_r: p.agotado_r, agotado_d: p.agotado_d, precio_d: p.precio_d
        });
      }
    }
    return new Response(JSON.stringify(lista), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function onRequestPost({ request, env }) {
  if (!(await verifySupabaseSession(getBearerToken(request)))) return unauthorized();
  try {
    const { catalogo_id, catalogo_variante, disponibles } = await request.json();
    if (!catalogo_id) return new Response(JSON.stringify({ error: 'catalogo_id requerido' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (typeof disponibles !== 'number' || !Number.isFinite(disponibles)) return new Response(JSON.stringify({ error: 'disponibles debe ser un número' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const agotado = disponibles <= 0;

    await mutateCatalog(env.GITHUB_TOKEN, env.GITHUB_REPO, catalog => {
      const p = findProducto(catalog, catalogo_id);
      if (!p) throw new Error('Producto no encontrado en el catálogo: ' + catalogo_id);
      if (catalogo_variante === 'regular') p.agotado_r = agotado;
      else if (catalogo_variante === 'deluxe') p.agotado_d = agotado;
      else { p.agotado = agotado; p.cantidad = String(disponibles); }
    }, { message: 'Sync stock — Sistema de Órdenes' });

    return new Response(JSON.stringify({ ok: true, agotado }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
