# Estado de Entrega Separado — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar el estado de pago (`en_proceso | pagada | cancelada`) del estado de entrega (`entregado: boolean`) en todas las vistas del sistema.

**Architecture:** Se agrega una columna `entregado boolean` a la tabla `ordenes` en Supabase. Se migran los datos existentes. Se actualiza `sistema-db.js` con una función nueva y `sistema.html` en 4 lugares: lista de órdenes, detalle de orden, formulario nueva/editar orden, e historial de cliente.

**Tech Stack:** Alpine.js v3, Supabase PostgREST, HTML/CSS vanilla. Sin build step ni test framework — las verificaciones son manuales en el browser abriendo `sistema.html` (Cloudflare Pages o localhost).

---

## Task 1: Migración de base de datos en Supabase

**Files:**
- No hay archivos de código — es un paso manual en el dashboard de Supabase.

- [ ] **Step 1: Abrir el SQL Editor de Supabase**

Ir a https://supabase.com → proyecto `rpaiizqttenkfbiqulng` → SQL Editor → New query.

- [ ] **Step 2: Ejecutar el ALTER TABLE**

```sql
ALTER TABLE ordenes ADD COLUMN entregado boolean NOT NULL DEFAULT false;
```

Verificar que el resultado diga `Success. No rows returned`.

- [ ] **Step 3: Migrar datos existentes**

```sql
-- Marcar como entregadas las que tenían estado='entregada'
UPDATE ordenes SET entregado = true WHERE estado = 'entregada';

-- Reasignar estado de pago: entregada/reservada → pagada o en_proceso según saldo real
UPDATE ordenes SET estado = CASE
  WHEN estado = 'entregada' AND (
    precio_venta_gtq - COALESCE(
      (SELECT SUM(monto) FROM pagos WHERE orden_id = ordenes.id), 0
    )
  ) <= 0 THEN 'pagada'
  WHEN estado IN ('entregada', 'reservada') THEN 'en_proceso'
  ELSE estado
END
WHERE estado IN ('entregada', 'reservada');
```

- [ ] **Step 4: Verificar la migración**

```sql
-- Debe mostrar solo en_proceso, pagada, cancelada
SELECT DISTINCT estado FROM ordenes;

-- Debe mostrar cuántas quedaron entregado=true
SELECT entregado, COUNT(*) FROM ordenes GROUP BY entregado;
```

---

## Task 2: Nueva función `dbSetEntregado` en sistema-db.js

**Files:**
- Modify: `sistema-db.js:186-189`

- [ ] **Step 1: Agregar la función después de `dbUpdateEstadoOrden`**

Abrir `sistema-db.js`. Después de la función `dbUpdateEstadoOrden` (línea 186), agregar:

```js
async function dbSetEntregado(id, entregado) {
  const { error } = await db.from('ordenes').update({ entregado }).eq('id', id);
  if (error) throw error;
}
```

El archivo debe quedar:

```js
async function dbUpdateEstadoOrden(id, estado) {
  const { error } = await db.from('ordenes').update({ estado }).eq('id', id);
  if (error) throw error;
}

async function dbSetEntregado(id, entregado) {
  const { error } = await db.from('ordenes').update({ entregado }).eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 2: Commit**

```bash
git add sistema-db.js
git commit -m "feat: agregar dbSetEntregado para campo entregado independiente"
```

---

## Task 3: Actualizar lista de órdenes

**Files:**
- Modify: `sistema.html` — función `uvOrdenes()` (~línea 1145) y HTML de la vista ordenes (~líneas 364-427)

### 3A — JavaScript: `uvOrdenes()`

- [ ] **Step 1: Agregar `filtroEntregado` al estado y actualizar el getter**

Ubicar la función `uvOrdenes()` (~línea 1145). Cambiar:

```js
function uvOrdenes() {
  return {
    ordenes: [], loading: true, busqueda: '', filtroEstado: '',
```

Por:

```js
function uvOrdenes() {
  return {
    ordenes: [], loading: true, busqueda: '', filtroEstado: '', filtroEntregado: '',
```

- [ ] **Step 2: Actualizar el getter `ordenesFiltradas`**

Cambiar:

```js
    get ordenesFiltradas() {
      return this.ordenes.filter(o => {
        const q = this.busqueda.toLowerCase();
        const matchQ = !q || o.producto?.toLowerCase().includes(q) || o.clientes?.nombre?.toLowerCase().includes(q);
        const matchE = !this.filtroEstado || o.estado === this.filtroEstado;
        return matchQ && matchE;
      });
    },
```

Por:

```js
    get ordenesFiltradas() {
      return this.ordenes.filter(o => {
        const q = this.busqueda.toLowerCase();
        const matchQ = !q || o.producto?.toLowerCase().includes(q) || o.clientes?.nombre?.toLowerCase().includes(q);
        const matchE = !this.filtroEstado || o.estado === this.filtroEstado;
        const matchEnt = !this.filtroEntregado ||
          (this.filtroEntregado === 'entregado' ? o.entregado : !o.entregado);
        return matchQ && matchE && matchEnt;
      });
    },
```

- [ ] **Step 3: Agregar método `toggleEntregado`**

Después del método `cambiarEstadoOrden`, agregar:

```js
    async toggleEntregado(o) {
      const prev = o.entregado;
      o.entregado = !o.entregado;
      try { await dbSetEntregado(o.id, o.entregado); }
      catch(e) { o.entregado = prev; alert('Error: ' + e.message); }
    },
```

### 3B — HTML: filtros y tabla

- [ ] **Step 4: Actualizar los filtros — quitar "entregada" y agregar filtro de entrega**

Ubicar el bloque de filtros (~línea 364). Cambiar el select de estado:

```html
          <select class="form-select" x-model="filtroEstado" style="width:auto;max-width:160px;padding:8px 12px;font-size:14px">
            <option value="">Todos los estados</option>
            <option value="en_proceso">En proceso</option>
            <option value="pagada">Pagada</option>
            <option value="entregada">Entregada</option>
            <option value="cancelada">Cancelada</option>
          </select>
```

Por:

```html
          <select class="form-select" x-model="filtroEstado" style="width:auto;max-width:160px;padding:8px 12px;font-size:14px">
            <option value="">Todos los estados</option>
            <option value="en_proceso">En proceso</option>
            <option value="pagada">Pagada</option>
            <option value="cancelada">Cancelada</option>
          </select>
          <select class="form-select" x-model="filtroEntregado" style="width:auto;max-width:160px;padding:8px 12px;font-size:14px">
            <option value="">Toda entrega</option>
            <option value="entregado">Entregadas</option>
            <option value="sin_entregar">Sin entregar</option>
          </select>
```

- [ ] **Step 5: Actualizar cabecera de tabla — agregar columna Entrega**

Cambiar:

```html
                <tr>
                  <th>Producto</th>
                  <th>Cliente</th>
                  <th>Precio</th>
                  <th>Abonado</th>
                  <th>Saldo</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
```

Por:

```html
                <tr>
                  <th>Producto</th>
                  <th>Cliente</th>
                  <th>Precio</th>
                  <th>Abonado</th>
                  <th>Saldo</th>
                  <th>Pago</th>
                  <th>Entrega</th>
                  <th></th>
                </tr>
```

- [ ] **Step 6: Actualizar fila de tabla — quitar "entregada" del select e insertar toggle**

Cambiar el `<td>` de estado:

```html
                    <td>
                      <select :value="o.estado" @change="cambiarEstadoOrden(o, $event.target.value)" class="badge" :class="'badge-'+o.estado" style="border:none;cursor:pointer;font-size:12px;padding:3px 6px;border-radius:6px;font-weight:600;appearance:none;-webkit-appearance:none;background-image:none">
                        <option value="en_proceso">en proceso</option>
                        <option value="pagada">pagada</option>
                        <option value="entregada">entregada</option>
                        <option value="cancelada">cancelada</option>
                      </select>
                    </td>
                    <td>
                      <button class="btn-sm btn-ghost" @click="verOrden(o.id)">Ver</button>
                    </td>
```

Por:

```html
                    <td>
                      <select :value="o.estado" @change="cambiarEstadoOrden(o, $event.target.value)" class="badge" :class="'badge-'+o.estado" style="border:none;cursor:pointer;font-size:12px;padding:3px 6px;border-radius:6px;font-weight:600;appearance:none;-webkit-appearance:none;background-image:none">
                        <option value="en_proceso">en proceso</option>
                        <option value="pagada">pagada</option>
                        <option value="cancelada">cancelada</option>
                      </select>
                    </td>
                    <td>
                      <button class="btn-sm" :class="o.entregado ? 'btn-green' : 'btn-ghost'" @click="toggleEntregado(o)" style="font-size:11px;padding:3px 10px" x-text="o.entregado ? 'Entregado' : 'Sin entregar'"></button>
                    </td>
                    <td>
                      <button class="btn-sm btn-ghost" @click="verOrden(o.id)">Ver</button>
                    </td>
```

- [ ] **Step 7: Agregar CSS para `.btn-green`**

Buscar en la sección `<style>` la línea donde están `.btn-purple` y `.btn-danger`, y agregar después:

```css
.btn-green{background:rgba(47,199,110,.15);color:var(--green);border:1px solid rgba(47,199,110,.3);}
.btn-green:hover{background:rgba(47,199,110,.25);}
```

- [ ] **Step 8: Verificar en browser**

Abrir `sistema.html`, ir a Órdenes. Verificar:
- El select de estado solo muestra "en proceso / pagada / cancelada"
- Aparece una segunda columna "Entrega" con botón "Sin entregar" / "Entregado"
- Aparece el filtro "Toda entrega" junto al filtro de estado
- Click en el botón togglea el estado y actualiza inmediatamente

- [ ] **Step 9: Commit**

```bash
git add sistema.html
git commit -m "feat: entrega separada del estado de pago en lista de ordenes"
```

---

## Task 4: Actualizar detalle de orden

**Files:**
- Modify: `sistema.html` — función `uvDetalleOrden()` (~línea 1461) y HTML de la vista detalle-orden (~líneas 447-452)

### 4A — JavaScript: `uvDetalleOrden()`

- [ ] **Step 1: Agregar método `toggleEntregado`**

Dentro de `uvDetalleOrden()`, después de `cambiarEstado`, agregar:

```js
    async toggleEntregado() {
      const prev = this.orden.entregado;
      this.orden.entregado = !this.orden.entregado;
      try { await dbSetEntregado(this.orden.id, this.orden.entregado); }
      catch(e) { this.orden.entregado = prev; alert('Error: ' + e.message); }
    },
```

### 4B — HTML: botones de estado en el detalle

- [ ] **Step 2: Reemplazar los 4 botones de estado por 3 + botón entregado separado**

Cambiar:

```html
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">
                <button class="btn-sm" :class="orden.estado==='en_proceso'?'btn-purple':'btn-ghost'" @click="cambiarEstado('en_proceso')">En proceso</button>
                <button class="btn-sm" :class="orden.estado==='pagada'?'btn-purple':'btn-ghost'" @click="cambiarEstado('pagada')">Pagada</button>
                <button class="btn-sm" :class="orden.estado==='entregada'?'btn-purple':'btn-ghost'" @click="cambiarEstado('entregada')">Entregada</button>
                <button class="btn-sm" :class="orden.estado==='cancelada'?'btn-danger':'btn-ghost'" @click="cambiarEstado('cancelada')">Cancelada</button>
              </div>
```

Por:

```html
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">
                <button class="btn-sm" :class="orden.estado==='en_proceso'?'btn-purple':'btn-ghost'" @click="cambiarEstado('en_proceso')">En proceso</button>
                <button class="btn-sm" :class="orden.estado==='pagada'?'btn-purple':'btn-ghost'" @click="cambiarEstado('pagada')">Pagada</button>
                <button class="btn-sm" :class="orden.estado==='cancelada'?'btn-danger':'btn-ghost'" @click="cambiarEstado('cancelada')">Cancelada</button>
                <button class="btn-sm" :class="orden.entregado?'btn-green':'btn-ghost'" @click="toggleEntregado()" x-text="orden.entregado?'Entregado':'Sin entregar'"></button>
              </div>
```

- [ ] **Step 3: Verificar en browser**

Abrir el detalle de una orden. Verificar:
- Solo aparecen 3 botones de estado de pago (sin "Entregada")
- Aparece botón "Sin entregar" / "Entregado" al lado
- Click en el botón alterna el estado de entrega

- [ ] **Step 4: Commit**

```bash
git add sistema.html
git commit -m "feat: boton de entrega separado en detalle de orden"
```

---

## Task 5: Actualizar formulario nueva/editar orden

**Files:**
- Modify: `sistema.html` — función `uvNuevaOrden()` (~línea 1264) y HTML del form (~líneas 677-691)

### 5A — JavaScript: `uvNuevaOrden()`

- [ ] **Step 1: Agregar `entregado: false` al objeto `form`**

Cambiar:

```js
    form: {
      id: null, cliente_id: '', producto: '', codigo: '', marca: '',
      escala: '', pedido: '', precio_original: 0, envio: 0, envio_mbe: 0,
      impuesto: 0, aduana: 0, arancel: 0, precio_venta_usd: 0,
      precio_venta_gtq: 0, estado: 'en_proceso', notas: ''
    },
```

Por:

```js
    form: {
      id: null, cliente_id: '', producto: '', codigo: '', marca: '',
      escala: '', pedido: '', precio_original: 0, envio: 0, envio_mbe: 0,
      impuesto: 0, aduana: 0, arancel: 0, precio_venta_usd: 0,
      precio_venta_gtq: 0, estado: 'en_proceso', entregado: false, notas: ''
    },
```

Nota: cuando se edita una orden existente, `this.form = { ...o }` ya incluye `entregado` automáticamente porque viene del SELECT `*` de Supabase.

### 5B — HTML: formulario

- [ ] **Step 2: Quitar "Entregada" del select de estado en el form**

Cambiar:

```html
              <div><label class="form-label">Estado</label>
                <select class="form-select" x-model="form.estado" style="font-size:16px">
                  <option value="en_proceso">En proceso</option>
                  <option value="pagada">Pagada</option>
                  <option value="entregada">Entregada</option>
                  <option value="cancelada">Cancelada</option>
                </select></div>
```

Por:

```html
              <div><label class="form-label">Estado de pago</label>
                <select class="form-select" x-model="form.estado" style="font-size:16px">
                  <option value="en_proceso">En proceso</option>
                  <option value="pagada">Pagada</option>
                  <option value="cancelada">Cancelada</option>
                </select></div>
```

- [ ] **Step 3: Agregar checkbox de entregado después del select de estado**

El bloque completo del `<div style="margin-bottom:24px">` que contiene el select de estado y las notas queda así:

```html
          <div style="margin-bottom:24px">
            <div class="form-row">
              <div><label class="form-label">Estado de pago</label>
                <select class="form-select" x-model="form.estado" style="font-size:16px">
                  <option value="en_proceso">En proceso</option>
                  <option value="pagada">Pagada</option>
                  <option value="cancelada">Cancelada</option>
                </select></div>
              <div style="display:flex;flex-direction:column;justify-content:flex-end">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding-bottom:8px">
                  <input type="checkbox" x-model="form.entregado" style="width:16px;height:16px;accent-color:var(--green)">
                  <span class="form-label" style="margin-bottom:0">Ya fue entregada</span>
                </label>
              </div>
            </div>
            <div class="form-row-1">
              <label class="form-label">Notas</label>
              <textarea class="form-textarea" x-model="form.notas" placeholder="Notas internas..."></textarea>
            </div>
          </div>
```

- [ ] **Step 4: Verificar en browser**

Abrir "Nueva orden" y "Editar orden". Verificar:
- Select de estado solo tiene 3 opciones (sin "Entregada")
- Aparece checkbox "Ya fue entregada"
- Al editar una orden ya entregada, el checkbox aparece marcado

- [ ] **Step 5: Commit**

```bash
git add sistema.html
git commit -m "feat: campo entregado en formulario de nueva y editar orden"
```

---

## Task 6: Actualizar historial de cliente

**Files:**
- Modify: `sistema.html` — HTML de la vista historial-cliente (~líneas 815-829)

- [ ] **Step 1: Agregar columna "Entrega" a la tabla**

Cambiar la cabecera:

```html
              <table class="table">
                <thead><tr><th>Producto</th><th>Marca</th><th>Estado</th><th>Precio</th><th>Saldo</th><th></th></tr></thead>
```

Por:

```html
              <table class="table">
                <thead><tr><th>Producto</th><th>Marca</th><th>Estado</th><th>Entrega</th><th>Precio</th><th>Saldo</th><th></th></tr></thead>
```

- [ ] **Step 2: Agregar celda de entrega en cada fila**

Cambiar las filas del `<tbody>`:

```html
                  <template x-for="o in ordenes" :key="o.id">
                    <tr>
                      <td x-text="o.producto" style="color:#fff;font-weight:500"></td>
                      <td x-text="o.marca||'—'" style="color:var(--muted2)"></td>
                      <td><span class="badge" :class="'badge-'+o.estado" x-text="o.estado.replace('_',' ')"></span></td>
                      <td x-text="fmtQ(o.precio_venta_gtq)" style="color:var(--green)"></td>
                      <td x-text="fmtQ((o.precio_venta_gtq||0) - (o._abonado||0))" :style="((o.precio_venta_gtq||0)-(o._abonado||0))>0?'color:var(--red)':''"></td>
                      <td><button class="btn-sm btn-ghost" @click="verOrden(o.id)">Ver</button></td>
                    </tr>
                  </template>
```

Por:

```html
                  <template x-for="o in ordenes" :key="o.id">
                    <tr>
                      <td x-text="o.producto" style="color:#fff;font-weight:500"></td>
                      <td x-text="o.marca||'—'" style="color:var(--muted2)"></td>
                      <td><span class="badge" :class="'badge-'+o.estado" x-text="o.estado.replace('_',' ')"></span></td>
                      <td><span class="badge" :class="o.entregado?'badge-entregada':''" x-text="o.entregado?'Entregado':'—'"></span></td>
                      <td x-text="fmtQ(o.precio_venta_gtq)" style="color:var(--green)"></td>
                      <td x-text="fmtQ((o.precio_venta_gtq||0) - (o._abonado||0))" :style="((o.precio_venta_gtq||0)-(o._abonado||0))>0?'color:var(--red)':''"></td>
                      <td><button class="btn-sm btn-ghost" @click="verOrden(o.id)">Ver</button></td>
                    </tr>
                  </template>
```

- [ ] **Step 3: Verificar en browser**

Abrir historial de un cliente. Verificar:
- La tabla muestra la columna "Entrega" con badge verde "Entregado" o "—"

- [ ] **Step 4: Push final**

```bash
git add sistema.html
git commit -m "feat: columna entrega en historial de cliente"
git push origin main
```
