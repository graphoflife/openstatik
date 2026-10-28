// Grafischer Editor: einheitliches Zeichnen, Wählen und Verschieben in allen Modulen.
//
// Das Modul beschreibt über einen Adapter (createApp({editor: …})), was es zeichnet und wie es auf
// Punkte reagiert. Der Editor kennt nur drei Formen – Punkte, Strecken und Flächen – und die Mechanik,
// mit der Punkte entstehen. Sie ist für jedes Werkzeug gleich:
//
//   Maus     fängt an Punkten □, Streckenmitten △, Schnittpunkten ×, am Lot ⊥ vom Bezugspunkt,
//            auf Strecken ◇, sonst am Raster +.  Alt gedrückt: kein Fang.
//   X / Y    (bzw. die Achsnamen des Moduls) binden an die Achse durch den Bezugspunkt. Ein Punkt
//            unter dem Zeiger wird gefangen und auf die Achse projiziert.
//   M        Mitte zweier Punkte (mit Bindung: auf die Achse projiziert).
//   R        Bezugspunkt auf den gefangenen Punkt setzen (sonst automatisch der letzte Punkt).
//   P / S    parallel bzw. senkrecht zu einer anschliessend angeklickten Strecke.
//   Shift    waagrecht/senkrecht zum Bezugspunkt, solange gedrückt.
//   Ziffern  Koordinaten tippen (relativ, absolut oder Länge/Winkel), Enter setzt den Punkt.
//   Esc      nimmt schrittweise zurück: Warten → Bindung → Getipptes → letzter Punkt → Werkzeug → Auswahl.
// Alle Hilfen sind in beliebiger Reihenfolge kombinierbar.
//
// Adapter (alle Funktionen erhalten app als erstes Argument):
//   axes: ['x','y'], unit: 'm', digits: 3, grid: [Stufen], gridDefault, modes: [viewModes mit Bearbeitung]
//   tools: [{id, label, icon, key, form: 'point'|'line'|'chain'|'polyline'|'polygon'|'rect'|'pick', title, pick: ['point','segment','region'],
//            once: true → nach dem Setzen zurück zur Auswahl (Eigenschaften des neuen Elements werden angezeigt)}]
//   geometry(app) → {points:[{id,p,label,movable,deletable}], segments:[{id,a,b,label,…}], regions:[{id,ring,label,…}], snaps:[{p,kind}]}
//                   movable:false → nicht verschiebbar; deletable (Standard = movable) → Löschen erlaubt
//   create(app, toolId, pts, {snaps}) → [neue Auswahl-IDs]      – Punkt/Linie/Polygon fertig
//   pick(app, toolId, hit) → [neue Auswahl-IDs]                 – Werkzeug der Form 'pick' (z.B. Last auf Stab)
//   move(app, ids, [dx,dy], {copy}) → [neue Auswahl-IDs]        – Verschieben bzw. Kopieren
//   remove(app, ids)                                            – Löschen
//   inspect(app, ids) → {title, content} | null                 – Eigenschaften der Auswahl
//   idleHint(app) → Text                                        – Hinweis ohne Auswahl
import { h, clear, button, icon, svgEl, segmented, numInput, toast } from './ui.js';
import { fmt, parseNum } from './format.js';

const NEAR = 9;        // px: Treffer an Strecken
const SNAP = 12;       // px: Fang an Punkten
const DRAG = 4;        // px: ab hier ist ein Druck ein Ziehen
const rnd = (v) => Math.round(v * 1e6) / 1e6;
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

function onSegment(p, a, b) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const l2 = r[0] * r[0] + r[1] * r[1] || 1e-30;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * r[0] + (p[1] - a[1]) * r[1]) / l2));
  return { q: [a[0] + t * r[0], a[1] + t * r[1]], t };
}
function onLine(p, through, r) {
  const l2 = r[0] * r[0] + r[1] * r[1] || 1e-30;
  const t = ((p[0] - through[0]) * r[0] + (p[1] - through[1]) * r[1]) / l2;
  return [through[0] + t * r[0], through[1] + t * r[1]];
}
function intersect([p1, p2], [q1, q2]) {
  const r = [p2[0] - p1[0], p2[1] - p1[1]], s = [q2[0] - q1[0], q2[1] - q1[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((q1[0] - p1[0]) * s[1] - (q1[1] - p1[1]) * s[0]) / den;
  const u = ((q1[0] - p1[0]) * r[1] - (q1[1] - p1[1]) * r[0]) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [p1[0] + t * r[0], p1[1] + t * r[1]];
}
function inside([x, y], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const SNAP_LABEL = { point: 'Punkt', mid: 'Mitte', cross: 'Schnittpunkt', perp: 'Lot', line: 'auf Linie', grid: 'Raster', free: 'frei', proj: 'projiziert', extra: 'Fangpunkt', typed: 'getippt', midpoint: 'Mitte zweier Punkte' };

/** Erzeugt den Editor für eine App. Wird von createApp aufgerufen, wenn def.editor gesetzt ist. */
export function createEditor(app, spec) {
  const view = app.view;
  const axes = spec.axes || ['x', 'y'];
  const unit = spec.unit || 'm';
  const digits = spec.digits ?? 3;
  const store = { get: (k) => { try { return localStorage.getItem(`openstatik.${app.def.id}.${k}`); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(`openstatik.${app.def.id}.${k}`, v); } catch { /* */ } } };
  const ed = {
    spec, tool: 'select', sel: [], anchor: null,
    hoverHit: null, cursor: null, snap: null,
    ref: null, bind: null, waiting: null, typed: ['', ''], mode: 'rel', round: 0,
    cmd: null, drag: null, box: null,
    snapOn: store.get('snap') !== '0',
    grid: +(store.get('grid') || spec.gridDefault || (spec.grid ? spec.grid[Math.floor(spec.grid.length / 2)] : 0.1)),
    geomCache: null,
  };
  app.editor = ed;

  // ------------------------------------------------------------ Geometrie
  ed.invalidate = () => { ed.geomCache = null; };
  function geom() {
    if (ed.geomCache) return ed.geomCache;
    let g = {};
    if (app.project) { try { g = spec.geometry(app) || {}; } catch (e) { console.error(e); g = {}; } }
    const points = g.points || [], segments = g.segments || [], regions = g.regions || [];
    const mids = segments.map((s) => ({ p: [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2] }));
    const crosses = [];
    if (segments.length < 400) {
      for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
        const A = segments[i], B = segments[j];
        const p = intersect([A.a, A.b], [B.a, B.b]);
        if (p && ![A.a, A.b, B.a, B.b].some((q) => dist(p, q) < 1e-6)) crosses.push({ p });
      }
    }
    ed.geomCache = { points, segments, regions, mids, crosses, extra: g.snaps || [] };
    return ed.geomCache;
  }
  const editable = () => !spec.modes || spec.modes.includes(app.viewMode);
  /** Elemente der Auswahl (aus der Geometrie). */
  function selItems() {
    const g = geom();
    return ed.sel.map((id) => g.points.find((q) => q.id === id) || g.segments.find((q) => q.id === id) || g.regions.find((q) => q.id === id)).filter(Boolean);
  }
  const canMoveSel = () => !!spec.move && ed.sel.length > 0 && selItems().some((it) => it.movable !== false);
  // löschbar: ausdrücklich deletable, sonst wie movable (Grundelemente wie Träger oder Wand bleiben stehen)
  const canDeleteSel = () => !!spec.remove && ed.sel.length > 0 && selItems().some((it) => (it.deletable ?? it.movable) !== false);
  const S = (p) => [view.X(p[0]), view.Y(p[1])];

  /** Element unter dem Zeiger: Punkte vor Strecken vor Flächen. */
  function hitAt(w, kinds = ['point', 'segment', 'region']) {
    const g = geom();
    const pr = view.px(SNAP), lr = view.px(NEAR);
    if (kinds.includes('point')) {
      let best = null;
      for (const pt of g.points) { const d = dist(w, pt.p); if (d <= pr && (!best || d < best.d)) best = { type: 'point', id: pt.id, item: pt, d }; }
      if (best) return best;
    }
    if (kinds.includes('segment')) {
      let best = null;
      for (const s of g.segments) { const { q, t } = onSegment(w, s.a, s.b); const d = dist(w, q); if (d <= lr && (!best || d < best.d)) best = { type: 'segment', id: s.id, item: s, d, t, q }; }
      if (best) return best;
    }
    if (kinds.includes('region')) {
      // kleinste Fläche zuerst (z.B. Öffnung vor Umriss)
      const hits = g.regions.filter((r) => r.ring?.length > 2 && inside(w, r.ring));
      if (hits.length) {
        const area = (r) => Math.abs(r.ring.reduce((a, p, i) => { const q = r.ring[(i + 1) % r.ring.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0));
        hits.sort((a, b) => area(a) - area(b));
        return { type: 'region', id: hits[0].id, item: hits[0], d: 0 };
      }
    }
    return null;
  }

  // ------------------------------------------------------------ Fangen
  function bindLine() {
    if (!ed.bind) return null;
    return { through: ed.ref || [0, 0], r: ed.bind.r };
  }

  /** Gefangener Punkt {p, kind, from?, id?} für Weltpunkt w. */
  function snapAt(w, e = {}) {
    const free = e.altKey || !ed.snapOn;
    const grid = ed.grid || 0;
    const ras = (v) => (grid > 0 ? Math.round(v / grid) * grid : v);
    let line = bindLine();
    if (!line && e.shiftKey && ed.ref) {
      const horiz = Math.abs(w[0] - ed.ref[0]) >= Math.abs(w[1] - ed.ref[1]);
      line = { through: ed.ref, r: horiz ? [1, 0] : [0, 1] };
    }
    const g = free ? null : geom();
    const pr = view.px(SNAP), lr = view.px(NEAR);
    let pt = null;
    if (g) {
      const near = (list, kind) => {
        let best = null;
        for (const x of list) { const d = dist(w, x.p); if (d <= pr && (!best || d < best.d)) best = { p: x.p, kind, id: x.id, d }; }
        return best;
      };
      const own = (ed.cmd?.pts || []).map((p) => ({ p }));
      const exclude = ed.drag?.ids || (ed.cmd?.kind === 'move' ? ed.sel : null);
      const pts = exclude ? g.points.filter((q) => !exclude.includes(q.id)) : g.points;
      pt = near([...pts, ...own], 'point') || near(g.crosses, 'cross') || near(g.mids, 'mid') || near(g.extra, 'extra');
    }
    if (line) {
      if (pt) return { p: onLine(pt.p, line.through, line.r), kind: 'proj', from: pt };
      const foot = onLine(w, line.through, line.r);
      if (free) return { p: foot, kind: 'free' };
      const l = Math.hypot(...line.r) || 1;
      const t = ((foot[0] - line.through[0]) * line.r[0] + (foot[1] - line.through[1]) * line.r[1]) / l;
      const tr = ras(t);
      return { p: [line.through[0] + tr * line.r[0] / l, line.through[1] + tr * line.r[1] / l], kind: 'grid' };
    }
    if (free) return { p: w, kind: 'free' };
    if (pt) return { p: pt.p, kind: pt.kind, id: pt.id };
    if (ed.ref) {
      let lot = null;
      for (const s of g.segments) {
        const r = [s.b[0] - s.a[0], s.b[1] - s.a[1]];
        const l2 = r[0] * r[0] + r[1] * r[1];
        if (!l2) continue;
        const t = ((ed.ref[0] - s.a[0]) * r[0] + (ed.ref[1] - s.a[1]) * r[1]) / l2;
        if (t <= 1e-9 || t >= 1 - 1e-9) continue;
        const foot = [s.a[0] + t * r[0], s.a[1] + t * r[1]];
        const d = dist(w, foot);
        if (d <= lr && dist(foot, ed.ref) > 1e-9 && (!lot || d < lot.d)) lot = { p: foot, d };
      }
      if (lot) return { p: lot.p, kind: 'perp' };
    }
    let best = null;
    for (const s of g.segments) {
      const { q } = onSegment(w, s.a, s.b);
      const d = dist(w, q);
      if (d > lr * 0.8 || (best && d >= best.d)) continue;
      let p = q;
      if (Math.abs(s.b[1] - s.a[1]) < 1e-9) p = [ras(q[0]), s.a[1]];
      else if (Math.abs(s.b[0] - s.a[0]) < 1e-9) p = [s.a[0], ras(q[1])];
      if (dist(onSegment(p, s.a, s.b).q, p) > 1e-9) p = q;
      best = { p, d, kind: 'line', seg: s.id };
    }
    if (best) return { p: best.p, kind: 'line', seg: best.seg };
    return { p: [ras(w[0]), ras(w[1])], kind: 'grid' };
  }

  /** Strecke unter dem Zeiger (für P/S). */
  function segmentAt(w) {
    const h0 = hitAt(w, ['segment']);
    return h0 ? h0.item : null;
  }

  /** Punkt aus einem Klick unter Berücksichtigung von M, P/S. Gibt {p,…} oder null (Zwischenschritt). */
  function clickPoint(w, e) {
    if (ed.waiting === 'parallel' || ed.waiting === 'perp') {
      const s = segmentAt(w);
      if (!s) { app.status('Bitte eine Linie anklicken.', 'warn'); return null; }
      let r = [s.b[0] - s.a[0], s.b[1] - s.a[1]];
      if (ed.waiting === 'perp') r = [-r[1], r[0]];
      ed.bind = { kind: ed.waiting, r, text: `${ed.waiting === 'parallel' ? '∥' : '⊥'} ${s.label || ''}`.trim() };
      ed.waiting = null;
      return null;
    }
    const f = snapAt(w, e);
    if (ed.waiting?.kind === 'mid') {
      if (!ed.waiting.first) { ed.waiting.first = f.p; return null; }
      let m = [(ed.waiting.first[0] + f.p[0]) / 2, (ed.waiting.first[1] + f.p[1]) / 2];
      const bl = bindLine();
      if (bl) m = onLine(m, bl.through, bl.r);
      ed.waiting = null;
      return { p: m.map(rnd), kind: 'midpoint' };
    }
    return { p: f.p.map(rnd), kind: f.kind, id: f.id };
  }

  function typedPoint() {
    const [u, v] = ed.typed.map((t) => (String(t).trim() === '' ? null : parseNum(t)));
    if (u === null && v === null) return null;
    if (Number.isNaN(u) || Number.isNaN(v)) return { error: 'Bitte eine Zahl eingeben.' };
    const base = ed.ref || [0, 0];
    const bl = bindLine();
    if (bl) {
      const l = Math.hypot(...bl.r) || 1;
      const t = u ?? 0;
      return { p: [base[0] + t * bl.r[0] / l, base[1] + t * bl.r[1] / l].map(rnd), kind: 'typed' };
    }
    if (ed.mode === 'abs') return { p: [u ?? base[0], v ?? base[1]].map(rnd), kind: 'typed' };
    if (ed.mode === 'polar') {
      const L = u ?? 0, a = (v ?? 0) * Math.PI / 180;
      return { p: [base[0] + L * Math.cos(a), base[1] + L * Math.sin(a)].map(rnd), kind: 'typed' };
    }
    return { p: [base[0] + (u ?? 0), base[1] + (v ?? 0)].map(rnd), kind: 'typed' };
  }
  const clearTyped = () => { ed.typed = ['', '']; ed.round++; };
  const clearAids = () => { ed.bind = null; ed.waiting = null; clearTyped(); };

  // ------------------------------------------------------------ Befehle
  const toolDef = (id) => (spec.tools || []).find((t) => t.id === id);

  function setTool(id) {
    if (id !== 'select' && !editable() && spec.modes?.length) app.setViewMode(spec.modes[0]);
    ed.tool = id;
    ed.cmd = null;
    clearAids();
    const t = toolDef(id);
    if (t && t.form !== 'pick') ed.cmd = { kind: 'create', tool: t, pts: [], snaps: [] };
    if (t && t.form === 'pick') ed.cmd = { kind: 'pick', tool: t, pts: [] };
    if (id === 'select') ed.ref = null;
    renderToolbar();
    refreshPanel(true);
    drawOverlay();
    updateHint();
  }
  ed.setTool = setTool;

  function finishCreate() {
    const c = ed.cmd;
    const t = c.tool;
    const pts = c.pts.slice();
    if (t.form === 'polygon' && pts.length < 3) { app.status('Ein Polygon braucht mindestens drei Punkte.', 'warn'); return; }
    if (t.form === 'polyline' && pts.length < 2) { app.status('Mindestens zwei Punkte setzen.', 'warn'); return; }
    let ids = null;
    try { ids = spec.create(app, t.id, pts, { snaps: c.snaps.slice() }); } catch (err) { toast(err.message, 'error'); }
    c.pts = []; c.snaps = [];
    clearAids();
    afterEdit(ids, true);
  }

  function addPoint(pt) {
    const c = ed.cmd;
    if (!c) return;
    if (c.kind === 'move') {
      if (!c.base) { c.base = pt.p; ed.ref = pt.p; clearAids(); refreshPanel(true); return; }
      const d = [pt.p[0] - c.base[0], pt.p[1] - c.base[1]];
      let ids = null;
      try { ids = spec.move(app, ed.sel.slice(), d, { copy: c.copy }); } catch (err) { toast(err.message, 'error'); }
      ed.ref = pt.p;
      ed.cmd = null; ed.tool = 'select';
      clearAids();
      afterEdit(ids || ed.sel, true);
      renderToolbar();
      return;
    }
    const t = c.tool;
    // Polygon schliessen durch Klick auf den ersten Punkt
    if (t.form === 'polygon' && c.pts.length >= 3 && dist(pt.p, c.pts[0]) < view.px(SNAP)) { finishCreate(); return; }
    c.pts.push(pt.p); c.snaps.push(pt);
    ed.ref = pt.p;
    clearAids();
    const n = c.pts.length;
    if (t.form === 'point' || (t.form === 'line' && n === 2) || (t.form === 'rect' && n === 2)) {
      const pts = t.form === 'rect' ? rectFrom(c.pts[0], c.pts[1]) : c.pts.slice();
      let ids = null;
      try { ids = spec.create(app, t.id, pts, { snaps: c.snaps.slice() }); } catch (err) { toast(err.message, 'error'); }
      c.pts = []; c.snaps = [];
      afterEdit(ids, false);
    } else if (t.form === 'chain' && n === 2) {
      let ids = null;
      try { ids = spec.create(app, t.id, c.pts.slice(), { snaps: c.snaps.slice() }); } catch (err) { toast(err.message, 'error'); }
      c.pts = [pt.p]; c.snaps = [{ ...pt, id: null }];
      afterEdit(ids, false);
    } else {
      refreshPanel(true);
      drawOverlay();
    }
  }
  const rectFrom = (a, b) => [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];

  function afterEdit(ids, keepSelect) {
    ed.invalidate();
    if (Array.isArray(ids) && ids.length) ed.sel = ids.slice();
    app.changed({ inputs: true, undoNow: true });
    if (keepSelect && ed.tool !== 'select' && ed.cmd?.kind !== 'create') setTool('select');
    else if (ed.cmd?.tool?.once && Array.isArray(ids) && ids.length) { const sel = ed.sel; setTool('select'); ed.sel = sel; }
    refreshPanel(true);
    drawOverlay();
    revealSelection();
  }

  /** Passt einmal neu ein, wenn das Eigenschaftsfenster die Auswahl verdecken würde (nur ohne manuellen Zoom). */
  function revealSelection() {
    if (view.userAdjusted || !ed.sel.length || panel.classList.contains('collapsed')) return;
    requestAnimationFrame(() => {
      const r = { x0: panel.offsetLeft, y0: panel.offsetTop, x1: panel.offsetLeft + panel.offsetWidth, y1: panel.offsetTop + panel.offsetHeight };
      const covered = selItems().some((it) => {
        const pts = it.p ? [it.p] : it.ring || [it.a, it.b];
        return pts.filter(Boolean).every((q) => { const [x, y] = S(q); return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; });
      });
      if (covered) view.fit();
    });
  }

  function startMove(copy) {
    if (!ed.sel.length) { app.status('Zuerst etwas auswählen.', 'warn'); return; }
    if (!canMoveSel()) { app.status('Die Auswahl lässt sich nicht verschieben.', 'warn'); return; }
    const base = ed.anchor || null;
    ed.cmd = { kind: 'move', copy: !!copy, base, pts: [] };
    ed.tool = copy ? '_copy' : '_move';
    if (base) ed.ref = base;
    clearAids();
    renderToolbar();
    refreshPanel(true);
    drawOverlay();
    updateHint();
  }

  function removeSelection() {
    if (!canDeleteSel()) { if (ed.sel.length) app.status('Die Auswahl lässt sich nicht löschen.', 'warn'); return; }
    try { spec.remove(app, ed.sel.slice()); } catch (err) { toast(err.message, 'error'); return; }
    ed.sel = [];
    ed.anchor = null;
    afterEdit(null, false);
  }

  function escape() {
    if (ed.waiting) { ed.waiting = null; }
    else if (ed.bind) { ed.bind = null; }
    else if (ed.typed.some((t) => t !== '')) { clearTyped(); }
    else if (ed.cmd?.kind === 'create' && ed.cmd.pts.length) { ed.cmd.pts.pop(); ed.cmd.snaps.pop(); ed.ref = ed.cmd.pts[ed.cmd.pts.length - 1] || null; }
    else if (ed.cmd?.kind === 'move' && ed.cmd.base && ed.cmd.base !== ed.anchor) { ed.cmd.base = ed.anchor; ed.ref = ed.anchor; }
    else if (ed.cmd || ed.tool !== 'select') { setTool('select'); return; }
    else if (ed.sel.length) { ed.sel = []; ed.anchor = null; app.redraw(); }
    refreshPanel(true);
    drawOverlay();
    updateHint();
  }

  // ------------------------------------------------------------ Maus
  const interaction = {
    down(w, e) {
      ed.cursor = w;
      if (!editable()) {
        const hit = hitAt(w);
        if (hit) { select(hit, e); return true; }
        return false;
      }
      if (ed.cmd) { ed.press = { w, x: e.clientX, y: e.clientY }; return true; }
      const hit = hitAt(w);
      if (hit) {
        const already = ed.sel.includes(hit.id);
        if (!already) select(hit, e);
        const movable = spec.move && (hit.type !== 'point' || hit.item.movable !== false) && hit.item.movable !== false;
        const base = hit.type === 'point' ? hit.item.p : snapAt(w, e).p;
        ed.drag = { start: [e.clientX, e.clientY], base, ids: ed.sel.slice(), moved: false, hit, movable, shift: e.shiftKey, already };
        return true;
      }
      ed.box = { a: w, b: w, start: [e.clientX, e.clientY], add: e.shiftKey, moved: false };
      return true;
    },
    move(w, e) {
      ed.cursor = w;
      if (ed.drag) {
        if (!ed.drag.moved && Math.hypot(e.clientX - ed.drag.start[0], e.clientY - ed.drag.start[1]) < DRAG) return;
        if (!ed.drag.moved) {
          if (!ed.drag.movable) { ed.drag = null; return; }
          ed.drag.moved = true;
          ed.ref = ed.drag.base;
          clearAids();
          refreshPanel(true);
          updateHint();
        }
        ed.snap = snapAt(w, e);
        scheduleOverlay();
        return;
      }
      if (ed.box) {
        if (!ed.box.moved && Math.hypot(e.clientX - ed.box.start[0], e.clientY - ed.box.start[1]) < DRAG) return;
        ed.box.moved = true;
        ed.box.b = w;
        scheduleOverlay();
        return;
      }
      interaction.hover(w, e);
    },
    up(w, e) {
      ed.cursor = w;
      if (ed.drag) {
        const d0 = ed.drag;
        ed.drag = null;
        if (d0.moved) {
          const target = ed.waiting?.kind === 'mid' && ed.waiting.first ? clickPoint(w, e) : (typedPoint() && !typedPoint().error ? typedPoint() : snapAt(w, e));
          if (target) {
            const d = [target.p[0] - d0.base[0], target.p[1] - d0.base[1]];
            let ids = null;
            try { ids = spec.move(app, d0.ids, d, { copy: false }); } catch (err) { toast(err.message, 'error'); }
            ed.anchor = target.p.map(rnd);
            ed.ref = ed.anchor;
            clearAids();
            afterEdit(ids || d0.ids, false);
          }
        } else if (d0.already) {
          select(d0.hit, { shiftKey: d0.shift, cycle: true });
        }
        updateHint();
        return;
      }
      if (ed.box) {
        const b = ed.box;
        ed.box = null;
        if (b.moved) boxSelect(b.a, b.b, b.add);
        else if (!b.add && ed.sel.length) { ed.sel = []; ed.anchor = null; refreshPanel(true); app.redraw(); }
        drawOverlay();
        return;
      }
      if (ed.cmd && ed.press) {
        ed.press = null;
        if (ed.cmd.kind === 'pick') {
          const hit = hitAt(w, ed.cmd.tool.pick || ['point', 'segment', 'region']);
          if (!hit) { app.status(ed.cmd.tool.hint || 'Bitte ein passendes Element anklicken.', 'warn'); return; }
          let ids = null;
          const once = ed.cmd.tool.once;
          try { ids = spec.pick(app, ed.cmd.tool.id, hit); } catch (err) { toast(err.message, 'error'); }
          afterEdit(ids, false);
          if (once) setTool('select');
          return;
        }
        const pt = clickPoint(w, e);
        if (pt) addPoint(pt);
        else { refreshPanel(true); drawOverlay(); }
        updateHint();
      }
    },
    hover(w, e) {
      ed.cursor = w;
      ed.lastEvent = { altKey: e.altKey, shiftKey: e.shiftKey };
      if (ed.cmd && ed.cmd.kind !== 'pick') ed.snap = snapAt(w, e);
      else ed.snap = null;
      const hh = editable() || !ed.cmd ? hitAt(w, ed.cmd?.kind === 'pick' ? ed.cmd.tool.pick : undefined) : null;
      const changed = (hh?.id || null) !== (ed.hoverHit?.id || null);
      ed.hoverHit = ed.cmd && ed.cmd.kind !== 'pick' ? null : hh;
      view.svg.style.cursor = ed.cmd ? (ed.cmd.kind === 'pick' ? (hh ? 'pointer' : 'not-allowed') : 'crosshair') : hh ? (editable() ? 'move' : 'pointer') : 'default';
      if (changed || ed.cmd) scheduleOverlay();
      if (ed.cmd && ed.snap) updateTipCoords();
    },
    leave() { ed.cursor = null; ed.snap = null; ed.hoverHit = null; scheduleOverlay(); },
    cancel() { ed.drag = null; ed.box = null; scheduleOverlay(); },
    dblclick() {
      if (ed.cmd?.kind === 'create' && ['polygon', 'polyline'].includes(ed.cmd.tool.form)) { finishCreate(); return true; }
      return !!ed.cmd;
    },
  };
  view.interaction = interaction;

  function select(hit, e = {}) {
    if (e.shiftKey) {
      ed.sel = ed.sel.includes(hit.id) ? ed.sel.filter((x) => x !== hit.id) : [...ed.sel, hit.id];
    } else {
      ed.sel = [hit.id];
    }
    ed.anchor = hit.type === 'point' ? hit.item.p : hit.type === 'segment' ? (dist(hit.q, hit.item.a) < dist(hit.q, hit.item.b) ? hit.item.a : hit.item.b) : null;
    app.selection = { ids: ed.sel.slice(), hit };
    spec.onSelect?.(app, ed.sel.slice(), hit);
    refreshPanel(true);
    app.redraw();
    updateHint();
    revealSelection();
  }
  ed.select = (ids) => { ed.sel = ids.slice(); refreshPanel(true); app.redraw(); };

  function boxSelect(a, b, add) {
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    const inBox = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
    const g = geom();
    const ids = [];
    for (const p of g.points) if (inBox(p.p)) ids.push(p.id);
    for (const s of g.segments) if (inBox(s.a) && inBox(s.b)) ids.push(s.id);
    for (const r of g.regions) if (r.ring?.every(inBox)) ids.push(r.id);
    ed.sel = add ? [...new Set([...ed.sel, ...ids])] : ids;
    ed.anchor = null;
    refreshPanel(true);
    app.redraw();
    app.status(`${ed.sel.length} Element${ed.sel.length === 1 ? '' : 'e'} ausgewählt`);
  }

  // ------------------------------------------------------------ Tastatur
  const isField = (t) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t?.isContentEditable;
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'a' && !isField(e.target) && view.hovered) {
        e.preventDefault();
        const g = geom();
        ed.sel = [...g.points.map((p) => p.id), ...g.segments.map((s) => s.id), ...g.regions.map((r) => r.id)];
        refreshPanel(true); app.redraw();
      }
      return;
    }
    if (isField(e.target)) {
      if (e.target.closest?.('.ed-coords') && (e.key === 'Escape')) { e.target.blur(); escape(); e.preventDefault(); }
      return;
    }
    if (document.querySelector('.modal-back, .report-back')) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const pointInput = !!ed.cmd && ed.cmd.kind !== 'pick' || !!ed.drag?.moved;
    if (k === 'Escape') { escape(); e.preventDefault(); return; }
    if (pointInput) {
      const [a1, a2] = axes.map((x) => x.toLowerCase());
      const curSnap = () => ed.snap?.p || (ed.cursor ? snapAt(ed.cursor, ed.lastEvent || {}).p : null);
      if (k === a1 || k === a2) {
        const r = k === a1 ? [1, 0] : [0, 1];
        if (ed.bind?.kind === 'axis' && ed.bind.r[0] === r[0]) ed.bind = null;
        else {
          if (!ed.ref) ed.ref = curSnap()?.map(rnd) || null;
          ed.bind = { kind: 'axis', r, text: `entlang ${k === a1 ? axes[0] : axes[1]}` };
        }
        clearTyped();
      } else if (k === 'm') {
        ed.waiting = { kind: 'mid', first: null };
      } else if (k === 'r') {
        const p = curSnap();
        if (p) ed.ref = p.map(rnd);
      } else if (k === 'p' || k === 's') {
        if (!ed.ref) ed.ref = curSnap()?.map(rnd) || null;
        ed.waiting = k === 'p' ? 'parallel' : 'perp';
      } else if (k === 'Enter') {
        const tp = typedPoint();
        if (tp && !tp.error) { applyTyped(); }
        else if (ed.cmd?.kind === 'create' && ['polygon', 'polyline'].includes(ed.cmd.tool.form)) finishCreate();
        else if (ed.cmd?.tool?.form === 'chain') setTool(ed.cmd.tool.id);
      } else if (k === 'Backspace' && ed.cmd?.kind === 'create' && ed.cmd.pts.length) {
        ed.cmd.pts.pop(); ed.cmd.snaps.pop(); ed.ref = ed.cmd.pts[ed.cmd.pts.length - 1] || null;
      } else if (/^[0-9.,-]$/.test(e.key)) {
        const inp = panel.querySelector('.ed-coords input');
        if (inp) { inp.focus(); inp.value = e.key; ed.typed[0] = e.key; e.preventDefault(); }
        return;
      } else return;
      e.preventDefault();
      if (ed.drag?.moved && ed.cursor) ed.snap = snapAt(ed.cursor, ed.lastEvent || {});
      else if (ed.cursor) ed.snap = snapAt(ed.cursor, ed.lastEvent || {});
      refreshPanel(true);
      drawOverlay();
      updateHint();
      return;
    }
    if ((k === 'Delete' || k === 'Backspace') && ed.sel.length && editable()) { removeSelection(); e.preventDefault(); return; }
    if (k === 'v' && ed.sel.length && editable()) { startMove(false); e.preventDefault(); return; }
    if (k === 'c' && ed.sel.length && editable() && spec.canCopy) { startMove(true); e.preventDefault(); return; }
    const t = (spec.tools || []).find((x) => x.key && x.key.toLowerCase() === k);
    if (t) { setTool(t.id); e.preventDefault(); }
  });

  function applyTyped() {
    const tp = typedPoint();
    if (!tp) return;
    if (tp.error) { app.status(tp.error, 'warn'); return; }
    clearTyped();
    if (ed.drag?.moved) {
      const d0 = ed.drag; ed.drag = null;
      const d = [tp.p[0] - d0.base[0], tp.p[1] - d0.base[1]];
      const ids = spec.move(app, d0.ids, d, { copy: false });
      afterEdit(ids || d0.ids, false);
      return;
    }
    addPoint(tp);
  }

  // ------------------------------------------------------------ Darstellung (Bildschirmkoordinaten)
  let raf = 0;
  function scheduleOverlay() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawOverlay(); }); }
  // Geometrie kann von der Zoomstufe abhängen (Symbole in Pixelgrösse) → Cache verwerfen
  view.onChange(() => { ed.invalidate(); scheduleOverlay(); });

  const MARK = {
    point: (x, y) => svgEl('rect', { x: x - 5.5, y: y - 5.5, width: 11, height: 11, class: 'ed-snap' }),
    mid: (x, y) => svgEl('path', { d: `M${x} ${y - 6.5}L${x + 6.5} ${y + 5}L${x - 6.5} ${y + 5}Z`, class: 'ed-snap' }),
    cross: (x, y) => svgEl('path', { d: `M${x - 6} ${y - 6}L${x + 6} ${y + 6}M${x + 6} ${y - 6}L${x - 6} ${y + 6}`, class: 'ed-snap' }),
    line: (x, y) => svgEl('path', { d: `M${x} ${y - 6.5}L${x + 6.5} ${y}L${x} ${y + 6.5}L${x - 6.5} ${y}Z`, class: 'ed-snap' }),
    perp: (x, y) => svgEl('path', { d: `M${x - 6.5} ${y + 5.5}H${x + 6.5}M${x} ${y + 5.5}V${y - 6.5}`, class: 'ed-snap' }),
    proj: (x, y) => svgEl('circle', { cx: x, cy: y, r: 5, class: 'ed-snap' }),
    extra: (x, y) => svgEl('circle', { cx: x, cy: y, r: 5, class: 'ed-snap' }),
    midpoint: (x, y) => svgEl('path', { d: `M${x} ${y - 6.5}L${x + 6.5} ${y + 5}L${x - 6.5} ${y + 5}Z`, class: 'ed-snap' }),
    grid: (x, y) => svgEl('path', { d: `M${x - 5.5} ${y}H${x + 5.5}M${x} ${y - 5.5}V${y + 5.5}`, class: 'ed-snap ed-snap-grid' }),
    free: (x, y) => svgEl('circle', { cx: x, cy: y, r: 2.5, class: 'ed-snap ed-snap-grid' }),
  };
  function label(g, x, y, lines, cls = 'ed-tip') {
    lines.filter(Boolean).forEach((t, i) => g.append(svgEl('text', { x: x + 14, y: y + 20 + i * 14, class: cls, text: t })));
  }
  function geomShape(g, id, cls) {
    const gg = geom();
    const pt = gg.points.find((p) => p.id === id);
    if (pt) { const [x, y] = S(pt.p); g.append(svgEl('circle', { cx: x, cy: y, r: cls === 'ed-sel' ? 6.5 : 5.5, class: `${cls} ed-pt` })); return; }
    const sg = gg.segments.find((s) => s.id === id);
    if (sg) { const [x1, y1] = S(sg.a), [x2, y2] = S(sg.b); g.append(svgEl('line', { x1, y1, x2, y2, class: cls })); return; }
    const rg = gg.regions.find((r) => r.id === id);
    if (rg?.ring?.length) g.append(svgEl('polygon', { points: rg.ring.map((p) => S(p).join(',')).join(' '), class: `${cls} ed-region` }));
  }

  function drawGrid() {
    const gg = view.gGrid;
    while (gg.firstChild) gg.removeChild(gg.firstChild);
    if (!editable() || !ed.grid) return;
    let step = ed.grid;
    while (step * view.scale < 12) step *= step * view.scale < 5 ? 10 : 2;
    const x0 = view.wx(0), x1 = view.wx(view.width), y0 = view.wy(view.height), y1 = view.wy(0);
    if ((x1 - x0) / step > 400 || (y1 - y0) / step > 400) return;
    const major = step * 5;
    let d = '', dm = '';
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      const X = view.X(x).toFixed(1);
      const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
      if (isMajor) dm += `M${X} 0V${view.height}`; else d += `M${X} 0V${view.height}`;
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const Y = view.Y(y).toFixed(1);
      const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-6;
      if (isMajor) dm += `M0 ${Y}H${view.width}`; else d += `M0 ${Y}H${view.width}`;
    }
    gg.append(svgEl('path', { d, class: 'ed-grid' }), svgEl('path', { d: dm, class: 'ed-grid ed-grid-major' }));
    const ox = view.X(0), oy = view.Y(0);
    gg.append(svgEl('path', { d: `M${ox} 0V${view.height}M0 ${oy}H${view.width}`, class: 'ed-grid ed-grid-axis' }));
  }

  function drawOverlay() {
    drawGrid();
    const g = view.gInteract;
    while (g.firstChild) g.removeChild(g.firstChild);
    // Auswahl und Hover
    for (const id of ed.sel) geomShape(g, id, 'ed-sel');
    if (ed.hoverHit && !ed.sel.includes(ed.hoverHit.id)) geomShape(g, ed.hoverHit.id, 'ed-hover');
    // Name des Elements unter dem Zeiger (Auswahlmodus bzw. Werkzeug «anklicken»)
    if (ed.hoverHit?.item?.label && ed.cursor && !ed.drag && !ed.box) {
      const [cx, cy] = S(ed.cursor);
      const tip = ed.cmd?.kind === 'pick' ? `${ed.hoverHit.item.label} – klicken` : ed.hoverHit.item.label;
      g.append(svgEl('text', { x: cx + 14, y: cy - 10, class: 'ed-tip ed-tip-name', text: tip }));
    }
    if (!editable() && !ed.cmd) return;
    // Bindung
    const bl = bindLine();
    if (bl) {
      const [x, y] = S(bl.through);
      const l = Math.hypot(bl.r[0], bl.r[1]) || 1;
      const L = Math.hypot(view.width, view.height);
      const dx = bl.r[0] / l * L, dy = -bl.r[1] / l * L;
      g.append(svgEl('line', { x1: x - dx, y1: y - dy, x2: x + dx, y2: y + dy, class: 'ed-bind' }));
    }
    // Bezugspunkt
    if (ed.ref && (ed.cmd || ed.drag?.moved)) {
      const [x, y] = S(ed.ref);
      g.append(svgEl('path', { d: `M${x - 7} ${y - 7}L${x + 7} ${y + 7}M${x + 7} ${y - 7}L${x - 7} ${y + 7}`, class: 'ed-ref' }));
    }
    const sp = ed.snap;
    const tp = typedPoint();
    const target = tp && !tp.error ? tp.p : sp?.p;
    // Vorschau des aktuellen Befehls
    if (ed.cmd?.kind === 'create' && target) {
      const pts = ed.cmd.pts;
      const form = ed.cmd.tool.form;
      if (form === 'rect' && pts.length === 1) {
        const r = rectFrom(pts[0], target);
        g.append(svgEl('polygon', { points: r.map((p) => S(p).join(',')).join(' '), class: 'ed-preview ed-preview-fill' }));
      } else if (pts.length) {
        const all = [...pts, target];
        g.append(svgEl('polyline', { points: all.map((p) => S(p).join(',')).join(' '), class: 'ed-preview' }));
        if (form === 'polygon' && pts.length >= 2) {
          g.append(svgEl('polygon', { points: all.map((p) => S(p).join(',')).join(' '), class: 'ed-preview-fill' }));
          const [x0, y0] = S(pts[0]);
          g.append(svgEl('circle', { cx: x0, cy: y0, r: 7, class: 'ed-close' }));
        }
        for (const p of pts) { const [x, y] = S(p); g.append(svgEl('circle', { cx: x, cy: y, r: 3.5, class: 'ed-vertex' })); }
        const last = pts[pts.length - 1];
        const [tx, ty] = S(target);
        label(g, tx, ty, [`L = ${fmt(dist(last, target), digits)} ${unit}`, `Δ${axes[0]} = ${fmt(target[0] - last[0], digits)}  Δ${axes[1]} = ${fmt(target[1] - last[1], digits)}`]);
      }
    }
    // Vorschau Verschieben / Ziehen
    const mv = ed.drag?.moved ? { base: ed.drag.base, ids: ed.drag.ids } : ed.cmd?.kind === 'move' && ed.cmd.base ? { base: ed.cmd.base, ids: ed.sel } : null;
    if (mv && target) {
      const d = [target[0] - mv.base[0], target[1] - mv.base[1]];
      const gg = geom();
      const shift = (p) => S([p[0] + d[0], p[1] + d[1]]);
      for (const id of mv.ids) {
        const pt = gg.points.find((p) => p.id === id);
        if (pt) { const [x, y] = shift(pt.p); g.append(svgEl('circle', { cx: x, cy: y, r: 4.5, class: 'ed-moved' })); }
        const sg = gg.segments.find((s) => s.id === id);
        if (sg) { const [x1, y1] = shift(sg.a), [x2, y2] = shift(sg.b); g.append(svgEl('line', { x1, y1, x2, y2, class: 'ed-moved' })); }
        const rg = gg.regions.find((r) => r.id === id);
        if (rg?.ring) g.append(svgEl('polygon', { points: rg.ring.map((p) => shift(p).join(',')).join(' '), class: 'ed-moved ed-region' }));
      }
      const [x0, y0] = S(mv.base), [x1, y1] = S(target);
      g.append(svgEl('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'ed-vector' }));
      label(g, x1, y1, [`Δ${axes[0]} = ${fmt(d[0], digits)}  Δ${axes[1]} = ${fmt(d[1], digits)} ${unit}`, `L = ${fmt(Math.hypot(d[0], d[1]), digits)} ${unit}`]);
    }
    // Mitte zweier Punkte
    if (ed.waiting?.kind === 'mid' && ed.waiting.first) {
      const [x, y] = S(ed.waiting.first);
      g.append(svgEl('circle', { cx: x, cy: y, r: 4, class: 'ed-midpt' }));
      if (sp) {
        const [x2, y2] = S(sp.p);
        g.append(svgEl('line', { x1: x, y1: y, x2, y2, class: 'ed-midline' }));
        g.append(svgEl('circle', { cx: (x + x2) / 2, cy: (y + y2) / 2, r: 3.5, class: 'ed-midpt' }));
      }
    }
    // Strecke für P/S hervorheben
    if ((ed.waiting === 'parallel' || ed.waiting === 'perp') && ed.cursor) {
      const s = segmentAt(ed.cursor);
      if (s) { const [x1, y1] = S(s.a), [x2, y2] = S(s.b); g.append(svgEl('line', { x1, y1, x2, y2, class: 'ed-pick' })); }
    }
    // Fangzeichen
    if (sp && (ed.cmd?.kind === 'create' || ed.cmd?.kind === 'move' || ed.drag?.moved)) {
      const [x, y] = S(target || sp.p);
      if (sp.from && !(tp && !tp.error)) {
        const [x0, y0] = S(sp.from.p);
        g.append(svgEl('line', { x1: x0, y1: y0, x2: x, y2: y, class: 'ed-trace' }));
        g.append((MARK[sp.from.kind] || MARK.extra)(x0, y0));
      }
      g.append((MARK[tp && !tp.error ? 'free' : sp.kind] || MARK.grid)(x, y));
      if (!ed.cmd?.pts?.length && !mv) label(g, x, y, [`${axes[0]} = ${fmt(sp.p[0], digits)}  ${axes[1]} = ${fmt(sp.p[1], digits)}`, SNAP_LABEL[sp.kind]], 'ed-tip ed-tip-soft');
    }
    // Auswahlrahmen
    if (ed.box?.moved) {
      const [x0, y0] = S(ed.box.a), [x1, y1] = S(ed.box.b);
      g.append(svgEl('rect', { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0), class: 'ed-box' }));
    }
  }
  ed.drawOverlay = drawOverlay;

  // ------------------------------------------------------------ Werkzeugleiste
  const toolbar = h('div', { class: 'ed-toolbar', role: 'toolbar', 'aria-label': 'Werkzeuge' });
  function toolIcon(t) {
    const s = svgEl('svg', { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    s.innerHTML = t.icon || TOOL_ICONS[t.form] || TOOL_ICONS.point;
    return s;
  }
  function toolButton(t, active, onClick, extra = '') {
    return h('button', { type: 'button', class: `ed-tool${active ? ' active' : ''}${extra}`, title: `${t.title || t.label}${t.key ? ` (${t.key.toUpperCase()})` : ''}`, 'aria-label': t.label, onclick: onClick },
      toolIcon(t), h('span', {}, t.label), t.key && t.key.length === 1 ? h('kbd', {}, t.key.toUpperCase()) : null);
  }
  function renderToolbar() {
    clear(toolbar);
    const ok = editable();
    toolbar.classList.toggle('readonly', !ok);
    toolbar.append(toolButton({ label: 'Auswahl', icon: TOOL_ICONS.select, key: 'esc', title: 'Auswählen und Eigenschaften bearbeiten; ziehen verschiebt' }, ed.tool === 'select', () => setTool('select')));
    toolbar.append(h('span', { class: 'ed-sep' }));
    for (const t of spec.tools || []) toolbar.append(toolButton(t, ed.tool === t.id, () => setTool(t.id)));
    if (spec.move || spec.remove) {
      toolbar.append(h('span', { class: 'ed-sep' }));
      const mv = canMoveSel(), del = canDeleteSel();
      if (spec.move) toolbar.append(toolButton({ label: 'Verschieben', icon: TOOL_ICONS.move, key: 'v', title: 'Auswahl verschieben (Basispunkt, dann Ziel)' }, ed.tool === '_move', () => startMove(false), mv ? ' action' : ' action dim'));
      if (spec.move && spec.canCopy) toolbar.append(toolButton({ label: 'Kopieren', icon: TOOL_ICONS.copy, key: 'c', title: 'Auswahl kopieren' }, ed.tool === '_copy', () => startMove(true), mv ? ' action' : ' action dim'));
      if (spec.remove) toolbar.append(toolButton({ label: 'Löschen', icon: TOOL_ICONS.trash, key: 'entf', title: 'Auswahl löschen (Entf)' }, false, () => removeSelection(), del ? ' action' : ' action dim'));
    }
  }
  ed.toolbar = toolbar;
  ed.renderToolbar = renderToolbar;

  // ------------------------------------------------------------ Schwebendes Fenster
  const panel = h('div', { class: 'ed-panel' });
  const pHead = h('div', { class: 'ed-panel-head' });
  const pTitle = h('b', {});
  const pBody = h('div', { class: 'ed-panel-body' });
  // Einklappen getrennt für Ruhezustand (Standard: eingeklappt) und Bearbeitung (Standard: offen)
  const panelState = () => (ed.cmd || ed.sel.length || ed.drag?.moved ? 'active' : 'idle');
  const isCollapsed = (st) => { const v = store.get(`panel.${st}`); return v === null ? st === 'idle' : v === '1'; };
  const applyCollapse = () => panel.classList.toggle('collapsed', isCollapsed(panelState()));
  const collapseBtn = button('', { icon: 'chevron', small: true, ghost: true, title: 'Ein-/ausklappen', onClick: () => { const st = panelState(); store.set(`panel.${st}`, isCollapsed(st) ? '0' : '1'); applyCollapse(); if (view.fitted && !view.userAdjusted) view.fit(); } });
  pHead.append(h('span', { class: 'ed-grip', 'aria-hidden': 'true' }, '⋮⋮'), pTitle, collapseBtn);
  panel.append(pHead, pBody);

  // verschiebbar
  (() => {
    let d = null;
    const pos = (() => { try { return JSON.parse(store.get('panelPos') || 'null'); } catch { return null; } })();
    if (pos) { panel.style.left = `${pos[0]}px`; panel.style.top = `${pos[1]}px`; }
    pHead.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      d = { x: e.clientX, y: e.clientY, l: panel.offsetLeft, t: panel.offsetTop };
      pHead.setPointerCapture(e.pointerId);
    });
    pHead.addEventListener('pointermove', (e) => {
      if (!d) return;
      const par = panel.parentElement.getBoundingClientRect();
      const l = Math.max(0, Math.min(par.width - 80, d.l + e.clientX - d.x));
      const t = Math.max(0, Math.min(par.height - 30, d.t + e.clientY - d.y));
      panel.style.left = `${l}px`; panel.style.top = `${t}px`;
    });
    pHead.addEventListener('pointerup', (e) => {
      if (d) {
        const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3;
        if (moved) store.set('panelPos', JSON.stringify([panel.offsetLeft, panel.offsetTop]));
        else if (!e.target.closest('button')) collapseBtn.click();
      }
      d = null;
    });
  })();
  ed.panel = panel;
  // Einpassen lässt den Platz des Fensters frei, solange es links oben steht und aufgeklappt ist
  view.insets = () => {
    if (!panel.isConnected || panel.classList.contains('collapsed') || panel.offsetLeft > view.width / 2) return {};
    return { rect: { x0: panel.offsetLeft, y0: panel.offsetTop, x1: panel.offsetLeft + panel.offsetWidth, y1: panel.offsetTop + panel.offsetHeight } };
  };

  let panelKey = '';
  let pendingSoft = false;
  panel.addEventListener('focusout', (e) => {
    if (pendingSoft && !panel.contains(e.relatedTarget)) { pendingSoft = false; setTimeout(() => refreshPanel(true), 0); }
  });
  /**
   * Baut das Fenster neu auf. soft: nur wenn gerade kein Feld im Fenster bearbeitet wird
   * (sonst nach Verlassen des Fensters) – so bleibt der Fokus beim Tabulieren erhalten.
   */
  function refreshPanel(force = false, soft = false) {
    if (!app.project) return;
    const ae = document.activeElement;
    if (soft && panel.contains(ae) && (ae instanceof HTMLInputElement || ae instanceof HTMLSelectElement || ae instanceof HTMLTextAreaElement)) { pendingSoft = true; return; }
    const key = JSON.stringify([ed.tool, ed.sel, ed.cmd?.kind, ed.cmd?.pts?.length, !!ed.cmd?.base, ed.bind?.text, ed.waiting?.kind || ed.waiting, ed.mode, ed.round, app.viewMode, editable()]);
    if (!force && key === panelKey) return;
    panelKey = key;
    applyCollapse();
    clear(pBody);
    if (ed.cmd || ed.drag?.moved) { commandPanel(); return; }
    if (ed.sel.length) {
      let info = null;
      try { info = spec.inspect?.(app, ed.sel.slice()); } catch (e) { console.error(e); info = { title: 'Auswahl', content: h('div', { class: 'note fail' }, e.message) }; }
      pTitle.textContent = info?.title || `${ed.sel.length} ausgewählt`;
      if (info?.content) pBody.append(...[].concat(info.content).filter(Boolean));
      const mv = canMoveSel(), del = canDeleteSel();
      if (editable() && (mv || del)) {
        pBody.append(h('div', { class: 'ed-actions' },
          mv ? button('Verschieben', { small: true, icon: 'fit', title: 'V – oder direkt in der Grafik ziehen', onClick: () => startMove(false) }) : null,
          mv && spec.canCopy ? button('Kopieren', { small: true, icon: 'copy', title: 'C', onClick: () => startMove(true) }) : null,
          del ? button('Löschen', { small: true, icon: 'trash', danger: true, title: 'Entf', onClick: () => removeSelection() }) : null));
      }
      return;
    }
    // Ruhezustand
    pTitle.textContent = editable() ? 'Raster, Fang & Hilfe' : 'Auswahl';
    const hint = spec.idleHint?.(app);
    if (hint) pBody.append(h('div', { class: 'ed-hint' }, hint));
    if (editable()) {
      const label = (g0) => { const t = fmt(g0, g0 < 0.01 ? 3 : g0 < 1 ? 2 : 0); return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t; };
      const gridOpts = (spec.grid || [0.01, 0.05, 0.1, 0.25, 0.5, 1]).map((g0) => ({ id: String(g0), label: label(g0) }));
      pBody.append(h('div', { class: 'ed-row' }, h('span', { class: 'muted small' }, `Raster [${unit}]`), segmented(gridOpts, String(ed.grid), (id) => { ed.grid = +id; store.set('grid', id); drawOverlay(); })));
      const cb = h('input', { type: 'checkbox', checked: ed.snapOn });
      cb.addEventListener('change', () => { ed.snapOn = cb.checked; store.set('snap', cb.checked ? '1' : '0'); });
      pBody.append(h('label', { class: 'ed-row ed-check' }, cb, 'Fang an Punkten, Linien und Raster (Alt: aus)'));
      pBody.append(keysHelp());
    }
  }
  ed.refreshPanel = refreshPanel;

  function keysHelp() {
    const [a1, a2] = axes.map((x) => x.toUpperCase());
    const rows = [
      ['Klick', 'wählen · Shift+Klick ergänzt · Rahmen ziehen'],
      ['Ziehen', 'Punkt/Element verschieben (mit Fang)'],
      [`${a1} / ${a2}`, 'an Achse binden (beim Zeichnen/Verschieben)'],
      ['M', 'Mitte zweier Punkte'],
      ['R', 'Bezugspunkt setzen'],
      ['P / S', 'parallel / senkrecht zu einer Linie'],
      ['Ziffern', 'Koordinaten tippen, Enter'],
      ['Esc', 'Schritt zurück'],
      ['Rechte Maus / Leertaste', 'Ansicht verschieben'],
    ];
    return h('details', { class: 'ed-keys' }, h('summary', {}, 'Tastenkürzel'), h('table', {}, rows.map(([k, t]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, t)))));
  }

  function commandPanel() {
    const c = ed.cmd;
    let q = '';
    if (ed.waiting === 'parallel') q = 'Linie anklicken, zu der parallel gezeichnet wird.';
    else if (ed.waiting === 'perp') q = 'Linie anklicken, zu der senkrecht gezeichnet wird.';
    else if (ed.waiting?.kind === 'mid') q = ed.waiting.first ? 'Zweiten Punkt der Mitte klicken.' : 'Ersten Punkt der Mitte klicken.';
    else if (ed.drag?.moved) q = 'Ziehen: Zielpunkt wählen und loslassen.';
    else if (c.kind === 'move') q = c.base ? `${c.copy ? 'Kopieren' : 'Verschieben'}: Zielpunkt wählen.` : `${c.copy ? 'Kopieren' : 'Verschieben'}: Basispunkt wählen.`;
    else if (c.kind === 'pick') q = c.tool.hint || 'Element anklicken.';
    else {
      const t = c.tool, n = c.pts.length;
      const prompts = t.prompts || {};
      if (t.form === 'point') q = prompts[0] || 'Punkt setzen.';
      else if (t.form === 'line' || t.form === 'chain') q = n ? (prompts[1] || 'Endpunkt setzen.') : (prompts[0] || 'Anfangspunkt setzen.');
      else if (t.form === 'rect') q = n ? 'Gegenüberliegende Ecke setzen.' : 'Erste Ecke setzen.';
      else if (t.form === 'polygon') q = n < 3 ? `Punkt ${n + 1} setzen.` : 'Weitere Punkte – Enter oder Klick auf den ersten Punkt schliesst.';
      else q = n < 2 ? `Punkt ${n + 1} setzen.` : 'Weitere Punkte – Enter oder Doppelklick beendet.';
    }
    pTitle.textContent = c?.kind === 'create' ? c.tool.label : c?.kind === 'move' ? (c.copy ? 'Kopieren' : 'Verschieben') : c?.kind === 'pick' ? c.tool.label : 'Verschieben';
    pBody.append(h('div', { class: 'ed-prompt' }, q));
    if (c?.kind === 'pick') {
      // zuletzt gesetztes Element gleich bearbeiten können, Werkzeug bleibt aktiv
      if (ed.sel.length) {
        let info = null;
        try { info = spec.inspect?.(app, ed.sel.slice()); } catch (e) { console.error(e); }
        if (info?.content) pBody.append(h('div', { class: 'ed-sub' }, info.title || 'Zuletzt gesetzt'), ...[].concat(info.content).filter(Boolean));
      }
      pBody.append(h('div', { class: 'muted small' }, 'Weiter anklicken setzt weitere Elemente · Esc beendet das Werkzeug'));
      return;
    }
    // Koordinatenfelder
    const bl = bindLine();
    const names = bl ? ['Abstand', null] : { rel: [`Δ${axes[0]}`, `Δ${axes[1]}`], abs: [axes[0], axes[1]], polar: ['L', 'α'] }[ed.mode];
    const units = bl ? [unit, null] : ed.mode === 'polar' ? [unit, '°'] : [unit, unit];
    const fields = h('div', { class: 'ed-coords' });
    names.forEach((nm, i) => {
      if (!nm) return;
      const inp = h('input', { class: 'num', inputmode: 'decimal', value: ed.typed[i], placeholder: '–' });
      inp.addEventListener('input', () => { ed.typed[i] = inp.value; drawOverlay(); });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); ed.typed[i] = inp.value; applyTyped(); refreshPanel(true); }
        else if (e.key === 'Tab') { /* Standard: nächstes Feld */ }
      });
      fields.append(h('label', {}, h('span', {}, nm), inp, h('small', {}, units[i])));
    });
    pBody.append(fields);
    if (!bl) {
      pBody.append(segmented([{ id: 'rel', label: 'relativ' }, { id: 'abs', label: 'absolut' }, { id: 'polar', label: 'L / α' }], ed.mode, (id) => { ed.mode = id; clearTyped(); refreshPanel(true); }));
    }
    // Hilfen als Knöpfe (für Maus und Touch)
    const [a1, a2] = axes;
    const chip = (k, txt, on, act) => h('button', { type: 'button', class: `ed-chip${on ? ' on' : ''}`, title: txt, onclick: act }, h('kbd', {}, k), txt);
    const toggleAxis = (r, nm) => () => {
      if (ed.bind?.kind === 'axis' && ed.bind.r[0] === r[0]) ed.bind = null;
      else { if (!ed.ref && ed.snap) ed.ref = ed.snap.p; ed.bind = { kind: 'axis', r, text: `entlang ${nm}` }; }
      clearTyped(); refreshPanel(true); drawOverlay();
    };
    pBody.append(h('div', { class: 'ed-chips' },
      chip(a1.toUpperCase(), `entlang ${a1}`, ed.bind?.kind === 'axis' && ed.bind.r[0] === 1, toggleAxis([1, 0], a1)),
      chip(a2.toUpperCase(), `entlang ${a2}`, ed.bind?.kind === 'axis' && ed.bind.r[1] === 1, toggleAxis([0, 1], a2)),
      chip('M', 'Mitte', ed.waiting?.kind === 'mid', () => { ed.waiting = ed.waiting?.kind === 'mid' ? null : { kind: 'mid', first: null }; refreshPanel(true); }),
      chip('P', 'parallel', ed.waiting === 'parallel' || ed.bind?.kind === 'parallel', () => { if (!ed.ref && ed.snap) ed.ref = ed.snap.p; ed.waiting = 'parallel'; refreshPanel(true); }),
      chip('S', 'senkrecht', ed.waiting === 'perp' || ed.bind?.kind === 'perp', () => { if (!ed.ref && ed.snap) ed.ref = ed.snap.p; ed.waiting = 'perp'; refreshPanel(true); })));
    if (ed.bind) pBody.append(h('div', { class: 'ed-bindinfo' }, `Bindung: ${ed.bind.text}`, button('', { icon: 'close', small: true, ghost: true, title: 'Bindung lösen', onClick: () => { ed.bind = null; refreshPanel(true); drawOverlay(); } })));
    if (ed.ref) pBody.append(h('div', { class: 'ed-refinfo muted small' }, `Bezugspunkt: ${axes[0]} = ${fmt(ed.ref[0], digits)}, ${axes[1]} = ${fmt(ed.ref[1], digits)} ${unit}`));
    if (c?.kind === 'create' && ['polygon', 'polyline'].includes(c.tool.form) && c.pts.length >= (c.tool.form === 'polygon' ? 3 : 2)) {
      pBody.append(button(c.tool.form === 'polygon' ? 'Polygon schliessen' : 'Fertig', { small: true, primary: true, icon: 'check', onClick: () => finishCreate() }));
    }
  }

  function updateTipCoords() { /* Koordinaten erscheinen am Zeiger */ }

  function updateHint() {
    const [a1, a2] = axes.map((x) => x.toUpperCase());
    let t;
    if (ed.cmd || ed.drag?.moved) t = `${a1}/${a2} Achse · M Mitte · R Bezugspunkt · P/S parallel/senkrecht · Shift orthogonal · Alt ohne Fang · Ziffern tippen · Esc zurück`;
    else if (ed.sel.length) t = editable() ? 'Ziehen oder V verschiebt · Entf löscht · Shift+Klick ergänzt · Esc hebt Auswahl auf' : 'Esc hebt Auswahl auf';
    else t = editable() ? 'Klick wählt · Rahmen ziehen wählt mehrere · Werkzeug oben wählen · Rechte Maustaste/Leertaste: Ansicht verschieben' : '';
    app.setHint?.(t);
  }
  ed.updateHint = updateHint;

  // nach jedem Neuzeichnen der Ansicht
  ed.afterRender = () => {
    ed.invalidate();
    const g = geom();
    const all = new Set([...g.points.map((p) => p.id), ...g.segments.map((s) => s.id), ...g.regions.map((r) => r.id)]);
    const before = ed.sel.length;
    ed.sel = ed.sel.filter((id) => all.has(id));
    if (ed.sel.length !== before) refreshPanel(true);
    renderToolbar();
    drawOverlay();
  };
  ed.onModeChange = () => {
    if (!editable() && ed.cmd) { ed.cmd = null; ed.tool = 'select'; clearAids(); }
    renderToolbar();
    refreshPanel(true);
    updateHint();
  };

  renderToolbar();
  refreshPanel(true);
  updateHint();
  return ed;
}

const TOOL_ICONS = {
  select: '<path d="M5 3l14 8-6.5 1.5L9 19z"/>',
  point: '<circle cx="12" cy="12" r="3.2" fill="currentColor"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
  line: '<circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="M6.5 17.5l11-11"/>',
  chain: '<circle cx="4" cy="19" r="1.8"/><circle cx="12" cy="7" r="1.8"/><circle cx="20" cy="17" r="1.8"/><path d="M5 17.5l6-9M13 8.5l6 7"/>',
  polyline: '<path d="M3 18l5-7 5 4 8-9"/><circle cx="3" cy="18" r="1.5"/><circle cx="21" cy="6" r="1.5"/>',
  polygon: '<path d="M4 18l3-12 10 2 3 10z"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  pick: '<path d="M9 11V5a2 2 0 0 1 4 0v6M13 11V9a2 2 0 0 1 4 0v4a7 7 0 0 1-7 7 6 6 0 0 1-5-3l-2-4a1.6 1.6 0 0 1 2.7-1.6L9 14"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  support: '<path d="M12 5v6M6 18l6-7 6 7z"/><path d="M4 21h16"/>',
  load: '<path d="M4 4h16M6 4v9M12 4v9M18 4v9M4 11l2 3 2-3M10 11l2 3 2-3M16 11l2 3 2-3"/><path d="M3 19h18"/>',
  pointload: '<path d="M12 3v13M8 12l4 5 4-5"/><path d="M4 20h16"/>',
  hinge: '<circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/>',
  layer: '<path d="M3 8h18M3 14h18"/><path d="M3 20h18" stroke-dasharray="2 2"/>',
  bar: '<circle cx="12" cy="12" r="4" fill="currentColor"/>',
  opening: '<rect x="4" y="4" width="16" height="16" rx="1"/><rect x="9" y="9" width="6" height="6" stroke-dasharray="2 1.5"/>',
  column: '<rect x="8" y="8" width="8" height="8"/><path d="M12 3v5M12 16v5"/>',
  wall: '<path d="M3 12h18" stroke-width="3.5"/>',
  water: '<path d="M3 10c2-2 4 2 6 0s4 2 6 0 4 2 6 0M3 15h18"/><path d="M12 4l-2 3h4z"/>',
};
export { TOOL_ICONS };
