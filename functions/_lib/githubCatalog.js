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

// Refleja en el producto del catálogo la disponibilidad real de un lote vinculado.
// Lote del producto completo (variante null): maneja `agotado` y también `cantidad`
// (el "Disponibles" que ve el cliente). Lote de una variante: solo `agotado_r`/`agotado_d`,
// porque ambas variantes comparten el mismo campo `cantidad`.
// Devuelve true si cambió algo.
export function aplicarStock(producto, variante, disponibles) {
  const agotado = disponibles <= 0;
  let cambio = false;
  if (variante === 'regular' || variante === 'deluxe') {
    const campo = variante === 'regular' ? 'agotado_r' : 'agotado_d';
    if (!!producto[campo] !== agotado) { producto[campo] = agotado; cambio = true; }
    return cambio;
  }
  if (!!producto.agotado !== agotado) { producto.agotado = agotado; cambio = true; }
  const cantidad = String(Math.max(disponibles, 0));
  if (producto.cantidad !== cantidad) { producto.cantidad = cantidad; cambio = true; }
  return cambio;
}
