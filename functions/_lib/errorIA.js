// Traduce una respuesta de error de Anthropic a una causa que el admin pueda resolver sin abrir la consola.
export function explicarErrorIA(status, cuerpo) {
  let detalle = String(cuerpo || '');
  try { detalle = JSON.parse(detalle)?.error?.message || detalle; } catch {}

  if (/credit balance/i.test(detalle)) return 'Sin crédito en Anthropic: cargá saldo en console.anthropic.com (Billing)';
  if (status === 401 || status === 403) return 'Anthropic rechazó la clave: revisá ANTHROPIC_API_KEY en Cloudflare';
  if (status === 429) return 'Anthropic limitó los pedidos: esperá un minuto y probá de nuevo';
  if (status >= 500) return `Anthropic está saturado o caído (${status}): probá de nuevo en unos minutos`;
  return `Anthropic ${status}: ${detalle}`;
}
