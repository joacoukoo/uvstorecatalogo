# Scrapeo en lote + lista de precios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desde el admin web, pegar el link de una página de FNC / Nonasea / Statuecorp (o cualquier Shopify), elegir figuras, traerlas limpias y clasificadas a "Pendientes de precio", ponerles precio en una lista y publicarlas todas juntas.

**Architecture:** Lógica pura en módulos testeables con vitest (`functions/_lib/listas.js`, `functions/_lib/limpieza.js`, `lote-import.js` en la raíz, cargado por el admin como ES module igual que `sistema.html` carga `sideshow-doc.js`). Endpoints nuevos en Cloudflare Pages Functions (`/api/scrape-lista`, `/api/pendientes`) y una acción nueva `add_many` en `/api/catalog`. El navegador recorre las figuras de a 2 llamando a `/api/scrape` (límite de subrequests). Pendientes en Supabase (`figuras_pendientes`).

**Tech Stack:** Vanilla JS (admin sin build), Cloudflare Pages Functions (ESM), Supabase REST, GitHub Contents API (`functions/_lib/githubCatalog.js`), Anthropic Messages API (modelo ya usado en `scrape.js`), vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-scrape-en-lote-design.md`

## Global Constraints

- Disponibilidad de toda figura traída: `disp: "Pre-Orden"`. Nunca "Entrega Inmediata" ni "Solo Bajo Pedido" automáticamente.
- Categoría nunca "Entrega Inmediata" automáticamente. Valores válidos: `"Hot Toys 1:6"`, `"Estatuas Premium"`, `"Otras Figuras"`, `"Adultos"`.
- Título y descripción nunca contienen: `Fanatic Anime Store`, `FNC`, `Nonasea`, `Hexapus`, `Statuecorp`/`StatueCorp`, `PRE-ORDER`, `【`, `】`, `Shipping Included`, `Licensed`, `WF20xx`, `In Stock`, emails, URLs, "facebook".
- Reserva = `Math.round(precio * 0.2)` (`RESERVA_FACTOR` del admin).
- Opciones que **no** son variantes (ignorar, case-insensitive): nombre de opción que contenga `payment`, `pago`, `stock`, `email`, `deposit`; valores que contengan `deposit`, `full payment`, `payment plan`.
- Franquicias válidas = `VALID_FRANQUICIAS` de `functions/api/scrape.js`.
- `index.html` es generado: cambios de web solo en `index_template.html`. Nunca editar `productos.json` fuera de `/api/catalog`.
- Todo endpoint nuevo queda detrás de `functions/api/_middleware.js` (no agregarlo a `RUTAS_SIN_ADMIN_SECRET`).
- Solo herramientas online: no tocar `uv_admin.py`.
- Cada commit se pushea a `origin/main` (`git fetch origin main` antes del push).

## Review Focus

1. Página de lista con 0 figuras nuevas (todas ya en catálogo) → la grilla lo dice y el botón "Traer" queda deshabilitado. Test en Task 4 (`marcarDuplicados` con todo duplicado).
2. La IA devuelve un nombre que aún contiene basura de tienda → `limpiarNombre` se aplica **después** de la IA también y el resultado no contiene ningún término prohibido. Test en Task 2.
3. Figura con precio base vacío pero variante con precio → la primera variante con precio pasa a base. Test en Task 4 (`armarProducto`).
4. Publicar dos veces seguidas (doble clic) o publicar una figura que otro admin publicó mientras tanto → `add_many` ignora ids ya existentes en el catálogo. Test en Task 5.
5. Una figura falla al scrapear (timeout del sitio) → queda en la grilla con error y botón "Reintentar"; las demás siguen. Cubierto en Task 7 (verificación manual) con la cola de `procesarCola` testeada en Task 4.

---

### Task 1: Leer páginas de lista (`listas.js` + `/api/scrape-lista`)

**Files:**
- Create: `functions/_lib/listas.js`
- Create: `functions/api/scrape-lista.js`
- Create: `tests/fixtures/fnc-lista.html` (recorte real: 3 `<article class="card">` + links de paginación, de `https://www.fanaticanimestore.com/shop-all/pre-order/?sort=newest`)
- Create: `tests/fixtures/nonasea-lista.json` (2 ítems reales de `https://www.nonasea.com/api/customer/index/class_product_list?class_id=32&ordering=-id&page=1&page_size=2`)
- Create: `tests/fixtures/shopify-lista.json` (2 productos de `https://statuecorp.com/collections/all/products.json?limit=2`)
- Test: `tests/listas.test.js`

**Interfaces:**
- Produces:
  - `detectarLista(url: string) -> {tipo: 'bigcommerce'|'nonasea'|'shopify', ...} | null` — `fanaticanimestore.com` → bigcommerce; `nonasea.com/mall/<CODIGO>` → `{tipo:'nonasea', codigo:'NEWPRODUCTS'}`; URL con `/collections/<x>` → `{tipo:'shopify', coleccion:'<x>', origin}`; otro → `null`.
  - Ítem de lista: `{origen: string, clave: string, nombre: string, foto: string}`. `clave` = id estable del producto en la tienda: `fnc:<slug>`, `nonasea:<id>`, `shopify:<host>:<handle>`.
  - `leerListaBigCommerce(html, url) -> {items: Item[], siguiente: string|null}` — `siguiente` = URL de `&page=N+1` si existe en el HTML (decodificar `&amp;`).
  - `leerListaNonasea(json) -> {items, total}`; `origen` = `https://www.nonasea.com/api/customer/shop/product/<id>` (ficha JSON, usada por `/api/scrape`).
  - `leerListaShopify(json, origin) -> {items}`; `origen` = `<origin>/products/<handle>`.
  - `POST /api/scrape-lista` body `{url, pagina?: number}` → `200 {items, siguiente}` (siguiente = número de página o null) | `400 {error:'Este sitio no está soportado para lote; usá el link individual'}`. Nonasea: resuelve `codigo`→`class_id` con `GET /api/customer/index/classification_list` comparando `ename` sin espacios en mayúscula (`"NEW PRODUCTS"`→`NEWPRODUCTS`), `page_size=50`. Shopify: `/collections/<x>/products.json?limit=50&page=N`. Fetch directo; si responde ≥400 o falla, reintentar por `PROXY_URL` como hace `scrape.js` (exportar `fetchPage` desde `scrape.js` o moverlo a `functions/_lib/fetchPage.js`).

- [ ] **Step 1: Bajar los 3 fixtures reales** con `curl -A "Mozilla/5.0"` y recortarlos (FNC: dejar 3 cards y la paginación).
- [ ] **Step 2: Tests que fallan** en `tests/listas.test.js`:
  - `detectarLista` con las 3 URLs del spec + `https://www.sideshow.com/collectibles` → `null`.
  - `leerListaBigCommerce(fixture)` → 3 ítems; el primero `nombre` empieza con `【PRE-ORDER】QuesQ Studio`, `clave === 'fnc:pre-order-quesq-studio-1-7-priest-space-sibuna-licensed'`, `foto` contiene `cdn11.bigcommerce.com`; `siguiente` termina en `page=2`.
  - `leerListaNonasea(fixture)` → `clave === 'nonasea:32755'`, `foto` contiene `hexapus`.
  - `leerListaShopify(fixture, 'https://statuecorp.com')` → `origen === 'https://statuecorp.com/products/02-mega-garchomp'`.
  - `onRequestPost` con `fetch` mockeado (patrón de `tests/loteSync.test.js`) para un sitio no soportado → 400 con el mensaje exacto.
- [ ] **Step 3: Correr** `npx vitest run tests/listas.test.js` → FAIL (módulo no existe).
- [ ] **Step 4: Implementar** `listas.js` y `scrape-lista.js`.
- [ ] **Step 5: Correr** `npx vitest run` → todo PASS.
- [ ] **Step 6: Commit + push** `feat: leer páginas de lista de FNC, Nonasea y Shopify`.

### Task 2: Limpieza de nombres, opciones y respuesta de la IA (todo el scrape)

**Files:**
- Create: `functions/_lib/limpieza.js`
- Modify: `functions/api/scrape.js` (`callClaudeForDesc`, `onRequestPost`)
- Modify: `functions/_lib/scrapers.js` (`scrapeBigCommerce`, `scrapeShopify` y el fast-path Shopify de `scrape.js`: devolver `opciones`)
- Test: `tests/limpieza.test.js`

**Interfaces:**
- Produces:
  - `limpiarNombre(s: string) -> string` — quita prefijos/sufijos de la lista de Global Constraints, paréntesis/corchetes que solo contienen esos términos, colapsa espacios y quita guiones sueltos al inicio/final. No intenta sacar marca ni licenciante ("JIMEI PALACE X Toei Animation"): eso lo hace la IA.
  - `tieneBasura(s: string) -> boolean` — true si contiene algún término prohibido.
  - `opcionesReales(opciones: {nombre, valores: string[]}[]) -> {nombre, valores}[]` — filtra según Global Constraints.
  - Resultado de `/api/scrape` gana campos: `nombre_limpio`, `categoria`, `entrega`, `origen` (= url pedida), `opciones` (ya filtradas), `variantes_ia: {label, escala?}[]`. `disp` siempre `'Pre-Orden'`; el campo `estado` existente deja de devolver `'Entrega Inmediata'`.
  - `/api/scrape` acepta URL de ficha Nonasea (`/api/customer/shop/product/<id>`): título, `content`/`description`, `img`, y `goods_list[].name` + `img` como opciones/variantes.
- Prompt de `callClaudeForDesc`: además de lo actual, pedir `"nombre"` (reglas de título del spec, con el ejemplo Doflamingo), `"categoria"` (una de las 4 válidas, con las reglas del spec), `"entrega"` (texto corto o ""), `"variantes"` (labels limpios en español a partir de `opciones`). La descripción no menciona tiendas/envíos/pagos. Post-proceso: `nombre = limpiarNombre(parsed.nombre || name)`; si `tieneBasura(desc)` se quitan las oraciones que la contienen; `categoria` fuera de las válidas → `'Otras Figuras'` (o `'Hot Toys 1:6'` si marca es Hot Toys).

- [ ] **Step 1: Tests que fallan** en `tests/limpieza.test.js`:
  - `limpiarNombre('(WF2026 Shipping Included)JIMEI PALACE X Toei Animation - One Piece - Donquixote Doflamingo 1/6  Statue -（Licensed）')` no contiene `Shipping`, `WF2026`, `Licensed`, `（`.
  - `limpiarNombre('【PRE-ORDER】Joy Station FF7 RE Vincent  Veluntine')` === `'Joy Station FF7 RE Vincent Veluntine'`.
  - `tieneBasura('Envío directo desde Nonasea')` === true; `tieneBasura('Figura de Goku 1/6')` === false.
  - `opcionesReales([{nombre:'figure scale',valores:['1:6','1:4']},{nombre:'Payment Choice',valores:['Deposit Only(...)','Full payment(...)']},{nombre:'Email Address',valores:[]}])` → solo `figure scale`.
  - Con `fetch` mockeado (Anthropic devuelve `{"nombre":"FNC Doflamingo 1/6 Statue","desc":"...","categoria":"Entrega Inmediata",...}`): el resultado de `onRequestPost` tiene `nombre_limpio` sin `FNC`, `categoria !== 'Entrega Inmediata'`, `disp === 'Pre-Orden'`.
- [ ] **Step 2: Correr** `npx vitest run tests/limpieza.test.js` → FAIL.
- [ ] **Step 3: Implementar** `limpieza.js`, opciones en scrapers, soporte ficha Nonasea y prompt/post-proceso en `scrape.js`.
- [ ] **Step 4: Correr** `npx vitest run` → todo PASS.
- [ ] **Step 5: Verificar en vivo tras deploy** (después del push): en el admin, scrape individual de una figura de Sideshow y una de FNC; el formulario se llena como antes, con nombre limpio y "Pre-Orden".
- [ ] **Step 6: Commit + push** `feat: nombres limpios, variantes y categoría desde la IA en el scrape`.

### Task 3: Pendientes en Supabase (`/api/pendientes`)

**Files:**
- Create: `docs/sql/figuras_pendientes.sql`
- Create: `functions/api/pendientes.js`
- Test: `tests/pendientes.test.js`

**Interfaces:**
- Tabla `figuras_pendientes`: `id uuid pk default gen_random_uuid()`, `clave text unique not null`, `origen text not null`, `datos jsonb not null` (resultado de `/api/scrape`), `creado_en timestamptz default now()`. RLS activado sin políticas (solo service key).
- `GET /api/pendientes` → `200 [{id, clave, origen, datos, creado_en}]` orden `creado_en.asc`.
- `POST /api/pendientes` body `{clave, origen, datos}` → `201 {id}`; clave repetida → `409 {error:'Ya está en pendientes'}` (usar `Prefer: return=representation`; Supabase responde 409 en unique).
- `DELETE /api/pendientes` body `{ids: string[]}` → `200 {ok:true}`.
- Usa `env.SUPABASE_SERVICE_KEY` y `SUPABASE_URL` igual que `functions/api/lote-sync.js` (extraer ambos a `functions/_lib/supabase.js` si se repiten).

- [ ] **Step 1: Escribir el SQL.**
- [ ] **Step 2: Tests que fallan** (fetch mockeado como en `tests/loteSync.test.js`): GET devuelve la lista; POST 201; POST con Supabase 409 → 409 con el mensaje; DELETE arma `id=in.(a,b)`.
- [ ] **Step 3: Correr** `npx vitest run tests/pendientes.test.js` → FAIL.
- [ ] **Step 4: Implementar** `pendientes.js`.
- [ ] **Step 5: Correr** `npx vitest run` → PASS.
- [ ] **Step 6: Crear la tabla**: pedir al dueño autorización para la conexión Supabase (plugin `supabase`, proyecto `rpaiizqttenkfbiqulng`); si no, darle el SQL para pegar en el editor SQL. No pushear este endpoint hasta que la tabla exista.
- [ ] **Step 7: Commit + push** `feat: pendientes de precio en Supabase`.

### Task 4: Lógica del admin (`lote-import.js`)

**Files:**
- Create: `lote-import.js` (raíz, ES module sin dependencias)
- Test: `tests/loteImport.test.js`

**Interfaces:**
- Consumes: Ítem de lista (Task 1), resultado de `/api/scrape` (Task 2), fila de pendientes (Task 3).
- Produces:
  - `clavesDeFotos(urls: string[]) -> string[]` — `fnc-img:<id>` de `cdn11.bigcommerce.com/s-5s1ah0hhi7/products/<id>/`; `shopify-img:<nombre de archivo sin _WxH ni query>` de `cdn.shopify.com/.../files/`; `nonasea-img:<archivo>` de `hexapus...aliyuncs.com/upload-assets/`.
  - `marcarDuplicados(items, catalogo, pendientes) -> items con estado: 'tenes'|'quizas'|'nueva'` — `'tenes'` si `item.clave` coincide con `origen`→clave de alguna figura/pendiente o si `clavesDeFotos([item.foto])` interseca con las de alguna figura; `'quizas'` si `similitudNombre(limpiarNombre(item.nombre), p.n) >= 0.8`; si no `'nueva'`. Seleccionadas por defecto: solo `'nueva'`.
  - `similitudNombre(a, b) -> number` (0..1) — Jaccard de tokens normalizados (minúsculas, sin acentos, sin escala `1/6`, sin palabras de `limpiarNombre`); importar `limpiarNombre` de `functions/_lib/limpieza.js`.
  - `procesarCola(tareas: (() => Promise)[], paralelo = 2, onAvance(hechas, total, error?))` → `Promise<{ok:number, fallidas:number[]}>` — nunca rechaza por una tarea.
  - `armarProducto(datos, precios: {base?: string, variantes: string[]}, extra: {nombre, categoria, franquicia, marca}) -> {category, product} | null` — `null` si no hay ningún precio. Mapeo: variante con label `/deluxe|exclusive/i` y exactamente 2 opciones → `precio_d`/`reserva_d`/`fotos_d`; resto → `variantes: [{label, precio, reserva, escala?, fotos?}]` y `label_base` = label de la base. Precio base vacío → primera variante con precio pasa a base. `product` incluye `id` (mismo `makeId` que el admin: pasar como parámetro `makeId`), `n`, `i`, `fotos`, `content`, `franquicia`, `marca`, `escala`, `disp:'Pre-Orden'`, `estado:'Nuevo'`, `precio`, `reserva`, `entrega`, `origen`, `added_at` (YYYY-MM-DD), flags `destacado/oferta/agotado/agotado_r/agotado_d` en false.

- [ ] **Step 1: Tests que fallan** en `tests/loteImport.test.js`:
  - `clavesDeFotos(['https://cdn11.bigcommerce.com/s-5s1ah0hhi7/products/3266/images/1/x.jpg'])` → `['fnc-img:3266']`.
  - `marcarDuplicados`: ítem cuya foto es del producto 3266 vs catálogo con esa foto → `'tenes'`; `'【PRE-ORDER】Joy Station FF7 RE Vincent Valentine'` vs catálogo `{n:'Vincent Valentine', marca:'Joy Station'}` → `'quizas'`; todos duplicados → ninguno seleccionado.
  - `armarProducto` con precio base `'1500'` → `reserva === '300'`, `disp === 'Pre-Orden'`.
  - `armarProducto` con opciones `['1:6','1:4']`, precios `{base:'', variantes:['2200']}` → `precio === '2200'`, sin `variantes`.
  - `armarProducto` con opciones `['Regular','Deluxe']`, precios `{base:'1800', variantes:['2100']}` → `precio_d === '2100'`, `reserva_d === '420'`, sin `variantes`.
  - `armarProducto` sin ningún precio → `null`.
  - `procesarCola` con una tarea que rechaza → `{ok: n-1, fallidas:[índice]}`.
- [ ] **Step 2: Correr** `npx vitest run tests/loteImport.test.js` → FAIL.
- [ ] **Step 3: Implementar** `lote-import.js`.
- [ ] **Step 4: Correr** `npx vitest run` → PASS.
- [ ] **Step 5: Commit + push** `feat: lógica de duplicados, cola y armado de productos para el lote`.

### Task 5: Publicar todas (`add_many`)

**Files:**
- Modify: `functions/api/catalog.js` (`onRequestPut`)
- Test: `tests/catalogAddMany.test.js`

**Interfaces:**
- `PUT /api/catalog` body `{action:'add_many', items:[{category, product}]}` → `200 {ok:true, agregadas:n, omitidas:[ids]}`. Un solo `mutateCatalog` con mensaje `'Add batch — UV Store GT Admin'`; omite productos cuyo `id` ya exista en cualquier categoría; categoría inexistente → 400.

- [ ] **Step 1: Tests que fallan** (mock GitHub como `tests/githubCatalog.test.js`): agrega 2 en un solo PUT a `contents/productos.json`; un id repetido queda en `omitidas`; `items` vacío → 400.
- [ ] **Step 2: Correr** → FAIL. **Step 3: Implementar.** **Step 4: Correr** `npx vitest run` → PASS.
- [ ] **Step 5: Commit + push** `feat: publicar varias figuras en un solo cambio de catálogo`.

### Task 6: Botón de variante base con su nombre (web)

**Files:**
- Modify: `index_template.html` (bloque `btnBase` dentro de la ficha, junto a `// Botón base (el producto principal) — siempre dice "Regular"`)

- [ ] **Step 1:** El texto del botón base usa `p.label_base` si existe, si no `"Regular"`; el sufijo `" — Agotada"` se mantiene. Actualizar el comentario.
- [ ] **Step 2: Verificar** generando `python inject_data.py --template index_template.html --data productos.json --output %TEMP%/prev.html` sin errores y `npx vitest run` → PASS. No commitear `index.html` (lo regenera el workflow).
- [ ] **Step 3: Commit + push** `feat: el botón de la variante base muestra su nombre`.

### Task 7: Pestaña "Lote" y "Pendientes" en el admin

**Files:**
- Modify: `admin-app.html` (nueva pestaña junto a `nav-add`/`nav-edit`/`nav-config`, `showTab`, CSS existente)

**Interfaces:**
- Consumes: `/api/scrape-lista` (T1), `/api/scrape` (T2), `/api/pendientes` (T3), `lote-import.js` (T4, cargar con `<script type="module">import * as LoteImport from './lote-import.js?v=20261020'; window.LoteImport = LoteImport;</script>`), `add_many` (T5), `resolverMarca`, `cargarMarcas`, `fetchFreshCatalog`, `makeId`, `RESERVA_FACTOR` (existentes en el admin).

Comportamiento (copy en español, estilo del admin, compacto y usable en celular):
- **Lote**: input de link + "Ver figuras" → grilla (foto 80px, nombre original). Estados: `tenes` gris "Ya la tenés" no clickeable; `quizas` borde ámbar "¿Ya la tenés?" desmarcada; `nueva` marcada. "Marcar todas"/"Desmarcar todas". "Cargar más" si `siguiente`. Botón "Traer N figuras" (deshabilitado con N=0; con 0 nuevas mostrar "No hay figuras nuevas en esta página"). Progreso "7 de 12"; cada figura: `/api/scrape` con `origen` → `POST /api/pendientes`. Fallidas con "Reintentar".
- **Pendientes de precio**: una fila por pendiente: foto, nombre editable (`nombre_limpio`), select categoría (4 válidas), select franquicia (las del admin), marca con sugerencia de `resolverMarca` como chip "¿Hot Toys?" que la aplica con un toque, campo "Precio Q" con reserva al lado (`Math.round(p*RESERVA_FACTOR)`), sub-filas por variante con su precio. "Quitar" (DELETE). "Publicar todas (N con precio)" → `armarProducto` para cada fila con precio → `add_many` → DELETE de las publicadas → "Publicadas N — el sitio se actualiza en ~30 seg".

- [ ] **Step 1: Implementar** la pestaña.
- [ ] **Step 2: Verificar en vivo tras push**: página de pre-órdenes de FNC → la grilla marca como "Ya la tenés" alguna de las 47 figuras de FNC existentes; traer 2 figuras nuevas → aparecen en Pendientes con nombre limpio y "Pre-Orden"; repetir el link → esas 2 salen "Ya la tenés". Repetir con Nonasea (New Products) y una colección de Statuecorp. Ponerle precio a 1 y "Publicar todas" con el dueño presente (no hay ambiente de prueba); confirmar en uvstore.shop; borrar si fue de prueba.
- [ ] **Step 3: Commit + push** `feat: admin — traer figuras en lote y lista de precios`.
