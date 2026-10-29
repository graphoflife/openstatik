// Grafische Bearbeitung Mauerwerk: Werkzeuge, Geometrie für den Editor und Eigenschaftsfenster.
//
// Bearbeitet wird in der Ansicht (x entlang der Wand, y über die Höhe, Ursprung am linken Wandfuss).
// In «Schnitt» und «Schub» lassen sich Lasten und Wand anklicken (Eigenschaften), aber nicht ziehen.
import { h, numField, selectField, checkField, fmt, utilBar, kvTable, rich } from '../../js/core/ui.js';
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
    // Horizontalkraft zuerst: bei gleicher Lage (h_V = h) gewinnt sie gegenüber der Wandecke
    if (hForce(L)) points.push({ id: 'v', p: [0, L.hV > 0 ? +L.hV : hh], label: 'Horizontalkraft – senkrecht ziehen ändert die Angriffshöhe' });
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
        app.status('Auflast aus der Decke 25 + 10 kN/m (ständig + veränderlich) gesetzt – Werte im Eigenschaftsfenster anpassen', 'ok');
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
      app.status(`Einzellast ${fmt(C.G, 0)} + ${fmt(C.Q, 0)} kN (ständig + veränderlich) bei x = ${fmt(C.x, 2)} m – Lastfläche im Eigenschaftsfenster anpassen`, 'ok');
      return ['c'];
    }
    if (tool === 'hkraft') {
      if (!['e:L', 'e:R', 'q:w'].includes(hit.id)) { app.status('Bitte den linken oder rechten Wandrand anklicken.', 'warn'); return null; }
      L.hV = r3(clamp(hit.q?.[1] ?? W.h, 0.1, W.h));
      if (!hForce(L)) L.Vw = 20;
      app.status(`Horizontalkraft in Wandebene auf Höhe ${fmt(L.hV, 2)} m – Wind- bzw. Erdbebenanteil im Eigenschaftsfenster eingeben`, 'ok');
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
        app.status(`Horizontalkraft auf Höhe ${fmt(L.hV, 2)} m`, 'ok');
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
      const r = inspectById(app, ids[0]);
      if (r) return r;
    }
    const n = ids.filter((id) => /^o:\d+$/.test(id)).length;
    return { title: `${ids.length} Elemente`, content: [h('div', { class: 'muted small' }, n ? `${n} Öffnung${n > 1 ? 'en' : ''} ausgewählt – ziehen verschiebt, Entf löscht.` : 'Mehrere Elemente ausgewählt.')] };
  },

  idleHint(app) {
    const L = app.project.loads;
    if (!anyLoad(L)) {
      return h('span', {}, 'Die Wand ist angelegt. Lasten setzen: ', h('b', {}, 'Auflast'), ' (Q) und die Deckenoberkante anklicken, ', h('b', {}, 'Einzellast'), ' (F) auf die Wandkrone, ', h('b', {}, 'Horizontalkraft'), ' (H) an den Wandrand, ', h('b', {}, 'Querlast'), ' (W) auf die Wandfläche. ', h('b', {}, 'Öffnung'), ' (O) als Rechteck aufziehen. Die Ecke oben rechts ziehen ändert Höhe und Länge.');
    }
    return h('span', {}, 'Wand, Öffnung oder Last anklicken, um Werte zu bearbeiten. Ecken und Öffnungen lassen sich ziehen (X/Y: nur entlang einer Achse). Im «Schnitt» Lastangriff anklicken für die Exzentrizität.');
  },
};

// ====================================================================== Einwirkungen (Register «Lasten» und Eigenschaftsfenster)

/** Einwirkungsarten: Liste mit Kurzinfo und Editor; Entfernen setzt die Werte auf null. */
export function loadKinds(app) {
  const p = app.project, L = p.loads, W = p.wall, E = L.earth, C = L.conc;
  const t = W.t / 1000;
  const eMode = { centric: 'zentrisch', slab: 'Deckenverdrehung', manual: `e_D = ${fmt(L.eD || 0, 0)} mm` };
  return [
    {
      kind: 'auflast', name: 'Auflast am Wandkopf', swatch: 'var(--c-load)',
      active: () => !!(L.gW || L.qW || L.gD || L.qD),
      sub: () => `g_k = ${fmt((L.gW || 0) + (L.gD || 0), 1)}, q_k = ${fmt((L.qW || 0) + (L.qD || 0), 1)} kN/m · ${eMode[L.eMode] || ''}`,
      add: () => { L.gD = 25; L.qD = 10; },
      clear: () => { L.gW = 0; L.qW = 0; L.gD = 0; L.qD = 0; },
      detail: (d, ch, chR) => {
        const eD = L.eMode === 'slab' ? (t / 2 - L.aD / 3000) * 1000 : L.eMode === 'centric' ? 0 : L.eD;
        d.append(...[
          numField('g_k Wand', L, 'gW', { unit: 'kN/m', min: 0, onChange: ch, info: 'Ständige Last aus den Geschossen darüber, zentrisch.' }),
          numField('q_k Wand', L, 'qW', { unit: 'kN/m', min: 0, onChange: ch, info: 'Nutz-/Schneelast aus den Geschossen darüber, zentrisch.' }),
          numField('g_k Decke', L, 'gD', { unit: 'kN/m', min: 0, onChange: ch, info: 'Auflagerkraft der Decke direkt über der Wand (ständig); greift mit e_D an.' }),
          numField('q_k Decke', L, 'qD', { unit: 'kN/m', min: 0, onChange: ch, info: 'Auflagerkraft der Decke aus Nutzlast.' }),
          selectField('Lastangriff', L, 'eMode', [
            { value: 'centric', label: 'zentrisch' },
            { value: 'slab', label: 'Deckenverdrehung' },
            { value: 'manual', label: 'Exzentrizität eingeben' },
          ], { onChange: chR, info: 'Zentrisch: Innenwand oder Zentrierstreifen. Deckenverdrehung (Endauflager): Resultierende bei a/3 vom Innenrand, e_D = t/2 − a/3.' }),
          L.eMode === 'slab' ? numField('Auflagertiefe a', L, 'aD', { unit: 'mm', min: 1, max: W.t, onChange: chR, info: 'Ab Innenkante, ≤ t. Volle Auflage a = t ergibt e_D = t/6.' }) : null,
          L.eMode === 'manual' ? numField('e_D', L, 'eD', { unit: 'mm', onChange: chR, info: 'Exzentrizität der Deckenauflagerkraft, positiv zur Raumseite.' }) : null,
          numField('e_u Wandfuss', L, 'eU', { unit: 'mm', onChange: ch, info: 'Exzentrizität der Resultierenden am Wandfuss (meist 0), positiv zur Raumseite.' }),
          kvTable([['e_D Decke', eD, 'mm', 1], ['Eigengewicht γ·t', p.material.gamma * t, 'kN/m²', 2]]),
        ].filter(Boolean));
      },
    },
    {
      kind: 'einzellast', name: 'Einzellast', swatch: 'var(--c-steel)',
      active: () => !!(C.on && (C.G || C.Q)),
      sub: () => `G_k = ${fmt(C.G || 0, 1)}, Q_k = ${fmt(C.Q || 0, 1)} kN · ${fmt(C.a, 0)} × ${fmt(C.b, 0)} mm bei x = ${fmt(C.x, 2)} m`,
      add: () => { C.on = true; C.G = C.G || 30; C.Q = C.Q || 10; C.a = C.a > 0 ? C.a : 200; C.b = Math.min(C.b > 0 ? C.b : 150, W.t); C.x = Math.max(0, Math.min(W.l - C.a / 1000, W.l / 2 - C.a / 2000)); },
      clear: () => { C.on = false; },
      detail: (d, ch) => d.append(
        numField('G_k', C, 'G', { unit: 'kN', min: 0, onChange: ch }),
        numField('Q_k', C, 'Q', { unit: 'kN', min: 0, onChange: ch }),
        numField('Länge a', C, 'a', { unit: 'mm', min: 1, onChange: ch, info: 'Länge der Lastfläche entlang der Wand.' }),
        numField('Tiefe b', C, 'b', { unit: 'mm', min: 1, max: W.t, onChange: ch, info: 'Tiefe der Lastfläche quer zur Wand, ≤ t.' }),
        numField('Lage x', C, 'x', { unit: 'm', min: 0, onChange: ch, info: 'Linker Rand der Lastfläche ab linkem Wandende; bestimmt den Randabstand a_1.' }),
        numField('e_c quer', C, 'ec', { unit: 'mm', onChange: ch, info: 'Abstand des Lastschwerpunkts von der Wandachse; EN 1996-1-1 verlangt e_c ≤ t/4.' })),
    },
    {
      kind: 'wind', name: 'Wind quer', swatch: 'var(--c-series-1)',
      active: () => !!L.wind,
      sub: () => `w_k = ${fmt(L.wind || 0, 2)} kN/m² senkrecht zur Wand`,
      add: () => { L.wind = 1.0; },
      clear: () => { L.wind = 0; },
      detail: (d, ch) => d.append(numField('w_k', L, 'wind', { unit: 'kN/m²', onChange: ch, info: 'Winddruck senkrecht zur Wand (SIA 261), positiv zur Raumseite; typisch 0.5–1.2 kN/m².' })),
    },
    {
      kind: 'erddruck', name: 'Erddruck', swatch: 'var(--c-soil)',
      active: () => !!(E.on && E.he > 0),
      sub: () => `h_e = ${fmt(E.he, 2)} m · γ = ${fmt(E.gs, 0)} kN/m³ · K = ${fmt(E.K, 2)} · q_k = ${fmt(E.qs, 1)} kN/m²`,
      add: () => { E.on = true; if (!(E.he > 0)) E.he = Math.min(2.0, W.h); },
      clear: () => { E.on = false; },
      detail: (d, ch) => d.append(
        numField('Höhe h_e', E, 'he', { unit: 'm', min: 0, onChange: ch, info: 'Höhe der Erdanschüttung über dem Wandfuss.' }),
        numField('γ_Boden', E, 'gs', { unit: 'kN/m³', min: 0, onChange: ch, info: 'Hinterfüllung, üblich 19–20 kN/m³.' }),
        numField('Beiwert K', E, 'K', { min: 0, max: 1.5, onChange: ch, info: 'Ruhedruck K_0 = 1 − sin φ\' ≈ 0.4–0.5 bei unverschieblichen Kellerwänden.' }),
        numField('Auflast q_k', E, 'qs', { unit: 'kN/m²', min: 0, onChange: ch, info: 'Gleichmässige Auflast auf dem Gelände, z.B. 5 kN/m².' })),
    },
    {
      kind: 'hkraft', name: 'Horizontalkraft in Wandebene', swatch: 'var(--c-series-4)',
      active: () => !!(L.Vw || L.Ve),
      sub: () => `V_w,k = ${fmt(L.Vw || 0, 1)} kN, V_E,d = ${fmt(L.Ve || 0, 1)} kN auf h_V = ${fmt(L.hV || W.h, 2)} m`,
      add: () => { L.Vw = 20; L.hV = W.h; },
      clear: () => { L.Vw = 0; L.Ve = 0; },
      detail: (d, ch) => d.append(
        numField('Wind V_w,k', L, 'Vw', { unit: 'kN', onChange: ch, info: 'Charakteristischer Windanteil dieser Aussteifungswand.' }),
        numField('Erdbeben V_E,d', L, 'Ve', { unit: 'kN', onChange: ch, info: 'Bemessungswert (z.B. Ersatzkraftverfahren SIA 261), Faktor 1.0 in der Erdbebenkombination.' }),
        numField('Höhe h_V', L, 'hV', { unit: 'm', min: 0.1, onChange: ch, info: 'Höhe über dem Wandfuss, meist Wandkopf. Mehrgeschossig: effektive Höhe M/V.' }),
        checkField('Kopf eingespannt', L, 'topFixed', { onChange: ch, info: 'Mit Einspannung am Wandkopf halbiert sich die Schubspannweite: h_0 = h_V/2 statt h_V (Kragscheibe).' })),
    },
  ];
}

// ====================================================================== Eigenschaftsfenster

const changed = (app, refresh) => { app.changed({ inputs: true }); if (refresh) app.editor?.refreshPanel(true); };

/** Kurze Ergebniszeilen (Ausnutzungsbalken) für eine Gruppe von Nachweisen. */
function resultRows(app, ids) {
  const R = app.results;
  if (!R) return null;
  const list = R.checks.filter((c) => ids.includes(c.id));
  if (!list.length) return null;
  return h('div', {}, h('div', { class: 'ed-sub' }, 'Nachweise'),
    ...list.map((c) => h('div', { class: 'mw-resrow' }, h('span', {}, rich(c.label)), utilBar(c.eta))));
}

/** Editor einer Einwirkungsart im Eigenschaftsfenster. */
function loadPanel(app, kind, title, ids) {
  const k = loadKinds(app).find((x) => x.kind === kind);
  const d = h('div');
  k.detail(d, () => changed(app), () => changed(app, true));
  return { title, content: [d, resultRows(app, ids)] };
}

function inspectWall(app) {
  const p = app.project, W = p.wall, M = p.material;
  const t = W.t / 1000;
  const f = sideFlags(W);
  const eff = effectiveHeight({ h: W.h, t, mode: W.support, rhoManual: W.rhoManual, sides: (f.L ? 1 : 0) + (f.R ? 1 : 0), ls: W.ls > 0 ? W.ls : W.l, eTop: 0 });
  const d = designValues(M);
  const ch = () => changed(app);
  const chSides = () => { setSides(W, f.L, f.R); if (!(W.ls > 0)) W.ls = W.l; changed(app, true); };
  return {
    title: 'Wand',
    content: [
      numField('Höhe h', W, 'h', { unit: 'm', min: MIN_H, max: 20, onChange: () => { fitIntoWall(p); ch(); }, info: 'Lichte Wandhöhe; auch durch Ziehen der Ecke oben rechts.' }),
      numField('Länge l', W, 'l', { unit: 'm', min: MIN_L, max: 50, onChange: () => { fitIntoWall(p); ch(); } }),
      numField('Dicke t', W, 't', { unit: 'mm', min: 50, max: 1000, onChange: ch }),
      selectField('Mauerwerk', M, 'type', MASONRY_TYPES.map((x) => ({ value: x.id, label: x.label })), { onChange: (id) => { applyTypeDefaults(M, id); changed(app, true); }, info: 'Setzt Standardwerte (Richtwerte); Details im Register «Material».' }),
      h('div', { class: 'grid2' },
        numField('f_xk', M, 'fxk', { unit: 'MPa', min: 0.1, onChange: () => { if (M.exkAuto) M.Exk = typeById(M.type).KE * M.fxk; ch(); } }),
        numField('f_yk', M, 'fyk', { unit: 'MPa', min: 0.05, onChange: ch })),
      selectField('Decken', W, 'support', [
        { value: 'slab', label: 'Stahlbeton (ρ_2 = 0.75)' },
        { value: 'hinged', label: 'gelenkig (ρ_2 = 1.0)' },
        { value: 'manual', label: 'ρ manuell' },
      ], { onChange: () => changed(app, true) }),
      W.support === 'manual' ? numField('ρ', W, 'rhoManual', { min: 0.1, max: 3, onChange: () => changed(app, true) }) : null,
      h('div', { class: 'grid2' },
        checkField('Querwand links', f, 'L', { onChange: chSides }),
        checkField('Querwand rechts', f, 'R', { onChange: chSides })),
      f.L || f.R ? numField('Abstand l_s', W, 'ls', { unit: 'm', min: 0.2, onChange: () => changed(app, true) }) : null,
      kvTable([['f_xd', d.fxd, 'MPa', 2], ['h_ef', eff.hef, 'm', 2], ['h_ef/t', eff.hef / t, '', 1]]),
      resultRows(app, ['top', 'bot', 'buck', 'buckEN', 'slender']),
    ],
  };
}

function inspectOpening(app, i) {
  const p = app.project, W = p.wall, o = W.openings[i];
  const ch = () => { fitIntoWall(p); changed(app); };
  return {
    title: `Öffnung ${i + 1}`,
    content: [
      h('div', { class: 'grid2' },
        numField('Breite', o, 'b', { unit: 'm', min: MIN_O, onChange: ch }),
        numField('Höhe', o, 'hgt', { unit: 'm', min: MIN_O, onChange: ch })),
      h('div', { class: 'grid2' },
        numField('x links', o, 'x', { unit: 'm', min: 0, onChange: ch, info: 'Abstand vom linken Wandende.' }),
        numField('Brüstung', o, 'y', { unit: 'm', min: 0, onChange: ch, info: 'Unterkante über dem Wandfuss (Türe: 0).' })),
      kvTable([['Pfeiler links', o.x, 'm', 2], ['Pfeiler rechts', W.l - o.x - o.b, 'm', 2]]),
    ],
  };
}

function inspectLateral(app) {
  const L = app.project.loads, E = L.earth;
  const ks = loadKinds(app);
  const d = h('div');
  ks.find((k) => k.kind === 'wind').detail(d, () => changed(app), () => changed(app, true));
  d.append(checkField('Erddruck', E, 'on', { onChange: () => changed(app, true), info: 'Erddruck von aussen (Kelleraussenwand).' }));
  if (E.on) ks.find((k) => k.kind === 'erddruck').detail(d, () => changed(app), () => changed(app, true));
  return { title: 'Querbelastung', content: [d, resultRows(app, ['lat', 'basMax', 'basMin'])] };
}

function inspectEdge(app, side) {
  const W = app.project.wall;
  const f = sideFlags(W);
  return {
    title: `Wandrand ${side === 'L' ? 'links' : 'rechts'}`,
    content: [
      checkField('Querwand', f, side, { onChange: () => { setSides(W, f.L, f.R); if (!(W.ls > 0)) W.ls = W.l; changed(app, true); }, info: 'Aussteifende Querwand an diesem Rand; verkürzt die Knicklänge (ρ_3, ρ_4 nach EN 1996-1-1, 5.5.1.2). Werkzeug «Horizontalkraft» (H): hier die Höhe einer Schubkraft anklicken.' }),
      f.L || f.R ? numField('Abstand l_s', W, 'ls', { unit: 'm', min: 0.2, onChange: () => changed(app) }) : null,
    ],
  };
}

/** Eigenschaftsfenster je Auswahl. */
function inspectById(app, id) {
  if (id === 'w' || id.startsWith('w:')) return inspectWall(app);
  const m = /^o:(\d+)/.exec(id);
  if (m && app.project.wall.openings[+m[1]]) return inspectOpening(app, +m[1]);
  if (id === 'q' || id === 'q:w' || id === 'q:u') return loadPanel(app, 'auflast', 'Auflast am Wandkopf', ['top', 'bot', 'buck', 'buckEN']);
  if (id === 'c') return loadPanel(app, 'einzellast', 'Einzellast', ['conc', 'concMid']);
  if (id === 'v') return loadPanel(app, 'hkraft', 'Horizontalkraft', ['shear', 'shearEN', 'shearN']);
  if (id === 'p') return inspectLateral(app);
  if (id === 'e:L' || id === 'e:R') return inspectEdge(app, id === 'e:L' ? 'L' : 'R');
  return null;
}
