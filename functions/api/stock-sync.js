import { readFile, mutateCatalog, findProducto, aplicarStock } from '../_lib/githubCatalog.js';

// Misma clave publica ("anon") ya usada del lado del cliente en sistema-db.js:5 — no es secreta.
const SUPABASE_URL = 'https://rpaiizqttenkfbiqulng.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwYWlpenF0dGVua2ZiaXF1bG5nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MzA4ODksImV4cCI6MjA5MzUwNjg4OX0.bqITcQIRVLxfqTSmrwdWCo9k8l1FdJpBmT-eLmcPovw';

// Único usuario admin de este sitio (single-owner). Si el admin cambia de cuenta,
// actualizar este id (Supabase dashboard -> Authentication -> Users).
const ADMIN_USER_ID = '902668dd-2f20-4d1e-a56a-dce062f98afc';

export async function verifySupabaseSession(accessToken) {
  if (!accessToken) return false;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) return false;
  try {
    const user = await res.json();
    return user && user.id === ADMIN_USER_ID;
  } catch {
    return false;
  }
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
          agotado_r: p.agotado_r, agotado_d: p.agotado_d, precio_d: p.precio_d,
          i: p.i, fotos: p.fotos, fotos_d: p.fotos_d
        });
      }
    }
    return new Response(JSON.stringify(lista), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function aplicarItem(p, it) {
  let cambio = aplicarStock(p, it.catalogo_variante || null, it.disponibles);
  if (it.disp && p.disp !== it.disp) { p.disp = it.disp; cambio = true; }
  return cambio;
}

// Varios productos en un solo commit (importación de documentos de Sideshow).
async function sincronizarVarios(items, env) {
  for (const it of items) {
    if (!it || !it.catalogo_id || typeof it.disponibles !== 'number' || !Number.isFinite(it.disponibles)) {
      return new Response(JSON.stringify({ error: 'cada item requiere catalogo_id y disponibles numérico' }), { status: 400, headers: JSON_HEADERS });
    }
  }
  const { catalog: actual } = await readFile(env.GITHUB_TOKEN, env.GITHUB_REPO);
  const noEncontrados = items.filter(it => !findProducto(actual, it.catalogo_id)).map(it => it.catalogo_id);
  const aplicables = items.filter(it => !noEncontrados.includes(it.catalogo_id));
  const cambiados = aplicables.filter(it => aplicarItem({ ...findProducto(actual, it.catalogo_id) }, it)).length;
  if (cambiados > 0) {
    await mutateCatalog(env.GITHUB_TOKEN, env.GITHUB_REPO, catalog => {
      for (const it of aplicables) {
        const p = findProducto(catalog, it.catalogo_id);
        if (p) aplicarItem(p, it);
      }
    }, { message: 'Sync stock — Importación Sideshow' });
  }
  return new Response(JSON.stringify({ ok: true, cambiados, no_encontrados: noEncontrados }), { headers: JSON_HEADERS });
}

export async function onRequestPost({ request, env }) {
  if (!(await verifySupabaseSession(getBearerToken(request)))) return unauthorized();
  try {
    const body = await request.json();
    if (Array.isArray(body.items)) return await sincronizarVarios(body.items, env);
    const { catalogo_id, catalogo_variante, disponibles } = body;
    if (!catalogo_id) return new Response(JSON.stringify({ error: 'catalogo_id requerido' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (typeof disponibles !== 'number' || !Number.isFinite(disponibles)) return new Response(JSON.stringify({ error: 'disponibles debe ser un número' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const agotado = disponibles <= 0;

    // Chequeo previo de solo lectura: si el catálogo ya refleja este stock, no escribimos nada.
    // Evita un commit no-op (y su rebuild+deploy) por cada cambio de orden que no afecta la
    // disponibilidad (ej. marcar una orden como pagada). Si el producto no aparece, seguimos
    // de largo y deja que mutateCatalog tire su propio error de "no encontrado".
    const { catalog: actualCatalog } = await readFile(env.GITHUB_TOKEN, env.GITHUB_REPO);
    const actual = findProducto(actualCatalog, catalogo_id);
    if (actual && !aplicarStock({ ...actual }, catalogo_variante, disponibles)) {
      return new Response(JSON.stringify({ ok: true, agotado, skipped: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    await mutateCatalog(env.GITHUB_TOKEN, env.GITHUB_REPO, catalog => {
      const p = findProducto(catalog, catalogo_id);
      if (!p) throw new Error('Producto no encontrado en el catálogo: ' + catalogo_id);
      aplicarStock(p, catalogo_variante, disponibles);
    }, { message: 'Sync stock — Sistema de Órdenes' });

    return new Response(JSON.stringify({ ok: true, agotado }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
