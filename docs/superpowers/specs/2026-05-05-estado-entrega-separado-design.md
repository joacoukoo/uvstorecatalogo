# Estado de Entrega Separado — Spec de Diseño
**Fecha:** 2026-05-05

## Resumen

Separar el estado de **pago** del estado de **entrega** en las órdenes. Actualmente un solo campo `estado` mezcla ambas dimensiones (`entregada` implica pagada y entregada). La realidad del negocio es que hay figuras que se entregan con saldo pendiente, por lo que deben ser dos campos independientes.

---

## Cambios de Base de Datos

### 1. Nuevo campo `entregado`

```sql
ALTER TABLE ordenes ADD COLUMN entregado boolean NOT NULL DEFAULT false;
```

### 2. Migración de datos existentes

```sql
-- Marcar como entregadas las que ya tenían ese estado
UPDATE ordenes SET entregado = true WHERE estado = 'entregada';

-- Reasignar estado de pago: entregada/reservada → en_proceso o pagada según saldo
UPDATE ordenes SET estado = CASE
  WHEN estado = 'entregada' AND (
    precio_venta_gtq - (SELECT COALESCE(SUM(monto),0) FROM pagos WHERE orden_id = ordenes.id)
  ) <= 0 THEN 'pagada'
  WHEN estado IN ('entregada', 'reservada') THEN 'en_proceso'
  ELSE estado
END
WHERE estado IN ('entregada', 'reservada');
```

### Estados de pago válidos post-migración

`en_proceso` | `pagada` | `cancelada`

El valor `entregada` y `reservada` dejan de existir como estados de pago.

---

## Cambios de Backend (`sistema-db.js`)

### Nueva función

```js
async function dbSetEntregado(id, entregado) {
  const { error } = await db.from('ordenes').update({ entregado }).eq('id', id);
  if (error) throw error;
}
```

### Sin cambios necesarios en

- `dbGetOrdenes` — ya usa `select('*')`, trae `entregado` automáticamente
- `dbSaveOrden` — ya spreads todos los campos del objeto orden
- `dbGetOrden`, `dbGetOrdenesByCliente` — igual

---

## Cambios de UI (`sistema.html`)

### Lista de órdenes (`uvOrdenes`)

La columna Estado se divide en dos controles inline:

**Select de pago** (igual que hoy pero con 3 opciones):
- `en proceso`
- `pagada`
- `cancelada`

**Botón toggle de entrega** (nuevo, al lado del select):
- Estado: `Sin entregar` — estilo gris/muted, sin fill
- Estado: `Entregado ✓` — estilo verde
- Click → llama `dbSetEntregado(o.id, !o.entregado)` + actualiza `o.entregado` localmente
- Sin confirmación (acción reversible con otro click)

### Filtros de la lista

Se agrega un tercer selector junto al de estado:

```
[Todos los estados ▾]  [Toda entrega ▾]
```

Opciones de entrega: `Toda entrega | Entregadas | Sin entregar`

### Detalle de orden (`uvDetalleOrden`)

- Los botones de cambio de estado pasan de 4 opciones a 3: `en proceso | pagada | cancelada`
- Se agrega un botón separado debajo: `Marcar como entregado` / `Marcar como no entregado`
- El botón cambia de estilo según el valor actual de `orden.entregado`

### Formulario nueva/editar orden (`uvNuevaOrden`)

- Se agrega checkbox al final del formulario: `¿Ya fue entregada?`
- Mapea al campo `entregado` del objeto orden

### Historial de cliente (`uvHistorialCliente`)

- La tabla de órdenes del cliente agrega una columna `Entrega` con el mismo badge verde/gris

---

## Lógica automática

- El campo `entregado` es **siempre manual** — no cambia automáticamente
- Las reglas de auto-cambio de `estado` al registrar un pago se mantienen igual:
  - Saldo llega a 0 → `pagada`
  - Nuevo pago hace que el saldo suba > 0 estando en `pagada` → `en_proceso`

---

## Fuera de scope

- Notificaciones al cambiar estado de entrega
- Fecha de entrega (campo adicional)
- Historial de cambios de entrega
