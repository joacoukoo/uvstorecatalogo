# Spec: Lotes de Pedido a Proveedor

**Fecha:** 2026-07-01
**Contexto:** Sistema de órdenes UV Store GT (`sistema.html` + `sistema-db.js` + Supabase)

---

## Problema

Para figuras que se piden en tanda al proveedor (Hot Toys, 1:12 y similares — no estatuas, que se piden 1 a 1 por venta confirmada), no hay forma de saber cuántas unidades ya se pidieron vs. cuántas ya se vendieron a clientes. Esto causa sobreventa (prometer más unidades de las que se pidieron) o subventa (dejar de vender pensando que no quedan, cuando sí quedan).

## Solución

Una entidad nueva, "lote de pedido", representa una tanda pedida al proveedor con una cantidad fija. Las órdenes de clientes se vinculan opcionalmente a un lote. La cantidad disponible se calcula en vivo: `cantidad del lote − órdenes vinculadas no canceladas`.

El vínculo entre una orden y un lote **nunca es automático por texto** — el nombre del producto es libre y con errores de tipeo, así que cualquier coincidencia de texto es solo un filtro de conveniencia para achicar una lista; la confirmación final de "esta orden es de este lote" siempre la hace la persona con un clic.

Esta funcionalidad es opcional por orden: si nunca se vincula una orden a un lote, esa orden funciona exactamente igual que hoy (caso estatuas, pedido 1 a 1).

---

## Modelo de datos

### Tabla nueva `lotes_pedido`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid, PK | |
| `producto` | text | |
| `marca` | text | |
| `escala` | text | |
| `cantidad` | integer | cantidad total pedida al proveedor |
| `codigo` | text, UNIQUE | ver generación automática abajo |
| `proveedor` | text | dónde se pidió (ebay, gundam, lts...) |
| `fecha_pedido` | date | |
| `notas` | text | |
| `created_at` | timestamptz | default now() |

### Columna nueva en `ordenes`

| Columna | Tipo | Notas |
|---|---|---|
| `lote_id` | uuid, nullable, FK → `lotes_pedido(id)` | null = orden sin lote (comportamiento actual) |

### Cálculo de disponibilidad (no se guarda, se calcula)

```
disponibles = lote.cantidad − count(ordenes WHERE lote_id = lote.id AND estado != 'cancelada')
```

Una orden cancelada libera su cupo automáticamente — no hace falta desvincularla a mano. `entregado` y `estado` de pago no afectan el cupo (una orden vinculada consume cupo hasta que se cancela, sin importar si ya se pagó o entregó).

---

## Generación automática de código

Cuando se crea un lote sin especificar código manualmente, se genera así:
1. Tomar las primeras 2 letras del `producto` (sin tildes/espacios, mayúsculas).
2. Tomar las primeras 2 letras de la `marca` (mismo tratamiento).
3. Concatenar + sufijo numérico de 2 dígitos empezando en `01`.
4. Si el código resultante ya existe en `lotes_pedido`, incrementar el sufijo (`02`, `03`...) hasta encontrar uno libre.

Ejemplo: producto "Jinx", marca "Hot Toys" → `JIHO01`. El campo código queda editable, así que si la figura ya tiene un SKU real del fabricante, se puede escribir ese en su lugar.

---

## Flujo 1: Crear un lote

Desde Órdenes → botón nuevo "Lotes de Pedido" (mismo patrón que el botón existente "Sin pedir") se accede a una vista `lotes` con:
- Listado de lotes: producto, marca, código, cantidad pedida, vendidas, disponibles (fila en rojo si `disponibles <= 0`), proveedor, fecha.
- Botón "+ Nuevo lote" abre formulario: producto, marca, escala, cantidad, proveedor, fecha_pedido, notas, código (prefilled auto-generado, editable).

**Al guardar el lote**, el sistema busca automáticamente órdenes existentes sin lote (`lote_id IS NULL`, `estado != 'cancelada'`) cuyo `producto`/`marca` se parezcan por texto al del lote recién creado, y muestra una pantalla "¿Alguna de estas órdenes es de este lote?" con checkboxes. El usuario tilda las que correspondan y confirma → se actualiza `lote_id` en esas órdenes de una sola vez. Este mismo paso de búsqueda también queda accesible después, desde el detalle del lote (botón "Buscar y vincular órdenes"), por si aparecen más coincidencias más adelante o el usuario se lo salteó al crear el lote.

## Flujo 2: Vender una unidad nueva de un producto en lote

En el formulario de "Nueva/Editar Orden", sección opcional colapsada "Vincular a lote de pedido":
- Al expandirla, un buscador (por producto/marca/código, mismo patrón que el buscador de cliente) muestra lotes existentes con su disponibilidad ("Jinx Hot Toys — JIHO01 — 2 de 5 disponibles").
- Selecciona un lote → autocompleta `marca`, `escala`, `pedido` (proveedor) desde el lote y marca `pedida_proveedor = true`; guarda `lote_id`.
- Si el lote elegido tiene `disponibles <= 0`, se muestra una advertencia ("Ya vendiste las 5 unidades de este lote") pero no bloquea el guardado — puede ser sobreventa intencional a la espera de pedir más.
- Si nunca se toca esta sección, la orden se guarda sin `lote_id`, igual que hoy.

## Flujo 3: Ver el detalle de una orden vinculada

En el detalle de orden, si tiene `lote_id`, se muestra un badge/enlace al lote correspondiente (código + disponibilidad actual).

---

## Cambios en `sistema-db.js`

```js
async function dbGetLotes() { /* lotes + count de órdenes vinculadas no canceladas */ }
async function dbCreateLote(data) { /* genera código si no viene, inserta */ }
async function dbBuscarOrdenesSimilares(producto, marca) { /* órdenes sin lote_id, estado != cancelada */ }
async function dbVincularOrdenesALote(ordenIds, loteId) { /* update masivo de lote_id */ }
async function dbSetOrdenLote(ordenId, loteId) { /* update individual, usado desde el form de orden */ }
```

**Criterio de "se parecen por texto"** (usado tanto en `dbBuscarOrdenesSimilares` como en el buscador de lotes del form de orden): coincidencia parcial case-insensitive (`ILIKE '%...%'`) entre el `producto` del lote/búsqueda y el `producto` de la orden, o entre `marca` y `marca`. Es deliberadamente laxo — el objetivo es achicar la lista para revisión humana, no encontrar la coincidencia exacta.

---

## Archivos a modificar/crear

| Archivo | Cambio |
|---|---|
| Supabase (manual) | `CREATE TABLE lotes_pedido (...)`, `ALTER TABLE ordenes ADD COLUMN lote_id uuid REFERENCES lotes_pedido(id)` |
| `sistema-db.js` | + `dbGetLotes`, `dbCreateLote`, `dbBuscarOrdenesSimilares`, `dbVincularOrdenesALote`, `dbSetOrdenLote` |
| `sistema.html` | + vista `lotes` (listado + form nuevo lote + pantalla de vinculación), + sección "Vincular a lote" en form de orden, + badge de lote en detalle de orden, + botón "Lotes de Pedido" junto a "Sin pedir" |

## Lo que NO cambia

- El flujo de estatuas (pedido 1 a 1) sigue idéntico, sin lotes de por medio.
- El campo `codigo` que ya existe en `ordenes` sigue siendo opcional y sin relación con el código del lote.
- No hay borrado ni archivado de lotes en esta primera versión.
- RLS, autenticación admin y flujo de pagos existentes no se tocan.
