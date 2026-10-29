// Querschnitt – Querschnittsanalyse Stahlbeton (Oberfläche)
//
// Linke Spalte nach den Gestaltungsregeln (docs/ARCHITEKTUR.md): Register → Karten (eine Ebene), Sammlungen als
// Liste (Aussparungen, Lastfälle), selten Gebrauchtes in eingeklappten Karten, Formelzeichen mit Unterstrich.
import { createApp, IncompleteInput } from '../../js/core/app.js';
import { h, rich, group, numField, selectField, checkField, textField, dataTable, segmented, button, note, emptyState, toast, selectInput, listEditor } from '../../js/core/ui.js';
import { CONCRETE_CLASSES, REBAR_GRADES, NORMS } from '../../js/core/materials.js';
import { fmt } from '../../js/core/format.js';
import {
  SHAPE_TYPES, SHAPE_PARAMS, defaultShapes, templatePolygons, projectGeometry, bounds, rowsToPts, ptsToRows, pointInPolygon,
  barsLayers, barsRow, barsCircle, barsPerimeter, barsCircular, circlePts, barAreaMm2, polygonProps,
} from './shapes.js';
import { analyze, createCache, materialSet, grossProps, missingInput, SLS_REQUIREMENTS, REF_POINTS } from './calc.js';
import { renderView, caseIndex, STATE_OPTIONS, signFigure, shapeIcon } from './view.js';
import { renderResults, buildReport } from './results.js';
import { baseProject, defaultProject, EXAMPLES } from './examples.js';
import { createEditorSpec, setShape, centerSection } from './editing.js';
import { derivation } from './derivation.js';
import { INTRO, HELP, subs } from './help.js';

/** Gemeinsamer Zustand der Oberfläche (nicht Teil des Projekts). */
const ctx = {
  cache: createCache(),
  ui: { resTab: 'nachweise', nmAxis: 'My', mkDir: 'auto', barGen: 'vorlage', barD: 16, ductD: 100, lcOpen: null, openOpen: null },
  gen: null,       // Parameter der Bewehrungsgeneratoren (auch Überdeckung für die Fangpunkte der Grafik)
  lastGroup: null, // zuletzt gezeichnete Stabreihe bzw. -kreis (Anzahl im Eigenschaftsfenster änderbar)
  tables: {},
  instId: null,    // aktive Position (Querschnitt); bei Wechsel werden die Oberflächenzustände zurückgesetzt
};

/** Wechsel der Position (Querschnitt) erkennen und positionsbezogene Zustände zurücksetzen. */
function syncInstance(app) {
  const id = app.instance?.id ?? null;
  if (id === ctx.instId) return;
  ctx.instId = id;
  ctx.gen = null;
  ctx.lastGroup = null;
  ctx.ui.lcOpen = null;
  ctx.ui.openOpen = null;
}

const upd = (app) => () => app.changed();
const updInputs = (app) => () => app.changed({ inputs: true });
/** Info-Tooltip mit Formelzeichen. */
const tip = (html) => subs(html);
/** Kurzinfo-Zeile (gedämpft) mit Formelzeichen. */
const hint = (text) => h('div', { class: 'muted small' }, rich(text));
/** Anzahl im Kartentitel nachführen, ohne den Eingabebereich neu aufzubauen. */
const setCount = (card, n) => { const el = card?.querySelector(':scope > .group-title .group-count'); if (el) el.textContent = String(n); };

// ------------------------------------------------------------------ Hilfetexte

const PARAM_INFO = {
  rect: { b: 'Breite in y-Richtung.', h: 'Höhe in z-Richtung.' },
  T: { b: 'Mitwirkende Plattenbreite b_eff (SIA 262 4.1.3.3.2, EN 1992-1-1 5.3.2.1).', hf: 'Dicke der Platte (Druckgurt bei positivem Moment).', bw: 'Breite des Stegs.', h: 'Gesamthöhe inklusive Platte.' },
  I: { bo: 'Breite des oberen Gurts.', to: 'Dicke des oberen Gurts.', bu: 'Breite des unteren Gurts.', tu: 'Dicke des unteren Gurts.', bw: 'Stegbreite.', h: 'Gesamthöhe.' },
  box: { bo: 'Breite der oberen Platte inkl. Kragplatten; gleich b_u → rechteckiger Kasten.', bu: 'Aussenbreite des Kastens (Stegaussenseiten).', h: 'Gesamthöhe.', to: 'Dicke der oberen Platte.', tu: 'Dicke der unteren Platte.', tw: 'Dicke eines Stegs.' },
  circle: { D: 'Als flächengleiches 72-Eck modelliert, Mittelpunkt im Ursprung.' },
  ring: { D: 'Aussendurchmesser, Mittelpunkt im Ursprung.', t: 'Radiale Wandstärke.' },
  L: { b: 'Länge des unteren Schenkels (y-Richtung).', h: 'Länge des linken Schenkels (z-Richtung).', tb: 'Dicke des unteren Schenkels.', th: 'Dicke des linken Schenkels.' },
};

const SIGN_INFO = 'N > 0 Zug, N < 0 Druck · M_y > 0 erzeugt <b>Zug unten</b> (Feldmoment) · M_z > 0 erzeugt <b>Zug rechts</b>. Die Schnittgrössen wirken im Bezugspunkt (Standard: Schwerpunkt des Betons).';

// ------------------------------------------------------------------ Register 1: Querschnitt

/** Formauswahl als Kacheln mit gut sichtbarer Vorschau. */
function shapePicker(app) {
  const p = app.project;
  const defs = defaultShapes();
  const wrap = h('div', { role: 'radiogroup', 'aria-label': 'Querschnittsform', style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px' } });
  for (const s of SHAPE_TYPES) {
    let ic;
    try {
      if (s.id === 'poly') {
        const pts = rowsToPts(p.shape.poly);
        ic = pts.length >= 3 ? shapeIcon(pts, [], 54, 34) : shapeIcon([[0, 0], [10, 0], [12, 6], [6, 11], [0, 7]], [], 54, 34);
      } else {
        const t = templatePolygons(s.id, defs[s.id]);
        ic = shapeIcon(t.outer, t.holes, 54, 34);
      }
    } catch { ic = shapeIcon([[0, 0], [1, 0], [1, 1], [0, 1]], [], 54, 34); }
    // Grösse und Kontur des Symbols (Standard-Knopfstil verkleinert SVGs auf 15 px)
    ic.style.width = '54px'; ic.style.height = '34px';
    const path = ic.querySelector('path');
    if (path) { path.style.strokeWidth = '1.6'; path.style.fill = 'var(--c-concrete)'; path.style.stroke = 'var(--c-concrete-line)'; }
    const active = p.shape.type === s.id;
    wrap.append(h('button', {
      type: 'button', class: 'btn', role: 'radio', 'aria-checked': active ? 'true' : 'false',
      title: s.id === 'poly' ? 'Polygon frei: Eckpunkte und Aussparungen beliebig (die aktuelle Form wird übernommen)' : s.label,
      style: {
        flexDirection: 'column', height: 'auto', padding: '6px 2px', gap: '3px', minWidth: 0, fontSize: '11.5px',
        border: active ? '1.5px solid var(--accent)' : '1px solid var(--border-strong)',
        background: active ? 'var(--accent-soft)' : 'var(--surface)',
        color: 'var(--text)', fontWeight: active ? 600 : 500,
      },
      onclick: () => setShape(app, s.id),
    }, ic, h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' } }, s.label)));
  }
  return wrap;
}

function polyTable(app, onEdit) {
  const p = app.project;
  if (!Array.isArray(p.shape.poly)) p.shape.poly = [];
  const rows = p.shape.poly;
  const tbl = dataTable([
    { key: 'y', label: 'y', unit: 'mm' },
    { key: 'z', label: 'z', unit: 'mm' },
  ], rows, {
    onChange: () => { app.changed(); onEdit?.(); },
    newRow: (r) => {
      const a = r[r.length - 1] || { y: 0, z: 0 }, b = r[0] || { y: 0, z: 0 };
      return { y: Math.round((a.y + b.y) / 2), z: Math.round((a.z + b.z) / 2) };
    },
    minRows: 3, canMove: true, maxHeight: '240px',
    onSelect: (i) => app.editor?.select([`v:${i}`]),
    hint: 'Excel: y, z',
    extraButtons: rows.length >= 3 ? [button('Schwerpunkt → 0/0', { small: true, title: 'Polygon, Aussparungen und Bewehrung so verschieben, dass der Schwerpunkt im Ursprung liegt', onClick: () => centerSection(app) })] : [],
  });
  ctx.tables.poly = tbl;
  return tbl;
}

function formCard(app) {
  const p = app.project;
  const t = p.shape.type;
  const info = h('div', { class: 'muted small' });
  /** Fläche und Schwerpunkt bzw. verständliche Fehlermeldung, ohne den Eingabebereich neu aufzubauen. */
  const refresh = () => {
    const g = projectGeometry(p);
    if (t === 'poly' && (p.shape.poly || []).length < 3) { info.replaceChildren(); return; }
    if (g.errors.length) { info.replaceChildren(note(g.errors[0], 'fail')); return; }
    try {
      const gp = grossProps(g.outer, g.holes);
      info.replaceChildren(rich(`A_c = ${fmt(gp.A, 0)} mm² · Schwerpunkt y_S = ${fmt(gp.cy, 1)}, z_S = ${fmt(gp.cz, 1)} mm`));
    } catch (e) { info.replaceChildren(note(e.message, 'fail')); }
  };
  const kids = [shapePicker(app)];
  if (t === 'poly') {
    if ((p.shape.poly || []).length < 3) kids.push(emptyState('Noch kein Betonumriss', 'In der Grafik «Rechteck» (Q) oder «Polygon» (U) zeichnen, oben eine Vorlage wählen oder Eckpunkte erfassen.'));
    kids.push(polyTable(app, refresh));
  } else {
    p.shape[t] ||= defaultShapes()[t];
    kids.push(h('div', { class: 'grid2' }, SHAPE_PARAMS[t].map(([k, label]) => numField(label, p.shape[t], k, { unit: 'mm', min: 1, onChange: () => { app.changed(); refresh(); }, info: tip(PARAM_INFO[t]?.[k] || '') }))));
  }
  kids.push(info);
  refresh();
  const where = t === 'poly' ? 'Eckpunkte der Reihe nach entlang des Randes (im oder gegen den Uhrzeigersinn), Koordinaten in mm.'
    : t === 'circle' || t === 'ring' ? 'Mittelpunkt im Ursprung (0/0).' : t === 'L' ? 'Äussere Ecke im Ursprung (0/0).' : 'Unterkante auf z = 0, symmetrisch zur z-Achse.';
  return group('Form', kids, { info: tip(`Vorlage wählen und Masse eingeben. «Polygon frei» übernimmt die aktuelle Form als Eckpunkte. ${where}`) });
}

// ---- Aussparungen

/** Freie Stelle im Beton für eine neue Aussparung der Grösse s [mm] (nicht in bestehenden Hohlräumen). */
function freeSpot(p, s) {
  const g = projectGeometry(p);
  if (!g.outer.length) return [0, 0];
  const bb = bounds(g.outer);
  let c = [(bb.ymin + bb.ymax) / 2, (bb.zmin + bb.zmax) / 2];
  try { const gp = grossProps(g.outer, g.holes); c = [gp.cy, gp.cz]; } catch { /* Mitte des Rechtecks */ }
  const fits = ([y, z]) => [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].every(([a, b]) => {
    const q = [y + a * s / 2, z + b * s / 2];
    return pointInPolygon(q, g.outer) && !g.holes.some((hh) => pointInPolygon(q, hh));
  });
  const cand = [c];
  for (let k = 1; k <= 9; k++) cand.push([c[0], bb.zmin + bb.h * k / 10], [bb.ymin + bb.b * k / 10, c[1]]);
  return cand.find(fits) || c;
}

const r1 = (v) => Math.round(v * 10) / 10;
const ductPts = (c) => ptsToRows(circlePts(c.y, c.z, c.D / 2, 32, true), 1);

function newRectOpening(p) {
  const g = projectGeometry(p);
  const bb = g.outer.length ? bounds(g.outer) : { b: 500, h: 500 };
  const s = Math.max(20, Math.round(Math.min(bb.b, bb.h) * 0.2 / 10) * 10);
  const [y, z] = freeSpot(p, s);
  const pts = [[y - s / 2, z - s / 2], [y + s / 2, z - s / 2], [y + s / 2, z + s / 2], [y - s / 2, z + s / 2]].map(([a, b]) => [r1(a), r1(b)]);
  return { name: `Öffnung ${(p.openings || []).length + 1}`, pts: ptsToRows(pts, 1) };
}

function newDuct(p) {
  const D = ctx.ui.ductD || 100;
  const [y, z] = freeSpot(p, D);
  const circle = { y: r1(y), z: r1(z), D };
  return { name: `Hüllrohr Ø${D}`, pts: ductPts(circle), circle };
}

function openingSub(o) {
  if (o.circle) return `Hüllrohr Ø${fmt(o.circle.D, 0)} · Mitte ${fmt(o.circle.y, 0)} / ${fmt(o.circle.z, 0)} mm`;
  const A = Math.abs(polygonProps(rowsToPts(o.pts)).A || 0);
  return `${(o.pts || []).length} Eckpunkte · ${fmt(A, 0)} mm²`;
}

/** Name und Kurzinfo der geöffneten Listenzeile nachführen (ohne Neuaufbau, damit der Fokus bleibt). */
function refreshRow(detail, name, sub, swatch) {
  const row = detail.previousElementSibling;
  if (!row) return;
  if (name !== undefined) row.querySelector('.lst-name')?.replaceChildren(rich(name) ?? '');
  if (sub !== undefined) row.querySelector('.lst-sub')?.replaceChildren(rich(sub) ?? '');
  if (swatch) { const sw = row.querySelector('.lst-swatch'); if (sw) sw.style.background = swatch; }
}

function openingDetail(d, o, app) {
  const sync = () => refreshRow(d, o.name, openingSub(o));
  d.append(textField('Bezeichnung', o, 'name', { onChange: () => { sync(); app.changed(); } }));
  if (o.circle) {
    const set = () => {
      if (!(o.circle.D > 0)) return;
      o.pts = ductPts(o.circle);
      if (/^Hüllrohr Ø/.test(o.name || '')) o.name = `Hüllrohr Ø${fmt(o.circle.D, 0)}`;
      ctx.ui.ductD = o.circle.D;
      sync();
      app.changed();
    };
    d.append(h('div', { class: 'grid3' },
      numField('Ø', o.circle, 'D', { unit: 'mm', min: 1, onChange: set, info: 'Als flächengleiches 32-Eck modelliert.' }),
      numField('Mitte y', o.circle, 'y', { unit: 'mm', onChange: set }),
      numField('Mitte z', o.circle, 'z', { unit: 'mm', onChange: set })));
  } else {
    d.append(dataTable([{ key: 'y', label: 'y', unit: 'mm' }, { key: 'z', label: 'z', unit: 'mm' }], o.pts, {
      onChange: () => { sync(); app.changed(); }, minRows: 3, canMove: true, maxHeight: '200px', hint: 'Excel: y, z',
      newRow: (r) => { const a = r[r.length - 1] || { y: 0, z: 0 }, b = r[0] || { y: 0, z: 0 }; return { y: Math.round((a.y + b.y) / 2), z: Math.round((a.z + b.z) / 2) }; },
    }));
  }
}

function openingsCard(app) {
  const p = app.project;
  p.openings ||= [];
  const list = listEditor(p.openings, {
    active: ctx.ui.openOpen, onActive: (i) => { ctx.ui.openOpen = i; },
    label: (o, j) => o.name || `Aussparung ${j + 1}`,
    sub: (o) => openingSub(o),
    swatch: (o) => (o.circle ? 'var(--c-steel)' : 'var(--c-concrete-line)'),
    duplicate: (o) => {
      const bb = bounds(rowsToPts(o.pts));
      const dy = r1(bb.b + 30);
      const c = { ...JSON.parse(JSON.stringify(o)), name: `${o.name || 'Aussparung'} (Kopie)` };
      delete c.fromTemplate;
      c.pts = c.pts.map((q) => ({ y: r1(q.y + dy), z: q.z }));
      if (c.circle) c.circle.y = r1(c.circle.y + dy);
      return c;
    },
    onChange: ({ type, index }) => { ctx.ui.openOpen = type === 'remove' ? null : index; app.changed({ inputs: true }); },
    detail: (d, o) => openingDetail(d, o, app),
    add: [
      { label: 'Rechteck', icon: 'plus', create: () => newRectOpening(p) },
      { label: 'Hüllrohr', icon: 'plus', create: () => newDuct(p) },
    ],
    empty: 'Keine Aussparungen – oder in der Grafik «Öffnung» (O) bzw. «Hüllrohr» (H) zeichnen.',
  });
  return group(`Aussparungen (${p.openings.length})`, [list], {
    id: 'Aussparungen', collapsed: !p.openings.length,
    info: 'Hohlräume (Hüllrohre, Durchbrüche) werden von der Betonfläche abgezogen. Bei «Polygon frei» erscheinen hier auch die Hohlräume umgewandelter Vorlagen.',
  });
}

function concreteCard(app) {
  const m = app.project.material;
  const c = materialSet(app.project).c;
  return group('Beton', [
    h('div', { class: 'grid2' },
      selectField('Norm', m, 'norm', NORMS.map((n) => ({ value: n.value, label: n.value === 'SIA' ? 'SIA 262' : 'EN 1992-1-1' })), { onChange: updInputs(app), info: 'SIA 262 (Schweiz) oder Eurocode EN 1992-1-1. Bestimmt ε_cu, E_cm, E_s und die Nachweisformeln.' }),
      selectField('Betonsorte', m, 'concrete', CONCRETE_CLASSES, { onChange: updInputs(app) })),
    h('div', { class: 'grid2' },
      numField('γ_c', m, 'gammaC', { min: 1, max: 3, onChange: updInputs(app), info: tip('Teilsicherheitsbeiwert Beton, üblich 1.5 (SIA 262 2.3.2.5, EN 1992-1-1 2.4.2.4).') }),
      m.norm === 'EC' ? numField('α_cc', m, 'alphaCC', { min: 0.5, max: 1, onChange: updInputs(app), info: tip('Dauerstandsbeiwert α_cc nach EN 1992-1-1 3.1.6 (empfohlen 1.0, je nach Nationalem Anhang 0.85).') }) : null),
    hint(`f_cd = ${fmt(c.fcd, 1)} MPa · f_ctm = ${fmt(c.fctm, 2)} MPa · E_cm = ${fmt(c.Ecm / 1000, 1)} GPa · ε_cu = ${fmt(c.ecu * 1000, 1)} ‰`),
  ], { info: tip('Parabel-Rechteck-Diagramm mit f_cd, ohne Zugfestigkeit.') });
}

function renderSection(el, app) {
  syncInstance(app);
  el.append(formCard(app));
  el.append(openingsCard(app));
  el.append(concreteCard(app));
}

// ------------------------------------------------------------------ Register 2: Bewehrung

/** Generatorparameter; die geometrieabhängigen Vorschläge folgen der aktuellen Querschnittsform. */
function initGen(app) {
  const g = projectGeometry(app.project);
  const bb = g.outer.length ? bounds(g.outer) : { ymin: -150, ymax: 150, zmin: 0, zmax: 500 };
  const key = [bb.ymin, bb.ymax, bb.zmin, bb.zmax].map((x) => Math.round(x)).join('|');
  ctx.gen = { nBot: 3, dBot: 16, nTop: 2, dTop: 12, c: 30, dw: 8, n: 8, d: 16, nInner: 0, dInner: 12, nRow: 3, dRow: 16, nCirc: 8, dCirc: 16, phi0: 90, dPer: 14, sPer: 200, ...(ctx.gen || {}) };
  if (ctx.gen.key === key) return;
  const a = 50;
  Object.assign(ctx.gen, {
    key,
    y1: Math.round(bb.ymin + a), z1: Math.round(bb.zmin + a), y2: Math.round(bb.ymax - a), z2: Math.round(bb.zmin + a),
    yc: Math.round((bb.ymin + bb.ymax) / 2), zc: Math.round((bb.zmin + bb.zmax) / 2), r: Math.round(Math.max(20, Math.min(bb.ymax - bb.ymin, bb.zmax - bb.zmin) / 2 - a)),
  });
}

function applyBars(app, bars, replace) {
  if (!bars.length) { toast('Mit diesen Angaben entstehen keine Stäbe – bitte Anzahl, Durchmesser und Überdeckung prüfen.', 'warn'); return; }
  const p = app.project;
  p.bars = replace ? bars : [...(p.bars || []), ...bars];
  app.selection = null;
  app.changed({ inputs: true });
  toast(`${bars.length} Stäbe ${replace ? 'erzeugt (bisherige Bewehrung ersetzt)' : 'hinzugefügt'}.`, 'ok');
}

function barsCard(app) {
  const p = app.project;
  p.bars ||= [];
  const g = projectGeometry(p);
  let Ac = NaN;
  try { if (!g.errors.length && g.outer.length) Ac = grossProps(g.outer, g.holes).A; } catch { /* */ }
  const summary = h('div', { class: 'muted small' });
  let card = null;
  const refresh = () => {
    const As = p.bars.reduce((sum, b) => sum + (b.d > 0 ? barAreaMm2(b.d) : 0), 0);
    summary.replaceChildren(rich(`A_s = ${fmt(As, 0)} mm²${Number.isFinite(Ac) ? ` · ρ = A_s/A_c = ${fmt(As / Ac * 100, 2)} %` : ''}`));
    setCount(card, p.bars.length);
  };
  const empty = p.bars.length ? null : emptyState('Noch keine Bewehrung', 'In der Grafik «Stab» (B), «Stabreihe» (L) oder «Stabkreis» (K) – oder unten «Lagen erzeugen».');
  const tbl = dataTable([
    { key: 'y', label: 'y', unit: 'mm' },
    { key: 'z', label: 'z', unit: 'mm' },
    { key: 'd', label: 'Ø', unit: 'mm', min: 1, max: 80, info: 'Stabdurchmesser; Bündel als flächengleichen Einzelstab erfassen.' },
    { type: 'calc', label: 'A_s', unit: 'mm²', calc: (r) => (r.d > 0 ? fmt(barAreaMm2(r.d), 0) : '–') },
  ], p.bars, {
    onChange: () => { refresh(); if (p.bars.length) empty?.remove(); app.changed(); },
    newRow: (rows) => { const l = rows[rows.length - 1]; return l ? { y: l.y + 50, z: l.z, d: l.d } : { y: 0, z: 50, d: 16 }; },
    maxHeight: '280px',
    onSelect: (i) => app.editor?.select([`b:${i}`]),
    hint: 'Excel: y, z, Ø',
    extraButtons: p.bars.length ? [button('Alle löschen', { icon: 'trash', small: true, onClick: () => { p.bars.length = 0; app.selection = null; app.changed({ inputs: true }); } })] : [],
  });
  ctx.tables.bars = tbl;
  card = group(`Stäbe (${p.bars.length})`, [empty, tbl, summary], { id: 'Stäbe', info: 'Jeder Stab ist eine Punktfaser mit A_s = π·Ø²/4. Ein Klick auf einen Stab in der Grafik wählt die Zeile.' });
  refresh();
  return card;
}

function generatorCard(app) {
  const p = app.project;
  initGen(app);
  const G = ctx.gen;
  const circular = p.shape.type === 'circle' || p.shape.type === 'ring';
  const modes = [
    { id: 'vorlage', label: circular ? 'Umfang' : 'Lagen', title: circular ? 'Stäbe gleichmässig am Umfang' : 'Lagen unten und oben mit Überdeckung' },
    { id: 'reihe', label: 'Reihe', title: 'n Stäbe zwischen zwei Punkten' },
    { id: 'kreis', label: 'Kreis', title: 'n Stäbe auf einem Kreis' },
    ...(circular ? [] : [{ id: 'umlaufend', label: 'Umlaufend', title: 'Randbewehrung entlang aller Ränder' }]),
  ];
  if (!modes.some((m) => m.id === ctx.ui.barGen)) ctx.ui.barGen = 'vorlage';
  const body = h('div');
  const n = (label, key, info) => numField(label, G, key, { unit: 'Stk.', min: 0, max: 400, info: info ? tip(info) : undefined });
  const d = (label, key) => numField(label, G, key, { unit: 'mm', min: 4, max: 60 });
  const cover = () => h('div', { class: 'grid2' },
    numField('Überdeckung c', G, 'c', { unit: 'mm', min: 0, info: 'Nennmass bis zur Bügelaussenseite.' }),
    numField('Bügel Ø_w', G, 'dw', { unit: 'mm', min: 0, info: tip('Achsabstand der Längsstäbe vom Rand: a = c + Ø_w + Ø/2.') }));
  const build = () => {
    const geom = projectGeometry(p);
    if (geom.errors.length) { toast(geom.errors[0], 'warn'); return []; }
    switch (ctx.ui.barGen) {
      case 'vorlage':
        return circular
          ? barsCircular(p.shape, { n: G.n, d: G.d, nInner: G.nInner, dInner: G.dInner, c: G.c, dw: G.dw })
          : barsLayers(geom, { nBot: G.nBot, dBot: G.dBot, nTop: G.nTop, dTop: G.dTop, c: G.c, dw: G.dw });
      case 'reihe': return G.nRow >= 1 && G.dRow > 0 ? barsRow(G.y1, G.z1, G.y2, G.z2, G.nRow, G.dRow) : [];
      case 'kreis': return G.nCirc >= 1 && G.dCirc > 0 && G.r > 0 ? barsCircle(G.yc, G.zc, G.r, G.nCirc, G.dCirc, G.phi0) : [];
      case 'umlaufend': return G.dPer > 0 ? barsPerimeter(geom, { d: G.dPer, s: G.sPer, c: G.c, dw: G.dw }) : [];
      default: return [];
    }
  };
  const fill = () => {
    let f;
    switch (ctx.ui.barGen) {
      case 'vorlage':
        f = circular
          ? [h('div', { class: 'grid2' }, n('Anzahl', 'n', 'Gleichmässig am Umfang, erster Stab oben.'), d('Ø', 'd')),
            p.shape.type === 'ring' ? h('div', { class: 'grid2' }, n('Anzahl innen', 'nInner', '0 = keine innere Lage.'), d('Ø innen', 'dInner')) : null, cover()]
          : [h('div', { class: 'grid2' }, n('Anzahl unten', 'nBot', 'Untere Lage; 0 = keine. Verteilt in der breitesten Materialzone auf Höhe a.'), d('Ø unten', 'dBot')),
            h('div', { class: 'grid2' }, n('Anzahl oben', 'nTop', 'Obere Lage; 0 = keine.'), d('Ø oben', 'dTop')), cover()];
        break;
      case 'reihe':
        f = [h('div', { class: 'grid2' }, numField('Start y', G, 'y1', { unit: 'mm' }), numField('Start z', G, 'z1', { unit: 'mm' })),
          h('div', { class: 'grid2' }, numField('Ende y', G, 'y2', { unit: 'mm' }), numField('Ende z', G, 'z2', { unit: 'mm' })),
          h('div', { class: 'grid2' }, n('Anzahl', 'nRow', 'Inklusive der beiden Endstäbe.'), d('Ø', 'dRow'))];
        break;
      case 'kreis':
        f = [h('div', { class: 'grid2' }, numField('Mitte y', G, 'yc', { unit: 'mm' }), numField('Mitte z', G, 'zc', { unit: 'mm' })),
          h('div', { class: 'grid2' }, numField('Radius r', G, 'r', { unit: 'mm', min: 1, info: 'Radius der Stabachsen.' }), numField('Startwinkel φ_0', G, 'phi0', { unit: '°', info: '0° = rechts (+y), 90° = oben (+z), im Gegenuhrzeigersinn.' })),
          h('div', { class: 'grid2' }, n('Anzahl', 'nCirc'), d('Ø', 'dCirc'))];
        break;
      default:
        f = [h('div', { class: 'grid2' }, d('Ø', 'dPer'), numField('Abstand s_max', G, 'sPer', { unit: 'mm', min: 20, info: tip('Stäbe in allen Ecken, dazwischen gleichmässig mit Abstand ≤ s_max – entlang des Aussenrands und aller Aussparungen.') })), cover()];
    }
    body.replaceChildren(...f.filter(Boolean));
  };
  fill();
  return group('Lagen erzeugen', [
    segmented(modes, ctx.ui.barGen, (id) => { ctx.ui.barGen = id; fill(); }),
    body,
    h('div', { class: 'ed-actions' },
      button('Hinzufügen', { icon: 'plus', small: true, title: 'Erzeugte Stäbe zur bestehenden Bewehrung hinzufügen', onClick: () => applyBars(app, build(), false) }),
      button('Ersetzen', { icon: 'check', small: true, primary: true, title: 'Bestehende Bewehrung durch die erzeugten Stäbe ersetzen', onClick: () => applyBars(app, build(), true) })),
  ], { collapsed: (p.bars || []).length > 0, info: '«Ersetzen» löscht die bisherige Bewehrung, «Hinzufügen» ergänzt sie (z.B. zweite Lage als Reihe).' });
}

function steelCard(app) {
  const m = app.project.material;
  const s = materialSet(app.project).s;
  return group('Betonstahl', [
    h('div', { class: 'grid2' },
      selectField('Stahlsorte', m, 'steel', REBAR_GRADES, { onChange: updInputs(app), info: tip('Duktilitätsklasse A/B/C bestimmt ε_ud und das Verfestigungsverhältnis k_s.') }),
      numField('γ_s', m, 'gammaS', { min: 1, max: 2, onChange: updInputs(app), info: tip('Teilsicherheitsbeiwert Betonstahl, üblich 1.15.') })),
    checkField('Verfestigung bis k_s·f_sd', m, 'hardening', { onChange: updInputs(app), info: tip('Ohne Häkchen: horizontales Fliessplateau bei f_sd (übliche, konservative Annahme).') }),
    hint(`f_sd = ${fmt(s.fsd, 1)} MPa · E_s = ${fmt(s.Es / 1000, 0)} GPa · ε_ud = ${fmt(s.eud * 1000, 1)} ‰`),
  ], { collapsed: true });
}

function shearCard(app) {
  const p = app.project;
  const sh = p.shear;
  const sia = materialSet(p).norm === 'SIA';
  const R = app.results;
  const kids = [checkField('Querkraft nachweisen', sh, 'active', { onChange: updInputs(app), info: tip('Für alle GZT-Lastfälle; die Querkraft V_d wird je Lastfall eingegeben.') })];
  if (sh.active) {
    kids.push(
      h('div', { class: 'grid2' },
        numField('Bügel Ø_w', sh, 'dw', { unit: 'mm', min: 0, onChange: updInputs(app), info: '0 → Nachweis ohne Querkraftbewehrung.' }),
        numField('Abstand s', sh, 's', { unit: 'mm', min: 0, onChange: updInputs(app) })),
      h('div', { class: 'grid2' },
        numField('Schnittigkeit', sh, 'legs', { unit: 'Stk.', min: 0, max: 12, onChange: updInputs(app), info: 'Bügelschenkel pro Schnitt (geschlossener Bügel = 2).' }),
        numField(sia ? 'Neigung α' : 'Neigung θ', sh, 'angle', { unit: '°', min: 10, max: 60, onChange: upd(app), info: sia ? 'Neigung des Druckfelds; SIA 262 4.3.3.3.2: üblich 25° ≤ α ≤ 45°.' : 'EN 1992-1-1 6.2.3(2): 1 ≤ cot θ ≤ 2.5, d.h. 21.8° ≤ θ ≤ 45°.' })),
      selectField('Biegezugseite', sh, 'side', [{ value: 'unten', label: 'unten' }, { value: 'oben', label: 'oben' }], { onChange: updInputs(app), info: tip('Massgebend für d (Druckrand bis Zugbewehrung) und A_sl.') }),
    );
    const allAuto = sh.bwAuto !== false && sh.dAuto !== false && sh.zAuto !== false;
    const tmp = { auto: allAuto };
    kids.push(checkField('b_w, d, z automatisch', tmp, 'auto', {
      info: tip('b_w: kleinste Materialbreite zwischen 10 % und 90 % der Höhe (Hohlkasten: beide Stege); d: Druckrand bis Schwerpunkt der Zugbewehrung; z = 0.9·d.'),
      onChange: (v) => {
        const g = R?.shearGeo;
        if (!v && g) { sh.bw = Math.round(g.bw); sh.d = Math.round(g.d); sh.z = Math.round(g.z); }
        sh.bwAuto = sh.dAuto = sh.zAuto = v;
        app.changed({ inputs: true });
      },
    }));
    if (allAuto) {
      const g = R?.shearGeo;
      if (g) kids.push(hint(`b_w = ${fmt(g.bw, 0)} · d = ${fmt(g.d, 0)} · z = ${fmt(g.z, 0)} mm`));
    } else {
      kids.push(h('div', { class: 'grid3' },
        numField('b_w', sh, 'bw', { unit: 'mm', min: 1, onChange: upd(app) }),
        numField('d', sh, 'd', { unit: 'mm', min: 1, onChange: upd(app) }),
        numField('z', sh, 'z', { unit: 'mm', min: 1, onChange: upd(app) })));
    }
    if (sia && !(sh.dw > 0 && sh.s > 0 && sh.legs > 0)) {
      kids.push(h('div', { class: 'grid2' },
        numField('Grösstkorn D_max', sh, 'Dmax', { unit: 'mm', min: 0, max: 64, onChange: upd(app), info: tip('k_g = 48/(16 + D_max), SIA 262 4.3.3.2.1.') }),
        selectField('Dehnung ε_v', sh, 'epsMode', [{ value: 'elastic', label: 'elastisch' }, { value: 'plastic', label: 'plastisch' }], { onChange: upd(app), info: tip('SIA 262 4.3.3.2.2 – elastisch: ε_v = f_sd/E_s·m_Ed/m_Rd (Biegeausnutzung des Lastfalls); plastisch: ε_v = 1.5·f_sd/E_s.') })));
    }
  }
  return group('Querkraft', kids, { collapsed: !sh.active, info: sia ? 'SIA 262 4.3.3 (vereinfacht, konstante Querschnittswerte).' : 'EN 1992-1-1 6.2.' });
}

function renderRebar(el, app) {
  syncInstance(app);
  el.append(barsCard(app));
  el.append(generatorCard(app));
  el.append(shearCard(app));
  el.append(steelCard(app));
}

// ------------------------------------------------------------------ Register 3: Lasten

const LC_COLORS = { GZT: 'var(--accent)', GZG: 'var(--c-series-4)' };

function loadSub(l, shear) {
  const parts = [l.type === 'GZG' ? 'GZG' : 'GZT', `N = ${fmt(+l.N || 0, 0)} kN`, `M_y = ${fmt(+l.My || 0, 1)}`, `M_z = ${fmt(+l.Mz || 0, 1)} kNm`];
  if (shear && l.type !== 'GZG') parts.push(`V = ${fmt(+l.V || 0, 0)} kN`);
  return parts.join(' · ');
}

function loadDetail(d, l, i, app) {
  const shear = !!app.project.shear?.active;
  const sync = () => refreshRow(d, l.name, loadSub(l, shear), LC_COLORS[l.type] || LC_COLORS.GZT);
  const ch = () => { sync(); app.changed(); };
  d.append(h('div', { class: 'grid2' },
    textField('Bezeichnung', l, 'name', { onChange: ch }),
    selectField('Typ', l, 'type', [{ value: 'GZT', label: 'GZT (Bemessung)' }, { value: 'GZG', label: 'GZG (Gebrauch)' }], {
      onChange: ch, info: '<b>GZT</b>: Bemessungswerte – Ausnutzung aus dem Interaktionsdiagramm. <b>GZG</b>: Gebrauchslasten – Spannungen im gerissenen Zustand.',
    })));
  d.append(h('div', { class: 'grid3' },
    numField('N', l, 'N', { unit: 'kN', onChange: ch, info: 'Zug positiv, Druck negativ.' }),
    numField('M_y', l, 'My', { unit: 'kNm', onChange: ch, info: 'Positiv → Zug unten (Feldmoment).' }),
    numField('M_z', l, 'Mz', { unit: 'kNm', onChange: ch, info: 'Positiv → Zug rechts (y > 0).' })));
  if (shear) d.append(h('div', { class: 'grid3' }, numField('V_d', l, 'V', { unit: 'kN', onChange: ch, info: 'Bemessungsquerkraft (Betrag); nur bei GZT.' })));
  void i;
}

function loadsCard(app) {
  const p = app.project;
  const shear = !!p.shear?.active;
  const newLc = (type) => () => ({ name: `LF ${p.loads.length + 1}`, type, N: 0, My: 0, Mz: 0, V: 0 });
  const list = listEditor(p.loads, {
    active: ctx.ui.lcOpen,
    onActive: (i) => {
      ctx.ui.lcOpen = i;
      if (i !== null && i !== undefined) { app.viewOpts.lc = i; app.renderView(); app.renderResults(); }
    },
    label: (l, i) => l.name || `LF ${i + 1}`,
    sub: (l) => loadSub(l, shear),
    swatch: (l) => LC_COLORS[l.type] || LC_COLORS.GZT,
    onChange: ({ type, index }) => {
      ctx.ui.lcOpen = type === 'remove' ? null : index;
      if (type !== 'remove') app.viewOpts.lc = index;
      app.changed({ inputs: true });
    },
    detail: (d, l, i) => loadDetail(d, l, i, app),
    add: [
      { label: 'GZT-Lastfall', icon: 'plus', create: newLc('GZT') },
      { label: 'GZG-Lastfall', icon: 'plus', create: newLc('GZG') },
    ],
    empty: 'Noch keine Lastfälle. GZT: Tragsicherheit mit Bemessungswerten; GZG: Spannungen unter Gebrauchslasten.',
  });
  ctx.tables.loadList = list;
  return group(`Lastfälle (${p.loads.length})`, [list], { id: 'Lastfälle', info: tip(SIGN_INFO) });
}

function loadTableCard(app) {
  const p = app.project;
  const shear = !!p.shear?.active;
  let card = null;
  const cols = [
    { key: 'name', label: 'Name', type: 'text', width: '25%' },
    { key: 'type', label: 'Typ', type: 'select', options: [{ value: 'GZT', label: 'GZT' }, { value: 'GZG', label: 'GZG' }], width: '64px' },
    { key: 'N', label: 'N', unit: 'kN' },
    { key: 'My', label: 'M_y', unit: 'kNm' },
    { key: 'Mz', label: 'M_z', unit: 'kNm' },
  ];
  if (shear) cols.push({ key: 'V', label: 'V_d', unit: 'kN' });
  const tbl = dataTable(cols, p.loads, {
    onChange: () => { ctx.tables.loadList?.refresh(); setCount(card, p.loads.length); app.changed(); },
    newRow: (rows) => ({ name: `LF ${rows.length + 1}`, type: 'GZT', N: 0, My: 0, Mz: 0, V: 0 }),
    enterAdds: true,
    hint: rich(`Excel: Name, Typ, N, M_y, M_z${shear ? ', V_d' : ''}`),
  });
  card = group('Tabelle', [tbl], { id: 'Lastfall-Tabelle', collapsed: true, info: 'Alle Lastfälle als Tabelle – zum schnellen Erfassen und für das Einfügen aus Excel (Spalten in dieser Reihenfolge).' });
  return card;
}

function slsCard(app) {
  const p = app.project;
  const mat = materialSet(p);
  const sls = p.sls, calc = p.calc;
  const kids = [];
  if (mat.norm === 'SIA') {
    kids.push(selectField('Anforderungen', sls, 'req', SLS_REQUIREMENTS, {
      onChange: updInputs(app), wide: true,
      info: tip('Rissbreitenbegrenzung nach SIA 262 4.4.2: <b>normal</b> – Kontrolle σ_s ≤ f_sd; <b>erhöht/hoch</b> – σ_s,adm abhängig vom Stababstand s (Näherung der Kurven von Fig. 31, mit der Norm vergleichen); <b>vorgeben</b> – eigener Grenzwert.'),
    }));
    if (sls.req === 'manual') kids.push(numField('σ_s,adm', sls, 'sigmaAdm', { unit: 'MPa', min: 1, onChange: upd(app) }));
    if (sls.req === 'erhoeht' || sls.req === 'hoch') {
      kids.push(checkField('Stababstand s automatisch', sls, 'spacingAuto', { onChange: updInputs(app), info: 'Grösster Achsabstand benachbarter Stäbe der am stärksten gezogenen Lage, je GZG-Lastfall.' }));
      if (sls.spacingAuto === false) kids.push(numField('Stababstand s', sls, 'spacing', { unit: 'mm', min: 10, onChange: upd(app) }));
    }
  } else {
    kids.push(hint('EN 1992-1-1, 7.2: σ_s ≤ 0.8·f_yk und |σ_c| ≤ 0.6·f_ck (charakteristische Kombination).'));
  }
  kids.push(selectField('Wertigkeit n', calc, 'nMode', [{ value: 'auto', label: `automatisch (${fmt(mat.s.Es * (1 + mat.phi) / mat.c.Ecm, 2)})` }, { value: 'manual', label: 'vorgeben' }], {
    onChange: updInputs(app), wide: true, info: tip('n = E_s·(1 + φ)/E_cm für die gerissene, linear-elastische Spannungsberechnung; Langzeit üblich n ≈ 15–20.'),
  }));
  if (calc.nMode === 'manual') kids.push(numField('n', calc, 'n', { min: 1, max: 50, onChange: upd(app) }));
  return group('Gebrauchstauglichkeit', kids, { collapsed: true, info: 'Spannungsgrenzen für die Lastfälle vom Typ GZG.' });
}

function advancedCard(app) {
  const calc = app.project.calc;
  const R = app.results;
  return group('Erweitert', [
    selectField('Bezugspunkt', calc, 'ref', REF_POINTS, { onChange: upd(app), wide: true, info: tip('Punkt, in dem N, M_y und M_z angreifen. Gerechnet wird intern um den Betonschwerpunkt; die Ausnutzung hängt nicht von dieser Wahl ab.') }),
    numField('Kriechzahl φ', calc, 'creep', { min: 0, max: 5, onChange: updInputs(app), info: 'Wirkt auf n im GZG und auf die M-κ-Linie (Betondehnungen × (1 + φ)), nicht auf den Tragwiderstand.' }),
    R ? hint(`Fasermodell: ${R.nFibers} Fasern, Kantenlänge ≈ ${fmt(R.mesh * 1000, 0)} mm`) : null,
  ], { collapsed: true });
}

function signCard() {
  return group('Vorzeichen', [h('div', {}, signFigure()), hint('N > 0 Zug · M_y > 0 Zug unten · M_z > 0 Zug rechts')], { collapsed: true, info: tip(SIGN_INFO) });
}

function renderLoads(el, app) {
  syncInstance(app);
  app.project.loads ||= [];
  el.append(loadsCard(app));
  el.append(signCard());
  el.append(loadTableCard(app));
  el.append(slsCard(app));
  el.append(advancedCard(app));
}

// ------------------------------------------------------------------ App

function migrate(p) {
  const b = baseProject();
  p.shape = { ...b.shape, ...(p.shape || {}) };
  for (const k of Object.keys(b.shape)) {
    if (k === 'type' || k === 'poly') continue;
    p.shape[k] = { ...b.shape[k], ...(p.shape[k] || {}) };
  }
  if (!Array.isArray(p.shape.poly)) p.shape.poly = b.shape.poly;
  p.openings = Array.isArray(p.openings) ? p.openings : [];
  // Hohlräume einer Vorlage sind nur bei «Polygon frei» eigene Aussparungen
  if (p.shape.type !== 'poly') p.openings = p.openings.filter((o) => !o.fromTemplate);
  p.bars = Array.isArray(p.bars) ? p.bars : [];
  p.loads = Array.isArray(p.loads) ? p.loads : [];
  p.material = { ...b.material, ...(p.material || {}) };
  p.calc = { ...b.calc, ...(p.calc || {}) };
  p.sls = { ...b.sls, ...(p.sls || {}) };
  p.shear = { ...b.shear, ...(p.shear || {}) };
  return p;
}

createApp({
  id: 'querschnitt',
  title: 'Querschnitt',
  subtitle: 'Querschnittsanalyse Stahlbeton',
  version: 1,
  instance: { label: 'Querschnitt', plural: 'Querschnitte' },
  defaultProject,
  migrate,
  examples: EXAMPLES,
  intro: INTRO,
  help: HELP,
  autoCompute: true,
  inputTabs: [
    { id: 'querschnitt', label: 'Querschnitt', render: renderSection },
    { id: 'bewehrung', label: 'Bewehrung', render: renderRebar },
    { id: 'lasten', label: 'Lasten', render: renderLoads },
  ],
  viewModes: [
    { id: 'geometrie', label: 'Geometrie' },
    { id: 'dehnungen', label: 'Dehnungen', needsResults: true },
    { id: 'spannungen', label: 'Spannungen', needsResults: true },
  ],
  viewOptions: (app) => {
    const mode = app.viewMode || 'geometrie';
    const o = [];
    if (mode !== 'geometrie') o.push({ key: 'state', label: 'Zustand', type: 'select', default: 'auto', options: STATE_OPTIONS });
    o.push({ key: 'labels', label: 'Beschriftung', type: 'check', default: true });
    if (mode === 'geometrie') {
      o.push({ key: 'dims', label: 'Masse', type: 'check', default: true });
      o.push({ key: 'axes', label: 'Achsen', type: 'check', default: true });
    }
    return o;
  },
  toolbarExtras: (app) => {
    const loads = app.project?.loads || [];
    if (app.viewMode === 'geometrie' || !loads.length) return [];
    app.viewOpts.lc = caseIndex(app);
    const sel = selectInput(app.viewOpts, 'lc', loads.map((l, i) => ({ value: i, label: `${l.name || `LF ${i + 1}`} (${l.type || 'GZT'})` })), {
      onChange: () => { app.selection = null; app.renderView(); app.renderResults(); },
    });
    sel.title = 'Lastfall für Dehnungen und Spannungen';
    sel.style.width = '180px';
    return [h('span', { class: 'sep' }), h('span', { class: 'small muted' }, 'Lastfall'), sel];
  },
  renderView: (v, app, mode) => { syncInstance(app); renderView(v, app, mode); },
  editor: createEditorSpec(ctx),
  derivation: (app) => derivation(app),
  compute: (project, app) => {
    if (app) syncInstance(app);
    const miss = missingInput(project);
    if (miss) throw new IncompleteInput(miss.msg, miss.hint);
    return analyze(project, ctx.cache);
  },
  renderResults: (el, app) => renderResults(el, app, ctx),
  report: (app) => buildReport(app, ctx),
});
