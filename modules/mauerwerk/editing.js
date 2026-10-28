// Grafische Bearbeitung Mauerwerk: Werkzeuge, Geometrie für den Editor und Eigenschaftsfenster.
//
// Bearbeitet wird in der Ansicht (x entlang der Wand, y über die Höhe, Ursprung am linken Wandfuss).
// In «Schnitt» und «Schub» lassen sich Lasten und Wand anklicken (Eigenschaften), aber nicht ziehen.
import { h, numField, selectField, checkField, button, kvTable, note, fmt, utilBar } from '../../js/core/ui.js';
import { TOOL_ICONS } from '../../js/core/editor.js';
import { MASONRY_TYPES, typeById, applyTypeDefaults, designValues } from './materials.js';
import { effectiveHeight, sideFlags, setSides } from './calc.js';
import { SLAB, schnittScale, pickCombo } from './view.js';

const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MIN_L = 0.3, MIN_H = 0.5, MIN_O = 0.1;

const ICON_H = '<path d="M3 12h15M14 7l5 5-5 5"/><path d="M3 5v14" stroke-dasharray="2 2"/>';
const ICON_Q = '<circle cx="12" cy="12" r="7"/><path d="M7 7l10 10M17 7L7 17"/>';
const ICON_SIDE = '<path d="M5 3v18M19 3v18" stroke-width="3"/><path d="M8 12h8" stroke-dasharray="2 2"/>';

/** Ist irgendeine Einwirkung erfasst? (gleich wie hasLoads in calc.js, hier für Hinweise) */
function anyLoad(L) {
  return !!(L.gW || L.qW || L.gD || L.qD || L.wind || L.earth?.on || L.Vw || L.Ve || (L.conc?.on && (L.conc.G || L.conc.Q)));
}

function opening(p, i) { return p.wall.openings[i]; }

/** Öffnungen und Einzellast nach einer Änderung der Wandabmessungen in die Wand zurückschieben. */
export function fitIntoWall(p) {
  const W = p.wall;
  for (const o of W.openings || []) {
    o.b = r3(Math.min(o.b, Math.max(MIN_O, W.l - 0.2)));
    o.hgt = r3(Math.min(o.hgt, Math.max(MIN_O, W.h)));
    o.x = r3(clamp(o.x, 0, W.l - o.b));
    o.y = r3(clamp(o.y, 0, W.h - o.hgt));
  }
  const C = p.loads.conc;
  if (C) {
    const a = (C.a || 0) / 1000;
    if (a > W.l) C.a = Math.round(W.l * 1000);
    C.x = r3(clamp(C.x || 0, 0, W.l - (C.a || 0) / 1000));
  }
}

function hForce(L) { return Math.abs(L.Vw || 0) + Math.abs(L.Ve || 0) > 0; }
function latLoad(L) { return !!(L.wind || L.earth?.on); }

export const editorSpec = {
  axes: ['x', 'y'],
  unit: 'm',
  digits: 3,
  grid: [0.01, 0.05, 0.1, 0.25, 0.5],
  gridDefault: 0.05,
  modes: ['ansicht'],
  canCopy: true,
  tools: [
    { id: 'opening', label: 'Öffnung', key: 'o', form: 'rect', icon: TOOL_ICONS.opening, title: 'Fenster oder Türe als Rechteck aufziehen: zwei gegenüberliegende Ecken anklicken', prompts: ['Erste Ecke der Öffnung setzen (Raster und Wandkanten fangen).', 'Gegenüberliegende Ecke setzen.'] },
    { id: 'auflast', label: 'Auflast', key: 'q', form: 'pick', pick: ['segment'], icon: TOOL_ICONS.load, title: 'Deckenoberkante oder Wandkrone anklicken: Vertikallasten am Wandkopf (je m Wand)', hint: 'Deckenoberkante bzw. Wandkrone anklicken.' },
    { id: 'einzellast', label: 'Einzellast', key: 'f', form: 'pick', pick: ['segment'], icon: TOOL_ICONS.pointload, title: 'Stelle auf der Wandkrone anklicken: Einzellast mit Lastfläche (Teilflächenbelastung)', hint: 'Stelle auf der Wandkrone bzw. Deckenoberkante anklicken.' },
    { id: 'hkraft', label: 'Horizontalkraft', key: 'h', form: 'pick', pick: ['segment'], icon: ICON_H, title: 'Wandrand auf der Höhe der Kraft anklicken: Horizontalkraft in Wandebene (Schubwand)', hint: 'Linken oder rechten Wandrand auf der Höhe der Kraft anklicken.' },
    { id: 'querlast', label: 'Querlast', key: 'w', form: 'pick', pick: ['region'], icon: ICON_Q, title: 'Wandfläche anklicken: Wind oder Erddruck senkrecht zur Wand', hint: 'Wandfläche anklicken.' },
    { id: 'querwand', label: 'Querwand', key: 'k', form: 'pick', pick: ['segment'], icon: ICON_SIDE, title: 'Linken oder rechten Wandrand anklicken: aussteifende Querwand ein/aus (verkürzt die Knicklänge)', hint: 'Linken oder rechten Wandrand anklicken.' },
  ],

  geometry(app) {
    const p = app.project, W = p.wall, L = p.loads;
    const l = +W.l, hh = +W.h;
    if (!(l > 0 && hh > 0)) return {};
    const mode = app.viewMode;
    const points = [], segments = [], regions = [];
    if (mode === 'schnitt') {
      // Schnitt (quer überhöht): Lastangriff am Kopf und Fuss, Wandfläche, Querlast
      const t = W.t / 1000, k = schnittScale(p), tw = t / 2 * k;
      const c = app.results ? pickCombo(app, 'schnitt') : null;
      points.push({ id: 'q', p: [(c?.eTop ?? 0) * k, hh], label: 'Lastangriff Wandkopf', movable: false });
      points.push({ id: 'q:u', p: [(c?.eBot ?? (L.eU || 0) / 1000) * k, 0], label: 'Lastangriff Wandfuss', movable: false });
      if (latLoad(L)) points.push({ id: 'p', p: [-tw - 0.25, hh / 2], label: 'Querlast', movable: false });
      regions.push({ id: 'w', ring: [[-tw, 0], [tw, 0], [tw, hh], [-tw, hh]], label: 'Wand', movable: false });
      return { points, segments, regions };
    }
    const sideOff = 0.12 * Math.max(l, hh);
    if (mode !== 'schub') {
      points.push({ id: 'w:bl', p: [0, 0], label: 'Wandfuss links (Ursprung)', movable: false });
      points.push({ id: 'w:tl', p: [0, hh], label: 'Wandkrone links – ziehen ändert die Höhe' });
      points.push({ id: 'w:tr', p: [l, hh], label: 'Ecke oben rechts – ziehen ändert Höhe und Länge' });
      points.push({ id: 'w:br', p: [l, 0], label: 'Wandfuss rechts – ziehen ändert die Länge' });
      (W.openings || []).forEach((o, i) => {
        const ring = [[o.x, o.y], [o.x + o.b, o.y], [o.x + o.b, o.y + o.hgt], [o.x, o.y + o.hgt]];
        ring.forEach((q, k) => points.push({ id: `o:${i}:${k}`, p: q, label: `Öffnung ${i + 1} – Ecke` }));
        regions.push({ id: `o:${i}`, ring, label: `Öffnung ${i + 1}` });
      });
      if (L.conc?.on) points.push({ id: 'c', p: [(L.conc.x || 0) + (L.conc.a || 0) / 2000, hh], label: 'Einzellast – entlang der Wandkrone ziehen' });
      if (latLoad(L)) points.push({ id: 'p', p: [l + sideOff, hh / 2], label: 'Querlast (Wind/Erddruck)', movable: false });
    }
    if (hForce(L)) points.push({ id: 'v', p: [0, L.hV > 0 ? +L.hV : hh], label: 'Horizontalkraft – senkrecht ziehen ändert die Angriffshöhe' });
    segments.push({ id: 'q', a: [0, hh + SLAB], b: [l, hh + SLAB], label: 'Auflast (Deckenoberkante)', movable: false });
    segments.push({ id: 'q:w', a: [0, hh], b: [l, hh], label: 'Wandkrone', movable: false });
    segments.push({ id: 'e:L', a: [0, 0], b: [0, hh], label: 'Wandrand links', movable: false });
    segments.push({ id: 'e:R', a: [l, 0], b: [l, hh], label: 'Wandrand rechts', movable: false });
    regions.push({ id: 'w', ring: [[0, 0], [l, 0], [l, hh], [0, hh]], label: 'Wand', movable: false });
    return { points, segments, regions };
  },

  create(app, tool, pts) {
    if (tool !== 'opening') return null;
    if (app.viewMode !== 'ansicht') { app.status('Öffnungen werden in der Ansicht gezeichnet.', 'warn'); return null; }
    const W = app.project.wall;
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const x0 = clamp(Math.min(...xs), 0, W.l), x1 = clamp(Math.max(...xs), 0, W.l);
    const y0 = clamp(Math.min(...ys), 0, W.h), y1 = clamp(Math.max(...ys), 0, W.h);
    if (x1 - x0 < MIN_O || y1 - y0 < MIN_O) { app.status('Die Öffnung ist zu klein (mindestens 10 cm) oder liegt ausserhalb der Wand.', 'warn'); return null; }
    if (x1 - x0 > W.l * 0.9) { app.status('Die Öffnung ist fast so breit wie die Wand – bitte kleiner zeichnen.', 'warn'); return null; }
    W.openings.push({ x: r3(x0), b: r3(x1 - x0), y: r3(y0), hgt: r3(y1 - y0) });
    const i = W.openings.length - 1;
    app.status(`Öffnung ${i + 1}: ${fmt(x1 - x0, 2)} × ${fmt(y1 - y0, 2)} m, Brüstung ${fmt(y0, 2)} m`, 'ok');
    return [`o:${i}`];
  },

  pick(app, tool, hit) {
    const p = app.project, W = p.wall, L = p.loads;
    if (tool === 'auflast') {
      if (!['q', 'q:w'].includes(hit.id)) { app.status('Bitte die Deckenoberkante oder die Wandkrone anklicken.', 'warn'); return null; }
      if (!(L.gW || L.qW || L.gD || L.qD)) {
        L.gD = 25; L.qD = 10;
        app.status('Auflast aus der Decke gk = 25 kN/m, qk = 10 kN/m gesetzt – Werte im Eigenschaftsfenster anpassen', 'ok');
      }
      return ['q'];
    }
    if (tool === 'einzellast') {
      if (!['q', 'q:w'].includes(hit.id)) { app.status('Bitte eine Stelle auf der Wandkrone anklicken.', 'warn'); return null; }
      const C = L.conc;
      C.on = true;
      if (!(C.G || C.Q)) { C.G = 30; C.Q = 10; }
      if (!(C.a > 0)) C.a = 200;
      if (!(C.b > 0) || C.b > W.t) C.b = Math.min(150, W.t);
      C.x = r3(clamp(hit.t * W.l - C.a / 2000, 0, W.l - C.a / 1000));
      app.status(`Einzellast Gk = ${fmt(C.G, 0)} kN, Qk = ${fmt(C.Q, 0)} kN bei x = ${fmt(C.x, 2)} m – Lastfläche im Eigenschaftsfenster anpassen`, 'ok');
      return ['c'];
    }
    if (tool === 'hkraft') {
      if (!['e:L', 'e:R', 'q:w'].includes(hit.id)) { app.status('Bitte den linken oder rechten Wandrand anklicken.', 'warn'); return null; }
      L.hV = r3(clamp(hit.q?.[1] ?? W.h, 0.1, W.h));
      if (!hForce(L)) L.Vw = 20;
      app.status(`Horizontalkraft in Wandebene auf hV = ${fmt(L.hV, 2)} m – Wind- bzw. Erdbebenanteil im Eigenschaftsfenster eingeben`, 'ok');
      return ['v'];
    }
    if (tool === 'querlast') {
      if (!latLoad(L)) L.wind = 1.0;
      app.status('Querlast: Wind 1.0 kN/m² gesetzt – im Eigenschaftsfenster anpassen oder Erddruck aktivieren', 'ok');
      return ['p'];
    }
    if (tool === 'querwand') {
      if (!['e:L', 'e:R'].includes(hit.id)) { app.status('Bitte den linken oder rechten Wandrand anklicken.', 'warn'); return null; }
      const f = sideFlags(W);
      if (hit.id === 'e:L') f.L = !f.L; else f.R = !f.R;
      setSides(W, f.L, f.R);
      if (!(W.ls > 0)) W.ls = W.l;
      app.status(`Querwand ${hit.id === 'e:L' ? 'links' : 'rechts'} ${(hit.id === 'e:L' ? f.L : f.R) ? 'gesetzt' : 'entfernt'}`, 'ok');
      return [hit.id];
    }
    return null;
  },

  move(app, ids, d, { copy }) {
    const p = app.project, W = p.wall, L = p.loads;
    const [dx, dy] = d;
    if (copy) {
      const out = [];
      for (const id of ids) {
        const m = /^o:(\d+)$/.exec(id);
        if (!m) continue;
        const o = opening(p, +m[1]);
        W.openings.push({ ...o, x: r3(clamp(o.x + dx, 0, W.l - o.b)), y: r3(clamp(o.y + dy, 0, W.h - o.hgt)) });
        out.push(`o:${W.openings.length - 1}`);
      }
      if (!out.length) app.status('Kopieren ist nur für Öffnungen möglich.', 'warn');
      return out.length ? out : null;
    }
    const regionsMoved = new Set(ids.map((id) => /^o:(\d+)$/.exec(id)?.[1]).filter((x) => x !== undefined).map(Number));
    const corners = ids.filter((id) => ['w:tl', 'w:tr', 'w:br'].includes(id));
    if (corners.length === 1) {
      const oldL = W.l;
      if (corners[0] !== 'w:tl') W.l = r3(Math.max(MIN_L, W.l + dx));
      if (corners[0] !== 'w:br') W.h = r3(Math.max(MIN_H, W.h + dy));
      if (Math.abs((W.ls || 0) - oldL) < 1e-9) W.ls = W.l;
      if (L.hV > 0 && Math.abs(L.hV - (W.h - dy)) < 1e-9) L.hV = W.h;
      fitIntoWall(p);
      app.status(`Wand: h = ${fmt(W.h, 2)} m, l = ${fmt(W.l, 2)} m`, 'ok');
    }
    for (const id of ids) {
      let m = /^o:(\d+)$/.exec(id);
      if (m) {
        const o = opening(p, +m[1]);
        o.x = r3(clamp(o.x + dx, 0, W.l - o.b));
        o.y = r3(clamp(o.y + dy, 0, W.h - o.hgt));
        continue;
      }
      m = /^o:(\d+):(\d)$/.exec(id);
      if (m && !regionsMoved.has(+m[1]) && ids.filter((x) => x.startsWith(`o:${m[1]}:`)).length === 1) {
        const o = opening(p, +m[1]);
        const ring = [[o.x, o.y], [o.x + o.b, o.y], [o.x + o.b, o.y + o.hgt], [o.x, o.y + o.hgt]];
        const k = +m[2];
        const moved = [clamp(ring[k][0] + dx, 0, W.l), clamp(ring[k][1] + dy, 0, W.h)];
        const fix = ring[(k + 2) % 4];
        const x0 = Math.min(moved[0], fix[0]), x1 = Math.max(moved[0], fix[0]);
        const y0 = Math.min(moved[1], fix[1]), y1 = Math.max(moved[1], fix[1]);
        if (x1 - x0 < MIN_O || y1 - y0 < MIN_O) { app.status('Öffnung zu klein – Mindestmass 10 cm.', 'warn'); continue; }
        Object.assign(o, { x: r3(x0), b: r3(x1 - x0), y: r3(y0), hgt: r3(y1 - y0) });
        app.status(`Öffnung ${+m[1] + 1}: ${fmt(o.b, 2)} × ${fmt(o.hgt, 2)} m`, 'ok');
        continue;
      }
      if (id === 'c' && L.conc?.on) {
        L.conc.x = r3(clamp((L.conc.x || 0) + dx, 0, W.l - (L.conc.a || 0) / 1000));
        app.status(`Einzellast bei x = ${fmt(L.conc.x, 2)} m`, 'ok');
      }
      if (id === 'v') {
        L.hV = r3(Math.max(0.1, (L.hV > 0 ? L.hV : W.h) + dy));
        app.status(`Horizontalkraft auf hV = ${fmt(L.hV, 2)} m`, 'ok');
      }
    }
    return ids;
  },

  remove(app, ids) {
    const p = app.project, W = p.wall, L = p.loads;
    const open = [...new Set(ids.map((id) => /^o:(\d+)/.exec(id)?.[1]).filter((x) => x !== undefined).map(Number))].sort((a, b) => b - a);
    for (const i of open) W.openings.splice(i, 1);
    let msg = open.length ? `${open.length} Öffnung${open.length > 1 ? 'en' : ''} gelöscht` : '';
    if (ids.includes('c')) { L.conc.on = false; msg = 'Einzellast entfernt'; }
    if (ids.includes('v')) { L.Vw = 0; L.Ve = 0; msg = 'Horizontalkraft entfernt'; }
    if (ids.includes('p')) { L.wind = 0; L.earth.on = false; msg = 'Querlast entfernt'; }
    if (ids.includes('q') || ids.includes('q:w')) { L.gW = 0; L.qW = 0; L.gD = 0; L.qD = 0; msg = 'Auflast entfernt'; }
    if (ids.includes('e:L') || ids.includes('e:R')) {
      const f = sideFlags(W);
      if (ids.includes('e:L')) f.L = false;
      if (ids.includes('e:R')) f.R = false;
      setSides(W, f.L, f.R);
      msg = msg || 'Querwand entfernt';
    }
    if (!msg && ids.some((id) => id === 'w' || id.startsWith('w:'))) { app.status('Die Wand selbst kann nicht gelöscht werden – für ein leeres Projekt «Neu» wählen.', 'warn'); return; }
    if (msg) app.status(msg, 'ok');
  },

  inspect(app, ids) {
    if (ids.length === 1) {
      const id = ids[0];
      if (id === 'w' || id.startsWith('w:')) return inspectWall(app);
      const m = /^o:(\d+)/.exec(id);
      if (m && app.project.wall.openings[+m[1]]) return inspectOpening(app, +m[1]);
      if (id === 'q' || id === 'q:w' || id === 'q:u') return inspectLoads(app);
      if (id === 'c') return inspectConc(app);
      if (id === 'v') return inspectHForce(app);
      if (id === 'p') return inspectLateral(app);
      if (id === 'e:L' || id === 'e:R') return inspectEdge(app, id === 'e:L' ? 'L' : 'R');
    }
    const n = ids.filter((id) => /^o:\d+$/.test(id)).length;
    return { title: `${ids.length} Elemente`, content: [h('div', { class: 'muted small' }, n ? `${n} Öffnung${n > 1 ? 'en' : ''} ausgewählt` : 'Mehrere Elemente ausgewählt'), note('Ziehen verschiebt die gewählten Öffnungen, Entf löscht sie.')] };
  },

  idleHint(app) {
    const L = app.project.loads;
    if (!anyLoad(L)) {
      return h('span', {}, 'Die Wand ist angelegt. Lasten setzen: ', h('b', {}, 'Auflast'), ' (Q) und die Deckenoberkante anklicken, ', h('b', {}, 'Einzellast'), ' (F) auf die Wandkrone, ', h('b', {}, 'Horizontalkraft'), ' (H) an den Wandrand, ', h('b', {}, 'Querlast'), ' (W) auf die Wandfläche. ', h('b', {}, 'Öffnung'), ' (O) als Rechteck aufziehen. Die Ecke oben rechts ziehen ändert Höhe und Länge.');
    }
    return h('span', {}, 'Wand, Öffnung oder Last anklicken, um Werte zu bearbeiten. Ecken und Öffnungen lassen sich ziehen (X/Y: nur entlang einer Achse). Im «Schnitt» Lastangriff anklicken für die Exzentrizität.');
  },
};

// ====================================================================== Eigenschaftsfenster

const changed = (app, refresh) => { app.changed({ inputs: true }); if (refresh) app.editor?.refreshPanel(true); };

function sub(text, extra) { return h('div', { class: 'ed-sub' }, text, extra ? h('span', { class: 'muted small' }, ` · ${extra}`) : null); }

/** Kurze Ergebniszeile(n) für eine Gruppe von Nachweisen. */
function resultRows(app, ids) {
  const R = app.results;
  if (!R) return null;
  const list = R.checks.filter((c) => ids.includes(c.id));
  if (!list.length) return null;
  return h('div', {}, sub('Nachweise', app.stale ? 'wird aktualisiert' : null),
    ...list.map((c) => h('div', { class: 'ed-row', style: { justifyContent: 'space-between', gap: '8px' } },
      h('span', { class: 'small' }, c.label), utilBar(c.eta))));
}

function inspectWall(app) {
  const p = app.project, W = p.wall, M = p.material;
  const t = W.t / 1000;
  const f = sideFlags(W);
  const eff = effectiveHeight({ h: W.h, t, mode: W.support, rhoManual: W.rhoManual, sides: (f.L ? 1 : 0) + (f.R ? 1 : 0), ls: W.ls > 0 ? W.ls : W.l, eTop: 0 });
  const d = designValues(M);
  const ch = () => { p.wall.ls = W.ls > 0 ? W.ls : W.l; changed(app); };
  return {
    title: 'Wand',
    content: [
      h('div', { class: 'grid3' },
        numField('h', W, 'h', { unit: 'm', min: MIN_H, max: 20, onChange: () => { fitIntoWall(p); ch(); }, info: 'Lichte Wandhöhe. Auch durch Ziehen der Ecke oben rechts änderbar.' }),
        numField('l', W, 'l', { unit: 'm', min: MIN_L, max: 50, onChange: () => { fitIntoWall(p); ch(); }, info: 'Wandlänge.' }),
        numField('t', W, 't', { unit: 'mm', min: 50, max: 1000, onChange: ch, info: 'Wanddicke (Nachweise aus der Ebene je m Wand).' })),
      selectField('Mauerwerk', M, 'type', MASONRY_TYPES.map((x) => ({ value: x.id, label: x.label })), { wide: true, onChange: (id) => { applyTypeDefaults(M, id); changed(app, true); }, info: 'Setzt Standardwerte (Richtwerte) für fxk, fyk, Exk usw. Details im Register «Material».' }),
      h('div', { class: 'grid2' },
        numField('fxk', M, 'fxk', { unit: 'MPa', min: 0.1, onChange: () => { if (M.exkAuto) M.Exk = typeById(M.type).KE * M.fxk; changed(app); }, info: 'Druckfestigkeit senkrecht zu den Lagerfugen.' }),
        numField('fyk', M, 'fyk', { unit: 'MPa', min: 0.05, onChange: () => changed(app), info: 'Druckfestigkeit parallel zu den Lagerfugen (Schub).' })),
      h('div', { class: 'muted small' }, `fxd = ${fmt(d.fxd, 2)} MPa · fyd = ${fmt(d.fyd, 2)} MPa · Exd = ${fmt(d.Exd, 0)} MPa`),
      sub('Halterung'),
      selectField('oben/unten', W, 'support', [
        { value: 'slab', label: 'Stahlbetondecken (ρ2 = 0.75)' },
        { value: 'hinged', label: 'gelenkig (ρ2 = 1.0)' },
        { value: 'manual', label: 'ρ manuell' },
      ], { wide: true, onChange: () => changed(app, true), info: 'Einspannung durch die Decken (EN 1996-1-1, 5.5.1.2).' }),
      W.support === 'manual' ? numField('ρ', W, 'rhoManual', { unit: '–', min: 0.1, max: 3, onChange: () => changed(app, true) }) : null,
      h('div', { class: 'grid2' },
        checkField('Querwand links', f, 'L', { onChange: () => { setSides(W, f.L, f.R); changed(app, true); } }),
        checkField('Querwand rechts', f, 'R', { onChange: () => { setSides(W, f.L, f.R); changed(app, true); } })),
      f.L || f.R ? numField('Abstand Querwände', W, 'ls', { unit: 'm', min: 0.2, onChange: () => changed(app, true), info: 'Lichter Abstand der aussteifenden Querwände.' }) : null,
      h('div', { class: 'muted small' }, `hef = ${fmt(eff.rho, 3)}·h = ${fmt(eff.hef, 2)} m · hef/t = ${fmt(eff.hef / t, 1)}`),
      resultRows(app, ['top', 'bot', 'buck', 'buckEN', 'slender']),
    ],
  };
}

function inspectOpening(app, i) {
  const p = app.project, W = p.wall, o = W.openings[i];
  const ch = () => { fitIntoWall(p); changed(app); };
  const left = o.x, right = W.l - o.x - o.b;
  return {
    title: `Öffnung ${i + 1}`,
    content: [
      h('div', { class: 'grid2' },
        numField('Breite', o, 'b', { unit: 'm', min: MIN_O, onChange: ch }),
        numField('Höhe', o, 'hgt', { unit: 'm', min: MIN_O, onChange: ch })),
      h('div', { class: 'grid2' },
        numField('x links', o, 'x', { unit: 'm', min: 0, onChange: ch, info: 'Abstand vom linken Wandende.' }),
        numField('Brüstung', o, 'y', { unit: 'm', min: 0, onChange: ch, info: 'Höhe der Unterkante über dem Wandfuss (Türe: 0).' })),
      h('div', { class: 'muted small' }, `Pfeiler links ${fmt(left, 2)} m · rechts ${fmt(right, 2)} m`),
      note('Die Auflast wird auf die Pfeiler konzentriert (Faktor l/(l − Σb)). Pfeiler und Sturz sind separat nachzuweisen.'),
    ],
  };
}

function inspectLoads(app) {
  const p = app.project, L = p.loads, W = p.wall;
  const t = W.t / 1000;
  const eD = L.eMode === 'slab' ? (t / 2 - L.aD / 3000) * 1000 : L.eMode === 'centric' ? 0 : L.eD;
  const nW = (L.gW || 0) + (L.qW || 0), nD = (L.gD || 0) + (L.qD || 0);
  const out = [
    sub('Wand darüber (zentrisch)', 'je m'),
    h('div', { class: 'grid2' },
      numField('gk', L, 'gW', { unit: 'kN/m', min: 0, onChange: () => changed(app), info: 'Ständige Last aus den Geschossen darüber, zentrisch.' }),
      numField('qk', L, 'qW', { unit: 'kN/m', min: 0, onChange: () => changed(app), info: 'Nutz-/Schneelast aus den Geschossen darüber.' })),
    sub('Deckenauflager (exzentrisch)', 'je m'),
    h('div', { class: 'grid2' },
      numField('gk', L, 'gD', { unit: 'kN/m', min: 0, onChange: () => changed(app), info: 'Auflagerkraft der Decke über der Wand (ständig).' }),
      numField('qk', L, 'qD', { unit: 'kN/m', min: 0, onChange: () => changed(app), info: 'Auflagerkraft der Decke aus Nutzlast.' })),
    selectField('Lastangriff', L, 'eMode', [
      { value: 'centric', label: 'zentrisch (Zentrierstreifen)' },
      { value: 'slab', label: 'Deckenverdrehung e = t/2 − a/3' },
      { value: 'manual', label: 'Exzentrizität eingeben' },
    ], { wide: true, onChange: () => changed(app, true), info: 'Endauflager: Resultierende im Abstand a/3 vom Innenrand. Zentrierstreifen: zentrisch.' }),
    L.eMode === 'slab' ? numField('Auflagertiefe a', L, 'aD', { unit: 'mm', min: 1, max: W.t, onChange: () => changed(app, true) }) : null,
    L.eMode === 'manual' ? numField('Exzentrizität eD', L, 'eD', { unit: 'mm', onChange: () => changed(app, true), info: 'Positiv zur Raumseite.' }) : null,
    numField('Wandfuss eu', L, 'eU', { unit: 'mm', onChange: () => changed(app, true), info: 'Exzentrizität der Resultierenden am Wandfuss, meist 0.' }),
    h('div', { class: 'muted small' }, `eD = ${fmt(eD, 1)} mm → eo (gk + qk) = ${fmt(nW + nD > 0 ? nD * eD / (nW + nD) : 0, 1)} mm · Eigengewicht ${fmt(p.material.gamma * t, 2)} kN/m²`),
  ];
  const c = app.results?.combos?.find((x) => x.type === 'ULS');
  if (c) out.push(kvTable([['nd,o (' + c.name + ')', c.nTop, 'kN/m', 1], ['eo', c.eTop * 1000, 'mm', 1]]));
  out.push(resultRows(app, ['top', 'bot', 'buck', 'buckEN']));
  return { title: 'Auflast am Wandkopf', content: out };
}

function inspectConc(app) {
  const p = app.project, C = p.loads.conc, W = p.wall;
  const ch = () => { if (C.b > W.t) C.b = W.t; changed(app); };
  return {
    title: 'Einzellast',
    content: [
      h('div', { class: 'grid2' },
        numField('Gk', C, 'G', { unit: 'kN', min: 0, onChange: ch }),
        numField('Qk', C, 'Q', { unit: 'kN', min: 0, onChange: ch })),
      sub('Lastfläche'),
      h('div', { class: 'grid2' },
        numField('a (längs)', C, 'a', { unit: 'mm', min: 1, onChange: () => { if (C.a / 1000 > W.l) C.a = W.l * 1000; C.x = r3(clamp(C.x, 0, W.l - C.a / 1000)); ch(); }, info: 'Länge der Auflagerfläche entlang der Wand.' }),
        numField('b (quer)', C, 'b', { unit: 'mm', min: 1, max: W.t, onChange: ch, info: 'Tiefe der Auflagerfläche, ≤ t.' })),
      h('div', { class: 'grid2' },
        numField('x', C, 'x', { unit: 'm', min: 0, onChange: () => { C.x = r3(clamp(C.x, 0, W.l - C.a / 1000)); ch(); }, info: 'Linker Rand der Lastfläche ab linkem Wandende. Auch durch Ziehen änderbar.' }),
        numField('ec', C, 'ec', { unit: 'mm', onChange: ch, info: 'Exzentrizität quer zur Wand (≤ t/4).' })),
      checkField('Vollsteine (β > 1 zulässig)', p.material, 'solid', { onChange: () => changed(app), info: 'Erhöhungsfaktor β nur für Steine der Gruppe 1 (EN 1996-1-1, 6.1.3).' }),
      resultRows(app, ['conc', 'concMid']),
    ],
  };
}

function inspectHForce(app) {
  const p = app.project, L = p.loads;
  return {
    title: 'Horizontalkraft in Wandebene',
    content: [
      h('div', { class: 'grid2' },
        numField('Wind Vw,k', L, 'Vw', { unit: 'kN', onChange: () => changed(app), info: 'Charakteristischer Windanteil dieser Aussteifungswand.' }),
        numField('Erdbeben VE,d', L, 'Ve', { unit: 'kN', onChange: () => changed(app), info: 'Bemessungswert der Erdbebenkraft (SIA 261).' })),
      numField('Angriffshöhe hV', L, 'hV', { unit: 'm', min: 0.1, onChange: () => changed(app), info: 'Höhe über dem Wandfuss. Auch durch senkrechtes Ziehen des Pfeils änderbar.' }),
      checkField('Wandkopf eingespannt (h0 = hV/2)', L, 'topFixed', { onChange: () => changed(app) }),
      resultRows(app, ['shear', 'shearEN', 'shearN']),
    ],
  };
}

function inspectLateral(app) {
  const p = app.project, L = p.loads, E = L.earth;
  return {
    title: 'Querbelastung',
    content: [
      numField('Wind wk', L, 'wind', { unit: 'kN/m²', onChange: () => changed(app), info: 'Winddruck senkrecht zur Wand, positiv zur Raumseite.' }),
      checkField('Erddruck (Kellerwand)', E, 'on', { onChange: () => changed(app, true) }),
      E.on ? h('div', { class: 'grid2' },
        numField('he', E, 'he', { unit: 'm', min: 0, onChange: () => changed(app), info: 'Anschütthöhe über dem Wandfuss.' }),
        numField('γ Boden', E, 'gs', { unit: 'kN/m³', min: 0, onChange: () => changed(app) })) : null,
      E.on ? h('div', { class: 'grid2' },
        numField('K', E, 'K', { unit: '–', min: 0, onChange: () => changed(app), info: 'Ruhedruckbeiwert K0 ≈ 0.4–0.5.' }),
        numField('Auflast', E, 'qs', { unit: 'kN/m²', min: 0, onChange: () => changed(app) })) : null,
      resultRows(app, ['lat', 'basMax', 'basMin']),
    ],
  };
}

function inspectEdge(app, side) {
  const p = app.project, W = p.wall;
  const f = sideFlags(W);
  return {
    title: `Wandrand ${side === 'L' ? 'links' : 'rechts'}`,
    content: [
      checkField('Aussteifende Querwand', f, side, { onChange: () => { setSides(W, f.L, f.R); changed(app, true); }, info: 'Querwände verkürzen die Knicklänge (ρ3/ρ4 nach EN 1996-1-1, 5.5.1.2).' }),
      f.L || f.R ? numField('Abstand Querwände', W, 'ls', { unit: 'm', min: 0.2, onChange: () => changed(app), info: 'Lichter Abstand der Querwände bzw. Abstand zum freien Rand.' }) : null,
      h('div', { class: 'muted small' }, 'Mit dem Werkzeug «Horizontalkraft» (H) hier die Höhe einer Schubkraft anklicken.'),
    ],
  };
}
