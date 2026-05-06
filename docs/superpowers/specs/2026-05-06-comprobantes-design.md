# Comprobantes de Pago — Design Spec

## Goal

Generar automáticamente comprobantes de pago (reserva y abono) en PDF desde el sistema, compartibles directamente por WhatsApp.

## Architecture

`comprobante.html` es una página standalone que recibe datos por URL params, renderiza el diseño del comprobante en HTML/CSS idéntico a los templates de Canva, genera un PDF client-side con `html2canvas` + `jsPDF`, y lo comparte via Web Share API.

No requiere backend, Cloudflare Worker, ni integración con Canva API.

## Assets requeridos (provistos por el usuario)

- `assets/comprobante-bg.jpg` — foto de fondo exportada desde Canva (la misma imagen oscura con figuras que usan ambos templates)
- `assets/uvstore-logo.png` — logo UV Store GT (el que aparece en la parte inferior de ambos comprobantes)

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

## Tipografía

- Encabezado (ABONO / ¡FELICIDADES!): **Syne** 700, mayúsculas
- Nombre cliente: **Syne** 700, ~36px
- Textos descriptivos y tabla: **DM Sans** 400/700
- Nombre figura: **DM Sans** 700 italic, color naranja
- Ambas fuentes disponibles vía Google Fonts

## Visual design de comprobante.html

Dimensiones: 600×900px (proporción similar al diseño de Canva, portrait).

Estructura de arriba a abajo:
1. **Fondo**: `comprobante-bg.jpg` con overlay oscuro semitransparente (`rgba(0,0,0,0.55)`)
2. **Encabezado**: banner rombo/paralelo morado (`#7B2FBE`) con texto blanco bold en mayúsculas ("ABONO" o "¡FELICIDADES!")
3. **Nombre cliente**: texto blanco, ~36px, bold
4. **Descripción**: texto blanco, ~16px, centrado, con el monto subrayado/destacado
5. **Nombre figura**: texto naranja/dorado (`#E8A020`), ~20px, cursiva o bold
6. **Nota de envío** (solo reserva): texto blanco, ~14px, centrado
7. **Tabla**: borde naranja redondeado, fondo blanco semitransparente, 2 o 3 filas. Columna izquierda texto normal, columna derecha texto bold
8. **"¡Gracias por confiar en nosotros!"**: texto blanco, cursiva
9. **Logo UV Store GT**: centrado, ~200px de ancho
10. **Footer**: fondo oscuro, iconos de redes sociales + @uvstore_gt + +502 3026 1622

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
- **Agregar**: `assets/comprobante-bg.jpg` (el usuario provee este archivo)
- **Agregar**: `assets/uvstore-logo.png` (el usuario provee este archivo)
