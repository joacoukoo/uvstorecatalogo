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
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      });
    } catch (e) {
      return json({ error: "Fetch failed: " + e.message }, 502);
    }

    const html = await resp.text();

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
