import { detectProvider, scrapeSideshow, scrapeShopify, scrapeWooCommerce, scrapeBigCommerce, scrapeOpenCart, scrapeEE, scrapeBBTS, scrapeGeneric, guessFranquicia as guessFranquiciaProxy, guessEscala as guessEscalaProxy } from '../_lib/scrapers.js';
import { fetchPage, PROXY_URL } from '../_lib/fetchPage.js';


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
{"desc":"2-3 oraciones vendedoras en español","specs":"- Altura: X cm\\n- Escala: 1:X\\n- Material: ...","includes":"- accesorio1\\n- accesorio2","franquicia":"una de: Marvel|DC Comics|Star Wars|Anime|Gaming|Harry Potter|El Señor de los Anillos|Alien|Predator|Terminator|Tortugas Ninja|Masters of the Universe|Transformers|Adultos|Otros"}`;

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
    if (!parts.length) return null;
    const VALID_FRANQUICIAS = ['Marvel','DC Comics','Star Wars','Anime','Gaming','Harry Potter','El Señor de los Anillos','Alien','Predator','Terminator','Tortugas Ninja','Masters of the Universe','Transformers','Adultos','Otros'];
    return {
      desc: parts.join('\n\n'),
      franquicia: VALID_FRANQUICIAS.includes(parsed.franquicia) ? parsed.franquicia : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Fetch the Deluxe/Exclusive variant page from Sideshow and scrape it
async function fetchSideshowDeluxe(baseUrl, deluxeSku) {
  try {
    const u = new URL(baseUrl);
    u.searchParams.set('var', deluxeSku);
    const res = await fetchPage(u.toString());
    if (!res.ok) return null;
    const html = await res.text();
    return await scrapeSideshow(u.toString(), html);
  } catch {
    return null;
  }
}

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

    // ── Claude + Deluxe fetch en paralelo ────────────────────────────────
    const isSSDeluxe = result.provider === 'sideshow' && result.deluxeVariantSku;
    const [aiResult, deluxeResult] = await Promise.all([
      callClaudeForDesc(env, {
        name:       result.name       || '',
        marca:      result.marca      || '',
        escala:     result.escala     || '',
        franquicia: result.franquicia || '',
        desc_raw:   result.desc       || '',
        foto:       result.photos?.[0] || '',
      }),
      isSSDeluxe ? fetchSideshowDeluxe(url, result.deluxeVariantSku) : Promise.resolve(null),
    ]);

    if (aiResult) {
      result.desc = aiResult.desc;
      if (aiResult.franquicia && (!result.franquicia || result.franquicia === 'Otros')) result.franquicia = aiResult.franquicia;
      result.ai_ok = true;
    } else {
      result.ai_ok = false;
    }

    if (deluxeResult?.photos?.length >= 2) {
      result.photos_d = deluxeResult.photos;
      const aiDeluxe = await callClaudeForDesc(env, {
        name:       deluxeResult.name  || result.name  || '',
        marca:      deluxeResult.marca || result.marca || '',
        escala:     deluxeResult.escala || result.escala || '',
        franquicia: aiResult?.franquicia || result.franquicia || '',
        desc_raw:   deluxeResult.desc  || '',
        foto:       deluxeResult.photos?.[0] || '',
      });
      if (aiDeluxe) result.desc_d = aiDeluxe.desc;
    }

    return json(result);

  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
