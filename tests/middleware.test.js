import { describe, it, expect, vi } from 'vitest';
import { onRequest } from '../functions/api/_middleware.js';
import { createToken, buildSessionCookie } from '../functions/_lib/auth.js';

function makeContext(path, cookieHeader) {
  const headers = cookieHeader ? { Cookie: cookieHeader } : {};
  return {
    request: new Request(`https://example.com${path}`, { headers }),
    env: { ADMIN_SECRET: 'shhh' },
    next: vi.fn().mockResolvedValue(new Response('ok'))
  };
}

describe('middleware de /api/*', () => {
  it('deja pasar /api/mis-pedidos sin cookie', async () => {
    const ctx = makeContext('/api/mis-pedidos');
    await onRequest(ctx);
    expect(ctx.next).toHaveBeenCalled();
  });

  it('deja pasar /api/stock-sync sin cookie de ADMIN_SECRET', async () => {
    const ctx = makeContext('/api/stock-sync');
    await onRequest(ctx);
    expect(ctx.next).toHaveBeenCalled();
  });

  it('bloquea otras rutas sin cookie valida', async () => {
    const ctx = makeContext('/api/catalog');
    const res = await onRequest(ctx);
    expect(ctx.next).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
  });

  it('deja pasar otras rutas con cookie valida', async () => {
    const token = await createToken('shhh');
    const cookie = buildSessionCookie(token).split(';')[0];
    const ctx = makeContext('/api/catalog', cookie);
    await onRequest(ctx);
    expect(ctx.next).toHaveBeenCalled();
  });
});
