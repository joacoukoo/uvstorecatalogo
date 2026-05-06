# Comprobantes de Pago — Design Spec

## Goal

Generar automáticamente comprobantes de pago (reserva y abono) en PDF desde el sistema, compartibles directamente por WhatsApp.

## Architecture

`comprobante.html` es una página standalone que recibe datos por URL params, renderiza el diseño del comprobante en HTML/CSS idéntico a los templates de Canva, genera un PDF client-side con `html2canvas` + `jsPDF`, y lo comparte via Web Share API.

No requiere backend, Cloudflare Worker, ni integración con Canva API.

## Assets (ya copiados a assets/)

- `assets/comprobante-abono-bg.png` — fondo completo del abono (1200×1600px), incluye banner ABONO, tabla con bordes, logo, footer — solo faltan los textos dinámicos
- `assets/comprobante-reserva-bg.png` — fondo completo de la reserva (1200×1600px), incluye banner ¡FELICIDADES!, tabla, logo, footer — solo faltan los textos dinámicos
- `assets/uvstore-logo.jpg` — logo UV Store GT (para uso futuro)

## Tipos de comprobante

### Reserva (`tipo=reserva`)

Texto fijo:
- Encabezado: **¡FELICIDADES!**
- Descripción: "Con tu depósito de __{monto}__ te hemos reservado el siguiente artículo:"
- Nota: "El artículo te será enviado una vez que nos llegue a Guatemala y/o se haya terminado de pagar por completo"

Tabla (2 filas):
- El valor es de: | **Q{total}**
- Saldo restante: | **Q{restante}**

### Abono (`tipo=abono`)

Texto fijo:
- Encabezado: **ABONO**
- Descripción: "Hemos recibido tu abono de __{monto}__ correspondiente a la figura:"

Tabla (3 filas):
- Valor total: | **Q{total}**
- Abono total: | **Q{abonado}**
- Saldo pendiente: | **Q{restante}**

## URL params

| Param | Tipo | Descripción |
|---|---|---|
| `tipo` | `reserva` \| `abono` | Tipo de comprobante |
| `nombre` | string | Nombre del cliente |
| `figura` | string | Nombre de la figura |
| `monto` | number | Monto de este pago (sin "Q") |
| `total` | number | Precio total de la figura |
| `abonado` | number | Total acumulado abonado (solo abono) |
| `restante` | number | Saldo pendiente |

Ejemplo reserva:
```
comprobante.html?tipo=reserva&nombre=Mario+Gilberto+Merlo&figura=Yoda+by+Hot+Toys&monto=620&total=3100&restante=2480
```

Ejemplo abono:
```
comprobante.html?tipo=abono&nombre=Elizabeth+López&figura=Pegaso+Seiya+Deluxe+by+Iron+Studios&monto=1000&total=3800&abonado=2000&restante=1800
```

## Manejo de params ausentes

`comprobante.html` debe funcionar aunque falten params opcionales:
- Si falta `abonado` (caso reserva): ignorar, no mostrar esa fila
- Si falta cualquier otro param: mostrar "—" en lugar del valor
- Si falta `tipo`: asumir `abono` por defecto

## Visual design de comprobante.html

Los backgrounds ya tienen todo el diseño estático renderizado. `comprobante.html` muestra el PNG como imagen base y superpone solo los textos dinámicos con `position: absolute` en porcentajes.

Dimensiones del contenedor: 1200×1600px (o escalado proporcionalmente con `max-width: 600px` para que entre en pantalla).

**Textos dinámicos a superponer (con % desde el borde superior del contenedor):**

### Abono (`comprobante-abono-bg.png`)
| Campo | top% | Estilo |
|---|---|---|
| Nombre cliente | ~19% | blanco, bold, ~32px, centrado |
| Monto (inline en descripción) | ~27% | blanco, bold, centrado |
| Nombre figura | ~38% | naranja `#E8A020`, bold, centrado |
| Valor total (celda derecha fila 1) | ~51% | negro, bold, ~22px, centrado |
| Abono total (celda derecha fila 2) | ~57.5% | negro, bold, centrado |
| Saldo pendiente (celda derecha fila 3) | ~64% | negro, bold, centrado |

### Reserva (`comprobante-reserva-bg.png`)
| Campo | top% | Estilo |
|---|---|---|
| Nombre cliente | ~19% | blanco, bold, ~32px, centrado |
| Monto (inline en descripción) | ~27% | blanco, bold, centrado |
| Nombre figura | ~36% | naranja `#E8A020`, bold, centrado |
| Valor total (celda derecha fila 1) | ~54% | negro, bold, ~22px, centrado |
| Saldo restante (celda derecha fila 2) | ~61% | negro, bold, centrado |

Los % son estimados y se ajustan durante implementación con prueba visual.

**Fuente para overlays:** `"Montserrat", "DM Sans", sans-serif` — bold para valores, regular para nombre.

## Trigger desde sistema.html

En `uvDetalleOrden`, cada fila de la tabla de pagos tiene un botón **"Comprobante"**.

Lógica del botón:
- Si `p.tipo === 'reserva'`: genera URL con params de reserva
- Si `p.tipo === 'abono'`: genera URL con params de abono
- `abonado` = suma de todos los pagos de la orden (se calcula desde `this.pagos`)
- `restante` = `orden.precio_venta_gtq - abonado`
- Abre `comprobante.html` en nueva pestaña: `window.open(url, '_blank')`

## Generación PDF y share

En `comprobante.html`:
- Botón **"Compartir por WhatsApp"** visible en la página
- Al clickear:
  1. `html2canvas` captura el div del comprobante → canvas
  2. `jsPDF` crea un PDF con la imagen del canvas (orientación portrait, A4 o proporción del diseño)
  3. Si `navigator.canShare` disponible (mobile): `navigator.share({ files: [pdfFile] })` → share nativo → WhatsApp
  4. Si no (desktop): `URL.createObjectURL(blob)` → `<a download>` → descarga automática

## Librerías client-side (CDN)

- `html2canvas` v1.4.1: `https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js`
- `jsPDF` v2.5.1: `https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js`

## Archivos a crear/modificar

- **Crear**: `comprobante.html`
- **Modificar**: `sistema.html` — agregar botón "Comprobante" en tabla de pagos de `uvDetalleOrden`
- **Ya en repo**: `assets/comprobante-abono-bg.png`, `assets/comprobante-reserva-bg.png`, `assets/uvstore-logo.jpg`
