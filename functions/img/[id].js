// functions/img/[id].js
// Proxies a product's image server-to-server so social crawlers can load it.
// WhatsApp/Telegram block direct Sideshow CDN URLs; this bypass works because
// the request comes from Cloudflare (not the user's browser).

export async function onRequestGet(context) {
  const { params, request } = context;
  const figId = params.id;
  const url = new URL(request.url);
  const siteUrl = url.origin;

  if (!figId) return Response.redirect(siteUrl, 302);

  // Load catalog
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
    return Response.redirect(`${siteUrl}/og-image.jpg`, 302);
  }

  // Find product by id
  let product = null;
  for (const catData of Object.values(catalog)) {
    const prods = (catData && catData.products) ? catData.products : [];
    const found = prods.find(p => p.id === figId);
    if (found) { product = found; break; }
  }

  if (!product) return Response.redirect(`${siteUrl}/og-image.jpg`, 302);

  // Pick best image URL
  const fotos = (product.fotos && product.fotos.length) ? product.fotos : [];
  const imgUrl = fotos.find(f => f && f.startsWith("http")) || product.i;

  if (!imgUrl) return Response.redirect(`${siteUrl}/og-image.jpg`, 302);

  // Fetch image server-to-server (bypasses hotlink protection)
  try {
    const imgResp = await fetch(imgUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; UVStoreBot/1.0)",
        "Referer": "https://www.sideshow.com/",
      },
    });
    if (!imgResp.ok) throw new Error(`img fetch ${imgResp.status}`);

    const contentType = imgResp.headers.get("content-type") || "image/jpeg";
    const body = await imgResp.arrayBuffer();

    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return Response.redirect(`${siteUrl}/og-image.jpg`, 302);
  }
}
