# Lotes de Pedido a Proveedor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir vincular ventas de clientes a lotes de pedido al proveedor (con cantidad fija) para saber en cualquier momento cuántas unidades de una figura pre-ordenada quedan disponibles, evitando sobreventa/subventa.

**Architecture:** Tabla nueva `lotes_pedido` en Supabase + columna `lote_id` nullable en `ordenes`. Todo el resto vive en `sistema.html` (Alpine.js) y `sistema-db.js` (funciones globales que llaman a Supabase directo, sin backend propio — así funciona todo el resto del panel admin). El vínculo orden↔lote nunca es automático por texto: la búsqueda de texto solo acorta una lista de candidatos, la persona confirma con un clic.

**Tech Stack:** Alpine.js v3 (sin bundler), Supabase JS client cargado por CDN, CSS inline existente en `sistema.html`.

## Global Constraints

- `sistema.html`/`sistema-db.js` no tienen cobertura de tests automatizados (el único test del repo, `npm test` → vitest, cubre `functions/_lib/auth.js`, que es código de Cloudflare Functions completamente aparte). Por eso cada tarea de este plan se verifica **manualmente en el navegador**, no con tests unitarios — así se hizo con cada feature previa de `sistema.html`.
- No hay entorno de staging: toda verificación manual corre contra la base de Supabase de **producción real**. Usar siempre datos de prueba con el prefijo `ZZZTEST` en el campo `producto` para poder identificarlos y borrarlos al final de cada tarea (instrucciones de limpieza incluidas en cada tarea).
- `sistema-db.js` es un `<script>` clásico (no ES module): toda función nueva se define como función global de nivel superior, sin `export`, y sigue el patrón `if (error) throw error;` sin try/catch (el try/catch vive del lado de Alpine que la llama).
- Reusar clases CSS existentes (`.card`, `.modal-bg`/`.modal`, `.btn-sm`/`.btn-purple`/`.btn-ghost`, `.form-input`/`.form-select`, `.badge`, `.form-row`/`.form-row-1`, variables `var(--purple)`, `var(--pl)`, `var(--green)`, `var(--red)`, `var(--muted2)`) — no inventar estilos nuevos.
- Para levantar el sitio localmente y probar: `python -m http.server 8000` desde la raíz del repo, y abrir `http://localhost:8000/sistema.html` (requiere iniciar sesión con las credenciales admin reales, ya que habla directo con Supabase de producción).

---

### Task 1: Schema de Supabase (acción manual)

**Files:**
- Ninguno en el repo — se ejecuta en el SQL Editor del dashboard de Supabase (proyecto `rpaiizqttenkfbiqulng`, ver `sistema-db.js:4`).

**Interfaces:**
- Produces: tabla `lotes_pedido(id, producto, marca, escala, cantidad, codigo, proveedor, fecha_pedido, notas, created_at)` y columna `ordenes.lote_id` (FK nullable a `lotes_pedido.id`), que consumen todas las tareas siguientes.

- [ ] **Step 1: Ejecutar el DDL en Supabase SQL Editor**

```sql
CREATE TABLE lotes_pedido (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto text NOT NULL,
  marca text,
  escala text,
  cantidad integer NOT NULL CHECK (cantidad > 0),
  codigo text NOT NULL UNIQUE,
  proveedor text,
  fecha_pedido date,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ordenes ADD COLUMN lote_id uuid REFERENCES lotes_pedido(id);
```

- [ ] **Step 2: Habilitar RLS en la tabla nueva con la misma política que ya usa `ordenes`**

Antes de correr esto, revisar en el dashboard de Supabase (Authentication → Policies) qué política tiene hoy la tabla `ordenes` para el rol `authenticated`, y replicar el mismo criterio sobre `lotes_pedido` (en este proyecto el panel admin es de un solo usuario autenticado con acceso total, así que normalmente es una policy simple de "authenticated puede todo"). Ejemplo si `ordenes` usa una policy abierta para `authenticated`:

```sql
ALTER TABLE lotes_pedido ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access" ON lotes_pedido
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
```

- [ ] **Step 3: Verificar el schema**

En el SQL Editor:
```sql
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'lotes_pedido';
SELECT column_name FROM information_schema.columns WHERE table_name = 'ordenes' AND column_name = 'lote_id';
```
Esperado: la primera consulta lista las 9 columnas definidas arriba; la segunda devuelve una fila (`lote_id`).

- [ ] **Step 4: Commit**

No hay archivos que commitear en este paso (cambio de infraestructura, no de código).

---

### Task 2: Funciones de datos en `sistema-db.js`

**Files:**
- Modify: `sistema-db.js:109-117` (`_cleanOrdenFields`)
- Modify: `sistema-db.js` — agregar bloque nuevo después de la línea 252 (fin del archivo, después de `dbMarcarPedidasPorMarca`)

**Interfaces:**
- Consumes: tabla `lotes_pedido` y columna `ordenes.lote_id` (Task 1); helper global `normalize(s)` ya existente en `sistema-db.js:211-213`.
- Produces: `generarCodigoLote(producto, marca, codigosExistentes)`, `dbCreateLote(lote)`, `dbGetLotes()`, `dbGetLote(id)`, `dbBuscarOrdenesSimilares(producto, marca)`, `dbVincularOrdenesALote(ordenIds, loteId)` — usados por las tareas 3, 4, 5 y 6.

- [ ] **Step 1: Normalizar `lote_id` vacío a `null` en `_cleanOrdenFields`**

En `sistema-db.js:109-117`, reemplazar:
```js
function _cleanOrdenFields(fields) {
  if (fields.fecha_venta === '') fields.fecha_venta = null;
  if (fields.cliente_id === '') fields.cliente_id = null;
  delete fields.sort_index;
  delete fields._abonado;
  delete fields._saldo;
  delete fields.pagos;
  return fields;
}
```
por:
```js
function _cleanOrdenFields(fields) {
  if (fields.fecha_venta === '') fields.fecha_venta = null;
  if (fields.cliente_id === '') fields.cliente_id = null;
  if (fields.lote_id === '') fields.lote_id = null;
  delete fields.sort_index;
  delete fields._abonado;
  delete fields._saldo;
  delete fields.pagos;
  return fields;
}
```

- [ ] **Step 2: Agregar las funciones de lotes al final de `sistema-db.js`**

Agregar después de la línea 252 (después del cierre de `dbMarcarPedidasPorMarca`):
```js

// ── LOTES DE PEDIDO ───────────────────────────────────────────────────
function generarCodigoLote(producto, marca, codigosExistentes) {
  const limpiar = (s) => (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase();
  const prefijo = limpiar(producto).slice(0, 2) + limpiar(marca).slice(0, 2);
  const existentesSet = new Set(codigosExistentes.map(c => (c || '').toUpperCase()));
  let n = 1;
  let codigo;
  do {
    codigo = prefijo + String(n).padStart(2, '0');
    n++;
  } while (existentesSet.has(codigo));
  return codigo;
}

async function dbCreateLote(lote) {
  let codigo = (lote.codigo || '').trim().toUpperCase();
  if (!codigo) {
    const { data: existentes, error: errBusq } = await db.from('lotes_pedido').select('codigo');
    if (errBusq) throw errBusq;
    codigo = generarCodigoLote(lote.producto, lote.marca, existentes.map(l => l.codigo));
  }
  const { id, ...fields } = lote;
  const { data, error } = await db.from('lotes_pedido').insert({ ...fields, codigo }).select().single();
  if (error) throw error;
  return data;
}

function _conDisponibilidad(lote) {
  const vendidas = (lote.ordenes || []).filter(o => o.estado !== 'cancelada').length;
  const { ordenes, ...resto } = lote;
  return { ...resto, vendidas, disponibles: lote.cantidad - vendidas };
}

async function dbGetLotes() {
  const { data, error } = await db
    .from('lotes_pedido')
    .select('*, ordenes(id, estado)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(_conDisponibilidad);
}

async function dbGetLote(id) {
  const { data, error } = await db
    .from('lotes_pedido')
    .select('*, ordenes(id, estado)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return _conDisponibilidad(data);
}

async function dbBuscarOrdenesSimilares(producto, marca) {
  const { data, error } = await db
    .from('ordenes')
    .select('*, clientes(nombre)')
    .is('lote_id', null)
    .neq('estado', 'cancelada');
  if (error) throw error;
  const p = normalize(producto || '');
  const m = normalize(marca || '');
  return data.filter(o =>
    (p && normalize(o.producto || '').includes(p)) ||
    (m && normalize(o.marca || '').includes(m))
  );
}

async function dbVincularOrdenesALote(ordenIds, loteId) {
  const { error } = await db.from('ordenes').update({ lote_id: loteId }).in('id', ordenIds);
  if (error) throw error;
}
```

- [ ] **Step 3: Sanity check de que no se rompió nada**

Run: `npm test`
Expected: `1 passed` (el test existente de `functions/_lib/auth.js` sigue pasando; este archivo no lo toca esta tarea, es solo para confirmar que el entorno de test sigue sano).

- [ ] **Step 4: Verificación manual en consola del navegador**

1. Levantar el sitio: `python -m http.server 8000` en la raíz del repo.
2. Abrir `http://localhost:8000/sistema.html`, iniciar sesión.
3. Abrir la consola del navegador (F12) y ejecutar:
   ```js
   generarCodigoLote('Jinx', 'Hot Toys', [])
   ```
   Esperado: `"JIHO01"`.
4. Ejecutar:
   ```js
   generarCodigoLote('Jinx', 'Hot Toys', ['JIHO01', 'JIHO02'])
   ```
   Esperado: `"JIHO03"`.
5. Crear un lote de prueba desde consola:
   ```js
   await dbCreateLote({ producto: 'ZZZTEST Jinx', marca: 'Hot Toys', escala: '1:6', cantidad: 5, proveedor: 'test', fecha_pedido: '2026-07-01' })
   ```
   Esperado: devuelve el objeto insertado con `codigo` generado (ej. `"ZZHO01"`) y un `id` uuid. Guardar ese `id` para el siguiente paso (`const testLoteId = '...'`).
6. Ejecutar:
   ```js
   await dbGetLotes()
   ```
   Esperado: un array que incluye el lote recién creado con `vendidas: 0` y `disponibles: 5`.
7. Ejecutar:
   ```js
   await dbGetLote(testLoteId)
   ```
   Esperado: mismo objeto individual, con `vendidas: 0` y `disponibles: 5`.
8. Ejecutar:
   ```js
   await dbBuscarOrdenesSimilares('Jinx', 'Hot Toys')
   ```
   Esperado: array (puede estar vacío si no hay órdenes reales de Jinx sin lote; no debe tirar error).
9. **Limpieza:** en el SQL Editor de Supabase, borrar el lote de prueba: `DELETE FROM lotes_pedido WHERE producto = 'ZZZTEST Jinx';`

- [ ] **Step 5: Commit**

```bash
git add sistema-db.js
git commit -m "feat: funciones de datos para lotes de pedido a proveedor"
```

---

### Task 3: Vista "Lotes de Pedido" — listado y creación

**Files:**
- Modify: `sistema.html:494-497` (page-header de Órdenes — agregar botón de acceso)
- Modify: `sistema.html:1482` (`ALL_VIEWS` — registrar `'lotes'`)
- Modify: `sistema.html` — insertar vista nueva después de la línea 1294 (cierre de "Vista: Sin pedir al proveedor"), antes de la línea 1296 (`<!-- Vista: Métricas -->`)
- Modify: `sistema.html` — insertar función `uvLotes()` después de la línea 1478 (cierre de `uvSinPedir()`), antes de la línea 1480 (`const VIEWS_PERSISTIBLES`)

**Interfaces:**
- Consumes: `dbGetLotes()`, `dbCreateLote(lote)` (Task 2).
- Produces: vista `'lotes'` navegable vía `$dispatch('go-to','lotes')`; función Alpine `uvLotes()` con `lotes`, `abrirNuevo()`, `crearLote()` — Task 4 extiende esta misma función.

- [ ] **Step 1: Agregar botón de acceso en el header de Órdenes**

En `sistema.html:494-497`, reemplazar:
```html
      <div class="page-header">
        <h1 class="page-title">Órdenes</h1>
        <button class="btn-sm btn-purple" @click="$dispatch('open-nueva-orden')">+ Nueva orden</button>
      </div>
```
por:
```html
      <div class="page-header">
        <h1 class="page-title">Órdenes</h1>
        <div style="display:flex;gap:8px">
          <button class="btn-sm btn-ghost" @click="$dispatch('go-to','lotes')">📦 Lotes de Pedido</button>
          <button class="btn-sm btn-purple" @click="$dispatch('open-nueva-orden')">+ Nueva orden</button>
        </div>
      </div>
```

- [ ] **Step 2: Registrar la vista en `ALL_VIEWS`**

En `sistema.html:1482`, reemplazar:
```js
const ALL_VIEWS = new Set(['dashboard','ordenes','clientes','metricas','whatsapp-masivo','detalle-orden','historial-cliente','nueva-orden','sin-pedir']);
```
por:
```js
const ALL_VIEWS = new Set(['dashboard','ordenes','clientes','metricas','whatsapp-masivo','detalle-orden','historial-cliente','nueva-orden','sin-pedir','lotes']);
```

- [ ] **Step 3: Insertar el HTML de la vista**

Insertar después de `sistema.html:1294` (la línea `    </div>` que cierra "Vista: Sin pedir al proveedor") y antes de `sistema.html:1296` (`<!-- Vista: Métricas -->`):
```html

    <!-- Vista: Lotes de Pedido -->
    <div x-show="view==='lotes'" x-data="uvLotes()">
      <div class="page-header">
        <h1 class="page-title">Lotes de Pedido</h1>
        <div style="display:flex;gap:8px">
          <button class="btn-sm btn-ghost" @click="$dispatch('go-to','ordenes')">← Órdenes</button>
          <button class="btn-sm btn-purple" @click="abrirNuevo()">+ Nuevo lote</button>
        </div>
      </div>
      <div class="page-body">
        <div x-show="loading" style="color:#fff;font-size:14px;padding:24px 0">Cargando...</div>
        <div x-show="!loading && error" style="color:var(--red);font-size:14px;padding:16px 0" x-text="'Error: ' + error"></div>
        <div x-show="!loading && !error">
          <div x-show="lotes.length === 0" style="color:var(--muted2);font-size:14px;padding:16px 0">No hay lotes pedidos todavía.</div>
          <div class="card" x-show="lotes.length > 0">
            <table class="table">
              <thead>
                <tr>
                  <th>Producto</th><th>Código</th><th>Pedidas</th><th>Vendidas</th><th>Disponibles</th><th>Proveedor</th>
                </tr>
              </thead>
              <tbody>
                <template x-for="l in lotes" :key="l.id">
                  <tr>
                    <td>
                      <div style="font-weight:600;color:#fff" x-text="l.producto"></div>
                      <div style="font-size:12px;color:var(--muted2)" x-text="[l.marca,l.escala].filter(Boolean).join(' · ')"></div>
                    </td>
                    <td x-text="l.codigo"></td>
                    <td x-text="l.cantidad"></td>
                    <td x-text="l.vendidas"></td>
                    <td :style="l.disponibles<=0?'color:var(--red);font-weight:700':'color:var(--green);font-weight:700'" x-text="l.disponibles"></td>
                    <td x-text="l.proveedor||'—'"></td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Modal nuevo lote -->
      <div class="modal-bg" :class="{open:modalNuevo}" @click.self="modalNuevo=false">
        <div class="modal">
          <button class="modal-close" @click="modalNuevo=false">✕</button>
          <div class="modal-title">Nuevo lote de pedido</div>
          <div class="form-row">
            <div><label class="form-label">Producto *</label>
              <input class="form-input" type="text" x-model="form.producto" placeholder="Ej: Jinx" style="font-size:16px"></div>
            <div><label class="form-label">Marca</label>
              <input class="form-input" type="text" x-model="form.marca" placeholder="Hot Toys..." style="font-size:16px"></div>
          </div>
          <div class="form-row">
            <div><label class="form-label">Escala</label>
              <input class="form-input" type="text" x-model="form.escala" placeholder="1:6, 1:12..." style="font-size:16px"></div>
            <div><label class="form-label">Cantidad pedida *</label>
              <input class="form-input" type="number" x-model.number="form.cantidad" min="1" style="font-size:16px"></div>
          </div>
          <div class="form-row">
            <div><label class="form-label">Código</label>
              <input class="form-input" type="text" x-model="form.codigo" placeholder="Auto si se deja vacío" style="font-size:16px"></div>
            <div><label class="form-label">Proveedor</label>
              <input class="form-input" type="text" x-model="form.proveedor" placeholder="ebay, gundam, lts..." style="font-size:16px"></div>
          </div>
          <div class="form-row-1">
            <label class="form-label">Fecha de pedido</label>
            <input class="form-input" type="date" x-model="form.fecha_pedido" style="font-size:16px">
          </div>
          <div class="modal-footer">
            <button class="btn-sm btn-ghost" @click="modalNuevo=false">Cancelar</button>
            <button class="btn-sm btn-purple" @click="crearLote()" :disabled="guardando">
              <span x-text="guardando?'Creando...':'Crear lote'"></span>
            </button>
          </div>
        </div>
      </div>
    </div>
```

- [ ] **Step 4: Insertar la función Alpine `uvLotes()`**

Insertar después de `sistema.html:1478` (la línea `}` que cierra `uvSinPedir()`) y antes de `sistema.html:1480` (`const VIEWS_PERSISTIBLES`):
```js

// ── LOTES DE PEDIDO ───────────────────────────────────────────────────
function uvLotes() {
  return {
    loading: true, error: '', lotes: [],
    modalNuevo: false, guardando: false,
    form: { producto: '', marca: '', escala: '', cantidad: 1, codigo: '', proveedor: '', fecha_pedido: '', notas: '' },
    async init() { await this.cargar(); },
    async cargar() {
      this.loading = true; this.error = '';
      try { this.lotes = await dbGetLotes(); }
      catch(e) { this.error = e.message; }
      finally { this.loading = false; }
    },
    abrirNuevo() {
      this.form = { producto: '', marca: '', escala: '', cantidad: 1, codigo: '', proveedor: '', fecha_pedido: '', notas: '' };
      this.modalNuevo = true;
    },
    async crearLote() {
      if (!this.form.producto.trim()) { alert('El producto es obligatorio'); return; }
      if (!this.form.cantidad || this.form.cantidad < 1) { alert('La cantidad debe ser mayor a 0'); return; }
      this.guardando = true;
      try {
        const nuevo = await dbCreateLote(this.form);
        this.modalNuevo = false;
        this.lotes.unshift({ ...nuevo, vendidas: 0, disponibles: nuevo.cantidad });
      } catch(e) { alert('Error: ' + e.message); }
      finally { this.guardando = false; }
    },
  };
}
```

- [ ] **Step 5: Verificación manual**

1. Levantar el sitio (`python -m http.server 8000`) y abrir `sistema.html`, iniciar sesión.
2. Ir a Órdenes → click en "📦 Lotes de Pedido". Esperado: vista vacía o con lotes existentes, sin errores en consola.
3. Click "+ Nuevo lote" → completar Producto: `ZZZTEST Batman`, Marca: `Iron Studios`, Cantidad: `3` → "Crear lote". Esperado: el modal se cierra, aparece una fila nueva en la tabla con Pedidas=3, Vendidas=0, Disponibles=3 (en verde), y un código autogenerado tipo `ZZIR01`.
4. Recargar la página (F5), volver a Órdenes → Lotes de Pedido. Esperado: el lote de prueba sigue apareciendo (persistido en Supabase).
5. **Limpieza:** `DELETE FROM lotes_pedido WHERE producto = 'ZZZTEST Batman';` en el SQL Editor de Supabase.

- [ ] **Step 6: Commit**

```bash
git add sistema.html
git commit -m "feat: vista de listado y creación de lotes de pedido"
```

---

### Task 4: Vincular órdenes existentes a un lote

**Files:**
- Modify: `sistema.html` — dentro de la vista `'lotes'` creada en Task 3 (agregar botón por fila + modal de vinculación)
- Modify: `sistema.html` — dentro de `uvLotes()` creada en Task 3 (agregar estado y métodos)

**Interfaces:**
- Consumes: `dbBuscarOrdenesSimilares(producto, marca)`, `dbVincularOrdenesALote(ordenIds, loteId)` (Task 2); `uvLotes()` de Task 3.
- Produces: al crear un lote (o desde el botón "Buscar y vincular órdenes" de una fila existente), se puede vincular en bloque cualquier cantidad de órdenes existentes al lote.

- [ ] **Step 1: Agregar botón "Buscar y vincular órdenes" a cada fila y el modal de vinculación**

En el HTML insertado en Task 3, dentro de `<tr>` del `x-for="l in lotes"`, reemplazar:
```html
                    <td x-text="l.proveedor||'—'"></td>
                  </tr>
```
por:
```html
                    <td x-text="l.proveedor||'—'"></td>
                    <td><button class="btn-sm btn-ghost" @click="abrirVincular(l)">Buscar y vincular órdenes</button></td>
                  </tr>
```
Y en el `<thead>`, reemplazar:
```html
                  <th>Producto</th><th>Código</th><th>Pedidas</th><th>Vendidas</th><th>Disponibles</th><th>Proveedor</th>
```
por:
```html
                  <th>Producto</th><th>Código</th><th>Pedidas</th><th>Vendidas</th><th>Disponibles</th><th>Proveedor</th><th></th>
```

Justo antes del `</div>` que cierra la vista `'lotes'` (la línea que sigue al cierre del modal "Nuevo lote" agregado en Task 3), agregar el modal de vinculación:
```html

      <!-- Modal vincular órdenes existentes -->
      <div class="modal-bg" :class="{open:modalVincular}" @click.self="modalVincular=false">
        <div class="modal">
          <button class="modal-close" @click="modalVincular=false">✕</button>
          <div class="modal-title" x-text="'¿Alguna de estas órdenes es del lote ' + (loteActivo ? loteActivo.codigo : '') + '?'"></div>
          <div x-show="buscandoCandidatos" style="color:var(--muted2);font-size:14px">Buscando órdenes parecidas...</div>
          <div x-show="!buscandoCandidatos && candidatos.length===0" style="color:var(--muted2);font-size:14px">No se encontraron órdenes sin lote que se parezcan por nombre. Podés volver a buscar más adelante con este mismo botón.</div>
          <div x-show="!buscandoCandidatos && candidatos.length>0">
            <template x-for="o in candidatos" :key="o.id">
              <label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer">
                <input type="checkbox" :value="o.id" x-model="seleccionados" style="width:16px;height:16px;accent-color:var(--purple)">
                <div>
                  <div style="font-size:14px;color:#fff" x-text="o.producto"></div>
                  <div style="font-size:12px;color:var(--muted2)" x-text="[o.clientes?.nombre, o.marca].filter(Boolean).join(' · ')"></div>
                </div>
              </label>
            </template>
          </div>
          <div class="modal-footer">
            <button class="btn-sm btn-ghost" @click="modalVincular=false">Cerrar sin vincular</button>
            <button class="btn-sm btn-purple" @click="confirmarVinculacion()" x-text="'Vincular seleccionadas (' + seleccionados.length + ')'" :disabled="seleccionados.length===0"></button>
          </div>
        </div>
      </div>
```

- [ ] **Step 2: Agregar el estado y los métodos a `uvLotes()`**

En la función `uvLotes()` agregada en Task 3, reemplazar:
```js
    form: { producto: '', marca: '', escala: '', cantidad: 1, codigo: '', proveedor: '', fecha_pedido: '', notas: '' },
    async init() { await this.cargar(); },
```
por:
```js
    form: { producto: '', marca: '', escala: '', cantidad: 1, codigo: '', proveedor: '', fecha_pedido: '', notas: '' },
    modalVincular: false, loteActivo: null, candidatos: [], seleccionados: [], buscandoCandidatos: false,
    async init() { await this.cargar(); },
```
Y reemplazar el método `crearLote` (escrito en Task 3 Step 4) para que abra automáticamente la búsqueda de vinculación después de crear el lote — de:
```js
    async crearLote() {
      if (!this.form.producto.trim()) { alert('El producto es obligatorio'); return; }
      if (!this.form.cantidad || this.form.cantidad < 1) { alert('La cantidad debe ser mayor a 0'); return; }
      this.guardando = true;
      try {
        const nuevo = await dbCreateLote(this.form);
        this.modalNuevo = false;
        this.lotes.unshift({ ...nuevo, vendidas: 0, disponibles: nuevo.cantidad });
      } catch(e) { alert('Error: ' + e.message); }
      finally { this.guardando = false; }
    },
```
a:
```js
    async crearLote() {
      if (!this.form.producto.trim()) { alert('El producto es obligatorio'); return; }
      if (!this.form.cantidad || this.form.cantidad < 1) { alert('La cantidad debe ser mayor a 0'); return; }
      this.guardando = true;
      try {
        const nuevo = await dbCreateLote(this.form);
        this.modalNuevo = false;
        this.lotes.unshift({ ...nuevo, vendidas: 0, disponibles: nuevo.cantidad });
        await this.abrirVincular(nuevo);
      } catch(e) { alert('Error: ' + e.message); }
      finally { this.guardando = false; }
    },
    async abrirVincular(lote) {
      this.loteActivo = lote;
      this.seleccionados = [];
      this.modalVincular = true;
      this.buscandoCandidatos = true;
      try { this.candidatos = await dbBuscarOrdenesSimilares(lote.producto, lote.marca); }
      catch(e) { alert('Error buscando órdenes: ' + e.message); }
      finally { this.buscandoCandidatos = false; }
    },
    async confirmarVinculacion() {
      try {
        await dbVincularOrdenesALote(this.seleccionados, this.loteActivo.id);
        await this.cargar();
        this.modalVincular = false;
      } catch(e) { alert('Error: ' + e.message); }
    },
```

- [ ] **Step 3: Verificación manual**

1. Levantar el sitio, abrir `sistema.html`, iniciar sesión.
2. Ir a Órdenes → crear una orden de prueba nueva: producto `ZZZTEST Vinculacion`, marca `Test Brand`, cliente cualquiera, guardar. Confirmar que queda sin lote (comportamiento normal).
3. Ir a Órdenes → Lotes de Pedido → "+ Nuevo lote" → Producto: `ZZZTEST Vinculacion`, Marca: `Test Brand`, Cantidad: `2` → "Crear lote". Esperado: se cierra el modal de creación y se abre automáticamente el modal "¿Alguna de estas órdenes es del lote...?" mostrando la orden `ZZZTEST Vinculacion` creada en el paso 2 como candidata.
4. Tildar esa orden → "Vincular seleccionadas (1)". Esperado: el modal se cierra, la fila del lote en la tabla ahora muestra Vendidas=1, Disponibles=1.
5. En la fila del lote, click "Buscar y vincular órdenes" de nuevo. Esperado: se reabre el modal (sin la orden ya vinculada, porque `dbBuscarOrdenesSimilares` solo trae órdenes con `lote_id IS NULL`).
6. **Limpieza:** en el SQL Editor de Supabase:
   ```sql
   DELETE FROM ordenes WHERE producto = 'ZZZTEST Vinculacion';
   DELETE FROM lotes_pedido WHERE producto = 'ZZZTEST Vinculacion';
   ```

- [ ] **Step 4: Commit**

```bash
git add sistema.html
git commit -m "feat: vincular órdenes existentes a un lote de pedido"
```

---

### Task 5: Vincular un lote desde el formulario de Nueva/Editar Orden

**Files:**
- Modify: `sistema.html:808-861` (sección "Producto" del formulario de orden)
- Modify: `sistema.html:2020-2023` (estado inicial de `uvNuevaOrden()`)
- Modify: `sistema.html` — dentro de `uvNuevaOrden()`, método `init()` (línea 2038 en adelante, ver contenido citado en el punto 6 de la exploración: bloque que arranca `async init() { this.clientes = await dbGetClientes();`)

**Interfaces:**
- Consumes: `dbGetLotes()`, `dbGetLote(id)` (Task 2); helper global `normalize(s)`.
- Produces: `form.lote_id` en el objeto que ya guarda `dbSaveOrden` (Task 2 ya normaliza `''` → `null`) — Task 6 lee este mismo campo desde el detalle de orden.

**Nota respecto al spec:** el spec original menciona una función `dbSetOrdenLote(ordenId, loteId)` para persistir el vínculo desde el form de orden. No se implementa como función separada porque el form de "Nueva/Editar Orden" no guarda ningún campo individualmente — todo (producto, marca, precio, etc.) queda en `form` y se persiste junto al hacer click en "Guardar", vía `dbSaveOrden`. Agregar `dbSetOrdenLote` sería una ruta de guardado redundante que nada llama; `lote_id` viaja como un campo más de `form`, igual que `marca` o `escala`.

- [ ] **Step 1: Agregar la sección de vínculo a lote en el HTML del formulario**

En `sistema.html`, el bloque "Producto" termina en la línea 861 con:
```html
            </div>
          </div>

          <div style="margin-bottom:24px">
            <div class="card-title" style="margin-bottom:16px;font-size:16px">Costos (USD)</div>
```
(la primera línea `</div>` de ese fragmento es la 861, que cierra el `<div style="margin-bottom:24px">` abierto en la línea 808). Insertar el bloque de vínculo a lote justo antes de esa línea 861, es decir después del cierre del `form-row` de Cliente (línea 860):
```html
            </div>

            <div x-show="!loteExpandido" class="form-row-1">
              <button type="button" class="btn-sm btn-ghost" @click="loteExpandido=true">+ Vincular a lote de pedido</button>
            </div>
            <div x-show="loteExpandido" class="form-row-1" style="padding:14px;background:var(--bg3);border:1px solid var(--border2);border-radius:8px">
              <template x-if="!form.lote_id">
                <div>
                  <label class="form-label">Buscar lote (producto, marca o código)</label>
                  <div style="position:relative">
                    <input class="form-input" type="text" x-model="loteBusqueda" @input="buscarLotes()" placeholder="Ej: Jinx, Hot Toys, JIHO01..." style="font-size:16px">
                    <div x-show="lotesFiltrados.length>0" style="position:absolute;top:100%;left:0;right:0;z-index:300;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;max-height:200px;overflow-y:auto;margin-top:4px">
                      <template x-for="l in lotesFiltrados" :key="l.id">
                        <button type="button" @click="seleccionarLote(l)" style="display:block;width:100%;text-align:left;padding:10px 14px;background:none;border:none;color:var(--text);font-size:14px;font-family:inherit;cursor:pointer">
                          <span x-text="l.producto + ' · ' + l.codigo"></span>
                          <span :style="l.disponibles<=0?'color:var(--red)':'color:var(--green)'" x-text="' — ' + l.disponibles + ' disponibles'"></span>
                        </button>
                      </template>
                    </div>
                  </div>
                </div>
              </template>
              <template x-if="form.lote_id">
                <div>
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="font-size:14px;color:#fff" x-text="loteVinculado ? (loteVinculado.producto + ' · ' + loteVinculado.codigo) : ''"></span>
                    <button type="button" class="btn-sm btn-ghost" @click="quitarLote()">Quitar vínculo</button>
                  </div>
                  <div x-show="loteVinculado && loteVinculado.disponibles<=0" style="color:var(--red);font-size:12px;margin-top:6px">
                    ⚠ Ya no quedan unidades disponibles en este lote.
                  </div>
                </div>
              </template>
            </div>
          </div>
```

- [ ] **Step 2: Agregar estado y campo `lote_id` en `uvNuevaOrden()`**

En `sistema.html:2013-2023`, reemplazar:
```js
function uvNuevaOrden() {
  return {
    clientes: [], guardando: false, abonoInicial: 0,
    aduanaManual: false, arancelManual: false,
    clienteBusqueda: '', mostrarClienteOpts: false,
    modalNuevoCliente: false, nuevoClienteForm: { nombre: '', whatsapp: '' }, guardandoCliente: false,
    form: {
      id: null, cliente_id: '', producto: '', codigo: '', marca: '',
      escala: '', pedido: '', precio_original: 0, envio: 0, envio_mbe: 0,
      impuesto: 0, aduana: 0, arancel: 0, precio_venta_usd: 0,
      precio_venta_gtq: 0, estado: 'en_proceso', entregado: false, pedida_proveedor: false, notas: ''
    },
```
por:
```js
function uvNuevaOrden() {
  return {
    clientes: [], guardando: false, abonoInicial: 0,
    aduanaManual: false, arancelManual: false,
    clienteBusqueda: '', mostrarClienteOpts: false,
    modalNuevoCliente: false, nuevoClienteForm: { nombre: '', whatsapp: '' }, guardandoCliente: false,
    loteExpandido: false, loteBusqueda: '', lotesTodos: [], loteVinculado: null,
    form: {
      id: null, cliente_id: '', producto: '', codigo: '', marca: '',
      escala: '', pedido: '', precio_original: 0, envio: 0, envio_mbe: 0,
      impuesto: 0, aduana: 0, arancel: 0, precio_venta_usd: 0,
      precio_venta_gtq: 0, estado: 'en_proceso', entregado: false, pedida_proveedor: false, notas: '', lote_id: ''
    },
```

- [ ] **Step 3: Agregar el getter de filtrado y los métodos de selección**

En `uvNuevaOrden()`, justo después del getter `clientesFiltrados`/método `seleccionarCliente` (los que siguen a `form: {...}`), agregar:
```js
    get lotesFiltrados() {
      const q = normalize(this.loteBusqueda);
      if (!q) return [];
      return this.lotesTodos.filter(l =>
        normalize(l.producto).includes(q) ||
        normalize(l.marca || '').includes(q) ||
        normalize(l.codigo).includes(q)
      ).slice(0, 8);
    },
    async buscarLotes() {
      if (this.lotesTodos.length === 0) this.lotesTodos = await dbGetLotes();
    },
    seleccionarLote(l) {
      this.form.lote_id = l.id;
      this.loteVinculado = l;
      this.loteBusqueda = '';
      if (!this.form.marca) this.form.marca = l.marca;
      if (!this.form.escala) this.form.escala = l.escala;
      if (!this.form.pedido) this.form.pedido = l.proveedor;
      this.form.pedida_proveedor = true;
      if (l.disponibles <= 0) alert('Ya vendiste todas las unidades de este lote (' + l.cantidad + '). Podés vincularla igual si vas a pedir más.');
    },
    quitarLote() {
      this.form.lote_id = '';
      this.loteVinculado = null;
    },
```

- [ ] **Step 4: Resolver el lote vinculado al editar una orden existente**

En el método `init()` de `uvNuevaOrden()`, reemplazar:
```js
    async init() {
      this.clientes = await dbGetClientes();
      if (_editarOrdenId) {
        const o = await dbGetOrden(_editarOrdenId);
        this.form = { ...o };
        this.abonoInicial = 0;
        _editarOrdenId = null;
        if (o.cliente_id) {
          const c = this.clientes.find(c => c.id === o.cliente_id);
          if (c) this.clienteBusqueda = c.nombre;
        }
```
por:
```js
    async init() {
      this.clientes = await dbGetClientes();
      if (_editarOrdenId) {
        const o = await dbGetOrden(_editarOrdenId);
        this.form = { ...o, lote_id: o.lote_id || '' };
        this.abonoInicial = 0;
        _editarOrdenId = null;
        if (o.cliente_id) {
          const c = this.clientes.find(c => c.id === o.cliente_id);
          if (c) this.clienteBusqueda = c.nombre;
        }
        if (o.lote_id) {
          this.loteExpandido = true;
          this.loteVinculado = await dbGetLote(o.lote_id);
        }
```
(el resto del `init()`, incluyendo los `$watch` de aduana/arancel, sigue sin cambios).

- [ ] **Step 5: Verificación manual**

1. Levantar el sitio, abrir `sistema.html`, iniciar sesión.
2. Ir a Órdenes → Lotes de Pedido → "+ Nuevo lote" → producto `ZZZTEST Formulario`, marca `Test Brand`, cantidad `1` → crear (en el modal de vinculación que se abre automáticamente, cerrar sin vincular nada).
3. Ir a Órdenes → "+ Nueva orden". Completar Producto: `ZZZTEST Formulario`, cliente cualquiera. Click "+ Vincular a lote de pedido". Escribir "Formulario" en el buscador. Esperado: aparece el lote `ZZZTEST Formulario` con "1 disponibles" en verde.
4. Click en el resultado. Esperado: se autocompletan Marca y Proveedor desde el lote, aparece el nombre del lote con botón "Quitar vínculo", y el checkbox "Pedida al proveedor" del form queda tildado.
5. Guardar la orden. Ir al detalle de esa orden y click "Editar". Esperado: la sección de lote aparece ya expandida mostrando el mismo lote vinculado (sin tener que buscar de nuevo).
6. Click "Quitar vínculo" → Guardar. Volver a editar la orden. Esperado: la sección vuelve a mostrar el buscador (colapsado), sin lote vinculado.
7. Repetir el paso 3-4 vinculando la orden al lote de nuevo, y crear una segunda orden de prueba vinculada al mismo lote (`ZZZTEST Formulario 2`). Esperado: al buscar el lote la segunda vez, muestra "0 disponibles" en rojo, y al seleccionarlo igual aparece el `alert` de advertencia de sobreventa, pero permite guardar igual.
8. **Limpieza:**
   ```sql
   DELETE FROM ordenes WHERE producto LIKE 'ZZZTEST Formulario%';
   DELETE FROM lotes_pedido WHERE producto = 'ZZZTEST Formulario';
   ```

- [ ] **Step 6: Commit**

```bash
git add sistema.html
git commit -m "feat: vincular lote de pedido desde el formulario de orden"
```

---

### Task 6: Badge de lote en el detalle de orden

**Files:**
- Modify: `sistema.html:608-612` (header del detalle de orden)
- Modify: `sistema.html:2290-2321` (`uvDetalleOrden()` — estado e `init()`)

**Interfaces:**
- Consumes: `dbGetLote(id)` (Task 2); `orden.lote_id` (Task 1/5).

- [ ] **Step 1: Agregar el badge en el HTML del detalle**

En `sistema.html:609-612`, reemplazar:
```html
              <div style="margin-top:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                <span class="badge" :class="'badge-'+orden.estado" x-text="orden.estado.replace('_',' ')"></span>
                <span style="font-size:12px;color:var(--muted2)" x-text="'Creada el ' + fechaOrden"></span>
              </div>
```
por:
```html
              <div style="margin-top:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                <span class="badge" :class="'badge-'+orden.estado" x-text="orden.estado.replace('_',' ')"></span>
                <span x-show="loteVinculado" class="badge" style="background:rgba(232,98,42,.15);color:var(--pl)" x-text="loteVinculado ? ('Lote ' + loteVinculado.codigo + ' — ' + loteVinculado.disponibles + ' disp.') : ''"></span>
                <span style="font-size:12px;color:var(--muted2)" x-text="'Creada el ' + fechaOrden"></span>
              </div>
```

- [ ] **Step 2: Cargar el lote vinculado en `uvDetalleOrden()`**

En `sistema.html:2290-2321`, reemplazar:
```js
function uvDetalleOrden() {
  return {
    orden: null, pagos: [], loading: true, backView: 'ordenes',
```
por:
```js
function uvDetalleOrden() {
  return {
    orden: null, pagos: [], loading: true, backView: 'ordenes', loteVinculado: null,
```
Y reemplazar el `init()`:
```js
    async init() {
      if (_verOrdenId) {
        this.backView = _detalleBack || 'ordenes';
        this.loading = true;
        try {
          [this.orden, this.pagos] = await Promise.all([
            dbGetOrden(_verOrdenId),
            dbGetPagosByOrden(_verOrdenId)
          ]);
        } catch(e) { alert('Error al cargar orden: ' + e.message); }
        finally { this.loading = false; _verOrdenId = null; _detalleBack = null; }
      }
    },
```
por:
```js
    async init() {
      if (_verOrdenId) {
        this.backView = _detalleBack || 'ordenes';
        this.loading = true;
        try {
          [this.orden, this.pagos] = await Promise.all([
            dbGetOrden(_verOrdenId),
            dbGetPagosByOrden(_verOrdenId)
          ]);
          if (this.orden.lote_id) this.loteVinculado = await dbGetLote(this.orden.lote_id);
        } catch(e) { alert('Error al cargar orden: ' + e.message); }
        finally { this.loading = false; _verOrdenId = null; _detalleBack = null; }
      }
    },
```

- [ ] **Step 3: Verificación manual**

1. Levantar el sitio, abrir `sistema.html`, iniciar sesión.
2. Repetir los pasos 2-4 de la verificación de Task 5 para dejar una orden `ZZZTEST Badge` vinculada a un lote nuevo `ZZZTEST Badge` (cantidad 2).
3. Ir al detalle de esa orden (desde Órdenes, buscarla y abrirla). Esperado: junto al badge de estado (ej. "en proceso"), aparece un segundo badge naranja "Lote XXXX — 1 disp." con el código real generado.
4. **Limpieza:**
   ```sql
   DELETE FROM ordenes WHERE producto = 'ZZZTEST Badge';
   DELETE FROM lotes_pedido WHERE producto = 'ZZZTEST Badge';
   ```

- [ ] **Step 4: Commit**

```bash
git add sistema.html
git commit -m "feat: mostrar lote vinculado en el detalle de orden"
```

---

## Resumen de archivos tocados

| Archivo | Tareas |
|---|---|
| Supabase (manual) | Task 1 |
| `sistema-db.js` | Task 2 |
| `sistema.html` | Task 3, 4, 5, 6 |
