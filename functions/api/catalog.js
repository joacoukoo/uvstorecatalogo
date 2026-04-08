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
  const bytes = Uint8Array.from(atob(data.content.replace(/\n/g, '')), c => c.charCodeAt(0));
  const text = new TextDecoder().decode(bytes);
  return { catalog: JSON.parse(text), sha: data.sha };
}

async function writeFile(token, repo, catalog, sha) {
  const json = JSON.stringify(catalog, null, 2);
  const bytes = new TextEncoder().encode(json);
  const b64 = btoa(String.fromCharCode(...bytes));
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
    return new Response(JSON.stringify(catalog), { headers: { 'Content-Type': 'application/json' } });
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
