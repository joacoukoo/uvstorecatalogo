import { detectProvider, scrapeSideshow, scrapeShopify, scrapeEE, scrapeBBTS, scrapeGeneric } from '../_lib/scrapers.js';

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

export async function onRequestPost({ request }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'JSON inválido' }, 400); }

  const { url } = body;
  if (!url || !url.startsWith('http')) return json({ error: 'URL inválida' }, 400);

  try {
    const provider = detectProvider(url);
    let result;
    if (provider === 'shopify') {
      result = await scrapeShopify(url);
    } else {
      const res = await fetch(url, { headers: FETCH_HEADERS });
      if (!res.ok) return json({ error: `El sitio respondió ${res.status}` }, 422);
      const html = await res.text();
      if (provider === 'sideshow') result = await scrapeSideshow(url, html);
      else if (provider === 'entertainmentearth') result = scrapeEE(html);
      else if (provider === 'bbts') result = scrapeBBTS(html);
      else result = scrapeGeneric(html);
    }
    return json(result);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
