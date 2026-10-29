// Stütze – Eingaben: Register links und Bausteine für das Eigenschaftsfenster der Grafik
//
// Gestaltung: Register → Karten (eine Ebene), selten Gebrauchtes in eingeklappten Karten mit dem
// aktuellen Wert im Titel, Lastfälle als Liste, Feldpaare nebeneinander (.grid2), Formelzeichen mit
// Unterstrich (werden tiefgestellt), Erklärungen als «?»-Tooltips.
import { h, group, numField, selectField, checkField, textField, segmented, kvTable, note, listEditor, badge, rich, subHtml, fmt } from '../../js/core/ui.js';
import { NORMS, CONCRETE_CLASSES, REBAR_GRADES, BAR_DIAMETERS } from '../../js/core/materials.js';
import {
  newLoadCase, SUPPORT_PRESETS, inclination, effectiveCreep, suggestN, supportState, setSupportState, LOAD_KEYS,
} from './calc.js';
import { sectionGeometry, materials, columnLawKind } from './section.js';
import { supportIcon, signSketch, lcIndex } from './views.js';

// ------------------------------------------------------------------ Modul-Stile (nur CSS-Variablen)

const CSS = `
.stz-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.stz-tile { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: 6px 4px 5px;
  cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 1px; font: inherit; font-size: 11px;
  color: var(--text-2); line-height: 1.25; text-align: center; transition: border-color .12s, background .12s; }
.stz-tile:hover { border-color: var(--accent); color: var(--text); }
.stz-tile.active { border-color: var(--accent); background: var(--accent-soft); color: var(--text); font-weight: 600; box-shadow: var(--shadow-sm); }
.stz-tile .beta { font-family: var(--mono); color: var(--text-3); font-size: 10.5px; font-weight: 400; }
.ed-panel .stz-tiles { gap: 4px; }
.ed-panel .stz-tile { padding: 4px 2px; font-size: 10.5px; }
.ed-panel .stz-tile svg { width: 34px; height: 43px; }
.stz-sign { display: flex; justify-content: center; }
.stz-sign svg { max-width: 100%; height: auto; }
.stz-verdict { margin-top: 6px; font-size: 12.5px; line-height: 1.45; }
.stz-verdict .muted { display: block; margin-top: 2px; }
.stz-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0 0 10px; }
.stz-bar .lbl { color: var(--text-2); font-size: 11.5px; }
.stz-h { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--text-2); margin: 14px 0 6px; }
.stz-lc tr.gov td { font-weight: 600; }
.stz-lc tr { cursor: pointer; }
.stz-lc tr:hover td { background: var(--surface-2); }
.stz-lc tr.sel td { background: var(--accent-soft); }
.stz-legend { font-size: 11px; color: var(--text-2); margin: -6px 0 12px; line-height: 1.5; }
`;
if (typeof document !== 'undefined' && document.head && !document.getElementById('stz-css')) {
  document.head.append(h('style', { id: 'stz-css' }, CSS));
}

/** HTML mit Formelzeichen: Unterstriche ausserhalb von Tags werden tiefgestellt (f_cd → f<sub>cd</sub>). */
export const htmlSub = (s) => String(s ?? '').split(/(<[^>]+>)/).map((x, i) => (i % 2 ? x : subHtml(x))).join('');

/** Kurze Formel-/Ergebniszeile (gemeinsame Klasse .formula). */
export const formulaLine = (html) => h('div', { class: 'formula', html: htmlSub(html) });

/** Titel einer Karte nachführen (ohne die Eingaben neu aufzubauen). */
function setTitle(card, text) {
  const n = card?.querySelector('.group-name');
  if (n) n.replaceChildren(rich(text));
}

// ------------------------------------------------------------------ Erklärungen

export const INFO = {
  norm: 'Massgebend für Baustoffkennwerte, Imperfektion, Grenzschlankheit und das vereinfachte Verfahren: <b>SIA 262</b> (Schweiz) oder <b>EN 1992-1-1</b> (Eurocode 2).',
  L: 'Systemlänge zwischen Fuss und Kopf (Abstand der Auflagerpunkte). In der Grafik lässt sich der Stützenkopf auch ziehen.',
  support: 'Lagerung der Stützenenden. Die gestrichelte Linie zeigt die Knickfigur, β ist der Knicklängenbeiwert (l_0 = β·L). <b>Verschieblich</b> heisst: der Kopf kann seitlich ausweichen (z.B. Kragstütze, unausgesteifter Rahmen).',
  supportZ: 'Getrennte Lagerung für die Biegung um z, z.B. bei Hallenstützen: in Querrichtung Kragstütze, im Längsverband gehalten.',
  spring: 'Drehfedersteifigkeit c = M/φ des Anschlusses, z.B. aus Fundament oder anschliessenden Riegeln und Decken. 0 = gelenkig. Ein Moment am Federende verteilt sich nach den Steifigkeiten auf Feder und Stütze.',
  sway: 'Angekreuzt: der Kopf kann seitlich ausweichen (verschiebliches System, Schiefstellung als Imperfektion). Sonst ist der Kopf horizontal gehalten.',
  beta: '<b>Aus Lagerung</b>: l_0 folgt aus der Knickberechnung des Stabmodells (bei Drehfedern mit der Nennsteifigkeit EI_nom). <b>Vorgeben</b>: β wirkt auf Schlankheit, Imperfektion und vereinfachtes Verfahren – das allgemeine Verfahren rechnet stets mit der gewählten Lagerung.',
  b: 'Abmessung in y-Richtung (waagrecht im Querschnittsbild), massgebend für die Biegung um z.',
  h: 'Abmessung in z-Richtung (senkrecht im Querschnittsbild), massgebend für die Biegung um y.',
  D: 'Aussendurchmesser der Rundstütze.',
  nb: 'Stäbe entlang der oberen und unteren Seite (parallel zu b), Eckstäbe mitgezählt.',
  nh: 'Stäbe entlang der linken und rechten Seite (parallel zu h), Eckstäbe mitgezählt.',
  n: 'Gleichmässig auf dem Umfang verteilt. Eine gerade Anzahl ergibt einen doppelt symmetrischen Querschnitt (Voraussetzung der Berechnung).',
  dia: 'Durchmesser der Längsstäbe (alle Stäbe gleich).',
  coverMode: '<b>Überdeckung + Bügel</b>: Achsabstand a = c_nom + Ø_w + Ø/2. <b>Achsabstand</b>: Abstand der Stabachse vom Rand direkt eingeben.',
  cover: 'Nominelle Betonüberdeckung bis zur Aussenkante der Bügel.',
  stirrup: 'Durchmesser der Bügel bzw. der Querbewehrung.',
  axis: 'Abstand vom Betonrand bis zur Achse der Längsstäbe.',
  concrete: 'Betonsorte. Rechenwerte: f_cd für die Bemessung, E_cm und E_cd = E_cm/γ_cE mit γ_cE = 1.2 für die Verformungen.',
  steel: 'Betonstahlsorte (f_sk = 500 bzw. 450 MPa). Gerechnet wird bilinear mit f_sd und der Bruchdehnung ε_ud.',
  biaxial: 'Zusätzlich Lasten um die z-Achse erfassen. Beide Richtungen werden nichtlinear berechnet und am Querschnitt mit der M_y–M_z-Interaktion kombiniert (Imperfektion jeweils nur in der ungünstigeren Richtung).',
  loads: 'Bemessungswerte der Einwirkungen je Lastfall. Normalkraft als <b>Druck positiv</b>. Momente positiv, wenn die Druckseite rechts (+z bzw. +y) liegt, also M = N·e mit einer Exzentrizität e nach rechts. Gleiches Vorzeichen oben und unten bedeutet einfache Krümmung (ungünstig). Zeile anklicken: bearbeiten und in der Grafik zeigen.',
  N: 'Bemessungswert der Normalkraft, Druck positiv, über die Höhe konstant (Eigengewicht der Stütze gegebenenfalls einrechnen).',
  Mt: 'Biegemoment 1. Ordnung am Stützenkopf, positiv bei Druckseite rechts (M = N·e). Bei eingespanntem Kopf geht es direkt ins Auflager.',
  Mb: 'Biegemoment 1. Ordnung am Stützenfuss, positiv bei Druckseite rechts. Bei eingespanntem Fuss geht es direkt ins Fundament.',
  H: 'Horizontalkraft am Stützenkopf, positiv nach rechts. Nur bei verschieblichem Kopf wirksam (sonst nimmt das Auflager sie auf).',
  q: 'Gleichmässig verteilte Querlast über die ganze Höhe, positiv nach rechts (z.B. Wind auf die Stütze).',
  imp: 'Ungewollte Schiefstellung θ_i. Nach Norm: SIA 262 4.3.7.2 α_i = 0.01/√L mit 1/300 ≤ α_i ≤ 1/100, bzw. EN 1992-1-1 5.2 θ_i = α_h/200 mit α_h = 2/√L (2/3 ≤ α_h ≤ 1). Unverschieblich: Vorkrümmung e_i = θ_i·l_0/2 in Form der Knickfigur; verschieblich: Schiefstellung θ_i. Die Richtung wird automatisch ungünstig gewählt.',
  phi: 'Endkriechzahl φ(∞,t_0) des Betons, abhängig von Belastungsalter, wirksamer Dicke und Feuchte (SIA 262 bzw. EN 1992-1-1 Bild 3.1). Üblich sind Werte von 1.5 bis 3.',
  ratio: 'Anteil der quasi-ständigen Last am Bemessungsmoment M_0Eqp/M_0Ed (0 bis 1): bei Wind als Leiteinwirkung klein (≈ 0.2–0.4), bei vorwiegend ständiger Last gross (≈ 0.6–0.8).',
  creep: 'Kriechen vergrössert die Verformungen unter Dauerlast und damit die Momente 2. Ordnung. Wirksame Kriechzahl φ_ef = φ(∞,t_0)·M_0Eqp/M_0Ed (SIA 262 4.3.7.3, EN 1992-1-1 5.8.4); die Betondehnungen werden mit 1 + φ_ef gestreckt.',
  law: 'Spannungs-Dehnungs-Linie des Betons für die Verformungsberechnung. Standard SIA: linear-elastisch – ideal-plastisch mit E_cd = E_cm/1.2 und f_cd (SIA 262 4.3.7); Standard EC: nichtlinear nach 3.1.5 mit f_cd und E_cd (EN 1992-1-1 5.8.6). M_Rd wird immer mit dem Parabel-Rechteck-Diagramm ermittelt.',
  nEl: 'Anzahl Stabelemente des Rechenmodells. 40 Elemente genügen in aller Regel; mehr Elemente erhöhen die Rechenzeit.',
};
for (const k of Object.keys(INFO)) INFO[k] = htmlSub(INFO[k]);

// ------------------------------------------------------------------ Bausteine: Lagerung

/** Kacheln der Standardlagerungen (Biegeachse über key 'support' bzw. 'supportZ'). */
export function supportTiles(p, key, onChange) {
  const wrap = h('div', { class: 'stz-tiles', role: 'radiogroup' });
  for (const [k, pr] of Object.entries(SUPPORT_PRESETS)) {
    const active = p[key] === k;
    wrap.append(h('button', {
      type: 'button', class: ['stz-tile', active && 'active'], title: pr.label, role: 'radio', 'aria-checked': active ? 'true' : 'false',
      onclick: () => { p[key] = k; onChange(); },
    }, supportIcon(k), h('span', {}, pr.short), h('span', { class: 'beta' }, pr.beta ? `β = ${pr.beta === 0.699 ? '0.7' : fmt(pr.beta, pr.beta % 1 ? 1 : 0)}` : 'β berechnet')));
  }
  return wrap;
}

const BOT_OPTS = [{ value: 'fixed', label: 'eingespannt' }, { value: 'pinned', label: 'gelenkig' }, { value: 'spring', label: 'Drehfeder' }];
const TOP_OPTS = [{ value: 'pinned', label: 'frei drehbar' }, { value: 'fixed', label: 'eingespannt' }, { value: 'spring', label: 'Drehfeder' }];

/** Benutzerdefinierte Lagerung (Register). */
function customFields(c, chI, ch) {
  return [
    h('div', { class: 'grid2' },
      selectField('Fuss', c, 'bot', BOT_OPTS, { onChange: chI }),
      selectField('Kopf', c, 'top', TOP_OPTS, { onChange: chI })),
    c.bot === 'spring' || c.top === 'spring' ? h('div', { class: 'grid2' },
      c.bot === 'spring' ? numField('c_Fuss', c, 'kBot', { unit: 'MNm/rad', min: 0, max: 1e6, onChange: ch, info: INFO.spring }) : h('div'),
      c.top === 'spring' ? numField('c_Kopf', c, 'kTop', { unit: 'MNm/rad', min: 0, max: 1e6, onChange: ch, info: INFO.spring }) : null) : null,
    checkField('Kopf verschieblich', c, 'sway', { onChange: chI, info: INFO.sway }),
  ];
}

/** Lagerung eines einzelnen Stützenendes (Eigenschaftsfenster). */
export function supportEndFields(p, ax, end, onChange) {
  const st = supportState(p, ax);
  const set = (patch) => { setSupportState(p, ax, { ...supportState(p, ax), ...patch }); onChange(); };
  const kKey = end === 'top' ? 'kTop' : 'kBot';
  const o = { v: st[end], k: st[kKey], sway: st.sway };
  return [
    selectField(end === 'top' ? 'Verdrehung' : 'Lagerung', o, 'v', end === 'top' ? TOP_OPTS : BOT_OPTS, { wide: true, onChange: (v) => set({ [end]: v }), info: INFO.support }),
    st[end] === 'spring' ? numField('Drehfeder c', o, 'k', { unit: 'MNm/rad', min: 0, max: 1e6, onChange: (v) => set({ [kKey]: v }), info: INFO.spring }) : null,
    end === 'top' ? checkField('Kopf verschieblich', o, 'sway', { onChange: (v) => set({ sway: v }), info: INFO.sway }) : null,
  ];
}

/** Knicklängenbeiwert je Achse (Benutzerwert, Standardfall oder aus den Ergebnissen). */
export function betaOf(p, ax, results) {
  if (p.betaMode === 'user') return ax === 'y' ? p.betaY : p.betaZ;
  const preset = ax === 'z' && p.supportZ !== 'same' ? p.supportZ : p.support;
  return SUPPORT_PRESETS[preset]?.beta || results?.lcs?.[0]?.[ax.toUpperCase()]?.beta || null;
}

// ------------------------------------------------------------------ Bausteine: Querschnitt und Baustoffe

/** Form und Abmessungen. chS: Änderung mit neuem Aufbau der Felder, ch: Wertänderung. */
export function sectionShapeFields(sp, ch, chS) {
  return [
    segmented([{ id: 'rect', label: 'Rechteck' }, { id: 'circle', label: 'Kreis' }], sp.shape, (id) => { sp.shape = id; chS(); }),
    sp.shape === 'circle'
      ? numField('Durchmesser D', sp, 'D', { unit: 'mm', min: 100, max: 5000, onChange: ch, info: INFO.D })
      : h('div', { class: 'grid2' },
        numField('Breite b', sp, 'b', { unit: 'mm', min: 100, max: 5000, onChange: ch, info: INFO.b }),
        numField('Höhe h', sp, 'h', { unit: 'mm', min: 100, max: 5000, onChange: ch, info: INFO.h })),
  ];
}

export function barFields(sp, ch) {
  const dias = [...new Set([...BAR_DIAMETERS, sp.dia])].sort((a, b) => a - b).map((d) => ({ value: d, label: `Ø ${d} mm` }));
  return sp.shape === 'circle'
    ? [h('div', { class: 'grid2' },
      selectField('Stab-Ø', sp, 'dia', dias, { onChange: ch, info: INFO.dia }),
      numField('Anzahl Stäbe', sp, 'n', { unit: 'Stk.', min: 4, max: 60, digits: 0, onChange: ch, info: INFO.n }))]
    : [selectField('Stab-Ø', sp, 'dia', dias, { onChange: ch, info: INFO.dia }),
      h('div', { class: 'grid2' },
        numField('Stäbe oben/unten', sp, 'nb', { unit: 'Stk.', min: 2, max: 20, digits: 0, onChange: ch, info: INFO.nb }),
        numField('Stäbe links/rechts', sp, 'nh', { unit: 'Stk.', min: 2, max: 20, digits: 0, onChange: ch, info: INFO.nh }))];
}

export function coverFields(sp, ch, chS) {
  return [
    selectField('Angabe', sp, 'coverMode', [{ value: 'nominal', label: 'Überdeckung' }, { value: 'axis', label: 'Achsabstand' }], { onChange: chS, info: INFO.coverMode }),
    sp.coverMode === 'axis'
      ? numField('Achsabstand a', sp, 'axis', { unit: 'mm', min: 10, max: 300, onChange: ch, info: INFO.axis })
      : h('div', { class: 'grid2' },
        numField('Überdeckung c_nom', sp, 'cover', { unit: 'mm', min: 0, max: 200, onChange: ch, info: INFO.cover }),
        numField('Bügel Ø_w', sp, 'stirrup', { unit: 'mm', min: 0, max: 30, onChange: ch, info: INFO.stirrup })),
  ];
}

export function materialFields(p, ch) {
  return [h('div', { class: 'grid2' },
    selectField('Beton', p, 'concrete', CONCRETE_CLASSES, { onChange: ch, info: INFO.concrete }),
    selectField('Betonstahl', p, 'steel', REBAR_GRADES, { onChange: ch, info: INFO.steel }))];
}

/** Kennwerte des Querschnitts (oder Fehlermeldung bei ungültiger Eingabe). */
export function sectionSummary(p, compact = false) {
  const sp = p.section;
  try {
    const g = sectionGeometry(sp);
    const m = materials(p.norm, p.concrete, p.steel);
    const rows = compact ? [
      ['A_s', `${g.n} Ø${sp.dia} = ${fmt(g.As * 1e6, 0)}`, 'mm²'],
      ['ρ = A_s/A_c', g.As / g.Ac * 100, '%', 2],
      ['Achsabstand a', g.a * 1000, 'mm', 0],
    ] : [
      ['A_c', g.Ac * 1e4, 'cm²', 0],
      ['A_s', `${g.n} Ø${sp.dia} = ${fmt(g.As * 1e6, 0)}`, 'mm²'],
      ['ρ = A_s/A_c', g.As / g.Ac * 100, '%', 2],
      ['Achsabstand a', g.a * 1000, 'mm', 0],
      ['f_cd / f_sd', `${fmt(m.fcd, 1)} / ${fmt(m.fsd, 0)}`, 'MPa'],
      ['E_cm / E_cd', `${fmt(m.c.Ecm / 1000, 1)} / ${fmt(m.Ecd / 1000, 1)}`, 'GPa'],
    ];
    return [kvTable(rows), g.symmetric ? null : note('Ungerade Stabanzahl: bitte eine gerade Anzahl wählen, damit der Querschnitt doppelt symmetrisch ist.', 'warn')];
  } catch (e) {
    return [note(e.message, 'fail')];
  }
}

// ------------------------------------------------------------------ Bausteine: Imperfektion, Kriechen, Rechenmodell

export const impTitle = (p) => {
  const th = inclination(p.norm, p.L, p.imperfection);
  return th > 0 ? `Imperfektion · θ_i = 1/${fmt(1 / th, 0)}` : 'Imperfektion · keine';
};
export const creepTitle = (p) => `Kriechen · φ_ef = ${fmt(effectiveCreep(p.creep), 2)}`;

export function imperfectionFields(p, ch, chS, results = null) {
  const imp = p.imperfection;
  const th = inclination(p.norm, p.L, imp);
  const r0 = results?.lcs?.[0];
  const ei = (A) => (A.sway ? `${fmt(A.impAmp * 1000, 1)} mm (Kopf)` : `${fmt(A.ei * 1000, 1)} mm`);
  const eLine = r0 ? (results.geo.shape === 'rect' || p.biaxial ? ` · e_i,y = ${ei(r0.Y)} · e_i,z = ${ei(r0.Z)}` : ` · e_i = ${ei(r0.Y)}`) : '';
  return [
    selectField('Ansatz', imp, 'mode', [{ value: 'norm', label: `nach Norm (${p.norm === 'EC' ? 'EN 1992-1-1 5.2' : 'SIA 262 4.3.7.2'})` }, { value: 'user', label: 'Schiefstellung vorgeben' }, { value: 'none', label: 'keine (nur Vergleich)' }], { wide: true, onChange: chS, info: INFO.imp }),
    imp.mode === 'user' ? numField('θ_i = 1 / …', imp, 'denom', { min: 20, max: 5000, digits: 0, onChange: chS }) : null,
    th > 0
      ? formulaLine(`θ_i = 1/${fmt(1 / th, 0)} = ${fmt(th * 1000, 2)} ‰${eLine}`)
      : note('Ohne Imperfektion – nur für Vergleichsrechnungen.', 'warn'),
  ];
}

/** Kriechzahl und Anteil quasi-ständig; card: Karte, deren Titel nachgeführt wird. */
export function creepFields(p, ch, card = null) {
  const line = formulaLine('');
  const upd = () => {
    const pe = effectiveCreep(p.creep);
    line.innerHTML = htmlSub(`φ_ef = ${fmt(p.creep.phi, 2)} · ${fmt(p.creep.ratio, 2)} = ${fmt(pe, 2)} → Dehnungen × ${fmt(1 + pe, 2)}`);
    if (card) setTitle(card(), creepTitle(p));
  };
  upd();
  const onChange = () => { upd(); ch(); };
  return [
    h('div', { class: 'grid2' },
      numField('φ(∞,t_0)', p.creep, 'phi', { min: 0, max: 6, onChange, info: INFO.phi }),
      numField('M_0Eqp/M_0Ed', p.creep, 'ratio', { min: 0, max: 1, onChange, info: INFO.ratio })),
    line,
  ];
}

const LAW_SHORT = { linplast: 'linear-plastisch', parabola: 'Parabel-Rechteck', sargin: 'nichtlinear EC' };

function modelFields(p, ch) {
  const def = columnLawKind(p.norm, 'auto');
  return [
    selectField('Betongesetz', p, 'lawMode', [
      { value: 'auto', label: `Norm-Standard (${def === 'sargin' ? 'nichtlinear EC' : 'linear-plastisch'})` },
      { value: 'linplast', label: 'linear-elastisch – plastisch' },
      { value: 'parabola', label: 'Parabel-Rechteck' },
      { value: 'sargin', label: 'nichtlinear (EN 1992 3.1.5)' },
    ], { wide: true, onChange: ch, info: INFO.law }),
    numField('Stabelemente', p, 'nEl', { unit: 'Stk.', min: 10, max: 120, digits: 0, onChange: ch, info: INFO.nEl }),
  ];
}

// ------------------------------------------------------------------ Bausteine: Lasten

/** Aktiver Lastfall (Ansichtsoption «Lastfall»), ggf. null. */
export function activeLoadCase(app) {
  return app.project.loadCases[lcIndex(app)] || null;
}

/** Legt bei Bedarf einen ersten Lastfall mit vorgeschlagener Normalkraft an und liefert den aktiven Lastfall. */
export function ensureLoadCase(app) {
  const p = app.project;
  if (!p.loadCases.length) {
    p.loadCases.push(newLoadCase(1, suggestN(p)));
    app.viewOpts.lc = 0;
  }
  return activeLoadCase(app);
}

/** Bezeichnungen der Lastfelder je Biegeachse. */
const LOAD_LABELS = {
  y: { Mt: 'M_y,oben', Mb: 'M_y,unten', H: 'H_z (Kopf)', q: 'q_z' },
  z: { Mt: 'M_z,oben', Mb: 'M_z,unten', H: 'H_y (Kopf)', q: 'q_y' },
};

/** Lastfelder eines Stützenendes bzw. der Stütze (Eigenschaftsfenster). where: 'top' | 'bot' | 'span'. */
export function loadFields(lc, ax, where, ch) {
  const k = LOAD_KEYS[ax], l = LOAD_LABELS[ax];
  if (where === 'top') {
    return [
      numField('N_d (Druck +)', lc, 'N', { unit: 'kN', onChange: ch, info: INFO.N }),
      numField(l.H, lc, k.H, { unit: 'kN', onChange: ch, info: INFO.H }),
      numField(l.Mt, lc, k.Mt, { unit: 'kNm', onChange: ch, info: INFO.Mt }),
    ];
  }
  if (where === 'bot') return [numField(l.Mb, lc, k.Mb, { unit: 'kNm', onChange: ch, info: INFO.Mb })];
  return [numField(l.q, lc, k.q, { unit: 'kN/m', onChange: ch, info: INFO.q })];
}

/** Kurzinfo eines Lastfalls für die Liste. */
export function lcSummary(lc, p) {
  const v = (x) => +x || 0;
  const parts = [`N_d = ${fmt(v(lc.N), 0)} kN`];
  const axes = p.biaxial ? ['y', 'z'] : ['y'];
  for (const ax of axes) {
    const k = LOAD_KEYS[ax], d = ax === 'y' ? 'z' : 'y';
    if (v(lc[k.Mt]) || v(lc[k.Mb])) parts.push(`M_${ax} = ${fmt(v(lc[k.Mt]), 0)}/${fmt(v(lc[k.Mb]), 0)}`);
    if (v(lc[k.H])) parts.push(`H_${d} = ${fmt(v(lc[k.H]), 1)}`);
    if (v(lc[k.q])) parts.push(`q_${d} = ${fmt(v(lc[k.q]), 1)}`);
  }
  return parts.join(' · ');
}

function lcDetail(d, lc, i, app) {
  const p = app.project;
  const upd = () => {
    const row = d.previousElementSibling;
    row?.querySelector('.lst-name')?.replaceChildren(rich(lc.name || `LF ${i + 1}`));
    row?.querySelector('.lst-sub')?.replaceChildren(rich(lcSummary(lc, p)));
  };
  const ch = () => { upd(); app.changed(); };
  const pair = (ax) => {
    const k = LOAD_KEYS[ax], l = LOAD_LABELS[ax];
    return [
      h('div', { class: 'grid2' },
        numField(l.Mt, lc, k.Mt, { unit: 'kNm', onChange: ch, info: INFO.Mt }),
        numField(l.Mb, lc, k.Mb, { unit: 'kNm', onChange: ch, info: INFO.Mb })),
      h('div', { class: 'grid2' },
        numField(l.H, lc, k.H, { unit: 'kN', onChange: ch, info: INFO.H }),
        numField(l.q, lc, k.q, { unit: 'kN/m', onChange: ch, info: INFO.q })),
    ];
  };
  d.append(
    h('div', { class: 'grid2' },
      textField('Name', lc, 'name', { onChange: ch }),
      numField('N_d (Druck +)', lc, 'N', { unit: 'kN', onChange: ch, info: INFO.N })),
    ...pair('y'),
    ...(p.biaxial ? pair('z') : []),
  );
}

/** Hinweis auf Lasten, die wegen der Lagerung nicht in die Stütze gehen. */
function ignoredHints(p) {
  const out = [];
  for (const ax of p.biaxial ? ['y', 'z'] : ['y']) {
    const st = supportState(p, ax);
    const k = LOAD_KEYS[ax];
    const any = (key) => p.loadCases.some((l) => +l[key]);
    if (st.top === 'fixed' && any(k.Mt)) out.push(`M_${ax},oben geht direkt ins eingespannte Kopfauflager.`);
    if (st.bot === 'fixed' && any(k.Mb)) out.push(`M_${ax},unten geht direkt ins eingespannte Fundament.`);
    if (!st.sway && any(k.H)) out.push(`H_${ax === 'y' ? 'z' : 'y'} wird vom gehaltenen Kopf aufgenommen.`);
  }
  return out.length ? note(rich(out.join(' ')), 'warn') : null;
}

// ------------------------------------------------------------------ Register: System

export function tabSystem(el, app) {
  const p = app.project;
  const ch = () => app.changed();
  const chI = () => app.changed({ inputs: true });
  el.append(group('Stütze', [
    selectField('Norm', p, 'norm', NORMS, { onChange: chI, info: INFO.norm }),
    numField('Länge L', p, 'L', { unit: 'm', min: 0.2, max: 80, onChange: chI, info: INFO.L }),
  ], { id: 'stuetze' }));
  const sep = p.supportZ !== 'same';
  const zFlag = { v: sep };
  el.append(group(sep ? 'Lagerung um y' : 'Lagerung', [
    supportTiles(p, 'support', chI),
    p.support === 'custom' ? customFields(p.custom, chI, ch) : null,
    checkField('Je Richtung verschieden', zFlag, 'v', {
      onChange: (v) => { p.supportZ = v ? p.support : 'same'; if (v) p.customZ = { ...p.custom }; chI(); }, info: INFO.supportZ,
    }),
  ], { id: 'lagerung', info: INFO.support }));
  if (sep) {
    el.append(group('Lagerung um z', [
      supportTiles(p, 'supportZ', chI),
      p.supportZ === 'custom' ? customFields(p.customZ, chI, ch) : null,
    ], { id: 'lagerung-z', info: INFO.supportZ }));
  }
  // Knicklänge (eingeklappt, Ergebnis im Titel)
  const by = betaOf(p, 'y', app.results), bz = betaOf(p, 'z', app.results);
  const l0 = (b) => (b ? `${fmt(b * p.L, 2)} m` : '…');
  const title = sep || p.betaMode === 'user' ? `Knicklänge · l_0 = ${l0(by)} / ${l0(bz)}` : `Knicklänge · l_0 = ${l0(by)}`;
  el.append(group(title, [
    selectField('Ermittlung', p, 'betaMode', [{ value: 'auto', label: 'aus Lagerung' }, { value: 'user', label: 'Beiwert β vorgeben' }], { wide: true, onChange: chI, info: INFO.beta }),
    p.betaMode === 'user' ? h('div', { class: 'grid2' },
      numField('β_y', p, 'betaY', { min: 0.2, max: 10, onChange: chI }),
      numField('β_z', p, 'betaZ', { min: 0.2, max: 10, onChange: chI })) : null,
    kvTable([
      ['Biegung um y', by ? `β = ${fmt(by, 2)} · l_0 = ${fmt(by * p.L, 2)}` : 'β wird berechnet', by ? 'm' : ''],
      ['Biegung um z', bz ? `β = ${fmt(bz, 2)} · l_0 = ${fmt(bz * p.L, 2)}` : 'β wird berechnet', bz ? 'm' : ''],
    ]),
  ], { id: 'knicklaenge', collapsed: true, info: INFO.beta }));
  el.append(group(`Rechenmodell · ${LAW_SHORT[columnLawKind(p.norm, p.lawMode)]}`, modelFields(p, chI), { id: 'rechenmodell', collapsed: true, info: INFO.law }));
}

// ------------------------------------------------------------------ Register: Querschnitt

export function tabSection(el, app) {
  const p = app.project;
  const sp = p.section;
  const summary = h('div');
  const upd = () => summary.replaceChildren(...sectionSummary(p).filter(Boolean));
  const ch = () => { upd(); app.changed(); };
  const chI = () => app.changed({ inputs: true });
  el.append(group('Form', sectionShapeFields(sp, ch, chI), { id: 'form' }));
  el.append(group('Längsbewehrung', [...barFields(sp, ch), ...coverFields(sp, ch, chI)], { id: 'bewehrung' }));
  el.append(group('Baustoffe', materialFields(p, ch), { id: 'baustoffe' }));
  upd();
  el.append(group('Kennwerte', [summary], { id: 'kennwerte' }));
}

// ------------------------------------------------------------------ Register: Lasten

export function tabLoads(el, app) {
  const p = app.project;
  const ch = () => app.changed();
  const chI = () => app.changed({ inputs: true });
  const list = listEditor(p.loadCases, {
    active: app.stzOpenLc ?? null,
    onActive: (i) => {
      app.stzOpenLc = i;
      if (i !== null && i !== lcIndex(app)) { app.viewOpts.lc = i; app.renderView(); app.renderResults(); }
    },
    label: (lc, i) => lc.name || `LF ${i + 1}`,
    sub: (lc) => lcSummary(lc, p),
    swatch: (lc, i) => (i === lcIndex(app) ? 'var(--c-load)' : 'var(--border-strong)'),
    badge: (lc, i) => {
      const r = app.results?.lcs?.[i];
      return r && !app.stale && Number.isFinite(r.eta) ? badge(`η ${fmt(r.eta, 2)}`, r.eta <= 1.0001 ? 'ok' : 'fail') : null;
    },
    duplicate: (lc) => ({ ...lc, name: `${lc.name || 'LF'} (Kopie)` }),
    onChange: () => chI(),
    detail: (d, lc, i) => lcDetail(d, lc, i, app),
    add: [{ label: 'Lastfall', create: () => newLoadCase(p.loadCases.length + 1, +p.loadCases[p.loadCases.length - 1]?.N || suggestN(p)) }],
    empty: 'Noch kein Lastfall – mit «Lastfall» anlegen oder in der Grafik das Werkzeug «Last» (F) auf den Stützenkopf.',
  });
  // Ergebnis-Plaketten und Markierung des gewählten Lastfalls nach der Berechnung nachführen
  app.stzRefreshLcList = () => { if (list.isConnected && !list.contains(document.activeElement)) list.refresh(); };
  el.append(group(`Lastfälle (${p.loadCases.length})`, [
    checkField('Lasten auch um z', p, 'biaxial', { onChange: chI, info: INFO.biaxial }),
    list,
    ignoredHints(p),
  ], { id: 'lastfaelle', info: INFO.loads }));
  let impCard = null, creepCard = null;
  impCard = group(impTitle(p), imperfectionFields(p, ch, chI, app.results), { id: 'imperfektion', collapsed: true, info: INFO.imp });
  creepCard = group(creepTitle(p), creepFields(p, ch, () => creepCard), { id: 'kriechen', collapsed: true, info: INFO.creep });
  el.append(impCard, creepCard);
  el.append(group('Vorzeichen', [h('div', { class: 'stz-sign' }, signSketch())], { id: 'vorzeichen', collapsed: true, info: INFO.loads }));
}
