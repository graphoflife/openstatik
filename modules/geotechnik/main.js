// Geotechnik – Erddruck, Grundbruch, Setzung, Böschung, Stützmauer
import { createApp } from '../../js/core/app.js';
import { h, group, numField, selectField, checkField, dataTable, segmented, note, emptyState, button, dropdown, icon, toast, fmt } from '../../js/core/ui.js';
import { compute, ANALYSES } from './calc.js';
import { EXAMPLES, baseProject, defaultProject, SOIL_PRESETS } from './examples.js';
import { normPreset } from './soil.js';
import { renderView, viewModes, viewOptions } from './draw.js';
import { renderResults, buildReport, DEPTH_REF } from './output.js';
import { editorSpec } from './editing.js';
import { derivation } from './derivation.js';

// ------------------------------------------------------------------ Stil (nur CSS-Variablen)

const CSS = `
.geo-picker { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; margin: 2px 0 8px; }
.geo-picker button { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 2px 7px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text-2); font: inherit; font-size: 11.5px; line-height: 1.15; cursor: pointer; transition: background .12s, border-color .12s, color .12s, box-shadow .12s; min-width: 0; }
.geo-picker button span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.geo-picker button:hover { border-color: var(--accent); color: var(--text); background: var(--surface-2); }
.geo-picker button.active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: 600; box-shadow: inset 0 0 0 1px var(--accent); }
.geo-picker button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.geo-picker svg { width: 30px; height: 30px; }
.geo-desc { color: var(--text-2); font-size: 12px; margin: 0 0 12px; padding: 0 2px; }
.geo-context { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border); margin: 0 0 12px; font-size: 12px; color: var(--text-2); }
.geo-context b { color: var(--text); }
.geo-context svg { width: 22px; height: 22px; color: var(--accent); flex: none; }
.geo-context .btn { margin-left: auto; }
.geo-seg { margin: 2px 0 8px; display: flex; }
.geo-seg .seg { flex: 1; display: flex; }
.geo-seg .seg button { flex: 1; }
.geo-muted-group > .group-title { opacity: .7; }
`;
function injectStyle() {
  if (document.getElementById('geo-style')) return;
  document.head.append(h('style', { id: 'geo-style' }, CSS));
}

// Piktogramme der Analysearten (Strich, currentColor)
const PICTO = {
  erddruck: '<path d="M9 5v22M5 27h22"/><path d="M9 7l11 20H9z" fill="currentColor" fill-opacity=".16"/><path d="M19 15h-6M21.5 20h-8.5M16.5 10h-3.5" stroke-width="1.4"/><path d="M13 13.5l-1.6 1.5 1.6 1.5M13 18.5l-1.6 1.5 1.6 1.5" stroke-width="1.2"/>',
  grundbruch: '<path d="M14 3v8M18 3v8"/><path d="M9 11h14v4H9z" fill="currentColor" fill-opacity=".16"/><path d="M3 15h6M23 15h6"/><path d="M9 15l7 6 7-6" stroke-dasharray="2 2"/><path d="M9 15c-5 1-6 7-1 9s9-1 8-3M23 15c5 1 6 7 1 9s-9-1-8-3" stroke-dasharray="2 2"/>',
  setzung: '<path d="M3 9h26"/><path d="M10 6h12v3H10z" fill="currentColor" fill-opacity=".2"/><path d="M10 9c0 8 12 8 12 0" fill="currentColor" fill-opacity=".14"/><path d="M8 9c0 13 16 13 16 0" opacity=".7"/><path d="M6 9c0 18 20 18 20 0" opacity=".4"/>',
  boeschung: '<path d="M2 9h8l12 12h8"/><path d="M2 9h8l12 12h8v8H2z" fill="currentColor" fill-opacity=".12" stroke="none"/><path d="M7 9a13 13 0 0 0 19 12" stroke-dasharray="2.5 2"/><circle cx="20" cy="5" r="1.4" fill="currentColor"/><path d="M20 5l-6 13" stroke-width="1" opacity=".6"/>',
  stuetzmauer: '<path d="M11 4h4v19h10v4H6v-4h5z" fill="currentColor" fill-opacity=".18"/><path d="M15 6h14M15 4l14 0" opacity=".5"/><path d="M2 23h4"/><path d="M15 9h4M15 14h6M15 19h8" stroke-width="1.2" opacity=".7"/>',
};
const picto = (id) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 32 32'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.6'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = PICTO[id] || '';
  return s;
};

// ------------------------------------------------------------------ Hilfen



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
const N = (label, obj, key, opts = {}) => numField(label, obj, key, { ...opts, onChange: () => { opts.onChange?.(); changed(opts.rebuild ? { inputs: true } : undefined); } });
const S = (label, obj, key, options, opts = {}) => selectField(label, obj, key, options, { ...opts, onChange: () => { opts.onChange?.(); changed({ inputs: opts.rebuild !== false }); } });
const C = (label, obj, key, opts = {}) => checkField(label, obj, key, { ...opts, onChange: () => { opts.onChange?.(); changed({ inputs: !!opts.rebuild }); } });

function seg(items, active, onSelect) {
  return h('div', { class: 'geo-seg' }, segmented(items, active, onSelect));
}

function contextBar(app, text, action) {
  const a = ANALYSES.find((x) => x.id === app.project.analysis);
  return h('div', { class: 'geo-context' }, picto(a.id), h('div', {}, h('b', {}, a.label), h('div', { class: 'small' }, text)), action || null);
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
  el.append(h('div', { class: 'geo-desc' }, ANALYSES.find((a) => a.id === p.analysis)?.desc + '.'));
  ({ erddruck: inEP, grundbruch: inBC, setzung: inST, boeschung: inSL, stuetzmauer: inRW })[p.analysis](el, app);
}

// ---------------------------------------------------------------- Erddruck
function inEP(el, app) {
  const e = app.project.ep;
  el.append(group('Wand und Gelände', [
    N('Wandhöhe H', e, 'H', { unit: 'm', min: 0.01, info: 'Höhe der Wand (lotrechte Projektion) vom Wandkopf bis zum Wandfuss. Die Bodenschichten beginnen am Wandkopf (Tiefe 0).' }),
    N('Wandneigung α', e, 'alpha', { unit: '°', min: -45, max: 45, info: 'Neigung der Wandrückseite gegen die Lotrechte. <b>Positiv</b>, wenn der Wandkopf vom Erdreich weg geneigt ist (der Boden liegt auf der Wand → grösserer Erddruck). 0 = lotrechte Wand.' }),
    N('Geländeneigung β', e, 'beta', { unit: '°', min: -45, max: 45, info: 'Neigung der Geländeoberfläche hinter der Wand, positiv ansteigend. Muss kleiner als φ\' sein, sonst ist das Gelände nicht standfest.' }),
  ], { info: 'Vorzeichen wie DIN 4085. Die Grafik zeigt die Geometrie sofort an.' }));
  const kinds = [{ value: 'active', label: 'aktiver Erddruck' }, { value: 'increased', label: 'erhöhter aktiver Erddruck' }, { value: 'atrest', label: 'Erdruhedruck' }, { value: 'passive', label: 'Erdwiderstand (passiv)' }];
  const items = [S('Erddruckart', e, 'kind', kinds, { info: '<b>Aktiv</b>: Wand kann ausweichen (Stützmauer). <b>Erhöht aktiv</b>: Zwischenwert für wenig nachgiebige Wände, z.B. Kellerwände (e = e_a + μ·(e_0 − e_a)). <b>Ruhedruck</b>: unverschiebliche Wand. <b>Erdwiderstand</b>: Boden wird gegen die Wand gedrückt.' })];
  if (e.kind !== 'passive') {
    items.push(S('Verfahren', e, 'method', [{ value: 'coulomb', label: 'Coulomb (δ aus Bodentabelle)' }, { value: 'rankine', label: 'Rankine (δ = β)' }], { rebuild: false, info: '<b>Coulomb</b> (ebene Gleitfläche, DIN 4085) mit Wandreibung δ = (δ/φ)·φ\' aus der Bodentabelle. <b>Rankine</b>: Erddruck parallel zur Geländeoberfläche (δ = β), lotrechte Wand.' }));
    if (e.kind !== 'atrest') items.push(C('Mindesterddruck (kohäsive Böden)', e, 'minPressure', { info: 'Bei kohäsiven Böden mindestens den Erddruck mit φ = 40° und c = 0 ansetzen (DIN 4085), damit die Kohäsion den Erddruck nicht unrealistisch verkleinert.' }));
    if (e.kind === 'increased') items.push(N('Erhöhungsfaktor μ', e, 'mu', { min: 0, max: 1, unit: '–', info: 'e = e_a + μ·(e_0 − e_a). μ = 0.5 entspricht dem Mittelwert aus aktivem Erddruck und Ruhedruck (häufig für Kellerwände).' }));
    if (e.kind !== 'active') items.push(N('Überkonsolidierung OCR', e, 'ocr', { min: 1, unit: '–', info: 'Überkonsolidierungsgrad für den Ruhedruck: K_0 = (1 − sin φ\')·√OCR (EN 1997-1, 9.5.2). 1 = normalkonsolidiert.' }));
  } else {
    items.push(S('Gleitfläche', e, 'passiveMethod', [{ value: 'curved', label: 'gekrümmt (empfohlen)' }, { value: 'coulomb', label: 'eben (Coulomb)' }], { rebuild: false, info: '<b>Gekrümmt</b>: Lösung nach Lancellotta (2002), nahe bei Caquot–Kérisel, auf der sicheren Seite. <b>Eben</b>: Coulomb – nur für kleine Wandreibung |δ_p| ≤ φ/3 zulässig, sonst überschätzt.' }));
    items.push(N('Wandreibung δ_p/φ', e, 'dpRatio', { min: 0, max: 1, unit: '–', info: 'Verhältnis Wandreibungswinkel zu Reibungswinkel beim Erdwiderstand (Betrag). Üblich: 0 … 2/3; bei ebener Gleitfläche höchstens 1/3.' }));
  }
  el.append(group('Erddruckansatz', items));
  const loadsGroup = [
    N('Flächenlast q', e, 'q', { unit: 'kN/m²', min: 0, info: 'Gleichmässig verteilte, veränderliche Auflast auf dem Gelände hinter der Wand (z.B. Verkehr 10 kN/m²). Erddruck daraus: e = K_aqh·q.' }),
    C('Wasserdruck auf die Wand', e, 'water', { info: 'Hydrostatischer Wasserdruck unterhalb des Grundwasserspiegels (Register «Baugrund») zusätzlich zum Erddruck mit γ\'.' }),
  ];
  if (e.kind !== 'passive') {
    if (!e.loads.length) loadsGroup.push(emptyState('Keine Streifen- oder Linienlasten', 'Mit «+ Zeile» z.B. ein Fundament oder eine Kranbahn neben der Wand erfassen.'));
    loadsGroup.push(dataTable([
      { key: 'type', label: 'Art', type: 'select', options: [{ value: 'strip', label: 'Streifen' }, { value: 'line', label: 'Linie' }], width: '82px', info: '<b>Streifen</b>: Flächenlast p [kN/m²] der Breite b. <b>Linie</b>: Linienlast P [kN/m] (b wird ignoriert).' },
      { key: 'p', label: 'p bzw. P', unit: 'kN/m² | kN/m', min: 0 },
      { key: 'a', label: 'a', unit: 'm', min: 0, info: 'Horizontaler Abstand vom Wandkopf bis zum Lastbeginn.' },
      { key: 'b', label: 'b', unit: 'm', min: 0, info: 'Breite der Streifenlast.' },
    ], e.loads, { onChange: (ev) => changed({ inputs: ev.type === 'add' || ev.type === 'remove' }), newRow: () => ({ type: 'strip', p: 20, a: 1, b: 1 }), hint: 'veränderliche Lasten (Q)' }));
  }
  el.append(group('Lasten', loadsGroup));
}

// ---------------------------------------------------------------- Grundbruch
const SHAPES = [{ id: 'strip', label: 'Streifen' }, { id: 'rect', label: 'Rechteck' }, { id: 'circle', label: 'Kreis' }];

function inBC(el, app) {
  const f = app.project.bc;
  const strip = f.shape === 'strip', circ = f.shape === 'circle';
  el.append(group('Fundament', [
    seg(SHAPES, f.shape, (id) => { f.shape = id; changed({ inputs: true }); }),
    N(circ ? 'Durchmesser' : 'Breite B', f, 'B', { unit: 'm', min: 0.01, info: strip ? 'Breite des Streifenfundaments. Lasten und Widerstände je Laufmeter.' : 'Kürzere Seite (x-Richtung). Lasten H_B und M_B wirken in dieser Richtung.' }),
    f.shape === 'rect' ? N('Länge L', f, 'L', { unit: 'm', min: 0.01, info: 'Längere Seite (y-Richtung).' }) : null,
    N('Einbindetiefe D', f, 'D', { unit: 'm', min: 0, info: 'Tiefe der Fundamentsohle unter der Geländeoberkante. Die Überlagerung q\' = σ\'_v(D) wirkt als seitliche Auflast.' }),
    N('Fundamentdicke t', f, 't', { unit: 'm', min: 0, info: 'Für Eigengewicht und für das Versetzungsmoment H·t der an der Fundamentoberkante angreifenden Horizontalkräfte.' }),
    N('Sohlneigung α', f, 'alphaBase', { unit: '°', min: 0, max: 45, info: 'Neigung der Sohle gegen die Horizontale (Beiwerte b nach EN 1997-1, Anh. D). Normalfall 0.' }),
    C('Eigengewicht Fundament und Auflast', f, 'selfWeight', { rebuild: true, info: 'Ergänzt V_G um das Fundament (γ_c·t) und den Boden über dem Fundament bis zur Geländeoberkante.' }),
    f.selfWeight ? N('Raumgewicht Beton γ_c', f, 'gammaC', { unit: 'kN/m³', min: 0 }) : null,
  ]));
  const cols = strip
    ? [{ key: 'V', label: 'V', unit: 'kN/m', info: 'Vertikalkraft (Druck positiv).' }, { key: 'HB', label: 'H', unit: 'kN/m', info: 'Horizontalkraft quer zum Streifen.' }, { key: 'MB', label: 'M', unit: 'kNm/m', info: 'Moment; positiv, wenn es die Resultierende in +x verschiebt.' }]
    : [{ key: 'V', label: 'V', unit: 'kN' }, { key: 'HB', label: 'H_B', unit: 'kN', info: 'Horizontalkraft in Richtung B (x).' }, { key: 'HL', label: 'H_L', unit: 'kN', info: 'Horizontalkraft in Richtung L (y).' }, { key: 'MB', label: 'M_B', unit: 'kNm', info: 'Moment, das die Resultierende in Richtung B verschiebt (e_B = M_B/V).' }, { key: 'ML', label: 'M_L', unit: 'kNm', info: 'Moment, das die Resultierende in Richtung L verschiebt.' }];
  el.append(group('Lasten an Fundamentoberkante (charakteristisch)', [
    dataTable(cols, [f.loads.G, f.loads.Q], { onChange: () => changed(), canAdd: false, canRemove: false, rowLabel: (i) => (i ? 'Q' : 'G'), hint: 'G: ständig · Q: veränderlich' }),
    note('Die Lasten werden automatisch mit γ_G bzw. γ_Q kombiniert (ständig ungünstig/günstig, mit/ohne veränderliche Last); massgebend ist die grösste Ausnutzung.'),
  ], { info: 'Charakteristische Werte an der Fundamentoberkante (Stützenfuss). Horizontalkräfte erzeugen in der Sohle zusätzlich das Moment H·t.' }));
  el.append(group('Bodenverhalten', [
    S('Nachweis', f, 'drainage', [{ value: 'drained', label: 'drainiert (c\', φ\')' }, { value: 'undrained', label: 'undrainiert (c_u)' }, { value: 'both', label: 'beide, massgebend' }], { rebuild: false, info: '<b>Drainiert</b>: Langzeitzustand mit effektiven Scherparametern. <b>Undrainiert</b>: Kurzzeitzustand in wassergesättigten feinkörnigen Böden mit c_u. «Beide» wählt den ungünstigeren Fall.' }),
    S('Sohlreibung', f, 'interface', [{ value: 'cast', label: 'Ortbeton (δ = φ\')' }, { value: 'precast', label: 'Fertigteil (δ = ⅔·φ\')' }], { rebuild: false, info: 'Sohlreibungswinkel für den Gleitnachweis nach EN 1997-1, 6.5.3 (10).' }),
  ]));
}

// ---------------------------------------------------------------- Setzung
function inST(el, app) {
  const s = app.project.st, bc = app.project.bc;
  const circ = s.shape === 'circle';
  el.append(group('Fundament', [
    seg(SHAPES, s.shape, (id) => { s.shape = id; changed({ inputs: true }); }),
    N(circ ? 'Durchmesser' : 'Breite B', s, 'B', { unit: 'm', min: 0.01 }),
    s.shape === 'rect' ? N('Länge L', s, 'L', { unit: 'm', min: 0.01 }) : null,
    N('Gründungstiefe D', s, 'D', { unit: 'm', min: 0, info: 'Tiefe der Fundamentsohle unter Gelände. Die Spannungsausbreitung beginnt in der Sohle.' }),
  ], { actions: [button('aus Grundbruch', { small: true, ghost: true, icon: 'copy', title: 'Form und Abmessungen aus der Analyse «Grundbruch» übernehmen', onClick: () => { Object.assign(s, { shape: bc.shape, B: bc.B, L: bc.L, D: bc.D }); changed({ inputs: true }); toast('Abmessungen aus «Grundbruch» übernommen', 'ok'); } })] }));
  el.append(group('Belastung (quasi-ständig)', [
    S('Eingabe als', s, 'loadMode', [{ value: 'p', label: 'Sohlspannung σ₀' }, { value: 'V', label: 'Vertikalkraft V' }]),
    s.loadMode === 'V'
      ? N(s.shape === 'strip' ? 'Vertikalkraft V (je m)' : 'Vertikalkraft V', s, 'V', { unit: s.shape === 'strip' ? 'kN/m' : 'kN', min: 0, info: 'Setzungswirksame (quasi-ständige) Last inkl. Fundamenteigengewicht.' })
      : N('Sohlspannung σ₀', s, 'p0', { unit: 'kN/m²', min: 0, info: 'Mittlere setzungswirksame Sohlspannung (quasi-ständig, charakteristisch) inkl. Fundamenteigengewicht.' }),
    C('Aushubentlastung abziehen', s, 'unload', { info: 'Setzungswirksam ist nur die Netto-Sohlspannung σ₀ − σ_v(D): Der Aushub entlastet den Baugrund zuvor.' }),
  ]));
  el.append(group('Berechnung', [
    N('Grenztiefe: Δσ = f · σ\'_v0, f =', s, 'limitFactor', { min: 0.01, max: 1, unit: '–', info: 'Die Setzung wird bis in die Tiefe integriert, in der die Zusatzspannung f·σ\'_v0 erreicht (DIN 4019: f = 0.2; bei weichen Böden f = 0.1).' }),
    C('Starres Fundament (kennzeichnender Punkt)', s, 'rigid', { info: 'Starre Fundamente setzen sich gleichmässig; die Setzung entspricht der eines schlaffen Fundaments im kennzeichnenden Punkt (0.37·B und 0.37·L ab Mitte bzw. 0.845·r beim Kreis).' }),
    N('Zulässige Setzung s_zul', s, 'sAllow', { unit: 'mm', min: 0, info: 'Für die Beurteilung der Gebrauchstauglichkeit (0 = ohne Nachweis). Richtwerte: Einzelfundamente 20–30 mm, Platten bis 50 mm, je nach Bauwerk.' }),
  ]));
  el.append(note('Spannungsausbreitung nach Boussinesq (Eckpunktformel nach Steinbrenner), Setzung mit dem Steifemodul M_E der Schichten (Register «Baugrund»).'));
}

// ---------------------------------------------------------------- Böschung
function inSL(el, app) {
  const s = app.project.sl;
  s._gen = s._gen || { H: 6, n: 2, a: 10, b: 14 };
  const g = s._gen;
  el.append(group('Geländelinie', [
    !s.surface.length ? emptyState('Noch keine Geländelinie', 'Unten mit «Erzeugen» eine Böschung generieren oder Punkte (x, y) eingeben.') : null,
    dataTable([{ key: 'x', label: 'x', unit: 'm' }, { key: 'y', label: 'y (Höhe)', unit: 'm' }], s.surface, { onChange: () => changed(), newRow: (rows) => ({ x: (rows[rows.length - 1]?.x ?? 0) + 5, y: rows[rows.length - 1]?.y ?? 0 }), minRows: 2, hint: 'Punkte von links nach rechts', maxHeight: '220px' }),
  ], { info: 'Geländeoberfläche als Polylinie (x nach rechts, y nach oben). Die Böschung darf nach rechts oder links abfallen. Die Linie muss seitlich so weit reichen, dass die Gleitkreise austreten können.' }));
  el.append(group('Böschung erzeugen', [
    h('div', { class: 'grid2' },
      numField('Höhe H', g, 'H', { unit: 'm', min: 0.1 }), numField('Neigung 1 :', g, 'n', { unit: '–', min: 0.05, info: 'Verhältnis horizontal zu vertikal, z.B. 2 für eine 2:1-Böschung (26.6°).' }),
      numField('Krone a', g, 'a', { unit: 'm', min: 0, info: 'Länge des horizontalen Geländes oberhalb der Böschung.' }), numField('Fuss b', g, 'b', { unit: 'm', min: 0, info: 'Länge des horizontalen Geländes unterhalb der Böschung.' })),
    h('div', { class: 'row end' }, button('Geländelinie erzeugen', { icon: 'play', small: true, primary: true, onClick: () => {
      const H = +g.H, n = +g.n, a = +g.a, b = +g.b;
      s.surface.splice(0, s.surface.length, { x: 0, y: H }, { x: a, y: H }, { x: a + n * H, y: 0 }, { x: a + n * H + b, y: 0 });
      s.q.x1 = Math.max(0, a * 0.2); s.q.x2 = Math.max(0, a * 0.8);
      changed({ inputs: true });
      toast(`Böschung ${fmt(n, 2)}:1 mit H = ${fmt(H, 2)} m erzeugt`, 'ok');
    } })),
  ], { collapsible: true, collapsed: s.surface.length >= 2, info: 'Einfache Böschung mit horizontaler Krone und horizontalem Fuss. Überschreibt die Geländelinie.' }));
  const water = [S('Wasserspiegel', s, 'waterMode', [{ value: 'none', label: 'kein Wasser' }, { value: 'gw', label: 'horizontal (GW aus «Baugrund»)' }, { value: 'line', label: 'Sickerlinie (Polylinie)' }], { info: 'Porenwasserdruck u = γ_w·(h_w − y) an der Lamellenbasis. Liegt der Wasserspiegel über dem Gelände, wirkt das Wasser als Auflast.' })];
  if (s.waterMode === 'line') water.push(dataTable([{ key: 'x', label: 'x', unit: 'm' }, { key: 'y', label: 'y (Wasserspiegel)', unit: 'm' }], s.water, { onChange: () => changed(), newRow: (rows) => ({ x: (rows[rows.length - 1]?.x ?? 0) + 5, y: rows[rows.length - 1]?.y ?? 0 }), minRows: 2, maxHeight: '180px' }));
  el.append(group('Wasser', water));
  el.append(group('Auflast (veränderlich)', [
    N('Flächenlast q', s.q, 'p', { unit: 'kN/m²', min: 0, info: 'Streifenlast auf der Geländeoberfläche, z.B. Verkehr oder Lager. In der Bemessung mit γ_Q und nur dort, wo sie ungünstig wirkt.' }),
    h('div', { class: 'grid2' }, N('von x₁', s.q, 'x1', { unit: 'm' }), N('bis x₂', s.q, 'x2', { unit: 'm' })),
  ]));
  el.append(group('Berechnung', [
    S('Bodenverhalten', s, 'drainage', [{ value: 'drained', label: 'drainiert (c\', φ\')' }, { value: 'undrained', label: 'undrainiert (c_u, wo > 0)' }], { rebuild: false }),
    N('Anzahl Lamellen', s, 'nSlices', { min: 8, max: 80, unit: '–', info: '20 – 40 Lamellen genügen in der Regel (Abweichung < 0.5 %).' }),
    N('Mindesttiefe Gleitkörper', s, 'tMin', { unit: 'm', min: 0, info: 'Oberflächennahe Kreise mit kleinerer Tiefe werden ignoriert (z.B. Oberflächenerosion).' }),
    N('Kreise bis unter Fuss', s, 'depthBelow', { unit: 'm', min: 0, info: 'Wie tief unter dem tiefsten Geländepunkt die Gleitkreise reichen dürfen (z.B. bis zu einer festen Schicht).' }),
  ]));
  const gr = s.grid;
  const gridItems = [C('Suchraster automatisch', gr, 'auto', { rebuild: true, info: 'Mittelpunkte über der Böschung und Radien bis zur Tiefengrenze werden aus der Geometrie bestimmt; danach wird um das Minimum verfeinert.' })];
  if (gr.auto === false) {
    gridItems.push(h('div', { class: 'grid2' },
      N('x₀', gr, 'x0', { unit: 'm' }), N('x₁', gr, 'x1', { unit: 'm' }),
      N('y₀', gr, 'y0', { unit: 'm' }), N('y₁', gr, 'y1', { unit: 'm' }),
      N('Punkte in x', gr, 'nx', { min: 2, max: 60, unit: '–' }), N('Punkte in y', gr, 'ny', { min: 2, max: 60, unit: '–' })),
    N('Radien je Mittelpunkt', gr, 'nr', { min: 2, max: 60, unit: '–', info: 'Die Radien werden über Tangentenhöhen zwischen Tiefengrenze und Gelände verteilt. Mehr Radien = genauer, aber langsamer.' }));
  } else {
    gridItems.push(h('div', { class: 'row end' }, button('Raster zum Bearbeiten übernehmen', { small: true, icon: 'grid', disabled: !(app.results?.sl), onClick: () => {
      const R = app.results?.sl;
      if (!R) return;
      const a = R.M.tx(R.grid.x0), b = R.M.tx(R.grid.x1);
      Object.assign(gr, { auto: false, x0: +Math.min(a, b).toFixed(2), x1: +Math.max(a, b).toFixed(2), y0: +R.grid.y0.toFixed(2), y1: +R.grid.y1.toFixed(2), nx: R.grid.nx, ny: R.grid.ny, nr: R.grid.nr });
      changed({ inputs: true });
    } })));
  }
  el.append(group('Suchraster', gridItems, { collapsible: true, collapsed: gr.auto !== false, info: 'Die Grafik «Suchraster F» zeigt den kleinsten Sicherheitsfaktor je Mittelpunkt. Liegt das Minimum am Rand des Rasters, Raster vergrössern.' }));
}

// ---------------------------------------------------------------- Stützmauer
function inRW(el, app) {
  const w = app.project.rw;
  el.append(group('Wand', [
    N('Wandhöhe h_s (ab OK Fundament)', w, 'hs', { unit: 'm', min: 0.1 }),
    N('Wanddicke oben', w, 'tTop', { unit: 'm', min: 0.05 }),
    N('Wanddicke unten', w, 'tBot', { unit: 'm', min: 0.05, info: 'Die Rückseite ist lotrecht; der Anzug liegt auf der Luftseite.' }),
  ]));
  el.append(group('Fundament', [
    N('Zehe (vorne)', w, 'toe', { unit: 'm', min: 0, info: 'Auskragung des Fundaments vor der Wand (Luftseite).' }),
    N('Ferse (hinten)', w, 'heel', { unit: 'm', min: 0, info: 'Länge des Fundaments hinter der Wand (Erdseite). Der Boden darüber wirkt stabilisierend.' }),
    N('Fundamentdicke d', w, 'd', { unit: 'm', min: 0.1 }),
    N('Einbindetiefe vorne D_f', w, 'Df', { unit: 'm', min: 0, info: 'Höhe des Geländes vor der Mauer über der Fundamentsohle. Bestimmt die Überlagerung beim Grundbruch.' }),
    C('Sporn unter der Sohle', w.key, 'on', { rebuild: true, info: 'Ein Sporn erhöht den Gleitwiderstand durch Erdwiderstand vor dem Sporn (nur auf Spornhöhe, abgemindert mit γ_R,e).' }),
    w.key.on ? h('div', { class: 'grid2' }, N('Sporntiefe', w.key, 'depth', { unit: 'm', min: 0 }), N('Spornbreite', w.key, 'width', { unit: 'm', min: 0 })) : null,
    w.key.on ? N('Lage ab Vorderkante', w.key, 'x', { unit: 'm', min: 0 }) : null,
  ]));
  el.append(group('Hinterfüllung und Lasten', [
    N('Geländeneigung β', w, 'beta', { unit: '°', min: -40, max: 40, info: 'Neigung der Hinterfüllung (positiv ansteigend).' }),
    N('Flächenlast q', w, 'q', { unit: 'kN/m²', min: 0, info: 'Veränderliche Auflast auf der Hinterfüllung. Wirkt auf die Ersatzwand (ungünstig) und auf die Ferse (günstig – wird in den Kombinationen auch weggelassen).' }),
    S('Erddruck auf Ersatzwand', w, 'method', [{ value: 'rankine', label: 'Rankine (δ = β)' }, { value: 'coulomb', label: 'Coulomb (δ aus Tabelle)' }], { rebuild: false, info: 'Erddruck auf die lotrechte Ersatzwand durch das Fersenende. Rankine: δ = β (üblich bei Boden-auf-Boden). Coulomb: δ = (δ/φ)·φ\'.' }),
    C('Wasserdruck (Grundwasser)', w, 'water', { info: 'Wasserdruck auf Ersatzwand und Luftseite sowie Sohlwasserdruck. Ohne Haken wird eine wirksame Drainage vorausgesetzt.' }),
    N('Raumgewicht Beton γ_c', w, 'gammaC', { unit: 'kN/m³', min: 0 }),
  ]));
  el.append(group('Fundation', [
    S('Nachweis', w, 'drainage', [{ value: 'drained', label: 'drainiert (c\', φ\')' }, { value: 'undrained', label: 'undrainiert (c_u)' }, { value: 'both', label: 'beide, massgebend' }], { rebuild: false }),
    S('Sohlreibung', w, 'interface', [{ value: 'cast', label: 'Ortbeton (δ = φ\')' }, { value: 'precast', label: 'Fertigteil (δ = ⅔·φ\')' }], { rebuild: false }),
  ]));
}

// ------------------------------------------------------------------ Register 2: Baugrund

function renderSoil(el, app) {
  const p = app.project, soil = p.soil;
  el.append(contextBar(app, `Tiefen ab ${DEPTH_REF[p.analysis]}`));
  const rows = soil.layers;
  const thick = (row) => {
    const zs = rows.map((r) => +r.z).filter((z) => z > +row.z).sort((a, b) => a - b);
    return zs.length ? fmt(zs[0] - row.z, 2) : '∞';
  };
  const nextCol = () => (rows.length % 8) + 1;
  const addPreset = (pr) => {
    const zLast = rows.length ? Math.max(...rows.map((r) => +r.z)) : -2;
    rows.push({ name: pr.name, z: rows.length ? zLast + 2 : 0, gamma: pr.gamma, gammaP: pr.gammaP, phi: pr.phi, c: pr.c, cu: pr.cu, ME: pr.ME, dr: 2 / 3, col: nextCol() });
    changed({ inputs: true });
  };
  const presets = dropdown('Vorlage', SOIL_PRESETS.map((pr) => ({ label: pr.name, desc: `${pr.desc} · φ'=${pr.phi}°, c'=${pr.c}, M_E=${pr.ME}`, onClick: () => addPreset(pr) })), { icon: 'layers', title: 'Schicht mit typischen Kennwerten hinzufügen (Richtwerte, projektspezifisch prüfen)' });
  let t2 = null;
  // Nach einer Zellenänderung nur die abhängigen Anzeigen nachführen (Fokus bleibt erhalten)
  const syncAfterEdit = () => {
    t2?.refresh();
    t1.querySelectorAll('tbody tr').forEach((tr, i) => { const td = tr.children[3]; if (td && rows[i]) td.textContent = thick(rows[i]); });
  };
  const t1 = dataTable([
      { key: 'name', label: 'Bezeichnung', type: 'text', width: '30%' },
      { key: 'z', label: 'OK', unit: 'm', min: -50, info: 'Oberkante der Schicht als Tiefe ab der Bezugsebene. Die oberste Schicht beginnt bei 0 m; jede Schicht reicht bis zur nächsten.' },
      { key: '_d', label: 'Dicke', unit: 'm', type: 'calc', calc: (row) => thick(row) },
      { key: 'gamma', label: 'γ', unit: 'kN/m³', min: 1, info: 'Raumgewicht des feuchten Bodens über dem Grundwasser.' },
      { key: 'gammaP', label: "γ'", unit: 'kN/m³', min: 0, info: 'Raumgewicht unter Auftrieb (γ_sat − γ_w), massgebend unter dem Grundwasserspiegel.' },
      { key: 'col', label: 'Stil', type: 'select', options: [1, 2, 3, 4, 5, 6, 7, 8].map((k) => ({ value: k, label: String(k) })), width: '46px', info: 'Darstellung der Schicht (Deckkraft und Schraffur) zur Unterscheidung in der Grafik.' },
    ], rows, {
      onChange: (ev) => { if (ev.type === 'edit') { changed(); syncAfterEdit(); } else changed({ inputs: true }); },
      newRow: (rs) => ({ name: `Schicht ${rs.length + 1}`, z: rs.length ? Math.max(...rs.map((r) => +r.z)) + 2 : 0, gamma: 20, gammaP: 10, phi: 30, c: 0, cu: 0, ME: 20, dr: 2 / 3, col: (rs.length % 8) + 1 }),
      minRows: 1, extraButtons: [presets], hint: 'Zeile anklicken markiert die Schicht in der Grafik',
      onSelect: (i) => app.editor?.select([`L:${i}`]),
    });
  el.append(group('Schichtaufbau', [
    t1,
  ], { info: 'Bodenschichten von oben nach unten. Die Werte sind <b>charakteristische Werte</b> (vorsichtige Schätzung des Mittelwerts, SIA 267 bzw. EN 1997-1, 2.4.5.2).' }));
  t2 = dataTable([
      { key: 'phi', label: "φ'_k", unit: '°', min: 0, max: 50, info: 'Effektiver Reibungswinkel (charakteristisch).' },
      { key: 'c', label: "c'_k", unit: 'kN/m²', min: 0, info: 'Effektive Kohäsion (charakteristisch). Für nichtbindige Böden 0.' },
      { key: 'cu', label: 'c_u,k', unit: 'kN/m²', min: 0, info: 'Undrainierte Scherfestigkeit für den Kurzzeitzustand bindiger Böden. 0 = nicht massgebend.' },
      { key: 'ME', label: 'M_E', unit: 'MN/m²', min: 0.1, info: 'Steifemodul (Oedometermodul) im massgebenden Spannungsbereich, für die Setzungsberechnung.' },
      { key: 'dr', label: 'δ/φ', unit: '–', min: 0, max: 1, digits: 2, info: 'Wandreibung als Anteil von φ\' für den Erddruck nach Coulomb: rauhe Betonwand 2/3, glatte Wand 0 – 1/3.' },
    ], rows, { onChange: () => changed(), canAdd: false, canRemove: false, rowLabel: (i, row) => row.name || i + 1, hint: 'Charakteristische Werte' });
  el.append(group('Scherfestigkeit und Steifigkeit', [t2], { info: 'Effektive Scherparameter für den drainierten Zustand, undrainierte Scherfestigkeit für den Kurzzeitzustand und Steifemodul für Setzungen.' }));
  el.append(group('Grundwasser', [
    C('Grundwasser vorhanden', soil.gw, 'on', { rebuild: true }),
    soil.gw.on ? N('Tiefe Grundwasserspiegel z_w', soil.gw, 'z', { unit: 'm', info: 'Tiefe des Grundwasserspiegels ab der Bezugsebene. Darunter gilt γ\' und der Porenwasserdruck u = γ_w·(z − z_w).' }) : null,
    soil.gw.on ? N('Wichte Wasser γ_w', soil, 'gammaW', { unit: 'kN/m³', min: 9, max: 11 }) : null,
  ]));
}

// ------------------------------------------------------------------ Register 3: Nachweis

function renderNorm(el, app) {
  const p = app.project, n = p.norm, a = p.analysis;
  el.append(contextBar(app, a === 'setzung' ? 'Setzungen: Gebrauchstauglichkeit mit charakteristischen Werten' : 'Partialfaktoren für die Tragsicherheitsnachweise'));
  el.append(group('Norm', [
    selectField('Nachweiskonzept', n, 'code', [{ value: 'SIA', label: 'SIA 267 / SIA 260' }, { value: 'EC', label: 'EN 1997-1, Verfahren 2' }], { onChange: (code) => { Object.assign(n, normPreset(code)); changed({ inputs: true }); toast('Partialfaktoren auf die Voreinstellung gesetzt', 'ok'); }, info: 'Setzt alle Partialfaktoren auf die Voreinstellung. Alle Werte bleiben editierbar. <b>Die Voreinstellungen sind mit der gültigen Normausgabe und den Projektvorgaben abzugleichen.</b>' }),
  ], { actions: [button('Zurücksetzen', { small: true, ghost: true, icon: 'undo', title: 'Faktoren auf Voreinstellung zurücksetzen', onClick: () => { Object.assign(n, normPreset(n.code)); changed({ inputs: true }); } })] }));
  const use = {
    soilM: a === 'boeschung' || ((a === 'grundbruch' || a === 'stuetzmauer') && n.geoMode === 'M'),
    geo: a === 'grundbruch' || a === 'stuetzmauer',
    act: a === 'grundbruch' || a === 'stuetzmauer' || a === 'erddruck',
    slope: a === 'boeschung',
    passive: a === 'erddruck' || a === 'stuetzmauer',
  };
  const grp = (title, items, used, info) => group(used ? title : `${title} – hier nicht verwendet`, items, { info, collapsible: !used, collapsed: !used, class: used ? '' : 'geo-muted-group' });
  el.append(grp('Bodenkennwerte γ_M', [
    N('γ_φ (auf tan φ\')', n, 'gPhi', { min: 1, unit: '–' }), N('γ_c (auf c\')', n, 'gC', { min: 1, unit: '–' }),
    N('γ_cu (auf c_u)', n, 'gCu', { min: 1, unit: '–' }), N('γ_γ (auf γ)', n, 'gGamma', { min: 1, unit: '–' }),
  ], use.soilM, 'Bemessungswerte der Bodenkennwerte: tan φ\'_d = tan φ\'_k/γ_φ, c\'_d = c\'_k/γ_c, c_u,d = c_u,k/γ_cu (SIA 267, Tab. 1: 1.2 / 1.5 / 1.5; EN 1997-1 M2: 1.25 / 1.25 / 1.4). Verwendet für die Böschung und – je nach Einstellung – für Grundbruch und Gleiten.'));
  el.append(grp('Grundbruch und Gleiten', [
    selectField('Vorgehen', n, 'geoMode', [{ value: 'R', label: 'Widerstandsbeiwerte γ_R (charakt. Boden)' }, { value: 'M', label: 'Bemessungswerte Boden γ_M' }], { onChange: (m) => { if (m === 'M') { n.gRv = 1; n.gRh = 1; toast('γ_R,v und γ_R,h auf 1.0 gesetzt (Sicherheit über γ_M)', 'info'); } else { const pr = normPreset(n.code); n.gRv = pr.gRv; n.gRh = pr.gRh; } changed({ inputs: true }); }, info: '<b>γ_R</b>: R_d = R(X_k)/γ_R mit charakteristischen Bodenkennwerten (wie EN 1997-1, Verfahren 2). <b>γ_M</b>: R_d = R(X_d) mit abgeminderten Bodenkennwerten (dann γ_R in der Regel 1.0).' }),
    N('γ_R,v Grundbruch', n, 'gRv', { min: 1, unit: '–', info: 'Widerstandsbeiwert für den Grundbruchwiderstand (Voreinstellung 1.4).' }),
    N('γ_R,h Gleiten', n, 'gRh', { min: 1, unit: '–', info: 'Widerstandsbeiwert für den Gleitwiderstand (Voreinstellung 1.1).' }),
  ], use.geo));
  el.append(grp('Einwirkungen', [
    N('γ_G ständig, ungünstig', n, 'gG', { min: 1, unit: '–', info: 'SIA 260 (Typ 2) bzw. EN 1990: 1.35.' }),
    N('γ_G,inf ständig, günstig', n, 'gGinf', { min: 0, max: 1, unit: '–', info: 'SIA 260: 0.8; EN 1990 (STR/GEO): 1.0. Wird für den Gleitwiderstand und für günstige Kombinationen verwendet.' }),
    N('γ_Q veränderlich', n, 'gQ', { min: 0, unit: '–', info: 'Veränderliche Einwirkungen: 1.5.' }),
  ], use.act, 'Charakteristische Lasten werden mit diesen Faktoren zu Bemessungswerten kombiniert.'));
  el.append(grp('Erdwiderstand', [
    N('γ_R,e Erdwiderstand', n, 'gRe', { min: 1, unit: '–', info: 'Abminderung des Erdwiderstands: E_p,d = E_p,k/γ_R,e (Voreinstellung 1.4). Bei der Stützmauer für den Erdwiderstand vor dem Sporn.' }),
  ], use.passive));
  el.append(grp('Böschung (Gesamtstabilität)', [
    N('γ_Q veränderlich (Böschung)', n, 'gQslope', { min: 0, unit: '–', info: 'Faktor auf veränderliche Lasten im Böschungsnachweis (SIA 260 Typ 3 bzw. EN 1997-1 A2: 1.3). Ständige Lasten (Eigengewicht) mit 1.0.' }),
    N('γ_R erforderlich F_d ≥', n, 'gRs', { min: 0.5, unit: '–', info: 'Mit Bemessungswerten der Scherparameter muss der Sicherheitsfaktor F_d mindestens γ_R erreichen (normalerweise 1.0).' }),
  ], use.slope));
  if (a === 'setzung') el.append(note('Die Setzungsberechnung verwendet charakteristische Bodenkennwerte und quasi-ständige Lasten (Gebrauchstauglichkeit); Partialfaktoren werden nicht angewendet.'));
}

// ------------------------------------------------------------------ Hilfe

const INTRO = `<h4>So funktioniert's</h4><ol>
<li><b>Analyse wählen</b> – im Register «Analyse»: Erddruck, Grundbruch, Setzung, Böschung oder Stützmauer.</li>
<li><b>In der Grafik zeichnen</b>: mit den Werkzeugen über der Grafik Wand, Fundament, Gelände oder Mauer anklicken; Griffe und Schichtgrenzen ziehen.</li>
<li><b>Schicht anklicken</b>, um Bodenart und Kennwerte im Eigenschaftsfenster zu setzen; «Schicht» (L) teilt eine Schicht in der angeklickten Tiefe.</li>
<li>Rechts sehen Sie, ob alle Nachweise <b>erfüllt</b> sind – «Herleitung» zeigt den Rechenweg, «Bericht» das Dokument.</li></ol>`;

const HELP = `
<h3>Überblick</h3>
<p>Das Modul behandelt klassische Grundbauaufgaben mit gemeinsamen Bodenschichten. Alle Eingaben sind charakteristische Werte; Bemessungswerte entstehen mit den Partialfaktoren im Register «Nachweis» (Voreinstellung SIA 267/SIA 260, alternativ EN 1997-1 Verfahren 2). Die Schichttiefen beziehen sich je Analyse auf die Geländeoberkante (Wandkopf, Fundamentniveau, Böschungskrone bzw. Mauerkrone).</p>
<h3>Erddruck</h3>
<ul><li>Aktiv nach Coulomb/Müller-Breslau (DIN 4085) mit Wandneigung α, Geländeneigung β und Wandreibung δ, oder Rankine (δ = β). Beiwerte für die Horizontalkomponente: e_ah = K_agh·σ'_v + K_aqh·q − K_ach·c' ≥ 0.</li>
<li>Ruhedruck K_0 = (1 − sin φ')·√OCR·(1 + sin β) (EN 1997-1, 9.5.2); erhöhter aktiver Erddruck e = e_a + μ·(e_0 − e_a).</li>
<li>Erdwiderstand mit gekrümmter Gleitfläche nach Lancellotta (2002) oder eben (Coulomb, nur für δ_p ≤ φ/3).</li>
<li>Streifen- und Linienlasten über das Coulomb-Krafteck mit der Gleitfuge ϑ_a (vereinfachte Verteilung), Wasserdruck hydrostatisch.</li>
<li>Konvention: α > 0, wenn der Wandkopf vom Erdreich weg geneigt ist. Beispiel φ = 30°, δ = 20°: K_a = 0.297 (geneigte Resultierende), K_agh = 0.279.</li></ul>
<h3>Grundbruch</h3>
<ul><li>Tragwiderstand nach EN 1997-1 Anhang D (Grundbruchformel wie SIA 267) mit wirksamer Fläche nach Meyerhof B' = B − 2e, Form-, Neigungs- und Sohlneigungsbeiwerten; drainiert und/oder undrainiert.</li>
<li>Bodenkennwerte bis 2B' unter der Sohle dickengewichtet gemittelt; Grundwasser über γ' und q'.</li>
<li>Kombinationen ständig ungünstig/günstig × veränderlich mit/ohne; Gleiten mit γ_G,inf·V_G·tan δ; Ausmittigkeit: ständig im Kern (e ≤ B/6), Bemessung e ≤ B/3.</li></ul>
<h3>Setzung</h3>
<ul><li>Spannungsausbreitung nach Boussinesq: Eckpunktformel (Steinbrenner) mit Überlagerung für Mitte, kennzeichnenden Punkt und Ecke; exakte Lösungen für Streifen und Kreis.</li>
<li>s = Σ Δσ·Δz/M_E bis zur Grenztiefe Δσ = f·σ'_v0 (f = 0.2). Starre Fundamente: kennzeichnender Punkt.</li></ul>
<h3>Böschung</h3>
<ul><li>Kreisförmige Gleitflächen, Lamellenverfahren nach Bishop (vereinfacht), Fellenius zum Vergleich.</li>
<li>Automatische Suche: Raster von Mittelpunkten × Radien, danach lokale Mustersuche. Die Farbkarte zeigt den kleinsten Faktor je Mittelpunkt.</li>
<li>Bemessung: Scherparameter mit γ_M abgemindert, veränderliche Lasten mit γ_Q (nur ungünstig); Anforderung F_d ≥ γ_R. Validiert am ACADS-Beispiel 1(a) (F ≈ 0.99).</li></ul>
<h3>Stützmauer</h3>
<ul><li>Winkelstützmauer je Laufmeter: Erddruck auf die lotrechte Ersatzwand durch das Fersenende, Bodenkörper über der Ferse als Teil des Stützkörpers.</li>
<li>Nachweise Gleiten (optional mit Sporn), Ausmittigkeit (Kippen) und Grundbruch (wie Analyse «Grundbruch», Streifen B' = B − 2e).</li>
<li>Schnittkräfte für die Bemessung: Wand an der Einspannung (M, V über die Höhe), Zehe und Ferse an den Wandanschnitten.</li></ul>
<h3>Grenzen</h3>
<p>Keine nicht-kreisförmigen Gleitflächen, keine Erdbebenlasten, keine Konsolidationszeit, keine Tiefenbeiwerte. Die Gesamtstabilität von Stützbauwerken ist separat zu prüfen. Die voreingestellten Partialfaktoren sind mit der gültigen Normausgabe abzugleichen. Ergebnisse ohne Gewähr.</p>
<h3>Arbeiten in der Grafik</h3>
<ul><li><b>Werkzeuge</b> über der Grafik (je Analyse): «Wand» (N), «Fundament» (F), «Gelände» (G), «Mauer» (N) erzeugen die Geometrie mit zwei Klicks bzw. einer Punktfolge (Doppelklick beendet). «Streifenlast», «Linienlast», «Auflast» (Q/K) setzen Lasten, «Wasserspiegel» (W) den Grundwasserspiegel bzw. eine Sickerlinie, «Suchraster» (U) den Bereich der Kreismittelpunkte.</li>
<li><b>Bodenschichten</b>: eine Schicht anklicken öffnet das Eigenschaftsfenster (Bodenart aus Vorlage, γ, γ', φ', c', c_u, M_E, δ/φ). «Schicht» (L) teilt die angeklickte Schicht in dieser Tiefe; Schichtgrenzen und Grundwasserspiegel lassen sich senkrecht ziehen.</li>
<li><b>Griffe</b> (Punkte) ziehen ändert Masse: Wandkopf (H, α), Fundamentecke (B, D), Geländepunkte, bei der Stützmauer Krone, Zehe, Ferse, Sohle, Wanddicken und Sporn. Fang an Punkten und Raster, X/Y binden an eine Achse, Ziffern tippen Koordinaten.</li>
<li>Die Register links bleiben als gleichwertige Eingabe erhalten und sind mit der Grafik synchron. «Löschen» (Entf) entfernt Lasten, Schichten und Punkte.</li></ul>
<h3>Herleitung</h3>
<p>Im Ergebnisbereich zeigt «Herleitung» den vollständigen Rechenweg jeder Analyse mit allgemeiner Formel, eingesetzten Werten, Ergebnis und Normbezug; «Herleitung ›» in der Nachweistabelle springt direkt zum zugehörigen Abschnitt. Die Herleitung wird auch an den Bericht angehängt.</p>
<h3>Bedienung</h3>
<p>Ein neues Projekt ist leer (eine Bodenschicht); Beispiele finden Sie unter «Beispiele». Zahlenfelder akzeptieren Ausdrücke (z.B. <code>6/2</code>, <code>2,5</code>). Tabellen können aus Excel eingefügt werden. Mausrad zoomt, rechte Maustaste verschiebt, Doppelklick passt die Grafik ein.</p>`;

// ------------------------------------------------------------------ App

injectStyle();

const def = {
  id: 'geotechnik',
  title: 'Geotechnik',
  subtitle: 'Erddruck, Grundbruch, Setzung, Böschung, Stützmauer',
  version: 1,
  defaultProject,
  examples: EXAMPLES,
  migrate: (p) => deepDefaults(p, baseProject()),
  intro: INTRO,
  inputTabs: [
    { id: 'analysis', label: 'Analyse', render: renderAnalysis },
    { id: 'soil', label: 'Baugrund', render: renderSoil },
    { id: 'norm', label: 'Nachweis', render: renderNorm },
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
void icon;
