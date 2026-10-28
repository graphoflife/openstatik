// Querschnitt – Querschnittsanalyse Stahlbeton (Oberfläche)
import { createApp } from '../../js/core/app.js';
import { h, group, numField, selectField, checkField, textField, dataTable, segmented, button, note, emptyState, toast, selectInput, badge } from '../../js/core/ui.js';
import { CONCRETE_CLASSES, REBAR_GRADES, NORMS } from '../../js/core/materials.js';
import { fmt } from '../../js/core/format.js';
import {
  SHAPE_TYPES, SHAPE_PARAMS, defaultShapes, templatePolygons, templateToPoly, projectGeometry, bounds, rowsToPts, ptsToRows,
  barsLayers, barsRow, barsCircle, barsPerimeter, barsCircular, circlePts, barAreaMm2, polygonProps,
} from './shapes.js';
import { analyze, createCache, materialSet, grossProps, SLS_REQUIREMENTS, REF_POINTS } from './calc.js';
import { renderView, hitTest, caseIndex, STATE_OPTIONS, signFigure, shapeIcon } from './view.js';
import { renderResults, buildReport } from './results.js';
import { baseProject, defaultProject, EXAMPLES } from './examples.js';
import { INTRO, HELP } from './help.js';

/** Gemeinsamer Zustand der Oberfläche (nicht Teil des Projekts). */
const ctx = {
  cache: createCache(),
  ui: { resTab: 'nachweise', nmAxis: 'My', mkDir: 'auto', barGen: 'vorlage', openGen: 'rect' },
  gen: null,      // Parameter der Bewehrungsgeneratoren
  openPar: null,  // Parameter des Aussparungsgenerators
  tables: {},
};

const upd = (app) => () => app.changed();
const updInputs = (app) => () => app.changed({ inputs: true });

// ------------------------------------------------------------------ Hilfetexte

const PARAM_INFO = {
  rect: { b: 'Breite in y-Richtung (horizontal).', h: 'Höhe in z-Richtung. Die Unterkante liegt auf z = 0, der Querschnitt ist zur z-Achse zentriert.' },
  T: {
    b: 'Mitwirkende Plattenbreite b<sub>eff</sub> (SIA 262 4.1.3.3.2 bzw. EN 1992-1-1 5.3.2.1).',
    hf: 'Dicke der Platte (Druckgurt bei positivem Moment).',
    bw: 'Breite des Stegs.',
    h: 'Gesamthöhe inklusive Platte.',
  },
  I: { bo: 'Breite des oberen Gurts.', to: 'Dicke des oberen Gurts.', bu: 'Breite des unteren Gurts.', tu: 'Dicke des unteren Gurts.', bw: 'Stegbreite.', h: 'Gesamthöhe.' },
  box: {
    bo: 'Breite der oberen Platte inkl. Kragplatten. Gleich bu → rechteckiger Kasten.',
    bu: 'Aussenbreite des Kastens (Abstand der Stegaussenseiten).',
    h: 'Gesamthöhe.', to: 'Dicke der oberen Platte (Fahrbahnplatte).', tu: 'Dicke der unteren Platte.', tw: 'Dicke eines Stegs.',
  },
  circle: { D: 'Durchmesser. Modelliert als flächengleiches 72-Eck, Mittelpunkt im Ursprung (0/0).' },
  ring: { D: 'Aussendurchmesser, Mittelpunkt im Ursprung.', t: 'Wandstärke (radial).' },
  L: { b: 'Länge des unteren Schenkels (in y-Richtung).', h: 'Länge des linken Schenkels (in z-Richtung).', tb: 'Dicke des unteren Schenkels.', th: 'Dicke des linken Schenkels.' },
};

// ------------------------------------------------------------------ Register 1: Querschnitt

function setShape(app, id) {
  const p = app.project;
  if (p.shape.type === id) return;
  if (id === 'poly') {
    try {
      const conv = templateToPoly(p.shape);
      p.shape.poly = conv.poly;
      p.openings = [...conv.openings.map((o) => ({ ...o, fromTemplate: true })), ...(p.openings || []).filter((o) => !o.fromTemplate)];
      toast('Die Form wurde in ein Polygon umgewandelt – die Eckpunkte sind jetzt frei bearbeitbar.', 'ok');
    } catch (e) {
      toast(`Umwandlung nicht möglich: ${e.message}`, 'warn');
    }
  } else if (p.shape.type === 'poly') {
    // aus einer Vorlage stammende Hohlräume gehören zum Polygon
    p.openings = (p.openings || []).filter((o) => !o.fromTemplate);
  }
  p.shape.type = id;
  app.selection = null;
  // Stäbe ausserhalb der neuen Form melden
  const g = projectGeometry(p);
  const outside = g.warnings.filter((w) => w.includes('ausserhalb')).length;
  if (outside) toast(`${outside} Stäbe liegen ausserhalb der neuen Form – Bewehrung im Register «Bewehrung» neu erzeugen.`, 'warn', 5000);
  app.changed({ inputs: true });
}

function shapePicker(app) {
  const p = app.project;
  const defs = defaultShapes();
  const wrap = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px', margin: '2px 0 6px' } });
  for (const s of SHAPE_TYPES) {
    let ic;
    try {
      if (s.id === 'poly') {
        const pts = rowsToPts(p.shape.poly);
        ic = pts.length >= 3 ? shapeIcon(pts) : shapeIcon([[0, 0], [10, 0], [12, 6], [6, 11], [0, 7]]);
      } else {
        const t = templatePolygons(s.id, defs[s.id]);
        ic = shapeIcon(t.outer, t.holes);
      }
    } catch { ic = shapeIcon([[0, 0], [1, 0], [1, 1], [0, 1]]); }
    const active = p.shape.type === s.id;
    wrap.append(h('button', {
      type: 'button', class: 'btn', title: s.id === 'poly' ? 'Polygon frei: Eckpunkte und Aussparungen beliebig (aktuelle Form wird übernommen)' : s.label,
      'aria-pressed': active ? 'true' : 'false',
      style: {
        flexDirection: 'column', height: 'auto', padding: '6px 2px 5px', gap: '2px', fontSize: '11px', minWidth: 0,
        borderColor: active ? 'var(--accent)' : 'var(--border)', background: active ? 'var(--accent-soft)' : 'var(--surface)',
        color: active ? 'var(--text)' : 'var(--text-2)', fontWeight: active ? 600 : 400, boxShadow: active ? '0 0 0 1px var(--accent) inset' : 'none',
      },
      onclick: () => setShape(app, s.id),
    }, ic, h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' } }, s.label)));
  }
  return wrap;
}

function polyTable(app, onEdit) {
  const p = app.project;
  if (!Array.isArray(p.shape.poly)) p.shape.poly = defaultShapes().poly;
  const rows = p.shape.poly;
  const tbl = dataTable([
    { key: 'y', label: 'y', unit: 'mm', info: 'Horizontale Koordinate des Eckpunkts (nach rechts positiv).' },
    { key: 'z', label: 'z', unit: 'mm', info: 'Vertikale Koordinate des Eckpunkts (nach oben positiv).' },
  ], rows, {
    onChange: () => { app.changed(); onEdit?.(); },
    newRow: (r) => {
      const a = r[r.length - 1] || { y: 0, z: 0 }, b = r[0] || { y: 0, z: 0 };
      return { y: Math.round((a.y + b.y) / 2), z: Math.round((a.z + b.z) / 2) };
    },
    minRows: 3, canMove: true, maxHeight: '260px',
    rowLabel: (i) => i + 1,
    onSelect: (i) => { app.selection = { kind: 'vertex', index: i }; app.redraw(); },
    hint: 'Eckpunkte der Reihe nach entlang des Randes · Excel-Einfügen (y, z)',
    extraButtons: [button('Schwerpunkt → (0/0)', { small: true, title: 'Polygon, Aussparungen und Bewehrung so verschieben, dass der Schwerpunkt im Ursprung liegt', onClick: () => centerPolygon(app) })],
  });
  ctx.tables.poly = tbl;
  return tbl;
}

function centerPolygon(app) {
  const p = app.project;
  const g = projectGeometry(p);
  if (g.errors.length) { toast(g.errors[0], 'warn'); return; }
  const gp = grossProps(g.outer, g.holes);
  const dy = Math.round(gp.cy * 10) / 10, dz = Math.round(gp.cz * 10) / 10;
  const mv = (r) => { r.y = Math.round((r.y - dy) * 10) / 10; r.z = Math.round((r.z - dz) * 10) / 10; };
  p.shape.poly.forEach(mv);
  (p.openings || []).forEach((o) => o.pts.forEach(mv));
  (p.bars || []).forEach(mv);
  app.changed({ inputs: true });
  toast(`Verschoben um Δy = ${fmt(-dy, 1)} mm, Δz = ${fmt(-dz, 1)} mm.`, 'ok');
}

function openingsGroup(app) {
  const p = app.project;
  p.openings ||= [];
  const kids = [];
  if (!p.openings.length) kids.push(emptyState('Keine Aussparungen', 'Hüllrohre oder Durchbrüche unten als Rechteck oder Kreis hinzufügen – sie lassen sich danach als Polygon bearbeiten.'));
  p.openings.forEach((o, k) => {
    const tbl = dataTable([
      { key: 'y', label: 'y', unit: 'mm' },
      { key: 'z', label: 'z', unit: 'mm' },
    ], o.pts, { onChange: upd(app), minRows: 3, canMove: true, maxHeight: '180px', hint: 'Excel-Einfügen (y, z)',
      newRow: (r) => { const a = r[r.length - 1] || { y: 0, z: 0 }, b = r[0] || { y: 0, z: 0 }; return { y: Math.round((a.y + b.y) / 2), z: Math.round((a.z + b.z) / 2) }; } });
    const A = Math.abs(polygonProps(rowsToPts(o.pts)).A || 0);
    kids.push(group(h('span', {}, o.name || `Aussparung ${k + 1}`, h('span', { class: 'muted', style: { fontWeight: 400, textTransform: 'none', marginLeft: '6px' } }, `${o.pts.length} Punkte · ${fmt(A, 0)} mm²`)), [
      textField('Bezeichnung', o, 'name', { onChange: updInputs(app) }),
      tbl,
    ], { collapsible: true, collapsed: true, actions: [button('', { icon: 'trash', small: true, ghost: true, title: 'Aussparung löschen', onClick: () => { p.openings.splice(k, 1); app.changed({ inputs: true }); } })] }));
  });
  // Generator
  initGen(app);
  const g = projectGeometry(p);
  const bb = g.outer.length ? bounds(g.outer) : { ymin: -100, ymax: 100, zmin: 0, zmax: 200, b: 200, h: 200 };
  if (!ctx.openPar) {
    const s = Math.round(Math.min(bb.b, bb.h) * 0.2 / 10) * 10 || 100;
    ctx.openPar = { yc: Math.round((bb.ymin + bb.ymax) / 2), zc: Math.round((bb.zmin + bb.zmax) / 2), b: s, h: s, D: s };
  }
  const op = ctx.openPar;
  const kind = ctx.ui.openGen;
  const fields = h('div');
  const fill = () => {
    fields.replaceChildren(
      numField('Mittelpunkt y', op, 'yc', { unit: 'mm' }),
      numField('Mittelpunkt z', op, 'zc', { unit: 'mm' }),
      ...(ctx.ui.openGen === 'rect'
        ? [numField('Breite', op, 'b', { unit: 'mm', min: 1 }), numField('Höhe', op, 'h', { unit: 'mm', min: 1 })]
        : [numField('Durchmesser', op, 'D', { unit: 'mm', min: 1, info: 'Als flächengleiches 32-Eck modelliert.' })]));
  };
  fill();
  const add = () => {
    let pts;
    if (ctx.ui.openGen === 'rect') pts = [[op.yc - op.b / 2, op.zc - op.h / 2], [op.yc + op.b / 2, op.zc - op.h / 2], [op.yc + op.b / 2, op.zc + op.h / 2], [op.yc - op.b / 2, op.zc + op.h / 2]];
    else pts = circlePts(op.yc, op.zc, op.D / 2, 32, true);
    if (!(op.b > 0 && op.h > 0 && op.D > 0)) { toast('Bitte positive Abmessungen für die Aussparung eingeben.', 'warn'); return; }
    p.openings.push({ name: ctx.ui.openGen === 'rect' ? `Öffnung ${fmt(op.b, 0)}×${fmt(op.h, 0)}` : `Rohr Ø${fmt(op.D, 0)}`, pts: ptsToRows(pts, 1) });
    app.changed({ inputs: true });
  };
  kids.push(h('div', { style: { border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius)', padding: '8px', margin: '6px 0 0' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' } },
      h('b', { class: 'small' }, 'Neue Aussparung'),
      segmented([{ id: 'rect', label: 'Rechteck' }, { id: 'circle', label: 'Kreis' }], kind, (id) => { ctx.ui.openGen = id; fill(); })),
    fields,
    h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '4px' } }, button('Aussparung hinzufügen', { icon: 'plus', small: true, primary: true, onClick: add }))));
  return group('Aussparungen', kids, {
    collapsible: true, collapsed: !p.openings.length && p.shape.type !== 'poly',
    info: 'Hohlräume im Querschnitt (Hüllrohre, Durchbrüche, Aussparungen). Sie werden von der Betonfläche abgezogen. Bei «Polygon frei» erscheinen hier auch die Hohlräume umgewandelter Vorlagen (Hohlkasten, Kreisring).',
  });
}

function concreteGroup(app) {
  const m = app.project.material;
  const mat = materialSet(app.project);
  const c = mat.c;
  return group('Beton und Norm', [
    selectField('Norm', m, 'norm', NORMS, { onChange: updInputs(app), info: 'SIA 262 (Schweiz) oder Eurocode EN 1992-1-1. Bestimmt εcu, Ecm, Es und die Nachweisformeln.' }),
    selectField('Betonsorte', m, 'concrete', CONCRETE_CLASSES, { onChange: updInputs(app), info: 'Festigkeitsklasse fck/fck,cube.' }),
    numField('Widerstandsbeiwert γc', m, 'gammaC', { min: 1, max: 3, onChange: updInputs(app), info: 'Teilsicherheitsbeiwert Beton, üblich 1.5 (SIA 262 2.3.2.5, EN 1992-1-1 2.4.2.4).' }),
    m.norm === 'EC' ? numField('Beiwert αcc', m, 'alphaCC', { min: 0.5, max: 1, onChange: updInputs(app), info: 'Dauerstandsbeiwert αcc nach EN 1992-1-1 3.1.6 (empfohlen 1.0; je nach Nationalem Anhang 0.85).' }) : null,
    h('div', { class: 'small muted', style: { margin: '4px 0 0' } },
      `fcd = ${fmt(c.fcd, 1)} MPa · fctm = ${fmt(c.fctm, 2)} MPa · Ecm = ${fmt(c.Ecm / 1000, 1)} GPa · εc2 = ${fmt(c.ec2 * 1000, 1)} ‰ · εcu = ${fmt(c.ecu * 1000, 1)} ‰`),
  ], { info: 'Werkstoffgesetz: Parabel-Rechteck-Diagramm mit fcd, ohne Zugfestigkeit.' });
}

function renderSection(el, app) {
  const p = app.project;
  const t = p.shape.type;
  const areaLine = h('div', { style: { margin: '-6px 0 10px' } });
  /** Fläche und Schwerpunkt bzw. verständliche Fehlermeldung, ohne den Eingabebereich neu aufzubauen. */
  const refreshArea = () => {
    const g = projectGeometry(p);
    if (g.errors.length) { areaLine.replaceChildren(note(g.errors[0], 'fail')); return; }
    try {
      const gp = grossProps(g.outer, g.holes);
      areaLine.replaceChildren(h('span', { class: 'small muted' }, `Fläche A = ${fmt(gp.A, 0)} mm² · Schwerpunkt y = ${fmt(gp.cy, 1)} mm, z = ${fmt(gp.cz, 1)} mm`));
    } catch (e) { areaLine.replaceChildren(note(e.message, 'fail')); }
  };
  el.append(group('Form', [shapePicker(app)], { info: 'Vorlage wählen und Abmessungen eingeben. «Polygon frei» übernimmt die aktuelle Form als bearbeitbare Eckpunkte.' }));
  if (t === 'poly') {
    el.append(group('Eckpunkte', [polyTable(app, () => refreshArea())], { info: 'Aussenrand des Querschnitts als Polygon. Reihenfolge im oder gegen den Uhrzeigersinn; der Rand darf sich nicht selbst schneiden. Koordinaten in mm, y nach rechts, z nach oben.' }));
  } else {
    p.shape[t] ||= defaultShapes()[t];
    el.append(group('Abmessungen', SHAPE_PARAMS[t].map(([k, label]) => numField(label, p.shape[t], k, { unit: 'mm', min: 1, onChange: () => { app.changed(); refreshArea(); }, info: PARAM_INFO[t]?.[k] })),
      { info: t === 'circle' || t === 'ring' ? 'Mittelpunkt im Ursprung (0/0).' : t === 'L' ? 'Äussere Ecke im Ursprung (0/0).' : 'Unterkante auf z = 0, symmetrisch zur z-Achse.' }));
  }
  el.append(areaLine);
  refreshArea();
  el.append(openingsGroup(app));
  el.append(concreteGroup(app));
}

// ------------------------------------------------------------------ Register 2: Bewehrung

/** Generatorparameter; die geometrieabhängigen Vorschläge folgen der aktuellen Querschnittsform. */
function initGen(app) {
  const g = projectGeometry(app.project);
  const bb = g.outer.length ? bounds(g.outer) : { ymin: -150, ymax: 150, zmin: 0, zmax: 500 };
  const key = [bb.ymin, bb.ymax, bb.zmin, bb.zmax].map((x) => Math.round(x)).join('|');
  ctx.gen ||= { nBot: 3, dBot: 16, nTop: 2, dTop: 12, c: 30, dw: 8, n: 8, d: 16, nInner: 0, dInner: 12, nRow: 3, dRow: 16, nCirc: 8, dCirc: 16, phi0: 90, dPer: 14, sPer: 200 };
  if (ctx.gen.key === key) return;
  const a = 50;
  Object.assign(ctx.gen, {
    key,
    y1: Math.round(bb.ymin + a), z1: Math.round(bb.zmin + a), y2: Math.round(bb.ymax - a), z2: Math.round(bb.zmin + a),
    yc: Math.round((bb.ymin + bb.ymax) / 2), zc: Math.round((bb.zmin + bb.zmax) / 2), r: Math.round(Math.max(20, Math.min(bb.ymax - bb.ymin, bb.zmax - bb.zmin) / 2 - a)),
  });
  ctx.openPar = null;
}

function applyBars(app, bars, replace) {
  if (!bars.length) { toast('Mit diesen Angaben entstehen keine Stäbe – bitte Anzahl, Durchmesser und Überdeckung prüfen.', 'warn'); return; }
  const p = app.project;
  p.bars = replace ? bars : [...(p.bars || []), ...bars];
  app.selection = null;
  app.changed({ inputs: true });
  toast(`${bars.length} Stäbe ${replace ? 'erzeugt (bisherige Bewehrung ersetzt)' : 'hinzugefügt'}.`, 'ok');
}

function generatorGroup(app) {
  const p = app.project;
  initGen(app);
  const G = ctx.gen;
  const circular = p.shape.type === 'circle' || p.shape.type === 'ring';
  const modes = [
    { id: 'vorlage', label: 'Vorlage', title: circular ? 'Stäbe gleichmässig am Umfang' : 'Lagen unten und oben mit Überdeckung' },
    { id: 'reihe', label: 'Reihe', title: 'n Stäbe zwischen zwei Punkten' },
    { id: 'kreis', label: 'Kreis', title: 'n Stäbe auf einem Kreis' },
    ...(circular ? [] : [{ id: 'umlaufend', label: 'Umlaufend', title: 'Randbewehrung entlang aller Ränder' }]),
  ];
  if (!modes.some((m) => m.id === ctx.ui.barGen)) ctx.ui.barGen = 'vorlage';
  const body = h('div');
  const cover = () => [
    numField('Betonüberdeckung c', G, 'c', { unit: 'mm', min: 0, info: 'Nennmass der Überdeckung bis zur Bügelaussenseite.' }),
    numField('Bügel Øw', G, 'dw', { unit: 'mm', min: 0, info: 'Bügeldurchmesser. Achsabstand der Längsstäbe vom Rand: a = c + Øw + Ø/2.' }),
  ];
  const n = (label, key, info) => numField(label, G, key, { unit: 'Stk.', min: 0, max: 400, info });
  const d = (label, key) => numField(label, G, key, { unit: 'mm', min: 4, max: 60 });
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
          ? [n('Anzahl Stäbe', 'n', 'Gleichmässig am Umfang verteilt, erster Stab oben.'), d('Durchmesser Ø', 'd'),
            ...(p.shape.type === 'ring' ? [n('Anzahl innen', 'nInner', '0 = keine innere Lage.'), d('Ø innen', 'dInner')] : []), ...cover()]
          : [n('Anzahl unten', 'nBot', 'Stäbe der unteren Lage; 0 = keine. Verteilung in der breitesten Materialzone auf Höhe a über der Unterkante.'), d('Ø unten', 'dBot'),
            n('Anzahl oben', 'nTop', 'Stäbe der oberen Lage; 0 = keine.'), d('Ø oben', 'dTop'), ...cover()];
        break;
      case 'reihe':
        f = [numField('Punkt 1: y', G, 'y1', { unit: 'mm' }), numField('Punkt 1: z', G, 'z1', { unit: 'mm' }), numField('Punkt 2: y', G, 'y2', { unit: 'mm' }), numField('Punkt 2: z', G, 'z2', { unit: 'mm' }),
          n('Anzahl', 'nRow', 'Inklusive der beiden Endpunkte.'), d('Durchmesser Ø', 'dRow')];
        break;
      case 'kreis':
        f = [numField('Mittelpunkt y', G, 'yc', { unit: 'mm' }), numField('Mittelpunkt z', G, 'zc', { unit: 'mm' }), numField('Radius r (Stabachsen)', G, 'r', { unit: 'mm', min: 1 }),
          n('Anzahl', 'nCirc'), d('Durchmesser Ø', 'dCirc'), numField('Startwinkel φ0', G, 'phi0', { unit: '°', info: '0° = rechts (+y), 90° = oben (+z), im Gegenuhrzeigersinn.' })];
        break;
      default:
        f = [d('Durchmesser Ø', 'dPer'), numField('max. Stababstand s', G, 'sPer', { unit: 'mm', min: 20, info: 'Stäbe in allen Ecken, dazwischen gleichmässig mit Abstand ≤ s – entlang des Aussenrands und aller Aussparungen.' }), ...cover()];
    }
    body.replaceChildren(...f);
  };
  fill();
  return group('Bewehrung erzeugen', [
    h('div', { style: { margin: '0 0 6px' } }, segmented(modes, ctx.ui.barGen, (id) => { ctx.ui.barGen = id; fill(); })),
    body,
    h('div', { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end', marginTop: '6px' } },
      button('Hinzufügen', { icon: 'plus', small: true, title: 'Erzeugte Stäbe zur bestehenden Bewehrung hinzufügen', onClick: () => applyBars(app, build(), false) }),
      button('Ersetzen', { icon: 'check', small: true, primary: true, title: 'Bestehende Bewehrung durch die erzeugten Stäbe ersetzen', onClick: () => applyBars(app, build(), true) })),
  ], { collapsible: true, collapsed: (p.bars || []).length > 0, info: 'Stäbe automatisch platzieren. «Ersetzen» löscht die bisherige Bewehrung, «Hinzufügen» ergänzt sie (z.B. zweite Lage oder Seitenbewehrung als Reihe).' });
}

function renderRebar(el, app) {
  const p = app.project;
  p.bars ||= [];
  const m = p.material;
  const s = materialSet(p).s;
  el.append(group('Betonstahl', [
    selectField('Stahlsorte', m, 'steel', REBAR_GRADES, { onChange: updInputs(app), info: 'Duktilitätsklasse A/B/C bestimmt die Bruchdehnung εud und das Verfestigungsverhältnis ks.' }),
    numField('Widerstandsbeiwert γs', m, 'gammaS', { min: 1, max: 2, onChange: updInputs(app), info: 'Teilsicherheitsbeiwert Betonstahl, üblich 1.15.' }),
    checkField('Verfestigung bis ks·fsd berücksichtigen', m, 'hardening', { onChange: updInputs(app), info: 'Ohne Häkchen: horizontales Fliessplateau bei fsd (übliche, konservative Annahme).' }),
    h('div', { class: 'small muted', style: { margin: '4px 0 0' } }, `fsd = ${fmt(s.fsd, 1)} MPa · Es = ${fmt(s.Es / 1000, 0)} GPa · εud = ${fmt(s.eud * 1000, 1)} ‰`),
  ]));
  const g = projectGeometry(p);
  const Ac = g.errors.length ? NaN : grossProps(g.outer, g.holes).A;
  const summary = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '0 0 6px' } });
  const refreshSummary = () => {
    const As = p.bars.reduce((sum, b) => sum + (b.d > 0 ? barAreaMm2(b.d) : 0), 0);
    summary.replaceChildren(badge(`${p.bars.length} Stäbe`, 'info'), badge(`As = ${fmt(As, 0)} mm²`, 'info'), Number.isFinite(Ac) ? badge(`ρ = ${fmt(As / Ac * 100, 2)} %`, 'info') : '');
  };
  refreshSummary();
  const empty = p.bars.length ? null : emptyState('Noch keine Bewehrung', 'Stäbe in der Tabelle erfassen («+ Zeile», Excel-Einfügen) oder unten mit «Bewehrung erzeugen» platzieren.');
  const tbl = dataTable([
    { key: 'y', label: 'y', unit: 'mm', info: 'Horizontale Lage der Stabachse.' },
    { key: 'z', label: 'z', unit: 'mm', info: 'Vertikale Lage der Stabachse.' },
    { key: 'd', label: 'Ø', unit: 'mm', min: 1, max: 80, info: 'Stabdurchmesser. Bündel als flächengleichen Einzelstab erfassen.' },
    { type: 'calc', label: 'As', unit: 'mm²', calc: (r) => (r.d > 0 ? fmt(barAreaMm2(r.d), 0) : '–') },
  ], p.bars, {
    onChange: () => { refreshSummary(); if (p.bars.length) empty?.remove(); app.changed(); },
    newRow: (rows) => { const l = rows[rows.length - 1]; return l ? { y: l.y + 50, z: l.z, d: l.d } : { y: 0, z: 50, d: 16 }; },
    maxHeight: '300px',
    onSelect: (i) => { app.selection = { kind: 'bar', index: i }; app.redraw(); },
    hint: 'Excel-Einfügen (y, z, Ø)',
    extraButtons: p.bars.length ? [button('Alle löschen', { icon: 'trash', small: true, onClick: () => { p.bars.length = 0; app.selection = null; app.changed({ inputs: true }); } })] : [],
  });
  ctx.tables.bars = tbl;
  el.append(group('Stäbe', [
    summary,
    empty,
    tbl,
  ], { info: 'Jeder Stab als Punktfaser mit Fläche π·Ø²/4. Ein Klick auf einen Stab in der Grafik wählt die Zeile.' }));
  el.append(generatorGroup(app));
}

// ------------------------------------------------------------------ Register 3: Lasten

function renderLoads(el, app) {
  const p = app.project;
  p.loads ||= [];
  const shear = !!p.shear?.active;
  el.append(group('Vorzeichen', [
    signFigure(),
    h('div', { class: 'small muted' }, 'N > 0 Zug, N < 0 Druck · My > 0 erzeugt Zug unten · Mz > 0 erzeugt Zug rechts. Die Schnittgrössen wirken im Bezugspunkt (Standard: Schwerpunkt des Betons).'),
  ], { collapsible: true, info: 'Koordinaten: y nach rechts, z nach oben. Feldmomente eines Balkens mit Zug unten sind also positive My.' }));
  const cols = [
    { key: 'name', label: 'Bezeichnung', type: 'text', width: '30%' },
    { key: 'type', label: 'Typ', type: 'select', options: [{ value: 'GZT', label: 'GZT' }, { value: 'GZG', label: 'GZG' }], width: '62px', info: '<b>GZT</b>: Bemessungswerte (Tragsicherheit) – Ausnutzung aus dem Interaktionsdiagramm.<br><b>GZG</b>: Gebrauchslasten – Spannungen im gerissenen Zustand mit Spannungsbegrenzung.' },
    { key: 'N', label: 'N', unit: 'kN', info: 'Normalkraft: Zug positiv, Druck negativ.' },
    { key: 'My', label: 'My', unit: 'kNm', info: 'Biegemoment um die y-Achse: positiv → Zug unten (z.B. Feldmoment).' },
    { key: 'Mz', label: 'Mz', unit: 'kNm', info: 'Biegemoment um die z-Achse: positiv → Zug rechts (y > 0).' },
  ];
  if (shear) cols.push({ key: 'V', label: 'Vd', unit: 'kN', info: 'Bemessungsquerkraft (Betrag) für den Querkraftnachweis; nur bei GZT-Lastfällen.' });
  const empty = p.loads.length ? null : emptyState('Noch keine Lastfälle', 'Mit «+ Zeile» einen Lastfall anlegen und N, My, Mz eintragen.');
  const tbl = dataTable(cols, p.loads, {
    onChange: () => { if (p.loads.length) empty?.remove(); app.changed(); },
    newRow: (rows) => ({ name: `LF ${rows.length + 1}`, type: 'GZT', N: 0, My: 0, Mz: 0, V: 0 }),
    canMove: true, enterAdds: true,
    onSelect: (i) => { app.viewOpts.lc = i; app.renderView(); app.renderResults(); },
    hint: 'Excel-Einfügen (Bezeichnung, Typ, N, My, Mz)',
  });
  ctx.tables.loads = tbl;
  el.append(group('Lastfälle', [
    empty,
    tbl,
  ], { info: 'Jede Zeile ist eine Schnittgrössenkombination. Die Zeile anklicken, um den Lastfall in Grafik und Ergebnissen zu zeigen.' }));
  el.append(note('Tipp: Lastfälle vom Typ GZG im Register «Nachweise» mit den Anforderungen an die Rissbreite verknüpfen; die Querkraft lässt sich dort zuschalten.', ''));
}

// ------------------------------------------------------------------ Register 4: Nachweise

function autoField(label, obj, flagKey, valKey, autoVal, opts, app) {
  const isAuto = obj[flagKey] !== false;
  const wrap = h('div');
  if (isAuto) wrap.append(numField(label, { v: autoVal }, 'v', { ...opts, readonly: true, digits: 0 }));
  else wrap.append(numField(label, obj, valKey, { ...opts, onChange: upd(app) }));
  wrap.append(checkField(`${label.split(' ')[0]} automatisch aus dem Querschnitt`, obj, flagKey, { onChange: (v) => { if (!v) obj[valKey] = Math.round(autoVal); app.changed({ inputs: true }); } }));
  return wrap;
}

function renderChecks(el, app) {
  const p = app.project;
  const mat = materialSet(p);
  const sls = p.sls, calc = p.calc, sh = p.shear;
  // GZG
  const slsKids = [];
  if (mat.norm === 'SIA') {
    slsKids.push(selectField('Anforderungen', sls, 'req', SLS_REQUIREMENTS, {
      onChange: updInputs(app), wide: true,
      info: 'Rissbreitenbegrenzung nach SIA 262 4.4.2: <b>normal</b> – Kontrolle σs ≤ fsd; <b>erhöht/hoch</b> – σs,adm abhängig vom Stababstand s (Näherung der Kurven von Fig. 31, bitte mit der Norm vergleichen); <b>manuell</b> – eigener Grenzwert.',
    }));
    if (sls.req === 'manual') slsKids.push(numField('Zulässige Stahlspannung σs,adm', sls, 'sigmaAdm', { unit: 'MPa', min: 1, onChange: upd(app) }));
    if (sls.req === 'erhoeht' || sls.req === 'hoch') {
      slsKids.push(checkField('Stababstand s automatisch (Zuglage)', sls, 'spacingAuto', { onChange: updInputs(app), info: 'Grösster Achsabstand benachbarter Stäbe der am stärksten gezogenen Lage, je GZG-Lastfall.' }));
      if (sls.spacingAuto === false) slsKids.push(numField('Stababstand s', sls, 'spacing', { unit: 'mm', min: 10, onChange: upd(app) }));
    }
  } else {
    slsKids.push(note('EN 1992-1-1, 7.2: σs ≤ 0.8·fyk (k3) und |σc| ≤ 0.6·fck (k1) unter der charakteristischen Kombination.', ''));
  }
  slsKids.push(selectField('Wertigkeit n', calc, 'nMode', [{ value: 'auto', label: `automatisch: Es(1+φ)/Ecm = ${fmt(mat.s.Es * (1 + mat.phi) / mat.c.Ecm, 2)}` }, { value: 'manual', label: 'vorgeben' }], { onChange: updInputs(app), wide: true, info: 'Verhältnis Es/Ec,eff für die gerissene, linear-elastische Spannungsberechnung. Langzeit üblich n ≈ 15–20.' }));
  if (calc.nMode === 'manual') slsKids.push(numField('n', calc, 'n', { min: 1, max: 50, onChange: upd(app) }));
  el.append(group('Gebrauchstauglichkeit (GZG)', slsKids, { info: 'Gilt für alle Lastfälle vom Typ GZG.' }));

  // Querkraft
  const R = app.results;
  const auto = R?.shearGeo?.auto;
  const shKids = [checkField('Querkraftnachweis durchführen', sh, 'active', { onChange: updInputs(app), info: 'Fügt der Lastfalltabelle die Spalte Vd hinzu und weist die Querkraft für alle GZT-Lastfälle nach.' })];
  if (sh.active) {
    const angLabel = mat.norm === 'SIA' ? 'Druckfeldneigung α' : 'Druckstrebenneigung θ';
    shKids.push(
      numField('Bügel Øw (0 = keine)', sh, 'dw', { unit: 'mm', min: 0, onChange: upd(app), info: 'Durchmesser der Querkraftbewehrung. 0 → Nachweis ohne Querkraftbewehrung.' }),
      numField('Bügelabstand s', sh, 's', { unit: 'mm', min: 0, onChange: upd(app) }),
      numField('Schnittigkeit', sh, 'legs', { unit: 'Stk.', min: 0, max: 12, onChange: upd(app), info: 'Anzahl Bügelschenkel pro Schnitt (geschlossener Bügel = 2).' }),
      numField(angLabel, sh, 'angle', { unit: '°', min: 10, max: 60, onChange: upd(app), info: mat.norm === 'SIA' ? 'SIA 262 4.3.3.3.2: üblich 25° ≤ α ≤ 45°.' : 'EN 1992-1-1 6.2.3(2): 1 ≤ cot θ ≤ 2.5, d.h. 21.8° ≤ θ ≤ 45°.' }),
      selectField('Biegezugseite', sh, 'side', [{ value: 'unten', label: 'unten' }, { value: 'oben', label: 'oben' }], { onChange: updInputs(app), info: 'Massgebend für d (Abstand Druckrand – Zugbewehrung) und die Längsbewehrung Asl.' }),
      autoField('bw Stegbreite', sh, 'bwAuto', 'bw', auto?.bw ?? sh.bw, { unit: 'mm', min: 1, info: 'Automatisch: kleinste Materialbreite zwischen 10 % und 90 % der Höhe (bei Hohlkästen Summe beider Stege).' }, app),
      autoField('d statische Höhe', sh, 'dAuto', 'd', auto?.d ?? sh.d, { unit: 'mm', min: 1, info: 'Automatisch: Abstand vom Druckrand zum Schwerpunkt der Stäbe auf der Biegezugseite.' }, app),
      autoField('z Hebelarm', sh, 'zAuto', 'z', (R?.shearGeo?.d ?? auto?.d ?? sh.d) * 0.9, { unit: 'mm', min: 1, info: 'Automatisch: z = 0.9·d.' }, app),
    );
    if (mat.norm === 'SIA' && !(sh.dw > 0 && sh.s > 0 && sh.legs > 0)) {
      shKids.push(
        numField('Grösstkorn Dmax', sh, 'Dmax', { unit: 'mm', min: 0, max: 64, onChange: upd(app), info: 'kg = 48/(16 + Dmax), SIA 262 4.3.3.2.1.' }),
        selectField('Dehnung εv', sh, 'epsMode', [{ value: 'elastic', label: 'fsd/Es · MEd/MRd' }, { value: 'plastic', label: '1.5 · fsd/Es (plastisch)' }], { onChange: upd(app), wide: true, info: 'SIA 262 4.3.3.2.2: elastische Schnittgrössen → εv = fsd/Es·mEd/mRd (MEd/MRd = Biegeausnutzung des Lastfalls); plastische Schnittgrössen → 1.5·fsd/Es.' }),
      );
    }
  }
  el.append(group('Querkraft', shKids, { info: mat.norm === 'SIA' ? 'SIA 262 4.3.3 (vereinfacht, konstante Querschnittswerte).' : 'EN 1992-1-1 6.2.' }));

  // Berechnung
  el.append(group('Berechnungsoptionen', [
    selectField('Bezugspunkt', calc, 'ref', REF_POINTS, { onChange: upd(app), wide: true, info: 'Punkt, in dem N, My und Mz angreifen (bei N ≠ 0 ändern sich die Momente mit dem Bezugspunkt). Intern wird auf den Betonschwerpunkt umgerechnet, die Ausnutzung ist daher unabhängig von dieser Wahl. Standard: Schwerpunkt des Betonbruttoquerschnitts.' }),
    numField('Kriechzahl φ', calc, 'creep', { min: 0, max: 5, onChange: updInputs(app), info: 'Wirkt auf die Wertigkeit n im GZG und auf die M-κ-Linie (Streckung der Betondehnungen um 1 + φ). Kein Einfluss auf den Tragwiderstand.' }),
    selectField('M-κ-Werkstoffgesetze', calc, 'mkLaws', [{ value: 'both', label: 'Bemessungs- und Mittelwerte' }, { value: 'design', label: 'nur Bemessungswerte' }, { value: 'mean', label: 'nur Mittelwerte' }], { onChange: () => app.renderResults(), wide: true }),
    R ? h('div', { class: 'small muted', style: { marginTop: '4px' } }, `Fasermodell: ${R.nFibers} Fasern (Kantenlänge ≈ ${fmt(R.mesh * 1000, 0)} mm).`) : null,
  ]));
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
  p.bars = Array.isArray(p.bars) ? p.bars : [];
  p.loads = Array.isArray(p.loads) ? p.loads : [];
  p.material = { ...b.material, ...(p.material || {}) };
  p.calc = { ...b.calc, ...(p.calc || {}) };
  p.sls = { ...b.sls, ...(p.sls || {}) };
  p.shear = { ...b.shear, ...(p.shear || {}) };
  ctx.gen = null;
  ctx.openPar = null;
  return p;
}

createApp({
  id: 'querschnitt',
  title: 'Querschnitt',
  subtitle: 'Querschnittsanalyse Stahlbeton',
  version: 1,
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
    { id: 'nachweise', label: 'Nachweise', render: renderChecks },
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
    sel.style.width = '180px';
    sel.title = 'Lastfall für Dehnungen und Spannungen';
    return [h('span', { class: 'sep' }), h('span', { class: 'small muted' }, 'Lastfall'), sel];
  },
  renderView: (v, app, mode) => renderView(v, app, mode),
  onViewClick(x, y, app) {
    const hit = hitTest(app, x, y);
    if (!hit) {
      if (app.selection) { app.selection = null; app.redraw(); }
      return;
    }
    app.selection = hit;
    const tabId = hit.kind === 'bar' ? 'bewehrung' : 'querschnitt';
    if (app.activeTab !== tabId) app.selectTab(tabId);
    const tbl = hit.kind === 'bar' ? ctx.tables.bars : ctx.tables.poly;
    if (tbl?.isConnected) {
      tbl.select(hit.index);
      tbl.querySelectorAll('tbody tr')[hit.index]?.scrollIntoView({ block: 'nearest' });
    }
    app.redraw();
    const p = app.project;
    if (hit.kind === 'bar') { const b = p.bars[hit.index]; app.status(`Stab ${hit.index + 1}: Ø${b.d} mm bei y = ${fmt(b.y, 0)} mm, z = ${fmt(b.z, 0)} mm`); }
    else { const r = p.shape.poly[hit.index]; app.status(`Eckpunkt ${hit.index + 1}: y = ${fmt(r.y, 0)} mm, z = ${fmt(r.z, 0)} mm`); }
  },
  compute: (project) => analyze(project, ctx.cache),
  renderResults: (el, app) => renderResults(el, app, ctx),
  report: (app) => buildReport(app, ctx),
});
