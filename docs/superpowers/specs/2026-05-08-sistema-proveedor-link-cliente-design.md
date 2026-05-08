# Spec: Seguimiento proveedor + Link público del cliente

**Fecha:** 2026-05-08
**Contexto:** Sistema de órdenes UV Store GT (`sistema.html` + `sistema-db.js` + Supabase)

---

## Feature 1: Seguimiento de pedido al proveedor

### Problema
No hay forma de registrar si una figura ya fue pedida al proveedor. Las órdenes activas sin pedir se pierden entre las demás y no hay recordatorio visual.

### Solución
Agregar un boolean `pedida_proveedor` en `ordenes`. Un checkbox en el detalle de la orden y un punto naranja en la lista como indicador visual.

### Cambios en Supabase
- Agregar columna `pedida_proveedor` (boolean, NOT NULL, default `false`) a la tabla `ordenes`

### Cambios en `sistema-db.js`
```js
async function dbSetPedidaProveedor(id, value) {
  const { error } = await db.from('ordenes').update({ pedida_proveedor: value }).eq('id', id);
  if (error) throw error;
}
```

### Cambios en `sistema.html`

**Detalle de orden — checkbox (justo arriba de "Entregado"):**
```html
<label style="display:flex;align-items:center;gap:8px;cursor:pointer">
  <input type="checkbox" :checked="orden.pedida_proveedor"
    @change="togglePedidaProveedor(orden, $event.target.checked)"
    style="width:16px;height:16px;accent-color:var(--orange)">
  <span style="font-size:14px">Pedida al proveedor</span>
</label>
```

**Handler:**
```js
async togglePedidaProveedor(orden, val) {
  await dbSetPedidaProveedor(orden.id, val);
  orden.pedida_proveedor = val;
}
```

**Lista de órdenes — indicador visual:**
En la columna de producto, mostrar un punto naranja `●` cuando `pedida_proveedor === false && !o.entregado`:
```html
<span x-show="!o.pedida_proveedor && !o.entregado"
  title="Sin pedir al proveedor"
  style="color:var(--orange);margin-right:4px;font-size:10px">●</span>
```

---

## Feature 2: Link público del cliente (`mis-pedidos.html`)

### Problema
No hay forma de que un cliente vea su historial de compras sin darle acceso al panel admin.

### Solución
Cada cliente tiene un token UUID. El admin copia una URL desde la ficha del cliente y la manda por WhatsApp. La URL abre `mis-pedidos.html` que llama a un endpoint Cloudflare que valida el token server-side.

### Datos mostrados al cliente
| Mostrar | Ocultar |
|---|---|
| Nombre del cliente | precio_original |
| Nombre de la figura (producto) | envio, envio_mbe |
| Fecha de orden (created_at) | impuesto, aduana, arancel |
| Estado (entregado / en proceso) | margen |
| Precio acordado (precio_venta) | Datos de otros clientes |
| Total abonado (suma de pagos) | Credenciales admin |
| Saldo pendiente | |
| Historial de pagos (fecha, monto, método) | |

### Cambios en Supabase
- Agregar columna `token` (text, UNIQUE, nullable) a la tabla `clientes`

### Nuevo archivo: `functions/api/mis-pedidos.js`

- Método: GET con query param `?t=TOKEN`
- Usa `env.SUPABASE_SERVICE_KEY` para consultar sin restricciones RLS
- Retorna `{ cliente: { nombre }, ordenes: [...] }` donde cada orden incluye:
  - `id, producto, created_at, precio_venta, estado, entregado`
  - `pagos: [{ fecha, monto, metodo }]`
- Si el token no existe: 404 `{ error: 'No encontrado' }`

No usa el SDK de Supabase (sin bundler) — usa la REST API directamente con `fetch`:

```js
export async function onRequestGet({ env, request }) {
  const token = new URL(request.url).searchParams.get('t');
  if (!token) return json({ error: 'Token requerido' }, 400);

  const base = env.SUPABASE_URL + '/rest/v1';
  const headers = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };

  // Buscar cliente por token
  const cRes = await fetch(`${base}/clientes?token=eq.${encodeURIComponent(token)}&select=id,nombre`, { headers });
  const clientes = await cRes.json();
  if (!clientes?.length) return json({ error: 'No encontrado' }, 404);
  const cliente = clientes[0];

  // Buscar órdenes con pagos
  const oRes = await fetch(
    `${base}/ordenes?cliente_id=eq.${cliente.id}&select=id,producto,created_at,precio_venta,estado,entregado,pagos(fecha,monto,metodo)&order=created_at.desc`,
    { headers: { ...headers, 'Accept': 'application/json', 'Prefer': 'return=representation' } }
  );
  const ordenes = await oRes.json();

  return json({ cliente: { nombre: cliente.nombre }, ordenes: ordenes || [] });
}
```

### Nuevo archivo: `mis-pedidos.html`

Página pública, móvil-first, dark theme igual a `sistema.html`. Estructura:

```
UV Store GT
────────────
Hola, [Nombre del cliente]

┌─────────────────────────────────┐
│ Hot Toys Qui-Gon Jinn 1:6       │
│ Pedida: 15 ene 2026             │
│ Estado: En proceso              │
│ Precio: Q3,500                  │
│ Abonado: Q1,500  Saldo: Q2,000  │
│                                 │
│ Pagos:                          │
│   15 ene 2026  Q500  efectivo   │
│   20 feb 2026  Q1000 transfer.  │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ Iron Studios Batman 1:10        │
│ Pedida: 3 mar 2026              │
│ Estado: ✓ Entregada             │
│ ...                             │
└─────────────────────────────────┘
```

### Cambios en `sistema.html` — ficha del cliente

En la vista de historial del cliente, agregar botón "Copiar link":
- Si el cliente no tiene token: llama a `dbGenerateClienteToken(id)` que genera un UUID, lo guarda en Supabase y lo retorna
- Si ya tiene token: usa el existente
- Copia `window.location.origin + '/mis-pedidos.html?t=' + token` al clipboard (URL dinámica, funciona en cualquier dominio)
- Muestra feedback "¡Link copiado!" por 2 segundos

### Cambios en `sistema-db.js`

```js
async function dbGenerateClienteToken(id) {
  const token = crypto.randomUUID();
  const { data, error } = await db
    .from('clientes').update({ token }).eq('id', id).select('token').single();
  if (error) throw error;
  return data.token;
}

async function dbGetClienteToken(id) {
  const { data } = await db.from('clientes').select('token').eq('id', id).single();
  return data?.token || null;
}
```

---

## Archivos a modificar/crear

| Archivo | Cambio |
|---|---|
| Supabase (manual) | `ALTER TABLE ordenes ADD COLUMN pedida_proveedor boolean NOT NULL DEFAULT false` |
| Supabase (manual) | `ALTER TABLE clientes ADD COLUMN token text UNIQUE` |
| `sistema-db.js` | + `dbSetPedidaProveedor`, `dbGenerateClienteToken`, `dbGetClienteToken` |
| `sistema.html` | + checkbox proveedor, punto naranja en lista, botón "Copiar link" en ficha cliente |
| `functions/api/mis-pedidos.js` | Nuevo — endpoint GET con token |
| `mis-pedidos.html` | Nuevo — página pública del cliente |

## Lo que NO cambia
- RLS de Supabase (el endpoint usa service key server-side)
- Flujo de cobros y pagos existente
- Autenticación del admin
