import { detectProvider, scrapeSideshow, scrapeShopify, scrapeWooCommerce, scrapeBigCommerce, scrapeOpenCart, scrapeEE, scrapeBBTS, scrapeGeneric, guessFranquicia as guessFranquiciaProxy, guessEscala as guessEscalaProxy } from '../_lib/scrapers.js';

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

const PROXY_URL = 'https://safe-carp-12.joacoukoo.deno.net';

// Fetch with manual redirect handling to preserve cookies across redirects
async function fetchPage(url, maxRedirects = 6) {
  let currentUrl = url;
  let cookies = {};
  for (let i = 0; i <= maxRedirects; i++) {
    const cookieHeader = Object.entries(cookies).map(([k,v]) => `${k}=${v}`).join('; ');
    const headers = { ...FETCH_HEADERS };
    if (cookieHeader) headers['Cookie'] = cookieHeader;
    const res = await fetch(currentUrl, { headers, redirect: 'manual' });
    // Collect Set-Cookie headers
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      for (const part of setCookie.split(',')) {
        const m = part.trim().match(/^([^=]+)=([^;]*)/);
        if (m) cookies[m[1].trim()] = m[2].trim();
      }
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`Redirect sin Location header`);
      currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).toString();
      continue;
    }
    if (res.status === 429 || res.status === 403) {
      // Blocked by bot detection — retry through external proxy
      return fetchViaProxy(currentUrl);
    }
    if (!res.ok) throw new Error(`El sitio respondio ${res.status}`);
    return res;
  }
  throw new Error('Too many redirects');
}

// Fetch through Deno proxy to bypass IP-based blocks
async function fetchViaProxy(url) {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  if (!res.ok) throw new Error(`Proxy error: ${res.status}`);
  const { html, status, error } = await res.json();
  if (error) throw new Error(`Proxy: ${error}`);
  if (status && status >= 400) throw new Error(`El sitio respondio ${status}`);
  // Return a fake Response-like object with .text() method
  return { ok: true, text: () => Promise.resolve(html) };
}

export async function onRequestPost({ request }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'JSON invalido' }, 400); }

  const { url } = body;
  if (!url || !url.startsWith('http')) return json({ error: 'URL invalida' }, 400);

  try {
    // For known Shopify stores, try the JSON API first (direct, then via proxy)
    const providerEarly = detectProvider(url);
    if (providerEarly === 'shopify') {
      // Direct JSON API
      try {
        const result = await scrapeShopify(url, '');
        if (result.name) return json(result);
      } catch (_) {}
      // JSON API via proxy (for sites that block Cloudflare IPs)
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
                return json({ name, price: product.variants?.[0]?.price||'', marca: product.vendor||'', photos, franquicia: guessFranquiciaProxy(name, tags), escala: guessEscalaProxy(name, tags), estado: product.variants?.some(v=>v.available)?'Entrega Inmediata':'Pre-Orden', provider: 'shopify' });
              }
            }
          }
        } catch (_) {}
      }
    }

    const res = await fetchPage(url);
    if (!res.ok) return json({ error: `El sitio respondio ${res.status}` }, 422);
    const html = await res.text();

    // Re-detect with HTML for auto-detection (woocommerce, bigcommerce, etc.)
    const provider = detectProvider(url, html);

    let result;
    if (provider === 'sideshow')          result = await scrapeSideshow(url, html);
    else if (provider === 'shopify')      result = await scrapeShopify(url, html);
    else if (provider === 'woocommerce')  result = scrapeWooCommerce(url, html);
    else if (provider === 'bigcommerce')  result = scrapeBigCommerce(url, html);
    else if (provider === 'opencart')     result = scrapeOpenCart(url, html);
    else if (provider === 'entertainmentearth') result = scrapeEE(html);
    else if (provider === 'bbts')         result = scrapeBBTS(html);
    else                                  result = scrapeGeneric(html);

    return json(result);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
