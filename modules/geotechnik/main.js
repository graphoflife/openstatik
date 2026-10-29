// Geotechnik – Erddruck, Grundbruch, Setzung, Böschung, Stützmauer
import { createApp } from '../../js/core/app.js';
import { h, group, numField, selectField, checkField, dataTable, segmented, button, toast, fmt, listEditor, badge, rich, subHtml } from '../../js/core/ui.js';
import { compute, ANALYSES } from './calc.js';
import { EXAMPLES, baseProject, defaultProject } from './examples.js';
import { normPreset, soilColor } from './soil.js';
import { migrateSoil, FAR, TOP } from './ground.js';
import { renderView, viewModes, viewOptions } from './draw.js';
import { renderResults, buildReport, DEPTH_REF } from './output.js';
import { editorSpec, soilEditor, newSoil } from './editing.js';
import { derivation } from './derivation.js';

// ------------------------------------------------------------------ Stil (nur CSS-Variablen)

const CSS = `
.geo-picker { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; margin: 0 0 12px; }
.geo-picker button { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 2px 5px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text-2); font: inherit; font-size: 11px; line-height: 1.15; cursor: pointer; min-width: 0; transition: background .12s, border-color .12s, color .12s; }
.geo-picker button span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.geo-picker button:hover { border-color: var(--accent); color: var(--text); }
.geo-picker button.active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: 600; }
.geo-picker button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.geo-picker svg { width: 22px; height: 22px; }
.geo-context { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-size: 12px; color: var(--text-2); }
.geo-context svg { width: 18px; height: 18px; color: var(--accent); flex: none; }
.geo-seg { display: flex; margin: 0 0 6px; }
.geo-seg .seg { flex: 1; display: flex; }
.geo-seg .seg button { flex: 1; }
`;
function injectStyle() {
  if (document.getElementById('geo-style')) return;
  document.head.append(h('style', { id: 'geo-style' }, CSS));
}

// Piktogramme der Analysearten (Strich, currentColor)
const PICTO = {
  erddruck: '<path d="M9 5v22M5 27h22"/><path d="M9 7l11 20H9z" fill="currentColor" fill-opacity=".16"/><path d="M19 15h-6M21.5 20h-8.5M16.5 10h-3.5" stroke-width="1.4"/>',
  grundbruch: '<path d="M14 3v8M18 3v8"/><path d="M9 11h14v4H9z" fill="currentColor" fill-opacity=".16"/><path d="M3 15h6M23 15h6"/><path d="M9 15c-5 1-6 7-1 9s9-1 8-3M23 15c5 1 6 7 1 9s-9-1-8-3" stroke-dasharray="2 2"/>',
  setzung: '<path d="M3 9h26"/><path d="M10 6h12v3H10z" fill="currentColor" fill-opacity=".2"/><path d="M10 9c0 8 12 8 12 0" fill="currentColor" fill-opacity=".14"/><path d="M7 9c0 15 18 15 18 0" opacity=".6"/>',
  boeschung: '<path d="M2 9h8l12 12h8"/><path d="M2 9h8l12 12h8v8H2z" fill="currentColor" fill-opacity=".12" stroke="none"/><path d="M7 9a13 13 0 0 0 19 12" stroke-dasharray="2.5 2"/><circle cx="20" cy="5" r="1.4" fill="currentColor"/>',
  stuetzmauer: '<path d="M11 4h4v19h10v4H6v-4h5z" fill="currentColor" fill-opacity=".18"/><path d="M15 6h14" opacity=".5"/><path d="M2 23h4"/>',
};
const picto = (id) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 32 32'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.6'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = PICTO[id] || '';
  return s;
};

// ------------------------------------------------------------------ Hilfen

/** Formelzeichen in Erklärungstexten (HTML) tiefstellen: c_u → c<sub>u</sub>. */
const I = (t) => (t ? String(t).split(/(<[^>]+>)/).map((x) => (x.startsWith('<') ? x : subHtml(x))).join('') : t);

function deepDefaults(p, base) {
  if (!p || typeof p !== 'object') return base;
  for (const [k, v] of Object.entries(base)) {
    if (p[k] === undefined || p[k] === null) p[k] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v) && typeof p[k] === 'object' && !Array.isArray(p[k])) deepDefaults(p[k], v);
  }
  return p;
}

let appRef = null;
const changed = (opts) => appRef?.changed(opts);
const N = (label, obj, key, opts = {}) => numField(label, obj, key, { ...opts, info: I(opts.info), onChange: () => { opts.onChange?.(); changed(opts.rebuild ? { inputs: true } : undefined); } });
const S = (label, obj, key, options, opts = {}) => selectField(label, obj, key, options, { ...opts, info: I(opts.info), onChange: () => { opts.onChange?.(); changed({ inputs: opts.rebuild !== false }); } });
const C = (label, obj, key, opts = {}) => checkField(label, obj, key, { ...opts, info: I(opts.info), onChange: () => { opts.onChange?.(); changed({ inputs: !!opts.rebuild }); } });
const G = (title, children, opts = {}) => group(title, children, { ...opts, info: I(opts.info) });
const seg = (items, active, onSelect) => h('div', { class: 'geo-seg' }, segmented(items, active, onSelect));

/** Liste, deren Kurzinfos nach dem Verlassen neu gezeichnet werden (Werte bleiben aktuell). */
function liveList(items, opts) {
  const el = listEditor(items, opts);
  el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget)) el.refresh(); });
  return el;
}

function contextLine(app, text) {
  const a = ANALYSES.find((x) => x.id === app.project.analysis);
  return h('div', { class: 'geo-context' }, picto(a.id), h('span', {}, rich(text)));
}

function setAnalysis(app, id) {
  if (app.project.analysis === id) return;
  app.editor?.setTool?.('select');
  app.editor?.select?.([]);
  app.project.analysis = id;
  app.changed({ inputs: true, immediate: true });
}

// ------------------------------------------------------------------ Register 1: Analyse

function renderAnalysis(el, app) {
  const p = app.project;
  const picker = h('div', { class: 'geo-picker', role: 'tablist', 'aria-label': 'Analyseart' });
  for (const a of ANALYSES) {
    picker.append(h('button', { type: 'button', role: 'tab', class: a.id === p.analysis ? 'active' : '', title: a.desc, 'aria-selected': a.id === p.analysis ? 'true' : 'false', onclick: () => setAnalysis(app, a.id) }, picto(a.id), h('span', {}, a.short)));
  }
  el.append(picker);
  ({ erddruck: inEP, grundbruch: inBC, setzung: inST, boeschung: inSL, stuetzmauer: inRW })[p.analysis](el, app);
}

// ---------------------------------------------------------------- Erddruck
function inEP(el, app) {
  const e = app.project.ep;
  el.append(G('Wand', [
    N('Wandhöhe H', e, 'H', { unit: 'm', min: 0, info: 'Höhe der Wand (lotrechte Projektion). Die Bodenschichten beziehen sich auf den Wandkopf (Tiefe 0). In der Grafik: Wandkopf ziehen.' }),
    N('Wandneigung α', e, 'alpha', { unit: '°', min: -45, max: 45, info: 'Neigung der Wandrückseite gegen die Lotrechte; <b>positiv</b>, wenn der Wandkopf vom Erdreich weg geneigt ist (DIN 4085).' }),
    N('Geländeneigung β', e, 'beta', { unit: '°', min: -45, max: 45, info: 'Neigung des Geländes hinter der Wand, positiv ansteigend; kleiner als φ\'_k.' }),
  ]));
  const kinds = [{ value: 'active', label: 'aktiv' }, { value: 'increased', label: 'erhöht aktiv' }, { value: 'atrest', label: 'Ruhedruck' }, { value: 'passive', label: 'Erdwiderstand' }];
  const items = [S('Erddruckart', e, 'kind', kinds, { info: '<b>Aktiv</b>: Wand kann ausweichen. <b>Erhöht aktiv</b>: e = e_a + μ·(e_0 − e_a), z.B. Kellerwände. <b>Ruhedruck</b>: unverschiebliche Wand. <b>Erdwiderstand</b>: Boden wird gegen die Wand gedrückt.' })];
  if (e.kind === 'passive') {
    items.push(S('Gleitfläche', e, 'passiveMethod', [{ value: 'curved', label: 'gekrümmt' }, { value: 'coulomb', label: 'eben (Coulomb)' }], { rebuild: false, info: 'Gekrümmt: Lancellotta (2002), nahe Caquot–Kérisel. Eben: nur für δ_p ≤ φ/3.' }));
    items.push(N('Wandreibung δ_p/φ', e, 'dpRatio', { min: 0, max: 1, unit: '–', info: 'Betrag der Wandreibung beim Erdwiderstand, üblich 0 … 2/3.' }));
  } else {
    items.push(S('Verfahren', e, 'method', [{ value: 'coulomb', label: 'Coulomb' }, { value: 'rankine', label: 'Rankine (δ = β)' }], { rebuild: false, info: 'Coulomb (DIN 4085) mit δ = (δ/φ)·φ\' der Bodenart; Rankine: Erddruck parallel zum Gelände.' }));
    if (e.kind === 'increased') items.push(N('Erhöhungsfaktor μ', e, 'mu', { min: 0, max: 1, unit: '–', info: 'μ = 0.5: Mittelwert aus aktivem Erddruck und Ruhedruck.' }));
  }
  el.append(G('Erddruck', items));
  const loads = e.kind === 'passive' ? [] : e.loads;
  el.append(G(`Lasten (${loads.length + (Number(e.q) > 0 ? 1 : 0)})`, [
    N('Flächenlast q', e, 'q', { unit: 'kN/m²', min: 0, info: 'Gleichmässige veränderliche Auflast hinter der Wand (z.B. Verkehr 10 kN/m²).' }),
    C('Wasserdruck auf die Wand', e, 'water', { info: 'Hydrostatischer Wasserdruck unter dem Grundwasserspiegel (Register «Baugrund»).' }),
    e.kind === 'passive' ? null : liveList(e.loads, {
      active: app.openLoad ?? null, onActive: (i) => { app.openLoad = i; },
      label: (l, i) => `${l.type === 'line' ? 'Linienlast' : 'Streifenlast'} ${i + 1}`,
      sub: (l) => (l.type === 'line' ? `P = ${fmt(+l.p, 1)} kN/m · a = ${fmt(+l.a, 2)} m` : `p = ${fmt(+l.p, 1)} kN/m² · a = ${fmt(+l.a, 2)} m · b = ${fmt(+l.b, 2)} m`),
      swatch: () => 'var(--c-load)',
      onChange: ({ type, index }) => { if (type === 'add' || type === 'duplicate') app.openLoad = index; changed({ inputs: true }); },
      detail: (d, l) => d.append(
        selectField('Art', l, 'type', [{ value: 'strip', label: 'Streifenlast' }, { value: 'line', label: 'Linienlast' }], { onChange: () => changed({ inputs: true }) }),
        N(l.type === 'line' ? 'Linienlast P' : 'Flächenlast p', l, 'p', { unit: l.type === 'line' ? 'kN/m' : 'kN/m²', min: 0 }),
        N('Abstand a', l, 'a', { unit: 'm', min: 0, info: 'Horizontaler Abstand vom Wandkopf bis zum Lastbeginn.' }),
        l.type === 'line' ? null : N('Breite b', l, 'b', { unit: 'm', min: 0 })),
      add: [{ label: 'Streifenlast', create: () => ({ type: 'strip', p: 20, a: 1, b: 1 }) }, { label: 'Linienlast', create: () => ({ type: 'line', p: 20, a: 1, b: 0 }) }],
      empty: 'Keine Streifen- oder Linienlasten – hier hinzufügen oder in der Grafik mit «Streifenlast» (Q) aufziehen.',
    }),
  ], { info: 'Veränderliche Lasten (γ_Q). Streifen- und Linienlasten wirken über den Coulomb-Gleitkeil.' }));
  el.append(G('Erweitert', [
    e.kind !== 'passive' && e.kind !== 'atrest' ? C('Mindesterddruck', e, 'minPressure', { info: 'Bei kohäsiven Böden mindestens den Erddruck mit φ = 40° und c = 0 ansetzen (DIN 4085).' }) : null,
    e.kind !== 'passive' ? N('Überkonsolidierung OCR', e, 'ocr', { min: 1, unit: '–', info: 'Für den Ruhedruck: K_0 = (1 − sin φ\')·√OCR (EN 1997-1, 9.5.2).' }) : null,
  ], { collapsed: true }));
}

// ---------------------------------------------------------------- Grundbruch
const SHAPES = [{ id: 'strip', label: 'Streifen' }, { id: 'rect', label: 'Rechteck' }, { id: 'circle', label: 'Kreis' }];
const DRAIN = [{ value: 'drained', label: 'drainiert' }, { value: 'undrained', label: 'undrainiert' }, { value: 'both', label: 'beide (massgebend)' }];
const IFACE = [{ value: 'cast', label: 'Ortbeton (δ = φ)' }, { value: 'precast', label: 'Fertigteil (δ = ⅔φ)' }];

function inBC(el, app) {
  const f = app.project.bc;
  const strip = f.shape === 'strip', circ = f.shape === 'circle';
  el.append(G('Fundament', [
    seg(SHAPES, f.shape, (id) => { f.shape = id; changed({ inputs: true }); }),
    N(circ ? 'Durchmesser' : 'Breite B', f, 'B', { unit: 'm', min: 0, info: strip ? 'Lasten und Widerstände je Laufmeter.' : 'Kürzere Seite (x-Richtung); H_B und M_B wirken in dieser Richtung.' }),
    f.shape === 'rect' ? N('Länge L', f, 'L', { unit: 'm', min: 0 }) : null,
    N('Einbindetiefe D', f, 'D', { unit: 'm', min: 0, info: 'Tiefe der Sohle unter Gelände; q\' = σ\'_v(D) wirkt als seitliche Auflast.' }),
    N('Fundamentdicke t', f, 't', { unit: 'm', min: 0, info: 'Für Eigengewicht und das Versetzungsmoment H·t.' }),
  ]));
  const cols = strip
    ? [{ key: 'V', label: 'V', unit: 'kN/m' }, { key: 'HB', label: 'H', unit: 'kN/m' }, { key: 'MB', label: 'M', unit: 'kNm/m', info: 'Positiv, wenn die Resultierende in +x wandert.' }]
    : [{ key: 'V', label: 'V', unit: 'kN' }, { key: 'HB', label: 'H_B', unit: 'kN' }, { key: 'HL', label: 'H_L', unit: 'kN' }, { key: 'MB', label: 'M_B', unit: 'kNm' }, { key: 'ML', label: 'M_L', unit: 'kNm' }];
  el.append(G('Lasten (charakteristisch)', [
    dataTable(cols, [f.loads.G, f.loads.Q], { onChange: () => changed(), canAdd: false, canRemove: false, rowLabel: (i) => (i ? 'Q' : 'G'), hint: 'G ständig · Q veränderlich' }),
  ], { info: 'An der Fundamentoberkante. Kombiniert mit γ_G bzw. γ_Q (ständig ungünstig/günstig, mit/ohne Q); massgebend ist die grösste Ausnutzung.' }));
  el.append(G('Berechnung', [
    S('Bodenverhalten', f, 'drainage', DRAIN, { rebuild: false, info: 'Drainiert: Langzeit mit c\', φ\'. Undrainiert: Kurzzeit mit c_u. «Beide» wählt den ungünstigeren Fall.' }),
    S('Sohlreibung', f, 'interface', IFACE, { rebuild: false, info: 'Sohlreibungswinkel für das Gleiten (EN 1997-1, 6.5.3).' }),
  ]));
  el.append(G('Erweitert', [
    N('Sohlneigung α', f, 'alphaBase', { unit: '°', min: 0, max: 45 }),
    C('Eigengewicht ergänzen', f, 'selfWeight', { rebuild: true, info: 'Fundament (γ_c·t) und Boden über dem Fundament werden zu V_G addiert.' }),
    f.selfWeight ? N('Raumgewicht γ_c', f, 'gammaC', { unit: 'kN/m³', min: 0 }) : null,
  ], { collapsed: true }));
}

// ---------------------------------------------------------------- Setzung
function inST(el, app) {
  const s = app.project.st, bc = app.project.bc;
  el.append(G('Fundament', [
    seg(SHAPES, s.shape, (id) => { s.shape = id; changed({ inputs: true }); }),
    N(s.shape === 'circle' ? 'Durchmesser' : 'Breite B', s, 'B', { unit: 'm', min: 0 }),
    s.shape === 'rect' ? N('Länge L', s, 'L', { unit: 'm', min: 0 }) : null,
    N('Gründungstiefe D', s, 'D', { unit: 'm', min: 0 }),
  ], { actions: [button('aus Grundbruch', { small: true, ghost: true, icon: 'copy', title: 'Form und Abmessungen aus «Grundbruch» übernehmen', onClick: () => { Object.assign(s, { shape: bc.shape, B: bc.B, L: bc.L, D: bc.D }); changed({ inputs: true }); toast('Abmessungen übernommen', 'ok'); } })] }));
  el.append(G('Belastung (quasi-ständig)', [
    S('Eingabe als', s, 'loadMode', [{ value: 'p', label: 'Sohlspannung σ_0' }, { value: 'V', label: 'Vertikalkraft V' }]),
    s.loadMode === 'V'
      ? N('Vertikalkraft V', s, 'V', { unit: s.shape === 'strip' ? 'kN/m' : 'kN', min: 0, info: 'Setzungswirksame Last inkl. Fundamenteigengewicht.' })
      : N('Sohlspannung σ_0', s, 'p0', { unit: 'kN/m²', min: 0, info: 'Mittlere setzungswirksame Sohlspannung inkl. Fundamenteigengewicht.' }),
    C('Aushubentlastung abziehen', s, 'unload', { info: 'Setzungswirksam ist σ_0 − σ_v(D).' }),
    N('zulässige Setzung s_zul', s, 'sAllow', { unit: 'mm', min: 0, info: 'Für die Gebrauchstauglichkeit (0 = ohne Nachweis). Richtwerte: Einzelfundamente 20–30 mm.' }),
  ]));
  el.append(G('Erweitert', [
    N('Grenztiefe-Faktor f', s, 'limitFactor', { min: 0.01, max: 1, unit: '–', info: 'Integration bis Δσ = f·σ\'_v0 (DIN 4019: 0.2; weiche Böden 0.1).' }),
    C('Starres Fundament', s, 'rigid', { info: 'Setzung im kennzeichnenden Punkt (0.37·B, 0.37·L ab Mitte; Kreis 0.845·r).' }),
  ], { collapsed: true }));
}

// ---------------------------------------------------------------- Böschung
function inSL(el, app) {
  const s = app.project.sl;
  s._gen = s._gen || { H: 6, n: 2, a: 10, b: 14 };
  const g = s._gen;
  el.append(G(`Gelände (${s.surface.length})`, [
    dataTable([{ key: 'x', label: 'x', unit: 'm' }, { key: 'y', label: 'y', unit: 'm' }], s.surface, { onChange: () => changed(), newRow: (rows) => ({ x: (rows[rows.length - 1]?.x ?? 0) + 5, y: rows[rows.length - 1]?.y ?? 0 }), minRows: 0, hint: 'von links nach rechts', maxHeight: '200px' }),
  ], { info: 'Geländeoberfläche als Polylinie (x nach rechts, y nach oben). In der Grafik: Werkzeug «Gelände» (G), Punkte ziehen, «Punkt einfügen» (I).' }));
  el.append(G('Böschung erzeugen', [
    h('div', { class: 'grid2' }, numField('Höhe H', g, 'H', { unit: 'm', min: 0.1 }), numField('Neigung 1 :', g, 'n', { unit: '–', min: 0.05 }),
      numField('Krone a', g, 'a', { unit: 'm', min: 0 }), numField('Fuss b', g, 'b', { unit: 'm', min: 0 })),
    h('div', { class: 'row end' }, button('Erzeugen', { icon: 'play', small: true, primary: true, onClick: () => {
      const H = +g.H, n = +g.n, a = +g.a, b = +g.b;
      s.surface.splice(0, s.surface.length, { x: 0, y: H }, { x: a, y: H }, { x: a + n * H, y: 0 }, { x: a + n * H + b, y: 0 });
      s.q.x1 = a * 0.2; s.q.x2 = a * 0.8;
      changed({ inputs: true });
      toast(`Böschung ${fmt(n, 2)}:1, H = ${fmt(H, 2)} m`, 'ok');
    } })),
  ], { collapsed: s.surface.length >= 2, info: 'Böschung mit horizontaler Krone und horizontalem Fuss (überschreibt die Geländelinie).' }));
  const water = [S('Wasserspiegel', s, 'waterMode', [{ value: 'none', label: 'kein Wasser' }, { value: 'gw', label: 'horizontal (Baugrund)' }, { value: 'line', label: 'Sickerlinie' }], { info: 'u = γ_w·(h_w − y) an der Lamellenbasis; Wasser über Gelände wirkt als Auflast.' })];
  if (s.waterMode === 'line') water.push(dataTable([{ key: 'x', label: 'x', unit: 'm' }, { key: 'y', label: 'y_w', unit: 'm' }], s.water, { onChange: () => changed(), newRow: (rows) => ({ x: (rows[rows.length - 1]?.x ?? 0) + 5, y: rows[rows.length - 1]?.y ?? 0 }), minRows: 2, maxHeight: '160px' }));
  el.append(G('Wasser', water));
  el.append(G('Auflast', [
    N('Flächenlast q', s.q, 'p', { unit: 'kN/m²', min: 0, info: 'Veränderlich: Bemessung mit γ_Q, nur wo ungünstig.' }),
    h('div', { class: 'grid2' }, N('von x_1', s.q, 'x1', { unit: 'm' }), N('bis x_2', s.q, 'x2', { unit: 'm' })),
  ]));
  el.append(G('Berechnung', [
    S('Bodenverhalten', s, 'drainage', [{ value: 'drained', label: 'drainiert' }, { value: 'undrained', label: 'undrainiert (c_u > 0)' }], { rebuild: false }),
    N('Lamellen', s, 'nSlices', { min: 8, max: 80, unit: '–', info: '20 – 40 Lamellen genügen in der Regel.' }),
    N('Mindesttiefe t_min', s, 'tMin', { unit: 'm', min: 0, info: 'Flachere Kreise werden ignoriert.' }),
    N('Kreise bis unter Fuss', s, 'depthBelow', { unit: 'm', min: 0, info: 'Tiefste zulässige Lage der Gleitkreise unter dem tiefsten Geländepunkt.' }),
  ], { collapsed: true }));
  const gr = s.grid;
  const gridItems = [C('automatisch', gr, 'auto', { rebuild: true, info: 'Mittelpunkte über der Böschung, Radien bis zur Tiefengrenze, danach lokale Verfeinerung. In der Grafik: Werkzeug «Suchraster» (U).' })];
  if (gr.auto === false) {
    gridItems.push(h('div', { class: 'grid2' }, N('x_0', gr, 'x0', { unit: 'm' }), N('x_1', gr, 'x1', { unit: 'm' }), N('y_0', gr, 'y0', { unit: 'm' }), N('y_1', gr, 'y1', { unit: 'm' })),
      h('div', { class: 'grid3' }, N('n_x', gr, 'nx', { min: 2, max: 60 }), N('n_y', gr, 'ny', { min: 2, max: 60 }), N('Radien', gr, 'nr', { min: 2, max: 60 })));
  }
  el.append(G('Suchraster', gridItems, { collapsed: true }));
}

// ---------------------------------------------------------------- Stützmauer
function inRW(el, app) {
  const w = app.project.rw;
  el.append(G('Wand', [
    N('Wandhöhe h_s', w, 'hs', { unit: 'm', min: 0, info: 'Ab Oberkante Fundament. In der Grafik: Mauerkrone ziehen.' }),
    h('div', { class: 'grid2' }, N('Dicke oben', w, 'tTop', { unit: 'm', min: 0.05 }), N('Dicke unten', w, 'tBot', { unit: 'm', min: 0.05, info: 'Rückseite lotrecht, Anzug auf der Luftseite.' })),
  ]));
  el.append(G('Fundament', [
    h('div', { class: 'grid2' }, N('Zehe', w, 'toe', { unit: 'm', min: 0 }), N('Ferse', w, 'heel', { unit: 'm', min: 0 })),
    h('div', { class: 'grid2' }, N('Dicke d', w, 'd', { unit: 'm', min: 0.1 }), N('Einbindung D_f', w, 'Df', { unit: 'm', min: 0, info: 'Gelände vor der Mauer über der Sohle.' })),
    C('Sporn', w.key, 'on', { rebuild: true, info: 'Erhöht den Gleitwiderstand (Erdwiderstand auf Spornhöhe, γ_R,e).' }),
    w.key.on ? h('div', { class: 'grid3' }, N('Tiefe', w.key, 'depth', { unit: 'm', min: 0 }), N('Breite', w.key, 'width', { unit: 'm', min: 0 }), N('Lage', w.key, 'x', { unit: 'm', min: 0 })) : null,
  ]));
  el.append(G('Hinterfüllung', [
    h('div', { class: 'grid2' }, N('Neigung β', w, 'beta', { unit: '°', min: -40, max: 40 }), N('Auflast q', w, 'q', { unit: 'kN/m²', min: 0 })),
    S('Erddruckansatz', w, 'method', [{ value: 'rankine', label: 'Rankine (δ = β)' }, { value: 'coulomb', label: 'Coulomb' }], { rebuild: false, info: 'Erddruck auf die lotrechte Ersatzwand durch das Fersenende.' }),
    C('Wasserdruck', w, 'water', { info: 'Ohne Haken wird eine wirksame Drainage vorausgesetzt.' }),
  ]));
  el.append(G('Erweitert', [
    S('Bodenverhalten', w, 'drainage', DRAIN, { rebuild: false }),
    S('Sohlreibung', w, 'interface', IFACE, { rebuild: false }),
    N('Raumgewicht γ_c', w, 'gammaC', { unit: 'kN/m³', min: 0 }),
  ], { collapsed: true }));
}

// ------------------------------------------------------------------ Register 2: Baugrund

const isBand = (z) => z.ring.length === 4 && z.ring.every((q) => Math.abs(Math.abs(q[0]) - FAR) < 1e-6);
function zoneSub(z) {
  const ys = z.ring.map((q) => q[1]);
  if (isBand(z)) {
    const top = Math.max(...ys), bot = Math.min(...ys);
    return `waagrecht · Tiefe ${top >= TOP - 1e-6 ? 'oben' : fmt(-top, 2)} … ${fmt(-bot, 2)} m`;
  }
  return `${z.ring.length} Ecken · Höhe ${fmt(Math.min(...ys), 2)} … ${fmt(Math.max(...ys), 2)} m`;
}

function renderSoil(el, app) {
  const p = app.project, sl = p.soil;
  const soils = sl.soils, zones = sl.zones;
  el.append(contextLine(app, `Bezugsniveau (Tiefe 0): ${DEPTH_REF[p.analysis]}`));
  const uses = (i) => zones.filter((z) => z.soil === i).length;
  // Verweise nach Löschen/Duplizieren nachführen
  const fixRefs = ({ type, index }) => {
    if (type === 'remove') {
      const nb = sl.base === index ? 0 : sl.base > index ? sl.base - 1 : sl.base;
      for (const z of zones) { if (z.soil === index) z.soil = nb; else if (z.soil > index) z.soil -= 1; }
      sl.base = nb;
    }
    if (type === 'duplicate') { for (const z of zones) if (z.soil > index - 1) z.soil += 1; if (sl.base > index - 1) sl.base += 1; }
    if (type === 'add' || type === 'duplicate') app.openSoil = index;
    changed({ inputs: true });
  };
  el.append(G(`Bodenarten (${soils.length})`, [
    liveList(soils, {
      active: app.openSoil ?? null, onActive: (i) => { app.openSoil = i; if (i !== null) sl.active = i; },
      label: (s) => s.name,
      sub: (s) => `φ'_k = ${fmt(+s.phi, 1)}° · c'_k = ${fmt(+s.c, 1)} · γ = ${fmt(+s.gamma, 1)} · M_E = ${fmt(+s.ME, 0)}`,
      swatch: (s) => soilColor(s.col),
      badge: (s, i) => (i === sl.base ? badge('Untergrund', 'info') : uses(i) ? badge(`${uses(i)} Fläche${uses(i) === 1 ? '' : 'n'}`, 'info') : null),
      canRemove: (s, i) => soils.length > 1,
      onChange: fixRefs,
      detail: (d, s) => d.append(...soilEditor(s, (rebuild) => changed(rebuild ? { inputs: true } : undefined))),
      add: [{ label: 'Bodenart', create: () => newSoil(p) }],
    }),
  ], { info: I('Kennwerte der Bodenarten (charakteristisch, SIA 267 / EN 1997-1, 2.4.5.2). Welche Bodenart wo liegt, bestimmen die Flächen.') }));
  el.append(G(`Flächen (${zones.length})`, [
    S('Untergrund', sl, 'base', soils.map((s, i) => ({ value: i, label: s.name })), { info: 'Bodenart überall dort, wo keine Fläche liegt.' }),
    liveList(zones, {
      active: app.openZone ?? null,
      onActive: (i) => { app.openZone = i; if (i !== null) app.editor?.select([`Z:${i}`]); },
      label: (z, i) => `Fläche ${i + 1}: ${soils[z.soil]?.name ?? '?'}`,
      sub: (z) => zoneSub(z),
      swatch: (z) => soilColor(soils[z.soil]?.col),
      duplicate: false,
      onChange: ({ type, index }) => { if (type === 'add') app.openZone = index; changed({ inputs: true }); },
      detail: (d, z, k) => {
        const rows = z.ring.map((q) => ({ get x() { return q[0]; }, set x(v) { q[0] = v; }, get y() { return q[1]; }, set y(v) { q[1] = v; } }));
        const sync = () => { z.ring.splice(0, z.ring.length, ...rows.map((r) => [Number(r.x) || 0, Number(r.y) || 0])); changed(); };
        d.append(
          S('Bodenart', z, 'soil', soils.map((s, i) => ({ value: i, label: s.name }))),
          dataTable([{ key: 'x', label: 'x', unit: 'm' }, { key: 'y', label: 'y', unit: 'm', info: I('Höhe relativ zum Bezugsniveau (y = −Tiefe).') }], rows, { onChange: sync, newRow: () => ({ x: 0, y: 0 }), minRows: 3, maxHeight: '180px', hint: 'Ecken in Umlaufrichtung' }),
          h('div', { class: 'row' }, button('Nach vorne', { small: true, icon: 'up', title: 'Fläche über die anderen legen', onClick: () => { zones.push(zones.splice(k, 1)[0]); app.openZone = zones.length - 1; changed({ inputs: true }); } })));
      },
      add: [{
        label: 'Waagrechte Schicht', create: () => {
          const bottoms = zones.filter(isBand).map((z) => Math.min(...z.ring.map((q) => q[1])));
          const top = bottoms.length ? Math.min(...bottoms) : 0;
          soils.push(newSoil(p));
          return { soil: soils.length - 1, ring: [[-FAR, top], [FAR, top], [FAR, top - 2], [-FAR, top - 2]] };
        },
      }],
      empty: 'Noch keine Flächen – überall gilt der Untergrund. Schichten in der Grafik mit «Schicht» (L) zeichnen, mit «Teilen» (J) abtrennen oder hier eine waagrechte Schicht hinzufügen.',
    }),
  ], { info: I('Frei geformte Schichten (Polygone); spätere Flächen liegen über früheren. Koordinaten wie in der Grafik, y relativ zum Bezugsniveau. Die Berechnung verwendet das senkrechte Profil an der massgebenden Stelle (Wand, Fundamentachse, Ersatzwand) bzw. bei der Böschung den Boden jeder Lamelle.') }));
  el.append(G('Grundwasser', [
    C('Grundwasser vorhanden', sl.gw, 'on', { rebuild: true }),
    sl.gw.on ? N('Tiefe z_w', sl.gw, 'z', { unit: 'm', info: 'Tiefe des Spiegels ab Bezugsniveau; darunter gilt γ\' und u = γ_w·(z − z_w).' }) : null,
    sl.gw.on ? N('Wichte γ_w', sl, 'gammaW', { unit: 'kN/m³', min: 9, max: 11 }) : null,
  ]));
}

// ------------------------------------------------------------------ Register 3: Norm

function renderNorm(el, app) {
  const p = app.project, n = p.norm, a = p.analysis;
  el.append(G('Norm', [
    selectField('Nachweiskonzept', n, 'code', [{ value: 'SIA', label: 'SIA 267 / SIA 260' }, { value: 'EC', label: 'EN 1997-1, Verfahren 2' }], { wide: true, onChange: (code) => { Object.assign(n, normPreset(code)); changed({ inputs: true }); toast('Partialfaktoren auf die Voreinstellung gesetzt', 'ok'); }, info: I('Setzt alle Partialfaktoren auf die Voreinstellung; alle Werte bleiben editierbar. <b>Mit der gültigen Normausgabe abgleichen.</b>') }),
    a === 'setzung' ? h('div', { class: 'muted small' }, 'Setzungen: charakteristische Werte, keine Partialfaktoren.') : null,
  ], { actions: [button('', { small: true, ghost: true, icon: 'undo', title: 'Faktoren zurücksetzen', onClick: () => { Object.assign(n, normPreset(n.code)); changed({ inputs: true }); } })] }));
  const used = {
    soilM: a === 'boeschung' || ((a === 'grundbruch' || a === 'stuetzmauer') && n.geoMode === 'M'),
    geo: a === 'grundbruch' || a === 'stuetzmauer',
    act: a === 'grundbruch' || a === 'stuetzmauer' || a === 'erddruck',
    slope: a === 'boeschung',
    passive: a === 'erddruck' || a === 'stuetzmauer',
  };
  const card = (title, items, use, info) => G(use ? title : `${title} (nicht verwendet)`, items, { collapsed: !use, info });
  el.append(card('Grundbruch und Gleiten', [
    selectField('Vorgehen', n, 'geoMode', [{ value: 'R', label: 'Widerstandsbeiwerte γ_R' }, { value: 'M', label: 'Bodenkennwerte γ_M' }], { wide: true, onChange: (m) => { if (m === 'M') { n.gRv = 1; n.gRh = 1; toast('γ_R,v und γ_R,h auf 1.0 gesetzt', 'info'); } else { const pr = normPreset(n.code); n.gRv = pr.gRv; n.gRh = pr.gRh; } changed({ inputs: true }); }, info: I('<b>γ_R</b>: R_d = R(X_k)/γ_R. <b>γ_M</b>: R_d = R(X_d) mit abgeminderten Kennwerten (dann γ_R = 1.0).') }),
    h('div', { class: 'grid2' }, N('γ_R,v Grundbruch', n, 'gRv', { min: 1, unit: '–' }), N('γ_R,h Gleiten', n, 'gRh', { min: 1, unit: '–' })),
  ], used.geo));
  el.append(card('Einwirkungen', [
    h('div', { class: 'grid3' }, N('γ_G', n, 'gG', { min: 1, unit: '–', info: 'Ständig ungünstig (SIA 260 Typ 2: 1.35).' }), N('γ_G,inf', n, 'gGinf', { min: 0, max: 1, unit: '–', info: 'Ständig günstig (SIA 260: 0.8; EN 1990: 1.0).' }), N('γ_Q', n, 'gQ', { min: 0, unit: '–' })),
  ], used.act));
  el.append(card('Bodenkennwerte γ_M', [
    h('div', { class: 'grid2' }, N('γ_φ (auf tan φ\')', n, 'gPhi', { min: 1, unit: '–' }), N('γ_c', n, 'gC', { min: 1, unit: '–' }), N('γ_cu', n, 'gCu', { min: 1, unit: '–' }), N('γ_γ', n, 'gGamma', { min: 1, unit: '–' })),
  ], used.soilM, 'tan φ\'_d = tan φ\'_k/γ_φ, c\'_d = c\'_k/γ_c, c_u,d = c_u,k/γ_cu (SIA 267, Tab. 1: 1.2 / 1.5 / 1.5; EN 1997-1 M2: 1.25 / 1.25 / 1.4).'));
  el.append(card('Böschung', [
    h('div', { class: 'grid2' }, N('γ_Q (Böschung)', n, 'gQslope', { min: 0, unit: '–', info: 'SIA 260 Typ 3 bzw. EN 1997-1 A2: 1.3.' }), N('erforderlich F_d ≥', n, 'gRs', { min: 0.5, unit: '–' })),
  ], used.slope));
  el.append(card('Erdwiderstand', [N('γ_R,e', n, 'gRe', { min: 1, unit: '–', info: 'E_p,d = E_p,k/γ_R,e (auch vor dem Sporn).' })], used.passive));
}

// ------------------------------------------------------------------ Hilfe

const INTRO = `<h4>So funktioniert's</h4><ol>
<li><b>Analyse wählen</b> (oben im Register «Analyse»).</li>
<li><b>In der Grafik zeichnen</b>: Wand, Fundament, Gelände oder Mauer mit dem Werkzeug über der Grafik; Griffe ziehen.</li>
<li><b>Boden</b>: Fläche anklicken und Bodenart wählen; «Schicht» (L) zeichnet eine Schicht als Polygon, «Teilen» (J) trennt entlang einer Linie.</li>
<li>Rechts: Nachweise (grün = erfüllt), «Herleitung» und «Bericht».</li></ol>`;

const HELP = `
<h3>Überblick</h3>
<p>Klassische Grundbauaufgaben mit einem frei gezeichneten Bodenmodell. Eingaben sind charakteristische Werte; Bemessungswerte entstehen mit den Partialfaktoren im Register «Norm» (SIA 267/SIA 260, alternativ EN 1997-1 Verfahren 2). Über die Leiste oben links lassen sich mehrere Nachweise in einem Dokument verwalten.</p>
<h3>Bodenmodell</h3>
<ul><li><b>Bodenarten</b> (Register «Baugrund») enthalten die Kennwerte γ, γ', φ'<sub>k</sub>, c'<sub>k</sub>, c<sub>u,k</sub>, M<sub>E</sub>, δ/φ.</li>
<li><b>Flächen</b> sind beliebige Polygone mit einer Bodenart; spätere Flächen liegen über früheren, ausserhalb gilt der <b>Untergrund</b>. Waagrechte Schichten sind breite Rechtecke.</li>
<li>Zeichnen: «Schicht» (L) fängt an vorhandenen Ecken und Grenzen; «Teilen» (J) trennt Flächen entlang einer Linie (seitlich waagrecht verlängert); Ecken, Grenzen und die Grenzenden am Bildrand lassen sich ziehen (gemeinsame Grenzen bleiben verbunden).</li>
<li>Berechnung: Erddruck mit dem senkrechten Profil in der Mitte der Wandrückseite, Grundbruch und Setzung mit dem Profil in der Fundamentachse (Spannungsausbreitung im homogenen Halbraum), Stützmauer mit den Profilen in der Ersatzwand, unter der Sohle und für jeden Bodenstreifen über der Ferse; Böschung mit dem Boden an der Basis und im Gewicht jeder Lamelle.</li></ul>
<h3>Erddruck</h3>
<ul><li>Aktiv nach Coulomb/Müller-Breslau (DIN 4085) oder Rankine (δ = β): e_ah = K_agh·σ'_v + K_aqh·q − K_ach·c' ≥ 0. Ruhedruck K_0 = (1 − sin φ')·√OCR·(1 + sin β); erhöht aktiv e = e_a + μ·(e_0 − e_a); Erdwiderstand gekrümmt (Lancellotta 2002) oder eben.</li></ul>
<h3>Grundbruch</h3>
<ul><li>EN 1997-1 Anhang D (wie SIA 267) mit B' = B − 2e (Meyerhof), Form-, Neigungs- und Sohlneigungsbeiwerten; Kennwerte bis 2B' gemittelt. Gleiten und Ausmittigkeit (Kern e ≤ B/6, Bemessung e ≤ B/3).</li></ul>
<h3>Setzung</h3>
<ul><li>Boussinesq/Steinbrenner (Eckpunktformel mit Überlagerung), s = Σ Δσ·Δz/M_E bis Δσ = f·σ'_v0.</li></ul>
<h3>Böschung</h3>
<ul><li>Kreisgleitflächen nach Bishop (vereinfacht), Fellenius zum Vergleich; Suche über Raster und Mustersuche; Bemessung mit γ_M und γ_Q, F_d ≥ γ_R. Validiert am ACADS-Beispiel 1(a).</li></ul>
<h3>Stützmauer</h3>
<ul><li>Erddruck auf die Ersatzwand durch das Fersenende; Gleiten (mit Sporn), Ausmittigkeit, Grundbruch und Schnittkräfte für die Bemessung.</li></ul>
<h3>Grenzen</h3>
<p>Keine nicht-kreisförmigen Gleitflächen, keine Erdbebenlasten, keine Konsolidationszeit, keine Tiefenbeiwerte. Partialfaktoren mit der gültigen Normausgabe abgleichen. Ergebnisse ohne Gewähr.</p>
<h3>Bedienung</h3>
<p>Werkzeuge über der Grafik mit Tastenkürzel (N, F, G, L, J, W, Q, K, I, U, O). Fang an Punkten, Mitten und Raster, X/Y binden an eine Achse, Ziffern tippen Koordinaten. «Herleitung» im Ergebnisbereich zeigt den Rechenweg mit Normbezug. Neue Projekte sind leer; Beispiele unter «Beispiele».</p>`;

// ------------------------------------------------------------------ App

injectStyle();

const def = {
  id: 'geotechnik',
  title: 'Geotechnik',
  subtitle: 'Erddruck, Grundbruch, Setzung, Böschung, Stützmauer',
  version: 2,
  instance: { label: 'Nachweis', plural: 'Nachweise' },
  defaultProject,
  examples: EXAMPLES,
  migrate: (p) => { if (p?.soil && !p.soil.soils) migrateSoil(p.soil); return deepDefaults(p, baseProject()); },
  intro: INTRO,
  inputTabs: [
    { id: 'analysis', label: 'Analyse', render: renderAnalysis },
    { id: 'soil', label: 'Baugrund', render: renderSoil },
    { id: 'norm', label: 'Norm', render: renderNorm },
  ],
  viewModes,
  viewOptions,
  renderView,
  editor: editorSpec,
  derivation,
  autoCompute: true,
  compute: (project) => compute(project),
  renderResults,
  report: buildReport,
  help: HELP,
};

appRef = createApp(def);
