# Conectar Lotes de Figuras con Stock del Catálogo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vincular cada lote de `lotes_pedido` (Supabase) a un producto real del catálogo público (`productos.json`, en GitHub), para que vender la última unidad marque el producto agotado en la página automáticamente, y viceversa.

**Architecture:** Dos columnas nuevas en `lotes_pedido` (`catalogo_id`, `catalogo_variante`) conectan el sistema de órdenes con el catálogo. Dos endpoints nuevos de Cloudflare Functions hacen de puente: `functions/api/lote-sync.js` (admin-app.html → Supabase, protegido por la sesión de admin ya existente) y `functions/api/stock-sync.js` (sistema.html → GitHub, protegido validando la sesión de Supabase ya activa en `sistema.html`, ya que ese archivo es público y no tiene la cookie de admin). Toda la lógica de "¿hay que sincronizar?" vive centralizada en `sistema-db.js`, dentro de las funciones que ya mutan órdenes y lotes — así ningún botón de la UI necesita saber de esto.

**Tech Stack:** Alpine.js v3 (sin bundler) en `sistema.html`; JS vanilla en `admin-app.html`; Cloudflare Pages Functions (ES modules) en `functions/`; Supabase JS client vía CDN; Vitest para las Functions.

**Spec:** `docs/superpowers/specs/2026-09-22-lote-stock-catalogo-design.md`

## Global Constraints

- `sistema.html`/`sistema-db.js`/`admin-app.html` no tienen cobertura de tests automatizados — se verifican **manualmente en el navegador**, igual que toda feature previa de esos archivos. `functions/*.js` **sí** tiene cobertura con Vitest (`npm test`, ver `tests/auth.test.js`) — todo código nuevo ahí lleva sus tests, mockeando `fetch` con `vi.stubGlobal('fetch', ...)` y usando los `Request`/`Response` nativos de Node (no hace falta un framework HTTP de prueba).
- No hay entorno de staging: la verificación manual de `sistema.html`/`sistema-db.js` corre contra Supabase de **producción real**, y la de `admin-app.html` contra el **catálogo real en GitHub** (cualquier producto que se cree ahí se publica en el sitio en vivo). Usar siempre datos de prueba con el prefijo `ZZZTEST` en `producto`/nombre para poder identificarlos y borrarlos al final de cada tarea (instrucciones de limpieza incluidas en cada tarea: `DELETE` en Supabase, y el propio botón "Eliminar" de `admin-app.html` para el catálogo).
- `sistema-db.js` es un `<script>` clásico (no ES module): toda función nueva se define como función global de nivel superior, sin `export`, siguiendo el patrón `if (error) throw error;` sin try/catch (el try/catch vive del lado de Alpine que la llama).
- `functions/*.js` sí son ES modules (`export async function onRequestGet(...)`, etc.) — ese patrón no cambia.
- **`index.html` es un archivo generado — nunca se edita directo.** Se genera con `python inject_data.py --template index_template.html --data productos.json --output index.html`. Todo cambio de UI del catálogo público va en `index_template.html`, y se regenera `index.html` como parte de la verificación de esa tarea. `python` (no `python3`) está disponible en este entorno.
- Reusar clases CSS existentes (`.card`, `.modal-bg`/`.modal`, `.btn-sm`/`.btn-purple`/`.btn-ghost`, `.form-input`/`.form-select`, `.badge`, `.form-row`/`.form-row-1`, variables `var(--purple)`, `var(--pl)`, `var(--green)`, `var(--red)`, `var(--muted2)`) en `sistema.html` — no inventar estilos nuevos. En `admin-app.html`, reusar `.field`, `.check-item`, `.btn`/`.btn-secondary`/`.btn-danger`.
- Para levantar el sitio localmente: `python -m http.server 8000` desde la raíz del repo. `sistema.html` y `admin-app.html` requieren iniciar sesión real (Supabase y contraseña de admin respectivamente) porque hablan directo con producción — no hay forma de probarlos sin credenciales reales.
- Antes de la Tarea 4, hace falta crear manualmente la env var `SUPABASE_SERVICE_KEY` en el dashboard de Cloudflare Pages (Settings → Environment variables), con el valor del **service role key** del proyecto Supabase (`rpaiizqttenkfbiqulng`, Settings → API → `service_role` secret). Sin esto, `/api/lote-sync` no puede escribir en Supabase desde el servidor. Esta key nunca se commitea ni se usa en código de cliente.

---

### Task 1: Schema de Supabase (acción manual)

**Files:**
- Ninguno en el repo — se ejecuta en el SQL Editor del dashboard de Supabase (proyecto `rpaiizqttenkfbiqulng`).

**Interfaces:**
- Produces: columnas `lotes_pedido.catalogo_id` (text, nullable) y `lotes_pedido.catalogo_variante` (text, nullable, `'regular'|'deluxe'|null`), que consumen todas las tareas siguientes.

- [ ] **Step 1: Ejecutar el DDL en Supabase SQL Editor**

```sql
ALTER TABLE lotes_pedido ADD COLUMN catalogo_id text;
ALTER TABLE lotes_pedido ADD COLUMN catalogo_variante text
  CHECK (catalogo_variante IN ('regular', 'deluxe') OR catalogo_variante IS NULL);

-- Un solo lote "automático" (sin variante) por producto de catálogo
CREATE UNIQUE INDEX lotes_pedido_catalogo_id_unico
  ON lotes_pedido (catalogo_id)
  WHERE catalogo_variante IS NULL;

-- Un solo lote por producto+variante cuando sí hay variante
CREATE UNIQUE INDEX lotes_pedido_catalogo_variante_unico
  ON lotes_pedido (catalogo_id, catalogo_variante)
  WHERE catalogo_variante IS NOT NULL;
```

- [ ] **Step 2: Verificar el schema**

En el SQL Editor:
```sql
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'lotes_pedido' AND column_name IN ('catalogo_id', 'catalogo_variante');
SELECT indexname FROM pg_indexes WHERE tablename = 'lotes_pedido' AND indexname LIKE 'lotes_pedido_catalogo%';
```
Esperado: la primera consulta devuelve 2 filas; la segunda devuelve 2 índices.

- [ ] **Step 3: Commit**

No hay archivos que commitear en este paso (cambio de infraestructura).

---

### Task 2: Extraer helpers de GitHub a `functions/_lib/githubCatalog.js`

**Files:**
- Create: `functions/_lib/githubCatalog.js`
- Modify: `functions/api/catalog.js` (queda solo con los handlers HTTP, sin las funciones de GitHub)
- Test: `tests/githubCatalog.test.js`

**Interfaces:**
- Produces: `readFile(token, repo)`, `writeFile(token, repo, catalog, sha, message?)`, `mutateCatalog(token, repo, mutateFn, { retries?, message? })`, `findProducto(catalog, catalogoId)` — usados por `catalog.js` (esta tarea) y por `functions/api/stock-sync.js` (Task 3).
- **Nota:** esto es un refactor sin cambio de comportamiento — hoy `catalog.js` ya tiene esta misma lógica inline; acá se mueve a un archivo compartido para que `stock-sync.js` no la duplique.

- [ ] **Step 1: Escribir los tests**

Crear `tests/githubCatalog.test.js`:
```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFile, writeFile, mutateCatalog, findProducto } from '../functions/_lib/githubCatalog.js';

function b64(str) { return Buffer.from(str, 'utf-8').toString('base64'); }

afterEach(() => { vi.unstubAllGlobals(); });

describe('readFile', () => {
  it('lee el catalogo desde GitHub usando el sha del commit mas reciente', async () => {
    const catalog = { 'Entrega Inmediata': { products: [{ id: 'a', n: 'Figura A' }] } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'commitsha123' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'filesha456' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await readFile('tok', 'owner/repo');

    expect(result.catalog).toEqual(catalog);
    expect(result.sha).toBe('filesha456');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('ref=commitsha123');
  });

  it('lanza error si GitHub responde con status no-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('boom', { status: 500 })));
    await expect(readFile('tok', 'owner/repo')).rejects.toThrow('GitHub commits 500');
  });
});

describe('writeFile', () => {
  it('hace PUT con el contenido en base64 y el mensaje por defecto', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await writeFile('tok', 'owner/repo', { a: 1 }, 'sha1');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/contents/productos.json');
    expect(opts.method).toBe('PUT');
    const body = JSON.parse(opts.body);
    expect(body.sha).toBe('sha1');
    expect(body.message).toBe('Update catalog — UV Store GT Admin');
    expect(JSON.parse(Buffer.from(body.content, 'base64').toString('utf-8'))).toEqual({ a: 1 });
  });

  it('acepta un mensaje de commit custom', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await writeFile('tok', 'owner/repo', { a: 1 }, 'sha1', 'Sync stock — Sistema de Ordenes');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.message).toBe('Sync stock — Sistema de Ordenes');
  });

  it('lanza error con status adjunto si GitHub rechaza el PUT', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('conflict', { status: 409 })));
    await expect(writeFile('tok', 'owner/repo', {}, 'sha1')).rejects.toMatchObject({ status: 409 });
  });
});

describe('mutateCatalog', () => {
  it('lee, aplica la mutacion y escribe', async () => {
    const catalog = { Cat: { products: [{ id: 'a', cantidad: '1' }] } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'f1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await mutateCatalog('tok', 'owner/repo', c => { c.Cat.products[0].cantidad = '0'; });

    expect(result.Cat.products[0].cantidad).toBe('0');
    const writeBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(JSON.parse(Buffer.from(writeBody.content, 'base64').toString('utf-8')).Cat.products[0].cantidad).toBe('0');
  });

  it('reintenta ante conflicto 409 en el write', async () => {
    const catalog = { Cat: { products: [] } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'f1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('conflict', { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'f2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await mutateCatalog('tok', 'owner/repo', () => {});

    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});

describe('findProducto', () => {
  it('encuentra un producto por id en cualquier categoria', () => {
    const catalog = { A: { products: [{ id: 'x' }] }, B: { products: [{ id: 'y' }] } };
    expect(findProducto(catalog, 'y')).toEqual({ id: 'y' });
  });

  it('devuelve null si no existe', () => {
    expect(findProducto({ A: { products: [] } }, 'nope')).toBe(null);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL — `Cannot find module '../functions/_lib/githubCatalog.js'` (el archivo todavía no existe).

- [ ] **Step 3: Crear `functions/_lib/githubCatalog.js`**

```js
const GH_API = 'https://api.github.com';

function headers(token) {
  return {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'UV-Store-Admin/1.0'
  };
}

export async function readFile(token, repo) {
  const commitRes = await fetch(`${GH_API}/repos/${repo}/commits/main`, { headers: headers(token), cache: 'no-store' });
  if (!commitRes.ok) throw new Error(`GitHub commits ${commitRes.status}: ${await commitRes.text()}`);
  const commitSha = (await commitRes.json()).sha;

  const res = await fetch(`${GH_API}/repos/${repo}/contents/productos.json?ref=${commitSha}`, { headers: headers(token), cache: 'no-store' });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  const data = await res.json();
  let text;
  if (data.content) {
    const bytes = Uint8Array.from(atob(data.content.replace(/\s/g, '')), c => c.charCodeAt(0));
    text = new TextDecoder().decode(bytes);
  } else if (data.download_url) {
    const dlRes = await fetch(data.download_url, { cache: 'no-store' });
    if (!dlRes.ok) throw new Error(`download_url ${dlRes.status}`);
    text = await dlRes.text();
  } else {
    throw new Error('GitHub API returned no content and no download_url');
  }
  return { catalog: JSON.parse(text), sha: data.sha };
}

function bytesToBase64(bytes) {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function writeFile(token, repo, catalog, sha, message = 'Update catalog — UV Store GT Admin') {
  const json = JSON.stringify(catalog, null, 2);
  const bytes = new TextEncoder().encode(json);
  const b64 = bytesToBase64(bytes);
  const res = await fetch(`${GH_API}/repos/${repo}/contents/productos.json`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: b64, sha })
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`GitHub ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function mutateCatalog(token, repo, mutateFn, { retries = 3, message } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 100 * attempt));
    const { catalog, sha } = await readFile(token, repo);
    mutateFn(catalog);
    try {
      await writeFile(token, repo, catalog, sha, message);
      return catalog;
    } catch (e) {
      lastErr = e;
      if (e.status === 409 || e.status === 422) continue;
      throw e;
    }
  }
  throw lastErr;
}

export function findProducto(catalog, catalogoId) {
  for (const cat in catalog) {
    const prods = catalog[cat].products || [];
    const p = prods.find(x => x.id === catalogoId);
    if (p) return p;
  }
  return null;
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: todos los tests de `tests/githubCatalog.test.js` en verde.

- [ ] **Step 5: Refactorizar `functions/api/catalog.js` para usar el módulo nuevo**

Reemplazar el archivo completo por:
```js
import { readFile, writeFile, mutateCatalog } from '../_lib/githubCatalog.js';

export async function onRequestGet({ env }) {
  try {
    const { catalog } = await readFile(env.GITHUB_TOKEN, env.GITHUB_REPO);
    return new Response(JSON.stringify(catalog), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestPut({ env, request }) {
  try {
    const body = await request.json();

    if (body.catalog && !body.action) {
      const { sha } = await readFile(env.GITHUB_TOKEN, env.GITHUB_REPO);
      await writeFile(env.GITHUB_TOKEN, env.GITHUB_REPO, body.catalog, sha);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    const { action } = body;

    if (action === 'add') {
      const { category, product } = body;
      if (!category || !product) return err400('add requiere category y product');
      await mutateCatalog(env.GITHUB_TOKEN, env.GITHUB_REPO, catalog => {
        if (!catalog[category]) catalog[category] = { products: [] };
        catalog[category].products.unshift(product);
      });
      return ok();
    }

    if (action === 'edit') {
      const { productId, product, newCategory } = body;
      if (!productId || !product) return err400('edit requiere productId y product');
      await mutateCatalog(env.GITHUB_TOKEN, env.GITHUB_REPO, catalog => {
        for (const c in catalog) {
          const prods = catalog[c].products || [];
          const i = prods.findIndex(p => p.id === productId);
          if (i === -1) continue;
          if (newCategory && newCategory !== c && catalog[newCategory]) {
            prods.splice(i, 1);
            catalog[newCategory].products.unshift(product);
          } else {
            prods[i] = product;
          }
          return;
        }
        throw new Error('Producto no encontrado: ' + productId);
      });
      return ok();
    }

    if (action === 'delete') {
      const { productId } = body;
      if (!productId) return err400('delete requiere productId');
      await mutateCatalog(env.GITHUB_TOKEN, env.GITHUB_REPO, catalog => {
        for (const c in catalog) {
          const prods = catalog[c].products || [];
          const i = prods.findIndex(p => p.id === productId);
          if (i !== -1) { prods.splice(i, 1); return; }
        }
        throw new Error('Producto no encontrado: ' + productId);
      });
      return ok();
    }

    if (action === 'replace') {
      const { catalog } = body;
      if (!catalog) return err400('replace requiere catalog');
      const { sha } = await readFile(env.GITHUB_TOKEN, env.GITHUB_REPO);
      await writeFile(env.GITHUB_TOKEN, env.GITHUB_REPO, catalog, sha);
      return ok();
    }

    return err400('action inválido: ' + action);
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

function ok() {
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}
function err400(msg) {
  return new Response(JSON.stringify({ error: msg }), { status: 400, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 6: Correr todos los tests (regresión)**

Run: `npm test`
Expected: `2 passed` en archivos (`auth.test.js`, `githubCatalog.test.js`), sin fallos.

- [ ] **Step 7: Verificación manual de que `admin-app.html` sigue funcionando**

1. Levantar el sitio: `python -m http.server 8000`, abrir `http://localhost:8000/admin-app.html` (pide la contraseña de admin real, ya que `/admin` valida contra `ADMIN_SECRET`/`ADMIN_PASSWORD` en Cloudflare — si se prueba local sin Cloudflare Functions, usar el deploy de preview de Cloudflare Pages en su lugar).
2. Ir a la pestaña de catálogo, cargarlo. Esperado: el catálogo carga igual que antes del refactor (mismo número de figuras).

- [ ] **Step 8: Commit**

```bash
git add functions/_lib/githubCatalog.js functions/api/catalog.js tests/githubCatalog.test.js
git commit -m "refactor: extraer helpers de GitHub a functions/_lib/githubCatalog.js"
```

---

### Task 3: `functions/api/stock-sync.js` — GET/POST protegido por sesión de Supabase

**Files:**
- Create: `functions/api/stock-sync.js`
- Modify: `functions/api/_middleware.js`
- Test: `tests/stockSync.test.js`, `tests/middleware.test.js`

**Interfaces:**
- Consumes: `readFile`, `mutateCatalog`, `findProducto` (Task 2).
- Produces: `GET /api/stock-sync` (requiere header `Authorization: Bearer <access_token de Supabase>`, devuelve lista liviana del catálogo) y `POST /api/stock-sync` (mismo header, body `{catalogo_id, catalogo_variante, disponibles}`, aplica el cambio al catálogo) — consumidos por `sistema-db.js` en Task 5.

- [ ] **Step 1: Escribir los tests de `stock-sync.js`**

Crear `tests/stockSync.test.js`:
```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestGet, onRequestPost, verifySupabaseSession } from '../functions/api/stock-sync.js';

function b64(str) { return Buffer.from(str, 'utf-8').toString('base64'); }
const ENV = { GITHUB_TOKEN: 'gh', GITHUB_REPO: 'o/r' };

afterEach(() => { vi.unstubAllGlobals(); });

describe('verifySupabaseSession', () => {
  it('devuelve false sin token', async () => {
    expect(await verifySupabaseSession(null)).toBe(false);
  });
  it('devuelve true si Supabase responde ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 })));
    expect(await verifySupabaseSession('tok123')).toBe(true);
  });
  it('devuelve false si Supabase rechaza el token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}', { status: 401 })));
    expect(await verifySupabaseSession('tok-malo')).toBe(false);
  });
});

describe('onRequestGet', () => {
  it('devuelve 401 sin Authorization header', async () => {
    const res = await onRequestGet({ request: new Request('https://x/api/stock-sync'), env: ENV });
    expect(res.status).toBe(401);
  });

  it('devuelve la lista liviana del catalogo con sesion valida', async () => {
    const catalog = { Cat: { products: [{ id: 'a', n: 'Figura', marca: 'M', cantidad: '2', agotado: false }] } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'f1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('https://x/api/stock-sync', { headers: { Authorization: 'Bearer tok123' } });
    const res = await onRequestGet({ request: req, env: ENV });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([{ id: 'a', n: 'Figura', marca: 'M', cantidad: '2', agotado: false }]);
  });
});

describe('onRequestPost', () => {
  it('devuelve 401 sin Authorization header', async () => {
    const res = await onRequestPost({ request: new Request('https://x/api/stock-sync', { method: 'POST', body: '{}' }), env: ENV });
    expect(res.status).toBe(401);
  });

  it('marca agotado y actualiza cantidad cuando disponibles es 0', async () => {
    const catalog = { Cat: { products: [{ id: 'a', cantidad: '1', agotado: false }] } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'f1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('https://x/api/stock-sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok123', 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogo_id: 'a', catalogo_variante: null, disponibles: 0 })
    });
    const res = await onRequestPost({ request: req, env: ENV });
    const body = await res.json();

    expect(body).toEqual({ ok: true, agotado: true });
    const writeBody = JSON.parse(fetchMock.mock.calls[3][1].body);
    const written = JSON.parse(Buffer.from(writeBody.content, 'base64').toString('utf-8'));
    expect(written.Cat.products[0]).toEqual({ id: 'a', cantidad: '0', agotado: true });
  });

  it('marca agotado_r en la variante regular sin tocar cantidad', async () => {
    const catalog = { Cat: { products: [{ id: 'a', cantidad: '3', agotado_r: false, agotado_d: false }] } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'f1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('https://x/api/stock-sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok123' },
      body: JSON.stringify({ catalogo_id: 'a', catalogo_variante: 'regular', disponibles: 0 })
    });
    await onRequestPost({ request: req, env: ENV });

    const writeBody = JSON.parse(fetchMock.mock.calls[3][1].body);
    const written = JSON.parse(Buffer.from(writeBody.content, 'base64').toString('utf-8'));
    expect(written.Cat.products[0].agotado_r).toBe(true);
    expect(written.Cat.products[0].cantidad).toBe('3');
  });

  it('devuelve 500 si el producto no existe en el catalogo', async () => {
    const catalog = { Cat: { products: [] } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sha: 'c1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: b64(JSON.stringify(catalog)), sha: 'f1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('https://x/api/stock-sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok123' },
      body: JSON.stringify({ catalogo_id: 'no-existe', catalogo_variante: null, disponibles: 0 })
    });
    const res = await onRequestPost({ request: req, env: ENV });
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL — `Cannot find module '../functions/api/stock-sync.js'`.

- [ ] **Step 3: Crear `functions/api/stock-sync.js`**

```js
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
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: todos los tests de `tests/stockSync.test.js` en verde.

- [ ] **Step 5: Escribir el test de la exclusión en el middleware**

Crear `tests/middleware.test.js`:
```js
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
```

- [ ] **Step 6: Correr el test y verificar que falla**

Run: `npm test`
Expected: FAIL en `tests/middleware.test.js` — `/api/stock-sync` todavía exige la cookie de `ADMIN_SECRET`.

- [ ] **Step 7: Excluir `/api/stock-sync` del middleware**

Reemplazar `functions/api/_middleware.js` completo por:
```js
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
```

- [ ] **Step 8: Correr todos los tests (regresión)**

Run: `npm test`
Expected: `4 passed` en archivos (`auth`, `githubCatalog`, `stockSync`, `middleware`), sin fallos.

- [ ] **Step 9: Commit**

```bash
git add functions/api/stock-sync.js functions/api/_middleware.js tests/stockSync.test.js tests/middleware.test.js
git commit -m "feat: endpoint stock-sync para reflejar disponibilidad de lotes en el catalogo"
```

---

### Task 4: `functions/api/lote-sync.js` — alta/actualización de lote desde `admin-app.html`

**Files:**
- Create: `functions/api/lote-sync.js`
- Test: `tests/loteSync.test.js`

**Interfaces:**
- Produces: `POST /api/lote-sync` (protegido automáticamente por el middleware existente, exige la cookie de `ADMIN_SECRET`), body `{catalogo_id, producto, marca, escala, cantidad}` → `{disponibles, agotado}` — consumido por `admin-app.html` en Task 9.
- Requiere `env.SUPABASE_SERVICE_KEY` (ver Global Constraints — configurar en Cloudflare antes de probar en producción; los tests de este Task mockean `fetch`, no necesitan la key real).

- [ ] **Step 1: Escribir los tests**

Crear `tests/loteSync.test.js`:
```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestPost, generarCodigoLote } from '../functions/api/lote-sync.js';

const ENV = { SUPABASE_SERVICE_KEY: 'service-key' };

afterEach(() => { vi.unstubAllGlobals(); });

describe('generarCodigoLote', () => {
  it('genera codigo de 2+2 letras mas sufijo 01', () => {
    expect(generarCodigoLote('Jinx', 'Hot Toys', [])).toBe('JIHO01');
  });
  it('incrementa el sufijo si ya existe', () => {
    expect(generarCodigoLote('Jinx', 'Hot Toys', ['JIHO01', 'JIHO02'])).toBe('JIHO03');
  });
});

describe('onRequestPost', () => {
  it('crea un lote nuevo cuando no existe uno para ese catalogo_id', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('[]', { status: 200 })) // buscar existente -> ninguno
      .mockResolvedValueOnce(new Response('[]', { status: 200 })) // todos los codigos -> ninguno
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'lote-1' }]), { status: 201 })) // insert
      .mockResolvedValueOnce(new Response('[]', { status: 200 })); // contar ordenes activas -> 0
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('https://x/api/lote-sync', {
      method: 'POST',
      body: JSON.stringify({ catalogo_id: 'a', producto: 'Jinx', marca: 'Hot Toys', escala: '1:6', cantidad: 3 })
    });
    const res = await onRequestPost({ request: req, env: ENV });
    const body = await res.json();

    expect(body).toEqual({ disponibles: 3, agotado: false });
    expect(fetchMock.mock.calls[2][1].method).toBe('POST');
    const insertBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(insertBody).toMatchObject({ producto: 'Jinx', marca: 'Hot Toys', catalogo_id: 'a', catalogo_variante: null, cantidad: 3 });
  });

  it('actualiza la cantidad de un lote existente y calcula disponibles con ordenes activas', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'lote-1', cantidad: 3 }]), { status: 200 })) // buscar existente
      .mockResolvedValueOnce(new Response('[]', { status: 200 })) // patch
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'o1' }, { id: 'o2' }]), { status: 200 })); // 2 ordenes activas
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request('https://x/api/lote-sync', {
      method: 'POST',
      body: JSON.stringify({ catalogo_id: 'a', producto: 'Jinx', marca: 'Hot Toys', escala: '1:6', cantidad: 5 })
    });
    const res = await onRequestPost({ request: req, env: ENV });
    const body = await res.json();

    expect(body).toEqual({ disponibles: 3, agotado: false });
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ cantidad: 5 });
  });

  it('devuelve 400 si falta un campo requerido', async () => {
    const req = new Request('https://x/api/lote-sync', { method: 'POST', body: JSON.stringify({ catalogo_id: 'a' }) });
    const res = await onRequestPost({ request: req, env: ENV });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL — `Cannot find module '../functions/api/lote-sync.js'`.

- [ ] **Step 3: Crear `functions/api/lote-sync.js`**

```js
const SUPABASE_URL = 'https://rpaiizqttenkfbiqulng.supabase.co';

function limpiarCodigo(s) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase();
}

export function generarCodigoLote(producto, marca, codigosExistentes) {
  const prefijo = limpiarCodigo(producto).slice(0, 2) + limpiarCodigo(marca).slice(0, 2);
  const existentesSet = new Set(codigosExistentes.map(c => (c || '').toUpperCase()));
  let n = 1;
  let codigo;
  do {
    codigo = prefijo + String(n).padStart(2, '0');
    n++;
  } while (existentesSet.has(codigo));
  return codigo;
}

function headersServicio(serviceKey) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };
}

async function buscarLotePorCatalogoId(serviceKey, catalogoId) {
  const url = `${SUPABASE_URL}/rest/v1/lotes_pedido?catalogo_id=eq.${encodeURIComponent(catalogoId)}&catalogo_variante=is.null&select=id,cantidad`;
  const res = await fetch(url, { headers: headersServicio(serviceKey) });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows[0] || null;
}

async function contarOrdenesActivas(serviceKey, loteId) {
  const url = `${SUPABASE_URL}/rest/v1/ordenes?lote_id=eq.${loteId}&estado=neq.cancelada&select=id`;
  const res = await fetch(url, { headers: headersServicio(serviceKey) });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows.length;
}

async function todosLosCodigos(serviceKey) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/lotes_pedido?select=codigo`, { headers: headersServicio(serviceKey) });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows.map(r => r.codigo);
}

export async function onRequestPost({ request, env }) {
  try {
    const { catalogo_id, producto, marca, escala, cantidad } = await request.json();
    if (!catalogo_id || !producto || !cantidad) {
      return new Response(JSON.stringify({ error: 'catalogo_id, producto y cantidad son requeridos' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const serviceKey = env.SUPABASE_SERVICE_KEY;
    const existente = await buscarLotePorCatalogoId(serviceKey, catalogo_id);

    let loteId;
    if (existente) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/lotes_pedido?id=eq.${existente.id}`, {
        method: 'PATCH',
        headers: headersServicio(serviceKey),
        body: JSON.stringify({ cantidad })
      });
      if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
      loteId = existente.id;
    } else {
      const codigo = generarCodigoLote(producto, marca, await todosLosCodigos(serviceKey));
      const res = await fetch(`${SUPABASE_URL}/rest/v1/lotes_pedido`, {
        method: 'POST',
        headers: { ...headersServicio(serviceKey), Prefer: 'return=representation' },
        body: JSON.stringify({ producto, marca, escala, cantidad, codigo, catalogo_id, catalogo_variante: null })
      });
      if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
      const [creado] = await res.json();
      loteId = creado.id;
    }

    const activas = await contarOrdenesActivas(serviceKey, loteId);
    const disponibles = cantidad - activas;
    return new Response(JSON.stringify({ disponibles, agotado: disponibles <= 0 }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: todos los tests de `tests/loteSync.test.js` en verde, `5 passed` en total de archivos.

- [ ] **Step 5: Commit**

```bash
git add functions/api/lote-sync.js tests/loteSync.test.js
git commit -m "feat: endpoint lote-sync para crear/actualizar el lote automatico desde admin-app.html"
```

---

### Task 5: Funciones de datos y sincronización automática en `sistema-db.js`

**Files:**
- Modify: `sistema-db.js` (agregar funciones nuevas al final de la sección `LOTES DE PEDIDO`, y tocar `dbCreateLote`, `dbSaveOrden`, `dbUpdateEstadoOrden`, `dbDeleteOrden`, `dbVincularOrdenesALote`)

**Interfaces:**
- Consumes: `/api/stock-sync` (Task 3); `dbGetLote(id)`, `generarCodigoLote` (ya existentes).
- Produces: `dbUpdateLote(id, fields)`, `dbGetCatalogoLiviano()`, `dbSyncStockCatalogo(lote)`, `dbImportarLotesCatalogo()`, `_syncStockSiCorresponde(loteId)` — usados por `sistema.html` en Tasks 6 y 7. A partir de esta tarea, crear/editar un lote, guardar/cancelar/eliminar una orden, o vincular órdenes en bloque, dispara la sincronización sola si el lote tiene `catalogo_id`.

Sin cobertura de tests automatizados (ver Global Constraints) — se verifica manualmente en la consola del navegador.

- [ ] **Step 1: Agregar `_syncStockSiCorresponde`, `dbGetCatalogoLiviano`, `dbSyncStockCatalogo`, `dbUpdateLote` e `dbImportarLotesCatalogo`**

Insertar después de `dbDeleteLote` (última función de la sección `LOTES DE PEDIDO`, `sistema-db.js:379-382`):
```js

async function _syncStockSiCorresponde(loteId) {
  if (!loteId) return;
  try {
    const lote = await dbGetLote(loteId);
    if (lote.catalogo_id) await dbSyncStockCatalogo(lote);
  } catch (e) {
    console.error('No se pudo sincronizar el stock del catálogo:', e.message);
    alert('No se pudo sincronizar el stock en la página — revisalo a mano en Lotes de Pedido.');
  }
}

async function dbGetCatalogoLiviano() {
  const session = await dbGetSession();
  const res = await fetch('/api/stock-sync', {
    headers: { Authorization: 'Bearer ' + (session ? session.access_token : '') }
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Error al cargar el catálogo');
  return res.json();
}

async function dbSyncStockCatalogo(lote) {
  if (!lote || !lote.catalogo_id) return;
  const session = await dbGetSession();
  const res = await fetch('/api/stock-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (session ? session.access_token : '') },
    body: JSON.stringify({ catalogo_id: lote.catalogo_id, catalogo_variante: lote.catalogo_variante || null, disponibles: lote.disponibles })
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Error al sincronizar stock');
  return res.json();
}

async function dbUpdateLote(id, fields) {
  const { error } = await db.from('lotes_pedido').update(fields).eq('id', id);
  if (error) throw error;
  await _syncStockSiCorresponde(id);
  return dbGetLote(id);
}

async function dbImportarLotesCatalogo() {
  const catalogo = await dbGetCatalogoLiviano();
  const { data: lotesExistentes, error } = await db.from('lotes_pedido').select('codigo, catalogo_id');
  if (error) throw error;
  const idsYaVinculados = new Set(lotesExistentes.map(l => l.catalogo_id).filter(Boolean));
  const codigosExistentes = lotesExistentes.map(l => l.codigo);

  const candidatos = catalogo.filter(p =>
    !idsYaVinculados.has(p.id) &&
    p.estado !== 'Vendido' && !p.agotado &&
    !p.precio_d &&
    /^\d+$/.test(String(p.cantidad || '').trim())
  );

  let creados = 0;
  for (const p of candidatos) {
    const cantidad = parseInt(p.cantidad, 10);
    const codigo = generarCodigoLote(p.n, p.marca, codigosExistentes);
    codigosExistentes.push(codigo);
    await dbCreateLote({ producto: p.n, marca: p.marca, escala: p.escala, cantidad, codigo, catalogo_id: p.id, catalogo_variante: null });
    creados++;
  }
  return creados;
}
```

- [ ] **Step 2: Disparar la sincronización al crear un lote**

En `dbCreateLote` (`sistema-db.js:272-283`), reemplazar:
```js
async function dbCreateLote(lote) {
  let codigo = (lote.codigo || '').trim().toUpperCase();
  if (!codigo) {
    const { data: existentes, error: errBusq } = await db.from('lotes_pedido').select('codigo');
    if (errBusq) throw errBusq;
    codigo = generarCodigoLote(lote.producto, lote.marca, existentes.map(l => l.codigo));
  }
  const { id, ...fields } = lote;
  const { data, error } = await db.from('lotes_pedido').insert({ ...fields, codigo }).select().single();
  if (error) throw error;
  return data;
}
```
por:
```js
async function dbCreateLote(lote) {
  let codigo = (lote.codigo || '').trim().toUpperCase();
  if (!codigo) {
    const { data: existentes, error: errBusq } = await db.from('lotes_pedido').select('codigo');
    if (errBusq) throw errBusq;
    codigo = generarCodigoLote(lote.producto, lote.marca, existentes.map(l => l.codigo));
  }
  const { id, ...fields } = lote;
  const { data, error } = await db.from('lotes_pedido').insert({ ...fields, codigo }).select().single();
  if (error) throw error;
  await _syncStockSiCorresponde(data.id);
  return data;
}
```

- [ ] **Step 3: Disparar la sincronización al guardar una orden (creación, edición, y cambio de lote vinculado)**

En `dbSaveOrden` (`sistema-db.js:120-134`), reemplazar:
```js
async function dbSaveOrden(orden) {
  if (orden.id) {
    const { id, created_at, clientes, ...fields } = orden;
    _cleanOrdenFields(fields);
    const { data, error } = await db.from('ordenes').update(fields).eq('id', id).select().single();
    if (error) throw error;
    return data;
  } else {
    const { id, created_at, clientes, ...fields } = orden;
    _cleanOrdenFields(fields);
    const { data, error } = await db.from('ordenes').insert(fields).select().single();
    if (error) throw error;
    return data;
  }
}
```
por:
```js
async function dbSaveOrden(orden) {
  if (orden.id) {
    const { id, created_at, clientes, ...fields } = orden;
    const { data: previa } = await db.from('ordenes').select('lote_id').eq('id', id).single();
    _cleanOrdenFields(fields);
    const { data, error } = await db.from('ordenes').update(fields).eq('id', id).select().single();
    if (error) throw error;
    const loteAnterior = previa ? previa.lote_id : null;
    if (loteAnterior && loteAnterior !== data.lote_id) await _syncStockSiCorresponde(loteAnterior);
    await _syncStockSiCorresponde(data.lote_id);
    return data;
  } else {
    const { id, created_at, clientes, ...fields } = orden;
    _cleanOrdenFields(fields);
    const { data, error } = await db.from('ordenes').insert(fields).select().single();
    if (error) throw error;
    await _syncStockSiCorresponde(data.lote_id);
    return data;
  }
}
```

- [ ] **Step 4: Disparar la sincronización al cambiar el estado o eliminar una orden, y al vincular órdenes en bloque**

En `sistema-db.js:225-228`, reemplazar:
```js
async function dbUpdateEstadoOrden(id, estado) {
  const { error } = await db.from('ordenes').update({ estado }).eq('id', id);
  if (error) throw error;
}
```
por:
```js
async function dbUpdateEstadoOrden(id, estado) {
  const { data, error } = await db.from('ordenes').update({ estado }).eq('id', id).select('lote_id').single();
  if (error) throw error;
  await _syncStockSiCorresponde(data.lote_id);
}
```

En `sistema-db.js:136-139`, reemplazar:
```js
async function dbDeleteOrden(id) {
  const { error } = await db.from('ordenes').delete().eq('id', id);
  if (error) throw error;
}
```
por:
```js
async function dbDeleteOrden(id) {
  const { data: previa } = await db.from('ordenes').select('lote_id').eq('id', id).single();
  const { error } = await db.from('ordenes').delete().eq('id', id);
  if (error) throw error;
  if (previa) await _syncStockSiCorresponde(previa.lote_id);
}
```

En `sistema-db.js:374-377`, reemplazar:
```js
async function dbVincularOrdenesALote(ordenIds, loteId) {
  const { error } = await db.from('ordenes').update({ lote_id: loteId }).in('id', ordenIds);
  if (error) throw error;
}
```
por:
```js
async function dbVincularOrdenesALote(ordenIds, loteId) {
  const { error } = await db.from('ordenes').update({ lote_id: loteId }).in('id', ordenIds);
  if (error) throw error;
  await _syncStockSiCorresponde(loteId);
}
```

- [ ] **Step 5: Sanity check de que no se rompió nada**

Run: `npm test`
Expected: `5 passed` (este archivo no tiene tests propios; solo confirma que el entorno de test sigue sano).

- [ ] **Step 6: Verificación manual en consola del navegador**

Requiere haber hecho el Step 1 de Task 1 (columnas nuevas) y desplegado los Tasks 2-4 (o probar contra el deploy de preview de Cloudflare Pages, donde sí corren las Functions).

1. Levantar el sitio, abrir `sistema.html`, iniciar sesión.
2. Consola del navegador:
   ```js
   const lote = await dbCreateLote({ producto: 'ZZZTEST Sync', marca: 'Test', escala: '1:6', cantidad: 2, catalogo_id: 'zzztest-id-1' });
   ```
   Esperado: no tira error (si `catalogo_id` no existe de verdad en el catálogo, `dbSyncStockCatalogo` fallará dentro de `_syncStockSiCorresponde`, que atrapa el error y solo muestra el `alert` — la creación del lote en Supabase igual se completa). Anotar `lote.id`.
3. Si se quiere probar el camino feliz completo (sync real), usar en cambio el `id` de un producto real de bajo riesgo del catálogo (`await fetch('/api/catalog').then(r=>r.json())` para inspeccionar ids) y confirmar en `productos.json` (recargando `/api/catalog`) que su `cantidad`/`agotado` cambiaron después del Step 4 de abajo.
4. `await dbGetLote(lote.id)` → confirmar `disponibles: 2`.
5. **Limpieza:** `DELETE FROM lotes_pedido WHERE producto = 'ZZZTEST Sync';` en el SQL Editor de Supabase. Si se usó un `catalogo_id` real y se disparó un sync real, revertirlo a mano desde `admin-app.html` (o dejarlo, si el valor que quedó es el correcto).

- [ ] **Step 7: Commit**

```bash
git add sistema-db.js
git commit -m "feat: sincronizacion automatica de stock del catalogo desde lotes y ordenes"
```

---

### Task 6: Editar lote + vincular producto del catálogo en `sistema.html`

**Files:**
- Modify: `sistema.html` — modal "Nuevo lote" (`sistema.html:1398-1432`, ver contenido actual citado abajo)
- Modify: `sistema.html` — fila de lote en la tabla (`sistema.html:1386-1389`)
- Modify: `sistema.html` — función `uvLotes()` (`sistema.html:1759` en adelante)

**Interfaces:**
- Consumes: `dbUpdateLote(id, fields)`, `dbGetCatalogoLiviano()` (Task 5); helper global `normalize(s)`.
- Produces: botón "Editar" por lote; el modal de lote (reutilizado para alta y edición) gana un buscador de producto del catálogo y un selector de variante — usado también por Task 7.

- [ ] **Step 1: Agregar el botón "Editar" a cada fila**

En `sistema.html:1386-1389`, reemplazar:
```html
                    <td style="white-space:nowrap">
                      <button class="btn-sm btn-ghost" @click="abrirVincular(l)">Buscar y vincular órdenes</button>
                      <button class="btn-sm btn-ghost" style="color:var(--red)" x-show="!l.tieneOrdenes" @click="eliminarLote(l)">Eliminar</button>
                    </td>
```
por:
```html
                    <td style="white-space:nowrap">
                      <button class="btn-sm btn-ghost" @click="abrirEditar(l)">Editar</button>
                      <button class="btn-sm btn-ghost" @click="abrirVincular(l)">Buscar y vincular órdenes</button>
                      <button class="btn-sm btn-ghost" style="color:var(--red)" x-show="!l.tieneOrdenes" @click="eliminarLote(l)">Eliminar</button>
                    </td>
```

- [ ] **Step 2: Agregar el buscador de catálogo y el selector de variante al modal, y hacer el título/botón dinámicos**

En `sistema.html:1398-1432` (modal "Nuevo lote"), reemplazar el bloque completo:
```html
      <!-- Modal nuevo lote -->
      <div class="modal-bg" :class="{open:modalNuevo}" @click.self="modalNuevo=false">
        <div class="modal">
          <button class="modal-close" @click="modalNuevo=false">✕</button>
          <div class="modal-title">Nuevo lote de pedido</div>
          <div class="form-row">
            <div><label class="form-label">Producto *</label>
              <input class="form-input" type="text" x-model="form.producto" placeholder="Ej: Jinx" style="font-size:16px"></div>
            <div><label class="form-label">Marca</label>
              <input class="form-input" type="text" x-model="form.marca" placeholder="Hot Toys..." style="font-size:16px"></div>
          </div>
          <div class="form-row">
            <div><label class="form-label">Escala</label>
              <input class="form-input" type="text" x-model="form.escala" placeholder="1:6, 1:12..." style="font-size:16px"></div>
            <div><label class="form-label">Cantidad pedida *</label>
              <input class="form-input" type="number" x-model.number="form.cantidad" min="1" style="font-size:16px"></div>
          </div>
          <div class="form-row">
            <div><label class="form-label">Código</label>
              <input class="form-input" type="text" x-model="form.codigo" placeholder="Auto si se deja vacío" style="font-size:16px"></div>
            <div><label class="form-label">Proveedor</label>
              <input class="form-input" type="text" x-model="form.proveedor" placeholder="ebay, gundam, lts..." style="font-size:16px"></div>
          </div>
          <div class="form-row-1">
            <label class="form-label">Fecha de pedido</label>
            <input class="form-input" type="date" x-model="form.fecha_pedido" style="font-size:16px">
          </div>
          <div class="modal-footer">
            <button class="btn-sm btn-ghost" @click="modalNuevo=false">Cancelar</button>
            <button class="btn-sm btn-purple" @click="crearLote()" :disabled="guardando">
              <span x-text="guardando?'Creando...':'Crear lote'"></span>
            </button>
          </div>
        </div>
      </div>
```
por:
```html
      <!-- Modal nuevo/editar lote -->
      <div class="modal-bg" :class="{open:modalNuevo}" @click.self="modalNuevo=false">
        <div class="modal">
          <button class="modal-close" @click="modalNuevo=false">✕</button>
          <div class="modal-title" x-text="form.id ? 'Editar lote de pedido' : 'Nuevo lote de pedido'"></div>
          <div class="form-row">
            <div><label class="form-label">Producto *</label>
              <input class="form-input" type="text" x-model="form.producto" placeholder="Ej: Jinx" style="font-size:16px"></div>
            <div><label class="form-label">Marca</label>
              <input class="form-input" type="text" x-model="form.marca" placeholder="Hot Toys..." style="font-size:16px"></div>
          </div>
          <div class="form-row">
            <div><label class="form-label">Escala</label>
              <input class="form-input" type="text" x-model="form.escala" placeholder="1:6, 1:12..." style="font-size:16px"></div>
            <div><label class="form-label">Cantidad pedida *</label>
              <input class="form-input" type="number" x-model.number="form.cantidad" min="1" style="font-size:16px"></div>
          </div>
          <div class="form-row">
            <div><label class="form-label">Código</label>
              <input class="form-input" type="text" x-model="form.codigo" placeholder="Auto si se deja vacío" style="font-size:16px"></div>
            <div><label class="form-label">Proveedor</label>
              <input class="form-input" type="text" x-model="form.proveedor" placeholder="ebay, gundam, lts..." style="font-size:16px"></div>
          </div>
          <div class="form-row-1">
            <label class="form-label">Fecha de pedido</label>
            <input class="form-input" type="date" x-model="form.fecha_pedido" style="font-size:16px">
          </div>
          <div class="form-row-1" style="margin-top:12px;padding:14px;background:var(--bg3);border:1px solid var(--border2);border-radius:8px">
            <label class="form-label">Producto del catálogo (opcional)</label>
            <template x-if="!form.catalogo_id">
              <div style="position:relative">
                <input class="form-input" type="text" x-model="catalogoBusqueda" @input="buscarCatalogo()" placeholder="Buscar por nombre o marca..." style="font-size:16px">
                <div x-show="catalogoFiltrado.length>0" style="position:absolute;top:100%;left:0;right:0;z-index:300;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;max-height:200px;overflow-y:auto;margin-top:4px">
                  <template x-for="p in catalogoFiltrado" :key="p.id">
                    <button type="button" @click="seleccionarCatalogo(p)" style="display:block;width:100%;text-align:left;padding:10px 14px;background:none;border:none;color:var(--text);font-size:14px;font-family:inherit;cursor:pointer">
                      <span x-text="p.n"></span>
                      <span style="color:var(--muted2)" x-text="' · ' + (p.marca||'')"></span>
                    </button>
                  </template>
                </div>
              </div>
            </template>
            <template x-if="form.catalogo_id">
              <div>
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span style="font-size:14px;color:#fff" x-text="catalogoSeleccionado ? catalogoSeleccionado.n : form.catalogo_id"></span>
                  <button type="button" class="btn-sm btn-ghost" @click="quitarCatalogo()">Quitar vínculo</button>
                </div>
                <div x-show="catalogoSeleccionado && catalogoSeleccionado.precio_d" style="margin-top:8px">
                  <label class="form-label">Variante</label>
                  <select class="form-select" x-model="form.catalogo_variante" style="font-size:16px">
                    <option value="">Ninguna (producto completo)</option>
                    <option value="regular">Regular</option>
                    <option value="deluxe">Deluxe</option>
                  </select>
                </div>
              </div>
            </template>
          </div>
          <div class="modal-footer">
            <button class="btn-sm btn-ghost" @click="modalNuevo=false">Cancelar</button>
            <button class="btn-sm btn-purple" @click="crearLote()" :disabled="guardando">
              <span x-text="guardando ? (form.id ? 'Guardando...' : 'Creando...') : (form.id ? 'Guardar cambios' : 'Crear lote')"></span>
            </button>
          </div>
        </div>
      </div>
```

- [ ] **Step 3: Actualizar `uvLotes()` — estado, form, y métodos de catálogo**

En `sistema.html:1759` en adelante, dentro de `uvLotes()`, reemplazar:
```js
    form: { producto: '', marca: '', escala: '', cantidad: 1, codigo: '', proveedor: '', fecha_pedido: '', notas: '' },
    modalVincular: false, loteActivo: null, candidatos: [], seleccionados: [], buscandoCandidatos: false,
```
por:
```js
    form: { id: null, producto: '', marca: '', escala: '', cantidad: 1, codigo: '', proveedor: '', fecha_pedido: '', notas: '', catalogo_id: '', catalogo_variante: '' },
    modalVincular: false, loteActivo: null, candidatos: [], seleccionados: [], buscandoCandidatos: false,
    catalogoTodos: [], catalogoBusqueda: '', catalogoSeleccionado: null, importando: false,
    get catalogoFiltrado() {
      const q = normalize(this.catalogoBusqueda);
      if (!q) return [];
      return this.catalogoTodos.filter(p => normalize(p.n).includes(q) || normalize(p.marca || '').includes(q)).slice(0, 8);
    },
    async buscarCatalogo() {
      if (this.catalogoTodos.length === 0) this.catalogoTodos = await dbGetCatalogoLiviano();
    },
    seleccionarCatalogo(p) {
      this.form.catalogo_id = p.id;
      this.catalogoSeleccionado = p;
      this.catalogoBusqueda = '';
      this.form.catalogo_variante = '';
    },
    quitarCatalogo() {
      this.form.catalogo_id = '';
      this.form.catalogo_variante = '';
      this.catalogoSeleccionado = null;
    },
```

- [ ] **Step 4: Reemplazar `abrirNuevo()`/`crearLote()` y agregar `abrirEditar()`**

En `uvLotes()`, reemplazar:
```js
    abrirNuevo() {
      this.form = { producto: '', marca: '', escala: '', cantidad: 1, codigo: '', proveedor: '', fecha_pedido: '', notas: '' };
      this.modalNuevo = true;
    },
    async crearLote() {
      if (!this.form.producto.trim()) { alert('El producto es obligatorio'); return; }
      if (!this.form.cantidad || this.form.cantidad < 1) { alert('La cantidad debe ser mayor a 0'); return; }
      this.guardando = true;
      try {
        const nuevo = await dbCreateLote(this.form);
        this.modalNuevo = false;
        this.lotes.unshift({ ...nuevo, vendidas: 0, disponibles: nuevo.cantidad, tieneOrdenes: false, clientes: [] });
        await this.abrirVincular(nuevo);
      } catch(e) { alert('Error: ' + e.message); }
      finally { this.guardando = false; }
    },
```
por:
```js
    abrirNuevo() {
      this.form = { id: null, producto: '', marca: '', escala: '', cantidad: 1, codigo: '', proveedor: '', fecha_pedido: '', notas: '', catalogo_id: '', catalogo_variante: '' };
      this.catalogoSeleccionado = null;
      this.catalogoBusqueda = '';
      this.modalNuevo = true;
    },
    abrirEditar(l) {
      this.form = { id: l.id, producto: l.producto, marca: l.marca || '', escala: l.escala || '', cantidad: l.cantidad, codigo: l.codigo, proveedor: l.proveedor || '', fecha_pedido: l.fecha_pedido || '', notas: l.notas || '', catalogo_id: l.catalogo_id || '', catalogo_variante: l.catalogo_variante || '' };
      this.catalogoSeleccionado = l.catalogo_id ? { id: l.catalogo_id, n: l.producto, marca: l.marca } : null;
      this.catalogoBusqueda = '';
      this.modalNuevo = true;
    },
    async crearLote() {
      if (!this.form.producto.trim()) { alert('El producto es obligatorio'); return; }
      if (!this.form.cantidad || this.form.cantidad < 1) { alert('La cantidad debe ser mayor a 0'); return; }
      this.guardando = true;
      try {
        const datos = { ...this.form, catalogo_id: this.form.catalogo_id || null, catalogo_variante: this.form.catalogo_variante || null };
        if (datos.id) {
          const { id, ...fields } = datos;
          await dbUpdateLote(id, fields);
          this.modalNuevo = false;
          await this.cargar();
        } else {
          delete datos.id;
          const nuevo = await dbCreateLote(datos);
          this.modalNuevo = false;
          this.lotes.unshift({ ...nuevo, vendidas: 0, disponibles: nuevo.cantidad, tieneOrdenes: false, clientes: [] });
          await this.abrirVincular(nuevo);
        }
      } catch(e) { alert('Error: ' + e.message); }
      finally { this.guardando = false; }
    },
```

- [ ] **Step 5: Verificación manual**

1. Levantar el sitio, abrir `sistema.html`, iniciar sesión.
2. Ir a Órdenes → Lotes de Pedido → "+ Nuevo lote". Escribir Producto: `ZZZTEST Editar`, Marca: `Test`, Cantidad: `4`. En "Producto del catálogo", buscar cualquier figura real (ej. "Robin") y seleccionarla. Confirmar que aparece el nombre elegido con botón "Quitar vínculo" (y el selector de Variante solo si esa figura tiene Deluxe). Crear el lote (en el modal de vinculación que se abre después, cerrar sin vincular nada).
3. En la fila del lote recién creado, click "Editar". Esperado: el modal se abre en modo edición ("Editar lote de pedido"), con todos los campos precargados incluyendo el producto del catálogo ya vinculado.
4. Cambiar Cantidad a `6`, click "Guardar cambios". Esperado: el modal se cierra, la fila muestra Pedidas=6.
5. Click "Editar" de nuevo → "Quitar vínculo" → "Guardar cambios". Esperado: el lote queda sin producto de catálogo vinculado.
6. **Limpieza:** `DELETE FROM lotes_pedido WHERE producto = 'ZZZTEST Editar';` en el SQL Editor de Supabase. Si el producto real elegido en el paso 2 tenía `agotado`/`cantidad` distintos después de la prueba (por el sync automático de Task 5), revisar y corregir a mano en `admin-app.html` si hizo falta.

- [ ] **Step 6: Commit**

```bash
git add sistema.html
git commit -m "feat: editar lote y vincularlo a un producto del catalogo"
```

---

### Task 7: Botón "Importar figuras del catálogo" en la vista de Lotes

**Files:**
- Modify: `sistema.html` — header de la vista Lotes (`sistema.html:1342-1349`)
- Modify: `sistema.html` — `uvLotes()` (agregar `importando` y `importarCatalogo()`)

**Interfaces:**
- Consumes: `dbImportarLotesCatalogo()` (Task 5).

- [ ] **Step 1: Agregar el botón**

En `sistema.html:1342-1349`, reemplazar:
```html
      <div class="page-header">
        <h1 class="page-title">Lotes de Pedido</h1>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn-sm" :class="ordenPor==='alfabetico' ? 'btn-purple' : 'btn-ghost'" @click="ordenPor='alfabetico'">A-Z</button>
          <button class="btn-sm" :class="ordenPor==='fecha' ? 'btn-purple' : 'btn-ghost'" @click="ordenPor='fecha'">Más reciente</button>
          <button class="btn-sm btn-purple" @click="abrirNuevo()">+ Nuevo lote</button>
        </div>
      </div>
```
por:
```html
      <div class="page-header">
        <h1 class="page-title">Lotes de Pedido</h1>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn-sm" :class="ordenPor==='alfabetico' ? 'btn-purple' : 'btn-ghost'" @click="ordenPor='alfabetico'">A-Z</button>
          <button class="btn-sm" :class="ordenPor==='fecha' ? 'btn-purple' : 'btn-ghost'" @click="ordenPor='fecha'">Más reciente</button>
          <button class="btn-sm btn-ghost" @click="importarCatalogo()" :disabled="importando">
            <span x-text="importando ? 'Importando...' : 'Importar figuras del catálogo'"></span>
          </button>
          <button class="btn-sm btn-purple" @click="abrirNuevo()">+ Nuevo lote</button>
        </div>
      </div>
```

- [ ] **Step 2: Agregar `importarCatalogo()` a `uvLotes()`**

`importando` ya quedó agregado al estado en Task 6 Step 3. En `uvLotes()`, reemplazar el final (método `eliminarLote` y el cierre del objeto/función):
```js
    async eliminarLote(l) {
      if (l.tieneOrdenes) return;
      if (!confirm('¿Eliminar el lote ' + l.codigo + '? Esta acción no se puede deshacer.')) return;
      try {
        await dbDeleteLote(l.id);
        this.lotes = this.lotes.filter(x => x.id !== l.id);
      } catch(e) { alert('Error al eliminar: ' + e.message); }
    },
  };
}
```
por:
```js
    async eliminarLote(l) {
      if (l.tieneOrdenes) return;
      if (!confirm('¿Eliminar el lote ' + l.codigo + '? Esta acción no se puede deshacer.')) return;
      try {
        await dbDeleteLote(l.id);
        this.lotes = this.lotes.filter(x => x.id !== l.id);
      } catch(e) { alert('Error al eliminar: ' + e.message); }
    },
    async importarCatalogo() {
      if (!confirm('Esto va a crear un lote nuevo para cada figura del catálogo que todavía no tenga uno vinculado. ¿Continuar?')) return;
      this.importando = true;
      try {
        const creados = await dbImportarLotesCatalogo();
        alert(creados + ' lote(s) nuevo(s) creado(s).');
        await this.cargar();
      } catch(e) { alert('Error al importar: ' + e.message); }
      finally { this.importando = false; }
    },
  };
}
```

- [ ] **Step 3: Verificación manual**

⚠️ Este botón crea lotes reales en Supabase para **todo** el catálogo que cumpla los criterios del spec — no ejecutarlo en producción hasta haber completado el paso manual de vincular a mano los lotes de Hot Toys que ya existen hoy (ver Flujo 4 del spec), o se van a crear lotes duplicados para esos productos.

1. Levantar el sitio, abrir `sistema.html`, iniciar sesión, ir a Lotes de Pedido.
2. Click "Importar figuras del catálogo" → confirmar. Esperado: aparece un `alert` con la cantidad de lotes creados, y la tabla se recarga mostrándolos.
3. Click de nuevo en "Importar figuras del catálogo". Esperado: esta vez crea 0 lotes nuevos (todos los candidatos ya tienen `catalogo_id` vinculado).
4. Revisar en la tabla algunos de los lotes recién creados: deben tener Disponibles = Pedidas (0 vendidas), y el nombre/marca copiados del catálogo.
5. **Si esto se corrió por error en producción:** identificar los lotes recién creados (los de `created_at` más reciente, sin órdenes vinculadas) y borrarlos desde la UI (botón "Eliminar", visible porque no tienen órdenes) o por SQL.

- [ ] **Step 4: Commit**

```bash
git add sistema.html
git commit -m "feat: importar figuras del catalogo como lotes de pedido"
```

---

### Task 8: Badge "Agotado" reconoce el campo `agotado` en `index_template.html`

**Files:**
- Modify: `index_template.html` (el badge de "Agotado" en `makeCard`)
- Regenerate: `index.html` (vía `inject_data.py`, no se edita a mano)

**Interfaces:**
- Consumes: campo nuevo `p.agotado` (booleano), escrito por `/api/stock-sync` (Task 3) y por el checkbox manual de Task 9.

- [ ] **Step 1: Ubicar y modificar la lógica del badge**

Buscar en `index_template.html` (buscar el texto `badgeText="Agotado"` — debería estar en el mismo lugar que hoy está en `index.html`, ya que `inject_data.py` no toca el resto del HTML). Reemplazar:
```js
  if(estadoLow==="vendido"||dispLow==="vendido"){badgeText="Agotado";badgeCls="badge-agotado";}
```
por:
```js
  if(estadoLow==="vendido"||dispLow==="vendido"||p.agotado){badgeText="Agotado";badgeCls="badge-agotado";}
```

- [ ] **Step 2: Regenerar `index.html`**

Run: `python inject_data.py --template index_template.html --data productos.json --output index.html`
Expected: imprime `"646 figuras en 6 categorias"` (o el conteo actual) y `"index.html generado: NNNN KB"`.

- [ ] **Step 3: Verificación manual**

1. En `productos.json`, elegir temporalmente un producto de prueba y ponerle `"agotado": true` a mano (o usar un editor de texto para buscar un `"id":"..."` y agregar el campo justo después) — **no commitear este cambio de prueba**.
2. Regenerar `index.html` con el comando del Step 2.
3. Levantar el sitio (`python -m http.server 8000`), abrir `http://localhost:8000/index.html`, buscar esa figura. Esperado: aparece con el badge "Agotado" aunque su `estado` no sea "Vendido".
4. Revertir el cambio de prueba en `productos.json` (`git checkout -- productos.json` si no hay otros cambios pendientes en ese archivo, o deshacer manualmente) y regenerar `index.html` de nuevo con el comando del Step 2 para dejarlo limpio.

- [ ] **Step 4: Commit**

```bash
git add index_template.html index.html
git commit -m "feat: el badge Agotado tambien reacciona al campo agotado del catalogo"
```

---

### Task 9: Checkbox "Agotado" y alta automática de lote en `admin-app.html`

**Files:**
- Modify: `admin-app.html` — checkboxes de flags (`admin-app.html:197-204` alta, `314-321` edición)
- Modify: `admin-app.html` — `buildAddProduct()` (`admin-app.html:491-524`), `resetAddForm()` (`admin-app.html:526-535`), `openEdit()` (`admin-app.html:725-756`), `saveEdit()` (`admin-app.html:764-801`), `saveAdd()` (`admin-app.html:653-666`)

**Interfaces:**
- Consumes: `POST /api/lote-sync` (Task 4).

- [ ] **Step 1: Agregar el checkbox "Agotado" en el formulario de alta**

En `admin-app.html:197-204`, reemplazar:
```html
    <div class="section-title">Flags</div>
    <div class="checks">
      <label class="check-item"><input type="checkbox" id="add-destacado"><span>Destacado</span></label>
      <label class="check-item"><input type="checkbox" id="add-oferta"><span>Oferta</span></label>
      <label class="check-item"><input type="checkbox" id="add-agotado-r"><span>Agotado Regular</span></label>
      <label class="check-item"><input type="checkbox" id="add-agotado-d"><span>Agotado Deluxe</span></label>
      <label class="check-item"><input type="checkbox" id="add-preorden-mes"><span>Pre orden del mes</span></label>
    </div>
```
por:
```html
    <div class="section-title">Flags</div>
    <div class="checks">
      <label class="check-item"><input type="checkbox" id="add-destacado"><span>Destacado</span></label>
      <label class="check-item"><input type="checkbox" id="add-oferta"><span>Oferta</span></label>
      <label class="check-item"><input type="checkbox" id="add-agotado"><span>Agotado</span></label>
      <label class="check-item"><input type="checkbox" id="add-agotado-r"><span>Agotado Regular</span></label>
      <label class="check-item"><input type="checkbox" id="add-agotado-d"><span>Agotado Deluxe</span></label>
      <label class="check-item"><input type="checkbox" id="add-preorden-mes"><span>Pre orden del mes</span></label>
    </div>
```

- [ ] **Step 2: Agregar el checkbox "Agotado" en el formulario de edición**

En `admin-app.html:314-321`, reemplazar:
```html
    <div class="section-title">Flags</div>
    <div class="checks">
      <label class="check-item"><input type="checkbox" id="edit-destacado"><span>Destacado</span></label>
      <label class="check-item"><input type="checkbox" id="edit-oferta"><span>Oferta</span></label>
      <label class="check-item"><input type="checkbox" id="edit-agotado-r"><span>Agotado Regular</span></label>
      <label class="check-item"><input type="checkbox" id="edit-agotado-d"><span>Agotado Deluxe</span></label>
      <label class="check-item"><input type="checkbox" id="edit-preorden-mes"><span>Pre orden del mes</span></label>
    </div>
```
por:
```html
    <div class="section-title">Flags</div>
    <div class="checks">
      <label class="check-item"><input type="checkbox" id="edit-destacado"><span>Destacado</span></label>
      <label class="check-item"><input type="checkbox" id="edit-oferta"><span>Oferta</span></label>
      <label class="check-item"><input type="checkbox" id="edit-agotado"><span>Agotado</span></label>
      <label class="check-item"><input type="checkbox" id="edit-agotado-r"><span>Agotado Regular</span></label>
      <label class="check-item"><input type="checkbox" id="edit-agotado-d"><span>Agotado Deluxe</span></label>
      <label class="check-item"><input type="checkbox" id="edit-preorden-mes"><span>Pre orden del mes</span></label>
    </div>
```

- [ ] **Step 3: Leer/escribir el campo `agotado` en `buildAddProduct`, `resetAddForm` y `openEdit`/`saveEdit`**

En `admin-app.html:507-510` (dentro de `buildAddProduct`), reemplazar:
```js
    destacado:getBool('add-destacado'),
    oferta:getBool('add-oferta'),
    agotado_r:getBool('add-agotado-r'),
    agotado_d:getBool('add-agotado-d'),
```
por:
```js
    destacado:getBool('add-destacado'),
    oferta:getBool('add-oferta'),
    agotado:getBool('add-agotado'),
    agotado_r:getBool('add-agotado-r'),
    agotado_d:getBool('add-agotado-d'),
```

En `admin-app.html:530` (`resetAddForm`), reemplazar:
```js
  ['add-destacado','add-oferta','add-agotado-r','add-agotado-d','add-preorden-mes'].forEach(function(id){setBool(id,false);});
```
por:
```js
  ['add-destacado','add-oferta','add-agotado','add-agotado-r','add-agotado-d','add-preorden-mes'].forEach(function(id){setBool(id,false);});
```

En `admin-app.html:745-748` (`openEdit`), reemplazar:
```js
  setBool('edit-destacado',p.destacado);
  setBool('edit-oferta',p.oferta);
  setBool('edit-agotado-r',p.agotado_r);
  setBool('edit-agotado-d',p.agotado_d);
```
por:
```js
  setBool('edit-destacado',p.destacado);
  setBool('edit-oferta',p.oferta);
  setBool('edit-agotado',p.agotado);
  setBool('edit-agotado-r',p.agotado_r);
  setBool('edit-agotado-d',p.agotado_d);
```

En `admin-app.html:784-787` (dentro de `saveEdit`, dentro del `Object.assign`), reemplazar:
```js
    destacado:getBool('edit-destacado'),
    oferta:getBool('edit-oferta'),
    agotado_r:getBool('edit-agotado-r'),
    agotado_d:getBool('edit-agotado-d')
```
por:
```js
    destacado:getBool('edit-destacado'),
    oferta:getBool('edit-oferta'),
    agotado:getBool('edit-agotado'),
    agotado_r:getBool('edit-agotado-r'),
    agotado_d:getBool('edit-agotado-d')
```

- [ ] **Step 4: Agregar `syncLoteStock` y llamarla antes de guardar**

Agregar justo antes de `async function saveAdd(){` (`admin-app.html:653`):
```js
async function syncLoteStock(p){
  if(p.precio_d || !p.cantidad || !/^\d+$/.test(String(p.cantidad).trim())) return;
  try{
    var res = await fetch('/api/lote-sync', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ catalogo_id: p.id, producto: p.n, marca: p.marca, escala: p.escala, cantidad: parseInt(p.cantidad, 10) })
    });
    var data = await res.json();
    if(!res.ok) throw new Error(data.error);
    p.cantidad = String(data.disponibles);
    p.agotado = data.agotado;
  }catch(e){
    setStatus('Aviso: no se pudo sincronizar el lote de stock ('+e.message+'), el producto se guarda igual','orange');
  }
}

```

En `saveAdd` (`admin-app.html:653-666`), reemplazar:
```js
async function saveAdd(){
  var name=getField('add-name');if(!name)return setStatus('El nombre es obligatorio','orange');
  var cat=getField('add-cat');if(!cat)return setStatus('Elegi una categoria','orange');
  var btn=document.getElementById('btn-save-add');
  if(btn) btn.disabled=true;
  setStatus('Guardando...','orange');
  try{
    await catalogAction({action:'add', category:cat, product:buildAddProduct()});
    setStatus('Guardado — el sitio se actualiza en ~30 seg','green');
    _catalog=null;
    resetAddForm();
  }catch(e){setStatus('Error: '+e.message,'red');}
  finally{ if(btn) btn.disabled=false; }
}
```
por:
```js
async function saveAdd(){
  var name=getField('add-name');if(!name)return setStatus('El nombre es obligatorio','orange');
  var cat=getField('add-cat');if(!cat)return setStatus('Elegi una categoria','orange');
  var btn=document.getElementById('btn-save-add');
  if(btn) btn.disabled=true;
  setStatus('Guardando...','orange');
  try{
    var product=buildAddProduct();
    await syncLoteStock(product);
    await catalogAction({action:'add', category:cat, product:product});
    setStatus('Guardado — el sitio se actualiza en ~30 seg','green');
    _catalog=null;
    resetAddForm();
  }catch(e){setStatus('Error: '+e.message,'red');}
  finally{ if(btn) btn.disabled=false; }
}
```

En `saveEdit` (`admin-app.html:793-801`), reemplazar:
```js
  var newCat=getField('edit-cat');
  setStatus('Guardando...','orange');
  try{
    await catalogAction({action:'edit', productId:productId, product:updated, newCategory:newCat});
    _catalog=null;
    setStatus('Cambios guardados','green');
    cancelEdit();renderProductList();
  }catch(e){setStatus('Error: '+e.message,'red');}
}
```
por:
```js
  var newCat=getField('edit-cat');
  setStatus('Guardando...','orange');
  try{
    await syncLoteStock(updated);
    await catalogAction({action:'edit', productId:productId, product:updated, newCategory:newCat});
    _catalog=null;
    setStatus('Cambios guardados','green');
    cancelEdit();renderProductList();
  }catch(e){setStatus('Error: '+e.message,'red');}
}
```

- [ ] **Step 5: Verificación manual**

Requiere que Task 4 esté desplegada y `SUPABASE_SERVICE_KEY` configurada en Cloudflare (ver Global Constraints) — probar contra el deploy de preview/producción de Cloudflare Pages, no contra `python -m http.server` (que no corre Functions).

1. Abrir `/admin`, loguearse, ir a "Agregar figura".
2. Completar Nombre: `ZZZTEST Admin Sync`, Categoría: cualquiera, Cantidad disponible: `2`. Dejar el checkbox "Agotado" destildado. Guardar.
3. En Supabase SQL Editor: `SELECT * FROM lotes_pedido WHERE producto = 'ZZZTEST Admin Sync';` — esperado: 1 fila, `cantidad = 2`, `catalogo_id` = el id generado para esa figura (visible en `/api/catalog` buscando el nombre), `catalogo_variante IS NULL`.
4. Ir a Editar esa misma figura, cambiar Cantidad disponible a `5`, guardar. Repetir el `SELECT`: la misma fila ahora tiene `cantidad = 5` (no se creó una segunda).
5. **Limpieza:** en `admin-app.html`, abrir esa figura en modo edición y click "Eliminar" (borra el producto del catálogo real). En Supabase: `DELETE FROM lotes_pedido WHERE producto = 'ZZZTEST Admin Sync';`.
6. Repetir el alta con un producto que tenga "Precio Deluxe" cargado (`add-precio-d`). Esperado: **no** se crea ningún lote en Supabase para ese producto (verificar con el mismo `SELECT` — 0 filas).

- [ ] **Step 6: Commit**

```bash
git add admin-app.html
git commit -m "feat: checkbox Agotado y alta automatica de lote de stock desde admin-app.html"
```

---

## Resumen de archivos tocados

| Archivo | Tareas |
|---|---|
| Supabase (manual) | Task 1 |
| Cloudflare env vars (manual) | Task 4 (`SUPABASE_SERVICE_KEY`) |
| `functions/_lib/githubCatalog.js` | Task 2 |
| `functions/api/catalog.js` | Task 2 |
| `functions/api/stock-sync.js` | Task 3 |
| `functions/api/_middleware.js` | Task 3 |
| `functions/api/lote-sync.js` | Task 4 |
| `tests/githubCatalog.test.js`, `tests/stockSync.test.js`, `tests/middleware.test.js`, `tests/loteSync.test.js` | Tasks 2, 3, 4 |
| `sistema-db.js` | Task 5 |
| `sistema.html` | Tasks 6, 7 |
| `index_template.html` / `index.html` | Task 8 |
| `admin-app.html` | Task 9 |
