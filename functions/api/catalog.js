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
    // File > 1MB: content is null, use download_url
    const dlRes = await fetch(data.download_url);
    if (!dlRes.ok) throw new Error(`download_url ${dlRes.status}`);
    text = await dlRes.text();
  } else {
    throw new Error('GitHub API returned no content and no download_url');
  }
  return { catalog: JSON.parse(text), sha: data.sha };
}

function bytesToBase64(bytes) {
  // Process in chunks to avoid stack overflow on large files
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
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function onRequestGet({ env }) {
  try {
    const { catalog } = await readFile(env.GITHUB_TOKEN, env.GITHUB_REPO);
    return new Response(JSON.stringify(catalog), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function onRequestPut({ env, request }) {
  try {
    const body = await request.json();
    if (!body.catalog || typeof body.catalog !== 'object') {
      return new Response(JSON.stringify({ error: 'Body debe ser { catalog: {...} }' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const { sha } = await readFile(env.GITHUB_TOKEN, env.GITHUB_REPO);
    await writeFile(env.GITHUB_TOKEN, env.GITHUB_REPO, body.catalog, sha);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
