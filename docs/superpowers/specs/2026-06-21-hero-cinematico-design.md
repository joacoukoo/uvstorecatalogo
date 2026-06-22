# Spec: Hero cinematográfico con fotos de productos destacados

**Fecha:** 2026-06-21
**Archivo afectado:** `index_template.html`

## Contexto

El hero de la home (`.hero`) es hoy solo texto sobre fondo plano (eyebrow, título "UV STORE GUATEMALA", subtítulo, stats). El usuario lo siente "muy simple" comparado con sitios como sideshow.com, y quiere un efecto "wow" tipo video en la portada — sin tener un archivo de video real, usando las fotos de producto que ya existen en el catálogo.

## Objetivo

Convertir el fondo del hero en un carrusel cinematográfico (zoom lento + crossfade, estilo "Ken Burns") de las fotos de los productos marcados como `destacado`, manteniendo el texto y los stats actuales sin cambios de copy ni de layout general de la home.

## Enfoque técnico

CSS puro para el movimiento (zoom + crossfade vía `transform`/`opacity`), JS vanilla solo para avanzar el índice del slide — mismo patrón ya usado en `carouselBuild`/`carouselGo` (carrusel de fotos del modal de producto). Sin librerías ni dependencias nuevas.

Descartado: Canvas/WebGL (riesgo de rendimiento en gama baja, no calza con el resto del sitio) y librerías de slider tipo GSAP/Swiper (dependencia externa innecesaria cuando CSS puro logra el mismo resultado).

## Fuente de datos

Reutiliza el array `destProds` que ya calcula `buildHome()` (productos con `p.destacado===true`, con fallback a "Entrega Inmediata" si hay menos de 4). Se toman hasta 6 productos de ese array para generar los slides del hero — la misma curaduría que ya alimenta la sección "Destacados", sin lógica nueva de selección.

Imagen por slide: `(p.fotos && p.fotos.length>0) ? p.fotos[0] : p.i` (mismo patrón que `makeCard()`).

Si `destProds` tiene 0 productos (caso límite, no debería pasar en producción), el hero no renderiza ningún slide y se ve igual que hoy (fondo plano).
Si tiene exactamente 1, se muestra esa foto fija (con zoom Ken Burns) sin rotación ni crossfade.

## Estructura visual (capas)

1. **`.hero-bg`** — contenedor `position:absolute;inset:0` dentro de `.hero` (que pasa a `position:relative;overflow:hidden`). Contiene una `<img class="hero-bg-slide">` por producto, todas `position:absolute;inset:0;object-fit:cover;object-position:center top`, apiladas. `object-position:center top` evita que el recorte corte la cabeza de la figura en fotos verticales de producto (más relevante que el pie). Solo la slide con clase `.active` tiene `opacity:1`; el resto `opacity:0`.
2. **`.hero-bg-overlay`** — capa fija encima del fondo: gradiente oscuro de abajo hacia arriba (`linear-gradient(180deg, var(--bg) 0%, rgba(7,8,13,.55) 45%, rgba(7,8,13,.85) 100%)`) combinado con un toque del glow morado/dorado existente, para legibilidad del texto y para que las fotos se sientan integradas a la estética del sitio en vez de "pegadas".
3. **Contenido** (`.hero-eye`, `.hero-title`, `.hero-sub`, `.hero-stats`) — sin cambios de markup ni de copy, queda con `position:relative;z-index:1` para flotar sobre las capas anteriores.

La altura del `.hero` no cambia (sigue dimensionada por su padding/contenido actual, no pasa a 100vh).

## Animación

- **Zoom (Ken Burns):** cada `.hero-bg-slide.active` anima `transform:scale(1) → scale(1.08)` a lo largo de ~6.5s con `ease-out`, vía `@keyframes heroKenBurns` reiniciada en cada slide (JS quita/agrega la clase `.active` para resetear la animación).
- **Crossfade:** `transition:opacity 1.1s ease` en `.hero-bg-slide`; al avanzar, la slide saliente pierde `.active` (opacity 0) y la entrante la gana (opacity 1) en el mismo tick.
- **Avance automático:** `setInterval` cada 6.5s que avanza el índice (loop infinito). Se limpia el interval si el usuario navega fuera de home (mismo ciclo de vida que ya gestionan otras funciones de `buildHome`).
- **`prefers-reduced-motion: reduce`:** el sitio ya tiene esta regla global (`animation-duration:.01ms!important`), así que el zoom queda congelado automáticamente; además el JS debe evitar arrancar el `setInterval` de rotación cuando este media query está activo, dejando fija la primera foto.

## Interacción

El slide visible es clicable (`cursor:pointer`) y dispara `openModal(p, cat)` — el mismo modal que abren las tarjetas de producto — usando el producto correspondiente a esa slide. Pequeño feedback visual on hover (p.ej. leve aumento de opacity del overlay) para indicar que es interactivo.

## Mobile / performance

- Misma rotación completa en mobile que en desktop (no se reduce a una sola foto).
- La primera imagen (slide inicial) usa `loading="eager"`; el resto `loading="lazy"`, para no descargar las 6 fotos de golpe.
- Mientras `buildHome()` no ha corrido, `.hero-bg` está vacío y el hero se ve igual que hoy (fondo plano de `--bg`) — sin salto de layout ni parpadeo; las imágenes aparecen ya con su primer crossfade-in una vez insertadas.

## Build

Todos los cambios van en `index_template.html` (HTML, CSS dentro del `<style>` existente, JS dentro del bloque de scripts existente). `index.html` se sigue regenerando vía `inject_data.py` / el workflow `inject.yml` — no se edita directamente.

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `index_template.html` | CSS nuevo (`.hero` pasa a `position:relative;overflow:hidden`, `.hero-bg`, `.hero-bg-slide`, `.hero-bg-overlay`, `@keyframes heroKenBurns`), función JS nueva (p.ej. `buildHeroBg(destProds)`) llamada desde `buildHome()`, reutilizando el array `destProds` ya calculado ahí. |

## Fuera de scope

- No se toca ninguna otra sección de la home (marquee, categorías, franquicias, destacados grid) — el efecto se limita al `.hero`.
- No se sube ningún archivo de video; todo el efecto es CSS/JS sobre las fotos existentes.
- No se cambia el copy del hero (eyebrow, título, subtítulo, stats).
- No se cambia la lógica de qué productos cuentan como `destacado` (eso ya existe en `buildHome()`).
