# Sistema de Gestión UV Store — Plan A: Foundation + CRUD

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation of the UV Store management system — auth, navigation, and full CRUD for clientes, órdenes, and pagos — as a working web app deployable on Cloudflare Pages.

**Architecture:** Three files: `sistema.html` (Alpine.js SPA with all HTML + inline styles), `sistema-db.js` (Supabase client + all CRUD operations), `sistema-pagos.js` (payment registration logic). Supabase handles auth and PostgreSQL. Navigation uses `currentView` state variable with `x-show` directives.

**Tech Stack:** Alpine.js 3 (CDN), Supabase JS v2 (CDN), Cloudflare Pages

**Spec:** `docs/superpowers/specs/2026-05-04-sistema-gestion-design.md`

---

## File Map

| File | Responsibility |
|---|---|
| `sistema.html` | Full SPA — HTML structure, CSS, Alpine.js init, all views |
| `sistema-db.js` | Supabase client, auth helpers, CRUD for clientes/ordenes/pagos |

---

## Task 1: Supabase — Crear proyecto y tablas

**Files:**
- No files to create — work done in Supabase dashboard

- [ ] **1.1 Crear proyecto Supabase**

  Ir a https://supabase.com → New project → nombre: `uvstore-sistema` → región: us-east-1 → generar password → crear.

  Guardar:
  - Project URL: `https://xxxx.supabase.co`
  - Anon public key: `eyJ...`

- [ ] **1.2 Crear tablas — ir a SQL Editor en Supabase y ejecutar:**

```sql
-- Clientes
CREATE TABLE clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  whatsapp text,
  notas text,
  created_at timestamptz DEFAULT now()
);

-- Ordenes
CREATE TABLE ordenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid REFERENCES clientes(id) ON DELETE SET NULL,
  producto text NOT NULL,
  codigo text DEFAULT '',
  marca text DEFAULT '',
  escala text DEFAULT '',
  pedido text DEFAULT '',
  precio_original numeric DEFAULT 0,
  envio numeric DEFAULT 0,
  envio_mbe numeric DEFAULT 0,
  impuesto numeric DEFAULT 0,
  aduana numeric DEFAULT 0,
  arancel numeric DEFAULT 0,
  precio_venta_usd numeric DEFAULT 0,
  precio_venta_gtq numeric DEFAULT 0,
  estado text DEFAULT 'reservada',
  notas text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- Pagos
CREATE TABLE pagos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id uuid REFERENCES ordenes(id) ON DELETE CASCADE,
  monto numeric NOT NULL,
  tipo text NOT NULL,
  metodo text NOT NULL,
  fecha date DEFAULT CURRENT_DATE,
  notas text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
```

- [ ] **1.3 Habilitar Row Level Security y políticas:**

```sql
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_clientes" ON clientes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_ordenes" ON ordenes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_pagos" ON pagos FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

- [ ] **1.4 Crear usuario en Supabase**

  Authentication → Users → Invite user → ingresar el email que usarás para el sistema → Create.
  
  Entrar al email y confirmar la cuenta, setear contraseña.

- [ ] **1.5 Commit**

```bash
git add docs/superpowers/plans/2026-05-04-sistema-gestion-parte-a.md
git commit -m "plan: sistema de gestión parte A — foundation + CRUD"
```

---

## Task 2: sistema-db.js — Cliente Supabase + helpers

**Files:**
- Create: `sistema-db.js`

- [ ] **2.1 Crear `sistema-db.js`**

  Reemplazar `TU_SUPABASE_URL` y `TU_ANON_KEY` con los valores del proyecto Supabase creado en Task 1.

```javascript
// sistema-db.js
const { createClient } = supabase;

const SUPABASE_URL = 'TU_SUPABASE_URL';
const SUPABASE_KEY = 'TU_ANON_KEY';

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── AUTH ──────────────────────────────────────────────────────────────
async function dbSignIn(email, password) {
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

async function dbSignOut() {
  await db.auth.signOut();
}

async function dbGetSession() {
  const { data } = await db.auth.getSession();
  return data.session;
}

// ── CLIENTES ──────────────────────────────────────────────────────────
async function dbGetClientes() {
  const { data, error } = await db.from('clientes').select('*').order('nombre');
  if (error) throw error;
  return data;
}

async function dbGetCliente(id) {
  const { data, error } = await db.from('clientes').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

async function dbSaveCliente(cliente) {
  if (cliente.id) {
    const { id, created_at, ...fields } = cliente;
    const { data, error } = await db.from('clientes').update(fields).eq('id', id).select().single();
    if (error) throw error;
    return data;
  } else {
    const { id, created_at, ...fields } = cliente;
    const { data, error } = await db.from('clientes').insert(fields).select().single();
    if (error) throw error;
    return data;
  }
}

async function dbDeleteCliente(id) {
  const { error } = await db.from('clientes').delete().eq('id', id);
  if (error) throw error;
}

// ── ORDENES ───────────────────────────────────────────────────────────
async function dbGetOrdenes() {
  const { data, error } = await db
    .from('ordenes')
    .select('*, clientes(nombre)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function dbGetOrden(id) {
  const { data, error } = await db
    .from('ordenes')
    .select('*, clientes(nombre, whatsapp)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

async function dbSaveOrden(orden) {
  if (orden.id) {
    const { id, created_at, clientes, ...fields } = orden;
    const { data, error } = await db.from('ordenes').update(fields).eq('id', id).select().single();
    if (error) throw error;
    return data;
  } else {
    const { id, created_at, clientes, ...fields } = orden;
    const { data, error } = await db.from('ordenes').insert(fields).select().single();
    if (error) throw error;
    return data;
  }
}

async function dbDeleteOrden(id) {
  const { error } = await db.from('ordenes').delete().eq('id', id);
  if (error) throw error;
}

async function dbGetOrdenesByCliente(clienteId) {
  const { data, error } = await db
    .from('ordenes')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// ── PAGOS ─────────────────────────────────────────────────────────────
async function dbGetPagosByOrden(ordenId) {
  const { data, error } = await db
    .from('pagos')
    .select('*')
    .eq('orden_id', ordenId)
    .order('fecha', { ascending: false });
  if (error) throw error;
  return data;
}

async function dbSavePago(pago) {
  const { id, created_at, ...fields } = pago;
  const { data, error } = await db.from('pagos').insert(fields).select().single();
  if (error) throw error;
  return data;
}

async function dbDeletePago(id) {
  const { error } = await db.from('pagos').delete().eq('id', id);
  if (error) throw error;
}

async function dbGetUltimosPagos(limit = 10) {
  const { data, error } = await db
    .from('pagos')
    .select('*, ordenes(producto, clientes(nombre))')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// ── HELPERS ───────────────────────────────────────────────────────────
function calcCostoEstimado(orden) {
  return (
    (orden.precio_original || 0) +
    (orden.envio || 0) +
    (orden.envio_mbe || 0) +
    (orden.impuesto || 0) +
    (orden.aduana || 0) +
    (orden.arancel || 0)
  );
}

function calcAbonado(pagos) {
  return pagos.reduce((sum, p) => sum + (p.monto || 0), 0);
}

function calcSaldo(orden, pagos) {
  return (orden.precio_venta_gtq || 0) - calcAbonado(pagos);
}

function fmtQ(n) {
  return 'Q' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
```

- [ ] **2.2 Verificar en navegador**

  Abrir la consola del navegador en cualquier página del repo. Ejecutar:
  ```javascript
  // Esto no se puede testear aún sin el HTML — continuar al Task 3
  ```

- [ ] **2.3 Commit**

```bash
git add sistema-db.js
git commit -m "feat: sistema-db.js — supabase client + CRUD clientes/ordenes/pagos"
```

---

## Task 3: sistema.html — Estructura base + auth

**Files:**
- Create: `sistema.html`

- [ ] **3.1 Crear `sistema.html` con estructura base, estilos y pantalla de login**

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>UV Store — Sistema</title>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js" defer></script>
<script src="sistema-db.js"></script>
<style>
:root{
  --bg:#07080d;--bg2:#0d0e18;--bg3:#13141f;--bg4:#1a1b28;
  --purple:#7B2FBE;--pl:#9d5cd4;
  --border:#1c1d2c;--border2:#272840;
  --text:#ecedf8;--muted:#525568;--muted2:#848aa0;
  --green:#2fc76e;--red:#e63946;--gold:#C8963E;
  --nav-h:60px;--sidebar-w:220px;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{background:var(--bg);overflow-x:hidden}
body{
  background:var(--bg);color:var(--text);
  font-family:"Segoe UI",system-ui,sans-serif;
  min-height:100dvh;
  -webkit-tap-highlight-color:transparent;
}
button,a{touch-action:manipulation;cursor:pointer}

/* ── LOGIN ── */
.login-wrap{
  min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;
}
.login-card{
  background:var(--bg2);border:1px solid var(--border2);border-radius:16px;
  padding:40px 32px;width:100%;max-width:380px;
}
.login-logo{font-size:22px;font-weight:700;letter-spacing:2px;color:#fff;margin-bottom:8px;}
.login-logo span{color:var(--pl);}
.login-sub{font-size:13px;color:var(--muted2);margin-bottom:32px;}
.form-group{margin-bottom:18px;}
.form-label{display:block;font-size:12px;font-weight:600;color:var(--muted2);
  letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px;}
.form-input{
  width:100%;background:var(--bg3);border:1px solid var(--border2);
  border-radius:8px;padding:11px 14px;color:var(--text);
  font-size:15px;font-family:inherit;outline:none;
  transition:border-color .15s;
}
.form-input:focus{border-color:var(--purple);}
.btn-primary{
  width:100%;background:var(--purple);color:#fff;border:none;
  border-radius:8px;padding:12px;font-size:15px;font-weight:600;
  font-family:inherit;transition:background .15s;
}
.btn-primary:hover{background:var(--pl);}
.btn-primary:active{transform:scale(.98);}
.btn-primary:disabled{opacity:.5;cursor:not-allowed;}
.error-msg{font-size:13px;color:var(--red);margin-top:12px;text-align:center;}

/* ── APP SHELL ── */
.app{display:flex;min-height:100dvh;}

/* Sidebar desktop */
.sidebar{
  width:var(--sidebar-w);background:var(--bg2);border-right:1px solid var(--border);
  position:fixed;top:0;left:0;bottom:0;z-index:100;
  display:flex;flex-direction:column;padding:24px 0;
}
.sidebar-logo{padding:0 20px 24px;font-size:18px;font-weight:700;
  letter-spacing:2px;color:#fff;border-bottom:1px solid var(--border);}
.sidebar-logo span{color:var(--pl);}
.sidebar-nav{flex:1;padding:16px 8px;}
.nav-item{
  display:flex;align-items:center;gap:10px;padding:10px 12px;
  border-radius:8px;color:var(--muted2);font-size:14px;font-weight:500;
  margin-bottom:2px;border:none;background:none;width:100%;text-align:left;
  transition:background .15s,color .15s;
}
.nav-item:hover,.nav-item.active{background:rgba(123,47,190,.15);color:#fff;}
.nav-item.active{color:var(--pl);}
.nav-item svg{width:18px;height:18px;flex-shrink:0;stroke:currentColor;
  stroke-width:1.8;fill:none;stroke-linecap:round;stroke-linejoin:round;}
.sidebar-footer{padding:16px 20px;border-top:1px solid var(--border);}
.btn-logout{background:none;border:1px solid var(--border2);color:var(--muted2);
  border-radius:8px;padding:8px 16px;font-size:13px;font-family:inherit;width:100%;
  transition:color .15s,border-color .15s;}
.btn-logout:hover{color:var(--red);border-color:var(--red);}

/* Main content */
.main{margin-left:var(--sidebar-w);flex:1;min-height:100dvh;}
.page-header{
  padding:28px 32px 0;display:flex;align-items:center;
  justify-content:space-between;gap:16px;margin-bottom:24px;
}
.page-title{font-size:22px;font-weight:700;color:#fff;}
.page-body{padding:0 32px 40px;}

/* ── MOBILE NAV ── */
.mobile-nav{
  display:none;position:fixed;bottom:0;left:0;right:0;z-index:100;
  background:var(--bg2);border-top:1px solid var(--border);
  padding:6px 0 max(6px,env(safe-area-inset-bottom));
}
.mobile-nav-item{
  flex:1;display:flex;flex-direction:column;align-items:center;
  gap:3px;min-height:44px;padding:6px 2px;
  border:none;background:none;color:var(--muted2);
  font-size:9.5px;font-weight:500;font-family:inherit;
  transition:color .15s;
}
.mobile-nav-item.active{color:var(--pl);}
.mobile-nav-item svg{width:21px;height:21px;stroke:currentColor;
  stroke-width:1.8;fill:none;stroke-linecap:round;stroke-linejoin:round;}

/* ── CARDS / TABLES ── */
.card{background:var(--bg2);border:1px solid var(--border);border-radius:12px;overflow:hidden;}
.card-header{padding:16px 20px;border-bottom:1px solid var(--border);
  display:flex;align-items:center;justify-content:space-between;}
.card-title{font-size:14px;font-weight:600;color:#fff;}
.table{width:100%;border-collapse:collapse;}
.table th{padding:10px 16px;font-size:11px;font-weight:600;
  color:var(--muted2);text-transform:uppercase;letter-spacing:.5px;
  text-align:left;border-bottom:1px solid var(--border);}
.table td{padding:12px 16px;font-size:14px;border-bottom:1px solid var(--border);}
.table tr:last-child td{border-bottom:none;}
.table tr:hover td{background:rgba(255,255,255,.02);}
.badge{
  display:inline-block;padding:3px 8px;border-radius:20px;
  font-size:11px;font-weight:600;letter-spacing:.3px;
}
.badge-reservada{background:rgba(123,47,190,.2);color:var(--pl);}
.badge-en_proceso{background:rgba(232,146,42,.15);color:#E8922A;}
.badge-pagada{background:rgba(47,199,110,.15);color:var(--green);}
.badge-entregada{background:rgba(82,85,104,.2);color:var(--muted2);}

/* ── FORMS ── */
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;}
.form-row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px;}
.form-row-1{margin-bottom:16px;}
.form-select{
  width:100%;background:var(--bg3);border:1px solid var(--border2);
  border-radius:8px;padding:11px 14px;color:var(--text);
  font-size:15px;font-family:inherit;outline:none;
  transition:border-color .15s;appearance:none;
}
.form-select:focus,.form-input:focus{border-color:var(--purple);}
.form-textarea{
  width:100%;background:var(--bg3);border:1px solid var(--border2);
  border-radius:8px;padding:11px 14px;color:var(--text);
  font-size:15px;font-family:inherit;outline:none;resize:vertical;min-height:80px;
  transition:border-color .15s;
}
.calc-field{
  background:var(--bg);border:1px solid var(--border);border-radius:8px;
  padding:11px 14px;font-size:15px;color:var(--gold);font-weight:600;
}

/* ── BUTTONS ── */
.btn-sm{
  padding:7px 14px;border-radius:7px;font-size:13px;font-weight:600;
  font-family:inherit;border:none;transition:background .15s,transform .08s;
}
.btn-sm:active{transform:scale(.97);}
.btn-purple{background:var(--purple);color:#fff;}
.btn-purple:hover{background:var(--pl);}
.btn-ghost{background:var(--bg3);color:var(--muted2);border:1px solid var(--border2);}
.btn-ghost:hover{color:#fff;border-color:var(--border3);}
.btn-danger{background:rgba(230,57,70,.15);color:var(--red);border:1px solid rgba(230,57,70,.3);}
.btn-danger:hover{background:var(--red);color:#fff;}

/* ── SEARCH ── */
.search-bar{
  display:flex;align-items:center;gap:8px;background:var(--bg3);
  border:1px solid var(--border2);border-radius:8px;padding:8px 14px;
  flex:1;max-width:360px;
}
.search-bar input{
  background:none;border:none;outline:none;color:var(--text);
  font-size:14px;font-family:inherit;flex:1;min-width:0;
}
.search-bar svg{width:15px;height:15px;stroke:var(--muted);
  stroke-width:2;fill:none;flex-shrink:0;}

/* ── STAT CARDS ── */
.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px;}
.stat-card{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:20px;}
.stat-label{font-size:11px;font-weight:600;color:var(--muted2);
  text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;}
.stat-value{font-size:22px;font-weight:700;color:#fff;}
.stat-value.green{color:var(--green);}
.stat-value.purple{color:var(--pl);}
.stat-value.gold{color:var(--gold);}

/* ── MODAL ── */
.modal-bg{
  display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);
  z-index:500;align-items:flex-start;justify-content:center;
  padding:20px;overflow-y:auto;
}
.modal-bg.open{display:flex;}
.modal{
  background:var(--bg2);border:1px solid var(--border2);border-radius:16px;
  max-width:640px;width:100%;margin:auto;padding:28px;position:relative;
}
.modal-title{font-size:18px;font-weight:700;color:#fff;margin-bottom:24px;}
.modal-close{
  position:absolute;top:16px;right:16px;background:none;border:none;
  color:var(--muted2);font-size:18px;line-height:1;
}
.modal-close:hover{color:#fff;}
.modal-footer{display:flex;gap:10px;justify-content:flex-end;margin-top:24px;}

/* ── EMPTY STATE ── */
.empty{text-align:center;padding:48px 24px;color:var(--muted2);}
.empty svg{width:40px;height:40px;margin:0 auto 12px;stroke:var(--border2);
  stroke-width:1.5;fill:none;}

/* ── RESPONSIVE ── */
@media(max-width:768px){
  .sidebar{display:none;}
  .main{margin-left:0;padding-bottom:calc(68px + env(safe-area-inset-bottom));}
  .mobile-nav{display:flex;}
  .page-header{padding:20px 16px 0;}
  .page-body{padding:0 16px 24px;}
  .stats-grid{grid-template-columns:repeat(2,1fr);gap:12px;}
  .form-row{grid-template-columns:1fr;}
  .form-row-3{grid-template-columns:1fr;}
}
</style>
</head>
<body>

<!-- ══ LOGIN ══════════════════════════════════════════════════════════ -->
<div x-data="uvLogin()" x-show="!session" class="login-wrap">
  <div class="login-card">
    <div class="login-logo">UV <span>STORE</span> GT</div>
    <div class="login-sub">Sistema de Gestión</div>
    <div class="form-group">
      <label class="form-label">Email</label>
      <input class="form-input" type="email" x-model="email" @keydown.enter="login()"
        placeholder="tu@email.com" autocomplete="email" style="font-size:16px">
    </div>
    <div class="form-group">
      <label class="form-label">Contraseña</label>
      <input class="form-input" type="password" x-model="password" @keydown.enter="login()"
        placeholder="••••••••" autocomplete="current-password" style="font-size:16px">
    </div>
    <button class="btn-primary" @click="login()" :disabled="loading">
      <span x-text="loading ? 'Ingresando...' : 'Ingresar'"></span>
    </button>
    <div class="error-msg" x-show="error" x-text="error"></div>
  </div>
</div>

<!-- ══ APP ════════════════════════════════════════════════════════════ -->
<div x-data="uvApp()" x-show="session" class="app" x-cloak>

  <!-- SIDEBAR -->
  <aside class="sidebar">
    <div class="sidebar-logo">UV <span>STORE</span></div>
    <nav class="sidebar-nav">
      <button class="nav-item" :class="{active: view==='dashboard'}" @click="goTo('dashboard')">
        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Dashboard
      </button>
      <button class="nav-item" :class="{active: view==='ordenes'||view==='detalle-orden'||view==='nueva-orden'}" @click="goTo('ordenes')">
        <svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>
        Órdenes
      </button>
      <button class="nav-item" :class="{active: view==='clientes'||view==='detalle-cliente'||view==='nuevo-cliente'}" @click="goTo('clientes')">
        <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Clientes
      </button>
    </nav>
    <div class="sidebar-footer">
      <button class="btn-logout" @click="logout()">Cerrar sesión</button>
    </div>
  </aside>

  <!-- MAIN -->
  <main class="main">
    <!-- Vista: Dashboard -->
    <div x-show="view==='dashboard'">
      <div class="page-header"><h1 class="page-title">Dashboard</h1></div>
      <div class="page-body" x-data="uvDashboard()">
        <!-- contenido en Task 8 -->
        <p style="color:var(--muted2)">Dashboard — próximamente</p>
      </div>
    </div>

    <!-- Vista: Lista Órdenes -->
    <div x-show="view==='ordenes'" x-data="uvOrdenes()">
      <div class="page-header">
        <h1 class="page-title">Órdenes</h1>
        <button class="btn-sm btn-purple" @click="$dispatch('open-nueva-orden')">+ Nueva orden</button>
      </div>
      <div class="page-body">
        <!-- Filtros y búsqueda -->
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;align-items:center">
          <div class="search-bar">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="text" placeholder="Buscar figura o cliente..." x-model="busqueda" style="font-size:16px">
          </div>
          <select class="form-select" x-model="filtroEstado" style="width:auto;max-width:160px;padding:8px 12px;font-size:14px">
            <option value="">Todos los estados</option>
            <option value="reservada">Reservada</option>
            <option value="en_proceso">En proceso</option>
            <option value="pagada">Pagada</option>
            <option value="entregada">Entregada</option>
          </select>
        </div>

        <!-- Tabla -->
        <div class="card">
          <div x-show="loading" style="padding:32px;text-align:center;color:var(--muted2)">Cargando...</div>
          <div x-show="!loading && ordenesFiltradas.length===0" class="empty">
            <svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
            <p>No hay órdenes</p>
          </div>
          <div x-show="!loading && ordenesFiltradas.length>0" style="overflow-x:auto">
            <table class="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cliente</th>
                  <th>Precio</th>
                  <th>Abonado</th>
                  <th>Saldo</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <template x-for="o in ordenesFiltradas" :key="o.id">
                  <tr>
                    <td>
                      <div x-text="o.producto" style="font-weight:500;color:#fff"></div>
                      <div x-text="o.marca" style="font-size:12px;color:var(--muted2)"></div>
                    </td>
                    <td x-text="o.clientes?.nombre || '—'" style="color:var(--muted2)"></td>
                    <td x-text="fmtQ(o.precio_venta_gtq)"></td>
                    <td x-text="fmtQ(o._abonado)" style="color:var(--green)"></td>
                    <td x-text="fmtQ(o._saldo)" :style="o._saldo>0?'color:var(--red)':''"></td>
                    <td><span class="badge" :class="'badge-'+o.estado" x-text="o.estado.replace('_',' ')"></span></td>
                    <td>
                      <button class="btn-sm btn-ghost" @click="verOrden(o.id)">Ver</button>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Vista: Detalle Orden -->
    <div x-show="view==='detalle-orden'" x-data="uvDetalleOrden()">
      <!-- Contenido en Task 5 -->
    </div>

    <!-- Vista: Lista Clientes -->
    <div x-show="view==='clientes'" x-data="uvClientes()">
      <div class="page-header">
        <h1 class="page-title">Clientes</h1>
        <button class="btn-sm btn-purple" @click="abrirFormCliente()">+ Nuevo cliente</button>
      </div>
      <div class="page-body">
        <div style="margin-bottom:20px">
          <div class="search-bar">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="text" placeholder="Buscar cliente..." x-model="busqueda" style="font-size:16px">
          </div>
        </div>
        <div class="card">
          <div x-show="loading" style="padding:32px;text-align:center;color:var(--muted2)">Cargando...</div>
          <div x-show="!loading && clientesFiltrados.length===0" class="empty">
            <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            <p>No hay clientes</p>
          </div>
          <div x-show="!loading && clientesFiltrados.length>0">
            <table class="table">
              <thead><tr><th>Nombre</th><th>WhatsApp</th><th></th></tr></thead>
              <tbody>
                <template x-for="c in clientesFiltrados" :key="c.id">
                  <tr>
                    <td x-text="c.nombre" style="color:#fff;font-weight:500"></td>
                    <td x-text="c.whatsapp||'—'" style="color:var(--muted2)"></td>
                    <td style="display:flex;gap:8px">
                      <button class="btn-sm btn-ghost" @click="editarCliente(c)">Editar</button>
                      <button class="btn-sm btn-danger" @click="eliminarCliente(c.id)">Eliminar</button>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

  </main>

  <!-- MOBILE NAV -->
  <nav class="mobile-nav">
    <button class="mobile-nav-item" :class="{active:view==='dashboard'}" @click="goTo('dashboard')">
      <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
      Dashboard
    </button>
    <button class="mobile-nav-item" :class="{active:view==='ordenes'||view==='detalle-orden'}" @click="goTo('ordenes')">
      <svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
      Órdenes
    </button>
    <button class="mobile-nav-item" :class="{active:view==='clientes'||view==='detalle-cliente'}" @click="goTo('clientes')">
      <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
      Clientes
    </button>
  </nav>

</div>

<script>
// ── AUTH ──────────────────────────────────────────────────────────────
function uvLogin() {
  return {
    session: null,
    email: '', password: '', loading: false, error: '',
    async init() {
      this.session = await dbGetSession();
      document.addEventListener('session-changed', (e) => { this.session = e.detail; });
    },
    async login() {
      this.loading = true; this.error = '';
      try {
        this.session = await dbSignIn(this.email, this.password);
        document.dispatchEvent(new CustomEvent('session-changed', { detail: this.session }));
      } catch(e) {
        this.error = 'Email o contraseña incorrectos';
      } finally { this.loading = false; }
    }
  };
}

function uvApp() {
  return {
    session: null,
    view: 'dashboard',
    async init() {
      this.session = await dbGetSession();
      document.addEventListener('session-changed', (e) => { this.session = e.detail; });
      document.addEventListener('go-to', (e) => { this.view = e.detail; });
      document.addEventListener('open-nueva-orden', () => { this.view = 'nueva-orden'; });
    },
    goTo(v) { this.view = v; },
    async logout() {
      await dbSignOut();
      this.session = null;
      document.dispatchEvent(new CustomEvent('session-changed', { detail: null }));
    }
  };
}

// ── ÓRDENES LIST ──────────────────────────────────────────────────────
function uvOrdenes() {
  return {
    ordenes: [], loading: true, busqueda: '', filtroEstado: '',
    async init() {
      await this.cargar();
    },
    async cargar() {
      this.loading = true;
      try {
        const data = await dbGetOrdenes();
        // calcular abonado y saldo por orden
        for (const o of data) {
          const pagos = await dbGetPagosByOrden(o.id);
          o._abonado = calcAbonado(pagos);
          o._saldo = calcSaldo(o, pagos);
        }
        this.ordenes = data;
      } finally { this.loading = false; }
    },
    get ordenesFiltradas() {
      return this.ordenes.filter(o => {
        const q = this.busqueda.toLowerCase();
        const matchQ = !q || o.producto?.toLowerCase().includes(q) || o.clientes?.nombre?.toLowerCase().includes(q);
        const matchE = !this.filtroEstado || o.estado === this.filtroEstado;
        return matchQ && matchE;
      });
    },
    verOrden(id) {
      document.dispatchEvent(new CustomEvent('ver-orden', { detail: id }));
      document.dispatchEvent(new CustomEvent('go-to', { detail: 'detalle-orden' }));
    },
    fmtQ
  };
}

// ── CLIENTES ──────────────────────────────────────────────────────────
function uvClientes() {
  return {
    clientes: [], loading: true, busqueda: '',
    formOpen: false, formData: {},
    async init() { await this.cargar(); },
    async cargar() {
      this.loading = true;
      try { this.clientes = await dbGetClientes(); }
      finally { this.loading = false; }
    },
    get clientesFiltrados() {
      const q = this.busqueda.toLowerCase();
      return !q ? this.clientes : this.clientes.filter(c => c.nombre.toLowerCase().includes(q));
    },
    abrirFormCliente(c = null) {
      this.formData = c ? { ...c } : { nombre: '', whatsapp: '', notas: '' };
      this.formOpen = true;
    },
    editarCliente(c) { this.abrirFormCliente(c); },
    async guardarCliente() {
      try {
        await dbSaveCliente(this.formData);
        this.formOpen = false;
        await this.cargar();
      } catch(e) { alert('Error: ' + e.message); }
    },
    async eliminarCliente(id) {
      if (!confirm('¿Eliminar este cliente?')) return;
      try { await dbDeleteCliente(id); await this.cargar(); }
      catch(e) { alert('Error: ' + e.message); }
    }
  };
}
</script>
</body>
</html>
```

- [ ] **3.2 Verificar en navegador**

  Abrir `sistema.html` directamente en el navegador (o via servidor local `npx serve .`).
  - Debe mostrar la pantalla de login
  - Ingresar con el email/contraseña del usuario Supabase creado en Task 1
  - Debe cambiar a la app con sidebar/nav
  - Cerrar sesión debe volver al login

- [ ] **3.3 Commit**

```bash
git add sistema.html
git commit -m "feat: sistema.html — auth + estructura base + clientes CRUD"
```

---

## Task 4: Modal formulario Cliente + CRUD completo

**Files:**
- Modify: `sistema.html` — agregar modal de formulario cliente

- [ ] **4.1 Agregar el modal de cliente dentro del div `x-data="uvApp()"`**

  Insertar antes del cierre del `</div>` del app shell (antes de `</body>`):

```html
<!-- MODAL CLIENTE -->
<div class="modal-bg" :class="{open: $store.clienteForm?.open}"
  x-data="{
    get open(){ return window._clienteFormOpen || false; }
  }">
```

  **Reemplazar** la función `uvClientes()` en el script por esta versión que incluye el modal inline (Alpine.js gestiona el estado dentro del componente):

```javascript
function uvClientes() {
  return {
    clientes: [], loading: true, busqueda: '',
    modal: false, guardando: false,
    form: { id: null, nombre: '', whatsapp: '', notas: '' },
    async init() { await this.cargar(); },
    async cargar() {
      this.loading = true;
      try { this.clientes = await dbGetClientes(); }
      finally { this.loading = false; }
    },
    get clientesFiltrados() {
      const q = this.busqueda.toLowerCase();
      return !q ? this.clientes : this.clientes.filter(c => c.nombre.toLowerCase().includes(q));
    },
    abrirFormCliente(c = null) {
      this.form = c
        ? { id: c.id, nombre: c.nombre, whatsapp: c.whatsapp||'', notas: c.notas||'' }
        : { id: null, nombre: '', whatsapp: '', notas: '' };
      this.modal = true;
    },
    async guardarCliente() {
      if (!this.form.nombre.trim()) { alert('El nombre es obligatorio'); return; }
      this.guardando = true;
      try {
        await dbSaveCliente(this.form);
        this.modal = false;
        await this.cargar();
      } catch(e) { alert('Error al guardar: ' + e.message); }
      finally { this.guardando = false; }
    },
    async eliminarCliente(id) {
      if (!confirm('¿Eliminar este cliente? También se eliminarán sus órdenes.')) return;
      try { await dbDeleteCliente(id); await this.cargar(); }
      catch(e) { alert('Error: ' + e.message); }
    }
  };
}
```

- [ ] **4.2 Agregar el HTML del modal dentro de la vista de clientes**

  Dentro de `<div x-show="view==='clientes'" x-data="uvClientes()">`, al final (antes del cierre del div):

```html
<!-- Modal Form Cliente -->
<div class="modal-bg" :class="{open: modal}" @click.self="modal=false">
  <div class="modal">
    <button class="modal-close" @click="modal=false">✕</button>
    <div class="modal-title" x-text="form.id ? 'Editar cliente' : 'Nuevo cliente'"></div>
    <div class="form-row-1">
      <label class="form-label">Nombre *</label>
      <input class="form-input" type="text" x-model="form.nombre" placeholder="Nombre completo" style="font-size:16px">
    </div>
    <div class="form-row-1">
      <label class="form-label">WhatsApp</label>
      <input class="form-input" type="tel" x-model="form.whatsapp" placeholder="+502 1234 5678" style="font-size:16px">
    </div>
    <div class="form-row-1">
      <label class="form-label">Notas</label>
      <textarea class="form-textarea" x-model="form.notas" placeholder="Notas internas..."></textarea>
    </div>
    <div class="modal-footer">
      <button class="btn-sm btn-ghost" @click="modal=false">Cancelar</button>
      <button class="btn-sm btn-purple" @click="guardarCliente()" :disabled="guardando">
        <span x-text="guardando ? 'Guardando...' : 'Guardar'"></span>
      </button>
    </div>
  </div>
</div>
```

- [ ] **4.3 Verificar CRUD de clientes**

  - Crear un cliente nuevo → aparece en la lista
  - Editar el cliente → cambios se guardan
  - Eliminar el cliente → desaparece de la lista
  - Buscar por nombre → filtra correctamente

- [ ] **4.4 Commit**

```bash
git add sistema.html
git commit -m "feat: clientes — CRUD completo con modal"
```

---

## Task 5: Módulo Órdenes — Formulario + Detalle

**Files:**
- Modify: `sistema.html`

- [ ] **5.1 Agregar función `uvNuevaOrden()` en el script**

```javascript
function uvNuevaOrden() {
  return {
    clientes: [], guardando: false,
    form: {
      id: null, cliente_id: '', producto: '', codigo: '', marca: '',
      escala: '', pedido: '', precio_original: 0, envio: 0, envio_mbe: 0,
      impuesto: 0, aduana: 0, arancel: 0, precio_venta_usd: 0,
      precio_venta_gtq: 0, estado: 'reservada', notas: ''
    },
    get costoEstimado() {
      return calcCostoEstimado(this.form);
    },
    get gananciaEstimada() {
      return (this.form.precio_venta_gtq || 0) - this.costoEstimado;
    },
    async init() {
      this.clientes = await dbGetClientes();
      // Si hay una orden para editar, cargarla
      document.addEventListener('editar-orden', async (e) => {
        const o = await dbGetOrden(e.detail);
        this.form = { ...o };
      });
    },
    async guardar() {
      if (!this.form.producto.trim()) { alert('El producto es obligatorio'); return; }
      this.guardando = true;
      try {
        await dbSaveOrden(this.form);
        document.dispatchEvent(new CustomEvent('go-to', { detail: 'ordenes' }));
        document.dispatchEvent(new CustomEvent('recargar-ordenes'));
      } catch(e) { alert('Error: ' + e.message); }
      finally { this.guardando = false; }
    },
    fmtQ
  };
}
```

- [ ] **5.2 Agregar vista nueva-orden en el HTML (dentro del div del app)**

  Insertar antes del cierre del `</main>`:

```html
<!-- Vista: Nueva / Editar Orden -->
<div x-show="view==='nueva-orden'" x-data="uvNuevaOrden()">
  <div class="page-header">
    <h1 class="page-title" x-text="form.id ? 'Editar orden' : 'Nueva orden'"></h1>
    <button class="btn-sm btn-ghost" @click="$dispatch('go-to','ordenes')">← Volver</button>
  </div>
  <div class="page-body">
    <div style="max-width:720px">

      <div style="margin-bottom:24px">
        <div class="card-title" style="margin-bottom:16px;font-size:16px">Producto</div>
        <div class="form-row">
          <div><label class="form-label">Nombre del producto *</label>
            <input class="form-input" type="text" x-model="form.producto" placeholder="Ej: Batman Arkham Origins" style="font-size:16px"></div>
          <div><label class="form-label">Código</label>
            <input class="form-input" type="text" x-model="form.codigo" placeholder="Código opcional" style="font-size:16px"></div>
        </div>
        <div class="form-row">
          <div><label class="form-label">Marca</label>
            <input class="form-input" type="text" x-model="form.marca" placeholder="Hot Toys, Iron Studios..." style="font-size:16px"></div>
          <div><label class="form-label">Escala</label>
            <input class="form-input" type="text" x-model="form.escala" placeholder="1:6, 1:12..." style="font-size:16px"></div>
        </div>
        <div class="form-row">
          <div><label class="form-label">Pedido / Proveedor</label>
            <input class="form-input" type="text" x-model="form.pedido" placeholder="ebay, gundam, lts..." style="font-size:16px"></div>
          <div><label class="form-label">Cliente</label>
            <select class="form-select" x-model="form.cliente_id" style="font-size:16px">
              <option value="">Sin asignar</option>
              <template x-for="c in clientes" :key="c.id">
                <option :value="c.id" x-text="c.nombre"></option>
              </template>
            </select></div>
        </div>
      </div>

      <div style="margin-bottom:24px">
        <div class="card-title" style="margin-bottom:16px;font-size:16px">Costos (USD)</div>
        <div class="form-row-3">
          <div><label class="form-label">Precio original</label>
            <input class="form-input" type="number" x-model.number="form.precio_original" step="0.01" style="font-size:16px"></div>
          <div><label class="form-label">Envío</label>
            <input class="form-input" type="number" x-model.number="form.envio" step="0.01" style="font-size:16px"></div>
          <div><label class="form-label">Envío MBE</label>
            <input class="form-input" type="number" x-model.number="form.envio_mbe" step="0.01" style="font-size:16px"></div>
        </div>
        <div class="form-row-3">
          <div><label class="form-label">Impuesto</label>
            <input class="form-input" type="number" x-model.number="form.impuesto" step="0.01" style="font-size:16px"></div>
          <div><label class="form-label">Aduana</label>
            <input class="form-input" type="number" x-model.number="form.aduana" step="0.01" style="font-size:16px"></div>
          <div><label class="form-label">Arancel</label>
            <input class="form-input" type="number" x-model.number="form.arancel" step="0.01" style="font-size:16px"></div>
        </div>
        <div class="form-row-1">
          <label class="form-label">Costo estimado (calculado)</label>
          <div class="calc-field" x-text="fmtQ(costoEstimado)"></div>
        </div>
      </div>

      <div style="margin-bottom:24px">
        <div class="card-title" style="margin-bottom:16px;font-size:16px">Precios de venta</div>
        <div class="form-row">
          <div><label class="form-label">Precio venta USD</label>
            <input class="form-input" type="number" x-model.number="form.precio_venta_usd" step="0.01" style="font-size:16px"></div>
          <div><label class="form-label">Precio venta GTQ</label>
            <input class="form-input" type="number" x-model.number="form.precio_venta_gtq" step="0.01" style="font-size:16px"></div>
        </div>
        <div class="form-row-1">
          <label class="form-label">Ganancia estimada (calculada)</label>
          <div class="calc-field" x-text="fmtQ(gananciaEstimada)"></div>
        </div>
      </div>

      <div style="margin-bottom:24px">
        <div class="form-row">
          <div><label class="form-label">Estado</label>
            <select class="form-select" x-model="form.estado" style="font-size:16px">
              <option value="reservada">Reservada</option>
              <option value="en_proceso">En proceso</option>
              <option value="pagada">Pagada</option>
              <option value="entregada">Entregada</option>
            </select></div>
        </div>
        <div class="form-row-1">
          <label class="form-label">Notas</label>
          <textarea class="form-textarea" x-model="form.notas" placeholder="Notas internas..."></textarea>
        </div>
      </div>

      <div style="display:flex;gap:12px">
        <button class="btn-sm btn-ghost" @click="$dispatch('go-to','ordenes')">Cancelar</button>
        <button class="btn-sm btn-purple" style="padding:10px 24px" @click="guardar()" :disabled="guardando">
          <span x-text="guardando ? 'Guardando...' : 'Guardar orden'"></span>
        </button>
      </div>
    </div>
  </div>
</div>
```

- [ ] **5.3 Agregar función `uvDetalleOrden()` en el script**

```javascript
function uvDetalleOrden() {
  return {
    orden: null, pagos: [], loading: true,
    modalPago: false, guardandoPago: false,
    formPago: { monto: 0, tipo: 'abono', metodo: 'transferencia', fecha: new Date().toISOString().slice(0,10), notas: '' },
    get abonado() { return calcAbonado(this.pagos); },
    get saldo() { return this.orden ? calcSaldo(this.orden, this.pagos) : 0; },
    get costoEstimado() { return this.orden ? calcCostoEstimado(this.orden) : 0; },
    async init() {
      document.addEventListener('ver-orden', async (e) => {
        this.loading = true; this.orden = null; this.pagos = [];
        this.orden = await dbGetOrden(e.detail);
        this.pagos = await dbGetPagosByOrden(e.detail);
        this.loading = false;
      });
    },
    async registrarPago() {
      if (!this.formPago.monto || this.formPago.monto <= 0) { alert('Ingresá un monto válido'); return; }
      this.guardandoPago = true;
      try {
        await dbSavePago({ ...this.formPago, orden_id: this.orden.id });
        this.pagos = await dbGetPagosByOrden(this.orden.id);
        // Si el saldo queda en 0, actualizar estado a pagada
        if (this.saldo <= 0) {
          await dbSaveOrden({ ...this.orden, estado: 'pagada' });
          this.orden.estado = 'pagada';
        } else if (this.orden.estado === 'reservada') {
          await dbSaveOrden({ ...this.orden, estado: 'en_proceso' });
          this.orden.estado = 'en_proceso';
        }
        this.modalPago = false;
        this.formPago = { monto: 0, tipo: 'abono', metodo: 'transferencia', fecha: new Date().toISOString().slice(0,10), notas: '' };
      } catch(e) { alert('Error: ' + e.message); }
      finally { this.guardandoPago = false; }
    },
    async eliminarPago(id) {
      if (!confirm('¿Eliminar este pago?')) return;
      await dbDeletePago(id);
      this.pagos = await dbGetPagosByOrden(this.orden.id);
    },
    editarOrden() {
      document.dispatchEvent(new CustomEvent('editar-orden', { detail: this.orden.id }));
      document.dispatchEvent(new CustomEvent('go-to', { detail: 'nueva-orden' }));
    },
    fmtQ
  };
}
```

- [ ] **5.4 Agregar HTML de detalle de orden (reemplazar el placeholder en el HTML)**

  Reemplazar `<div x-show="view==='detalle-orden'" x-data="uvDetalleOrden()"> <!-- Contenido en Task 5 --> </div>` por:

```html
<div x-show="view==='detalle-orden'" x-data="uvDetalleOrden()">
  <div class="page-header">
    <button class="btn-sm btn-ghost" @click="$dispatch('go-to','ordenes')">← Órdenes</button>
    <button class="btn-sm btn-ghost" @click="editarOrden()" x-show="orden">Editar</button>
  </div>
  <div class="page-body">
    <div x-show="loading" style="color:var(--muted2)">Cargando...</div>
    <template x-if="!loading && orden">
      <div style="max-width:720px">

        <!-- Header info -->
        <div style="margin-bottom:24px">
          <h2 x-text="orden.producto" style="font-size:20px;font-weight:700;color:#fff;margin-bottom:4px"></h2>
          <div style="font-size:14px;color:var(--muted2)" x-text="[orden.marca, orden.escala, orden.pedido].filter(Boolean).join(' · ')"></div>
          <div style="margin-top:10px">
            <span class="badge" :class="'badge-'+orden.estado" x-text="orden.estado.replace('_',' ')"></span>
          </div>
        </div>

        <!-- Resumen financiero -->
        <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:24px">
          <div class="stat-card">
            <div class="stat-label">Precio venta</div>
            <div class="stat-value" x-text="fmtQ(orden.precio_venta_gtq)"></div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Abonado</div>
            <div class="stat-value green" x-text="fmtQ(abonado)"></div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Saldo pendiente</div>
            <div class="stat-value" :style="saldo>0?'color:var(--red)':'color:var(--green)'" x-text="fmtQ(saldo)"></div>
          </div>
        </div>

        <!-- Cliente -->
        <div class="card" style="margin-bottom:16px;padding:16px 20px" x-show="orden.clientes">
          <div style="font-size:12px;color:var(--muted2);margin-bottom:4px">CLIENTE</div>
          <div x-text="orden.clientes?.nombre" style="font-weight:600;color:#fff"></div>
          <div x-text="orden.clientes?.whatsapp" style="font-size:13px;color:var(--muted2)"></div>
        </div>

        <!-- Pagos -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">Pagos</span>
            <button class="btn-sm btn-purple" @click="modalPago=true;formPago.tipo=pagos.length===0?'reserva':'abono'">
              + Registrar pago
            </button>
          </div>
          <div x-show="pagos.length===0" class="empty" style="padding:32px">
            <p>Sin pagos registrados</p>
          </div>
          <div x-show="pagos.length>0">
            <table class="table">
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Método</th><th>Monto</th><th></th></tr></thead>
              <tbody>
                <template x-for="p in pagos" :key="p.id">
                  <tr>
                    <td x-text="p.fecha"></td>
                    <td><span class="badge" :class="p.tipo==='reserva'?'badge-reservada':'badge-en_proceso'" x-text="p.tipo"></span></td>
                    <td x-text="p.metodo" style="color:var(--muted2)"></td>
                    <td x-text="fmtQ(p.monto)" style="font-weight:600;color:var(--green)"></td>
                    <td><button class="btn-sm btn-danger" @click="eliminarPago(p.id)">✕</button></td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Modal registrar pago -->
        <div class="modal-bg" :class="{open:modalPago}" @click.self="modalPago=false">
          <div class="modal">
            <button class="modal-close" @click="modalPago=false">✕</button>
            <div class="modal-title">Registrar pago</div>
            <div class="form-row">
              <div><label class="form-label">Tipo</label>
                <select class="form-select" x-model="formPago.tipo" style="font-size:16px">
                  <option value="reserva">Reserva</option>
                  <option value="abono">Abono</option>
                </select></div>
              <div><label class="form-label">Método</label>
                <select class="form-select" x-model="formPago.metodo" style="font-size:16px">
                  <option value="transferencia">Transferencia</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="deposito">Depósito</option>
                </select></div>
            </div>
            <div class="form-row">
              <div><label class="form-label">Monto (Q)</label>
                <input class="form-input" type="number" x-model.number="formPago.monto" step="0.01" placeholder="0.00" style="font-size:16px"></div>
              <div><label class="form-label">Fecha</label>
                <input class="form-input" type="date" x-model="formPago.fecha" style="font-size:16px"></div>
            </div>
            <div class="form-row-1">
              <label class="form-label">Notas</label>
              <textarea class="form-textarea" x-model="formPago.notas" placeholder="Opcional..."></textarea>
            </div>
            <div class="modal-footer">
              <button class="btn-sm btn-ghost" @click="modalPago=false">Cancelar</button>
              <button class="btn-sm btn-purple" @click="registrarPago()" :disabled="guardandoPago">
                <span x-text="guardandoPago?'Guardando...':'Guardar pago'"></span>
              </button>
            </div>
          </div>
        </div>

      </div>
    </template>
  </div>
</div>
```

- [ ] **5.5 Verificar flujo completo de órdenes**

  - Crear nueva orden con todos los campos → costo estimado y ganancia se calculan solos
  - Ver detalle de la orden
  - Registrar un pago tipo "reserva" → estado cambia a "en_proceso"
  - Registrar otro pago que complete el saldo → estado cambia a "pagada"
  - Eliminar un pago → saldo se recalcula

- [ ] **5.6 Commit**

```bash
git add sistema.html
git commit -m "feat: ordenes — lista, formulario, detalle + registro de pagos"
```

---

## Task 6: Deploy y verificación final

**Files:** No new files

- [ ] **6.1 Verificar que `sistema.html` y `sistema-db.js` están en la raíz del repo**

```bash
ls sistema.html sistema-db.js
```

  Expected: ambos archivos listados.

- [ ] **6.2 Push a producción**

```bash
git add sistema.html sistema-db.js
git push origin main
```

  Cloudflare Pages despliega automáticamente. Esperar ~1 minuto y verificar en el URL del sitio que `sistema.html` es accesible.

- [ ] **6.3 Verificar en mobile**

  Abrir `https://tu-sitio.pages.dev/sistema.html` desde el celular:
  - Login funciona
  - Nav inferior aparece en mobile
  - Formularios se pueden completar sin que el viewport haga zoom
  - Crear una orden completa → registrar pago → verificar saldo actualizado

- [ ] **6.4 Commit final del plan**

```bash
git commit -m "feat: sistema de gestión parte A completa — auth, clientes, ordenes, pagos"
```

---

## Siguiente paso

Una vez que este plan funcione correctamente, implementar **Plan B** (`2026-05-04-sistema-gestion-parte-b.md`) que agrega:
- Generación de comprobantes PDF (Canvas + jsPDF)
- Dashboard con métricas
- Exportar CSV
