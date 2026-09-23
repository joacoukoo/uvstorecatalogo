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
