// Stahlbau – Stabnachweise nach SIA 263 / EN 1993-1-1: Benutzeroberfläche
import { createApp } from '../../js/core/app.js';
import {
  h, group, numField, selectField, checkField, textField, dataTable, segmented, button, kvTable, resultTable,
  checksTable, summaryCard, stats, note, emptyState, toast, utilBar, badge, svgEl, icon, fmt,
} from '../../js/core/ui.js';
import { STEEL_GRADES } from '../../js/core/materials.js';
import { SERIES, SEARCHABLE, CATALOG, profileNames, findProfile, sectionProps } from './profiles.js';
import { SYSTEMS, CATEGORIES, systemGeometry, autoCombos, defaultFactors } from './beam.js';
import { compute, suggestProfiles, materialFor, SHAPE_OPTIONS, latRestraintPositions } from './calc.js';
import { defaultProject, EXAMPLES } from './examples.js';
import { drawSystem, drawForces, drawDeflection, drawSection } from './draw.js';
import { buildReport } from './bericht.js';

const ch = (app) => () => app.changed();
const chI = (app) => () => app.changed({ inputs: true });

// ------------------------------------------------------------------ Hilfen

function migrate(p) {
  const d = defaultProject();
  const q = { ...d, ...p };
  q.section = { ...d.section, ...(p.section || {}) };
  q.section.welded = { ...d.section.welded, ...(p.section?.welded || {}) };
  q.section.custom = { ...d.section.custom, ...(p.section?.custom || {}) };
  q.beam = { ...d.beam, ...(p.beam || {}) };
  q.forces = { ...d.forces, ...(p.forces || {}) };
  q.combos = { ...d.combos, ...(p.combos || {}) };
  q.sls = { ...d.sls, ...(p.sls || {}) };
  q.stab = { ...d.stab, ...(p.stab || {}) };
  q.gamma = { ...d.gamma, ...(p.gamma || {}) };
  for (const l of q.beam.loads) if (!l.kind) l.kind = l.type === 'N' ? 'N' : `${l.type || 'q'}${l.dir === 'y' ? 'y' : 'z'}`;
  return q;
}

/** Bezugslängen für die Stabilitätseingaben. */
function refLengths(p) {
  try {
    if (p.mode === 'forces') {
      const L = Number(p.forces.L) || 0;
      const r = latRestraintPositions(p, L, [{ x: 0 }, { x: L }], []);
      return { Ly: L, Lz: maxGap(r, L, []), L, fields: [{ x0: 0, x1: L, L }] };
    }
    const g = systemGeometry(p.beam);
    const r = latRestraintPositions(p, g.L, g.supports, g.freeEnds);
    return { Ly: Math.max(...g.fields.map((f) => f.L)), Lz: maxGap(r, g.L, g.freeEnds), L: g.L, fields: g.fields };
  } catch { return null; }
}
function maxGap(r, L) {
  const pts = [0, ...r, L].sort((a, b) => a - b);
  let m = 0;
  for (let i = 1; i < pts.length; i++) m = Math.max(m, pts[i] - pts[i - 1]);
  return m;
}

function lcList(p) {
  const l = [...(p.beam.loadCases || [])];
  if (p.beam.selfWeight) l.unshift({ id: 'EG', name: 'Eigengewicht', cat: 'G', auto: true });
  return l;
}

function shapeIcon(shape, psi = 1) {
  const f = { lin: (x) => 1 + (psi - 1) * x, q: (x) => 4 * x * (1 - x), P: (x) => 2 * Math.min(x, 1 - x), qe: (x) => 1 - 6 * x + 6 * x * x }[shape] || (() => 1);
  const pts = Array.from({ length: 21 }, (_, i) => [4 + i * 2.6, 13 + 8 * f(i / 20)]);
  const s = svgEl('svg', { viewBox: '0 0 60 26', width: 60, height: 26, 'aria-hidden': 'true', style: { flex: 'none' } });
  s.append(svgEl('polygon', { points: [[4, 13], ...pts, [56, 13]].map((q) => q.join(',')).join(' '), style: { fill: 'var(--c-pos-fill)', stroke: 'var(--c-pos)', strokeWidth: 1.2 } }));
  s.append(svgEl('line', { x1: 4, y1: 13, x2: 56, y2: 13, style: { stroke: 'var(--text-2)', strokeWidth: 1.4 } }));
  return s;
}

const INFO = {
  series: 'Gewalzte Profile nach Normtabelle (Querschnittswerte werden aus den Nennmassen inkl. Ausrundungen berechnet), ein geschweisster I-Querschnitt mit frei wählbaren Blechen oder ganz eigene Querschnittswerte.',
  norm: '<b>SIA 263</b>: γM0 = γM1 = 1.05, Lastbeiwerte nach SIA 260, Kippen nach SIA 263.<br><b>EN 1993-1-1</b>: γM0 = γM1 = 1.0 (empfohlene Werte), Lastbeiwerte nach EN 1990.<br>Die Nachweisformeln folgen in beiden Fällen der Nummerierung von EN 1993-1-1.',
  steel: 'Streckgrenze fy nach SIA 263 Tab. 1 bzw. EN 1993-1-1 Tab. 3.1. Für Bleche dicker als 40 mm wird fy automatisch abgemindert.',
  gamma: 'Widerstandsbeiwerte: γM0 für den Querschnittswiderstand, γM1 für die Stabilitätsnachweise (Knicken, Kippen).',
  mode: '<b>Träger mit Lasten</b>: System und Lasten eingeben – Schnittgrössen, Kombinationen und Durchbiegungen werden berechnet.<br><b>Schnittgrössen direkt</b>: Bemessungswerte N, My, Mz, Vz, Vy aus einer anderen Berechnung übernehmen (z.B. Stütze aus einem Rahmen).',
  selfWeight: 'Das Eigengewicht g = A · 78.5 kN/m³ wird als ständige Last (Lastfall «Eigengewicht») automatisch angesetzt. Es greift im Schwerpunkt an.',
  loadCases: 'Ein Lastfall fasst Lasten gleicher Herkunft zusammen. Die Kategorie bestimmt die Teilsicherheits- und Kombinationsbeiwerte. Für feldweise Nutzlast bei Durchlaufträgern je Feld einen eigenen Lastfall anlegen.',
  loads: 'Lasten in z wirken nach unten (Schwerkraft) und erzeugen My; Lasten in y wirken horizontal und erzeugen Mz. Normalkraft: Druck positiv, konstant über die Stablänge.',
  forces: 'Bemessungswerte (bereits mit Lastbeiwerten multipliziert). Vorzeichen: N als Druck positiv. My und Mz sind die betragsmässig grössten Momente; der Verlauf bestimmt C1 (Kippen) und die Momentenbeiwerte Cm.',
  psi: 'Endmomentenverhältnis ψ = M(Stabende) / M(Stabanfang) zwischen −1 und +1. ψ = 1: konstantes Moment, ψ = 0: Dreieck, ψ = −1: Doppelkrümmung (günstig).',
  beta: 'Knicklänge Lcr = β · Bezugslänge. β = 1.0 für beidseitig gelenkig gehaltene Stäbe, 0.7 für einseitig eingespannt, 0.5 für beidseitig eingespannt, 2.0 für Kragstützen.',
  betaZ: 'Bezugslänge für das Knicken um die schwache Achse ist der grösste Abstand zwischen seitlichen Halterungen (Auflager und zusätzliche Halterungen).',
  sway: 'Seitenverschiebliche Systeme (z.B. Kragstütze, unverschieblich nicht gehaltener Rahmen): Momentenbeiwert Cm = 0.9 nach EN 1993-1-1 Tab. B.3.',
  ltb: 'Biegedrillknicken (Kippen) tritt bei offenen Querschnitten unter Biegung um die starke Achse auf: Der gedrückte Gurt weicht seitlich aus und der Träger verdreht sich.',
  cont: 'Ist der Druckgurt durchgehend seitlich gehalten (z.B. durch eine schubsteife Decke, Trapezblech mit genügender Verbindung), kann der Träger nicht kippen – der Kippnachweis entfällt.',
  loadPos: 'Lasten auf dem Obergurt wirken destabilisierend (sie verstärken die Verdrehung) und reduzieren Mcr deutlich. Lasten am Untergurt wirken stabilisierend.',
  k: 'Seitliche Einspannung der Stabenden (Drehung um die z-Achse). k = 1.0: Gabellager, frei drehbar (Normalfall, auf der sicheren Seite).',
  kw: 'Wölbeinspannung der Stabenden. kw = 1.0: freie Verwölbung (Normalfall). kw = 0.5 nur bei konstruktiv wölbsteifen Anschlüssen (z.B. Stirnplatten mit Steifen, Einspannung eines Kragarms).',
  mcr: '<b>3-Faktoren-Formel</b>: Mcr = C1·π²EIz/(kL)²·{√[(k/kw)²·Iw/Iz + (kL)²·GIt/(π²EIz) + (C2·zg)²] − C2·zg} mit C1, C2 aus Tabellen (NCCI SN003).<br><b>Eigenwertanalyse</b>: genaue Lösung für beliebige Momentenverläufe, Kragarme und Halterungen (FE-Biegedrillstab).',
  cAuto: 'C1 berücksichtigt den Momentenverlauf (konstant: 1.0, Gleichlast: 1.13, Dreieck: 1.77). C2 erfasst den Lastangriffspunkt. Nicht tabellierte Verläufe werden automatisch mit der Eigenwertanalyse gerechnet.',
  chiLT: '<b>Nach Norm</b>: SIA → SIA 263 (αLT = 0.21 gewalzt / 0.49 geschweisst, λ̄LT,0 = 0.4); EN → 6.3.2.3 für I-Profile (mit Modifikation f), sonst 6.3.2.2.',
  restraints: 'Stellen, an denen der Träger seitlich und gegen Verdrehen gehalten ist (Gabellager), z.B. durch Querträger, Pfetten mit Verband oder Kopfbänder. An den Auflagern ist der Träger immer gehalten.',
  factors: 'Teilsicherheitsbeiwerte γ und Kombinationsbeiwerte ψ nach SIA 260 (Tab. 1, Tab. 2) bzw. EN 1990 (Tab. A1.1, A1.2(B)). γG,inf wird für günstig wirkende ständige Lasten bei Durchlaufträgern und Kragarmen verwendet.',
  combos: 'Tragsicherheit: γG·G + γQ·Q1 + Σ γQ·ψ0·Qi (jede veränderliche Last einmal als Leiteinwirkung). Gebrauch charakteristisch: G + Q1 + Σ ψ0·Qi; quasi-ständig: G + Σ ψ2·Qi.',
  sls: 'Grenzwerte der Durchbiegung als Bruchteil der Spannweite, z.B. L/300. Bei Kragarmen wird die doppelte Kraglänge eingesetzt (2·L/300).',
  suggest: 'Durchsucht die gewählte Reihe mit allen aktuellen Eingaben (Lasten, Knicklängen, Halterungen) und findet das leichteste Profil, das alle Nachweise erfüllt.',
};

// ------------------------------------------------------------------ Register 1: Profil

function renderProfile(el, app) {
  const p = app.project, s = p.section;
  const isCat = !!CATALOG[s.series];
  const kids = [
    selectField('Profilreihe', s, 'series', SERIES.map((x) => ({ value: x.id, label: x.label })), {
      wide: true, info: INFO.series,
      onChange: () => { if (CATALOG[s.series] && !findProfile(s.series, s.name)) s.name = CATALOG[s.series][Math.min(8, CATALOG[s.series].length - 1)].name; if (SEARCHABLE.includes(s.series)) p.suggestSeries = s.series; chI(app)(); },
    }),
  ];
  if (isCat) {
    const names = profileNames(s.series);
    const step = (d) => { const i = names.indexOf(s.name); const j = Math.max(0, Math.min(names.length - 1, i + d)); if (j !== i) { s.name = names[j]; chI(app)(); } };
    const f = selectField('Profil', s, 'name', names, { onChange: chI(app) });
    f.lastChild.replaceWith(h('span', { class: 'row', style: { gap: '2px', flexWrap: 'nowrap' } },
      button('', { icon: 'minus', small: true, ghost: true, title: 'Nächstkleineres Profil', onClick: () => step(-1) }),
      button('', { icon: 'plus', small: true, ghost: true, title: 'Nächstgrösseres Profil', onClick: () => step(1) })));
    f.style.gridTemplateColumns = 'minmax(110px, 1.1fr) minmax(80px, 1fr) auto';
    kids.push(f);
  } else if (s.series === 'WI') {
    const w = s.welded;
    kids.push(
      numField('Höhe h', w, 'h', { unit: 'mm', min: 1, onChange: ch(app), info: 'Gesamthöhe des Trägers.' }),
      numField('Flanschbreite b', w, 'b', { unit: 'mm', min: 1, onChange: ch(app) }),
      numField('Stegdicke tw', w, 'tw', { unit: 'mm', min: 0.1, onChange: ch(app) }),
      numField('Flanschdicke tf', w, 'tf', { unit: 'mm', min: 0.1, onChange: ch(app) }),
      numField('Halsnaht a', w, 'a', { unit: 'mm', min: 0, onChange: ch(app), info: 'Kehlnahtdicke der Halsnähte. Sie verkürzt die gedrückten Blechbreiten c für die Querschnittsklassifizierung (c = … − √2·a), wird aber in den Querschnittswerten nicht angerechnet.' }));
  } else {
    const u = s.custom;
    kids.push(
      textField('Bezeichnung', u, 'name', { onChange: ch(app) }),
      h('div', { class: 'grid2' },
        numField('Höhe h', u, 'h', { unit: 'mm', min: 1, onChange: ch(app), info: 'Für den Lastangriffspunkt beim Kippen (±h/2) und die Darstellung.' }),
        numField('Breite b', u, 'b', { unit: 'mm', min: 1, onChange: ch(app) }),
        numField('A', u, 'A', { unit: 'cm²', min: 0, onChange: ch(app) }),
        numField('Avz', u, 'Avz', { unit: 'cm²', min: 0, onChange: ch(app), info: 'Schubfläche für Querkraft Vz.' }),
        numField('Iy', u, 'Iy', { unit: 'cm⁴', min: 0, onChange: ch(app) }),
        numField('Iz', u, 'Iz', { unit: 'cm⁴', min: 0, onChange: ch(app) }),
        numField('Wel,y', u, 'Wely', { unit: 'cm³', min: 0, onChange: ch(app) }),
        numField('Wel,z', u, 'Welz', { unit: 'cm³', min: 0, onChange: ch(app) }),
        numField('Wpl,y', u, 'Wply', { unit: 'cm³', min: 0, onChange: ch(app) }),
        numField('Wpl,z', u, 'Wplz', { unit: 'cm³', min: 0, onChange: ch(app) }),
        numField('It', u, 'It', { unit: 'cm⁴', min: 0, onChange: ch(app), info: 'Torsionsträgheitsmoment (St. Venant).' }),
        numField('Iw', u, 'Iw', { unit: 'cm⁶', min: 0, onChange: ch(app), info: 'Wölbwiderstand. 0 für Hohlprofile.' })),
      selectField('Querschnittsklasse', u, 'cls', [1, 2, 3].map((c) => ({ value: c, label: `Klasse ${c}` })), { onChange: ch(app), info: 'Klassen 1/2: plastische Widerstände, Klasse 3: elastische. Klasse 4 ist für benutzerdefinierte Werte nicht vorgesehen.' }),
      h('div', { class: 'grid2' },
        selectField('Knicklinie y', u, 'curveY', ['a0', 'a', 'b', 'c', 'd'], { onChange: ch(app) }),
        selectField('Knicklinie z', u, 'curveZ', ['a0', 'a', 'b', 'c', 'd'], { onChange: ch(app) })),
      selectField('Kipplinie', u, 'ltbCurve', ['a', 'b', 'c', 'd'], { onChange: ch(app), info: 'Kipplinie für das allgemeine Verfahren (EN 1993-1-1 Tab. 6.4).' }));
  }
  let sec = null;
  try { sec = sectionProps(s); } catch (e) { kids.push(note(e.message, 'fail')); }
  if (sec) {
    const mat = materialFor(p, sec);
    const tiles = stats([
        ['h × b', `${fmt(sec.h, 0)} × ${fmt(sec.b, 0)}`, 'mm'],
        ['Masse', sec.mass, 'kg/m', 1],
        ['A', sec.A / 100, 'cm²', 1],
        ['Iy', sec.Iy / 1e4, 'cm⁴', 0],
        ['Wpl,y', sec.Wply / 1e3, 'cm³', 0],
        ['fy', mat.fy, 'N/mm²', 0],
      ]);
    tiles.style.marginTop = '8px';
    kids.push(tiles);
  }
  el.append(group('Querschnitt', kids, { info: 'Profil wählen. Mit − / + gelangt man zum nächstkleineren bzw. -grösseren Profil der Reihe.' }));

  el.append(group('Werkstoff und Norm', [
    selectField('Norm', p, 'norm', [{ value: 'SIA', label: 'SIA 263 (Schweiz)' }, { value: 'EC', label: 'EN 1993-1-1 (Eurocode)' }], {
      wide: true, info: INFO.norm,
      onChange: () => { p.combos.factors = null; toast('Last- und Widerstandsbeiwerte auf die Werte der gewählten Norm gesetzt.', 'info'); chI(app)(); },
    }),
    selectField('Stahlsorte', p, 'steel', STEEL_GRADES, { onChange: chI(app), info: INFO.steel }),
    checkField('Widerstandsbeiwerte nach Norm', p.gamma, 'auto', { onChange: (v) => { if (!v) { const d = p.norm === 'EC' ? 1.0 : 1.05; p.gamma.M0 = d; p.gamma.M1 = d; } chI(app)(); }, info: INFO.gamma }),
    p.gamma.auto === false ? h('div', { class: 'grid2' },
      numField('γM0', p.gamma, 'M0', { min: 0.8, max: 2, onChange: ch(app), info: 'Querschnittswiderstand' }),
      numField('γM1', p.gamma, 'M1', { min: 0.8, max: 2, onChange: ch(app), info: 'Stabilität' })) : null,
  ]));

  const search = { series: SEARCHABLE.includes(p.suggestSeries) ? p.suggestSeries : 'IPE' };
  el.append(group('Profil vorschlagen', [
    selectField('Reihe durchsuchen', search, 'series', SERIES.filter((x) => SEARCHABLE.includes(x.id)).map((x) => ({ value: x.id, label: x.label })), { wide: true, onChange: (v) => { p.suggestSeries = v; } }),
    h('div', { class: 'row end', style: { marginTop: '6px' } },
      button('Leichtestes Profil suchen', { icon: 'play', primary: true, onClick: () => runSuggest(app, search.series) })),
  ], { info: INFO.suggest }));
}

function runSuggest(app, series) {
  try {
    const t0 = performance.now();
    const res = suggestProfiles(app.project, series);
    app.suggest = { ...res, stamp: stampOf(app.project), ms: performance.now() - t0 };
    app.renderResults();
    if (res.best) toast(`${res.best.name} ist das leichteste Profil der Reihe ${series}, das alle Nachweise erfüllt (η = ${fmt(res.best.eta, 2)}).`, 'ok', 5000);
    else toast(`Kein Profil der Reihe ${series} erfüllt alle Nachweise. Grössere Reihe wählen oder Halterungen ergänzen.`, 'warn', 5000);
  } catch (e) {
    toast(`Profilsuche nicht möglich: ${e.message}`, 'error');
  }
}
function stampOf(p) { const q = { ...p, section: null, meta: null }; return JSON.stringify(q); }

// ------------------------------------------------------------------ Register 2: Belastung

function renderLoads(el, app) {
  const p = app.project;
  el.append(group('Eingabeart', [
    segmented([{ id: 'beam', label: 'Träger mit Lasten' }, { id: 'forces', label: 'Schnittgrössen direkt' }], p.mode, (id) => { p.mode = id; chI(app)(); }),
  ], { info: INFO.mode }));
  if (p.mode === 'forces') return renderForcesInput(el, app);
  const b = p.beam;
  // System
  const sysKids = [
    selectField('System', b, 'system', SYSTEMS, {
      wide: true,
      onChange: (v) => {
        const st = p.stab;
        if (v === 'cant') { Object.assign(st, { betaY: 2, betaZ: 2, swayY: true, swayZ: true, k: 0.7, kw: 0.7, mcr: 'fe' }); toast('Für den Kragarm wurden Knicklängen (β = 2), Einspannung (k = kw = 0.7) und die Eigenwertanalyse eingestellt.', 'info', 5000); } else if (st.betaY === 2 && st.swayY) Object.assign(st, { betaY: 1, betaZ: 1, swayY: false, swayZ: false, k: 1, kw: 1, mcr: 'formula' });
        if (v === 'cont' && b.spans.length < 2) b.spans = [b.spans[0] || 5, b.spans[0] || 5];
        chI(app)();
      },
    }),
  ];
  if (b.system === 'cont') {
    const rows = b.spans.map((L) => ({ L }));
    sysKids.push(dataTable([{ key: 'L', label: 'Spannweite', unit: 'm', min: 0.01 }], rows, {
      newRow: () => ({ L: rows[rows.length - 1]?.L || 5 }), minRows: 2, hint: 'Felder von links nach rechts',
      onChange: (e) => { b.spans = rows.map((r) => r.L); if (e.type === 'edit') ch(app)(); else chI(app)(); },
      rowLabel: (i) => `Feld ${i + 1}`,
    }));
  } else {
    const proxy = { L: b.spans[0] };
    sysKids.push(numField(b.system === 'cant' ? 'Kraglänge L' : 'Spannweite L', proxy, 'L', { unit: 'm', min: 0.01, onChange: (v) => { b.spans = [v, ...b.spans.slice(1)]; ch(app)(); } }));
    if (b.system === 'ss-cant') sysKids.push(numField('Kraglänge a (rechts)', b, 'overhang', { unit: 'm', min: 0.01, onChange: ch(app) }));
  }
  sysKids.push(checkField('Eigengewicht des Profils automatisch', b, 'selfWeight', { onChange: chI(app), info: INFO.selfWeight }));
  el.append(group('Statisches System', sysKids, { info: 'Die Auflager halten den Träger vertikal und seitlich (Gabellager). Eingespannte Auflager verhindern zusätzlich die Verdrehung in der Ebene.' }));

  // Lastfälle
  const nextId = () => { let i = 1; while (b.loadCases.some((l) => l.id === `L${i}`)) i++; return `L${i}`; };
  el.append(group('Lastfälle', [
    dataTable([
      { key: 'name', label: 'Bezeichnung', type: 'text' },
      { key: 'cat', label: 'Kategorie', type: 'select', options: CATEGORIES, width: '130px', info: 'Ständig: γG = 1.35; veränderlich: γQ = 1.5 mit ψ-Beiwerten der Kategorie.' },
    ], b.loadCases, {
      newRow: () => ({ id: nextId(), name: `Lastfall ${b.loadCases.length + 1}`, cat: 'Nutzlast' }), minRows: 1, hint: '',
      onChange: (e) => {
        if (e.type === 'remove') { const ids = new Set(b.loadCases.map((l) => l.id)); b.loads = b.loads.filter((l) => ids.has(l.lc)); }
        chI(app)();
      },
    }),
  ], { info: INFO.loadCases }));

  // Lasten
  const kids = [];
  if (!b.loads.length) kids.push(emptyState('Noch keine Lasten', 'Mit «+ Zeile» eine Linienlast, Einzellast oder Normalkraft hinzufügen. Leere Felder bedeuten: über die ganze Länge bzw. konstant.'));
  kids.push(dataTable([
    { key: 'lc', label: 'Lastfall', type: 'select', options: () => b.loadCases.map((l) => ({ value: l.id, label: l.name })), width: '96px' },
    { key: 'kind', label: 'Art', type: 'select', width: '110px', options: [
      { value: 'qz', label: 'Linienlast ↓' }, { value: 'Pz', label: 'Einzellast ↓' },
      { value: 'qy', label: 'Linienlast → (y)' }, { value: 'Py', label: 'Einzellast → (y)' }, { value: 'N', label: 'Normalkraft' }],
      info: '↓ vertikal (Schwerkraft, erzeugt My); → horizontal in y (erzeugt Mz); Normalkraft als Druck positiv.' },
    { key: 'v1', label: 'Wert', unit: 'kN/m · kN', info: 'Linienlast q [kN/m] (bei Trapezlast Anfangswert), Einzellast P [kN], Normalkraft N [kN]. Negativ = nach oben (z.B. Windsog).' },
    { key: 'v2', label: 'Endwert', unit: 'kN/m', allowEmpty: true, info: 'Nur für Trapez- und Dreieckslasten: Wert am Ende x₂. Leer = konstant.' },
    { key: 'x1', label: 'x₁', unit: 'm', allowEmpty: true, info: 'Linienlast: Beginn (leer = Trägeranfang). Einzellast: Position (leer = Feldmitte).' },
    { key: 'x2', label: 'x₂', unit: 'm', allowEmpty: true, info: 'Linienlast: Ende (leer = Trägerende).' },
  ], b.loads, {
    newRow: () => ({ lc: b.loadCases[b.loadCases.length - 1]?.id || 'G', kind: 'qz', v1: 5, v2: null, x1: null, x2: null }),
    onChange: (e) => (e.type === 'edit' ? ch(app)() : chI(app)()),
    hint: 'x ab linkem Trägerende',
  }));
  el.append(group('Lasten', kids, { info: INFO.loads }));
}

function renderForcesInput(el, app) {
  const p = app.project, F = p.forces;
  el.append(group('Stab', [
    numField('Stablänge L', F, 'L', { unit: 'm', min: 0.01, onChange: chI(app), info: 'Systemlänge zwischen den Gabellagern. Bezugslänge für Knicken (Lcr = β·L) und Kippen.' }),
    selectField('Darstellung', F, 'orient', [{ value: 'h', label: 'Träger (horizontal)' }, { value: 'v', label: 'Stütze (vertikal)' }], { wide: true, onChange: ch(app) }),
  ]));
  const cases = F.cases;
  app.selCase = Math.min(app.selCase ?? 0, Math.max(0, cases.length - 1));
  const list = h('div', { class: 'list' });
  cases.forEach((c, i) => {
    list.append(h('div', { class: `list-item${i === app.selCase ? ' active' : ''}`, onclick: () => { app.selCase = i; app.renderInputs(); } },
      h('span', { class: 'badge info' }, String(i + 1)),
      h('span', { class: 'grow' }, c.name || `Situation ${i + 1}`),
      h('span', { class: 'muted small mono' }, `N ${fmt(c.N || 0, 0)} · My ${fmt(c.My || 0, 1)} · Mz ${fmt(c.Mz || 0, 1)}`)));
  });
  const add = () => { cases.push({ name: `Situation ${cases.length + 1}`, N: 0, My: 0, Mz: 0, Vz: 0, Vy: 0, shapeY: 'lin', psiY: 1, shapeZ: 'lin', psiZ: 1 }); app.selCase = cases.length - 1; chI(app)(); };
  const kids = [];
  if (!cases.length) kids.push(emptyState('Noch keine Schnittgrössen', 'Mit «Situation hinzufügen» eine Bemessungssituation mit N, My, Mz … erfassen.'));
  else kids.push(list);
  kids.push(h('div', { class: 'row', style: { margin: '0 0 8px' } },
    button('Situation hinzufügen', { icon: 'plus', small: true, onClick: add }),
    cases.length ? button('Duplizieren', { icon: 'copy', small: true, onClick: () => { cases.splice(app.selCase + 1, 0, { ...cases[app.selCase], name: `${cases[app.selCase].name} (Kopie)` }); app.selCase++; chI(app)(); } }) : null,
    cases.length ? button('Löschen', { icon: 'trash', small: true, ghost: true, onClick: () => { cases.splice(app.selCase, 1); app.selCase = Math.max(0, app.selCase - 1); chI(app)(); } }) : null));
  const c = cases[app.selCase];
  if (c) {
    const shapeRow = (label, key, psiKey, axis) => {
      const wrap = h('div');
      const draw = () => {
        wrap.replaceChildren(
          h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '8px' } },
            h('div', { style: { flex: 1 } }, selectField(label, c, key, SHAPE_OPTIONS, { onChange: () => { draw(); ch(app)(); }, info: `Verlauf von ${axis} über die Stablänge. Bestimmt C1 (Kippen) und Cm (Interaktion).` })),
            shapeIcon(c[key], c[psiKey])),
          c[key] === 'lin' ? numField(`ψ (${axis})`, c, psiKey, { min: -1, max: 1, onChange: () => { draw(); ch(app)(); }, info: INFO.psi }) : null);
      };
      draw();
      return wrap;
    };
    kids.push(h('div', { class: 'group', style: { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)' } },
      textField('Bezeichnung', c, 'name', { onChange: chI(app) }),
      numField('N_Ed (Druck +)', c, 'N', { unit: 'kN', onChange: chI(app), info: 'Normalkraft, Druck positiv, Zug negativ.' }),
      numField('My,Ed', c, 'My', { unit: 'kNm', onChange: chI(app), info: 'Grösstes Biegemoment um die starke Achse (Stabanfang bei linearem Verlauf).' }),
      numField('Mz,Ed', c, 'Mz', { unit: 'kNm', onChange: chI(app), info: 'Grösstes Biegemoment um die schwache Achse.' }),
      numField('Vz,Ed', c, 'Vz', { unit: 'kN', onChange: ch(app), info: 'Querkraft in z-Richtung (wird über die ganze Länge angesetzt).' }),
      numField('Vy,Ed', c, 'Vy', { unit: 'kN', onChange: ch(app) }),
      shapeRow('Verlauf My', 'shapeY', 'psiY', 'My'),
      shapeRow('Verlauf Mz', 'shapeZ', 'psiZ', 'Mz')));
  }
  el.append(group('Bemessungsschnittgrössen', kids, { info: INFO.forces }));
}

// ------------------------------------------------------------------ Register 3: Kombinationen

function renderCombos(el, app) {
  const p = app.project;
  if (p.mode === 'forces') {
    el.append(emptyState('Keine Kombinationen nötig', 'Bei direkter Eingabe sind die Schnittgrössen bereits Bemessungswerte. Jede Situation im Register «Belastung» wird als eigene Kombination nachgewiesen.'));
    return;
  }
  const C = p.combos;
  const F = C.factors || (C.factors = defaultFactors(p.norm));
  el.append(group('Beiwerte', [
    h('div', { class: 'grid2' },
      numField('γG (ungünstig)', F, 'gG', { min: 0, onChange: ch(app) }),
      numField('γG,inf (günstig)', F, 'gGinf', { min: 0, onChange: ch(app), info: 'Für ständige Lasten, die entlastend wirken (Kragarm, Durchlaufträger).' }),
      numField('γQ', F, 'gQ', { min: 0, onChange: ch(app) })),
    (() => {
      const rows = Object.entries(F.psi).map(([cat, a]) => ({ cat, p0: a[0], p1: a[1], p2: a[2] }));
      return dataTable([
        { key: 'cat', label: 'Kategorie', type: 'calc', calc: (r) => r.cat },
        { key: 'p0', label: 'ψ0', info: 'Kombinationsbeiwert (Begleiteinwirkung)' },
        { key: 'p1', label: 'ψ1', info: 'häufiger Wert (nur informativ)' },
        { key: 'p2', label: 'ψ2', info: 'quasi-ständiger Wert' },
      ], rows, { canAdd: false, canRemove: false, numbered: false, hint: '', onChange: () => { for (const r of rows) F.psi[r.cat] = [r.p0, r.p1, r.p2]; ch(app)(); } });
    })(),
    h('div', { class: 'row end' }, button('Normwerte', { small: true, icon: 'undo', onClick: () => { C.factors = null; chI(app)(); } })),
  ], { info: INFO.factors }));

  const lcs = lcList(p);
  const kids = [checkField('Kombinationen automatisch erzeugen (empfohlen)', C, 'auto', {
    onChange: (v) => { if (!v && !(C.manual || []).length) C.manual = toManual(p); chI(app)(); },
  })];
  if (C.auto !== false) {
    const pattern = p.beam.system === 'cont' || p.beam.system === 'ss-cant';
    const list = autoCombos(lcs, F, { pattern });
    kids.push(resultTable(['', 'Kombination'], list.map((c) => [badge(c.type === 'ULS' ? 'Trag.' : c.type === 'SLS-char' ? 'Gebr.' : 'q.-st.', c.type === 'ULS' ? 'info' : 'ok'), c.name.replace(/^[^:]+: /, '')])));
    if (pattern) kids.push(note('Durchlaufträger/Kragarm: Begleitlasten werden auch weggelassen und ständige Lasten mit γG,inf kombiniert (ungünstigste Laststellung).', ''));
  } else {
    const cols = [
      { key: 'name', label: 'Bezeichnung', type: 'text', width: '110px' },
      { key: 'type', label: 'Typ', type: 'select', width: '96px', options: [{ value: 'ULS', label: 'Tragsicherheit' }, { value: 'SLS-char', label: 'Gebrauch char.' }, { value: 'SLS-qp', label: 'quasi-ständig' }] },
      ...lcs.map((l) => ({ key: `f_${l.id}`, label: l.name.length > 10 ? `${l.name.slice(0, 9)}…` : l.name, title: l.name, allowEmpty: true, width: '64px' })),
    ];
    kids.push(dataTable(cols, C.manual, {
      newRow: () => ({ name: `Kombination ${C.manual.length + 1}`, type: 'ULS', ...Object.fromEntries(lcs.map((l) => [`f_${l.id}`, l.cat === 'G' ? F.gG : F.gQ])) }),
      onChange: (e) => (e.type === 'edit' ? ch(app)() : chI(app)()), hint: 'Faktoren je Lastfall',
    }));
    kids.push(h('div', { class: 'row end' }, button('Aus automatischen übernehmen', { small: true, icon: 'copy', onClick: () => { C.manual = toManual(p); chI(app)(); } })));
  }
  el.append(group('Kombinationen', kids, { info: INFO.combos }));

  el.append(group('Durchbiegungsgrenzen', [
    numField('charakteristisch   L /', p.sls, 'limitChar', { min: 1, onChange: ch(app), info: 'Funktionstüchtigkeit (z.B. L/300). Charakteristische Kombination.' }),
    numField('quasi-ständig   L /', p.sls, 'limitQp', { min: 1, onChange: ch(app), info: 'Aussehen (z.B. L/250 bzw. L/300). Quasi-ständige Kombination.' }),
  ], { info: INFO.sls }));
}

function toManual(p) {
  const lcs = lcList(p);
  const F = p.combos.factors || defaultFactors(p.norm);
  const pattern = p.beam.system === 'cont' || p.beam.system === 'ss-cant';
  return autoCombos(lcs, F, { pattern }).map((c, i) => ({
    name: `${c.type === 'ULS' ? 'ULS' : c.type === 'SLS-char' ? 'SLS' : 'QS'} ${i + 1}`, type: c.type,
    ...Object.fromEntries(lcs.map((l) => [`f_${l.id}`, c.factors[l.id] || 0])),
  }));
}

// ------------------------------------------------------------------ Register 4: Stabilität

function renderStability(el, app) {
  const p = app.project, st = p.stab;
  const ref = refLengths(p);
  let sec = null;
  try { sec = sectionProps(p.section); } catch { /* */ }
  const hint = (beta, L, axis) => (ref ? `Lcr,${axis} = ${fmt(Number(beta) || 0, 2)} · ${fmt(L, 2)} m = ${fmt((Number(beta) || 0) * L, 2)} m` : '');
  el.append(group('Biegeknicken', [
    numField('βy (Knicken um y-y)', st, 'betaY', { min: 0.1, max: 10, onChange: chI(app), info: INFO.beta, help: ref ? `${hint(st.betaY, ref.Ly, 'y')} (Bezug: ${p.mode === 'forces' ? 'Stablänge' : 'grösstes Feld'})` : '' }),
    numField('βz (Knicken um z-z)', st, 'betaZ', { min: 0.1, max: 10, onChange: chI(app), info: `${INFO.beta}<br>${INFO.betaZ}`, help: ref ? `${hint(st.betaZ, ref.Lz, 'z')} (Bezug: grösster Abstand der Halterungen)` : '' }),
    checkField('seitenverschieblich in z (Cmy = 0.9)', st, 'swayY', { onChange: ch(app), info: INFO.sway }),
    checkField('seitenverschieblich in y (Cmz = 0.9)', st, 'swayZ', { onChange: ch(app), info: INFO.sway }),
  ], { info: 'Knicklängen für den Nachweis nach EN 1993-1-1 6.3.1. Die Knicklinien (a0 … d) werden aus Profiltyp, h/b, Flanschdicke und Stahlsorte bestimmt.' }));

  const ltbKids = [];
  if (sec?.closed) ltbKids.push(note('Hohlprofile sind wegen ihrer grossen Torsionssteifigkeit nicht kippgefährdet – der Kippnachweis entfällt.', 'ok'));
  else {
    ltbKids.push(
      checkField('Kippnachweis führen', st, 'ltb', { onChange: chI(app), info: INFO.ltb }),
      checkField('Druckgurt durchgehend seitlich gehalten', st, 'contRestraint', { onChange: chI(app), info: INFO.cont }));
    if (st.ltb !== false && !st.contRestraint) {
      ltbKids.push(
        selectField('Lastangriffspunkt', st, 'loadPos', [{ value: 'top', label: 'Obergurt (destabilisierend)' }, { value: 'centroid', label: 'Schwerpunkt' }, { value: 'bottom', label: 'Untergurt (stabilisierend)' }], { wide: true, onChange: ch(app), info: INFO.loadPos }),
        selectField('Seitliche Einspannung k', st, 'k', [{ value: 1, label: 'k = 1.0 – Gabellager' }, { value: 0.7, label: 'k = 0.7 – Anfang eingespannt' }, { value: 0.5, label: 'k = 0.5 – beide Enden' }], { wide: true, onChange: ch(app), info: INFO.k }),
        selectField('Wölbeinspannung kw', st, 'kw', [{ value: 1, label: 'kw = 1.0 – frei' }, { value: 0.7, label: 'kw = 0.7 – Anfang wölbsteif' }, { value: 0.5, label: 'kw = 0.5 – beide Enden' }], { wide: true, onChange: ch(app), info: INFO.kw }),
        selectField('Ermittlung Mcr', st, 'mcr', [{ value: 'formula', label: '3-Faktoren-Formel (C1, C2)' }, { value: 'fe', label: 'Eigenwertanalyse (FE)' }], { wide: true, onChange: chI(app), info: INFO.mcr }));
      if (st.mcr !== 'fe') {
        ltbKids.push(checkField('C1, C2 automatisch aus dem Momentenverlauf', st, 'cAuto', { onChange: chI(app), info: INFO.cAuto }));
        if (st.cAuto === false) ltbKids.push(h('div', { class: 'grid2' },
          numField('C1', st, 'C1', { min: 0.5, max: 4, onChange: ch(app), info: 'Momentenbeiwert (Form des Momentenverlaufs).' }),
          numField('C2', st, 'C2', { min: 0, max: 3, onChange: ch(app), info: 'Beiwert für den Lastangriffspunkt (0 ohne Querlast).' })));
      }
      ltbKids.push(selectField('χLT-Verfahren', st, 'chiLT', [
        { value: 'auto', label: `nach Norm (${p.norm === 'EC' ? 'EN' : 'SIA 263'})` }, { value: 'general', label: 'allgemein – EN 6.3.2.2' },
        { value: 'rolled', label: 'Walzprofile – EN 6.3.2.3' }, { value: 'sia', label: 'SIA 263' }], { wide: true, onChange: ch(app), info: INFO.chiLT }));
    }
  }
  el.append(group('Kippen (Biegedrillknicken)', ltbKids, { info: INFO.ltb }));

  // Seitliche Halterungen
  const L = ref?.L || 0;
  const rows = st.restraints;
  const kids = [];
  if (!rows.length) kids.push(emptyState('Nur an den Auflagern gehalten', 'Zusätzliche seitliche Halterungen (z.B. Querträger) mit «+ Zeile» oder den Schnellwahl-Knöpfen ergänzen.'));
  kids.push(dataTable([{ key: 'x', label: 'Position x', unit: 'm', min: 0, info: 'Abstand vom linken Stabende.' }], rows, {
    newRow: () => ({ x: +(L / 2).toFixed(3) }), onChange: chI(app), hint: L ? `Stab 0 … ${fmt(L, 2)} m` : '',
  }));
  const setR = (fn) => { st.restraints = fn(); chI(app)(); };
  const fields = ref?.fields || [];
  kids.push(h('div', { class: 'row' },
    h('span', { class: 'muted small' }, 'Schnellwahl:'),
    button('Feldmitten', { small: true, onClick: () => setR(() => fields.filter((f) => !f.cant).map((f) => ({ x: +((f.x0 + f.x1) / 2).toFixed(3) }))) }),
    button('Drittelspunkte', { small: true, onClick: () => setR(() => fields.filter((f) => !f.cant).flatMap((f) => [1, 2].map((k) => ({ x: +(f.x0 + f.L * k / 3).toFixed(3) })))) }),
    button('Keine', { small: true, ghost: true, onClick: () => setR(() => []) })));
  el.append(group('Seitliche Halterungen', kids, { info: INFO.restraints }));
}

// ------------------------------------------------------------------ Ergebnisse

function renderResults(el, app) {
  const r = app.results;
  const s = r.sec, u = r.govUls;
  const ok = r.etaMax <= 1.0001;
  const gov = r.gov;
  el.append(summaryCard(r.etaMax, 'Maximale Ausnutzung', h('div', { style: { marginTop: '6px' } },
    h('div', { style: { fontWeight: 600 } }, ok ? `Alle Nachweise erfüllt – ${s.name} in ${r.mat.name} ist ausreichend.` : `Nicht erfüllt: ${gov.label} ist überschritten.`),
    h('div', { class: 'muted small' }, `Massgebend: ${gov.label}${gov.comboName ? ` · ${gov.comboName}` : ''}`),
    ok ? null : h('div', { class: 'small', style: { marginTop: '4px' } }, 'Abhilfe: grösseres Profil wählen («Profil vorschlagen» im Register 1), seitliche Halterungen ergänzen oder höhere Stahlsorte.'))));
  // Kennzahlen
  const st = u.st;
  const segG = (() => { let b = null; for (const x of r.uls) for (const sg of x.st.segments) if (sg.etaLT !== undefined && (!b || sg.etaLT > b.etaLT)) b = sg; return b; })();
  const hasN = r.uls.some((x) => x.Nc > 1e-9);
  const NbRd = hasN ? Math.min(st.NbyRd, st.NbzRd, st.NbTRd ?? Infinity) / 1e3 : null;
  el.append(stats([
    ['Profil', s.name],
    ['Masse', s.mass, 'kg/m', 1],
    ['Querschnittsklasse', String(u.cls)],
    [u.cls <= 2 ? 'Mpl,y,Rd' : u.cls === 3 ? 'Mel,y,Rd' : 'Meff,y,Rd', u.R.McyRd / 1e6, 'kNm', 1],
    hasN ? ['Nb,Rd (min)', NbRd, 'kN', 0] : ['Npl,Rd', u.R.NcRd / 1e3, 'kN', 0],
    segG ? ['Mb,Rd', segG.MbRd / 1e6, 'kNm', 1] : ['Vpl,z,Rd', u.R.VplzRd / 1e3, 'kN', 0],
    segG ? ['Mcr', segG.Mcr / 1e6, 'kNm', 1] : null,
    segG ? ['χLT', segG.chiLT, '', 3] : null,
  ]));
  for (const w of r.warnings) el.append(note(w, 'warn'));

  // Profilsuche
  if (app.suggest) el.append(suggestBlock(app));

  // Nachweise
  for (const grp of ['Querschnitt', 'Stabilität', 'Gebrauchstauglichkeit']) {
    const list = r.checks.filter((c) => c.group === grp);
    if (!list.length) continue;
    el.append(group(grp, [checksTable(list.map((c) => ({
      label: c.label, ref: c.ref, Ed: c.Ed, Rd: c.Rd, unit: c.unit, digits: c.unit === 'mm' ? 1 : 1, eta: c.eta,
      detail: [c.comboName, Number.isFinite(c.x) && c.group !== 'Stabilität' ? `x = ${fmt(c.x, 2)} m` : null, c.seg && c.group === 'Stabilität' ? `Segment ${fmt(c.seg.x0, 2)} … ${fmt(c.seg.x1, 2)} m` : null, c.detail].filter(Boolean).join(' · '),
    })))]));
  }
  if (r.uls.length && !r.checks.some((c) => c.group === 'Stabilität') && !st.ltbActive && st.ltbReason) el.append(note(`Kippen: ${st.ltbReason}.`, ''));

  // Klassifizierung
  el.append(group(`Querschnittsklassifizierung – Klasse ${u.cls}`, [classTable(u), h('div', { class: 'muted small', style: { marginTop: '4px' } }, `ε = √(235/fy) = ${fmt(u.klass.eps, 3)} · unter N = ${fmt(Math.max(0, u.Nc), 1)} kN, My = ${fmt(u.MyMax, 1)} kNm, Mz = ${fmt(u.MzMax, 1)} kNm (${u.combo.name})`)], { collapsible: true, collapsed: true, info: 'Klassifizierung der gedrückten Querschnittsteile nach EN 1993-1-1 Tab. 5.2 unter der tatsächlichen Beanspruchung der massgebenden Kombination.' }));

  // Stabilitätskennwerte
  el.append(group('Stabilitätskennwerte', [stabKV(r, u)], { collapsible: true, collapsed: true, info: 'Zwischenwerte der massgebenden Kombination für Knicken, Kippen und Interaktion.' }));

  // Kombinationen
  if (r.uls.length > 1) {
    el.append(group('Ausnutzung je Kombination', [resultTable(['Kombination', 'Ausnutzung'], r.uls.map((x) => [x.combo.name, utilBar(x.eta)]))], { collapsible: true, collapsed: true }));
  }
  // Querschnittswerte
  el.append(group('Querschnittswerte', [propsKV(s, r.mat)], { collapsible: true, collapsed: true }));
}

function classTable(u) {
  if (!u.klass.parts.length) return note(u.klass.note || 'keine Teilflächen', '');
  const merged = [];
  for (const p of u.klass.parts) {
    const m = merged.find((x) => x.label === p.label);
    if (!m) merged.push({ ...p }); else if (p.cls > m.cls) Object.assign(m, p);
  }
  const lim = (v) => (Number.isFinite(v) ? fmt(v, 1) : '–');
  return resultTable(['Teil', { label: 'c/t', num: true }, { label: 'Kl. 1', num: true }, { label: 'Kl. 2', num: true }, { label: 'Kl. 3', num: true }, 'Klasse'],
    merged.map((p) => [p.label + (p.tension ? ' (Zug)' : ''), fmt(p.ct, 1), lim(p.lim[0]), lim(p.lim[1]), lim(p.lim[2]), badge(String(p.cls), p.cls <= 2 ? 'ok' : p.cls === 3 ? 'info' : 'warn')]));
}

function stabKV(r, u) {
  const st = u.st;
  const seg = st.segments.reduce((a, b) => ((b.etaLT ?? -1) > (a?.etaLT ?? -1) ? b : a), st.segments[0]);
  const rows = [
    ['Lcr,y / Lcr,z', `${fmt(st.LcrY / 1000, 2)} / ${fmt(st.LcrZ / 1000, 2)}`, 'm'],
    ['Knicklinie y / z', `${st.curveY} / ${st.curveZ}`, ''],
    ['Ncr,y', st.NcrY / 1e3, 'kN', 0], ['Ncr,z', st.NcrZ / 1e3, 'kN', 0],
    ['λ̄y / χy', `${fmt(st.lamY, 3)} / ${fmt(st.chiY, 3)}`, ''],
    ['λ̄z / χz', `${fmt(st.lamZ, 3)} / ${fmt(st.chiZ, 3)}`, ''],
    st.torsional ? [r.sec.type === 'U' ? 'Ncr,TF' : 'Ncr,T', st.NcrTorsion / 1e3, 'kN', 0] : null,
    st.torsional ? ['λ̄T / χT', `${fmt(st.lamT, 3)} / ${fmt(st.chiT, 3)}`, ''] : null,
  ];
  if (seg?.Mcr) {
    rows.push(
      ['Kippsegment', `${fmt(seg.x0, 2)} … ${fmt(seg.x1, 2)}`, 'm'],
      ['Mcr', seg.Mcr / 1e6, 'kNm', 1],
      seg.mcrBy === 'formula' ? ['C1 / C2', `${fmt(seg.C1, 3)} / ${fmt(seg.C2, 3)}`, ''] : ['C1 (äquivalent, FE)', seg.C1eq, '', 3],
      ['Ermittlung Mcr', seg.mcrBy === 'formula' ? `Formel – ${seg.csrc}` : `FE – ${seg.csrc}`, ''],
      ['zg (Lastangriff)', seg.zg ?? 0, 'mm', 0],
      ['k / kw', `${fmt(seg.k, 1)} / ${fmt(seg.kw, 1)}`, ''],
      ['λ̄LT / χLT', `${fmt(seg.lamLT, 3)} / ${fmt(seg.chiLT, 3)}`, ''],
      ['Verfahren χLT', { general: 'EN 6.3.2.2', rolled: `EN 6.3.2.3 (f = ${fmt(seg.lt.f, 3)})`, sia: 'SIA 263' }[st.ltbMethod], ''],
    );
  } else rows.push(['Kippen', st.ltbReason || 'nicht massgebend', '']);
  if (seg?.kf) {
    rows.push(
      ['Cmy / Cmz / CmLT', `${fmt(seg.Cmy.Cm, 3)} / ${fmt(seg.Cmz.Cm, 3)} / ${fmt(seg.CmLT.Cm, 3)}`, ''],
      ['kyy / kyz', `${fmt(seg.kf.kyy, 3)} / ${fmt(seg.kf.kyz, 3)}`, ''],
      ['kzy / kzz', `${fmt(seg.kf.kzy, 3)} / ${fmt(seg.kf.kzz, 3)}`, ''],
    );
  }
  return kvTable(rows);
}

function propsKV(s, mat) {
  const rows = [
    ['h / b', `${fmt(s.h, 1)} / ${fmt(s.b, 1)}`, 'mm'],
    s.tw && s.type !== 'RHS' && s.type !== 'CHS' ? ['tw / tf', `${fmt(s.tw, 1)} / ${fmt(s.tf, 1)}`, 'mm'] : null,
    s.t ? ['t', s.t, 'mm', 1] : null,
    s.r ? ['r', s.r, 'mm', 1] : null,
    ['A', s.A / 100, 'cm²', 2],
    ['Iy', s.Iy / 1e4, 'cm⁴', 1], ['Iz', s.Iz / 1e4, 'cm⁴', 1],
    ['Wel,y / Wel,z', `${fmt(s.Wely / 1e3, 1)} / ${fmt(s.Welz / 1e3, 1)}`, 'cm³'],
    ['Wpl,y / Wpl,z', `${fmt(s.Wply / 1e3, 1)} / ${fmt(s.Wplz / 1e3, 1)}`, 'cm³'],
    ['iy / iz', `${fmt(s.iy / 10, 2)} / ${fmt(s.iz / 10, 2)}`, 'cm'],
    ['It', s.It / 1e4, 'cm⁴', 2], ['Iw', s.Iw / 1e6, 'cm⁶', 0],
    ['Avz / Avy', `${fmt(s.Avz / 100, 2)} / ${fmt(s.Avy / 100, 2)}`, 'cm²'],
    s.type === 'U' ? ['Schwerpunkt ys (ab Rücken)', s.ys / 10, 'cm', 2] : null,
    s.type === 'U' ? ['Schubmittelpunkt yM (ab S)', s.y0 / 10, 'cm', 2] : null,
    ['Masse', s.mass, 'kg/m', 1],
    ['fy / fu', `${mat.fy} / ${mat.fu}`, 'N/mm²'],
  ];
  return kvTable(rows);
}

function suggestBlock(app) {
  const sg = app.suggest;
  const stale = sg.stamp !== stampOf(app.project);
  const cur = app.project.section.name;
  const pass = sg.list.filter((x) => x.ok);
  const idx = sg.best ? sg.list.indexOf(sg.best) : -1;
  // die zwei leichteren (nicht erfüllt) und die vier leichtesten erfüllten
  const show = [...sg.list.slice(Math.max(0, idx - 2), Math.max(0, idx)), ...pass.slice(0, 4)];
  const rows = (show.length ? show : sg.list.slice(-5)).map((x) => [
    h('span', { style: { fontWeight: x === sg.best ? 700 : 400 } }, x.name, x === sg.best ? ' ★' : ''),
    fmt(x.mass, 1), x.error ? h('span', { class: 'small muted' }, 'Fehler') : utilBar(x.eta),
    x.name === cur && app.project.section.series === sg.series ? badge('aktuell', 'info') : button('Übernehmen', { small: true, onClick: () => { app.project.section.series = sg.series; app.project.section.name = x.name; app.suggest.stamp = stampOf(app.project); app.changed({ inputs: true }); toast(`${x.name} übernommen.`, 'ok'); } }),
  ]);
  return group(`Profilvorschlag ${sg.series}`, [
    stale ? note('Die Eingaben wurden seit der Suche geändert – bitte die Suche im Register «Profil» erneut ausführen.', 'warn') : null,
    sg.best ? h('div', { class: 'small', style: { margin: '0 0 6px' } }, 'Leichtestes Profil mit η ≤ 1: ', h('b', {}, sg.best.name), ` (${fmt(sg.best.mass, 1)} kg/m, massgebend: ${sg.best.gov})`) : note('Kein Profil dieser Reihe erfüllt alle Nachweise.', 'fail'),
    resultTable(['Profil', { label: 'kg/m', num: true }, 'Ausnutzung', ''], rows),
  ], { actions: [button('', { icon: 'close', small: true, ghost: true, title: 'Vorschlag ausblenden', onClick: () => { app.suggest = null; app.renderResults(); } })] });
}

// ------------------------------------------------------------------ Grafik

function viewModes(app) {
  const beam = app.project?.mode !== 'forces';
  return [
    { id: 'system', label: 'System' },
    { id: 'forces', label: 'Schnittgrössen', needsResults: true },
    beam ? { id: 'deflection', label: 'Verformung', needsResults: true } : null,
    { id: 'section', label: 'Querschnitt' },
  ].filter(Boolean);
}

function viewOptions(app) {
  const r = app.results;
  const mode = app.viewMode;
  const opts = [];
  if (mode === 'forces' || mode === 'deflection' || (mode === 'system' && app.project?.mode === 'forces')) {
    const list = [];
    if (mode === 'deflection') {
      list.push({ value: 'gov', label: 'massgebend' });
      for (const c of r?.member.combos || []) if (c.type.startsWith('SLS')) list.push({ value: c.id, label: shortName(c) });
    } else {
      list.push({ value: 'gov', label: 'massgebend' });
      if (mode === 'forces') list.push({ value: 'env', label: 'Umhüllende' });
      for (const c of r?.member.combos || []) if (c.type === 'ULS') list.push({ value: c.id, label: shortName(c) });
    }
    opts.push({ key: 'combo', label: mode === 'system' ? 'Situation' : 'Kombination', type: 'select', default: 'gov', options: list });
  }
  opts.push({ key: 'labels', label: 'Beschriftung', type: 'check', default: true });
  if (mode === 'section') opts.push({ key: 'stress', label: 'Spannungen', type: 'check', default: true });
  return opts;
}
function shortName(c) {
  const n = c.name.replace(/^(Tragsicherheit|Gebrauch charakt\.|Gebrauch quasi-ständig): /, '');
  return `${c.id}: ${n.length > 42 ? `${n.slice(0, 41)}…` : n}`;
}

function renderView(view, app, mode) {
  app.showViewMessage?.('');
  if (mode === 'forces') drawForces(view, app);
  else if (mode === 'deflection') drawDeflection(view, app);
  else if (mode === 'section') drawSection(view, app);
  else drawSystem(view, app);
}

// ------------------------------------------------------------------ Hilfe

const HELP = `
<h3>Zweck</h3>
<p>Nachweis einzelner Stahlstäbe (Träger, Stützen, Pfetten) nach SIA 263 bzw. EN 1993-1-1: Querschnittswiderstand, Biegeknicken, Drillknicken, Biegedrillknicken (Kippen), Interaktion von Normalkraft und Biegung sowie Durchbiegungen.</p>
<h3>Vorgehen</h3>
<ol><li><b>Profil</b>: Reihe und Profil, Stahlsorte und Norm wählen.</li>
<li><b>Belastung</b>: entweder System mit Lasten (Schnittgrössen werden berechnet) oder Bemessungsschnittgrössen direkt.</li>
<li><b>Kombinationen</b>: werden nach SIA 260 / EN 1990 automatisch erzeugt; Beiwerte anpassbar.</li>
<li><b>Stabilität</b>: Knicklängen, Lastangriffspunkt, seitliche Halterungen.</li></ol>
<h3>Vorzeichen und Einheiten</h3>
<ul><li>x entlang der Stabachse ab linkem Ende [m]; Lasten in z positiv nach unten, Lasten in y horizontal.</li>
<li>Normalkraft: Druck positiv. My positiv bei Zug unten (Feldmoment); Momente werden auf der Zugseite dargestellt.</li>
<li>Querschnitt: y-y starke Achse, z-z schwache Achse; Abmessungen in mm, Querschnittswerte in cm.</li></ul>
<h3>Querschnittswerte</h3>
<p>Aus den Nennmassen der Normtabellen berechnet (Ausrundungen als Zwickel, It nach EN 10365 mit Ausrundungsanteil, Iw = Iz·(h − tf)²/4). UPN mit geneigten Flanschen durch numerische Integration; It und Iw der UPN sind Näherungen der Dünnwandtheorie. Hohlprofile nach EN 10210-2 (ro = 1.5·t, ri = t).</p>
<h3>Nachweise</h3>
<ul><li><b>Klassifizierung</b> (Tab. 5.2) unter der tatsächlichen Beanspruchung N + My + Mz der Kombination; Stege mit plastischer Nulllinie α, Klasse 3 mit Spannungsverhältnis ψ und kσ nach EN 1993-1-5.</li>
<li><b>Klasse 4</b>: wirksame Querschnitte nach EN 1993-1-5 4.4 (Aeff, Weff,y, Weff,z, Verschiebung eN) in zwei Iterationen. Rundrohre der Klasse 4 (Schalenbeulen) sind nicht abgedeckt.</li>
<li><b>Querschnitt</b>: N (6.2.3/6.2.4), V mit Schubbeulkontrolle hw/tw ≤ 72·ε/η (6.2.6, EN 1993-1-5 5), M mit Querkraftabminderung ρ (6.2.8), N + M plastisch nach 6.2.9.1 (I, RHS, CHS), elastisch für Klasse 3 und wirksam für Klasse 4; zweiachsig mit Exponenten α, β.</li>
<li><b>Biegeknicken</b> (6.3.1) mit Knicklinien nach Tab. 6.2; <b>Drillknicken</b> bzw. Biegedrillknicken unter Druck (6.3.1.4) für offene Profile.</li>
<li><b>Kippen</b> (6.3.2): Mcr mit der 3-Faktoren-Formel (C1, C2 nach NCCI SN003, k, kw, zg) oder mit einer FE-Eigenwertanalyse (kubische Elemente für seitliche Verschiebung und Verdrehung, Lastangriffshöhe, Gabellager). χLT nach 6.3.2.2, 6.3.2.3 (mit f) oder SIA 263.</li>
<li><b>Interaktion</b> (6.3.3) mit Beiwerten nach Anhang B (Methode 2), Cmy, Cmz, CmLT nach Tab. B.3; je Kippsegment ausgewertet.</li>
<li><b>Gebrauchstauglichkeit</b>: Durchbiegung charakteristisch und quasi-ständig gegen L/… (Kragarm 2·L/…).</li></ul>
<h3>Annahmen und Grenzen</h3>
<ul><li>Theorie 1. Ordnung für die Schnittgrössen; Stabilität über Ersatzstabverfahren. Keine Torsion aus Lastexzentrizität (bei UPN näherungsweise).</li>
<li>Seitliche Halterungen und Auflager wirken als Gabellager (seitliche Verschiebung und Verdrehung verhindert).</li>
<li>Knicklänge z: grösster Abstand der seitlichen Halterungen mal βz. Kippsegmente zwischen Halterungen; Kragarme mit der Eigenwertanalyse.</li>
<li>Bei direkter Eingabe wirkt die Querkraft über die ganze Länge (M–V-Interaktion auf der sicheren Seite).</li>
<li>Die SIA-263-Ziffern im Bericht sind sinngemäss zugeordnet; gerechnet wird nach den Formeln von EN 1993-1-1. Nationale Anhänge sind nicht berücksichtigt (empfohlene Werte).</li>
<li>Nicht enthalten: Ermüdung, Brand, Anschlüsse, Lasteinleitung (Stegkrüppeln), Nettoquerschnitt bei Löchern.</li></ul>`;

const INTRO = `<h4>So funktioniert's</h4><ol>
<li><b>Profil</b> und Stahlsorte wählen – oder «Profil vorschlagen» nutzen.</li>
<li><b>Belastung</b>: Träger mit Lasten eingeben oder Schnittgrössen direkt übernehmen.</li>
<li><b>Stabilität</b>: Knicklängen, Lastangriffspunkt und seitliche Halterungen prüfen.</li>
<li>Rechts erscheinen sofort alle Nachweise; mit «Bericht» entsteht die prüffähige Dokumentation.</li></ol>`;

// ------------------------------------------------------------------ App

createApp({
  id: 'stahlbau',
  title: 'Stahlbau',
  subtitle: 'Stahlstäbe nach SIA 263 / EN 1993-1-1',
  version: 1,
  defaultProject,
  migrate,
  examples: EXAMPLES,
  intro: INTRO,
  inputTabs: [
    { id: 'profil', label: 'Profil', render: renderProfile },
    { id: 'lasten', label: 'Belastung', render: renderLoads },
    { id: 'kombi', label: 'Kombinationen', render: renderCombos },
    { id: 'stab', label: 'Stabilität', render: renderStability },
  ],
  viewModes,
  viewOptions,
  renderView,
  autoCompute: true,
  compute: (p) => compute(p),
  renderResults,
  report: (app) => buildReport(app),
  help: HELP,
});
