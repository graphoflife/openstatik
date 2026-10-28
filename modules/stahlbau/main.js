// Stahlbau – Stabnachweise nach SIA 263 / EN 1993-1-1: Benutzeroberfläche
import { createApp } from '../../js/core/app.js';
import {
  h, group, numField, selectField, checkField, dataTable, segmented, button, kvTable, resultTable,
  checksTable, summaryCard, stats, note, emptyState, toast, utilBar, badge, fmt,
} from '../../js/core/ui.js';
import { SERIES, SEARCHABLE, sectionProps } from './profiles.js';
import { CATEGORIES, systemGeometry, autoCombos, defaultFactors, patternLoading, normSupports } from './beam.js';
import { compute, suggestProfiles, latRestraintPositions } from './calc.js';
import { defaultProject, EXAMPLES } from './examples.js';
import { drawSystem, drawForces, drawDeflection, drawSection } from './draw.js';
import { buildReport } from './bericht.js';
import { editorSpec, DERIV_OF } from './editing.js';
import { derivation } from './derivation.js';
import { INFO, profileFields, materialFields, systemFields, caseFields, newCase } from './fields.js';

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

// ------------------------------------------------------------------ Register 1: Profil

function renderProfile(el, app) {
  const p = app.project;
  const opts = { ch: ch(app), chI: chI(app) };
  el.append(group('Querschnitt', profileFields(app, opts), { info: 'Profil wählen – hier oder durch Klick auf den Träger bzw. den Querschnitt in der Grafik. Mit − / + gelangt man zum nächstkleineren bzw. -grösseren Profil der Reihe.' }));
  el.append(group('Werkstoff und Norm', materialFields(app, opts)));

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
  const spansTable = (kind) => {
    if (kind === 'cont') {
      const rows = b.spans.map((L) => ({ L }));
      return dataTable([{ key: 'L', label: 'Spannweite', unit: 'm', min: 0.01 }], rows, {
        newRow: () => ({ L: rows[rows.length - 1]?.L || 5 }), minRows: 2, hint: 'Felder von links nach rechts',
        onChange: (e) => { b.spans = rows.map((r) => r.L); if (e.type === 'edit') ch(app)(); else chI(app)(); },
        rowLabel: (i) => `Feld ${i + 1}`,
      });
    }
    b.supports = normSupports(b.supports, Number(b.length) || 0);
    return dataTable([
      { key: 'x', label: 'Lage x', unit: 'm', min: 0, info: 'Abstand vom linken Trägerende.' },
      { key: 'type', label: 'Lagerart', type: 'select', options: [{ value: 'pin', label: 'gelenkig' }, { value: 'fix', label: 'eingespannt' }], width: '120px' },
    ], b.supports, {
      newRow: () => ({ x: Number(b.length) || 0, type: 'pin' }), hint: 'Lager auch grafisch setzen (Werkzeug «Lager»)',
      onChange: (e) => (e.type === 'edit' ? ch(app)() : chI(app)()),
    });
  };
  el.append(group('Statisches System', systemFields(app, { ch: ch(app), chI: chI(app), spansTable }), { info: INFO.system }));

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
  const add = () => { cases.push(newCase(cases.length + 1)); app.selCase = cases.length - 1; chI(app)(); };
  const kids = [];
  if (!cases.length) kids.push(emptyState('Noch keine Schnittgrössen', 'Mit «Situation hinzufügen» eine Bemessungssituation mit N, My, Mz … erfassen – oder den Stab in der Grafik anklicken.'));
  else kids.push(list);
  kids.push(h('div', { class: 'row', style: { margin: '0 0 8px' } },
    button('Situation hinzufügen', { icon: 'plus', small: true, onClick: add }),
    cases.length ? button('Duplizieren', { icon: 'copy', small: true, onClick: () => { cases.splice(app.selCase + 1, 0, { ...cases[app.selCase], name: `${cases[app.selCase].name} (Kopie)` }); app.selCase++; chI(app)(); } }) : null,
    cases.length ? button('Löschen', { icon: 'trash', small: true, ghost: true, onClick: () => { cases.splice(app.selCase, 1); app.selCase = Math.max(0, app.selCase - 1); chI(app)(); } }) : null));
  const c = cases[app.selCase];
  if (c) {
    kids.push(h('div', { class: 'group', style: { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)' } },
      ...caseFields(c, { ch: ch(app), chI: chI(app) })));
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
    const pattern = patternLoading(p.beam);
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
  const pattern = patternLoading(p.beam);
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
      label: c.label, ref: c.ref, Ed: c.Ed, Rd: c.Rd, unit: c.unit, digits: 1, eta: c.eta, deriv: DERIV_OF(c.id),
      detail: [c.comboName, Number.isFinite(c.x) && c.group !== 'Stabilität' ? `x = ${fmt(c.x, 2)} m` : null, c.seg && c.group === 'Stabilität' ? `Segment ${fmt(c.seg.x0, 2)} … ${fmt(c.seg.x1, 2)} m` : null, c.detail].filter(Boolean).join(' · '),
    })))]));
  }
  if (r.uls.length && !r.checks.some((c) => c.group === 'Stabilität') && !st.ltbActive && st.ltbReason) el.append(note(`Kippen: ${st.ltbReason}.`, ''));

  // Klassifizierung
  el.append(group(`Querschnittsklassifizierung – Klasse ${u.cls}`, [classTable(u), h('div', { class: 'muted small', style: { marginTop: '4px' } }, `ε = √(235/fy) = ${fmt(u.klass.eps, 3)} · unter N = ${fmt(Math.max(0, u.Nc), 1)} kN, My = ${fmt(u.MyMax, 1)} kNm, Mz = ${fmt(u.MzMax, 1)} kNm (${u.combo.name})`)], { collapsible: true, collapsed: true, info: 'Klassifizierung der gedrückten Querschnittsteile nach EN 1993-1-1 Tab. 5.2 unter der tatsächlichen Beanspruchung der massgebenden Kombination.', actions: [button('Herleitung ›', { small: true, ghost: true, onClick: () => app.showDerivation('klasse') })] }));

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
<h3>Arbeiten in der Grafik</h3>
<p>Die Darstellung «System» ist der Hauptarbeitsbereich. Ein neues Projekt enthält einen Einfeldträger IPE 300 (S235, 6 m) ohne Lasten.</p>
<ul><li><b>Träger anklicken</b>: Profil, Stahlsorte, Norm, System und Stabilitätsangaben im Eigenschaftsfenster. In der Darstellung «Querschnitt» öffnet ein Klick auf das Profil die Profilwahl.</li>
<li><b>Streckenlast</b> (Q), <b>Einzellast</b> (F), <b>Normalkraft</b> (N): Werkzeug wählen und auf den Träger klicken; Wert, Lastfall und Richtung danach im Fenster. Neue Lasten kommen in den Lastfall, der ohne Auswahl im Fenster eingestellt ist.</li>
<li><b>Lager</b> (A): auf den Träger klicken; Lagerart (gelenkig/eingespannt) im Fenster. Lager entlang des Trägers ziehen; passt die Anordnung zu einer Vorlage (Einfeldträger, Kragarm, Durchlaufträger …), wird diese verwendet, sonst gilt «Frei».</li>
<li><b>Halterung</b> (H): seitliche Halterung (Gabellager) gegen Kippen und Knicken um z.</li>
<li><b>Ziehen</b>: Einzellasten (am Pfeilende), Enden und Bereich von Streckenlasten, Lager und Halterungen verschieben sich entlang x; das <b>Trägerende</b> ändert die Länge (ein Lager am Ende wandert mit). Das Raster fängt die Position, Alt schaltet den Fang aus.</li>
<li><b>Entf</b> löscht die Auswahl, <b>Esc</b> beendet ein Werkzeug bzw. hebt die Auswahl auf.</li>
<li>Bei «Schnittgrössen direkt» öffnet ein Klick auf den Stab Länge, Profil und Bemessungssituationen.</li></ul>
<p>Die Register links enthalten dieselben Eingaben als Formulare (z.B. Lasten als Tabelle, Kombinationen, alle Stabilitätsangaben) und bleiben mit der Grafik abgestimmt.</p>
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

const app = createApp({
  id: 'stahlbau',
  title: 'Stahlbau',
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

// Fangpunkte der Lager hängen vom Zoom ab (Pixelabstand unter dem Träger)
app.view.onChange(() => app.editor?.invalidate());
