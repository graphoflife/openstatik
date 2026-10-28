// Modul «Platte» – FE-Plattenberechnung (Oberfläche)
import { createApp } from '../../js/core/app.js';
import { h, group, stats, checksTable, summaryCard, note, resultTable, kvTable, badge, selectField, clone } from '../../js/core/ui.js';
import { fmt } from '../../js/core/format.js';
import { repTable, repKV, repFigure, repFormula, repP } from '../../js/core/report.js';
import {
  analyse, withDefaults, estimateNodes, meshProject, locate, interpolate, layerLabel, comboTypeLabel, LOAD_CATEGORIES,
} from './calc.js';
import { EXAMPLES, defaultProject } from './examples.js';
import { geometryTab, supportTab, loadTab, designTab } from './inputs.js';
import { drawSystem, drawMesh, drawContour, drawPrincipalCrosses, drawReactions, drawProbe, slabBounds } from './views.js';
import { principalMoments } from './design.js';
import { INTRO, HELP } from './help.js';

const LAYERS = ['bx', 'by', 'tx', 'ty'];
const TYPE_LABEL = { innen: 'Innenstütze', rand: 'Randstütze', ecke: 'Eckstütze' };
const RESULT_MODES = new Set(['w', 'mx', 'my', 'mxy', 'm12', 'react']);
const CONTOUR_MODES = new Set(['w', 'mx', 'my', 'mxy', 'm12', 'as']);
const AUTO_COMPUTE_NODES = 4000;

// ------------------------------------------------------------------ Hilfen

function defaultSet(r, prefer = 'ULS') {
  return r.sets.find((s) => s.kind === 'combo' && s.type === prefer) || r.sets.find((s) => s.kind === 'combo') || r.sets[0];
}

function setOptions(r) {
  return r.sets.map((s) => ({ value: s.key, label: s.kind === 'lc' ? `LF: ${s.name}` : `${s.name}${s.type === 'ULS' && !/GZT|Trag/i.test(s.name) ? ' (GZT)' : ''}` }));
}

function currentSet(app) {
  const r = app.results;
  if (!r) return null;
  return r.sets.find((s) => s.key === app.viewOpts.res) || defaultSet(r);
}

const meshCache = { key: null, mesh: null, error: null, elemFactor: null };
function previewMesh(app) {
  const p = app.project;
  const key = JSON.stringify([p.outline, p.openings, p.meshSize, p.pointSupports, p.lineSupports, p.lineLoads, p.pointLoads, p.loadAreas, p.refineColumns, p.columnHeads]);
  if (meshCache.key !== key) {
    meshCache.key = key;
    try {
      const m = meshProject(withDefaults(clone(p)));
      meshCache.mesh = m.mesh; meshCache.error = null;
    } catch (e) {
      meshCache.mesh = null; meshCache.error = e.message;
    }
  }
  return meshCache;
}

let snapshotting = false;
let lastPanelKey = null;

function nodal(set, kind) {
  const n = set.w.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const pm = principalMoments(set.mx[i], set.my[i], set.mxy[i]);
    out[i] = kind === 'm2' ? pm.m2 : pm.m1;
  }
  return out;
}

/** Werte der Bewehrungsgrafik: ohne Grundbewehrung die Biegebewehrung, sonst die Zulage max(as, as,min) − as,Grund. */
function designValues(r, layer) {
  const d = r.design;
  const a = d.as[layer], min = d.asMin[layer], base = d.asBasic[layer] || 0;
  let maxFinite = 0;
  for (const v of a) if (Number.isFinite(v) && v > maxFinite) maxFinite = v;
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const v = Number.isFinite(a[i]) ? a[i] : maxFinite * 1.05; // Druckzone ungenügend → Spitzenwert
    out[i] = base > 0 ? Math.max(0, Math.max(v, min) - base) : v;
  }
  return out;
}

// ------------------------------------------------------------------ Darstellung

function renderView(view, app, mode) {
  const b = slabBounds(app.project);
  if (b) view.setBounds(b.x0, b.y0, b.x1, b.y1);
  const r = app.results;
  if (!mode || mode === 'system' || (!r && mode !== 'mesh')) {
    drawSystem(view, app);
  } else if (mode === 'mesh') {
    if (r && !app.stale) drawMesh(view, app, r.mesh, { elemFactor: r.elemFactor });
    else {
      const pv = previewMesh(app);
      if (pv.mesh) drawMesh(view, app, pv.mesh, { preview: true });
      else { drawSystem(view, app); app.showViewMessage(`Netz kann nicht erzeugt werden: ${pv.error}`); }
    }
  } else {
    const s = currentSet(app);
    const head = `${s.kind === 'lc' ? 'Lastfall' : comboTypeLabel(s.type)}: ${s.name}`;
    if (mode === 'w') {
      drawContour(view, app, s.w.map((v) => v * 1000), { title: 'w', unit: 'mm', symmetric: 'auto', caption: `${head} · Durchbiegung w, elastisch, positiv nach unten` });
    } else if (mode === 'mx' || mode === 'my') {
      drawContour(view, app, s[mode], { title: mode, unit: 'kNm/m', symmetric: true, zeroLine: true, clip: 0.97, caption: `${head} · ${mode} (Bewehrung in ${mode[1]}-Richtung), positiv = Zug unten` });
    } else if (mode === 'mxy') {
      drawContour(view, app, s.mxy, { title: 'mxy', unit: 'kNm/m', symmetric: true, clip: 0.97, caption: `${head} · Drillmoment mxy` });
    } else if (mode === 'm12') {
      const pm = app.viewOpts.pm || 'm1';
      if (pm === 'dir') drawPrincipalCrosses(view, app, s);
      else drawContour(view, app, nodal(s, pm), { title: pm === 'm2' ? 'm₂' : 'm₁', unit: 'kNm/m', symmetric: true, zeroLine: true, clip: 0.97, caption: `${head} · Hauptmoment ${pm === 'm2' ? 'm₂ (Minimum)' : 'm₁ (Maximum)'}` });
    } else if (mode === 'as') {
      const layer = LAYERS.includes(app.viewOpts.layer) ? app.viewOpts.layer : 'bx';
      const d = r.design;
      const base = d.asBasic[layer] || 0;
      const L = d.layers[layer];
      drawContour(view, app, designValues(r, layer), {
        title: base > 0 ? 'Zulage' : 'as,erf', unit: 'mm²/m', symmetric: false, showMin: false, digits: 0, clip: 0.98, neutralBelow: 1,
        caption: base > 0
          ? `Zulagen ${layerLabel(layer)} (d = ${fmt(L.d, 0)} mm) · Umhüllende GZT · über Grundbewehrung ${fmt(base, 0)} mm²/m`
          : `Biegebewehrung ${layerLabel(layer)} (d = ${fmt(L.d, 0)} mm) · Umhüllende GZT · zusätzlich as,min = ${fmt(d.asMin[layer], 0)} mm²/m beachten`,
      });
    } else if (mode === 'react') {
      drawReactions(view, app, s);
    }
    // Ergebnisbereich mit der Auswahl synchron halten
    if (!snapshotting && RESULT_MODES.has(mode) && lastPanelKey !== s.key) {
      queueMicrotask(() => { if (app.results && lastPanelKey !== currentSet(app)?.key) app.renderResults(); });
    }
  }
  if (!snapshotting) drawProbe(view, app.selection?.probe);
}

function onViewClick(x, y, app) {
  const r = app.results;
  const mode = app.viewMode;
  if (!r || mode === 'system' || mode === 'mesh') {
    app.status(`Koordinaten: x = ${fmt(x, 3)} m, y = ${fmt(y, 3)} m`);
    if (app.selection) { app.selection = null; app.redraw(); }
    return;
  }
  const loc = locate(r.mesh, x, y);
  if (!loc) {
    app.status('Der angeklickte Punkt liegt ausserhalb der Platte.', 'warn');
    app.selection = null; app.redraw();
    return;
  }
  const s = currentSet(app);
  const I = (a) => interpolate(loc, a);
  const lines = [`x = ${fmt(x, 2)} m, y = ${fmt(y, 2)} m`];
  if (mode === 'as' && r.design) {
    for (const k of LAYERS) {
      const v = I(r.design.as[k]);
      lines.push(`as ${layerLabel(k).padEnd(7)} = ${fmt(Math.max(v, r.design.asMin[k]), 0)} mm²/m`);
    }
  } else {
    const mx = I(s.mx), my = I(s.my), mxy = I(s.mxy);
    const pm = principalMoments(mx, my, mxy);
    lines.push(`w   = ${fmt(I(s.w) * 1000, 2)} mm`, `mx  = ${fmt(mx, 1)} kNm/m`, `my  = ${fmt(my, 1)} kNm/m`, `mxy = ${fmt(mxy, 1)} kNm/m`, `m₁/m₂ = ${fmt(pm.m1, 1)} / ${fmt(pm.m2, 1)}`);
  }
  app.selection = { probe: { x, y, lines } };
  app.status(`${s.name}: ${lines.join(' · ')}`, 'ok');
  app.redraw();
}

// ------------------------------------------------------------------ Ergebnisse

function overallEta(r) {
  let eta = 0;
  for (const pc of r.punching) if (Number.isFinite(pc.eta)) eta = Math.max(eta, pc.eta);
  if (r.sls) eta = Math.max(eta, r.sls.eta);
  if (r.design?.failed) eta = Infinity;
  return eta;
}

function punchingChecks(r) {
  const rows = [];
  for (const pc of r.punching) {
    if (pc.skip) continue;
    const t = TYPE_LABEL[pc.type] || pc.type;
    const detail = r.norm === 'SIA'
      ? `u = ${fmt(pc.u, 2)} m · ke = ${fmt(pc.ke, 2)} · d = ${fmt(pc.d, 0)} mm · ψ = ${fmt(pc.res.psi * 1000, 2)} ‰ · kr = ${fmt(pc.res.kr, 2)}`
      : `u₁ = ${fmt(pc.u, 2)} m · β = ${fmt(pc.beta, 2)} · d = ${fmt(pc.d, 0)} mm · ρl = ${fmt(pc.rhoL * 100, 2)} %`;
    rows.push({ label: `${pc.name} · ${t}`, ref: `${r.norm === 'SIA' ? 'SIA 262, 4.3.6' : 'EN 1992-1-1, 6.4.4'} · ${pc.combo}`, Ed: pc.Vd, Rd: pc.VRd, unit: 'kN', detail, eta: pc.eta });
  }
  return rows;
}

function renderResults(el, app) {
  const r = app.results;
  if (!r.sets.some((x) => x.key === app.viewOpts.res)) app.viewOpts.res = defaultSet(r).key;
  const s = currentSet(app);
  lastPanelKey = s.key;
  if (r.warnings.length) el.append(note(h('div', {}, h('b', {}, 'Hinweise'), h('ul', { style: { margin: '4px 0 0', paddingLeft: '18px' } }, r.warnings.map((w) => h('li', {}, w)))), 'warn'));

  // Zusammenfassung
  const etaMax = overallEta(r);
  const needP = r.punching.filter((pc) => !pc.skip && pc.eta > 1);
  const impossible = needP.filter((pc) => !pc.res.possible);
  const msgs = [];
  if (r.design?.failed) msgs.push('Biegedruckzone ungenügend – Platte verstärken.');
  if (impossible.length) msgs.push(`Durchstanzen: ${impossible.map((p) => p.name).join(', ')} auch mit Durchstanzbewehrung nicht erfüllt (VRd,max).`);
  else if (needP.length) msgs.push(`Durchstanzbewehrung erforderlich bei ${needP.map((p) => p.name).join(', ')}.`);
  if (r.sls && r.sls.eta > 1) msgs.push(`Durchbiegung w∞ = ${fmt(r.sls.wLong * 1000, 1)} mm > L/${fmt(r.sls.limit, 0)}.`);
  if (!msgs.length) msgs.push(r.punching.length || r.sls ? 'Alle Nachweise erfüllt (Durchstanzen ohne Durchstanzbewehrung).' : 'Keine Nachweise mit Ausnutzung vorhanden.');
  el.append(summaryCard(etaMax, 'Massgebende Ausnutzung', h('div', { class: 'small', style: { marginTop: '4px' } }, msgs.map((m) => h('div', {}, m)))));

  // Auswahl
  const pick = selectField('Ergebnisse für', app.viewOpts, 'res', setOptions(r), {
    onChange: () => { lastPanelKey = app.viewOpts.res; app.renderView(); app.renderResults(); },
    info: 'Lastfall oder Kombination für Kennzahlen, Auflagerkräfte und Grafik. Bemessung und Durchstanzen verwenden immer die Umhüllende aller Tragsicherheitskombinationen.',
  });
  pick.lastChild?.remove?.();
  el.append(pick);

  const n = r.mesh.nNodes;
  const dEq = Math.abs(s.sumR - s.sumF);
  el.append(stats([
    ['Knoten / Elemente', `${n} / ${r.mesh.nTri}`],
    ['w max', s.wmax * 1000, 'mm', 2],
    ['mx min / max', `${fmt(s.mExt.mx[0], 1)} / ${fmt(s.mExt.mx[1], 1)}`, 'kNm/m'],
    ['my min / max', `${fmt(s.mExt.my[0], 1)} / ${fmt(s.mExt.my[1], 1)}`, 'kNm/m'],
    ['Σ Lasten', s.sumF, 'kN', 1],
    ['Σ Auflagerkräfte', s.sumR, 'kN', 1],
  ]));
  el.append(note(dEq <= 1e-6 * Math.max(1, Math.abs(s.sumF))
    ? `Gleichgewicht erfüllt: Σ Auflagerkräfte = Σ Lasten (Abweichung ${fmt(dEq, 4)} kN).`
    : `Gleichgewichtsabweichung ${fmt(dEq, 3)} kN – Eingaben prüfen.`, dEq <= 1e-6 * Math.max(1, Math.abs(s.sumF)) ? 'ok' : 'fail'));

  // Auflagerkräfte
  const rows = r.supports.map((sp, k) => {
    const f = s.supportForces[k];
    return sp.kind === 'point'
      ? [sp.name, sp.rigid ? 'Stütze' : 'Feder', f.value, '–']
      : [sp.name, sp.clamped ? 'Wand, eingesp.' : 'Wand', f.total, fmt(f.maxR, 1)];
  });
  el.append(group(`Auflagerkräfte – ${s.name}`, [resultTable(['Lager', 'Art', { label: 'R', unit: 'kN', num: true, digits: 1 }, { label: 'max r', unit: 'kN/m', num: true }], rows)], {
    collapsible: true, collapsed: r.supports.length > 16,
    info: 'R: Lagerkraft (positiv = Druck). Wände: Summe und grösste Linienlagerkraft. Knoten, die zu mehreren Lagern gehören (Wandecken), werden zu gleichen Teilen zugeordnet. Negative Werte an Wandenden sind die abhebenden Eckkräfte der Kirchhoff-Platte.',
  }));

  // Durchstanzen
  if (r.punching.length) {
    const checks = punchingChecks(r);
    const content = [checksTable(checks, { edLabel: 'Vd', rdLabel: 'VRd,c' })];
    const lines = r.punching.filter((pc) => !pc.skip).map((pc) => {
      const ok = pc.eta <= 1, poss = pc.res.possible;
      return h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '2px 0' } },
        h('b', { style: { minWidth: '34px' } }, pc.name),
        ok ? badge('ohne Durchstanzbewehrung erfüllt', 'ok') : poss ? badge('Durchstanzbewehrung erforderlich', 'warn') : badge('VRd,max überschritten', 'fail'),
        ok ? null : h('span', { class: 'muted small' }, `VRd,max = ${fmt(pc.res.VRdmax, 0)} kN`));
    });
    content.push(h('div', { style: { marginTop: '6px' } }, lines));
    const skipped = r.punching.filter((pc) => pc.skip);
    if (skipped.length) content.push(note(`Ohne Nachweis (keine Druckkraft): ${skipped.map((p) => p.name).join(', ')}`));
    el.append(group('Durchstanzen', content, {
      info: r.norm === 'SIA'
        ? 'SIA 262:2013, 4.3.6, Näherungsstufe 2. Vd = grösste Stützenkraft aller Tragsicherheitskombinationen. Rand- und Eckstützen werden aus dem angeschnittenen Nachweisschnitt erkannt.'
        : 'EN 1992-1-1, 6.4.4: vEd = β·VEd/(u₁·d) ≤ vRd,c. ρl aus der Bewehrung über der Stütze.',
    }));
  }

  // Biegebewehrung
  if (r.design) {
    const d = r.design;
    const anyBase = LAYERS.some((k) => d.asBasic[k] > 0);
    const rowsD = LAYERS.map((k) => {
      const L = d.layers[k];
      const minGov = !(L.asMax > L.asMin);
      return [
        h('div', {}, L.label, h('div', { class: 'muted small' }, `d = ${fmt(L.d, 0)} mm`)),
        fmt(L.mMax, 1),
        h('span', {}, Number.isFinite(L.asMax) ? fmt(Math.max(L.asMax, L.asMin), 0) : '–', minGov ? h('span', { class: 'muted small' }, ' min') : null),
        L.bars.label,
        ...(anyBase ? [d.asBasic[k] > 0 ? `${fmt(L.extraShare * 100, 0)} %` : '–'] : []),
      ];
    });
    el.append(group('Biegebewehrung (Umhüllende GZT)', [
      resultTable(['Lage', { label: 'mEd', unit: 'kNm/m', num: true }, { label: 'as,erf', unit: 'mm²/m', num: true }, 'Vorschlag', ...(anyBase ? [{ label: 'Zulagen', num: true }] : [])], rowsD),
      h('div', { class: 'muted small', style: { marginTop: '4px' } }, `mEd: grösstes Wood–Armer-Moment. as,erf inkl. Mindestbewehrung («min» = massgebend, as,min = ${fmt(Math.min(...LAYERS.map((k) => d.asMin[k])), 0)}–${fmt(Math.max(...LAYERS.map((k) => d.asMin[k])), 0)} mm²/m). Lage der Maxima: Ansicht «Bewehrung».` + (anyBase ? ' Zulagen: Flächenanteil, in dem die Grundbewehrung nicht genügt.' : '')),
    ], { info: 'Bemessung je Knoten aus der Umhüllenden der Wood–Armer-Momente aller Tragsicherheitskombinationen. Spitzenwerte über Stützen und unter Punktlasten sind netzabhängig.' }));
  }

  // Durchbiegung
  if (r.sls) {
    const sl = r.sls;
    el.append(group('Durchbiegung', [
      checksTable([{ label: `w∞ = ${fmt(sl.factor, 1)} · w_el ≤ L/${fmt(sl.limit, 0)}`, ref: `${sl.combo} · L = ${fmt(sl.Lspan, 2)} m${sl.autoSpan ? ' (automatisch)' : ''}`, Ed: sl.wLong * 1000, Rd: sl.wLim * 1000, unit: 'mm' }], { edLabel: 'w∞', rdLabel: 'w,lim' }),
      h('div', { class: 'muted small', style: { marginTop: '4px' } }, `Elastisch: w_el = ${fmt(sl.wEl * 1000, 2)} mm bei x = ${fmt(sl.x, 2)}, y = ${fmt(sl.y, 2)} m.`),
    ], { info: 'Vereinfachter Nachweis: elastische Durchbiegung der quasi-ständigen Kombination mal Langzeitfaktor k (Kriechen, Rissbildung), verglichen mit L/Grenzwert. Einstellungen im Register «Bemessung».' }));
  }

  // Modell
  const q = r.mesh.quality;
  el.append(group('Modell und Rechenzeit', [kvTable([
    ['Elementtyp', 'DKT (3 Knoten, 9 FHG)'],
    ['Gleichungen', r.neq, '', 0],
    ['Kleinster Elementwinkel', q.minAngle, '°', 1],
    ['Biegesteifigkeit D', r.D / 1000, 'MNm', 2],
    ['Netz / Lösung / Auswertung', `${fmt(r.time.mesh, 0)} / ${fmt(r.time.solve, 0)} / ${fmt(r.time.post, 0)}`, 'ms'],
  ])], { collapsible: true, collapsed: true }));
}

// ------------------------------------------------------------------ Bericht

function withView(app, opts, fn) {
  const prev = { ...app.viewOpts };
  const sel = app.selection;
  app.selection = null;
  Object.assign(app.viewOpts, opts);
  snapshotting = true;
  try { return fn(); } finally {
    snapshotting = false;
    for (const k of Object.keys(app.viewOpts)) if (!(k in prev)) delete app.viewOpts[k];
    Object.assign(app.viewOpts, prev);
    app.selection = sel;
  }
}

/**
 * Beschneidet eine Momentaufnahme vertikal auf den Modellbereich (die Ansicht hat meist Hochformat,
 * die Platte Querformat) und verschiebt Legende, Zeichenerklärung und Bildunterschrift mit.
 */
function cropFigure(svg, app) {
  const v = app.view, b = v.modelBounds;
  if (!b || !(v.height > 0)) return svg;
  const W = v.width, H = v.height;
  const screen = [...svg.children].find((c) => (c.getAttribute('class') || '') === 'screen');
  const items = screen ? [...screen.children] : [];
  let legendH = 0, bottomH = 0;
  for (const g of items) {
    const cls = g.getAttribute('class') || '';
    if (cls.includes('legend') && !cls.includes('key')) legendH = Math.max(legendH, Number(g.querySelector('rect')?.getAttribute('height')) || 0);
    else if (cls.includes('key-legend')) bottomH += (g.children.length / 2) * 17 + 8;
    else bottomH += 22;
  }
  let top = Math.max(0, v.Y(b.y1) - 46);
  let bottom = Math.min(H, v.Y(b.y0) + 70 + bottomH);
  if (bottom - top < legendH + 24 + bottomH) bottom = Math.min(H, top + legendH + 24 + bottomH);
  if (bottom - top >= H - 4) return svg;
  for (const g of items) {
    const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(g.getAttribute('transform') || '');
    if (!m) continue;
    const y = Number(m[2]);
    g.setAttribute('transform', `translate(${m[1]} ${y > H / 2 ? y - (H - bottom) : y + top})`);
  }
  svg.setAttribute('viewBox', `0 ${top.toFixed(1)} ${W} ${(bottom - top).toFixed(1)}`);
  return svg;
}

function report(app) {
  const r = app.results;
  const p = app.project;
  const c = r.conc, st = r.steel;
  const fig = (mode, opts, caption) => repFigure(withView(app, { iso: true, vals: false, meshOv: false, labels: true, punch: true, ...opts }, () => cropFigure(app.snapshot(mode), app)), caption);
  const uls = defaultSet(r, 'ULS'), sls = defaultSet(r, 'SLS');
  const ulsSets = r.sets.filter((s) => s.kind === 'combo' && s.type === 'ULS');
  const sections = [];

  sections.push({ title: 'Grundlagen', content: [
    repKV([
      ['Normen', r.norm === 'SIA' ? 'SIA 260, 261, 262:2013' : 'EN 1990, 1991-1-1, 1992-1-1'],
      ['Beton', c.name],
      ['fck / fcd', `${fmt(c.fck, 0)} / ${fmt(c.fcd, 1)}`, 'MPa'],
      ['Ecm', c.Ecm / 1000, 'GPa', 1],
      c.tcd ? ['τcd', c.tcd, 'MPa', 2] : null,
      ['Betonstahl', st.name],
      ['fsk / fsd', `${fmt(st.fsk, 0)} / ${fmt(st.fsd, 0)}`, 'MPa'],
      ['Plattendicke h', r.h, 'm', 3],
      ['Querdehnzahl ν', r.nu, '', 2],
      ['Biegesteifigkeit D', r.D, 'kNm', 0],
    ]),
    repFormula('D = Ecm·h³ / (12·(1 − ν²))'),
    repP('Berechnungsmodell: schubstarre Kirchhoff-Platte, linear-elastisch, ungerissen, Finite-Elemente-Methode mit DKT-Elementen (Batoz/Bathe/Ho 1980). Stützen mit Abmessungen werden als starre Stützenköpfe abgebildet; Wände als vertikal starre Linienlager.'),
  ] });

  // System
  const sysC = [fig('system', {}, 'Statisches System mit Lagern und Lasten')];
  sysC.push(repTable(['Punkt', { label: 'x [m]', num: true, digits: 3 }, { label: 'y [m]', num: true, digits: 3 }], p.outline.map((q, i) => [String(i + 1), q.x, q.y]), { caption: 'Plattenrand' }));
  p.openings.forEach((o, i) => sysC.push(repTable(['Punkt', { label: 'x [m]', num: true, digits: 3 }, { label: 'y [m]', num: true, digits: 3 }], o.pts.map((q, j) => [String(j + 1), q.x, q.y]), { caption: `Öffnung ${i + 1}${o.name ? ` – ${o.name}` : ''}` })));
  if (p.pointSupports.length) {
    sysC.push(repTable(['Stütze', { label: 'x [m]', num: true }, { label: 'y [m]', num: true }, { label: 'b × h [m]' }, 'Lagerung'],
      p.pointSupports.map((s, i) => [`S${i + 1}`, s.x, s.y, `${fmt(s.b || 0, 2)} × ${fmt(s.hc || 0, 2)}`,
        `${s.kz > 0 ? `kz = ${fmt(s.kz, 0)} kN/m` : 'starr'}${s.kr > 0 ? `, kφ = ${fmt(s.kr, 0)} kNm/rad` : ''}`]), { caption: 'Punktlager' }));
  }
  if (p.lineSupports.length) {
    sysC.push(repTable(['Wand', { label: 'x₁', num: true }, { label: 'y₁', num: true }, { label: 'x₂', num: true }, { label: 'y₂', num: true }, 'Lagerung'],
      p.lineSupports.map((w, i) => [`W${i + 1}`, w.x1, w.y1, w.x2, w.y2, w.clamped ? 'eingespannt' : 'gelenkig']), { caption: 'Linienlager [m]' }));
  }
  sections.push({ title: 'System', content: sysC });

  // Einwirkungen
  const lcName = (id) => p.loadCases.find((l) => l.id === id)?.name || id;
  const loadsC = [repTable(['Lastfall', 'Art', 'Eigengewicht', 'Kategorie', { label: 'ψ₀', num: true }, { label: 'ψ₁', num: true }, { label: 'ψ₂', num: true }],
    p.loadCases.map((l) => [l.name, l.type === 'Q' ? 'veränderlich' : 'ständig', l.sw ? `${fmt(25 * p.h, 2)} kN/m²` : '–',
      l.type === 'Q' ? (LOAD_CATEGORIES.find((k) => k.value === l.cat)?.label || '') : '–',
      l.type === 'Q' ? l.psi0 : '', l.type === 'Q' ? l.psi1 : '', l.type === 'Q' ? l.psi2 : '']), { caption: 'Lastfälle' })];
  if (p.areaLoads.length) loadsC.push(repTable(['Lastfall', { label: 'q [kN/m²]', num: true }, 'Bereich'], p.areaLoads.map((l) => [lcName(l.lc), l.q, l.region === 'all' || !l.region ? 'ganze Platte' : (p.loadAreas.find((a) => a.id === l.region)?.name || l.region)]), { caption: 'Flächenlasten' }));
  if (p.lineLoads.length) loadsC.push(repTable(['Lastfall', { label: 'x₁', num: true }, { label: 'y₁', num: true }, { label: 'x₂', num: true }, { label: 'y₂', num: true }, { label: 'p₁ [kN/m]', num: true }, { label: 'p₂ [kN/m]', num: true }], p.lineLoads.map((l) => [lcName(l.lc), l.x1, l.y1, l.x2, l.y2, l.p1, l.p2 ?? l.p1]), { caption: 'Linienlasten (Koordinaten in m)' }));
  if (p.pointLoads.length) loadsC.push(repTable(['Lastfall', { label: 'x [m]', num: true }, { label: 'y [m]', num: true }, { label: 'P [kN]', num: true }], p.pointLoads.map((l) => [lcName(l.lc), l.x, l.y, l.P]), { caption: 'Punktlasten' }));
  loadsC.push(repTable(['Kombination', 'Art', 'Formel', { label: 'Σ Lasten [kN]', num: true, digits: 1 }], r.sets.filter((s) => s.kind === 'combo').map((s) => [s.name, comboTypeLabel(s.type), s.formula, s.sumF]), { caption: `Lastkombinationen${r.autoCombos ? ' (automatisch nach ' + (r.norm === 'SIA' ? 'SIA 260' : 'EN 1990') + ')' : ''}` }));
  sections.push({ title: 'Einwirkungen', content: loadsC });

  // Modell
  sections.push({ title: 'FE-Modell', content: [
    fig('mesh', {}, 'Finite-Elemente-Netz'),
    repKV([
      ['Knoten / Elemente', `${r.mesh.nNodes} / ${r.mesh.nTri}`],
      ['Netzweite', r.mesh.size, 'm', 2],
      ['Kleinster Elementwinkel', r.mesh.quality.minAngle, '°', 1],
      ['Gleichungen', r.neq, '', 0],
    ]),
  ] });

  // Ergebnisse
  const resC = [];
  if (sls) resC.push(fig('w', { res: sls.key }, `Durchbiegung w [mm] – ${sls.name}`));
  if (uls) {
    resC.push(fig('mx', { res: uls.key }, `Biegemoment mx [kNm/m] – ${uls.name}`));
    resC.push(fig('my', { res: uls.key }, `Biegemoment my [kNm/m] – ${uls.name}`));
    resC.push(fig('react', { res: uls.key }, `Auflagerkräfte – ${uls.name}`));
    resC.push(repTable(['Lager', 'Art', ...ulsSets.map((s) => ({ label: `${s.name} [kN]`, num: true, digits: 1 })), { label: `${sls?.name || 'SLS'} [kN]`, num: true, digits: 1 }],
      r.supports.map((sp, k) => [sp.name, sp.kind === 'point' ? 'Stütze' : 'Wand', ...ulsSets.map((s) => s.supportForces[k].total), sls ? sls.supportForces[k].total : '']), { caption: 'Auflagerkräfte' }));
  }
  resC.push(repTable(['Lastfall / Kombination', { label: 'Σ Lasten [kN]', num: true, digits: 2 }, { label: 'Σ Auflager [kN]', num: true, digits: 2 }, { label: 'w max [mm]', num: true, digits: 2 }, { label: 'mx min/max [kNm/m]' }, { label: 'my min/max [kNm/m]' }],
    r.sets.map((s) => [s.name, s.sumF, s.sumR, s.wmax * 1000, `${fmt(s.mExt.mx[0], 1)} / ${fmt(s.mExt.mx[1], 1)}`, `${fmt(s.mExt.my[0], 1)} / ${fmt(s.mExt.my[1], 1)}`]), { caption: 'Übersicht und Gleichgewichtskontrolle' }));
  sections.push({ title: 'Schnittgrössen und Auflagerkräfte', content: resC });

  // Bemessung
  if (r.design) {
    const d = r.design;
    const dC = [repP(`Bemessungsmomente nach Wood–Armer (Umhüllende von ${ulsSets.map((s) => s.name).join(', ')}). Erforderliche Bewehrung mit rechteckigem Spannungsblock (Höhe ${fmt(d.lambda, 2)}·x, σc = fcd).`),
      repFormula('unten: mx* = mx + |mxy|, my* = my + |mxy|   oben: mx* = mx − |mxy|, my* = my − |mxy|  (mit Wood–Armer-Korrektur bei Vorzeichenwechsel)\nas = ω·b·d·fcd/fsd,  ω = 1 − √(1 − 2·mEd/(b·d²·fcd))')];
    for (const k of LAYERS) dC.push(fig('as', { layer: k }, `Erforderliche Bewehrung ${layerLabel(k)} [mm²/m]`));
    dC.push(repTable(['Lage', { label: 'd [mm]', num: true, digits: 0 }, { label: 'mEd,max [kNm/m]', num: true, digits: 1 }, { label: 'as,erf [mm²/m]', num: true, digits: 0 }, { label: 'as,min [mm²/m]', num: true, digits: 0 }, 'Vorschlag', { label: 'Grundbew. [mm²/m]', num: true, digits: 0 }],
      LAYERS.map((k) => { const L = d.layers[k]; return [L.label, L.d, L.mMax, L.asMax, L.asMin, L.bars.label, d.asBasic[k] || 0]; }), { caption: 'Zusammenstellung Biegebewehrung' }));
    sections.push({ title: 'Bemessung Biegung', content: dC });
  }

  // Durchstanzen
  if (r.punching.length) {
    const pc0 = r.punching.find((pc) => !pc.skip);
    const pC = [];
    if (r.norm === 'SIA') {
      pC.push(repP('Nachweis nach SIA 262:2013, Ziffer 4.3.6, Näherungsstufe 2, ohne Durchstanzbewehrung. Vd = grösste Stützenkraft der Tragsicherheitskombinationen (ohne Abzug der Last innerhalb des Nachweisschnitts).'));
      pC.push(repFormula('u: Nachweisschnitt im Abstand dv/2 vom Stützenrand (ausserhalb der Platte bzw. im Schatten von Öffnungen < 5d unwirksam)\nψ = 1.5·(rs/d)·(fsd/Es)·(msd/mRd)^1.5   mit rs = 0.22·L, msd = Vd/8 (innen), Vd/4 (Rand), Vd/2 (Ecke)   (Gl. 59, 64–67)\nkr = 1/(0.45 + 0.18·ψ·d·kg) ≤ 2.0,  kg = 48/(16 + Dmax)   (Gl. 58)\nVRd,c = kr·τcd·dv·ke·u,  ke = 0.90 / 0.70 / 0.65   (Gl. 57, 4.3.6.2.5)\nVRd,max = 2·kr·τcd·dv·ke·u ≤ 3.5·τcd·dv·ke·u   (4.3.6.5.7)'));
      pC.push(repTable(['Stütze', 'Typ', { label: 'Vd [kN]', num: true, digits: 1 }, { label: 'u [m]', num: true, digits: 3 }, { label: 'ke', num: true, digits: 2 }, { label: 'rs x/y [m]' }, { label: 'mRd [kNm/m]', num: true, digits: 1 }, { label: 'ψ [‰]', num: true, digits: 2 }, { label: 'kr', num: true, digits: 3 }, { label: 'VRd,c [kN]', num: true, digits: 1 }, { label: 'η', num: true, digits: 2 }, 'Ergebnis'],
        r.punching.filter((pc) => !pc.skip).map((pc) => [pc.name, TYPE_LABEL[pc.type], pc.Vd, pc.u, pc.ke, `${fmt(pc.rsx, 2)} / ${fmt(pc.rsy, 2)}`, Math.min(pc.mRdx, pc.mRdy), pc.res.psi * 1000, pc.res.kr, pc.VRd, pc.eta,
          pc.eta <= 1 ? 'erfüllt' : pc.res.possible ? `Durchstanzbewehrung erforderlich (VRd,max = ${fmt(pc.res.VRdmax, 0)} kN)` : 'nicht erfüllt (VRd,max)']), { caption: `Durchstanznachweise (d = dv = ${fmt(pc0?.d, 0)} mm, τcd = ${fmt(c.tcd, 2)} MPa)` }));
    } else {
      pC.push(repP('Nachweis nach EN 1992-1-1, 6.4.4 ohne Durchstanzbewehrung; kritischer Rundschnitt u₁ im Abstand 2d.'));
      pC.push(repFormula('vEd = β·VEd/(u₁·d) ≤ vRd,c = CRd,c·k·(100·ρl·fck)^(1/3) ≥ vmin\nk = 1 + √(200/d) ≤ 2,  CRd,c = 0.18/γc,  vmin = 0.035·k^1.5·fck^0.5'));
      pC.push(repTable(['Stütze', 'Typ', { label: 'VEd [kN]', num: true, digits: 1 }, { label: 'u₁ [m]', num: true, digits: 3 }, { label: 'β', num: true, digits: 2 }, { label: 'ρl [%]', num: true, digits: 2 }, { label: 'vEd [MPa]', num: true, digits: 3 }, { label: 'vRd,c [MPa]', num: true, digits: 3 }, { label: 'η', num: true, digits: 2 }, 'Ergebnis'],
        r.punching.filter((pc) => !pc.skip).map((pc) => [pc.name, TYPE_LABEL[pc.type], pc.Vd, pc.u, pc.beta, pc.rhoL * 100, pc.res.vEd, pc.res.vRdc, pc.eta, pc.eta <= 1 ? 'erfüllt' : pc.res.possible ? 'Durchstanzbewehrung erforderlich' : 'nicht erfüllt (vRd,max)']), { caption: 'Durchstanznachweise' }));
    }
    sections.push({ title: 'Durchstanzen', content: pC });
  }

  if (r.sls) {
    const sl = r.sls;
    sections.push({ title: 'Gebrauchstauglichkeit', content: [
      repKV([
        ['Kombination', sl.combo],
        ['Elastische Durchbiegung w_el', sl.wEl * 1000, 'mm', 2],
        ['Langzeitfaktor k (Kriechen, Rissbildung)', sl.factor, '', 2],
        ['w∞ = k·w_el', sl.wLong * 1000, 'mm', 2],
        ['Grenzwert L/' + fmt(sl.limit, 0) + ` (L = ${fmt(sl.Lspan, 2)} m)`, sl.wLim * 1000, 'mm', 2],
        ['Ausnutzung', sl.eta, '', 2],
        ['Ergebnis', sl.eta <= 1 ? 'erfüllt' : 'nicht erfüllt'],
      ]),
    ] });
  }

  sections.push({ title: 'Normbezüge und Annahmen', content: [h('ul', {},
    h('li', {}, 'Kombinationen: SIA 260:2013 Ziff. 4.4.3 (Tragsicherheit, Typ 2) und 4.4.4 (Gebrauchstauglichkeit); EN 1990 (6.10), (6.16).'),
    h('li', {}, 'Bemessungsmomente: Wood (1968), Armer (1968); Biegebemessung SIA 262 Ziff. 4.2.1/4.3.2 bzw. EN 1992-1-1 3.1.7, 6.1.'),
    h('li', {}, 'Durchstanzen: SIA 262:2013 Ziff. 4.3.6 bzw. EN 1992-1-1 Abschn. 6.4.'),
    h('li', {}, 'FE-Element: Batoz, Bathe, Ho, Int. J. Numer. Meth. Eng. 15 (1980) 1771–1812; Kontrolle an Timoshenko/Woinowsky-Krieger, Theory of Plates and Shells.'),
    h('li', {}, 'Annahmen: linear-elastisch, ungerissen; keine günstige Wirkung ständiger Lasten (γG,inf) und keine feldweise Laststellung, sofern nicht von Hand definiert; Momentenspitzen unter Punktlasten und an Punktlagern netzabhängig.'),
    ...r.warnings.map((w) => h('li', {}, `Hinweis: ${w}`)))] });
  return sections;
}

// ------------------------------------------------------------------ Anwendung

const app = createApp({
  id: 'platte',
  title: 'Platte',
  subtitle: 'FE-Plattenberechnung',
  version: 1,
  defaultProject,
  examples: EXAMPLES,
  migrate: withDefaults,
  intro: INTRO,
  help: HELP,
  autoCompute: false,
  inputTabs: [
    { id: 'geo', label: 'Geometrie', render: geometryTab },
    { id: 'sup', label: 'Lager', render: supportTab },
    { id: 'loads', label: 'Lasten', render: loadTab },
    { id: 'design', label: 'Bemessung', render: designTab },
  ],
  viewModes: (a) => [
    { id: 'system', label: 'System', title: 'Geometrie, Lager und Lasten' },
    { id: 'mesh', label: 'Netz', title: 'Finite-Elemente-Netz (Vorschau auch ohne Berechnung)' },
    { id: 'w', label: 'w', needsResults: true, title: 'Durchbiegung' },
    { id: 'mx', label: 'mx', needsResults: true, title: 'Biegemoment mx (Bewehrung in x-Richtung)' },
    { id: 'my', label: 'my', needsResults: true, title: 'Biegemoment my (Bewehrung in y-Richtung)' },
    { id: 'mxy', label: 'mxy', needsResults: true, title: 'Drillmoment' },
    { id: 'm12', label: 'm₁/m₂', needsResults: true, title: 'Hauptmomente und -richtungen' },
    { id: 'as', label: 'Bewehrung', needsResults: true, disabled: !!a.results && !a.results.design, title: 'Erforderliche Biegebewehrung (Umhüllende GZT)' },
    { id: 'react', label: 'Reaktionen', needsResults: true, title: 'Auflagerkräfte, Linienlagerverläufe und Durchstanzen' },
  ],
  viewOptions: (a) => {
    const m = a.viewMode, r = a.results;
    const out = [];
    if (m === 'system') out.push({ key: 'labels', label: 'Beschriftung', type: 'check', default: true });
    if (r && RESULT_MODES.has(m)) {
      const opts = setOptions(r);
      const def = (m === 'w' ? defaultSet(r, 'SLS') : defaultSet(r)).key;
      if (!opts.some((o) => o.value === a.viewOpts.res)) a.viewOpts.res = def;
      out.push({ key: 'res', label: 'Lastfall', type: 'select', options: opts, default: def });
    }
    if (r && m === 'm12') out.push({ key: 'pm', label: 'Anzeige', type: 'select', default: 'm1', options: [{ value: 'm1', label: 'm₁ (Maximum)' }, { value: 'm2', label: 'm₂ (Minimum)' }, { value: 'dir', label: 'Richtungen' }] });
    if (r && m === 'as') out.push({ key: 'layer', label: 'Lage', type: 'select', default: 'bx', options: LAYERS.map((k) => ({ value: k, label: layerLabel(k) })) });
    if (r && CONTOUR_MODES.has(m)) {
      out.push({ key: 'iso', label: 'Isolinien', type: 'check', default: true });
      out.push({ key: 'vals', label: 'Werte', type: 'check', default: false });
      out.push({ key: 'meshOv', label: 'Netz', type: 'check', default: false });
    }
    if (r && m === 'react' && r.punching.length) out.push({ key: 'punch', label: 'Durchstanzen', type: 'check', default: true });
    return out;
  },
  renderView,
  onViewClick,
  compute: (project) => analyse(project),
  renderResults,
  report,
});

// Kleine Projekte (Beispiele) nach dem Laden sofort berechnen
const baseSetProject = app.setProject;
app.setProject = (p, opts) => {
  baseSetProject(p, opts);
  if (estimateNodes(app.project) <= AUTO_COMPUTE_NODES) setTimeout(() => { if (!app.results) app.compute(); }, 0);
};
{
  // Start: kleine Projekte gleich berechnen und eine per URL verlangte Ergebnisansicht (?ansicht=mx) danach öffnen
  const startView = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('ansicht') || new URLSearchParams(location.search).get('view') : null;
  setTimeout(() => {
    if (!app.results && estimateNodes(app.project) <= AUTO_COMPUTE_NODES) app.compute();
    if (startView && app.results && app.viewMode !== startView) app.setViewMode(startView);
  }, 0);
}

