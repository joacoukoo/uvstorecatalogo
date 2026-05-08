# Scraper con IA integrada — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fusionar la generación IA dentro del endpoint `/api/scrape` para que un solo clic llene todos los campos del formulario admin, incluyendo descripción, specs y accesorios.

**Architecture:** El endpoint `/api/scrape` ya extrae datos del HTML pero tiene múltiples early returns para el path Shopify. Se refactoriza el handler para que todos los paths converjan en un único punto donde se llama a `callClaudeForDesc` antes de responder. Si Claude falla, devuelve `ai_ok: false` y el frontend lo indica con un aviso naranja.

**Tech Stack:** Cloudflare Pages Functions (JS ESM), Anthropic API (claude-haiku-4-5), Alpine.js (frontend admin)

---

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `functions/api/scrape.js` | Agregar `env`, nueva función `callClaudeForDesc`, refactorizar handler para un único return |
| `admin-app.html` | Status messages en `scrapeUrl()`, renombrar botones "Generar con IA" |

---

## Task 1: Agregar `callClaudeForDesc` al backend

**Files:**
- Modify: `functions/api/scrape.js`

- [ ] **Step 1: Agregar `callClaudeForDesc` como función standalone antes del handler**

En `functions/api/scrape.js`, insertar justo antes de la línea `export async function onRequestPost` (línea 70):

```js
async function callClaudeForDesc(env, { name, marca, escala, franquicia, desc_raw, foto }) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const ctx = [
    marca      && `Fabricante: ${marca}.`,
    escala     && `Escala: ${escala}.`,
    franquicia && `Franquicia: ${franquicia}.`,
  ].filter(Boolean).join(' ');

  const prompt = `Sos experto en figuras de colección premium. Genera contenido de venta para "${name}".
${ctx}
Texto/descripción del fabricante:
${desc_raw || '(no disponible)'}

Responde SOLO con JSON válido sin markdown:
{"desc":"2-3 oraciones vendedoras en español","specs":"- Altura: X cm\\n- Escala: 1:X\\n- Material: ...","includes":"- accesorio1\\n- accesorio2"}`;

  const content = foto
    ? [{ type: 'image', source: { type: 'url', url: foto } }, { type: 'text', text: prompt }]
    : prompt;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const parts = [parsed.desc, parsed.specs, parsed.includes].filter(Boolean);
    return parts.length ? parts.join('\n\n') : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

```

- [ ] **Step 2: Refactorizar el handler — agregar `env` y consolidar todos los paths en un único return**

El handler actual tiene tres early returns: dos para Shopify (líneas 85 y 101) y el return final (línea 126). Reemplazar el bloque completo `export async function onRequestPost` con:

```js
export async function onRequestPost({ env, request }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'JSON invalido' }, 400); }

  const { url } = body;
  if (!url || !url.startsWith('http')) return json({ error: 'URL invalida' }, 400);

  try {
    let result = null;

    // ── Shopify fast path (JSON API) ──────────────────────────────────────
    const providerEarly = detectProvider(url);
    if (providerEarly === 'shopify') {
      // Direct JSON API
      try {
        const r = await scrapeShopify(url, '');
        if (r.name) result = r;
      } catch (_) {}
      // JSON API via proxy (for sites that block Cloudflare IPs)
      if (!result) {
        const handleMatch = url.match(/\/products\/([^/?#]+)/);
        if (handleMatch) {
          try {
            const jsonUrl = `${new URL(url).origin}/products/${handleMatch[1]}.json`;
            const proxyRes = await fetch(PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: jsonUrl }) });
            if (proxyRes.ok) {
              const { html: jsonText, status } = await proxyRes.json();
              if (status < 400) {
                const { product } = JSON.parse(jsonText);
                if (product?.title) {
                  const tags = product.tags ? (Array.isArray(product.tags) ? product.tags : product.tags.split(',').map(t=>t.trim())) : [];
                  const photos = (product.images||[]).map(i=>i.src.replace(/_\d+x\d*(?:@\d+x)?(\.\w+)(\?.*)?$/,'$1')).slice(0,8);
                  const name = product.title;
                  result = { name, price: product.variants?.[0]?.price||'', marca: product.vendor||'', photos, franquicia: guessFranquiciaProxy(name, tags), escala: guessEscalaProxy(name, tags), estado: product.variants?.some(v=>v.available)?'Entrega Inmediata':'Pre-Orden', provider: 'shopify' };
                }
              }
            }
          } catch (_) {}
        }
      }
    }

    // ── HTML fetch + provider-specific scrapers ───────────────────────────
    if (!result) {
      const res = await fetchPage(url);
      if (!res.ok) return json({ error: `El sitio respondio ${res.status}` }, 422);
      const html = await res.text();

      // Re-detect with HTML for auto-detection (woocommerce, bigcommerce, etc.)
      const provider = detectProvider(url, html);

      if (provider === 'sideshow')               result = await scrapeSideshow(url, html);
      else if (provider === 'shopify')            result = await scrapeShopify(url, html);
      else if (provider === 'woocommerce')        result = scrapeWooCommerce(url, html);
      else if (provider === 'bigcommerce')        result = scrapeBigCommerce(url, html);
      else if (provider === 'opencart')           result = scrapeOpenCart(url, html);
      else if (provider === 'entertainmentearth') result = scrapeEE(html);
      else if (provider === 'bbts')               result = scrapeBBTS(html);
      else                                        result = scrapeGeneric(html);
    }

    // ── Claude: generar descripción ───────────────────────────────────────
    const aiDesc = await callClaudeForDesc(env, {
      name:       result.name       || '',
      marca:      result.marca      || '',
      escala:     result.escala     || '',
      franquicia: result.franquicia || '',
      desc_raw:   result.desc       || '',
      foto:       result.photos?.[0] || '',
    });
    if (aiDesc) {
      result.desc  = aiDesc;
      result.ai_ok = true;
    } else {
      result.ai_ok = false;
    }
    return json(result);

  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
```

- [ ] **Step 3: Verificar sintaxis**

```powershell
node -e "import('./functions/api/scrape.js').catch(e => { if (!e.message.includes('Cannot use import')) throw e })"
```
Si sale SyntaxError, revisar el paso anterior. El error de `import` es esperado (Node sin bundler), SyntaxError no.

- [ ] **Step 4: Commit backend**

```powershell
git add functions/api/scrape.js
git commit -m "feat: integrar Claude en /api/scrape para descripción automática"
```

---

## Task 2: Actualizar el frontend

**Files:**
- Modify: `admin-app.html`

- [ ] **Step 1: Cambiar el mensaje de status mientras scrapea**

En `admin-app.html` línea 509, cambiar:
```js
setStatus('Scrapeando...','orange');
```
por:
```js
setStatus('Scrapeando y generando descripción...','orange');
```

- [ ] **Step 2: Actualizar el mensaje de éxito/fallo según `ai_ok`**

En `admin-app.html` líneas 516-518, reemplazar:
```js
    var dbgMsg='Datos cargados — revisa y ajusta';
    if(data._dbg)dbgMsg+=' | '+data._dbg;
    setStatus(dbgMsg,'green');
```
por:
```js
    var dbgMsg=data.ai_ok
      ?'Listo — revisa y ajusta'
      :'Datos cargados — generación IA falló, usá Regenerar descripción';
    var dbgColor=data.ai_ok?'green':'orange';
    if(data._dbg)dbgMsg+=' | '+data._dbg;
    setStatus(dbgMsg,dbgColor);
```

- [ ] **Step 3: Renombrar el botón en el formulario de agregar (línea 203)**

Cambiar:
```html
<button class="btn btn-ai" onclick="generateAI('add')">Generar con IA</button>
```
por:
```html
<button class="btn btn-ai" onclick="generateAI('add')">Regenerar descripción</button>
```

- [ ] **Step 4: Renombrar el botón en el formulario de editar (línea 320)**

Cambiar:
```html
<button class="btn btn-ai" onclick="generateAI('edit')">Generar con IA</button>
```
por:
```html
<button class="btn btn-ai" onclick="generateAI('edit')">Regenerar descripción</button>
```

- [ ] **Step 5: Commit frontend**

```powershell
git add admin-app.html
git commit -m "feat: scraper muestra estado IA y renombra botones"
```

---

## Task 3: Push y verificación manual

- [ ] **Step 1: Push**

```powershell
git push origin main
```
Esperar ~30 segundos a que Cloudflare Pages despliegue.

- [ ] **Step 2: Probar con URL de Sideshow**

1. Ir a `/admin` → tab "Agregar"
2. Pegar una URL de Sideshow (ej: `https://www.sideshow.com/collectibles/...`)
3. Clic "Scrapear"
4. Verificar que el status diga "Scrapeando y generando descripción..." durante ~10-15s
5. Al terminar: status verde "Listo — revisa y ajusta"
6. El textarea de descripción debe tener 3 bloques separados por línea en blanco: párrafo vendedor, specs con bullets, accesorios con bullets

- [ ] **Step 3: Probar con URL de Statuecorp (Shopify)**

1. Repetir con una URL de `statuecorp.com`
2. Mismos resultados esperados

- [ ] **Step 4: Probar con URL de FNC (BigCommerce)**

1. Repetir con una URL de `fanaticanimestore.com`
2. Mismos resultados esperados

- [ ] **Step 5: Verificar fallback**

Para simular fallo de IA sin tocar Cloudflare: usar una URL de Sideshow con la key de Anthropic intencionalmente incorrecta. Editar temporalmente el env var en Cloudflare Pages → Settings → Environment variables → `ANTHROPIC_API_KEY` → poner valor falso → redeploy.

Verificar:
- El formulario se llena igual (nombre, fotos, precio)
- El status es naranja: "Datos cargados — generación IA falló, usá Regenerar descripción"
- El botón "Regenerar descripción" funciona manualmente

Restaurar la variable tras la prueba.
