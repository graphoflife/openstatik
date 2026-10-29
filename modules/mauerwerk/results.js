// Ergebnisbereich Mauerwerk: Zusammenfassung, Nachweise je Register, Diagramme
// Formelzeichen mit Unterstrich (f_xd, n_Rd …) werden von den Kernbausteinen tiefgestellt.
import { h, stats, checksTable, summaryCard, note, kvTable, resultTable, tabs, fmt, emptyState, icon, utilBar, rich, infoTip } from '../../js/core/ui.js';
import { chartBox } from '../../js/core/chart.js';
import { buildStrip, bucklingFactor, phiMidEN, shearSIA, shearEN } from './calc.js';
import { pickCombo } from './view.js';
import { DERIV_OF } from './derivation.js';

const state = { tab: 'over' };

/** Modulspezifische Stile (nur CSS-Variablen). */
export function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById('mw-style')) return;
  const st = document.createElement('style');
  st.id = 'mw-style';
  st.textContent = `
.mw-formula { font-family: var(--mono); font-size: 11.5px; line-height: 1.6; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 6px 9px; margin: 0 0 10px; white-space: pre-wrap; color: var(--text); overflow-x: auto; }
.mw-verdict { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; margin: 0 0 10px; font-weight: 600; border: 1px solid var(--border); }
.mw-verdict svg { flex: none; }
.mw-verdict.ok { background: var(--ok-soft); color: var(--ok); border-color: var(--ok); }
.mw-verdict.fail { background: var(--fail-soft); color: var(--fail); border-color: var(--fail); }
.mw-verdict .mw-v-eta { font-weight: 400; color: var(--text-2); margin-left: auto; white-space: nowrap; }
.mw-h { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--text-2); margin: 14px 0 6px; }
.mw-res-tabs > .tab-bar { padding: 4px 0 0; background: var(--surface); }
.mw-res-tabs > .tab-content { padding: 10px 0 0; }
.mw-resrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.mw-resrow > span { font-size: 12px; color: var(--text-2); }
`;
  document.head.append(st);
}

const ok = (eta) => Number.isFinite(eta) && eta <= 1.0001;
const etaTxt = (eta) => (Number.isFinite(eta) ? fmt(eta, 2) : '∞');
const derivLink = (id) => h('button', { type: 'button', class: 'chk-link', title: 'Rechenweg mit Formeln und eingesetzten Werten', onclick: () => document.dispatchEvent(new CustomEvent('os-derivation', { detail: id })) }, 'Herleitung ›');

/** Klare Aussage «erfüllt / nicht erfüllt» mit Erklärung (?) und Link zur Herleitung. */
export function verdict(eta, what, info, deriv) {
  const good = ok(eta);
  return h('div', { class: `mw-verdict ${good ? 'ok' : 'fail'}` }, icon(good ? 'check' : 'warn'),
    h('span', {}, `${what} ${good ? 'erfüllt' : 'nicht erfüllt'}`), info ? infoTip(info) : null,
    h('span', { class: 'mw-v-eta' }, `η = ${etaTxt(eta)}`), deriv ? derivLink(deriv) : null);
}

/** Formelblock mit Tiefstellung. */
function formula(lines) { return h('div', { class: 'mw-formula' }, rich(lines.filter(Boolean).join('\n'))); }

const maxEta = (list) => list.reduce((m, c) => (!Number.isFinite(c.eta) || c.eta > m ? (Number.isFinite(c.eta) ? c.eta : Infinity) : m), 0);
const T = (label, unit, digits, num = true) => ({ label, unit, digits, num });

export function renderResults(el, app) {
  ensureStyle();
  const R = app.results;
  const gov = R.gov;
  el.append(summaryCard(R.etaMax, 'Maximale Ausnutzung', gov ? h('div', { class: 'muted small' }, rich(`massgebend: ${gov.label} · ${gov.lc}`)) : null));
  const failed = R.checks.filter((c) => !ok(c.eta));
  if (failed.length) el.append(h('div', { class: 'mw-verdict fail' }, icon('warn'), h('span', {}, rich(`Nicht erfüllt: ${failed.map((c) => `${c.label} (η = ${etaTxt(c.eta)})`).join(', ')}`))));

  const buck = R.checks.find((c) => c.id === 'buck' || c.id === 'buckEN');
  const shear = R.checks.find((c) => c.id === 'shear' || c.id === 'shearEN');
  const conc = R.checks.find((c) => c.id === 'conc');
  const lat = R.checks.find((c) => c.id === 'lat');
  el.append(stats([
    ['f_xd', R.md.fxd, 'MPa', 2],
    ['h_ef/t', R.slender, '', 1],
    buck ? ['n_Rd Knicken', buck.Rd, 'kN/m', 0] : null,
    shear ? ['V_Rd Scheibe', shear.Rd, 'kN', 1] : null,
    conc && !shear ? ['N_Rdc Teilfläche', conc.Rd, 'kN', 1] : null,
    lat && !shear && !conc ? ['p_Rd Querlast', lat.Rd, 'kN/m²', 2] : null,
  ].filter(Boolean).slice(0, 4)));

  const has = (ids) => R.checks.some((c) => ids.includes(c.id));
  const defs = [
    { id: 'over', label: 'Übersicht', render: (c) => tabOverview(c, R) },
    { id: 'druck', label: 'Druck', render: (c) => tabDruck(c, R, app) },
    has(['shear', 'shearEN']) ? { id: 'schub', label: 'Schub', render: (c) => tabSchub(c, R, app) } : null,
    has(['conc']) ? { id: 'teil', label: 'Teilfläche', render: (c) => tabTeil(c, R) } : null,
    has(['lat', 'basMax', 'basMin']) ? { id: 'quer', label: 'Querlast', render: (c) => tabQuer(c, R, app) } : null,
    { id: 'gebrauch', label: 'Gebrauch', render: (c) => tabGebrauch(c, R) },
  ].filter(Boolean);
  let init = true;
  const t = tabs(defs, {
    active: state.tab,
    onSwitch: (id) => {
      state.tab = id;
      if (init) return;
      const mode = { druck: 'schnitt', quer: 'schnitt', schub: 'schub', teil: 'ansicht' }[id];
      if (mode && app.viewMode !== mode) app.setViewMode(mode);
    },
  });
  init = false;
  t.el.classList.add('mw-res-tabs');
  el.append(t.el);
}

// ======================================================================== Übersicht

function tabOverview(el, R) {
  el.append(checksTable(R.checks.map((c) => ({
    label: c.label, ref: c.ref, Ed: c.Ed, Rd: c.Rd, unit: c.unit, digits: c.digits ?? (c.unit === 'kN/m²' ? 2 : 1), eta: c.eta, deriv: DERIV_OF[c.id],
    detail: rich([c.lc && c.lc !== 'alle' ? c.lc : null, c.detail, c.id === 'basMin' ? 'E_d = erforderlich, R_d = vorhanden' : null].filter(Boolean).join(' · ')) || null,
  }))));
  if (R.notes.length) {
    el.append(h('div', { class: 'mw-h' }, `Hinweise (${R.notes.length})`));
    for (const n of R.notes) el.append(note(rich(n), 'warn'));
  }
  el.append(h('div', { class: 'mw-h' }, 'Kombinationen'));
  const anyV = R.combos.some((c) => c.shear), anyP = R.combos.some((c) => c.pMax > 0);
  el.append(resultTable(
    ['Kombination', T('n_d,o', 'kN/m', 1), T('e_o', 'mm', 1), anyV ? T('V_d', 'kN', 1) : null, anyP ? T('p_d', 'kN/m²', 2) : null, 'η'].filter(Boolean),
    R.combos.map((c) => {
      const etas = Object.values(c.checks).map((x) => x.eta);
      const e = etas.length ? Math.max(...etas.map((x) => (Number.isFinite(x) ? x : 1e9))) : 0;
      const row = [`${c.name}${c.type === 'SLS' ? ' (GZG)' : ''}`, c.nTop, c.eTop * 1000];
      if (anyV) row.push(c.shear ? c.shear.V : 0);
      if (anyP) row.push(c.pMax);
      row.push(etas.length ? utilBar(e >= 1e9 ? Infinity : e) : '–');
      return row;
    })));
}

// ======================================================================== Druck

function tabDruck(el, R, app) {
  const list = R.checks.filter((c) => ['top', 'bot', 'buck', 'buckEN'].includes(c.id));
  const sia = R.method === 'SIA';
  el.append(verdict(maxEta(list), 'Normalkraft', sia
    ? 'Wandstreifen 1 m, gelenkig oben und unten, Werkstoff ohne Zugfestigkeit (linear-elastisch – ideal-plastisch). Biegelinie nach Theorie 2. Ordnung; die Vertikallast wird bis zum Versagen gesteigert (λ_u). Querschnitt mit Spannungsblock.'
    : 'EN 1996-1-1: Φ_i = 1 − 2e_i/t an Kopf und Fuss, Φ_m nach Anhang G in Wandmitte.', 'buck'));
  const uls = R.combos.filter((c) => c.type === 'ULS');
  if (sia) {
    el.append(resultTable(
      ['Kombination', T('η Kopf', '', 2), T('η Fuss', '', 2), T('n_Rd', 'kN/m', 0), 'η Knicken'],
      uls.map((c) => [c.name, c.checks.top.eta, c.checks.bot.eta, c.buck.nRd, utilBar(c.buck.eta)])));
  } else {
    el.append(resultTable(
      ['Kombination', T('Φ_o', '', 2), T('Φ_u', '', 2), T('Φ_m', '', 2), 'η Mitte'],
      uls.map((c) => [c.name, c.en.top.phi, c.en.bot.phi, c.en.mid.phi, utilBar(c.checks.buckEN.eta)])));
  }
  el.append(formula([
    `f_xd = f_xk/γ_M = ${fmt(R.md.fxk, 2)}/${fmt(R.md.gammaM, 2)} = ${fmt(R.md.fxd, 2)} MPa`,
    `h_ef = ρ·h = ${fmt(R.eff.rho, 3)}·${fmt(R.h, 2)} = ${fmt(R.hef, 2)} m;  h_ef/t = ${fmt(R.slender, 1)}`,
    `e_0 = h_ef/${fmt(R.nImp, 0)} = ${fmt(R.eImp * 1000, 1)} mm`,
    sia ? `E_xd = E_xk/γ_E = ${fmt(R.md.Exd, 0)} MPa` : `λ = h_ef/t·√(f_k/E) = ${fmt(R.slender * Math.sqrt(R.md.fxk / R.md.Exk), 3)}`,
  ]));
  const c = pickCombo(app, 'schnitt');
  if (!c || c.type !== 'ULS') return;
  el.append(h('div', { class: 'mw-h' }, c.name));
  if (sia) {
    const b = c.buck;
    el.append(kvTable([
      ['n_d Kopf / Mitte / Fuss', `${fmt(c.nTop, 1)} / ${fmt(c.nMid, 1)} / ${fmt(c.nBot, 1)}`, 'kN/m'],
      ['e_o / e_u', `${fmt(c.eTop * 1000, 1)} / ${fmt(c.eBot * 1000, 1)}`, 'mm'],
      ['E_eff (φ_eff = ' + fmt(c.phiEff, 2) + ')', c.Eeff / 1000, 'MPa', 0],
      ['λ_u', Number.isFinite(b.xMax) ? b.xMax : '> 1000', '', 3],
      ['Schnitt z', b.z, 'm', 2],
      ['n_Rd = λ_u·n_Ed', b.nRd, 'kN/m', 1],
      ['Φ = n_Rd/(t·f_xd)', b.phi, '', 3],
      ['Versagen', b.mode, ''],
    ]));
  } else {
    const m = c.en.mid;
    el.append(kvTable([
      ['Φ_o (e_i,o = ' + fmt(c.en.top.e * 1000, 1) + ' mm)', c.en.top.phi, '', 3],
      ['Φ_u (e_i,u = ' + fmt(c.en.bot.e * 1000, 1) + ' mm)', c.en.bot.phi, '', 3],
      ['e_m / e_k / e_mk', `${fmt(m.em * 1000, 1)} / ${fmt(m.ek * 1000, 1)} / ${fmt(m.emk * 1000, 1)}`, 'mm'],
      ['A_1 / λ / u', `${fmt(m.A1, 3)} / ${fmt(m.lam, 3)} / ${fmt(m.u, 3)}`, ''],
      ['Φ_m', m.phi, '', 3],
      ['n_Rd,m = Φ_m·t·f_xd', m.nRd, 'kN/m', 1],
    ]));
  }
  el.append(eccChart(c, R, 'Exzentrizität über die Höhe'));
  if (sia) el.append(bucklingCurve(c, R));
}

/** Diagramm Exzentrizität über die Höhe. */
function eccChart(c, R, title, profile = c.profile) {
  const t = R.t * 1000;
  const series = [
    { points: profile.pts.map((q) => [(q.e1 + q.eq) * 1000, q.z]), label: 'Th. 1. O.', color: 'var(--c-dim)', dash: '5 4', width: 1.5 },
  ];
  if (profile.ok) series.push({ points: profile.pts.map((q) => [q.e * 1000, q.z]), label: 'Stützlinie Th. 2. O.', color: 'var(--c-pos)', width: 2.2 });
  return chartBox({
    title, series, xLabel: 'Exzentrizität e [mm] (+ Raumseite)', yLabel: 'Höhe z [m]', height: 290,
    xRange: [-t * 0.55, t * 0.55], yRange: [0, R.h],
    vLines: [{ v: -t / 2, color: 'var(--fail)', dash: '0', label: '' }, { v: t / 2, color: 'var(--fail)', dash: '0', label: 'Rand' }, { v: -t / 6, label: '' }, { v: t / 6, label: 'Kern' }],
  });
}

const curveCache = new WeakMap();
/** Knickkurve Φ(h_ef/t) für die gewählte Kombination (numerisch) mit Vergleich EN 1996-1-1 Anhang G. */
function bucklingCurve(c, R) {
  const box = h('div', { class: 'chart-box' }, h('div', { class: 'placeholder' }, 'Knickkurve wird berechnet …'));
  const draw = (data) => {
    const svg = chartBox({
      title: `Φ = n_Rd/(t·f_xd) – ${c.name}`,
      series: [
        { points: data.num, label: 'Th. 2. O. (numerisch)', color: 'var(--c-pos)', width: 2.2, markers: true },
        { points: data.en, label: 'EN 1996-1-1 Anh. G', color: 'var(--c-series-5)', dash: '6 4' },
      ],
      points: [{ x: R.slender, y: c.buck.phi, label: 'Wand', color: 'var(--c-neg)' }],
      xLabel: 'Schlankheit h_ef/t', yLabel: 'Φ [–]', height: 260, yRange: [0, 1], xRange: [0, Math.max(30, R.slender + 2)],
      vLines: [{ v: R.lambdaLim, label: `Grenze ${fmt(R.lambdaLim, 0)}`, color: 'var(--warn)' }],
    });
    box.replaceWith(svg);
  };
  if (curveCache.has(c)) { setTimeout(() => draw(curveCache.get(c)), 0); return box; }
  setTimeout(() => {
    if (!box.isConnected) return;
    const M = c.model, t = R.t, f = R.fxd;
    const mid = Math.floor(M.m / 2);
    const nMid = M.N[mid];
    const num = [], en = [];
    for (let s = 1; s <= 31; s += 3) {
      const hef = s * t;
      const S = buildStrip({ h: M.h, hef, t, f, E: M.E, nTop: M.nTop, gw: M.gw, eTop: M.eTop, eBot: M.eBot, pFn: M.pFn, eImp: hef / R.nImp, nseg: 24, impSign: M.impSign });
      const lf = bucklingFactor(S);
      num.push([s, Number.isFinite(lf.xMax) ? Math.min(1, lf.xMax * nMid / (t * f)) : 1]);
    }
    const e0 = M.M1[mid] / nMid, ehm = M.Mq[mid] / nMid;
    for (let s = 0; s <= 31; s += 0.5) {
      const hef = s * t;
      const em = Math.abs(e0 + ehm) + hef / R.nImp;
      const ek = s > 15 ? 0.002 * R.md.phi * s * Math.sqrt(t * em) : 0;
      const emk = Math.max(em + ek, 0.05 * t);
      en.push([s, phiMidEN({ hef, t, emk, fk: R.md.fxk, E: R.md.Exk }).phi]);
    }
    const data = { num, en };
    curveCache.set(c, data);
    if (box.isConnected) draw(data);
  }, 30);
  return box;
}

// ======================================================================== Schub

function tabSchub(el, R, app) {
  const list = R.checks.filter((c) => ['shear', 'shearEN', 'shearN'].includes(c.id));
  const sia = R.shearMethod === 'SIA';
  el.append(verdict(maxEta(list), 'Querkraft', sia
    ? 'Spannungsfeld: N und V laufen über ein geneigtes Druckfeld in die Druckzone l_c am Wandfuss. Fliessbedingungen nach Ganz/Thürlimann ohne Kohäsion: σ_x/f_xd + σ_y/f_yd ≤ 1, Gleiten τ ≤ μ·σ_x.'
    : 'EN 1996-1-1, 6.2: V_Rd = f_vd·t·l_c mit f_vk = f_vk0 + 0.4·σ_d ≤ f_vlt und überdrückter Länge l_c.', 'shear'));
  const uls = R.combos.filter((c) => c.shear);
  el.append(resultTable(
    ['Kombination', T('N_d', 'kN', 0), T('V_d', 'kN', 1), T('l_c', 'm', 2), T('V_Rd', 'kN', 1), 'η'],
    uls.map((c) => [c.name, c.shear.N, c.shear.V, c.shear.lc, c.shear.VRd, utilBar((c.checks.shear || c.checks.shearEN).eta)])));
  let c = pickCombo(app, 'schub');
  if (!c?.shear) c = uls[0];
  if (!c) return;
  const s = c.shear, l = R.l;
  el.append(h('div', { class: 'mw-h' }, c.name));
  if (sia) {
    el.append(formula([
      `N_d = ${fmt(s.N, 1)} kN, V_d = ${fmt(s.V, 1)} kN, h_0 = ${fmt(s.h0, 2)} m`,
      `V_Rd,c = −t·h_0·f_yd + √((t·h_0·f_yd)² + f_yd·N·(t·l − N/f_xd)) = ${fmt(s.Vstrut, 1)} kN`,
      `V_Rd,f = μ·N = ${fmt(s.Vfric, 1)} kN`,
      `V_Rd = ${fmt(s.VRd, 1)} kN (${s.mode})`,
      `l_c = l − 2·V·h_0/N = ${fmt(s.lc, 2)} m;  σ_x = ${fmt(s.sx / 1000, 3)}, τ = ${fmt(s.tau / 1000, 3)} MPa`,
    ]));
  } else {
    el.append(formula([
      `N_d = ${fmt(s.N, 1)} kN, V_d = ${fmt(s.V, 1)} kN → e = ${fmt(s.e, 3)} m`,
      `l_c = ${s.e <= l / 6 ? 'l' : '3·(l/2 − e)'} = ${fmt(s.lc, 2)} m;  σ_d = ${fmt(s.sd / 1000, 3)} MPa`,
      `f_vk = min(f_vk0 + 0.4·σ_d; f_vlt) = ${fmt(s.fvk / 1000, 3)} MPa`,
      `V_Rd = f_vk/γ_M·t·l_c = ${fmt(s.VRd, 1)} kN;  N_Rd = ${fmt(s.NRd, 1)} kN`,
    ]));
  }
  el.append(shearChart(R, uls));
}

function shearChart(R, uls) {
  const t = R.t, l = R.l, sia = R.shearMethod === 'SIA';
  const s0 = uls[0].shear;
  const Nmax = t * l * R.fxd;
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const N = Nmax * i / 60;
    let V;
    if (sia) V = shearSIA({ N, t, l, h0: s0.h0, fxd: R.fxd, fyd: R.fyd, mu: R.md.mu }).VRd;
    else {
      const g = (v) => { const r = shearEN({ N, V: v, t, l, h0: s0.h0, fvk0: R.md.fvk0 * 1000, fvlt: R.md.fvlt * 1000, gammaM: R.md.gammaM, fxd: R.fxd }); return Math.min(r.VRd - v, r.NRd - N); };
      let a = 0, b = Nmax;
      if (g(0) < 0) V = 0;
      else { for (let k = 0; k < 50; k++) { const m = (a + b) / 2; if (g(m) >= 0) a = m; else b = m; } V = a; }
    }
    pts.push([N, V]);
  }
  return chartBox({
    title: `Interaktion V_d–N_d (h_0 = ${fmt(s0.h0, 2)} m)`,
    series: [{ points: pts, label: 'V_Rd', color: 'var(--c-pos)', fill: true, width: 2.2 }],
    points: uls.map((c, i) => ({ x: c.shear.N, y: c.shear.V, label: String(i + 1), title: c.name, color: ok((c.checks.shear || c.checks.shearEN).eta) ? 'var(--ok)' : 'var(--fail)' })),
    xLabel: 'N_d [kN]', yLabel: 'V_d [kN]', height: 260,
  });
}

// ======================================================================== Teilfläche

function tabTeil(el, R) {
  const list = R.checks.filter((c) => ['conc', 'concMid'].includes(c.id));
  el.append(verdict(maxEta(list), 'Teilfläche', 'Einzellast unter der Lastfläche A_b am Wandkopf (EN 1996-1-1, 6.1.3): Erhöhungsfaktor β nur für Vollsteine, Lastausbreitung unter 60° bis Wandmitte.', 'conc'));
  const c = R.combos.filter((x) => x.conc).reduce((a, b) => (b.checks.conc.eta > (a?.checks.conc.eta ?? -1) ? b : a), null);
  if (!c) return;
  const q = c.conc;
  el.append(checksTable([
    { label: 'Pressung unter A_b', ref: 'EN 1996-1-1 (6.9)', Ed: q.Nc, Rd: q.NRdc, unit: 'kN', eta: c.checks.conc.eta, deriv: 'conc' },
    { label: 'Wandmitte (60°)', ref: 'EN 1996-1-1, 6.1.3 (4)', Ed: q.nEdMid, Rd: q.nRdMid, unit: 'kN/m', eta: c.checks.concMid.eta, deriv: 'conc' },
  ]));
  el.append(h('div', { class: 'mw-h' }, c.name));
  el.append(kvTable([
    ['N_c,d', q.Nc, 'kN', 1],
    ['A_b = a·b', q.Ab * 1e4, 'cm²', 0],
    ['a_1', q.a1, 'm', 2],
    ['l_efm', q.lefm, 'm', 3],
    ['A_b/A_ef', q.ratio, '', 3],
    ['β' + (R.md.solid ? '' : ' (Lochsteine)'), q.beta, '', 3],
  ]));
}

// ======================================================================== Querlast

function tabQuer(el, R, app) {
  const list = R.checks.filter((c) => ['lat', 'basMax', 'basMin'].includes(c.id));
  el.append(verdict(maxEta(list), 'Querbelastung', 'Die Querlast wird bei festen Vertikallasten bis zum Versagen gesteigert (μ_u). Die Stützlinie muss in der Wand bleiben; die Bogenwirkung wird über die Lage der Resultierenden am Wandfuss erfasst.', R.checks.some((c) => c.id === 'lat') ? 'lat' : 'bas'));
  const withLat = R.combos.filter((c) => c.lat);
  if (withLat.length) {
    el.append(resultTable(
      ['Kombination', T('p_d', 'kN/m²', 2), T('n_d,m', 'kN/m', 1), T('μ_u', '', 2), T('e_u', 'mm', 0), 'η'],
      withLat.map((c) => [c.name, c.pMax, c.nMid, Number.isFinite(c.lat.xMax) ? c.lat.xMax : '> 1000', c.lat.eU * 1000, utilBar(c.lat.eta)])));
    const c = withLat.reduce((a, b) => ((Number.isFinite(b.lat.eta) ? b.lat.eta : 1e9) > (Number.isFinite(a.lat.eta) ? a.lat.eta : 1e9) ? b : a));
    el.append(h('div', { class: 'mw-h' }, c.name));
    el.append(kvTable([
      ['μ_u', Number.isFinite(c.lat.xMax) ? c.lat.xMax : '> 1000', '', 3],
      ['e_u (Wandfuss)', c.lat.eU * 1000, 'mm', 1],
      ['Bogenwirkung', c.lat.arching ? 'ja' : 'nein', ''],
      ['Versagen', c.lat.blocked ? 'Normalkraft ohne Querlast ungenügend' : c.lat.mode, ''],
    ]));
    el.append(eccChart(c, R, 'Stützlinie unter Bemessungslast', c.lat.profile || c.profile));
  }
  const bas = R.combos.filter((c) => c.basement);
  if (bas.length) {
    const b0 = bas[0].basement;
    el.append(h('div', { class: 'mw-h' }, 'Kellerwand EN 1996-3, 4.5'));
    el.append(resultTable(
      ['Kombination', T('N_Ed', 'kN/m', 1), 'η max', 'η min'],
      bas.map((c) => [c.name, c.basement.N, utilBar(c.checks.basMax.eta), utilBar(c.checks.basMin.eta)])));
    el.append(formula([
      `N_max,Rd = t·f_d/3 = ${fmt(b0.NmaxRd, 1)} kN/m`,
      `N_min = ρ_e·h·h_e²/(β·t) = ${fmt(b0.NminReq, 1)} kN/m  (β = ${fmt(b0.beta, 0)}, b_c = ${fmt(app.project.settings.bc, 2)} m)`,
    ]));
  }
}

// ======================================================================== Gebrauch

function tabGebrauch(el, R) {
  const list = R.checks.filter((c) => ['slender', 'crack'].includes(c.id));
  el.append(verdict(maxEta(list), 'Gebrauchstauglichkeit', 'Schlankheit h_ef/t ≤ 27 (EN 1996-1-1, 5.5.1.4). Klaffende Fuge unter charakteristischen Lasten: |e| ≤ t/3 (Empfehlung zur Rissbegrenzung, Th. 1. O.).', 'gzg'));
  el.append(checksTable(list.map((c) => ({ label: c.label, ref: c.ref, Ed: c.Ed, Rd: c.Rd, unit: c.unit, digits: 1, eta: c.eta, deriv: 'gzg' }))));
  const sls = R.combos.filter((c) => c.sls);
  if (!sls.length) {
    el.append(emptyState('Keine Kombination GZG', 'Im Register «Lasten» eine Kombination der Art «Gebrauch (GZG)» aktivieren, um die klaffende Fuge zu prüfen.'));
    return;
  }
  el.append(resultTable(
    ['Kombination', T('e_o', 'mm', 1), T('e_m', 'mm', 1), T('e_u', 'mm', 1), T('t/3', 'mm', 1), 'η'],
    sls.map((c) => [c.name, c.sls.eTop * 1000, c.sls.eMid * 1000, c.sls.eBot * 1000, c.sls.lim * 1000, utilBar(c.checks.crack.eta)])));
}
