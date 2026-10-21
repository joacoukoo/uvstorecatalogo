import { describe, it, expect, vi } from 'vitest';
import { onRequest } from '../functions/_middleware.js';

async function pedir(path) {
  const ctx = { request: new Request('https://uvstore.shop' + path), env: {}, next: vi.fn().mockResolvedValue(new Response('ok')) };
  const res = await onRequest(ctx);
  return { status: res.status, paso: ctx.next.mock.calls.length > 0 };
}

describe('archivos internos no se publican', () => {
  it.each([
    '/uv_admin.py', '/debug_sideshow.py', '/inject_data.py', '/__pycache__/uv_admin.cpython-314.pyc',
    '/.claude/settings.local.json', '/.github/workflows/inject.yml', '/.gitignore',
    '/package.json', '/package-lock.json', '/desktop.ini', '/worker.js', '/data.js',
    '/docs/superpowers/plans/x.md', '/tests/auth.test.js', '/tempxlsxtool/a.xlsx',
    '/index_template.html', '/index_template', '/index_template%20-%20copia.html',
    '/admin-app', '/admin-app.html', '/ADMIN-APP.HTML',
  ])('%s da 404', async path => {
    const r = await pedir(path);
    expect(r.status).toBe(404);
    expect(r.paso).toBe(false);
  });

  it.each([
    '/', '/productos.json', '/admin', '/api/catalog', '/p/goku', '/img/goku', '/marca/hot-toys',
    '/sistema', '/nosotros', '/faq.html', '/lote-import.js', '/limpieza.js', '/sistema-db.js',
    '/assets/productos/goku/1.jpg', '/llms.txt', '/robots.txt', '/sitemap.xml',
  ])('%s sigue funcionando', async path => {
    const r = await pedir(path);
    expect(r.paso).toBe(true);
  });
});
