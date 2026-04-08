export function detectProvider(url) {
  if (/sideshowtoy\.com/i.test(url)) return 'sideshow';
  if (/entertainmentearth\.com/i.test(url)) return 'entertainmentearth';
  if (/bigbadtoystore\.com/i.test(url)) return 'bbts';
  if (/\/products\/[^/?]+/.test(url)) return 'shopify';
  return 'generic';
}

function rx(html, re) {
  const r = html.match(re);
  return r ? (r[1] || '').trim() : '';
}

function decodeHtml(s) {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&nbsp;/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(n));
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
  const varMatch = url.match(/[?&]var=([A-Z0-9-]+)/i);
  const sku = varMatch ? varMatch[1].toUpperCase() : null;
  const name = decodeHtml(
    rx(html, /<h1[^>]*class="[^"]*(?:product[_-]?title|pdp[_-]?title)[^"]*"[^>]*>([^<]+)/i) ||
    rx(html, /<h1[^>]*>([^<\n]+)/)
  );
  let price = rx(html, /"price"\s*:\s*"([\d.]+)"/);
  if (!price) price = extractPrice(rx(html, /class="[^"]*price[^"]*"[^>]*>[^$]*\$([\d,.]+)/i));
  let photos = [];
  if (sku) {
    const allImgs = [...html.matchAll(/https?:\/\/[^"'\s]+\.(?:jpg|jpeg|webp)[^"'\s]*/gi)];
    photos = [...new Set(allImgs.map(m=>m[0]).filter(u=>u.toUpperCase().includes(sku)))].slice(0,8);
  }
  if (!photos.length) {
    const og = ogImage(html);
    if (og) photos = [og];
  }
  return { name, price, desc: '', photos, estado: isPreOrder(html) ? 'Pre-Orden' : 'Entrega Inmediata', provider: 'sideshow', sku };
}

export async function scrapeShopify(url) {
  const handleMatch = url.match(/\/products\/([^/?#]+)/);
  if (!handleMatch) throw new Error('No se detectó handle Shopify');
  const origin = new URL(url).origin;
  const res = await fetch(`${origin}/products/${handleMatch[1]}.json`);
  if (!res.ok) throw new Error(`Shopify API: ${res.status}`);
  const { product } = await res.json();
  return {
    name: product.title || '',
    price: product.variants?.[0]?.price || '',
    desc: (product.body_html || '').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(),
    photos: (product.images || []).map(i=>i.src).slice(0,8),
    estado: product.variants?.some(v=>v.available) ? 'Entrega Inmediata' : 'Pre-Orden',
    provider: 'shopify'
  };
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
    rx(html, /<title[^>]*>([^<|·-]+)/)
  );
  const price = extractPrice(
    rx(html, /<meta[^>]*property="product:price:amount"[^>]*content="([^"]+)"/i) ||
    rx(html, /"price"\s*:\s*"?([\d.]+)"?/)
  );
  const og = ogImage(html);
  const desc = decodeHtml(rx(html, /<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i));
  return { name, price, desc, photos: og ? [og] : [], estado: isPreOrder(html) ? 'Pre-Orden' : 'Entrega Inmediata', provider: 'generic' };
}
