const GH_API = 'https://api.github.com';

function ghHeaders(token) {
  return {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'UV-Store-Admin/1.0'
  };
}

async function readGitHub(token, repo) {
  const res = await fetch(`${GH_API}/repos/${repo}/contents/productos.json`, {
    headers: { ...ghHeaders(token), 'Cache-Control': 'no-cache' }
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  const data = await res.json();
  let text;
  if (data.content) {
    const bytes = Uint8Array.from(atob(data.content.replace(/\s/g, '')), c => c.charCodeAt(0));
    text = new TextDecoder().decode(bytes);
  } else if (data.download_url) {
    const dlRes = await fetch(data.download_url);
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

async function writeGitHub(token, repo, catalog, sha) {
  const json = JSON.stringify(catalog, null, 2);
  const bytes = new TextEncoder().encode(json);
  const b64 = bytesToBase64(bytes);
  const res = await fetch(`${GH_API}/repos/${repo}/contents/productos.json`, {
    method: 'PUT',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Update catalog — UV Store GT Admin', content: b64, sha })
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`GitHub ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ── KV helpers ──────────────────────────────────────────────────────────────
// KV es la fuente de verdad para escrituras. GitHub es secundario (historial).
// Las escrituras en KV son atómicas — no hay race condition.

async function kvGet(kv) {
  const val = await kv.get('catalog');
  return val ? JSON.parse(val) : null;
}

async function kvPut(kv, catalog) {
  await kv.put('catalog', JSON.stringify(catalog));
}

// Escribe en KV (fuente de verdad) y luego en GitHub (historial/sitio estático).
// Si GitHub falla, el catálogo queda en KV igualmente.
async function persistCatalog(env, catalog) {
  await kvPut(env.UV_CATALOG, catalog);
  try {
    const { sha } = await readGitHub(env.GITHUB_TOKEN, env.GITHUB_REPO);
    await writeGitHub(env.GITHUB_TOKEN, env.GITHUB_REPO, catalog, sha);
  } catch (e) {
    // GitHub falló pero KV ya tiene el dato — no es crítico
    console.error('GitHub write failed (KV updated):', e.message);
  }
}

// Lee el catálogo desde KV. Si KV está vacío (primer uso), cae a GitHub.
async function readCatalog(env) {
  const fromKV = await kvGet(env.UV_CATALOG);
  if (fromKV) return fromKV;
  const { catalog } = await readGitHub(env.GITHUB_TOKEN, env.GITHUB_REPO);
  await kvPut(env.UV_CATALOG, catalog); // poblar KV
  return catalog;
}

// ── Handlers ────────────────────────────────────────────────────────────────

export async function onRequestGet({ env }) {
  try {
    const catalog = await readCatalog(env);
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

    // ── Backwards compat: { catalog } full replace ──
    if (body.catalog && !body.action) {
      await persistCatalog(env, body.catalog);
      return ok();
    }

    const { action } = body;

    if (action === 'add') {
      const { category, product } = body;
      if (!category || !product) return err400('add requiere category y product');
      const catalog = await readCatalog(env);
      if (!catalog[category]) catalog[category] = { products: [] };
      if (product.preorden_mes) {
        for (const c in catalog) {
          (catalog[c].products || []).forEach(p => { delete p.preorden_mes; });
        }
      }
      catalog[category].products.unshift(product);
      await persistCatalog(env, catalog);
      return ok();
    }

    if (action === 'edit') {
      const { productId, product, newCategory } = body;
      if (!productId || !product) return err400('edit requiere productId y product');
      const catalog = await readCatalog(env);
      if (product.preorden_mes) {
        for (const c in catalog) {
          (catalog[c].products || []).forEach(p => { delete p.preorden_mes; });
        }
      }
      let found = false;
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
        found = true;
        break;
      }
      if (!found) return err400('Producto no encontrado: ' + productId);
      await persistCatalog(env, catalog);
      return ok();
    }

    if (action === 'delete') {
      const { productId } = body;
      if (!productId) return err400('delete requiere productId');
      const catalog = await readCatalog(env);
      let found = false;
      for (const c in catalog) {
        const prods = catalog[c].products || [];
        const i = prods.findIndex(p => p.id === productId);
        if (i !== -1) { prods.splice(i, 1); found = true; break; }
      }
      if (!found) return err400('Producto no encontrado: ' + productId);
      await persistCatalog(env, catalog);
      return ok();
    }

    if (action === 'replace') {
      const { catalog } = body;
      if (!catalog) return err400('replace requiere catalog');
      await persistCatalog(env, catalog);
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
