// Descarga de páginas de tiendas: maneja redirects con cookies y cae al proxy si el sitio bloquea.
export const FETCH_HEADERS = {
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

export const PROXY_URL = 'https://safe-carp-12.joacoukoo.deno.net';

// Fetch with manual redirect handling to preserve cookies across redirects
export async function fetchPage(url, maxRedirects = 6) {
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
export async function fetchViaProxy(url) {
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
