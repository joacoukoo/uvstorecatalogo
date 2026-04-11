# Pre Orden del Mes — Design Spec

**Date:** 2026-04-10

---

## Overview

A compact accent band on the homepage that highlights a single featured pre-order figure. The admin marks any product as "Pre orden del mes" via a checkbox in the edit form; the site renders the band automatically. If no product has the flag, the band is hidden.

---

## Visual Design

**Position:** Between the hero section and the category grid — immediately visible without scrolling.

**Layout:** Horizontal band (full-width). Three columns:
- Left: figure thumbnail (small square, ~80×90px)
- Center: tag "PRE ORDEN DEL MES · [Month Year]" (month/year generated dynamically from `new Date()` in JS), figure name, franquicia + escala
- Right: price, reserva amount, "Reservar" CTA button

**Style:** Matches the site's dark theme. Background uses a subtle purple/gold gradient overlay on `--bg2`. Border top in `rgba(--purple, 0.3)`. The tag uses `--gold` color. CTA button uses `--purple`.

**Hidden state:** When no product has `preorden_mes: true`, the band element has `display: none`. No layout shift — it simply doesn't take up space.

---

## Data Model

Add one optional boolean field to product objects:

```json
{
  "preorden_mes": true
}
```

- Falsy/absent = not the pre-order of the month
- At most one product in the entire catalog should have `preorden_mes: true` at any time (enforced server-side)

---

## Site (index.html)

**Rendering:**
- After catalog data loads, find the first product across all categories where `p.preorden_mes === true`
- If found: populate and show the `.preorden-band` element with the product's data:
  - `p.i` — thumbnail image
  - `p.n` — name
  - `p.franquicia` + `p.escala` — subtitle
  - `p.precio` — price
  - `p.reserva` — reserva amount (shown if present)
  - `p.entrega` — delivery estimate (shown if present)
- If not found: keep band hidden

**CTA — "Reservar" button:**
- Product cards in `index.html` are rendered by `makeCard()`. The implementation must ensure each card gets `id="prod-{p.id}"` so it's addressable.
- Scrolls to the card using `document.getElementById('prod-' + p.id).scrollIntoView({ behavior: 'smooth', block: 'center' })`
- Adds a brief gold border flash animation to the card (CSS `@keyframes`, 1.5s, then removed)
- Category sections are always rendered and visible (they use horizontal carousels, not collapsible sections), so no expand logic is needed

**HTML structure:**
```html
<section class="preorden-band" id="preorden-band" style="display:none">
  <!-- populated by JS -->
</section>
```
Placed in the HTML between `#hero` and the category grid.

---

## Admin (admin-app.html)

**Edit form:** Add a checkbox row after the existing "Destacado" / "En oferta" checkboxes:

```
[ ] Pre orden del mes
```

- Bound to `p.preorden_mes`
- Label: "Pre orden del mes" (marks this figure as the featured pre-order on the homepage)

**Add form:** Same checkbox, default unchecked.

**Behavior note for the user:** No special UI feedback is needed when checking this — the server handles clearing the previous one. The admin can verify by reloading the site.

---

## Server (functions/api/catalog.js)

**In `edit` action:** After locating and updating the target product, if `product.preorden_mes === true`, walk all categories and set `preorden_mes` to `undefined` (delete the field) on every other product. This ensures only one product has the flag at write time.

**In `add` action:** Same logic — if the new product has `preorden_mes: true`, clear it from all existing products first.

**No new API actions needed.** The existing `add` and `edit` actions handle this entirely.

---

## Files to Modify

| File | Change |
|---|---|
| `index.html` | Add `.preorden-band` HTML + CSS + render logic in the catalog load function |
| `admin-app.html` | Add `preorden_mes` checkbox to edit form and add form; include field in `buildAddProduct()` and `saveEdit()` |
| `functions/api/catalog.js` | Clear `preorden_mes` from all other products when `add`/`edit` sets it to `true` |

---

## Out of Scope

- Multiple simultaneous pre-orders (not needed now)
- A countdown timer (can be added later if desired)
- A dedicated admin tab/screen for this feature
- Any change to `productos.json` schema beyond the optional boolean field
