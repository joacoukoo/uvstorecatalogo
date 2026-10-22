// POST {tienda: {nombre, foto}, nuestras: [{id, n, foto}]} → {id} de la nuestra que es la misma
// figura, o {id: null}. Lo usa "Traer en lote" para decidir las dudosas mirando las fotos: cada
// tienda nombra distinto la misma estatua ("Leon S. Kennedy" / "Leon Requiem").
// Las fotos se bajan acá (chicas) y van en base64: Sideshow no deja que Anthropic las baje directo.

const MAX_NUESTRAS = 4;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Versión chica de la foto en los CDNs de las tiendas, en un formato que acepta Anthropic.
export function fotoChica(url) {
  const s = String(url || '').trim().replace(/^http:\/\//i, 'https://');
  if (!/^https:\/\//i.test(s)) return '';
  if (/hexapus.*aliyuncs\.com\//.test(s)) return s.split('?')[0] + '?x-oss-process=image/resize,m_lfit,w_500/format,jpg';
  if (/cdn\d*\.bigcommerce\.com\/.*\/stencil\/\d+x\d+\//.test(s)) return s.replace(/\/stencil\/\d+x\d+\//, '/stencil/500x500/');
  const sideshow = s.match(/^https:\/\/www\.sideshow\.com\/(?:cdn-cgi\/image\/[^/]+\/https:\/\/www\.sideshow\.com\/)?(storage\/.+)$/);
  if (sideshow) return 'https://www.sideshow.com/cdn-cgi/image/width=500,quality=80,format=jpeg/https://www.sideshow.com/' + sideshow[1];
  if (/cdn\.shopify\.com\//.test(s)) return s + (s.includes('?') ? '&' : '?') + 'width=500';
  return s;
}

function tipoImagen(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return '';
}

async function bajarFoto(url) {
  const chica = fotoChica(url);
  if (!chica) return null;
  try {
    const res = await fetch(chica, { headers: { 'User-Agent': UA, Accept: 'image/jpeg,image/png,image/webp,*/*' } });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const media_type = tipoImagen(bytes);
    if (!media_type || bytes.length > 4_500_000) return null;
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { type: 'image', source: { type: 'base64', media_type, data: btoa(bin) } };
  } catch {
    return null;
  }
}

export async function onRequestPost({ env, request }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'JSON invalido' }, 400); }
  const { tienda, nuestras: todas } = body || {};
  const nuestras = (todas || []).filter(x => x?.id && x?.foto).slice(0, MAX_NUESTRAS);
  if (!tienda?.nombre || !tienda?.foto || !nuestras.length) return json({ error: 'Faltan datos' }, 400);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Falta ANTHROPIC_API_KEY' }, 500);

  const [fotoTienda, ...fotosNuestras] = await Promise.all([tienda.foto, ...nuestras.map(x => x.foto)].map(bajarFoto));
  // Sin la foto de la tienda no hay nada que comparar: mejor no decidir que adivinar.
  if (!fotoTienda) return json({ id: null, sinFoto: true });

  const content = [{ type: 'text', text: `FOTO TIENDA — "${tienda.nombre}"` }, fotoTienda];
  const opciones = [];
  nuestras.forEach((x, i) => {
    if (!fotosNuestras[i]) return;
    opciones.push(x);
    content.push({ type: 'text', text: `FOTO ${opciones.length} — "${x.n}"` }, fotosNuestras[i]);
  });
  if (!opciones.length) return json({ id: null, sinFoto: true });
  content.push({ type: 'text', text: `Sos experto en estatuas y figuras de colección. Las tiendas nombran distinto el mismo producto.
¿Alguna de las FOTOS 1-${opciones.length} es EXACTAMENTE el mismo producto que la FOTO TIENDA (misma escultura, pose, base y estudio)?
Mismo personaje con otra pose, otra escultura, otra escala u otro estudio = producto distinto. Una edición/versión de color distinta de la misma escultura cuenta como el mismo producto.
Responde SOLO JSON: {"misma": <número de la foto o 0 si ninguna>}` });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 50, messages: [{ role: 'user', content }] }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const text = (await res.json()).content?.[0]?.text || '';
    const n = parseInt((text.match(/"misma"\s*:\s*(\d+)/) || [])[1], 10);
    return json({ id: n > 0 && opciones[n - 1] ? opciones[n - 1].id : null });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
