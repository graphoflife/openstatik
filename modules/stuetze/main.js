// Stütze – Stahlbetonstützen nach Theorie 2. Ordnung: Benutzeroberfläche
import { createApp, IncompleteInput } from '../../js/core/app.js';
import {
  h, group, segmented, kvTable, resultTable, checksTable, summaryCard, stats, note, fmt, utilBar,
} from '../../js/core/ui.js';
import { chartBox, xyChart } from '../../js/core/chart.js';
import { repTable, repKV, repFigure, repFormula, repP } from '../../js/core/report.js';
import { compute, defaultProject, normalize, SUPPORT_PRESETS, LAW_LABELS, missingInput } from './calc.js';
import { renderView, VIEW_MODES, lcIndex } from './views.js';
import { tabSystem, tabSection, tabLoads, tabParams } from './inputs.js';
import { editorSpec, updateLive } from './editing.js';
import { derivation } from './derivation.js';
import { EXAMPLES } from './examples.js';

// ------------------------------------------------------------------ Ergebnisse

let lastResultsLc = -1;

const axName = (ax) => (ax === 'y' ? 'Biegung um y' : 'Biegung um z');
const reasonText = (A) => (A.capped ? 'Traglastfaktor ≥ 20 (Suche begrenzt)'
  : A.reason === 'section' ? 'Querschnittsversagen (Grenzdehnung erreicht)'
    : A.reason === 'axial' ? 'Normalkraft übersteigt den Querschnittswiderstand'
      : 'Stabilitätsversagen (Gleichgewicht nicht mehr stabil)');

function verdict(R) {
  const r = R.lcs[R.gov];
  const c = r.checks.reduce((m, x) => (x.eta > m.eta ? x : m), r.checks[0]);
  const ok = Number.isFinite(R.eta) && R.eta <= 1.0001;
  const d = h('div', { class: 'stz-verdict' });
  if (ok) {
    d.append(h('b', {}, 'Die Tragsicherheit der Stütze ist nachgewiesen.'),
      h('span', { class: 'muted' }, `Massgebend: ${r.name} – ${c.label}.`));
  } else {
    d.append(h('b', {}, 'Die Tragsicherheit ist nicht nachgewiesen.'),
      h('span', { class: 'muted' }, `Massgebend: ${r.name} – ${c.label}. Abhilfe: Bewehrung erhöhen, Querschnitt vergrössern, Knicklänge verkürzen (Lagerung) oder höhere Betonfestigkeit wählen.`));
  }
  return d;
}

function lcOverview(R, li, onSelect) {
  const t = h('table', { class: 'rt stz-lc' });
  t.append(h('thead', {}, h('tr', {}, h('th', {}, 'Lastfall'), h('th', { class: 'num' }, 'N_d [kN]'), h('th', { class: 'num' }, 'λu'), h('th', {}, 'Ausnutzung'))));
  const tb = h('tbody');
  R.lcs.forEach((r, i) => {
    const lu = Math.min(r.Y.lambdaU, r.Z.lambdaU);
    tb.append(h('tr', { class: [i === R.gov && 'gov', i === li && 'sel'], onclick: () => onSelect(i), title: 'Details anzeigen' },
      h('td', {}, r.name, i === R.gov ? h('span', { class: 'muted small' }, ' (massgebend)') : null),
      h('td', { class: 'num' }, fmt(r.N, 0)), h('td', { class: 'num' }, fmt(lu, 2)), h('td', {}, utilBar(r.eta))));
  });
  t.append(tb);
  return h('div', { class: 'dt-wrap', style: { border: 0, marginBottom: '10px' } }, t);
}

function nmChart(A, small = false) {
  const N = A.N;
  const pts = [];
  if (A.M1max !== undefined) pts.push({ x: A.M1max, y: N, label: 'I', color: 'var(--c-series-3)', shape: 'square', title: `1. Ordnung: M = ${fmt(A.M1max, 1)} kNm` });
  if (A.M2max !== null) pts.push({ x: A.M2max, y: N, label: 'II', color: 'var(--c-series-2)', title: `2. Ordnung (allgemein): M = ${fmt(A.M2max, 1)} kNm` });
  pts.push({ x: A.simp.MEd, y: N, label: 'V', color: 'var(--c-series-5)', shape: 'cross', title: `vereinfachtes Verfahren: M = ${fmt(A.simp.MEd, 1)} kNm` });
  return {
    title: `N-M-Interaktion – ${axName(A.ax)}`,
    series: [
      { points: A.nm.map((q) => [q.M, -q.N]), closed: true, fill: true, label: 'Widerstand', color: 'var(--c-series-1)', width: 1.6 },
      { points: A.path.map(([m, n]) => [Math.abs(m), n]), label: 'Lastpfad (2. Ordnung)', color: 'var(--c-series-2)', width: 2 },
    ],
    points: pts,
    xLabel: `M_${A.ax} [kNm]`, yLabel: 'N (Druck) [kN]', height: small ? 260 : 300,
  };
}

function mkChart(A) {
  const series = [];
  if (A.tabN) series.push({ points: Array.from(A.tabN.kap, (k, i) => [k * 1000, A.tabN.M[i]]), label: 'Stütze (Ecd, φef)', color: 'var(--c-series-1)', width: 2 });
  if (A.tabRd) series.push({ points: Array.from(A.tabRd.kap, (k, i) => [k * 1000, A.tabRd.M[i]]), label: 'Querschnitt (fcd)', color: 'var(--c-series-4)', dash: '5 4' });
  const pts = [];
  if (A.at1) pts.push({ x: Math.abs(A.at1.kapCrit) * 1000, y: A.at1.Mmax, label: 'λ = 1', color: 'var(--c-series-2)', title: `massgebender Schnitt x = ${fmt(A.x[A.at1.iM], 2)} m` });
  return {
    title: `Momenten-Krümmungs-Beziehung bei N_d = ${fmt(A.N, 0)} kN`,
    series, points: pts, hLines: A.MRd > 0 ? [{ v: A.MRd, label: `M_Rd = ${fmt(A.MRd, 1)} kNm`, color: 'var(--fail)' }] : [],
    xLabel: 'Krümmung κ [1/km]', yLabel: `M_${A.ax} [kNm]`,
  };
}

function ldChart(r, axes) {
  const cols = { y: 'var(--c-series-1)', z: 'var(--c-series-4)' };
  const series = [], pts = [];
  let wMax = 1, lMax = 1.2;
  for (const ax of axes) {
    const A = r[ax.toUpperCase()];
    const c = A.curve.map(([w, l]) => [Math.abs(w) * 1000, l]);
    series.push({ points: c, label: `um ${ax} (${A.sway ? 'Kopf' : 'max. w'})`, color: cols[ax], width: 2 });
    const last = c[c.length - 1];
    if (last) pts.push({ x: last[0], y: A.lambdaU, label: `λu = ${fmt(A.lambdaU, 2)}`, color: cols[ax], title: reasonText(A) });
    for (const [w] of c) wMax = Math.max(wMax, w);
    lMax = Math.max(lMax, A.lambdaU * 1.08);
  }
  return {
    title: 'Last-Verformungs-Kurve (proportionale Laststeigerung)',
    series, points: pts, hLines: [{ v: 1, label: 'λ = 1', color: 'var(--text-2)' }],
    xRange: [0, wMax * 1.3], yRange: [0, lMax],
    xLabel: 'Zusatzverformung w [mm]', yLabel: 'Lastfaktor λ',
  };
}

function detailRows(R, A) {
  const s = A.simp, ec = R.norm === 'EC';
  const rows = [
    ['Lagerung', SUPPORT_PRESETS[A.preset]?.label || A.preset],
    ['Knicklängenbeiwert β', A.beta, A.userBeta ? '(vorgegeben)' : '', 3],
    ['Knicklänge l₀', A.l0, 'm', 2],
    ['Trägheitsradius i', A.i * 1000, 'mm', 1],
    ['Schlankheit λ = l₀/i', A.lam, '', 1],
    ec ? ['λ_lim = 20·A·B·C/√n', `${fmt(A.lamLim, 1)} (A = ${fmt(A.limEC.A, 2)}, B = ${fmt(A.limEC.B, 2)}, C = ${fmt(A.limEC.C, 2)})`] : ['λ_lim (10-%-Kriterium)', A.lamLim, '', 1],
    ['Schiefstellung θi', `1/${fmt(1 / A.thetaI, 0)}`],
    [A.sway ? 'Kopfauslenkung θi·L' : 'Vorkrümmung ei = θi·l₀/2', A.impAmp * 1000, 'mm', 1],
    ['Wirksame Kriechzahl φef', R.phiEf, '', 2],
    ['Nennsteifigkeit EI (5.8.7.2)', A.EInom / 1000, 'MNm²', 2],
    ['Knicklast N_B = π²EI/l₀²', A.NB, 'kN', 0],
    ['M_Ed,I (inkl. Imperfektion)', A.M1max, 'kNm', 1],
    ['M_Ed,II (allgemeines Verfahren)', A.M2max ?? '–', 'kNm', 1],
    ['Vergrösserung M_II/M_I', A.amplification ?? '–', '', 2],
    ['M_Rd bei N_Ed', A.MRd, 'kNm', 1],
    ['Traglastfaktor λu', A.lambdaU, '', 3],
    ['Versagensart', reasonText(A)],
  ];
  const simp = [
    ['Nutzhöhe d = h/2 + i_s', s.d * 1000, 'mm', 0],
    ['ε_yd = f_yd/E_s', s.eyd * 1000, '‰', 3],
    ...(ec ? [
      ['n = N_Ed/(A_c·f_cd)', s.nRel, '', 3],
      ['K_r = (n_u − n)/(n_u − n_bal) ≤ 1', s.Kr, '', 3],
      ['β = 0.35 + f_ck/200 − λ/150', s.betaPhi, '', 3],
      ['K_φ = 1 + β·φef ≥ 1', s.Kphi, '', 3],
      ['1/r = K_r·K_φ·ε_yd/(0.45·d)', s.curv * 1000, '1/km', 2],
    ] : [
      ['χ_d = 2·ε_sd/(0.9·d)', s.curv * 1000, '1/km', 2],
    ]),
    ['e₂ = κ·l₀²/c', `${fmt(s.e2 * 1000, 1)} (c = ${ec ? '10' : 'π²'})`, 'mm'],
    ['M₀Ed (inkl. N·ei)', s.M0Ed, 'kNm', 1],
    ['M₂ = N·e₂', s.M2, 'kNm', 1],
    ['M_Ed', s.MEd, 'kNm', 1],
  ];
  return { rows, simp };
}

function renderResults(el, app) {
  const R = app.results;
  const li = lcIndex(app);
  lastResultsLc = li;
  const r = R.lcs[li] || R.lcs[0];
  const showZ = R.geo.shape === 'rect' || R.p.biaxial;
  const axes = showZ ? ['y', 'z'] : ['y'];
  const ax = axes.includes(app.stzAxis) ? app.stzAxis : r.governingAxis;
  const A = r[ax.toUpperCase()];
  const select = (i) => { app.viewOpts.lc = i; app.renderView(); app.renderResults(); };

  el.append(summaryCard(R.eta, 'Massgebende Ausnutzung', verdict(R)));
  for (const w of R.warnings) el.append(note(w, 'warn'));
  if (R.lcs.length > 1) {
    el.append(h('div', { class: 'stz-h' }, 'Lastfälle'));
    el.append(lcOverview(R, li, select));
  }
  el.append(h('div', { class: 'stz-h' }, R.lcs.length > 1 ? `Details – ${r.name}` : 'Kennwerte'));
  if (axes.length > 1) {
    el.append(h('div', { class: 'stz-bar' }, h('span', { class: 'lbl' }, 'Achse:'),
      segmented(axes.map((a) => ({ id: a, label: `${axName(a)}${a === r.governingAxis ? ' ★' : ''}`, title: a === r.governingAxis ? 'massgebende Achse' : '' })), ax, (id) => { app.stzAxis = id; app.renderResults(); })));
  }
  el.append(stats([
    ['Schlankheit λ', A.lam, '', 1],
    ['Grenzschlankheit λ_lim', Number.isFinite(A.lamLim) ? A.lamLim : '∞', '', 1],
    ['Knicklänge l₀', A.l0, 'm', 2],
    ['M_Ed,I (1. Ordnung)', A.M1max, 'kNm', 1],
    ['M_Ed,II (2. Ordnung)', A.M2max ?? '–', 'kNm', 1],
    ['M_Rd (bei N_Ed)', A.MRd, 'kNm', 1],
    ['Traglastfaktor λu', A.lambdaU, '', 2],
    ['e₂ (vereinfacht)', A.simp.e2 * 1000, 'mm', 1],
  ]));
  for (const n of r.notes) if (!n.ax || n.ax === ax) el.append(note(n.text, n.kind === 'fail' ? 'fail' : ''));
  if (A.lam <= A.lamLim && Number.isFinite(A.lamLim)) el.append(note(`${axName(ax)}: λ = ${fmt(A.lam, 1)} ≤ λ_lim = ${fmt(A.lamLim, 1)} – Einflüsse 2. Ordnung dürften vernachlässigt werden; sie sind hier trotzdem berücksichtigt.`, 'ok'));

  el.append(h('div', { class: 'stz-h' }, 'Nachweise – allgemeines Verfahren'));
  el.append(checksTable(r.checks));
  el.append(h('div', { class: 'stz-legend' }, 'Traglastfaktor λu: alle Lasten (inkl. N) werden proportional gesteigert, bis kein Gleichgewicht mehr möglich ist; Ausnutzung η = 1/λu.'));

  el.append(h('div', { class: 'stz-h' }, `Vergleich – ${R.norm === 'EC' ? 'Nennkrümmungsverfahren (EN 1992-1-1 5.8.8)' : 'vereinfachtes Verfahren (Modellstütze)'}`));
  el.append(checksTable(r.simpChecks));
  el.append(resultTable([{ label: 'Verfahren' }, { label: 'M_Ed', num: true, digits: 1, unit: 'kNm' }, { label: 'M_Rd', num: true, digits: 1, unit: 'kNm' }, { label: 'M_Ed/M_Rd', num: true, digits: 2 }], [
    ['1. Ordnung', A.M1max, A.MRd, A.MRd ? A.M1max / A.MRd : '–'],
    ['Allgemeines Verfahren', A.M2max ?? '–', A.MRd, A.M2max !== null ? A.etaSec : '–'],
    ['Vereinfachtes Verfahren', A.simp.MEd, A.simp.MRd, A.simp.eta],
  ], { caption: `${axName(ax)}, N_Ed = ${fmt(r.N, 0)} kN` }));

  el.append(h('div', { class: 'stz-h' }, 'Diagramme'));
  el.append(chartBox(nmChart(A)));
  el.append(h('div', { class: 'stz-legend' }, '■ I = 1. Ordnung · ● II = 2. Ordnung (allgemeines Verfahren) · ✕ V = vereinfachtes Verfahren. Die Linie «Lastpfad» zeigt das massgebende Moment bei proportionaler Laststeigerung bis zum Versagen – sie endet beim Traglastfaktor λu.'));
  el.append(chartBox(mkChart(A)));
  el.append(chartBox(ldChart(r, axes)));

  const d = detailRows(R, A);
  el.append(group(`Zwischenwerte – ${axName(ax)}`, [kvTable(d.rows)], { collapsible: true, collapsed: true }));
  el.append(group(`Vereinfachtes Verfahren – ${axName(ax)}`, [kvTable(d.simp)], { collapsible: true, collapsed: true }));
  el.append(h('div', { class: 'muted small', style: { marginTop: '8px' } }, `Fasermodell mit ${R.nFibers} Fasern · ${R.p.nEl} Stabelemente · Betongesetz: ${LAW_LABELS[R.kind]} · Rechenzeit ${fmt(R.time, 0)} ms`));
}

// ------------------------------------------------------------------ Bericht

function report(app) {
  const R = app.results;
  const p = R.p, g = R.geo, m = R.mat;
  const ec = p.norm === 'EC';
  const supp = (key, c) => (key === 'custom'
    ? `benutzerdefiniert: Fuss ${({ fixed: 'eingespannt', pinned: 'gelenkig', spring: `Drehfeder ${fmt(c.kBot, 1)} MNm/rad` })[c.bot]}, Kopf ${({ fixed: 'eingespannt', pinned: 'frei drehbar', spring: `Drehfeder ${fmt(c.kTop, 1)} MNm/rad` })[c.top]}, ${c.sway ? 'verschieblich' : 'unverschieblich'}`
    : SUPPORT_PRESETS[key].label);
  const sections = [];
  sections.push({
    title: 'Grundlagen und Eingaben',
    content: [
      h('h3', {}, 'System'),
      repKV([
        ['Norm', ec ? 'EN 1992-1-1 (Eurocode 2)' : 'SIA 262:2013'],
        ['Stützenlänge L', p.L, 'm', 2],
        ['Lagerung (Biegung um y)', supp(p.support, p.custom)],
        p.supportZ !== 'same' ? ['Lagerung (Biegung um z)', supp(p.supportZ, p.customZ)] : null,
        ['Knicklänge', p.betaMode === 'user' ? `β_y = ${fmt(p.betaY, 2)}, β_z = ${fmt(p.betaZ, 2)} (vorgegeben)` : 'aus Knickberechnung des Stabmodells'],
      ]),
      h('h3', {}, 'Querschnitt und Baustoffe'),
      repKV([
        ['Querschnitt', g.shape === 'circle' ? `Kreis D = ${fmt(g.D * 1000, 0)} mm` : `Rechteck b × h = ${fmt(g.b * 1000, 0)} × ${fmt(g.h * 1000, 0)} mm`],
        ['Längsbewehrung', `${g.n} Ø${p.section.dia} = ${fmt(g.As * 1e6, 0)} mm² (ρ = ${fmt(R.rho * 100, 2)} %)`],
        ['Achsabstand a', g.a * 1000, 'mm', 0],
        ['Beton', `${p.concrete}: f_ck = ${fmt(m.c.fck, 0)} MPa, f_cd = ${fmt(m.fcd, 1)} MPa, E_cm = ${fmt(m.c.Ecm, 0)} MPa, E_cd = E_cm/1.2 = ${fmt(m.Ecd, 0)} MPa`],
        ['Betonstahl', `${p.steel}: f_sd = ${fmt(m.fsd, 0)} MPa, E_s = ${fmt(m.Es, 0)} MPa, ε_ud = ${fmt(m.s.eud * 1000, 1)} ‰`],
        ['Querschnittswiderstand N_Rd', R.NRd, 'kN', 0],
      ]),
      h('h3', {}, 'Parameter'),
      repKV([
        ['Imperfektion θi', R.thetaI > 0 ? `1/${fmt(1 / R.thetaI, 0)} (${p.imperfection.mode === 'user' ? 'vorgegeben' : p.imperfection.mode === 'none' ? 'keine' : ec ? 'EN 1992-1-1 5.2' : 'SIA 262 4.3.7.2'})` : 'keine'],
        ['Kriechen', `φ(∞,t₀) = ${fmt(p.creep.phi, 2)}, M₀Eqp/M₀Ed = ${fmt(p.creep.ratio, 2)} → φef = ${fmt(R.phiEf, 2)}`],
        ['Betongesetz (Verformungen)', LAW_LABELS[R.kind]],
        ['Rechenmodell', `${p.nEl} Stabelemente, Fasermodell mit ${R.nFibers} Fasern`],
      ]),
      h('h3', {}, 'Lastfälle (Bemessungswerte)'),
      repTable([
        'Lastfall', { label: 'N [kN]', num: true, digits: 0 }, { label: 'M_y,o [kNm]', num: true, digits: 1 }, { label: 'M_y,u [kNm]', num: true, digits: 1 },
        { label: 'H_z [kN]', num: true, digits: 1 }, { label: 'q_z [kN/m]', num: true, digits: 2 },
        ...(p.biaxial ? [{ label: 'M_z,o', num: true, digits: 1 }, { label: 'M_z,u', num: true, digits: 1 }, { label: 'H_y', num: true, digits: 1 }, { label: 'q_y', num: true, digits: 2 }] : []),
      ], p.loadCases.map((l) => [l.name, +l.N, +l.Myt, +l.Myb, +l.Hz, +l.qz, ...(p.biaxial ? [+l.Mzt, +l.Mzb, +l.Hy, +l.qy] : [])])),
      repP('Vorzeichen: Normalkraft als Druck positiv; Momente positiv bei Druckseite rechts (+z bzw. +y), entsprechend M = N·e; H und q positiv in Richtung +z bzw. +y.'),
    ],
  });
  // Grafiken des massgebenden Lastfalls
  const prev = app.viewOpts.lc;
  app.viewOpts.lc = R.gov;
  const figs = [
    repFigure(app.snapshot('system'), `System, Lasten und Imperfektion (${R.lcs[R.gov].name})`),
    repFigure(app.snapshot('section'), 'Querschnitt'),
    repFigure(app.snapshot('deform'), `Verformung bei Bemessungslast (${R.lcs[R.gov].name}), überhöht dargestellt`),
    repFigure(app.snapshot('moments'), `Biegemomente 1. und 2. Ordnung (${R.lcs[R.gov].name})`),
  ];
  app.viewOpts.lc = prev;
  app.redraw?.();
  sections.push({ title: 'System und Ergebnisse (massgebender Lastfall)', content: figs });
  sections.push({
    title: 'Berechnungsverfahren',
    content: [
      h('h3', {}, 'Allgemeines Verfahren (nichtlinear)'),
      repP(`Die Stütze wird als Stabmodell mit ${p.nEl} Balkenelementen abgebildet. Für jede Laststufe wird bei der zugehörigen Normalkraft die Momenten-Krümmungs-Beziehung des Querschnitts mit einem Fasermodell ermittelt. Bemessungswerte der Baustoffe: Beton mit f_cd und E_cd = E_cm/γ_cE (γ_cE = 1.2), Betonstahl bilinear mit f_sd (${ec ? 'EN 1992-1-1 5.8.6' : 'SIA 262 4.3.7'}). Das Kriechen wird durch Streckung aller Betondehnungen mit (1 + φef) erfasst. Das Gleichgewicht wird am verformten System (Theorie 2. Ordnung, geometrische Steifigkeitsmatrix) mit dem Newton-Raphson-Verfahren gesucht; die Vorverformung wirkt als geometrische Imperfektion.`),
      repP('Alle Lasten (einschliesslich der Normalkraft) werden proportional mit dem Faktor λ gesteigert, bis kein stabiles Gleichgewicht mehr existiert oder eine Grenzdehnung (Beton ε_cu·(1 + φef), Stahl ε_ud) erreicht wird. Der Nachweis ist erfüllt, wenn λu ≥ 1 und die Schnittgrössen 2. Ordnung unter Bemessungslast vom Querschnitt aufgenommen werden (M_Ed,II ≤ M_Rd mit Parabel-Rechteck-Diagramm).'),
      repFormula('η = max( 1/λu ; M_Ed,II/M_Rd(N_Ed) ; N_Ed/N_Rd ; My-Mz-Interaktion )'),
      h('h3', {}, ec ? 'Vereinfachtes Verfahren: Nennkrümmung (EN 1992-1-1 5.8.8)' : 'Vereinfachtes Verfahren: Modellstütze (SIA 262 4.3.7)'),
      ec
        ? repFormula('1/r = K_r · K_φ · ε_yd / (0.45·d)      K_r = (n_u − n)/(n_u − n_bal) ≤ 1,  K_φ = 1 + β·φef ≥ 1\ne₂ = (1/r) · l₀² / c  (c = 10)      M_Ed = M₀Ed + N_Ed·e₂,  M₀Ed inkl. N_Ed·ei\nM₀e = 0.6·M₀₂ + 0.4·M₀₁ ≥ 0.4·M₀₂ (unverschieblich ohne Querlast),  M_Ed ≥ N_Ed·max(h/30; 20 mm)')
        : repFormula('χ_d = 2·ε_sd / (0.9·d)      e₂ = χ_d · l₀² / π²\nM_Ed = N_d · (e₀ + ei + e₂)      M₀e = 0.6·M₀₂ + 0.4·M₀₁ ≥ 0.4·M₀₂ (unverschieblich ohne Querlast)'),
      repP('Nutzhöhe d = h/2 + i_s (i_s: Trägheitsradius der gesamten Bewehrung). Das vereinfachte Verfahren dient dem Vergleich; massgebend ist das allgemeine Verfahren.'),
      h('h3', {}, 'Schlankheit'),
      ec
        ? repFormula('λ = l₀/i,  λ_lim = 20·A·B·C/√n  (EN 1992-1-1 5.8.3.1),  A = 1/(1 + 0.2·φef), B = √(1 + 2ω), C = 1.7 − r_m')
        : repFormula('λ = l₀/i,  λ_lim aus dem 10-%-Kriterium: 1/(1 − N_d/N_B) ≤ 1.1 mit N_B = π²·EI/l₀² (EI nach EN 1992-1-1 5.8.7.2)'),
    ],
  });
  for (const r of R.lcs) {
    const axes = R.geo.shape === 'rect' || p.biaxial ? ['y', 'z'] : ['y'];
    const val = (f, d = 1) => axes.map((ax) => { const v = f(r[ax.toUpperCase()]); return typeof v === 'number' ? fmt(v, d) : v; });
    const content = [
      repTable(['Grösse', ...axes.map((a) => axName(a))], [
        ['β / l₀ [m]', ...axes.map((a) => `${fmt(r[a.toUpperCase()].beta, 2)} / ${fmt(r[a.toUpperCase()].l0, 2)}`)],
        ['Schlankheit λ / λ_lim', ...axes.map((a) => `${fmt(r[a.toUpperCase()].lam, 1)} / ${fmt(r[a.toUpperCase()].lamLim, 1)}`)],
        ['Imperfektion [mm]', ...val((A) => A.impAmp * 1000)],
        ['EI_nom [MNm²] / N_B [kN]', ...axes.map((a) => `${fmt(r[a.toUpperCase()].EInom / 1000, 2)} / ${fmt(r[a.toUpperCase()].NB, 0)}`)],
        ['M_Ed,I [kNm]', ...val((A) => A.M1max)],
        ['M_Ed,II [kNm]', ...val((A) => A.M2max ?? '–')],
        ['M_Rd(N_Ed) [kNm]', ...val((A) => A.MRd)],
        ['Traglastfaktor λu', ...val((A) => A.lambdaU, 3)],
        ['Versagensart', ...axes.map((a) => reasonText(r[a.toUpperCase()]))],
        ['e₂ vereinfacht [mm]', ...val((A) => A.simp.e2 * 1000)],
        ['M_Ed vereinfacht [kNm]', ...val((A) => A.simp.MEd)],
      ]),
      h('h3', {}, 'Nachweise (allgemeines Verfahren)'),
      checksTable(r.checks),
      h('h3', {}, 'Vergleich vereinfachtes Verfahren'),
      checksTable(r.simpChecks),
    ];
    if (r.index === R.gov) {
      const A = r[r.governingAxis.toUpperCase()];
      content.push(h('h3', {}, 'Diagramme'),
        repFigure(xyChart({ ...nmChart(A), crosshair: false }), 'N-M-Interaktion mit Bemessungspunkten und Lastpfad'),
        repFigure(xyChart({ ...mkChart(A), crosshair: false }), 'Momenten-Krümmungs-Beziehung bei N_Ed'),
        repFigure(xyChart({ ...ldChart(r, axes), crosshair: false }), 'Last-Verformungs-Kurve'));
    }
    sections.push({ title: `Lastfall ${r.name}${r.index === R.gov ? ' (massgebend)' : ''}`, content });
  }
  sections.push({
    title: 'Zusammenfassung',
    content: [
      repTable(['Lastfall', { label: 'N_d [kN]', num: true, digits: 0 }, { label: 'λu', num: true, digits: 2 }, { label: 'η allgemein', num: true, digits: 2 }, { label: 'η vereinfacht', num: true, digits: 2 }, 'Status'],
        R.lcs.map((r) => [r.name, r.N, Math.min(r.Y.lambdaU, r.Z.lambdaU), r.eta, r.etaSimp, r.eta <= 1.0001 ? 'erfüllt' : 'nicht erfüllt'])),
      repP(R.eta <= 1.0001 ? `Die Tragsicherheit der Stütze ist für alle Lastfälle nachgewiesen (η_max = ${fmt(R.eta, 2)}).` : `Die Tragsicherheit ist nicht nachgewiesen (η_max = ${fmt(R.eta, 2)} > 1).`),
    ],
  });
  sections.push({
    title: 'Annahmen und Grenzen',
    content: h('ul', {},
      ...[
        'Normalkraft konstant über die Stützenhöhe; das Eigengewicht der Stütze ist in N_d einzurechnen.',
        'Doppelt symmetrische Querschnitte und Bewehrung; die M-κ-Beziehung wird punktsymmetrisch angenommen.',
        'Kein Mitwirken des Betons auf Zug (keine Zugversteifung) – auf der sicheren Seite.',
        'Kriechen vereinfacht durch Streckung der Betondehnungen mit (1 + φef); Schwinden nicht berücksichtigt.',
        'Zweiachsige Biegung: Berechnung je Biegeebene, Kombination der Momente am Querschnitt (My-Mz-Interaktion), Imperfektion jeweils nur in der ungünstigeren Richtung; Torsion und Kopplung der Verformungen werden vernachlässigt.',
        'Schubtragfähigkeit, Bügelbewehrung, Konstruktionsregeln und Brandschutz sind separat nachzuweisen.',
        'Traglastfaktor mit einer Genauigkeit von etwa 1 % (Bisektion, Konvergenzkriterium des Newton-Verfahrens).',
      ].map((t) => h('li', {}, t))),
  });
  return sections;
}

// ------------------------------------------------------------------ Hilfe

const INTRO = `<h4>So funktioniert's</h4>
<ol>
<li><b>Grafik ist die Eingabe</b>: Es steht bereits eine Stütze da. <b>Anklicken</b> öffnet das Eigenschaftsfenster – Stütze (Länge, Lagerung, Querschnitt), Kopf oder Fuss (Lagerung, Lasten), Querschnittsbild (Abmessungen, Bewehrung, Beton).</li>
<li><b>Lasten</b>: Werkzeug <b>Last</b> (F) wählen und den Stützenkopf anklicken – es entsteht ein Lastfall mit vorgeschlagener Normalkraft. <b>Streckenlast</b> (Q) auf die Stütze, <b>Lager</b> (A) auf Kopf oder Fuss.</li>
<li><b>Länge</b>: den Stützenkopf ziehen (Raster, Ziffern tippen für einen genauen Wert).</li>
<li>Die Ergebnisse erscheinen sofort rechts, unter <b>Herleitung</b> steht der Rechenweg. Die Register links bleiben als Alternative und sind immer synchron. Fertige Stützen unter <b>Beispiele</b>.</li>
</ol>`;

const HELP = `
<h3>Zweck</h3>
<p>Nachweis der Tragsicherheit schlanker Stahlbetonstützen mit Rechteck- oder Kreisquerschnitt nach Theorie 2. Ordnung, nach SIA 262 oder EN 1992-1-1.</p>
<h3>Allgemeines Verfahren (massgebend)</h3>
<ul>
<li>Stabmodell mit Balkenelementen; Krümmungen aus der Momenten-Krümmungs-Beziehung des Querschnitts (Fasermodell) bei der jeweiligen Normalkraft.</li>
<li>Baustoffe mit Bemessungswerten: Beton f_cd und E_cd = E_cm/1.2, Betonstahl f_sd. Standard-Betongesetz SIA: linear-elastisch – ideal-plastisch; EC: nichtlinear nach EN 1992-1-1 3.1.5 / 5.8.6.</li>
<li>Kriechen: Streckung der Betondehnungen mit (1 + φef), φef = φ(∞,t₀)·M₀Eqp/M₀Ed.</li>
<li>Imperfektion: unverschieblich als Vorkrümmung e_i = θi·l₀/2 in Form der Knickfigur, verschieblich als Schiefstellung θi; Richtung automatisch ungünstig.</li>
<li>Alle Lasten werden proportional gesteigert (Lastfaktor λ), bis kein stabiles Gleichgewicht mehr besteht oder eine Grenzdehnung erreicht ist: Traglastfaktor λu, Ausnutzung η = 1/λu. Zusätzlich wird M_Ed,II ≤ M_Rd(N_Ed) am Querschnitt geprüft.</li>
</ul>
<h3>Vereinfachtes Verfahren (Vergleich)</h3>
<ul>
<li><b>SIA 262</b>: Modellstütze mit e₂ = χ_d·l₀²/π², χ_d = 2·ε_sd/(0.9·d).</li>
<li><b>EN 1992-1-1 5.8.8</b>: Nennkrümmung 1/r = K_r·K_φ·ε_yd/(0.45·d), e₂ = (1/r)·l₀²/10.</li>
</ul>
<h3>Vorzeichen</h3>
<p>N als Druck positiv. Momente positiv, wenn die Druckseite rechts liegt (M = N·e mit Exzentrizität nach +z bzw. +y). H und q positiv nach rechts. Gleiche Vorzeichen von M oben und M unten bedeuten einfache Krümmung. In der Grafik werden Momente auf der Zugseite aufgetragen.</p>
<h3>Bedienung in der Grafik</h3>
<ul>
<li><b>Darstellung «System»</b>: Stütze, Stützenkopf und -fuss, Lastpfeile, Imperfektion (gestrichelt) und das Querschnittsbild lassen sich anklicken; das Eigenschaftsfenster zeigt die zugehörigen Eingaben und Ergebnisse. Bei zwei Biegeebenen gilt die Auswahl für das angeklickte Bild.</li>
<li><b>Werkzeuge</b>: <b>Last</b> (F) auf Kopf oder Fuss, <b>Streckenlast</b> (Q) auf die Stütze, <b>Lager</b> (A) auf Kopf oder Fuss. Ohne Lastfall wird automatisch einer angelegt.</li>
<li><b>Länge ändern</b>: Stützenkopf ziehen. Fang am Raster; mit Y senkrecht binden, Ziffern tippen für einen genauen Wert, Esc bricht ab.</li>
<li><b>Lagerung je Ende</b>: Kopf anklicken → Verdrehung (frei, eingespannt, Drehfeder) und «horizontal verschieblich»; Fuss anklicken → eingespannt, gelenkig oder Drehfeder. Passt die Kombination zu einem Standardfall, wird dieser gewählt (β bekannt), sonst «benutzerdefiniert».</li>
<li><b>Darstellung «Querschnitt»</b>: Querschnitt oder einen Stab anklicken → Abmessungen, Bewehrung, Überdeckung, Baustoffe.</li>
<li><b>Verformung / Momente</b>: Stützenachse anklicken → Verformung und Momente 1. und 2. Ordnung auf dieser Höhe.</li>
<li><b>Herleitung</b> (rechts): Rechenweg mit Formeln, eingesetzten Werten und Normbezügen für den gewählten Lastfall und die gewählte Achse. «Herleitung ›» in den Nachweistabellen springt zum passenden Abschnitt.</li>
</ul>
<h3>Lagerung</h3>
<p>Momente an eingespannten Enden gehen direkt ins Auflager; eine Horizontalkraft am gehaltenen Kopf wird vom Auflager aufgenommen. Drehfedern (MNm/rad) bilden elastische Einspannungen ab. Bei «Andere Lagerung für Biegung um z» werden beide Richtungen getrennt modelliert.</p>
<h3>Grenzen</h3>
<ul>
<li>Normalkraft konstant über die Höhe, doppelt symmetrische Querschnitte, keine Betonzugfestigkeit.</li>
<li>Zweiachsige Biegung über getrennte Biegeebenen und Querschnittsinteraktion (Imperfektion nur in einer Richtung).</li>
<li>Querkraft, Bügel, Konstruktionsregeln und Brandschutz sind nicht Teil des Moduls.</li>
</ul>
<p class="muted">Ergebnisse ohne Gewähr – Eingaben und Modellannahmen sind durch die projektierende Person zu prüfen.</p>`;

// ------------------------------------------------------------------ Anwendung

let lastTab = null;
const TAB_VIEW = { system: 'system', section: 'section', loads: 'system' };

/** Hält das Eigenschaftsfenster der Grafik nach Änderungen in den Registern und nach der Berechnung aktuell. */
function syncInspector(app) {
  const ed = app.editor;
  if (!ed) return;
  if (!app.stzViewHook) {
    // Lastsymbole haben Pixelgrösse: Trefferflächen nach Zoomen/Verschieben neu bestimmen
    app.stzViewHook = true;
    app.view.onChange(() => ed.invalidate());
  }
  // Öffnet sich das Eigenschaftsfenster, die Ansicht einmal so einpassen, dass es die Stütze nicht verdeckt
  // (wie beim Aufklappen von Hand; nur solange die Ansicht nicht von Hand verschoben/gezoomt wurde)
  const open = !!ed.panel && !ed.panel.classList.contains('collapsed');
  if (open && !app.stzPanelOpen && app.view.fitted && !app.view.userAdjusted && typeof requestAnimationFrame !== 'undefined') {
    const run = () => {
      if (ed.drag) { requestAnimationFrame(run); return; }
      if (app.view.fitted && !app.view.userAdjusted) app.view.fit();
    };
    requestAnimationFrame(run);
  }
  app.stzPanelOpen = open;
  if (!ed.sel.length) return;
  if (typeof document !== 'undefined' && ed.panel?.contains(document.activeElement)) updateLive();
  else ed.refreshPanel(true);
}

createApp({
  id: 'stuetze',
  title: 'Stütze',
  subtitle: 'Stahlbetonstützen nach Theorie 2. Ordnung',
  version: 1,
  defaultProject,
  migrate: (p) => normalize(p),
  examples: EXAMPLES,
  intro: INTRO,
  inputTabs: [
    { id: 'system', label: 'System', render: tabSystem },
    { id: 'section', label: 'Querschnitt', render: tabSection },
    { id: 'loads', label: 'Lasten', render: tabLoads },
    { id: 'params', label: 'Parameter', render: tabParams },
  ],
  // Grafik folgt der Eingabe (nur bei Klick auf ein anderes Register; der Rahmen meldet keine Erstanzeige)
  onTabSwitch(id, app) {
    if (id === lastTab) return;
    lastTab = id;
    if (TAB_VIEW[id] && app.viewMode !== TAB_VIEW[id]) app.setViewMode(TAB_VIEW[id]);
  },
  viewModes: VIEW_MODES,
  viewOptions: (app) => {
    const lcs = app.project?.loadCases || [];
    const list = [];
    if (lcs.length > 1) list.push({ key: 'lc', label: 'Lastfall', type: 'select', default: 0, options: () => lcs.map((l, i) => ({ value: i, label: l.name || `LF ${i + 1}` })) });
    list.push({ key: 'labels', label: 'Beschriftung', type: 'check', default: true });
    return list;
  },
  editor: editorSpec,
  derivation,
  renderView(v, app, mode) {
    const li = lcIndex(app);
    if (app.viewOpts.lc !== li) app.viewOpts.lc = li;
    if (app.results && lastResultsLc !== li && lastResultsLc !== -1) { lastResultsLc = li; setTimeout(() => app.renderResults(), 0); }
    renderView(v, app, mode);
    syncInspector(app);
  },
  autoCompute: true,
  compute(project) {
    const miss = missingInput(project);
    if (miss) throw new IncompleteInput(miss.msg, miss.hint);
    return compute(project);
  },
  renderResults,
  report,
  help: HELP,
});
