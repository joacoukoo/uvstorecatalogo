// Corre antes de todo el sitio: los archivos de trabajo del repo (scripts, notas, tests, config,
// el admin sin login) no deben poder bajarse desde uvstore.shop. El admin se sirve solo por /admin.
const CARPETAS_PRIVADAS = ['/.claude/', '/.github/', '/.superpowers/', '/.worktrees/', '/__pycache__/',
  '/docs/', '/tests/', '/tempxlsxtool/', '/node_modules/'];
const ARCHIVOS_PRIVADOS = new Set(['/package.json', '/package-lock.json', '/desktop.ini', '/.gitignore',
  '/worker.js', '/data.js', '/uv_config.json', '/admin-app', '/admin-app.html']);

export function esPrivado(path) {
  const p = decodeURIComponent(path).toLowerCase();
  return CARPETAS_PRIVADAS.some(c => p.startsWith(c)) || ARCHIVOS_PRIVADOS.has(p) ||
    p.startsWith('/index_template') || /\.(py|pyc|md)$/.test(p);
}

export async function onRequest(context) {
  const path = new URL(context.request.url).pathname;
  try { if (esPrivado(path)) return new Response('Not found', { status: 404 }); }
  catch { return new Response('Not found', { status: 404 }); }
  return context.next();
}
