import { detectProvider, scrapeSideshow, scrapeShopify, scrapeWooCommerce, scrapeBigCommerce, scrapeOpenCart, scrapeEE, scrapeBBTS, scrapeGeneric, guessFranquicia as guessFranquiciaProxy, guessEscala as guessEscalaProxy, MAX_FOTOS } from '../_lib/scrapers.js';
import { fetchPage, PROXY_URL } from '../_lib/fetchPage.js';
import { limpiarNombre, sacarOracionesConBasura, opcionesReales, esTienda } from '../_lib/limpieza.js';

async function callClaudeForDesc(env, { name, marca, escala, franquicia, desc_raw, foto, opciones = [] }) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const ctx = [
    marca      && `Fabricante: ${marca}.`,
    escala     && `Escala: ${escala}.`,
    franquicia && `Franquicia: ${franquicia}.`,
    opciones.length && `Opciones a la venta: ${opciones.map(o => `${o.nombre}: ${o.valores.join(' / ')}`).join('; ')}.`,
  ].filter(Boolean).join(' ');

  const prompt = `Sos experto en figuras de colección premium. Genera contenido de venta para "${name}".
${ctx}
Texto/descripción del fabricante:
${desc_raw || '(no disponible)'}

Reglas: nunca menciones tiendas (Fanatic Anime Store, FNC, Nonasea, Hexapus, Statuecorp, Sideshow ni otras), envíos, aduanas, formas de pago, depósitos, emails, redes sociales ni links.
"nombre": solo el personaje (y la obra si hace falta para entenderlo) y como mucho el tipo ("Statue", "1/6 Figure", "Bust"). Sin marca ni licenciante, sin "PRE-ORDER", "Shipping Included", "Licensed", "WF2026", corchetes ni emojis. Ejemplo: "(WF2026 Shipping Included)JIMEI PALACE X Toei Animation - One Piece - Donquixote Doflamingo 1/6 Statue -（Licensed）" → "Donquixote Doflamingo 1/6 Statue".
"categoria": "Hot Toys 1:6" si el fabricante es Hot Toys; "Estatuas Premium" para estatuas y bustos; "Otras Figuras" para figuras articuladas que no son Hot Toys; "Adultos" para contenido adulto.
"marca": el fabricante real de la figura (nunca la tienda que la vende), "" si no se sabe.
"entrega": fecha estimada de entrega si el texto la trae (ej. "2027 Q2"), si no "".
"variantes": una por cada opción a la venta, en el mismo orden: {"nombre": nombre corto ("1:4", "Deluxe", "EX"), "incluye": qué trae esa versión que la diferencia de las otras, en español y en pocas palabras, sacado del texto (ej. "Con alas y base escénica"), nunca vacío: si el texto no lo explica, deducilo del nombre de la opción (ej. "Regular+Extended Base" → "Base extendida más grande")}; [] si no hay opciones.

Responde SOLO con JSON válido sin markdown:
{"nombre":"...","marca":"","categoria":"...","entrega":"","variantes":[{"nombre":"...","incluye":"..."}],"desc":"2-3 oraciones vendedoras en español","specs":"- Altura: X cm\\n- Escala: 1:X\\n- Material: ...","includes":"- accesorio1\\n- accesorio2","franquicia":"una de: Marvel|DC Comics|Star Wars|Anime|Gaming|Harry Potter|El Señor de los Anillos|Alien|Predator|Terminator|Tortugas Ninja|Masters of the Universe|Transformers|Adultos|Otros"}`;

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
      nombre: typeof parsed.nombre === 'string' ? parsed.nombre : '',
      marca: typeof parsed.marca === 'string' ? parsed.marca.trim() : '',
      categoria: parsed.categoria,
      entrega: typeof parsed.entrega === 'string' ? parsed.entrega.trim() : '',
      variantes: Array.isArray(parsed.variantes)
        ? parsed.variantes.map(v => (v && typeof v === 'object') ? { nombre: String(v.nombre || ''), incluye: String(v.incluye || '').trim() } : { nombre: String(v), incluye: '' })
        : [],
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

    // ── Nonasea: ficha JSON de su API ─────────────────────────────────────
    if (/nonasea\.com\/api\/customer\/shop\/product\/\d+/.test(url)) {
      result = scrapeNonasea((await (await fetch(url)).json()).data);
    }

    // ── Shopify fast path (JSON API) ──────────────────────────────────────
    const providerEarly = result ? null : detectProvider(url);
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
                  const photos = (product.images||[]).map(i=>i.src.replace(/_\d+x\d*(?:@\d+x)?(\.\w+)(\?.*)?$/,'$1')).slice(0,MAX_FOTOS);
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
        opciones:   opcionesReales(result.opciones),
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
    completarParaCatalogo(result, aiResult, url);

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

const CATEGORIAS = ['Hot Toys 1:6', 'Estatuas Premium', 'Otras Figuras', 'Adultos'];

// Lo que el admin necesita para cargar la figura sin retocar: nombre limpio, categoría de la web,
// siempre Pre-Orden (stock de una tienda extranjera no es stock en Guatemala) y variantes reales.
function completarParaCatalogo(result, ai, url) {
  result.origen = url;
  result.nombre_limpio = limpiarNombre(ai?.nombre || '') || limpiarNombre(result.name || '');
  if (!result.marca || esTienda(result.marca)) result.marca = (ai?.marca && !esTienda(ai.marca)) ? ai.marca : '';
  if (!result.escala) result.escala = (String(result.name || '').match(/\b1\s*[:/]\s*\d+\b/) || [''])[0];
  result.escala = String(result.escala || '').replace(/\b1\s*\/\s*(\d+)/g, '1:$1');
  const esHotToys = /hot\s*toys/i.test(result.marca || '');
  result.categoria = esHotToys ? 'Hot Toys 1:6' : (CATEGORIAS.includes(ai?.categoria) ? ai.categoria : 'Otras Figuras');
  result.entrega = result.entrega || ai?.entrega || '';
  result.disp = 'Pre-Orden';
  result.estado = 'Pre-Orden';
  result.desc = sacarOracionesConBasura(result.desc);
  if (result.desc_d) result.desc_d = sacarOracionesConBasura(result.desc_d);
  result.opciones = opcionesReales(result.opciones);
  const op = result.opciones[0];
  const esEscala = /scale|escala/i.test(op?.nombre || '');
  result.variantes_ia = (op?.valores || []).map((v, i) => {
    const iv = ai?.variantes?.[i];
    const label = limpiarNombre(iv?.nombre || v) || v;
    const detalle = sacarOracionesConBasura(iv?.incluye || '').trim();
    const fotos = op.fotos?.[i]?.length ? op.fotos[i] : undefined;
    return { label, ...(detalle ? { detalle } : {}), ...(esEscala ? { escala: v.replace('/', ':') } : {}), ...(fotos ? { fotos } : {}) };
  });
}

// Ficha de la API de Nonasea. Título tipo "MARCA X Licenciante - Obra - Personaje 1/6 Statue".
function scrapeNonasea(p) {
  if (!p?.title) throw new Error('Nonasea no devolvió la figura');
  const marca = (limpiarNombre(p.title).split(' - ')[0] || '').split(/\s+X\s+/i)[0].trim();
  const html = String(p.content || '').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '');
  const goods = p.goods_list || [];
  return {
    name: p.title,
    marca: marca.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
    escala: guessEscalaProxy(p.title),
    franquicia: guessFranquiciaProxy(p.title),
    desc: [p.description, html].filter(Boolean).join('\n').slice(0, 4000),
    photos: (Array.isArray(p.img) ? p.img : [p.img]).filter(Boolean).slice(0, MAX_FOTOS),
    price: p.price ? String(p.price) : '',
    opciones: goods.length > 1 ? [{ nombre: 'Versión', valores: goods.map(g => g.name), fotos: goods.map(g => g.img || []) }] : [],
    provider: 'nonasea',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
