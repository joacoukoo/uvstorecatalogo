// Cloudflare Pages Function — inyecta OG tags dinámicos para previews de figuras
// Se activa cuando la URL tiene ?figura={id} (ej: links compartidos desde WhatsApp)

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const figId = url.searchParams.get("figura");

  // Sin parámetro: servir index.html normal
  if (!figId) return context.next();

  // Cargar catálogo — intenta ASSETS binding primero, luego fetch directo
  let catalog;
  try {
    const assetReq = new Request(new URL("/productos.json", url.origin));
    let resp;
    if (context.env && context.env.ASSETS) {
      resp = await context.env.ASSETS.fetch(assetReq);
    } else {
      resp = await fetch(assetReq);
    }
    if (!resp.ok) throw new Error(`status ${resp.status}`);
    catalog = await resp.json();
  } catch (e) {
    // Si no se puede cargar el catálogo, dejar que Cloudflare sirva index.html
    return context.next();
  }

  // Buscar producto por id
  let product = null;
  for (const catData of Object.values(catalog)) {
    const prods = (catData && catData.products) ? catData.products : [];
    const found = prods.find(p => p.id === figId);
    if (found) { product = found; break; }
  }

  if (!product) return context.next();

  const siteName  = "UV Store GT";
  const siteUrl   = url.origin;
  const title     = `${product.n} — ${siteName}`;

  // Imagen: usar la primera foto disponible, filtrando URLs vacías
  const fotos = (product.fotos && product.fotos.length) ? product.fotos : [];
  const image = fotos.find(f => f && f.startsWith("http")) || product.i || `${siteUrl}/favicon.png`;

  const pricePart = product.precio ? ` · Q${product.precio}` : "";
  const desc = [product.marca, product.escala, product.estado]
    .filter(Boolean).join(" · ") + pricePart;
  const canonical = `${siteUrl}/?figura=${encodeURIComponent(figId)}`;
  const redirect  = `${siteUrl}/#figura/${encodeURIComponent(figId)}`;

  const esc = s => String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<!-- Open Graph -->
<meta property="og:type"         content="product">
<meta property="og:site_name"    content="${esc(siteName)}">
<meta property="og:title"        content="${esc(title)}">
<meta property="og:description"  content="${esc(desc)}">
<meta property="og:image"        content="${esc(image)}">
<meta property="og:image:width"  content="800">
<meta property="og:image:height" content="800">
<meta property="og:url"          content="${esc(canonical)}">
<!-- Twitter / iMessage -->
<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:title"       content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image"       content="${esc(image)}">
<!-- Redirigir al SPA via hash (evita re-disparar la Function) -->
<meta http-equiv="refresh" content="0;url=${esc(redirect)}">
<script>window.location.replace(${JSON.stringify(redirect)});</script>
</head>
<body></body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html;charset=UTF-8" },
  });
}
