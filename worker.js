/**
 * worker.js — UV Store GT CORS Proxy
 * Deploy on Cloudflare Workers.
 * Set environment variable PROXY_SECRET to any secret string.
 *
 * POST { url, secret }          → { html, finalUrl, status }  (scraping proxy)
 * POST { ai:true, secret, ... } → Anthropic API proxy
 * GET  ?url=...&secret=...      → image proxy
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── GET: image proxy ──
    if (request.method === "GET") {
      const params = new URL(request.url).searchParams;
      const imgUrl = params.get("url");
      const secret = params.get("secret");

      if (!secret || secret !== env.PROXY_SECRET)
        return new Response("Unauthorized", { status: 401, headers: CORS });
      if (!imgUrl || !/^https?:\/\//.test(imgUrl))
        return new Response("Invalid URL", { status: 400, headers: CORS });

      try {
        const resp = await fetch(imgUrl, {
          headers: {
            "Referer": new URL(imgUrl).origin + "/",
            "User-Agent": BROWSER_HEADERS["User-Agent"],
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          },
        });
        return new Response(resp.body, {
          status: resp.status,
          headers: {
            "Content-Type": resp.headers.get("Content-Type") || "image/jpeg",
            "Cache-Control": "public, max-age=86400",
            ...CORS,
          },
        });
      } catch (e) {
        return new Response("Image fetch failed: " + e.message, { status: 502, headers: CORS });
      }
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: CORS });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const { secret } = body;
    if (!secret || secret !== env.PROXY_SECRET) {
      return json({ error: "Unauthorized" }, 401);
    }

    // ── POST { ai: true }: Anthropic proxy ──
    if (body.ai) {
      const { anthropicKey, model, system, messages, max_tokens } = body;
      if (!anthropicKey) return json({ error: "No anthropicKey" }, 400);
      try {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({ model, system, messages, max_tokens }),
        });
        const data = await r.json();
        return json(data, r.status);
      } catch (e) {
        return json({ error: "Anthropic fetch failed: " + e.message }, 502);
      }
    }

    // ── POST { url }: scraping proxy con manejo de Queue-it ──
    const { url } = body;
    if (!url || !/^https?:\/\//.test(url)) {
      return json({ error: "Invalid URL" }, 400);
    }

    try {
      const { html, finalUrl, status } = await fetchWithCookies(url, BROWSER_HEADERS);
      return json({ html, finalUrl, status }, 200);
    } catch (e) {
      return json({ error: e.message, url }, 502);
    }
  },
};

/**
 * Sigue redirects manualmente acumulando cookies.
 * Necesario para pasar el sistema Queue-it de Sideshow.
 */
async function fetchWithCookies(startUrl, baseHeaders) {
  const cookieJar = {};
  let currentUrl = startUrl;

  for (let hop = 0; hop < 15; hop++) {
    const cookieStr = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join("; ");
    const headers = { ...baseHeaders };
    if (cookieStr) headers["Cookie"] = cookieStr;

    const resp = await fetch(currentUrl, { headers, redirect: "manual" });

    harvestCookies(resp.headers, cookieJar);

    if (resp.status >= 200 && resp.status < 300) {
      const html = await resp.text();
      return { html, finalUrl: currentUrl, status: resp.status };
    }

    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      if (!loc) throw new Error("Redirect sin encabezado Location");
      currentUrl = new URL(loc, currentUrl).href;
      continue;
    }

    throw new Error(`HTTP ${resp.status} en ${currentUrl}`);
  }

  throw new Error("Demasiadas redirecciones — Sideshow cola de espera activa. Intentá en unos minutos.");
}

function harvestCookies(headers, jar) {
  let cookies = [];
  if (typeof headers.getAll === "function") {
    try { cookies = headers.getAll("set-cookie"); } catch {}
  }
  if (cookies.length === 0) {
    const raw = headers.get("set-cookie") || "";
    if (raw) cookies = raw.split(/,(?=\s*[A-Za-z0-9_\-]+=)/);
  }
  for (const c of cookies) {
    const nameVal = c.split(";")[0].trim();
    const eq = nameVal.indexOf("=");
    if (eq > 0) jar[nameVal.slice(0, eq).trim()] = nameVal.slice(eq + 1).trim();
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
