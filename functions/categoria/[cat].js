// Cloudflare Pages Function — Página de categoría para SEO
// Ruta: /categoria/{slug}  →  ej: uvstore.shop/categoria/estatuas-premium

function toSlug(str) {
  return String(str).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const esc = s => String(s)
  .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
  .replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function onRequestGet(context) {
  const { params, request } = context;
  const catSlug = params.cat;
  const url = new URL(request.url);
  const siteUrl = url.origin;

  if (!catSlug) return Response.redirect(siteUrl, 302);

  // Cargar catálogo
  let catalog;
  try {
    const req = new Request(`${siteUrl}/productos.json`);
    const resp = context.env?.ASSETS ? await context.env.ASSETS.fetch(req) : await fetch(req);
    if (!resp.ok) throw new Error(`status ${resp.status}`);
    catalog = await resp.json();
  } catch {
    return Response.redirect(siteUrl, 302);
  }

  // Buscar categoría que coincida con el slug
  let catName = null;
  let products = [];
  for (const [key, catData] of Object.entries(catalog)) {
    if (toSlug(key) === catSlug) {
      catName = key;
      products = catData?.products || [];
      break;
    }
  }

  if (!catName || !products.length) return Response.redirect(siteUrl, 302);

  const siteName  = "UV Store GT";
  const title     = `${catName} Guatemala — ${siteName}`;
  const metaDesc  = `Comprá ${catName.toLowerCase()} en Guatemala. ${products.length} producto${products.length !== 1 ? "s" : ""} disponible${products.length !== 1 ? "s" : ""} con entrega inmediata y pre-órdenes. Consultá por WhatsApp.`;
  const canonical = `${siteUrl}/categoria/${encodeURIComponent(catSlug)}`;

  // JSON-LD ItemList
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": `${catName} Guatemala`,
    "description": metaDesc,
    "numberOfItems": products.length,
    "itemListElement": products.slice(0, 10).map((p, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "item": {
        "@type": "Product",
        "name": p.n,
        "url": `${siteUrl}/p/${encodeURIComponent(p.id || "")}`,
        "image": p.fotos?.[0] || p.i || `${siteUrl}/favicon.png`,
        "offers": {
          "@type": "Offer",
          "priceCurrency": "GTQ",
          "price": p.precio || "0",
          "availability": p.disp === "Entrega Inmediata"
            ? "https://schema.org/InStock"
            : "https://schema.org/PreOrder"
        }
      }
    }))
  };

  const cardsHtml = products.map(p => {
    const img     = p.fotos?.[0] || p.i || `${siteUrl}/favicon.png`;
    const prodUrl = `${siteUrl}/p/${encodeURIComponent(p.id || "")}`;
    const price   = p.precio ? `Q${esc(p.precio)}` : "Consultar";
    const disp    = p.disp || "";
    const dispCls = disp.toLowerCase().includes("inmediata") ? "badge-stock"
                  : disp.toLowerCase().includes("pre")       ? "badge-pre" : "";
    return `<a class="prod-card" href="${esc(prodUrl)}">
  <img src="${esc(img)}" alt="${esc(p.n)}" loading="lazy">
  <div class="prod-info">
    <div class="prod-name">${esc(p.n)}</div>
    <div class="prod-price">${price}</div>
    ${disp ? `<span class="badge ${dispCls}">${esc(disp)}</span>` : ""}
  </div>
</a>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(metaDesc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type"        content="website">
<meta property="og:title"       content="${esc(title)}">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:url"         content="${esc(canonical)}">
<meta property="og:site_name"   content="${esc(siteName)}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0d0d0f;color:#e0e0e0;padding:24px 16px;max-width:960px;margin:0 auto}
.back{color:#a78bfa;text-decoration:none;font-size:14px;display:inline-block;margin-bottom:20px}
h1{font-size:26px;font-weight:700;margin-bottom:6px}
.subtitle{color:#999;font-size:14px;margin-bottom:28px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px}
.prod-card{background:#1a1a2e;border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;display:block;transition:transform .2s}
.prod-card:hover{transform:translateY(-2px)}
.prod-card img{width:100%;aspect-ratio:1;object-fit:cover}
.prod-info{padding:10px}
.prod-name{font-size:13px;font-weight:600;line-height:1.3;margin-bottom:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.prod-price{font-size:15px;font-weight:700;color:#a78bfa;margin-bottom:4px}
.badge{font-size:10px;padding:2px 6px;border-radius:4px;font-weight:600}
.badge-stock{background:#166534;color:#86efac}
.badge-pre{background:#1e3a5f;color:#93c5fd}
.wa-btn{display:inline-block;margin-top:28px;background:#25d366;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600}
</style>
</head>
<body>
<a class="back" href="${siteUrl}">← UV Store GT</a>
<h1>${esc(catName)} en Guatemala</h1>
<p class="subtitle">${products.length} producto${products.length !== 1 ? "s" : ""} disponible${products.length !== 1 ? "s" : ""}</p>
<div class="grid">
${cardsHtml}
</div>
<a class="wa-btn" href="https://wa.me/50230261622?text=${encodeURIComponent("Hola! Quiero consultar sobre " + catName + " en UV Store GT")}">Consultar por WhatsApp</a>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html;charset=UTF-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
