// Ergebnisbereich Mauerwerk: Zusammenfassung, Nachweise je Register, Diagramme
import { h, stats, checksTable, summaryCard, note, kvTable, resultTable, tabs, fmt, emptyState, icon, utilBar } from '../../js/core/ui.js';
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
.mw-formula { font-family: var(--mono); font-size: 11.5px; line-height: 1.55; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 6px 9px; margin: 4px 0 10px; white-space: pre-wrap; color: var(--text); overflow-x: auto; }
.mw-verdict { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; margin: 0 0 10px; font-weight: 600; border: 1px solid var(--border); }
.mw-verdict svg { flex: none; }
.mw-verdict.ok { background: var(--ok-soft); color: var(--ok); border-color: var(--ok); }
.mw-verdict.fail { background: var(--fail-soft); color: var(--fail); border-color: var(--fail); }
.mw-verdict.info { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
.mw-verdict small { font-weight: 400; color: var(--text-2); margin-left: auto; }
.mw-verdict .chk-link { margin-left: 8px; }
.mw-h { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--text-2); margin: 14px 0 6px; }
.mw-lead { color: var(--text-2); font-size: 12px; margin: 0 0 8px; }
.mw-live { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 6px; margin: 6px 0 10px; }
.mw-live > div { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 5px 8px; }
.mw-live b { display: block; font-size: 14px; font-variant-numeric: tabular-nums; }
.mw-live span { color: var(--text-2); font-size: 11px; }
.mw-sub { font-size: 11.5px; font-weight: 600; color: var(--text-2); margin: 8px 0 2px; }
.mw-res-tabs > .tab-bar { padding: 4px 0 0; background: var(--surface); }
.mw-res-tabs > .tab-content { padding: 10px 0 0; }
.mw-chip { display: inline-block; padding: 1px 7px; border-radius: 10px; background: var(--surface-3); color: var(--text-2); font-size: 11px; margin-left: 6px; }
`;
  document.head.append(st);
}

const ok = (eta) => Number.isFinite(eta) && eta <= 1.0001;
const etaTxt = (eta) => (Number.isFinite(eta) ? fmt(eta, 2) : '∞');

/** Klare Aussage «erfüllt / nicht erfüllt». */
export function verdict(eta, what, extra, deriv) {
  if (eta === null || eta === undefined) return h('div', { class: 'mw-verdict info' }, icon('info'), what);
  const good = ok(eta);
  return h('div', { class: `mw-verdict ${good ? 'ok' : 'fail'}` }, icon(good ? 'check' : 'warn'),
    `${what} ${good ? 'erfüllt' : 'nicht erfüllt'}`, h('small', {}, extra ?? `η = ${etaTxt(eta)}`),
    deriv ? h('button', { type: 'button', class: 'chk-link', title: 'Rechenweg mit Formeln und eingesetzten Werten', onclick: () => document.dispatchEvent(new CustomEvent('os-derivation', { detail: deriv })) }, 'Herleitung ›') : null);
}

function formula(lines) { return h('div', { class: 'mw-formula' }, lines.filter(Boolean).join('\n')); }

const maxEta = (list) => list.reduce((m, c) => (!Number.isFinite(c.eta) || c.eta > m ? (Number.isFinite(c.eta) ? c.eta : Infinity) : m), 0);

export function renderResults(el, app) {
  ensureStyle();
  const R = app.results;
  const gov = R.gov;
  el.append(summaryCard(R.etaMax, 'Maximale Ausnutzung', gov ? h('div', { class: 'muted small', style: { marginTop: '4px' } }, `massgebend: ${gov.label} · ${gov.lc}`) : null));
  const failed = R.checks.filter((c) => !ok(c.eta));
  if (!failed.length) el.append(h('div', { class: 'mw-verdict ok' }, icon('check'), 'Alle Nachweise sind erfüllt.'));
  else el.append(h('div', { class: 'mw-verdict fail' }, icon('warn'), h('span', {}, `Nicht erfüllt: ${failed.map((c) => `${c.label} (η = ${etaTxt(c.eta)})`).join(', ')}`)));

  const buck = R.checks.find((c) => c.id === 'buck' || c.id === 'buckEN');
  const shear = R.checks.find((c) => c.id === 'shear' || c.id === 'shearEN');
  const conc = R.checks.find((c) => c.id === 'conc');
  const lat = R.checks.find((c) => c.id === 'lat');
  el.append(stats([
    ['fxd = fxk/γM', R.md.fxd, 'MPa', 2],
    ['Schlankheit hef/t', R.slender, '', 1],
    buck ? ['nRd Knicken', buck.Rd, 'kN/m', 0] : null,
    shear ? ['VRd Scheibe', shear.Rd, 'kN', 1] : null,
    conc ? ['NRdc Teilfläche', conc.Rd, 'kN', 1] : null,
    lat ? ['Querlast pRd', lat.Rd, 'kN/m²', 2] : null,
  ]));

  const has = (ids) => R.checks.some((c) => ids.includes(c.id));
  const defs = [
    { id: 'over', label: 'Übersicht', render: (c) => tabOverview(c, R) },
    { id: 'druck', label: 'Druck', render: (c) => tabDruck(c, R, app) },
    has(['shear', 'shearEN']) ? { id: 'schub', label: 'Schub', render: (c) => tabSchub(c, R, app) } : null,
    has(['conc']) ? { id: 'teil', label: 'Teilfläche', render: (c) => tabTeil(c, R, app) } : null,
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
    detail: [c.lc && c.lc !== 'alle' ? `Kombination: ${c.lc}` : null, c.detail, c.id === 'basMin' ? 'Ed = erforderlich, Rd = vorhanden' : null].filter(Boolean).join(' · ') || null,
  }))));
  if (R.notes.length) {
    el.append(h('div', { class: 'mw-h' }, 'Hinweise'));
    for (const n of R.notes) el.append(note(n, 'warn'));
  }
  el.append(h('div', { class: 'mw-h' }, 'Lastkombinationen (Bemessungswerte)'));
  el.append(resultTable(
    ['Kombination', { label: 'nd,o', unit: 'kN/m', num: true, digits: 1 }, { label: 'eo', unit: 'mm', num: true, digits: 1 }, { label: 'Vd', unit: 'kN', num: true, digits: 1 }, { label: 'pd,max', unit: 'kN/m²', num: true, digits: 2 }, 'η max'],
    R.combos.map((c) => {
      const etas = Object.values(c.checks).map((x) => x.eta);
      const e = etas.length ? Math.max(...etas.map((x) => (Number.isFinite(x) ? x : 1e9))) : 0;
      return [h('span', {}, c.name, h('span', { class: 'mw-chip' }, c.type === 'SLS' ? 'GZG' : 'GZT')), c.nTop, c.eTop * 1000,
        c.shear ? c.shear.V : 0, c.pMax, etas.length ? utilBar(e >= 1e9 ? Infinity : e) : '–'];
    })));
}

// ======================================================================== Druck

function tabDruck(el, R, app) {
  const ids = ['top', 'bot', 'buck', 'buckEN'];
  const list = R.checks.filter((c) => ids.includes(c.id));
  el.append(verdict(maxEta(list), 'Nachweis Normalkraft', null, 'buck'));
  const sia = R.method === 'SIA';
  el.append(h('p', { class: 'mw-lead' }, sia
    ? 'Wandstreifen 1 m, gelenkig oben und unten, Werkstoff ohne Zugfestigkeit (linear-elastisch – ideal-plastisch). Die Biegelinie wird nach Theorie 2. Ordnung iteriert und die Vertikallast bis zum Versagen gesteigert (Laststeigerungsfaktor λu). Querschnittswiderstand mit Spannungsblock.'
    : 'Abminderungsfaktoren nach EN 1996-1-1: Φi = 1 − 2ei/t an Wandkopf und -fuss, Φm nach Anhang G in Wandmitte (Schlankheit, Exzentrizität, Kriechen).'));
  const t = R.t;
  el.append(formula([
    `fxd = fxk/γM = ${fmt(R.md.fxk, 2)}/${fmt(R.md.gammaM, 2)} = ${fmt(R.md.fxd, 2)} MPa`,
    R.eff.formula,
    `hef/t = ${fmt(R.hef, 3)}/${fmt(t, 3)} = ${fmt(R.slender, 1)}`,
    `e0 = hef/${fmt(R.nImp, 0)} = ${fmt(R.eImp * 1000, 1)} mm (Vorverformung)`,
    sia ? `Exd = Exk/γE = ${fmt(R.md.Exk, 0)}/${fmt(R.md.gammaE, 2)} = ${fmt(R.md.Exd, 0)} MPa` : `λ = hef/t·√(fk/E) = ${fmt(R.slender * Math.sqrt(R.md.fxk / R.md.Exk), 3)}`,
    'nRd = fxd·(t − 2e)   (Spannungsblock)',
  ]));
  const uls = R.combos.filter((c) => c.type === 'ULS');
  if (sia) {
    el.append(resultTable(
      ['Kombination', { label: 'η Kopf', num: true }, { label: 'η Fuss', num: true }, { label: 'λu', num: true, digits: 2 }, { label: 'nRd', unit: 'kN/m', num: true, digits: 0 }, 'η Knicken'],
      uls.map((c) => [c.name, c.checks.top.eta, c.checks.bot.eta, c.buck.xMax, c.buck.nRd, utilBar(c.buck.eta)])));
  } else {
    el.append(resultTable(
      ['Kombination', { label: 'Φo', num: true, digits: 3 }, { label: 'Φu', num: true, digits: 3 }, { label: 'Φm', num: true, digits: 3 }, { label: 'nRd,m', unit: 'kN/m', num: true, digits: 0 }, 'η Mitte'],
      uls.map((c) => [c.name, c.en.top.phi, c.en.bot.phi, c.en.mid.phi, c.en.mid.nRd, utilBar(c.checks.buckEN.eta)])));
  }
  const c = pickCombo(app, 'schnitt');
  if (!c || c.type !== 'ULS') return;
  el.append(h('div', { class: 'mw-h' }, `Detail: ${c.name}`));
  if (sia) {
    const b = c.buck;
    el.append(kvTable([
      ['nd am Wandkopf / Wandmitte / Wandfuss', `${fmt(c.nTop, 1)} / ${fmt(c.nMid, 1)} / ${fmt(c.nBot, 1)}`, 'kN/m'],
      ['Exzentrizität eo / eu', `${fmt(c.eTop * 1000, 1)} / ${fmt(c.eBot * 1000, 1)}`, 'mm'],
      ['Kriechen φeff = φ∞·nG/nd', c.phiEff, '', 2],
      ['E-Modul wirksam Eeff = Exd/(1+φeff)', c.Eeff / 1000, 'MPa', 0],
      ['Laststeigerungsfaktor λu', Number.isFinite(b.xMax) ? b.xMax : '> 1000', '', 3],
      ['massgebender Schnitt z', b.z, 'm', 2],
      ['Versagensart', b.mode, ''],
      ['nRd = λu·nEd(z)', b.nRd, 'kN/m', 1],
      ['Φ = nRd/(t·fxd)', b.phi, '', 3],
    ]));
  } else {
    const m = c.en.mid;
    el.append(formula([
      `ei,o = |eo| + e0 = ${fmt(c.en.top.e * 1000, 1)} mm → Φo = 1 − 2ei/t = ${fmt(c.en.top.phi, 3)}`,
      `ei,u = |eu| + e0 = ${fmt(c.en.bot.e * 1000, 1)} mm → Φu = ${fmt(c.en.bot.phi, 3)}`,
      `em = |Mmd/Nmd + ehm| + e0 = ${fmt(m.em * 1000, 1)} mm, ek = ${fmt(m.ek * 1000, 1)} mm, emk = ${fmt(m.emk * 1000, 1)} mm`,
      `A1 = 1 − 2emk/t = ${fmt(m.A1, 3)};  λ = ${fmt(m.lam, 3)};  u = (λ − 0.063)/(0.73 − 1.17·emk/t) = ${fmt(m.u, 3)}`,
      `Φm = A1·exp(−u²/2) = ${fmt(m.phi, 3)} → nRd,m = Φm·t·fxd = ${fmt(m.nRd, 1)} kN/m`,
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
    title, series, xLabel: 'Exzentrizität e [mm]  (+ = Raumseite)', yLabel: 'Höhe z [m]', height: 290,
    xRange: [-t * 0.55, t * 0.55], yRange: [0, R.h],
    vLines: [{ v: -t / 2, color: 'var(--fail)', dash: '0', label: '' }, { v: t / 2, color: 'var(--fail)', dash: '0', label: 'Rand' }, { v: -t / 6, label: '' }, { v: t / 6, label: 'Kern' }],
  });
}

const curveCache = new WeakMap();
/** Knickkurve Φ(hef/t) für die gewählte Kombination (numerisch) mit Vergleich EN 1996-1-1 Anhang G. */
function bucklingCurve(c, R) {
  const box = h('div', { class: 'chart-box' }, h('div', { class: 'muted small', style: { padding: '30px 8px', textAlign: 'center' } }, 'Knickkurve wird berechnet …'));
  const draw = (data) => {
    const t = R.t;
    const cur = [R.slender, c.buck.phi];
    const svg = chartBox({
      title: `Abminderung Φ = nRd/(t·fxd) – ${c.name}`,
      series: [
        { points: data.num, label: 'Th. 2. O. (numerisch)', color: 'var(--c-pos)', width: 2.2, markers: true },
        { points: data.en, label: 'EN 1996-1-1 Anh. G', color: 'var(--c-series-5)', dash: '6 4' },
      ],
      points: [{ x: cur[0], y: cur[1], label: 'Wand', color: 'var(--c-neg)' }],
      xLabel: 'Schlankheit hef/t', yLabel: 'Φ [–]', height: 260, yRange: [0, 1], xRange: [0, Math.max(30, R.slender + 2)],
      vLines: [{ v: R.lambdaLim, label: `hef/t = ${fmt(R.lambdaLim, 0)}`, color: 'var(--warn)' }],
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
  el.append(verdict(maxEta(list), 'Nachweis Querkraft in Wandebene', null, 'shear'));
  const sia = R.shearMethod === 'SIA';
  el.append(h('p', { class: 'mw-lead' }, sia
    ? 'Spannungsfeld: Die Normalkraft N und die Horizontalkraft V werden über ein geneigtes Druckfeld in die Druckzone am Wandfuss geleitet. Fliessbedingungen nach Ganz/Thürlimann (Grundlage SIA 266) ohne Kohäsion und Zugfestigkeit: Druckfeld σx/fxd + σy/fyd ≤ 1, Gleiten τ ≤ μ·σx.'
    : 'EN 1996-1-1, 6.2: VRd = fvd·t·lc mit fvk = fvk0 + 0.4·σd ≤ fvlt und überdrückter Länge lc bei linearer Spannungsverteilung.'));
  const uls = R.combos.filter((c) => c.shear);
  el.append(resultTable(
    ['Kombination', { label: 'Nd', unit: 'kN', num: true, digits: 0 }, { label: 'Vd', unit: 'kN', num: true, digits: 1 }, { label: 'lc', unit: 'm', num: true, digits: 2 }, { label: 'VRd', unit: 'kN', num: true, digits: 1 }, 'η'],
    uls.map((c) => [c.name, c.shear.N, c.shear.V, c.shear.lc, c.shear.VRd, utilBar((c.checks.shear || c.checks.shearEN).eta)])));
  let c = pickCombo(app, 'schub');
  if (!c?.shear) c = uls[0];
  if (!c) return;
  const s = c.shear, t = R.t, l = R.l;
  el.append(h('div', { class: 'mw-h' }, `Detail: ${c.name}`));
  if (sia) {
    el.append(formula([
      `Nd = ${fmt(s.N, 1)} kN, Vd = ${fmt(s.V, 1)} kN, h0 = ${fmt(s.h0, 2)} m`,
      `fxd = ${fmt(R.fxd / 1000, 2)} MPa, fyd = ${fmt(R.fyd / 1000, 2)} MPa, μ = ${fmt(R.md.mu, 2)}`,
      `VRd,c = −t·h0·fyd + √((t·h0·fyd)² + fyd·N·(t·l − N/fxd)) = ${fmt(s.Vstrut, 1)} kN`,
      `VRd,f = μ·N = ${fmt(s.Vfric, 1)} kN`,
      `VRd = min(VRd,c; VRd,f) = ${fmt(s.VRd, 1)} kN  (${s.mode})`,
      `bei Vd: e = Vd·h0/Nd = ${fmt(s.e, 3)} m, lc = l − 2e = ${fmt(s.lc, 2)} m`,
      `σx = ${fmt(s.sx / 1000, 3)} MPa, τ = ${fmt(s.tau / 1000, 3)} MPa, σy = τ²/σx = ${fmt(s.sy / 1000, 3)} MPa, α = ${fmt(s.alpha * 180 / Math.PI, 1)}°`,
    ]));
  } else {
    el.append(formula([
      `Nd = ${fmt(s.N, 1)} kN, Vd = ${fmt(s.V, 1)} kN, h0 = ${fmt(s.h0, 2)} m → e = ${fmt(s.e, 3)} m`,
      `lc = ${s.e <= l / 6 ? 'l' : '3·(l/2 − e)'} = ${fmt(s.lc, 2)} m;  σd = N/(t·lc) = ${fmt(s.sd / 1000, 3)} MPa`,
      `fvk = min(fvk0 + 0.4·σd; fvlt) = min(${fmt(R.md.fvk0, 2)} + ${fmt(0.4 * s.sd / 1000, 3)}; ${fmt(R.md.fvlt, 2)}) = ${fmt(s.fvk / 1000, 3)} MPa`,
      `fvd = fvk/γM = ${fmt(s.fvd / 1000, 3)} MPa → VRd = fvd·t·lc = ${fmt(s.VRd, 1)} kN`,
      `NRd = fxd·t·(l − 2e) = ${fmt(s.NRd, 1)} kN`,
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
      // grösstes V mit V ≤ VRd(N, V) und N ≤ NRd(N, V)
      const g = (v) => { const r = shearEN({ N, V: v, t, l, h0: s0.h0, fvk0: R.md.fvk0 * 1000, fvlt: R.md.fvlt * 1000, gammaM: R.md.gammaM, fxd: R.fxd }); return Math.min(r.VRd - v, r.NRd - N); };
      let a = 0, b = Nmax;
      if (g(0) < 0) V = 0;
      else { for (let k = 0; k < 50; k++) { const m = (a + b) / 2; if (g(m) >= 0) a = m; else b = m; } V = a; }
    }
    pts.push([N, V]);
  }
  return chartBox({
    title: `Interaktion Vd–Nd (h0 = ${fmt(s0.h0, 2)} m)`,
    series: [{ points: pts, label: sia ? 'VRd (Spannungsfeld)' : 'VRd (EN 1996-1-1)', color: 'var(--c-pos)', fill: true, width: 2.2 }],
    points: uls.map((c, i) => ({ x: c.shear.N, y: c.shear.V, label: String(i + 1), title: c.name, color: ok((c.checks.shear || c.checks.shearEN).eta) ? 'var(--ok)' : 'var(--fail)' })),
    xLabel: 'Normalkraft Nd [kN]', yLabel: 'Querkraft Vd [kN]', height: 260,
  });
}

// ======================================================================== Teilfläche

function tabTeil(el, R, app) {
  const list = R.checks.filter((c) => ['conc', 'concMid'].includes(c.id));
  el.append(verdict(maxEta(list), 'Nachweis Teilflächenbelastung', null, 'conc'));
  el.append(h('p', { class: 'mw-lead' }, 'Einzellast unter einer Lastfläche Ab am Wandkopf (z.B. Träger- oder Unterzugsauflager), EN 1996-1-1, 6.1.3: Erhöhungsfaktor β für Vollsteine, Lastausbreitung unter 60° bis Wandmitte.'));
  const c = R.combos.filter((x) => x.conc).reduce((a, b) => (b.checks.conc.eta > (a?.checks.conc.eta ?? -1) ? b : a), null);
  if (!c) return;
  const q = c.conc;
  el.append(kvTable([
    ['massgebende Kombination', c.name, ''],
    ['Einzellast Nc,d', q.Nc, 'kN', 1],
    ['Lastfläche Ab = a·b', q.Ab * 1e4, 'cm²', 0],
    ['Randabstand a1', q.a1, 'm', 2],
    ['wirksame Länge Wandmitte lefm', q.lefm, 'm', 3],
    ['Ab/Aef (≤ 0.45)', q.ratio, '', 3],
    ['Erhöhungsfaktor β', q.beta, '', 3],
  ]));
  el.append(formula([
    `β = (1 + 0.3·a1/hc)·(1.5 − 1.1·Ab/Aef) = ${fmt(q.beta, 3)}  (1.0 ≤ β ≤ ${fmt(q.betaMax, 3)})${R.md.solid ? '' : '  → Lochsteine: β = 1.0'}`,
    `NRdc = β·Ab·fxd = ${fmt(q.beta, 3)}·${fmt(q.Ab, 4)}·${fmt(R.fxd, 0)} = ${fmt(q.NRdc, 1)} kN  ≥ Nc,d = ${fmt(q.Nc, 1)} kN`,
    `Wandmitte: nEd = Nc/lefm + nd,m = ${fmt(q.Nc / q.lefm, 1)} + ${fmt(c.nMid, 1)} = ${fmt(q.nEdMid, 1)} kN/m`,
    `nRd,m = Φm·t·fxd = ${fmt(c.phiMid, 3)}·${fmt(R.t, 3)}·${fmt(R.fxd, 0)} = ${fmt(q.nRdMid, 1)} kN/m`,
  ]));
  el.append(checksTable([
    { label: 'Teilflächenpressung', ref: 'EN 1996-1-1 (6.9)', Ed: q.Nc, Rd: q.NRdc, unit: 'kN', eta: c.checks.conc.eta, deriv: 'conc' },
    { label: 'Lastausbreitung bis Wandmitte', ref: 'EN 1996-1-1, 6.1.3 (4)', Ed: q.nEdMid, Rd: q.nRdMid, unit: 'kN/m', eta: c.checks.concMid.eta, deriv: 'conc' },
  ]));
}

// ======================================================================== Querlast

function tabQuer(el, R, app) {
  const list = R.checks.filter((c) => ['lat', 'basMax', 'basMin'].includes(c.id));
  el.append(verdict(maxEta(list), 'Nachweis Querbelastung', null, R.checks.some((c) => c.id === 'lat') ? 'lat' : 'bas'));
  el.append(h('p', { class: 'mw-lead' }, 'Die Querlast (Wind, Erddruck) wird bis zum Versagen gesteigert (Faktor μu), bei festgehaltenen Vertikallasten der Kombination. Die Stützlinie muss innerhalb der Wanddicke bleiben; die Bogenwirkung zwischen Wandkopf und -fuss wird über die Lage der Resultierenden am Wandfuss berücksichtigt.'));
  const withLat = R.combos.filter((c) => c.lat);
  if (withLat.length) {
    el.append(resultTable(
      ['Kombination', { label: 'pd,max', unit: 'kN/m²', num: true, digits: 2 }, { label: 'nd,m', unit: 'kN/m', num: true, digits: 1 }, { label: 'μu', num: true, digits: 2 }, { label: 'eu', unit: 'mm', num: true, digits: 0 }, 'η'],
      withLat.map((c) => [c.name, c.pMax, c.nMid, Number.isFinite(c.lat.xMax) ? c.lat.xMax : '> 1000', c.lat.eU * 1000, utilBar(c.lat.eta)])));
    const c = withLat.reduce((a, b) => ((Number.isFinite(b.lat.eta) ? b.lat.eta : 1e9) > (Number.isFinite(a.lat.eta) ? a.lat.eta : 1e9) ? b : a));
    el.append(h('div', { class: 'mw-h' }, `Detail: ${c.name}`));
    el.append(kvTable([
      ['Laststeigerungsfaktor Querlast μu', Number.isFinite(c.lat.xMax) ? c.lat.xMax : '> 1000', '', 3],
      ['Versagensart', c.lat.blocked ? 'Normalkraft ohne Querlast bereits ungenügend' : c.lat.mode, ''],
      ['Resultierende am Wandfuss eu', c.lat.eU * 1000, 'mm', 1],
      ['Bogenwirkung angesetzt', c.lat.arching ? 'ja (statische Methode)' : 'nein', ''],
    ]));
    el.append(eccChart(c, R, 'Stützlinie unter Bemessungslast', c.lat.profile || c.profile));
  }
  const bas = R.combos.filter((c) => c.basement);
  if (bas.length) {
    el.append(h('div', { class: 'mw-h' }, 'Kelleraussenwand EN 1996-3, 4.5'));
    const b0 = bas[0].basement;
    el.append(formula([
      `β = ${fmt(b0.beta, 0)} (Querwandabstand bc = ${fmt(app.project.settings.bc, 2)} m)`,
      `Nmax,Rd = t·fd/3 = ${fmt(b0.NmaxRd, 1)} kN/m`,
      `Nmin,erf = ρe·h·he²/(β·t) = ${fmt(b0.NminReq, 1)} kN/m`,
    ]));
    el.append(resultTable(
      ['Kombination', { label: 'Nd (Mitte)', unit: 'kN/m', num: true, digits: 1 }, 'η max', 'η min'],
      bas.map((c) => [c.name, c.basement.N, utilBar(c.checks.basMax.eta), utilBar(c.checks.basMin.eta)])));
  }
}

// ======================================================================== Gebrauch

function tabGebrauch(el, R) {
  const list = R.checks.filter((c) => ['slender', 'crack'].includes(c.id));
  el.append(verdict(maxEta(list), 'Gebrauchstauglichkeit und Konstruktion', null, 'gzg'));
  el.append(formula([
    `Schlankheit hef/t = ${fmt(R.slender, 1)} ≤ ${fmt(R.lambdaLim, 0)}  (EN 1996-1-1, 5.5.1.4)`,
    'Klaffende Fuge unter charakteristischen Lasten: |e| ≤ t/3 (Empfehlung zur Rissbegrenzung)',
  ]));
  const sls = R.combos.filter((c) => c.sls);
  if (!sls.length) {
    el.append(emptyState('Keine Kombination für die Gebrauchstauglichkeit', 'Im Register «Lasten» eine Kombination mit Art «GZG» (Faktoren 1.0) aktivieren, um die klaffende Fuge zu prüfen.'));
  } else {
    el.append(resultTable(
      ['Kombination', { label: 'eo', unit: 'mm', num: true, digits: 1 }, { label: 'em', unit: 'mm', num: true, digits: 1 }, { label: 'eu', unit: 'mm', num: true, digits: 1 }, { label: 't/3', unit: 'mm', num: true, digits: 1 }, 'η'],
      sls.map((c) => [c.name, c.sls.eTop * 1000, c.sls.eMid * 1000, c.sls.eBot * 1000, c.sls.lim * 1000, utilBar(c.checks.crack.eta)])));
  }
  el.append(checksTable(list.map((c) => ({ label: c.label, ref: c.ref, Ed: c.Ed, Rd: c.Rd, unit: c.unit, digits: 1, eta: c.eta, deriv: 'gzg' }))));
}
