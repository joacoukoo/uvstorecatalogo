import { verifyToken, getSessionToken } from '../_lib/auth.js';

const RUTAS_SIN_ADMIN_SECRET = new Set(['/api/mis-pedidos', '/api/stock-sync']);

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (RUTAS_SIN_ADMIN_SECRET.has(url.pathname)) {
    return context.next();
  }
  const token = getSessionToken(context.request);
  const valid = await verifyToken(context.env.ADMIN_SECRET, token);
  if (!valid) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return context.next();
}
