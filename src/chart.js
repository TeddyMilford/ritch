// Tiny inline SVG line chart. Monochrome: uses currentColor, so it follows light and dark mode.

import { diffDays, formatDate } from './dates.js';

// points: [{ date, y, mark }] where mark=true draws a filled dot (rep checks).
export function lineChart(points, { from, to, label = '' }) {
  const W = 320, H = 150, L = 30, R = 10, T = 12, B = 24;
  const span = Math.max(1, diffDays(from, to));
  const yMax = Math.max(4, ...points.map((p) => p.y));
  const top = Math.ceil(yMax * 1.15);
  const x = (d) => L + (Math.min(span, Math.max(0, diffDays(from, d))) / span) * (W - L - R);
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const dots = points
    .map((p) => `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="${p.mark ? 4.5 : 3}" fill="${p.mark ? 'currentColor' : 'var(--bg)'}" stroke="currentColor" stroke-width="1.5"/>`)
    .join('');
  const mid = Math.round(top / 2);
  const short = (d) => formatDate(d, { month: 'short', day: 'numeric' });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
    <g class="chart-grid">
      <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>
      <line x1="${L}" x2="${W - R}" y1="${y(mid)}" y2="${y(mid)}" stroke-dasharray="2 4"/>
      <line x1="${L}" x2="${W - R}" y1="${y(top)}" y2="${y(top)}" stroke-dasharray="2 4"/>
    </g>
    <g class="chart-text">
      <text x="${L - 6}" y="${y(0) + 4}" text-anchor="end">0</text>
      <text x="${L - 6}" y="${y(mid) + 4}" text-anchor="end">${mid}</text>
      <text x="${L - 6}" y="${y(top) + 4}" text-anchor="end">${top}</text>
      <text x="${L}" y="${H - 4}">${short(from)}</text>
      <text x="${W - R}" y="${H - 4}" text-anchor="end">${short(to)}</text>
    </g>
    ${points.length > 1 ? `<path d="${path}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>` : ''}
    ${dots}
  </svg>`;
}
