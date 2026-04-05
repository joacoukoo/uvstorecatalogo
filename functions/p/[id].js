// Cloudflare Pages Function — OG tags dinámicos por producto
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

  const siteName = "UV Store GT";
  const title    = `${product.n} — ${siteName}`;
  const fotos    = (product.fotos && product.fotos.length) ? product.fotos : [];
  const image    = fotos.find(f => f && f.startsWith("http")) || product.i || `${siteUrl}/favicon.png`;
  const pricePart = product.precio ? ` · Q${product.precio}` : "";
  const desc     = [product.marca, product.escala, product.estado].filter(Boolean).join(" · ") + pricePart;
  const canonical = `${siteUrl}/p/${encodeURIComponent(figId)}`;
  const redirect  = `${siteUrl}/#figura/${encodeURIComponent(figId)}`;

  const esc = s => String(s)
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type"        content="product">
<meta property="og:site_name"   content="${esc(siteName)}">
<meta property="og:title"       content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image"       content="${esc(image)}">
<meta property="og:image:width" content="800">
<meta property="og:image:height" content="800">
<meta property="og:url"         content="${esc(canonical)}">
<meta name="twitter:card"       content="summary_large_image">
<meta name="twitter:title"      content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image"      content="${esc(image)}">
<meta http-equiv="refresh" content="0;url=${esc(redirect)}">
<script>window.location.replace(${JSON.stringify(redirect)});</script>
</head>
<body></body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html;charset=UTF-8" },
  });
}
