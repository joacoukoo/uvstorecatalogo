# Design: Search URLs + OG Thumbnail Fix + Back Navigation

**Date:** 2026-04-08  
**Status:** Approved

---

## Context

Three issues in the UV Store GT catalog site:

1. **OG thumbnail broken on sharing** — Product images are hosted on Sideshow's CDN which blocks hotlink requests from social media crawlers (WhatsApp, Telegram, etc.). The `/functions/p/[id].js` puts raw Sideshow URLs in `og:image`, which crawlers cannot load.

2. **Search not shareable** — Search is purely client-side state. There is no URL reflection, so search results cannot be shared or bookmarked.

3. **Back button from figure loses search context** — When a user searches, clicks a result (which pushes `/p/{id}` to history), then closes the figure, `history.back()` returns to whatever was before the search — losing all search state. This is a direct consequence of issue #2.

---

## Fix 1 — OG Thumbnail: Image Proxy

### Problem
All 392 products have Sideshow CDN URLs (zero Imgur). Sideshow blocks hotlink requests from social media crawlers. Server-to-server requests from Cloudflare ARE allowed.

### Solution
Create `/functions/img/[id].js` — a Cloudflare Pages Function that:
1. Looks up the product by `p.id` in `productos.json`
2. Fetches the product image server-to-server from Sideshow (bypasses hotlink block)
3. Returns the image with appropriate `Content-Type` and cache headers

Update `/functions/p/[id].js` to set:
```
og:image = {siteUrl}/img/{figId}
```
instead of the raw Sideshow URL.

### Files changed
- `functions/img/[id].js` — new file
- `functions/p/[id].js` — change `og:image` value (line 102)

### Cache
Proxy images cached with `Cache-Control: public, max-age=86400` (24h). Product images rarely change.

---

## Fix 2 — Shareable Search URLs

### Solution
Reflect search query in URL as `?q={query}` using `history.pushState`/`replaceState`.

**On search input:**
- Entering search mode (URL was not `?q=`) → `history.pushState` once (so back button exits search)
- Refining an existing search (URL already has `?q=`) → `history.replaceState` (avoids flooding history with every keystroke)
- Clearing search → `history.replaceState(null, "", "/")`

**On page load:**
- Read `new URLSearchParams(location.search).get("q")`
- If present, populate the search input and call `doSearchInline(q)`

**On `popstate`:**
- Re-read `location.search` and re-run search if `?q=` is present

### Shared URL behavior
`https://uvstore.shop/?q=inart` opens directly to filtered results for "inart".

### Files changed
- `index_template.html` — modify `doSearchInline()` to push URL, add init logic and popstate handler

---

## Fix 3 — Back Button (resolved by Fix 2)

With Fix 2 in place, the browser history stack becomes:

| Step | URL | State |
|------|-----|-------|
| 1 | `/` | home |
| 2 | `/?q=inart` | search results |
| 3 | `/p/inart-figure` | figure open |
| 4 (back) | `/?q=inart` | search re-runs via popstate |

No additional code needed beyond Fix 2.

---

## Verification

1. **Thumbnail:** Share a figure URL on WhatsApp → preview should show the product image
2. **Search URL:** Search for "inart" → URL bar shows `?q=inart` → copy and open in new tab → same results
3. **Back button:** Search → click figure → close → should land back on search results, not home
