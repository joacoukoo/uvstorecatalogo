export async function onRequestPost({ env, request }) {
  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { prompt, image_url } = body;
  if (!prompt) return new Response(JSON.stringify({ error: 'Falta prompt' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  const content = image_url
    ? [{ type: 'image', source: { type: 'url', url: image_url } }, { type: 'text', text: prompt }]
    : prompt;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, messages: [{ role: 'user', content }] })
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return new Response(JSON.stringify({ text: data.content[0].text }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
