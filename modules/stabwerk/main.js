// Modul Stabwerk – ebene Stabtragwerke (Theorie 1. und 2. Ordnung, Stabilität)
import { createApp, IncompleteInput } from '../../js/core/app.js';
import {
  h, clear, group, dataTable, numField, selectField, checkField, textField, button, icon, kvTable, resultTable, stats, note,
  segmented, badge, clone, fmt, emptyState, infoTip, summaryCard, toast,
} from '../../js/core/ui.js';
import { chartBox } from '../../js/core/chart.js';
import { repTable, repKV, repFigure, repP } from '../../js/core/report.js';
import { niceNum } from '../../js/core/format.js';
import { analyze, LC_KINDS, COMBO_TYPES, LOAD_DIRS, generateCombinations, pickResult } from './calc.js';
import { MATERIALS, PROFILES, SECTION_TYPES, sectionProps, sectionLabel, materialById } from './sections.js';
import { EXAMPLES } from './examples.js';
import { defaultProject, emptyLC, syncCombos, removeNodeRefs, removeMemberRefs, removeSectionRefs, SUPPORT_KINDS, supportKind } from './model.js';
import { editorSpec } from './editing.js';
import { derivation } from './derivation.js';

export { emptyLC };

// ------------------------------------------------------------------ Hilfsfunktionen Darstellung

const DIAG = {
  N: { key: 'N', label: 'Normalkraft N', unit: 'kN', side: 1 },
  V: { key: 'V', label: 'Querkraft V', unit: 'kN', side: 1 },
  M: { key: 'M', label: 'Biegemoment M', unit: 'kNm', side: -1 },
};

function modelExtent(p) {
  const xs = p.nodes.map((n) => +n.x), ys = p.nodes.map((n) => +n.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x0, x1, y0, y1, size: Math.max(x1 - x0, y1 - y0, 1) };
}

function caseOptions(app) {
  const r = app.results;
  if (!r) return [];
  const opts = r.lc.map((lc, i) => ({ value: `lc:${i}`, label: `LF ${i + 1}: ${app.project.loadCases[i]?.name ?? ''}` }));
  r.combos.forEach((c, i) => opts.push({ value: `co:${i}`, label: `K${i + 1}: ${c.name}` }));
  if (r.envelope) opts.push({ value: 'env', label: 'Umhüllende GZT' });
  return opts;
}

function ensureCase(app) {
  const opts = caseOptions(app);
  if (!opts.length) return;
  if (!opts.some((o) => o.value === app.viewOpts.case)) {
    const firstUls = app.results.combos.findIndex((c) => c.type === 'GZT');
    app.viewOpts.case = firstUls >= 0 ? `co:${firstUls}` : 'lc:0';
  }
}

function caseLabel(app, key) {
  return caseOptions(app).find((o) => o.value === key)?.label ?? '';
}

function supportType(s) {
  if (s.rz && s.ux && s.uy) return { type: 'fixed', angle: 90 };
  if (s.ux && s.uy) return { type: 'pinned', angle: 90 };
  if (s.uy) return { type: 'roller', angle: 90 };
  if (s.ux) return { type: 'roller', angle: 0 };
  if (s.kx > 0 || s.ky > 0 || s.kr > 0) return { type: 'spring', angle: s.ky > 0 || !s.kx ? 90 : 0 };
  return null;
}

// ------------------------------------------------------------------ Zeichnen

function drawStructure(v, app, opts = {}) {
  const p = app.project;
  const faint = opts.faint;
  p.members.forEach((m, k) => {
    const a = p.nodes[m.i - 1], b = p.nodes[m.j - 1];
    if (!a || !b) return;
    v.line(a.x, a.y, b.x, b.y, { stroke: faint ? 'var(--c-mesh)' : 'var(--c-struct)', width: faint ? 1.5 : 3, cap: 'round' });
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, c = (b.x - a.x) / L, s = (b.y - a.y) / L;
    if (m.hi) v.hinge(a.x, a.y, { dx: c * 9, dy: -s * 9, r: 4 });
    if (m.hj) v.hinge(b.x, b.y, { dx: -c * 9, dy: s * 9, r: 4 });
    if (opts.labels && !faint) {
      v.text((a.x + b.x) / 2, (a.y + b.y) / 2, String(k + 1), { size: 10.5, color: 'var(--accent)', bold: true, dx: -s * 12, dy: -c * 12, title: `Stab ${k + 1}: ${p.sections[m.sec - 1]?.name ?? ''}` });
    }
  });
  p.supports.forEach((s) => {
    const n = p.nodes[s.node - 1];
    if (!n) return;
    const t = supportType(s);
    if (t) v.support(n.x, n.y, t.type, t.angle, faint ? { color: 'var(--c-mesh)' } : {});
  });
  p.nodes.forEach((n, i) => {
    v.dot(n.x, n.y, 3.2, { fill: faint ? 'var(--c-mesh)' : 'var(--c-struct)', title: `Knoten ${i + 1} (${fmt(n.x, 2)} / ${fmt(n.y, 2)})` });
    if (opts.labels && !faint) v.text(n.x, n.y, String(i + 1), { size: 10.5, dx: 9, dy: 10, color: 'var(--text-2)' });
  });
}

function drawLoads(v, app) {
  const p = app.project;
  const lc = p.loadCases[p.activeLC];
  if (!lc) return;
  const ext = modelExtent(p);
  // Massstab für Streckenlasten
  const secs = p.sections.map((s) => { try { return sectionProps(s); } catch { return null; } });
  const dl = [...lc.dist.map((l) => Math.max(Math.abs(+l.q1 || 0), Math.abs(+(l.q2 ?? l.q1) || 0)))];
  if (lc.selfWeight) p.members.forEach((m) => { const sp = secs[m.sec - 1]; if (sp) dl.push(sp.gamma * sp.A); });
  const qmax = Math.max(1e-9, ...dl);
  const hq = 0.1 * ext.size / qmax;
  const ah = 0.018 * ext.size;
  const drawDist = (m, s1, s2, q1, q2, dir, label, faint) => {
    const a = p.nodes[m.i - 1], b = p.nodes[m.j - 1];
    if (!a || !b) return;
    const L = Math.hypot(b.x - a.x, b.y - a.y), c = (b.x - a.x) / L, s = (b.y - a.y) / L;
    // Lastrichtung (global, Einheitsvektor) für positive Werte
    let ux = 0, uy = -1;
    if (dir === 'x') { ux = 1; uy = 0; } else if (dir === 'n') { ux = s; uy = -c; } else if (dir === 'l') { ux = c; uy = s; }
    const pt = (t) => [a.x + c * t, a.y + s * t];
    const n = 12;
    const top = [], base = [];
    for (let k = 0; k <= n; k++) {
      const t = s1 + (s2 - s1) * k / n;
      const q = q1 + (q2 - q1) * k / n;
      const [x, y] = pt(t);
      base.push([x, y]);
      top.push([x - ux * q * hq, y - uy * q * hq]);
    }
    const col = faint ? 'var(--c-mesh)' : 'var(--c-load)';
    v.polygon([...base, ...top.reverse()], { fill: faint ? 'transparent' : 'var(--c-load-fill)', stroke: col, width: 1, dash: faint ? '3 3' : undefined });
    top.reverse();
    if (dir !== 'l') {
      const na = Math.max(2, Math.min(9, Math.round((s2 - s1) / ext.size * 14) + 1));
      for (let k = 0; k <= na; k++) {
        const t = s1 + (s2 - s1) * k / na, q = q1 + (q2 - q1) * k / na;
        if (Math.abs(q) * hq < ah * 1.2) continue;
        const [x, y] = pt(t);
        const sg = Math.sign(q);
        v.line(x - ux * q * hq, y - uy * q * hq, x - ux * sg * ah, y - uy * sg * ah, { stroke: col, width: 1 });
        const px = -uy, py = ux;
        v.polygon([[x, y], [x - ux * sg * ah + px * ah * 0.4, y - uy * sg * ah + py * ah * 0.4], [x - ux * sg * ah - px * ah * 0.4, y - uy * sg * ah - py * ah * 0.4]], { fill: col, stroke: 'none' });
      }
    }
    const mid = Math.floor(top.length / 2);
    if (label) v.text(top[mid][0], top[mid][1], label, { color: col, size: 10.5, dy: uy < 0 ? -9 : 9, dx: ux > 0 ? -12 : ux < 0 ? 12 : 0 });
  };
  if (lc.selfWeight) {
    p.members.forEach((m) => {
      const sp = secs[m.sec - 1];
      if (!sp) return;
      const L = Math.hypot(p.nodes[m.j - 1].x - p.nodes[m.i - 1].x, p.nodes[m.j - 1].y - p.nodes[m.i - 1].y);
      drawDist(m, 0, L, sp.gamma * sp.A, sp.gamma * sp.A, 'g', '', true);
    });
  }
  for (const l of lc.dist) {
    const m = p.members[l.member - 1];
    if (!m) continue;
    const a = p.nodes[m.i - 1], b = p.nodes[m.j - 1];
    if (!a || !b) continue;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const s1 = +l.a > 0 ? Math.min(L, +l.a) : 0, s2 = +l.b > 0 ? Math.min(L, +l.b) : L;
    const q1 = +l.q1 || 0, q2 = l.q2 === undefined || l.q2 === null || l.q2 === '' ? q1 : +l.q2;
    const lab = q1 === q2 ? `${fmt(q1, 1)} kN/m` : `${fmt(q1, 1)}…${fmt(q2, 1)} kN/m`;
    drawDist(m, s1, s2, q1, q2, l.dir === 'gp' ? 'g' : l.dir, lab, false);
  }
  for (const l of lc.point) {
    const m = p.members[l.member - 1];
    if (!m) continue;
    const a = p.nodes[m.i - 1], b = p.nodes[m.j - 1];
    if (!a || !b) continue;
    const L = Math.hypot(b.x - a.x, b.y - a.y), c = (b.x - a.x) / L, s = (b.y - a.y) / L;
    const t = Math.min(L, Math.max(0, +l.a || 0));
    const x = a.x + c * t, y = a.y + s * t;
    const P = +l.P || 0;
    let dx = 0, dy = -1;
    if (l.dir === 'x') { dx = 1; dy = 0; } else if (l.dir === 'n') { dx = s; dy = -c; } else if (l.dir === 'l') { dx = c; dy = s; }
    if (P) v.arrow(x, y, dx * Math.sign(P), dy * Math.sign(P), { label: `${fmt(Math.abs(P), 1)} kN`, length: 40 });
    if (+l.m) v.momentArrow(x, y, Math.sign(+l.m), { label: `${fmt(Math.abs(+l.m), 1)} kNm` });
  }
  for (const l of lc.nodal) {
    const n = p.nodes[l.node - 1];
    if (!n) continue;
    const fx = +l.fx || 0, fy = +l.fy || 0;
    if (fx) v.arrow(n.x, n.y, Math.sign(fx), 0, { label: `${fmt(Math.abs(fx), 1)} kN`, length: 42, offset: 4 });
    if (fy) v.arrow(n.x, n.y, 0, Math.sign(fy), { label: `${fmt(Math.abs(fy), 1)} kN`, length: 42, offset: 4 });
    if (+l.m) v.momentArrow(n.x, n.y, Math.sign(+l.m), { label: `${fmt(Math.abs(+l.m), 1)} kNm` });
  }
  for (const l of lc.temp) {
    const m = p.members[l.member - 1];
    if (!m) continue;
    const a = p.nodes[m.i - 1], b = p.nodes[m.j - 1];
    if (!a || !b) continue;
    const txt = [+l.dT ? `ΔT = ${fmt(+l.dT, 0)} K` : '', +l.dTg ? `ΔT↕ = ${fmt(+l.dTg, 0)} K` : ''].filter(Boolean).join(', ');
    if (txt) v.text((a.x + b.x) / 2, (a.y + b.y) / 2, txt, { color: 'var(--c-load)', size: 10.5, dy: 14 });
  }
  for (const l of lc.settle) {
    const n = p.nodes[l.node - 1];
    if (!n) continue;
    const txt = [+l.ux ? `Δx ${fmt(+l.ux, 1)} mm` : '', +l.uy ? `Δy ${fmt(+l.uy, 1)} mm` : '', +l.rz ? `Δφ ${fmt(+l.rz, 1)} mrad` : ''].filter(Boolean).join(' ');
    if (txt) v.text(n.x, n.y, txt, { color: 'var(--c-load)', size: 10.5, dy: 34 });
  }
}

/** Zeichnet ein Schnittgrössen-Diagramm für alle Stäbe. getVals(k) → [{x, val}] */
function drawDiagram(v, app, getVals, def, scaleFactor, opts = {}) {
  const p = app.project;
  const ext = modelExtent(p);
  let vmax = 1e-9;
  p.members.forEach((m, k) => { for (const s of getVals(k)) vmax = Math.max(vmax, Math.abs(s.val)); });
  const sc = 0.13 * ext.size / vmax * scaleFactor;
  const labels = [];
  p.members.forEach((m, k) => {
    const a = p.nodes[m.i - 1], b = p.nodes[m.j - 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y), c = (b.x - a.x) / L, s = (b.y - a.y) / L;
    const ny = [-s, c]; // lokale y-Richtung
    const pts = getVals(k);
    const P = (st, val) => { const bx = a.x + c * st, by = a.y + s * st; const o = def.side * val * sc; return [bx + ny[0] * o, by + ny[1] * o]; };
    const B = (st) => [a.x + c * st, a.y + s * st];
    // Flächen nach Vorzeichen
    let region = null;
    const flush = () => {
      if (region && region.top.length > 1) {
        v.polygon([...region.base, ...region.top.slice().reverse()], { fill: region.sg > 0 ? 'var(--c-pos-fill)' : 'var(--c-neg-fill)', stroke: 'none' });
        v.polyline(region.top, { stroke: region.sg > 0 ? 'var(--c-pos)' : 'var(--c-neg)', width: 1.6 });
      }
      region = null;
    };
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const sg = cur.val >= 0 ? 1 : -1;
      if (region && sg !== region.sg && Math.abs(cur.val) > 1e-12) {
        const prev = pts[i - 1];
        const t = prev.val / (prev.val - cur.val);
        const xz = prev.x + t * (cur.x - prev.x);
        region.base.push(B(xz)); region.top.push(B(xz));
        flush();
        region = { sg, base: [B(xz)], top: [B(xz)] };
      }
      if (!region) region = { sg, base: [], top: [] };
      region.base.push(B(cur.x)); region.top.push(P(cur.x, cur.val));
    }
    flush();
    // Schlusslinien an den Stabenden
    const f = pts[0], l = pts[pts.length - 1];
    v.line(...B(f.x), ...P(f.x, f.val), { stroke: f.val >= 0 ? 'var(--c-pos)' : 'var(--c-neg)', width: 1.2 });
    v.line(...B(l.x), ...P(l.x, l.val), { stroke: l.val >= 0 ? 'var(--c-pos)' : 'var(--c-neg)', width: 1.2 });
    if (app.viewOpts.values) {
      const cand = [f, l];
      let imax = 0, imin = 0;
      pts.forEach((q, i) => { if (q.val > pts[imax].val) imax = i; if (q.val < pts[imin].val) imin = i; });
      for (const i of [imax, imin]) if (i > 0 && i < pts.length - 1) cand.push(pts[i]);
      for (const q of cand) {
        if (Math.abs(q.val) < 0.02 * vmax) continue;
        const [x, y] = P(q.x, q.val);
        const key = `${x.toFixed(2)}|${y.toFixed(2)}`;
        if (labels.includes(key)) continue;
        labels.push(key);
        const o = def.side * Math.sign(q.val);
        v.text(x, y, fmt(q.val, 1), { size: 10.5, bold: true, color: q.val >= 0 ? 'var(--c-pos)' : 'var(--c-neg)', dx: ny[0] * o * 12, dy: -ny[1] * o * 12 });
      }
    }
  });
  v.caption(opts.caption || `${def.label} [${def.unit}]`);
}

function drawDeformed(v, app, res, scale, label) {
  const p = app.project;
  const ext = modelExtent(p);
  let umax = 1e-12;
  res.members.forEach((m) => { umax = Math.max(umax, m.uMax); });
  const sc = 0.1 * ext.size / umax * scale;
  drawStructure(v, app, { faint: true });
  res.members.forEach((mr, k) => {
    const m = p.members[k];
    const a = p.nodes[m.i - 1], b = p.nodes[m.j - 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y), c = (b.x - a.x) / L, s = (b.y - a.y) / L;
    v.polyline(mr.stations.map((st) => [a.x + c * st.x + st.ux * sc, a.y + s * st.x + st.uy * sc]), { stroke: 'var(--c-deform)', width: 2.4 });
  });
  if (app.viewOpts.values) {
    p.nodes.forEach((n, i) => {
      const d = res.disp[i];
      if (!d) return;
      const u = Math.hypot(d[0], d[1]) * 1000;
      if (u < 0.02 * umax * 1000) return;
      v.text(n.x + d[0] * sc, n.y + d[1] * sc, `${fmt(u, 1)} mm`, { size: 10.5, color: 'var(--c-deform)', bold: true, dy: -12 });
    });
    // grösste Durchbiegung im Feld
    res.members.forEach((mr, k) => {
      const m = p.members[k];
      const a = p.nodes[m.i - 1], b = p.nodes[m.j - 1];
      const L = Math.hypot(b.x - a.x, b.y - a.y), c = (b.x - a.x) / L, s = (b.y - a.y) / L;
      let best = null;
      mr.stations.forEach((st, i) => { if (i > 0 && i < mr.stations.length - 1 && (!best || Math.hypot(st.ux, st.uy) > Math.hypot(best.ux, best.uy))) best = st; });
      if (!best) return;
      const u = Math.hypot(best.ux, best.uy);
      const ends = Math.max(Math.hypot(...res.disp[m.i - 1].slice(0, 2)), Math.hypot(...res.disp[m.j - 1].slice(0, 2)));
      if (u > ends * 1.05 && u > 0.05 * umax) v.text(a.x + c * best.x + best.ux * sc, a.y + s * best.x + best.uy * sc, `${fmt(u * 1000, 1)} mm`, { size: 10.5, color: 'var(--c-deform)', dy: 13 });
    });
  }
  v.caption(label || `Verformung (überhöht ×${fmt(sc, 0)})`);
}

function drawReactions(v, app, res) {
  drawStructure(v, app, { labels: false });
  const p = app.project;
  for (const r of res.reactions) {
    const n = p.nodes[r.node];
    if (Math.abs(r.Rx) > 1e-6) v.arrow(n.x, n.y, Math.sign(r.Rx), 0, { label: `${fmt(Math.abs(r.Rx), 1)} kN`, length: 46, offset: 16, color: 'var(--c-support)' });
    if (Math.abs(r.Ry) > 1e-6) v.arrow(n.x, n.y, 0, Math.sign(r.Ry), { label: `${fmt(Math.abs(r.Ry), 1)} kN`, length: 46, offset: 22, color: 'var(--c-support)' });
    if (Math.abs(r.M) > 1e-6) v.momentArrow(n.x, n.y, Math.sign(r.M), { label: `${fmt(Math.abs(r.M), 1)} kNm`, color: 'var(--c-support)', radius: 22 });
  }
  v.caption('Auflagerkräfte (Wirkung auf das Tragwerk)');
}

function drawBuckling(v, app, combo) {
  const b = combo.buckling;
  const model = app.results.modelS;
  const p = app.project;
  const ext = modelExtent(p);
  drawStructure(v, app, { faint: true });
  const sc = 0.15 * ext.size;
  for (const e of model.elems) {
    const n1 = model.fe[e.n1], n2 = model.fe[e.n2];
    const d = e.dofs.map((k) => b.mode[k]);
    const c = e.c, s = e.s, L = e.L;
    const loc = [c * d[0] + s * d[1], -s * d[0] + c * d[1], d[2], c * d[3] + s * d[4], -s * d[3] + c * d[4], d[5]];
    const pts = [];
    for (let q = 0; q <= 10; q++) {
      const t = q / 10;
      const u = loc[0] * (1 - t) + loc[3] * t;
      const w = loc[1] * (1 - 3 * t * t + 2 * t ** 3) + loc[2] * L * (t - 2 * t * t + t ** 3) + loc[4] * (3 * t * t - 2 * t ** 3) + loc[5] * L * (-t * t + t ** 3);
      pts.push([n1.x + c * L * t + (c * u - s * w) * sc, n1.y + s * L * t + (s * u + c * w) * sc]);
    }
    v.polyline(pts, { stroke: 'var(--c-deform)', width: 2.4 });
    void n2;
  }
  v.caption(`1. Knickfigur – Verzweigungslastfaktor α_cr = ${fmt(b.alpha, 2)}`);
}

// ------------------------------------------------------------------ Eingabe: System

function renderSystemTab(el, app) {
  const p = app.project;
  const ch = (inputs) => () => app.changed({ inputs: !!inputs });
  el.append(group(`Knoten (${p.nodes.length})`, [
    dataTable([
      { key: 'x', label: 'x', unit: 'm', info: 'Horizontale Koordinate, positiv nach rechts.' },
      { key: 'y', label: 'y', unit: 'm', info: 'Vertikale Koordinate, positiv nach oben.' },
    ], p.nodes, {
      newRow: (rows) => ({ x: rows.length ? +rows[rows.length - 1].x + 1 : 0, y: rows.length ? +rows[rows.length - 1].y : 0 }),
      onChange: (e) => {
        if (e.type === 'remove') { removeNodeRefs(p, e.index); app.changed({ inputs: true }); } else app.changed({ inputs: e.type !== 'edit' });
      },
      onSelect: (i) => app.editor?.select([`n:${i}`]),
    }),
  ], { info: 'Knoten sind die Eck- und Verbindungspunkte des Tragwerks. Nummerierung in der Reihenfolge der Tabelle.' }));

  const secOpts = () => p.sections.map((s, i) => ({ value: i + 1, label: `${i + 1}: ${s.name}` }));
  el.append(group(`Stäbe (${p.members.length})`, [
    p.nodes.length < 2 ? emptyState('Zuerst Knoten erfassen', 'Ein Stab verbindet zwei Knoten.') : null,
    dataTable([
      { key: 'i', label: 'von', width: '46px', info: 'Anfangsknoten i. Die lokale Stabachse x zeigt von i nach j.' },
      { key: 'j', label: 'bis', width: '46px', info: 'Endknoten j.' },
      { key: 'sec', label: 'Querschnitt', type: 'select', options: secOpts },
      { key: 'hi', label: 'Gel. i', type: 'check', info: 'Momentengelenk am Stabanfang (M = 0).' },
      { key: 'hj', label: 'Gel. j', type: 'check', info: 'Momentengelenk am Stabende (M = 0). Beide Gelenke → Pendelstab / Fachwerkstab.' },
      { key: 'L', label: 'L', unit: 'm', type: 'calc', calc: (m) => { const a = p.nodes[m.i - 1], b = p.nodes[m.j - 1]; return a && b ? fmt(Math.hypot(b.x - a.x, b.y - a.y), 2) : '–'; } },
    ], p.members, {
      newRow: (rows) => {
        const last = rows[rows.length - 1];
        return { i: last ? last.j : 1, j: last ? Math.min(p.nodes.length, last.j + 1) : 2, sec: last ? last.sec : 1, hi: false, hj: false };
      },
      onChange: (e) => { if (e.type === 'remove') { removeMemberRefs(p, e.index); app.changed({ inputs: true }); } else app.changed({ inputs: e.type !== 'edit' }); },
      onSelect: (i) => { app.editor?.select([`m:${i}`]); app.renderResults(); },
    }),
  ], { info: 'Stäbe sind biegesteife Balken (Euler-Bernoulli). Gelenke an den Enden lösen das Moment.' }));

  for (const sp of p.supports) { sp.kind = supportKind(sp); sp._k = sp.kind; }
  el.append(group(`Lager (${p.supports.length})`, [
    p.supports.length ? null : emptyState('Noch keine Lager', 'Ohne Lager ist das System verschieblich. Mit «+ Zeile» ein Lager hinzufügen.'),
    dataTable([
      { key: 'node', label: 'Knoten', width: '54px' },
      { key: 'kind', label: 'Lagerart', type: 'select', options: SUPPORT_KINDS, info: 'Wählt die gesperrten Richtungen. Feinabstimmung über die Häkchen rechts.' },
      { key: 'ux', label: 'x', type: 'check', info: 'Horizontale Verschiebung gesperrt.' },
      { key: 'uy', label: 'y', type: 'check', info: 'Vertikale Verschiebung gesperrt.' },
      { key: 'rz', label: 'φ', type: 'check', info: 'Verdrehung gesperrt (Einspannung).' },
    ], p.supports, {
      newRow: () => ({ node: p.nodes.length, ux: true, uy: true, rz: false, kx: 0, ky: 0, kr: 0, kind: 'pinned' }),
      onChange: (e) => {
        for (const sp of p.supports) {
          if (sp.kind !== sp._k) { const f = SUPPORT_KINDS.find((k) => k.value === sp.kind)?.flags; if (f) [sp.ux, sp.uy, sp.rz] = f; }
          delete sp._k; delete sp.kind;
        }
        app.changed({ inputs: e.type !== 'edit' || true });
      },
    }),
  ], { info: 'Gesperrte Richtungen ergeben Auflagerkräfte. Nachgiebige Lager (z.B. Baugrund) unter «Federn».' }));
  if (p.supports.length) {
    el.append(group('Federn (optional)', [
      dataTable([
        { key: 'node', label: 'Knoten', type: 'calc', calc: (r) => String(r.node) },
        { key: 'kx', label: 'kx', unit: 'kN/m', info: 'Horizontale Feder – wirkt nur, wenn x nicht gesperrt ist.' },
        { key: 'ky', label: 'ky', unit: 'kN/m', info: 'Vertikale Feder – wirkt nur, wenn y nicht gesperrt ist.' },
        { key: 'kr', label: 'kφ', unit: 'kNm/rad', info: 'Drehfeder – wirkt nur, wenn φ nicht gesperrt ist.' },
      ], p.supports, { canAdd: false, canRemove: false, onChange: () => app.changed(), hint: '' }),
    ], { collapsible: true, collapsed: !p.supports.some((q) => q.kx || q.ky || q.kr) }));
  }
}

// ------------------------------------------------------------------ Eingabe: Querschnitte

function renderSectionsTab(el, app) {
  const p = app.project;
  if (app.activeSection === undefined || app.activeSection >= p.sections.length) app.activeSection = 0;
  const list = h('div', { class: 'list' });
  p.sections.forEach((s, i) => {
    let info = '';
    try { const sp = sectionProps(s); info = `EA = ${fmt(sp.E * sp.A / 1000, 0)} MN · EI = ${fmt(sp.E * sp.I / 1000, 1)} MNm²`; } catch { info = 'unvollständig'; }
    const used = p.members.filter((m) => m.sec === i + 1).length;
    list.append(h('div', { class: 'list-item' + (i === app.activeSection ? ' active' : ''), onclick: () => { app.activeSection = i; app.renderInputs(); } },
      h('b', {}, `${i + 1}`),
      h('div', { class: 'grow' }, h('div', {}, s.name || '–', ' ', h('span', { class: 'muted small' }, sectionLabel(s))), h('div', { class: 'muted small' }, info)),
      badge(`${used} Stab${used === 1 ? '' : 'e'}`, used ? 'info' : 'warn')));
  });
  el.append(group('Querschnitte', [list,
    h('div', { class: 'row' },
      button('Neuer Querschnitt', { icon: 'plus', small: true, onClick: () => { p.sections.push({ ...clone(p.sections[app.activeSection] || defaultProject().sections[0]), name: `Querschnitt ${p.sections.length + 1}` }); app.activeSection = p.sections.length - 1; app.changed({ inputs: true }); } }),
      button('Löschen', { icon: 'trash', small: true, ghost: true, disabled: p.sections.length < 2, onClick: () => { removeSectionRefs(p, app.activeSection); p.sections.splice(app.activeSection, 1); app.activeSection = 0; app.changed({ inputs: true }); } })),
  ], { info: 'Jeder Stab verweist auf einen Querschnitt. Werkstoff bestimmt E-Modul und Raumgewicht (Eigengewicht).' }));

  const s = p.sections[app.activeSection];
  if (!s) return;
  const ch = () => app.changed({ inputs: true });
  const fields = [
    textField('Bezeichnung', s, 'name', { onChange: ch }),
    selectField('Werkstoff', s, 'mat', MATERIALS.map((m) => ({ value: m.id, label: m.label })), { wide: true, onChange: ch, info: 'E-Modul: Beton nach SIA 262 (E_cm), Stahl 210 GPa, Holz E_0,mean.' }),
    selectField('Querschnittsform', s, 'type', SECTION_TYPES, { wide: true, onChange: ch }),
  ];
  if (s.type === 'rect') fields.push(numField('Breite b', s, 'b', { unit: 'mm', min: 1, onChange: ch }), numField('Höhe h', s, 'h', { unit: 'mm', min: 1, onChange: ch, info: 'Höhe in der Tragwerksebene (Biegung um die starke Achse).' }));
  if (s.type === 'circle') fields.push(numField('Durchmesser', s, 'd', { unit: 'mm', min: 1, onChange: ch }));
  if (s.type === 'profile') fields.push(selectField('Profil', s, 'profile', Object.keys(PROFILES), { wide: true, onChange: ch, info: 'Biegung um die starke Achse (y-y). Werte nach Profiltabellen.' }));
  if (s.type === 'values') fields.push(numField('Fläche A', s, 'A', { unit: 'cm²', min: 0, onChange: ch }), numField('Trägheitsmoment I', s, 'I', { unit: 'cm⁴', min: 0, onChange: ch }), numField('Höhe h', s, 'h', { unit: 'mm', min: 0, onChange: ch, info: 'Nur für Temperaturgradient und Widerstandsmoment.' }));
  if (s.mat === 'custom') fields.push(numField('E-Modul', s, 'E', { unit: 'MPa', min: 1, onChange: ch }), numField('Raumgewicht γ', s, 'gamma', { unit: 'kN/m³', min: 0, onChange: ch }));
  el.append(group(`Querschnitt ${app.activeSection + 1} bearbeiten`, fields));
  try {
    const sp = sectionProps(s);
    el.append(group('Querschnittswerte', [kvTable([
      ['Fläche A', sp.A * 1e4, 'cm²', 1],
      ['Trägheitsmoment I', sp.I * 1e8, 'cm⁴', 0],
      ['Widerstandsmoment W', sp.W * 1e6, 'cm³', 0],
      ['E-Modul', sp.E / 1000, 'MPa', 0],
      ['Eigengewicht g₀ = γ·A', sp.gamma * sp.A, 'kN/m', 3],
    ])]));
  } catch { /* unvollständig */ }
}

// ------------------------------------------------------------------ Eingabe: Lasten

function renderLoadsTab(el, app) {
  const p = app.project;
  if (!(p.activeLC >= 0 && p.activeLC < p.loadCases.length)) p.activeLC = 0;
  const list = h('div', { class: 'list' });
  p.loadCases.forEach((lc, i) => {
    const n = lc.nodal.length + lc.dist.length + lc.point.length + lc.temp.length + lc.settle.length + (lc.selfWeight ? 1 : 0);
    list.append(h('div', { class: 'list-item' + (i === p.activeLC ? ' active' : ''), onclick: () => { p.activeLC = i; app.setViewMode('sys'); app.renderInputs(); } },
      badge(LC_KINDS[lc.kind]?.short || lc.kind, lc.kind === 'G' ? 'info' : 'warn'),
      h('div', { class: 'grow' }, `LF ${i + 1}: ${lc.name}`),
      h('span', { class: 'muted small' }, `${n} Last${n === 1 ? '' : 'en'}`)));
  });
  const syncAndChange = () => { syncCombos(p); app.changed({ inputs: true }); };
  el.append(group('Lastfälle', [list,
    h('div', { class: 'row' },
      button('Neuer Lastfall', { icon: 'plus', small: true, onClick: () => { p.loadCases.push(emptyLC(`Nutzlast ${p.loadCases.length}`, 'Q')); p.activeLC = p.loadCases.length - 1; syncAndChange(); } }),
      button('Duplizieren', { icon: 'copy', small: true, ghost: true, onClick: () => { const c = clone(p.loadCases[p.activeLC]); c.name += ' (Kopie)'; p.loadCases.splice(p.activeLC + 1, 0, c); for (const co of p.combinations) co.factors.splice(p.activeLC + 1, 0, 0); p.activeLC += 1; syncAndChange(); } }),
      button('Löschen', { icon: 'trash', small: true, ghost: true, disabled: p.loadCases.length < 2, onClick: () => { p.loadCases.splice(p.activeLC, 1); for (const co of p.combinations) co.factors.splice(p.activeLC, 1); p.activeLC = Math.max(0, p.activeLC - 1); syncAndChange(); } })),
  ], { info: 'Ein Lastfall fasst Lasten gleicher Ursache zusammen (z.B. Eigengewicht, Nutzlast, Schnee, Wind). Kombinationen bildet das Programm automatisch nach SIA 260.' }));

  const lc = p.loadCases[p.activeLC];
  const kind = LC_KINDS[lc.kind];
  const head = [
    textField('Bezeichnung', lc, 'name', { onChange: () => app.changed() }),
    selectField('Einwirkungsart', lc, 'kind', Object.entries(LC_KINDS).map(([k, v]) => ({ value: k, label: `${k} – ${v.label}` })), {
      wide: true, info: 'Bestimmt Teilsicherheitsbeiwerte (γ_G = 1.35, γ_Q = 1.5) und Kombinationsbeiwerte ψ nach SIA 260.',
      onChange: () => { lc.psi = [...LC_KINDS[lc.kind].psi]; syncAndChange(); },
    }),
    checkField('Eigengewicht der Stäbe (γ·A) automatisch', lc, 'selfWeight', { onChange: () => app.changed({ inputs: true }) }),
  ];
  if (kind?.variable) {
    head.push(h('div', { class: 'grid2' },
      numField('ψ₀', lc.psi, 0, { min: 0, max: 1, onChange: syncAndChange, info: 'Kombinationsbeiwert für Begleiteinwirkungen (GZT).' }),
      numField('ψ₂', lc.psi, 2, { min: 0, max: 1, onChange: syncAndChange, info: 'Quasi-ständiger Beiwert (Langzeitverformungen).' })));
  }
  el.append(group(`Lastfall ${p.activeLC + 1} bearbeiten`, head));

  const ch = (e) => app.changed({ inputs: e?.type !== 'edit' });
  const memberCol = { key: 'member', label: 'Stab', width: '46px' };
  const dirCol = { key: 'dir', label: 'Richtung', type: 'select', options: LOAD_DIRS, info: '↓ vertikal: Schwerkraftrichtung (positiv nach unten). Projiziert: Last je m Grundriss (z.B. Schnee auf geneigtem Dach). ⊥: senkrecht zur Stabachse.' };
  const section = (title, key, columns, newRow, info) => {
    const rows = lc[key];
    return group(`${title} (${rows.length})`, [
      dataTable(columns, rows, { newRow, onChange: ch, hint: rows.length ? undefined : 'Mit «+ Zeile» hinzufügen' }),
    ], { collapsible: true, collapsed: !rows.length && key !== 'dist', info });
  };
  el.append(section('Streckenlasten', 'dist', [memberCol, dirCol,
    { key: 'q1', label: 'q Anfang', unit: 'kN/m' }, { key: 'q2', label: 'q Ende', unit: 'kN/m', allowEmpty: true, info: 'Leer lassen für konstante Last.' },
    { key: 'a', label: 'von', unit: 'm', allowEmpty: true, info: 'Abstand vom Stabanfang. Leer = ganzer Stab.' }, { key: 'b', label: 'bis', unit: 'm', allowEmpty: true }],
  () => ({ member: 1, dir: 'g', q1: 10, q2: null, a: null, b: null }), 'Linienlasten auf Stäben, konstant oder trapezförmig, auch auf Teilbereichen.'));
  el.append(section('Einzellasten auf Stäben', 'point', [memberCol, { ...dirCol, options: LOAD_DIRS.filter((d) => d.value !== 'gp') },
    { key: 'P', label: 'P', unit: 'kN' }, { key: 'a', label: 'Abstand a', unit: 'm', info: 'Abstand vom Stabanfang (Knoten i).' }, { key: 'm', label: 'M', unit: 'kNm', info: 'Einzelmoment, positiv im Gegenuhrzeigersinn.' }],
  () => ({ member: 1, dir: 'g', P: 10, a: 1, m: 0 }), 'Einzelkräfte und -momente an beliebiger Stelle eines Stabes.'));
  el.append(section('Knotenlasten', 'nodal', [{ key: 'node', label: 'Knoten', width: '56px' },
    { key: 'fx', label: 'Fx →', unit: 'kN', info: 'Positiv nach rechts.' }, { key: 'fy', label: 'Fy ↑', unit: 'kN', info: 'Positiv nach oben (Schwerkraft also negativ eingeben).' }, { key: 'm', label: 'M ↺', unit: 'kNm', info: 'Positiv im Gegenuhrzeigersinn.' }],
  () => ({ node: 1, fx: 0, fy: -10, m: 0 }), 'Kräfte in globalen Richtungen und Momente direkt an Knoten.'));
  el.append(section('Temperatur', 'temp', [memberCol,
    { key: 'dT', label: 'ΔT gleichm.', unit: 'K', info: 'Gleichmässige Temperaturänderung → Längenänderung bzw. Zwang.' },
    { key: 'dTg', label: 'ΔT unten−oben', unit: 'K', info: 'Temperaturunterschied zwischen Seite −y (unten) und +y (oben) → Krümmung. Benötigt die Querschnittshöhe.' }],
  () => ({ member: 1, dT: 20, dTg: 0 }), 'Temperaturlasten erzeugen in statisch unbestimmten Systemen Zwängungen.'));
  el.append(section('Lagerverschiebungen', 'settle', [{ key: 'node', label: 'Knoten', width: '56px' },
    { key: 'ux', label: 'Δx', unit: 'mm' }, { key: 'uy', label: 'Δy', unit: 'mm', info: 'Setzung: negativ (nach unten).' }, { key: 'rz', label: 'Δφ', unit: 'mrad' }],
  () => ({ node: 1, ux: 0, uy: -10, rz: 0 }), 'Vorgeschriebene Verschiebungen in gesperrten Lagerrichtungen (z.B. Stützensenkung).'));
}

// ------------------------------------------------------------------ Eingabe: Berechnung & Kombinationen

function renderAnalysisTab(el, app) {
  const p = app.project;
  const an = p.analysis;
  const ch = () => app.changed({ inputs: true });
  el.append(group('Berechnungsart', [
    checkField('Theorie 2. Ordnung für GZT-Kombinationen', an, 'secondOrder', { onChange: ch, info: 'Gleichgewicht am verformten System (P-Δ und P-δ). Nötig bei schlanken, gedrückten Tragwerken (α_cr < 10).' }),
    an.secondOrder ? numField('Schiefstellung 1/…', an, 'imperfection', { min: 0, onChange: ch, info: 'Globale Anfangsschiefstellung φ₀ = 1/Wert (z.B. 200 → 5 ‰). 0 = keine Imperfektion. SIA 262 4.3.7.2 / EN 1993-1-1 5.3.2.' }) : null,
    checkField('Verzweigungslasten (Knicken) berechnen', an, 'buckling', { onChange: ch, info: 'Liefert den Faktor α_cr, um den die GZT-Lasten bis zum Knicken gesteigert werden können, sowie Knicklängen.' }),
    numField('Unterteilung je Stab', an, 'nSub', { min: 1, max: 20, onChange: ch, info: 'Anzahl Teilelemente je Stab für Theorie 2. Ordnung und Knicken (Genauigkeit). 4 ist meist ausreichend.' }),
  ]));

  const nLC = p.loadCases.length;
  el.append(group('Lastfallkombinationen', [
    checkField('Automatisch nach SIA 260 erzeugen', p, 'autoCombos', { onChange: () => { syncCombos(p); ch(); }, info: 'GZT: 1.35·G + 1.5·Q_leit + Σ1.5·ψ₀·Q_begl, für jede Leiteinwirkung. GZG: charakteristisch und quasi-ständig.' }),
    p.combinations.length ? null : emptyState('Keine Kombinationen', 'Automatische Erzeugung aktivieren oder Zeilen hinzufügen.'),
    p.autoCombos ? resultTable(['Kombination', ...p.loadCases.map((_, i) => ({ label: `LF${i + 1}`, num: true }))],
      p.combinations.map((c, k) => [h('span', {}, h('b', {}, `K${k + 1} `), c.name), ...c.factors.map((f) => (f ? fmt(f, 2) : '·'))]))
      : dataTable([
        { key: 'name', label: 'Bezeichnung', type: 'text' },
        { key: 'type', label: 'Typ', type: 'select', options: Object.entries(COMBO_TYPES).map(([k, v]) => ({ value: k, label: k, title: v })) },
        ...Array.from({ length: nLC }, (_, i) => ({ key: i, label: `LF${i + 1}`, width: '48px', title: p.loadCases[i].name })),
      ], p.combinations.map((c) => { const row = c; c.factors.forEach((f, i) => { row[i] = f; }); return row; }), {
        newRow: () => { const r = { name: `Kombination ${p.combinations.length + 1}`, type: 'GZT', factors: p.loadCases.map(() => 0) }; p.loadCases.forEach((_, i) => { r[i] = 0; }); return r; },
        onChange: () => { for (const c of p.combinations) c.factors = p.loadCases.map((_, i) => +c[i] || 0); app.changed(); },
      }),
  ], { info: 'Faktoren je Lastfall. Theorie 2. Ordnung wird für jede GZT-Kombination separat (nichtlinear) gerechnet.' }));
}

// ------------------------------------------------------------------ Ergebnisse

function selectedResult(app) {
  const key = app.viewOpts.case;
  if (key === 'env') return null;
  return pickResult(app.results, key);
}

function renderResults(el, app) {
  const r = app.results;
  const p = app.project;
  ensureCase(app);
  el.append(h('div', { class: 'field wide', style: { marginBottom: '10px' } }, h('label', {}, 'Ergebnisse für'),
    (() => { const s = h('select'); for (const o of caseOptions(app)) s.append(h('option', { value: o.value }, o.label)); s.value = app.viewOpts.case; s.addEventListener('change', () => { app.viewOpts.case = s.value; app.renderView(); app.renderResults(); }); return s; })()));
  for (const w of r.warnings) el.append(note(w, 'warn'));
  const key = app.viewOpts.case;
  const combo = key?.startsWith('co:') ? r.combos[+key.slice(3)] : null;
  if (combo?.error) el.append(note(combo.error, 'fail'));
  if (combo && combo.res.secondOrder) el.append(note(h('span', {}, 'Theorie 2. Ordnung', p.analysis.imperfection > 0 ? ` mit Schiefstellung 1/${p.analysis.imperfection}` : '', ` – Momentenvergrösserung gegenüber 1. Ordnung: ×${fmt(combo.amplification, 3)} (${combo.res.iter} Iterationen)`), 'ok'));

  if (key === 'env') {
    const env = r.envelope;
    const mm = (k) => env.reduce((o, st) => ({ max: Math.max(o.max, ...st.map((s) => s[`${k}max`])), min: Math.min(o.min, ...st.map((s) => s[`${k}min`])) }), { max: -Infinity, min: Infinity });
    const M = mm('M'), V = mm('V'), N = mm('N');
    el.append(stats([['M max', M.max, 'kNm', 1], ['M min', M.min, 'kNm', 1], ['|V| max', Math.max(V.max, -V.min), 'kN', 1], ['N min (Druck)', N.min, 'kN', 1]]));
    el.append(group('Umhüllende je Stab', [resultTable(['Stab', { label: 'M max', num: true, digits: 1 }, { label: 'M min', num: true, digits: 1 }, { label: '|V| max', num: true, digits: 1 }, { label: 'N max', num: true, digits: 1 }, { label: 'N min', num: true, digits: 1 }],
      env.map((st, k) => [String(k + 1), Math.max(...st.map((s) => s.Mmax)), Math.min(...st.map((s) => s.Mmin)), Math.max(...st.map((s) => Math.max(s.Vmax, -s.Vmin))), Math.max(...st.map((s) => s.Nmax)), Math.min(...st.map((s) => s.Nmin))]))]));
    renderStability(el, app);
    return;
  }

  const res = selectedResult(app);
  if (!res) return;
  const absMax = (k) => Math.max(...res.members.map((m) => Math.max(Math.abs(m[k].max), Math.abs(m[k].min))));
  const uMax = Math.max(...res.members.map((m) => m.uMax)) * 1000;
  const alphaMin = r.combos.filter((c) => c.buckling).reduce((a, c) => Math.min(a, c.buckling.alpha), Infinity);
  el.append(stats([
    ['|M| max', absMax('M'), 'kNm', 1], ['|V| max', absMax('V'), 'kN', 1], ['|N| max', absMax('N'), 'kN', 1],
    ['Verschiebung max', uMax, 'mm', 1],
    Number.isFinite(alphaMin) ? ['α_cr min', alphaMin, '', 2] : null,
  ]));

  // ausgewählter Stab
  const selK = (app.editor?.sel || []).map((id) => id.split(':')).find(([t]) => t === 'm');
  const sel = selK ? { member: +selK[1] } : null;
  if (sel?.member !== undefined && res.members[sel.member]) {
    const mr = res.members[sel.member];
    el.append(group(`Stab ${sel.member + 1} – Verlauf`, [
      chartBox({ height: 220, series: [
        { points: mr.stations.map((s) => [s.x, s.M]), label: 'M [kNm]', fill: true },
        { points: mr.stations.map((s) => [s.x, s.V]), label: 'V [kN]', dash: '5 3' },
        { points: mr.stations.map((s) => [s.x, s.N]), label: 'N [kN]', dash: '2 3' },
      ], xLabel: 'x ab Knoten i [m]' }),
      kvTable([['M max / min', `${fmt(mr.M.max, 1)} / ${fmt(mr.M.min, 1)}`, 'kNm'], ['V max / min', `${fmt(mr.V.max, 1)} / ${fmt(mr.V.min, 1)}`, 'kN'], ['N max / min', `${fmt(mr.N.max, 1)} / ${fmt(mr.N.min, 1)}`, 'kN'], ['Verschiebung max', mr.uMax * 1000, 'mm', 1]]),
    ], { actions: [button('', { icon: 'close', small: true, ghost: true, title: 'Auswahl aufheben', onClick: () => { app.editor?.select([]); app.renderResults(); } })] }));
  }

  el.append(group('Auflagerkräfte', [
    resultTable(['Knoten', { label: 'Rx [kN]', num: true, digits: 2 }, { label: 'Ry [kN]', num: true, digits: 2 }, { label: 'M [kNm]', num: true, digits: 2 }],
      res.reactions.map((q) => [String(q.node + 1), q.Rx, q.Ry, q.M])),
    (() => {
      const ex = Math.abs(res.sumFx + res.sumRx), ey = Math.abs(res.sumFy + res.sumRy);
      const ok = ex < 1e-6 * Math.max(1, Math.abs(res.sumFx), Math.abs(res.sumFy)) + 1e-6 && ey < 1e-6 * Math.max(1, Math.abs(res.sumFy)) + 1e-6;
      return h('div', { class: 'small muted', style: { marginTop: '6px' } }, badge(ok ? 'Gleichgewicht erfüllt' : 'Gleichgewicht prüfen', ok ? 'ok' : 'warn'),
        ` ΣLasten: ${fmt(res.sumFx, 2)} / ${fmt(res.sumFy, 2)} kN · ΣReaktionen: ${fmt(res.sumRx, 2)} / ${fmt(res.sumRy, 2)} kN`);
    })(),
  ], { info: 'Kräfte, die die Lager auf das Tragwerk ausüben. Positiv in Richtung der globalen Achsen (→, ↑, ↺).' }));

  el.append(group('Stabendschnittgrössen', [resultTable(['Stab', { label: 'N i', num: true, digits: 1 }, { label: 'V i', num: true, digits: 1 }, { label: 'M i', num: true, digits: 1 }, { label: 'N j', num: true, digits: 1 }, { label: 'V j', num: true, digits: 1 }, { label: 'M j', num: true, digits: 1 }],
    res.members.map((m, k) => { const a = m.stations[0], b = m.stations[m.stations.length - 1]; return [String(k + 1), a.N, a.V, a.M, b.N, b.V, b.M]; }))],
  { info: 'N Zug positiv; M positiv bei Zug auf der Stabunterseite (Seite −y, bei Stützen: rechts bei Stabrichtung nach oben); V = dM/dx. Einheiten kN, kNm.' }));
  renderStability(el, app);
}

function renderStability(el, app) {
  const r = app.results;
  const withB = r.combos.map((c, i) => ({ c, i })).filter(({ c }) => c.buckling || c.bucklingError);
  if (!withB.length) return;
  const rows = withB.map(({ c, i }) => {
    const a = c.buckling?.alpha;
    const verdict = !c.buckling ? badge('keine Druckkräfte', 'info') : a < 1 ? badge('instabil', 'fail') : a < 10 ? badge('2. Ordnung massgebend', 'warn') : badge('2. Ordnung vernachlässigbar', 'ok');
    return [`K${i + 1}`, a ?? '–', verdict];
  });
  const crit = withB.filter(({ c }) => c.buckling).sort((a, b) => a.c.buckling.alpha - b.c.buckling.alpha)[0];
  const children = [resultTable(['Kombination', { label: 'α_cr', num: true, digits: 2 }, 'Beurteilung'], rows)];
  if (crit) {
    const lcr = crit.c.buckling.lcr.map((q, k) => (q ? [String(k + 1), q.N, q.Ncr, q.Lcr, q.beta] : null)).filter(Boolean);
    if (lcr.length) children.push(h('div', { class: 'small muted', style: { margin: '8px 0 4px' } }, `Knicklängen für K${crit.i + 1} (massgebend):`),
      resultTable(['Stab', { label: 'N [kN]', num: true, digits: 1 }, { label: 'N_cr [kN]', num: true, digits: 0 }, { label: 'L_cr [m]', num: true, digits: 2 }, { label: 'β', num: true, digits: 2 }], lcr));
  }
  el.append(group('Stabilität', children, { info: 'α_cr: Faktor auf die Lasten der Kombination bis zum Verzweigungsversagen (elastisch). Ab α_cr ≥ 10 dürfen Effekte 2. Ordnung meist vernachlässigt werden (EN 1993-1-1 5.2.1). Knicklänge L_cr = π·√(EI / N_cr).' }));
}

// ------------------------------------------------------------------ Bericht

function report(app) {
  const p = app.project, r = app.results;
  const secs = p.sections.map((s) => sectionProps(s));
  const out = [];
  out.push({ title: '1 System', content: [
    repFigure(app.snapshot('sys'), 'Statisches System mit Lasten des aktiven Lastfalls'),
    repTable(['Knoten', { label: 'x [m]', num: true, digits: 3 }, { label: 'y [m]', num: true, digits: 3 }], p.nodes.map((n, i) => [String(i + 1), +n.x, +n.y])),
    repTable(['Stab', 'i', 'j', 'Querschnitt', { label: 'L [m]', num: true, digits: 3 }, 'Gelenke'], p.members.map((m, k) => {
      const a = p.nodes[m.i - 1], b = p.nodes[m.j - 1];
      return [String(k + 1), String(m.i), String(m.j), p.sections[m.sec - 1]?.name ?? '', Math.hypot(b.x - a.x, b.y - a.y), [m.hi ? 'i' : '', m.hj ? 'j' : ''].filter(Boolean).join(', ') || '–'];
    })),
    repTable(['Querschnitt', 'Werkstoff', 'Form', { label: 'A [cm²]', num: true, digits: 1 }, { label: 'I [cm⁴]', num: true, digits: 0 }, { label: 'E [MPa]', num: true, digits: 0 }, { label: 'g₀ [kN/m]', num: true, digits: 3 }],
      p.sections.map((s, i) => [`${i + 1}: ${s.name}`, materialById(s.mat).label, sectionLabel(s), secs[i].A * 1e4, secs[i].I * 1e8, secs[i].E / 1000, secs[i].gamma * secs[i].A])),
    repTable(['Lager', 'Knoten', 'x', 'y', 'φ', 'Federn'], p.supports.map((s, i) => [String(i + 1), String(s.node), s.ux ? 'fest' : '–', s.uy ? 'fest' : '–', s.rz ? 'fest' : '–', [s.kx ? `kx=${s.kx}` : '', s.ky ? `ky=${s.ky}` : '', s.kr ? `kφ=${s.kr}` : ''].filter(Boolean).join(' ') || '–'])),
  ] });
  const lcContent = [];
  const prevLC = p.activeLC;
  p.loadCases.forEach((lc, i) => {
    p.activeLC = i;
    lcContent.push(h('h3', {}, `LF ${i + 1}: ${lc.name} (${LC_KINDS[lc.kind].label}${lc.selfWeight ? ', inkl. Eigengewicht' : ''})`));
    lcContent.push(repFigure(app.snapshot('sys')));
    if (lc.dist.length) lcContent.push(repTable(['Stab', 'Richtung', { label: 'q₁', num: true, digits: 2 }, { label: 'q₂', num: true, digits: 2 }, 'Bereich'], lc.dist.map((l) => [String(l.member), LOAD_DIRS.find((d) => d.value === l.dir)?.label ?? l.dir, +l.q1, l.q2 === null || l.q2 === '' || l.q2 === undefined ? +l.q1 : +l.q2, +l.a > 0 || +l.b > 0 ? `${fmt(+l.a || 0, 2)}…${l.b ? fmt(+l.b, 2) : 'L'} m` : 'ganzer Stab']), { caption: 'Streckenlasten [kN/m]' }));
    if (lc.point.length) lcContent.push(repTable(['Stab', 'Richtung', { label: 'P [kN]', num: true, digits: 2 }, { label: 'a [m]', num: true, digits: 2 }, { label: 'M [kNm]', num: true, digits: 2 }], lc.point.map((l) => [String(l.member), LOAD_DIRS.find((d) => d.value === l.dir)?.label ?? l.dir, +l.P, +l.a, +l.m || 0]), { caption: 'Einzellasten' }));
    if (lc.nodal.length) lcContent.push(repTable(['Knoten', { label: 'Fx [kN]', num: true, digits: 2 }, { label: 'Fy [kN]', num: true, digits: 2 }, { label: 'M [kNm]', num: true, digits: 2 }], lc.nodal.map((l) => [String(l.node), +l.fx || 0, +l.fy || 0, +l.m || 0]), { caption: 'Knotenlasten' }));
    if (lc.temp.length) lcContent.push(repTable(['Stab', { label: 'ΔT [K]', num: true, digits: 1 }, { label: 'ΔT unten−oben [K]', num: true, digits: 1 }], lc.temp.map((l) => [String(l.member), +l.dT || 0, +l.dTg || 0]), { caption: 'Temperatur' }));
    if (lc.settle.length) lcContent.push(repTable(['Knoten', { label: 'Δx [mm]', num: true, digits: 1 }, { label: 'Δy [mm]', num: true, digits: 1 }, { label: 'Δφ [mrad]', num: true, digits: 2 }], lc.settle.map((l) => [String(l.node), +l.ux || 0, +l.uy || 0, +l.rz || 0]), { caption: 'Lagerverschiebungen' }));
  });
  p.activeLC = prevLC;
  out.push({ title: '2 Lastfälle', content: lcContent });
  out.push({ title: '3 Kombinationen', content: [
    repP(p.autoCombos ? 'Kombinationen automatisch nach SIA 260, Gl. (10) (GZT, Typ 2) bzw. Gl. (17)/(19) (GZG).' : 'Kombinationen benutzerdefiniert.'),
    repTable(['Nr.', 'Bezeichnung', 'Typ', ...p.loadCases.map((_, i) => ({ label: `LF${i + 1}`, num: true, digits: 2 }))], p.combinations.map((c, k) => [`K${k + 1}`, c.name, c.type, ...c.factors.map(Number)])),
    repKV([['Theorie 2. Ordnung (GZT)', p.analysis.secondOrder ? 'ja' : 'nein'], p.analysis.secondOrder ? ['Schiefstellung', p.analysis.imperfection > 0 ? `1/${p.analysis.imperfection}` : 'keine'] : null, ['Verzweigungslasten', p.analysis.buckling ? 'ja' : 'nein']]),
  ] });
  const prevCase = app.viewOpts.case;
  const resContent = [];
  r.combos.forEach((c, i) => {
    if (c.type !== 'GZT' && c.type !== 'QP') return;
    app.viewOpts.case = `co:${i}`;
    resContent.push(h('h3', {}, `K${i + 1}: ${c.name}${c.res.secondOrder ? ' – Theorie 2. Ordnung' : ''}`));
    if (c.error) { resContent.push(repP(c.error)); return; }
    if (c.type === 'GZT') {
      resContent.push(repFigure(app.snapshot('M'), 'Biegemoment M [kNm] (auf der Zugseite)'));
      resContent.push(repFigure(app.snapshot('V'), 'Querkraft V [kN]'));
      resContent.push(repFigure(app.snapshot('N'), 'Normalkraft N [kN]'));
    } else {
      resContent.push(repFigure(app.snapshot('def'), 'Verformung'));
    }
    resContent.push(repTable(['Knoten', { label: 'Rx [kN]', num: true, digits: 2 }, { label: 'Ry [kN]', num: true, digits: 2 }, { label: 'M [kNm]', num: true, digits: 2 }], c.res.reactions.map((q) => [String(q.node + 1), q.Rx, q.Ry, q.M]), { caption: 'Auflagerkräfte' }));
    resContent.push(repTable(['Stab', { label: 'N i', num: true, digits: 1 }, { label: 'V i', num: true, digits: 1 }, { label: 'M i', num: true, digits: 1 }, { label: 'N j', num: true, digits: 1 }, { label: 'V j', num: true, digits: 1 }, { label: 'M j', num: true, digits: 1 }, { label: 'M max', num: true, digits: 1 }, { label: 'M min', num: true, digits: 1 }],
      c.res.members.map((m, k) => { const a = m.stations[0], b = m.stations[m.stations.length - 1]; return [String(k + 1), a.N, a.V, a.M, b.N, b.V, b.M, m.M.max, m.M.min]; }), { caption: 'Stabschnittgrössen [kN, kNm]' }));
  });
  if (r.envelope) {
    app.viewOpts.case = 'env';
    resContent.push(h('h3', {}, 'Umhüllende aller GZT-Kombinationen'));
    resContent.push(repFigure(app.snapshot('M'), 'Umhüllende Biegemoment [kNm]'));
  }
  app.viewOpts.case = prevCase;
  out.push({ title: '4 Ergebnisse', content: resContent });
  const stab = r.combos.map((c, i) => (c.buckling ? [`K${i + 1}`, c.name, c.buckling.alpha] : null)).filter(Boolean);
  if (stab.length) {
    out.push({ title: '5 Stabilität', content: [
      repP('Elastische Verzweigungslastfaktoren α_cr der GZT-Kombinationen (lineare Stabilitätsanalyse mit Normalkräften nach Theorie 1. Ordnung).'),
      repTable(['Nr.', 'Kombination', { label: 'α_cr', num: true, digits: 2 }], stab),
    ] });
  }
  out.push({ title: 'Annahmen', content: [repP('Ebenes Stabwerk, Euler-Bernoulli-Balken, linear-elastisches Werkstoffverhalten, kleine Verschiebungen (Theorie 2. Ordnung: P-Δ/P-δ mit konsistenter geometrischer Steifigkeit, Normalkräfte iterativ). Schubverformungen vernachlässigt. Vorzeichen: N Zug positiv, M positiv bei Zug auf der Seite −y des Stabes.')] });
  return out;
}

// ------------------------------------------------------------------ App

createApp({
  id: 'stabwerk',
  title: 'Stabwerk',
  subtitle: 'Ebene Stabtragwerke · Theorie 1. und 2. Ordnung',
  version: 1,
  autoCompute: true,
  defaultProject,
  examples: EXAMPLES,
  migrate(p) {
    p.analysis = { secondOrder: false, imperfection: 200, buckling: true, nSub: 4, ...(p.analysis || {}) };
    for (const lc of p.loadCases || []) for (const k of ['nodal', 'dist', 'point', 'temp', 'settle']) lc[k] ||= [];
    if (p.autoCombos === undefined) p.autoCombos = !p.combinations?.length;
    syncCombos(p);
    p.activeLC ||= 0;
    return p;
  },
  intro: `<h4>So funktioniert's</h4><ol>
    <li><b>Zeichnen</b>: oben <b>Stab</b> (L) wählen und Punkte in die Grafik klicken – Knoten entstehen automatisch.</li>
    <li><b>Lager und Lasten</b> mit den Werkzeugen <b>Lager</b> (A), <b>Streckenlast</b> (Q), <b>Einzellast</b> (F) anbringen.</li>
    <li><b>Anklicken</b> eines Stabes oder Knotens öffnet das Eigenschaftsfenster: Querschnitt, Material, Gelenke, Lasten.</li>
    <li>Ergebnisse erscheinen sofort; unter <b>Herleitung</b> rechts steht der Rechenweg. Die Tabellen links bleiben als Alternative.</li></ol>`,
  inputTabs: [
    { id: 'sys', label: 'System', render: renderSystemTab },
    { id: 'sec', label: 'Querschnitte', render: renderSectionsTab },
    { id: 'loads', label: 'Lasten', render: renderLoadsTab },
    { id: 'calc', label: 'Berechnung', render: renderAnalysisTab },
  ],
  viewModes: (app) => [
    { id: 'sys', label: 'System' },
    { id: 'def', label: 'Verformung', needsResults: true, disabled: app.viewOpts.case === 'env' },
    { id: 'M', label: 'M', needsResults: true },
    { id: 'V', label: 'V', needsResults: true },
    { id: 'N', label: 'N', needsResults: true },
    { id: 'R', label: 'Reaktionen', needsResults: true, disabled: app.viewOpts.case === 'env' },
    { id: 'buck', label: 'Knickfigur', needsResults: true, disabled: !app.results?.combos?.some((c) => c.buckling) },
  ],
  viewOptions: (app) => {
    if (app.results) ensureCase(app);
    const list = [];
    if (app.viewMode !== 'sys' && app.results) list.push({ key: 'case', label: '', type: 'select', options: caseOptions(app), default: 'lc:0' });
    list.push({ key: 'values', label: 'Werte', type: 'check', default: true });
    list.push({ key: 'labels', label: 'Nummern', type: 'check', default: true });
    if (['def', 'M', 'V', 'N', 'buck'].includes(app.viewMode)) list.push({ key: 'scale', label: 'Massstab', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1, digits: 2 });
    return list;
  },
  editor: editorSpec,
  derivation,
  renderView(v, app, mode) {
    const p = app.project;
    if (!p.nodes.length) {
      app.showViewMessage('');
      v.setBounds(-1, -1, 9, 5);
      v.caption('Leeres Projekt – Werkzeug «Stab» (L) wählen und Punkte anklicken');
      v.scaleBar();
      return;
    }
    app.showViewMessage('');
    const ext = modelExtent(p);
    const pad = 0.12 * ext.size;
    // Beim Bearbeiten nicht automatisch neu einpassen (nur beim Laden eines Projekts)
    v.setBounds(ext.x0 - pad, ext.y0 - pad, ext.x1 + pad, ext.y1 + pad, { noFit: true });
    const labels = app.viewOpts.labels !== false;
    const scale = app.viewOpts.scale ?? 1;
    if (mode === 'sys' || !app.results) {
      drawLoads(v, app);
      drawStructure(v, app, { labels });
      const lc = p.loadCases[p.activeLC];
      v.caption(lc ? `Lasten: LF ${p.activeLC + 1} – ${lc.name}${lc.selfWeight ? ' (inkl. Eigengewicht, gestrichelt)' : ''}` : 'System');
      v.scaleBar();
      return;
    }
    const key = app.viewOpts.case;
    if (key === 'env' && ['M', 'V', 'N'].includes(mode)) {
      drawStructure(v, app, { labels: false });
      const env = app.results.envelope;
      const d = DIAG[mode];
      drawDiagram(v, app, (k) => env[k].map((s) => ({ x: s.x, val: s[`${mode}max`] })), d, scale, { caption: `Umhüllende ${d.label} [${d.unit}] (max und min)` });
      drawDiagram(v, app, (k) => env[k].map((s) => ({ x: s.x, val: s[`${mode}min`] })), d, scale, { caption: ' ' });
      return;
    }
    const res = selectedResult(app);
    if (!res) { drawStructure(v, app, { labels }); return; }
    if (mode === 'def') { drawDeformed(v, app, res, scale); return; }
    if (mode === 'R') { drawReactions(v, app, res); return; }
    if (mode === 'buck') {
      const combo = key?.startsWith('co:') && app.results.combos[+key.slice(3)]?.buckling ? app.results.combos[+key.slice(3)] : app.results.combos.filter((c) => c.buckling).sort((a, b) => a.buckling.alpha - b.buckling.alpha)[0];
      if (combo) drawBuckling(v, app, combo);
      return;
    }
    const d = DIAG[mode];
    drawStructure(v, app, { labels: false });
    drawDiagram(v, app, (k) => res.members[k].stations.map((s) => ({ x: s.x, val: s[d.key] })), d, scale, { caption: `${d.label} [${d.unit}] – ${caseLabel(app, key)}` });
  },
  compute(p) {
    syncCombos(p);
    if (!p.members.length) throw new IncompleteInput('Noch kein Tragwerk vorhanden.', 'Wählen Sie oben das Werkzeug «Stab» (Taste L) und klicken Sie Anfangs- und Endpunkt in die Grafik – oder laden Sie unter «Beispiele» ein fertiges System.');
    if (!p.supports.length) throw new IncompleteInput('Es fehlen noch Lager.', 'Werkzeug «Lager» (Taste A) wählen und einen Knoten anklicken. Die Lagerart wählen Sie danach im Eigenschaftsfenster.');
    return analyze(p);
  },
  renderResults,
  report,
  help: `
    <h3>Vorzeichen und Achsen</h3>
    <ul>
      <li>Globale Achsen: x nach rechts, y nach oben, Drehungen im Gegenuhrzeigersinn positiv.</li>
      <li>Lokale Stabachse x zeigt vom Anfangsknoten i zum Endknoten j; y liegt 90° im Gegenuhrzeigersinn dazu.</li>
      <li><b>N</b> Zug positiv. <b>M</b> positiv bei Zug auf der Seite −y (waagrechter Stab von links nach rechts: Zug unten). Das Momentendiagramm wird auf der Zugseite gezeichnet. <b>V</b> = dM/dx.</li>
      <li>Streckenlasten «↓ vertikal» sind positiv nach unten (Schwerkraft). Knotenlasten Fx/Fy wirken in globaler Richtung (Fy nach oben positiv).</li>
    </ul>
    <h3>Berechnung</h3>
    <p>Weggrössenverfahren mit Euler-Bernoulli-Balken. Theorie 2. Ordnung mit konsistenter geometrischer Steifigkeit und iterativ bestimmten Normalkräften; optional globale Schiefstellung. Verzweigungslasten über Unterraumiteration (kleinster positiver Eigenwert von (K + α·K_G)·φ = 0).</p>
    <p>Kombinationen nach SIA 260: GZT 1.35·G + 1.5·Q₁ + Σ 1.5·ψ₀·Qᵢ für jede Leiteinwirkung, GZG charakteristisch und quasi-ständig. Faktoren können nach Deaktivieren der Automatik frei bearbeitet werden.</p>
    <h3>Bedienung</h3>
    <ul>
      <li>Werkzeuge <b>+ Knoten</b> und <b>+ Stab</b> über der Grafik: Klicks rasten auf ein Raster bzw. vorhandene Knoten ein. Esc beendet das Zeichnen.</li>
      <li>Im Modus <b>Auswahl</b> zeigt ein Klick auf einen Stab die Schnittgrössen an dieser Stelle und den Verlauf im Ergebnisbereich.</li>
      <li>Tabellen akzeptieren Einfügen aus Excel sowie Ausdrücke wie <code>6/2</code> oder <code>2*3,5</code>.</li>
    </ul>
    <h3>Grenzen</h3>
    <p>Keine Schubverformungen, keine Werkstoffnichtlinearität, keine räumlichen Systeme. Die Bemessung der Querschnitte erfolgt in den Modulen Querschnitt, Stahlbau und Stütze.</p>`,
});
