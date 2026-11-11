-- Costo por unidad del lote, en quetzales. Al vincular una orden nueva al lote,
-- se carga como "Precio original" (convertido a USD ÷ 7.9).
alter table public.lotes_pedido add column if not exists costo_gtq numeric(12,2)
  check (costo_gtq is null or costo_gtq >= 0);
