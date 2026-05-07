# Búsqueda sin acentos + Botón pago rápido — Design Spec

**Date:** 2026-05-07  
**Scope:** `sistema.html`, `sistema-db.js`

---

## Feature 1: Búsqueda sin acentos

**Problema:** Los filtros de búsqueda usan `.toLowerCase()`, por lo que "Maria" no encuentra "María".

**Solución:** Agregar `normalize(s)` en `sistema-db.js` y reemplazar todos los comparadores de búsqueda.

```js
function normalize(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
```

**Getters afectados en `sistema.html`:**

| Getter | Componente | Línea aprox. |
|---|---|---|
| `ordenesFiltradas` | `uvOrdenes` | ~1507 |
| `clientesFiltrados` | `uvClientes` | ~1594 |
| `clientesFiltrados` | `uvNuevaOrden` (autocompletado) | ~1666 |
| `clientesAnuncio` | `uvWhatsappMasivo` | ~1765 |

Cada comparación `.toLowerCase()` pasa a `normalize()` en ambos lados del `includes`.

---

## Feature 2: Botón "✓ Cobrado" en lista de órdenes

**Dónde:** Columna de acciones en la tabla de `uvOrdenes` — visible solo cuando `o._saldo > 0`.

**Comportamiento al clic:**
1. Registra pago por el saldo exacto: `{ orden_id, monto: o._saldo, tipo: 'abono', metodo: 'transferencia', fecha: hoy, notas: '' }`
2. Si `o.estado !== 'pagada'`, actualiza la orden a `estado: 'pagada'`
3. Llama a `this.cargar()` para refrescar la lista

**Sin confirmación.** Si el usuario se equivoca, puede eliminar el pago desde la ficha de detalle de la orden (funcionalidad existente).

**Método a agregar en `uvOrdenes`:**

```js
async pagarRapido(o) {
  const hoy = new Date().toISOString().slice(0, 10);
  await dbSavePago({ orden_id: o.id, monto: o._saldo, tipo: 'abono', metodo: 'transferencia', fecha: hoy, notas: '' });
  if (o.estado !== 'pagada') await dbSaveOrden({ ...o, estado: 'pagada' });
  await this.cargar();
},
```

**HTML del botón** (en la fila de la tabla, junto a los botones existentes):
```html
<button x-show="o._saldo > 0" class="btn-sm btn-green" @click="pagarRapido(o)">✓ Cobrado</button>
```

---

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `sistema-db.js` | Agregar función `normalize(s)` |
| `sistema.html` | 4 getters de búsqueda + método `pagarRapido` + botón en tabla |
