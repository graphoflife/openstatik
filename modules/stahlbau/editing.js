// Grafische Bearbeitung des Stahlträgers: Werkzeuge, Geometrie für den Editor, Eigenschaftsfenster.
//
// Systemansicht (Weltkoordinaten in m, Träger auf y = 0 von 0 bis L):
//   beam      Träger (Strecke)          → Profil, Stahl, System, Stabilität
//   end       Trägerende (Punkt)        → ziehen ändert die Länge; ein Lager am Ende wandert mit
//   S:i       Lager i (Punkt am Symbol) → ziehen verschiebt das Lager; Lagerart im Fenster
//   R:i       seitliche Halterung i     → ziehen entlang x
//   P:i       Einzellast (Last Nr. i)   → Griff oben am Pfeil, ziehen entlang x
//   q:i       Linienlast (Fläche)       → ziehen verschiebt den Bereich; qa:i / qb:i Anfang / Ende
//   N         Normalkraft (Fläche)      sw  Eigengewicht (Fläche)
// Schnittgrössen direkt: member (Stab), fend (Stabende), R:i.  Querschnittsansicht: section.
import { h, numField, selectField, checkField, button, kvTable, note, fmt, emptyState } from '../../js/core/ui.js';
import { TOOL_ICONS } from '../../js/core/editor.js';
import { SYSTEMS, CATEGORIES, beamModel, setBeamModel, normLoad } from './beam.js';
import { sectionProps } from './profiles.js';
import { systemLayout } from './draw.js';
import { profileFields, materialFields, systemFields, stabilityFields, caseFields, newCase, cantileverDefaults, INFO } from './fields.js';

const parse = (id) => { const k = String(id).indexOf(':'); return k < 0 ? { t: id, i: -1 } : { t: id.slice(0, k), i: +id.slice(k + 1) }; };
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const OPEN = { profil: true, system: false, stab: false, mat: true };

/** Ausklappbarer Abschnitt im Eigenschaftsfenster (Zustand bleibt beim Neuaufbau erhalten). */
function details(key, title, kids) {
  const d = h('details', { class: 'ed-details', open: !!OPEN[key] }, h('summary', {}, title), ...kids.filter(Boolean));
  d.addEventListener('toggle', () => { OPEN[key] = d.open; });
  return d;
}

function secOf(p) { try { return sectionProps(p.section); } catch { return null; } }
function layoutOf(p) { try { return systemLayout(p, secOf(p)); } catch { return null; } }

/** Position x auf dem Träger, am Fangraster gerundet. */
function snapX(app, x, L) {
  const g = app.editor?.snapOn !== false ? app.editor?.grid || 0 : 0;
  const v = g > 0 ? Math.round(x / g) * g : x;
  return r4(clamp(v, 0, L));
}

/** Lastfall für neue Lasten (vorhanden oder erster). */
function activeLC(p) {
  const b = p.beam;
  if (!b.loadCases?.length) b.loadCases = [{ id: 'G', name: 'Ständige Lasten', cat: 'G' }];
  return b.loadCases.find((l) => l.id === b.activeLC) || b.loadCases[0];
}

/** Lasten, Halterungen und Lager an eine neue Trägerlänge anpassen. */
function fitToLength(p, L) {
  for (const l of p.beam.loads || []) {
    if (l.kind === 'N' || l.type === 'N') continue;
    if (Number.isFinite(l.x1) && l.x1 >= L - 1e-9) l.x1 = (l.kind || l.type || 'q')[0] === 'P' ? r4(L) : null;
    if (Number.isFinite(l.x2) && l.x2 > L) l.x2 = null;
  }
  p.stab.restraints = (p.stab.restraints || []).filter((r) => r.x > 1e-6 && r.x < L - 1e-6);
}

const isCant = (b) => { try { return beamModel(b).supports.length === 1; } catch { return false; } };
/** Kragarm-Vorgaben (β = 2, k = kw = 0.7, FE) nur setzen bzw. zurücknehmen, wenn sich das ändert. */
function cantCheck(p, was) {
  const now = isCant(p.beam);
  if (now !== was) cantileverDefaults(p, now);
}

/** Trägerlänge ändern: Lager am alten Ende wandern mit, Lager ausserhalb entfallen. */
function resizeBeam(p, newL) {
  const m = beamModel(p.beam);
  const L = m.L;
  newL = r4(Math.max(0.1, newL));
  const sup = m.supports.map((s) => ({ ...s, x: Math.abs(s.x - L) < 1e-6 ? newL : s.x })).filter((s) => s.x <= newL + 1e-9);
  setBeamModel(p.beam, newL, sup);
  fitToLength(p, newL);
  return newL;
}

const LOAD_TOOLS = [
  { id: 'support', label: 'Lager', key: 'a', form: 'pick', pick: ['segment', 'point'], icon: TOOL_ICONS.support, title: 'Auf den Träger klicken: Lager an dieser Stelle (Lagerart danach im Fenster)', hint: 'Stelle auf dem Träger anklicken, an der ein Lager sitzt.' },
  { id: 'dist', label: 'Streckenlast', key: 'q', form: 'pick', pick: ['segment'], icon: TOOL_ICONS.load, title: 'Träger anklicken: Linienlast über die ganze Länge (Bereich und Wert danach im Fenster oder durch Ziehen der Enden)', hint: 'Träger anklicken, auf dem eine Streckenlast wirkt.' },
  { id: 'force', label: 'Einzellast', key: 'f', form: 'pick', pick: ['segment'], icon: TOOL_ICONS.pointload, title: 'Stelle auf dem Träger anklicken: Einzellast (danach ziehen oder Wert im Fenster)', hint: 'Stelle auf dem Träger anklicken, an der die Einzellast angreift.' },
  { id: 'axial', label: 'Normalkraft', key: 'n', form: 'pick', pick: ['segment', 'point'], icon: '<path d="M3 12h11M10 8l4 4-4 4"/><path d="M17 5v14" stroke-width="3"/>', title: 'Träger anklicken: Normalkraft (Druck positiv)', hint: 'Träger anklicken, auf den eine Normalkraft wirkt.' },
];
const RESTRAINT_TOOL = { id: 'restraint', label: 'Halterung', key: 'h', form: 'pick', pick: ['segment'], icon: '<circle cx="12" cy="12" r="6"/><path d="M8 8l8 8M16 8l-8 8"/>', title: 'Stelle auf dem Träger anklicken: seitliche Halterung (Gabellager gegen Kippen und Knicken um z)', hint: 'Stelle auf dem Träger anklicken, an der er seitlich gehalten ist.' };

export const editorSpec = {
  axes: ['x', 'y'],
  unit: 'm',
  digits: 3,
  grid: [0.05, 0.1, 0.25, 0.5, 1],
  gridDefault: 0.25,
  modes: ['system'],
  canCopy: false,
  _app: null,
  get tools() {
    const p = this._app?.project;
    return p?.mode === 'forces' ? [RESTRAINT_TOOL] : [...LOAD_TOOLS, RESTRAINT_TOOL];
  },

  geometry(app) {
    this._app = app;
    const p = app.project;
    const mode = app.viewMode;
    const sec = secOf(p);
    if (mode === 'section') {
      if (!sec) return {};
      const ring = sec.rings?.[0]?.length > 2 ? sec.rings[0] : [[-sec.b / 2, -sec.h / 2], [sec.b / 2, -sec.h / 2], [sec.b / 2, sec.h / 2], [-sec.b / 2, sec.h / 2]];
      return { regions: [{ id: 'section', ring: ring.map(([y, z]) => [y / 1000, z / 1000]), label: sec.name }] };
    }
    if (p.mode === 'forces') {
      const F = p.forces || {};
      const L = Number(F.L) || 0;
      if (!(L > 0)) return {};
      if (mode !== 'system') return { segments: [{ id: 'member', a: [0, 0], b: [L, 0], label: 'Stab', movable: false }] };
      const P = (s) => (F.orient === 'v' ? [0, s] : [s, 0]);
      const points = [{ id: 'fend', p: P(L), label: 'Stabende' }];
      if (!p.stab.contRestraint) (p.stab.restraints || []).forEach((r, i) => { if (r.x > 0 && r.x < L) points.push({ id: `R:${i}`, p: P(r.x), label: `Halterung x = ${fmt(r.x, 2)} m` }); });
      return { points, segments: [{ id: 'member', a: P(0), b: P(L), label: 'Stab', movable: false }] };
    }
    const lay = layoutOf(p);
    if (!lay) return {};
    const L = lay.L;
    const segments = [{ id: 'beam', a: [0, 0], b: [L, 0], label: 'Träger', movable: false }];
    if (mode !== 'system') return { segments };
    const off = app.view?.px ? app.view.px(9) : 0.1 * lay.u;
    const points = [{ id: 'end', p: [L, 0], label: 'Trägerende' }];
    lay.model.supports.forEach((s, i) => points.push({ id: `S:${i}`, p: [s.x, -off], label: `Lager x = ${fmt(s.x, 2)} m` }));
    if (!p.stab.contRestraint) (p.stab.restraints || []).forEach((r, i) => { if (r.x > 0 && r.x < L) points.push({ id: `R:${i}`, p: [r.x, lay.yR], label: `Halterung x = ${fmt(r.x, 2)} m` }); });
    for (const pt of lay.points) {
      points.push({ id: `P:${pt.ld.idx}`, p: [pt.x, pt.y1], label: 'Einzellast' });
      segments.push({ id: `P:${pt.ld.idx}`, a: [pt.x, pt.y0], b: [pt.x, pt.y1], label: 'Einzellast' });
    }
    const regions = [];
    for (const ln of lay.lanes) {
      if (ln.ld.self) { regions.push({ id: 'sw', ring: ln.ring, label: 'Eigengewicht', movable: false }); continue; }
      const i = ln.ld.idx;
      regions.push({ id: `q:${i}`, ring: ln.ring, label: 'Linienlast' });
      points.push({ id: `qa:${i}`, p: [ln.a, ln.yb], label: 'Anfang der Linienlast' }, { id: `qb:${i}`, p: [ln.b, ln.yb], label: 'Ende der Linienlast' });
    }
    if (lay.nArrow) regions.push({ id: 'N', ring: lay.nArrow.ring, label: 'Normalkraft', movable: false });
    const snaps = [];
    for (const f of lay.model.fields) snaps.push({ p: [(f.x0 + f.x1) / 2, 0] }, { p: [f.x0 + f.L / 3, 0] }, { p: [f.x0 + 2 * f.L / 3, 0] });
    for (const s of lay.model.supports) snaps.push({ p: [s.x, 0] });
    return { points, segments, regions, snaps };
  },

  pick(app, tool, hit) {
    const p = app.project;
    if (p.mode === 'forces') {
      if (tool !== 'restraint' || hit.id !== 'member') return null;
      const L = Number(p.forces.L) || 0;
      const x = snapX(app, p.forces.orient === 'v' ? hit.q[1] : hit.q[0], L);
      return addRestraint(app, x, L);
    }
    const lay = layoutOf(p);
    if (!lay) return null;
    const L = lay.L;
    if (tool === 'support' && hit.id.startsWith('S:')) return [hit.id];
    if (hit.id !== 'beam' && hit.id !== 'end') { app.status('Bitte direkt auf den Träger klicken.', 'warn'); return null; }
    const x = hit.id === 'end' ? L : snapX(app, hit.q[0], L);
    const b = p.beam;
    if (tool === 'support') {
      const sup = lay.model.supports.map((s) => ({ ...s }));
      const ex = sup.findIndex((s) => Math.abs(s.x - x) < 1e-6);
      if (ex >= 0) return [`S:${ex}`];
      sup.push({ x, type: 'pin' });
      const was = isCant(b);
      setBeamModel(b, L, sup);
      cantCheck(p, was);
      const j = beamModel(b).supports.findIndex((s) => Math.abs(s.x - x) < 1e-6);
      app.status(`Lager bei x = ${fmt(x, 2)} m – Lagerart im Eigenschaftsfenster wählen`, 'ok');
      app.editor?.setTool('select');
      return [`S:${j}`];
    }
    if (tool === 'restraint') return addRestraint(app, x, L);
    const lc = activeLC(p);
    if (tool === 'dist') {
      b.loads.push({ lc: lc.id, kind: 'qz', v1: 5, v2: null, x1: null, x2: null });
      app.status(`Streckenlast 5 kN/m über die ganze Länge (Lastfall «${lc.name}») – Wert und Bereich im Eigenschaftsfenster anpassen oder die Enden ziehen`, 'ok');
      app.editor?.setTool('select');
      return [`q:${b.loads.length - 1}`];
    }
    if (tool === 'force') {
      b.loads.push({ lc: lc.id, kind: 'Pz', v1: 10, v2: null, x1: x, x2: null });
      app.status(`Einzellast 10 kN bei x = ${fmt(x, 2)} m (Lastfall «${lc.name}») – Wert im Eigenschaftsfenster anpassen, Pfeil ziehen verschiebt`, 'ok');
      app.editor?.setTool('select');
      return [`P:${b.loads.length - 1}`];
    }
    if (tool === 'axial') {
      b.loads.push({ lc: lc.id, kind: 'N', v1: 100, v2: null, x1: null, x2: null });
      app.status(`Normalkraft 100 kN Druck (Lastfall «${lc.name}») – Wert im Eigenschaftsfenster anpassen`, 'ok');
      app.editor?.setTool('select');
      return ['N'];
    }
    return null;
  },

  move(app, ids, d) {
    const p = app.project;
    if (p.mode === 'forces') {
      const F = p.forces;
      const dl = F.orient === 'v' ? d[1] : d[0];
      const L = Number(F.L) || 0;
      for (const id of ids) {
        const { t, i } = parse(id);
        if (t === 'fend') { F.L = r4(Math.max(0.1, L + dl)); p.stab.restraints = p.stab.restraints.filter((r) => r.x < F.L - 1e-6); app.status(`Stablänge L = ${fmt(F.L, 2)} m`, 'ok'); }
        if (t === 'R' && p.stab.restraints[i]) p.stab.restraints[i].x = r4(clamp(p.stab.restraints[i].x + dl, 0.01, L - 0.01));
      }
      return ids;
    }
    const b = p.beam;
    const m = beamModel(b);
    const L = m.L, dx = d[0];
    const sup = m.supports.map((s) => ({ ...s }));
    let supMoved = null, newL = L, out = [];
    for (const id of ids) {
      const { t, i } = parse(id);
      const ld = b.loads[i];
      if (t === 'S' && sup[i]) { sup[i].x = r4(clamp(sup[i].x + dx, 0, L)); supMoved = sup[i]; }
      else if (t === 'end') newL = r4(Math.max(0.1, L + dx));
      else if (t === 'R' && p.stab.restraints[i]) p.stab.restraints[i].x = r4(clamp(p.stab.restraints[i].x + dx, 0.01, L - 0.01));
      else if (t === 'P' && ld) ld.x1 = r4(clamp(normLoad(ld, L).x1 + dx, 0, L));
      else if ((t === 'q' || t === 'qa' || t === 'qb') && ld) {
        const nl = normLoad(ld, L);
        let a = nl.x1, c = nl.x2;
        if (t === 'q') { const dd = clamp(dx, -Math.min(a, c), L - Math.max(a, c)); a += dd; c += dd; }
        else if (t === 'qa') a = clamp(a + dx, 0, c - 0.01);
        else c = clamp(c + dx, a + 0.01, L);
        ld.x1 = a < 1e-6 ? null : r4(a);
        ld.x2 = c > L - 1e-6 ? null : r4(c);
      }
    }
    if (supMoved) {
      const was = isCant(b);
      setBeamModel(b, L, sup);
      cantCheck(p, was);
      const j = beamModel(b).supports.findIndex((s) => Math.abs(s.x - supMoved.x) < 1e-6);
      app.status(`Lager bei x = ${fmt(supMoved.x, 2)} m · System: ${SYSTEMS.find((s) => s.value === b.system)?.label}`, 'ok');
      out = ids.map((id) => (id.startsWith('S:') ? `S:${j}` : id));
    } else out = ids.slice();
    if (newL !== L) {
      const Lr = resizeBeam(p, newL);
      app.status(`Trägerlänge L = ${fmt(Lr, 2)} m`, 'ok');
    }
    return out;
  },

  remove(app, ids) {
    const p = app.project;
    const b = p.beam;
    const loadIdx = new Set(), restr = new Set(), sups = new Set();
    let n = 0;
    for (const id of ids) {
      const { t, i } = parse(id);
      if (['P', 'q', 'qa', 'qb'].includes(t)) loadIdx.add(i);
      else if (t === 'N') (b.loads || []).forEach((l, k) => { if ((l.kind || l.type) === 'N') loadIdx.add(k); });
      else if (t === 'R') restr.add(i);
      else if (t === 'S') sups.add(i);
      else if (t === 'sw') { b.selfWeight = false; n++; }
      else app.status(t === 'section' ? 'Den Querschnitt ändern Sie im Eigenschaftsfenster.' : 'Der Träger selbst kann nicht gelöscht werden – Lasten, Lager und Halterungen schon.', 'warn');
    }
    for (const i of [...loadIdx].sort((a, c) => c - a)) { b.loads.splice(i, 1); n++; }
    p.stab.restraints = (p.stab.restraints || []).filter((_, i) => !restr.has(i));
    n += restr.size;
    if (sups.size) {
      const m = beamModel(b);
      const was = isCant(b);
      setBeamModel(b, m.L, m.supports.filter((_, i) => !sups.has(i)));
      cantCheck(p, was);
      n += sups.size;
    }
    if (n) app.status(`${n} Element${n === 1 ? '' : 'e'} gelöscht`, 'ok');
  },

  inspect(app, ids) {
    const p = app.project;
    if (ids.length !== 1) return { title: `${ids.length} Elemente`, content: [note('Ziehen verschiebt alle gewählten Lasten, Lager und Halterungen entlang des Trägers; Entf löscht sie.', '')] };
    const { t, i } = parse(ids[0]);
    switch (t) {
      case 'beam': return beamInspector(app);
      case 'section': return sectionInspector(app);
      case 'member': return memberInspector(app);
      case 'fend': return { title: 'Stabende', content: [numField('Stablänge L', p.forces, 'L', { unit: 'm', min: 0.01, onChange: () => app.changed({ inputs: true }) }), note('Ziehen ändert die Länge.', '')] };
      case 'end': return endInspector(app);
      case 'S': return supportInspector(app, i);
      case 'R': return restraintInspector(app, i);
      case 'P': return pointLoadInspector(app, i);
      case 'q': case 'qa': case 'qb': return lineLoadInspector(app, i);
      case 'N': return axialInspector(app);
      case 'sw': return selfWeightInspector(app);
      default: return null;
    }
  },

  idleHint(app) {
    const p = app.project;
    if (app.viewMode === 'section') return 'Querschnitt anklicken, um Profil und Stahlsorte zu wählen.';
    if (app.viewMode !== 'system') return 'Träger anklicken: Profil, System und Stabilität bearbeiten. Lasten und Lager setzen Sie in der Darstellung «System».';
    if (p.mode === 'forces') {
      return h('span', {}, 'Stab anklicken: Länge, Profil und Bemessungsschnittgrössen bearbeiten. Stabende ziehen ändert die Länge; ', h('b', {}, 'Halterung'), ' (H) setzt seitliche Halterungen.');
    }
    const b = p.beam;
    const lcSel = b.loadCases?.length ? selectField('Lastfall für neue Lasten', b, 'activeLC', b.loadCases.map((l) => ({ value: l.id, label: l.name })), { wide: true, onChange: () => app.editor?.refreshPanel(true), info: INFO.loadCases }) : null;
    if (b.activeLC === undefined && lcSel) b.activeLC = activeLC(p).id;
    if (!(b.loads || []).length) {
      return h('div', {},
        h('div', {}, 'Lasten setzen: Werkzeug ', h('b', {}, 'Streckenlast'), ' (Q) oder ', h('b', {}, 'Einzellast'), ' (F) wählen und auf den Träger klicken. ', h('b', {}, 'Lager'), ' (A) und ', h('b', {}, 'Halterung'), ' (H) setzen Sie genauso.'),
        h('div', { class: 'muted small', style: { marginTop: '4px' } }, 'Klick auf den Träger öffnet Profil, Stahlsorte, System und Stabilität.'),
        lcSel);
    }
    return h('div', {},
      h('div', {}, 'Träger, Lager oder Lasten anklicken, um sie zu bearbeiten. Lasten, Lager und Halterungen lassen sich entlang des Trägers ziehen, das Trägerende ändert die Länge.'),
      lcSel);
  },
};

function addRestraint(app, x, L) {
  const p = app.project;
  const st = p.stab;
  if (st.contRestraint) { app.status('Der Druckgurt ist durchgehend gehalten – einzelne Halterungen sind nicht nötig (Register «Stabilität»).', 'warn'); return null; }
  if (x <= 1e-6 || x >= L - 1e-6) { app.status('An den Trägerenden ist der Träger durch die Lager gehalten bzw. frei (Kragarm). Bitte eine Stelle dazwischen wählen.', 'warn'); return null; }
  st.restraints = st.restraints || [];
  const ex = st.restraints.findIndex((r) => Math.abs(r.x - x) < 1e-6);
  if (ex >= 0) return [`R:${ex}`];
  st.restraints.push({ x });
  app.status(`Seitliche Halterung bei x = ${fmt(x, 2)} m`, 'ok');
  return [`R:${st.restraints.length - 1}`];
}

// ------------------------------------------------------------------ Eigenschaftsfenster

const chP = (app) => () => app.changed({ inputs: true });

function resultLines(app) {
  const r = app.results;
  if (!r) return null;
  return [
    h('div', { class: 'ed-sub' }, 'Ergebnis'),
    kvTable([
      ['max. Ausnutzung η', r.etaMax, '', 2],
      ['massgebend', r.gov?.label || ''],
    ]),
    button('Herleitung ›', { small: true, onClick: () => app.showDerivation?.(DERIV_OF(r.gov?.id)) }),
  ];
}

/** Abschnitt der Herleitung zu einer Nachweis-ID. */
export function DERIV_OF(id) {
  if (!id) return null;
  if (id === 'Nby' || id === 'Nbz') return 'Nb';
  if (id === 'int61' || id === 'int62') return 'int';
  if (id.startsWith('w-')) return 'w';
  return id;
}

function beamInspector(app) {
  const p = app.project;
  const opts = { ch: chP(app), chI: chP(app), compact: true };
  let m = null;
  try { m = beamModel(p.beam); } catch { /* */ }
  const sec = secOf(p);
  return {
    title: `Träger${sec ? ` ${sec.name}` : ''}`,
    content: [
      m ? h('div', { class: 'muted small' }, `L = ${fmt(m.L, 2)} m · ${SYSTEMS.find((s) => s.value === p.beam.system)?.label || ''}`) : null,
      details('profil', 'Profil', profileFields(app, opts)),
      details('mat', 'Stahl und Norm', materialFields(app, opts)),
      details('system', 'System', systemFields(app, opts)),
      details('stab', 'Stabilität', stabilityFields(app, opts)),
      ...(resultLines(app) || []),
    ],
  };
}

function sectionInspector(app) {
  const opts = { ch: chP(app), chI: chP(app), compact: true };
  return { title: 'Querschnitt', content: [...profileFields(app, opts), ...materialFields(app, opts)] };
}

function memberInspector(app) {
  const p = app.project, F = p.forces;
  const opts = { ch: chP(app), chI: chP(app), compact: true };
  const cases = F.cases;
  app.selCase = Math.min(app.selCase ?? 0, Math.max(0, cases.length - 1));
  const out = [
    h('div', { class: 'grid2' },
      numField('Länge L', F, 'L', { unit: 'm', min: 0.01, onChange: chP(app) }),
      selectField('Lage', F, 'orient', [{ value: 'h', label: 'Träger' }, { value: 'v', label: 'Stütze' }], { onChange: chP(app) })),
    details('profil', 'Profil, Stahl', [...profileFields(app, opts), ...materialFields(app, opts)]),
    h('div', { class: 'ed-sub' }, 'Bemessungsschnittgrössen'),
  ];
  if (!cases.length) out.push(emptyState('Noch keine Situation', 'Mit «Situation hinzufügen» Bemessungswerte N, My, Mz … erfassen.'));
  else {
    const sel = { i: app.selCase };
    out.push(selectField('Situation', sel, 'i', cases.map((c, k) => ({ value: k, label: c.name || `Situation ${k + 1}` })), { wide: true, onChange: (v) => { app.selCase = v; app.renderInputs?.(); app.editor.refreshPanel(true); } }));
    out.push(...caseFields(cases[app.selCase], { ch: chP(app), chI: chP(app) }));
  }
  out.push(h('div', { class: 'row' },
    button('Situation hinzufügen', { icon: 'plus', small: true, onClick: () => { cases.push(newCase(cases.length + 1)); app.selCase = cases.length - 1; app.changed({ inputs: true }); } }),
    cases.length ? button('', { icon: 'trash', small: true, ghost: true, title: 'Situation löschen', onClick: () => { cases.splice(app.selCase, 1); app.selCase = Math.max(0, app.selCase - 1); app.changed({ inputs: true }); } }) : null));
  out.push(...(resultLines(app) || []));
  return { title: 'Stab', content: out };
}

function endInspector(app) {
  const p = app.project;
  const m = beamModel(p.beam);
  const obj = { L: m.L };
  return {
    title: 'Trägerende',
    content: [
      numField('Trägerlänge L', obj, 'L', { unit: 'm', min: 0.1, onChange: (v) => { resizeBeam(p, v); app.changed({ inputs: true }); } }),
      note('Ziehen ändert die Länge. Ein Lager am Trägerende wandert mit; Lasten und Halterungen ausserhalb werden angepasst.', ''),
    ],
  };
}

function supportInspector(app, i) {
  const p = app.project;
  const m = beamModel(p.beam);
  const s = m.supports[i];
  if (!s) return null;
  const obj = { x: s.x, type: s.type };
  const apply = () => {
    const sup = m.supports.map((q, k) => (k === i ? { x: obj.x, type: obj.type } : { ...q }));
    const was = isCant(p.beam);
    setBeamModel(p.beam, m.L, sup);
    cantCheck(p, was);
    const j = beamModel(p.beam).supports.findIndex((q) => Math.abs(q.x - obj.x) < 1e-6);
    if (app.editor && j >= 0) app.editor.sel = [`S:${j}`];
    app.changed({ inputs: true });
  };
  return {
    title: `Lager bei x = ${fmt(s.x, 2)} m`,
    content: [
      selectField('Lagerart', obj, 'type', [{ value: 'pin', label: 'gelenkig' }, { value: 'fix', label: 'eingespannt' }], { wide: true, onChange: apply, info: 'Alle Lager halten den Träger vertikal und seitlich (Gabellager). Eingespannt verhindert zusätzlich die Verdrehung in der Ebene.' }),
      numField('Lage x', obj, 'x', { unit: 'm', min: 0, max: m.L, onChange: apply }),
      h('div', { class: 'muted small' }, `System: ${SYSTEMS.find((q) => q.value === p.beam.system)?.label || ''}`),
      note('Ziehen verschiebt das Lager; die Spannweite ändern Sie am Trägerende.', ''),
    ],
  };
}

function restraintInspector(app, i) {
  const p = app.project;
  const r = p.stab.restraints[i];
  if (!r) return null;
  const L = p.mode === 'forces' ? Number(p.forces.L) || 0 : beamModel(p.beam).L;
  return {
    title: 'Seitliche Halterung',
    content: [
      numField('Lage x', r, 'x', { unit: 'm', min: 0, max: L, onChange: chP(app) }),
      note('Gabellager: seitliche Verschiebung und Verdrehung verhindert. Bestimmt die Kipplänge und die Knicklänge um z.', ''),
      checkField('Druckgurt durchgehend gehalten', p.stab, 'contRestraint', { onChange: chP(app), info: INFO.cont }),
    ],
  };
}

/** Lastfall einer Last (mit «neuer Lastfall») und dessen Kategorie. */
function lcFields(app, ld) {
  const p = app.project, b = p.beam;
  const opts = [...b.loadCases.map((l) => ({ value: l.id, label: l.name })), { value: '__new', label: '+ Neuer Lastfall …' }];
  const lc = b.loadCases.find((l) => l.id === ld.lc);
  return [
    selectField('Lastfall', ld, 'lc', opts, {
      wide: true, info: INFO.loadCases,
      onChange: (v) => {
        if (v === '__new') {
          let k = 1; while (b.loadCases.some((l) => l.id === `L${k}`)) k++;
          b.loadCases.push({ id: `L${k}`, name: `Lastfall ${b.loadCases.length + 1}`, cat: 'Nutzlast' });
          ld.lc = `L${k}`;
        }
        b.activeLC = ld.lc;
        app.changed({ inputs: true });
      },
    }),
    lc ? selectField('Kategorie', lc, 'cat', CATEGORIES, { wide: true, onChange: chP(app), info: `Gilt für alle Lasten im Lastfall «${lc.name}». Name und Kategorie auch im Register «Belastung».` }) : null,
  ].filter(Boolean);
}

function pointLoadInspector(app, i) {
  const p = app.project, ld = p.beam.loads[i];
  if (!ld) return null;
  const m = beamModel(p.beam);
  if (!Number.isFinite(ld.x1)) ld.x1 = r4(m.L / 2);
  return {
    title: 'Einzellast',
    content: [
      ...lcFields(app, ld),
      selectField('Richtung', ld, 'kind', [{ value: 'Pz', label: 'vertikal ↓ (z)' }, { value: 'Py', label: 'horizontal (y)' }], { wide: true, onChange: chP(app), info: INFO.loads }),
      h('div', { class: 'grid2' },
        numField('P', ld, 'v1', { unit: 'kN', onChange: chP(app), info: 'Positiv nach unten (bzw. in +y), negativ nach oben.' }),
        numField('Lage x', ld, 'x1', { unit: 'm', min: 0, max: m.L, onChange: chP(app) })),
      m.fields.length ? h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Mitte:'), ...m.fields.map((f, k) => button(m.fields.length > 1 ? `Feld ${k + 1}` : 'Feldmitte', { small: true, onClick: () => { ld.x1 = r4((f.x0 + f.x1) / 2); app.changed({ inputs: true }); } }))) : null,
    ],
  };
}

function lineLoadInspector(app, i) {
  const p = app.project, ld = p.beam.loads[i];
  if (!ld) return null;
  const m = beamModel(p.beam);
  return {
    title: 'Streckenlast',
    content: [
      ...lcFields(app, ld),
      selectField('Richtung', ld, 'kind', [{ value: 'qz', label: 'vertikal ↓ (z)' }, { value: 'qy', label: 'horizontal (y)' }], { wide: true, onChange: chP(app), info: INFO.loads }),
      h('div', { class: 'grid2' },
        numField('q', ld, 'v1', { unit: 'kN/m', onChange: chP(app), info: 'Wert am Anfang x₁ (positiv nach unten).' }),
        numField('q Ende', ld, 'v2', { unit: 'kN/m', allowEmpty: true, onChange: chP(app), info: 'Nur für Trapez- und Dreieckslasten. Leer = konstant.' }),
        numField('von x₁', ld, 'x1', { unit: 'm', min: 0, max: m.L, allowEmpty: true, onChange: chP(app), info: 'Leer = Trägeranfang.' }),
        numField('bis x₂', ld, 'x2', { unit: 'm', min: 0, max: m.L, allowEmpty: true, onChange: chP(app), info: 'Leer = Trägerende.' })),
      h('div', { class: 'row' },
        button('ganze Länge', { small: true, onClick: () => { ld.x1 = null; ld.x2 = null; app.changed({ inputs: true }); } }),
        ...(m.fields.length > 1 ? m.fields.map((f, k) => button(`Feld ${k + 1}`, { small: true, title: `${fmt(f.x0, 2)} … ${fmt(f.x1, 2)} m`, onClick: () => { ld.x1 = f.x0 > 1e-9 ? r4(f.x0) : null; ld.x2 = f.x1 < m.L - 1e-9 ? r4(f.x1) : null; app.changed({ inputs: true }); } })) : [])),
      h('div', { class: 'muted small' }, 'Die Enden der Last lassen sich in der Grafik ziehen.'),
    ],
  };
}

function axialInspector(app) {
  const p = app.project, b = p.beam;
  const out = [];
  b.loads.forEach((ld, k) => {
    if ((ld.kind || ld.type) !== 'N') return;
    out.push(h('div', { class: 'ed-load' },
      h('div', {}, ...lcFields(app, ld), numField('N', ld, 'v1', { unit: 'kN', onChange: chP(app), info: 'Druck positiv, Zug negativ. Konstant über die Stablänge.' })),
      button('', { icon: 'trash', small: true, ghost: true, title: 'Last entfernen', onClick: () => { b.loads.splice(k, 1); app.changed({ inputs: true }); } })));
  });
  out.push(button('Normalkraft', { icon: 'plus', small: true, onClick: () => { b.loads.push({ lc: activeLC(p).id, kind: 'N', v1: 100, v2: null, x1: null, x2: null }); app.changed({ inputs: true }); } }));
  return { title: 'Normalkraft', content: out };
}

function selfWeightInspector(app) {
  const p = app.project, sec = secOf(p);
  return {
    title: 'Eigengewicht',
    content: [
      sec ? kvTable([['g = A · 78.5 kN/m³', sec.A * 1e-6 * 78.5, 'kN/m', 3]]) : null,
      checkField('Eigengewicht automatisch ansetzen', p.beam, 'selfWeight', { onChange: chP(app), info: INFO.selfWeight }),
    ].filter(Boolean),
  };
}
