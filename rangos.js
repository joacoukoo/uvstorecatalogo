// ── RANGOS DE CLIENTES ────────────────────────────────────────────────
// Compartido por mis-pedidos.html (vista del cliente) y sistema.html (admin).
// El rango se calcula con el total invertido histórico (precio de venta de
// todas las órdenes no canceladas). Al cliente nunca se le muestra el monto.
const RANGOS = [
  { id: 'bronce',    nombre: 'Bronce',    min: 0,      c1: '#f0a56b', c2: '#8a4a1f' },
  { id: 'plata',     nombre: 'Plata',     min: 5000,   c1: '#f1f3f7', c2: '#8d95a3' },
  { id: 'oro',       nombre: 'Oro',       min: 10000,  c1: '#ffe680', c2: '#c9930a' },
  { id: 'platino',   nombre: 'Platino',   min: 20000,  c1: '#e8fbfb', c2: '#1f6f7a' },
  { id: 'esmeralda', nombre: 'Esmeralda', min: 40000,  c1: '#7cf0b0', c2: '#0e7a44' },
  { id: 'rubi',      nombre: 'Rubí',      min: 80000,  c1: '#ff7a8f', c2: '#9b0f2a' },
  { id: 'diamante',  nombre: 'Diamante',  min: 150000, c1: '#b5ecff', c2: '#2f6fe0' },
  { id: 'leyenda',   nombre: 'Leyenda UV',min: 300000, c1: '#c58bff', c2: '#4b0f8f' },
];

function rangoPorMonto(total) {
  let r = RANGOS[0];
  for (const x of RANGOS) if ((total || 0) >= x.min) r = x;
  return r;
}

// Progreso (0–100) hacia el siguiente rango; null si ya es el máximo.
function progresoRango(total) {
  const r = rangoPorMonto(total);
  const i = RANGOS.indexOf(r);
  const sig = RANGOS[i + 1];
  if (!sig) return null;
  const pct = ((total || 0) - r.min) / (sig.min - r.min) * 100;
  return { siguiente: sig, pct: Math.max(0, Math.min(100, pct)) };
}

// Insignia: escudo con las letras UV al estilo del logo (blancas con borde
// negro). Todas iguales, solo cambia el color del escudo.
let _rangoSvgSeq = 0;
function insigniaRango(rango, size = 48) {
  const r = typeof rango === 'string' ? (RANGOS.find(x => x.id === rango) || RANGOS[0]) : rango;
  const g = 'rg' + (++_rangoSvgSeq);
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="Rango ${r.nombre}" style="flex-shrink:0;filter:drop-shadow(0 2px 6px ${r.c2}88)">
  <defs>
    <linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${r.c1}"/><stop offset="1" stop-color="${r.c2}"/>
    </linearGradient>
  </defs>
  <path d="M32 3 L57 12 V30 C57 45 46 56 32 61 C18 56 7 45 7 30 V12 Z" fill="url(#${g})" stroke="#0b0b12" stroke-width="3" stroke-linejoin="round"/>
  <path d="M32 8 L52 15.5 V30 C52 42 43.5 51 32 55.5" fill="none" stroke="#ffffff" stroke-opacity=".35" stroke-width="1.5"/>
  <text x="32" y="40" text-anchor="middle" font-family="'Arial Black','Segoe UI',sans-serif" font-weight="900" font-size="24" letter-spacing="-1"
        fill="#ffffff" stroke="#0b0b12" stroke-width="3" paint-order="stroke" style="font-style:normal">UV</text>
</svg>`;
}
