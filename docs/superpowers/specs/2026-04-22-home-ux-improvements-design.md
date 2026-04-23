# Diseño: Mejoras UX Home — Franquicias + Búsqueda
**Fecha:** 2026-04-22  
**Estado:** Aprobado por usuario

---

## Contexto

El home de uvstore.shop tiene dos problemas de UX identificados:

1. Los íconos de franquicias (círculos de 120px) no comunican bien su contenido — las imágenes son demasiado pequeñas para leer, y "Otros" es ambiguo.
2. La búsqueda existe pero es poco visible: un pill chico en la esquina del navbar desktop (el mobile ya tiene el ícono en la barra inferior).

---

## Cambio 1 — Rediseño de la sección Franquicias

### Qué cambia
Los 7 íconos circulares (`makeFranchiseCard` en `index.html`) se reemplazan por cards rectangulares en grid de 3 columnas.

### Especificación visual
- **Layout:** `grid-template-columns: repeat(3, 1fr)`, gap de 8px
- **Tamaño:** ratio `aspect-ratio: 3/4` (más altas que anchas)
- **Imagen:** la cover existente (`FRANCHISE_ICONS[fname]`) como background, `object-fit: cover`, `filter: brightness(0.5)`
- **Overlay:** gradiente `linear-gradient(to top, <color-franquicia-75%> 0%, transparent 60%)`
- **Texto:** nombre en Bebas Neue 10px, blanco, `letter-spacing: 1.5px`, `text-shadow` para legibilidad. Contador "X fig." en 8px, rgba blanco 65%.
- **Borde:** `1px solid` con el color de la franquicia al 35% de opacidad
- **Border-radius:** 12px
- **Box-shadow:** `0 4px 16px rgba(0,0,0,.4)`

### Qué NO cambia
- Los colores de cada franquicia (`FRANCHISE_ACCENTS`)
- Las imágenes de cover (`FRANCHISE_ICONS`)
- El comportamiento al hacer click (goFranchise / showAgeGate para Adultos)
- El hover effect: `transform: scale(1.03)` + `box-shadow: 0 8px 28px rgba(0,0,0,.6)` sobre la card entera (reemplaza el hover actual que animaba solo el círculo)
- La sección de franquicias aparece en el home y en `franchise-page` — ambas usan `buildFranchiseGrid()`, el cambio aplica a las dos

### Archivos afectados
- `index.html` — función `makeFranchiseCard()` (línea ~1358) y el CSS inline de los elementos generados

---

## Cambio 2 — Barra de búsqueda visible en el home

### Qué cambia
Se agrega una barra de búsqueda estática en el home, como primer elemento del contenido, antes de la sección de Categorías.

### Especificación visual
- **Posición:** dentro del `<div class="section">` del home, antes del `sec-hdr` de Categorías
- **Aspecto:** input-like div (no es un `<input>` real, es un `<button>`) — `background: var(--bg3)`, `border: 1px solid var(--border2)`, `border-radius: 12px`, `padding: 12px 18px`
- **Contenido:** ícono de lupa (mismo SVG del navbar) + texto placeholder `"Buscar por nombre, marca o franquicia..."` en color `var(--muted)`
- **Hover:** `border-color: var(--purple)`
- **Click:** llama a `openSearchPage()` (mismo comportamiento que el botón del navbar)
- **Mobile:** visible también, complementa el ícono de la barra inferior. Margin-bottom adecuado para no chocar con la nav inferior.

### Qué NO cambia
- La página de búsqueda existente y su lógica
- El botón "Buscar" del navbar (se mantiene)
- El ícono de búsqueda en la barra de navegación mobile

### Archivos afectados
- `index.html` — HTML del home (línea ~908) y CSS de la barra nueva

---

## Orden de implementación

1. Cambio 2 (barra de búsqueda) — HTML + CSS nuevos, sin tocar lógica existente. Menor riesgo.
2. Cambio 1 (franquicias) — Reescribir `makeFranchiseCard()`. Aplicar CSS inline a los elementos generados.

## Criterios de éxito

- Las franquicias se entienden visualmente sin ambigüedad
- La barra de búsqueda es lo primero que ve el usuario al entrar al home
- Ambos cambios se ven bien en mobile (375px) y desktop (1440px)
- No hay regresiones en navegación o comportamiento
