# Scrapeo en lote + lista de precios — diseño

Fecha: 2026-10-20 · Estado: aprobado para planificar

## Por qué

Hoy el admin (`admin-app.html`) trae **una** figura por link: scrapea fotos, nombre, marca, escala, la IA escribe la descripción y clasifica la franquicia, y después hay que completar precio y guardar. Cuando una tienda publica 20–50 pre-órdenes nuevas, eso es abrir figura por figura. El dueño quiere:

1. Pegar el link de una **página con muchas figuras** y traerlas todas de una.
2. Ponerles precio **en una sola lista**, sin entrar a cada figura, y que la reserva de pre-orden se calcule sola.
3. Publicarlas **todas juntas** con un botón.

Preferencia fuerte del dueño: **todo lo más automático posible**, con la opción de corregir. Solo usa las herramientas online (admin web); el admin de escritorio `uv_admin.py` no se toca.

## Sitios (por orden de importancia)

Los sitios donde el dueño necesita el lote. Sideshow se sigue haciendo de a una figura, como hoy.

| Sitio | Plataforma | Página de ejemplo | Cómo leer la lista |
|---|---|---|---|
| Fanatic Anime Store ("FNC") | BigCommerce | `https://www.fanaticanimestore.com/shop-all/pre-order/?sort=newest` | HTML: 20 `<article class="card">` por página, link en `.card-title a`; paginación `&page=N` |
| Nonasea | App propia (Vite/React) con API JSON | `https://www.nonasea.com/mall/NEWPRODUCTS?ordering=-id&page=1&page_size=50` | `GET https://www.nonasea.com/api/customer/index/class_product_list?class_id=<id>&ordering=-id&page=N&page_size=50` devuelve `{data:{list,total}}` con `title`, `description`, `content` (HTML) y fotos. El `class_id` sale de `GET /api/customer/index/classification_list` (ej. "NEW PRODUCTS" = 32). Hay que mapear el segmento de la URL (`NEWPRODUCTS`) al `class_id`. Ficha individual: `/api/customer/shop/product` (ver bundle JS) |
| Statuecorp | Shopify | cualquier `/collections/<x>` | `GET /collections/<x>/products.json?limit=250&page=N` devuelve productos completos (título, body_html, imágenes, variantes) |

Cualquier otra tienda **Shopify** debería funcionar igual que Statuecorp (`/collections/.../products.json`), y cualquier BigCommerce con la misma estructura de cards que FNC. Un sitio no reconocido muestra "Este sitio no está soportado para lote; usá el link individual".

Hallazgo: en FNC casi todas las "opciones" de producto **no son variantes**: son forma de pago ("Deposit Only", "Payment plan", "Full payment"), "Current Stock", "Email Address". Variantes reales vistas: `figure scale: 1:6 / 1:4` (ej. Kogenta de Night Wings Studio). Otras esperables: DLC, Deluxe/Exclusive, cabeza extra, color.

## Flujo del dueño

1. **Pegar link** de la página de lista en una pestaña nueva del admin ("Traer en lote").
2. **Grilla rápida** (segundos, sin IA): foto chica + nombre original de cada figura de esa página. La grilla carga una página del sitio a la vez, con un botón "Cargar más" para la siguiente.
   - **Ya la tenés** (coincidencia exacta, ver Duplicados): apagada, no se puede marcar.
   - **¿Ya la tenés?** (coincidencia por nombre parecido): otro color, **desmarcada** por defecto, se puede marcar con un toque.
   - **Nuevas**: todas **marcadas** por defecto. Tocar desmarca. Botones "Marcar todas" / "Desmarcar todas".
3. **"Traer N figuras"**: el admin procesa cada una (fotos, nombre limpio, marca, escala, franquicia, categoría, descripción, variantes, entrega estimada) mostrando progreso ("7 de 12"). Si una falla, se marca con error y sigue con las demás. Se puede dejar trabajando.
4. Cada figura procesada queda en **"Pendientes de precio"** (no visible en la web). Esta lista sobrevive a cerrar el navegador.
5. En **"Pendientes de precio"** el dueño escribe precios seguidos y toca **"Publicar todas"**.

Mínimo de clics si quiere todo: pegar link → "Traer" → precios → "Publicar todas".

## Duplicados ("¿cuáles ya tengo?")

Se compara cada figura de la lista contra el catálogo publicado **y** contra los pendientes:

1. **Exacta por origen**: (a) campo nuevo `origen` (URL de la ficha de la tienda) que se guarda en cada figura nueva desde ahora; (b) para figuras viejas, las URLs de **fotos** apuntan al CDN del sitio original e incluyen el id del producto de la tienda (BigCommerce: `cdn11.bigcommerce.com/s-5s1ah0hhi7/products/<id>/...` es FNC; Shopify: el nombre de archivo de la imagen; Nonasea: `hexapus...aliyuncs.com/...`). Coincidencia → "Ya la tenés".
   Datos actuales: 47 figuras con fotos de FNC, 4 de Statuecorp, 1 de Nonasea.
2. **Por nombre parecido**: nombre limpio de la tienda vs `n` del catálogo (+ marca si hay), sin mayúsculas/acentos/ruido ("PRE-ORDER", corchetes, escala). Coincidencia alta → "¿Ya la tenés?".

## Reglas de limpieza (IA) — obligatorias

- **Título**: solo personaje (y obra si hace falta para entenderlo), opcionalmente el tipo ("Statue", "1/6 Figure", "Bust"). **Nunca**: nombre de tienda (Fanatic Anime Store, FNC, Nonasea, Hexapus, Statuecorp…), "PRE-ORDER", "【】", "Shipping Included", "Licensed", "WF2026", "In Stock", nombre de la marca (va en su campo), emojis.
  Ej.: `(WF2026 Shipping Included)JIMEI PALACE X Toei Animation - One Piece - Donquixote Doflamingo 1/6 Statue -（Licensed）` → **Donquixote Doflamingo 1/6 Statue**, marca Jimei Palace, franquicia Anime, escala 1:6.
- **Descripción**: en español, como hoy. **Nunca** menciona tiendas, envíos, aduanas, formas de pago, emails, Facebook ni links.
- **Marca**: pasa por la normalización que ya existe en el admin (`resolverMarca`: forma canónica del catálogo). En lote **no** se pregunta "¿quisiste decir…?" por cada una: si hay sugerencia, se muestra en la fila de pendientes para aceptar con un toque.
- **Franquicia**: una de la lista válida (incluye las 8 nuevas), con las mismas reglas + IA que el scrape individual.
- **Categoría de la web**: "Hot Toys 1:6" si la marca es Hot Toys; "Estatuas Premium" para estatuas/bustos; "Otras Figuras" para figuras articuladas que no son Hot Toys; "Adultos" para contenido adulto. **Nunca** "Entrega Inmediata" automáticamente. (La IA decide con nombre + descripción; el dueño puede cambiarla en la fila.)
- **Disponibilidad**: **siempre "Pre-Orden"**, aunque la tienda extranjera diga "in stock" (eso no es stock en Guatemala). Solo cambia si el dueño la marca distinto en la fila. **Nunca** "Solo Bajo Pedido": el dueño dice que ese estado ya no debería existir. **Entrega** estimada si el texto la trae (ej. "Pre-sale 2027 Q2" → "2027 Q2").
- **Escala**: normalizada `1:N` cuando se pueda.

## Variantes

- Se ignoran siempre las opciones de pago/stock/email.
- Variantes reales → **una** figura con variantes. La primera es la base (`precio`, `reserva`, `escala`, `fotos`, `content`); las demás van en `p.variantes` (formato que la web **ya soporta**: `{label, precio, reserva, escala, fotos, content}`), con `label` limpio ("1:4", "Deluxe", "Cabeza extra").
- Ajuste en la web (`index_template.html`, ficha del producto): el botón de la variante base hoy dice siempre "Regular". Pasa a usar un campo nuevo `label_base` si existe (ej. "1:6"); si no, "Regular" como hoy.
- Fotos por variante solo si el sitio las separa (Shopify lo hace por variante); si no, todas comparten fotos.
- En la lista de precios, cada variante es una sub-fila con su propio precio. **Precio vacío = esa variante no se publica.** Si la base queda vacía pero alguna variante tiene precio, la primera con precio pasa a ser la base.

## Lista "Pendientes de precio"

- Una fila por figura: foto, nombre limpio (editable), categoría (select), franquicia (select), sugerencia de marca si aplica, campo **Precio (Q)**, reserva calculada mostrada al lado; sub-filas por variante.
- Reserva = `Math.round(precio * RESERVA_FACTOR)` (hoy `RESERVA_FACTOR = 0.2` en el admin), igual que el alta individual.
- Botones: quitar fila (descarta la figura), **"Publicar todas"** (publica solo las filas con precio; las que no tienen precio quedan pendientes).
- Publicar = **un solo** cambio de catálogo con todas las figuras (una acción nueva tipo `add_many` en `functions/api/catalog.js`, usando `mutateCatalog` para no pisar cambios concurrentes), con `added_at`, `origen`, `disp`, `entrega`, etc. Los lotes de stock no se crean (igual que el alta normal sin "crear lote").

## Restricciones

- Cloudflare Pages Functions: límite de subrequests por invocación → el **navegador** recorre las figuras y llama una vez por figura (reusar `/api/scrape` o variante), con 2–3 en paralelo como máximo. El endpoint de lista solo devuelve la lista liviana.
- Todo detrás del login del admin (middleware existente).
- `index.html` es generado: los cambios de web van en `index_template.html`.
- `productos.json` lo escriben el admin y el Sistema vía GitHub; nunca escribirlo de otra forma.
- Las fotos se guardan como hoy (URLs del sitio original), no se re-alojan.

## Decisiones tomadas por Claude (no por el dueño)

- **Dónde viven los pendientes**: tabla nueva en Supabase (`figuras_pendientes`, una fila por figura con el producto armado en `jsonb` + `origen` + `creado_en`), con un endpoint `/api/pendientes` (GET/POST/DELETE) usando `SUPABASE_SERVICE_KEY` como `lote-sync.js`. Motivo: no publicar en el repo figuras sin precio (un `pendientes.json` quedaría público en uvstore.shop y dispararía deploys en cada cambio).
- En lote no hay confirm() por marca; se muestra la sugerencia en la fila.
- "¿Ya la tenés?" viene desmarcada por defecto (mejor no duplicar).
- El modelo de IA es el mismo que ya usa `scrape.js`; el prompt se amplía con las reglas de limpieza.
- Las reglas de limpieza (título, descripción sin tiendas) aplican **también al scrape individual** de un link: el dueño quiere nombres limpios en todos lados. La IA pasa a devolver además `nombre`, `categoria`, `entrega` y variantes; el flujo de un link (incluido Sideshow) se vuelve a probar.
- Variantes "Regular / Deluxe" (o Exclusive) usan el sistema Deluxe que ya existe (`precio_d`, `reserva_d`, `fotos_d`, `content_d`), igual que las figuras de Sideshow, para no tener dos formas de mostrar Deluxe. Cualquier otra variante (escala, DLC, cabeza extra, color) va en `variantes` con `label_base`.
- Tabla de Supabase: se entrega el SQL en un archivo; se crea con la conexión de Supabase si el dueño la autoriza, si no el dueño la pega en el editor SQL. El endpoint se publica después de que la tabla exista.
- Pruebas: no hay ambiente de prueba. El scrapeo y los pendientes se prueban en vivo (los pendientes no se ven en la web). "Publicar todas" se prueba con una figura real que el dueño quiera publicar, o con una que se borra enseguida desde el admin.

## Fuera de alcance

- Sideshow en lote.
- Re-alojar fotos.
- Crear lotes de stock desde el lote.
- Editar el resto de campos (descripción, fotos) en la lista: para eso se publica y se edita en el admin como hoy.

## Queda a criterio del que construye

- Estructura de código y nombres de funciones/endpoints.
- Detalle del algoritmo de "nombre parecido" y su umbral.
- Diseño visual de la pestaña (seguir el estilo del admin; sobrio y compacto, usable en el celular).
- Cómo reintentar una figura que falló.
