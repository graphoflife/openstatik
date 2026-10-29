// Grafische Bearbeitung Geotechnik: Werkzeuge je Analyseart, anklickbare Geometrie (aus der gezeichneten
// Szene, draw.js), Ziehen von Schichtgrenzen und Griffen, Eigenschaftsfenster.
//
// IDs:  Z:k Zone (Index in project.soil.zones), Z:b Untergrund   E:k:i Kante, V:k:i Ecke, X:k:i:e Grenzende am Bildrand
//       GW Grundwasserspiegel
//       ep:wall/top/surf/surfEnd Wand und Gelände (Erddruck)   ld:k Streifen-/Linienlast
//       f:foot/col/edge/plan/corner Fundament (Grundbruch, Setzung)   g:surf Gelände
//       s:i / ss:i:j Geländepunkte/-abschnitte   w:i / ws:i:j Wasserspiegel   q Auflast   grid Suchraster
//       w:stem/base/key/surf, h:… Griffe der Stützmauer
import { h, numField, selectField, textField, checkField, button, kvTable, fmt, note, rich, subHtml } from '../../js/core/ui.js';
import { TOOL_ICONS } from '../../js/core/editor.js';
import { scene, markEdit } from './draw.js';
import { SOIL_PRESETS } from './examples.js';
import { rad, deg, soilColor } from './soil.js';
import { splitRing, clipSegToRing, FAR } from './ground.js';

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const parse = (id) => String(id).split(':');
const fobj = (p) => (p.analysis === 'setzung' ? p.st : p.bc);

let lastApp = null;
const cur = () => (lastApp || globalThis.openstatik)?.project?.analysis || 'erddruck';

const ICON_WALL = '<path d="M9 3h5v18H9z"/><path d="M14 8h7M14 13h7M14 18h7" stroke-dasharray="2 2"/>';
const ICON_FOOT = '<path d="M11 3v8h2V3"/><rect x="5" y="11" width="14" height="5" rx="1"/><path d="M2 20h20" stroke-dasharray="2 2"/>';
const ICON_LWALL = '<path d="M9 3h4v13h8v4H4v-4h5z"/>';
const ICON_INSERT = '<path d="M3 17l6-8 6 5 6-8"/><circle cx="12" cy="11.5" r="2.4" fill="currentColor"/><path d="M12 3v3M12 17v4"/>';
const ICON_GRID = '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="2 2"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/>';
const ICON_KEY = '<path d="M3 9h18v4H3z"/><path d="M13 13v6h4v-6"/>';
const ICON_SPLIT = '<path d="M3 7h18M3 17h18" opacity=".55"/><path d="M3 15l7-5 4 3 7-5" stroke-dasharray="2.5 2"/><circle cx="6" cy="5" r="1.6"/><circle cx="6" cy="19" r="1.6"/>';

const T = {
  zone: { id: 'zone', label: 'Schicht', key: 'l', form: 'polygon', icon: TOOL_ICONS.polygon, title: 'Schicht als Fläche zeichnen: Ecken anklicken (fängt an vorhandenen Ecken und Grenzen), Klick auf den ersten Punkt oder Doppelklick schliesst', prompts: ['Erste Ecke der Schicht anklicken.', 'Nächste Ecke – Klick auf den ersten Punkt oder Doppelklick schliesst.'] },
  split: { id: 'split', label: 'Teilen', key: 'j', form: 'polyline', icon: ICON_SPLIT, title: 'Schichten entlang einer Linie teilen: Punkte anklicken, Doppelklick oder Enter beendet (die Linie wird seitlich waagrecht verlängert)', prompts: ['Anfang der Trennlinie anklicken.', 'Nächster Punkt – Doppelklick/Enter beendet.'] },
  gw: { id: 'gw', label: 'Wasserspiegel', key: 'w', form: 'point', icon: TOOL_ICONS.water, title: 'Höhe des Grundwasserspiegels anklicken', prompts: ['Höhe des Grundwasserspiegels anklicken.'] },
  wall: { id: 'wall', label: 'Wand', key: 'n', form: 'line', icon: ICON_WALL, title: 'Wandrückseite zeichnen: Wandkopf und Wandfuss anklicken (Höhe H und Neigung α)', prompts: ['Wandkopf anklicken.', 'Wandfuss anklicken.'] },
  strip: { id: 'strip', label: 'Streifenlast', key: 'q', form: 'rect', icon: TOOL_ICONS.load, title: 'Streifenlast: Anfang und Ende auf dem Gelände anklicken (Breite b, Abstand a ab Wandkopf)', prompts: ['Beginn der Streifenlast anklicken.', 'Ende der Streifenlast anklicken.'] },
  line: { id: 'lineload', label: 'Linienlast', key: 'k', form: 'point', icon: TOOL_ICONS.pointload, title: 'Linienlast: Lage auf dem Gelände anklicken', prompts: ['Lage der Linienlast anklicken.'] },
  foot: { id: 'foot', label: 'Fundament', key: 'f', form: 'rect', icon: ICON_FOOT, title: 'Fundament im Schnitt: zwei gegenüberliegende Ecken anklicken (Breite B, Sohltiefe D, Dicke t)', prompts: ['Erste Ecke des Fundaments anklicken.', 'Gegenüberliegende Ecke anklicken (Unterkante = Sohle).'] },
  terrain: { id: 'terrain', label: 'Gelände', key: 'g', form: 'polyline', icon: TOOL_ICONS.polyline, title: 'Geländelinie neu zeichnen: Punkte anklicken, Doppelklick oder Enter beendet (ersetzt die bestehende Linie)', prompts: ['Ersten Geländepunkt anklicken.', 'Nächsten Punkt anklicken – Doppelklick/Enter beendet.'] },
  waterLine: { id: 'waterline', label: 'Wasserspiegel', key: 'w', form: 'polyline', icon: TOOL_ICONS.water, title: 'Sickerlinie zeichnen: Punkte anklicken, Doppelklick oder Enter beendet', prompts: ['Ersten Punkt des Wasserspiegels anklicken.', 'Nächsten Punkt – Doppelklick/Enter beendet.'] },
  insert: { id: 'insert', label: 'Punkt einfügen', key: 'i', form: 'pick', pick: ['segment'], icon: ICON_INSERT, title: 'Auf die Gelände- oder Wasserspiegellinie klicken: dort einen Punkt einfügen', hint: 'Gelände- oder Wasserspiegellinie anklicken.' },
  surcharge: { id: 'surcharge', label: 'Auflast', key: 'q', form: 'line', icon: TOOL_ICONS.load, title: 'Auflast: Anfang und Ende auf dem Gelände anklicken', prompts: ['Beginn der Auflast anklicken.', 'Ende der Auflast anklicken.'] },
  grid: { id: 'grid', label: 'Suchraster', key: 'u', form: 'rect', icon: ICON_GRID, title: 'Bereich der Kreismittelpunkte aufziehen (schaltet das automatische Raster aus)', prompts: ['Erste Ecke des Suchrasters anklicken.', 'Gegenüberliegende Ecke anklicken.'] },
  lwall: { id: 'lwall', label: 'Mauer', key: 'n', form: 'line', icon: ICON_LWALL, title: 'Winkelstützmauer: Vorderkante Fundament unten, dann Mauerkrone anklicken (Proportionen werden vorgeschlagen)', prompts: ['Vorderkante des Fundaments (unten) anklicken.', 'Mauerkrone anklicken.'] },
  key: { id: 'key', label: 'Sporn', key: 'o', form: 'point', icon: ICON_KEY, title: 'Sporn unter der Sohle: Lage unter der Fundamentplatte anklicken (nochmals = entfernen über «Löschen»)', prompts: ['Lage des Sporns unter der Sohle anklicken.'] },
};

const TOOLS = {
  erddruck: [T.wall, T.zone, T.split, T.gw, T.strip, T.line],
  grundbruch: [T.foot, T.zone, T.split, T.gw],
  setzung: [T.foot, T.zone, T.split, T.gw],
  boeschung: [T.terrain, T.zone, T.split, T.waterLine, T.insert, T.surcharge, T.grid],
  stuetzmauer: [T.lwall, T.zone, T.split, T.gw, T.key],
};

const after = (app, panel) => () => { markEdit(); app.changed({ inputs: true }); if (panel) app.editor?.refreshPanel(true); };

export const editorSpec = {
  axes: ['x', 'y'],
  unit: 'm',
  digits: 3,
  grid: [0.05, 0.1, 0.25, 0.5, 1],
  gridDefault: 0.25,
  modes: ['ep', 'wedge', 'bc', 'plan', 'mech', 'bulb', 'profile', 'trough', 'crit', 'grid', 'wall', 'forces'],
  canCopy: false,
  get tools() { return TOOLS[cur()] || TOOLS.erddruck; },

  geometry(app) {
    lastApp = app;
    const points = [], segments = [], regions = [];
    if (!scene.key.startsWith(`${app.project.analysis}|`)) return { points, segments, regions };
    for (const it of scene.items) {
      if (it.type === 'point') points.push({ id: it.id, p: it.p, label: it.label, movable: it.movable });
      else if (it.type === 'segment') segments.push({ id: it.id, a: it.a, b: it.b, label: it.label });
      else regions.push({ id: it.id, ring: it.ring, label: it.label, movable: it.movable });
    }
    return { points, segments, regions };
  },

  create(app, tool, pts) {
    const p = app.project;
    const zOf = scene.zOfY || ((y) => -y);
    if (tool === 'zone') return createZone(app, pts);
    if (tool === 'split') return splitZones(app, pts);
    if (tool === 'gw') {
      const z = r2(zOf(pts[0][1]));
      p.soil.gw.on = true; p.soil.gw.z = z;
      if (p.analysis === 'erddruck') p.ep.water = true;
      if (p.analysis === 'stuetzmauer') p.rw.water = true;
      markEdit();
      app.status(`Grundwasserspiegel in ${fmt(z, 2)} m Tiefe`, 'ok');
      return ['GW'];
    }
    if (tool === 'wall') {
      const [a, b] = pts[0][1] >= pts[1][1] ? pts : [pts[1], pts[0]];
      const H = r2(a[1] - b[1]);
      if (H < 0.1) { app.status('Wandkopf und Wandfuss müssen übereinander liegen (Höhe > 0).', 'warn'); return null; }
      p.ep.H = H;
      p.ep.alpha = r2(clamp(deg(Math.atan((b[0] - a[0]) / H)), -45, 45));
      app.status(`Wand H = ${fmt(H, 2)} m, α = ${fmt(p.ep.alpha, 1)}°`, 'ok');
      return ['ep:wall'];
    }
    if (tool === 'strip' || tool === 'lineload') {
      const xTop = scene.info.xTop ?? 0;
      const xs = pts.map((q) => q[0]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const ld = tool === 'strip' ? { type: 'strip', p: 10, a: r2(Math.max(0, x0 - xTop)), b: r2(Math.max(0.1, x1 - x0)) } : { type: 'line', p: 10, a: r2(Math.max(0, x0 - xTop)), b: 0 };
      p.ep.loads.push(ld);
      markEdit();
      app.status(`${tool === 'strip' ? 'Streifenlast' : 'Linienlast'} 10 ${tool === 'strip' ? 'kN/m²' : 'kN/m'} gesetzt – Wert im Eigenschaftsfenster anpassen`, 'ok');
      return [`ld:${p.ep.loads.length - 1}`];
    }
    if (tool === 'foot') {
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const B = r2(Math.max(...xs) - Math.min(...xs));
      const yB = Math.min(...ys), yT = Math.max(...ys);
      if (B < 0.1) { app.status('Das Fundament braucht eine Breite > 0.1 m.', 'warn'); return null; }
      const f = fobj(p);
      f.B = B;
      f.D = r2(Math.max(0, -yB));
      if (p.analysis === 'grundbruch') f.t = r2(Math.max(0.1, f.D > 0 ? Math.min(yT - yB, f.D) : yT - yB));
      if (f.shape === 'rect' && !(Number(f.L) >= B)) f.L = B;
      app.status(`Fundament B = ${fmt(B, 2)} m, Sohltiefe D = ${fmt(f.D, 2)} m${p.analysis === 'grundbruch' ? ' – Lasten im Eigenschaftsfenster eingeben' : ''}`, 'ok');
      return [p.analysis === 'grundbruch' ? 'f:col' : 'f:foot'];
    }
    if (tool === 'terrain') {
      const s = sortPts(pts);
      if (s.length < 2) return null;
      p.sl.surface.splice(0, p.sl.surface.length, ...s);
      if (!(+p.sl.q.p)) { p.sl.q.x1 = s[0].x; p.sl.q.x2 = s[0].x; }
      app.status(`Geländelinie mit ${s.length} Punkten`, 'ok');
      return [];
    }
    if (tool === 'waterline') {
      const s = sortPts(pts);
      p.sl.water.splice(0, p.sl.water.length, ...s);
      p.sl.waterMode = 'line';
      markEdit();
      app.status(`Wasserspiegel mit ${s.length} Punkten`, 'ok');
      return [];
    }
    if (tool === 'surcharge') {
      const xs = pts.map((q) => q[0]);
      p.sl.q.x1 = r2(Math.min(...xs)); p.sl.q.x2 = r2(Math.max(...xs));
      if (!(+p.sl.q.p > 0)) p.sl.q.p = 10;
      markEdit();
      app.status(`Auflast q = ${fmt(+p.sl.q.p, 1)} kN/m² von x = ${fmt(p.sl.q.x1, 2)} bis ${fmt(p.sl.q.x2, 2)} m`, 'ok');
      return ['q'];
    }
    if (tool === 'grid') {
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const g = p.sl.grid;
      Object.assign(g, { auto: false, x0: r2(Math.min(...xs)), x1: r2(Math.max(...xs)), y0: r2(Math.min(...ys)), y1: r2(Math.max(...ys)) });
      g.nx = g.nx || 12; g.ny = g.ny || 12; g.nr = g.nr || 12;
      if (app.viewMode !== 'grid') app.setViewMode?.('grid');
      markEdit();
      return ['grid'];
    }
    if (tool === 'lwall') {
      const [lo, hi] = pts[0][1] <= pts[1][1] ? pts : [pts[1], pts[0]];
      const H = r2(hi[1] - lo[1]);
      if (H < 0.8) { app.status('Die Mauer sollte mindestens 0.8 m hoch sein.', 'warn'); return null; }
      const d = r2(Math.max(0.3, H / 10)), tTop = r2(Math.max(0.2, H / 20)), tBot = r2(Math.max(tTop, H / 12));
      const B = r2(0.7 * H), toe = r2(0.2 * B);
      Object.assign(p.rw, { hs: r2(H - d), d, tTop, tBot, toe, heel: r2(Math.max(0.2, B - toe - tBot)), Df: r2(Math.min(H, d + 0.4)) });
      app.status(`Winkelstützmauer H = ${fmt(H, 2)} m, B = ${fmt(toe + tBot + p.rw.heel, 2)} m – Griffe ziehen zum Anpassen`, 'ok');
      return ['w:stem'];
    }
    if (tool === 'key') {
      const g = scene.info.g;
      if (!g) return null;
      const k = p.rw.key;
      k.on = true; k.width = k.width || 0.4; k.depth = k.depth || 0.4;
      k.x = r2(clamp(pts[0][0] - k.width / 2, 0, g.B - k.width));
      markEdit();
      return ['w:key'];
    }
    return null;
  },

  pick(app, tool, hit) {
    const p = app.project;
    if (tool === 'insert' && hit.type === 'segment') {
      const [t] = parse(hit.id);
      const arr = t === 'ss' ? p.sl.surface : t === 'ws' ? p.sl.water : null;
      if (!arr) { app.status('Bitte die Gelände- oder Wasserspiegellinie anklicken.', 'warn'); return null; }
      const pt = { x: r3(hit.q[0]), y: r3(hit.q[1]) };
      arr.push(pt);
      arr.sort((a, b) => a.x - b.x);
      markEdit();
      return [`${t === 'ss' ? 's' : 'w'}:${arr.indexOf(pt)}`];
    }
    return null;
  },

  move(app, ids, d) {
    const p = app.project;
    const [dx, dy] = d;
    markEdit();
    const out = [];
    const done = new Set();
    for (const id of ids) {
      const [t, a, b] = parse(id);
      if (t === 'Z' && a !== 'b') moveZone(p, +a, dx, dy);
      else if (t === 'V' && !done.has(vkey(p, a, b))) { done.add(vkey(p, a, b)); moveVertex(p, +a, +b, dx, dy); }
      else if (t === 'E') moveEdge(p, +a, +b, dx, dy, done);
      else if (t === 'X') { const nid = moveCrossing(p, +a, +b, +parse(id)[3], dx, dy); if (nid) { out.push(nid); continue; } }
      else if (t === 'GW') p.soil.gw.z = r3(+p.soil.gw.z - dy);
      else if (t === 'ep') moveEP(p, a, dx, dy);
      else if (t === 'ld') { const ld = p.ep.loads[+a]; if (ld) ld.a = r2(Math.max(0, +ld.a + dx)); }
      else if (t === 'f') moveFooting(p, a, dx, dy);
      else if (t === 's' || (t === 'w' && /^\d+$/.test(a))) { const arr = t === 's' ? p.sl.surface : p.sl.water; const pt = arr[+a]; if (pt) { pt.x = r3(+pt.x + dx); pt.y = r3(+pt.y + dy); arr.sort((u, v) => u.x - v.x); out.push(`${t}:${arr.indexOf(pt)}`); continue; } }
      else if (t === 'ss' || t === 'ws') {
        const arr = t === 'ss' ? p.sl.surface : p.sl.water;
        for (const k of [+a, +b]) { const pt = arr[k]; if (pt) { pt.x = r3(+pt.x + dx); pt.y = r3(+pt.y + dy); } }
        arr.sort((u, v) => u.x - v.x);
      } else if (t === 'q') { p.sl.q.x1 = r2(+p.sl.q.x1 + dx); p.sl.q.x2 = r2(+p.sl.q.x2 + dx); }
      else if (t === 'grid') moveGrid(app, dx, dy);
      else if (t === 'h' || (t === 'w' && a === 'key')) moveWall(p, t === 'w' ? 'key' : a, dx, dy);
      out.push(id);
    }
    return out;
  },

  remove(app, ids) {
    const p = app.project;
    const layerIdx = [], loadIdx = [], sIdx = [], wIdx = [];
    for (const id of ids) {
      const [t, a, b] = parse(id);
      if (t === 'Z' && a !== 'b') layerIdx.push(+a);
      else if (t === 'V') removeVertex(app, +a, +b);
      else if (t === 'GW') p.soil.gw.on = false;
      else if (t === 'ld') loadIdx.push(+a);
      else if (t === 's') sIdx.push(+a);
      else if (t === 'w' && /^\d+$/.test(a)) wIdx.push(+a);
      else if (t === 'q') p.sl.q.p = 0;
      else if (t === 'grid') p.sl.grid.auto = true;
      else if ((t === 'w' || t === 'h') && a === 'key') p.rw.key.on = false;
      else app.status('Dieses Element ist Teil der Geometrie und kann nicht gelöscht werden – Masse im Eigenschaftsfenster ändern.', 'warn');
    }
    const desc = (arr) => [...new Set(arr)].sort((x, y) => y - x);
    for (const i of desc(layerIdx)) p.soil.zones.splice(i, 1);
    for (const i of desc(loadIdx)) p.ep.loads.splice(i, 1);
    for (const i of desc(sIdx)) if (p.sl.surface.length > 2) p.sl.surface.splice(i, 1);
    for (const i of desc(wIdx)) p.sl.water.splice(i, 1);
    if (p.sl.waterMode === 'line' && p.sl.water.length < 2) p.sl.waterMode = 'none';
    markEdit();
  },

  inspect(app, ids) {
    if (ids.length !== 1) return { title: `${ids.length} Elemente`, content: [h('div', { class: 'muted small' }, 'Mehrere Elemente gewählt. Einzeln anklicken, um Werte zu bearbeiten; «Löschen» entfernt Lasten, Schichten und Punkte.')] };
    const p = app.project;
    const [t, a] = parse(ids[0]);
    if (t === 'Z' && a === 'b') return inspectBase(app);
    if (t === 'Z' || t === 'E' || t === 'V' || t === 'X') return inspectZone(app, +a, t);
    if (t === 'GW') return inspectWater(app);
    if (t === 'ep') return inspectEPWall(app);
    if (t === 'ld') return inspectLoad(app, +a);
    if (t === 'f' || (t === 'g' && p.analysis !== 'boeschung')) return inspectFooting(app, a);
    if (t === 's' || (t === 'w' && /^\d+$/.test(a))) return inspectPoint(app, t, +a);
    if (t === 'ss' || t === 'ws') return { title: t === 'ss' ? 'Geländelinie' : 'Wasserspiegel', content: [h('div', { class: 'muted small' }, 'Ziehen verschiebt den Abschnitt. Mit dem Werkzeug «Punkt einfügen» (I) entsteht an der angeklickten Stelle ein neuer Punkt.')] };
    if (t === 'q') return inspectSurcharge(app);
    if (t === 'grid') return inspectGrid(app);
    if (t === 'w' || t === 'h') return a === 'surf' || a === 'surfEnd' ? inspectBackfill(app) : inspectWall(app);
    return null;
  },

  idleHint(app) {
    const p = app.project, a = p.analysis;
    if (scene.empty) {
      const first = { erddruck: ['Wand', 'N', 'Wandkopf und Wandfuss anklicken'], grundbruch: ['Fundament', 'F', 'zwei Ecken des Fundaments im Schnitt anklicken'], setzung: ['Fundament', 'F', 'zwei Ecken des Fundaments im Schnitt anklicken'], boeschung: ['Gelände', 'G', 'die Geländepunkte von links nach rechts anklicken, Doppelklick beendet'], stuetzmauer: ['Mauer', 'N', 'zuerst die Vorderkante des Fundaments unten, dann die Mauerkrone anklicken'] }[a];
      return h('span', {}, 'Werkzeug ', h('b', {}, first[0]), ` (Taste ${first[1]}) wählen und ${first[2]}. Boden: Fläche anklicken; «Schicht» (L) zeichnet eine Schicht als Polygon, «Teilen» (J) trennt entlang einer Linie.`);
    }
    const extra = {
      erddruck: 'Den Wandkopf ziehen ändert Höhe und Neigung, das Geländeende die Geländeneigung β.',
      grundbruch: 'Die Fundamentecke ziehen ändert Breite und Tiefe; die Stütze anklicken, um Lasten einzugeben.',
      setzung: 'Die Fundamentecke ziehen ändert Breite und Tiefe; das Fundament anklicken für die Belastung.',
      boeschung: 'Geländepunkte und Wasserspiegel ziehen; das Suchraster (Darstellung «Suchraster F») lässt sich verschieben.',
      stuetzmauer: 'Die Griffe an Krone, Zehe, Ferse und Sohle ziehen; Mauer oder Hinterfüllung anklicken für alle Masse.',
    }[a];
    return h('span', {}, 'Schicht anklicken: Bodenart und Kennwerte. Grenzen, Ecken und die Grenzenden am Rand ziehen (neigen); «Schicht» (L) zeichnet eine Fläche, «Teilen» (J) trennt entlang einer Linie. ', extra);
  },
};

// ------------------------------------------------------------------ Änderungen

function sortPts(pts) {
  const s = pts.map((q) => ({ x: r3(q[0]), y: r3(q[1]) })).sort((a, b) => a.x - b.x);
  const out = [];
  for (const q of s) if (!out.length || Math.abs(q.x - out[out.length - 1].x) > 1e-6) out.push(q);
  return out;
}

// ------------------------------------------------------------------ Zonen (frei geformte Schichten)

const I = (t) => (t ? String(t).split(/(<[^>]+>)/).map((x) => (x.startsWith('<') ? x : subHtml(x))).join('') : t);
const relPt = (P) => [r3(P[0]), r3(P[1] - (scene.ref || 0))];
const near = (p, q, tol = 1e-6) => Math.abs(p[0] - q[0]) < tol && Math.abs(p[1] - q[1]) < tol;
const vkey = (p, k, i) => { const v = p.soil.zones[+k]?.ring[+i]; return v ? `${v[0].toFixed(6)},${v[1].toFixed(6)}` : `${k}:${i}`; };

/** Neue Bodenart (Kennwerte wie Untergrund, nächster Darstellungsstil). */
export function newSoil(p, over = {}) {
  const n = p.soil.soils.length;
  const b = p.soil.soils[p.soil.base ?? 0] || {};
  return { name: `Boden ${n + 1}`, gamma: b.gamma ?? 20, gammaP: b.gammaP ?? 10, phi: b.phi ?? 30, c: b.c ?? 0, cu: b.cu ?? 0, ME: b.ME ?? 20, dr: b.dr ?? 2 / 3, ...over, col: (n % 8) + 1 };
}

function createZone(app, pts) {
  const p = app.project, sl = p.soil;
  const ring = pts.map(relPt);
  let soil = sl.active;
  if (!(Number.isInteger(soil) && soil !== sl.base && sl.soils[soil])) { sl.soils.push(newSoil(p)); soil = sl.soils.length - 1; }
  sl.active = soil;
  sl.zones.push({ soil, ring });
  markEdit();
  app.status(`Fläche ${sl.zones.length} mit ${ring.length} Ecken – Bodenart im Eigenschaftsfenster wählen`, 'ok');
  return [`Z:${sl.zones.length - 1}`];
}

function splitZones(app, pts) {
  const p = app.project, sl = p.soil;
  const line = pts.map(relPt);
  if (line.length < 2) return null;
  let n = 0;
  for (let k = sl.zones.length - 1; k >= 0; k--) {
    const r = splitRing(sl.zones[k].ring, line);
    if (!r) continue;
    sl.zones[k].ring = r[0].map((q) => [r3(q[0]), r3(q[1])]);
    sl.zones.splice(k + 1, 0, { soil: sl.zones[k].soil, ring: r[1].map((q) => [r3(q[0]), r3(q[1])]) });
    n++;
  }
  markEdit();
  if (!n) {
    // Untergrund teilen: der Bereich unter der Linie wird eine neue Schicht
    const l = line.slice().sort((u, v) => u[0] - v[0]);
    sl.soils.push(newSoil(p));
    sl.zones.push({ soil: sl.soils.length - 1, ring: [[-4 * FAR, l[0][1]], ...l, [4 * FAR, l[l.length - 1][1]], [4 * FAR, -FAR], [-4 * FAR, -FAR]] });
    sl.active = sl.soils.length - 1;
    app.status('Neue Schicht unterhalb der Linie – Bodenart im Eigenschaftsfenster wählen', 'ok');
    return [`Z:${sl.zones.length - 1}`];
  }
  app.status(`${n} Fläche${n === 1 ? '' : 'n'} geteilt – Teilflächen anklicken, um die Bodenart zu wählen`, 'ok');
  return [];
}

/** Alle Zonenecken an der Stelle P (relativ) verschieben – gemeinsame Grenzen bleiben verbunden. */
function moveVertexAt(p, P, dx, dy) {
  for (const z of p.soil.zones) for (const q of z.ring) if (near(q, P)) { q[0] = r3(q[0] + dx); q[1] = r3(q[1] + dy); }
}
function moveVertex(p, k, i, dx, dy) {
  const v = p.soil.zones[k]?.ring[i];
  if (v) moveVertexAt(p, v.slice(), dx, dy);
}
function moveEdge(p, k, i, dx, dy, done) {
  const r = p.soil.zones[k]?.ring;
  if (!r) return;
  const a = r[i].slice(), b = r[(i + 1) % r.length].slice();
  if (Math.abs(b[1] - a[1]) < 0.05 * Math.abs(b[0] - a[0])) dx = 0; // waagrechte Grenze: nur senkrecht
  for (const P of [a, b]) {
    const key = `${P[0].toFixed(6)},${P[1].toFixed(6)}`;
    if (done.has(key)) continue;
    done.add(key);
    moveVertexAt(p, P, dx, dy);
  }
}
function moveZone(p, k, dx, dy) {
  const z = p.soil.zones[k];
  if (z) for (const q of z.ring) { q[0] = r3(q[0] + dx); q[1] = r3(q[1] + dy); }
}
/** Punkt P (relativ) auf alle Zonenkanten einfügen, auf denen er liegt. */
function insertOnEdges(p, P) {
  for (const z of p.soil.zones) {
    const r = z.ring;
    if (r.some((q) => near(q, P, 1e-3))) continue;
    for (let j = 0; j < r.length; j++) {
      const a = r[j], b = r[(j + 1) % r.length];
      const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      if (!L2) continue;
      const t = ((P[0] - a[0]) * (b[0] - a[0]) + (P[1] - a[1]) * (b[1] - a[1])) / L2;
      if (t <= 1e-9 || t >= 1 - 1e-9) continue;
      const d = Math.hypot(a[0] + t * (b[0] - a[0]) - P[0], a[1] + t * (b[1] - a[1]) - P[1]);
      if (d < 2e-3) { r.splice(j + 1, 0, P.slice()); break; }
    }
  }
}
/** Ende einer Grenze am Bildrand ziehen: beide Randpunkte als Ecken einfügen, dann den gezogenen verschieben. */
function moveCrossing(p, k, i, end, dx, dy) {
  const z = p.soil.zones[k];
  if (!z || !scene.region) return null;
  const r = z.ring, ref = scene.ref || 0;
  const A = [r[i][0], ref + r[i][1]], B = [r[(i + 1) % r.length][0], ref + r[(i + 1) % r.length][1]];
  const parts = clipSegToRing(A, B, scene.region);
  if (!parts.length) return null;
  const P0 = parts[0], P1 = parts[parts.length - 1];
  const ends = [];
  if (P0[2] > 1e-9) ends.push(relPt(P0[0]));
  if (P1[3] < 1 - 1e-9) ends.push(relPt(P1[1]));
  for (const P of ends) insertOnEdges(p, P);
  const target = relPt(end === 0 ? P0[0] : P1[1]);
  for (const zz of p.soil.zones) for (const q of zz.ring) if (near(q, target, 2e-3)) { q[0] = target[0]; q[1] = target[1]; }
  moveVertexAt(p, target, dx, dy);
  const moved = [r3(target[0] + dx), r3(target[1] + dy)];
  const idx = z.ring.findIndex((q) => near(q, moved, 1e-3));
  return idx >= 0 ? `V:${k}:${idx}` : null;
}
function removeVertex(app, k, i) {
  const p = app.project;
  const v = p.soil.zones[k]?.ring[i];
  if (!v) return;
  const P = v.slice();
  let blocked = false;
  for (const z of p.soil.zones) {
    const hits = z.ring.filter((q) => near(q, P));
    if (!hits.length) continue;
    if (z.ring.length - hits.length < 3) { blocked = true; continue; }
    z.ring = z.ring.filter((q) => !near(q, P));
  }
  if (blocked) app.status('Eine Fläche braucht mindestens drei Ecken – ganze Fläche anklicken und löschen.', 'warn');
}

function moveEP(p, which, dx, dy) {
  const e = p.ep;
  const H = +e.H, xTop = -H * Math.tan(rad(+e.alpha || 0));
  if (which === 'top') {
    const H2 = Math.max(0.2, H + dy), x2 = xTop + dx;
    e.H = r2(H2);
    e.alpha = r2(clamp(deg(Math.atan(-x2 / H2)), -45, 45));
  } else if (which === 'surfEnd' && scene.info.X1 !== undefined) {
    const x = scene.info.X1 + dx, y = scene.info.yS(scene.info.X1) + dy;
    e.beta = r2(clamp(deg(Math.atan2(y - H, Math.max(0.1, x - xTop))), -40, 40));
  }
}

function moveFooting(p, which, dx, dy) {
  const f = fobj(p);
  if (which === 'foot') f.D = r2(Math.max(0, +f.D - dy));
  else if (which === 'edge') { f.B = r2(Math.max(0.1, +f.B + 2 * dx)); f.D = r2(Math.max(0, +f.D - dy)); }
  else if (which === 'corner') {
    f.B = r2(Math.max(0.1, +f.B + 2 * dx));
    if (f.shape === 'rect') f.L = r2(Math.max(0.1, +f.L + 2 * dy));
  }
  if (p.analysis === 'grundbruch' && +f.t > +f.D && +f.D > 0) f.t = f.D;
  if (f.shape === 'rect' && +f.L < +f.B) f.L = f.B;
}

function moveGrid(app, dx, dy) {
  const g = app.project.sl.grid;
  const it = scene.items.find((x) => x.id === 'grid');
  if (g.auto !== false && it) {
    const xs = it.ring.map((q) => q[0]), ys = it.ring.map((q) => q[1]);
    const R = app.results?.sl?.grid;
    Object.assign(g, { auto: false, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), nx: R?.nx || 12, ny: R?.ny || 12, nr: R?.nr || 12 });
  }
  g.x0 = r2(+g.x0 + dx); g.x1 = r2(+g.x1 + dx); g.y0 = r2(+g.y0 + dy); g.y1 = r2(+g.y1 + dy);
}

function moveWall(p, which, dx, dy) {
  const w = p.rw;
  if (which === 'top') w.hs = r2(Math.max(0.2, +w.hs + dy));
  else if (which === 'stemTop') w.tTop = r2(clamp(+w.tTop - dx, 0.1, +w.tBot));
  else if (which === 'stemBot') {
    const toe = clamp(+w.toe + dx, 0, +w.toe + +w.tBot - +w.tTop);
    w.tBot = r2(Math.max(+w.tTop, +w.tBot - (toe - +w.toe)));
    w.toe = r2(toe);
  } else if (which === 'heel') w.heel = r2(Math.max(0, +w.heel + dx));
  else if (which === 'toe') w.toe = r2(Math.max(0, +w.toe - dx));
  else if (which === 'd') { const d = clamp(+w.d + dy, 0.1, +w.d + +w.hs - 0.2); w.hs = r2(+w.hs - (d - +w.d)); w.d = r2(d); }
  else if (which === 'front') w.Df = r2(clamp(+w.Df + dy, 0, +w.d + +w.hs));
  else if (which === 'surfEnd' && scene.info.g) {
    const { g, X1, yS } = scene.info;
    const x = X1 + dx, y = yS(X1) + dy;
    w.beta = r2(clamp(deg(Math.atan2(y - g.H, Math.max(0.1, x - g.xb))), -40, 40));
  } else if (which === 'key') {
    const k = w.key;
    if (dy) k.depth = r2(Math.max(0.05, +k.depth - dy));
    if (dx) k.x = r2(Math.max(0, +k.x + dx));
  }
}

// ------------------------------------------------------------------ Eigenschaftsfenster

const DEPTH_TXT = { erddruck: 'ab Wandkopf', grundbruch: 'ab Gelände', setzung: 'ab Gelände', boeschung: 'ab Böschungskrone', stuetzmauer: 'ab Mauerkrone' };

/** Felder einer Bodenart (für Eigenschaftsfenster und die Liste im Register «Baugrund»). */
export function soilEditor(S, onChange) {
  const c = () => onChange(false), cp = () => onChange(true);
  const tpl = { v: '' };
  return [
    textField('Bezeichnung', S, 'name', { onChange: cp }),
    selectField('Vorlage', tpl, 'v', [{ value: '', label: '– wählen –' }, ...SOIL_PRESETS.map((s, j) => ({ value: String(j), label: s.name }))], {
      wide: true, info: I('Setzt Name, γ, γ\', φ\'_k, c\'_k, c_u,k und M_E auf typische Richtwerte (projektspezifisch prüfen).'),
      onChange: (v) => { const pr = SOIL_PRESETS[+v]; if (!pr) return; Object.assign(S, { name: pr.name, gamma: pr.gamma, gammaP: pr.gammaP, phi: pr.phi, c: pr.c, cu: pr.cu, ME: pr.ME }); cp(); },
    }),
    h('div', { class: 'grid2' },
      numField('γ', S, 'gamma', { unit: 'kN/m³', min: 1, onChange: c, info: 'Raumgewicht über dem Grundwasser.' }),
      numField("γ'", S, 'gammaP', { unit: 'kN/m³', min: 0, onChange: c, info: 'Raumgewicht unter Auftrieb (unter dem Grundwasserspiegel).' })),
    h('div', { class: 'grid2' },
      numField("φ'_k", S, 'phi', { unit: '°', min: 0, max: 50, onChange: c, info: 'Effektiver Reibungswinkel (charakteristisch).' }),
      numField("c'_k", S, 'c', { unit: 'kN/m²', min: 0, onChange: c, info: 'Effektive Kohäsion (charakteristisch).' })),
    h('div', { class: 'grid2' },
      numField('c_u,k', S, 'cu', { unit: 'kN/m²', min: 0, onChange: c, info: 'Undrainierte Scherfestigkeit (0 = nicht massgebend).' }),
      numField('M_E', S, 'ME', { unit: 'MN/m²', min: 0.1, onChange: c, info: 'Steifemodul (Oedometer) für die Setzung.' })),
    h('div', { class: 'grid2' },
      numField('δ/φ', S, 'dr', { unit: '–', min: 0, max: 1, digits: 2, onChange: c, info: 'Wandreibung als Anteil von φ\' (Erddruck nach Coulomb), rauhe Betonwand 2/3.' }),
      selectField('Stil', S, 'col', [1, 2, 3, 4, 5, 6, 7, 8].map((k) => ({ value: k, label: `Farbe ${k}` })), { onChange: cp })),
  ];
}

function soilResults(app, si) {
  const r = app.results;
  if (r?.ep) {
    const K = r.ep.layers.find((x) => x.idx === si);
    if (K) return [h('div', { class: 'ed-sub' }, 'Ergebnisse'), kvTable([['K_h', K.Kgh, '', 3], ['K_ch', K.Kch, '', 3], K.theta ? ['ϑ_a', K.theta, '°', 1] : null])];
  } else if (r?.st) {
    const rows = r.st.layers.filter((x) => x.idx === si);
    if (rows.length) return [h('div', { class: 'ed-sub' }, 'Ergebnisse'), kvTable([['Setzungsanteil', rows.reduce((a, x) => a + x.ds[r.st.refKey], 0), 'mm', 1]])];
  }
  return [];
}

function soilPicker(app, obj, key, label) {
  const p = app.project, soils = p.soil.soils;
  return selectField(label, obj, key, [...soils.map((s, i) => ({ value: i, label: s.name })), { value: -1, label: '+ Neue Bodenart …' }], {
    wide: true, info: I('Bodenart dieser Fläche. Die Kennwerte gelten für alle Flächen mit derselben Bodenart; die Liste der Bodenarten steht im Register «Baugrund».'),
    onChange: (v) => { if (v === -1) { soils.push(newSoil(p)); obj[key] = soils.length - 1; } p.soil.active = obj[key]; after(app, true)(); },
  });
}

function inspectZone(app, k, t) {
  const p = app.project, Z = p.soil.zones[k];
  if (!Z) return null;
  const soils = p.soil.soils, S = soils[Z.soil] || soils[0];
  const used = p.soil.zones.filter((z) => z.soil === Z.soil).length + (p.soil.base === Z.soil ? 1 : 0);
  const hint = { E: 'Grenze ziehen verschiebt sie (waagrechte Grenzen nur senkrecht).', V: 'Ecke ziehen – gemeinsame Ecken benachbarter Flächen wandern mit. «Löschen» entfernt die Ecke.', X: 'Ende der Grenze ziehen, um sie zu neigen.' }[t];
  return {
    title: `Fläche ${k + 1}: ${S.name}`,
    content: [
      hint ? h('div', { class: 'muted small' }, hint) : null,
      soilPicker(app, Z, 'soil', 'Bodenart'),
      h('div', { class: 'ed-sub' }, used > 1 ? `Kennwerte · ${used} Flächen` : 'Kennwerte'),
      ...soilEditor(S, (rebuild) => after(app, rebuild)()),
      ...soilResults(app, Z.soil),
      h('div', { class: 'row' },
        button('Nach vorne', { small: true, icon: 'up', title: 'Fläche über die anderen legen', onClick: () => { p.soil.zones.push(p.soil.zones.splice(k, 1)[0]); app.editor?.select([`Z:${p.soil.zones.length - 1}`]); after(app, true)(); } })),
    ],
  };
}

function inspectBase(app) {
  const p = app.project, S = p.soil.soils[p.soil.base ?? 0];
  return {
    title: `Untergrund: ${S?.name ?? ''}`,
    content: [
      h('div', { class: 'muted small' }, 'Bodenart ausserhalb aller gezeichneten Flächen. Eigene Schichten mit «Schicht» (L) zeichnen oder mit «Teilen» (J) abtrennen.'),
      soilPicker(app, p.soil, 'base', 'Untergrund'),
      ...(S ? soilEditor(S, (rebuild) => after(app, rebuild)()) : []),
      ...soilResults(app, p.soil.base ?? 0),
    ],
  };
}

function inspectWater(app) {
  const p = app.project, c = after(app);
  const out = [
    checkField('Grundwasser vorhanden', p.soil.gw, 'on', { onChange: after(app, true) }),
    numField('Tiefe z_w', p.soil.gw, 'z', { unit: 'm', onChange: c, info: `Tiefe des Grundwasserspiegels ${DEPTH_TXT[p.analysis]}. Die Linie lässt sich in der Grafik senkrecht ziehen.` }),
    numField('Wichte γ_w', p.soil, 'gammaW', { unit: 'kN/m³', min: 9, max: 11, onChange: c }),
  ];
  if (p.analysis === 'erddruck') out.push(checkField('Wasserdruck auf die Wand', p.ep, 'water', { onChange: c }));
  if (p.analysis === 'stuetzmauer') out.push(checkField('Wasserdruck auf die Mauer', p.rw, 'water', { onChange: c }));
  if (p.analysis === 'boeschung') out.push(note('In der Böschung wirkt dieser Spiegel nur, wenn im Register «Analyse» unter «Wasser» der horizontale GW-Spiegel gewählt ist.'));
  return { title: 'Grundwasserspiegel', content: out };
}

function inspectEPWall(app) {
  const e = app.project.ep, c = after(app), cp = after(app, true);
  const kinds = [{ value: 'active', label: 'aktiv' }, { value: 'increased', label: 'erhöht aktiv' }, { value: 'atrest', label: 'Ruhedruck' }, { value: 'passive', label: 'Erdwiderstand' }];
  const out = [
    h('div', { class: 'grid3' },
      numField('H', e, 'H', { unit: 'm', min: 0.1, onChange: c }),
      numField('α', e, 'alpha', { unit: '°', min: -45, max: 45, onChange: c, info: 'Neigung der Wandrückseite; positiv, wenn der Wandkopf vom Erdreich weg geneigt ist.' }),
      numField('β', e, 'beta', { unit: '°', min: -40, max: 40, onChange: c, info: 'Geländeneigung hinter der Wand (positiv ansteigend).' })),
    selectField('Erddruckart', e, 'kind', kinds, { wide: true, onChange: cp }),
    e.kind === 'increased' ? numField('Erhöhungsfaktor μ', e, 'mu', { min: 0, max: 1, unit: '–', onChange: c }) : null,
    e.kind === 'passive' ? numField('δ_p/φ', e, 'dpRatio', { min: 0, max: 1, unit: '–', onChange: c }) : selectField('Verfahren', e, 'method', [{ value: 'coulomb', label: 'Coulomb (δ aus Schicht)' }, { value: 'rankine', label: 'Rankine (δ = β)' }], { wide: true, onChange: c }),
    numField('Flächenlast q', e, 'q', { unit: 'kN/m²', min: 0, onChange: c, info: 'Gleichmässige veränderliche Auflast hinter der Wand.' }),
    checkField('Wasserdruck auf die Wand', e, 'water', { onChange: c }),
  ];
  const r = app.results?.ep;
  if (r) out.push(h('div', { class: 'ed-sub' }, 'Ergebnisse'), kvTable([[r.passive ? 'E_ph,k' : 'E_ah,k', r.Eh, 'kN/m', 1], ['Angriff über Fuss', r.hE, 'm', 2], ['Bemessungswert', r.Ed, 'kN/m', 1]]));
  return { title: 'Wand und Gelände', content: out };
}

function inspectLoad(app, k) {
  const e = app.project.ep, ld = e.loads[k];
  if (!ld) return null;
  const c = after(app), cp = after(app, true);
  return {
    title: `${ld.type === 'line' ? 'Linienlast' : 'Streifenlast'} ${k + 1}`,
    content: [
      selectField('Art', ld, 'type', [{ value: 'strip', label: 'Streifenlast' }, { value: 'line', label: 'Linienlast' }], { wide: true, onChange: cp }),
      h('div', { class: ld.type === 'line' ? 'grid2' : 'grid3' },
        numField(ld.type === 'line' ? 'P' : 'p', ld, 'p', { unit: ld.type === 'line' ? 'kN/m' : 'kN/m²', min: 0, onChange: c }),
        numField('a', ld, 'a', { unit: 'm', min: 0, onChange: c, info: 'Abstand ab Wandkopf (horizontal). In der Grafik seitlich ziehen.' }),
        ld.type === 'line' ? null : numField('b', ld, 'b', { unit: 'm', min: 0, onChange: c, info: 'Breite der Streifenlast.' })),
      h('div', { class: 'muted small' }, 'Veränderliche Last (γ_Q). Ausserhalb des Gleitkeils ohne Einfluss.'),
    ],
  };
}

function inspectFooting(app, which) {
  const p = app.project, f = fobj(p), c = after(app), cp = after(app, true);
  const circ = f.shape === 'circle', strip = f.shape === 'strip';
  const out = [
    selectField('Form', f, 'shape', [{ value: 'strip', label: 'Streifen' }, { value: 'rect', label: 'Rechteck' }, { value: 'circle', label: 'Kreis' }], { wide: true, onChange: cp }),
    h('div', { class: 'grid3' },
      numField(circ ? 'Ø' : 'B', f, 'B', { unit: 'm', min: 0.1, onChange: c }),
      f.shape === 'rect' ? numField('L', f, 'L', { unit: 'm', min: 0.1, onChange: c }) : null,
      numField('D', f, 'D', { unit: 'm', min: 0, onChange: c, info: 'Sohltiefe unter Gelände.' }),
      p.analysis === 'grundbruch' ? numField('t', f, 't', { unit: 'm', min: 0, onChange: c, info: 'Fundamentdicke.' }) : null),
  ];
  if (p.analysis === 'grundbruch') {
    const u = strip ? ['kN/m', 'kNm/m'] : ['kN', 'kNm'];
    const row = (lab, o) => h('div', { class: 'ed-load' }, h('div', {},
      h('div', { class: 'muted small' }, lab),
      h('div', { class: 'grid3' },
        numField('V', o, 'V', { unit: u[0], onChange: c }),
        numField(strip ? 'H' : 'H_B', o, 'HB', { unit: u[0], onChange: c }),
        numField(strip ? 'M' : 'M_B', o, 'MB', { unit: u[1], onChange: c, info: 'Positiv, wenn die Resultierende in +x wandert.' })),
      strip ? null : h('div', { class: 'grid3' }, numField('H_L', o, 'HL', { unit: u[0], onChange: c }), numField('M_L', o, 'ML', { unit: u[1], onChange: c }))));
    out.push(h('div', { class: 'ed-sub' }, 'Lasten an Fundamentoberkante (charakteristisch)'), row('ständig G', f.loads.G), row('veränderlich Q', f.loads.Q));
    out.push(checkField('Eigengewicht Fundament + Auflast', f, 'selfWeight', { onChange: c }));
    const g = app.results?.bc?.gov;
    if (g && !g.error) out.push(h('div', { class: 'ed-sub' }, 'Ergebnisse'), kvTable([['V_d / R_d', `${fmt(g.ld.V, 0)} / ${fmt(g.Rd, 0)}`, strip ? 'kN/m' : 'kN'], ["B'", g.eff.Bp, 'm', 2], ['Ausnutzung η', g.eta, '', 2]]));
  } else {
    out.push(h('div', { class: 'ed-sub' }, 'Belastung (quasi-ständig)'),
      selectField('Eingabe', f, 'loadMode', [{ value: 'p', label: 'Sohlspannung σ₀' }, { value: 'V', label: 'Vertikalkraft V' }], { wide: true, onChange: cp }),
      f.loadMode === 'V' ? numField('V', f, 'V', { unit: strip ? 'kN/m' : 'kN', min: 0, onChange: c }) : numField('σ₀', f, 'p0', { unit: 'kN/m²', min: 0, onChange: c }),
      checkField('Aushubentlastung abziehen', f, 'unload', { onChange: c }));
    const s = app.results?.st;
    if (s) out.push(h('div', { class: 'ed-sub' }, 'Ergebnisse'), kvTable([['Setzung (Bezugspunkt)', s.sRef, 'mm', 1], ['Grenztiefe', s.zLim, 'm', 2]]));
  }
  void which;
  return { title: p.analysis === 'grundbruch' ? 'Fundament und Lasten' : 'Fundament', content: out };
}

function inspectPoint(app, t, i) {
  const p = app.project, arr = t === 's' ? p.sl.surface : p.sl.water, pt = arr[i];
  if (!pt) return null;
  const c = () => { arr.sort((u, v) => u.x - v.x); after(app)(); };
  return {
    title: t === 's' ? `Geländepunkt ${i + 1}` : `Wasserspiegel, Punkt ${i + 1}`,
    content: [
      h('div', { class: 'grid2' }, numField('x', pt, 'x', { unit: 'm', onChange: c }), numField('y', pt, 'y', { unit: 'm', onChange: c })),
      h('div', { class: 'muted small' }, 'Punkt ziehen verschiebt ihn; mit X bzw. Y nur in einer Richtung. «Löschen» entfernt ihn.'),
    ],
  };
}

function inspectSurcharge(app) {
  const q = app.project.sl.q, c = after(app);
  return { title: 'Auflast', content: [
    numField('Flächenlast q', q, 'p', { unit: 'kN/m²', min: 0, onChange: c, info: 'Veränderlich: in der Bemessung mit γ_Q und nur, wo sie ungünstig wirkt.' }),
    h('div', { class: 'grid2' }, numField('von x₁', q, 'x1', { unit: 'm', onChange: c }), numField('bis x₂', q, 'x2', { unit: 'm', onChange: c })),
  ] };
}

function inspectGrid(app) {
  const g = app.project.sl.grid, c = after(app), cp = after(app, true);
  const out = [checkField('Suchraster automatisch', g, 'auto', { onChange: cp })];
  if (g.auto === false) {
    out.push(h('div', { class: 'grid2' }, numField('x₀', g, 'x0', { unit: 'm', onChange: c }), numField('x₁', g, 'x1', { unit: 'm', onChange: c }), numField('y₀', g, 'y0', { unit: 'm', onChange: c }), numField('y₁', g, 'y1', { unit: 'm', onChange: c })),
      h('div', { class: 'grid3' }, numField('n_x', g, 'nx', { min: 2, max: 60, unit: '', onChange: c }), numField('n_y', g, 'ny', { min: 2, max: 60, unit: '', onChange: c }), numField('Radien', g, 'nr', { min: 2, max: 60, unit: '', onChange: c })));
  }
  const R = app.results?.sl;
  if (R) out.push(kvTable([['untersuchte Kreise', `${R.circles} (${R.ms} ms)`], ['F_d (Bemessung)', R.Fd, '', 3]]));
  out.push(h('div', { class: 'muted small' }, 'Liegt das Minimum am Rand, das Raster grösser ziehen bzw. verschieben.'));
  return { title: 'Suchraster', content: out };
}

function inspectWall(app) {
  const w = app.project.rw, c = after(app), cp = after(app, true);
  const out = [
    h('div', { class: 'grid3' },
      numField('h_s', w, 'hs', { unit: 'm', min: 0.2, onChange: c, info: 'Wandhöhe ab Oberkante Fundament.' }),
      numField('t oben', w, 'tTop', { unit: 'm', min: 0.05, onChange: c }),
      numField('t unten', w, 'tBot', { unit: 'm', min: 0.05, onChange: c })),
    h('div', { class: 'grid3' },
      numField('Zehe', w, 'toe', { unit: 'm', min: 0, onChange: c }),
      numField('Ferse', w, 'heel', { unit: 'm', min: 0, onChange: c }),
      numField('d', w, 'd', { unit: 'm', min: 0.1, onChange: c, info: 'Fundamentdicke.' })),
    numField('Einbindung vorne D_f', w, 'Df', { unit: 'm', min: 0, onChange: c }),
    checkField('Sporn', w.key, 'on', { onChange: cp }),
    w.key.on ? h('div', { class: 'grid3' }, numField('Tiefe', w.key, 'depth', { unit: 'm', min: 0, onChange: c }), numField('Breite', w.key, 'width', { unit: 'm', min: 0, onChange: c }), numField('Lage', w.key, 'x', { unit: 'm', min: 0, onChange: c, info: 'Abstand ab Vorderkante Fundament.' })) : null,
  ];
  const R = app.results?.rw;
  if (R) out.push(h('div', { class: 'ed-sub' }, 'Ergebnisse'), kvTable([['Gleiten η', R.govS.eta, '', 2], ['Grundbruch η', R.govB.eta, '', 2], ['Ausmitte e_k', R.charG.e, 'm', 3], ['Wand M_Ed', R.sec.base.Md, 'kNm/m', 1]]));
  return { title: 'Winkelstützmauer', content: out };
}

function inspectBackfill(app) {
  const w = app.project.rw, c = after(app);
  return { title: 'Hinterfüllung', content: [
    h('div', { class: 'grid2' },
      numField('β', w, 'beta', { unit: '°', min: -40, max: 40, onChange: c, info: 'Geländeneigung; in der Grafik das Geländeende ziehen.' }),
      numField('q', w, 'q', { unit: 'kN/m²', min: 0, onChange: c, info: 'Veränderliche Auflast.' })),
    selectField('Erddruck auf Ersatzwand', w, 'method', [{ value: 'rankine', label: 'Rankine (δ = β)' }, { value: 'coulomb', label: 'Coulomb (δ aus Schicht)' }], { wide: true, onChange: c }),
    checkField('Wasserdruck (Grundwasser)', w, 'water', { onChange: c }),
  ] };
}
