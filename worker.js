/**
 * worker.js — UV Store GT CORS Proxy
 * Deploy on Cloudflare Workers.
 * Set environment variable PROXY_SECRET to any secret string.
 *
 * POST { url, secret } → { html, finalUrl }
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
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

    const { url, secret } = body;

    if (!secret || secret !== env.PROXY_SECRET) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (!url || !/^https?:\/\//.test(url)) {
      return json({ error: "Invalid URL" }, 400);
    }

    let resp;
    try {
      resp = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Upgrade-Insecure-Requests": "1",
        },
        redirect: "follow",
      });
    } catch (e) {
      return json({ error: "Fetch failed: " + e.message, url }, 502);
    }

    let html;
    try {
      html = await resp.text();
    } catch (e) {
      return json({ error: "Read body failed: " + e.message, httpStatus: resp.status }, 502);
    }

    return json(
      { html, finalUrl: resp.url, status: resp.status },
      200
    );
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
