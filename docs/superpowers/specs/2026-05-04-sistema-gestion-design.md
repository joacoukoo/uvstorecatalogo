# Sistema de Gestión UV Store — Spec de Diseño
**Fecha:** 2026-05-04

## Resumen

Aplicación web separada (`sistema.html`) para reemplazar el Excel actual de UV Store. Gestiona órdenes, clientes, pagos e inventario de figuras coleccionables. El pain point principal es la generación de comprobantes en Canva (requiere computadora, tiempo manual) — el sistema los genera automáticamente como PDF compartibles por WhatsApp desde cualquier dispositivo.

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | HTML + Alpine.js (CDN, 15kb, sin build step) |
| Base de datos | Supabase (free tier — PostgreSQL) |
| Auth | Supabase Auth (email + contraseña, usuario único) |
| Comprobantes | HTML Canvas API + jsPDF (CDN) |
| Compartir | Web Share API nativa del navegador |
| Deploy | Cloudflare Pages (mismo repo que el catálogo) |

---

## Módulos

### 1. Dashboard
Pantalla principal al ingresar. Muestra:

**Métricas:**
- Cobrado este mes (suma de pagos del mes actual)
- Saldo total pendiente (suma de saldos de todas las órdenes activas)
- Órdenes activas (count en estado reservada o en_proceso)
- Ganancia estimada del mes (de órdenes pagadas/entregadas este mes)

**Listas:**
- Saldos pendientes: todas las órdenes con saldo > 0, ordenadas de mayor a menor monto
- Últimos 10 pagos registrados (cliente, monto, fecha)

---

### 2. Órdenes

Lista de todas las órdenes con búsqueda por nombre/cliente y filtro por estado.

**Estados posibles:** `reservada → en_proceso → pagada → entregada`

**Pantalla: Nueva orden / Editar orden**

Campos del formulario:
- Producto (nombre de la figura)
- Código
- Marca (Hot Toys, Mondo, Iron Studios, etc.)
- Escala (1:6, 1:12, etc.)
- Pedido (proveedor: ebay, gundam, lts, statusecorp, etc.)
- Cliente (selector desde lista de clientes)
- Precio Original (USD)
- Envío
- Envío MBE
- Impuesto
- Aduana
- Arancel
- *Costo estimado* (calculado automáticamente: suma de todos los costos anteriores)
- Precio venta USD
- Precio venta GTQ
- *Ganancia estimada* (calculada: precio_venta_gtq − costo_estimado convertido)
- Estado
- Notas

**Pantalla: Detalle de orden**

Muestra todos los datos de la orden + historial de pagos + saldo actual.
Acciones disponibles: Registrar pago, Editar orden, Ver/generar comprobante.

---

### 3. Clientes

Lista de clientes con búsqueda por nombre.

**Campos:**
- Nombre completo
- WhatsApp (con código de país)
- Notas internas

**Detalle de cliente:** historial de todas sus órdenes con estado y saldo pendiente de cada una.

---

### 4. Pagos

Se registran desde el detalle de una orden, no como sección independiente.

**Campos por pago:**
- Monto (GTQ)
- Tipo: `reserva` | `abono`
- Método: `transferencia` | `efectivo` | `depósito`
- Fecha
- Notas (opcional)

Al guardar un pago, el sistema:
1. Actualiza el saldo pendiente de la orden
2. Cambia el estado de la orden automáticamente si corresponde (reservada → en_proceso)
3. Genera automáticamente el comprobante PDF correspondiente al tipo de pago

---

### 5. Comprobantes

**Tipo Reserva (¡FELICIDADES!):**
- Badge: "¡FELICIDADES!" (fondo púrpura)
- Texto: "Con tu depósito de Q{monto} te hemos reservado el siguiente artículo:"
- Nombre figura (dorado)
- Texto: "El artículo te será enviado una vez que nos llegue a Guatemala y/o se haya terminado de pagar por completo"
- Tabla: Valor / Saldo restante
- Footer: "¡Gracias por confiar en nosotros!" + logo UV Store + redes

**Tipo Abono:**
- Badge: "ABONO" (fondo púrpura)
- Texto: "Hemos recibido tu abono de Q{monto} correspondiente a la figura:"
- Nombre figura (dorado)
- Tabla: Valor total / Abono total / Saldo pendiente
- Footer: "¡Gracias por confiar en nosotros!" + logo UV Store + redes

**Implementación:**
- Diseño dibujado con HTML Canvas API replicando el template de Canva
- Fondo: imagen de figuras UV Store embebida como base64
- Logo: embebido como base64
- Conversión a PDF con jsPDF
- Botón "Compartir" usa Web Share API → abre menú nativo del dispositivo (WhatsApp, etc.)
- Botón "Descargar" como fallback en desktop

**Nota:** Los comprobantes generados NO se almacenan en la base de datos. Se generan on-demand desde los datos de la orden y el pago.

---

## Base de Datos (Supabase)

### Tabla: `clientes`
```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
nombre      text NOT NULL
whatsapp    text
notas       text
created_at  timestamptz DEFAULT now()
```

### Tabla: `ordenes`
```sql
id               uuid PRIMARY KEY DEFAULT gen_random_uuid()
cliente_id       uuid REFERENCES clientes(id)
producto         text NOT NULL
codigo           text
marca            text
escala           text
pedido           text
precio_original  numeric DEFAULT 0
envio            numeric DEFAULT 0
envio_mbe        numeric DEFAULT 0
impuesto         numeric DEFAULT 0
aduana           numeric DEFAULT 0
arancel          numeric DEFAULT 0
precio_venta_usd numeric DEFAULT 0
precio_venta_gtq numeric DEFAULT 0
estado           text DEFAULT 'reservada'
notas            text
created_at       timestamptz DEFAULT now()
```

*Campos calculados (client-side):*
- `costo_estimado` = precio_original + envio + envio_mbe + impuesto + aduana + arancel
- `ganancia_estimada` = precio_venta_gtq − costo_estimado (con fórmula de conversión a definir durante implementación)
- `abonado` = SUM de pagos.monto WHERE orden_id = este id
- `saldo_pendiente` = precio_venta_gtq − abonado

### Tabla: `pagos`
```sql
id         uuid PRIMARY KEY DEFAULT gen_random_uuid()
orden_id   uuid REFERENCES ordenes(id) ON DELETE CASCADE
monto      numeric NOT NULL
tipo       text NOT NULL  -- 'reserva' | 'abono'
metodo     text NOT NULL  -- 'transferencia' | 'efectivo' | 'deposito'
fecha      date DEFAULT CURRENT_DATE
notas      text
created_at timestamptz DEFAULT now()
```

**Row Level Security:** habilitado en todas las tablas. Solo el usuario autenticado puede leer/escribir sus propios datos.

---

## Navegación

**Mobile (barra inferior):** Dashboard / Órdenes / Clientes

**Desktop (sidebar izquierdo):** Dashboard / Órdenes / Clientes / Exportar CSV

---

## Exportar CSV

Botón en desktop que descarga todos los pagos del período seleccionado como archivo `.csv` compatible con Excel. Columnas: fecha, cliente, figura, monto, tipo, método.

---

## Identidad visual

- Fondo oscuro (`#07080d`) — misma paleta que el catálogo
- Acentos púrpura (`#7B2FBE`)
- Tipografía: DM Sans (ya cargada en el proyecto)
- Responsive: mobile-first, funcional en desktop

---

## Fuera de scope (v1)

- Notificaciones automáticas por WhatsApp (requiere API de pago de Meta)
- Integración automática con el catálogo para autocompletar figuras
- Múltiples usuarios / roles
- Tracking de fecha estimada de llegada
- Almacenamiento de comprobantes generados
