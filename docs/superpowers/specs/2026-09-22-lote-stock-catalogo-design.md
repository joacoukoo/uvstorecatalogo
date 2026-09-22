# Spec: Conectar Lotes de Figuras con Stock del Catálogo

**Fecha:** 2026-09-22
**Contexto:** Sistema de órdenes UV Store GT (`sistema.html` + `sistema-db.js` + Supabase), Admin de catálogo (`admin-app.html` + `functions/api/catalog.js` + GitHub), Catálogo público (`index.html` + `productos.json`). Continuación de [[2026-07-01-lotes-pedido-proveedor-design]] y [[2026-07-02-aviso-stock-lote-y-eliminar-orden-design]].

---

## Problema

Hoy son tres sistemas desconectados:

1. **`admin-app.html`** — sube/edita figuras, escribe directo a `productos.json` en GitHub (vía `/api/catalog`, protegido con sesión de admin por contraseña).
2. **`sistema.html` + Supabase** — sistema de órdenes. Ya existe el concepto de "lote de pedido" (`lotes_pedido`), pero solo para figuras que se piden en tanda (Hot Toys, 1:12), vinculado a órdenes por **texto libre**, sin ninguna relación con el catálogo público.
3. **`index.html`** — la página pública, que lee `productos.json` y muestra "Agotado" según campos que hoy edita el admin a mano (`estado`, `agotado_r`, `agotado_d`, `cantidad`).

Vender la última unidad de algo en el sistema de órdenes no tiene ningún efecto en la página: alguien tiene que acordarse de ir a `admin-app.html` y marcarlo agotado a mano.

## Solución

Cada producto del catálogo con stock (única pieza o tanda) tiene un lote correspondiente en `lotes_pedido`, vinculado por el `id` real del producto (no por texto). La disponibilidad del lote (`cantidad − órdenes vinculadas no canceladas`) pasa a ser la fuente de verdad del stock mostrado en la página. Cuando se vende la última unidad, la página se marca agotada sola; cuando se cancela/elimina esa venta, se revierte sola.

---

## Modelo de datos

### Columnas nuevas en `lotes_pedido`

| Columna | Tipo | Notas |
|---|---|---|
| `catalogo_id` | text, nullable, UNIQUE cuando `catalogo_variante IS NULL` | El `id` del producto en `productos.json` (ej. `"robin-mon4pkg2"`). `null` = lote sin vínculo a la página (comportamiento actual, sigue funcionando igual). |
| `catalogo_variante` | text, nullable | `'regular'` \| `'deluxe'` \| `null`. Solo se usa para los ~6 productos Hot Toys con variante dual (ver más abajo). |

El campo `producto` (texto libre) que ya existe **no se toca** — sigue usándose para el matching de órdenes existente. `catalogo_id` es un vínculo adicional, no un reemplazo.

### Qué controla cada lote en el catálogo

El campo `estado` **no se toca** — hoy guarda la condición de la pieza (`"Sellado"`, `"Usado - Como Nuevo"`, `"Exhibido - Excelente Estado"`, etc., son 15 valores distintos en uso), no solo disponibilidad. Sobreescribirlo a `"Vendido"` perdería esa información sin forma limpia de revertirlo. En su lugar:

- Se agrega un campo nuevo `agotado` (booleano) al catálogo, con el mismo patrón que los ya existentes `agotado_r`/`agotado_d`.
- Si `catalogo_variante IS NULL`: el lote controla `agotado` (`true` cuando `disponibles <= 0`) y `cantidad` (siempre refleja `disponibles`).
- Si `catalogo_variante` es `'regular'` o `'deluxe'`: el lote controla `agotado_r` o `agotado_d` respectivamente. Este caso **no se crea automáticamente** — solo a mano (ver "Variantes Regular/Deluxe").
- `index.html` se actualiza para que el badge "Agotado" también dispare con `p.agotado === true` (hoy solo mira `estado==="vendido"`/`disp==="vendido"`).

---

## Autorización — dos endpoints nuevos, dos mecanismos distintos

`sistema.html` se sirve como archivo estático público (no hay portón de servidor como en `/admin` — el login de Supabase es solo una pantalla del lado del cliente). Por eso no puede usar una clave fija embebida en su JS, ni tampoco la sesión de `ADMIN_SECRET` (que no tiene). `admin-app.html`, en cambio, **sí** está detrás de un portón de servidor (`functions/admin.js` no sirve el HTML hasta validar la contraseña), así que reutilizar su protección actual es seguro.

### `functions/api/lote-sync.js` — dirección admin-app.html → Supabase

- Protegido automáticamente por el middleware existente (`functions/api/_middleware.js`, exige la cookie de sesión `ADMIN_SECRET` — la misma que ya protege todo `/api/*`). No hace falta código de auth nuevo.
- `POST` recibe `{ catalogo_id, producto, marca, escala, cantidad }`.
- Server-side, usando una service key de Supabase nueva (env var `SUPABASE_SERVICE_KEY`, nunca expuesta al cliente): busca un lote con ese `catalogo_id` y `catalogo_variante IS NULL`; si existe, actualiza su `cantidad`; si no, lo crea (código autogenerado igual que hoy).
- Devuelve `{ disponibles, agotado }` recién calculado, para que `admin-app.html` lo use al guardar el producto en `/api/catalog` (así el campo `cantidad` público siempre refleja disponibilidad real, no lo que el admin tipeó).

### `functions/api/stock-sync.js` — dirección sistema.html → catálogo (GitHub)

- Excluido del middleware de `ADMIN_SECRET` (mismo patrón que ya usa `/api/mis-pedidos`).
- Verifica autorización propia: exige header `Authorization: Bearer <token>` con el `access_token` de la sesión de Supabase ya activa en `sistema.html` (se obtiene con `db.auth.getSession()`, que la app ya usa). El endpoint llama a `GET {SUPABASE_URL}/auth/v1/user` con ese token — si Supabase responde con un usuario válido, se autoriza. Si no, `401`.
- `POST` recibe `{ catalogo_id, catalogo_variante, disponibles }`.
- Server-side, con `GITHUB_TOKEN`/`GITHUB_REPO` (ya existen), hace el mismo read-modify-write que ya usa `functions/api/catalog.js` (misma lógica de reintento ante conflicto de `sha`), pero acotado a un solo producto: actualiza `cantidad` = `disponibles`, y `agotado`/`agotado_r`/`agotado_d` según corresponda (nunca toca `estado`).
- No expone ninguna otra operación del catálogo (nada de agregar, borrar, ni editar campos fuera de estos).

---

## Flujo 1: Vincular un lote a un producto del catálogo (buscador)

En el formulario de "Nuevo/Editar lote" en `sistema.html`, se agrega un campo "Producto del catálogo" con un buscador (mismo patrón visual que el buscador de cliente/lote ya existente). Este buscador consulta `GET /api/stock-sync` (mismo endpoint, con método GET también protegido por sesión de Supabase), que devuelve una lista liviana de productos (`id`, `n`, `marca`, `escala`, `disp`, `cantidad`, `estado`, `agotado_r`, `agotado_d` — sin fotos ni contenido largo).

- Al elegir un producto, se guarda `catalogo_id`. Si el producto tiene variantes (tiene `agotado_r`/`agotado_d` presentes en el catálogo), aparece un selector adicional "Variante" (Regular/Deluxe/Ninguna) para fijar `catalogo_variante`.
- Es opcional, igual que el resto del sistema de lotes: un lote sin `catalogo_id` sigue funcionando exactamente igual que hoy (solo trackea proveedor/órdenes, sin tocar la página).

## Flujo 2: Venta que agota el lote (o cancelación que libera cupo)

Cuando se guarda una orden vinculada a un lote, se cancela, o se elimina (los tres puntos donde `disponibles` puede cambiar — ver [[2026-07-01-lotes-pedido-proveedor-design]] y [[2026-07-02-aviso-stock-lote-y-eliminar-orden-design]]):

1. Se recalcula `disponibles` para ese lote (como ya se hace hoy).
2. Si el lote tiene `catalogo_id`, se llama automáticamente a `POST /api/stock-sync` con el nuevo `disponibles`. Sin botón aparte — pasa en el mismo momento que hoy se guarda/cancela/elimina la orden.
3. Si la llamada falla (ej. GitHub caído), se muestra un aviso no bloqueante ("No se pudo sincronizar el stock en la página — revisalo a mano") pero la orden ya quedó guardada en Supabase; no se reintenta solo.

## Flujo 3: Alta continua desde `admin-app.html`

Al guardar un producto (nuevo o editado) en `admin-app.html` con un valor de `cantidad`:

1. Antes de escribir en `/api/catalog`, se llama a `POST /api/lote-sync` con el `catalogo_id` (el `id` del producto) y la `cantidad` tipeada.
2. La respuesta trae `disponibles` (que en un lote recién creado o recién restockeado es igual a la `cantidad`, salvo que ya tuviera órdenes vinculadas de antes).
3. El producto se guarda en `/api/catalog` usando ese `disponibles` como `cantidad` pública (no el número crudo que tipeó el admin), y `agotado`/`agotado_*` según corresponda.
4. Esto **no aplica** a los productos con variante Regular/Deluxe (ver abajo) — para esos, `admin-app.html` sigue funcionando exactamente igual que hoy, sin tocar Supabase.

## Variantes Regular/Deluxe — excluidas del automático

Los ~6 productos Hot Toys con `agotado_r`/`agotado_d` no tienen una cantidad separada por variante en el catálogo hoy (una sola `cantidad` para el producto entero), así que no hay forma automática de saber cuánto asignarle a cada variante. Por eso:

- El alta automática (Flujo 3) **no se dispara** para estos productos — se detecta porque el producto ya tiene `agotado_r` o `agotado_d` definidos, o porque el usuario explícitamente elige una variante al vincular un lote a mano.
- Si se quiere conectar uno de estos productos, se hace a mano desde `sistema.html`: crear un lote, buscar el producto, elegir variante (Regular o Deluxe) y cantidad real de esa variante. A partir de ahí, ese lote específico sí sincroniza automáticamente (Flujo 2).
- `admin-app.html` sigue editando `agotado_r`/`agotado_d` a mano para estos productos, como hoy, salvo que existan lotes vinculados que los controlen.

## Flujo 4: Importación inicial (una sola vez)

Antes de correr la importación masiva, hace falta un paso manual: **los lotes que ya existen hoy** (creados a mano para Hot Toys en tanda, antes de este feature) deben vincularse a su `catalogo_id` uno por uno, editando cada lote existente y usando el buscador del Flujo 1. Esto evita que la importación cree un lote duplicado para un producto que ya tenía uno.

Hecho eso, se corre una importación (botón "Importar figuras del catálogo" en la vista de Lotes de `sistema.html`, protegido por la sesión de Supabase ya existente) que recorre todo `productos.json` vía `GET /api/stock-sync` y crea un lote nuevo para cada producto que cumpla **todas** estas condiciones:

- No tiene ya un lote con ese `catalogo_id` (evita duplicar los recién vinculados a mano).
- `estado` no es `"Vendido"` y `agotado` no es `true` (32 productos hoy tienen `estado="Vendido"` — ya no están a la venta, no hace falta trackearlos).
- `cantidad` es un número entero válido (excluye vacíos y textos como `"Consultar Disponibilidad"` — quedan sin lote hasta que alguien cargue una cantidad real a mano, desde `admin-app.html` o creando el lote directo en `sistema.html`).
- No tiene `agotado_r` ni `agotado_d` definidos (excluye las variantes duales, ver arriba).

Cada lote creado usa `cantidad` = el valor actual del catálogo, `catalogo_variante = null`, y el `producto`/`marca`/`escala` copiados del catálogo (para que el lote se vea igual de completo que uno creado a mano).

---

## Archivos a modificar/crear

| Archivo | Cambio |
|---|---|
| Supabase (manual) | `ALTER TABLE lotes_pedido ADD COLUMN catalogo_id text, ADD COLUMN catalogo_variante text`; índice único parcial en `(catalogo_id)` donde `catalogo_variante IS NULL` |
| Cloudflare (manual) | Nueva env var `SUPABASE_SERVICE_KEY` (service role key de Supabase, secreta) |
| `functions/api/lote-sync.js` (nuevo) | Crea/actualiza lote auto-gestionado desde `admin-app.html`. Protegido por el middleware existente. |
| `functions/api/stock-sync.js` (nuevo) | GET (lista liviana del catálogo) y POST (aplica cantidad/agotado a un producto). Verifica sesión de Supabase, excluido del middleware de `ADMIN_SECRET`. |
| `functions/api/_middleware.js` | Excluir `/api/stock-sync` del chequeo de `ADMIN_SECRET` (mismo patrón que `/api/mis-pedidos`) |
| `sistema-db.js` | + `dbGetLoteCatalogo`, `dbVincularLoteCatalogo(loteId, catalogoId, variante)`, `dbSyncStockCatalogo(lote)` (llama a `/api/stock-sync`), `dbImportarLotesCatalogo()` |
| `sistema.html` | + campo "Producto del catálogo" y selector de variante en form de lote; + botón "Importar figuras del catálogo" en vista de Lotes; llamada a `dbSyncStockCatalogo` tras guardar/cancelar/eliminar una orden vinculada a lote |
| `admin-app.html` | Al guardar producto (alta o edición) con `cantidad`, llamar a `/api/lote-sync` antes de `/api/catalog`, salvo que el producto tenga `agotado_r`/`agotado_d` definidos; + checkbox "Agotado" (campo `agotado`) en los formularios de alta/edición, igual patrón que `agotado_r`/`agotado_d` |
| `index.html` | El badge "Agotado" (línea ~1327) también dispara con `p.agotado === true`, además de `estado`/`disp` como hoy |

## Lo que NO cambia

- El flujo de estatuas sigue permitiendo vender sin vincular a ningún lote — vincular sigue siendo 100% opcional, igual que hoy.
- El vínculo orden↔lote sigue siendo manual por clic — esto no introduce ningún matching automático nuevo ahí.
- `ADMIN_SECRET`/`ADMIN_PASSWORD` no cambian ni se reutilizan para el nuevo endpoint de `sistema.html`.
- No se toca el criterio de "se parecen por texto" para vincular órdenes a lotes.
- Los ~6 productos con variante Regular/Deluxe no ganan sincronización automática en esta versión — solo manual, si alguien decide conectarlos.
- Productos con `cantidad` vacía o "Consultar Disponibilidad" quedan sin lote tras la importación — no se les inventa un número.
