# Importar documentos de Sideshow a los lotes — Diseño

Fecha: 2026-09-23

## Objetivo

Hoy las cantidades de los lotes se cargan y corrigen a mano. Sideshow manda dos tipos de
documento con el detalle por figura. Subiendo ese documento en sistema.html, el sistema tiene
que **revisar las cantidades de los lotes contra el documento y crear los lotes que falten**,
siempre con una pantalla de revisión donde el admin confirma antes de guardar.

## Alcance

Dentro:
- Leer los dos formatos de Sideshow (ver abajo), subidos como archivo o pegados como texto.
- Comparar con los lotes por **código** (el número de ítem de Sideshow es el `codigo` del lote).
- Proponer por figura: ajustar la cantidad del lote, sumar unidades recibidas o crear el lote,
  con la decisión en manos del admin.
- Registrar los documentos importados para no aplicar dos veces el mismo.

Fuera (decisión explícita del usuario):
- **Precios, envío, aranceles ("Tariff Offsets"/"Tariff Impact Fee"), impuestos y pagos: no se
  leen ni se guardan.**
- No se modifican órdenes ni clientes (tampoco "pedida al proveedor").
- Otros proveedores. El lector es de reglas fijas y solo para Sideshow. Si hace falta otro
  formato, se evalúa aparte, eventualmente con IA.

## Documentos soportados

### A. Factura con tracking (correo)

Asunto `Sideshow Tracking & Invoice #<número> (Wholesale)`. Llega como correo; el admin sube el
`.eml` (Gmail → "Descargar mensaje") o pega el texto.

- Tipo: `factura`. Número: `Invoice ID`. Fecha: `Invoice Date` (MM/DD/YYYY).
- Por figura, un bloque:
  ```
  *Joel Miller Sixth Scale Figure - The Last of Us (Hot Toys)*
  Item: 100519
  Order: 00332512
  $185.25 / Qty: 2
  ```
  Se toma: nombre (entre `*`, puede ocupar 2 líneas), `Item` (5 a 7 dígitos, ej. `9146252`) y `Qty`.
  El precio se ignora.
- La sección `Tariff Offsets` repite los códigos sin `Qty` y se ignora.
- Significado: **unidades despachadas** en este envío.

### B. Orden de venta (PDF)

Encabezado `Sales Order`, con `Order Number` y `Change Order`. Es texto (no escaneado).

- Tipo: `orden_venta`. Número: `<Order Number>-<Change Order>` (ej. `00328836-0`), porque una
  orden puede reemitirse con cambios. Fecha: `Order Date` (M/D/YYYY).
- Se lee con pdf.js. Los fragmentos de texto se agrupan en filas por su coordenada Y
  (tolerancia ±2) y se ordenan por X. Una fila de ítem cumple
  `^(\d{5,7}) \d{3} (\d+) (\d+) (\d+) PC\b` → código, pedidas (`Ordered`), enviadas (`Shipped`) y
  pendientes (`BackOrd`). El nombre es la fila siguiente. La fila `MISC` (Tariff Impact Fee) se ignora.
- Significado: **unidades pedidas** a Sideshow.

La detección es automática: `Invoice ID:` → factura; `Sales Order` + `Order Number:` → orden de
venta. Si no se reconoce ningún ítem, se muestra un error claro y no se hace nada.

## Datos nuevos (migración en Supabase)

1. `lotes_pedido.recibidas integer not null default 0`: unidades que llegaron según las facturas
   importadas.
2. Tabla `documentos_proveedor`:
   - `id uuid pk default gen_random_uuid()`
   - `tipo text not null` (`factura` | `orden_venta`)
   - `numero text not null`
   - `fecha date`
   - `resumen jsonb`: lista de `{codigo, nombre, cantidad(es), accion}` aplicada, para auditoría.
   - `created_at timestamptz default now()`
   - `unique (tipo, numero)`
   - RLS igual que el resto: política `ALL` para `authenticated`.

## Pantalla

En **Lotes**, botón **"Importar documento Sideshow"** → modal:

1. **Carga:** selector de archivo (`.eml`, `.pdf`, `.txt`) y un área para pegar texto. pdf.js se
   carga desde cdnjs recién cuando se elige un PDF.
2. **Revisión:** encabezado con tipo, número y fecha del documento. Si ese documento ya fue
   importado, se muestra un aviso con la fecha de importación (ver Duplicados). Después, una fila
   por figura con el código, el nombre, lo que dice el documento, lo que dice el lote y un selector
   de acción con un valor por defecto.
3. **Aplicar:** ejecuta las acciones y muestra un resumen ("3 lotes ajustados, 2 creados,
   17 sin cambios").

La lista de Lotes suma la columna **"Recibidas"** (ej. `2/3`, en rojo si falta).

## Acciones por figura

Notación: `C` = cantidad del lote, `R` = recibidas del lote, `V` = unidades vendidas (órdenes
activas), `q` = cantidad del documento.

### Factura (q = despachadas)

`R' = R + q`

| Caso | Opciones (★ = por defecto) | Efecto |
|---|---|---|
| Sin lote | ★ Crear lote · Ignorar | Crear: `codigo`, `producto` = nombre, `marca` = último paréntesis del nombre (ej. "Hot Toys"), `cantidad = q`, `recibidas = q`, `proveedor = 'Sideshow'` |
| `R' = C` | ★ Sumar recibidas | `recibidas = R'` |
| `R' < C` | ★ Faltan, las completo por otro lado · Bajar el lote a `R'` | Ambas: `recibidas = R'`. Bajar además: `cantidad = R'`. Si `R' < V`, aviso: "te faltarían N figuras para clientes" |
| `R' > C` | ★ Subir el lote a `R'` · Dejar la cantidad igual | Ambas: `recibidas = R'`. Subir además: `cantidad = R'` |

### Orden de venta (q = pedidas)

`recibidas` nunca se toca desde una orden de venta.

| Caso | Opciones (★ = por defecto) | Efecto |
|---|---|---|
| Sin lote | ★ Crear lote · Ignorar | Crear: como en factura pero `recibidas = 0`; `marca` vacía (los nombres del PDF son abreviados) |
| `q = C` | Sin cambios | nada |
| `q ≠ C` | ★ Dejar igual · Ajustar el lote a `q` | Ajustar: `cantidad = q`. Si `q < V`, el mismo aviso |

## Aplicación y sincronización con la página

- Los cambios se guardan lote por lote con el cliente de Supabase, **sin** el sync individual
  (`skipSync`).
- Al terminar, los lotes vinculados al catálogo cuya cantidad cambió o que se crearon con
  vínculo se sincronizan **en un solo commit**: `/api/stock-sync` acepta además
  `{ items: [{catalogo_id, catalogo_variante, disponibles}] }` y aplica todos con un único
  `mutateCatalog`. Se evita un commit y un deploy por figura. La forma actual (un solo ítem) se
  mantiene.
- Los lotes creados por la importación no se vinculan solos al catálogo. Se vinculan desde
  Lotes → Editar, como siempre.
- Al final se inserta el registro en `documentos_proveedor` con el resumen.

## Duplicados

- **Factura ya importada:** se bloquea la aplicación, porque sumaría las recibidas dos veces. Se
  muestra el aviso "Esta factura ya se importó el dd/mm/aaaa".
- **Orden de venta ya importada:** aviso, pero se permite volver a revisarla y aplicarla (sus
  acciones fijan valores y no suman). Al aplicar se actualiza el registro existente.

## Errores

- Archivo que no es de Sideshow o sin ítems: "No encontré figuras de Sideshow en este documento".
- PDF escaneado (sin texto): "Este PDF es una imagen; no lo puedo leer. Pega el texto o sube el
  correo".
- Falla al guardar un lote: se detiene, se informa qué se aplicó y qué no, y no se registra el
  documento. Así se puede reintentar, y las acciones ya aplicadas quedan en `R = C` o sin
  diferencia.

## Organización del código

- `sideshow-doc.js` (nuevo, módulo ES, sin dependencias): funciones puras
  - `extraerTextoEml(raw)`: parte `text/plain`, decodifica quoted-printable o base64 (UTF-8).
  - `leerFactura(texto)` → `{tipo, numero, fecha, items:[{codigo, nombre, cantidad}]}`
  - `leerOrdenVenta(filas)` → `{tipo, numero, fecha, items:[{codigo, nombre, pedidas, enviadas, pendientes}]}`,
    donde `filas` es el texto por fila ya agrupado desde pdf.js.
  - `agruparFilasPdf(itemsPdfJs)`: agrupa por Y y ordena por X.
  - `detectarDocumento(texto | filas)`.
  - `proponerAcciones(documento, lotes)` → filas de revisión con opciones y valor por defecto.
  - `efectoDeAccion(fila, accion)` → `{crear?, update?: {cantidad?, recibidas?}, aviso?}`.
- `sistema.html`: modal, carga de pdf.js y aplicación de los efectos.
- `sistema-db.js`: `dbGetDocumentoProveedor(tipo, numero)`, `dbGuardarDocumentoProveedor(...)`,
  `dbSyncStockCatalogoLote(items)`.
- `functions/api/stock-sync.js`: soporte de `items[]`.

## Pruebas

- **Vitest** para `sideshow-doc.js` con fixtures **anonimizados** en `tests/fixtures/` (el repo
  es público: sin direcciones, nombres de personas, teléfonos ni tarjetas; solo los bloques de
  ítems y los encabezados con número y fecha):
  - Factura: 21 ítems, incluidos los códigos de 7 dígitos (`9146252`) y nombres en 2 líneas; la
    sección Tariff no genera ítems; se leen número y fecha.
  - `.eml` quoted-printable → mismo resultado que el texto pegado.
  - Orden de venta: filas de pdf.js (extraídas una vez del PDF de ejemplo y guardadas como JSON)
    → 12 ítems, `MISC` excluido, número `00328836-0`.
  - `proponerAcciones` y `efectoDeAccion`: cada caso de las dos tablas, incluido el aviso por
    ventas.
- **stock-sync** con `items[]`: un solo PUT para varios productos, y ninguno si nada cambia.
- **Chrome** (puppeteer, datos simulados): subir el `.eml` y el PDF reales, revisar y aplicar;
  verificar que el duplicado se bloquea.
