// Grafische Bearbeitung der Platte: Werkzeuge, Geometrie für den Editor, Eigenschaftsfenster
import { h, numField, selectField, checkField, textField, button, kvTable, note, badge, utilBar, rich } from '../../js/core/ui.js';
import { subHtml as I } from '../../js/core/format.js';
import { fmt } from '../../js/core/format.js';
import { TOOL_ICONS } from '../../js/core/editor.js';
import { CONCRETE_CLASSES } from '../../js/core/materials.js';
import {
  parseId, moveSelection, copySelection, removeSelection, createElement, insertMidpoint, addWallsOnEdges, addWallsOnFreeEdges,
  activeLoadCase, onSlab, slabAt, addSlabLoad,
} from './model.js';
import { signedArea } from './geom.js';
import { currentSet } from './views.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const EDIT_MODES = ['system', 'mesh'];
const TYPE_LABEL = { innen: 'Innenstütze', rand: 'Randstütze', ecke: 'Eckstütze' };

const ICON_AREA = '<path d="M4 6h16v12H4z" stroke-dasharray="3 2"/><path d="M8 3v6M12 3v6M16 3v6M7 7l1 2 1-2M11 7l1 2 1-2M15 7l1 2 1-2"/>';
const ICON_ZONE = '<path d="M4 18l3-12h11l2 12z" stroke-dasharray="3 2"/><path d="M10 9v5M14 9v5M9 12.5l1 2 1-2M13 12.5l1 2 1-2"/>';
const ICON_LINELOAD = '<path d="M3 18h18"/><path d="M6 6v9M12 6v9M18 6v9M4.5 13l1.5 2 1.5-2M10.5 13l1.5 2 1.5-2M16.5 13l1.5 2 1.5-2"/>';
const ICON_SLAB = '<path d="M3 8l9-4 9 4-9 4z"/><path d="M3 8v4l9 4 9-4V8"/>';

export const editorSpec = {
  axes: ['x', 'y'],
  unit: 'm',
  digits: 3,
  grid: [0.05, 0.1, 0.25, 0.5, 1],
  gridDefault: 0.25,
  modes: EDIT_MODES,
  canCopy: true,
  tools: [
    { id: 'slab', label: 'Platte', key: 'u', form: 'polygon', icon: ICON_SLAB, title: 'Platte zeichnen: Eckpunkte nacheinander anklicken, Klick auf den ersten Punkt oder Enter schliesst. Weitere Platten mit gemeinsamen Rändern sind verbunden; eine Platte innerhalb einer anderen überschreibt dort die Dicke.', prompts: ['Ersten Eckpunkt der Platte setzen.', 'Nächsten Eckpunkt setzen – Klick auf den ersten Punkt oder Enter schliesst.'] },
    { id: 'opening', label: 'Öffnung', key: 'o', form: 'rect', icon: TOOL_ICONS.opening, title: 'Rechteckige Öffnung: zwei gegenüberliegende Ecken anklicken', prompts: ['Erste Ecke der Öffnung setzen.', 'Gegenüberliegende Ecke setzen.'] },
    { id: 'column', label: 'Stütze', key: 's', form: 'point', icon: TOOL_ICONS.column, title: 'Stütze (Punktlager) setzen; b × h und Federn im Eigenschaftsfenster' },
    { id: 'wall', label: 'Wand', key: 'w', form: 'chain', icon: TOOL_ICONS.wall, title: 'Wand (Linienlager): Punkte nacheinander anklicken, Esc beendet', prompts: ['Anfangspunkt der Wand setzen.', 'Endpunkt setzen – weiterzeichnen oder Esc.'] },
    { id: 'area', label: 'Flächenlast', key: 'f', form: 'pick', pick: ['region'], icon: ICON_AREA, title: 'Flächenlast auf eine ganze Platte bzw. Lastfläche: in die Fläche klicken', hint: 'In eine Platte (oder Lastfläche) klicken – die Last wirkt auf die ganze Fläche.' },
    { id: 'zone', label: 'Lastfläche', key: 'z', form: 'polygon', icon: ICON_ZONE, title: 'Teilfläche mit Flächenlast zeichnen (Polygon)', prompts: ['Ersten Eckpunkt der Lastfläche setzen.', 'Nächsten Eckpunkt – Klick auf den ersten Punkt schliesst.'] },
    { id: 'lineload', label: 'Linienlast', key: 'l', form: 'line', icon: ICON_LINELOAD, title: 'Linienlast (z.B. Wand- oder Geländerlast) von Punkt zu Punkt', prompts: ['Anfangspunkt der Linienlast setzen.', 'Endpunkt setzen.'] },
    { id: 'pointload', label: 'Punktlast', key: 'p', form: 'point', icon: TOOL_ICONS.pointload, title: 'Einzellast setzen' },
  ],

  geometry(app) {
    const p = app.project;
    const edit = EDIT_MODES.includes(app.viewMode);
    const points = [], segments = [], regions = [];
    const P = (q) => [num(q.x), num(q.y)];
    const ok = (q) => Number.isFinite(q[0]) && Number.isFinite(q[1]);
    p.pointSupports.forEach((s, i) => { const q = P(s); if (ok(q)) points.push({ id: `c:${i}`, p: q, label: `Stütze S${i + 1}` }); });
    p.pointLoads.forEach((l, i) => { const q = P(l); if (ok(q)) points.push({ id: `pl:${i}`, p: q, label: `Punktlast ${fmt(num(l.P), 1)} kN` }); });
    if (edit) {
      p.slabs.forEach((sl, k) => sl.outline.forEach((q, i) => { const r = P(q); if (ok(r)) points.push({ id: `sv:${k}:${i}`, p: r, label: `${sl.name}, Punkt ${i + 1}` }); }));
      p.openings.forEach((o, k) => o.pts.forEach((q, i) => { const r = P(q); if (ok(r)) points.push({ id: `hv:${k}:${i}`, p: r, label: `Öffnung ${k + 1}, Punkt ${i + 1}` }); }));
      p.loadAreas.forEach((a, k) => a.pts.forEach((q, i) => { const r = P(q); if (ok(r)) points.push({ id: `av:${k}:${i}`, p: r, label: `${a.name || 'Lastfläche'}, Punkt ${i + 1}` }); }));
      p.lineSupports.forEach((w, i) => [[w.x1, w.y1], [w.x2, w.y2]].forEach((q, e) => { if (ok(q.map(Number))) points.push({ id: `we:${i}:${e}`, p: q.map(Number), label: `Wand W${i + 1}, ${e ? 'Ende' : 'Anfang'}` }); }));
      p.lineLoads.forEach((l, i) => [[l.x1, l.y1], [l.x2, l.y2]].forEach((q, e) => { if (ok(q.map(Number))) points.push({ id: `le:${i}:${e}`, p: q.map(Number), label: `Linienlast ${i + 1}, ${e ? 'Ende' : 'Anfang'}` }); }));
    }
    const seg = (id, a, b, label) => { if (ok(a) && ok(b)) segments.push({ id, a, b, label }); };
    p.lineSupports.forEach((w, i) => seg(`w:${i}`, [num(w.x1), num(w.y1)], [num(w.x2), num(w.y2)], `Wand W${i + 1}`));
    p.lineLoads.forEach((l, i) => seg(`ll:${i}`, [num(l.x1), num(l.y1)], [num(l.x2), num(l.y2)], `Linienlast ${i + 1}`));
    if (edit) {
      p.openings.forEach((o, k) => o.pts.forEach((q, i) => seg(`he:${k}:${i}`, P(q), P(o.pts[(i + 1) % o.pts.length]), `Öffnung ${k + 1}`)));
      p.slabs.forEach((sl, k) => {
        const n = sl.outline.length;
        if (n >= 2) sl.outline.forEach((q, i) => { if (n >= 3 || i === 0) seg(`se:${k}:${i}`, P(q), P(sl.outline[(i + 1) % n]), `${sl.name}: Rand ${i + 1}–${(i + 1) % n + 1}`); });
      });
      p.openings.forEach((o, k) => { if (o.pts.length >= 3) regions.push({ id: `h:${k}`, ring: o.pts.map(P), label: o.name || `Öffnung ${k + 1}` }); });
      p.loadAreas.forEach((a, k) => { if (a.pts.length >= 3) regions.push({ id: `a:${k}`, ring: a.pts.map(P), label: a.name || `Lastfläche ${k + 1}` }); });
      p.slabs.forEach((sl, k) => { if (sl.outline.length >= 3) regions.push({ id: `s:${k}`, ring: sl.outline.map(P), label: `${sl.name} (h = ${fmt(num(sl.h), 2)} m)` }); });
    }
    return { points, segments, regions };
  },

  create(app, tool, pts) {
    const p = app.project;
    const r = createElement(p, tool === 'zone' ? 'area' : tool, pts, { lc: app.viewOpts.lc });
    if (r.msg) app.status(r.msg, r.kind);
    if (tool === 'slab') {
      if (p.slabs.length === 1 && !p.lineSupports.length && !p.pointSupports.length) app.view.fitted = false;
      // zurück zur Auswahl: die neue Platte ist gewählt, das Fenster bietet Dicke und «Wände an freien Rändern»
      setTimeout(() => { app.editor?.setTool('select'); app.editor?.select(r.ids); }, 0);
    }
    return r.ids;
  },

  pick(app, tool, hit) {
    const p = app.project;
    if (tool !== 'area' || !hit) return [];
    const lc = activeLoadCase(p, app.viewOpts.lc);
    if (!lc) throw new Error('Zuerst im Register «Lasten» einen Lastfall anlegen.');
    const { t, a } = parseId(hit.id);
    const lcName = p.loadCases.find((l) => l.id === lc)?.name || lc;
    if (t === 's' && p.slabs[a]) {
      addSlabLoad(p, p.slabs[a].id, lc, 2.0);
      app.status(`Flächenlast 2.0 kN/m² auf «${p.slabs[a].name}» (${lcName}) – Wert im Eigenschaftsfenster`, 'ok');
      app.changed({ inputs: true });
      return [hit.id];
    }
    if (t === 'a' && p.loadAreas[a]) {
      addSlabLoad(p, p.loadAreas[a].id, lc, 2.0);
      app.status(`Flächenlast 2.0 kN/m² auf «${p.loadAreas[a].name || 'Lastfläche'}» (${lcName})`, 'ok');
      app.changed({ inputs: true });
      return [hit.id];
    }
    app.status('Bitte in eine Platte oder Lastfläche klicken (nicht in eine Öffnung).', 'warn');
    return [];
  },

  move(app, ids, d, { copy }) {
    const p = app.project;
    if (copy) {
      const out = copySelection(p, ids, d);
      app.status(out.length ? `${out.length} Element${out.length === 1 ? '' : 'e'} kopiert` : 'Eckpunkte und Kanten lassen sich nicht kopieren – die ganze Platte wählen', out.length ? 'ok' : 'warn');
      return out.length ? out : ids;
    }
    moveSelection(p, ids, d);
    return ids;
  },

  remove(app, ids) {
    const n = removeSelection(app.project, ids);
    app.status(n ? `${n} Element${n === 1 ? '' : 'e'} gelöscht` : 'Randkanten lassen sich nicht einzeln löschen – Eckpunkte oder die ganze Platte wählen', n ? 'ok' : 'warn');
  },

  inspect(app, ids) {
    const p = app.project;
    if (ids.length === 1) {
      const { t, a, b } = parseId(ids[0]);
      if (t === 's' && p.slabs[a]) return inspectSlab(app, a);
      if (t === 'sv' && p.slabs[a]?.outline[b]) return inspectVertex(app, p.slabs[a].outline, b, p.slabs[a].name, p.slabs[a].outline.length > 3);
      if (t === 'se' && p.slabs[a]?.outline[b]) return inspectEdge(app, p.slabs[a].outline, b, a);
      if (t === 'h' && p.openings[a]) return inspectOpening(app, a);
      if (t === 'hv' && p.openings[a]?.pts[b]) return inspectVertex(app, p.openings[a].pts, b, `Öffnung ${a + 1}`, p.openings[a].pts.length > 3);
      if (t === 'he' && p.openings[a]?.pts[b]) return inspectEdge(app, p.openings[a].pts, b, -1, a);
      if (t === 'a' && p.loadAreas[a]) return inspectArea(app, a);
      if (t === 'av' && p.loadAreas[a]?.pts[b]) return inspectVertex(app, p.loadAreas[a].pts, b, p.loadAreas[a].name || `Lastfläche ${a + 1}`, p.loadAreas[a].pts.length > 3);
      if (t === 'c' && p.pointSupports[a]) return inspectColumn(app, a);
      if ((t === 'w' || t === 'we') && p.lineSupports[a]) return inspectWall(app, a);
      if ((t === 'll' || t === 'le') && p.lineLoads[a]) return inspectLineLoad(app, a);
      if (t === 'pl' && p.pointLoads[a]) return inspectPointLoad(app, a);
    }
    return inspectMulti(app, ids);
  },

  idleHint(app) {
    const p = app.project;
    if (!p.slabs.length) return h('span', {}, 'Wählen Sie oben ', h('b', {}, 'Platte'), ' (U) und klicken Sie die Eckpunkte; Klick auf den ersten Punkt schliesst. Koordinaten lassen sich tippen. Fertige Systeme: «Beispiele».');
    if (!p.pointSupports.length && !p.lineSupports.length) return h('span', {}, 'Lager setzen: ', h('b', {}, 'Wand'), ' (W) oder ', h('b', {}, 'Stütze'), ' (S). Tipp: Platte anklicken › «Wände an freien Rändern».');
    const loads = p.areaLoads.length + p.lineLoads.length + p.pointLoads.length;
    if (!loads) return h('span', {}, 'Eigengewicht ist enthalten. Weitere Lasten: ', h('b', {}, 'Flächenlast'), ' (F, Klick in eine Platte), ', h('b', {}, 'Linienlast'), ' (L), ', h('b', {}, 'Punktlast'), ' (P). Dann ', h('b', {}, 'Berechnen'), ' (Ctrl+Enter).');
    return h('span', {}, 'Element anklicken zum Bearbeiten, ziehen zum Verschieben (verbundene Punkte gehen mit). X/Y binden an eine Achse, M fängt die Mitte. Dann ', h('b', {}, 'Berechnen'), ' (Ctrl+Enter).');
  },
};

// ------------------------------------------------------------------ Hilfen

const ch = (app) => () => app.changed({ inputs: true });
const refresh = (app) => () => { app.changed({ inputs: true }); app.editor.refreshPanel(true); };

function lcOptions(p) {
  return p.loadCases.map((l) => ({ value: l.id, label: l.name || l.id }));
}

function sub(title, extra) {
  return h('div', { class: 'ed-sub' }, title, extra ? h('span', { class: 'muted small' }, ` · ${extra}`) : null);
}

function resultsSet(app) {
  if (!app.results) return null;
  return currentSet(app);
}

function staleNote(app) {
  return app.results && app.stale ? h('div', { class: 'muted small' }, 'Ergebnisse veraltet – neu berechnen (Ctrl+Enter).') : null;
}

/** Betonauswahl einer Platte: leer = Projektbeton. */
export function concreteOptions(p) {
  return [{ value: '', label: `wie Projekt (${p.concrete})` }, ...CONCRETE_CLASSES.map((c) => ({ value: c, label: c }))];
}

/** Flächenlasten mit Ziel `region` als kompakte Liste (Lastfall, q, entfernen) samt «+». */
export function regionLoads(app, region, after) {
  const p = app.project;
  const c = () => { app.changed({ inputs: true }); after?.(); };
  const out = [];
  for (const l of p.areaLoads.filter((x) => x.region === region)) {
    out.push(h('div', { class: 'ed-load' },
      h('div', { class: 'grid2' },
        selectField('Lastfall', l, 'lc', lcOptions(p), { onChange: c }),
        numField('q', l, 'q', { unit: 'kN/m²', onChange: c, info: 'Positiv = nach unten.' })),
      button('', { icon: 'trash', small: true, ghost: true, title: 'Last entfernen', onClick: () => { p.areaLoads.splice(p.areaLoads.indexOf(l), 1); c(); app.editor?.refreshPanel(true); } })));
  }
  out.push(h('div', { class: 'row' }, button('Flächenlast', { icon: 'plus', small: true, title: 'Gleichmässige Last auf die ganze Fläche', onClick: () => {
    if (!p.loadCases.length) { app.status('Zuerst einen Lastfall anlegen (Register «Lasten»).', 'warn'); return; }
    addSlabLoad(p, region, activeLoadCase(p, app.viewOpts.lc), 2.0);
    c(); app.editor?.refreshPanel(true);
  } })));
  return out;
}

// ------------------------------------------------------------------ Eigenschaftsfenster

function slabArea(sl) {
  return Math.abs(signedArea(sl.outline.map((q) => [num(q.x), num(q.y)])));
}

function inspectSlab(app, k) {
  const p = app.project;
  const sl = p.slabs[k];
  const c = ch(app);
  const A = slabArea(sl);
  const out = [
    textField('Bezeichnung', sl, 'name', { onChange: c }),
    h('div', { class: 'grid2' },
      numField('Dicke h', sl, 'h', { unit: 'm', min: 0.05, max: 3, digits: 3, onChange: c, info: 'Plattendicke. Richtwert h ≈ L/30 (zweiachsig) bzw. L/25 (Flachdecke). Liegt diese Platte in einer anderen, gilt hier ihre Dicke.' }),
      selectField('Beton', sl, 'concrete', concreteOptions(p), { onChange: c, info: 'Leer = Projektbeton (Register «Platten»).' })),
    h('div', { class: 'muted small' }, rich(`${sl.outline.length} Eckpunkte · ${fmt(A, 2)} m² · g_0 = ${fmt(25 * num(sl.h), 2)} kN/m²`)),
    sub('Flächenlasten auf der ganzen Platte'),
    ...regionLoads(app, sl.id),
    sub('Lager'),
    h('div', { class: 'row' },
      button('Wände an freien Rändern', { icon: 'plus', small: true, title: 'Für jeden freien Rand dieser Platte ein Linienlager ergänzen (gemeinsame Ränder mit anderen Platten ausgenommen)', onClick: () => {
        const n = addWallsOnFreeEdges(p, k);
        app.status(n ? `${n} Wände ergänzt` : 'Alle freien Ränder sind bereits gelagert', n ? 'ok' : 'warn');
        refresh(app)();
      } })),
  ];
  const s = resultsSet(app);
  if (s) {
    out.push(sub('Ergebnisse', s.name), kvTable([
      ['w_max (alle Platten)', s.wmax * 1000, 'mm', 2],
      ['m_x min / max', `${fmt(s.mExt.mx[0], 1)} / ${fmt(s.mExt.mx[1], 1)}`, 'kNm/m'],
      ['m_y min / max', `${fmt(s.mExt.my[0], 1)} / ${fmt(s.mExt.my[1], 1)}`, 'kNm/m'],
    ]), staleNote(app));
  }
  return { title: sl.name || `Platte ${k + 1}`, content: out };
}

function inspectVertex(app, list, i, owner, canDelete) {
  const q = list[i];
  const c = ch(app);
  return {
    title: `${owner} – Punkt ${i + 1}`,
    content: [
      h('div', { class: 'grid2' }, numField('x', q, 'x', { unit: 'm', onChange: c }), numField('y', q, 'y', { unit: 'm', onChange: c })),
      h('div', { class: 'muted small' }, canDelete ? 'Entf löscht den Punkt. Ziehen verschiebt ihn samt verbundener Punkte.' : 'Ein Polygon braucht mindestens drei Punkte.'),
    ],
  };
}

function inspectEdge(app, list, i, slabIdx, holeIdx = -1) {
  const p = app.project;
  const a = list[i], b = list[(i + 1) % list.length];
  const L = Math.hypot(num(b.x) - num(a.x), num(b.y) - num(a.y));
  const isSlab = slabIdx >= 0;
  const vPrefix = isSlab ? `sv:${slabIdx}` : `hv:${holeIdx}`;
  const out = [
    h('div', { class: 'muted small' }, `(${fmt(num(a.x), 2)} / ${fmt(num(a.y), 2)}) → (${fmt(num(b.x), 2)} / ${fmt(num(b.y), 2)}) · L = ${fmt(L, 3)} m`),
    h('div', { class: 'row' },
      button('Punkt einfügen', { icon: 'plus', small: true, title: 'Teilt die Kante in der Mitte; der neue Punkt kann anschliessend verschoben werden', onClick: () => {
        const k = insertMidpoint(list, i);
        app.changed({ inputs: true });
        app.editor.select([`${vPrefix}:${k}`]);
      } }),
      isSlab ? button('Wand auf Kante', { icon: 'plus', small: true, onClick: () => {
        const k = addWallsOnEdges(p, [i], slabIdx);
        app.status(k ? 'Wand ergänzt' : 'Auf dieser Kante liegt bereits eine Wand', k ? 'ok' : 'warn');
        refresh(app)();
      } }) : null),
  ];
  return { title: isSlab ? `${p.slabs[slabIdx].name}: Rand ${i + 1}–${(i + 1) % list.length + 1}` : 'Kante der Öffnung', content: out };
}

function inspectOpening(app, k) {
  const o = app.project.openings[k];
  const A = Math.abs(signedArea(o.pts.map((q) => [num(q.x), num(q.y)])));
  return {
    title: `Öffnung ${k + 1}`,
    content: [
      textField('Bezeichnung', o, 'name', { onChange: ch(app) }),
      h('div', { class: 'muted small' }, `${o.pts.length} Eckpunkte · ${fmt(A, 2)} m². Öffnungen näher als 5d (SIA) bzw. 6d (EC) bei Stützen verkürzen den Nachweisschnitt automatisch.`),
    ],
  };
}

function inspectArea(app, k) {
  const p = app.project;
  const ar = p.loadAreas[k];
  const A = Math.abs(signedArea(ar.pts.map((q) => [num(q.x), num(q.y)])));
  return {
    title: ar.name || `Lastfläche ${k + 1}`,
    content: [
      textField('Bezeichnung', ar, 'name', { onChange: ch(app) }),
      h('div', { class: 'muted small' }, `${ar.pts.length} Eckpunkte · ${fmt(A, 2)} m²`),
      sub('Flächenlasten'),
      ...regionLoads(app, ar.id),
    ],
  };
}

function inspectColumn(app, i) {
  const p = app.project;
  const s = p.pointSupports[i];
  const c = ch(app);
  const out = [
    h('div', { class: 'grid2' },
      numField('x', s, 'x', { unit: 'm', onChange: c }), numField('y', s, 'y', { unit: 'm', onChange: c }),
      numField('b', s, 'b', { unit: 'm', min: 0, digits: 3, onChange: c, info: 'Abmessung in x-Richtung (Durchstanzen, starrer Stützenkopf). 0 = reines Punktlager.' }),
      numField('h', s, 'hc', { unit: 'm', min: 0, digits: 3, onChange: c, info: 'Abmessung in y-Richtung.' }),
      numField('Feder k_z', s, 'kz', { unit: 'kN/m', min: 0, allowEmpty: true, onChange: c, info: I('Leer = starr. Stütze darunter: k_z ≈ E·A/L.') }),
      numField('Drehfeder k_φ', s, 'kr', { unit: 'kNm/rad', min: 0, allowEmpty: true, onChange: c, info: I('Leer = gelenkig. Einspannung durch Stützen: k_φ ≈ 4·E·I/L je Geschoss.') })),
  ];
  if (!onSlab(p, num(s.x), num(s.y))) out.push(note('Die Stütze liegt ausserhalb der Platten und wird ignoriert.', 'warn'));
  else if (p.slabs.length > 1) {
    const k = slabAt(p, num(s.x), num(s.y));
    if (k >= 0) out.push(h('div', { class: 'muted small' }, `In «${p.slabs[k].name}» (h = ${fmt(num(p.slabs[k].h), 2)} m)`));
  }
  const r = app.results;
  const set = resultsSet(app);
  if (r && set) {
    const k = r.supports.findIndex((sp) => sp.kind === 'point' && sp.i === i);
    out.push(sub('Ergebnisse', set.name));
    if (k >= 0) out.push(kvTable([['Stützenkraft R', set.supportForces[k].value, 'kN', 1]]));
    const pc = r.punching.find((q) => q.name === `S${i + 1}`);
    if (pc && !pc.skip) {
      out.push(sub('Durchstanzen', r.norm === 'SIA' ? 'SIA 262, 4.3.6' : 'EN 1992-1-1, 6.4'));
      out.push(kvTable([
        ['Stützentyp', TYPE_LABEL[pc.type] || pc.type],
        ['V_d / V_Rd,c', `${fmt(pc.Vd, 1)} / ${fmt(pc.VRd, 1)}`, 'kN'],
        ['Nachweisschnitt u', pc.u, 'm', 2],
      ]));
      out.push(h('div', { class: 'row' }, utilBar(pc.eta),
        pc.eta <= 1 ? badge('erfüllt', 'ok') : pc.res.possible ? badge('Durchstanzbewehrung nötig', 'warn') : badge('V_Rd,max überschritten', 'fail')));
      out.push(button('Herleitung ›', { small: true, ghost: true, title: 'Rechenweg dieses Nachweises', onClick: () => app.showDerivation?.(`p-${pc.name}`) }));
    } else if (pc?.skip) out.push(h('div', { class: 'muted small' }, 'Kein Durchstanznachweis (keine Druckkraft).'));
    else if (!(num(s.b) > 0 && num(s.hc) > 0)) out.push(h('div', { class: 'muted small' }, 'Für den Durchstanznachweis b und h eingeben.'));
    out.push(staleNote(app));
  }
  return { title: `Stütze S${i + 1}`, content: out };
}

function inspectWall(app, i) {
  const p = app.project;
  const w = p.lineSupports[i];
  const c = ch(app);
  const L = Math.hypot(num(w.x2) - num(w.x1), num(w.y2) - num(w.y1));
  const out = [
    h('div', { class: 'grid2' },
      numField('x_1', w, 'x1', { unit: 'm', onChange: c }), numField('y_1', w, 'y1', { unit: 'm', onChange: c }),
      numField('x_2', w, 'x2', { unit: 'm', onChange: c }), numField('y_2', w, 'y2', { unit: 'm', onChange: c })),
    checkField('eingespannt', w, 'clamped', { onChange: c, info: 'Keine Verdrehung um die Wandachse (z.B. Kragplatte, biegesteifer Anschluss). Sonst gelenkig gelagert.' }),
    h('div', { class: 'muted small' }, `L = ${fmt(L, 3)} m`),
  ];
  const r = app.results;
  const set = resultsSet(app);
  if (r && set) {
    const k = r.supports.findIndex((sp) => sp.kind === 'line' && sp.i === i);
    if (k >= 0) {
      const f = set.supportForces[k];
      out.push(sub('Ergebnisse', set.name), kvTable([
        ['Wandkraft Σ', f.total, 'kN', 1],
        ['r max / min', `${fmt(f.maxR, 1)} / ${fmt(f.minR, 1)}`, 'kN/m'],
        ['r mittel', L > 0 ? f.total / L : NaN, 'kN/m', 1],
      ]), staleNote(app));
    }
  }
  return { title: `Wand W${i + 1}`, content: out };
}

function inspectLineLoad(app, i) {
  const p = app.project;
  const l = p.lineLoads[i];
  const c = ch(app);
  return {
    title: `Linienlast ${i + 1}`,
    content: [
      selectField('Lastfall', l, 'lc', lcOptions(p), { wide: true, onChange: c }),
      h('div', { class: 'grid2' },
        numField('p Anfang', l, 'p1', { unit: 'kN/m', onChange: c, info: 'Positiv nach unten.' }),
        numField('p Ende', l, 'p2', { unit: 'kN/m', allowEmpty: true, onChange: c, info: 'Leer = konstant (gleich p Anfang).' }),
        numField('x_1', l, 'x1', { unit: 'm', onChange: c }), numField('y_1', l, 'y1', { unit: 'm', onChange: c }),
        numField('x_2', l, 'x2', { unit: 'm', onChange: c }), numField('y_2', l, 'y2', { unit: 'm', onChange: c })),
    ],
  };
}

function inspectPointLoad(app, i) {
  const p = app.project;
  const l = p.pointLoads[i];
  const c = ch(app);
  return {
    title: `Punktlast ${i + 1}`,
    content: [
      selectField('Lastfall', l, 'lc', lcOptions(p), { wide: true, onChange: c }),
      h('div', { class: 'grid2' },
        numField('P', l, 'P', { unit: 'kN', onChange: c, info: 'Positiv nach unten. Unter Punktlasten sind die Momente singulär (netzabhängig).' }),
        h('span'),
        numField('x', l, 'x', { unit: 'm', onChange: c }), numField('y', l, 'y', { unit: 'm', onChange: c })),
    ],
  };
}

function inspectMulti(app, ids) {
  const p = app.project;
  const parsed = ids.map(parseId);
  const count = (...ts) => parsed.filter((x) => ts.includes(x.t)).length;
  const parts = [
    [count('s'), 'Platten'], [count('c'), 'Stützen'], [count('w', 'we'), 'Wände'], [count('ll', 'le', 'pl', 'a', 'av'), 'Lasten/Lastflächen'],
    [count('sv', 'se'), 'Randpunkte/-kanten'], [count('h', 'hv', 'he'), 'Öffnungselemente'],
  ].filter(([n]) => n).map(([n, t]) => `${n} ${t}`);
  const out = [h('div', { class: 'muted small' }, parts.join(' · ') || `${ids.length} Elemente`)];
  const slabs = parsed.filter((x) => x.t === 's' && p.slabs[x.a]).map((x) => p.slabs[x.a]);
  if (slabs.length) {
    const tmp = { h: slabs[0].h };
    out.push(sub('Alle gewählten Platten'), numField('Dicke h', tmp, 'h', { unit: 'm', min: 0.05, max: 3, digits: 3, onChange: () => { for (const s of slabs) s.h = tmp.h; app.changed({ inputs: true }); } }));
  }
  const cols = parsed.filter((x) => x.t === 'c' && p.pointSupports[x.a]).map((x) => p.pointSupports[x.a]);
  if (cols.length) {
    const tmp = { b: cols[0].b, hc: cols[0].hc };
    const apply = () => { for (const s of cols) { s.b = tmp.b; s.hc = tmp.hc; } app.changed({ inputs: true }); };
    out.push(sub('Alle gewählten Stützen'), h('div', { class: 'grid2' }, numField('b', tmp, 'b', { unit: 'm', min: 0, onChange: apply }), numField('h', tmp, 'hc', { unit: 'm', min: 0, onChange: apply })));
  }
  const walls = parsed.filter((x) => x.t === 'w' && p.lineSupports[x.a]).map((x) => p.lineSupports[x.a]);
  if (walls.length) {
    const tmp = { clamped: walls.every((w) => w.clamped) };
    out.push(checkField('Gewählte Wände eingespannt', tmp, 'clamped', { onChange: (v) => { for (const w of walls) w.clamped = v; app.changed({ inputs: true }); } }));
  }
  const edges = parsed.filter((x) => x.t === 'se');
  if (edges.length) out.push(button('Wände auf gewählten Kanten', { icon: 'plus', small: true, onClick: () => { let k = 0; for (const e of edges) k += addWallsOnEdges(p, [e.b], e.a); app.status(`${k} Wände ergänzt`, 'ok'); refresh(app)(); } }));
  out.push(h('div', { class: 'muted small' }, 'Ziehen verschiebt alle gewählten Elemente, Entf löscht sie, C kopiert.'));
  return { title: `${ids.length} Elemente`, content: out };
}

/** Editor-ID für eine Tabellenzeile (Synchronisation Tabelle → Grafik). */
export function idForRow(kind, i, j) {
  switch (kind) {
    case 'slab': return [Number.isInteger(j) ? `sv:${i}:${j}` : `s:${i}`];
    case 'opening': return [Number.isInteger(j) ? `hv:${i}:${j}` : `h:${i}`];
    case 'area': return [Number.isInteger(j) ? `av:${i}:${j}` : `a:${i}`];
    case 'ps': return [`c:${i}`];
    case 'ls': return [`w:${i}`];
    case 'll': return [`ll:${i}`];
    case 'pl': return [`pl:${i}`];
    default: return [];
  }
}
