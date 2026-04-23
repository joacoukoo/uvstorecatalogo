# Home UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar barra de búsqueda prominente en el home y rediseñar los íconos de franquicias de círculos a cards rectangulares con imagen de fondo.

**Architecture:** Todo el código vive en `index.html` (SPA vanilla JS). No hay framework de tests — la verificación es visual en el browser. Los cambios son independientes y se implementan en orden: primero la barra de búsqueda (solo HTML+CSS), luego las franquicias (reescritura de `makeFranchiseCard()`).

**Tech Stack:** HTML/CSS/JS vanilla · Cloudflare Pages · Sin build step

---

## Task 1: Barra de búsqueda en el home

**Files:**
- Modify: `index.html` — CSS (~línea 167, después de `.btn-search:hover`) y HTML (~línea 908, antes del `sec-hdr` de Categorías)

- [ ] **Step 1: Agregar CSS de la barra de búsqueda**

Buscar la línea:
```css
.btn-search:hover svg{opacity:1}
```

Agregar inmediatamente después:
```css
.home-search-bar{
  width:100%;background:var(--bg3);border:1px solid var(--border2);
  border-radius:12px;padding:14px 18px;
  display:flex;align-items:center;gap:10px;
  cursor:pointer;text-align:left;
  transition:border-color .2s;margin-bottom:24px;
  color:var(--muted);font-size:14px;font-family:"DM Sans",sans-serif;
}
.home-search-bar:hover{border-color:var(--purple)}
.home-search-bar svg{flex-shrink:0;opacity:.5}
```

- [ ] **Step 2: Agregar HTML de la barra en el home**

Buscar la línea:
```html
    <div class="sec-hdr"><div class="sec-title">Categor&iacute;as</div></div>
```

Agregar inmediatamente antes:
```html
    <button class="home-search-bar" onclick="openSearchPage()" aria-label="Buscar figura">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      Buscar por nombre, marca o franquicia...
    </button>
```

- [ ] **Step 3: Verificar visualmente**

Abrir el sitio localmente (o hacer push y revisar en uvstore.shop). Verificar:
- La barra aparece como primer elemento del contenido del home, antes de "Categorías"
- Tiene el mismo fondo oscuro que el resto de la UI
- Al hacer hover el borde cambia a color púrpura
- Al hacer click abre la página de búsqueda (misma que el botón del navbar)
- En mobile (375px) ocupa todo el ancho y no choca con la barra inferior

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: agregar barra de búsqueda prominente en el home"
git push origin main
```

---

## Task 2: Rediseño de franquicias — contenedores grid

**Files:**
- Modify: `index.html` — atributos `style` de `#franchise-home-grid` (~línea 926) y `#franchise-page-grid` (~línea 989)

- [ ] **Step 1: Cambiar franchise-home-grid de flex a grid**

Buscar:
```html
    <div id="franchise-home-grid" style="display:flex;flex-wrap:wrap;gap:24px 32px;margin-bottom:40px;align-items:flex-start"></div>
```

Reemplazar con:
```html
    <div id="franchise-home-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:40px;"></div>
```

- [ ] **Step 2: Cambiar franchise-page-grid de flex a grid**

Buscar:
```html
  <div id="franchise-page-grid" style="display:flex;flex-wrap:wrap;gap:24px 40px;padding:0 32px 64px;max-width:1400px;margin:0 auto;align-items:flex-start"></div>
```

Reemplazar con:
```html
  <div id="franchise-page-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;padding:0 32px 64px;max-width:1400px;margin:0 auto;"></div>
```

- [ ] **Step 3: Commit intermedio**

```bash
git add index.html
git commit -m "refactor: cambiar contenedores de franquicias de flex a grid"
```

---

## Task 3: Rediseño de franquicias — reescribir makeFranchiseCard()

**Files:**
- Modify: `index.html` — función `makeFranchiseCard()` (~línea 1358–1395)

- [ ] **Step 1: Reemplazar la función makeFranchiseCard() completa**

Buscar el bloque completo desde `function makeFranchiseCard(fname,gridId){` hasta el `}` de cierre (~línea 1395), y reemplazarlo con:

```js
function makeFranchiseCard(fname,gridId){
  var prods=getFranchiseProducts(fname);
  if(prods.length===0)return null;
  var accent=FRANCHISE_ACCENTS[fname]||"#7B2FBE";
  var iconVal=FRANCHISE_ICONS[fname];

  function hexToRgba(hex,alpha){
    var r=parseInt(hex.slice(1,3),16);
    var g=parseInt(hex.slice(3,5),16);
    var b=parseInt(hex.slice(5,7),16);
    return"rgba("+r+","+g+","+b+","+alpha+")";
  }
  var accentRgba75=hexToRgba(accent,0.75);
  var accentRgba35=hexToRgba(accent,0.35);

  var wrap=document.createElement("div");
  wrap.style.cssText="position:relative;border-radius:12px;overflow:hidden;aspect-ratio:3/4;border:1px solid "+accentRgba35+";box-shadow:0 4px 16px rgba(0,0,0,.4);cursor:pointer;transition:transform .2s,box-shadow .2s;";

  var img=document.createElement("img");
  img.src=iconVal;img.alt=fname;img.loading="lazy";
  img.style.cssText="width:100%;height:100%;object-fit:cover;filter:brightness(.5);display:block;";
  wrap.appendChild(img);

  var overlay=document.createElement("div");
  overlay.style.cssText="position:absolute;inset:0;background:linear-gradient(to top,"+accentRgba75+" 0%,transparent 60%);";
  wrap.appendChild(overlay);

  var textDiv=document.createElement("div");
  textDiv.style.cssText="position:absolute;bottom:0;left:0;right:0;padding:10px 8px;text-align:center;";

  var lbl=document.createElement("div");
  lbl.style.cssText="font-family:'Bebas Neue',sans-serif;font-size:11px;color:#fff;letter-spacing:1.5px;text-shadow:0 1px 4px rgba(0,0,0,.8);";
  lbl.textContent=fname;

  var cnt=document.createElement("div");
  cnt.style.cssText="font-size:9px;color:rgba(255,255,255,.65);margin-top:2px;font-family:'Syne',sans-serif;";
  cnt.textContent=prods.length+" fig.";

  textDiv.appendChild(lbl);textDiv.appendChild(cnt);
  wrap.appendChild(textDiv);

  wrap.addEventListener("mouseover",function(){
    wrap.style.transform="scale(1.03)";
    wrap.style.boxShadow="0 8px 28px rgba(0,0,0,.6)";
  });
  wrap.addEventListener("mouseout",function(){
    wrap.style.transform="";
    wrap.style.boxShadow="0 4px 16px rgba(0,0,0,.4)";
  });
  wrap.addEventListener("click",(function(f){return function(){if(f==="Adultos"){showAgeGate(f);}else{goFranchise(f);}};})(fname));
  return wrap;
}
```

- [ ] **Step 2: Verificar visualmente — home**

Abrir el home. Verificar:
- La sección Franquicias muestra 7 cards en grid 3 columnas (3+3+1)
- Cada card tiene imagen de fondo oscurecida con gradiente del color de la franquicia en la parte inferior
- El nombre y contador se leen sobre el gradiente
- El borde tiene el color sutil de la franquicia
- Al hacer hover la card escala levemente
- Al hacer click va a la franquicia correcta
- "Adultos" muestra el age gate

- [ ] **Step 3: Verificar visualmente — franchise-page**

Hacer click en "Franquicias" en la nav. Verificar:
- Las 7 cards aparecen en grid responsive (auto-fill, minmax 140px)
- En desktop se ven 4-5 columnas, en mobile 2-3 columnas
- El comportamiento al click sigue igual

- [ ] **Step 4: Verificar en mobile (375px)**

Abrir DevTools → viewport 375px. Verificar:
- En el home: 3 columnas de cards (se achican proporcionalmente)
- Las cards no están demasiado pequeñas para leer el texto
- Si el texto queda ilegible a 375px con 3 columnas, cambiar `grid-template-columns` a `repeat(2,1fr)` dentro de un `@media(max-width:400px){}` en el CSS

- [ ] **Step 5: Commit final y push**

```bash
git add index.html
git commit -m "feat: rediseñar franquicias — cards rectangulares con imagen de fondo"
git push origin main
```
