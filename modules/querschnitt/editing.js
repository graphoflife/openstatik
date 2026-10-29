// Querschnitt – grafische Bearbeitung: Werkzeuge, Geometrie für den Editor, Eigenschaftsfenster
//
// Die Grafik arbeitet in mm (y nach rechts, z nach oben), genau wie die Eingabe. IDs und Bearbeitungs-
// operationen siehe model.js; hier nur die Anbindung an den Editor (js/core/editor.js) und die Oberfläche.
import { h, rich, numField, selectField, selectInput, textField, button, kvTable, note, toast } from '../../js/core/ui.js';
import { TOOL_ICONS } from '../../js/core/editor.js';
import { fmt } from '../../js/core/format.js';
import { CONCRETE_CLASSES, NORMS } from '../../js/core/materials.js';
import { SHAPE_TYPES, SHAPE_PARAMS, defaultShapes, projectGeometry, offsetPolygon, orient, polygonProps, barAreaMm2, pointInPolygon } from './shapes.js';
import { grossProps } from './calc.js';
import {
  parseId, editableOutline, hasOutline, convertToPoly, createOutline, addOpening, addDuct, setDuct, addBars, rowCount, circleCount,
  groupBars, moveSelection, removeSelection, insertVertex, setVertex, moveToOrigin, shapeLabel,
} from './model.js';
import { caseIndex, viewState } from './view.js';

/** Übliche Stabdurchmesser [mm]. */
export const BAR_DIAMETERS = [6, 8, 10, 12, 14, 16, 18, 20, 22, 26, 30, 34, 40];

const ICONS = {
  row: '<circle cx="5" cy="12" r="2.6" fill="currentColor"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/><circle cx="19" cy="12" r="2.6" fill="currentColor"/><path d="M3 18h18" stroke-dasharray="2 2"/>',
  circle: '<circle cx="12" cy="12" r="7" stroke-dasharray="2 2"/><circle cx="12" cy="5" r="2.2" fill="currentColor"/><circle cx="19" cy="12" r="2.2" fill="currentColor"/><circle cx="12" cy="19" r="2.2" fill="currentColor"/><circle cx="5" cy="12" r="2.2" fill="currentColor"/>',
  duct: '<rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="12" cy="12" r="5" stroke-dasharray="2 1.5"/>',
};

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** Gedämpfte Kurzinfo mit Formelzeichen. */
const hint = (text) => h('div', { class: 'muted small' }, rich(text));
const f0 = (v) => fmt(v, 0);

/** Achsabstand vom Rand für Fangpunkte: a = c + Øw + Ø/2 (Werte des Bewehrungsgenerators). */
function coverAxis(ctx) {
  const c = Number.isFinite(ctx.gen?.c) ? ctx.gen.c : 30, dw = Number.isFinite(ctx.gen?.dw) ? ctx.gen.dw : 8;
  return c + dw + ctx.ui.barD / 2;
}

function insideConcrete(p, q) {
  const g = projectGeometry(p);
  return g.outer.length >= 3 && pointInPolygon(q, g.outer) && !g.holes.some((hh) => pointInPolygon(q, hh));
}

/** Hinweis nach automatischer Umwandlung einer Vorlage (Statuszeile und Meldung, da die Statuszeile nach der Berechnung wechselt). */
function converted(app, label) {
  const msg = `Vorlage «${label}» in «Polygon frei» umgewandelt – Eckpunkte und Kanten sind jetzt frei verschiebbar (Rückgängig: Ctrl+Z).`;
  app.status(msg, 'warn');
  toast(msg, 'info', 5000);
}

/** Nach dem Erzeugen zur Auswahl wechseln, damit das Eigenschaftsfenster das neue Element zeigt. */
const toSelect = (app) => setTimeout(() => app.editor?.setTool('select'), 0);

// ------------------------------------------------------------------ Form wechseln (auch vom Register «Querschnitt»)

/** Querschnittsform setzen; Vorlage → «Polygon frei» übernimmt die aktuelle Form. */
export function setShape(app, id) {
  const p = app.project;
  if (p.shape.type === id) return;
  if (id === 'poly') {
    if (hasOutline(p)) {
      try {
        convertToPoly(p);
        toast('Die Form wurde in ein Polygon umgewandelt – die Eckpunkte sind jetzt frei bearbeitbar.', 'ok');
      } catch (e) {
        toast(`Umwandlung nicht möglich: ${e.message}`, 'warn');
        p.shape.type = 'poly';
      }
    } else p.shape.type = 'poly';
  } else {
    // aus einer Vorlage stammende Hohlräume gehören zum Polygon
    if (p.shape.type === 'poly') p.openings = (p.openings || []).filter((o) => !o.fromTemplate);
    p.shape[id] ||= defaultShapes()[id];
    p.shape.type = id;
  }
  const g = projectGeometry(p);
  const outside = g.warnings.filter((w) => w.includes('ausserhalb')).length;
  if (outside) toast(`${outside} Stäbe liegen ausserhalb der neuen Form – Stäbe verschieben oder im Register «Bewehrung» neu erzeugen.`, 'warn', 5000);
  app.changed({ inputs: true });
}

/** Querschnitt so verschieben, dass sein Schwerpunkt im Ursprung liegt. */
export function centerSection(app) {
  const p = app.project;
  const g = projectGeometry(p);
  if (g.errors.length) { toast(g.errors[0], 'warn'); return; }
  const gp = grossProps(g.outer, g.holes);
  const [dy, dz] = moveToOrigin(p, gp.cy, gp.cz);
  app.changed({ inputs: true });
  toast(`Verschoben um Δy = ${fmt(-dy, 1)} mm, Δz = ${fmt(-dz, 1)} mm.`, 'ok');
}

// ------------------------------------------------------------------ Adapter

/** Editor-Adapter; ctx ist der gemeinsame Oberflächenzustand aus main.js. */
export function createEditorSpec(ctx) {
  ctx.ui.barD ||= 16;
  ctx.ui.ductD ||= 100;

  const barPrompt = () => `Stabmitte anklicken – Ø ${ctx.ui.barD} mm (Ø ändern: Esc und Stab anklicken, oder im Fenster ohne Auswahl).`;
  const spec = {
    axes: ['y', 'z'],
    unit: 'mm',
    digits: 1,
    grid: [1, 5, 10, 25, 50, 100],
    gridDefault: 10,
    modes: ['geometrie'],
    canCopy: true,
    tools: [
      { id: 'outline', label: 'Polygon', key: 'u', form: 'polygon', icon: TOOL_ICONS.polygon, title: 'Betonumriss als Polygon zeichnen: Eckpunkte anklicken, Enter oder Klick auf den ersten Punkt schliesst (ersetzt einen bestehenden Umriss)' },
      { id: 'outlineRect', label: 'Rechteck', key: 'q', form: 'rect', icon: TOOL_ICONS.rect, title: 'Rechteckigen Betonquerschnitt zeichnen: zwei gegenüberliegende Ecken anklicken (ersetzt einen bestehenden Umriss)' },
      { id: 'opening', label: 'Öffnung', key: 'o', form: 'polygon', icon: TOOL_ICONS.opening, title: 'Aussparung als Polygon zeichnen (Durchbruch): Eckpunkte anklicken, Enter schliesst' },
      { id: 'duct', label: 'Hüllrohr', key: 'h', form: 'point', icon: ICONS.duct, title: 'Kreisförmige Aussparung: Mittelpunkt anklicken (Ø im Eigenschaftsfenster)', get prompts() { return [`Mittelpunkt anklicken – Ø ${ctx.ui.ductD} mm.`]; } },
      { id: 'bar', label: 'Stab', key: 'b', form: 'point', icon: TOOL_ICONS.bar, title: 'Bewehrungsstab setzen: Stabmitte anklicken', get prompts() { return [barPrompt()]; } },
      { id: 'barRow', label: 'Stabreihe', key: 'l', form: 'line', icon: ICONS.row, title: 'Stäbe gleichmässig zwischen zwei Punkten: Achse des ersten und des letzten Stabs anklicken', get prompts() { return [`Erster Stab (Achse) – Ø ${ctx.ui.barD} mm.`, 'Letzter Stab – Anzahl danach im Eigenschaftsfenster.']; } },
      { id: 'barCircle', label: 'Stabkreis', key: 'k', form: 'line', icon: ICONS.circle, title: 'Stäbe auf einem Kreis: Mittelpunkt, dann die Achse des ersten Stabs anklicken', get prompts() { return [`Kreismittelpunkt anklicken (z.B. Schwerpunkt ○) – Ø ${ctx.ui.barD} mm.`, 'Achse des ersten Stabs anklicken – Anzahl danach im Eigenschaftsfenster.']; } },
    ],

    geometry(app) {
      const p = app.project;
      const eo = editableOutline(p);
      const round = p.shape.type === 'circle' || p.shape.type === 'ring';
      const points = [], segments = [], regions = [], snaps = [];
      const n = eo.outer.length;
      if (n >= 3) {
        if (!round) eo.outer.forEach((q, i) => points.push({ id: `v:${i}`, p: q, label: `Eckpunkt ${i + 1}` }));
        eo.outer.forEach((q, i) => segments.push({ id: `e:${i}`, a: q, b: eo.outer[(i + 1) % n], label: `Kante ${i + 1}`, movable: !round }));
        regions.push({ id: 'c', ring: eo.outer, label: 'Beton', movable: !eo.template });
      }
      eo.openings.forEach((o, k) => {
        if (o.pts.length < 3) return;
        const fixed = round && o.template;
        const circ = fixed || !!o.circle;
        if (!circ) o.pts.forEach((q, i) => points.push({ id: `ov:${k}:${i}`, p: q, label: `${o.name}, Punkt ${i + 1}` }));
        o.pts.forEach((q, i) => segments.push({ id: `oe:${k}:${i}`, a: q, b: o.pts[(i + 1) % o.pts.length], label: o.name, movable: !circ }));
        regions.push({ id: `o:${k}`, ring: o.pts, label: o.name, movable: !fixed });
        if (o.circle) snaps.push({ p: [o.circle.y, o.circle.z] });
      });
      (p.bars || []).forEach((b, i) => {
        if (Number.isFinite(b.y) && Number.isFinite(b.z) && b.d > 0) points.push({ id: `b:${i}`, p: [b.y, b.z], label: `Stab ${i + 1} Ø${b.d}` });
      });
      // Fangpunkte: Schwerpunkt und Ecken im Achsabstand a vom Rand (Bewehrungslage)
      if (n >= 3) {
        try {
          const g = projectGeometry(p);
          if (!g.errors.length) {
            const gp = grossProps(g.outer, g.holes);
            snaps.push({ p: [gp.cy, gp.cz] });
            const a = coverAxis(ctx);
            const every = (ring) => Math.max(1, Math.round(ring.length / 12));
            const outer = offsetPolygon(orient(g.outer, true), a);
            const so = round ? every(outer) : 1;
            outer.forEach((q, i) => { if (i % so === 0) snaps.push({ p: q }); });
            for (const hole of g.holes.slice(0, 12)) {
              const ring = offsetPolygon(orient(hole, false), a);
              const sh = hole.length > 8 ? every(ring) : 1;
              ring.forEach((q, i) => { if (i % sh === 0) snaps.push({ p: q }); });
            }
          }
        } catch { /* unvollständige Geometrie: keine Fangpunkte */ }
      }
      return { points, segments, regions, snaps };
    },

    create(app, tool, pts) {
      const p = app.project;
      if (tool === 'outline' || tool === 'outlineRect') {
        const r = createOutline(p, pts);
        const what = r.type === 'rect' ? `Rechteck ${f0(p.shape.rect.b)} × ${f0(p.shape.rect.h)} mm (Vorlage, Masse im Fenster änderbar)` : `Polygon mit ${p.shape.poly.length} Eckpunkten`;
        app.status(`${r.replaced ? 'Betonumriss ersetzt' : 'Betonquerschnitt erstellt'}: ${what}.${(p.bars || []).length ? '' : ' Als Nächstes Bewehrung setzen: «Stab» (B) oder «Stabreihe» (L).'}`, 'ok');
        toSelect(app);
        return ['c'];
      }
      if (tool === 'opening') {
        const k = addOpening(p, pts);
        app.status(`Aussparung «${p.openings[p.openings.length - 1].name}» mit ${pts.length} Eckpunkten erstellt.`, 'ok');
        return [`o:${k}`];
      }
      if (tool === 'duct') {
        const k = addDuct(p, pts[0], ctx.ui.ductD);
        app.status(`Hüllrohr Ø${ctx.ui.ductD} mm bei y = ${f0(pts[0][0])}, z = ${f0(pts[0][1])} mm.`, 'ok');
        return [`o:${k}`];
      }
      if (tool === 'bar') {
        const ids = addBars(p, [{ y: pts[0][0], z: pts[0][1], d: ctx.ui.barD }]);
        const ok = insideConcrete(p, pts[0]);
        app.status(`Stab ${p.bars.length}: Ø${ctx.ui.barD} bei y = ${fmt(pts[0][0], 1)}, z = ${fmt(pts[0][1], 1)} mm${ok ? '' : ' – liegt ausserhalb des Betons!'}`, ok ? 'ok' : 'warn');
        return ids;
      }
      if (tool === 'barRow' || tool === 'barCircle') {
        const kind = tool === 'barRow' ? 'row' : 'circle';
        const L = dist(pts[0], pts[1]);
        if (L < 1) throw new Error(kind === 'row' ? 'Erster und letzter Stab fallen zusammen.' : 'Der Radius ist null – zweiten Punkt neben den Mittelpunkt setzen.');
        const g = { kind, a: pts[0].slice(), b: pts[1].slice(), n: kind === 'row' ? rowCount(L) : circleCount(L), d: ctx.ui.barD };
        const ids = addBars(p, groupBars(g));
        ctx.lastGroup = { ...g, ids };
        app.status(`${g.n} Stäbe Ø${g.d} ${kind === 'row' ? 'als Reihe' : 'auf einem Kreis'} – Anzahl und Ø im Eigenschaftsfenster anpassen.`, 'ok');
        toSelect(app);
        return ids;
      }
      return null;
    },

    move(app, ids, d, { copy }) {
      const r = moveSelection(app.project, ids, d, copy);
      if (r.converted) converted(app, r.converted);
      else if (r.skipped) app.status('Der Betonumriss und einzelne Eckpunkte werden nicht kopiert – nur Stäbe und Aussparungen.', 'warn');
      // Stabgruppe mitführen
      const G = ctx.lastGroup;
      if (!copy && G && G.ids.every((id) => ids.includes(id))) { G.a = [G.a[0] + d[0], G.a[1] + d[1]]; G.b = [G.b[0] + d[0], G.b[1] + d[1]]; }
      return r.ids;
    },

    remove(app, ids) {
      const r = removeSelection(app.project, ids);
      const parts = [];
      if (r.outline) parts.push('Betonquerschnitt');
      if (r.openings) parts.push(`${r.openings} Aussparung${r.openings > 1 ? 'en' : ''}`);
      if (r.vertices && !r.outline) parts.push(`${r.vertices} Eckpunkt${r.vertices > 1 ? 'e' : ''}`);
      if (r.bars) parts.push(r.bars === 1 ? '1 Stab' : `${r.bars} Stäbe`);
      const conv = r.converted ? ` (Vorlage «${r.converted}» in ein Polygon umgewandelt)` : '';
      if (r.converted) converted(app, r.converted);
      app.status(parts.length ? `Gelöscht: ${parts.join(', ')}${conv}.${r.outline && (app.project.bars || []).length ? ' Die Bewehrung bleibt erhalten.' : ''}` : 'Nichts gelöscht – Kanten sind Teil des Umrisses (Eckpunkte oder den ganzen Beton wählen).', parts.length ? 'ok' : 'warn');
    },

    inspect(app, ids) {
      const sel = [...new Set(ids)];
      if (sel.length === 1) {
        const x = parseId(sel[0]);
        if (x.t === 'c') return inspectConcrete(app, ctx);
        if (x.t === 'b' && app.project.bars[x.a]) return inspectBar(app, ctx, x.a);
        if (x.t === 'v' || x.t === 'ov') return inspectVertex(app, sel[0]);
        if (x.t === 'e' || x.t === 'oe') return inspectEdge(app, sel[0]);
        if (x.t === 'o') return inspectOpening(app, ctx, x.a);
      }
      return inspectMulti(app, ctx, sel);
    },

    onSelect(app, ids) {
      if (ids.length !== 1) return;
      const x = parseId(ids[0]);
      const tbl = x.t === 'b' ? ctx.tables.bars : x.t === 'v' && app.project.shape.type === 'poly' ? ctx.tables.poly : null;
      if (tbl?.isConnected) { tbl.select(x.a); tbl.querySelectorAll('tbody tr')[x.a]?.scrollIntoView({ block: 'nearest' }); }
    },

    idleHint(app) { return idlePanel(app, ctx); },
  };
  return spec;
}

// ------------------------------------------------------------------ Eigenschaftsfenster

const changed = (app) => app.changed({ inputs: true });

/** Auswahl für den Stabdurchmesser (übliche Durchmesser, aktueller Wert immer enthalten). */
function diaField(label, obj, key, onChange, info) {
  const opts = [...new Set([...BAR_DIAMETERS, obj[key]].filter((v) => v > 0))].sort((a, b) => a - b).map((v) => ({ value: v, label: `Ø ${v}` }));
  return selectField(label, obj, key, opts, { unit: 'mm', onChange, info });
}

/** Lastfallwahl für Ergebniswerte im Fenster. */
function caseSelect(app) {
  const loads = app.project.loads || [];
  app.viewOpts.lc = caseIndex(app);
  const s = selectInput(app.viewOpts, 'lc', loads.map((l, i) => ({ value: i, label: `${l.name || `LF ${i + 1}`} (${l.type || 'GZT'})` })), {
    onChange: () => { app.renderView(); app.renderResults(); app.editor?.refreshPanel(true); },
  });
  s.style.width = '100%';
  return h('div', { class: 'field wide' }, h('label', {}, 'Lastfall'), s);
}

/** Dehnung und Spannung der Stäbe im gewählten Lastfall (Zustand wie in der Grafik). */
function barResults(app, idx) {
  const R = app.results;
  if (!R?.cases?.length) return [];
  const c = R.cases[caseIndex(app)];
  if (!c) return [];
  const vs = viewState(app, c);
  const out = [h('div', { class: 'ed-sub' }, 'Ergebnis'), caseSelect(app), hint(vs.label)];
  if (!vs.st?.ok) { out.push(note(vs.st?.msg || 'Kein Zustand verfügbar.', 'warn')); return out; }
  const bars = vs.st.bars.filter((b) => idx.includes(b.i));
  if (!bars.length) { out.push(h('div', { class: 'muted small' }, 'Stab nicht im Fasermodell (ausserhalb des Betons oder ungültig).')); return out; }
  if (bars.length === 1) {
    const b = bars[0];
    out.push(kvTable([
      ['Dehnung ε_s', b.eps * 1000, '‰', 3],
      ['Spannung σ_s', b.sigma, 'MPa', 1],
      ['Kraft F_s = σ_s·A_s', b.sigma * b.A * 1000, 'kN', 1],
    ]));
  } else {
    const e = bars.map((b) => b.eps), s = bars.map((b) => b.sigma);
    out.push(kvTable([
      ['ε_s min / max', `${fmt(Math.min(...e) * 1000, 3)} / ${fmt(Math.max(...e) * 1000, 3)}`, '‰'],
      ['σ_s min / max', `${fmt(Math.min(...s), 1)} / ${fmt(Math.max(...s), 1)}`, 'MPa'],
      ['Summe F_s = Σ σ_s·A_s', bars.reduce((t, b) => t + b.sigma * b.A * 1000, 0), 'kN', 1],
    ]));
  }
  return out;
}

function inspectBar(app, ctx, i) {
  const p = app.project, b = p.bars[i];
  const ok = insideConcrete(p, [b.y, b.z]);
  const out = [
    h('div', { class: 'grid2' }, numField('y', b, 'y', { unit: 'mm', onChange: () => changed(app) }), numField('z', b, 'z', { unit: 'mm', onChange: () => changed(app) })),
    diaField('Ø', b, 'd', (v) => { ctx.ui.barD = v; changed(app); }, 'Stabdurchmesser. Gilt auch für die nächsten Stäbe, die mit «Stab», «Stabreihe» oder «Stabkreis» gesetzt werden.'),
    hint(`A_s = π·Ø²/4 = ${fmt(barAreaMm2(b.d), 0)} mm²`),
    ok ? null : note('Der Stab liegt ausserhalb des Betons bzw. in einer Aussparung.', 'warn'),
    ...barResults(app, [i]),
  ];
  return { title: `Stab ${i + 1}`, content: out };
}

function sectionProps(p) {
  const g = projectGeometry(p);
  if (g.errors.length) return { error: g.errors[0] };
  try { return { g, gp: grossProps(g.outer, g.holes) }; } catch (e) { return { error: e.message }; }
}

function inspectConcrete(app, ctx) {
  const p = app.project, m = p.material;
  const t = p.shape.type;
  const out = [];
  const tmp = { type: t };
  out.push(selectField('Form', tmp, 'type', SHAPE_TYPES.map((s) => ({ value: s.id, label: s.label })), {
    wide: true, info: 'Vorlage mit Parametern oder «Polygon frei». Der Wechsel auf «Polygon frei» übernimmt die aktuelle Form als Eckpunkte; das Ziehen eines Eckpunkts tut dies automatisch.',
    onChange: (v) => setShape(app, v),
  }));
  if (t !== 'poly') {
    p.shape[t] ||= defaultShapes()[t];
    out.push(h('div', { class: 'grid2' }, SHAPE_PARAMS[t].map(([k, label]) => numField(label, p.shape[t], k, { unit: 'mm', min: 1, onChange: () => changed(app) }))));
    out.push(hint(t === 'circle' || t === 'ring' ? 'Mittelpunkt im Ursprung (0/0).' : t === 'L' ? 'Äussere Ecke im Ursprung (0/0).' : 'Ziehen eines Eckpunkts wandelt in «Polygon frei» um.'));
  } else {
    const n = (p.shape.poly || []).length;
    out.push(hint(`${n} Eckpunkte – ziehen; Kante anklicken fügt einen Punkt ein.`));
    out.push(h('div', { class: 'ed-actions' }, button('Schwerpunkt → (0/0)', { small: true, title: 'Beton, Aussparungen und Stäbe so verschieben, dass der Schwerpunkt im Ursprung liegt', onClick: () => centerSection(app) })));
  }
  out.push(h('div', { class: 'grid2' },
    selectField('Beton', m, 'concrete', CONCRETE_CLASSES, { onChange: () => changed(app) }),
    selectField('Norm', m, 'norm', NORMS.map((x) => ({ value: x.value, label: x.value === 'SIA' ? 'SIA 262' : 'EN 1992-1-1' })), { onChange: () => changed(app) })));
  const sp = sectionProps(p);
  if (sp.error) out.push(note(sp.error, 'fail'));
  else {
    const { g, gp } = sp;
    const rot = !gp.isotropic && Math.abs(Math.sin(2 * gp.alpha)) > 1e-6;
    out.push(h('div', { class: 'ed-sub' }, 'Beton brutto'));
    out.push(kvTable([
      ['Fläche A_c', gp.A, 'mm²', 0],
      ['y_S / z_S', `${fmt(gp.cy, 1)} / ${fmt(gp.cz, 1)}`, 'mm'],
      ['I_y / I_z', `${fmt(gp.Iy / 1e6, 1)} / ${fmt(gp.Iz / 1e6, 1)}`, '10⁶ mm⁴'],
      rot ? ['I_1 / I_2, α', `${fmt(gp.I1 / 1e6, 1)} / ${fmt(gp.I2 / 1e6, 1)}, ${fmt(gp.alpha * 180 / Math.PI, 1)}°`, '10⁶ mm⁴'] : null,
      ['Breite × Höhe', `${f0(gp.b)} × ${f0(gp.h)}`, 'mm'],
      g.holes.length ? ['Aussparungen', g.holes.length, '', 0] : null,
    ]));
  }
  void ctx;
  return { title: t === 'poly' ? 'Betonquerschnitt (Polygon)' : `Betonquerschnitt: ${shapeLabel(t)}`, content: out };
}

function templateNote(app) {
  const t = app.project.shape.type;
  return t !== 'poly' ? note(`Teil der Vorlage «${shapeLabel(t)}» – Ändern oder Ziehen wandelt sie in «Polygon frei» um.`, '') : null;
}

function inspectVertex(app, id) {
  const p = app.project;
  const eo = editableOutline(p);
  const x = parseId(id);
  const ring = x.t === 'v' ? eo.outer : eo.openings[x.a]?.pts;
  const i = x.t === 'v' ? x.a : x.b;
  const q = ring?.[i];
  if (!q) return { title: 'Eckpunkt', content: [] };
  const tmp = { y: q[0], z: q[1] };
  const set = () => {
    const conv = setVertex(p, id, tmp.y, tmp.z);
    if (conv) converted(app, conv);
    changed(app);
  };
  const prev = ring[(i + ring.length - 1) % ring.length], next = ring[(i + 1) % ring.length];
  return {
    title: x.t === 'v' ? `Eckpunkt ${i + 1}` : `${eo.openings[x.a].name}, Punkt ${i + 1}`,
    content: [
      h('div', { class: 'grid2' }, numField('y', tmp, 'y', { unit: 'mm', onChange: set }), numField('z', tmp, 'z', { unit: 'mm', onChange: set })),
      h('div', { class: 'muted small' }, `Kanten: ${fmt(dist(prev, q), 1)} mm zum vorherigen, ${fmt(dist(q, next), 1)} mm zum nächsten Punkt.`),
      eo.openings[x.a]?.circle ? note('Ändern wandelt das Hüllrohr in eine freie Aussparung um.', '') : null,
      templateNote(app),
    ],
  };
}

function inspectEdge(app, id) {
  const p = app.project;
  const eo = editableOutline(p);
  const x = parseId(id);
  const ring = x.t === 'e' ? eo.outer : eo.openings[x.a]?.pts;
  const i = x.t === 'e' ? x.a : x.b;
  if (!ring?.[i]) return { title: 'Kante', content: [] };
  const a = ring[i], b = ring[(i + 1) % ring.length];
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  const round = p.shape.type === 'circle' || p.shape.type === 'ring' || !!eo.openings[x.a]?.circle;
  return {
    title: x.t === 'e' ? `Kante ${i + 1} → ${(i + 1) % ring.length + 1}` : `${eo.openings[x.a].name}, Kante`,
    content: [
      kvTable([
        ['Länge', dist(a, b), 'mm', 1],
        ['Neigung gegen y', ang, '°', 1],
        ['von', `${fmt(a[0], 1)} / ${fmt(a[1], 1)}`, 'mm'],
        ['bis', `${fmt(b[0], 1)} / ${fmt(b[1], 1)}`, 'mm'],
      ]),
      round ? null : h('div', { class: 'ed-actions' }, button('Punkt in der Mitte einfügen', {
        small: true, icon: 'plus', title: 'Neuen Eckpunkt in der Kantenmitte einfügen (danach ziehen)',
        onClick: () => {
          const r = insertVertex(p, id);
          if (r.converted) converted(app, r.converted);
          changed(app);
          if (r.id) app.editor?.select([r.id]);
        },
      })),
      round ? null : templateNote(app),
    ],
  };
}

function inspectOpening(app, ctx, k) {
  const p = app.project;
  const eo = editableOutline(p);
  const o = eo.openings[k];
  if (!o) return { title: 'Aussparung', content: [] };
  const pp = polygonProps(o.pts);
  const out = [];
  if (o.template) {
    out.push(note(`Hohlraum der Vorlage «${shapeLabel(p.shape.type)}» – Abmessungen beim Betonquerschnitt ändern.`, ''));
  } else {
    const src = p.openings[o.user];
    out.push(textField('Bezeichnung', src, 'name', { onChange: () => changed(app) }));
    if (src.circle) {
      const tmp = { ...src.circle };
      const set = () => { try { setDuct(p, k, tmp); ctx.ui.ductD = tmp.D; changed(app); } catch (e) { toast(e.message, 'warn'); } };
      out.push(h('div', { class: 'grid3' },
        numField('Ø', tmp, 'D', { unit: 'mm', min: 1, onChange: set, info: 'Als flächengleiches 32-Eck modelliert; gilt auch für das nächste Hüllrohr.' }),
        numField('Mitte y', tmp, 'y', { unit: 'mm', onChange: set }), numField('Mitte z', tmp, 'z', { unit: 'mm', onChange: set })));
    } else {
      out.push(hint(`${o.pts.length} Eckpunkte – ziehen; Kante anklicken fügt einen Punkt ein.`));
    }
  }
  out.push(kvTable([
    ['Fläche', Math.abs(pp.A), 'mm²', 0],
    ['Schwerpunkt y / z', `${fmt(pp.cy, 1)} / ${fmt(pp.cz, 1)}`, 'mm'],
  ]));
  if (eo.outer.length >= 3 && !o.pts.every((q) => pointInPolygon(q, eo.outer))) out.push(note('Die Aussparung liegt nicht vollständig im Beton.', 'warn'));
  return { title: o.name, content: out };
}

/** Passt die Auswahl genau zur zuletzt gezeichneten Stabgruppe (Reihe/Kreis)? */
function groupOf(app, ctx, barIdx) {
  const G = ctx.lastGroup;
  if (!G || G.ids.length !== barIdx.length) return null;
  const set = new Set(G.ids.map((id) => parseId(id).a));
  if (!barIdx.every((i) => set.has(i))) return null;
  const ref = groupBars(G);
  const bars = G.ids.map((id) => app.project.bars[parseId(id).a]);
  if (bars.some((b, j) => !b || Math.abs(b.y - ref[j].y) > 0.05 || Math.abs(b.z - ref[j].z) > 0.05)) return null;
  return G;
}

function regroup(app, ctx, G, n, d) {
  const p = app.project;
  const idx = G.ids.map((id) => parseId(id).a).sort((a, b) => b - a);
  for (const i of idx) p.bars.splice(i, 1);
  const g = { ...G, n: Math.max(1, Math.round(n)), d };
  const ids = addBars(p, groupBars(g));
  ctx.lastGroup = { ...g, ids };
  changed(app);
  app.editor?.select(ids);
}

function inspectMulti(app, ctx, ids) {
  const p = app.project;
  const P = ids.map(parseId);
  const barIdx = P.filter((x) => x.t === 'b' && p.bars[x.a]).map((x) => x.a);
  const other = P.length - barIdx.length;
  const out = [];
  if (barIdx.length) {
    const As = barIdx.reduce((s, i) => s + barAreaMm2(p.bars[i].d), 0);
    const ds = [...new Set(barIdx.map((i) => p.bars[i].d))];
    out.push(hint(`${barIdx.length} Stäbe${other ? ` und ${other} weitere Elemente` : ''} · A_s = ${fmt(As, 0)} mm²${ds.length > 1 ? ` (Ø ${ds.join(', ')})` : ''}`));
    const G = groupOf(app, ctx, barIdx);
    const tmp = { d: ds.length === 1 ? ds[0] : ctx.ui.barD, n: G?.n };
    out.push(diaField(ds.length === 1 ? 'Ø' : 'Ø für alle', tmp, 'd', (v) => {
      ctx.ui.barD = v;
      for (const i of barIdx) p.bars[i].d = v;
      if (G) G.d = v;
      changed(app);
    }));
    if (G) {
      out.push(numField('Anzahl n', tmp, 'n', {
        unit: 'Stk.', min: 1, max: 200, info: G.kind === 'row' ? 'Gleichmässig zwischen erstem und letztem Stab (beide inbegriffen).' : 'Gleichmässig auf dem Kreis, beginnend beim ersten Stab.',
        onChange: (v) => regroup(app, ctx, G, v, tmp.d),
      }));
      const L = dist(G.a, G.b);
      const s = G.kind === 'row' ? (G.n > 1 ? L / (G.n - 1) : 0) : 2 * Math.PI * L / G.n;
      out.push(hint(`Achsabstand s = ${fmt(s, 0)} mm${G.kind === 'circle' ? ` (Radius ${fmt(L, 0)} mm)` : ''}`));
    }
    out.push(...barResults(app, barIdx));
  } else {
    out.push(hint(`${ids.length} Elemente ausgewählt.`));
  }
  out.push(hint('Ziehen verschiebt · Entf löscht · C kopiert Stäbe und Aussparungen'));
  return { title: barIdx.length && !other ? `${barIdx.length} Stäbe` : `${ids.length} Elemente`, content: out };
}

// ------------------------------------------------------------------ Ruhezustand (nichts ausgewählt)

function idlePanel(app, ctx) {
  const p = app.project;
  const settings = () => {
    ctx.gen ||= {};
    const g = ctx.gen;
    if (!Number.isFinite(g.c)) g.c = 30;
    if (!Number.isFinite(g.dw)) g.dw = 8;
    const upd = () => { app.editor?.invalidate(); app.editor?.drawOverlay(); };
    return h('div', {},
      h('div', { class: 'ed-sub' }, 'Neue Elemente'),
      h('div', { class: 'grid2' },
        diaField('Ø Stäbe', ctx.ui, 'barD', upd, 'Durchmesser für «Stab», «Stabreihe» und «Stabkreis».'),
        numField('Ø Hüllrohr', ctx.ui, 'ductD', { unit: 'mm', min: 1 })),
      h('div', { class: 'grid2' },
        numField('Überdeckung c', g, 'c', { unit: 'mm', min: 0, onChange: upd, info: 'Für die Fangpunkte ○ im Achsabstand a = c + Ø<sub>w</sub> + Ø/2 vom Rand.' }),
        numField('Bügel Ø_w', g, 'dw', { unit: 'mm', min: 0, onChange: upd })),
      hint(`Fangpunkte ○: Achsabstand a = ${fmt(coverAxis(ctx), 0)} mm vom Rand`));
  };
  if (!hasOutline(p)) {
    return h('div', {},
      h('b', {}, 'Schritt 1 · Beton'),
      h('div', {}, '«Rechteck» (Q): zwei Ecken anklicken · «Polygon» (U): Eckpunkte, Enter schliesst. Masse in mm.'),
      hint('Vorlagen im Register «Querschnitt», fertige Querschnitte unter «Beispiele».'));
  }
  if (!(p.bars || []).length) {
    return h('div', {},
      h('b', {}, 'Schritt 2 · Bewehrung'),
      h('div', {}, '«Stab» (B), «Stabreihe» (L) oder «Stabkreis» (K); Fangpunkte ○ im Achsabstand vom Rand.'),
      settings());
  }
  if (!(p.loads || []).length) {
    return h('div', {},
      h('b', {}, 'Schritt 3 · Lastfall'),
      h('div', {}, rich('Schnittgrössen N, M_y, M_z im Register «Lasten» erfassen.')),
      h('div', { class: 'ed-actions' }, button('Lastfall anlegen', {
        small: true, primary: true, icon: 'plus',
        onClick: () => { p.loads.push({ name: 'LF 1', type: 'GZT', N: 0, My: 0, Mz: 0, V: 0 }); ctx.ui.lcOpen = p.loads.length - 1; changed(app); app.selectTab('lasten'); app.status('Lastfall «LF 1» angelegt – N und die Momente im geöffneten Lastfall eintragen.', 'ok'); },
      })));
  }
  return h('div', {},
    h('div', {}, 'Beton, Eckpunkt, Kante, Aussparung oder Stab anklicken zeigt Eigenschaften und Ergebnisse; Ziehen verschiebt.'),
    settings());
}
