-- Figuras traídas en lote desde el admin que todavía no tienen precio (no se ven en la web).
-- Solo las usa /api/pendientes con la service key, por eso RLS activado y sin políticas.
create table if not exists public.figuras_pendientes (
  id uuid primary key default gen_random_uuid(),
  clave text unique not null,
  origen text not null,
  datos jsonb not null,
  creado_en timestamptz not null default now()
);

alter table public.figuras_pendientes enable row level security;
