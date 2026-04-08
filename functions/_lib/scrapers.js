// Explicit domain → platform mapping
const DOMAIN_PLATFORMS = {
  'sideshow.com':           'sideshow',
  'lionrocktoyz.com':       'bigcommerce',
  'fanaticanimestore.com':  'bigcommerce',
  'statuecorp.com':         'shopify',
  'tnsfigures.com':         'bigcommerce',
  'mondoshop.com':          'shopify',
  'specfictionshop.com':    'shopify',
  'onesixthkit.com':        'opencart',
  'entertainmentearth.com': 'generic',
  'bigbadtoystore.com':     'generic',
  'hottoys.com.hk':         'generic',
};

export function detectProvider(url, html = '') {
  const domain = new URL(url).hostname.replace(/^www\./, '');
  for (const [d, p] of Object.entries(DOMAIN_PLATFORMS)) {
    if (domain.includes(d)) return p;
  }
  if (html) {
    const head = html.slice(0, 4000).toLowerCase();
    if (head.includes('cdn.shopify.com') || head.includes('"shopify"')) return 'shopify';
    if (head.includes('woocommerce') || head.includes('wc-block')) return 'woocommerce';
    if (head.includes('bigcommerce')) return 'bigcommerce';
    if (head.includes('opencart') || url.includes('index.php?route=product')) return 'opencart';
  }
  if (/\/products\/[^/?]+/.test(url)) return 'shopify';
  return 'generic';
}

function rx(html, re) {
  const r = html.match(re);
  return r ? (r[1] || '').trim() : '';
}

function decodeHtml(s) {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&nbsp;/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n));
}

function extractPrice(text) {
  const m = text.match(/\$?\s*([\d,]+(?:\.\d{1,2})?)/);
  return m ? m[1].replace(/,/g,'') : '';
}

function ogImage(html) {
  return rx(html, /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i) ||
         rx(html, /<meta[^>]*content="([^"]+)"[^>]*property="og:image"/i);
}

function isPreOrder(html) {
  return /pre.?order/i.test(html);
}

// Parse JSON-LD blocks from page
function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { out.push(JSON.parse(m[1])); } catch (_) {}
  }
  return out;
}

// Convert HTML product description to clean text
// Returns paragraphs + bullet items as a single string with \n separating bullets
function htmlToDesc(bodyHtml) {
  if (!bodyHtml) return '';
  // Extract list items as bullet lines
  const bullets = [];
  const listRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let lm;
  while ((lm = listRe.exec(bodyHtml)) !== null) {
    const text = decodeHtml(lm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (text) bullets.push('- ' + text);
  }
  // Extract paragraph text (non-list)
  const noLists = bodyHtml.replace(/<[ou]l[^>]*>[\s\S]*?<\/[ou]l>/gi, '\n');
  const paraText = decodeHtml(noLists.replace(/<\/?(p|div|br|h[1-6])[^>]*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim());
  const parts = [];
  if (paraText) parts.push(paraText);
  if (bullets.length) parts.push(bullets.join('\n'));
  return parts.join('\n\n');
}

// Try to guess franquicia from product name / tags
export function guessFranquicia(name, tags = []) {
  const known = ['Batman','Superman','Spider-Man','Iron Man','Captain America','Thor','Wolverine','Deadpool',
    'Joker','Wonder Woman','Hulk','Black Panther','Venom','One Piece','Naruto','Dragon Ball','Goku','Luffy',
    'Demon Slayer','Attack on Titan','Star Wars','Mandalorian','Darth Vader','Yoda','Alien','Predator',
    'Terminator','RoboCop','Transformers','He-Man','Godzilla','King Kong'];
  const text = (name + ' ' + tags.join(' ')).toLowerCase();
  for (const f of known) {
    if (text.includes(f.toLowerCase())) return f;
  }
  return '';
}

// Try to extract scale from name/tags
export function guessEscala(name, tags = []) {
  const text = name + ' ' + tags.join(' ');
  const m = text.match(/\b(1\s*[:/]\s*\d+(?:\s*scale)?|\d+(?:th|st|rd)[\s-]scale|1\/\d+)\b/i);
  return m ? m[0].replace(/\s+/g, '') : '';
}

// Extract product data (photos, vendor, tags, product_type) from embedded Shopify HTML scripts
// Works for stores that block the JSON API (Statuecorp, Specfiction, etc.)
function extractShopifyScriptData(html, url) {
  const baseUrl = new URL(url).origin;
  const photos = [];
  const seen = new Set();
  let vendor = '';
  let productType = '';
  let tags = [];

  function normalizeImg(rawSrc) {
    if (!rawSrc) return '';
    if (rawSrc.startsWith('//')) rawSrc = 'https:' + rawSrc;
    if (!rawSrc.startsWith('http')) rawSrc = baseUrl + (rawSrc.startsWith('/') ? '' : '/') + rawSrc;
    return rawSrc.replace(/_\d+x\d*(?:@\d+x)?(\.\w+)(\?.*)?$/, '$1');
  }

  // Strategy 1: find JSON objects in script tags — handles var productjson={}, window.x.product={}, etc.
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let sm;
  while ((sm = scriptRe.exec(html)) !== null) {
    const src = sm[1];
    // Match any JSON-like object assigned to a variable containing "product" (case-insensitive)
    // Also catch ShopifyAnalytics.meta, _BISConfig, SPOParams patterns
    const jsonRe = /(?:(?:var\s+\w+|[\w.]+)\s*[=:]\s*)(\{[^{}]*"(?:images|vendor|product_type)"[^{}]*(?:\{[^{}]*\}[^{}]*)?\})/g;
    let jm;
    while ((jm = jsonRe.exec(src)) !== null) {
      try {
        const obj = JSON.parse(jm[1]);
        if (obj.vendor && !vendor) vendor = obj.vendor;
        if (obj.product_type && !productType) productType = obj.product_type;
        if (obj.tags && !tags.length) {
          tags = Array.isArray(obj.tags) ? obj.tags : obj.tags.split(',').map(t => t.trim());
        }
        const images = obj.images || obj.media || [];
        for (const img of images) {
          const u = normalizeImg(typeof img === 'string' ? img : (img.src || img.original_src || img.url || ''));
          if (u && !seen.has(u)) { seen.add(u); photos.push(u); }
          if (photos.length >= 8) break;
        }
      } catch (_) {}
    }
    // Also extract vendor/type from loose JSON strings (e.g. ShopifyAnalytics)
    if (!vendor) { const m = src.match(/"vendor"\s*:\s*"([^"]+)"/); if (m) vendor = m[1]; }
    if (!productType) { const m = src.match(/"product_type"\s*:\s*"([^"]+)"/); if (m) productType = m[1]; }
  }

  // Strategy 2: CDN image URLs in HTML (covers Statuecorp-style custom CDN)
  if (!photos.length) {
    const domain = new URL(url).hostname.replace(/^www\./, '');
    const cdnRe = new RegExp(`(?:https?:)?//${domain.replace(/\./g, '\\.')}/cdn/shop/[^"'\\s>]+\\.(?:jpg|jpeg|webp|png)`, 'gi');
    for (const m of html.matchAll(cdnRe)) {
      const u = normalizeImg(m[0]);
      if (u && !seen.has(u)) { seen.add(u); photos.push(u); }
      if (photos.length >= 8) break;
    }
  }

  // Strategy 3: any Shopify CDN images in the HTML
  if (!photos.length) {
    const cdnRe = /https?:\/\/cdn\.shopify\.com\/s\/files\/[^"'\s>]+\.(?:jpg|jpeg|webp|png)/gi;
    for (const m of html.matchAll(cdnRe)) {
      const u = m[0].split('?')[0].replace(/_\d+x\d*(?:@\d+x)?(\.\w+)$/, '$1');
      if (!seen.has(u)) { seen.add(u); photos.push(u); }
      if (photos.length >= 8) break;
    }
  }

  return { photos, vendor, productType, tags };
}

export async function scrapeSideshow(url, html) {
  const varMatch = url.match(/[?&](?:var|sku)=(\d{5,})/i);
  const pathMatch = url.match(/-(\d{6,})\/?(?:\?.*)?$/);
  const sku = (varMatch ? varMatch[1] : pathMatch ? pathMatch[1] : null);

  const name = decodeHtml(
    rx(html, /<h1[^>]*class="[^"]*(?:product[_-]?title|pdp[_-]?title)[^"]*"[^>]*>([^<]+)/i) ||
    rx(html, /<h1[^>]*>([^<\n]+)/)
  );

  let price = rx(html, /"price"\s*:\s*"([\d.]+)"/);
  if (!price) price = extractPrice(rx(html, /class="[^"]*price[^"]*"[^>]*>[^$]*\$([\d,.]+)/i));

  // Description from JSON-LD or og:description
  const jsonLd = extractJsonLd(html);
  const ldProduct = jsonLd.find(d => d['@type'] === 'Product');
  let desc = '';
  if (ldProduct?.description) desc = decodeHtml(ldProduct.description.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
  if (!desc) desc = decodeHtml(rx(html, /<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i));

  let photos = [];
  if (sku) {
    const storagePattern = new RegExp(
      `https://www\\.sideshow\\.com/storage/product-images/${sku}/[^"'\\s)>]+\\.(?:jpg|webp|png)`,
      'gi'
    );
    const found = [...html.matchAll(storagePattern)].map(m => m[0].split('?')[0]);
    const cdnUrls = [...new Set(found)].map(u => `https://www.sideshow.com/cdn-cgi/image/quality=90,f=auto/${u}`);
    photos = cdnUrls.slice(0, 8);
  }
  if (!photos.length) {
    const allImgs = [...html.matchAll(/https?:\/\/[^"'\s]+\.(?:jpg|jpeg|webp)[^"'\s]*/gi)];
    if (sku) photos = [...new Set(allImgs.map(m=>m[0]).filter(u=>u.includes(sku)))].slice(0, 8);
    if (!photos.length) { const og = ogImage(html); if (og) photos = [og]; }
  }

  return {
    name, price, desc, photos,
    franquicia: guessFranquicia(name),
    estado: isPreOrder(html) ? 'Pre-Orden' : 'Entrega Inmediata',
    provider: 'sideshow', sku
  };
}

export async function scrapeShopify(url, html = '') {
  const handleMatch = url.match(/\/products\/([^/?#]+)/);
  if (handleMatch) {
    const origin = new URL(url).origin;
    try {
      const res = await fetch(`${origin}/products/${handleMatch[1]}.json`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Referer': url,
        }
      });
      if (res.ok) {
        const { product } = await res.json();
        const photos = (product.images || [])
          .map(i => i.src.replace(/_\d+x\d*(?:@\d+x)?(\.\w+)(\?.*)?$/, '$1'))
          .slice(0, 8);
        const tags = product.tags ? (Array.isArray(product.tags) ? product.tags : product.tags.split(',').map(t=>t.trim())) : [];
        const desc = htmlToDesc(product.body_html || '');
        const name = product.title || '';
        return {
          name,
          price: product.variants?.[0]?.price || '',
          desc,
          photos,
          marca: product.vendor || '',
          franquicia: guessFranquicia(name, tags),
          escala: guessEscala(name, tags),
          estado: product.variants?.some(v=>v.available) ? 'Entrega Inmediata' : 'Pre-Orden',
          provider: 'shopify'
        };
      }
    } catch (_) {}
  }

  // Fallback: parse HTML
  if (html) {
    // Extract all available data from embedded JS scripts (photos, vendor, tags, product_type)
    const scriptData = extractShopifyScriptData(html, url);

    // Try JSON-LD for metadata (name, price, desc)
    const jsonLd = extractJsonLd(html);
    const ldProduct = jsonLd.find(d => d['@type'] === 'Product');
    if (ldProduct) {
      const name = decodeHtml(ldProduct.name || '');
      const offer = Array.isArray(ldProduct.offers) ? ldProduct.offers[0] : ldProduct.offers;
      const price = offer?.price ? String(offer.price) : '';
      const desc = decodeHtml((ldProduct.description || '').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
      const available = offer?.availability?.includes('InStock') ?? !isPreOrder(html);
      let photos = scriptData.photos;
      if (!photos.length) {
        const imgRaw = Array.isArray(ldProduct.image) ? ldProduct.image : (ldProduct.image ? [ldProduct.image] : []);
        photos = imgRaw.map(i => typeof i === 'string' ? i : (i.url || '')).filter(Boolean)
          .map(u => u.replace(/_\d+x\d*(?:@\d+x)?(\.\w+)(\?.*)?$/, '$1'))
          .slice(0, 8);
      }
      const marca = scriptData.vendor || ldProduct.brand?.name || '';
      const allTags = scriptData.tags.length ? scriptData.tags : [];
      return {
        name, price, desc,
        photos: photos.length ? photos : [ogImage(html)].filter(Boolean),
        marca,
        franquicia: guessFranquicia(name, allTags),
        escala: guessEscala(name + ' ' + scriptData.productType, allTags),
        estado: available ? 'Entrega Inmediata' : 'Pre-Orden',
        provider: 'shopify'
      };
    }

    // No JSON-LD — combine script data with generic metadata
    const generic = scrapeGeneric(html);
    const name = generic.name;
    const allTags = scriptData.tags;
    return {
      ...generic,
      photos: scriptData.photos.length ? scriptData.photos : generic.photos,
      marca: scriptData.vendor || generic.marca || '',
      franquicia: guessFranquicia(name, allTags),
      escala: guessEscala(name + ' ' + scriptData.productType, allTags),
      provider: 'shopify'
    };
  }
  throw new Error('Shopify API bloqueada y no hay HTML disponible');
}

export function scrapeWooCommerce(url, html) {
  const name = decodeHtml(
    rx(html, /<h1[^>]*class="[^"]*product[^"]*title[^"]*"[^>]*>([^<]+)/i) ||
    rx(html, /<h1[^>]*>([^<]+)/)
  );
  const largeImgs = [...html.matchAll(/data-large_image="([^"]+)"/gi)].map(m => m[1]);
  const galleryImgs = [...html.matchAll(/class="[^"]*woocommerce[^"]*gallery[^"]*"[\s\S]{0,500}?<img[^>]+src="([^"]+)"/gi)].map(m => m[1]);
  const allImgs = [...new Set([...largeImgs, ...galleryImgs])].filter(u => u.startsWith('http')).slice(0, 8);
  const photos = allImgs.length ? allImgs : [ogImage(html)].filter(Boolean);
  const price = extractPrice(
    rx(html, /class="[^"]*woocommerce-Price-amount[^"]*"[^>]*>(?:<[^>]+>)*\s*\$?([\d,.]+)/i) ||
    rx(html, /class="[^"]*price[^"]*"[^>]*>(?:<[^>]+>)*\s*\$?([\d,.]+)/i)
  );
  // Try to extract description from product tabs
  const descHtml = rx(html, /class="[^"]*woocommerce-product-details__short-description[^"]*"[^>]*>([\s\S]{0,2000}?)<\/div>/i) ||
                   rx(html, /class="[^"]*product[^"]*description[^"]*"[^>]*>([\s\S]{0,2000}?)<\/div>/i);
  const desc = descHtml ? htmlToDesc(descHtml) : decodeHtml(rx(html, /<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i));
  return { name, price, desc, photos, franquicia: guessFranquicia(name), estado: isPreOrder(html) ? 'Pre-Orden' : 'Entrega Inmediata', provider: 'woocommerce' };
}

export function scrapeBigCommerce(url, html) {
  const name = decodeHtml(
    rx(html, /<h1[^>]*class="[^"]*productView-title[^"]*"[^>]*>([^<]+)/i) ||
    rx(html, /<h1[^>]*>([^<]+)/)
  );
  const jsonLd = extractJsonLd(html);
  const ldProduct = jsonLd.find(d => d['@type'] === 'Product');

  // Strategy 1: extract image URLs from anywhere in the HTML (including JSON-encoded in scripts)
  // BigCommerce embeds product data in stencilBootstrap and data attributes, but JSON-encodes the URLs
  // so we unescape the HTML first, then scan for CDN URLs
  const unescaped = html.replace(/\\u002F/gi, '/').replace(/\\/g, '').replace(/&quot;/g, '"');
  const cdnRe = /https?:\/\/cdn\d*\.bigcommerce\.com\/[^"'\s?]+\.(?:jpg|jpeg|webp|png)/gi;
  const byImgId = new Map();
  for (const source of [html, unescaped]) {
    for (const m of source.matchAll(cdnRe)) {
      const u = m[0];
      if (!u.includes('/products/')) continue;
      const key = u.replace(/\/stencil\/[^/]+\//, '/stencil//');
      if (!byImgId.has(key)) byImgId.set(key, u);
      else {
        const curSize = parseInt(byImgId.get(key).match(/\/stencil\/(\d+)x/)?.[1] || '0');
        const newSize = parseInt(u.match(/\/stencil\/(\d+)x/)?.[1] || '0');
        if (newSize > curSize) byImgId.set(key, u);
      }
    }
  }
  let photos = [...byImgId.values()].slice(0, 8);
  // Strategy 2: JSON-LD image(s)
  if (!photos.length && ldProduct?.image) {
    const imgRaw = Array.isArray(ldProduct.image) ? ldProduct.image : [ldProduct.image];
    photos = imgRaw.map(i => typeof i === 'string' ? i : (i.url || '')).filter(Boolean).slice(0, 8);
  }
  if (!photos.length) photos = [ogImage(html)].filter(Boolean);

  const price = extractPrice(
    rx(html, /class="[^"]*price--main[^"]*"[^>]*>(?:<[^>]+>)*\s*\$?([\d,.]+)/i) ||
    rx(html, /"price"\s*:\s*"?([\d.]+)"?/)
  );
  const descHtml = rx(html, /id="tab-description"[^>]*>([\s\S]{0,3000}?)<\/div>/i) ||
                   rx(html, /class="[^"]*productView-description[^"]*"[^>]*>([\s\S]{0,3000}?)<\/div>/i);
  const descRaw = descHtml ? htmlToDesc(descHtml) : '';
  // Only use extracted description if it has meaningful content (>40 chars)
  const desc = descRaw.length > 40 ? descRaw : decodeHtml(rx(html, /<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i));

  // Extract specs from definition list (dt/dd pairs) — common in BigCommerce stores like FNC
  const specs = {};
  const dlRe = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  let dm;
  while ((dm = dlRe.exec(html)) !== null) {
    const key = decodeHtml(dm[1].replace(/<[^>]+>/g, '').replace(/:$/, '').trim().toLowerCase());
    const val = decodeHtml(dm[2].replace(/<[^>]+>/g, '').trim());
    if (key && val) specs[key] = val;
  }
  const marca = specs['brand'] || ldProduct?.brand?.name || '';
  const escala = specs['scale'] || guessEscala(name);
  const entrega = specs['estimated release time'] || specs['release date'] || specs['release time'] || '';

  return { name, price, desc, photos, marca, escala, entrega, franquicia: guessFranquicia(name), estado: isPreOrder(html) ? 'Pre-Orden' : 'Entrega Inmediata', provider: 'bigcommerce' };
}

export function scrapeOpenCart(url, html) {
  const name = decodeHtml(rx(html, /<h1[^>]*>([^<]+)/));
  const imgs = [...html.matchAll(/<img[^>]+src="([^"]+)"[^>]*class="[^"]*(?:img-thumbnail|product)[^"]*"/gi)]
    .map(m => m[1]).filter(u => u.startsWith('http'));
  const photos = imgs.length ? [...new Set(imgs)].slice(0, 8) : [ogImage(html)].filter(Boolean);
  const price = extractPrice(rx(html, /class="[^"]*price[^"]*"[^>]*>(?:<[^>]+>)*\s*\$?([\d,.]+)/i));
  const desc = decodeHtml(rx(html, /<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i));
  return { name, price, desc, photos, franquicia: guessFranquicia(name), estado: isPreOrder(html) ? 'Pre-Orden' : 'Entrega Inmediata', provider: 'opencart' };
}

export function scrapeEE(html) {
  const name = decodeHtml(rx(html, /<h1[^>]*>([^<]+)/));
  const price = extractPrice(rx(html, /class="[^"]*(?:our-price|sale-price)[^"]*"[^>]*>\s*\$?([\d,.]+)/i));
  const og = ogImage(html);
  const desc = decodeHtml(rx(html, /<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i));
  return { name, price, desc, photos: og ? [og] : [], franquicia: guessFranquicia(name), estado: isPreOrder(html) ? 'Pre-Orden' : 'Entrega Inmediata', provider: 'entertainmentearth' };
}

export function scrapeBBTS(html) {
  const name = decodeHtml(rx(html, /<h1[^>]*>([^<]+)/));
  const price = extractPrice(rx(html, /class="[^"]*(?:retail|price)[^"]*"[^>]*>\s*\$?([\d,.]+)/i));
  const og = ogImage(html);
  const desc = decodeHtml(rx(html, /<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i));
  return { name, price, desc, photos: og ? [og] : [], franquicia: guessFranquicia(name), estado: isPreOrder(html) ? 'Pre-Orden' : 'Entrega Inmediata', provider: 'bbts' };
}

export function scrapeGeneric(html) {
  const name = decodeHtml(
    rx(html, /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i) ||
    rx(html, /<title[^>]*>([^<|·\-–]+)/)
  );
  const price = extractPrice(
    rx(html, /<meta[^>]*property="product:price:amount"[^>]*content="([^"]+)"/i) ||
    rx(html, /"price"\s*:\s*"?([\d.]+)"?/)
  );
  const og = ogImage(html);
  const desc = decodeHtml(rx(html, /<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i));
  return { name, price, desc, photos: og ? [og] : [], franquicia: guessFranquicia(name), estado: isPreOrder(html) ? 'Pre-Orden' : 'Entrega Inmediata', provider: 'generic' };
}
