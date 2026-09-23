# Importar documentos de Sideshow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subir una factura (correo `.eml`/texto) o una orden de venta (PDF) de Sideshow en sistema.html, revisar figura por figura contra los lotes y aplicar: ajustar cantidades, sumar recibidas y crear lotes (vinculándolos a la página cuando se encuentra la figura).

**Architecture:** Toda la lectura y la lógica de decisiones vive en `sideshow-doc.js`, un módulo ES puro sin dependencias que se testea con vitest. `sistema.html` solo carga el archivo (pdf.js desde cdnjs para PDFs), muestra la revisión y aplica los efectos con funciones nuevas de `sistema-db.js`. La página pública se actualiza con un solo commit vía `/api/stock-sync` en modo lote (`items[]`).

**Tech Stack:** HTML + Alpine.js 3 (sistema.html), Supabase (Postgres + supabase-js), Cloudflare Pages Functions, vitest, pdf.js 4.10.38 (cdnjs).

**Spec:** `docs/superpowers/specs/2026-09-23-importar-documento-sideshow-design.md`

## Global Constraints

- **No se leen ni se guardan precios, envío, aranceles, impuestos ni pagos.**
- No se modifican órdenes ni clientes.
- El repo es **público**: los fixtures no llevan direcciones, nombres de personas, teléfonos, tarjetas ni precios (se reemplazan por `0.00`).
- Un lote por figura (o variante): no se vincula un lote nuevo a un producto que ya tiene lote en conflicto.
- Nada se guarda sin que el admin toque **Aplicar** en la revisión.
- Una factura nunca suma `recibidas` dos veces.
- Tests: correr siempre con ruta explícita (`npx vitest run tests/...`); `.claude/worktrees` tiene copias viejas de los tests.
- Cada commit se pushea a `origin/main` (`git fetch origin main && git pull --rebase origin main && git push origin main`).
- Commits terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `sideshow-doc.js` (nuevo) | Lectura de documentos (eml, factura, filas de PDF) y decisiones por figura. Puro, sin DOM ni red. |
| `tests/sideshowDoc.test.js` (nuevo) | Tests del módulo. |
| `tests/fixtures/sideshow-factura.txt`, `sideshow-factura.eml`, `sideshow-orden-filas.json` (nuevos) | Ejemplos anonimizados. |
| `functions/api/stock-sync.js` | GET devuelve fotos; POST acepta `items[]` con `disp` opcional. |
| `tests/stockSync.test.js` | Tests del modo lote. |
| `sistema-db.js` | `dbUpdateLote(..., {skipSync})`, registro de documentos, sync en lote. |
| `sistema.html` | Columna Recibidas, botón y modal de importación. |
| Supabase (migración) | `lotes_pedido.recibidas`, tabla `documentos_proveedor`. |

---

### Task 1: Migración de Supabase

**Files:** ninguno en el repo (migración aplicada con la herramienta de Supabase, proyecto `rpaiizqttenkfbiqulng`).

**Interfaces:**
- Produces: columna `lotes_pedido.recibidas integer not null default 0`; tabla `documentos_proveedor(id, tipo, numero, fecha, resumen, created_at)` con `unique(tipo, numero)`.

- [ ] **Step 1: Aplicar la migración** (`apply_migration`, nombre `importar_documento_sideshow`)

```sql
alter table public.lotes_pedido add column if not exists recibidas integer not null default 0;

create table if not exists public.documentos_proveedor (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('factura', 'orden_venta')),
  numero text not null,
  fecha date,
  resumen jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (tipo, numero)
);

alter table public.documentos_proveedor enable row level security;
create policy auth_documentos_proveedor on public.documentos_proveedor
  for all to authenticated using (true) with check (true);
```

- [ ] **Step 2: Verificar**

```sql
select column_name, data_type, column_default from information_schema.columns
 where table_name = 'lotes_pedido' and column_name = 'recibidas';
select policyname, roles::text from pg_policies where tablename = 'documentos_proveedor';
select count(*) filter (where recibidas = 0) as en_cero, count(*) from lotes_pedido;
```
Expected: la columna existe con default 0; la política existe para `{authenticated}`; los 43 lotes quedan en 0.

- [ ] **Step 3: Revisar advisors de seguridad** (`get_advisors` type `security`) y confirmar que no hay alertas nuevas de `documentos_proveedor`.

---

### Task 2: Lectura de documentos (`sideshow-doc.js` parte 1)

**Files:**
- Create: `sideshow-doc.js`
- Create: `tests/fixtures/sideshow-factura.txt`, `tests/fixtures/sideshow-factura.eml`, `tests/fixtures/sideshow-orden-filas.json`
- Create: `tests/sideshowDoc.test.js`

**Interfaces:**
- Produces:
  - `extraerTextoEml(raw: string): string`
  - `leerFactura(texto: string): Documento` con `tipo: 'factura'`
  - `agruparFilasPdf(items: {str, x, y}[]): string[]`
  - `leerOrdenVenta(filas: string[]): Documento` con `tipo: 'orden_venta'`
  - `detectarDocumento(entrada: string | string[]): Documento`: tira `Error` con el mensaje para el usuario.
  - `Documento = { tipo, numero: string, fecha: 'YYYY-MM-DD' | null, items: Item[] }`
  - `Item = { codigo: string, nombre: string, cantidad: number }`, más `pedidas`, `enviadas` y `pendientes` en la orden de venta (ahí `cantidad = pedidas`).

- [ ] **Step 1: Generar los fixtures anonimizados**

Script (correr una vez desde la raíz del repo; lee los originales de Descargas, que NO se commitean):

```bash
python - <<'EOF'
import email, re, json, quopri, subprocess
from email import policy
src = r'C:\Users\Joaquin\Downloads\Sideshow Tracking & Invoice #0005007540 (Wholesale).eml'
m = email.message_from_binary_file(open(src, 'rb'), policy=policy.default)
t = m.get_body(preferencelist=('plain',)).get_content()
t = re.sub(r'<https?://[^>]+>', '', t)
t = re.sub(r'[ \t\u202f\xa0]+', ' ', t)
t = re.sub(r'\n\s*\n+', '\n', t)
ini = t.index('*Order Information*'); fin = t.index('Subtotal:')
cuerpo = t[ini:fin]
cuerpo = re.sub(r'\$[\d,]+\.\d\d', '$0.00', cuerpo)          # sin precios ni aranceles
factura = 'Sideshow Tracking & Invoice (Wholesale) - ejemplo anonimizado\n' + cuerpo
open('tests/fixtures/sideshow-factura.txt', 'w', encoding='utf-8', newline='\n').write(factura)
qp = quopri.encodestring(factura.encode('utf-8')).decode('ascii')
eml = ('From: Ejemplo <ejemplo@example.com>\nSubject: Sideshow Tracking & Invoice (ejemplo)\n'
       'MIME-Version: 1.0\nContent-Type: multipart/alternative; boundary="XYZ"\n\n'
       '--XYZ\nContent-Type: text/plain; charset="UTF-8"\nContent-Transfer-Encoding: quoted-printable\n\n'
       + qp + '\n--XYZ\nContent-Type: text/html; charset="UTF-8"\n\n<p>html</p>\n--XYZ--\n')
open('tests/fixtures/sideshow-factura.eml', 'w', encoding='ascii', newline='\n').write(eml)
EOF
```

Para las filas del PDF, con `pdfjs-dist` instalado **fuera del repo** (scratchpad):

```js
// dump-filas.mjs: node dump-filas.mjs "<ruta del PDF>" > tests/fixtures/sideshow-orden-filas.json
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import { agruparFilasPdf } from 'file:///C:/dev/uvstorecatalogo/sideshow-doc.js';
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(process.argv[2])) }).promise;
let filas = [];
for (let n = 1; n <= doc.numPages; n++) {
  const tc = await (await doc.getPage(n)).getTextContent();
  filas = filas.concat(agruparFilasPdf(tc.items.map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))));
}
const utiles = filas
  .filter(f => /Sales Order|Order Number:|Order Date:|Change Order:|^Item |^\d{5,7} |^MISC|^[A-Z][^:]*\(|HOT TOYS|HT\)|THREEZERO|HT$|Tariff/.test(f))
  .map(f => f.replace(/2630 Conejo Spectrum\s*/, '').replace(/\b\d{1,3}(,\d{3})*\.\d\d\b/g, '0.00'));
console.log(JSON.stringify(utiles, null, 2));
```

(Este script usa `agruparFilasPdf`, así que se corre después del Step 3. Revisar a mano que el JSON no tenga direcciones ni teléfonos.)

- [ ] **Step 2: Escribir los tests que fallan** (`tests/sideshowDoc.test.js`)

```js
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { extraerTextoEml, leerFactura, agruparFilasPdf, leerOrdenVenta, detectarDocumento } from '../sideshow-doc.js';

const fx = f => fs.readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');

describe('leerFactura', () => {
  const doc = leerFactura(fx('sideshow-factura.txt'));
  it('lee numero, fecha y tipo', () => {
    expect(doc).toMatchObject({ tipo: 'factura', numero: '0005007540', fecha: '2026-09-11' });
  });
  it('lee las 21 figuras con codigo y cantidad', () => {
    expect(doc.items).toHaveLength(21);
    expect(doc.items[0]).toEqual({ codigo: '100519', nombre: 'Joel Miller Sixth Scale Figure - The Last of Us (Hot Toys)', cantidad: 2 });
  });
  it('lee codigos de 7 digitos y nombres en dos lineas', () => {
    const vader = doc.items.find(i => i.codigo === '9146252');
    expect(vader.cantidad).toBe(1);
    expect(vader.nombre).toBe('Darth Vader (Mustafar) (Artisan Edition) Sixth Scale Figure - Revenge of the Sith - Star Wars (Hot Toys)');
  });
  it('la seccion Tariff Offsets no genera items', () => {
    expect(new Set(doc.items.map(i => i.codigo)).size).toBe(21);
  });
  it('funciona con texto pegado desde la vista de Gmail (sin asteriscos)', () => {
    const pegado = 'Invoice Date: 09/11/2026\nInvoice ID: 0005007540\nBlade Sixth Scale Figure - Deadpool & Wolverine - Marvel (Hot Toys)\nItem: 913953\nOrder: 00332512\n$188.50 / Qty: 3\nShips via FedEx Ground\nTrack shipment\nTotal: $565.50\nVi Sixth Scale Figure - Arcane - Television Masterpiece Series - League of\nLegends (Hot Toys)\nItem: 914057\nOrder: 00332512\n$182.00 / Qty: 6\n';
    expect(leerFactura(pegado).items).toEqual([
      { codigo: '913953', nombre: 'Blade Sixth Scale Figure - Deadpool & Wolverine - Marvel (Hot Toys)', cantidad: 3 },
      { codigo: '914057', nombre: 'Vi Sixth Scale Figure - Arcane - Television Masterpiece Series - League of Legends (Hot Toys)', cantidad: 6 }
    ]);
  });
  it('suma cantidades si el mismo codigo aparece dos veces', () => {
    const t = 'Invoice ID: 1\n*A (X)*\nItem: 111111\nOrder: 1\n$1.00 / Qty: 1\nTotal: $1\n*A (X)*\nItem: 111111\nOrder: 2\n$1.00 / Qty: 2\n';
    expect(leerFactura(t).items).toEqual([{ codigo: '111111', nombre: 'A (X)', cantidad: 3 }]);
  });
});

describe('extraerTextoEml', () => {
  it('decodifica quoted-printable y da lo mismo que el texto', () => {
    expect(leerFactura(extraerTextoEml(fx('sideshow-factura.eml')))).toEqual(leerFactura(fx('sideshow-factura.txt')));
  });
  it('devuelve el texto tal cual si no es un correo MIME', () => {
    expect(extraerTextoEml('hola\nmundo')).toBe('hola\nmundo');
  });
  it('decodifica base64', () => {
    const b64 = Buffer.from('Invoice ID: 9 ñ', 'utf-8').toString('base64');
    const raw = 'Content-Type: multipart/mixed; boundary="B"\n\n--B\nContent-Type: text/plain; charset="UTF-8"\nContent-Transfer-Encoding: base64\n\n' + b64 + '\n--B--\n';
    expect(extraerTextoEml(raw)).toBe('Invoice ID: 9 ñ');
  });
});

describe('agruparFilasPdf', () => {
  it('agrupa por Y con tolerancia y ordena por X', () => {
    const filas = agruparFilasPdf([
      { str: 'B', x: 50, y: 100 }, { str: 'A', x: 10, y: 101 }, { str: ' ', x: 5, y: 100 },
      { str: 'C', x: 10, y: 80 }
    ]);
    expect(filas).toEqual(['A B', 'C']);
  });
});

describe('leerOrdenVenta', () => {
  const doc = leerOrdenVenta(JSON.parse(fx('sideshow-orden-filas.json')));
  it('lee numero con change order, fecha y tipo', () => {
    expect(doc).toMatchObject({ tipo: 'orden_venta', numero: '00328836-0', fecha: '2026-06-29' });
  });
  it('lee las 12 figuras y excluye MISC', () => {
    expect(doc.items).toHaveLength(12);
    expect(doc.items.some(i => i.codigo === 'MISC')).toBe(false);
    expect(doc.items[0]).toEqual({ codigo: '903739', nombre: 'Chewbacca w C3PO 1:6 SW (HT)', cantidad: 3, pedidas: 3, enviadas: 0, pendientes: 3 });
    expect(doc.items.find(i => i.codigo === '914528')).toMatchObject({ nombre: 'Stitch Collectible Figure (HOT TOYS)', pedidas: 7 });
  });
});

describe('detectarDocumento', () => {
  it('reconoce factura por texto', () => {
    expect(detectarDocumento(fx('sideshow-factura.txt')).tipo).toBe('factura');
  });
  it('reconoce orden de venta por filas', () => {
    expect(detectarDocumento(JSON.parse(fx('sideshow-orden-filas.json'))).tipo).toBe('orden_venta');
  });
  it('tira un error claro si no es de Sideshow', () => {
    expect(() => detectarDocumento('hola')).toThrow('No encontré figuras de Sideshow en este documento');
    expect(() => detectarDocumento('Invoice ID: 5\nnada')).toThrow('No encontré figuras de Sideshow en este documento');
  });
  it('tira un error claro si el PDF no tiene texto', () => {
    expect(() => detectarDocumento([])).toThrow('Este PDF es una imagen; no lo puedo leer. Pegá el texto o subí el correo.');
  });
});
```

- [ ] **Step 3: Implementar la parte de lectura** (`sideshow-doc.js`)

```js
// sideshow-doc.js: lectura de documentos de Sideshow y decisiones de importación a lotes.
// Módulo puro (sin DOM ni red): lo usan sistema.html y los tests.

const ITEM_FACTURA = /^Item:\s*(\d{5,7})\b/;
const FIN_NOMBRE = /^(\*?Order Information\*?|Invoice (Date|ID):|Total:|Track shipment|Ships via|Comments:|\*?Tariff Offsets)/i;
const FILA_ITEM_PDF = /^(\d{5,7})\s+\d{3}\s+(\d+)\s+(\d+)\s+(\d+)\s+PC\b/;
const ERROR_SIN_ITEMS = 'No encontré figuras de Sideshow en este documento';
const ERROR_PDF_IMAGEN = 'Este PDF es una imagen; no lo puedo leer. Pegá el texto o subí el correo.';

function limpiar(s) {
  return s.replace(/\r/g, '').replace(/[\u00a0\u202f\t]/g, ' ');
}

function bytesAUtf8(bytes) {
  return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
}

function decodificarQP(s) {
  const sinCortes = s.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < sinCortes.length; i++) {
    const c = sinCortes[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(sinCortes.slice(i + 1, i + 3))) {
      bytes.push(parseInt(sinCortes.slice(i + 1, i + 3), 16)); i += 2;
    } else {
      bytes.push(...new TextEncoder().encode(c));
    }
  }
  return bytesAUtf8(bytes);
}

// Devuelve el texto plano de un correo .eml (parte text/plain). Si no es MIME, lo devuelve igual.
export function extraerTextoEml(raw) {
  const lineas = raw.replace(/\r/g, '').split('\n');
  const ini = lineas.findIndex(l => /^Content-Type:\s*text\/plain/i.test(l));
  if (ini === -1) return raw;
  let i = ini, encoding = '';
  for (; i < lineas.length && lineas[i] !== ''; i++) {
    const m = lineas[i].match(/^Content-Transfer-Encoding:\s*(\S+)/i);
    if (m) encoding = m[1].toLowerCase();
  }
  const cuerpo = [];
  for (i++; i < lineas.length && !/^--\S/.test(lineas[i]); i++) cuerpo.push(lineas[i]);
  const texto = cuerpo.join('\n').replace(/\n+$/, '');
  if (encoding === 'quoted-printable') return decodificarQP(texto);
  if (encoding === 'base64') return bytesAUtf8(Uint8Array.from(atob(texto.replace(/\s/g, '')), c => c.charCodeAt(0)));
  return texto;
}

function fechaISO(d, m, a) {
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function agregarItem(items, item) {
  const previo = items.find(i => i.codigo === item.codigo);
  if (previo) previo.cantidad += item.cantidad;
  else items.push(item);
}

// Factura con tracking ("Sideshow Tracking & Invoice"): unidades despachadas por figura.
export function leerFactura(texto) {
  const lineas = limpiar(texto).split('\n').map(l => l.trim());
  const todo = lineas.join('\n');
  const numero = (todo.match(/Invoice ID:\s*(\d+)/) || [])[1] || '';
  const f = todo.match(/Invoice Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const items = [];
  lineas.forEach((linea, i) => {
    const m = linea.match(ITEM_FACTURA);
    if (!m) return;
    const partes = [];
    for (let j = i - 1; j >= 0 && partes.length < 4; j--) {
      const previa = lineas[j];
      if (!previa || FIN_NOMBRE.test(previa) || ITEM_FACTURA.test(previa) || /Qty:/.test(previa)) break;
      partes.unshift(previa);
      if (previa.startsWith('*')) break;
    }
    let cantidad = null;
    for (let j = i + 1; j < Math.min(lineas.length, i + 5); j++) {
      const q = lineas[j].match(/Qty:\s*(\d+)/);
      if (q) { cantidad = parseInt(q[1], 10); break; }
    }
    if (cantidad === null) return;
    const nombre = partes.join(' ').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    agregarItem(items, { codigo: m[1], nombre, cantidad });
  });
  return { tipo: 'factura', numero, fecha: f ? fechaISO(f[2], f[1], f[3]) : null, items };
}

// Agrupa los fragmentos de texto de pdf.js ({str, x, y}) en filas de arriba hacia abajo.
export function agruparFilasPdf(items) {
  const utiles = items.filter(it => it.str && it.str.trim()).sort((a, b) => b.y - a.y);
  const filas = [];
  for (const it of utiles) {
    const fila = filas.find(f => Math.abs(f.y - it.y) <= 2);
    if (fila) fila.items.push(it); else filas.push({ y: it.y, items: [it] });
  }
  return filas.map(f => f.items.sort((a, b) => a.x - b.x).map(it => it.str.trim()).join(' '));
}

// Orden de venta ("Sales Order", PDF): unidades pedidas por figura.
export function leerOrdenVenta(filas) {
  const todo = filas.join('\n');
  const orden = (todo.match(/Order Number:\s*(\d+)/) || [])[1] || '';
  const cambio = (todo.match(/Change Order:\s*(\d+)/) || [])[1] || '0';
  const f = todo.match(/Order Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const items = [];
  filas.forEach((fila, i) => {
    const m = fila.match(FILA_ITEM_PDF);
    if (!m) return;
    const siguiente = filas[i + 1] || '';
    const nombre = FILA_ITEM_PDF.test(siguiente) || /^MISC\b/.test(siguiente) ? '' : siguiente.trim();
    const pedidas = parseInt(m[2], 10);
    agregarItem(items, { codigo: m[1], nombre, cantidad: pedidas, pedidas, enviadas: parseInt(m[3], 10), pendientes: parseInt(m[4], 10) });
  });
  return { tipo: 'orden_venta', numero: orden ? `${orden}-${cambio}` : '', fecha: f ? fechaISO(f[2], f[1], f[3]) : null, items };
}

// Reconoce el tipo de documento. `entrada`: texto (correo o pegado) o filas de un PDF.
export function detectarDocumento(entrada) {
  if (Array.isArray(entrada) && entrada.length === 0) throw new Error(ERROR_PDF_IMAGEN);
  const texto = Array.isArray(entrada) ? entrada.join('\n') : limpiar(entrada);
  let doc = null;
  if (/Invoice ID:/.test(texto)) doc = leerFactura(texto);
  else if (/Sales Order/.test(texto) && /Order Number:/.test(texto)) {
    doc = leerOrdenVenta(Array.isArray(entrada) ? entrada : texto.split('\n').map(l => l.trim()));
  }
  if (!doc || !doc.items.length) throw new Error(ERROR_SIN_ITEMS);
  return doc;
}
```

- [ ] **Step 4: Generar `sideshow-orden-filas.json`** con `dump-filas.mjs` (Step 1) y revisarlo a mano. Correr el script Python del Step 1 para los fixtures de la factura.

- [ ] **Step 5: Correr los tests**

Run: `npx vitest run tests/sideshowDoc.test.js`
Expected: PASS (todos). Si falla un nombre por espacios o por el corte de líneas, corregir el lector, no el test.

- [ ] **Step 6: Commit**

```bash
git add sideshow-doc.js tests/sideshowDoc.test.js tests/fixtures/sideshow-factura.txt tests/fixtures/sideshow-factura.eml tests/fixtures/sideshow-orden-filas.json
git commit -m "feat: lector de facturas y ordenes de venta de Sideshow"
```

---

### Task 3: Decisiones por figura (`sideshow-doc.js` parte 2)

**Files:**
- Modify: `sideshow-doc.js` (agregar al final)
- Modify: `tests/sideshowDoc.test.js` (agregar al final)

**Interfaces:**
- Consumes: `Documento` (Task 2).
- Consumes `lotes`: `{id, codigo, producto, cantidad, recibidas, vendidas, catalogo_id, catalogo_variante}[]` (de `dbGetLotes`).
- Consumes `catalogo`: `{id, n, precio_d, i, fotos, fotos_d}[]` (de `dbGetCatalogoLiviano`, Task 4).
- Produces:
  - `buscarEnCatalogo(codigo, catalogo, lotes): {id, n, variante: null|'regular'|'deluxe'} | null`
  - `nombreCorto(nombre): string` y `marcaDeNombre(nombre): string`
  - `proponerAcciones(doc, lotes, catalogo): Fila[]`
  - `Fila = { tipo, codigo, nombre, q, lote|null, candidato|null, estado: 'ok'|'diferencia'|'nuevo', opciones: {valor, etiqueta}[], accion }`
  - `efectoDeAccion(fila, accion): { crear?: object, update?: {cantidad?, recibidas?}, aviso?: string }`

- [ ] **Step 1: Escribir los tests que fallan** (agregar a `tests/sideshowDoc.test.js`)

```js
import { buscarEnCatalogo, proponerAcciones, efectoDeAccion, nombreCorto, marcaDeNombre } from '../sideshow-doc.js';

const IMG = c => `https://www.sideshow.com/storage/product-images/${c}/foto.jpg`;
const CAT = [
  { id: 'blade', n: 'Blade', i: IMG('913953'), fotos: [IMG('913953')] },
  { id: 'atrt', n: 'AT-RT Driver', precio_d: '6000', i: IMG('915300'), fotos: [IMG('915300')], fotos_d: [IMG('9153002')] },
  { id: 'nicepool', n: 'Nicepool', i: IMG('914072'), fotos: [] }
];
const lote = (o) => ({ id: 'L' + o.codigo, producto: 'x', recibidas: 0, vendidas: 0, catalogo_id: null, catalogo_variante: null, ...o });
const fac = items => ({ tipo: 'factura', numero: '1', fecha: null, items });
const ov = items => ({ tipo: 'orden_venta', numero: '1-0', fecha: null, items });

describe('nombreCorto / marcaDeNombre', () => {
  it('corta en el primer " - " y saca la marca del ultimo parentesis', () => {
    const n = 'Grand Admiral Thrawn (Imperial Armor) Sixth Scale Figure - Star Wars: Rebels (Hot Toys) EXCLUSIVE';
    expect(nombreCorto(n)).toBe('Grand Admiral Thrawn (Imperial Armor) Sixth Scale Figure');
    expect(marcaDeNombre(n)).toBe('Hot Toys');
    expect(marcaDeNombre('Sin marca')).toBe('');
  });
});

describe('buscarEnCatalogo', () => {
  it('encuentra por la foto y sin variante si no hay deluxe', () => {
    expect(buscarEnCatalogo('913953', CAT, [])).toEqual({ id: 'blade', n: 'Blade', variante: null });
  });
  it('elige regular o deluxe segun en que fotos aparece', () => {
    expect(buscarEnCatalogo('915300', CAT, [])).toMatchObject({ id: 'atrt', variante: 'regular' });
    expect(buscarEnCatalogo('9153002', CAT, [])).toMatchObject({ id: 'atrt', variante: 'deluxe' });
  });
  it('no confunde un codigo con otro que lo contiene', () => {
    expect(buscarEnCatalogo('915300', [{ id: 'x', n: 'X', i: IMG('9153002') }], [])).toBeNull();
  });
  it('descarta el producto si ya tiene un lote en conflicto', () => {
    expect(buscarEnCatalogo('913953', CAT, [lote({ codigo: 'OTRO', catalogo_id: 'blade' })])).toBeNull();
    expect(buscarEnCatalogo('9153002', CAT, [lote({ codigo: 'R', catalogo_id: 'atrt', catalogo_variante: 'regular' })])).toMatchObject({ variante: 'deluxe' });
  });
  it('null si no esta en el catalogo', () => {
    expect(buscarEnCatalogo('999999', CAT, [])).toBeNull();
  });
});

describe('proponerAcciones: factura', () => {
  it('sin lote y en el catalogo: crear y vincular por defecto', () => {
    const [f] = proponerAcciones(fac([{ codigo: '913953', nombre: 'Blade Sixth Scale Figure - Marvel (Hot Toys)', cantidad: 3 }]), [], CAT);
    expect(f).toMatchObject({ estado: 'nuevo', accion: 'crear_vincular', candidato: { id: 'blade' } });
    expect(f.opciones.map(o => o.valor)).toEqual(['crear_vincular', 'crear', 'ignorar']);
    expect(efectoDeAccion(f, 'crear_vincular')).toEqual({ crear: {
      codigo: '913953', producto: 'Blade Sixth Scale Figure', marca: 'Hot Toys', cantidad: 3, recibidas: 3,
      proveedor: 'Sideshow', catalogo_id: 'blade', catalogo_variante: null } });
    expect(efectoDeAccion(f, 'crear').crear).toMatchObject({ catalogo_id: null, catalogo_variante: null });
    expect(efectoDeAccion(f, 'ignorar')).toEqual({});
  });
  it('sin lote y fuera del catalogo: crear por defecto', () => {
    const [f] = proponerAcciones(fac([{ codigo: '999999', nombre: 'Algo (Marca)', cantidad: 1 }]), [], CAT);
    expect(f.accion).toBe('crear');
    expect(f.opciones.map(o => o.valor)).toEqual(['crear', 'ignorar']);
  });
  it('coincide: sumar recibidas', () => {
    const [f] = proponerAcciones(fac([{ codigo: '100519', nombre: 'J', cantidad: 2 }]), [lote({ codigo: '100519', cantidad: 2 })], CAT);
    expect(f).toMatchObject({ estado: 'ok', accion: 'sumar' });
    expect(efectoDeAccion(f, 'sumar')).toEqual({ update: { recibidas: 2 } });
  });
  it('vinieron menos: faltan por defecto, o bajar con aviso si quedan ventas sin cubrir', () => {
    const [f] = proponerAcciones(fac([{ codigo: '913848', nombre: 'S', cantidad: 2 }]), [lote({ codigo: '913848', cantidad: 3, vendidas: 3 })], CAT);
    expect(f).toMatchObject({ estado: 'diferencia', accion: 'faltan' });
    expect(f.opciones.map(o => o.valor)).toEqual(['faltan', 'bajar']);
    expect(efectoDeAccion(f, 'faltan')).toEqual({ update: { recibidas: 2 } });
    expect(efectoDeAccion(f, 'bajar')).toEqual({ update: { recibidas: 2, cantidad: 2 }, aviso: 'Te faltaría 1 figura para clientes' });
  });
  it('recibidas acumuladas de facturas anteriores', () => {
    const [f] = proponerAcciones(fac([{ codigo: '913848', nombre: 'S', cantidad: 1 }]), [lote({ codigo: '913848', cantidad: 3, recibidas: 2 })], CAT);
    expect(f).toMatchObject({ estado: 'ok', accion: 'sumar' });
    expect(efectoDeAccion(f, 'sumar')).toEqual({ update: { recibidas: 3 } });
  });
  it('vinieron mas: subir por defecto', () => {
    const [f] = proponerAcciones(fac([{ codigo: '1', nombre: 'S', cantidad: 4 }]), [lote({ codigo: '1', cantidad: 3 })], CAT);
    expect(f.accion).toBe('subir');
    expect(efectoDeAccion(f, 'subir')).toEqual({ update: { recibidas: 4, cantidad: 4 } });
    expect(efectoDeAccion(f, 'dejar')).toEqual({ update: { recibidas: 4 } });
  });
});

describe('proponerAcciones: orden de venta', () => {
  it('coincide: sin cambios', () => {
    const [f] = proponerAcciones(ov([{ codigo: '1', nombre: 'S', cantidad: 3, pedidas: 3 }]), [lote({ codigo: '1', cantidad: 3 })], CAT);
    expect(f).toMatchObject({ estado: 'ok', accion: 'sin_cambios' });
    expect(efectoDeAccion(f, 'sin_cambios')).toEqual({});
  });
  it('distinto: dejar igual por defecto; ajustar nunca toca recibidas', () => {
    const [f] = proponerAcciones(ov([{ codigo: '1', nombre: 'S', cantidad: 1, pedidas: 1 }]), [lote({ codigo: '1', cantidad: 3, vendidas: 2, recibidas: 3 })], CAT);
    expect(f).toMatchObject({ estado: 'diferencia', accion: 'dejar' });
    expect(efectoDeAccion(f, 'dejar')).toEqual({});
    expect(efectoDeAccion(f, 'ajustar')).toEqual({ update: { cantidad: 1 }, aviso: 'Te faltaría 1 figura para clientes' });
  });
  it('sin lote: crea con 0 recibidas y sin marca', () => {
    const [f] = proponerAcciones(ov([{ codigo: '999999', nombre: 'Carnage (Deluxe) 1:6 (HT)', cantidad: 1, pedidas: 1 }]), [], CAT);
    expect(efectoDeAccion(f, 'crear').crear).toMatchObject({ cantidad: 1, recibidas: 0, marca: '', producto: 'Carnage (Deluxe) 1:6 (HT)' });
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/sideshowDoc.test.js`
Expected: FAIL (`buscarEnCatalogo is not a function`, etc.).

- [ ] **Step 3: Implementar** (agregar al final de `sideshow-doc.js`)

```js
// ── Decisiones por figura ─────────────────────────────────────────────

export function nombreCorto(nombre) {
  return nombre.split(' - ')[0].trim();
}

export function marcaDeNombre(nombre) {
  const todos = [...nombre.matchAll(/\(([^()]+)\)/g)];
  return todos.length ? todos[todos.length - 1][1].trim() : '';
}

function tieneFoto(urls, codigo) {
  const marca = `product-images/${codigo}/`;
  return (urls || []).some(u => typeof u === 'string' && u.includes(marca));
}

function chocaConLote(lotes, productoId, variante) {
  return lotes.some(l => l.catalogo_id === productoId &&
    (!l.catalogo_variante || !variante || l.catalogo_variante === variante));
}

// Busca la figura del catálogo cuyas fotos llevan el número de Sideshow (mismo criterio con el
// que se vincularon los lotes existentes). Descarta productos que ya tienen un lote en conflicto.
export function buscarEnCatalogo(codigo, catalogo, lotes) {
  for (const p of catalogo) {
    const enDeluxe = tieneFoto(p.fotos_d, codigo);
    const enRegular = tieneFoto([p.i, ...(p.fotos || [])], codigo);
    if (!enDeluxe && !enRegular) continue;
    const variante = p.precio_d ? (enDeluxe ? 'deluxe' : 'regular') : null;
    if (chocaConLote(lotes, p.id, variante)) continue;
    return { id: p.id, n: p.n, variante };
  }
  return null;
}

const ETIQUETAS = {
  crear_vincular: c => `Crear lote y vincular a ${c.n}${c.variante ? ' (' + c.variante + ')' : ''}`,
  crear: () => 'Crear lote',
  ignorar: () => 'Ignorar',
  sumar: () => 'Sumar recibidas',
  faltan: () => 'Faltan, las completo por otro lado',
  bajar: (c, q) => `Bajar el lote a ${q}`,
  subir: (c, q) => `Subir el lote a ${q}`,
  dejar: () => 'Dejar la cantidad igual',
  sin_cambios: () => 'Sin cambios',
  ajustar: (c, q) => `Ajustar el lote a ${q}`
};

function opciones(valores, candidato, q) {
  return valores.map(v => ({ valor: v, etiqueta: ETIQUETAS[v](candidato, q) }));
}

export function proponerAcciones(doc, lotes, catalogo) {
  return doc.items.map(item => {
    const base = { tipo: doc.tipo, codigo: item.codigo, nombre: item.nombre, q: item.cantidad, lote: null, candidato: null };
    const lote = lotes.find(l => String(l.codigo) === item.codigo) || null;
    if (!lote) {
      const candidato = buscarEnCatalogo(item.codigo, catalogo, lotes);
      const valores = candidato ? ['crear_vincular', 'crear', 'ignorar'] : ['crear', 'ignorar'];
      return { ...base, candidato, estado: 'nuevo', opciones: opciones(valores, candidato), accion: valores[0] };
    }
    if (doc.tipo === 'factura') {
      const r2 = (lote.recibidas || 0) + item.cantidad;
      if (r2 === lote.cantidad) return { ...base, lote, estado: 'ok', opciones: opciones(['sumar']), accion: 'sumar' };
      const valores = r2 < lote.cantidad ? ['faltan', 'bajar'] : ['subir', 'dejar'];
      return { ...base, lote, estado: 'diferencia', opciones: opciones(valores, null, r2), accion: valores[0] };
    }
    if (item.cantidad === lote.cantidad) return { ...base, lote, estado: 'ok', opciones: opciones(['sin_cambios']), accion: 'sin_cambios' };
    return { ...base, lote, estado: 'diferencia', opciones: opciones(['dejar', 'ajustar'], null, item.cantidad), accion: 'dejar' };
  });
}

function avisoFaltantes(nuevaCantidad, vendidas) {
  const faltan = (vendidas || 0) - nuevaCantidad;
  if (faltan <= 0) return null;
  return `Te faltaría${faltan === 1 ? '' : 'n'} ${faltan} figura${faltan === 1 ? '' : 's'} para clientes`;
}

// Qué cambia en la base al elegir `accion` para la fila. {} = nada.
export function efectoDeAccion(fila, accion) {
  if (accion === 'ignorar' || accion === 'sin_cambios') return {};
  if (accion === 'crear' || accion === 'crear_vincular') {
    const vincular = accion === 'crear_vincular' && fila.candidato;
    return { crear: {
      codigo: fila.codigo,
      producto: nombreCorto(fila.nombre) || fila.codigo,
      marca: fila.tipo === 'factura' ? marcaDeNombre(fila.nombre) : '',
      cantidad: fila.q,
      recibidas: fila.tipo === 'factura' ? fila.q : 0,
      proveedor: 'Sideshow',
      catalogo_id: vincular ? fila.candidato.id : null,
      catalogo_variante: vincular ? fila.candidato.variante : null
    } };
  }
  const lote = fila.lote;
  if (fila.tipo === 'factura') {
    const r2 = (lote.recibidas || 0) + fila.q;
    if (accion === 'bajar' || accion === 'subir') {
      const efecto = { update: { recibidas: r2, cantidad: r2 } };
      const aviso = avisoFaltantes(r2, lote.vendidas);
      return aviso ? { ...efecto, aviso } : efecto;
    }
    return { update: { recibidas: r2 } }; // sumar, faltan, dejar
  }
  if (accion === 'ajustar') {
    const aviso = avisoFaltantes(fila.q, lote.vendidas);
    return aviso ? { update: { cantidad: fila.q }, aviso } : { update: { cantidad: fila.q } };
  }
  return {}; // dejar (orden de venta)
}
```

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run tests/sideshowDoc.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sideshow-doc.js tests/sideshowDoc.test.js
git commit -m "feat: decisiones por figura al importar documentos de Sideshow"
```

---

### Task 4: `/api/stock-sync`: fotos en la lista y sync en lote

**Files:**
- Modify: `functions/api/stock-sync.js`
- Modify: `tests/stockSync.test.js`

**Interfaces:**
- Consumes: `aplicarStock(producto, variante, disponibles)` y `findProducto`, `readFile`, `mutateCatalog` de `functions/_lib/githubCatalog.js`.
- Produces:
  - GET: cada elemento suma `i`, `fotos` y `fotos_d`.
  - POST `{ items: [{catalogo_id, catalogo_variante, disponibles, disp?}] }` → `{ ok: true, cambiados: number, no_encontrados: string[] }` con **un solo** PUT, o ninguno si `cambiados === 0`. La forma de un solo ítem no cambia.

- [ ] **Step 1: Tests que fallan** (agregar a `tests/stockSync.test.js`, dentro del `describe` del POST o en uno nuevo; usa `authOk`, `ghRead`, `mockFetch`, `catalogoEscrito`, `huboPut` ya definidos en el archivo)

```js
describe('onRequestPost con items[]', () => {
  const post = (body) => new Request('https://x/api/stock-sync', {
    method: 'POST', headers: { Authorization: 'Bearer tok123' }, body: JSON.stringify(body)
  });

  it('aplica varios productos en un solo PUT, con disp opcional', async () => {
    const catalog = { Cat: { products: [
      { id: 'a', cantidad: '1', agotado: false, disp: 'Pre Orden' },
      { id: 'b', cantidad: '5', agotado_r: false, precio_d: '1' }
    ] } };
    const fetchMock = mockFetch([authOk(), ...ghRead(catalog), ...ghRead(catalog), new Response('{}', { status: 200 })]);
    const res = await onRequestPost({ request: post({ items: [
      { catalogo_id: 'a', catalogo_variante: null, disponibles: 3, disp: 'Entrega Inmediata' },
      { catalogo_id: 'b', catalogo_variante: 'regular', disponibles: 0 },
      { catalogo_id: 'zz', catalogo_variante: null, disponibles: 1 }
    ] }), env: ENV });

    expect(await res.json()).toEqual({ ok: true, cambiados: 2, no_encontrados: ['zz'] });
    expect(fetchMock.mock.calls.filter(c => c[1] && c[1].method === 'PUT')).toHaveLength(1);
    const escrito = catalogoEscrito(fetchMock).Cat.products;
    expect(escrito[0]).toMatchObject({ cantidad: '3', agotado: false, disp: 'Entrega Inmediata' });
    expect(escrito[1]).toMatchObject({ cantidad: '5', agotado_r: true });
  });

  it('no escribe si nada cambia', async () => {
    const catalog = { Cat: { products: [{ id: 'a', cantidad: '3', agotado: false }] } };
    const fetchMock = mockFetch([authOk(), ...ghRead(catalog)]);
    const res = await onRequestPost({ request: post({ items: [{ catalogo_id: 'a', catalogo_variante: null, disponibles: 3 }] }), env: ENV });
    expect(await res.json()).toEqual({ ok: true, cambiados: 0, no_encontrados: [] });
    expect(huboPut(fetchMock)).toBe(false);
  });

  it('400 si algun item no trae disponibles numerico', async () => {
    mockFetch([authOk()]);
    const res = await onRequestPost({ request: post({ items: [{ catalogo_id: 'a', disponibles: 'x' }] }), env: ENV });
    expect(res.status).toBe(400);
  });
});

it('GET incluye las fotos para buscar por numero de Sideshow', async () => {
  const catalog = { Cat: { products: [{ id: 'a', n: 'A', i: 'u1', fotos: ['u1'], fotos_d: ['u2'] }] } };
  mockFetch([authOk(), ...ghRead(catalog)]);
  const res = await onRequestGet({ request: new Request('https://x/api/stock-sync', { headers: { Authorization: 'Bearer t' } }), env: ENV });
  expect((await res.json())[0]).toMatchObject({ id: 'a', i: 'u1', fotos: ['u1'], fotos_d: ['u2'] });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run tests/stockSync.test.js`
Expected: FAIL en los 4 tests nuevos.

- [ ] **Step 3: Implementar**

En `onRequestGet`, agregar al objeto de la lista: `i: p.i, fotos: p.fotos, fotos_d: p.fotos_d`.

Agregar antes de `export async function onRequestPost`:

```js
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function aplicarItem(p, it) {
  let cambio = aplicarStock(p, it.catalogo_variante || null, it.disponibles);
  if (it.disp && p.disp !== it.disp) { p.disp = it.disp; cambio = true; }
  return cambio;
}

// Varios productos en un solo commit (importación de documentos de Sideshow).
async function sincronizarVarios(items, env) {
  for (const it of items) {
    if (!it || !it.catalogo_id || typeof it.disponibles !== 'number' || !Number.isFinite(it.disponibles)) {
      return new Response(JSON.stringify({ error: 'cada item requiere catalogo_id y disponibles numérico' }), { status: 400, headers: JSON_HEADERS });
    }
  }
  const { catalog: actual } = await readFile(env.GITHUB_TOKEN, env.GITHUB_REPO);
  const noEncontrados = items.filter(it => !findProducto(actual, it.catalogo_id)).map(it => it.catalogo_id);
  const aplicables = items.filter(it => !noEncontrados.includes(it.catalogo_id));
  const cambiados = aplicables.filter(it => aplicarItem({ ...findProducto(actual, it.catalogo_id) }, it)).length;
  if (cambiados > 0) {
    await mutateCatalog(env.GITHUB_TOKEN, env.GITHUB_REPO, catalog => {
      for (const it of aplicables) {
        const p = findProducto(catalog, it.catalogo_id);
        if (p) aplicarItem(p, it);
      }
    }, { message: 'Sync stock — Importación Sideshow' });
  }
  return new Response(JSON.stringify({ ok: true, cambiados, no_encontrados: noEncontrados }), { headers: JSON_HEADERS });
}
```

Y al principio del `try` de `onRequestPost`, reemplazar la lectura del body por:

```js
    const body = await request.json();
    if (Array.isArray(body.items)) return await sincronizarVarios(body.items, env);
    const { catalogo_id, catalogo_variante, disponibles } = body;
```

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run tests/stockSync.test.js tests/loteSync.test.js`
Expected: PASS (todos, incluidos los que ya existían).

- [ ] **Step 5: Commit**

```bash
git add functions/api/stock-sync.js tests/stockSync.test.js
git commit -m "feat: stock-sync en lote (items[]) y fotos en la lista del catalogo"
```

---

### Task 5: Funciones de datos en `sistema-db.js`

**Files:**
- Modify: `sistema-db.js`

**Interfaces:**
- Produces:
  - `dbUpdateLote(id, fields, opts = {})`: con `opts.skipSync` no sincroniza.
  - `dbGetDocumentoProveedor(tipo, numero): Promise<row | null>`
  - `dbGuardarDocumentoProveedor({tipo, numero, fecha, resumen}): Promise<row>` (upsert por `tipo,numero`)
  - `dbActualizarResumenDocumento(id, resumen): Promise<void>`
  - `dbSyncStockCatalogoLote(items): Promise<{ok, cambiados, no_encontrados}>`

- [ ] **Step 1: Implementar**

Reemplazar `dbUpdateLote`:

```js
async function dbUpdateLote(id, fields, opts = {}) {
  const { error } = await db.from('lotes_pedido').update(fields).eq('id', id);
  if (error) throw error;
  if (!opts.skipSync) await _syncStockSiCorresponde(id);
  return dbGetLote(id);
}
```

Agregar después de `dbSyncStockCatalogo`:

```js
// ── DOCUMENTOS DE PROVEEDOR (importación Sideshow) ───────────────────
async function dbGetDocumentoProveedor(tipo, numero) {
  const { data, error } = await db.from('documentos_proveedor').select('*').eq('tipo', tipo).eq('numero', numero).maybeSingle();
  if (error) throw error;
  return data;
}

async function dbGuardarDocumentoProveedor(doc) {
  const { data, error } = await db.from('documentos_proveedor').upsert(doc, { onConflict: 'tipo,numero' }).select().single();
  if (error) throw error;
  return data;
}

async function dbActualizarResumenDocumento(id, resumen) {
  const { error } = await db.from('documentos_proveedor').update({ resumen }).eq('id', id);
  if (error) throw error;
}

// Actualiza varios productos de la página en un solo commit.
async function dbSyncStockCatalogoLote(items) {
  if (!items.length) return { ok: true, cambiados: 0, no_encontrados: [] };
  const session = await dbGetSession();
  const res = await fetch('/api/stock-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (session ? session.access_token : '') },
    body: JSON.stringify({ items })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error al sincronizar stock');
  return data;
}
```

- [ ] **Step 2: Verificar sintaxis y tests**

Run: `node --check sistema-db.js && npx vitest run tests/`
Expected: sin errores; todos los tests en verde.

- [ ] **Step 3: Commit**

```bash
git add sistema-db.js
git commit -m "feat: funciones de datos para importar documentos de proveedor"
```

---

### Task 6: Pantalla de importación y columna Recibidas (`sistema.html`)

**Files:**
- Modify: `sistema.html` (vista Lotes: botón, columna, modal; carga del módulo; lógica en `uvLotes()`)

**Interfaces:**
- Consumes: `window.SideshowDoc` (`extraerTextoEml`, `agruparFilasPdf`, `detectarDocumento`, `proponerAcciones`, `efectoDeAccion`), las funciones de Task 5, `dbGetLotes`, `dbCreateLote(lote, {skipSync:true})` y `dbGetCatalogoLiviano`.

- [ ] **Step 1: Cargar el módulo** después de `<script src="sistema-db.js?v=...">`:

```html
<script type="module">
  import * as SideshowDoc from './sideshow-doc.js?v=20260923';
  window.SideshowDoc = SideshowDoc;
</script>
```

- [ ] **Step 2: Columna Recibidas.** En el encabezado de la tabla de lotes, agregar `<th>Recibidas</th>` después de `<th>Disponibles</th>`. En la fila, después de la celda de disponibles:

```html
<td :style="l.recibidas && l.recibidas < l.cantidad ? 'color:var(--red);font-weight:700' : ''"
    x-text="l.recibidas ? (l.recibidas + '/' + l.cantidad) : '—'"></td>
```

- [ ] **Step 3: Botón** en el `page-header` de Lotes, junto a los botones existentes:

```html
<button class="btn-sm btn-ghost" @click="abrirImportar()">Importar documento Sideshow</button>
```

- [ ] **Step 4: Estado y lógica** (agregar a las propiedades de `uvLotes()`)

```js
    imp: { abierto: false, paso: 'carga', texto: '', error: '', leyendo: false, aplicando: false,
           doc: null, filas: [], previo: null, modo: 'nuevo', entregaInmediata: false, resultado: '' },
    abrirImportar() {
      this.imp = { abierto: true, paso: 'carga', texto: '', error: '', leyendo: false, aplicando: false,
                   doc: null, filas: [], previo: null, modo: 'nuevo', entregaInmediata: false, resultado: '' };
    },
    async _filasDePdf(buffer) {
      const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
      let filas = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const tc = await (await pdf.getPage(n)).getTextContent();
        filas = filas.concat(SideshowDoc.agruparFilasPdf(tc.items.map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))));
      }
      return filas;
    },
    async leerArchivo(file) {
      if (!file) return;
      this.imp.error = ''; this.imp.leyendo = true;
      try {
        const entrada = /\.pdf$/i.test(file.name)
          ? await this._filasDePdf(await file.arrayBuffer())
          : SideshowDoc.extraerTextoEml(await file.text());
        await this._revisar(entrada);
      } catch (e) { this.imp.error = e.message; }
      finally { this.imp.leyendo = false; }
    },
    async leerTextoPegado() {
      this.imp.error = ''; this.imp.leyendo = true;
      try { await this._revisar(SideshowDoc.extraerTextoEml(this.imp.texto)); }
      catch (e) { this.imp.error = e.message; }
      finally { this.imp.leyendo = false; }
    },
    async _revisar(entrada) {
      const doc = SideshowDoc.detectarDocumento(entrada);
      const [lotes, catalogo, previo] = await Promise.all([
        dbGetLotes(), dbGetCatalogoLiviano(), dbGetDocumentoProveedor(doc.tipo, doc.numero)
      ]);
      this.lotes = lotes;
      this.imp.doc = doc; this.imp.previo = previo;
      const pendientes = previo ? (previo.resumen || []).filter(r => !r.aplicado) : [];
      if (doc.tipo === 'factura' && previo && pendientes.length === 0) {
        this.imp.modo = 'bloqueado';
      } else if (doc.tipo === 'factura' && previo) {
        this.imp.modo = 'terminar';
        this.imp.filas = pendientes.map(r => ({ ...r, opciones: [{ valor: r.accion, etiqueta: r.etiqueta }] }));
      } else {
        this.imp.modo = previo ? 'repetida' : 'nuevo';
        this.imp.filas = SideshowDoc.proponerAcciones(doc, lotes, catalogo);
      }
      this.imp.paso = 'revision';
    },
    efectoFila(f) {
      return f.efecto || SideshowDoc.efectoDeAccion(f, f.accion);
    },
    async aplicarImportacion() {
      const imp = this.imp;
      imp.aplicando = true; imp.error = '';
      const resumen = imp.filas.map(f => ({
        codigo: f.codigo, nombre: f.nombre, tipo: f.tipo, q: f.q, estado: f.estado, accion: f.accion,
        etiqueta: (f.opciones.find(o => o.valor === f.accion) || {}).etiqueta || f.accion,
        efecto: this.efectoFila(f), lote_id: f.lote ? f.lote.id : (f.lote_id || null), aplicado: !!f.aplicado
      }));
      const cont = { creados: 0, ajustados: 0, sinCambios: 0 };
      const aSincronizar = [];
      try {
        const registro = imp.modo === 'terminar'
          ? imp.previo
          : await dbGuardarDocumentoProveedor({ tipo: imp.doc.tipo, numero: imp.doc.numero, fecha: imp.doc.fecha, resumen });
        const guardado = imp.modo === 'terminar' ? registro.resumen : resumen;
        for (const r of resumen) {
          const e = r.efecto;
          if (e.crear) {
            const nuevo = await dbCreateLote(e.crear, { skipSync: true });
            cont.creados++;
            if (nuevo.catalogo_id) aSincronizar.push({ lote: nuevo, vendidas: 0, llego: imp.doc.tipo === 'factura' });
          } else if (e.update) {
            await dbUpdateLote(r.lote_id, e.update, { skipSync: true });
            const lote = this.lotes.find(l => l.id === r.lote_id);
            if ('cantidad' in e.update) cont.ajustados++; else cont.sinCambios++;
            if (lote && lote.catalogo_id && ('cantidad' in e.update || imp.entregaInmediata)) {
              aSincronizar.push({ lote: { ...lote, ...e.update }, vendidas: lote.vendidas || 0, llego: imp.doc.tipo === 'factura' });
            }
          } else {
            cont.sinCambios++;
          }
          const entrada = guardado.find(g => g.codigo === r.codigo);
          if (entrada) entrada.aplicado = true;
          await dbActualizarResumenDocumento(registro.id, guardado);
        }
        const items = aSincronizar.map(({ lote, vendidas, llego }) => ({
          catalogo_id: lote.catalogo_id,
          catalogo_variante: lote.catalogo_variante || null,
          disponibles: lote.cantidad - vendidas,
          ...(imp.entregaInmediata && llego ? { disp: 'Entrega Inmediata' } : {})
        }));
        const sync = await dbSyncStockCatalogoLote(items);
        imp.resultado = `${cont.ajustados} lote(s) ajustado(s), ${cont.creados} creado(s), ${cont.sinCambios} sin cambio de cantidad.` +
          (sync.cambiados ? ` Página actualizada (${sync.cambiados} figura(s)).` : '');
        imp.paso = 'resultado';
        await this.cargar();
      } catch (e) {
        imp.error = 'Se detuvo: ' + e.message + '. Lo aplicado quedó guardado; volvé a subir el documento para terminar lo pendiente.';
      } finally { imp.aplicando = false; }
    },
```

Nota: en modo `terminar`, `aSincronizar` usa `this.lotes` recargado en `_revisar`, así que la cantidad es la actual.

- [ ] **Step 5: Modal** (agregar dentro del `div x-data="uvLotes()"`, junto a los otros modales; usa las clases existentes `modal-*`, `form-*` y `btn-*`)

```html
<template x-if="imp.abierto">
  <div class="modal-backdrop" @click.self="imp.aplicando || (imp.abierto=false)">
    <div class="modal" style="max-width:760px;width:100%">
      <div class="modal-header"><h2 class="modal-title">Importar documento Sideshow</h2></div>
      <div class="modal-body">
        <template x-if="imp.paso==='carga'">
          <div>
            <label class="form-label">Archivo (.eml del correo o .pdf de la orden)</label>
            <input type="file" accept=".eml,.pdf,.txt" @change="leerArchivo($event.target.files[0])" style="font-size:16px">
            <div style="margin:14px 0 6px;color:var(--muted2);font-size:13px">o pegá el texto del correo</div>
            <textarea class="form-input" rows="6" x-model="imp.texto" style="font-size:16px"></textarea>
            <button class="btn-sm btn-purple" style="margin-top:8px" :disabled="!imp.texto.trim() || imp.leyendo" @click="leerTextoPegado()">Leer texto</button>
            <div x-show="imp.leyendo" style="margin-top:10px;color:var(--muted2)">Leyendo...</div>
          </div>
        </template>
        <template x-if="imp.paso==='revision'">
          <div>
            <div style="margin-bottom:12px;font-size:14px;color:#fff"
                 x-text="(imp.doc.tipo==='factura' ? 'Factura ' : 'Orden de venta ') + imp.doc.numero + (imp.doc.fecha ? ' · ' + imp.doc.fecha : '') + ' · ' + imp.doc.items.length + ' figuras'"></div>
            <div x-show="imp.modo==='bloqueado'" style="color:var(--red);font-size:14px"
                 x-text="'Esta factura ya se importó el ' + fmtDate(imp.previo.created_at) + '. No se puede aplicar de nuevo (sumaría las recibidas dos veces).'"></div>
            <div x-show="imp.modo==='terminar'" style="color:var(--orange);font-size:13px;margin-bottom:10px">Esta factura quedó a medias. Se aplicarán solo las figuras pendientes, con las decisiones que ya habías elegido.</div>
            <div x-show="imp.modo==='repetida'" style="color:var(--orange);font-size:13px;margin-bottom:10px" x-text="'Esta orden ya se importó el ' + fmtDate(imp.previo.created_at) + '. Podés revisarla y aplicarla de nuevo.'"></div>
            <template x-if="imp.modo!=='bloqueado'">
              <div style="overflow-x:auto">
                <table class="table" style="width:100%;font-size:13px">
                  <thead><tr><th>Código</th><th>Figura</th><th>Documento</th><th>Lote</th><th>Acción</th></tr></thead>
                  <tbody>
                    <template x-for="f in imp.filas" :key="f.codigo">
                      <tr>
                        <td x-text="f.codigo"></td>
                        <td x-text="f.nombre"></td>
                        <td x-text="f.q"></td>
                        <td x-text="f.lote ? (f.lote.cantidad + (imp.doc.tipo==='factura' ? ' (recibidas ' + (f.lote.recibidas||0) + ')' : '')) : 'sin lote'"
                            :style="f.estado==='diferencia' ? 'color:var(--orange)' : ''"></td>
                        <td>
                          <select class="form-select" x-model="f.accion" style="font-size:14px" :disabled="imp.modo==='terminar'">
                            <template x-for="o in f.opciones" :key="o.valor"><option :value="o.valor" x-text="o.etiqueta"></option></template>
                          </select>
                          <div x-show="efectoFila(f).aviso" style="color:var(--red);font-size:12px;margin-top:4px" x-text="efectoFila(f).aviso"></div>
                        </td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>
            </template>
            <label x-show="imp.doc.tipo==='factura' && imp.modo!=='bloqueado'" style="display:flex;gap:8px;align-items:center;margin-top:12px;font-size:14px">
              <input type="checkbox" x-model="imp.entregaInmediata">
              Pasar a "Entrega Inmediata" las figuras de la página que llegaron en esta factura
            </label>
          </div>
        </template>
        <template x-if="imp.paso==='resultado'"><div style="font-size:14px;color:var(--green)" x-text="imp.resultado"></div></template>
        <div x-show="imp.error" style="color:var(--red);font-size:14px;margin-top:10px" x-text="imp.error"></div>
      </div>
      <div class="modal-footer">
        <button class="btn-sm btn-ghost" @click="imp.abierto=false" :disabled="imp.aplicando" x-text="imp.paso==='resultado' ? 'Cerrar' : 'Cancelar'"></button>
        <button class="btn-sm btn-purple" x-show="imp.paso==='revision' && imp.modo!=='bloqueado'" :disabled="imp.aplicando" @click="aplicarImportacion()"
                x-text="imp.aplicando ? 'Aplicando...' : 'Aplicar'"></button>
      </div>
    </div>
  </div>
</template>
```

Antes de pegarlo, confirmar los nombres reales de las clases del modal existente de "Nuevo lote" (`grep -n "modal" sistema.html`) y usar esas mismas.

- [ ] **Step 6: Bump de versión** de `sistema-db.js?v=` en `sistema.html` (por ejemplo `20260923d`).

- [ ] **Step 7: Verificar la sintaxis de los scripts inline**

```bash
node -e "const s=require('fs').readFileSync('sistema.html','utf8');const re=/<script(?![^>]*\bsrc=)(?![^>]*type=\"module\")[^>]*>([\s\S]*?)<\/script>/g;let m;while((m=re.exec(s)))new Function(m[1]);console.log('ok')"
```
Expected: `ok`.

- [ ] **Step 8: Commit**

```bash
git add sistema.html
git commit -m "feat: importar documento Sideshow en Lotes (revision, aplicar, recibidas)"
```

---

### Task 7: Prueba en Chrome, publicación y verificación

**Files:** ninguno del repo (scripts de prueba en el scratchpad).

- [ ] **Step 1: Prueba en Chrome con datos simulados** (puppeteer-core + Chrome instalado; mismo método que las pruebas anteriores: se interceptan `sistema-db.js`, agregando stubs en memoria de `dbGetLotes`, `dbCreateLote`, `dbUpdateLote`, `dbGetCatalogoLiviano`, `dbGetDocumentoProveedor`, `dbGuardarDocumentoProveedor`, `dbActualizarResumenDocumento` y `dbSyncStockCatalogoLote`, y `sistema.html`; `sideshow-doc.js` y pdf.js se cargan de verdad). Casos:
  1. Subir el `.eml` real → 21 filas. Scarecrow (lote 3) en "Faltan"; figuras sin lote en "Crear lote" o "Crear y vincular". Aplicar → los efectos llegan a los stubs, un solo llamado a `dbSyncStockCatalogoLote`.
  2. Subir el mismo `.eml` de nuevo → aviso "ya se importó" y sin botón Aplicar.
  3. Simular una falla en el 5º `dbUpdateLote`, reintentar → modo "terminar" con solo las pendientes.
  4. Subir el PDF real → 12 filas, número `00328836-0`.
  5. Pegar texto sin sentido → "No encontré figuras de Sideshow en este documento".
  6. Captura en 400px y 1200px, y 0 errores de JS.

- [ ] **Step 2: Publicar** (`git fetch origin main && git pull --rebase origin main && git push origin main`) y esperar el deploy.

- [ ] **Step 3: Verificar producción:** `curl -sL https://uvstore.shop/sistema` contiene "Importar documento Sideshow"; `https://uvstore.shop/sideshow-doc.js?v=20260923` responde 200; `https://uvstore.shop/api/stock-sync` responde 401 sin sesión.

- [ ] **Step 4: Actualizar la memoria** `project_lotes_stock_catalogo.md` (o una nueva `project_importar_sideshow.md`) con el estado y lo que falta probar en vivo con la sesión del usuario.
