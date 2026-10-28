// Stütze – Eingabefelder: Register links und Eigenschaftsfenster der Grafik verwenden dieselben Bausteine
import { h, group, numField, selectField, checkField, dataTable, segmented, kvTable, note, emptyState, fmt } from '../../js/core/ui.js';
import { NORMS, CONCRETE_CLASSES, REBAR_GRADES, BAR_DIAMETERS } from '../../js/core/materials.js';
import {
  newLoadCase, SUPPORT_PRESETS, inclination, effectiveCreep, suggestN, supportState, setSupportState, LOAD_KEYS,
} from './calc.js';
import { sectionGeometry, materials, columnLawKind } from './section.js';
import { supportIcon, signSketch, lcIndex } from './views.js';

// ------------------------------------------------------------------ Modul-Stile (nur CSS-Variablen)

const CSS = `
.stz-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin: 2px 0 8px; }
.stz-tile { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: 6px 4px 5px;
  cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 1px; font: inherit; font-size: 11px;
  color: var(--text-2); line-height: 1.25; text-align: center; transition: border-color .12s, background .12s; }
.stz-tile:hover { border-color: var(--accent); color: var(--text); }
.stz-tile.active { border-color: var(--accent); background: var(--accent-soft); color: var(--text); font-weight: 600; box-shadow: var(--shadow-sm); }
.stz-tile .beta { font-family: var(--mono); color: var(--text-3); font-size: 10.5px; font-weight: 400; }
.ed-panel .stz-tiles { gap: 4px; margin: 0; }
.ed-panel .stz-tile { padding: 4px 2px; font-size: 10.5px; }
.ed-panel .stz-tile svg { width: 34px; height: 43px; }
.stz-sub { font-size: 11.5px; font-weight: 600; color: var(--text-2); margin: 8px 0 4px; }
.stz-calc { font-family: var(--mono); font-size: 11.5px; color: var(--text-2); background: var(--surface-2); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 5px 8px; margin: 4px 0 6px; line-height: 1.5; }
.stz-calc b { color: var(--text); font-weight: 600; }
.ed-panel .stz-calc { margin: 0; font-size: 11px; }
.stz-sign { display: flex; justify-content: center; padding: 4px 0; }
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
.stz-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
`;
if (typeof document !== 'undefined' && document.head && !document.getElementById('stz-css')) {
  document.head.append(h('style', { id: 'stz-css' }, CSS));
}

// ------------------------------------------------------------------ Erklärungen

export const INFO = {
  norm: 'Massgebend für Baustoffkennwerte, Imperfektion, Grenzschlankheit und das vereinfachte Verfahren: <b>SIA 262</b> (Schweiz) oder <b>EN 1992-1-1</b> (Eurocode 2).',
  L: 'Systemlänge der Stütze zwischen Fuss und Kopf (Abstand der Auflagerpunkte). In der Grafik lässt sich der Stützenkopf auch mit der Maus ziehen.',
  support: 'Lagerung der Stützenenden. Die gestrichelte Linie zeigt die Knickfigur, β ist der Knicklängenbeiwert (Knicklänge l₀ = β·L). <b>Verschieblich</b> heisst: der Stützenkopf kann seitlich ausweichen (z.B. Kragstütze, unausgesteifter Rahmen).',
  supportZ: 'Bei Hallenstützen ist die Lagerung oft je Richtung verschieden, z.B. Kragstütze in Querrichtung und im Längsverband gehalten in Längsrichtung.',
  spring: 'Drehfedersteifigkeit c = M/φ des Anschlusses, z.B. aus Fundament (Bodensteifigkeit) oder anschliessenden Riegeln/Decken. 0 = gelenkig. Ein am Federende eingegebenes Moment verteilt sich nach den Steifigkeiten auf Feder und Stütze.',
  sway: 'Angekreuzt: der Kopf kann seitlich ausweichen (verschiebliches System, Schiefstellung als Imperfektion). Sonst ist der Kopf horizontal gehalten.',
  beta: '<b>Aus Lagerung</b>: l₀ folgt aus der Knickberechnung des Stabmodells (bei Drehfedern mit der Nennsteifigkeit EI). <b>Vorgeben</b>: β wirkt auf Schlankheit, Imperfektion und vereinfachtes Verfahren – das allgemeine Verfahren rechnet stets mit der gewählten Lagerung.',
  b: 'Querschnittsabmessung in y-Richtung (horizontal im Querschnittsbild). Massgebend für die Biegung um die z-Achse.',
  h: 'Querschnittsabmessung in z-Richtung (vertikal im Querschnittsbild). Massgebend für die Biegung um die y-Achse.',
  D: 'Aussendurchmesser der Rundstütze.',
  nb: 'Stäbe entlang der oberen und unteren Seite (parallel zu b), Eckstäbe mitgezählt.',
  nh: 'Stäbe entlang der linken und rechten Seite (parallel zu h), Eckstäbe mitgezählt.',
  n: 'Stäbe gleichmässig auf dem Umfang verteilt. Eine gerade Anzahl ergibt einen doppelt symmetrischen Querschnitt (Voraussetzung der Berechnung).',
  dia: 'Durchmesser der Längsstäbe.',
  coverMode: '<b>Überdeckung + Bügel</b>: Achsabstand a = c_nom + Ø_Bügel + Ø/2. <b>Achsabstand</b>: Abstand der Stabachse vom Rand direkt eingeben.',
  cover: 'Nominelle Betonüberdeckung bis zur Aussenkante der Bügel.',
  stirrup: 'Durchmesser der Bügel bzw. der Querbewehrung.',
  axis: 'Abstand vom Betonrand bis zur Achse der Längsstäbe.',
  concrete: 'Betonsorte. Rechenwerte: fcd (Bemessung), Ecm und Ecd = Ecm/γcE mit γcE = 1.2 für die Verformungsberechnung.',
  steel: 'Betonstahlsorte (fsk = 500 bzw. 450 MPa). Gerechnet wird bilinear mit fsd und der Bruchdehnung εud.',
  biaxial: 'Zusätzlich Lasten um die z-Achse erfassen. Beide Richtungen werden nichtlinear berechnet und am Querschnitt mit der My-Mz-Interaktion kombiniert (Imperfektion jeweils nur in der ungünstigeren Richtung).',
  loads: 'Bemessungswerte der Einwirkungen (mit Lastbeiwerten) je Lastfall. Normalkraft als <b>Druck positiv</b>. Momente positiv, wenn die Druckseite rechts (+z bzw. +y) liegt – also M = N·e mit einer Exzentrizität e nach rechts. Gleiches Vorzeichen oben und unten bedeutet einfache Krümmung (ungünstig).',
  N: 'Bemessungswert der Normalkraft, Druck positiv. Wird über die Höhe konstant angenommen – Eigengewicht der Stütze gegebenenfalls einrechnen.',
  Mt: 'Biegemoment 1. Ordnung am Stützenkopf. Positiv bei Druckseite rechts (M = N·e). Bei eingespanntem Kopf geht es direkt ins Auflager.',
  Mb: 'Biegemoment 1. Ordnung am Stützenfuss. Positiv bei Druckseite rechts. Bei eingespanntem Fuss geht es direkt ins Fundament.',
  H: 'Horizontalkraft am Stützenkopf, positiv nach rechts. Nur bei verschieblichem Kopf wirksam (sonst nimmt das Auflager sie auf).',
  q: 'Gleichmässig verteilte Querlast über die ganze Höhe, positiv nach rechts (z.B. Wind auf die Stütze).',
  imp: 'Ungewollte Schiefstellung θi. Nach Norm: SIA 262 4.3.7.2 αi = 0.01/√L mit 1/300 ≤ αi ≤ 1/100, bzw. EN 1992-1-1 5.2 θi = αh/200 mit αh = 2/√L (2/3 ≤ αh ≤ 1). Unverschieblich: Vorkrümmung ei = θi·l₀/2 in Form der Knickfigur; verschieblich: Schiefstellung θi. Die Richtung wird automatisch ungünstig gewählt.',
  phi: 'Endkriechzahl φ(∞,t₀) des Betons, z.B. nach SIA 262 (Kriechzahl in Abhängigkeit von Belastungsalter, wirksamer Dicke und Feuchte) bzw. EN 1992-1-1 Bild 3.1. Üblich sind Werte von 1.5 bis 3.',
  ratio: 'Anteil der quasi-ständigen Last am Bemessungsmoment M₀Eqp/M₀Ed (0 bis 1). Bei Wind als Leiteinwirkung klein (≈ 0.2 bis 0.4), bei vorwiegend ständiger Last gross (≈ 0.6 bis 0.8).',
  law: 'Spannungs-Dehnungs-Linie des Betons für die Verformungsberechnung. Standard SIA: linear-elastisch ideal-plastisch mit Ecd = Ecm/1.2 und fcd (SIA 262 4.3.7); Standard EC: nichtlinear nach 3.1.5 mit fcd und Ecd (EN 1992-1-1 5.8.6). Der Querschnittswiderstand M_Rd wird immer mit dem Parabel-Rechteck-Diagramm ermittelt.',
  nEl: 'Anzahl Stabelemente des Rechenmodells. 40 Elemente genügen in aller Regel; mehr Elemente erhöhen die Rechenzeit.',
};

const ensure = (app) => app.project;

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

function customFields(c, chI, ch) {
  return [
    selectField('Fuss', c, 'bot', [{ value: 'fixed', label: 'eingespannt' }, { value: 'pinned', label: 'gelenkig' }, { value: 'spring', label: 'Drehfeder' }], { onChange: chI }),
    c.bot === 'spring' ? numField('Drehfeder Fuss', c, 'kBot', { unit: 'MNm/rad', min: 0, max: 1e6, onChange: ch, info: INFO.spring }) : null,
    selectField('Kopf (Verdrehung)', c, 'top', [{ value: 'pinned', label: 'frei drehbar' }, { value: 'fixed', label: 'eingespannt' }, { value: 'spring', label: 'Drehfeder' }], { onChange: chI }),
    c.top === 'spring' ? numField('Drehfeder Kopf', c, 'kTop', { unit: 'MNm/rad', min: 0, max: 1e6, onChange: ch, info: INFO.spring }) : null,
    checkField('Kopf horizontal verschieblich', c, 'sway', { onChange: chI, info: INFO.sway }),
  ];
}

/** Lagerung eines einzelnen Stützenendes (Kopf: Verdrehung und Verschieblichkeit, Fuss: Verdrehung). */
export function supportEndFields(p, ax, end, onChange) {
  const st = supportState(p, ax);
  const set = (patch) => { setSupportState(p, ax, { ...supportState(p, ax), ...patch }); onChange(); };
  const opts = end === 'top'
    ? [{ value: 'pinned', label: 'frei drehbar' }, { value: 'fixed', label: 'eingespannt' }, { value: 'spring', label: 'Drehfeder' }]
    : [{ value: 'fixed', label: 'eingespannt' }, { value: 'pinned', label: 'gelenkig' }, { value: 'spring', label: 'Drehfeder' }];
  const kKey = end === 'top' ? 'kTop' : 'kBot';
  const o = { v: st[end], k: st[kKey], sway: st.sway };
  return [
    selectField(end === 'top' ? 'Verdrehung' : 'Lagerung', o, 'v', opts, { wide: true, onChange: (v) => set({ [end]: v }), info: INFO.support }),
    st[end] === 'spring' ? numField('Drehfeder c', o, 'k', { unit: 'MNm/rad', min: 0, max: 1e6, onChange: (v) => set({ [kKey]: v }), info: INFO.spring }) : null,
    end === 'top' ? checkField('horizontal verschieblich', o, 'sway', { onChange: (v) => set({ sway: v }), info: INFO.sway }) : null,
  ];
}

// ------------------------------------------------------------------ Bausteine: Querschnitt und Baustoffe

/** Form und Abmessungen. chS: Änderung mit neuem Aufbau der Felder, ch: Wertänderung. */
export function sectionShapeFields(sp, ch, chS) {
  return [
    segmented([{ id: 'rect', label: 'Rechteck' }, { id: 'circle', label: 'Kreis' }], sp.shape, (id) => { sp.shape = id; chS(); }),
    sp.shape === 'circle'
      ? numField('Durchmesser D', sp, 'D', { unit: 'mm', min: 100, max: 5000, onChange: ch, info: INFO.D })
      : [numField('Breite b', sp, 'b', { unit: 'mm', min: 100, max: 5000, onChange: ch, info: INFO.b }), numField('Höhe h', sp, 'h', { unit: 'mm', min: 100, max: 5000, onChange: ch, info: INFO.h })],
  ];
}

export function barFields(sp, ch) {
  return [
    selectField('Stabdurchmesser Ø', sp, 'dia', [...new Set([...BAR_DIAMETERS, sp.dia])].sort((a, b) => a - b).map((d) => ({ value: d, label: `Ø ${d}` })), { unit: 'mm', onChange: ch, info: INFO.dia }),
    sp.shape === 'circle'
      ? numField('Anzahl Stäbe', sp, 'n', { unit: 'Stk.', min: 4, max: 60, digits: 0, onChange: ch, info: INFO.n })
      : [numField('Stäbe oben/unten', sp, 'nb', { unit: 'Stk.', min: 2, max: 20, digits: 0, onChange: ch, info: INFO.nb }), numField('Stäbe links/rechts', sp, 'nh', { unit: 'Stk.', min: 2, max: 20, digits: 0, onChange: ch, info: INFO.nh })],
  ];
}

export function coverFields(sp, ch, chS) {
  return [
    selectField('Angabe', sp, 'coverMode', [{ value: 'nominal', label: 'Überdeckung + Bügel' }, { value: 'axis', label: 'Achsabstand a' }], { onChange: chS, info: INFO.coverMode }),
    sp.coverMode === 'axis'
      ? numField('Achsabstand a', sp, 'axis', { unit: 'mm', min: 10, max: 300, onChange: ch, info: INFO.axis })
      : [numField('Überdeckung c_nom', sp, 'cover', { unit: 'mm', min: 0, max: 200, onChange: ch, info: INFO.cover }), numField('Bügel Ø', sp, 'stirrup', { unit: 'mm', min: 0, max: 30, onChange: ch, info: INFO.stirrup })],
  ];
}

export function materialFields(p, ch) {
  return [
    selectField('Beton', p, 'concrete', CONCRETE_CLASSES, { onChange: ch, info: INFO.concrete }),
    selectField('Betonstahl', p, 'steel', REBAR_GRADES, { onChange: ch, info: INFO.steel }),
  ];
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
      ['Betonfläche A_c', g.Ac * 1e4, 'cm²', 0],
      ['Bewehrung A_s', `${g.n} Ø${sp.dia} = ${fmt(g.As * 1e6, 0)}`, 'mm²'],
      ['Bewehrungsgehalt ρ', g.As / g.Ac * 100, '%', 2],
      ['Achsabstand a', g.a * 1000, 'mm', 0],
      ['f_cd / f_sd', `${fmt(m.fcd, 1)} / ${fmt(m.fsd, 0)}`, 'MPa'],
      ['E_cm / E_cd', `${fmt(m.c.Ecm / 1000, 1)} / ${fmt(m.Ecd / 1000, 1)}`, 'GPa'],
    ];
    return [kvTable(rows), g.symmetric ? null : note('Ungerade Stabanzahl: bitte eine gerade Anzahl wählen, damit der Querschnitt doppelt symmetrisch ist.', 'warn')];
  } catch (e) {
    return [note(e.message, 'fail')];
  }
}

// ------------------------------------------------------------------ Bausteine: Imperfektion und Kriechen

export function imperfectionFields(p, ch, chS) {
  const imp = p.imperfection;
  const info = h('div', { class: 'stz-calc' });
  const upd = () => {
    const th = inclination(p.norm, p.L, imp);
    info.innerHTML = th > 0
      ? `θi = 1/${fmt(1 / th, 0)} = <b>${fmt(th * 1000, 2)} ‰</b><br>Vorkrümmung ei = θi·l₀/2, bei Pendelstütze L = ${fmt(p.L, 2)} m: <b>${fmt(th * p.L / 2 * 1000, 1)} mm</b>`
      : 'Keine Imperfektion angesetzt – nur für Vergleichsrechnungen verwenden.';
  };
  upd();
  return [
    selectField('Ansatz', imp, 'mode', [{ value: 'norm', label: `nach Norm (${p.norm === 'EC' ? 'EN 1992-1-1 5.2' : 'SIA 262 4.3.7.2'})` }, { value: 'user', label: 'Schiefstellung vorgeben' }, { value: 'none', label: 'keine (nur Vergleich)' }], { onChange: chS, info: INFO.imp }),
    imp.mode === 'user' ? numField('Schiefstellung θi = 1 /', imp, 'denom', { unit: '–', min: 20, max: 5000, onChange: () => { upd(); ch(); } }) : null,
    info,
  ];
}

export function creepFields(p, ch) {
  const info = h('div', { class: 'stz-calc' });
  const upd = () => {
    const pe = effectiveCreep(p.creep);
    info.innerHTML = `φef = φ(∞,t₀)·M₀Eqp/M₀Ed = ${fmt(p.creep.phi, 2)} · ${fmt(p.creep.ratio, 2)} = <b>${fmt(pe, 2)}</b><br>Betondehnungen gestreckt mit 1 + φef = <b>${fmt(1 + pe, 2)}</b>`;
  };
  upd();
  return [
    numField('Kriechzahl φ(∞,t₀)', p.creep, 'phi', { unit: '–', min: 0, max: 6, onChange: () => { upd(); ch(); }, info: INFO.phi }),
    numField('Anteil M₀Eqp/M₀Ed', p.creep, 'ratio', { unit: '–', min: 0, max: 1, onChange: () => { upd(); ch(); }, info: INFO.ratio }),
    info,
  ];
}

// ------------------------------------------------------------------ Bausteine: Lasten

/** Aktiver Lastfall (Ansichtsoption «Lastfall»), ggf. null. */
export function activeLoadCase(app) {
  const p = app.project;
  return p.loadCases[lcIndex(app)] || null;
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

/** Lastfelder eines Stützenendes bzw. der Stütze (kurze Bezeichnungen für das Eigenschaftsfenster). where: 'top' | 'bot' | 'span'. */
export function loadFields(lc, ax, where, ch) {
  const k = LOAD_KEYS[ax];
  if (where === 'top') {
    return [
      numField('N (Druck +)', lc, 'N', { unit: 'kN', onChange: ch, info: INFO.N }),
      numField('H', lc, k.H, { unit: 'kN', onChange: ch, info: INFO.H }),
      numField('M oben', lc, k.Mt, { unit: 'kNm', onChange: ch, info: INFO.Mt }),
    ];
  }
  if (where === 'bot') return [numField('M unten', lc, k.Mb, { unit: 'kNm', onChange: ch, info: INFO.Mb })];
  return [numField('q', lc, k.q, { unit: 'kN/m', onChange: ch, info: INFO.q })];
}

// ------------------------------------------------------------------ Register: System

export function tabSystem(el, app) {
  const p = ensure(app);
  const ch = () => app.changed();
  const chI = () => app.changed({ inputs: true });
  el.append(group('Grundlagen', [
    selectField('Norm', p, 'norm', NORMS, { onChange: chI, info: INFO.norm }),
    numField('Stützenlänge L', p, 'L', { unit: 'm', min: 0.2, max: 80, onChange: chI, info: INFO.L }),
  ]));
  const two = p.supportZ !== 'same';
  const zFlag = { v: two };
  el.append(group('Lagerung', [
    two ? h('div', { class: 'stz-sub' }, 'Biegung um y (Ausbiegung in z-Richtung)') : null,
    supportTiles(p, 'support', chI),
    p.support === 'custom' ? customFields(p.custom, chI, ch) : null,
    checkField('Andere Lagerung für Biegung um z', zFlag, 'v', {
      onChange: (v) => { p.supportZ = v ? p.support : 'same'; if (v) p.customZ = { ...p.custom }; chI(); }, info: INFO.supportZ,
    }),
    two ? [h('div', { class: 'stz-sub' }, 'Biegung um z (Ausbiegung in y-Richtung)'), supportTiles(p, 'supportZ', chI), p.supportZ === 'custom' ? customFields(p.customZ, chI, ch) : null] : null,
  ], { info: INFO.support }));
  const betaInfo = h('div', { class: 'stz-calc' });
  const updBeta = () => {
    const R = app.results;
    const parts = [];
    for (const ax of ['y', 'z']) {
      const A = R?.lcs?.[0]?.[ax.toUpperCase()];
      const preset = ax === 'z' && p.supportZ !== 'same' ? p.supportZ : p.support;
      let beta = p.betaMode === 'user' ? (ax === 'y' ? p.betaY : p.betaZ) : SUPPORT_PRESETS[preset]?.beta;
      if (!beta && A) beta = A.beta;
      parts.push(`Biegung um ${ax}: β = <b>${beta ? fmt(beta, 2) : '…'}</b> → l₀ = <b>${beta ? fmt(beta * p.L, 2) : '…'} m</b>`);
    }
    betaInfo.innerHTML = parts.join('<br>');
  };
  updBeta();
  el.append(group('Knicklänge', [
    selectField('Knicklänge l₀', p, 'betaMode', [{ value: 'auto', label: 'aus Lagerung (empfohlen)' }, { value: 'user', label: 'Beiwert β vorgeben' }], { onChange: chI, info: INFO.beta }),
    p.betaMode === 'user' ? [
      numField('β für Biegung um y', p, 'betaY', { unit: '–', min: 0.2, max: 10, onChange: () => { updBeta(); ch(); } }),
      numField('β für Biegung um z', p, 'betaZ', { unit: '–', min: 0.2, max: 10, onChange: () => { updBeta(); ch(); } }),
    ] : null,
    betaInfo,
  ]));
}

// ------------------------------------------------------------------ Register: Querschnitt

export function tabSection(el, app) {
  const p = ensure(app);
  const sp = p.section;
  const summary = h('div');
  const upd = () => summary.replaceChildren(...sectionSummary(p).filter(Boolean));
  const ch = () => { upd(); app.changed(); };
  const chI = () => app.changed({ inputs: true });
  el.append(group('Querschnittsform', [sectionShapeFields(sp, ch, chI)]));
  el.append(group('Längsbewehrung', barFields(sp, ch)));
  el.append(group('Lage der Bewehrung', coverFields(sp, ch, chI)));
  el.append(group('Baustoffe', materialFields(p, ch)));
  upd();
  el.append(group('Kennwerte', [summary]));
}

// ------------------------------------------------------------------ Register: Lasten

function ignoredHints(p) {
  const out = [];
  const lcs = p.loadCases;
  for (const ax of p.biaxial ? ['y', 'z'] : ['y']) {
    const st = supportState(p, ax);
    const k = LOAD_KEYS[ax];
    const any = (key) => lcs.some((l) => +l[key]);
    if (st.top === 'fixed' && any(k.Mt)) out.push(`M_${ax},oben wirkt direkt ins eingespannte Kopfauflager und erzeugt keine Stützenbiegung.`);
    if (st.bot === 'fixed' && any(k.Mb)) out.push(`M_${ax},unten wirkt direkt ins eingespannte Fundament und erzeugt keine Stützenbiegung.`);
    if (!st.sway && any(k.H)) out.push(`H_${ax === 'y' ? 'z' : 'y'} wird vom horizontal gehaltenen Kopf aufgenommen.`);
  }
  return out.length ? note(h('div', {}, h('b', {}, 'Hinweis zur Lagerung: '), out.join(' ')), 'warn') : null;
}


export function tabLoads(el, app) {
  const p = ensure(app);
  const ch = () => app.changed();
  const chI = () => app.changed({ inputs: true });
  const onTable = (e) => (e.type === 'edit' ? ch() : chI());
  const colsY = [
    { key: 'name', label: 'Name', type: 'text', width: '64px' },
    { key: 'N', label: 'N', unit: 'kN', info: INFO.N },
    { key: 'Myt', label: 'M oben', unit: 'kNm', info: INFO.Mt },
    { key: 'Myb', label: 'M unten', unit: 'kNm', info: INFO.Mb },
    { key: 'Hz', label: 'H', unit: 'kN', info: INFO.H },
    { key: 'qz', label: 'q', unit: 'kN/m', info: INFO.q },
  ];
  const colsZ = [
    { key: 'name', label: 'Name', type: 'calc', calc: (r) => r.name || '' },
    { key: 'Mzt', label: 'M oben', unit: 'kNm', info: INFO.Mt },
    { key: 'Mzb', label: 'M unten', unit: 'kNm', info: INFO.Mb },
    { key: 'Hy', label: 'H', unit: 'kN', info: INFO.H },
    { key: 'qy', label: 'q', unit: 'kN/m', info: INFO.q },
  ];
  el.append(group('Lastfälle (Bemessungswerte)', [
    checkField('Zweiachsige Biegung (Lasten auch um z)', p, 'biaxial', { onChange: chI, info: INFO.biaxial }),
    h('div', { class: 'stz-sub' }, p.biaxial ? 'Normalkraft und Biegung um y (Ausbiegung in z)' : 'Normalkraft und Biegung um y'),
    p.loadCases.length ? null : emptyState('Noch kein Lastfall', 'Mit «+ Zeile» hinzufügen – oder in der Grafik das Werkzeug «Last» (F) wählen und den Stützenkopf anklicken.'),
    dataTable(colsY, p.loadCases, { onChange: onTable, newRow: (rows) => newLoadCase(rows.length + 1, rows[rows.length - 1]?.N || suggestN(p)), minRows: 0, hint: 'Druck positiv · Einfügen aus Excel möglich' }),
    p.biaxial && p.loadCases.length ? [
      h('div', { class: 'stz-sub' }, 'Biegung um z (Ausbiegung in y)'),
      dataTable(colsZ, p.loadCases, { onChange: () => ch(), canAdd: false, canRemove: false, hint: 'Zeilen werden in der oberen Tabelle verwaltet' }),
    ] : null,
    ignoredHints(p),
  ], { info: INFO.loads }));
  el.append(group('Vorzeichenregel', [
    h('div', { class: 'stz-sign' }, signSketch()),
    h('div', { class: 'muted small' }, 'Biegung um y: Ausbiegung und Kräfte in z-Richtung; Biegung um z: in y-Richtung. Die Grafik «System» zeigt die eingegebenen Lasten mit ihrer Wirkungsrichtung.'),
  ], { collapsible: true }));
}

// ------------------------------------------------------------------ Register: Parameter

export function tabParams(el, app) {
  const p = ensure(app);
  const ch = () => app.changed();
  const chI = () => app.changed({ inputs: true });
  el.append(group('Imperfektion', imperfectionFields(p, ch, chI), { info: INFO.imp }));
  el.append(group('Kriechen', creepFields(p, ch), { info: 'Das Kriechen vergrössert die Verformungen unter Dauerlast und damit die Momente 2. Ordnung. Es wird über die wirksame Kriechzahl φef berücksichtigt (SIA 262 4.3.7.3, EN 1992-1-1 5.8.4).' }));
  const def = columnLawKind(p.norm, 'auto');
  el.append(group('Rechenmodell', [
    selectField('Betongesetz', p, 'lawMode', [
      { value: 'auto', label: `Norm-Standard (${def === 'sargin' ? 'nichtlinear EC' : 'linear-plastisch'})` },
      { value: 'linplast', label: 'linear-elastisch – plastisch' },
      { value: 'parabola', label: 'Parabel-Rechteck' },
      { value: 'sargin', label: 'nichtlinear (EN 1992 3.1.5)' },
    ], { onChange: ch, info: INFO.law }),
    numField('Stabelemente', p, 'nEl', { unit: 'Stk.', min: 10, max: 120, digits: 0, onChange: ch, info: INFO.nEl }),
  ]));
}
