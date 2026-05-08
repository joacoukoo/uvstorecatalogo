# Spec: Scraper con IA integrada

**Fecha:** 2026-05-08
**Contexto:** Admin panel de UV Store GT (`admin-app.html` + `functions/api/scrape.js`)

## Problema

El flujo actual para agregar una figura requiere dos pasos manuales:
1. Pegar URL → "Scrapear" (llena nombre, fotos, precio, marca, escala)
2. Revisar → "Generar IA" (genera descripción, specs, accesorios)

Además, cuando el scraper no extrae la descripción del fabricante correctamente, el modelo de IA trabaja sin contexto y genera contenido pobre. El usuario tiene que corregir o agregar datos manualmente antes de poder generar.

**Sitios prioritarios:** Sideshow, Statuecorp (Shopify), FNC/Fanatic Anime (BigCommerce).

## Solución

Fusionar la llamada a Claude dentro del endpoint `/api/scrape`, de modo que un solo clic llene todos los campos del formulario incluyendo la descripción generada por IA.

## Arquitectura

```
Usuario pega URL → clic "Scrapear"
  → POST /api/scrape
      1. fetchPage(url) → HTML
      2. detectProvider + scrapeXxx() → { name, price, photos, marca, escala, franquicia, desc_raw, entrega, estado }
      3. callClaudeForDesc(env, { name, marca, escala, franquicia, desc_raw, foto }) → { desc, specs, includes }
      4. Armar respuesta: desc = desc + "\n\n" + specs + "\n\n" + includes
      5. Devolver { name, price, photos, marca, escala, franquicia, entrega, estado, desc, ai_ok: true }
  ← Frontend recibe respuesta
  → fillAddForm(data) llena todos los campos incluyendo textarea de descripción
  → Listo para revisar y guardar
```

Si Claude falla (timeout, error de API), el endpoint devuelve los datos scrapeados con `ai_ok: false` y `desc` vacío. El frontend muestra un aviso y el botón "Regenerar descripción" queda disponible.

## Cambios en el backend (`functions/api/scrape.js`)

### 1. Agregar `env` al handler
```js
// antes
export async function onRequestPost({ request }) {
// después
export async function onRequestPost({ env, request }) {
```

### 2. Nueva función `callClaudeForDesc`
```js
async function callClaudeForDesc(env, { name, marca, escala, franquicia, desc_raw, foto }) {
  const ctx = [marca && `Fabricante: ${marca}.`, escala && `Escala: ${escala}.`, franquicia && `Franquicia: ${franquicia}.`]
    .filter(Boolean).join(' ');

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
  const timeout = setTimeout(() => controller.abort(), 20000);
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
    return parts.join('\n\n');
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
```

### 3. Llamar `callClaudeForDesc` antes de responder
Después del `switch` de providers, antes del `return json(result)`:
```js
const aiDesc = await callClaudeForDesc(env, {
  name: result.name,
  marca: result.marca,
  escala: result.escala,
  franquicia: result.franquicia,
  desc_raw: result.desc,
  foto: result.photos?.[0] || '',
});
if (aiDesc) {
  result.desc = aiDesc;
  result.ai_ok = true;
} else {
  result.ai_ok = false;
}
return json(result);
```

## Cambios en el frontend (`admin-app.html`)

### 1. `scrapeUrl()` — mensaje de status
```js
// antes
setStatus('Scrapeando...', 'orange');
// después
setStatus('Scrapeando y generando descripción...', 'orange');
```

### 2. `scrapeUrl()` — mensaje de éxito
```js
// antes
var dbgMsg = 'Datos cargados — revisa y ajusta';
// después
var dbgMsg = data.ai_ok
  ? 'Listo — revisa y ajusta'
  : 'Datos cargados — generación IA falló, usá Regenerar';
var dbgColor = data.ai_ok ? 'green' : 'orange';
setStatus(dbgMsg + (data._dbg ? ' | ' + data._dbg : ''), dbgColor);
```

### 3. Botón "Generar IA" → renombrar
```html
<!-- antes -->
Generar con IA
<!-- después -->
Regenerar descripción
```
El botón se mantiene funcional para casos donde el usuario quiere refrescar la descripción después de editar campos.

### 4. `fillAddForm()` — sin cambios
Ya usa `data.desc` para llenar el textarea. El `desc` ahora llega pre-procesado con formato `desc + specs + includes`.

## Manejo de errores

| Escenario | Comportamiento |
|---|---|
| Claude timeout (>20s) | `ai_ok: false`, datos scrapeados disponibles, aviso naranja |
| Claude error de API | Igual que timeout |
| Scrape falla | Error rojo como antes (sin cambio) |
| `ANTHROPIC_API_KEY` no configurada | `callClaudeForDesc` retorna `null`, fallback silencioso |

## Lo que NO cambia

- Scrapers específicos de Sideshow, Shopify, BigCommerce — misma lógica de extracción
- Flujo de fotos Deluxe (scrape separado con segunda URL)
- Endpoint `/api/ai` — sigue disponible para el botón "Regenerar descripción"
- Botón "Generar IA Deluxe" — sin cambios
- Categoría, cantidad y otros campos que el usuario completa manualmente

## Resultado esperado

- Un solo clic en "Scrapear" llena todos los campos incluyendo descripción
- Tiempo estimado: 10-15 segundos (antes eran dos pasos de ~5s c/u)
- La IA recibe el texto completo del fabricante como contexto → mejor calidad
- Fallback silencioso si Claude no responde
