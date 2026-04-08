import { describe, it, expect } from 'vitest';
import { createToken, verifyToken, getSessionToken } from '../functions/_lib/auth.js';

const SECRET = 'test-secret-for-unit-tests-only-32chars';

describe('createToken + verifyToken', () => {
  it('verifica un token recién creado', async () => {
    const token = await createToken(SECRET);
    expect(await verifyToken(SECRET, token)).toBe(true);
  });

  it('rechaza token con secret incorrecto', async () => {
    const token = await createToken(SECRET);
    expect(await verifyToken('wrong-secret', token)).toBe(false);
  });

  it('rechaza token null/vacío/malformado', async () => {
    expect(await verifyToken(SECRET, null)).toBe(false);
    expect(await verifyToken(SECRET, '')).toBe(false);
    expect(await verifyToken(SECRET, 'sinpunto')).toBe(false);
  });

  it('rechaza token expirado (8 días)', async () => {
    const oldTs = Date.now() - 8 * 24 * 60 * 60 * 1000;
    expect(await verifyToken(SECRET, `${oldTs}.fakesig`)).toBe(false);
  });
});

describe('getSessionToken', () => {
  it('extrae token de la cookie', () => {
    const req = new Request('https://example.com', {
      headers: { Cookie: 'uv_session=abc123; other=val' }
    });
    expect(getSessionToken(req)).toBe('abc123');
  });

  it('devuelve null si no hay cookie', () => {
    expect(getSessionToken(new Request('https://example.com'))).toBe(null);
  });
});
