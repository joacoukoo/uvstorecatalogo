# Búsqueda sin acentos + Botón pago rápido — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalizar todas las búsquedas para ignorar acentos/diacríticos, y agregar un botón "✓ Cobrado" en la lista de órdenes que registra el saldo pendiente como pago de transferencia con un solo clic.

**Architecture:** La función `normalize(s)` se agrega en `sistema-db.js` (ya importado globalmente en `sistema.html`). Los cuatro getters de búsqueda en `sistema.html` la usan en lugar de `.toLowerCase()`. El método `pagarRapido(o)` se agrega en `uvOrdenes` y el botón en la fila de la tabla.

**Tech Stack:** JavaScript vanilla, Alpine.js v3, Supabase (funciones `dbSavePago` y `dbSaveOrden` ya existentes en `sistema-db.js`).

---

## Archivos

| Archivo | Cambio |
|---|---|
| `sistema-db.js` | Agregar función `normalize(s)` después de `fmtDate` (línea ~179) |
| `sistema.html` | 4 getters de búsqueda + método `pagarRapido` en `uvOrdenes` + botón en tabla |

---

### Task 1: Agregar `normalize(s)` en sistema-db.js

**Files:**
- Modify: `sistema-db.js:179` — después de la función `fmtDate`

- [ ] **Step 1: Agregar la función `normalize` en sistema-db.js**

Localizar en `sistema-db.js` la línea que dice:
```js
function fmtDate(dt) {
```
Y agregar la siguiente función ANTES de `fmtDate`:

```js
function normalize(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
```

El bloque resultante debe quedar:
```js
function normalize(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function fmtDate(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' });
}
```

- [ ] **Step 2: Commit**

```bash
git add sistema-db.js
git commit -m "feat: agregar función normalize para búsquedas sin acentos"
```

---

### Task 2: Aplicar `normalize` en los 4 getters de búsqueda

**Files:**
- Modify: `sistema.html` — getters en líneas 1507, 1594, 1666, 1764

- [ ] **Step 1: Corregir `ordenesFiltradas` en `uvOrdenes` (~línea 1507)**

Localizar:
```js
    get ordenesFiltradas() {
      return this.ordenes.filter(o => {
        const q = this.busqueda.toLowerCase();
        const matchQ = !q || o.producto?.toLowerCase().includes(q) || o.clientes?.nombre?.toLowerCase().includes(q);
```

Reemplazar por:
```js
    get ordenesFiltradas() {
      return this.ordenes.filter(o => {
        const q = normalize(this.busqueda);
        const matchQ = !q || normalize(o.producto).includes(q) || normalize(o.clientes?.nombre).includes(q);
```

- [ ] **Step 2: Corregir `clientesFiltrados` en `uvClientes` (~línea 1594)**

Localizar:
```js
    get clientesFiltrados() {
      const q = this.busqueda.toLowerCase();
      return !q ? this.clientes : this.clientes.filter(c => c.nombre.toLowerCase().includes(q));
    },
```

Reemplazar por:
```js
    get clientesFiltrados() {
      const q = normalize(this.busqueda);
      return !q ? this.clientes : this.clientes.filter(c => normalize(c.nombre).includes(q));
    },
```

- [ ] **Step 3: Corregir `clientesFiltrados` en `uvNuevaOrden` (~línea 1666)**

Localizar (es el segundo `clientesFiltrados`, en el componente de nueva orden que usa `clienteBusqueda`):
```js
    get clientesFiltrados() {
      const q = this.clienteBusqueda.toLowerCase();
      return !q ? this.clientes : this.clientes.filter(c => c.nombre.toLowerCase().includes(q));
    },
```

Reemplazar por:
```js
    get clientesFiltrados() {
      const q = normalize(this.clienteBusqueda);
      return !q ? this.clientes : this.clientes.filter(c => normalize(c.nombre).includes(q));
    },
```

- [ ] **Step 4: Corregir `clientesAnuncio` en `uvWhatsappMasivo` (~línea 1764)**

Localizar:
```js
    get clientesAnuncio() {
      const q = this.filtroAnuncio.toLowerCase().trim();
```
y más abajo:
```js
      if (q) lista = lista.filter(c => c._productos.some(p => p.toLowerCase().includes(q)));
```

Reemplazar la primera línea del getter por:
```js
    get clientesAnuncio() {
      const q = normalize(this.filtroAnuncio);
```
Y la línea del filter por:
```js
      if (q) lista = lista.filter(c => c._productos.some(p => normalize(p).includes(q)));
```

- [ ] **Step 5: Verificar**

Abrir `sistema.html` en el navegador. Ir a Órdenes y buscar "maria" — debe encontrar clientes con nombre "María". Ir a Clientes y buscar "garcia" — debe encontrar "García". Ir a Nueva Orden y escribir "perez" en el campo cliente — debe sugerir "Pérez".

- [ ] **Step 6: Commit**

```bash
git add sistema.html
git commit -m "feat: búsqueda sin acentos en órdenes, clientes y anuncio WA"
```

---

### Task 3: Botón "✓ Cobrado" en tabla de órdenes

**Files:**
- Modify: `sistema.html` — método en `uvOrdenes` (~línea 1539) y HTML de la fila (~línea 537)

- [ ] **Step 1: Agregar método `pagarRapido` en `uvOrdenes`**

Localizar en `sistema.html` (dentro de `function uvOrdenes()`):
```js
    fmtQ, fmtDate
  };
}

// ── HISTORIAL CLIENTE
```

Reemplazar por:
```js
    async pagarRapido(o) {
      const hoy = new Date().toISOString().slice(0, 10);
      try {
        await dbSavePago({ orden_id: o.id, monto: o._saldo, tipo: 'abono', metodo: 'transferencia', fecha: hoy, notas: '' });
        if (o.estado !== 'pagada') await dbSaveOrden({ ...o, estado: 'pagada' });
        await this.cargar();
      } catch(e) { alert('Error al registrar pago: ' + e.message); }
    },
    fmtQ, fmtDate
  };
}

// ── HISTORIAL CLIENTE
```

- [ ] **Step 2: Agregar el botón en la fila de la tabla**

Localizar en `sistema.html` (dentro del `<template x-for="o in ordenesFiltradas">`):
```html
                    <td>
                      <button class="btn-sm btn-ghost" @click="verOrden(o.id)">Ver</button>
                    </td>
```

Reemplazar por:
```html
                    <td style="display:flex;gap:6px;flex-wrap:wrap">
                      <button x-show="o._saldo > 0" class="btn-sm btn-green" @click="pagarRapido(o)">✓ Cobrado</button>
                      <button class="btn-sm btn-ghost" @click="verOrden(o.id)">Ver</button>
                    </td>
```

- [ ] **Step 3: Verificar**

Abrir `sistema.html` → Órdenes. Las filas con saldo pendiente deben mostrar un botón verde "✓ Cobrado". Al hacer clic, el saldo debe quedar en Q0 y el estado debe cambiar a "pagada". Las filas con saldo 0 no deben mostrar el botón.

- [ ] **Step 4: Commit y push**

```bash
git add sistema.html
git commit -m "feat: botón pago rápido en lista de órdenes"
git push origin main
```
