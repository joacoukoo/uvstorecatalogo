export const COOKIE_NAME = 'uv_session';
export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

async function sign(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(data)));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function createToken(secret) {
  const ts = Date.now();
  const sig = await sign(secret, ts);
  return `${ts}.${sig}`;
}

export async function verifyToken(secret, token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot === -1) return false;
  const ts = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const timestamp = parseInt(ts, 10);
  if (isNaN(timestamp)) return false;
  if (Date.now() - timestamp > TOKEN_TTL_MS) return false;
  const expected = await sign(secret, timestamp);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export function getSessionToken(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function buildSessionCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Max-Age=${7 * 24 * 3600}; Path=/`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`;
}
