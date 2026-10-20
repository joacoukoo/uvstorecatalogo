// Figuras traídas en lote que esperan precio. Viven en Supabase (no en productos.json)
// para que no aparezcan en la web ni disparen un deploy por cada una.
const SUPABASE_URL = 'https://rpaiizqttenkfbiqulng.supabase.co';
const TABLA = `${SUPABASE_URL}/rest/v1/figuras_pendientes`;

function headers(env, extra = {}) {
  const k = env.SUPABASE_SERVICE_KEY;
  return { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json', ...extra };
}

export async function onRequestGet({ env }) {
  const res = await fetch(`${TABLA}?select=id,clave,origen,datos,creado_en&order=creado_en.asc`, { headers: headers(env) });
  if (!res.ok) return json({ error: `Supabase ${res.status}: ${await res.text()}` }, 500);
  return json(await res.json());
}

export async function onRequestPost({ env, request }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON invalido' }, 400); }
  const { clave, origen, datos } = body || {};
  if (!clave || !origen || !datos) return json({ error: 'Faltan clave, origen o datos' }, 400);
  const res = await fetch(TABLA, {
    method: 'POST',
    headers: headers(env, { Prefer: 'return=representation' }),
    body: JSON.stringify({ clave, origen, datos }),
  });
  if (res.status === 409) return json({ error: 'Ya está en pendientes' }, 409);
  if (!res.ok) return json({ error: `Supabase ${res.status}: ${await res.text()}` }, 500);
  const [fila] = await res.json();
  return json({ id: fila.id }, 201);
}

export async function onRequestDelete({ env, request }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON invalido' }, 400); }
  const ids = (body?.ids || []).filter(id => /^[0-9a-zA-Z-]+$/.test(id));
  if (!ids.length) return json({ error: 'Faltan ids' }, 400);
  const res = await fetch(`${TABLA}?id=in.(${ids.join(',')})`, { method: 'DELETE', headers: headers(env) });
  if (!res.ok) return json({ error: `Supabase ${res.status}: ${await res.text()}` }, 500);
  return json({ ok: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
