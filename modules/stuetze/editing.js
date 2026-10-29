// Stütze – grafische Bearbeitung: Trefferflächen für den Editor, Werkzeuge und Eigenschaftsfenster
//
// Darstellung «System» (bearbeitbar): Zeichenebene in m wie in allen Modulen (x waagrecht, y senkrecht) –
// waagrecht liegt die Ausbiegungsrichtung, senkrecht die Stützenachse (0 = Fuss, L = Kopf). Bei zwei
// Biegeebenen stehen die Bilder nebeneinander. Die Werkzeuge wirken einmal (once) und kehren dann zur
// Auswahl zurück, damit das Eigenschaftsfenster sofort die neuen Felder zeigt.
// IDs (Achse ax = 'y' | 'z'):
//   top:ax / bot:ax   Stützenkopf (ziehen ändert L) bzw. -fuss – Lagerung und Lasten am Ende
//   N:ax H:ax Mt:ax Mb:ax  Lastsymbole (öffnen das zugehörige Stützenende)
//   col:ax            Stütze (Länge, Lagerung, Querschnitt, Parameter, Ergebnisse)
//   q:ax              Streckenlast,   imp:ax  Imperfektion,   sec  Querschnitt-Einsatz
// Darstellung «Querschnitt» (nur Auswahl): qs Querschnitt, bar:k Bewehrungsstab k.
// Darstellungen «Verformung»/«Momente»: col:ax als Strecke – ein Klick zeigt die Werte auf dieser Höhe.
import { h, numField, selectField, checkField, button, kvTable, note, fmt } from '../../js/core/ui.js';
import { TOOL_ICONS } from '../../js/core/editor.js';
import { SUPPORT_PRESETS, LOAD_KEYS, normalize, newLoadCase, suggestN, supportState, presetFor } from './calc.js';
import { systemLayout, panelGeometry, lcIndex, shownAxes } from './views.js';
import { sectionGeometry } from './section.js';
import {
  INFO, supportTiles, supportEndFields, sectionShapeFields, barFields, coverFields, materialFields, sectionSummary,
  imperfectionFields, loadFields, ensureLoadCase, activeLoadCase, formulaLine, betaOf,
} from './inputs.js';

const parse = (id) => { const [t, ax] = String(id).split(':'); return { t, ax }; };
const AXNAME = { y: 'Biegung um y', z: 'Biegung um z' };
const END_OF = { top: 'top', N: 'top', H: 'top', Mt: 'top', bot: 'bot', Mb: 'bot' };
const two = (p) => shownAxes(p).length > 1;

// ------------------------------------------------------------------ Live-Werte im Eigenschaftsfenster

// Ergebnisblöcke im Fenster werden nach einer Neuberechnung an Ort und Stelle aktualisiert, solange
// ein Feld im Fenster den Fokus hat (sonst wird das ganze Fenster neu aufgebaut).
let live = [];
function liveBox(fn) {
  const el = h('div', { class: 'stz-live' });
  const upd = () => el.replaceChildren(...[].concat(fn() || []).flat(Infinity).filter(Boolean));
  upd();
  live.push(upd);
  return el;
}
export function updateLive() {
  for (const f of live) { try { f(); } catch (e) { console.error(e); } }
}

// ------------------------------------------------------------------ Adapter

export const editorSpec = {
  axes: ['x', 'y'],
  unit: 'm',
  digits: 3,
  grid: [0.05, 0.1, 0.25, 0.5, 1],
  gridDefault: 0.1,
  modes: ['system'],
  canCopy: false,
  tools: [
    { id: 'load', label: 'Last', key: 'f', form: 'pick', once: true, pick: ['point'], icon: TOOL_ICONS.pointload, title: 'Stützenkopf anklicken: Normalkraft, Horizontalkraft und Kopfmoment · Fuss anklicken: Fussmoment', hint: 'Stützenkopf oder -fuss anklicken.' },
    { id: 'dist', label: 'Streckenlast', key: 'q', form: 'pick', once: true, pick: ['region'], icon: TOOL_ICONS.load, title: 'Stütze anklicken: gleichmässige Querlast q über die ganze Höhe', hint: 'Stütze anklicken, auf die eine Streckenlast wirkt.' },
    { id: 'support', label: 'Lager', key: 'a', form: 'pick', once: true, pick: ['point'], icon: TOOL_ICONS.support, title: 'Stützenkopf oder -fuss anklicken: Lagerung wählen', hint: 'Stützenkopf oder -fuss anklicken.' },
  ],

  geometry(app) {
    const p = app.project;
    const mode = app.viewMode;
    if (mode === 'section') {
      let geo;
      try { geo = sectionGeometry(p.section); } catch { return {}; }
      return {
        points: geo.bars.map((b, k) => ({ id: `bar:${k}`, p: [b.y, b.z], label: `Stab ${k + 1}`, movable: false })),
        regions: [{ id: 'qs', ring: geo.poly, label: 'Querschnitt', movable: false }],
      };
    }
    const R = app.results;
    if ((mode === 'deform' || mode === 'moments') && R) {
      const pg = panelGeometry(R.p, mode);
      const L = R.p.L;
      const points = [], segments = [];
      for (const ax of pg.axes) {
        const x0 = pg.x0(ax);
        points.push({ id: `top:${ax}`, p: [x0, L], label: 'Stützenkopf', movable: false }, { id: `bot:${ax}`, p: [x0, 0], label: 'Stützenfuss', movable: false });
        segments.push({ id: `col:${ax}`, a: [x0, 0], b: [x0, L], label: 'Stütze – Werte auf dieser Höhe', movable: false });
      }
      return { points, segments };
    }
    // System: Pixelgrössen der Lastsymbole beim aktuellen Massstab in Weltkoordinaten
    const px = (n) => app.view.px(n);
    const lay = systemLayout(normalize(p), R, lcIndex(app));
    const L = lay.L, lc = lay.lc || {};
    const points = [], regions = [];
    for (const ax of lay.axes) {
      const { x0, hw, bc, ld, impHandle, qRing } = lay.panels[ax];
      points.push({ id: `top:${ax}`, p: [x0, L], label: 'Stützenkopf – ziehen ändert die Länge', movable: true });
      points.push({ id: `bot:${ax}`, p: [x0, 0], label: 'Stützenfuss', movable: false });
      if (lay.thetaI > 0) points.push({ id: `imp:${ax}`, p: impHandle, label: 'Imperfektion', movable: false });
      if (lc.N) points.push({ id: `N:${ax}`, p: [x0, L + px(24)], label: 'Normalkraft', movable: false });
      if (bc.sway && ld.H) points.push({ id: `H:${ax}`, p: [x0 - Math.sign(ld.H) * (hw + px(24)), L * 0.985], label: 'Horizontalkraft', movable: false });
      if (ld.Mt && bc.top !== 'fixed') points.push({ id: `Mt:${ax}`, p: [x0 + px(15.6), L + px(9)], label: 'Kopfmoment', movable: false });
      if (ld.Mb && bc.bot !== 'fixed') points.push({ id: `Mb:${ax}`, p: [x0 + px(15.6), px(9)], label: 'Fussmoment', movable: false });
      regions.push({ id: `col:${ax}`, ring: [[x0 - hw, 0], [x0 + hw, 0], [x0 + hw, L], [x0 - hw, L]], label: 'Stütze', movable: false });
      if (qRing) regions.push({ id: `q:${ax}`, ring: qRing, label: 'Streckenlast', movable: false });
    }
    if (lay.inset) regions.push({ id: 'sec', ring: lay.inset.ring, label: 'Querschnitt', movable: false });
    return { points, regions };
  },

  create() { return null; },

  pick(app, tool, hit) {
    return pickOnce(app, tool, hit);
  },

  // Nur der Stützenkopf ist verschiebbar: senkrechte Verschiebung = neue Länge L
  move(app, ids, d) {
    if (!ids.some((id) => parse(id).t === 'top')) { app.status('Nur der Stützenkopf lässt sich ziehen – er ändert die Länge L.', 'warn'); return ids; }
    const p = app.project;
    const L = Math.round((p.L + d[1]) * 1000) / 1000;
    if (!(L >= 0.5)) { app.status('Die Stützenlänge muss mindestens 0.5 m betragen.', 'warn'); return ids; }
    p.L = Math.min(80, L);
    app.stzNoFit = true;
    app.status(`Stützenlänge L = ${fmt(p.L, 2)} m`, 'ok');
    return ids;
  },

  onSelect(app, ids, hit) {
    app.stzPickX = hit?.type === 'segment' && hit.q ? hit.q[1] : null;
    const ax = parse(ids[0] || '').ax;
    if ((ax === 'y' || ax === 'z') && app.stzAxis !== ax && app.results) {
      app.stzAxis = ax;
      setTimeout(() => app.renderResults(), 0);
    }
  },

  inspect(app, ids) {
    live = [];
    if (ids.length !== 1) return { title: `${ids.length} Elemente`, content: [note('Ein einzelnes Element anklicken, um es zu bearbeiten.')] };
    const { t, ax } = parse(ids[0]);
    if (t === 'col') return inspectColumn(app, ax);
    if (END_OF[t]) return inspectEnd(app, ax, END_OF[t]);
    if (t === 'q') return inspectSpan(app, ax);
    if (t === 'imp') return inspectImperfection(app, ax);
    if (t === 'sec' || t === 'qs') return { title: 'Querschnitt', content: sectionEditor(app) };
    if (t === 'bar') return inspectBar(app, +ax);
    return null;
  },

  idleHint(app) {
    const p = app.project;
    if (app.viewMode === 'section') return 'Querschnitt oder einen Bewehrungsstab anklicken, um Abmessungen, Bewehrung und Baustoffe zu ändern.';
    if (!p.loadCases.length) {
      return h('span', {}, 'Werkzeug ', h('b', {}, 'Last'), ' (Taste F) wählen und den Stützenkopf anklicken – es entsteht ein Lastfall mit einer vorgeschlagenen Normalkraft. ',
        'Kopf oder Fuss anklicken ändert die Lagerung, das Querschnittsbild rechts die Abmessungen; den Kopf ziehen ändert die Länge.');
    }
    return h('span', {}, 'Stütze, Kopf, Fuss, Lastpfeile, Imperfektion oder Querschnitt anklicken, um sie zu bearbeiten. Kopf ziehen ändert die Länge (mit ',
      h('b', {}, 'Y'), ' senkrecht gebunden, Ziffern tippen für einen genauen Wert).');
  },
};

function pickOnce(app, tool, hit) {
  const p = app.project;
  const { t, ax } = parse(hit.id);
  const end = END_OF[t];
  if (tool === 'support') {
    if (!end) { app.status('Stützenkopf oder -fuss anklicken.', 'warn'); return null; }
    app.status(`${end === 'top' ? 'Stützenkopf' : 'Stützenfuss'}: Lagerung im Eigenschaftsfenster wählen`, 'ok');
    return [`${end}:${ax}`];
  }
  if (tool === 'load') {
    if (!end) { app.status('Kopf oder Fuss anklicken – für die Querlast gibt es das Werkzeug «Streckenlast» (Q).', 'warn'); return null; }
    const fresh = !p.loadCases.length;
    const lc = ensureLoadCase(app);
    let msg = '';
    if (!(+lc.N)) { lc.N = suggestN(p); msg = ` mit N = ${fmt(lc.N, 0)} kN (Vorschlag)`; }
    app.status(`${fresh ? `Lastfall «${lc.name}» angelegt` : `Lastfall «${lc.name}»`}${msg} – Werte im Eigenschaftsfenster anpassen`, 'ok');
    return [`${end}:${ax}`];
  }
  if (tool === 'dist') {
    if (t !== 'col' && t !== 'q') { app.status('Die Stütze anklicken.', 'warn'); return null; }
    const lc = ensureLoadCase(app);
    if (ax === 'z' && !p.biaxial) { p.biaxial = true; }
    const k = LOAD_KEYS[ax].q;
    if (!(+lc[k])) lc[k] = 5;
    app.status(`Streckenlast q = ${fmt(+lc[k], 1)} kN/m (${AXNAME[ax]}, ${lc.name}) – Wert im Eigenschaftsfenster anpassen`, 'ok');
    return [`q:${ax}`];
  }
  return null;
}

// ------------------------------------------------------------------ Bausteine

const changed = (app) => () => app.changed({ inputs: true });

/** Lastfallwahl (bzw. «Lastfall anlegen») in einer Zeile. */
function lcBar(app) {
  const p = app.project;
  if (!p.loadCases.length) {
    return [button('Lastfall anlegen', { icon: 'plus', small: true, primary: true, onClick: () => { ensureLoadCase(app); app.changed({ inputs: true }); } })];
  }
  const add = () => {
    const cur = activeLoadCase(app);
    p.loadCases.push(newLoadCase(p.loadCases.length + 1, cur ? (+cur.N || suggestN(p)) : suggestN(p)));
    app.viewOpts.lc = p.loadCases.length - 1;
    app.changed({ inputs: true });
  };
  const o = { v: lcIndex(app) };
  const sel = selectField('Lastfall', o, 'v', p.loadCases.map((lc, i) => ({ value: i, label: lc.name || `LF ${i + 1}` })), {
    wide: true, onChange: (v) => { app.viewOpts.lc = v; app.renderView(); app.renderResults(); app.editor.refreshPanel(true); },
  });
  return [h('div', { class: 'row' }, h('div', { style: { flex: '1' } }, sel), button('', { icon: 'plus', small: true, title: 'Neuen Lastfall anlegen', onClick: add }))];
}

function derivButton(app, id) {
  return app.results ? button('Herleitung ›', { small: true, ghost: true, title: 'Rechenweg anzeigen', onClick: () => app.showDerivation(id) }) : null;
}

/** Ergebnisse der Biegeachse im aktiven Lastfall. */
function axisResult(app, ax) {
  const r = app.results?.lcs?.[lcIndex(app)];
  return r ? { r, A: r[ax.toUpperCase()] } : null;
}

function nearestIndex(xs, x) {
  let k = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[k] - x)) k = i;
  return k;
}

function resultsBlock(app, ax) {
  return liveBox(() => {
    const res = axisResult(app, ax);
    if (!res) return app.error ? h('div', { class: 'muted small' }, app.errorIncomplete ? 'Ergebnisse erscheinen, sobald eine Last vorhanden ist.' : app.error) : null;
    const { r, A } = res;
    const out = [h('div', { class: 'ed-sub' }, `Ergebnisse · ${r.name}`)];
    const xPick = app.stzPickX;
    if (xPick !== null && xPick !== undefined && (app.viewMode === 'deform' || app.viewMode === 'moments') && A.at1) {
      const k = nearestIndex(A.x, xPick);
      out.push(kvTable([
        ['Höhe x', A.x[k], 'm', 2],
        ['w (2. Ordnung)', A.at1.w[k] * 1000, 'mm', 1],
        ['M_I / M_II', `${fmt(A.M1[k], 1)} / ${fmt(A.at1.M[k], 1)}`, 'kNm'],
      ]));
    }
    out.push(kvTable([
      ['λ / λ_lim', `${fmt(A.lam, 1)} / ${Number.isFinite(A.lamLim) ? fmt(A.lamLim, 1) : '∞'}`, ''],
      ['M_Ed,I / M_Ed,II', `${fmt(A.M1max, 1)} / ${A.M2max !== null ? fmt(A.M2max, 1) : '–'}`, 'kNm'],
      ['M_Rd(N_Ed)', A.MRd, 'kNm', 1],
      ['Traglastfaktor λ_u', A.lambdaU, '', 2],
    ]));
    out.push(h('div', { class: 'row' }, derivButton(app, `allg-${ax}`)));
    return out;
  });
}

/** Querschnitt, Bewehrung und Baustoffe (Eigenschaftsfenster). */
function sectionEditor(app) {
  const p = app.project, sp = p.section;
  const ch = changed(app);
  return [
    ...sectionShapeFields(sp, ch, ch),
    h('div', { class: 'ed-sub' }, 'Längsbewehrung'),
    ...barFields(sp, ch),
    ...coverFields(sp, ch, ch),
    h('div', { class: 'ed-sub' }, 'Baustoffe'),
    ...materialFields(p, ch),
    ...sectionSummary(p, true),
  ];
}

/** Knöpfe, die ein anderes Element der Grafik zum Bearbeiten öffnen. */
function jumpRow(app, items) {
  return h('div', { class: 'row' }, items.map(([label, id, title]) => button(`${label} ›`, { small: true, ghost: true, title, onClick: () => app.editor.select([id]) })));
}

// ------------------------------------------------------------------ Eigenschaftsfenster

function inspectColumn(app, ax) {
  const p = app.project;
  const ch = changed(app);
  const sepZ = ax === 'z' && p.supportZ !== 'same';
  const proxy = { v: sepZ ? p.supportZ : p.support };
  const setTile = () => {
    if (ax === 'z') {
      if (p.supportZ === 'same') p.customZ = { ...p.custom };
      p.supportZ = proxy.v;
    } else p.support = proxy.v;
    ch();
  };
  const beta = axisResult(app, ax)?.A?.beta ?? betaOf(p, ax, app.results);
  const lc = activeLoadCase(app);
  const content = [
    numField('Länge L', p, 'L', { unit: 'm', min: 0.2, max: 80, onChange: ch, info: INFO.L }),
    h('div', { class: 'ed-sub' }, two(p) ? `Lagerung · ${AXNAME[ax]}` : 'Lagerung'),
    supportTiles(proxy, 'v', setTile),
    beta ? formulaLine(`β = ${fmt(beta, 2)} → l_0 = ${fmt(beta * p.L, 2)} m`) : null,
    two(p) ? checkField('Gleiche Lagerung y und z', { v: p.supportZ === 'same' }, 'v', {
      onChange: (v) => { if (v) p.supportZ = 'same'; else { p.supportZ = p.support; p.customZ = { ...p.custom }; } ch(); },
    }) : null,
    jumpRow(app, [
      ['Kopf', `top:${ax}`, 'Lagerung und Lasten am Stützenkopf'],
      ['Fuss', `bot:${ax}`, 'Lagerung und Moment am Stützenfuss'],
      ['Querschnitt', 'sec', 'Abmessungen, Bewehrung, Baustoffe'],
      lc ? ['Imperfektion', `imp:${ax}`, 'Schiefstellung bzw. Vorkrümmung'] : null,
    ].filter(Boolean)),
  ];
  if (lc && (ax === 'y' || p.biaxial)) content.push(h('div', { class: 'ed-sub' }, 'Streckenlast'), ...lcBar(app), ...loadFields(lc, ax, 'span', ch));
  // in «Verformung»/«Momente» stehen die Werte an der angeklickten Stelle oben
  if (app.viewMode === 'deform' || app.viewMode === 'moments') content.unshift(resultsBlock(app, ax));
  else content.push(resultsBlock(app, ax));
  return { title: two(p) ? `Stütze · ${AXNAME[ax]}` : 'Stütze', content };
}

function inspectEnd(app, ax, end) {
  const p = app.project;
  const ch = changed(app);
  const st = supportState(p, ax);
  const key = presetFor(st);
  const beta = axisResult(app, ax)?.A?.beta ?? SUPPORT_PRESETS[key]?.beta;
  const lc = activeLoadCase(app);
  const k = LOAD_KEYS[ax];
  const content = [
    ...supportEndFields(p, ax, end, ch),
    formulaLine(`${SUPPORT_PRESETS[key].short}${beta ? ` · β = ${fmt(beta, 2)}` : ''}`),
    h('div', { class: 'ed-sub' }, end === 'top' ? 'Lasten am Kopf' : 'Last am Fuss'),
    ...lcBar(app),
  ];
  if (lc) {
    const zOff = ax === 'z' && !p.biaxial;
    if (end === 'top') content.push(...loadFields(lc, ax, 'top', ch).slice(0, zOff ? 1 : 3));
    else if (!zOff) content.push(...loadFields(lc, ax, 'bot', ch));
    if (zOff) content.push(checkField('Lasten auch um z', p, 'biaxial', { onChange: ch, info: INFO.biaxial }));
    const Mkey = end === 'top' ? k.Mt : k.Mb;
    if (!zOff && st[end] === 'fixed' && +lc[Mkey]) content.push(note('Das Moment geht direkt ins eingespannte Auflager.', 'warn'));
    if (!zOff && end === 'top' && !st.sway && +lc[k.H]) content.push(note('H wird vom gehaltenen Kopf aufgenommen – «Kopf verschieblich» ankreuzen, falls er ausweichen kann.', 'warn'));
  }
  content.push(liveBox(() => {
    const rr = axisResult(app, ax);
    if (!rr?.A?.at1) return null;
    const A = rr.A, i = end === 'top' ? A.x.length - 1 : 0;
    return [h('div', { class: 'ed-sub' }, `Ergebnisse · ${rr.r.name}`), kvTable([
      ['M_II am Ende', A.at1.M[i], 'kNm', 1],
      end === 'top' && A.sway ? ['w_Kopf (2. Ordnung)', A.at1.w[i] * 1000, 'mm', 1] : null,
    ].filter(Boolean))];
  }));
  return { title: `${end === 'top' ? 'Stützenkopf' : 'Stützenfuss'}${two(p) ? ` · ${AXNAME[ax]}` : ''}`, content };
}

function inspectSpan(app, ax) {
  const ch = changed(app);
  const lc = activeLoadCase(app);
  const k = LOAD_KEYS[ax].q;
  return {
    title: `Streckenlast${two(app.project) ? ` · ${AXNAME[ax]}` : ''}`,
    content: [
      ...lcBar(app),
      ...(lc ? loadFields(lc, ax, 'span', ch) : []),
      lc ? h('div', { class: 'row' }, button('Entfernen', { icon: 'trash', small: true, danger: true, title: 'Streckenlast in diesem Lastfall auf 0 setzen', onClick: () => { lc[k] = 0; ch(); } })) : null,
    ],
  };
}

function inspectImperfection(app, ax) {
  const p = app.project;
  const ch = changed(app);
  return {
    title: 'Imperfektion',
    content: [
      ...imperfectionFields(p, ch, ch),
      liveBox(() => {
        const A = axisResult(app, ax)?.A;
        if (!A || !(A.thetaI > 0)) return null;
        return [formulaLine(A.sway
          ? `${AXNAME[ax]}: θ_i·L = ${fmt(A.impAmp * 1000, 1)} mm (Kopfauslenkung)`
          : `${AXNAME[ax]}: e_i = θ_i·l_0/2 = ${fmt(A.ei * 1000, 1)} mm`), h('div', { class: 'row' }, derivButton(app, 'imp'))];
      }),
    ],
  };
}

function inspectBar(app, k) {
  const p = app.project, sp = p.section;
  const ch = changed(app);
  let pos = null, n = 0;
  try {
    const g = sectionGeometry(sp);
    n = g.n;
    const b = g.bars[k];
    if (b) pos = `y = ${fmt(b.y * 1000, 0)} mm · z = ${fmt(b.z * 1000, 0)} mm`;
  } catch { /* ungültig */ }
  return {
    title: `Längsbewehrung${n ? ` · Stab ${k + 1}/${n}` : ''}`,
    content: [
      pos ? formulaLine(pos) : null,
      ...barFields(sp, ch),
      ...coverFields(sp, ch, ch),
      ...sectionSummary(p, true),
    ],
  };
}
