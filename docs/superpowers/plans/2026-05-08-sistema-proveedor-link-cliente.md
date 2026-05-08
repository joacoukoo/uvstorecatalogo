# Sistema: Seguimiento proveedor + Link público del cliente

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar seguimiento de pedido al proveedor en órdenes, y una página pública `mis-pedidos.html` donde cada cliente puede ver su historial de compras vía link con token.

**Architecture:** Tres features independientes: (1) campo `pedida_proveedor` en Supabase + UI en sistema.html, (2) campo `token` en clientes + botón "Copiar link", (3) Cloudflare Function GET `/api/mis-pedidos` + página estática `mis-pedidos.html`. El endpoint usa `SUPABASE_SERVICE_KEY` server-side vía REST API directa (sin SDK).

**Tech Stack:** Supabase (PostgreSQL), Alpine.js (sistema.html), Cloudflare Pages Functions (JS ESM), HTML/CSS vanilla (mis-pedidos.html)

---

## Archivos a modificar/crear

| Archivo | Cambio |
|---|---|
| Supabase SQL (manual) | 2 ALTER TABLE |
| `sistema-db.js` | + `dbSetPedidaProveedor`, `dbGetOrCreateClienteToken` |
| `sistema.html` | + dot naranja en lista, checkbox en detalle y formulario, botón Copiar link |
| `functions/api/mis-pedidos.js` | Nuevo — endpoint GET con token |
| `mis-pedidos.html` | Nuevo — página pública del cliente |

---

## Task 1: Migraciones Supabase (manual)

**Files:** — (Supabase dashboard)

- [ ] **Step 1: Agregar columna `pedida_proveedor` a `ordenes`**

En el Supabase dashboard → SQL Editor, ejecutar:

```sql
ALTER TABLE ordenes
  ADD COLUMN IF NOT EXISTS pedida_proveedor boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Agregar columna `token` a `clientes`**

```sql
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS token text UNIQUE;
```

- [ ] **Step 3: Verificar**

En Table Editor → `ordenes`: confirmar que existe la columna `pedida_proveedor` con default `false`.
En Table Editor → `clientes`: confirmar que existe la columna `token` nullable.

---

## Task 2: Funciones DB en `sistema-db.js`

**Files:**
- Modify: `sistema-db.js`

- [ ] **Step 1: Agregar `dbSetPedidaProveedor` al final del bloque ORDENES**

Insertar después de `dbSetEntregado` (línea 215):

```js
async function dbSetPedidaProveedor(id, value) {
  const { error } = await db.from('ordenes').update({ pedida_proveedor: value }).eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 2: Agregar `dbGetOrCreateClienteToken` al final del bloque CLIENTES**

Insertar después de `dbDeleteCliente` (línea 61):

```js
async function dbGetOrCreateClienteToken(clienteId) {
  const { data } = await db.from('clientes').select('token').eq('id', clienteId).single();
  if (data?.token) return data.token;
  const token = crypto.randomUUID();
  const { data: updated, error } = await db
    .from('clientes').update({ token }).eq('id', clienteId).select('token').single();
  if (error) throw error;
  return updated.token;
}
```

- [ ] **Step 3: Verificar sintaxis**

```powershell
node -e "const s = require('fs').readFileSync('sistema-db.js','utf8'); console.log('ok', s.length)"
```

Esperado: `ok NNNNN` sin errores.

- [ ] **Step 4: Actualizar cache bust en sistema.html**

En `sistema.html` línea 9, cambiar el parámetro `?v=` a la fecha actual:

```html
<script src="sistema-db.js?v=20260508"></script>
```

- [ ] **Step 5: Commit**

```powershell
git add sistema-db.js sistema.html
git commit -m "feat: dbSetPedidaProveedor y dbGetOrCreateClienteToken"
```

---

## Task 3: UI pedida_proveedor en `sistema.html`

**Files:**
- Modify: `sistema.html`

### Subtarea A — Punto naranja en la lista de órdenes

- [ ] **Step 1: Agregar dot naranja en la columna Producto de la lista**

En `sistema.html`, en la tabla de órdenes (alrededor de la línea donde está `<div x-text="o.producto"`), reemplazar:

```html
                    <td>
                      <div x-text="o.producto" style="font-weight:500;color:#fff"></div>
                      <div style="font-size:11px;color:var(--muted2)" x-text="[o.marca, !o.fecha_venta ? fmtDate(o.created_at) : ''].filter(Boolean).join(' · ')"></div>
                    </td>
```

por:

```html
                    <td>
                      <div style="display:flex;align-items:center;gap:6px">
                        <span x-show="!o.pedida_proveedor && !o.entregado" title="Sin pedir al proveedor"
                          style="flex-shrink:0;width:7px;height:7px;border-radius:50%;background:var(--orange)"></span>
                        <span x-text="o.producto" style="font-weight:500;color:#fff"></span>
                      </div>
                      <div style="font-size:11px;color:var(--muted2)" x-text="[o.marca, !o.fecha_venta ? fmtDate(o.created_at) : ''].filter(Boolean).join(' · ')"></div>
                    </td>
```

### Subtarea B — Botón en el detalle de la orden

- [ ] **Step 2: Agregar botón "Pedida al proveedor" junto al botón Entregado**

En `sistema.html`, en la sección de detalle de orden (alrededor de la línea con `toggleEntregado()`), reemplazar:

```html
                <button class="btn-sm" :class="orden.entregado?'btn-green':'btn-ghost'" @click="toggleEntregado()" x-text="orden.entregado?'Entregado':'Sin entregar'"></button>
```

por:

```html
                <button class="btn-sm" :class="orden.pedida_proveedor?'btn-orange':'btn-ghost'" @click="togglePedidaProveedor()" x-text="orden.pedida_proveedor?'Pedida al prov.':'Pedir al prov.'"></button>
                <button class="btn-sm" :class="orden.entregado?'btn-green':'btn-ghost'" @click="toggleEntregado()" x-text="orden.entregado?'Entregado':'Sin entregar'"></button>
```

- [ ] **Step 3: Agregar clase CSS `btn-orange`**

En el bloque `<style>` de `sistema.html`, buscar `.btn-green` y agregar después:

```css
.btn-orange { background: var(--orange); color: #fff; border-color: var(--orange); }
```

- [ ] **Step 4: Agregar `togglePedidaProveedor` en la función `uvDetalleOrden`**

En `sistema.html`, en la función `uvDetalleOrden()`, buscar el método `toggleEntregado`:

```js
    async toggleEntregado() {
```

Insertar ANTES de ese método:

```js
    async togglePedidaProveedor() {
      const val = !this.orden.pedida_proveedor;
      try {
        await dbSetPedidaProveedor(this.orden.id, val);
        this.orden.pedida_proveedor = val;
      } catch(e) { alert('Error: ' + e.message); }
    },
```

### Subtarea C — Checkbox en el formulario de nueva/editar orden

- [ ] **Step 5: Agregar `pedida_proveedor: false` en el estado inicial del formulario**

En `uvNuevaOrden()`, buscar:

```js
      precio_venta_gtq: 0, estado: 'en_proceso', entregado: false, notas: ''
```

Reemplazar por:

```js
      precio_venta_gtq: 0, estado: 'en_proceso', entregado: false, pedida_proveedor: false, notas: ''
```

- [ ] **Step 6: Agregar checkbox en el formulario**

En `sistema.html`, buscar el checkbox de `entregado` en el formulario:

```html
                  <input type="checkbox" x-model="form.entregado" style="width:16px;height:16px;accent-color:var(--green)">
                  <span class="form-label" style="margin-bottom:0">Ya fue entregada</span>
```

Agregar ANTES de ese bloque `<label>`:

```html
              <div style="display:flex;flex-direction:column;justify-content:flex-end">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding-bottom:8px">
                  <input type="checkbox" x-model="form.pedida_proveedor" style="width:16px;height:16px;accent-color:var(--orange)">
                  <span class="form-label" style="margin-bottom:0">Pedida al proveedor</span>
                </label>
              </div>
```

- [ ] **Step 7: Commit**

```powershell
git add sistema.html
git commit -m "feat: pedida_proveedor — dot naranja en lista, botón en detalle, checkbox en form"
```

---

## Task 4: Endpoint `functions/api/mis-pedidos.js`

**Files:**
- Create: `functions/api/mis-pedidos.js`

Nota de contexto: `SUPABASE_URL` está hardcodeada en `sistema-db.js` como constante pública (`https://rpaiizqttenkfbiqulng.supabase.co`). En la función se puede usar directamente. Solo se necesita agregar `SUPABASE_SERVICE_KEY` como env var en Cloudflare Pages (la service_role key de Supabase → Settings → API).

- [ ] **Step 1: Crear el archivo**

Crear `functions/api/mis-pedidos.js` con el siguiente contenido completo:

```js
export async function onRequestGet({ env, request }) {
  const token = new URL(request.url).searchParams.get('t');
  if (!token) return resp({ error: 'Token requerido' }, 400);

  const base = 'https://rpaiizqttenkfbiqulng.supabase.co/rest/v1';
  const headers = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Accept': 'application/json',
  };

  // Buscar cliente por token
  const cRes = await fetch(
    `${base}/clientes?token=eq.${encodeURIComponent(token)}&select=id,nombre`,
    { headers }
  );
  if (!cRes.ok) return resp({ error: 'Error de base de datos' }, 500);
  const clientes = await cRes.json();
  if (!Array.isArray(clientes) || !clientes.length) return resp({ error: 'No encontrado' }, 404);
  const cliente = clientes[0];

  // Buscar órdenes con pagos embebidos
  const oRes = await fetch(
    `${base}/ordenes?cliente_id=eq.${cliente.id}&select=id,producto,created_at,precio_venta_gtq,estado,entregado,pagos(fecha,monto,metodo)&order=created_at.desc`,
    { headers }
  );
  if (!oRes.ok) return resp({ error: 'Error de base de datos' }, 500);
  const ordenes = await oRes.json();

  return resp({ cliente: { nombre: cliente.nombre }, ordenes: ordenes || [] });
}

function resp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

- [ ] **Step 2: Verificar sintaxis**

```powershell
node -e "import('./functions/api/mis-pedidos.js').catch(e => { if (!e.message.includes('Cannot use import')) throw e })"
```

Sin output = OK. SyntaxError = revisar el paso anterior.

- [ ] **Step 3: Agregar `SUPABASE_SERVICE_KEY` en Cloudflare Pages**

En Cloudflare Pages → tu proyecto → Settings → Environment variables:
- Agregar variable: `SUPABASE_SERVICE_KEY` = la **service_role** key de Supabase (Supabase → Settings → API → service_role key, distinta de la anon key).
- Asegurarse de deployar después de guardar la variable (o hacer un push).

- [ ] **Step 4: Commit**

```powershell
git add functions/api/mis-pedidos.js
git commit -m "feat: endpoint GET /api/mis-pedidos — historial cliente por token"
```

---

## Task 5: Página pública `mis-pedidos.html`

**Files:**
- Create: `mis-pedidos.html`

- [ ] **Step 1: Crear `mis-pedidos.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mis Pedidos — UV Store GT</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #0f1117; color: #e8eaf0; min-height: 100vh; padding: 0 0 48px; }
    .header { padding: 20px 20px 0; border-bottom: 1px solid #2a2d3a; margin-bottom: 24px; padding-bottom: 16px; }
    .header-brand { font-size: 13px; font-weight: 700; letter-spacing: .08em;
                    text-transform: uppercase; color: #7c3aed; margin-bottom: 6px; }
    .header-name { font-size: 22px; font-weight: 700; color: #fff; }
    .container { max-width: 600px; margin: 0 auto; padding: 0 16px; }
    .card { background: #1a1d27; border: 1px solid #2a2d3a; border-radius: 12px;
            padding: 18px 20px; margin-bottom: 16px; }
    .figura { font-size: 16px; font-weight: 600; color: #fff; margin-bottom: 4px; }
    .fecha { font-size: 12px; color: #6b7280; margin-bottom: 12px; }
    .estado { display: inline-flex; align-items: center; gap: 5px;
              font-size: 11px; font-weight: 700; letter-spacing: .05em;
              text-transform: uppercase; padding: 3px 10px; border-radius: 20px; margin-bottom: 14px; }
    .estado-proceso { background: rgba(99,102,241,.15); color: #a5b4fc; }
    .estado-pagada  { background: rgba(16,185,129,.15); color: #6ee7b7; }
    .estado-cancelada { background: rgba(239,68,68,.15); color: #fca5a5; }
    .estado-entregada { background: rgba(16,185,129,.2); color: #34d399; }
    .montos { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 16px; }
    .monto-item { text-align: center; }
    .monto-label { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 2px; }
    .monto-val { font-size: 16px; font-weight: 700; color: #fff; }
    .monto-val.green { color: #34d399; }
    .monto-val.red { color: #f87171; }
    .pagos-titulo { font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase;
                    letter-spacing: .05em; margin-bottom: 8px; }
    .pago-row { display: flex; justify-content: space-between; align-items: center;
                padding: 7px 0; border-top: 1px solid #2a2d3a; font-size: 13px; }
    .pago-info { color: #9ca3af; }
    .pago-monto { font-weight: 600; color: #34d399; }
    .empty { text-align: center; padding: 60px 20px; color: #6b7280; }
    .error { text-align: center; padding: 60px 20px; color: #f87171; }
    .loading { text-align: center; padding: 60px 20px; color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <div id="app">
    <div class="loading" id="loading">Cargando tus pedidos...</div>
    <div id="content" style="display:none">
      <div class="header container">
        <div class="header-brand">UV Store GT</div>
        <div class="header-name" id="clienteNombre"></div>
      </div>
      <div class="container" id="ordenes"></div>
    </div>
    <div class="error" id="error" style="display:none"></div>
  </div>

  <script>
    const token = new URLSearchParams(location.search).get('t');

    function fmtQ(n) {
      return 'Q' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function fmtDate(dt) {
      if (!dt) return '';
      return new Date(dt).toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    function estadoClass(o) {
      if (o.entregado) return 'estado-entregada';
      if (o.estado === 'pagada') return 'estado-pagada';
      if (o.estado === 'cancelada') return 'estado-cancelada';
      return 'estado-proceso';
    }
    function estadoLabel(o) {
      if (o.entregado) return '✓ Entregada';
      if (o.estado === 'pagada') return 'Pagada';
      if (o.estado === 'cancelada') return 'Cancelada';
      return 'En proceso';
    }
    function renderOrden(o) {
      const pagos = o.pagos || [];
      const abonado = pagos.reduce((s, p) => s + (p.monto || 0), 0);
      const saldo = (o.precio_venta_gtq || 0) - abonado;
      const pagosHtml = pagos.length === 0 ? '' : `
        <div class="pagos-titulo">Pagos registrados</div>
        ${pagos.map(p => `
          <div class="pago-row">
            <span class="pago-info">${p.fecha || ''} · ${p.metodo || ''}</span>
            <span class="pago-monto">${fmtQ(p.monto)}</span>
          </div>`).join('')}`;
      return `
        <div class="card">
          <div class="figura">${o.producto || ''}</div>
          <div class="fecha">${fmtDate(o.created_at)}</div>
          <span class="estado ${estadoClass(o)}">${estadoLabel(o)}</span>
          <div class="montos">
            <div class="monto-item">
              <div class="monto-label">Precio</div>
              <div class="monto-val">${fmtQ(o.precio_venta_gtq)}</div>
            </div>
            <div class="monto-item">
              <div class="monto-label">Abonado</div>
              <div class="monto-val green">${fmtQ(abonado)}</div>
            </div>
            <div class="monto-item">
              <div class="monto-label">Saldo</div>
              <div class="monto-val ${saldo > 0 ? 'red' : 'green'}">${fmtQ(saldo)}</div>
            </div>
          </div>
          ${pagosHtml}
        </div>`;
    }

    async function load() {
      if (!token) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('error').style.display = '';
        document.getElementById('error').textContent = 'Link inválido. Pedile a UV Store el link correcto.';
        return;
      }
      try {
        const res = await fetch('/api/mis-pedidos?t=' + encodeURIComponent(token));
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error');
        document.getElementById('loading').style.display = 'none';
        document.getElementById('content').style.display = '';
        document.getElementById('clienteNombre').textContent = 'Hola, ' + data.cliente.nombre;
        const cont = document.getElementById('ordenes');
        if (!data.ordenes.length) {
          cont.innerHTML = '<div class="empty">No tenés pedidos registrados aún.</div>';
        } else {
          cont.innerHTML = data.ordenes.map(renderOrden).join('');
        }
      } catch(e) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('error').style.display = '';
        document.getElementById('error').textContent = 'No se pudo cargar tu historial. Intentá de nuevo más tarde.';
      }
    }

    load();
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```powershell
git add mis-pedidos.html
git commit -m "feat: mis-pedidos.html — página pública de historial por token"
```

---

## Task 6: Botón "Copiar link" en historial del cliente (`sistema.html`)

**Files:**
- Modify: `sistema.html`

- [ ] **Step 1: Agregar `linkCopiado` al estado y método `copiarLink` en `uvHistorialCliente`**

En `sistema.html`, en la función `uvHistorialCliente()`, buscar:

```js
    cliente: null, ordenes: [], loading: false, _pagandoId: null,
```

Reemplazar por:

```js
    cliente: null, ordenes: [], loading: false, _pagandoId: null, linkCopiado: false,
```

Luego, en la misma función, buscar el método `verOrden` e insertar ANTES de él:

```js
    async copiarLink() {
      try {
        const token = await dbGetOrCreateClienteToken(this.cliente.id);
        const url = window.location.origin + '/mis-pedidos.html?t=' + token;
        await navigator.clipboard.writeText(url);
        this.linkCopiado = true;
        setTimeout(() => { this.linkCopiado = false; }, 2000);
      } catch(e) { alert('Error al generar link: ' + e.message); }
    },
```

- [ ] **Step 2: Agregar botón "Copiar link" en el header del historial del cliente**

En `sistema.html`, en la vista `historial-cliente`, buscar el page-header:

```html
      <div class="page-header">
        <button class="btn-sm btn-ghost" @click="$dispatch('go-to','clientes')">← Clientes</button>
      </div>
```

Reemplazar por:

```html
      <div class="page-header">
        <button class="btn-sm btn-ghost" @click="$dispatch('go-to','clientes')">← Clientes</button>
        <button class="btn-sm btn-ghost" @click="copiarLink()" x-show="cliente"
          x-text="linkCopiado ? '✓ Link copiado' : '🔗 Copiar link'"></button>
      </div>
```

- [ ] **Step 3: Commit y push**

```powershell
git add sistema.html
git commit -m "feat: botón Copiar link en historial cliente para mis-pedidos"
git push origin main
```

---

## Task 7: Verificación manual en producción

- [ ] **Step 1: Verificar `pedida_proveedor`**

1. Ir a `/sistema.html` → Órdenes
2. Confirmar que las órdenes no entregadas muestran el punto naranja
3. Abrir el detalle de una orden → confirmar botón "Pedir al prov." visible
4. Hacer click → confirmar que cambia a "Pedida al prov." (naranja) y el punto desaparece de la lista
5. Crear nueva orden → confirmar checkbox "Pedida al proveedor" visible en el formulario

- [ ] **Step 2: Verificar link del cliente**

1. Ir a → Clientes → seleccionar un cliente con órdenes
2. Click "🔗 Copiar link" → confirmar mensaje "✓ Link copiado"
3. Pegar el link en una pestaña incógnita
4. Confirmar que muestra nombre del cliente, órdenes, precios, pagos
5. Confirmar que NO muestra precio_original, envio, arancel, aduana
6. Hacer click en el link nuevamente → confirmar que usa el mismo token (no genera uno nuevo)
7. Probar con token inválido: `/mis-pedidos.html?t=INVALIDO` → debe mostrar mensaje de error

- [ ] **Step 3: Verificar en mobile**

Abrir `mis-pedidos.html` en el celular. Confirmar que el layout es legible y usable.
