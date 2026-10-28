// Stütze – Stahlbetonstützen nach Theorie 2. Ordnung: Benutzeroberfläche
import { createApp } from '../../js/core/app.js';
import {
  h, group, numField, selectField, checkField, dataTable, segmented, kvTable, resultTable, checksTable,
  summaryCard, stats, note, emptyState, fmt, utilBar,
} from '../../js/core/ui.js';
import { chartBox, xyChart } from '../../js/core/chart.js';
import { repTable, repKV, repFigure, repFormula, repP } from '../../js/core/report.js';
import { NORMS, CONCRETE_CLASSES, REBAR_GRADES, BAR_DIAMETERS } from '../../js/core/materials.js';
import { compute, defaultProject, normalize, newLoadCase, SUPPORT_PRESETS, LAW_LABELS, inclination, effectiveCreep } from './calc.js';
import { sectionGeometry, materials, columnLawKind } from './section.js';
import { renderView, VIEW_MODES, lcIndex, supportIcon, signSketch } from './views.js';
import { EXAMPLES } from './examples.js';

// ------------------------------------------------------------------ Modul-Stile (nur CSS-Variablen)

const CSS = `
.stz-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin: 2px 0 8px; }
.stz-tile { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: 6px 4px 5px;
  cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 1px; font: inherit; font-size: 11px;
  color: var(--text-2); line-height: 1.25; text-align: center; transition: border-color .12s, background .12s; }
.stz-tile:hover { border-color: var(--accent); color: var(--text); }
.stz-tile.active { border-color: var(--accent); background: var(--accent-soft); color: var(--text); font-weight: 600; box-shadow: var(--shadow-sm); }
.stz-tile .beta { font-family: var(--mono); color: var(--text-3); font-size: 10.5px; font-weight: 400; }
.stz-sub { font-size: 11.5px; font-weight: 600; color: var(--text-2); margin: 8px 0 4px; }
.stz-calc { font-family: var(--mono); font-size: 11.5px; color: var(--text-2); background: var(--surface-2); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 5px 8px; margin: 4px 0 6px; line-height: 1.5; }
.stz-calc b { color: var(--text); font-weight: 600; }
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
`;
if (typeof document !== 'undefined' && !document.getElementById('stz-css')) {
  document.head.append(h('style', { id: 'stz-css' }, CSS));
}

// ------------------------------------------------------------------ Erklärungen

const INFO = {
  norm: 'Massgebend für Baustoffkennwerte, Imperfektion, Grenzschlankheit und das vereinfachte Verfahren: <b>SIA 262</b> (Schweiz) oder <b>EN 1992-1-1</b> (Eurocode 2).',
  L: 'Systemlänge der Stütze zwischen Fuss und Kopf (Abstand der Auflagerpunkte).',
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

// Das Projekt ist beim Laden bereits vervollständigt (migrate → normalize)
const ensure = (app) => app.project;

// ------------------------------------------------------------------ Eingabe: System

function supportTiles(p, key, onChange) {
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

function tabSystem(el, app) {
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

// ------------------------------------------------------------------ Eingabe: Querschnitt

function tabSection(el, app) {
  const p = ensure(app);
  const sp = p.section;
  const summary = h('div');
  const upd = () => {
    summary.replaceChildren();
    try {
      const g = sectionGeometry(sp);
      const m = materials(p.norm, p.concrete, p.steel);
      summary.append(kvTable([
        ['Betonfläche A_c', g.Ac * 1e4, 'cm²', 0],
        ['Bewehrung A_s', `${g.n} Ø${sp.dia} = ${fmt(g.As * 1e6, 0)}`, 'mm²'],
        ['Bewehrungsgehalt ρ', g.As / g.Ac * 100, '%', 2],
        ['Achsabstand a', g.a * 1000, 'mm', 0],
        ['f_cd / f_sd', `${fmt(m.fcd, 1)} / ${fmt(m.fsd, 0)}`, 'MPa'],
        ['E_cm / E_cd', `${fmt(m.c.Ecm / 1000, 1)} / ${fmt(m.Ecd / 1000, 1)}`, 'GPa'],
      ]));
      if (!g.symmetric) summary.append(note('Ungerade Stabanzahl: bitte eine gerade Anzahl wählen, damit der Querschnitt doppelt symmetrisch ist.', 'warn'));
    } catch (e) {
      summary.append(note(e.message, 'fail'));
    }
  };
  const ch = () => { upd(); app.changed(); };
  const chI = () => app.changed({ inputs: true });
  el.append(group('Querschnittsform', [
    segmented([{ id: 'rect', label: 'Rechteck' }, { id: 'circle', label: 'Kreis' }], sp.shape, (id) => { sp.shape = id; chI(); }),
    h('div', { style: { height: '6px' } }),
    sp.shape === 'circle'
      ? numField('Durchmesser D', sp, 'D', { unit: 'mm', min: 100, max: 5000, onChange: ch, info: INFO.D })
      : [numField('Breite b', sp, 'b', { unit: 'mm', min: 100, max: 5000, onChange: ch, info: INFO.b }), numField('Höhe h', sp, 'h', { unit: 'mm', min: 100, max: 5000, onChange: ch, info: INFO.h })],
  ]));
  el.append(group('Längsbewehrung', [
    selectField('Stabdurchmesser Ø', sp, 'dia', [...new Set([...BAR_DIAMETERS, sp.dia])].sort((a, b) => a - b).map((d) => ({ value: d, label: `Ø ${d}` })), { unit: 'mm', onChange: ch, info: INFO.dia }),
    sp.shape === 'circle'
      ? numField('Anzahl Stäbe', sp, 'n', { unit: 'Stk.', min: 4, max: 60, digits: 0, onChange: ch, info: INFO.n })
      : [numField('Stäbe oben/unten', sp, 'nb', { unit: 'Stk.', min: 2, max: 20, digits: 0, onChange: ch, info: INFO.nb }), numField('Stäbe links/rechts', sp, 'nh', { unit: 'Stk.', min: 2, max: 20, digits: 0, onChange: ch, info: INFO.nh })],
  ]));
  el.append(group('Lage der Bewehrung', [
    selectField('Angabe', sp, 'coverMode', [{ value: 'nominal', label: 'Überdeckung + Bügel' }, { value: 'axis', label: 'Achsabstand a' }], { onChange: chI, info: INFO.coverMode }),
    sp.coverMode === 'axis'
      ? numField('Achsabstand a', sp, 'axis', { unit: 'mm', min: 10, max: 300, onChange: ch, info: INFO.axis })
      : [numField('Überdeckung c_nom', sp, 'cover', { unit: 'mm', min: 0, max: 200, onChange: ch, info: INFO.cover }), numField('Bügel Ø', sp, 'stirrup', { unit: 'mm', min: 0, max: 30, onChange: ch, info: INFO.stirrup })],
  ]));
  el.append(group('Baustoffe', [
    selectField('Beton', p, 'concrete', CONCRETE_CLASSES, { onChange: ch, info: INFO.concrete }),
    selectField('Betonstahl', p, 'steel', REBAR_GRADES, { onChange: ch, info: INFO.steel }),
  ]));
  upd();
  el.append(group('Kennwerte', [summary]));
}

// ------------------------------------------------------------------ Eingabe: Lasten

function ignoredHints(p) {
  const out = [];
  const lcs = p.loadCases;
  for (const ax of p.biaxial ? ['y', 'z'] : ['y']) {
    const preset = ax === 'z' && p.supportZ !== 'same' ? p.supportZ : p.support;
    const c = preset === 'custom' ? (ax === 'z' && p.supportZ !== 'same' ? p.customZ : p.custom) : SUPPORT_PRESETS[preset];
    const k = ax === 'y' ? { Mt: 'Myt', Mb: 'Myb', H: 'Hz' } : { Mt: 'Mzt', Mb: 'Mzb', H: 'Hy' };
    const any = (key) => lcs.some((l) => +l[key]);
    if (c.top === 'fixed' && any(k.Mt)) out.push(`M_${ax},oben wirkt direkt ins eingespannte Kopfauflager und erzeugt keine Stützenbiegung.`);
    if (c.bot === 'fixed' && any(k.Mb)) out.push(`M_${ax},unten wirkt direkt ins eingespannte Fundament und erzeugt keine Stützenbiegung.`);
    if (!c.sway && any(k.H)) out.push(`H_${ax === 'y' ? 'z' : 'y'} wird vom horizontal gehaltenen Kopf aufgenommen.`);
  }
  return out.length ? note(h('div', {}, h('b', {}, 'Hinweis zur Lagerung: '), out.join(' ')), 'warn') : null;
}

function tabLoads(el, app) {
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
    p.loadCases.length ? null : emptyState('Noch kein Lastfall', 'Mit «+ Zeile» einen Lastfall hinzufügen.'),
    dataTable(colsY, p.loadCases, { onChange: onTable, newRow: (rows) => newLoadCase(rows.length + 1), minRows: 1, hint: 'Druck positiv · Einfügen aus Excel möglich' }),
    p.biaxial ? [
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

// ------------------------------------------------------------------ Eingabe: Parameter

function tabParams(el, app) {
  const p = ensure(app);
  const ch = () => app.changed();
  const chI = () => app.changed({ inputs: true });
  const imp = p.imperfection;
  const impInfo = h('div', { class: 'stz-calc' });
  const updImp = () => {
    const th = inclination(p.norm, p.L, imp);
    impInfo.innerHTML = th > 0
      ? `θi = 1/${fmt(1 / th, 0)} = <b>${fmt(th * 1000, 2)} ‰</b><br>Vorkrümmung ei = θi·l₀/2, bei Pendelstütze L = ${fmt(p.L, 2)} m: <b>${fmt(th * p.L / 2 * 1000, 1)} mm</b>`
      : 'Keine Imperfektion angesetzt – nur für Vergleichsrechnungen verwenden.';
  };
  updImp();
  el.append(group('Imperfektion', [
    selectField('Ansatz', imp, 'mode', [{ value: 'norm', label: `nach Norm (${p.norm === 'EC' ? 'EN 1992-1-1 5.2' : 'SIA 262 4.3.7.2'})` }, { value: 'user', label: 'Schiefstellung vorgeben' }, { value: 'none', label: 'keine (nur Vergleich)' }], { onChange: chI, info: INFO.imp }),
    imp.mode === 'user' ? numField('Schiefstellung θi = 1 /', imp, 'denom', { unit: '–', min: 20, max: 5000, onChange: () => { updImp(); ch(); } }) : null,
    impInfo,
  ], { info: INFO.imp }));
  const crInfo = h('div', { class: 'stz-calc' });
  const updCr = () => {
    const pe = effectiveCreep(p.creep);
    crInfo.innerHTML = `φef = φ(∞,t₀)·M₀Eqp/M₀Ed = ${fmt(p.creep.phi, 2)} · ${fmt(p.creep.ratio, 2)} = <b>${fmt(pe, 2)}</b><br>Betondehnungen gestreckt mit 1 + φef = <b>${fmt(1 + pe, 2)}</b>`;
  };
  updCr();
  el.append(group('Kriechen', [
    numField('Kriechzahl φ(∞,t₀)', p.creep, 'phi', { unit: '–', min: 0, max: 6, onChange: () => { updCr(); ch(); }, info: INFO.phi }),
    numField('Anteil M₀Eqp/M₀Ed', p.creep, 'ratio', { unit: '–', min: 0, max: 1, onChange: () => { updCr(); ch(); }, info: INFO.ratio }),
    crInfo,
  ], { info: 'Das Kriechen vergrössert die Verformungen unter Dauerlast und damit die Momente 2. Ordnung. Es wird über die wirksame Kriechzahl φef berücksichtigt (SIA 262 4.3.7.3, EN 1992-1-1 5.8.4).' }));
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

// ------------------------------------------------------------------ Ergebnisse

let resAxis = null;
let lastResultsLc = -1;

const axName = (ax) => (ax === 'y' ? 'Biegung um y' : 'Biegung um z');
const reasonText = (A) => (A.capped ? 'Traglastfaktor ≥ 20 (Suche begrenzt)'
  : A.reason === 'section' ? 'Querschnittsversagen (Grenzdehnung erreicht)'
    : A.reason === 'axial' ? 'Normalkraft übersteigt den Querschnittswiderstand'
      : 'Stabilitätsversagen (Gleichgewicht nicht mehr stabil)');

function verdict(R) {
  const r = R.lcs[R.gov];
  const c = r.checks.reduce((m, x) => (x.eta > m.eta ? x : m), r.checks[0]);
  const ok = Number.isFinite(R.eta) && R.eta <= 1.0001;
  const d = h('div', { class: 'stz-verdict' });
  if (ok) {
    d.append(h('b', {}, 'Die Tragsicherheit der Stütze ist nachgewiesen.'),
      h('span', { class: 'muted' }, `Massgebend: ${r.name} – ${c.label}.`));
  } else {
    d.append(h('b', {}, 'Die Tragsicherheit ist nicht nachgewiesen.'),
      h('span', { class: 'muted' }, `Massgebend: ${r.name} – ${c.label}. Abhilfe: Bewehrung erhöhen, Querschnitt vergrössern, Knicklänge verkürzen (Lagerung) oder höhere Betonfestigkeit wählen.`));
  }
  return d;
}

function lcOverview(R, li, onSelect) {
  const t = h('table', { class: 'rt stz-lc' });
  t.append(h('thead', {}, h('tr', {}, h('th', {}, 'Lastfall'), h('th', { class: 'num' }, 'N_d [kN]'), h('th', { class: 'num' }, 'λu'), h('th', {}, 'Ausnutzung'))));
  const tb = h('tbody');
  R.lcs.forEach((r, i) => {
    const lu = Math.min(r.Y.lambdaU, r.Z.lambdaU);
    tb.append(h('tr', { class: [i === R.gov && 'gov', i === li && 'sel'], onclick: () => onSelect(i), title: 'Details anzeigen' },
      h('td', {}, r.name, i === R.gov ? h('span', { class: 'muted small' }, ' (massgebend)') : null),
      h('td', { class: 'num' }, fmt(r.N, 0)), h('td', { class: 'num' }, fmt(lu, 2)), h('td', {}, utilBar(r.eta))));
  });
  t.append(tb);
  return h('div', { class: 'dt-wrap', style: { border: 0, marginBottom: '10px' } }, t);
}

function nmChart(A, small = false) {
  const N = A.N;
  const pts = [];
  if (A.M1max !== undefined) pts.push({ x: A.M1max, y: N, label: 'I', color: 'var(--c-series-3)', shape: 'square', title: `1. Ordnung: M = ${fmt(A.M1max, 1)} kNm` });
  if (A.M2max !== null) pts.push({ x: A.M2max, y: N, label: 'II', color: 'var(--c-series-2)', title: `2. Ordnung (allgemein): M = ${fmt(A.M2max, 1)} kNm` });
  pts.push({ x: A.simp.MEd, y: N, label: 'V', color: 'var(--c-series-5)', shape: 'cross', title: `vereinfachtes Verfahren: M = ${fmt(A.simp.MEd, 1)} kNm` });
  return {
    title: `N-M-Interaktion – ${axName(A.ax)}`,
    series: [
      { points: A.nm.map((q) => [q.M, -q.N]), closed: true, fill: true, label: 'Widerstand', color: 'var(--c-series-1)', width: 1.6 },
      { points: A.path.map(([m, n]) => [Math.abs(m), n]), label: 'Lastpfad (2. Ordnung)', color: 'var(--c-series-2)', width: 2 },
    ],
    points: pts,
    xLabel: `M_${A.ax} [kNm]`, yLabel: 'N (Druck) [kN]', height: small ? 260 : 300,
  };
}

function mkChart(A) {
  const series = [];
  if (A.tabN) series.push({ points: Array.from(A.tabN.kap, (k, i) => [k * 1000, A.tabN.M[i]]), label: 'Stütze (Ecd, φef)', color: 'var(--c-series-1)', width: 2 });
  if (A.tabRd) series.push({ points: Array.from(A.tabRd.kap, (k, i) => [k * 1000, A.tabRd.M[i]]), label: 'Querschnitt (fcd)', color: 'var(--c-series-4)', dash: '5 4' });
  const pts = [];
  if (A.at1) pts.push({ x: Math.abs(A.at1.kapCrit) * 1000, y: A.at1.Mmax, label: 'λ = 1', color: 'var(--c-series-2)', title: `massgebender Schnitt x = ${fmt(A.x[A.at1.iM], 2)} m` });
  return {
    title: `Momenten-Krümmungs-Beziehung bei N_d = ${fmt(A.N, 0)} kN`,
    series, points: pts, hLines: A.MRd > 0 ? [{ v: A.MRd, label: `M_Rd = ${fmt(A.MRd, 1)} kNm`, color: 'var(--fail)' }] : [],
    xLabel: 'Krümmung κ [1/km]', yLabel: `M_${A.ax} [kNm]`,
  };
}

function ldChart(r, axes) {
  const cols = { y: 'var(--c-series-1)', z: 'var(--c-series-4)' };
  const series = [], pts = [];
  let wMax = 1, lMax = 1.2;
  for (const ax of axes) {
    const A = r[ax.toUpperCase()];
    const c = A.curve.map(([w, l]) => [Math.abs(w) * 1000, l]);
    series.push({ points: c, label: `um ${ax} (${A.sway ? 'Kopf' : 'max. w'})`, color: cols[ax], width: 2 });
    const last = c[c.length - 1];
    if (last) pts.push({ x: last[0], y: A.lambdaU, label: `λu = ${fmt(A.lambdaU, 2)}`, color: cols[ax], title: reasonText(A) });
    for (const [w] of c) wMax = Math.max(wMax, w);
    lMax = Math.max(lMax, A.lambdaU * 1.08);
  }
  return {
    title: 'Last-Verformungs-Kurve (proportionale Laststeigerung)',
    series, points: pts, hLines: [{ v: 1, label: 'λ = 1', color: 'var(--text-2)' }],
    xRange: [0, wMax * 1.3], yRange: [0, lMax],
    xLabel: 'Zusatzverformung w [mm]', yLabel: 'Lastfaktor λ',
  };
}

function detailRows(R, A) {
  const s = A.simp, ec = R.norm === 'EC';
  const rows = [
    ['Lagerung', SUPPORT_PRESETS[A.preset]?.label || A.preset],
    ['Knicklängenbeiwert β', A.beta, A.userBeta ? '(vorgegeben)' : '', 3],
    ['Knicklänge l₀', A.l0, 'm', 2],
    ['Trägheitsradius i', A.i * 1000, 'mm', 1],
    ['Schlankheit λ = l₀/i', A.lam, '', 1],
    ec ? ['λ_lim = 20·A·B·C/√n', `${fmt(A.lamLim, 1)} (A = ${fmt(A.limEC.A, 2)}, B = ${fmt(A.limEC.B, 2)}, C = ${fmt(A.limEC.C, 2)})`] : ['λ_lim (10-%-Kriterium)', A.lamLim, '', 1],
    ['Schiefstellung θi', `1/${fmt(1 / A.thetaI, 0)}`],
    [A.sway ? 'Kopfauslenkung θi·L' : 'Vorkrümmung ei = θi·l₀/2', A.impAmp * 1000, 'mm', 1],
    ['Wirksame Kriechzahl φef', R.phiEf, '', 2],
    ['Nennsteifigkeit EI (5.8.7.2)', A.EInom / 1000, 'MNm²', 2],
    ['Knicklast N_B = π²EI/l₀²', A.NB, 'kN', 0],
    ['M_Ed,I (inkl. Imperfektion)', A.M1max, 'kNm', 1],
    ['M_Ed,II (allgemeines Verfahren)', A.M2max ?? '–', 'kNm', 1],
    ['Vergrösserung M_II/M_I', A.amplification ?? '–', '', 2],
    ['M_Rd bei N_Ed', A.MRd, 'kNm', 1],
    ['Traglastfaktor λu', A.lambdaU, '', 3],
    ['Versagensart', reasonText(A)],
  ];
  const simp = [
    ['Nutzhöhe d = h/2 + i_s', s.d * 1000, 'mm', 0],
    ['ε_yd = f_yd/E_s', s.eyd * 1000, '‰', 3],
    ...(ec ? [
      ['n = N_Ed/(A_c·f_cd)', s.nRel, '', 3],
      ['K_r = (n_u − n)/(n_u − n_bal) ≤ 1', s.Kr, '', 3],
      ['β = 0.35 + f_ck/200 − λ/150', s.betaPhi, '', 3],
      ['K_φ = 1 + β·φef ≥ 1', s.Kphi, '', 3],
      ['1/r = K_r·K_φ·ε_yd/(0.45·d)', s.curv * 1000, '1/km', 2],
    ] : [
      ['χ_d = 2·ε_sd/(0.9·d)', s.curv * 1000, '1/km', 2],
    ]),
    ['e₂ = κ·l₀²/c', `${fmt(s.e2 * 1000, 1)} (c = ${ec ? '10' : 'π²'})`, 'mm'],
    ['M₀Ed (inkl. N·ei)', s.M0Ed, 'kNm', 1],
    ['M₂ = N·e₂', s.M2, 'kNm', 1],
    ['M_Ed', s.MEd, 'kNm', 1],
  ];
  return { rows, simp };
}

function renderResults(el, app) {
  const R = app.results;
  const li = lcIndex(app);
  lastResultsLc = li;
  const r = R.lcs[li] || R.lcs[0];
  const showZ = R.geo.shape === 'rect' || R.p.biaxial;
  const axes = showZ ? ['y', 'z'] : ['y'];
  const ax = axes.includes(resAxis) ? resAxis : r.governingAxis;
  const A = r[ax.toUpperCase()];
  const select = (i) => { app.viewOpts.lc = i; app.renderView(); app.renderResults(); };

  el.append(summaryCard(R.eta, 'Massgebende Ausnutzung', verdict(R)));
  for (const w of R.warnings) el.append(note(w, 'warn'));
  if (R.lcs.length > 1) {
    el.append(h('div', { class: 'stz-h' }, 'Lastfälle'));
    el.append(lcOverview(R, li, select));
  }
  el.append(h('div', { class: 'stz-h' }, R.lcs.length > 1 ? `Details – ${r.name}` : 'Kennwerte'));
  if (axes.length > 1) {
    el.append(h('div', { class: 'stz-bar' }, h('span', { class: 'lbl' }, 'Achse:'),
      segmented(axes.map((a) => ({ id: a, label: `${axName(a)}${a === r.governingAxis ? ' ★' : ''}`, title: a === r.governingAxis ? 'massgebende Achse' : '' })), ax, (id) => { resAxis = id; app.renderResults(); })));
  }
  el.append(stats([
    ['Schlankheit λ', A.lam, '', 1],
    ['Grenzschlankheit λ_lim', Number.isFinite(A.lamLim) ? A.lamLim : '∞', '', 1],
    ['Knicklänge l₀', A.l0, 'm', 2],
    ['M_Ed,I (1. Ordnung)', A.M1max, 'kNm', 1],
    ['M_Ed,II (2. Ordnung)', A.M2max ?? '–', 'kNm', 1],
    ['M_Rd (bei N_Ed)', A.MRd, 'kNm', 1],
    ['Traglastfaktor λu', A.lambdaU, '', 2],
    ['e₂ (vereinfacht)', A.simp.e2 * 1000, 'mm', 1],
  ]));
  for (const n of r.notes) if (!n.ax || n.ax === ax) el.append(note(n.text, n.kind === 'fail' ? 'fail' : ''));
  if (A.lam <= A.lamLim && Number.isFinite(A.lamLim)) el.append(note(`${axName(ax)}: λ = ${fmt(A.lam, 1)} ≤ λ_lim = ${fmt(A.lamLim, 1)} – Einflüsse 2. Ordnung dürften vernachlässigt werden; sie sind hier trotzdem berücksichtigt.`, 'ok'));

  el.append(h('div', { class: 'stz-h' }, 'Nachweise – allgemeines Verfahren'));
  el.append(checksTable(r.checks));
  el.append(h('div', { class: 'stz-legend' }, 'Traglastfaktor λu: alle Lasten (inkl. N) werden proportional gesteigert, bis kein Gleichgewicht mehr möglich ist; Ausnutzung η = 1/λu.'));

  el.append(h('div', { class: 'stz-h' }, `Vergleich – ${R.norm === 'EC' ? 'Nennkrümmungsverfahren (EN 1992-1-1 5.8.8)' : 'vereinfachtes Verfahren (Modellstütze)'}`));
  el.append(checksTable(r.simpChecks));
  el.append(resultTable([{ label: 'Verfahren' }, { label: 'M_Ed', num: true, digits: 1, unit: 'kNm' }, { label: 'M_Rd', num: true, digits: 1, unit: 'kNm' }, { label: 'M_Ed/M_Rd', num: true, digits: 2 }], [
    ['1. Ordnung', A.M1max, A.MRd, A.MRd ? A.M1max / A.MRd : '–'],
    ['Allgemeines Verfahren', A.M2max ?? '–', A.MRd, A.M2max !== null ? A.etaSec : '–'],
    ['Vereinfachtes Verfahren', A.simp.MEd, A.simp.MRd, A.simp.eta],
  ], { caption: `${axName(ax)}, N_Ed = ${fmt(r.N, 0)} kN` }));

  el.append(h('div', { class: 'stz-h' }, 'Diagramme'));
  el.append(chartBox(nmChart(A)));
  el.append(h('div', { class: 'stz-legend' }, '■ I = 1. Ordnung · ● II = 2. Ordnung (allgemeines Verfahren) · ✕ V = vereinfachtes Verfahren. Die Linie «Lastpfad» zeigt das massgebende Moment bei proportionaler Laststeigerung bis zum Versagen – sie endet beim Traglastfaktor λu.'));
  el.append(chartBox(mkChart(A)));
  el.append(chartBox(ldChart(r, axes)));

  const d = detailRows(R, A);
  el.append(group(`Zwischenwerte – ${axName(ax)}`, [kvTable(d.rows)], { collapsible: true, collapsed: true }));
  el.append(group(`Vereinfachtes Verfahren – ${axName(ax)}`, [kvTable(d.simp)], { collapsible: true, collapsed: true }));
  el.append(h('div', { class: 'muted small', style: { marginTop: '8px' } }, `Fasermodell mit ${R.nFibers} Fasern · ${R.p.nEl} Stabelemente · Betongesetz: ${LAW_LABELS[R.kind]} · Rechenzeit ${fmt(R.time, 0)} ms`));
}

// ------------------------------------------------------------------ Bericht

function report(app) {
  const R = app.results;
  const p = R.p, g = R.geo, m = R.mat;
  const ec = p.norm === 'EC';
  const supp = (key, c) => (key === 'custom'
    ? `benutzerdefiniert: Fuss ${({ fixed: 'eingespannt', pinned: 'gelenkig', spring: `Drehfeder ${fmt(c.kBot, 1)} MNm/rad` })[c.bot]}, Kopf ${({ fixed: 'eingespannt', pinned: 'frei drehbar', spring: `Drehfeder ${fmt(c.kTop, 1)} MNm/rad` })[c.top]}, ${c.sway ? 'verschieblich' : 'unverschieblich'}`
    : SUPPORT_PRESETS[key].label);
  const sections = [];
  sections.push({
    title: 'Grundlagen und Eingaben',
    content: [
      h('h3', {}, 'System'),
      repKV([
        ['Norm', ec ? 'EN 1992-1-1 (Eurocode 2)' : 'SIA 262:2013'],
        ['Stützenlänge L', p.L, 'm', 2],
        ['Lagerung (Biegung um y)', supp(p.support, p.custom)],
        p.supportZ !== 'same' ? ['Lagerung (Biegung um z)', supp(p.supportZ, p.customZ)] : null,
        ['Knicklänge', p.betaMode === 'user' ? `β_y = ${fmt(p.betaY, 2)}, β_z = ${fmt(p.betaZ, 2)} (vorgegeben)` : 'aus Knickberechnung des Stabmodells'],
      ]),
      h('h3', {}, 'Querschnitt und Baustoffe'),
      repKV([
        ['Querschnitt', g.shape === 'circle' ? `Kreis D = ${fmt(g.D * 1000, 0)} mm` : `Rechteck b × h = ${fmt(g.b * 1000, 0)} × ${fmt(g.h * 1000, 0)} mm`],
        ['Längsbewehrung', `${g.n} Ø${p.section.dia} = ${fmt(g.As * 1e6, 0)} mm² (ρ = ${fmt(R.rho * 100, 2)} %)`],
        ['Achsabstand a', g.a * 1000, 'mm', 0],
        ['Beton', `${p.concrete}: f_ck = ${fmt(m.c.fck, 0)} MPa, f_cd = ${fmt(m.fcd, 1)} MPa, E_cm = ${fmt(m.c.Ecm, 0)} MPa, E_cd = E_cm/1.2 = ${fmt(m.Ecd, 0)} MPa`],
        ['Betonstahl', `${p.steel}: f_sd = ${fmt(m.fsd, 0)} MPa, E_s = ${fmt(m.Es, 0)} MPa, ε_ud = ${fmt(m.s.eud * 1000, 1)} ‰`],
        ['Querschnittswiderstand N_Rd', R.NRd, 'kN', 0],
      ]),
      h('h3', {}, 'Parameter'),
      repKV([
        ['Imperfektion θi', R.thetaI > 0 ? `1/${fmt(1 / R.thetaI, 0)} (${p.imperfection.mode === 'user' ? 'vorgegeben' : p.imperfection.mode === 'none' ? 'keine' : ec ? 'EN 1992-1-1 5.2' : 'SIA 262 4.3.7.2'})` : 'keine'],
        ['Kriechen', `φ(∞,t₀) = ${fmt(p.creep.phi, 2)}, M₀Eqp/M₀Ed = ${fmt(p.creep.ratio, 2)} → φef = ${fmt(R.phiEf, 2)}`],
        ['Betongesetz (Verformungen)', LAW_LABELS[R.kind]],
        ['Rechenmodell', `${p.nEl} Stabelemente, Fasermodell mit ${R.nFibers} Fasern`],
      ]),
      h('h3', {}, 'Lastfälle (Bemessungswerte)'),
      repTable([
        'Lastfall', { label: 'N [kN]', num: true, digits: 0 }, { label: 'M_y,o [kNm]', num: true, digits: 1 }, { label: 'M_y,u [kNm]', num: true, digits: 1 },
        { label: 'H_z [kN]', num: true, digits: 1 }, { label: 'q_z [kN/m]', num: true, digits: 2 },
        ...(p.biaxial ? [{ label: 'M_z,o', num: true, digits: 1 }, { label: 'M_z,u', num: true, digits: 1 }, { label: 'H_y', num: true, digits: 1 }, { label: 'q_y', num: true, digits: 2 }] : []),
      ], p.loadCases.map((l) => [l.name, +l.N, +l.Myt, +l.Myb, +l.Hz, +l.qz, ...(p.biaxial ? [+l.Mzt, +l.Mzb, +l.Hy, +l.qy] : [])])),
      repP('Vorzeichen: Normalkraft als Druck positiv; Momente positiv bei Druckseite rechts (+z bzw. +y), entsprechend M = N·e; H und q positiv in Richtung +z bzw. +y.'),
    ],
  });
  // Grafiken des massgebenden Lastfalls
  const prev = app.viewOpts.lc;
  app.viewOpts.lc = R.gov;
  const figs = [
    repFigure(app.snapshot('system'), `System, Lasten und Imperfektion (${R.lcs[R.gov].name})`),
    repFigure(app.snapshot('section'), 'Querschnitt'),
    repFigure(app.snapshot('deform'), `Verformung bei Bemessungslast (${R.lcs[R.gov].name}), überhöht dargestellt`),
    repFigure(app.snapshot('moments'), `Biegemomente 1. und 2. Ordnung (${R.lcs[R.gov].name})`),
  ];
  app.viewOpts.lc = prev;
  app.redraw?.();
  sections.push({ title: 'System und Ergebnisse (massgebender Lastfall)', content: figs });
  sections.push({
    title: 'Berechnungsverfahren',
    content: [
      h('h3', {}, 'Allgemeines Verfahren (nichtlinear)'),
      repP(`Die Stütze wird als Stabmodell mit ${p.nEl} Balkenelementen abgebildet. Für jede Laststufe wird bei der zugehörigen Normalkraft die Momenten-Krümmungs-Beziehung des Querschnitts mit einem Fasermodell ermittelt. Bemessungswerte der Baustoffe: Beton mit f_cd und E_cd = E_cm/γ_cE (γ_cE = 1.2), Betonstahl bilinear mit f_sd (${ec ? 'EN 1992-1-1 5.8.6' : 'SIA 262 4.3.7'}). Das Kriechen wird durch Streckung aller Betondehnungen mit (1 + φef) erfasst. Das Gleichgewicht wird am verformten System (Theorie 2. Ordnung, geometrische Steifigkeitsmatrix) mit dem Newton-Raphson-Verfahren gesucht; die Vorverformung wirkt als geometrische Imperfektion.`),
      repP('Alle Lasten (einschliesslich der Normalkraft) werden proportional mit dem Faktor λ gesteigert, bis kein stabiles Gleichgewicht mehr existiert oder eine Grenzdehnung (Beton ε_cu·(1 + φef), Stahl ε_ud) erreicht wird. Der Nachweis ist erfüllt, wenn λu ≥ 1 und die Schnittgrössen 2. Ordnung unter Bemessungslast vom Querschnitt aufgenommen werden (M_Ed,II ≤ M_Rd mit Parabel-Rechteck-Diagramm).'),
      repFormula('η = max( 1/λu ; M_Ed,II/M_Rd(N_Ed) ; N_Ed/N_Rd ; My-Mz-Interaktion )'),
      h('h3', {}, ec ? 'Vereinfachtes Verfahren: Nennkrümmung (EN 1992-1-1 5.8.8)' : 'Vereinfachtes Verfahren: Modellstütze (SIA 262 4.3.7)'),
      ec
        ? repFormula('1/r = K_r · K_φ · ε_yd / (0.45·d)      K_r = (n_u − n)/(n_u − n_bal) ≤ 1,  K_φ = 1 + β·φef ≥ 1\ne₂ = (1/r) · l₀² / c  (c = 10)      M_Ed = M₀Ed + N_Ed·e₂,  M₀Ed inkl. N_Ed·ei\nM₀e = 0.6·M₀₂ + 0.4·M₀₁ ≥ 0.4·M₀₂ (unverschieblich ohne Querlast),  M_Ed ≥ N_Ed·max(h/30; 20 mm)')
        : repFormula('χ_d = 2·ε_sd / (0.9·d)      e₂ = χ_d · l₀² / π²\nM_Ed = N_d · (e₀ + ei + e₂)      M₀e = 0.6·M₀₂ + 0.4·M₀₁ ≥ 0.4·M₀₂ (unverschieblich ohne Querlast)'),
      repP('Nutzhöhe d = h/2 + i_s (i_s: Trägheitsradius der gesamten Bewehrung). Das vereinfachte Verfahren dient dem Vergleich; massgebend ist das allgemeine Verfahren.'),
      h('h3', {}, 'Schlankheit'),
      ec
        ? repFormula('λ = l₀/i,  λ_lim = 20·A·B·C/√n  (EN 1992-1-1 5.8.3.1),  A = 1/(1 + 0.2·φef), B = √(1 + 2ω), C = 1.7 − r_m')
        : repFormula('λ = l₀/i,  λ_lim aus dem 10-%-Kriterium: 1/(1 − N_d/N_B) ≤ 1.1 mit N_B = π²·EI/l₀² (EI nach EN 1992-1-1 5.8.7.2)'),
    ],
  });
  for (const r of R.lcs) {
    const axes = R.geo.shape === 'rect' || p.biaxial ? ['y', 'z'] : ['y'];
    const val = (f, d = 1) => axes.map((ax) => { const v = f(r[ax.toUpperCase()]); return typeof v === 'number' ? fmt(v, d) : v; });
    const content = [
      repTable(['Grösse', ...axes.map((a) => axName(a))], [
        ['β / l₀ [m]', ...axes.map((a) => `${fmt(r[a.toUpperCase()].beta, 2)} / ${fmt(r[a.toUpperCase()].l0, 2)}`)],
        ['Schlankheit λ / λ_lim', ...axes.map((a) => `${fmt(r[a.toUpperCase()].lam, 1)} / ${fmt(r[a.toUpperCase()].lamLim, 1)}`)],
        ['Imperfektion [mm]', ...val((A) => A.impAmp * 1000)],
        ['EI_nom [MNm²] / N_B [kN]', ...axes.map((a) => `${fmt(r[a.toUpperCase()].EInom / 1000, 2)} / ${fmt(r[a.toUpperCase()].NB, 0)}`)],
        ['M_Ed,I [kNm]', ...val((A) => A.M1max)],
        ['M_Ed,II [kNm]', ...val((A) => A.M2max ?? '–')],
        ['M_Rd(N_Ed) [kNm]', ...val((A) => A.MRd)],
        ['Traglastfaktor λu', ...val((A) => A.lambdaU, 3)],
        ['Versagensart', ...axes.map((a) => reasonText(r[a.toUpperCase()]))],
        ['e₂ vereinfacht [mm]', ...val((A) => A.simp.e2 * 1000)],
        ['M_Ed vereinfacht [kNm]', ...val((A) => A.simp.MEd)],
      ]),
      h('h3', {}, 'Nachweise (allgemeines Verfahren)'),
      checksTable(r.checks),
      h('h3', {}, 'Vergleich vereinfachtes Verfahren'),
      checksTable(r.simpChecks),
    ];
    if (r.index === R.gov) {
      const A = r[r.governingAxis.toUpperCase()];
      content.push(h('h3', {}, 'Diagramme'),
        repFigure(xyChart({ ...nmChart(A), crosshair: false }), 'N-M-Interaktion mit Bemessungspunkten und Lastpfad'),
        repFigure(xyChart({ ...mkChart(A), crosshair: false }), 'Momenten-Krümmungs-Beziehung bei N_Ed'),
        repFigure(xyChart({ ...ldChart(r, axes), crosshair: false }), 'Last-Verformungs-Kurve'));
    }
    sections.push({ title: `Lastfall ${r.name}${r.index === R.gov ? ' (massgebend)' : ''}`, content });
  }
  sections.push({
    title: 'Zusammenfassung',
    content: [
      repTable(['Lastfall', { label: 'N_d [kN]', num: true, digits: 0 }, { label: 'λu', num: true, digits: 2 }, { label: 'η allgemein', num: true, digits: 2 }, { label: 'η vereinfacht', num: true, digits: 2 }, 'Status'],
        R.lcs.map((r) => [r.name, r.N, Math.min(r.Y.lambdaU, r.Z.lambdaU), r.eta, r.etaSimp, r.eta <= 1.0001 ? 'erfüllt' : 'nicht erfüllt'])),
      repP(R.eta <= 1.0001 ? `Die Tragsicherheit der Stütze ist für alle Lastfälle nachgewiesen (η_max = ${fmt(R.eta, 2)}).` : `Die Tragsicherheit ist nicht nachgewiesen (η_max = ${fmt(R.eta, 2)} > 1).`),
    ],
  });
  sections.push({
    title: 'Annahmen und Grenzen',
    content: h('ul', {},
      ...[
        'Normalkraft konstant über die Stützenhöhe; das Eigengewicht der Stütze ist in N_d einzurechnen.',
        'Doppelt symmetrische Querschnitte und Bewehrung; die M-κ-Beziehung wird punktsymmetrisch angenommen.',
        'Kein Mitwirken des Betons auf Zug (keine Zugversteifung) – auf der sicheren Seite.',
        'Kriechen vereinfacht durch Streckung der Betondehnungen mit (1 + φef); Schwinden nicht berücksichtigt.',
        'Zweiachsige Biegung: Berechnung je Biegeebene, Kombination der Momente am Querschnitt (My-Mz-Interaktion), Imperfektion jeweils nur in der ungünstigeren Richtung; Torsion und Kopplung der Verformungen werden vernachlässigt.',
        'Schubtragfähigkeit, Bügelbewehrung, Konstruktionsregeln und Brandschutz sind separat nachzuweisen.',
        'Traglastfaktor mit einer Genauigkeit von etwa 1 % (Bisektion, Konvergenzkriterium des Newton-Verfahrens).',
      ].map((t) => h('li', {}, t))),
  });
  return sections;
}

// ------------------------------------------------------------------ Hilfe

const INTRO = `<h4>So funktioniert's</h4>
<ol>
<li><b>System</b>: Norm, Stützenlänge und Lagerung wählen.</li>
<li><b>Querschnitt</b>: Abmessungen, Längsbewehrung und Baustoffe eingeben.</li>
<li><b>Lasten</b>: Bemessungswerte je Lastfall erfassen – Normalkraft als Druck positiv. Imperfektion und Kriechen bei Bedarf unter <b>Parameter</b> anpassen.</li>
<li>Die Ergebnisse erscheinen sofort rechts; die Grafik zeigt System, Verformung und Momente. Mit <b>Bericht</b> dokumentieren.</li>
</ol>`;

const HELP = `
<h3>Zweck</h3>
<p>Nachweis der Tragsicherheit schlanker Stahlbetonstützen mit Rechteck- oder Kreisquerschnitt nach Theorie 2. Ordnung, nach SIA 262 oder EN 1992-1-1.</p>
<h3>Allgemeines Verfahren (massgebend)</h3>
<ul>
<li>Stabmodell mit Balkenelementen; Krümmungen aus der Momenten-Krümmungs-Beziehung des Querschnitts (Fasermodell) bei der jeweiligen Normalkraft.</li>
<li>Baustoffe mit Bemessungswerten: Beton f_cd und E_cd = E_cm/1.2, Betonstahl f_sd. Standard-Betongesetz SIA: linear-elastisch – ideal-plastisch; EC: nichtlinear nach EN 1992-1-1 3.1.5 / 5.8.6.</li>
<li>Kriechen: Streckung der Betondehnungen mit (1 + φef), φef = φ(∞,t₀)·M₀Eqp/M₀Ed.</li>
<li>Imperfektion: unverschieblich als Vorkrümmung e_i = θi·l₀/2 in Form der Knickfigur, verschieblich als Schiefstellung θi; Richtung automatisch ungünstig.</li>
<li>Alle Lasten werden proportional gesteigert (Lastfaktor λ), bis kein stabiles Gleichgewicht mehr besteht oder eine Grenzdehnung erreicht ist: Traglastfaktor λu, Ausnutzung η = 1/λu. Zusätzlich wird M_Ed,II ≤ M_Rd(N_Ed) am Querschnitt geprüft.</li>
</ul>
<h3>Vereinfachtes Verfahren (Vergleich)</h3>
<ul>
<li><b>SIA 262</b>: Modellstütze mit e₂ = χ_d·l₀²/π², χ_d = 2·ε_sd/(0.9·d).</li>
<li><b>EN 1992-1-1 5.8.8</b>: Nennkrümmung 1/r = K_r·K_φ·ε_yd/(0.45·d), e₂ = (1/r)·l₀²/10.</li>
</ul>
<h3>Vorzeichen</h3>
<p>N als Druck positiv. Momente positiv, wenn die Druckseite rechts liegt (M = N·e mit Exzentrizität nach +z bzw. +y). H und q positiv nach rechts. Gleiche Vorzeichen von M oben und M unten bedeuten einfache Krümmung. In der Grafik werden Momente auf der Zugseite aufgetragen.</p>
<h3>Lagerung</h3>
<p>Momente an eingespannten Enden gehen direkt ins Auflager; eine Horizontalkraft am gehaltenen Kopf wird vom Auflager aufgenommen. Drehfedern (MNm/rad) bilden elastische Einspannungen ab. Bei «Andere Lagerung für Biegung um z» werden beide Richtungen getrennt modelliert.</p>
<h3>Grenzen</h3>
<ul>
<li>Normalkraft konstant über die Höhe, doppelt symmetrische Querschnitte, keine Betonzugfestigkeit.</li>
<li>Zweiachsige Biegung über getrennte Biegeebenen und Querschnittsinteraktion (Imperfektion nur in einer Richtung).</li>
<li>Querkraft, Bügel, Konstruktionsregeln und Brandschutz sind nicht Teil des Moduls.</li>
</ul>
<p class="muted">Ergebnisse ohne Gewähr – Eingaben und Modellannahmen sind durch die projektierende Person zu prüfen.</p>`;

// ------------------------------------------------------------------ Anwendung

let lastTab = null;
const TAB_VIEW = { system: 'system', section: 'section', loads: 'system' };

createApp({
  id: 'stuetze',
  title: 'Stütze',
  subtitle: 'Stahlbetonstützen nach Theorie 2. Ordnung',
  version: 1,
  defaultProject,
  migrate: (p) => normalize(p),
  examples: EXAMPLES,
  intro: INTRO,
  inputTabs: [
    { id: 'system', label: 'System', render: tabSystem },
    { id: 'section', label: 'Querschnitt', render: tabSection },
    { id: 'loads', label: 'Lasten', render: tabLoads },
    { id: 'params', label: 'Parameter', render: tabParams },
  ],
  // Grafik folgt der Eingabe (nur bei Klick auf ein anderes Register; der Rahmen meldet keine Erstanzeige)
  onTabSwitch(id, app) {
    if (id === lastTab) return;
    lastTab = id;
    if (TAB_VIEW[id] && app.viewMode !== TAB_VIEW[id]) app.setViewMode(TAB_VIEW[id]);
  },
  viewModes: VIEW_MODES,
  viewOptions: (app) => {
    const lcs = app.project?.loadCases || [];
    const list = [];
    if (lcs.length > 1) list.push({ key: 'lc', label: 'Lastfall', type: 'select', default: 0, options: () => lcs.map((l, i) => ({ value: i, label: l.name || `LF ${i + 1}` })) });
    list.push({ key: 'labels', label: 'Beschriftung', type: 'check', default: true });
    return list;
  },
  renderView(v, app, mode) {
    const li = lcIndex(app);
    if (app.viewOpts.lc !== li) app.viewOpts.lc = li;
    if (app.results && lastResultsLc !== li && lastResultsLc !== -1) { lastResultsLc = li; setTimeout(() => app.renderResults(), 0); }
    renderView(v, app, mode);
  },
  autoCompute: true,
  compute: (project) => compute(project),
  renderResults,
  report,
  help: HELP,
});

