const GH_API = 'https://api.github.com';

function headers(token) {
  return {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'UV-Store-Admin/1.0'
  };
}

async function readFile(token, repo) {
  const res = await fetch(`${GH_API}/repos/${repo}/contents/productos.json`, { headers: headers(token) });
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

async function writeFile(token, repo, catalog, sha) {
  const json = JSON.stringify(catalog, null, 2);
  const bytes = new TextEncoder().encode(json);
  const b64 = bytesToBase64(bytes);
  const res = await fetch(`${GH_API}/repos/${repo}/contents/productos.json`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
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

// Lee el catálogo, aplica mutateFn(catalog), escribe de vuelta.
// Reintenta hasta `retries` veces si GitHub devuelve 409/422 (SHA stale).
async function mutateCatalog(token, repo, mutateFn, retries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 100 * attempt));
    const { catalog, sha } = await readFile(token, repo);
    mutateFn(catalog);
    try {
      await writeFile(token, repo, catalog, sha);
      return catalog;
    } catch (e) {
      lastErr = e;
      if (e.status === 409 || e.status === 422) continue; // SHA conflict — reintentar
      throw e;
    }
  }
  throw lastErr;
}

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

    // ── Backwards compat: { catalog } full replace ──
    if (body.catalog && !body.action) {
      const { sha } = await readFile(env.GITHUB_TOKEN, env.GITHUB_REPO);
      await writeFile(env.GITHUB_TOKEN, env.GITHUB_REPO, body.catalog, sha);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    const { action } = body;

    if (action === 'add') {
      // { action:'add', category: string, product: object }
      const { category, product } = body;
      if (!category || !product) return err400('add requiere category y product');
      await mutateCatalog(env.GITHUB_TOKEN, env.GITHUB_REPO, catalog => {
        if (!catalog[category]) catalog[category] = { products: [] };
        catalog[category].products.unshift(product);
      });
      return ok();
    }

    if (action === 'edit') {
      // { action:'edit', productId: string, product: object, newCategory?: string }
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
      // { action:'delete', productId: string }
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
      // { action:'replace', catalog: object } — usado por optimizeCatalog (bulk AI)
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
