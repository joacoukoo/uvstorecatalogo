import { verifyToken, getSessionToken } from '../_lib/auth.js';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.pathname === '/api/mis-pedidos') {
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
