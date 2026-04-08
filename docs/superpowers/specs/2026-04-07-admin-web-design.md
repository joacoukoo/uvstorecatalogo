# Admin Web — UV Store GT

**Fecha:** 2026-04-07  
**Estado:** Aprobado para implementación

## Problema

El admin actual (`uv_admin.py`) es una app Python/Tkinter que vive en cada computadora por separado. Esto causa:
- Desincronización de datos entre computadoras
- El código del admin mismo puede quedar desactualizado en alguna máquina
- Requiere Python + Git instalados en cada computadora

## Solución

Un admin web accesible desde cualquier browser, hosteado en Cloudflare (mismo proveedor que el sitio). Siempre está en la última versión porque vive en un servidor, no en cada máquina.

---

## Arquitectura

### Stack
- **Frontend:** HTML + JS vanilla (sin frameworks), un solo archivo `admin-app.html`
- **Backend:** Cloudflare Pages Functions (JS/ES modules) — ya están configuradas en el repo
- **Diseño:** El skill `frontend-design` se usa durante la implementación para crear una UI de calidad

### Archivos nuevos

```
functions/
  admin.js              ← sirve la app, verifica auth
  api/
    catalog.js          ← GET/PUT productos.json vía GitHub API
    scrape.js           ← proxy de scraping (evita CORS)
    ai.js               ← proxy a Anthropic API

admin-app.html          ← SPA del admin (HTML + JS inline)
```

### Rutas
| Ruta | Qué hace |
|------|----------|
| `GET /admin` | Muestra login o la app según cookie de sesión |
| `POST /admin` | Procesa el login, setea cookie |
| `GET /api/catalog` | Lee `productos.json` desde GitHub API |
| `PUT /api/catalog` | Escribe `productos.json` a GitHub (crea commit) |
| `POST /api/scrape` | Recibe URL, devuelve datos scrapeados |
| `POST /api/ai` | Recibe datos del producto, devuelve contenido generado por IA |

---

## Autenticación

- Contraseña única configurada como variable de entorno `ADMIN_PASSWORD` en Cloudflare
- Al hacer login correcto: se setea una cookie `uv_session` con un token firmado (HMAC-SHA256) usando `ADMIN_SECRET`
- Cookie dura 7 días, `HttpOnly`, `Secure`, `SameSite=Strict`
- Todas las rutas `/api/*` también verifican la cookie antes de responder

---

## Variables de entorno en Cloudflare (secretos)

| Variable | Descripción |
|----------|-------------|
| `ADMIN_PASSWORD` | Contraseña para entrar al admin |
| `ADMIN_SECRET` | Clave para firmar tokens de sesión (string aleatorio largo) |
| `GITHUB_TOKEN` | Personal Access Token con permisos `contents:write` |
| `GITHUB_REPO` | Repo en formato `owner/repo` (ej: `joacoukoo/uvstorecatalogo`) |
| `ANTHROPIC_API_KEY` | API key de Anthropic para Claude Haiku |

Se configuran una sola vez en el dashboard de Cloudflare → Settings → Environment Variables. No viven en ninguna computadora local ni en el código.

---

## Funcionalidades

### Tab 1 — Agregar figura
1. Input de URL → botón "Scrapear" → llama a `/api/scrape`
2. El scraper soporta: Sideshow, Shopify, WooCommerce, Entertainment Earth, BBTS, genérico
3. Se pre-llenan los campos con los datos scrapeados
4. Botón "Generar con IA" → llama a `/api/ai` → llena descripción y características
5. Campos editables: nombre, categoría, precio, disponibilidad, escala, marca, fotos, descripción, características, variantes (regular/deluxe), flags (destacado, oferta, adulto18, agotado)
6. Botón "Guardar y Publicar" → llama a `PUT /api/catalog` → commit a GitHub → deploy automático en ~30 seg

### Tab 2 — Editar catálogo
1. Carga todos los productos desde `GET /api/catalog`
2. Buscador por nombre
3. Click en un producto → se abre el mismo formulario que Tab 1 con los datos pre-cargados
4. Botón "Guardar cambios" → `PUT /api/catalog`
5. Botón "Eliminar" con confirmación

### Tab 3 — Configuración
- Muestra estado de las variables de entorno (✅ configurada / ❌ falta) sin exponer los valores
- Link directo al dashboard de Cloudflare para modificarlas
- Botón "Optimizar catálogo con IA" (batch): detecta productos sin `content_ok: true` y los mejora con Claude Haiku

---

## Scraping en Cloudflare Workers

La lógica de scraping del `uv_admin.py` (Python/BeautifulSoup) se porta a JavaScript usando `DOMParser` o parsing con regex/string. Los patrones por proveedor se mantienen idénticos:

- **Sideshow:** detecta variantes por `?var=`, extrae SKU para fotos de edición deluxe
- **Shopify:** API `/products.json`
- **WooCommerce:** parsing de HTML
- **Entertainment Earth / BBTS:** parsing genérico
- **Genérico:** extrae título, imagen principal, precio

---

## Diseño visual

La UI se construye con el skill `frontend-design` durante la implementación. Objetivo: dark theme consistente con el sitio actual, limpio y funcional. No se usa Bootstrap ni frameworks externos.

---

## Lo que NO cambia

- `productos.json` sigue siendo la fuente de verdad
- El flujo GitHub → Cloudflare Pages → sitio en vivo sigue igual
- `uv_admin.py` puede coexistir (para uso offline si se necesita)
- `inject_data.py` / `index_template.html` no se tocan
