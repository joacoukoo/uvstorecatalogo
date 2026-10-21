import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// inject_data.py también escribe sitemap.xml a partir de productos.json.
describe('sitemap.xml generado', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uvsm-'));
  writeFileSync(join(dir, 'productos.json'), JSON.stringify({
    'Hot Toys 1:6': { products: [{ id: 'goku', n: 'Goku', marca: 'Hot Toys', added_at: '2026-10-01T10:00:00' }] },
    'Estatuas Premium': { products: [{ id: 'vegeta', n: 'Vegeta', marca: 'Prime 1 Studio' }, { id: 'luffy', n: 'Luffy', marca: 'Hot Toys ' }] },
    Adultos: { products: [{ id: 'secreta', n: 'X', marca: 'Kora Studio' }] },
  }));
  writeFileSync(join(dir, 't.html'), '<script type="application/json" id="uv-data">{}</script>');
  execFileSync('python', ['-I', 'inject_data.py', '--template', join(dir, 't.html'), '--data', join(dir, 'productos.json'),
    '--output', join(dir, 'index.html'), '--sitemap', join(dir, 'sitemap.xml')]);
  const sm = readFileSync(join(dir, 'sitemap.xml'), 'utf-8');
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

  it('incluye cada figura, categoría y marca, sin repetir', () => {
    expect(locs).toEqual([
      'https://uvstore.shop/',
      'https://uvstore.shop/categoria/hot-toys-1-6',
      'https://uvstore.shop/categoria/estatuas-premium',
      'https://uvstore.shop/marca/hot-toys',
      'https://uvstore.shop/marca/prime-1-studio',
      'https://uvstore.shop/p/goku',
      'https://uvstore.shop/p/vegeta',
      'https://uvstore.shop/p/luffy',
    ]);
  });

  it('deja afuera todo lo de Adultos', () => {
    expect(sm).not.toContain('adultos');
    expect(sm).not.toContain('secreta');
    expect(sm).not.toContain('kora');
  });

  it('usa la fecha en que se agregó la figura', () => {
    expect(sm).toContain('<loc>https://uvstore.shop/p/goku</loc><lastmod>2026-10-01</lastmod>');
  });
});
