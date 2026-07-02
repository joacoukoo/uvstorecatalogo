# Aviso de stock de lote, eliminar orden y ganancia de canceladas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En el sistema de órdenes UV Store GT (`sistema.html` + `sistema-db.js`, Supabase), avisar automáticamente cuando un producto nuevo coincide con un lote agotado, permitir eliminar una orden de verdad, y que el abono de una orden cancelada cuente como ganancia en vez de perderse o inflar el número.

**Architecture:** Todo el trabajo es dentro de `sistema.html` (Alpine.js v3, sin build step, funciones globales `uvNuevaOrden()`, `uvDetalleOrden()`, `uvDashboard()`, `uvMetricas()`). No hay cambios de esquema ni de `sistema-db.js` — `dbDeleteOrden` y `calcAbonado` ya existen y se reutilizan tal cual.

**Tech Stack:** HTML + Alpine.js v3 + Supabase JS (CDN, sin bundler). Sin framework de test para este archivo (vitest en este repo solo cubre `functions/_lib/*.js`, módulos ES puros — `sistema.html` no es un módulo ES y depende de globals de browser/Supabase, así que no es testeable con vitest sin una reestructuración fuera de alcance).

## Global Constraints

- Tasa de conversión GTQ→USD: `7.9` (hardcodeada en todo el archivo, no hay config — seguir el mismo patrón, no introducir una constante nueva).
- El vínculo orden↔lote nunca es automático por texto — cualquier coincidencia de texto es solo informativa, la confirmación de vínculo siempre es un clic manual del usuario (regla de [[2026-07-01-lotes-pedido-proveedor-design]]).
- Sin automated tests para `sistema.html`: cada tarea se verifica manualmente en el navegador, sirviendo el repo con un servidor estático local (ej. `npx serve .` o `python -m http.server 8000`) y abriendo `sistema.html`, logueado con las credenciales admin de Supabase existentes.
- Seguir los patrones visuales ya existentes: `btn-danger` para acciones destructivas, `confirm()` antes de cualquier borrado, `document.dispatchEvent(new CustomEvent('recargar-ordenes'))` después de cualquier mutación que otros componentes deban reflejar.
- No tocar RLS, autenticación, ni el flujo de pagos existente.

---

### Task 1: Aviso de stock al escribir el producto en orden nueva

**Files:**
- Modify: `sistema.html:816-817` (input "Nombre del producto")
- Modify: `sistema.html:2211` (estado inicial de `uvNuevaOrden()`, ya tiene `lotesTodos: []`, sin cambios de esa línea salvo revisar que siga ahí)
- Modify: `sistema.html:2227` (agregar getter `loteSugerido` antes de `lotesFiltrados`)
- Modify: `sistema.html:2269-2270` (`init()` de `uvNuevaOrden()`, precargar `lotesTodos`)

**Interfaces:**
- Consumes: `dbGetLotes()` (`sistema-db.js:291`, ya existe, devuelve lotes con campo `disponibles`), `normalize()` (`sistema-db.js:212`, ya existe).
- Produces: getter `loteSugerido` en `uvNuevaOrden()` — devuelve `null` o un objeto lote (con `codigo`, `disponibles`) cuyo `producto` coincide parcialmente (case-insensitive) con `form.producto`, o `null` si `form.lote_id` ya está seteado.

- [ ] **Step 1: Precargar `lotesTodos` en `init()`**

Archivo `sistema.html`, dentro de `function uvNuevaOrden()`, reemplazar la primera línea de `async init()`:

```js
// ANTES (sistema.html:2269-2270)
async init() {
  this.clientes = await dbGetClientes();
```

```js
// DESPUÉS
async init() {
  const [clientes, lotes] = await Promise.all([dbGetClientes(), dbGetLotes()]);
  this.clientes = clientes;
  this.lotesTodos = lotes;
```

El resto del cuerpo de `init()` (manejo de `_editarOrdenId`, `$watch`, etc.) queda igual, sin tocar.

- [ ] **Step 2: Agregar el getter `loteSugerido`**

Inmediatamente antes de `get lotesFiltrados() {` (`sistema.html:2227`), agregar:

```js
get loteSugerido() {
  if (this.form.lote_id) return null;
  const q = normalize(this.form.producto);
  if (!q) return null;
  return this.lotesTodos.find(l => normalize(l.producto).includes(q)) || null;
},
```

- [ ] **Step 3: Mostrar el aviso debajo del campo Producto**

Archivo `sistema.html`, reemplazar el bloque del campo "Nombre del producto":

```html
<!-- ANTES (sistema.html:816-817) -->
              <div><label class="form-label">Nombre del producto *</label>
                <input class="form-input" type="text" x-model="form.producto" placeholder="Ej: Batman Arkham Origins" style="font-size:16px"></div>
```

```html
<!-- DESPUÉS -->
              <div><label class="form-label">Nombre del producto *</label>
                <input class="form-input" type="text" x-model="form.producto" placeholder="Ej: Batman Arkham Origins" style="font-size:16px">
                <div x-show="loteSugerido"
                  :style="'margin-top:6px;font-size:12px;color:' + (loteSugerido && loteSugerido.disponibles<=0 ? 'var(--red)' : 'var(--muted2)')"
                  x-text="loteSugerido ? ((loteSugerido.disponibles<=0?'⚠ ':'') + 'Lote ' + loteSugerido.codigo + ': ' + loteSugerido.disponibles + (loteSugerido.disponibles===1?' disponible':' disponibles')) : ''">
                </div>
              </div>
```

- [ ] **Step 4: Verificación manual**

1. Servir el repo (`npx serve .` o `python -m http.server 8000`) y abrir `sistema.html`, loguearse.
2. Ir a "Lotes de Pedido" y confirmar (o crear) un lote con `disponibles = 0` — por ejemplo el lote "stitch" que mencionaste, o crear uno de prueba con cantidad 1 y una orden ya vinculada.
3. Ir a Órdenes → "+ Nueva orden". En el campo "Nombre del producto" escribir texto que coincida con ese lote (ej. "stitch").
4. Confirmar que aparece el aviso en rojo `⚠ Lote CODIGO: 0 disponibles` debajo del campo, sin haber tocado "+ Vincular a lote de pedido".
5. Borrar el texto del campo Producto → el aviso desaparece.
6. Escribir el nombre de un producto que coincide con un lote CON stock (`disponibles > 0`) → aparece el aviso sin el ícono de advertencia, en gris.
7. Abrir "+ Vincular a lote de pedido" y seleccionar manualmente ese lote → el aviso automático desaparece (porque `form.lote_id` ya está seteado) y se sigue viendo el badge normal de lote vinculado.
8. Confirmar que guardar la orden sin tocar "+ Vincular a lote" sigue funcionando igual que antes (sin `lote_id`).

- [ ] **Step 5: Commit**

```bash
git add sistema.html
git commit -m "feat: avisar stock de lote al escribir el producto en orden nueva"
```

---

### Task 2: Botón para eliminar una orden

**Files:**
- Modify: `sistema.html:602-604` (page-header del detalle de orden)
- Modify: `sistema.html:2626-2630` (agregar método junto a `editarOrden()` en `uvDetalleOrden()`)

**Interfaces:**
- Consumes: `dbDeleteOrden(id)` (`sistema-db.js:136-139`, ya existe, sin cambios).
- Produces: método `eliminarOrden()` en `uvDetalleOrden()`.

- [ ] **Step 1: Agregar el botón "Eliminar"**

```html
<!-- ANTES (sistema.html:601-604) -->
    <template x-if="view==='detalle-orden'"><div x-data="uvDetalleOrden()">
      <div class="page-header">
        <button class="btn-sm btn-ghost" @click="$dispatch('go-to', backView)" x-text="backView==='historial-cliente' ? '← Cliente' : backView==='dashboard' ? '← Dashboard' : backView==='sin-pedir' ? '← Sin pedir' : '← Órdenes'"></button>
        <button class="btn-sm btn-ghost" @click="editarOrden()" x-show="orden">Editar</button>
      </div>
```

```html
<!-- DESPUÉS -->
    <template x-if="view==='detalle-orden'"><div x-data="uvDetalleOrden()">
      <div class="page-header">
        <button class="btn-sm btn-ghost" @click="$dispatch('go-to', backView)" x-text="backView==='historial-cliente' ? '← Cliente' : backView==='dashboard' ? '← Dashboard' : backView==='sin-pedir' ? '← Sin pedir' : '← Órdenes'"></button>
        <button class="btn-sm btn-ghost" @click="editarOrden()" x-show="orden">Editar</button>
        <button class="btn-sm btn-danger" @click="eliminarOrden()" x-show="orden">Eliminar</button>
      </div>
```

- [ ] **Step 2: Agregar el método `eliminarOrden()`**

```js
// ANTES (sistema.html:2626-2630)
    editarOrden() {
      _editarOrdenId = this.orden.id;
      _nuevaOrdenBack = this.backView;
      document.dispatchEvent(new CustomEvent('go-to', { detail: 'nueva-orden' }));
    },
```

```js
// DESPUÉS
    editarOrden() {
      _editarOrdenId = this.orden.id;
      _nuevaOrdenBack = this.backView;
      document.dispatchEvent(new CustomEvent('go-to', { detail: 'nueva-orden' }));
    },
    async eliminarOrden() {
      if (!confirm('¿Eliminar esta orden? Esta acción no se puede deshacer.')) return;
      try {
        await dbDeleteOrden(this.orden.id);
        document.dispatchEvent(new CustomEvent('recargar-ordenes'));
        document.dispatchEvent(new CustomEvent('go-to', { detail: this.backView }));
      } catch(e) { alert('Error al eliminar: ' + e.message); }
    },
```

- [ ] **Step 3: Verificación manual**

1. Servir el repo y loguearse en `sistema.html`.
2. Crear una orden de prueba cualquiera (cliente opcional, producto "TEST BORRAR").
3. Entrar al detalle de esa orden y confirmar que aparece el botón "Eliminar" en rojo junto a "Editar".
4. Click en "Eliminar" → aparece el `confirm()`. Cancelar el diálogo → la orden sigue existiendo.
5. Click en "Eliminar" de nuevo → confirmar el diálogo → la vista vuelve a la lista de Órdenes y la orden de prueba ya no aparece.
6. Si el navegador muestra un error de la llamada a Supabase (por ejemplo de RLS bloqueando el `DELETE`), anotar el mensaje exacto — sería necesario ajustar la policy de la tabla `ordenes` en el dashboard de Supabase (Authentication → Policies), fuera del alcance de este repo.
7. Repetir con una orden que tenga un lote vinculado con cupo ajustado (por ejemplo, la orden de prueba vinculada al lote "stitch" agotado): tras eliminarla, entrar a "Lotes de Pedido" y confirmar que "Disponibles" subió en 1 automáticamente (sin ningún paso manual extra).

- [ ] **Step 4: Commit**

```bash
git add sistema.html
git commit -m "feat: permitir eliminar una orden desde su detalle"
```

---

### Task 3: Ganancia de canceladas en el dashboard

**Files:**
- Modify: `sistema.html:1818-1830` (`gananciaMes` dentro de `uvDashboard().cargar()`)

**Interfaces:**
- Consumes: `calcAbonado(pagos)` (`sistema-db.js:196`, ya existe, recibe array de pagos y devuelve la suma de `monto` en GTQ).

- [ ] **Step 1: Ajustar el cálculo de `gananciaMes`**

```js
// ANTES (sistema.html:1818-1830)
        this.gananciaMes = ordenes.reduce((sum, o) => {
          if (o.estado === 'cancelada') return sum;
          let ano, mes;
          if (o.fecha_venta) {
            const p = o.fecha_venta.split('-');
            ano = parseInt(p[0]); mes = parseInt(p[1]) - 1;
          } else {
            const f = new Date(o.created_at);
            ano = f.getFullYear(); mes = f.getMonth();
          }
          if (ano !== anioActual || mes !== mesActual) return sum;
          return sum + ((o.precio_venta_gtq || 0) / 7.9) - calcCostoEstimado(o);
        }, 0);
```

```js
// DESPUÉS
        this.gananciaMes = ordenes.reduce((sum, o) => {
          let ano, mes;
          if (o.fecha_venta) {
            const p = o.fecha_venta.split('-');
            ano = parseInt(p[0]); mes = parseInt(p[1]) - 1;
          } else {
            const f = new Date(o.created_at);
            ano = f.getFullYear(); mes = f.getMonth();
          }
          if (ano !== anioActual || mes !== mesActual) return sum;
          if (o.estado === 'cancelada') return sum + (calcAbonado(o.pagos || []) / 7.9);
          return sum + ((o.precio_venta_gtq || 0) / 7.9) - calcCostoEstimado(o);
        }, 0);
```

- [ ] **Step 2: Verificación manual**

1. En `sistema.html`, anotar el valor actual de "Ganancia est." del dashboard (mes actual).
2. Crear una orden de prueba con `fecha_venta` (o fecha de creación) del mes actual, precio de venta alto (ej. Q1000), y registrarle un abono parcial (ej. Q300).
3. Cancelarla (botón "Cancelada" en su detalle).
4. Volver al dashboard (forzar recarga si hace falta) y confirmar que "Ganancia est." subió en aproximadamente `300 / 7.9 ≈ 37.97` respecto al valor anotado en el paso 1 (no en el precio de venta completo, no en Q0).
5. Borrar la orden de prueba al terminar (usando el botón de la Task 2) para no dejar basura en los datos reales.

- [ ] **Step 3: Commit**

```bash
git add sistema.html
git commit -m "fix: contar el abono de ordenes canceladas como ganancia en el dashboard"
```

---

### Task 4: Ganancia de canceladas en Informes

**Files:**
- Modify: `sistema.html:2451-2486` (`calcular()` dentro de `uvMetricas()`)

**Interfaces:**
- Consumes: `calcCostoEstimado(orden)` (`sistema-db.js:185`, ya existe, sin cambios).
- Produces: `o._ganancia` ahora refleja correctamente canceladas (usado también por la tabla drilldown de `ordenesDelMes`, `sistema.html:1547` — no necesita cambios ahí, hereda el fix automáticamente).

- [ ] **Step 1: Ajustar `calcular()`**

```js
// ANTES (sistema.html:2451-2486)
      let totalOrdenes=0, totalVentas=0, totalCobrado=0, totalCosto=0;

      for (const o of this._ordenes) {
        // Calcular abonado para TODOS los órdenes (no solo el año seleccionado)
        const ab = (o.pagos || []).reduce((s,p) => s + (p.monto||0), 0);
        o._abonado = ab;
        o._saldo   = Math.max(0, (o.precio_venta_gtq||0) - ab);
        o._ganancia = ((o.precio_venta_gtq||0) / 7.9) - calcCostoEstimado(o);

        let anioOrden, mesOrden;
        if (o.fecha_venta) {
          const p = o.fecha_venta.split('-');
          anioOrden = parseInt(p[0]);
          mesOrden  = parseInt(p[1]) - 1;
        } else {
          const f = new Date(o.created_at);
          anioOrden = f.getFullYear();
          mesOrden  = f.getMonth();
        }
        if (anioOrden !== anio) continue;

        byMes[mesOrden].ordenes++;
        byMes[mesOrden].ventas   += o.precio_venta_gtq || 0;
        byMes[mesOrden].cobrado  += ab;
        byMes[mesOrden].porCobrar += o._saldo;
        totalOrdenes++;
        totalVentas  += o.precio_venta_gtq || 0;
        totalCobrado += ab;
        totalCosto   += calcCostoEstimado(o);
      }

      const maxVentas = Math.max(...byMes.map(m => m.ventas), 1);
      const mesesConDatos = byMes.filter(m => m.ordenes > 0).length;
      this.soloAnual = mesesConDatos <= 1;
      this.meses = byMes.map(m => ({ ...m, pct: Math.round(m.ventas / maxVentas * 100) }));
      this.resumen = { ordenes: totalOrdenes, ventas: totalVentas, cobrado: totalCobrado, margen: (totalVentas / 7.9) - totalCosto };
```

```js
// DESPUÉS
      let totalOrdenes=0, totalVentas=0, totalCobrado=0, totalGanancia=0;

      for (const o of this._ordenes) {
        // Calcular abonado para TODOS los órdenes (no solo el año seleccionado)
        const ab = (o.pagos || []).reduce((s,p) => s + (p.monto||0), 0);
        o._abonado = ab;
        o._saldo   = Math.max(0, (o.precio_venta_gtq||0) - ab);
        o._ganancia = o.estado === 'cancelada'
          ? (ab / 7.9)
          : (((o.precio_venta_gtq||0) / 7.9) - calcCostoEstimado(o));

        let anioOrden, mesOrden;
        if (o.fecha_venta) {
          const p = o.fecha_venta.split('-');
          anioOrden = parseInt(p[0]);
          mesOrden  = parseInt(p[1]) - 1;
        } else {
          const f = new Date(o.created_at);
          anioOrden = f.getFullYear();
          mesOrden  = f.getMonth();
        }
        if (anioOrden !== anio) continue;

        byMes[mesOrden].ordenes++;
        byMes[mesOrden].ventas   += o.precio_venta_gtq || 0;
        byMes[mesOrden].cobrado  += ab;
        byMes[mesOrden].porCobrar += o._saldo;
        totalOrdenes++;
        totalVentas  += o.precio_venta_gtq || 0;
        totalCobrado += ab;
        totalGanancia += o._ganancia;
      }

      const maxVentas = Math.max(...byMes.map(m => m.ventas), 1);
      const mesesConDatos = byMes.filter(m => m.ordenes > 0).length;
      this.soloAnual = mesesConDatos <= 1;
      this.meses = byMes.map(m => ({ ...m, pct: Math.round(m.ventas / maxVentas * 100) }));
      this.resumen = { ordenes: totalOrdenes, ventas: totalVentas, cobrado: totalCobrado, margen: totalGanancia };
```

Nota: `totalVentas` y `totalCobrado` (usados en los stat-cards "Ventas totales" y "Cobrado") siguen sumando el precio de venta y abonado completos de toda orden, cancelada o no — eso no cambia, tal como está hoy. Solo `resumen.margen` (el stat-card "Ganancia neta est.") pasa a derivarse de la suma de `o._ganancia` en vez de `totalVentas − totalCosto`.

- [ ] **Step 2: Verificación manual**

1. En `sistema.html`, ir a "Informes" y anotar "Ganancia neta est." del año actual.
2. Con la misma orden de prueba cancelada creada en la Task 3 (o una nueva, con abono conocido), confirmar que el número de "Ganancia neta est." refleja el abono de esa orden cancelada (subida de aproximadamente `abono / 7.9`), no el precio de venta completo.
3. Expandir el mes correspondiente en la tabla drilldown y confirmar que la fila de esa orden muestra "Ganancia est." = abono convertido a USD, no el precio de venta completo ni Q0/$0.
4. Confirmar que "Ventas totales" y "Cobrado" no cambiaron respecto a antes del fix (siguen incluyendo el precio de venta y abono completos de la orden cancelada, sin filtrar).
5. Borrar la orden de prueba al terminar.

- [ ] **Step 3: Commit**

```bash
git add sistema.html
git commit -m "fix: contar el abono de ordenes canceladas como ganancia en informes"
```

---

### Task 5: Ganancia de canceladas en el detalle de una orden

**Files:**
- Modify: `sistema.html:2525-2528` (`gananciaEstimada` getter en `uvDetalleOrden()`)

**Interfaces:**
- Consumes: `this.abonado` (getter ya existente en `uvDetalleOrden()`, `sistema.html:2519`, devuelve `calcAbonado(this.pagos)` en GTQ).

- [ ] **Step 1: Ajustar el getter `gananciaEstimada`**

```js
// ANTES (sistema.html:2525-2528)
    get gananciaEstimada() {
      if (!this.orden) return 0;
      return ((this.orden.precio_venta_gtq||0) / 7.9) - this.costoEstimado - (this.comisionTarjeta / 7.9);
    },
```

```js
// DESPUÉS
    get gananciaEstimada() {
      if (!this.orden) return 0;
      if (this.orden.estado === 'cancelada') return this.abonado / 7.9;
      return ((this.orden.precio_venta_gtq||0) / 7.9) - this.costoEstimado - (this.comisionTarjeta / 7.9);
    },
```

- [ ] **Step 2: Verificación manual**

1. Crear una orden de prueba con precio de venta y un abono parcial, y entrar a su detalle. Anotar el valor de "Ganancia est." mostrado (`sistema.html:650-651`) — debería ser precio − costo − comisión, como siempre.
2. Cancelarla (botón "Cancelada").
3. Confirmar que "Ganancia est." en esa misma pantalla cambia inmediatamente a `abonado / 7.9` (sin necesidad de recargar la página).
4. Cambiarla de vuelta a "En proceso" o "Pagada" → "Ganancia est." vuelve a la fórmula normal (precio − costo − comisión).
5. Borrar la orden de prueba al terminar.

- [ ] **Step 3: Commit**

```bash
git add sistema.html
git commit -m "fix: contar el abono como ganancia en el detalle de una orden cancelada"
```

---

## Self-Review Notes

- **Cobertura del spec:** los 3 puntos del spec (`docs/superpowers/specs/2026-07-02-aviso-stock-lote-y-eliminar-orden-design.md`) están cubiertos — Task 1 (punto 1), Task 2 (punto 2), Tasks 3-5 (punto 3, los tres lugares de ganancia).
- **Consistencia:** los tres cálculos de ganancia (Tasks 3-5) usan la misma regla (`estado === 'cancelada'` → `abonado / 7.9`) con los nombres de getters/funciones ya existentes en cada componente (`calcAbonado`, `this.abonado`, `ab`), sin inventar una función compartida nueva — cada componente ya tenía su propia forma de calcular el abonado antes de este plan, y este plan no la unifica (fuera de alcance, ver "Lo que NO cambia" del spec).
- **Sin placeholders:** cada paso tiene el código completo a pegar, sin "TODO" ni pasos vagos.
