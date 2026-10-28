// Grafische Bearbeitung der Platte: Werkzeuge, Geometrie für den Editor, Eigenschaftsfenster
import { h, numField, selectField, checkField, textField, button, kvTable, note, badge, utilBar } from '../../js/core/ui.js';
import { fmt } from '../../js/core/format.js';
import { TOOL_ICONS } from '../../js/core/editor.js';
import { CONCRETE_CLASSES, NORMS } from '../../js/core/materials.js';
import {
  parseId, moveSelection, copySelection, removeSelection, createElement, insertMidpoint, addWallsOnEdges, activeLoadCase, onSlab,
} from './model.js';
import { signedArea } from './geom.js';
import { currentSet } from './views.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const EDIT_MODES = ['system', 'mesh'];
const TYPE_LABEL = { innen: 'Innenstütze', rand: 'Randstütze', ecke: 'Eckstütze' };

const ICON_AREA = '<path d="M4 6h16v12H4z" stroke-dasharray="3 2"/><path d="M8 3v6M12 3v6M16 3v6M7 7l1 2 1-2M11 7l1 2 1-2M15 7l1 2 1-2"/>';
const ICON_LINELOAD = '<path d="M3 18h18"/><path d="M6 6v9M12 6v9M18 6v9M4.5 13l1.5 2 1.5-2M10.5 13l1.5 2 1.5-2M16.5 13l1.5 2 1.5-2"/>';

export const editorSpec = {
  axes: ['x', 'y'],
  unit: 'm',
  digits: 3,
  grid: [0.05, 0.1, 0.25, 0.5, 1],
  gridDefault: 0.25,
  modes: ['system'],
  canCopy: true,
  tools: [
    { id: 'outline', label: 'Umriss', key: 'u', form: 'polygon', icon: TOOL_ICONS.polygon, title: 'Plattenrand zeichnen: Eckpunkte nacheinander anklicken, Klick auf den ersten Punkt oder Doppelklick schliesst (ersetzt einen vorhandenen Rand)', prompts: ['Ersten Eckpunkt der Platte setzen.', 'Nächsten Eckpunkt setzen – Klick auf den ersten Punkt oder Doppelklick schliesst den Umriss.'] },
    { id: 'opening', label: 'Öffnung', key: 'o', form: 'rect', icon: TOOL_ICONS.opening, title: 'Rechteckige Öffnung: zwei gegenüberliegende Ecken anklicken', prompts: ['Erste Ecke der Öffnung setzen.', 'Gegenüberliegende Ecke setzen.'] },
    { id: 'column', label: 'Stütze', key: 's', form: 'point', icon: TOOL_ICONS.column, title: 'Stütze (Punktlager) setzen; Abmessungen b × h und Federn im Eigenschaftsfenster' },
    { id: 'wall', label: 'Wand', key: 'w', form: 'chain', icon: TOOL_ICONS.wall, title: 'Wand (Linienlager) zeichnen: Punkte nacheinander anklicken, Esc beendet', prompts: ['Anfangspunkt der Wand setzen.', 'Endpunkt setzen – weiterzeichnen oder Esc.'] },
    { id: 'area', label: 'Flächenlast', key: 'f', form: 'polygon', icon: ICON_AREA, title: 'Lastfläche zeichnen (Polygon); die ganze Platte trägt Flächenlasten über die Tabelle «Lasten»', prompts: ['Ersten Eckpunkt der Lastfläche setzen.', 'Nächsten Eckpunkt – Klick auf den ersten Punkt schliesst.'] },
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
      p.outline.forEach((q, i) => { const r = P(q); if (ok(r)) points.push({ id: `ov:${i}`, p: r, label: `Eckpunkt ${i + 1}` }); });
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
      const n = p.outline.length;
      if (n >= 2) p.outline.forEach((q, i) => { if (n >= 3 || i === 0) seg(`oe:${i}`, P(q), P(p.outline[(i + 1) % n]), `Rand ${i + 1}–${(i + 1) % n + 1}`); });
      p.openings.forEach((o, k) => { if (o.pts.length >= 3) regions.push({ id: `h:${k}`, ring: o.pts.map(P), label: o.name || `Öffnung ${k + 1}` }); });
      p.loadAreas.forEach((a, k) => { if (a.pts.length >= 3) regions.push({ id: `a:${k}`, ring: a.pts.map(P), label: a.name || `Lastfläche ${k + 1}` }); });
      if (n >= 3) regions.push({ id: 'slab', ring: p.outline.map(P), label: 'Platte' });
    }
    return { points, segments, regions };
  },

  create(app, tool, pts) {
    const p = app.project;
    const r = createElement(p, tool, pts, { lc: app.viewOpts.lc });
    if (r.msg) app.status(r.msg, r.kind);
    if (tool === 'outline') {
      if (p.lineSupports.length === 0 && p.pointSupports.length === 0) app.view.fitted = false;
      // nach dem Umriss zurück zur Auswahl: die Plattenfläche ist gewählt, das Fenster bietet «Wände an allen Rändern»
      setTimeout(() => { app.editor?.setTool('select'); app.editor?.select(['slab']); }, 0);
    }
    return r.ids;
  },

  move(app, ids, d, { copy }) {
    const p = app.project;
    if (copy) {
      const out = copySelection(p, ids, d);
      app.status(out.length ? `${out.length} Element${out.length === 1 ? '' : 'e'} kopiert` : 'Plattenrand und Eckpunkte lassen sich nicht kopieren', out.length ? 'ok' : 'warn');
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
      if (t === 'slab') return inspectSlab(app);
      if (t === 'ov' && p.outline[a]) return inspectVertex(app, p.outline, a, 'Plattenrand', 'ov', p.outline.length > 3);
      if (t === 'oe' && p.outline[a]) return inspectEdge(app, p.outline, a, 'oe');
      if (t === 'h' && p.openings[a]) return inspectOpening(app, a);
      if (t === 'hv' && p.openings[a]?.pts[b]) return inspectVertex(app, p.openings[a].pts, b, `Öffnung ${a + 1}`, `hv:${a}`, p.openings[a].pts.length > 3);
      if (t === 'he' && p.openings[a]?.pts[b]) return inspectEdge(app, p.openings[a].pts, b, `he:${a}`);
      if (t === 'a' && p.loadAreas[a]) return inspectArea(app, a);
      if (t === 'av' && p.loadAreas[a]?.pts[b]) return inspectVertex(app, p.loadAreas[a].pts, b, p.loadAreas[a].name || `Lastfläche ${a + 1}`, `av:${a}`, p.loadAreas[a].pts.length > 3);
      if (t === 'c' && p.pointSupports[a]) return inspectColumn(app, a);
      if ((t === 'w' || t === 'we') && p.lineSupports[a]) return inspectWall(app, a);
      if ((t === 'll' || t === 'le') && p.lineLoads[a]) return inspectLineLoad(app, a);
      if (t === 'pl' && p.pointLoads[a]) return inspectPointLoad(app, a);
    }
    return inspectMulti(app, ids);
  },

  idleHint(app) {
    const p = app.project;
    if (p.outline.length < 3) return h('span', {}, 'Wählen Sie oben ', h('b', {}, 'Umriss'), ' (Taste U) und klicken Sie die Eckpunkte der Platte; Klick auf den ersten Punkt oder Doppelklick schliesst. Koordinaten lassen sich auch tippen. Für Rechteckplatten: Register «Geometrie» › «Rechteck …».');
    if (!p.pointSupports.length && !p.lineSupports.length) return h('span', {}, 'Als Nächstes die Lager: ', h('b', {}, 'Wand'), ' (W) entlang der Ränder zeichnen oder ', h('b', {}, 'Stütze'), ' (S) setzen. Tipp: Plattenfläche anklicken › «Wände an allen Rändern».');
    const loads = p.areaLoads.length + p.lineLoads.length + p.pointLoads.length;
    if (!loads) return h('span', {}, 'Lasten: Das Eigengewicht ist automatisch enthalten. Flächenlasten auf die ganze Platte im Register «Lasten»; Teilflächen, Linien- und Punktlasten mit ', h('b', {}, 'Flächenlast'), ' (F), ', h('b', {}, 'Linienlast'), ' (L), ', h('b', {}, 'Punktlast'), ' (P). Dann ', h('b', {}, 'Berechnen'), ' (Ctrl+Enter).');
    return h('span', {}, 'Element anklicken, um es zu bearbeiten. Ziehen verschiebt – verbundene Punkte (z.B. Wandenden an Ecken) gehen mit; X/Y binden an eine Achse, M fängt die Mitte zweier Punkte. Nach Änderungen: ', h('b', {}, 'Berechnen'), ' (Ctrl+Enter).');
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

// ------------------------------------------------------------------ Eigenschaftsfenster

function inspectSlab(app) {
  const p = app.project;
  const ring = p.outline.map((q) => [num(q.x), num(q.y)]);
  let A = Math.abs(signedArea(ring));
  for (const o of p.openings) A -= Math.abs(signedArea(o.pts.map((q) => [num(q.x), num(q.y)])));
  let U = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; U += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const c = ch(app);
  const out = [
    h('div', { class: 'muted small' }, `${ring.length} Eckpunkte · Fläche ${fmt(A, 2)} m² · Umfang ${fmt(U, 2)} m`),
    h('div', { class: 'grid2' },
      numField('Dicke h', p, 'h', { unit: 'm', min: 0.05, max: 3, digits: 3, onChange: c, info: 'Konstante Plattendicke. Richtwert h ≈ L/30 (zweiachsig gespannt) bzw. L/25 (Flachdecke).' }),
      numField('Netzweite', p, 'meshSize', { unit: 'm', min: 0.02, digits: 3, onChange: c, info: 'Mittlere Elementgrösse, Richtwert Spannweite/12 … /20.' })),
    selectField('Beton', p, 'concrete', CONCRETE_CLASSES, { wide: true, onChange: c }),
    selectField('Norm', p, 'norm', NORMS, { wide: true, onChange: c }),
    h('div', { class: 'muted small' }, `Eigengewicht g₀ = 25 kN/m³ · h = ${fmt(25 * num(p.h), 2)} kN/m²`),
    h('div', { class: 'row' },
      button('Wände an allen Rändern', { icon: 'plus', small: true, title: 'Für jede Randkante ein Linienlager ergänzen', onClick: () => {
        const k = addWallsOnEdges(p, p.outline.map((_, i) => i));
        app.status(k ? `${k} Wände ergänzt` : 'Alle Ränder sind bereits gelagert', k ? 'ok' : 'warn');
        refresh(app)();
      } })),
  ];
  const s = resultsSet(app);
  if (s) {
    out.push(sub('Ergebnisse', s.name));
    out.push(kvTable([
      ['w max', s.wmax * 1000, 'mm', 2],
      ['mx min / max', `${fmt(s.mExt.mx[0], 1)} / ${fmt(s.mExt.mx[1], 1)}`, 'kNm/m'],
      ['my min / max', `${fmt(s.mExt.my[0], 1)} / ${fmt(s.mExt.my[1], 1)}`, 'kNm/m'],
      ['Σ Lasten = Σ Lager', `${fmt(s.sumF, 1)} = ${fmt(s.sumR, 1)}`, 'kN'],
    ]), staleNote(app));
  }
  return { title: 'Platte', content: out };
}

function inspectVertex(app, list, i, owner, prefix, canDelete) {
  const q = list[i];
  const c = ch(app);
  return {
    title: `${owner} – Punkt ${i + 1}`,
    content: [
      h('div', { class: 'grid2' }, numField('x', q, 'x', { unit: 'm', onChange: c }), numField('y', q, 'y', { unit: 'm', onChange: c })),
      h('div', { class: 'muted small' }, canDelete ? 'Entf löscht den Punkt. Ziehen verschiebt ihn samt verbundener Wand- und Lastenden.' : 'Ein Polygon braucht mindestens drei Punkte.'),
      void prefix,
    ],
  };
}

function inspectEdge(app, list, i, prefix) {
  const p = app.project;
  const a = list[i], b = list[(i + 1) % list.length];
  const L = Math.hypot(num(b.x) - num(a.x), num(b.y) - num(a.y));
  const isOutline = prefix === 'oe';
  const vPrefix = isOutline ? 'ov' : prefix.replace('he', 'hv');
  const out = [
    h('div', { class: 'muted small' }, `(${fmt(num(a.x), 2)} / ${fmt(num(a.y), 2)}) → (${fmt(num(b.x), 2)} / ${fmt(num(b.y), 2)}) · L = ${fmt(L, 3)} m`),
    h('div', { class: 'row' },
      button('Punkt in der Mitte einfügen', { icon: 'plus', small: true, title: 'Teilt die Kante; der neue Punkt kann anschliessend verschoben werden', onClick: () => {
        const k = insertMidpoint(list, i);
        app.changed({ inputs: true });
        app.editor.select([`${vPrefix}:${k}`]);
      } }),
      isOutline ? button('Wand auf dieser Kante', { icon: 'plus', small: true, onClick: () => {
        const k = addWallsOnEdges(p, [i]);
        app.status(k ? 'Wand ergänzt' : 'Auf dieser Kante liegt bereits eine Wand', k ? 'ok' : 'warn');
        refresh(app)();
      } }) : null),
  ];
  return { title: isOutline ? `Plattenrand ${i + 1}–${(i + 1) % list.length + 1}` : 'Kante der Öffnung', content: out };
}

function inspectOpening(app, k) {
  const o = app.project.openings[k];
  const A = Math.abs(signedArea(o.pts.map((q) => [num(q.x), num(q.y)])));
  return {
    title: `Öffnung ${k + 1}`,
    content: [
      textField('Bezeichnung', o, 'name', { onChange: ch(app) }),
      h('div', { class: 'muted small' }, `${o.pts.length} Eckpunkte · Fläche ${fmt(A, 2)} m²`),
      h('div', { class: 'muted small' }, 'Öffnungen näher als 5d (SIA) bzw. 6d (EC) bei Stützen verkürzen den Durchstanz-Nachweisschnitt automatisch.'),
    ],
  };
}

function inspectArea(app, k) {
  const p = app.project;
  const ar = p.loadAreas[k];
  const A = Math.abs(signedArea(ar.pts.map((q) => [num(q.x), num(q.y)])));
  const loads = p.areaLoads.filter((l) => l.region === ar.id);
  const c = ch(app);
  const out = [
    textField('Bezeichnung', ar, 'name', { onChange: c }),
    h('div', { class: 'muted small' }, `${ar.pts.length} Eckpunkte · Fläche ${fmt(A, 2)} m²`),
    sub('Flächenlasten auf dieser Fläche'),
  ];
  for (const l of loads) {
    out.push(h('div', { class: 'ed-load' },
      h('div', { class: 'grid2' },
        selectField('Lastfall', l, 'lc', lcOptions(p), { onChange: c }),
        numField('q', l, 'q', { unit: 'kN/m²', onChange: c, info: 'Positiv = nach unten.' })),
      button('', { icon: 'trash', small: true, ghost: true, title: 'Last entfernen', onClick: () => { p.areaLoads.splice(p.areaLoads.indexOf(l), 1); refresh(app)(); } })));
  }
  if (!loads.length) out.push(h('div', { class: 'muted small' }, 'Noch keine Last auf dieser Fläche.'));
  out.push(button('Flächenlast', { icon: 'plus', small: true, onClick: () => { p.areaLoads.push({ lc: activeLoadCase(p, app.viewOpts.lc), q: 2.0, region: ar.id }); refresh(app)(); } }));
  return { title: ar.name || `Lastfläche ${k + 1}`, content: out };
}

function inspectColumn(app, i) {
  const p = app.project;
  const s = p.pointSupports[i];
  const c = ch(app);
  const out = [
    h('div', { class: 'grid2' }, numField('x', s, 'x', { unit: 'm', onChange: c }), numField('y', s, 'y', { unit: 'm', onChange: c })),
    h('div', { class: 'grid2' },
      numField('b', s, 'b', { unit: 'm', min: 0, digits: 3, onChange: c, info: 'Abmessung in x-Richtung (für Durchstanzen und starren Stützenkopf). 0 = reines Punktlager.' }),
      numField('h', s, 'hc', { unit: 'm', min: 0, digits: 3, onChange: c, info: 'Abmessung in y-Richtung.' })),
    h('div', { class: 'grid2' },
      numField('Feder kz', s, 'kz', { unit: 'kN/m', min: 0, allowEmpty: true, onChange: c, info: 'Leer = starr. Stütze darunter: kz ≈ E·A/L.' }),
      numField('Drehfeder kφ', s, 'kr', { unit: 'kNm/rad', min: 0, allowEmpty: true, onChange: c, info: 'Leer = gelenkig. Einspannung durch die Stützen: kφ ≈ 4·E·I/L je Geschoss.' })),
  ];
  if (!onSlab(p, num(s.x), num(s.y))) out.push(note('Die Stütze liegt ausserhalb der Platte und wird ignoriert.', 'warn'));
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
        ['Vd (GZT)', pc.Vd, 'kN', 1],
        [r.norm === 'SIA' ? 'VRd,c' : 'VRd,c (aus vRd,c)', pc.VRd, 'kN', 1],
        ['Nachweisschnitt u', pc.u, 'm', 2],
      ]));
      out.push(h('div', { class: 'row', style: { alignItems: 'center' } }, utilBar(pc.eta),
        pc.eta <= 1 ? badge('erfüllt', 'ok') : pc.res.possible ? badge('Durchstanzbewehrung nötig', 'warn') : badge('VRd,max überschritten', 'fail')));
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
    h('div', { class: 'grid2' }, numField('x₁', w, 'x1', { unit: 'm', onChange: c }), numField('y₁', w, 'y1', { unit: 'm', onChange: c })),
    h('div', { class: 'grid2' }, numField('x₂', w, 'x2', { unit: 'm', onChange: c }), numField('y₂', w, 'y2', { unit: 'm', onChange: c })),
    h('div', { class: 'muted small' }, `L = ${fmt(L, 3)} m`),
    checkField('eingespannt (keine Verdrehung um die Wandachse)', w, 'clamped', { onChange: c, info: 'Z.B. Kragplatte oder biegesteifer Anschluss an eine steife Wand. Sonst gelenkig gelagert.' }),
  ];
  const r = app.results;
  const set = resultsSet(app);
  if (r && set) {
    const k = r.supports.findIndex((sp) => sp.kind === 'line' && sp.i === i);
    if (k >= 0) {
      const f = set.supportForces[k];
      out.push(sub('Ergebnisse', set.name), kvTable([
        ['Wandkraft Σ', f.total, 'kN', 1],
        ['Linienlast max / min', `${fmt(f.maxR, 1)} / ${fmt(f.minR, 1)}`, 'kN/m'],
        ['Mittelwert', L > 0 ? f.total / L : NaN, 'kN/m', 1],
      ]), h('div', { class: 'muted small' }, 'Verlauf in der Ansicht «Reaktionen». Spitzen an Wandenden sind modellbedingt.'), staleNote(app));
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
        numField('p Ende', l, 'p2', { unit: 'kN/m', allowEmpty: true, onChange: c, info: 'Leer = konstant (gleich p Anfang).' })),
      h('div', { class: 'grid2' }, numField('x₁', l, 'x1', { unit: 'm', onChange: c }), numField('y₁', l, 'y1', { unit: 'm', onChange: c })),
      h('div', { class: 'grid2' }, numField('x₂', l, 'x2', { unit: 'm', onChange: c }), numField('y₂', l, 'y2', { unit: 'm', onChange: c })),
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
      numField('P', l, 'P', { unit: 'kN', onChange: c, info: 'Positiv nach unten. Unter Punktlasten sind die Momente singulär (netzabhängig).' }),
      h('div', { class: 'grid2' }, numField('x', l, 'x', { unit: 'm', onChange: c }), numField('y', l, 'y', { unit: 'm', onChange: c })),
    ],
  };
}

function inspectMulti(app, ids) {
  const p = app.project;
  const parsed = ids.map(parseId);
  const count = (...ts) => parsed.filter((x) => ts.includes(x.t)).length;
  const parts = [
    [count('c'), 'Stützen'], [count('w', 'we'), 'Wände'], [count('ll', 'le', 'pl', 'a', 'av'), 'Lasten/Lastflächen'],
    [count('ov', 'oe', 'slab'), 'Randelemente'], [count('h', 'hv', 'he'), 'Öffnungselemente'],
  ].filter(([n]) => n).map(([n, t]) => `${n} ${t}`);
  const out = [h('div', { class: 'muted small' }, parts.join(' · ') || `${ids.length} Elemente`)];
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
  const edges = parsed.filter((x) => x.t === 'oe').map((x) => x.a);
  if (edges.length) out.push(button('Wände auf gewählten Randkanten', { icon: 'plus', small: true, onClick: () => { const k = addWallsOnEdges(p, edges); app.status(`${k} Wände ergänzt`, 'ok'); refresh(app)(); } }));
  out.push(note('Ziehen verschiebt alle gewählten Elemente (verbundene Punkte gehen mit), Entf löscht sie, C kopiert Stützen, Wände, Lasten und Öffnungen.'));
  return { title: `${ids.length} Elemente`, content: out };
}

/** Editor-ID für eine Tabellenzeile (Synchronisation Tabelle → Grafik). */
export function idForRow(kind, i, j) {
  switch (kind) {
    case 'outline': return [`ov:${i}`];
    case 'opening': return [Number.isInteger(j) ? `hv:${i}:${j}` : `h:${i}`];
    case 'area': return [Number.isInteger(j) ? `av:${i}:${j}` : `a:${i}`];
    case 'ps': return [`c:${i}`];
    case 'ls': return [`w:${i}`];
    case 'll': return [`ll:${i}`];
    case 'pl': return [`pl:${i}`];
    default: return [];
  }
}
