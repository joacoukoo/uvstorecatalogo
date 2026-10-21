export async function onRequestPost({ env, request }) {
  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { prompt, image_url } = body;
  if (!prompt) return new Response(JSON.stringify({ error: 'Falta prompt' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // Anthropic solo acepta https: completa las fotos propias relativas, sube http a https
  // y descarta lo que no es una dirección (data:, blob:) para generar solo con el texto.
  let imagen = String(image_url || '').trim();
  if (/^http:\/\//i.test(imagen)) imagen = 'https://' + imagen.slice(7);
  else if (imagen && !/^[a-z]+:/i.test(imagen)) imagen = new URL(imagen, new URL(request.url).origin + '/').href;
  if (!/^https:\/\//i.test(imagen)) imagen = '';

  const content = imagen
    ? [{ type: 'image', source: { type: 'url', url: imagen } }, { type: 'text', text: prompt }]
    : prompt;

  const pedir = c => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, messages: [{ role: 'user', content: c }] })
  });

  try {
    let res = await pedir(content);
    // La tienda de origen puede bloquear la foto (ej. Sideshow): mejor una descripción sin foto que un error.
    if (res.status === 400 && imagen) res = await pedir(prompt);
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return new Response(JSON.stringify({ text: data.content[0].text }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
