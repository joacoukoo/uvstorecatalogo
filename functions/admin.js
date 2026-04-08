import { createToken, verifyToken, getSessionToken, buildSessionCookie, clearSessionCookie } from './_lib/auth.js';

const ADMIN_APP_HTML = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>UV Store GT — Admin</title></head>
<body style="background:#0d0d0d;color:#f4f4f4;font-family:system-ui;padding:40px">
<h1 style="color:#a78bfa">UV Store GT — Admin</h1>
<p>Backend listo. La interfaz completa se construye en Task 8.</p>
<p><a href="/admin?logout=1" style="color:#666">Cerrar sesión</a></p>
<script>
fetch('/api/catalog').then(r=>r.json()).then(d=>{
  const total = Object.values(d).reduce((s,c)=>s+(c.products||[]).length,0);
  document.body.insertAdjacentHTML('beforeend','<p style="color:#2ec4b6">✅ Catálogo cargado: '+total+' productos</p>');
}).catch(e=>document.body.insertAdjacentHTML('beforeend','<p style="color:#e63946">❌ '+e.message+'</p>'));
<\/script>
</body></html>`;

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>UV Store GT — Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0d0d0d;color:#f4f4f4;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#111;border:1px solid #222;border-radius:12px;padding:40px;width:100%;max-width:360px}
h1{font-size:20px;margin-bottom:4px;color:#a78bfa}
.sub{color:#666;font-size:13px;margin-bottom:28px}
input{width:100%;padding:10px 14px;background:#1a1a1a;border:1px solid #333;border-radius:8px;color:#f4f4f4;font-size:14px;margin-bottom:12px;outline:none}
input:focus{border-color:#7b2fff}
button{width:100%;padding:11px;background:#7b2fff;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}
button:hover{background:#6d20f0}
.error{color:#e63946;font-size:13px;margin-top:12px;text-align:center}
</style>
</head>
<body>
<div class="card">
  <h1>UV Store GT</h1>
  <p class="sub">Admin · Ingresá tu contraseña</p>
  <form method="POST" action="/admin">
    <input type="password" name="password" placeholder="Contraseña" autofocus required>
    <button type="submit">Entrar</button>
    {{ERROR}}
  </form>
</div>
</body></html>`;

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  if (url.searchParams.has('logout')) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': '/admin', 'Set-Cookie': clearSessionCookie() }
    });
  }
  const token = getSessionToken(context.request);
  const valid = await verifyToken(context.env.ADMIN_SECRET, token);
  if (!valid) {
    return new Response(LOGIN_HTML.replace('{{ERROR}}', ''), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }
  return new Response(ADMIN_APP_HTML, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' }
  });
}

export async function onRequestPost(context) {
  const form = await context.request.formData();
  const password = form.get('password') || '';
  if (password !== context.env.ADMIN_PASSWORD) {
    const html = LOGIN_HTML.replace('{{ERROR}}', '<p class="error">Contraseña incorrecta</p>');
    return new Response(html, { status: 401, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }
  const token = await createToken(context.env.ADMIN_SECRET);
  return new Response(null, {
    status: 302,
    headers: { 'Location': '/admin', 'Set-Cookie': buildSessionCookie(token) }
  });
}
