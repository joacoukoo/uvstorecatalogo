# Spec: Aviso de stock de lote en orden nueva + eliminar orden + ganancia de canceladas

**Fecha:** 2026-07-02
**Contexto:** Sistema de órdenes UV Store GT (`sistema.html` + `sistema-db.js` + Supabase). Continuación de [[2026-07-01-lotes-pedido-proveedor-design]].

---

## Problema

Tres huecos detectados el día después de implementar lotes de pedido:

1. Al cargar una orden nueva para un producto que ya tiene un lote con poco o ningún stock, no hay ninguna señal a menos que el usuario abra manualmente la sección "+ Vincular a lote de pedido" y busque. Es fácil no darse cuenta de que un producto ya está agotado.
2. No existe forma de eliminar una orden desde la interfaz. La función de borrado en la base de datos (`dbDeleteOrden`) existe pero nunca se conectó a ningún botón — quedó huérfana. Lo único disponible es marcar una orden como "Cancelada" (soft-delete, la fila sigue existiendo).
3. Una orden cancelada casi siempre tiene un abono que no se reembolsa, pero el cálculo de "Ganancia" (dashboard, ganancia del mes, informes) excluye por completo las órdenes canceladas (`sistema.html:1819`), así que esa plata que sí quedó en el bolsillo nunca se refleja en ningún lado.

## Solución

### 1. Aviso de stock al escribir el producto

En el formulario de Nueva/Editar Orden, mientras el usuario escribe en el campo "Producto" (texto libre), se muestra debajo un aviso automático si el texto coincide con algún lote existente, usando el mismo criterio de matching que ya usa `lotesFiltrados` (coincidencia parcial case-insensitive por `producto`).

- Coincide con un lote con `disponibles > 0`: aviso gris/verde, ej. `Lote JIHO01: 2 disponibles`.
- Coincide con un lote con `disponibles <= 0`: aviso rojo, ej. `⚠ Lote JIHO01: 0 disponibles`.
- Si hay más de un lote coincidente, se muestra el de código más reciente (mismo criterio de orden que ya usa el buscador manual) y no una lista completa — es solo un aviso rápido, no un selector.
- Es puramente informativo: **no vincula el lote a la orden ni bloquea el guardado**. Si el usuario quiere vincular, sigue usando el buscador manual "+ Vincular a lote de pedido" como hoy. Esto respeta la regla ya establecida de que el vínculo orden↔lote nunca es automático por texto.
- No aplica si el campo Producto está vacío o no coincide con ningún lote (no se muestra nada).

Reutiliza `lotesFiltrados`/`disponibles` sin cambios de backend — es una pieza de UI nueva en `sistema.html` que reacciona al `x-model` del campo Producto del formulario de orden.

### 2. Eliminar una orden

En la vista de detalle de orden, junto al botón "Editar" existente, se agrega un botón "Eliminar orden" (estilo `btn-danger`, mismo patrón visual que `eliminarCliente`/`eliminarPago`).

- Al hacer clic, `confirm("¿Eliminar esta orden? Esta acción no se puede deshacer.")`.
- Si se confirma, llama a `dbDeleteOrden(orden.id)` (ya existe en `sistema-db.js:136`, sin cambios) y redirige a la lista de órdenes (`backView`).
- Es un borrado permanente y real (`DELETE FROM ordenes`), distinto del botón "Cancelada" que ya existe y que solo cambia el `estado` sin borrar la fila. Ambos botones conviven a propósito: "Cancelada" es el camino normal para una venta que no se concreta pero donde ya hubo un abono (que no se reembolsa) — necesita quedar registrada. "Eliminar" es para casos donde la orden no debería haber existido nunca, como pruebas o cargas por error, donde no tiene sentido dejar rastro.
- Si la orden tenía `lote_id`, al borrarse la fila el cupo del lote se libera automáticamente sin ningún paso extra, porque `disponibles` se calcula contando filas existentes en `ordenes` (ver [[2026-07-01-lotes-pedido-proveedor-design]]).
- No hay restricción adicional por estado de pago o entrega — se puede eliminar cualquier orden, sin importar si está pagada/entregada. Es responsabilidad de quien la borra confirmar que corresponde.

### 3. Ganancia de órdenes canceladas

Hoy existen tres cálculos de ganancia independientes, y ninguno trata las órdenes canceladas de forma correcta ni consistente entre sí:

| Dónde | Archivo/línea | Comportamiento actual con canceladas |
|---|---|---|
| Dashboard, "Ganancia est." del mes | `sistema.html:1818-1819` (`gananciaMes`) | Las excluye por completo (aportan Q0) |
| Informes, gráfico y tabla de ventas/ganancia por mes | `sistema.html:2453-2458` (`calcular()`, campo `o._ganancia`) | No filtra por estado — las cuenta con el precio de venta completo, como si la venta se hubiera concretado |
| Detalle de una orden individual, "Ganancia est." | `sistema.html:2525-2528` (`gananciaEstimada` getter) | Igual que informes: no filtra por estado, cuenta precio completo |

El fix es el mismo en los tres lugares: cuando `orden.estado === 'cancelada'`, la ganancia de esa orden pasa a ser **el monto abonado** (`calcAbonado(pagos)` / suma de `pagos.monto`), en vez de Q0 (dashboard) o del precio de venta completo (informes y detalle). Para cualquier otro estado, el cálculo no cambia (`precio_venta − costo_estimado`, con sus conversiones existentes).

- `gananciaMes` (dashboard): en vez de `if (o.estado === 'cancelada') return sum;`, sumar el abonado de esa orden cuando esté cancelada (respetando el filtro de mes/año ya existente por `fecha_venta`/`created_at`).
- `calcular()` (informes) y su campo `o._ganancia`: si `estado === 'cancelada'`, usar el abonado (`o._abonado`, ya calculado en la misma función en la línea anterior) en vez de `(precio_venta_gtq / 7.9) − costoEstimado`.
- `gananciaEstimada` getter (detalle de orden): si `this.orden.estado === 'cancelada'`, devolver `this.abonado` en vez de la fórmula de precio − costo − comisión.

---

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `sistema.html` | + aviso de stock reactivo en el campo Producto del form de orden (nueva/editar); + botón "Eliminar orden" en detalle de orden; + método `eliminarOrden()` en `uvDetalleOrden()`; ajuste de `gananciaMes` (dashboard), `calcular()`/`o._ganancia` (informes) y `gananciaEstimada` (detalle de orden) para que canceladas cuenten el abonado |
| `sistema-db.js` | Sin cambios — `dbDeleteOrden` ya existe |
| Supabase (manual, a verificar) | Confirmar que la policy RLS de `ordenes` cubra `DELETE` (no solo `SELECT/INSERT/UPDATE`); si el borrado falla en producción, esta es la causa más probable |

## Lo que NO cambia

- El vínculo orden↔lote sigue siendo 100% manual vía el buscador existente.
- El botón "Cancelada" y su efecto sobre el cupo del lote no se tocan.
- No se agrega borrado de lotes ni de otras entidades — solo de órdenes.
- No hay confirmación en dos pasos ni papelera de reciclaje; el borrado es inmediato tras el `confirm()`, igual que `eliminarCliente`/`eliminarPago`.
- El cálculo de ganancia para órdenes NO canceladas (en proceso, pagada) no cambia en ninguno de los tres lugares.
- `ventasTotal`/`totalVentas` (montos de venta, no de ganancia) y `porCobrar`/`cobrado` no se tocan — el ajuste es solo sobre el campo "ganancia".
