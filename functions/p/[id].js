// Cloudflare Pages Function — Página de producto con SEO + OG tags
// Ruta: /p/{id}  →  ej: uvstore.shop/p/wolverinepool

export async function onRequestGet(context) {
  const { params, request } = context;
  const figId = params.id;
  const url = new URL(request.url);
  const siteUrl = url.origin;

  if (!figId) return Response.redirect(siteUrl, 302);

  // Cargar catálogo
  let catalog;
  try {
    let resp;
    if (context.env && context.env.ASSETS) {
      resp = await context.env.ASSETS.fetch(new Request(`${siteUrl}/productos.json`));
    } else {
      resp = await fetch(`${siteUrl}/productos.json`);
    }
    if (!resp.ok) throw new Error(`status ${resp.status}`);
    catalog = await resp.json();
  } catch {
    return Response.redirect(siteUrl, 302);
  }

  // Buscar producto por id
  let product = null;
  for (const catData of Object.values(catalog)) {
    const prods = (catData && catData.products) ? catData.products : [];
    const found = prods.find(p => p.id === figId);
    if (found) { product = found; break; }
  }

  if (!product) return Response.redirect(siteUrl, 302);

  const siteName  = "UV Store GT";
  const title     = `${product.n} — ${siteName}`;
  const fotos     = (product.fotos && product.fotos.length) ? product.fotos : [];
  const image     = fotos.find(f => f && f.startsWith("http")) || product.i || `${siteUrl}/favicon.png`;
  const pricePart = product.precio ? ` · Q${product.precio}` : "";
  const metaDesc  = [product.marca, product.escala, product.estado].filter(Boolean).join(" · ") + pricePart;
  const canonical = `${siteUrl}/p/${encodeURIComponent(figId)}`;
  const redirect  = `${siteUrl}/#figura/${encodeURIComponent(figId)}`;

  // Extraer descripción de los content blocks
  let descripcion = "";
  let features = [];
  if (product.content && Array.isArray(product.content)) {
    for (const block of product.content) {
      if (block.t === "notion-text" && block.x) {
        descripcion = block.x;
      } else if (block.t === "notion-bulleted-list" && block.x) {
        // Cada bullet puede tener múltiples items separados por saltos de línea
        const items = block.x.split(/\n/).map(s => s.trim()).filter(Boolean);
        features.push(...items);
      }
    }
  }

  const esc = s => String(s)
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // JSON-LD para Google rich results
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": product.n,
    "image": fotos.length ? fotos.slice(0, 5) : [image],
    "description": descripcion || metaDesc,
    "brand": { "@type": "Brand", "name": product.marca || siteName },
    "offers": {
      "@type": "Offer",
      "priceCurrency": "GTQ",
      "price": product.precio || "0",
      "availability": product.disp === "Entrega Inmediata"
        ? "https://schema.org/InStock"
        : "https://schema.org/PreOrder",
      "seller": { "@type": "Organization", "name": siteName }
    }
  };

  // HTML de la página de producto
  const featuresHtml = features.length
    ? `<ul>${features.map(f => `<li>${esc(f)}</li>`).join("")}</ul>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(metaDesc)}">
<link rel="canonical" href="${esc(canonical)}">
<!-- Open Graph -->
<meta property="og:type"         content="product">
<meta property="og:site_name"    content="${esc(siteName)}">
<meta property="og:title"        content="${esc(title)}">
<meta property="og:description"  content="${esc(metaDesc)}">
<meta property="og:image"        content="${esc(image)}">
<meta property="og:image:width"  content="800">
<meta property="og:image:height" content="800">
<meta property="og:url"          content="${esc(canonical)}">
<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:title"       content="${esc(title)}">
<meta name="twitter:description" content="${esc(metaDesc)}">
<meta name="twitter:image"       content="${esc(image)}">
<!-- JSON-LD -->
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
  body{font-family:system-ui,sans-serif;max-width:700px;margin:0 auto;padding:24px 16px;background:#0d0d0f;color:#e0e0e0}
  h1{font-size:22px;margin:0 0 8px}
  .meta{color:#999;font-size:14px;margin-bottom:16px}
  img{max-width:100%;border-radius:12px;margin-bottom:16px}
  p{line-height:1.6;color:#ccc;font-size:15px}
  ul{color:#ccc;font-size:15px;line-height:1.8;padding-left:20px}
  .price{font-size:24px;font-weight:700;color:#a78bfa;margin:12px 0}
  .btn{display:inline-block;background:#25d366;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;margin-top:16px}
  .logo{color:#999;font-size:13px;margin-bottom:20px}
</style>
</head>
<body>
<div class="logo"><a href="${siteUrl}" style="color:#a78bfa;text-decoration:none">${esc(siteName)}</a></div>
<img src="${esc(image)}" alt="${esc(product.n)}" loading="lazy">
<h1>${esc(product.n)}</h1>
<div class="meta">${esc([product.marca, product.escala, product.estado, product.disp].filter(Boolean).join(" · "))}</div>
${product.precio ? `<div class="price">Q${esc(product.precio)}</div>` : ""}
${descripcion ? `<p>${esc(descripcion)}</p>` : ""}
${featuresHtml}
<a class="btn" href="https://wa.me/50230261622?text=${encodeURIComponent("Hola! Me interesa: " + product.n + " — " + canonical)}">Consultar por WhatsApp</a>
<!-- Redirigir a la app (bots no ejecutan JS) -->
<script>window.location.replace(${JSON.stringify(redirect)});</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html;charset=UTF-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
