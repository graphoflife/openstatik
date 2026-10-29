// Modul «Platte» – FE-Plattenberechnung (Oberfläche)
import { createApp, IncompleteInput } from '../../js/core/app.js';
import { h, group, stats, checksTable, summaryCard, note, resultTable, kvTable, badge, selectField, clone, rich, unicodeSub } from '../../js/core/ui.js';
import { fmt, subHtml as I } from '../../js/core/format.js';
import { repTable, repKV, repFigure, repFormula, repP } from '../../js/core/report.js';
import {
  analyse, withDefaults, estimateNodes, meshProject, locate, interpolate, layerLabel, comboTypeLabel, LOAD_CATEGORIES, geometryOf,
} from './calc.js';
import { editorSpec } from './editing.js';
import { derivation } from './derivation.js';
import { activeLoadCase } from './model.js';
import { EXAMPLES, defaultProject } from './examples.js';
import { geometryTab, supportTab, loadTab, designTab } from './inputs.js';
import { drawSystem, drawMesh, drawContour, drawPrincipalCrosses, drawReactions, drawProbe, slabBounds, defaultSet, setOptions, currentSet } from './views.js';
import { principalMoments } from './design.js';
import { INTRO, HELP } from './help.js';

const LAYERS = ['bx', 'by', 'tx', 'ty'];
const TYPE_LABEL = { innen: 'Innenstütze', rand: 'Randstütze', ecke: 'Eckstütze' };
const RESULT_MODES = new Set(['w', 'mx', 'my', 'mxy', 'm12', 'react']);
const CONTOUR_MODES = new Set(['w', 'mx', 'my', 'mxy', 'm12', 'as']);
const AUTO_COMPUTE_NODES = 4000;

// ------------------------------------------------------------------ Hilfen

/** Fehlt noch etwas Grundlegendes? → IncompleteInput mit Hinweis, wie es weitergeht. */
function checkComplete(p) {
  if (!geometryOf(p).slabs.length) {
    throw new IncompleteInput('Noch keine Platte vorhanden.', 'Werkzeug «Platte» (Taste U) wählen und die Eckpunkte in die Grafik klicken – oder im Register «Platten» «Rechteck …» verwenden. Fertige Systeme finden Sie oben unter «Beispiele».');
  }
  if (!(p.pointSupports || []).length && !(p.lineSupports || []).length) {
    throw new IncompleteInput('Es fehlen noch Lager.', 'Werkzeug «Wand» (W) entlang der gelagerten Ränder zeichnen oder «Stütze» (S) setzen. Tipp: Platte anklicken › «Wände an freien Rändern».');
  }
  if (!(p.loadCases || []).length) {
    throw new IncompleteInput('Es ist kein Lastfall vorhanden.', 'Im Register «Lasten» einen Lastfall anlegen, z.B. «Eigengewicht» mit automatischem Eigengewicht (EG).');
  }
}

function isComplete(p) {
  try { checkComplete(p); return true; } catch { return false; }
}

function compute(project) {
  checkComplete(project);
  return analyse(project);
}

/** Bearbeitungshilfen (Raster, Auswahl) aus einer Momentaufnahme entfernen. */
function stripEditor(svg) {
  for (const c of [...svg.children]) {
    const cls = c.getAttribute('class') || '';
    if (cls === 'gridlayer' || cls === 'interact') c.remove();
  }
  return svg;
}

const meshCache = { key: null, mesh: null, error: null, elemFactor: null };
function previewMesh(app) {
  const p = app.project;
  const key = JSON.stringify([p.slabs, p.openings, p.meshSize, p.pointSupports, p.lineSupports, p.lineLoads, p.pointLoads, p.loadAreas, p.refineColumns, p.columnHeads]);
  if (meshCache.key !== key) {
    meshCache.key = key;
    try {
      const m = meshProject(withDefaults(clone(p)));
      meshCache.mesh = m.mesh; meshCache.error = null; meshCache.geo = m.geo;
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
  const a = d.as[layer], min = d.asMinNode[layer], base = d.asBasic[layer] || 0;
  let maxFinite = 0;
  for (const v of a) if (Number.isFinite(v) && v > maxFinite) maxFinite = v;
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const v = Number.isFinite(a[i]) ? a[i] : maxFinite * 1.05; // Druckzone ungenügend → Spitzenwert
    out[i] = base > 0 ? Math.max(0, Math.max(v, min[i]) - base) : v;
  }
  return out;
}

// ------------------------------------------------------------------ Darstellung

function renderView(view, app, mode) {
  const p = app.project;
  if (!geometryOf(p).slabs.length) {
    // Leeres Projekt: Zeichenfläche ca. 10 × 8 m mit Raster, Hinweis zum ersten Schritt
    view.setBounds(-1, -1, 11, 9);
    for (const sl of p.slabs) for (const q of sl.outline) if (Number.isFinite(+q.x) && Number.isFinite(+q.y)) view.dot(+q.x, +q.y, 3.5, { fill: 'var(--c-struct)' });
    view.caption('Leeres Projekt – «Platte» (U) wählen und die Eckpunkte anklicken');
    return;
  }
  const b = slabBounds(p);
  if (b) view.setBounds(b.x0, b.y0, b.x1, b.y1, { noFit: true });
  const r = app.results;
  if (!mode || mode === 'system' || (!r && mode !== 'mesh')) {
    drawSystem(view, app);
  } else if (mode === 'mesh') {
    if (r && !app.stale) drawMesh(view, app, r.mesh, { headMask: r.headMask, slabs: r.slabs, eSlab: r.eSlab, free: r.free });
    else {
      const pv = previewMesh(app);
      if (pv.mesh) drawMesh(view, app, pv.mesh, { preview: true, slabs: pv.geo?.slabs });
      else { drawSystem(view, app); app.showViewMessage(`Netz kann nicht erzeugt werden: ${pv.error}`); }
    }
  } else {
    const s = currentSet(app);
    const head = `${s.kind === 'lc' ? 'Lastfall' : comboTypeLabel(s.type)}: ${s.name}`;
    if (mode === 'w') {
      drawContour(view, app, s.w.map((v) => v * 1000), { title: 'w', unit: 'mm', symmetric: 'auto', caption: `${head} · Durchbiegung w, elastisch, positiv nach unten` });
    } else if (mode === 'mx' || mode === 'my') {
      const sym = `m_${mode[1]}`;
      drawContour(view, app, s[mode], { title: sym, unit: 'kNm/m', symmetric: true, zeroLine: true, clip: 0.97, caption: `${head} · ${sym} (Bewehrung in ${mode[1]}-Richtung), positiv = Zug unten` });
    } else if (mode === 'mxy') {
      drawContour(view, app, s.mxy, { title: 'm_xy', unit: 'kNm/m', symmetric: true, clip: 0.97, caption: `${head} · Drillmoment m_xy` });
    } else if (mode === 'm12') {
      const pm = app.viewOpts.pm || 'm1';
      if (pm === 'dir') drawPrincipalCrosses(view, app, s);
      else drawContour(view, app, nodal(s, pm), { title: pm === 'm2' ? 'm_2' : 'm_1', unit: 'kNm/m', symmetric: true, zeroLine: true, clip: 0.97, caption: `${head} · Hauptmoment ${pm === 'm2' ? 'm_2 (Minimum)' : 'm_1 (Maximum)'}` });
    } else if (mode === 'as') {
      const layer = LAYERS.includes(app.viewOpts.layer) ? app.viewOpts.layer : 'bx';
      const d = r.design;
      const base = d.asBasic[layer] || 0;
      const minTxt = d.bySlab.length > 1 ? `${fmt(Math.min(...d.bySlab.map((b) => b.asMin[layer])), 0)}–${fmt(Math.max(...d.bySlab.map((b) => b.asMin[layer])), 0)}` : fmt(d.asMin[layer], 0);
      drawContour(view, app, designValues(r, layer), {
        title: base > 0 ? 'Zulage' : 'a_s,erf', unit: 'mm²/m', symmetric: false, showMin: false, digits: 0, clip: 0.98, neutralBelow: 1,
        caption: base > 0
          ? `Zulagen ${layerLabel(layer)} über Grundbewehrung ${fmt(base, 0)} mm²/m · Umhüllende GZT`
          : `a_s ${layerLabel(layer)} · Umhüllende GZT · a_s,min = ${minTxt} mm²/m beachten`,
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
      lines.push(`a_s ${layerLabel(k).padEnd(7)} = ${fmt(Math.max(v, I(r.design.asMinNode[k])), 0)} mm²/m`);
    }
  } else {
    const mx = I(s.mx), my = I(s.my), mxy = I(s.mxy);
    const pm = principalMoments(mx, my, mxy);
    lines.push(`w    = ${fmt(I(s.w) * 1000, 2)} mm`, `m_x  = ${fmt(mx, 1)} kNm/m`, `m_y  = ${fmt(my, 1)} kNm/m`, `m_xy = ${fmt(mxy, 1)} kNm/m`, `m_1/m_2 = ${fmt(pm.m1, 1)} / ${fmt(pm.m2, 1)}`);
    if (r.slabs.length > 1) { const sl = r.slabs[r.eSlab[loc.t]]; if (sl) lines.splice(1, 0, `${sl.name}, h = ${fmt(sl.h, 2)} m`); }
  }
  app.selection = { probe: { x, y, lines } };
  app.status(unicodeSub(`${s.name}: ${lines.join(' · ')}`), 'ok');
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
    const where = r.slabs.length > 1 ? ` · ${pc.slab}` : '';
    const detail = r.norm === 'SIA'
      ? `u = ${fmt(pc.u, 2)} m · k_e = ${fmt(pc.ke, 2)} · d = ${fmt(pc.d, 0)} mm · ψ = ${fmt(pc.res.psi * 1000, 2)} ‰ · k_r = ${fmt(pc.res.kr, 2)}`
      : `u_1 = ${fmt(pc.u, 2)} m · β = ${fmt(pc.beta, 2)} · d = ${fmt(pc.d, 0)} mm · ρ_l = ${fmt(pc.rhoL * 100, 2)} %`;
    rows.push({ label: `${pc.name} · ${t}${where}`, ref: `${r.norm === 'SIA' ? 'SIA 262, 4.3.6' : 'EN 1992-1-1, 6.4.4'} · ${pc.combo}`, Ed: pc.Vd, Rd: pc.VRd, unit: 'kN', detail, eta: pc.eta, deriv: `p-${pc.name}` });
  }
  return rows;
}

function renderResults(el, app) {
  const r = app.results;
  if (!r.sets.some((x) => x.key === app.viewOpts.res)) app.viewOpts.res = defaultSet(r).key;
  const s = currentSet(app);
  lastPanelKey = s.key;
  if (r.warnings.length) el.append(note(h('div', {}, h('b', {}, 'Hinweise'), h('ul', {}, r.warnings.map((w) => h('li', {}, w)))), 'warn'));

  // Zusammenfassung
  const etaMax = overallEta(r);
  const needP = r.punching.filter((pc) => !pc.skip && pc.eta > 1);
  const impossible = needP.filter((pc) => !pc.res.possible);
  const msgs = [];
  if (r.design?.failed) msgs.push('Biegedruckzone ungenügend – Platte verstärken.');
  if (impossible.length) msgs.push(`Durchstanzen: ${impossible.map((q) => q.name).join(', ')} auch mit Durchstanzbewehrung nicht erfüllt (V_Rd,max).`);
  else if (needP.length) msgs.push(`Durchstanzbewehrung erforderlich bei ${needP.map((q) => q.name).join(', ')}.`);
  if (r.sls && r.sls.eta > 1) msgs.push(`Durchbiegung w_{∞} = ${fmt(r.sls.wLong * 1000, 1)} mm > L/${fmt(r.sls.limit, 0)}.`);
  if (!msgs.length) msgs.push(r.punching.length || r.sls ? 'Alle Nachweise erfüllt (Durchstanzen ohne Durchstanzbewehrung).' : 'Keine Nachweise mit Ausnutzung vorhanden.');
  el.append(summaryCard(etaMax, 'Massgebende Ausnutzung', h('div', { class: 'small' }, msgs.map((m) => h('div', {}, rich(m))))));

  // Auswahl
  const pick = selectField('Ergebnisse für', app.viewOpts, 'res', setOptions(r), {
    wide: true,
    onChange: () => { lastPanelKey = app.viewOpts.res; app.renderView(); app.renderResults(); },
    info: 'Lastfall oder Kombination für Kennzahlen, Auflagerkräfte und Grafik. Bemessung und Durchstanzen verwenden immer die Umhüllende aller Tragsicherheitskombinationen.',
  });
  el.append(pick);

  const dEq = Math.abs(s.sumR - s.sumF);
  const eqOk = dEq <= 1e-6 * Math.max(1, Math.abs(s.sumF));
  el.append(stats([
    ['w_max', s.wmax * 1000, 'mm', 2],
    ['m_x min / max', `${fmt(s.mExt.mx[0], 1)} / ${fmt(s.mExt.mx[1], 1)}`, 'kNm/m'],
    ['m_y min / max', `${fmt(s.mExt.my[0], 1)} / ${fmt(s.mExt.my[1], 1)}`, 'kNm/m'],
    ['Σ Lasten = Σ Lager', eqOk ? `${fmt(s.sumF, 1)} ✓` : `${fmt(s.sumF, 1)} ≠ ${fmt(s.sumR, 1)}`, 'kN'],
  ]));

  // Durchstanzen
  if (r.punching.length) {
    const checks = punchingChecks(r);
    const content = [checksTable(checks, { edLabel: 'V_d', rdLabel: 'V_Rd,c' })];
    const notOk = r.punching.filter((pc) => !pc.skip && pc.eta > 1);
    if (notOk.length) {
      content.push(h('div', { class: 'row' }, notOk.map((pc) => (pc.res.possible
        ? badge(rich(`${pc.name}: Durchstanzbewehrung (V_Rd,max ${fmt(pc.res.VRdmax, 0)} kN)`), 'warn')
        : badge(rich(`${pc.name}: V_Rd,max überschritten`), 'fail')))));
    }
    const skipped = r.punching.filter((pc) => pc.skip);
    if (skipped.length) content.push(note(`Ohne Nachweis (keine Druckkraft): ${skipped.map((q) => q.name).join(', ')}`));
    el.append(group(`Durchstanzen (${checks.length})`, content, {
      info: I(r.norm === 'SIA'
        ? 'SIA 262:2013, 4.3.6, Näherungsstufe 2. V_d = grösste Stützenkraft aller Tragsicherheitskombinationen; d aus der Platte an der Stütze. Rand- und Eckstützen werden aus dem angeschnittenen Nachweisschnitt erkannt.'
        : 'EN 1992-1-1, 6.4.4: v_Ed = β·V_Ed/(u_1·d) ≤ v_Rd,c. ρ_l aus der Bewehrung über der Stütze.'),
    }));
  }

  // Biegebewehrung
  if (r.design) {
    const d = r.design;
    const anyBase = LAYERS.some((k) => d.asBasic[k] > 0);
    const multi = r.slabs.length > 1;
    const rowsD = LAYERS.map((k) => {
      const L = d.layers[k];
      return [
        h('div', { class: 'nowrap', title: multi ? `Maximum in «${L.slab}»` : '' }, L.label, h('div', { class: 'muted small' }, `d = ${fmt(L.d, 0)} mm`)),
        fmt(L.mMax, 1),
        h('span', {}, Number.isFinite(L.asReq) ? fmt(L.asReq, 0) : '–', L.minGoverns ? h('span', { class: 'muted small' }, ' min') : null),
        h('span', { class: 'nowrap' }, L.bars.label, h('button', { type: 'button', class: 'chk-link', title: 'Rechenweg am massgebenden Punkt', onclick: () => app.showDerivation?.(`as-${k}`) }, ' ›')),
        ...(anyBase ? [d.asBasic[k] > 0 ? `${fmt(L.extraShare * 100, 0)} %` : '–'] : []),
      ];
    });
    const content = [
      resultTable(['Lage', { label: 'm_Ed', unit: 'kNm/m', num: true }, { label: 'a_s,erf', unit: 'mm²/m', num: true }, 'Wahl', ...(anyBase ? [{ label: 'Zulage', num: true }] : [])], rowsD),
    ];
    if (multi) {
      content.push(h('div', { class: 'ed-sub' }, 'je Platte (a_s,erf in mm²/m)'));
      content.push(resultTable(['Platte', { label: 'h', unit: 'm', num: true, digits: 2 }, ...LAYERS.map((k) => ({ label: layerLabel(k).replace('unten', 'u.').replace('oben', 'o.'), num: true }))],
        d.bySlab.map((b) => [b.name, b.h, ...LAYERS.map((k) => fmt(b.max[k].req, 0))])));
    }
    el.append(group('Biegebewehrung (Umhüllende GZT)', content, { info: I('m_Ed: grösstes Wood–Armer-Moment; a_s,erf inkl. Mindestbewehrung («min» = massgebend). Lage der Maxima: Ansicht «Bewehrung». Spitzenwerte über Stützen und unter Punktlasten sind netzabhängig.') }));
  }

  // Durchbiegung
  if (r.sls) {
    const sl = r.sls;
    el.append(group('Durchbiegung', [
      checksTable([{ label: `w_{∞} = ${fmt(sl.factor, 1)} · w_el ≤ L/${fmt(sl.limit, 0)}`, ref: `${sl.combo} · L = ${fmt(sl.Lspan, 2)} m${sl.autoSpan ? ' (automatisch)' : ''} · w_el = ${fmt(sl.wEl * 1000, 2)} mm`, Ed: sl.wLong * 1000, Rd: sl.wLim * 1000, unit: 'mm', deriv: 'sls' }], { edLabel: 'w_{∞}', rdLabel: 'w_lim' }),
    ], { info: 'Vereinfacht: elastische Durchbiegung der quasi-ständigen Kombination mal Langzeitfaktor k (Kriechen, Rissbildung), verglichen mit L/Grenzwert. Einstellungen im Register «Bemessung».' }));
  }

  // Auflagerkräfte
  const rows = r.supports.map((sp, k) => {
    const f = s.supportForces[k];
    return sp.kind === 'point'
      ? [sp.name, sp.rigid ? 'Stütze' : 'Feder', f.value, '–']
      : [sp.name, sp.clamped ? 'Wand, eingesp.' : 'Wand', f.total, fmt(f.maxR, 1)];
  });
  el.append(group(`Auflagerkräfte (${r.supports.length})`, [
    h('div', { class: 'muted small' }, s.name),
    resultTable(['Lager', 'Art', { label: 'R', unit: 'kN', num: true, digits: 1 }, { label: 'r_max', unit: 'kN/m', num: true }], rows),
  ], {
    collapsed: r.supports.length > 12,
    info: 'R: Lagerkraft (positiv = Druck). Wände: Summe und grösste Linienlagerkraft. Knoten mehrerer Lager (Wandecken) werden anteilig zugeordnet; negative Werte an Wandenden sind die abhebenden Eckkräfte der Kirchhoff-Platte.',
  }));

  // Modell
  const q = r.mesh.quality;
  el.append(group('Modell', [kvTable([
    ['Knoten / Elemente', `${r.mesh.nNodes} / ${r.mesh.nTri}`],
    ['Elementtyp', 'DKT (3 Knoten, 9 FHG)'],
    ['Kleinster Elementwinkel', q.minAngle, '°', 1],
    ...r.slabs.map((sl) => [`D ${r.slabs.length > 1 ? sl.name : ''}`.trim(), sl.D / 1000, 'MNm', 2]),
    ['Rechenzeit', `${fmt(r.time.total, 0)}`, 'ms'],
  ])], { collapsed: true }));
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

/** Berichtstabellen mit Tiefstellung in Kopf und Zellen (z.B. «f_cd»). */
const RH = (hs) => hs.map((x) => (typeof x === 'string' ? { label: rich(x) } : { ...x, label: rich(x.label) }));
const RR = (rows) => rows.map((r) => r.map((v) => (typeof v === 'string' ? rich(v) : v)));
const rT = (headers, rows, opts) => repTable(RH(headers), RR(rows), opts);
const rKV = (rows) => repKV(rows.filter(Boolean).map(([l, v, u, d]) => [rich(l), typeof v === 'string' ? rich(v) : v, u, d]));

function report(app) {
  const r = app.results;
  const p = app.project;
  const st = r.steel;
  const fig = (mode, opts, caption) => repFigure(withView(app, { iso: true, vals: false, meshOv: false, labels: true, punch: true, ...opts }, () => cropFigure(stripEditor(app.snapshot(mode)), app)), caption);
  const uls = defaultSet(r, 'ULS'), sls = defaultSet(r, 'SLS');
  const ulsSets = r.sets.filter((s) => s.kind === 'combo' && s.type === 'ULS');
  const sections = [];
  const concs = [...new Map(r.slabs.map((sl) => [sl.conc.name, sl.conc])).values()];

  sections.push({ title: 'Grundlagen', content: [
    rKV([
      ['Normen', r.norm === 'SIA' ? 'SIA 260, 261, 262:2013' : 'EN 1990, 1991-1-1, 1992-1-1'],
      ['Betonstahl', `${st.name}: f_sk = ${fmt(st.fsk, 0)} MPa, f_sd = ${fmt(st.fsd, 0)} MPa`],
      ['Querdehnzahl ν', r.nu, '', 2],
    ]),
    rT(['Beton', { label: 'f_ck [MPa]', num: true, digits: 0 }, { label: 'f_cd [MPa]', num: true, digits: 1 }, { label: 'E_cm [GPa]', num: true, digits: 1 }, { label: 'τ_cd [MPa]', num: true, digits: 2 }],
      concs.map((c) => [c.name, c.fck, c.fcd, c.Ecm / 1000, c.tcd ?? ''])),
    rT(['Platte', { label: 'h [m]', num: true, digits: 3 }, 'Beton', { label: 'Fläche [m²]', num: true, digits: 2 }, { label: 'D [kNm]', num: true, digits: 0 }, { label: 'g_0 [kN/m²]', num: true, digits: 2 }],
      r.slabs.map((sl) => [sl.name, sl.h, sl.conc.name, sl.meshArea, sl.D, 25 * sl.h]), { caption: rich('Platten (D = E_cm·h^3/(12·(1 − ν^2)))') }),
    repP('Berechnungsmodell: schubstarre Kirchhoff-Platte, linear-elastisch, ungerissen, Finite-Elemente-Methode mit DKT-Elementen (Batoz/Bathe/Ho 1980). Platten mit gemeinsamen Rändern sind biegesteif verbunden; liegt eine Platte innerhalb einer anderen, gelten dort ihre Dicke und ihr Beton. Stützen mit Abmessungen werden als starre Stützenköpfe abgebildet, Wände als vertikal starre Linienlager.'),
  ] });

  // System
  const sysC = [fig('system', {}, 'Statisches System mit Lagern und Lasten')];
  for (const sl of p.slabs) sysC.push(rT(['Punkt', { label: 'x [m]', num: true, digits: 3 }, { label: 'y [m]', num: true, digits: 3 }], sl.outline.map((q, i) => [String(i + 1), q.x, q.y]), { caption: `${sl.name} (h = ${fmt(sl.h, 2)} m)` }));
  p.openings.forEach((o, i) => sysC.push(rT(['Punkt', { label: 'x [m]', num: true, digits: 3 }, { label: 'y [m]', num: true, digits: 3 }], o.pts.map((q, j) => [String(j + 1), q.x, q.y]), { caption: `Öffnung ${i + 1}${o.name && o.name !== 'Öffnung' ? ` – ${o.name}` : ''}` })));
  if (p.pointSupports.length) {
    sysC.push(rT(['Stütze', { label: 'x [m]', num: true }, { label: 'y [m]', num: true }, { label: 'b × h [m]' }, 'Lagerung'],
      p.pointSupports.map((s, i) => [`S${i + 1}`, s.x, s.y, `${fmt(s.b || 0, 2)} × ${fmt(s.hc || 0, 2)}`,
        `${s.kz > 0 ? `k_z = ${fmt(s.kz, 0)} kN/m` : 'starr'}${s.kr > 0 ? `, k_φ = ${fmt(s.kr, 0)} kNm/rad` : ''}`]), { caption: 'Punktlager' }));
  }
  if (p.lineSupports.length) {
    sysC.push(rT(['Wand', { label: 'x_1', num: true }, { label: 'y_1', num: true }, { label: 'x_2', num: true }, { label: 'y_2', num: true }, 'Lagerung'],
      p.lineSupports.map((w, i) => [`W${i + 1}`, w.x1, w.y1, w.x2, w.y2, w.clamped ? 'eingespannt' : 'gelenkig']), { caption: 'Linienlager [m]' }));
  }
  sections.push({ title: 'System', content: sysC });

  // Einwirkungen
  const lcName = (id) => p.loadCases.find((l) => l.id === id)?.name || id;
  const target = (reg) => (reg === 'all' || !reg ? (p.slabs.length > 1 ? 'alle Platten' : 'ganze Platte') : p.slabs.find((x) => x.id === reg)?.name || p.loadAreas.find((a) => a.id === reg)?.name || reg);
  const loadsC = [rT(['Lastfall', 'Art', 'Eigengewicht', 'Kategorie', { label: 'ψ_0', num: true }, { label: 'ψ_1', num: true }, { label: 'ψ_2', num: true }],
    p.loadCases.map((l) => [l.name, l.type === 'Q' ? 'veränderlich' : 'ständig', l.sw ? '25 kN/m³ · h' : '–',
      l.type === 'Q' ? (LOAD_CATEGORIES.find((k) => k.value === l.cat)?.label || '') : '–',
      l.type === 'Q' ? l.psi0 : '', l.type === 'Q' ? l.psi1 : '', l.type === 'Q' ? l.psi2 : '']), { caption: 'Lastfälle' })];
  if (p.areaLoads.length) loadsC.push(rT(['Lastfall', { label: 'q [kN/m²]', num: true }, 'wirkt auf'], p.areaLoads.map((l) => [lcName(l.lc), l.q, target(l.region)]), { caption: 'Flächenlasten' }));
  if (p.lineLoads.length) loadsC.push(rT(['Lastfall', { label: 'x_1', num: true }, { label: 'y_1', num: true }, { label: 'x_2', num: true }, { label: 'y_2', num: true }, { label: 'p_1 [kN/m]', num: true }, { label: 'p_2 [kN/m]', num: true }], p.lineLoads.map((l) => [lcName(l.lc), l.x1, l.y1, l.x2, l.y2, l.p1, l.p2 ?? l.p1]), { caption: 'Linienlasten (Koordinaten in m)' }));
  if (p.pointLoads.length) loadsC.push(rT(['Lastfall', { label: 'x [m]', num: true }, { label: 'y [m]', num: true }, { label: 'P [kN]', num: true }], p.pointLoads.map((l) => [lcName(l.lc), l.x, l.y, l.P]), { caption: 'Punktlasten' }));
  loadsC.push(rT(['Kombination', 'Art', 'Formel', { label: 'Σ Lasten [kN]', num: true, digits: 1 }], r.sets.filter((s) => s.kind === 'combo').map((s) => [s.name, comboTypeLabel(s.type), s.formula, s.sumF]), { caption: `Lastkombinationen${r.autoCombos ? ' (automatisch nach ' + (r.norm === 'SIA' ? 'SIA 260' : 'EN 1990') + ')' : ''}` }));
  sections.push({ title: 'Einwirkungen', content: loadsC });

  // Modell
  sections.push({ title: 'FE-Modell', content: [
    fig('mesh', {}, 'Finite-Elemente-Netz'),
    rKV([
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
    resC.push(fig('mx', { res: uls.key }, rich(`Biegemoment m_x [kNm/m] – ${uls.name}`)));
    resC.push(fig('my', { res: uls.key }, rich(`Biegemoment m_y [kNm/m] – ${uls.name}`)));
    resC.push(fig('react', { res: uls.key }, `Auflagerkräfte – ${uls.name}`));
    resC.push(rT(['Lager', 'Art', ...ulsSets.map((s) => ({ label: `${s.name} [kN]`, num: true, digits: 1 })), { label: `${sls?.name || 'SLS'} [kN]`, num: true, digits: 1 }],
      r.supports.map((sp, k) => [sp.name, sp.kind === 'point' ? 'Stütze' : 'Wand', ...ulsSets.map((s) => s.supportForces[k].total), sls ? sls.supportForces[k].total : '']), { caption: 'Auflagerkräfte' }));
  }
  resC.push(rT(['Lastfall / Kombination', { label: 'Σ Lasten [kN]', num: true, digits: 2 }, { label: 'Σ Auflager [kN]', num: true, digits: 2 }, { label: 'w_max [mm]', num: true, digits: 2 }, { label: 'm_x min/max [kNm/m]' }, { label: 'm_y min/max [kNm/m]' }],
    r.sets.map((s) => [s.name, s.sumF, s.sumR, s.wmax * 1000, `${fmt(s.mExt.mx[0], 1)} / ${fmt(s.mExt.mx[1], 1)}`, `${fmt(s.mExt.my[0], 1)} / ${fmt(s.mExt.my[1], 1)}`]), { caption: 'Übersicht und Gleichgewichtskontrolle' }));
  sections.push({ title: 'Schnittgrössen und Auflagerkräfte', content: resC });

  // Bemessung
  if (r.design) {
    const d = r.design;
    const dC = [repP(`Bemessungsmomente nach Wood–Armer (Umhüllende von ${ulsSets.map((s) => s.name).join(', ')}). Erforderliche Bewehrung mit rechteckigem Spannungsblock (Höhe ${fmt(d.lambda, 2)}·x, σ = f_cd); statische Höhe aus der Dicke der jeweiligen Platte.`.replace('f_cd', 'fcd')),
      repFormula('unten: mx* = mx + |mxy|, my* = my + |mxy|   oben: mx* = mx − |mxy|, my* = my − |mxy|  (mit Wood–Armer-Korrektur bei Vorzeichenwechsel)\nas = ω·b·d·fcd/fsd,  ω = 1 − √(1 − 2·mEd/(b·d²·fcd))')];
    for (const k of LAYERS) dC.push(fig('as', { layer: k }, rich(`Erforderliche Bewehrung a_s ${layerLabel(k)} [mm²/m]`)));
    dC.push(rT(['Lage', 'Platte', { label: 'd [mm]', num: true, digits: 0 }, { label: 'm_Ed,max [kNm/m]', num: true, digits: 1 }, { label: 'a_s,erf [mm²/m]', num: true, digits: 0 }, 'Vorschlag', { label: 'Grundbew. [mm²/m]', num: true, digits: 0 }],
      LAYERS.map((k) => { const L = d.layers[k]; return [L.label, L.slab, L.d, L.mMax, L.asReq, L.bars.label, d.asBasic[k] || 0]; }), { caption: 'Zusammenstellung Biegebewehrung (Maximum aller Platten)' }));
    if (r.slabs.length > 1) {
      dC.push(rT(['Platte', { label: 'h [m]', num: true, digits: 2 }, ...LAYERS.map((k) => ({ label: `${layerLabel(k)} [mm²/m]`, num: true, digits: 0 })), 'Vorschlag unten / oben'],
        d.bySlab.map((b) => [b.name, b.h, ...LAYERS.map((k) => b.max[k].req), `${b.max.bx.bars.label} / ${b.max.tx.bars.label}`]), { caption: 'Erforderliche Bewehrung je Platte (a_s,erf inkl. Mindestbewehrung)' }));
    }
    sections.push({ title: 'Bemessung Biegung', content: dC });
  }

  // Durchstanzen
  if (r.punching.length) {
    const pC = [];
    const list = r.punching.filter((pc) => !pc.skip);
    if (r.norm === 'SIA') {
      pC.push(repP('Nachweis nach SIA 262:2013, Ziffer 4.3.6, Näherungsstufe 2, ohne Durchstanzbewehrung. Vd = grösste Stützenkraft der Tragsicherheitskombinationen (ohne Abzug der Last innerhalb des Nachweisschnitts); d aus der Platte an der Stütze.'));
      pC.push(repFormula('u: Nachweisschnitt im Abstand dv/2 vom Stützenrand (ausserhalb der Platte bzw. im Schatten von Öffnungen < 5d unwirksam)\nψ = 1.5·(rs/d)·(fsd/Es)·(msd/mRd)^1.5   mit rs = 0.22·L, msd = Vd/8 (innen), Vd/4 (Rand), Vd/2 (Ecke)   (Gl. 59, 64–67)\nkr = 1/(0.45 + 0.18·ψ·d·kg) ≤ 2.0,  kg = 48/(16 + Dmax)   (Gl. 58)\nVRd,c = kr·τcd·dv·ke·u,  ke = 0.90 / 0.70 / 0.65   (Gl. 57, 4.3.6.2.5)\nVRd,max = 2·kr·τcd·dv·ke·u ≤ 3.5·τcd·dv·ke·u   (4.3.6.5.7)'));
      pC.push(rT(['Stütze', 'Typ', { label: 'd [mm]', num: true, digits: 0 }, { label: 'V_d [kN]', num: true, digits: 1 }, { label: 'u [m]', num: true, digits: 3 }, { label: 'k_e', num: true, digits: 2 }, { label: 'r_s x/y [m]' }, { label: 'm_Rd [kNm/m]', num: true, digits: 1 }, { label: 'ψ [‰]', num: true, digits: 2 }, { label: 'k_r', num: true, digits: 3 }, { label: 'V_Rd,c [kN]', num: true, digits: 1 }, { label: 'η', num: true, digits: 2 }, 'Ergebnis'],
        list.map((pc) => [pc.name, TYPE_LABEL[pc.type], pc.d, pc.Vd, pc.u, pc.ke, `${fmt(pc.rsx, 2)} / ${fmt(pc.rsy, 2)}`, Math.min(pc.mRdx, pc.mRdy), pc.res.psi * 1000, pc.res.kr, pc.VRd, pc.eta,
          pc.eta <= 1 ? 'erfüllt' : pc.res.possible ? `Durchstanzbewehrung erforderlich (V_Rd,max = ${fmt(pc.res.VRdmax, 0)} kN)` : 'nicht erfüllt (V_Rd,max)']), { caption: 'Durchstanznachweise' }));
    } else {
      pC.push(repP('Nachweis nach EN 1992-1-1, 6.4.4 ohne Durchstanzbewehrung; kritischer Rundschnitt u1 im Abstand 2d; d aus der Platte an der Stütze.'));
      pC.push(repFormula('vEd = β·VEd/(u1·d) ≤ vRd,c = CRd,c·k·(100·ρl·fck)^(1/3) ≥ vmin\nk = 1 + √(200/d) ≤ 2,  CRd,c = 0.18/γc,  vmin = 0.035·k^1.5·fck^0.5'));
      pC.push(rT(['Stütze', 'Typ', { label: 'd [mm]', num: true, digits: 0 }, { label: 'V_Ed [kN]', num: true, digits: 1 }, { label: 'u_1 [m]', num: true, digits: 3 }, { label: 'β', num: true, digits: 2 }, { label: 'ρ_l [%]', num: true, digits: 2 }, { label: 'v_Ed [MPa]', num: true, digits: 3 }, { label: 'v_Rd,c [MPa]', num: true, digits: 3 }, { label: 'η', num: true, digits: 2 }, 'Ergebnis'],
        list.map((pc) => [pc.name, TYPE_LABEL[pc.type], pc.d, pc.Vd, pc.u, pc.beta, pc.rhoL * 100, pc.res.vEd, pc.res.vRdc, pc.eta, pc.eta <= 1 ? 'erfüllt' : pc.res.possible ? 'Durchstanzbewehrung erforderlich' : 'nicht erfüllt (v_Rd,max)']), { caption: 'Durchstanznachweise' }));
    }
    sections.push({ title: 'Durchstanzen', content: pC });
  }

  if (r.sls) {
    const sl = r.sls;
    sections.push({ title: 'Gebrauchstauglichkeit', content: [
      rKV([
        ['Kombination', sl.combo],
        ['Elastische Durchbiegung w_el', sl.wEl * 1000, 'mm', 2],
        ['Langzeitfaktor k (Kriechen, Rissbildung)', sl.factor, '', 2],
        ['w_{∞} = k·w_el', sl.wLong * 1000, 'mm', 2],
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
    h('li', {}, rich('Annahmen: linear-elastisch, ungerissen; Dicke und Beton je Platte; keine günstige Wirkung ständiger Lasten (γ_G,inf) und keine feldweise Laststellung, sofern nicht von Hand definiert; Momentenspitzen unter Punktlasten und an Punktlagern netzabhängig.')),
    ...r.warnings.map((w) => h('li', {}, `Hinweis: ${w}`)))] });
  return sections;
}

// ------------------------------------------------------------------ Anwendung

const app = createApp({
  id: 'platte',
  title: 'Platte',
  subtitle: 'FE-Plattenberechnung',
  version: 2,
  instance: { label: 'Decke', plural: 'Decken' },
  defaultProject,
  examples: EXAMPLES,
  migrate: withDefaults,
  intro: INTRO,
  help: HELP,
  autoCompute: false,
  inputTabs: [
    { id: 'geo', label: 'Platten', render: geometryTab },
    { id: 'sup', label: 'Lager', render: supportTab },
    { id: 'loads', label: 'Lasten', render: loadTab },
    { id: 'design', label: 'Bemessung', render: designTab },
  ],
  viewModes: (a) => [
    { id: 'system', label: 'System', title: 'Geometrie, Lager und Lasten' },
    { id: 'mesh', label: 'Netz', title: 'Finite-Elemente-Netz (Vorschau auch ohne Berechnung)' },
    { id: 'w', label: 'w', needsResults: true, title: 'Durchbiegung' },
    { id: 'mx', label: 'm_x', needsResults: true, title: 'Biegemoment mx (Bewehrung in x-Richtung)' },
    { id: 'my', label: 'm_y', needsResults: true, title: 'Biegemoment my (Bewehrung in y-Richtung)' },
    { id: 'mxy', label: 'm_xy', needsResults: true, title: 'Drillmoment' },
    { id: 'm12', label: 'm_1/m_2', needsResults: true, title: 'Hauptmomente und -richtungen' },
    { id: 'as', label: 'Bewehrung', needsResults: true, disabled: !!a.results && !a.results.design, title: 'Erforderliche Biegebewehrung (Umhüllende GZT)' },
    { id: 'react', label: 'Reaktionen', needsResults: true, title: 'Auflagerkräfte, Linienlagerverläufe und Durchstanzen' },
  ],
  viewOptions: (a) => {
    const m = a.viewMode, r = a.results;
    const out = [];
    if (m === 'system') {
      out.push({ key: 'labels', label: 'Beschriftung', type: 'check', default: true });
      const lcs = a.project.loadCases || [];
      if (lcs.length) {
        const def = activeLoadCase(a.project, null);
        if (!lcs.some((l) => l.id === a.viewOpts.lc)) a.viewOpts.lc = def;
        out.push({ key: 'lc', label: 'Neue Lasten in', type: 'select', default: def, options: lcs.map((l) => ({ value: l.id, label: l.name || l.id })) });
      }
    }
    if (r && RESULT_MODES.has(m)) {
      const opts = setOptions(r);
      const def = (m === 'w' ? defaultSet(r, 'SLS') : defaultSet(r)).key;
      if (!opts.some((o) => o.value === a.viewOpts.res)) a.viewOpts.res = def;
      out.push({ key: 'res', label: 'Lastfall', type: 'select', options: opts, default: def });
    }
    if (r && m === 'm12') out.push({ key: 'pm', label: 'Anzeige', type: 'select', default: 'm1', options: [{ value: 'm1', label: 'm_1 (Maximum)' }, { value: 'm2', label: 'm_2 (Minimum)' }, { value: 'dir', label: 'Richtungen' }] });
    if (r && m === 'as') out.push({ key: 'layer', label: 'Lage', type: 'select', default: 'bx', options: LAYERS.map((k) => ({ value: k, label: layerLabel(k) })) });
    if (r && CONTOUR_MODES.has(m)) {
      out.push({ key: 'iso', label: 'Isolinien', type: 'check', default: true });
      out.push({ key: 'vals', label: 'Werte', type: 'check', default: false });
      out.push({ key: 'meshOv', label: 'Netz', type: 'check', default: false });
    }
    if (r && m === 'react' && r.punching.length) out.push({ key: 'punch', label: 'Durchstanzen', type: 'check', default: true });
    return out;
  },
  editor: editorSpec,
  derivation,
  renderView,
  onViewClick,
  compute,
  renderResults,
  report,
});

// Kleine Projekte (Beispiele) nach dem Laden bzw. beim Wechsel der Decke sofort berechnen
const autoCompute = () => setTimeout(() => {
  if (!app.results && !app.error && isComplete(app.project) && estimateNodes(app.project) <= AUTO_COMPUTE_NODES) app.compute();
}, 0);
for (const fn of ['setProject', 'setDocument', 'addInstance', 'duplicateInstance', 'switchInstance', 'removeInstance']) {
  const base = app[fn];
  if (typeof base !== 'function') continue;
  app[fn] = (...args) => { const out = base(...args); autoCompute(); return out; };
}
{
  // Start: kleine Projekte gleich berechnen und eine per URL verlangte Ergebnisansicht (?ansicht=mx) danach öffnen
  const startView = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('ansicht') || new URLSearchParams(location.search).get('view') : null;
  setTimeout(() => {
    if (!app.results && isComplete(app.project) && estimateNodes(app.project) <= AUTO_COMPUTE_NODES) app.compute();
    if (startView && app.results && app.viewMode !== startView) app.setViewMode(startView);
  }, 0);
}
