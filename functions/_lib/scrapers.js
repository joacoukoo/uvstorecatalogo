// Explicit domain → platform mapping (mirrors uv_admin.py PROVIDER_PLATFORMS)
const DOMAIN_PLATFORMS = {
  'sideshow.com':          'sideshow',
  'lionrocktoyz.com':      'shopify',
  'fanaticanimestore.com': 'bigcommerce',
  'statuecorp.com':        'shopify',
  'tnsfigures.com':        'shopify',
  'mondoshop.com':         'shopify',
  'specfictionshop.com':   'shopify',
  'onesixthkit.com':       'opencart',
  'entertainmentearth.com':'generic',
  'bigbadtoystore.com':    'generic',
  'hottoys.com.hk':        'generic',
};

export function detectProvider(url, html = '') {
  const domain = new URL(url).hostname.replace(/^www\./, '');
  for (const [d, p] of Object.entries(DOMAIN_PLATFORMS)) {
    if (domain.includes(d)) return p;
  }
  // Auto-detect from HTML
  if (html) {
    const head = html.slice(0, 4000).toLowerCase();
    if (head.includes('cdn.shopify.com') || head.includes('"shopify"')) return 'shopify';
    if (head.includes('woocommerce') || head.includes('wc-block')) return 'woocommerce';
    if (head.includes('bigcommerce')) return 'bigcommerce';
    if (head.includes('opencart') || url.includes('index.php?route=product')) return 'opencart';
  }
  // URL-based Shopify fallback
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

export async function scrapeSideshow(url, html) {
  // Extract SKU from ?var= or URL path number (e.g. -915521)
  const varMatch = url.match(/[?&](?:var|sku)=(\d{5,})/i);
  const pathMatch = url.match(/-(\d{6,})\/?(?:\?.*)?$/);
  const sku = (varMatch ? varMatch[1] : pathMatch ? pathMatch[1] : null);

  const name = decodeHtml(
    rx(html, /<h1[^>]*class="[^"]*(?:product[_-]?title|pdp[_-]?title)[^"]*"[^>]*>([^<]+)/i) ||
    rx(html, /<h1[^>]*>([^<\n]+)/)
  );

  let price = rx(html, /"price"\s*:\s*"([\d.]+)"/);
  if (!price) price = extractPrice(rx(html, /class="[^"]*price[^"]*"[^>]*>[^$]*\$([\d,.]+)/i));

  let photos = [];
  if (sku) {
    // Use Sideshow CDN pattern with quality optimization
    const storagePattern = new RegExp(
      `https://www\\.sideshow\\.com/storage/product-images/${sku}/[^"'\\s)>]+\\.(?:jpg|webp|png)`,
      'gi'
    );
    const found = [...html.matchAll(storagePattern)].map(m => m[0].split('?')[0]);
    const cdnUrls = [...new Set(found)].map(u => `https://www.sideshow.com/cdn-cgi/image/quality=90,f=auto/${u}`);
    photos = cdnUrls.slice(0, 8);
  }
  if (!photos.length) {
    // Fallback: any image URL containing the SKU
    const allImgs = [...html.matchAll(/https?:\/\/[^"'\s]+\.(?:jpg|jpeg|webp)[^"'\s]*/gi)];
    if (sku) {
      photos = [...new Set(allImgs.map(m=>m[0]).filter(u=>u.includes(sku)))].slice(0, 8);
    }
    if (!photos.length) {
      const og = ogImage(html);
      if (og) photos = [og];
    }
  }

  return { name, price, desc: '', photos, estado: isPreOrder(html) ? 'Pre-Orden' : 'Entrega Inmediata', provider: 'sideshow', sku };
}

export async function scrapeShopify(url, html = '') {
  const handleMatch = url.match(/\/products\/([^/?#]+)/);
  if (handleMatch) {
    const origin = new URL(url).origin;
    try {
      const res = await fetch(`${origin}/products/${handleMatch[1]}.json`);
      if (res.ok) {
        const { product } = await res.json();
        // Clean Shopify size suffixes from image URLs (_480x, _1024x1024, etc.)
        const photos = (product.images || [])
          .map(i => i.src.replace(/_\d+x\d*(?:@\d+x)?(\.\w+)(\?.*)?$/, '$1'))
          .slice(0, 8);
        return {
          name: product.title || '',
          price: product.variants?.[0]?.price || '',
          desc: (product.body_html || '').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(),
          photos,
          estado: product.variants?.some(v=>v.available) ? 'Entrega Inmediata' : 'Pre-Orden',
          provider: 'shopify'
        };
      }
    } catch (_) { /* fall through to HTML */ }
  }
  // Fallback: extract Shopify CDN images from HTML
  if (html) {
    const generic = scrapeGeneric(html);
    const cdnImgs = [...html.matchAll(/https?:\/\/cdn\.shopify\.com\/[^"'\s]+\.(?:jpg|jpeg|webp|png)[^"'\s?]*/gi)]
      .map(m => m[0].replace(/_\d+x\d*(?:@\d+x)?(\.\w+)$/, '$1'))
      .filter(u => !/(_icon|icon_|logo|badge)/i.test(u));
    const photos = [...new Set(cdnImgs)].slice(0, 8);
    return { ...generic, photos: photos.length ? photos : generic.photos, provider: 'shopify' };
  }
  throw new Error('Shopify API bloqueada y no hay HTML disponible');
}

export function scrapeWooCommerce(url, html) {
  const name = decodeHtml(
    rx(html, /<h1[^>]*class="[^"]*product[^"]*title[^"]*"[^>]*>([^<]+)/i) ||
    rx(html, /<h1[^>]*>([^<]+)/)
  );
  // WooCommerce gallery images
  const galleryImgs = [...html.matchAll(/class="[^"]*woocommerce[^"]*gallery[^"]*"[\s\S]{0,500}?<img[^>]+src="([^"]+)"/gi)]
    .map(m => m[1]);
  // Also try data-large_image
  const largeImgs = [...html.matchAll(/data-large_image="([^"]+)"/gi)].map(m => m[1]);
  const allImgs = [...new Set([...largeImgs, ...galleryImgs])].filter(u => u.startsWith('http')).slice(0, 8);
  const photos = allImgs.length ? allImgs : [ogImage(html)].filter(Boolean);
  const price = extractPrice(
    rx(html, /class="[^"]*woocommerce-Price-amount[^"]*"[^>]*>(?:<[^>]+>)*\s*\$?([\d,.]+)/i) ||
    rx(html, /class="[^"]*price[^"]*"[^>]*>(?:<[^>]+>)*\s*\$?([\d,.]+)/i)
  );
  return { name, price, desc: '', photos, estado: isPreOrder(html) ? 'Pre-Orden' : 'Entrega Inmediata', provider: 'woocommerce' };
}

export function scrapeBigCommerce(url, html) {
  const name = decodeHtml(
    rx(html, /<h1[^>]*class="[^"]*productView-title[^"]*"[^>]*>([^<]+)/i) ||
    rx(html, /<h1[^>]*>([^<]+)/)
  );
  // BigCommerce CDN images
  const cdnImgs = [...html.matchAll(/https?:\/\/cdn\d*\.bigcommerce\.com\/[^"'\s]+\.(?:jpg|jpeg|webp|png)[^"'\s]*/gi)]
    .map(m => m[0].split('?')[0]);
  const photos = [...new Set(cdnImgs)].slice(0, 8);
  const price = extractPrice(
    rx(html, /class="[^"]*price--main[^"]*"[^>]*>(?:<[^>]+>)*\s*\$?([\d,.]+)/i) ||
    rx(html, /"price"\s*:\s*"?([\d.]+)"?/)
  );
  return { name, price, desc: '', photos: photos.length ? photos : [ogImage(html)].filter(Boolean), estado: isPreOrder(html) ? 'Pre-Orden' : 'Entrega Inmediata', provider: 'bigcommerce' };
}

export function scrapeOpenCart(url, html) {
  const name = decodeHtml(
    rx(html, /<h1[^>]*>([^<]+)/)
  );
  const imgs = [...html.matchAll(/<img[^>]+src="([^"]+)"[^>]*class="[^"]*(?:img-thumbnail|product)[^"]*"/gi)]
    .map(m => m[1]).filter(u => u.startsWith('http'));
  const photos = imgs.length ? [...new Set(imgs)].slice(0, 8) : [ogImage(html)].filter(Boolean);
  const price = extractPrice(rx(html, /class="[^"]*price[^"]*"[^>]*>(?:<[^>]+>)*\s*\$?([\d,.]+)/i));
  return { name, price, desc: '', photos, estado: isPreOrder(html) ? 'Pre-Orden' : 'Entrega Inmediata', provider: 'opencart' };
}

export function scrapeEE(html) {
  const name = decodeHtml(rx(html, /<h1[^>]*>([^<]+)/));
  const price = extractPrice(rx(html, /class="[^"]*(?:our-price|sale-price)[^"]*"[^>]*>\s*\$?([\d,.]+)/i));
  const og = ogImage(html);
  return { name, price, desc: '', photos: og ? [og] : [], estado: isPreOrder(html) ? 'Pre-Orden' : 'Entrega Inmediata', provider: 'entertainmentearth' };
}

export function scrapeBBTS(html) {
  const name = decodeHtml(rx(html, /<h1[^>]*>([^<]+)/));
  const price = extractPrice(rx(html, /class="[^"]*(?:retail|price)[^"]*"[^>]*>\s*\$?([\d,.]+)/i));
  const og = ogImage(html);
  return { name, price, desc: '', photos: og ? [og] : [], estado: isPreOrder(html) ? 'Pre-Orden' : 'Entrega Inmediata', provider: 'bbts' };
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
  return { name, price, desc, photos: og ? [og] : [], estado: isPreOrder(html) ? 'Pre-Orden' : 'Entrega Inmediata', provider: 'generic' };
}
