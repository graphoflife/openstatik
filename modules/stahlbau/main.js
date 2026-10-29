// Stahlbau – Stabnachweise nach SIA 263 / EN 1993-1-1: Benutzeroberfläche
import { createApp } from '../../js/core/app.js';
import {
  h, group, numField, selectField, checkField, textField, dataTable, segmented, button, kvTable, resultTable,
  checksTable, summaryCard, stats, note, emptyState, toast, utilBar, badge, fmt, rich, listEditor, clone,
} from '../../js/core/ui.js';
import { SERIES, SEARCHABLE, sectionProps } from './profiles.js';
import { CATEGORIES, systemGeometry, autoCombos, defaultFactors, patternLoading, normSupports, beamModel } from './beam.js';
import { compute, suggestProfiles, latRestraintPositions } from './calc.js';
import { defaultProject, EXAMPLES } from './examples.js';
import { drawSystem, drawForces, drawDeflection, drawSection, CAT_COLOR } from './draw.js';
import { buildReport } from './bericht.js';
import { editorSpec, DERIV_OF } from './editing.js';
import { derivation } from './derivation.js';
import { INFO, profileFields, materialFields, gammaFields, systemFields, ltbMainFields, caseFields, newCase } from './fields.js';

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
      return { Ly: L, Lz: maxGap(r, L), L, fields: [{ x0: 0, x1: L, L }] };
    }
    const g = systemGeometry(p.beam);
    const r = latRestraintPositions(p, g.L, g.supports, g.freeEnds);
    return { Ly: Math.max(...g.fields.map((f) => f.L)), Lz: maxGap(r, g.L), L: g.L, fields: g.fields };
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
const shortCombo = (n) => (n ? n.replace(/^(Tragsicherheit|Gebrauch charakt\.|Gebrauch quasi-ständig): /, '') : n);
const catLabel = (c) => ({ G: 'ständig', Nutzlast: 'Nutzlast', Schnee: 'Schnee', Wind: 'Wind' }[c] || c);
const beamLength = (p) => { try { return beamModel(p.beam).L; } catch { return 0; } };

// ------------------------------------------------------------------ Register 1: Profil

function renderProfile(el, app) {
  const p = app.project;
  const opts = { ch: ch(app), chI: chI(app) };
  el.append(group('Profil', profileFields(app, opts), { info: 'Profil wählen – hier oder durch Klick auf den Träger bzw. den Querschnitt in der Grafik.' }));
  el.append(group('Werkstoff', materialFields(app, opts)));
  el.append(group('Widerstandsbeiwerte', gammaFields(app, opts), { collapsed: true, info: INFO.gamma }));
  const search = { series: SEARCHABLE.includes(p.suggestSeries) ? p.suggestSeries : 'IPE' };
  el.append(group('Profil vorschlagen', [
    selectField('Reihe', search, 'series', SERIES.filter((x) => SEARCHABLE.includes(x.id)).map((x) => ({ value: x.id, label: x.label })), { wide: true, onChange: (v) => { p.suggestSeries = v; } }),
    h('div', { class: 'row end' }, button('Leichtestes Profil suchen', { icon: 'play', primary: true, onClick: () => runSuggest(app, search.series) })),
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

const modeSwitch = (app) => segmented([{ id: 'beam', label: 'Träger mit Lasten' }, { id: 'forces', label: 'Schnittgrössen direkt' }], app.project.mode, (id) => { app.project.mode = id; chI(app)(); });

function renderLoads(el, app) {
  const p = app.project;
  if (p.mode === 'forces') return renderForcesInput(el, app);
  const b = p.beam;
  // System
  const spansTable = (kind) => {
    if (kind === 'cont') {
      const rows = b.spans.map((L) => ({ L }));
      return dataTable([{ key: 'L', label: 'Spannweite', unit: 'm', min: 0.01 }], rows, {
        newRow: () => ({ L: rows[rows.length - 1]?.L || 5 }), minRows: 2, hint: 'Felder von links nach rechts (Nr. = Feld)',
        onChange: (e) => { b.spans = rows.map((r) => r.L); if (e.type === 'edit') ch(app)(); else chI(app)(); },
      });
    }
    b.supports = normSupports(b.supports, Number(b.length) || 0);
    return dataTable([
      { key: 'x', label: 'Lage x', unit: 'm', min: 0, info: 'Abstand vom linken Trägerende.' },
      { key: 'type', label: 'Lagerart', type: 'select', options: [{ value: 'pin', label: 'gelenkig' }, { value: 'fix', label: 'eingespannt' }], width: '120px' },
    ], b.supports, {
      newRow: () => ({ x: Number(b.length) || 0, type: 'pin' }), hint: 'auch grafisch (Werkzeug «Lager»)',
      onChange: (e) => (e.type === 'edit' ? ch(app)() : chI(app)()),
    });
  };
  el.append(group('System', [modeSwitch(app), ...systemFields(app, { ch: ch(app), chI: chI(app), spansTable })], { info: `${INFO.mode}<br><br>${INFO.system}` }));

  // Lastfälle
  const nextId = () => { let i = 1; while (b.loadCases.some((l) => l.id === `L${i}`)) i++; return `L${i}`; };
  const nLoads = (lc) => b.loads.filter((l) => l.lc === lc.id).length;
  const newLC = (cat) => ({ id: nextId(), name: cat === 'G' ? 'Ständige Lasten' : `${catLabel(cat)} ${b.loadCases.filter((l) => l.cat === cat).length + 1}`, cat });
  el.append(group(`Lastfälle (${b.loadCases.length})`, [
    listEditor(b.loadCases, {
      active: app.openLC ?? null, onActive: (i) => { app.openLC = i; },
      label: (l) => l.name,
      sub: (l) => { const n = nLoads(l); return `${catLabel(l.cat)} · ${n ? `${n} Last${n === 1 ? '' : 'en'}` : 'keine Lasten'}`; },
      swatch: (l) => CAT_COLOR[l.cat] || 'var(--c-load)',
      canRemove: () => b.loadCases.length > 1,
      duplicate: (l) => {
        const c = { ...clone(l), id: nextId(), name: `${l.name} (Kopie)` };
        for (const ld of b.loads.filter((x) => x.lc === l.id)) b.loads.push({ ...clone(ld), lc: c.id });
        return c;
      },
      onChange: (e) => {
        if (e.type === 'remove') { const ids = new Set(b.loadCases.map((l) => l.id)); b.loads = b.loads.filter((l) => ids.has(l.lc)); }
        chI(app)();
      },
      detail: (d, l) => d.append(
        textField('Bezeichnung', l, 'name', { onChange: chI(app) }),
        selectField('Kategorie', l, 'cat', CATEGORIES, { wide: true, onChange: chI(app), info: 'Ständig: γ<sub>G</sub>; veränderlich: γ<sub>Q</sub> mit den ψ-Beiwerten der Kategorie.' })),
      add: [{ label: 'Ständig', create: () => newLC('G') }, { label: 'Veränderlich', create: () => newLC('Nutzlast') }],
    }),
  ], { info: INFO.loadCases }));

  // Lasten
  const L = beamLength(p);
  const lcOf = (id) => b.loadCases.find((l) => l.id === id);
  const activeLc = () => b.loadCases.find((l) => l.id === b.activeLC)?.id || b.loadCases[b.loadCases.length - 1]?.id || 'G';
  el.append(group(`Lasten (${b.loads.length})`, [
    listEditor(b.loads, {
      active: app.openLoad ?? null, onActive: (i) => { app.openLoad = i; },
      empty: 'Noch keine Lasten – unten hinzufügen oder in der Grafik mit den Werkzeugen setzen.',
      label: loadLabel, sub: (ld) => loadSub(ld, lcOf(ld.lc), L),
      swatch: (ld) => CAT_COLOR[lcOf(ld.lc)?.cat] || 'var(--c-load)',
      duplicate: (ld) => clone(ld),
      onChange: chI(app),
      detail: (d, ld) => d.append(...loadDetail(app, ld, L)),
      add: [
        { label: 'Streckenlast', create: () => ({ lc: activeLc(), kind: 'qz', v1: 5, v2: null, x1: null, x2: null }) },
        { label: 'Einzellast', create: () => ({ lc: activeLc(), kind: 'Pz', v1: 10, v2: null, x1: +(L / 2).toFixed(3), x2: null }) },
        { label: 'Normalkraft', create: () => ({ lc: activeLc(), kind: 'N', v1: 100, v2: null, x1: null, x2: null }) },
      ],
    }),
  ], { info: INFO.loads }));
  renderCombos(el, app);
}

const KIND = [
  { value: 'qz', label: 'Streckenlast ↓ (z)' }, { value: 'Pz', label: 'Einzellast ↓ (z)' },
  { value: 'qy', label: 'Streckenlast → (y)' }, { value: 'Py', label: 'Einzellast → (y)' }, { value: 'N', label: 'Normalkraft' },
];

function loadLabel(ld) {
  const k = ld.kind || 'qz';
  const arrow = k[1] === 'y' ? '→' : '↓';
  if (k === 'N') return `N = ${fmt(Math.abs(ld.v1 || 0), 1)} kN (${(ld.v1 || 0) >= 0 ? 'Druck' : 'Zug'})`;
  if (k[0] === 'P') return `P = ${fmt(ld.v1 || 0, 1)} kN ${arrow}`;
  const v2 = Number.isFinite(ld.v2) && Math.abs(ld.v2 - ld.v1) > 1e-9 ? ` … ${fmt(ld.v2, 2)}` : '';
  return `q = ${fmt(ld.v1 || 0, 2)}${v2} kN/m ${arrow}`;
}
function loadSub(ld, lc, L) {
  const k = ld.kind || 'qz';
  const where = k === 'N' ? 'konstant' : k[0] === 'P' ? `x = ${fmt(Number.isFinite(ld.x1) ? ld.x1 : L / 2, 2)} m`
    : (!Number.isFinite(ld.x1) && !Number.isFinite(ld.x2) ? 'ganze Länge' : `x = ${fmt(Number.isFinite(ld.x1) ? ld.x1 : 0, 2)} … ${fmt(Number.isFinite(ld.x2) ? ld.x2 : L, 2)} m`);
  return `${lc?.name || '–'} · ${where}`;
}

function loadDetail(app, ld, L) {
  const b = app.project.beam;
  const k = ld.kind || 'qz';
  const lcOpts = [...b.loadCases.map((l) => ({ value: l.id, label: l.name })), { value: '__new', label: '+ Neuer Lastfall …' }];
  const out = [
    selectField('Lastfall', ld, 'lc', lcOpts, {
      wide: true, info: INFO.loadCases,
      onChange: (v) => {
        if (v === '__new') { let i = 1; while (b.loadCases.some((l) => l.id === `L${i}`)) i++; b.loadCases.push({ id: `L${i}`, name: `Lastfall ${b.loadCases.length + 1}`, cat: 'Nutzlast' }); ld.lc = `L${i}`; }
        b.activeLC = ld.lc;
        chI(app)();
      },
    }),
    selectField('Art', ld, 'kind', KIND, { wide: true, onChange: chI(app), info: INFO.loads }),
  ];
  if (k === 'N') out.push(numField('N (Druck +)', ld, 'v1', { unit: 'kN', onChange: ch(app), info: 'Druck positiv, Zug negativ; konstant über die Stablänge.' }));
  else if (k[0] === 'P') {
    out.push(h('div', { class: 'grid2' },
      numField('P', ld, 'v1', { unit: 'kN', onChange: ch(app), info: 'Positiv nach unten bzw. in +y, negativ nach oben.' }),
      numField('Lage x', ld, 'x1', { unit: 'm', min: 0, max: L, allowEmpty: true, onChange: ch(app), info: 'Abstand vom linken Trägerende; leer = Mitte.' })));
  } else {
    out.push(h('div', { class: 'grid2' },
      numField('q', ld, 'v1', { unit: 'kN/m', onChange: ch(app), info: 'Wert am Anfang x<sub>1</sub>; positiv nach unten bzw. in +y.' }),
      numField('q_2 (Ende)', ld, 'v2', { unit: 'kN/m', allowEmpty: true, onChange: ch(app), info: 'Nur für Trapez- und Dreieckslasten; leer = konstant.' }),
      numField('von x_1', ld, 'x1', { unit: 'm', min: 0, max: L, allowEmpty: true, onChange: ch(app), info: 'Leer = Trägeranfang.' }),
      numField('bis x_2', ld, 'x2', { unit: 'm', min: 0, max: L, allowEmpty: true, onChange: ch(app), info: 'Leer = Trägerende.' })));
  }
  return out;
}

function renderForcesInput(el, app) {
  const p = app.project, F = p.forces;
  el.append(group('Stab', [
    modeSwitch(app),
    numField('Stablänge L', F, 'L', { unit: 'm', min: 0.01, onChange: chI(app), info: 'Systemlänge zwischen den Gabellagern; Bezugslänge für Knicken (L<sub>cr</sub> = β·L) und Kippen.' }),
    selectField('Darstellung', F, 'orient', [{ value: 'h', label: 'Träger (horizontal)' }, { value: 'v', label: 'Stütze (vertikal)' }], { wide: true, onChange: ch(app) }),
  ], { info: INFO.mode }));
  const cases = F.cases;
  el.append(group(`Bemessungssituationen (${cases.length})`, [
    listEditor(cases, {
      active: app.openCase ?? null, onActive: (i) => { app.openCase = i; if (i !== null) app.selCase = i; },
      empty: 'Noch keine Schnittgrössen – «Situation» hinzufügen oder den Stab in der Grafik anklicken.',
      label: (c) => c.name || 'Situation',
      sub: (c) => [`N = ${fmt(c.N || 0, 0)} kN`, `M_y = ${fmt(c.My || 0, 1)} kNm`, Math.abs(c.Mz || 0) > 1e-9 ? `M_z = ${fmt(c.Mz, 1)} kNm` : null].filter(Boolean).join(' · '),
      swatch: () => 'var(--c-pos)',
      onChange: chI(app),
      detail: (d, c) => d.append(...caseFields(c, { ch: ch(app), chI: chI(app) })),
      add: [{ label: 'Situation', create: () => newCase(cases.length + 1) }],
    }),
  ], { info: INFO.forces }));
}

// ------------------------------------------------------------------ Register 3: Kombinationen

function renderCombos(el, app) {
  const p = app.project;
  const C = p.combos;
  const F = C.factors || (C.factors = defaultFactors(p.norm));
  const lcs = lcList(p);
  const pattern = patternLoading(p.beam);
  const kids = [checkField('automatisch erzeugen', C, 'auto', {
    info: 'Empfohlen: alle massgebenden Kombinationen nach Norm. Ausschalten, um Faktoren je Lastfall selbst festzulegen.',
    onChange: (v) => { if (!v && !(C.manual || []).length) C.manual = toManual(p); chI(app)(); },
  })];
  let n;
  if (C.auto !== false) {
    const list = autoCombos(lcs, F, { pattern });
    n = list.length;
    kids.push(resultTable(['', 'Kombination'], list.map((c) => [badge(c.type === 'ULS' ? 'Trag.' : c.type === 'SLS-char' ? 'Gebr.' : 'q.-st.', c.type === 'ULS' ? 'info' : 'ok'), c.name.replace(/^[^:]+: /, '')])));
  } else {
    n = C.manual.length;
    const cols = [
      { key: 'name', label: 'Name', type: 'text', width: '96px' },
      { key: 'type', label: 'Typ', type: 'select', width: '92px', options: [{ value: 'ULS', label: 'Tragsicherheit' }, { value: 'SLS-char', label: 'Gebrauch char.' }, { value: 'SLS-qp', label: 'quasi-ständig' }] },
      ...lcs.map((l) => ({ key: `f_${l.id}`, label: l.name.length > 10 ? `${l.name.slice(0, 9)}…` : l.name, title: l.name, allowEmpty: true, width: '64px' })),
    ];
    kids.push(dataTable(cols, C.manual, {
      newRow: () => ({ name: `Kombination ${C.manual.length + 1}`, type: 'ULS', ...Object.fromEntries(lcs.map((l) => [`f_${l.id}`, l.cat === 'G' ? F.gG : F.gQ])) }),
      onChange: (e) => (e.type === 'edit' ? ch(app)() : chI(app)()), hint: 'Faktoren je Lastfall',
    }));
    kids.push(h('div', { class: 'row end' }, button('Aus automatischen übernehmen', { small: true, icon: 'copy', onClick: () => { C.manual = toManual(p); chI(app)(); } })));
  }
  el.append(group(`Kombinationen (${n})`, kids, { collapsed: true, info: `${INFO.combos}${pattern ? '<br><br>Durchlaufträger/Kragarm: Begleitlasten werden auch weggelassen und ständige Lasten mit γ<sub>G,inf</sub> kombiniert (ungünstigste Laststellung).' : ''}` }));

  el.append(group('Durchbiegung', [
    h('div', { class: 'grid2' },
      numField('charakt.: L /', p.sls, 'limitChar', { min: 1, onChange: ch(app), info: 'Funktionstüchtigkeit, charakteristische Kombination (z.B. L/300).' }),
      numField('quasi-ständig: L /', p.sls, 'limitQp', { min: 1, onChange: ch(app), info: 'Aussehen, quasi-ständige Kombination (z.B. L/250).' })),
  ], { info: INFO.sls }));

  const psiRows = Object.entries(F.psi).map(([cat, a]) => ({ cat, p0: a[0], p1: a[1], p2: a[2] }));
  el.append(group('Teilsicherheitsbeiwerte', [
    h('div', { class: 'grid3' },
      numField('γ_G', F, 'gG', { min: 0, onChange: ch(app), info: 'ständige Lasten, ungünstig' }),
      numField('γ_G,inf', F, 'gGinf', { min: 0, onChange: ch(app), info: 'ständige Lasten, günstig (Kragarm, Durchlaufträger)' }),
      numField('γ_Q', F, 'gQ', { min: 0, onChange: ch(app), info: 'veränderliche Lasten' })),
    dataTable([
      { key: 'cat', label: 'Kategorie', type: 'calc', calc: (r) => r.cat },
      { key: 'p0', label: 'ψ_0', info: 'Kombinationsbeiwert (Begleiteinwirkung)' },
      { key: 'p1', label: 'ψ_1', info: 'häufiger Wert (nur informativ)' },
      { key: 'p2', label: 'ψ_2', info: 'quasi-ständiger Wert' },
    ], psiRows, { canAdd: false, canRemove: false, numbered: false, hint: '', onChange: () => { for (const r of psiRows) F.psi[r.cat] = [r.p0, r.p1, r.p2]; ch(app)(); } }),
  ], { collapsed: true, info: INFO.factors, actions: [button('Normwerte', { small: true, ghost: true, icon: 'undo', title: 'Beiwerte der gewählten Norm wiederherstellen', onClick: () => { C.factors = null; chI(app)(); } })] }));
}

function toManual(p) {
  const lcs = lcList(p);
  const F = p.combos.factors || defaultFactors(p.norm);
  return autoCombos(lcs, F, { pattern: patternLoading(p.beam) }).map((c, i) => ({
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
  const lcr = (beta, Lr, ax) => (ref ? rich(`L_cr,${ax} = ${fmt(Number(beta) || 0, 2)} · ${fmt(Lr, 2)} = ${fmt((Number(beta) || 0) * Lr, 2)} m`) : null);
  el.append(group('Knicken', [
    numField('β_y (um y-y)', st, 'betaY', { min: 0.1, max: 10, onChange: chI(app), info: `${INFO.beta}<br>Bezug: ${p.mode === 'forces' ? 'Stablänge' : 'grösstes Feld'}.`, help: lcr(st.betaY, ref?.Ly, 'y') }),
    numField('β_z (um z-z)', st, 'betaZ', { min: 0.1, max: 10, onChange: chI(app), info: `${INFO.beta}<br>${INFO.betaZ}`, help: lcr(st.betaZ, ref?.Lz, 'z') }),
  ], { info: 'Knicklängen für den Nachweis nach EN 1993-1-1 6.3.1. Die Knicklinien (a<sub>0</sub> … d) folgen aus Profiltyp, h/b, Flanschdicke und Stahlsorte.' }));

  const ltbKids = [];
  if (sec?.closed) ltbKids.push(note('Hohlprofile sind wegen ihrer grossen Torsionssteifigkeit nicht kippgefährdet – der Kippnachweis entfällt.', 'ok'));
  else {
    ltbKids.push(
      checkField('Kippnachweis führen', st, 'ltb', { onChange: chI(app), info: INFO.ltb }),
      st.ltb !== false ? checkField('Druckgurt durchgehend gehalten', st, 'contRestraint', { onChange: chI(app), info: INFO.cont }) : null);
    if (st.ltb !== false && !st.contRestraint) ltbKids.push(...ltbMainFields(app, { ch: ch(app), chI: chI(app) }));
  }
  el.append(group('Kippen', ltbKids.filter(Boolean), { info: INFO.ltb }));

  // Seitliche Halterungen
  const L = ref?.L || 0;
  const fields = (ref?.fields || []).filter((f) => !f.cant);
  const setR = (list) => { st.restraints = list; app.openRestr = null; chI(app)(); return null; };
  const midOfLongest = () => {
    const pts = [0, ...(latRestraintPositions(p, L, (ref?.fields || []).flatMap((f) => [{ x: f.x0 }, { x: f.x1 }]), []) || []), L].sort((a, b) => a - b);
    let best = [0, L];
    for (let i = 1; i < pts.length; i++) if (pts[i] - pts[i - 1] > best[1] - best[0]) best = [pts[i - 1], pts[i]];
    return +((best[0] + best[1]) / 2).toFixed(3);
  };
  const addOpts = [{ label: 'Halterung', create: () => ({ x: midOfLongest() }) }];
  if (fields.length) {
    addOpts.push({ label: 'Feldmitten', icon: 'grid', create: () => setR(fields.map((f) => ({ x: +((f.x0 + f.x1) / 2).toFixed(3) }))) });
    addOpts.push({ label: 'Drittel', icon: 'grid', create: () => setR(fields.flatMap((f) => [1, 2].map((k) => ({ x: +(f.x0 + f.L * k / 3).toFixed(3) })))) });
  }
  el.append(group(`Halterungen (${st.restraints.length})`, [
    st.contRestraint ? note('Der Druckgurt ist durchgehend gehalten – einzelne Halterungen wirken nur noch auf das Knicken um z-z.', '') : null,
    listEditor(st.restraints, {
      active: app.openRestr ?? null, onActive: (i) => { app.openRestr = i; },
      empty: 'Nur an den Auflagern gehalten.',
      label: (r) => `x = ${fmt(r.x, 2)} m`, sub: () => 'Gabellager',
      swatch: () => 'var(--c-highlight)', duplicate: false,
      onChange: chI(app),
      detail: (d, r) => d.append(numField('Lage x', r, 'x', { unit: 'm', min: 0, max: L, onChange: chI(app), info: 'Abstand vom linken Stabende.' })),
      add: addOpts,
    }),
  ].filter(Boolean), { info: INFO.restraints }));

  // Erweitert
  const adv = [];
  if (!sec?.closed && st.ltb !== false && !st.contRestraint) {
    adv.push(
      selectField('Einspannung k', st, 'k', [{ value: 1, label: '1.0 – Gabellager' }, { value: 0.7, label: '0.7 – Anfang eingespannt' }, { value: 0.5, label: '0.5 – beide Enden' }], { wide: true, onChange: ch(app), info: INFO.k }),
      selectField('Wölbung k_w', st, 'kw', [{ value: 1, label: '1.0 – frei' }, { value: 0.7, label: '0.7 – Anfang wölbsteif' }, { value: 0.5, label: '0.5 – beide Enden' }], { wide: true, onChange: ch(app), info: INFO.kw }),
      selectField('χ_LT-Verfahren', st, 'chiLT', [
        { value: 'auto', label: `nach Norm (${p.norm === 'EC' ? 'EN' : 'SIA 263'})` }, { value: 'general', label: 'allgemein (6.3.2.2)' },
        { value: 'rolled', label: 'Walzprofile (6.3.2.3)' }, { value: 'sia', label: 'SIA 263' }], { wide: true, onChange: ch(app), info: INFO.chiLT }));
    if (st.mcr !== 'fe') {
      adv.push(checkField('C_1, C_2 automatisch', st, 'cAuto', { onChange: chI(app), info: INFO.cAuto }));
      if (st.cAuto === false) adv.push(h('div', { class: 'grid2' },
        numField('C_1', st, 'C1', { min: 0.5, max: 4, onChange: ch(app), info: 'Momentenbeiwert (Form des Momentenverlaufs).' }),
        numField('C_2', st, 'C2', { min: 0, max: 3, onChange: ch(app), info: 'Beiwert für den Lastangriffspunkt (0 ohne Querlast).' })));
    }
  }
  adv.push(
    checkField('verschieblich in z (C_my = 0.9)', st, 'swayY', { onChange: ch(app), info: INFO.sway }),
    checkField('verschieblich in y (C_mz = 0.9)', st, 'swayZ', { onChange: ch(app), info: INFO.sway }));
  el.append(group('Erweitert', adv, { id: 'stab-erweitert', collapsed: true, info: 'Seltener benötigte Angaben: Endeinspannungen, Verfahren für χ<sub>LT</sub>, eigene C<sub>1</sub>/C<sub>2</sub> und seitenverschiebliche Systeme.' }));
}

// ------------------------------------------------------------------ Ergebnisse

function renderResults(el, app) {
  const r = app.results;
  const s = r.sec, u = r.govUls;
  const ok = r.etaMax <= 1.0001;
  const gov = r.gov;
  el.append(summaryCard(r.etaMax, 'Maximale Ausnutzung', h('div', { class: 'summary-extra' },
    h('div', {}, h('b', {}, rich(ok ? `Alle Nachweise erfüllt – ${s.name} in ${r.mat.name} genügt.` : `Nicht erfüllt: ${gov.label}`))),
    h('div', { class: 'muted small' }, rich(`Massgebend: ${gov.label}${gov.comboName ? ` · ${shortCombo(gov.comboName)}` : ''}`)),
    ok ? null : h('div', { class: 'small' }, 'Abhilfe: grösseres Profil («Profil vorschlagen» im Register «Profil»), seitliche Halterungen ergänzen oder höhere Stahlsorte.'))));
  // Kennzahlen
  const st = u.st;
  const segG = (() => { let b = null; for (const x of r.uls) for (const sg of x.st.segments) if (sg.etaLT !== undefined && (!b || sg.etaLT > b.etaLT)) b = sg; return b; })();
  const hasN = r.uls.some((x) => x.Nc > 1e-9);
  const NbRd = hasN ? Math.min(st.NbyRd, st.NbzRd, st.NbTRd ?? Infinity) / 1e3 : null;
  el.append(stats([
    ['Profil', s.name],
    ['Klasse', String(u.cls)],
    [u.cls <= 2 ? 'M_pl,y,Rd' : u.cls === 3 ? 'M_el,y,Rd' : 'M_eff,y,Rd', u.R.McyRd / 1e6, 'kNm', 1],
    hasN ? ['N_b,Rd (min)', NbRd, 'kN', 0] : ['N_pl,Rd', u.R.NcRd / 1e3, 'kN', 0],
    segG ? ['M_b,Rd', segG.MbRd / 1e6, 'kNm', 1] : ['V_pl,z,Rd', u.R.VplzRd / 1e3, 'kN', 0],
    segG ? ['M_cr', segG.Mcr / 1e6, 'kNm', 1] : ['Masse', s.mass, 'kg/m', 1],
  ]));
  for (const w of r.warnings) el.append(note(rich(w), 'warn'));

  // Profilsuche
  if (app.suggest) el.append(suggestBlock(app));

  // Nachweise
  for (const grp of ['Querschnitt', 'Stabilität', 'Gebrauchstauglichkeit']) {
    const list = r.checks.filter((c) => c.group === grp);
    if (!list.length) continue;
    el.append(group(`${grp} (${list.length})`, [checksTable(list.map((c) => ({
      label: c.label, ref: c.ref, Ed: c.Ed, Rd: c.Rd, unit: c.unit, digits: 1, eta: c.eta, deriv: DERIV_OF(c.id),
      detail: rich([shortCombo(c.comboName), Number.isFinite(c.x) && c.group !== 'Stabilität' ? `x = ${fmt(c.x, 2)} m` : null, c.seg && c.group === 'Stabilität' ? `Segment ${fmt(c.seg.x0, 2)} … ${fmt(c.seg.x1, 2)} m` : null, c.detail].filter(Boolean).join(' · ')),
    })), { edLabel: 'E_d', rdLabel: 'R_d' })], { id: `res-${grp}` }));
  }
  if (r.uls.length && !r.checks.some((c) => c.group === 'Stabilität') && !st.ltbActive && st.ltbReason) el.append(note(rich(`Kippen: ${st.ltbReason}.`), ''));

  // Details (eingeklappt)
  el.append(group(`Klassifizierung – Klasse ${u.cls}`, [classTable(u), h('div', { class: 'muted small' }, rich(`ε = √(235/f_y) = ${fmt(u.klass.eps, 3)} · N_Ed = ${fmt(Math.max(0, u.Nc), 1)} kN, M_y,Ed = ${fmt(u.MyMax, 1)} kNm, M_z,Ed = ${fmt(u.MzMax, 1)} kNm (${u.combo.name})`))], { id: 'res-klasse', collapsed: true, info: 'Klassifizierung der gedrückten Querschnittsteile nach EN 1993-1-1 Tab. 5.2 unter der tatsächlichen Beanspruchung der massgebenden Kombination.', actions: [button('Herleitung ›', { small: true, ghost: true, onClick: () => app.showDerivation('klasse') })] }));
  el.append(group('Stabilitätskennwerte', [stabKV(r, u)], { collapsed: true, info: 'Zwischenwerte der massgebenden Kombination für Knicken, Kippen und Interaktion.' }));
  if (r.uls.length > 1) el.append(group(`Kombinationen (${r.uls.length})`, [resultTable(['Kombination', 'Ausnutzung'], r.uls.map((x) => [x.combo.name, utilBar(x.eta)]))], { id: 'res-kombi', collapsed: true }));
  el.append(group('Querschnittswerte', [propsKV(s, r.mat)], { id: 'res-qs', collapsed: true }));
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
    ['L_cr,y / L_cr,z', `${fmt(st.LcrY / 1000, 2)} / ${fmt(st.LcrZ / 1000, 2)}`, 'm'],
    ['Knicklinie y / z', `${st.curveY} / ${st.curveZ}`, ''],
    ['N_cr,y', st.NcrY / 1e3, 'kN', 0], ['N_cr,z', st.NcrZ / 1e3, 'kN', 0],
    ['λ̄_y / χ_y', `${fmt(st.lamY, 3)} / ${fmt(st.chiY, 3)}`, ''],
    ['λ̄_z / χ_z', `${fmt(st.lamZ, 3)} / ${fmt(st.chiZ, 3)}`, ''],
    st.torsional ? [r.sec.type === 'U' ? 'N_cr,TF' : 'N_cr,T', st.NcrTorsion / 1e3, 'kN', 0] : null,
    st.torsional ? ['λ̄_T / χ_T', `${fmt(st.lamT, 3)} / ${fmt(st.chiT, 3)}`, ''] : null,
  ];
  if (seg?.Mcr) {
    rows.push(
      ['Kippsegment', `${fmt(seg.x0, 2)} … ${fmt(seg.x1, 2)}`, 'm'],
      ['M_cr', seg.Mcr / 1e6, 'kNm', 1],
      seg.mcrBy === 'formula' ? ['C_1 / C_2', `${fmt(seg.C1, 3)} / ${fmt(seg.C2, 3)}`, ''] : ['C_1 (äquivalent, FE)', seg.C1eq, '', 3],
      ['Ermittlung M_cr', seg.mcrBy === 'formula' ? `Formel – ${seg.csrc}` : `FE – ${seg.csrc}`, ''],
      ['z_g (Lastangriff)', seg.zg ?? 0, 'mm', 0],
      ['k / k_w', `${fmt(seg.k, 1)} / ${fmt(seg.kw, 1)}`, ''],
      ['λ̄_LT / χ_LT', `${fmt(seg.lamLT, 3)} / ${fmt(seg.chiLT, 3)}`, ''],
      ['Verfahren χ_LT', { general: 'EN 6.3.2.2', rolled: `EN 6.3.2.3 (f = ${fmt(seg.lt.f, 3)})`, sia: 'SIA 263' }[st.ltbMethod], ''],
    );
  } else rows.push(['Kippen', st.ltbReason || 'nicht massgebend', '']);
  if (seg?.kf) {
    rows.push(
      ['C_my / C_mz / C_mLT', `${fmt(seg.Cmy.Cm, 3)} / ${fmt(seg.Cmz.Cm, 3)} / ${fmt(seg.CmLT.Cm, 3)}`, ''],
      ['k_yy / k_yz', `${fmt(seg.kf.kyy, 3)} / ${fmt(seg.kf.kyz, 3)}`, ''],
      ['k_zy / k_zz', `${fmt(seg.kf.kzy, 3)} / ${fmt(seg.kf.kzz, 3)}`, ''],
    );
  }
  return kvTable(rows);
}

function propsKV(s, mat) {
  const rows = [
    ['h / b', `${fmt(s.h, 1)} / ${fmt(s.b, 1)}`, 'mm'],
    s.tw && s.type !== 'RHS' && s.type !== 'CHS' ? ['t_w / t_f', `${fmt(s.tw, 1)} / ${fmt(s.tf, 1)}`, 'mm'] : null,
    s.t ? ['t', s.t, 'mm', 1] : null,
    s.r ? ['r', s.r, 'mm', 1] : null,
    ['A', s.A / 100, 'cm²', 2],
    ['I_y', s.Iy / 1e4, 'cm⁴', 1], ['I_z', s.Iz / 1e4, 'cm⁴', 1],
    ['W_el,y / W_el,z', `${fmt(s.Wely / 1e3, 1)} / ${fmt(s.Welz / 1e3, 1)}`, 'cm³'],
    ['W_pl,y / W_pl,z', `${fmt(s.Wply / 1e3, 1)} / ${fmt(s.Wplz / 1e3, 1)}`, 'cm³'],
    ['i_y / i_z', `${fmt(s.iy / 10, 2)} / ${fmt(s.iz / 10, 2)}`, 'cm'],
    ['I_t', s.It / 1e4, 'cm⁴', 2], ['I_w', s.Iw / 1e6, 'cm⁶', 0],
    ['A_vz / A_vy', `${fmt(s.Avz / 100, 2)} / ${fmt(s.Avy / 100, 2)}`, 'cm²'],
    s.type === 'U' ? ['Schwerpunkt y_s (ab Rücken)', s.ys / 10, 'cm', 2] : null,
    s.type === 'U' ? ['Schubmittelpunkt y_M (ab S)', s.y0 / 10, 'cm', 2] : null,
    ['Masse', s.mass, 'kg/m', 1],
    ['f_y / f_u', `${mat.fy} / ${mat.fu}`, 'N/mm²'],
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
    x === sg.best ? h('b', {}, `${x.name} ★`) : x.name,
    fmt(x.mass, 1), x.error ? h('span', { class: 'small muted' }, 'Fehler') : utilBar(x.eta),
    x.name === cur && app.project.section.series === sg.series ? badge('aktuell', 'info') : button('Übernehmen', { small: true, onClick: () => { app.project.section.series = sg.series; app.project.section.name = x.name; app.suggest.stamp = stampOf(app.project); app.changed({ inputs: true }); toast(`${x.name} übernommen.`, 'ok'); } }),
  ]);
  return group(`Profilvorschlag ${sg.series}`, [
    stale ? note('Die Eingaben wurden seit der Suche geändert – bitte die Suche im Register «Profil» erneut ausführen.', 'warn') : null,
    sg.best ? h('div', { class: 'small' }, 'Leichtestes Profil mit η ≤ 1: ', h('b', {}, sg.best.name), rich(` (${fmt(sg.best.mass, 1)} kg/m, massgebend: ${sg.best.gov})`)) : note('Kein Profil dieser Reihe erfüllt alle Nachweise.', 'fail'),
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
<h3>Arbeiten in der Grafik</h3>
<p>Die Darstellung «System» ist der Hauptarbeitsbereich. Ein neues Projekt enthält einen Einfeldträger IPE 300 (S235, 6 m) ohne Lasten.</p>
<ul><li><b>Träger anklicken</b>: Profil, Stahlsorte, Norm, System und Stabilitätsangaben im Eigenschaftsfenster. In der Darstellung «Querschnitt» öffnet ein Klick auf das Profil die Profilwahl.</li>
<li><b>Streckenlast</b> (Q), <b>Einzellast</b> (F), <b>Normalkraft</b> (N): Werkzeug wählen und auf den Träger klicken; Wert, Lastfall und Richtung danach im Fenster. Neue Lasten kommen in den Lastfall, der ohne Auswahl im Fenster eingestellt ist.</li>
<li><b>Lager</b> (A): auf den Träger klicken; Lagerart (gelenkig/eingespannt) im Fenster. Lager entlang des Trägers ziehen; passt die Anordnung zu einer Vorlage (Einfeldträger, Kragarm, Durchlaufträger …), wird diese verwendet, sonst gilt «Frei».</li>
<li><b>Halterung</b> (H): seitliche Halterung (Gabellager) gegen Kippen und Knicken um z.</li>
<li><b>Ziehen</b>: Einzellasten (am Pfeilende), Enden und Bereich von Streckenlasten, Lager und Halterungen verschieben sich entlang x; das <b>Trägerende</b> ändert die Länge (ein Lager am Ende wandert mit). Das Raster fängt die Position, Alt schaltet den Fang aus.</li>
<li><b>Entf</b> löscht die Auswahl, <b>Esc</b> beendet ein Werkzeug bzw. hebt die Auswahl auf.</li>
<li>Bei «Schnittgrössen direkt» öffnet ein Klick auf den Stab Länge, Profil und Bemessungssituationen.</li></ul>
<p>Die Register links (1 Profil, 2 Lasten mit Kombinationen, 3 Stabilität) enthalten dieselben Eingaben als Listen und Formulare und bleiben mit der Grafik abgestimmt. Mehrere Bauteile pro Projekt verwalten Sie oben links (neu, duplizieren, umbenennen).</p>
<h3>Ergebnisse und Herleitung</h3>
<p>Rechts erscheinen alle Nachweise mit Ausnutzung. «Herleitung ›» neben einem Nachweis öffnet den Rechenweg mit allgemeiner Formel, eingesetzten Werten, Ergebnis und Normbezug; der Bericht enthält die Herleitung vollständig.</p>
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
<li>Die SIA-263-Ziffern sind sinngemäss zugeordnet; gerechnet wird nach den Formeln von EN 1993-1-1. Nationale Anhänge sind nicht berücksichtigt (empfohlene Werte).</li>
<li>Nicht enthalten: Ermüdung, Brand, Anschlüsse, Lasteinleitung (Stegkrüppeln), Nettoquerschnitt bei Löchern.</li></ul>`;

const INTRO = `<h4>So funktioniert's</h4><ol>
<li><b>Träger anklicken</b>: Profil, Stahlsorte und System im Eigenschaftsfenster wählen.</li>
<li><b>Lasten setzen</b>: Werkzeug «Streckenlast» (Q) oder «Einzellast» (F) wählen und auf den Träger klicken; Lager (A) und seitliche Halterungen (H) genauso.</li>
<li>Lasten, Lager und das Trägerende <b>ziehen</b> – die Nachweise rechnen sofort mit.</li>
<li>Rechts «Herleitung ›» zeigt den Rechenweg jedes Nachweises; «Bericht» erstellt die prüffähige Dokumentation. Fertige Fälle unter «Beispiele».</li></ol>`;

// ------------------------------------------------------------------ App

// ?offen=Erweitert,Kombinationen öffnet eingeklappte Karten (z.B. für Anleitungen)
for (const key of (new URLSearchParams(location.search).get('offen') || '').split(',').filter(Boolean)) {
  try { localStorage.setItem(`openstatik.grp.${location.pathname}.${key}`, '0'); } catch { /* privat */ }
}

const app = createApp({
  id: 'stahlbau',
  title: 'Stahlbau',
  instance: { label: 'Bauteil', plural: 'Bauteile' },
  subtitle: 'Stahlstäbe nach SIA 263 / EN 1993-1-1',
  version: 1,
  defaultProject,
  migrate,
  examples: EXAMPLES,
  intro: INTRO,
  editor: editorSpec,
  derivation,
  inputTabs: [
    { id: 'profil', label: 'Profil', render: renderProfile },
    { id: 'lasten', label: 'Lasten', render: renderLoads },
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

// Fangpunkte der Lager hängen vom Zoom ab (Pixelabstand unter dem Träger)
app.view.onChange(() => app.editor?.invalidate());

// Direkteinstieg über die Adresse (z.B. für Anleitungen): ?register=stab&auswahl=beam&detail=1
{
  const q = new URLSearchParams(location.search);
  if (q.get('detail')) { app.openLoad = 0; app.openLC = 0; app.openCase = 0; app.openRestr = 0; app.renderInputs(); }
  if (q.get('register')) app.selectTab(q.get('register'));
  if (q.get('auswahl') && app.editor) setTimeout(() => app.editor.select(q.get('auswahl').split(',')), 50);
  if (q.get('bericht')) setTimeout(() => [...document.querySelectorAll('.topbar button')].find((b) => /Bericht/.test(b.textContent))?.click(), 300);
}
