// Statische XY-Diagramme als SVG (Interaktionsdiagramme, Momenten-Krümmungs-Linien, Druckverläufe …)
import { svgEl } from './ui.js';
import { fmt, niceTicks, decimalsFor } from './format.js';

/**
 * Erzeugt ein Diagramm.
 * opts:
 *  series: [{points:[[x,y],…], label, color, width, dash, fill (Fläche bis y=0 bzw. geschlossen), closed, markers, area:'x'|'y'}]
 *  points: [{x, y, label, color, shape:'circle'|'cross'|'square'}]   – Einzelpunkte (z.B. Bemessungspunkt)
 *  xLabel, yLabel, title, width=520, height=320
 *  xRange:[min,max], yRange:[min,max], equal (gleicher Massstab), invertY (y nach unten, z.B. Tiefe)
 *  zeroLines=true, legend=true, hLines/vLines: [{v, label, color, dash}]
 */
export function xyChart(opts) {
  const W = opts.width || 420, H = opts.height || 300;
  const m = { l: 58, r: 16, t: opts.title ? 28 : 14, b: 40 };
  const legendItems = (opts.series || []).filter((s) => s.label);
  if (opts.legend !== false && legendItems.length) m.t += 18;
  const pw = W - m.l - m.r, ph = H - m.t - m.b;

  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  const take = (x, y) => { if (Number.isFinite(x)) { xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); } if (Number.isFinite(y)) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); } };
  for (const s of opts.series || []) for (const [x, y] of s.points) take(x, y);
  for (const p of opts.points || []) take(p.x, p.y);
  for (const l of opts.hLines || []) take(NaN, l.v);
  for (const l of opts.vLines || []) take(l.v, NaN);
  if (opts.includeZero !== false) { take(0, 0); }
  if (!Number.isFinite(xmin)) { xmin = 0; xmax = 1; }
  if (!Number.isFinite(ymin)) { ymin = 0; ymax = 1; }
  if (opts.xRange) [xmin, xmax] = opts.xRange;
  if (opts.yRange) [ymin, ymax] = opts.yRange;

  let tx = niceTicks(xmin, xmax, Math.max(3, Math.round(pw / 80)));
  let ty = niceTicks(ymin, ymax, Math.max(3, Math.round(ph / 50)));
  if (opts.equal) {
    const sx = pw / (tx.max - tx.min), sy = ph / (ty.max - ty.min);
    const s = Math.min(sx, sy);
    const cx = (tx.max + tx.min) / 2, cy = (ty.max + ty.min) / 2;
    const hx = pw / s / 2, hy = ph / s / 2;
    tx = niceTicks(cx - hx, cx + hx, Math.max(3, Math.round(pw / 80)));
    ty = niceTicks(cy - hy, cy + hy, Math.max(3, Math.round(ph / 50)));
    const s2 = Math.min(pw / (tx.max - tx.min), ph / (ty.max - ty.min));
    const cx2 = (tx.max + tx.min) / 2, cy2 = (ty.max + ty.min) / 2;
    tx.min = cx2 - pw / s2 / 2; tx.max = cx2 + pw / s2 / 2;
    ty.min = cy2 - ph / s2 / 2; ty.max = cy2 + ph / s2 / 2;
    tx.ticks = tx.ticks.filter((v) => v >= tx.min - 1e-9 && v <= tx.max + 1e-9);
    ty.ticks = ty.ticks.filter((v) => v >= ty.min - 1e-9 && v <= ty.max + 1e-9);
  }
  const X = (x) => m.l + (x - tx.min) / (tx.max - tx.min) * pw;
  const Y = opts.invertY ? (y) => m.t + (y - ty.min) / (ty.max - ty.min) * ph : (y) => m.t + ph - (y - ty.min) / (ty.max - ty.min) * ph;

  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, xmlns: 'http://www.w3.org/2000/svg', role: 'img' });
  const clipId = 'clip' + Math.random().toString(36).slice(2, 9);
  svg.append(svgEl('defs', {}, svgEl('clipPath', { id: clipId }, svgEl('rect', { x: m.l, y: m.t, width: pw, height: ph }))));
  if (opts.title) svg.append(svgEl('text', { class: 'title', x: m.l, y: 16, text: opts.title }));

  // Gitter & Achsen
  const grid = svgEl('g', { class: 'grid' });
  const dx = decimalsFor(tx.step), dy = decimalsFor(ty.step);
  for (const v of tx.ticks) {
    grid.append(svgEl('line', { x1: X(v), y1: m.t, x2: X(v), y2: m.t + ph }));
    svg.append(svgEl('text', { x: X(v), y: m.t + ph + 15, 'text-anchor': 'middle', text: fmt(v, dx) }));
  }
  for (const v of ty.ticks) {
    grid.append(svgEl('line', { x1: m.l, y1: Y(v), x2: m.l + pw, y2: Y(v) }));
    svg.append(svgEl('text', { x: m.l - 6, y: Y(v), 'text-anchor': 'end', 'dominant-baseline': 'middle', text: fmt(v, dy) }));
  }
  svg.insertBefore(grid, svg.children[1]);
  const axis = svgEl('g', { class: 'axis' });
  axis.append(svgEl('rect', { x: m.l, y: m.t, width: pw, height: ph, fill: 'none', style: { stroke: 'var(--border)' } }));
  if (opts.zeroLines !== false) {
    if (tx.min < 0 && tx.max > 0) axis.append(svgEl('line', { x1: X(0), y1: m.t, x2: X(0), y2: m.t + ph, style: { stroke: 'var(--text-3)', strokeWidth: 1 } }));
    if (ty.min < 0 && ty.max > 0) axis.append(svgEl('line', { x1: m.l, y1: Y(0), x2: m.l + pw, y2: Y(0), style: { stroke: 'var(--text-3)', strokeWidth: 1 } }));
  }
  svg.append(axis);
  if (opts.xLabel) svg.append(svgEl('text', { x: m.l + pw / 2, y: H - 6, 'text-anchor': 'middle', style: { fill: 'var(--text)' }, text: opts.xLabel }));
  if (opts.yLabel) svg.append(svgEl('text', { x: 14, y: m.t + ph / 2, 'text-anchor': 'middle', transform: `rotate(-90 14 ${m.t + ph / 2})`, style: { fill: 'var(--text)' }, text: opts.yLabel }));

  const plot = svgEl('g', { 'clip-path': `url(#${clipId})` });
  svg.append(plot);
  const palette = ['var(--c-series-1)', 'var(--c-series-2)', 'var(--c-series-3)', 'var(--c-series-4)', 'var(--c-series-5)', 'var(--c-series-6)'];

  for (const l of opts.hLines || []) {
    plot.append(svgEl('line', { x1: m.l, y1: Y(l.v), x2: m.l + pw, y2: Y(l.v), style: { stroke: l.color || 'var(--text-3)', strokeDasharray: l.dash || '4 3', strokeWidth: 1.2 } }));
    if (l.label) svg.append(svgEl('text', { x: m.l + pw - 4, y: Y(l.v) - 4, 'text-anchor': 'end', style: { fill: l.color || 'var(--text-2)', fontSize: '10.5px' }, text: l.label }));
  }
  for (const l of opts.vLines || []) {
    plot.append(svgEl('line', { x1: X(l.v), y1: m.t, x2: X(l.v), y2: m.t + ph, style: { stroke: l.color || 'var(--text-3)', strokeDasharray: l.dash || '4 3', strokeWidth: 1.2 } }));
    if (l.label) svg.append(svgEl('text', { x: X(l.v) + 4, y: m.t + 12, style: { fill: l.color || 'var(--text-2)', fontSize: '10.5px' }, text: l.label }));
  }

  (opts.series || []).forEach((s, i) => {
    const col = s.color || palette[i % palette.length];
    const pts = s.points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (!pts.length) return;
    const P = pts.map(([x, y]) => `${X(x).toFixed(2)},${Y(y).toFixed(2)}`);
    if (s.fill) {
      let d;
      if (s.closed) d = `M${P.join('L')}Z`;
      else if (s.area === 'x') d = `M${X(0)},${Y(pts[0][1])}L${P.join('L')}L${X(0)},${Y(pts[pts.length - 1][1])}Z`;
      else d = `M${X(pts[0][0])},${Y(0)}L${P.join('L')}L${X(pts[pts.length - 1][0])},${Y(0)}Z`;
      plot.append(svgEl('path', { d, style: { fill: s.fill === true ? col : s.fill, fillOpacity: s.fillOpacity ?? 0.14, stroke: 'none' } }));
    }
    plot.append(svgEl(s.closed ? 'polygon' : 'polyline', { points: P.join(' '), style: { fill: 'none', stroke: col, strokeWidth: s.width || 1.8, strokeDasharray: s.dash || null, strokeLinejoin: 'round' } }));
    if (s.markers) for (const p of pts) plot.append(svgEl('circle', { cx: X(p[0]), cy: Y(p[1]), r: 2.5, style: { fill: col } }));
  });

  for (const p of opts.points || []) {
    const col = p.color || 'var(--text)';
    const g = svgEl('g', { transform: `translate(${X(p.x)} ${Y(p.y)})` });
    if (p.shape === 'cross') {
      g.append(svgEl('path', { d: 'M-5,-5L5,5M-5,5L5,-5', style: { stroke: col, strokeWidth: 2 } }));
    } else if (p.shape === 'square') {
      g.append(svgEl('rect', { x: -4, y: -4, width: 8, height: 8, style: { fill: col } }));
    } else {
      g.append(svgEl('circle', { r: 4.5, style: { fill: col, stroke: 'var(--surface)', strokeWidth: 1.5 } }));
    }
    if (p.label) g.append(svgEl('text', { x: 8, y: -8, style: { fill: col, fontSize: '11px', fontWeight: 600, paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 3 }, text: p.label }));
    if (p.title) g.append(svgEl('title', { text: p.title }));
    svg.append(g);
  }

  if (opts.legend !== false && legendItems.length) {
    const lg = svgEl('g', { transform: `translate(${m.l} ${m.t - 10})` });
    let x = 0;
    (opts.series || []).forEach((s, i) => {
      if (!s.label) return;
      const col = s.color || palette[i % palette.length];
      lg.append(svgEl('line', { x1: x, y1: 0, x2: x + 16, y2: 0, style: { stroke: col, strokeWidth: 2.2, strokeDasharray: s.dash || null } }));
      const t = svgEl('text', { x: x + 20, y: 0, 'dominant-baseline': 'middle', style: { fontSize: '11px' }, text: s.label });
      lg.append(t);
      x += 30 + s.label.length * 6.2;
    });
    svg.append(lg);
  }

  // Fadenkreuz mit Koordinatenanzeige
  if (opts.crosshair !== false) {
    const ch = svgEl('g', { style: { pointerEvents: 'none', display: 'none' } });
    const vl = svgEl('line', { y1: m.t, y2: m.t + ph, style: { stroke: 'var(--text-3)', strokeDasharray: '2 2' } });
    const hl = svgEl('line', { x1: m.l, x2: m.l + pw, style: { stroke: 'var(--text-3)', strokeDasharray: '2 2' } });
    const lab = svgEl('text', { style: { fontSize: '10.5px', fill: 'var(--text)', paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 3, fontFamily: 'var(--mono)' } });
    ch.append(vl, hl, lab);
    svg.append(ch);
    const hit = svgEl('rect', { x: m.l, y: m.t, width: pw, height: ph, style: { fill: 'transparent' } });
    svg.append(hit);
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const sx = (e.clientX - r.left) * W / r.width, sy = (e.clientY - r.top) * H / r.height;
      const vx = tx.min + (sx - m.l) / pw * (tx.max - tx.min);
      const vy = opts.invertY ? ty.min + (sy - m.t) / ph * (ty.max - ty.min) : ty.min + (m.t + ph - sy) / ph * (ty.max - ty.min);
      ch.style.display = '';
      vl.setAttribute('x1', sx); vl.setAttribute('x2', sx);
      hl.setAttribute('y1', sy); hl.setAttribute('y2', sy);
      lab.textContent = `${fmt(vx, dx + 1)} / ${fmt(vy, dy + 1)}`;
      const right = sx > m.l + pw - 110;
      lab.setAttribute('x', right ? sx - 6 : sx + 6);
      lab.setAttribute('text-anchor', right ? 'end' : 'start');
      lab.setAttribute('y', sy < m.t + 20 ? sy + 14 : sy - 6);
    });
    hit.addEventListener('pointerleave', () => { ch.style.display = 'none'; });
  }
  return svg;
}

/** Diagramm in einer umrahmten Box. */
export function chartBox(opts) {
  const div = document.createElement('div');
  div.className = 'chart-box';
  div.append(xyChart(opts));
  return div;
}
