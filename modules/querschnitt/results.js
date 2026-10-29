// Querschnitt – Ergebnisbereich und Bericht
import { h, rich, tabs, segmented, selectInput, checksTable, summaryCard, stats, kvTable, resultTable, note, badge, emptyState, button, utilBar } from '../../js/core/ui.js';
import { fx } from '../../js/core/formula.js';
import { chartBox, xyChart } from '../../js/core/chart.js';
import { fmt, fmtSig } from '../../js/core/format.js';
import { repTable, repKV, repFigure, repFormula, repP } from '../../js/core/report.js';
import { SHAPE_TYPES, SHAPE_PARAMS, barAreaMm2 } from './shapes.js';
import { thetaForUserMoment, SLS_REQUIREMENTS, REF_POINTS, SIA_FIG31 } from './calc.js';
import { caseIndex } from './view.js';

const MM = 1e-3;
/** Kurzname für Diagrammbeschriftungen. */
const short = (t, n = 16) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const ok = (eta) => Number.isFinite(eta) && eta <= 1.0001;
/** Hinweis mit Formelzeichen (f_cd → tiefgestellt). */
const noteR = (text, kind) => note(rich(text), kind);

// Bericht: Bausteine mit Tiefstellung der Formelzeichen (repTable/repKV/repP stellen nicht selbst tief)
const rr = (v) => (typeof v === 'string' ? rich(v) : v);
const rP = (t) => repP(rich(t));
const rKV = (rows) => repKV(rows.filter(Boolean).map(([l, v, u, d]) => [rr(l), rr(v), rr(u), d]));
const rTable = (headers, rows) => repTable(headers.filter(Boolean).map((x) => (typeof x === 'string' ? { label: rich(x) } : { ...x, label: rich(x.label) })), rows.map((r) => r.map(rr)));
const rFig = (svg, cap) => repFigure(svg, rich(cap));

// ------------------------------------------------------------------ Nachweiszeilen

function bendingRef(R) {
  return R.mat.norm === 'SIA'
    ? `SIA 262, 4.3.2 / 2.3.2: Fasermodell, Parabel-Rechteck (ε_cu = ${fmt(R.mat.c.ecu * 1000, 1)} ‰), ε_ud = ${fmt(R.mat.s.eud * 1000, 0)} ‰`
    : `EN 1992-1-1, 6.1 / 3.1.7: Parabel-Rechteck (ε_cu2 = ${fmt(R.mat.c.ecu * 1000, 1)} ‰), ε_ud = ${fmt(R.mat.s.eud * 1000, 0)} ‰`;
}

/** Nachweiszeilen eines Lastfalls für checksTable. */
export function caseChecks(R, c) {
  const rows = [];
  if (c.type === 'GZT') {
    const u = c.uls;
    const M = Math.hypot(c.My, c.Mz), MR = Math.hypot(u.MyR, u.MzR);
    if (u.outside || M < 0.01) {
      rows.push({ label: `${c.name} · Normalkraft`, ref: rich(bendingRef(R)), Ed: c.N, Rd: u.NR, unit: 'kN', eta: u.eta, digits: 0, detail: u.outside ? 'Normalkraft grösser als der zentrische Widerstand' : '', deriv: `gzt:${c.i}` });
    } else {
      rows.push({ label: `${c.name} · Biegung mit Normalkraft`, ref: rich(bendingRef(R)), Ed: M, Rd: MR, unit: 'kNm', eta: u.eta, digits: 1, detail: `bei N = ${fmt(c.N, 0)} kN${Math.abs(c.Mz) > 1e-6 && Math.abs(c.My) > 1e-6 ? ' (schiefe Biegung, Resultierende)' : ''}`, deriv: `gzt:${c.i}` });
    }
    if (c.shear) for (const ch of c.shear.checks) rows.push({ ...ch, ref: rich(ch.ref), label: `${c.name} · ${ch.label}`, digits: 0, deriv: `v:${c.i}` });
  } else if (c.sls) {
    if (c.sls.error) rows.push({ label: `${c.name} · Gebrauchszustand`, detail: c.sls.error, eta: Infinity, deriv: `gzg:${c.i}` });
    for (const ch of c.sls.checks) rows.push({ ...ch, ref: rich(ch.ref), label: `${c.name} · ${ch.label}`, deriv: `gzg:${c.i}` });
  }
  return rows;
}

function verdict(R) {
  const all = R.cases.flatMap((c) => caseChecks(R, c));
  const failed = all.filter((x) => !ok(x.eta ?? (Math.abs(x.Ed) / Math.abs(x.Rd))));
  if (!all.length) return h('div', { class: 'small' }, 'Keine Nachweise – bitte Lastfälle erfassen.');
  if (!failed.length) return h('div', { class: 'small' }, `Alle ${all.length} Nachweise sind erfüllt.`);
  const gov = R.governing !== null ? R.cases[R.governing] : null;
  return h('div', { class: 'small' }, `${failed.length} von ${all.length} Nachweisen nicht erfüllt${gov ? ` – massgebend: «${gov.name}»` : ''}. Querschnitt oder Bewehrung vergrössern bzw. Lasten prüfen.`);
}

// ------------------------------------------------------------------ Ergebnisbereich

export function renderResults(el, app, ctx) {
  const R = app.results;
  if (!R.cases.length) {
    el.append(emptyState('Noch keine Lastfälle', 'Im Register «Lasten» einen Lastfall mit N und den Momenten erfassen. Querschnittswerte und Interaktion sind bereits unten verfügbar.'));
  } else {
    el.append(summaryCard(R.etaMax, 'Maximale Ausnutzung', verdict(R)));
  }
  if (R.warnings.length) {
    el.append(h('div', { class: 'note warn' }, h('b', {}, 'Hinweise zur Eingabe'), h('ul', { style: { margin: '4px 0 0', paddingLeft: '18px' } }, R.warnings.map((w) => h('li', {}, w)))));
  }
  const defs = [
    { id: 'nachweise', label: 'Nachweise', render: (e) => tabChecks(e, app) },
    { id: 'lastfall', label: 'Lastfall', render: (e) => tabCase(e, app, ctx) },
    { id: 'interaktion', label: 'Interaktion', render: (e) => tabInteraction(e, app, ctx) },
    { id: 'mk', label: 'M–κ', render: (e) => tabMK(e, app, ctx) },
    { id: 'werte', label: 'Werte', render: (e) => tabProps(e, app) },
  ];
  const t = tabs(defs, { active: ctx.ui.resTab, onSwitch: (id) => { ctx.ui.resTab = id; } });
  t.el.style.margin = '6px -12px 0';
  el.append(t.el);
}

function caseSelector(app) {
  const loads = app.project.loads || [];
  app.viewOpts.lc = caseIndex(app);
  const sel = selectInput(app.viewOpts, 'lc', loads.map((l, i) => ({ value: i, label: `${l.name || `LF ${i + 1}`} (${l.type || 'GZT'})` })), {
    onChange: () => { app.selection = null; app.renderView(); app.renderResults(); },
  });
  sel.style.width = '100%';
  return h('div', { class: 'field wide', style: { marginBottom: '8px' } }, h('label', {}, 'Lastfall'), sel);
}

function tabChecks(el, app) {
  const R = app.results;
  if (!R.cases.length) { el.append(emptyState('Keine Nachweise', 'Lastfälle im Register «Lasten» erfassen.')); return; }
  const rows = R.cases.flatMap((c) => caseChecks(R, c));
  el.append(checksTable(rows, { edLabel: 'Einwirkung', rdLabel: 'Widerstand' }));
  // Kurzübersicht je Lastfall
  el.append(h('div', { class: 'small muted', style: { margin: '8px 0 4px' } }, 'Übersicht je Lastfall (Klick wählt den Lastfall für Grafik und Details):'));
  const list = h('div', { style: { display: 'grid', gap: '4px' } });
  for (const c of R.cases) {
    const eta = Math.max(c.eta ?? 0, c.etaV ?? 0);
    list.append(h('button', {
      type: 'button', class: 'btn', style: { justifyContent: 'space-between', height: 'auto', padding: '5px 8px', borderColor: c.i === caseIndex(app) ? 'var(--accent)' : undefined },
      onclick: () => { app.viewOpts.lc = c.i; app.renderView(); app.renderResults(); },
    }, h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center', minWidth: 0 } }, badge(c.type, c.type === 'GZT' ? 'info' : 'warn'), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, c.name)), utilBar(eta)));
  }
  el.append(list);
}

function stateRows(st, opts = {}) {
  if (!st) return [];
  return [
    ['Dehnung im Bezugspunkt ε_0', (st.eRef ?? st.e0) * 1000, '‰', 3],
    ['Gradient ∂ε/∂y', st.ky * 1000, '‰/m', 3],
    ['Gradient ∂ε/∂z', st.kz * 1000, '‰/m', 3],
    ['Krümmung |κ|', Math.hypot(st.ky, st.kz) * 1000, '1/km', 3],
    ['Beton ε_c,min', st.ext.ecMin * 1000, '‰', 2],
    ['Beton ε_c,max (Zugrand)', st.ext.ecMax * 1000, '‰', 2],
    st.bars.length ? ['Stahl ε_s,max', st.ext.esMax * 1000, '‰', 2] : null,
    st.bars.length ? ['Stahl ε_s,min', st.ext.esMin * 1000, '‰', 2] : null,
    ['Druckzonenhöhe x', Number.isFinite(st.x) ? st.x / MM : 'voll überdrückt', Number.isFinite(st.x) ? 'mm' : '', 0],
    ['Betonspannung σ_c,min', st.sigmaCmin, 'MPa', 1],
    st.bars.length ? ['Stahlspannung σ_s,max', st.sigmaSmax, 'MPa', 0] : null,
    st.bars.length ? ['Stahlspannung σ_s,min', st.sigmaSmin, 'MPa', 0] : null,
    opts.withN ? ['Kontrolle N / M_y / M_z', `${fmt(st.N, 0)} / ${fmt(st.My, 1)} / ${fmt(st.Mz, 1)}`, 'kN, kNm'] : null,
  ];
}

function tabCase(el, app, ctx) {
  const R = app.results;
  if (!R.cases.length) { el.append(emptyState('Kein Lastfall', 'Lastfälle im Register «Lasten» erfassen.')); return; }
  el.append(caseSelector(app));
  const c = R.cases[caseIndex(app)];
  const eta = Math.max(c.eta ?? 0, c.etaV ?? 0);
  el.append(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '0 0 8px' } },
    badge(c.type === 'GZT' ? 'Tragsicherheit (GZT)' : 'Gebrauchstauglichkeit (GZG)', c.type === 'GZT' ? 'info' : 'warn'),
    badge(ok(eta) ? 'erfüllt' : 'nicht erfüllt', ok(eta) ? 'ok' : 'fail')));
  el.append(stats([['N', c.N, 'kN', 0], ['M_y', c.My, 'kNm', 1], ['M_z', c.Mz, 'kNm', 1], [c.shear ? 'max. η (inkl. V)' : 'Ausnutzung η', Number.isFinite(eta) ? eta : '∞', '', 2]]));
  el.append(h('div', { style: { display: 'flex', gap: '6px', margin: '0 0 10px', flexWrap: 'wrap' } },
    button('Dehnungen zeigen', { small: true, icon: 'layers', onClick: () => app.setViewMode('dehnungen') }),
    button('Spannungen zeigen', { small: true, icon: 'grid', onClick: () => app.setViewMode('spannungen') })));
  if (c.type === 'GZT') {
    const u = c.uls;
    el.append(h('h4', { style: { margin: '6px 0 4px' } }, 'Widerstand (Bruchzustand)'));
    el.append(kvTable([
      ['η = max(η_M, η_N)', u.eta, '', 3],
      u.outside ? null : ['η_M (Momente, N konstant)', u.etaM, '', 3],
      ['η_N = N/N_Rd', u.etaN, '', 3],
      u.outside ? ['N_Rd (zentrisch)', u.NR, 'kN', 0] : ['M_Rd,y (gleiches N)', u.MyR, 'kNm', 1],
      u.outside ? null : ['M_Rd,z (gleiches N)', u.MzR, 'kNm', 1],
      ['Versagensart', u.mode || '–', ''],
      u.rstate ? ['ε_c,min / ε_s,max', `${fmt(u.rstate.ext.ecMin * 1000, 2)} / ${fmt(u.rstate.ext.esMax * 1000, 2)}`, '‰'] : null,
      u.rstate && Number.isFinite(u.rstate.x) ? ['Druckzone x (Bruch)', u.rstate.x / MM, 'mm', 0] : null,
    ]));
    el.append(h('div', { class: 'small muted', style: { margin: '4px 0 8px' } }, rich('η_M: Momente bei konstanter Normalkraft radial bis zum Interaktionsrand gesteigert; η_N: Normalkraft im Verhältnis zum zentrischen Widerstand. Massgebend ist der grössere Wert.')));
    if (u.shifted) el.append(noteR('Der Bezugspunkt liegt bei dieser Normalkraft ausserhalb des M_y-M_z-Bereichs (stark exzentrischer Bezugspunkt). Die Momente werden deshalb vom Schwerpunkt des Bereichs aus gesteigert. Empfehlung: Bezugspunkt «Schwerpunkt Beton».', 'warn'));
    el.append(h('h4', { style: { margin: '6px 0 4px' } }, 'Dehnungszustand unter Bemessungslasten'));
    if (c.ulsState.ok) {
      if (c.ulsState.fail) el.append(note('Grenzdehnung überschritten – der Zustand liegt ausserhalb des zulässigen Bereichs.', 'fail'));
      el.append(kvTable(stateRows(c.ulsState)));
    } else el.append(note(c.ulsState.msg, 'fail'));
    if (c.shear) {
      const s = c.shear, g = R.shearGeo;
      el.append(h('h4', { style: { margin: '10px 0 4px' } }, 'Querkraft'));
      el.append(kvTable([
        ['Querkraft V_Ed', s.VEd, 'kN', 0],
        ['b_w / d / z', `${fmt(g.bw, 0)} / ${fmt(g.d, 0)} / ${fmt(g.z, 0)}`, 'mm'],
        s.hasStirrups ? ['Bügel a_sw', s.asw, 'mm²/m', 0] : ['Querkraftbewehrung', 'keine', ''],
        s.kd !== undefined ? ['k_d = 1/(1 + ε_v·d·k_g)', s.kd, '', 3] : null,
        s.VRds !== undefined ? ['V_Rd,s', s.VRds, 'kN', 0] : null,
        s.VRdc !== undefined ? [R.mat.norm === 'SIA' ? 'V_Rd,c (Druckfeld)' : 'V_Rd,c (ohne Bügel)', s.VRdc, 'kN', 0] : null,
        s.VRdmax !== undefined ? ['V_Rd,max', s.VRdmax, 'kN', 0] : null,
        ['Widerstand V_Rd', s.VRd, 'kN', 0],
      ]));
      for (const n of s.notes) el.append(noteR(n, 'warn'));
    }
  } else {
    const s = c.sls;
    el.append(h('h4', { style: { margin: '6px 0 4px' } }, 'Spannungsnachweis (gerissen, linear-elastisch)'));
    if (s.error) { el.append(note(s.error, 'fail')); return; }
    el.append(checksTable(s.checks, { edLabel: 'vorhanden', rdLabel: 'zulässig' }));
    el.append(kvTable([
      ['Wertigkeit n = E_s/E_c,eff', R.mat.nSLS, '', 2],
      R.mat.norm === 'SIA' ? ['Stababstand s (Zuglage)', `${fmt(s.spacing, 0)}${s.spacingAuto ? ' (automatisch)' : ''}`, 'mm'] : null,
      ['σ_s,adm', s.lim.value, 'MPa', 0],
    ]));
    for (const n of s.notes) el.append(noteR(n, 'warn'));
    el.append(h('h4', { style: { margin: '10px 0 4px' } }, 'Dehnungszustand'));
    el.append(kvTable(stateRows(c.slsState)));
  }
  void ctx;
}

function tabInteraction(el, app, ctx) {
  const R = app.results;
  const axis = ctx.ui.nmAxis === 'Mz' ? 'Mz' : 'My';
  el.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 6px' } },
    h('span', { class: 'small muted' }, 'N-M-Diagramm für'),
    segmented([{ id: 'My', label: 'M_y (um y)' }, { id: 'Mz', label: 'M_z (um z)' }], axis, (id) => { ctx.ui.nmAxis = id; app.renderResults(); })));
  el.append(chartBox(nmChartOpts(R, axis, app.results.cases.length ? caseIndex(app) : -1)));
  el.append(h('div', { class: 'small muted', style: { margin: '-6px 0 10px' } },
    rich(`Bruchzustand, Nulllinie ${axis === 'My' ? 'horizontal' : 'vertikal'}. Punkte: Lastfälle (● GZT, ■ GZG) mit ihrer ${axis === 'My' ? 'M_y' : 'M_z'}-Komponente. N < 0 Druck (oben).`)));
  if (!R.cases.length) return;
  el.append(caseSelector(app));
  const c = R.cases[caseIndex(app)];
  const opts = mymzChartOpts(R, c);
  if (!opts) { el.append(noteR(`N = ${fmt(c.N, 0)} kN liegt ausserhalb des zentrischen Widerstands (${fmt(R.axial.Nc, 0)} … ${fmt(R.axial.Nt, 0)} kN) – kein M_y-M_z-Diagramm.`, 'fail')); return; }
  el.append(chartBox(opts));
  el.append(h('div', { class: 'small muted', style: { margin: '-6px 0 10px' } }, rich('M_y-M_z-Interaktion bei der Normalkraft des Lastfalls; gestrichelt: Strahl bis zum Widerstand (η = Länge Einwirkung / Länge Widerstand).')));
}

export function nmChartOpts(R, axis, sel = -1, size = {}) {
  const curve = R.lazy.nm(axis);
  const pts = R.cases.map((c) => ({
    x: axis === 'My' ? c.My : c.Mz, y: c.N, shape: c.type === 'GZT' ? 'circle' : 'square',
    color: c.i === sel ? 'var(--c-highlight)' : c.type === 'GZT' ? 'var(--c-series-2)' : 'var(--c-series-4)',
    label: c.i === sel ? short(c.name) : '', title: `${c.name}: N = ${fmt(c.N, 0)} kN, ${axis === 'My' ? 'M_y' : 'M_z'} = ${fmt(axis === 'My' ? c.My : c.Mz, 1)} kNm`,
  }));
  return {
    series: [{ points: curve.map((p) => [p.M, p.N]), closed: true, fill: true, fillOpacity: 0.12, label: 'Widerstand', color: 'var(--c-series-1)' }],
    points: pts,
    xLabel: `${axis === 'My' ? 'M_y' : 'M_z'} [kNm] (${axis === 'My' ? '+ Zug unten' : '+ Zug rechts'})`, yLabel: 'N [kN]', invertY: true,
    title: `Interaktion N–${axis === 'My' ? 'M_y' : 'M_z'}`, ...size,
  };
}

export function mymzChartOpts(R, c, size = {}) {
  const curve = c.uls ? c.uls.curve : R.lazy.mymz(c.N);
  if (!curve.length) return null;
  const u = c.uls || R.lazy.cap(c.N, c.My, c.Mz);
  const series = [{ points: curve.map((p) => [p.My, p.Mz]), closed: true, fill: true, fillOpacity: 0.12, label: `Widerstand bei N = ${fmt(c.N, 0)} kN`, color: 'var(--c-series-1)' }];
  const from = u.from || [0, 0];
  const hasRay = !u.outside && Math.hypot(c.My - from[0], c.Mz - from[1]) > 1e-9;
  if (hasRay) series.push({ points: [from, [u.MyR, u.MzR]], color: 'var(--text-3)', dash: '4 3', width: 1.2 });
  return {
    series,
    points: [
      { x: c.My, y: c.Mz, color: 'var(--c-highlight)', label: short(c.name), title: `Einwirkung: M_y = ${fmt(c.My, 1)}, M_z = ${fmt(c.Mz, 1)} kNm` },
      hasRay ? { x: u.MyR, y: u.MzR, shape: 'cross', color: 'var(--c-series-1)', title: `Widerstand: M_y = ${fmt(u.MyR, 1)}, M_z = ${fmt(u.MzR, 1)} kNm` } : null,
    ].filter(Boolean),
    xLabel: 'M_y [kNm] (+ Zug unten)', yLabel: 'M_z [kNm] (+ Zug rechts)', equal: true, title: `Interaktion M_y–M_z · ${short(c.name, 28)}`, ...size,
  };
}

// ------------------------------------------------------------------ M-κ

const MK_DIRS = [
  { value: 'auto', label: 'aus Lastfall' },
  { value: 'My+', label: 'um y, Zug unten' },
  { value: 'My-', label: 'um y, Zug oben' },
  { value: 'Mz+', label: 'um z, Zug rechts' },
  { value: 'Mz-', label: 'um z, Zug links' },
];

function mkSetup(R, app, ctx) {
  const c = R.cases.length ? R.cases[caseIndex(app)] : null;
  const N = c ? c.N : 0;
  const dir = ctx.ui.mkDir || 'auto';
  let theta;
  if (dir === 'My+') theta = Math.PI / 2;
  else if (dir === 'My-') theta = -Math.PI / 2;
  else if (dir === 'Mz+') theta = Math.PI;
  else if (dir === 'Mz-') theta = 0;
  else theta = c ? thetaForUserMoment(c.My, c.Mz) : Math.PI / 2;
  const laws = app.project.calc?.mkLaws || 'both';
  const curves = [];
  if (laws !== 'mean') curves.push({ law: 'design', label: 'Bemessung', color: 'var(--c-series-1)', dash: null, res: R.lazy.mk('design', N, theta) });
  if (laws !== 'design') curves.push({ law: 'mean', label: 'Mittelwerte', color: 'var(--c-series-3)', dash: '6 3', res: R.lazy.mk('mean', N, theta) });
  return { c, N, theta, curves };
}

export function mkChartOpts(setup, size = {}) {
  const series = [], points = [];
  for (const cv of setup.curves) {
    const r = cv.res;
    if (!r.points.length) continue;
    series.push({ points: r.points.map((p) => [p.kappa * 1000, p.M]), label: cv.label, color: cv.color, dash: cv.dash, width: 2 });
    if (r.crack) points.push({ x: r.crack.kappa * 1000, y: r.crack.M, shape: 'square', color: cv.color, title: `${cv.label}: Riss M = ${fmt(r.crack.M, 1)} kNm` });
    if (r.yield) points.push({ x: r.yield.kappa * 1000, y: r.yield.M, color: cv.color, label: cv.law === 'design' ? 'Fliessen' : '', title: `${cv.label}: Fliessbeginn M = ${fmt(r.yield.M, 1)} kNm, κ = ${fmt(r.yield.kappa * 1000, 2)} 1/km` });
    if (r.ultimate) points.push({ x: r.ultimate.kappa * 1000, y: r.ultimate.M, shape: 'cross', color: cv.color, label: cv.law === 'design' ? 'Bruch' : '', title: `${cv.label}: Bruch M = ${fmt(r.ultimate.M, 1)} kNm, κ = ${fmt(r.ultimate.kappa * 1000, 2)} 1/km` });
  }
  return { series, points, xLabel: 'Krümmung κ [1/km]', yLabel: 'M [kNm]', title: `M–κ bei N = ${fmt(setup.N, 0)} kN`, ...size };
}

function tabMK(el, app, ctx) {
  const R = app.results;
  if (R.cases.length) el.append(caseSelector(app));
  const p = app.project;
  const dirSel = selectInput(ctx.ui, 'mkDir', MK_DIRS, { onChange: () => app.renderResults() });
  const lawSel = selectInput(p.calc, 'mkLaws', [{ value: 'both', label: 'Bemessungs- und Mittelwerte' }, { value: 'design', label: 'nur Bemessungswerte' }, { value: 'mean', label: 'nur Mittelwerte' }], { onChange: () => app.renderResults() });
  el.append(h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', {}, 'Biegerichtung'), dirSel), h('div', { class: 'field' }, h('label', {}, 'Werkstoffgesetze'), lawSel)));
  const setup = mkSetup(R, app, ctx);
  const errs = setup.curves.filter((cv) => cv.res.error);
  if (errs.length === setup.curves.length) { el.append(noteR(errs[0].res.error, 'fail')); return; }
  el.append(chartBox(mkChartOpts(setup)));
  const rows = [];
  for (const cv of setup.curves) {
    const r = cv.res;
    if (r.error) continue;
    const mu = r.yield && r.ultimate ? r.ultimate.kappa / r.yield.kappa : NaN;
    rows.push([cv.label,
      r.crack ? fmt(r.crack.M, 0) : '–', r.yield ? fmt(r.yield.M, 0) : '–', r.yield ? fmt(r.yield.kappa * 1000, 1) : '–',
      r.ultimate ? fmt(r.ultimate.M, 0) : '–', r.ultimate ? fmt(r.ultimate.kappa * 1000, 1) : '–', fmt(mu, 1),
      r.yield ? fmt(r.yield.M / r.yield.kappa / 1000, 0) : '–']);
  }
  el.append(resultTable([{ label: '' }, { label: 'M_cr', num: true }, { label: 'M_F', num: true }, { label: 'κ_F', num: true }, { label: 'M_u', num: true }, { label: 'κ_u', num: true }, { label: 'μ_κ', num: true }, { label: 'EI_II', num: true }], rows));
  el.append(h('div', { class: 'small muted' },
    rich(`Index F: Fliessbeginn, u: Bruch, cr: Riss. Momente in kNm, Krümmungen in 1/km, EI_II = M_F/κ_F in MNm², μ_κ = κ_u/κ_F (Krümmungsduktilität). ${R.mat.phi > 0 ? `Kriechzahl φ = ${fmt(R.mat.phi, 1)} berücksichtigt (Dehnungen ×(1+φ)). ` : ''}Mittelwerte: f_cm mit f_ctm bis zum Riss, Stahl f_sk mit Verfestigung bis k_s·f_sk (ohne Mitwirkung des Betons zwischen den Rissen).`)));
}

// ------------------------------------------------------------------ Querschnittswerte

function propRows(R) {
  const g = R.gross, i = R.ideal;
  const mm2 = (x) => x * 1e6, mm4 = (x) => x * 1e12 / 1e6, mm3 = (x) => x * 1e9 / 1e3, mm = (x) => x * 1e3;
  const f = (x) => fmtSig(x, 4);
  return [
    ['Fläche A', f(mm2(g.A)), f(mm2(i.A)), 'mm²'],
    ['Schwerpunkt y_S', fmt(mm(g.cy), 1), fmt(mm(i.cy), 1), 'mm'],
    ['Schwerpunkt z_S', fmt(mm(g.cz), 1), fmt(mm(i.cz), 1), 'mm'],
    ['I_y (um y-Achse)', f(mm4(g.Iy)), f(mm4(i.Iy)), '10⁶ mm⁴'],
    ['I_z (um z-Achse)', f(mm4(g.Iz)), f(mm4(i.Iz)), '10⁶ mm⁴'],
    ['I_yz', f(mm4(g.Iyz)), f(mm4(i.Iyz)), '10⁶ mm⁴'],
    ['I_1 (Hauptachse 1)', f(mm4(g.I1)), f(mm4(i.I1)), '10⁶ mm⁴'],
    ['I_2 (Hauptachse 2)', f(mm4(g.I2)), f(mm4(i.I2)), '10⁶ mm⁴'],
    ['Winkel α der Achse 1', g.isotropic ? 'beliebig' : fmt(g.alpha * 180 / Math.PI, 2), i.isotropic ? 'beliebig' : fmt(i.alpha * 180 / Math.PI, 2), '°'],
    ['W_y oben', f(mm3(g.Wy_top)), f(mm3(i.Wy_top)), '10³ mm³'],
    ['W_y unten', f(mm3(g.Wy_bot)), f(mm3(i.Wy_bot)), '10³ mm³'],
    ['W_z rechts', f(mm3(g.Wz_right)), f(mm3(i.Wz_right)), '10³ mm³'],
    ['W_z links', f(mm3(g.Wz_left)), f(mm3(i.Wz_left)), '10³ mm³'],
  ].map(([l, ...r]) => [rich(l), ...r]);
}

function tabProps(el, app) {
  const R = app.results;
  el.append(stats([
    ['Bewehrung A_s', R.As * 1e6, 'mm²', 0],
    ['Bewehrungsgehalt ρ', R.rho * 100, '%', 2],
    ['N_Rd Druck', R.axial.Nc, 'kN', 0],
    ['N_Rd Zug', R.axial.Nt, 'kN', 0],
    ['M_Rd,y+ (N = 0)', R.mrd.MyPos, 'kNm', 1],
    ['M_Rd,y− (N = 0)', R.mrd.MyNeg, 'kNm', 1],
    ['M_Rd,z+ (N = 0)', R.mrd.MzPos, 'kNm', 1],
    ['M_Rd,z− (N = 0)', R.mrd.MzNeg, 'kNm', 1],
  ]));
  el.append(h('h4', { style: { margin: '6px 0 4px' } }, 'Querschnittswerte'));
  el.append(resultTable([{ label: 'Grösse' }, { label: 'Beton brutto', num: true }, { label: `ideell (n = ${fmt(R.mat.nShort, 2)})`, num: true }, { label: 'Einheit' }], propRows(R)));
  el.append(h('div', { class: 'small muted' }, rich('Koordinaten bezogen auf den Ursprung der Eingabe. Ideell: ungerissen, Stäbe mit (n − 1)·A_s, n = E_s/E_cm. Achse 1: grösstes Trägheitsmoment, Winkel α gegen die y-Achse.')));
  const { c, s } = R.mat;
  el.append(h('h4', { style: { margin: '6px 0 4px' } }, 'Baustoffe'));
  el.append(kvTable([
    [`Beton ${c.name} (${R.mat.norm})`, `f_ck = ${fmt(c.fck, 0)}`, 'MPa'],
    ['Bemessungswert f_cd', c.fcd, 'MPa', 2],
    ['Zugfestigkeit f_ctm', c.fctm, 'MPa', 2],
    ['E-Modul E_cm', c.Ecm / 1000, 'GPa', 1],
    ['ε_c2 / ε_cu', `${fmt(c.ec2 * 1000, 2)} / ${fmt(c.ecu * 1000, 2)}`, '‰'],
    [`Betonstahl ${s.name}`, `f_sk = ${fmt(s.fsk, 0)}`, 'MPa'],
    ['Bemessungswert f_sd', s.fsd, 'MPa', 1],
    ['E_s / ε_ud', `${fmt(s.Es / 1000, 0)} GPa / ${fmt(s.eud * 1000, 1)} ‰`, ''],
    ['Fasermodell', `${R.nFibers} Fasern, h ≈ ${fmt(R.mesh * 1000, 0)} mm`, ''],
    ['Bezugspunkt', `${REF_POINTS.find((r) => r.value === R.refMode)?.label || ''} (${fmt(R.ref[0] / MM, 1)} / ${fmt(R.ref[1] / MM, 1)} mm)`, ''],
  ]));
}

// ------------------------------------------------------------------ Bericht

export function buildReport(app, ctx) {
  const R = app.results, p = app.project;
  const sections = [];
  const shapeLabel = SHAPE_TYPES.find((s) => s.id === p.shape.type)?.label || p.shape.type;
  const params = p.shape.type === 'poly'
    ? `${p.shape.poly.length} Eckpunkte${(p.openings || []).length ? `, ${p.openings.length} Aussparung(en)` : ''}`
    : SHAPE_PARAMS[p.shape.type].map(([k, l]) => `${l} = ${fmt(p.shape[p.shape.type][k], 0)} mm`).join(', ');
  const { c, s } = R.mat;

  sections.push({ title: 'Querschnitt und Baustoffe', content: [
    rP(`${shapeLabel}: ${params}.`),
    rFig(app.snapshot('geometrie'), 'Querschnitt mit Bewehrung (Masse in mm), Schwerpunkt S und Haupt-/Schwerachsen'),
    rKV([
      ['Norm', R.mat.norm === 'SIA' ? 'SIA 262 (2013)' : 'EN 1992-1-1'],
      ['Beton', `${c.name}: f_cd = ${fmt(c.fcd, 1)} MPa, f_ctm = ${fmt(c.fctm, 2)} MPa, E_cm = ${fmt(c.Ecm / 1000, 1)} GPa, ε_c2 = ${fmt(c.ec2 * 1000, 1)} ‰, ε_cu = ${fmt(c.ecu * 1000, 1)} ‰ (γ_c = ${fmt(c.gammaC, 2)})`],
      ['Betonstahl', `${s.name}: f_sd = ${fmt(s.fsd, 1)} MPa, E_s = ${fmt(s.Es / 1000, 0)} GPa, ε_ud = ${fmt(s.eud * 1000, 1)} ‰ (γ_s = ${fmt(s.gammaS, 2)})${R.mat.hardening ? ', mit Verfestigung' : ''}`],
    ]),
  ] });

  const bars = (p.bars || []).map((b, i) => [i + 1, b.y, b.z, b.d, barAreaMm2(b.d)]);
  sections.push({ title: 'Bewehrung', content: [
    rTable([{ label: 'Nr.' }, { label: 'y [mm]', num: true, digits: 1 }, { label: 'z [mm]', num: true, digits: 1 }, { label: 'Ø [mm]', num: true, digits: 0 }, { label: 'A_s [mm²]', num: true, digits: 0 }], bars),
    rP(`Total ${bars.length} Stäbe, A_s = ${fmt(R.As * 1e6, 0)} mm², ρ = A_s/A_c = ${fmt(R.rho * 100, 2)} %.`),
  ] });

  sections.push({ title: 'Querschnittswerte', content: [
    rTable([{ label: 'Grösse' }, { label: 'Beton brutto', num: true }, { label: `ideell (n = ${fmt(R.mat.nShort, 2)})`, num: true }, { label: 'Einheit' }], propRows(R)),
    rP(`Zentrischer Widerstand: N_Rd = ${fmt(R.axial.Nc, 0)} kN (Druck) bzw. ${fmt(R.axial.Nt, 0)} kN (Zug). Biegewiderstand bei N = 0: M_Rd,y = +${fmt(R.mrd.MyPos, 1)} / ${fmt(R.mrd.MyNeg, 1)} kNm, M_Rd,z = +${fmt(R.mrd.MzPos, 1)} / ${fmt(R.mrd.MzNeg, 1)} kNm.`),
  ] });

  sections.push({ title: 'Schnittgrössen', content: [
    rP(`Vorzeichen: N > 0 Zug; M_y > 0 erzeugt Zug unten (z < 0), M_z > 0 Zug rechts (y > 0). Bezugspunkt: ${REF_POINTS.find((r) => r.value === R.refMode)?.label} (y = ${fmt(R.ref[0] / MM, 1)} mm, z = ${fmt(R.ref[1] / MM, 1)} mm).`),
    rTable([{ label: 'Lastfall' }, { label: 'Typ' }, { label: 'N [kN]', num: true, digits: 1 }, { label: 'M_y [kNm]', num: true, digits: 1 }, { label: 'M_z [kNm]', num: true, digits: 1 }, p.shear?.active ? { label: 'V_d [kN]', num: true, digits: 1 } : null],
      R.cases.map((x) => [x.name, x.type, x.N, x.My, x.Mz, ...(p.shear?.active ? [x.V] : [])])),
  ] });

  if (R.ulsCases.length) {
    sections.push({ title: 'Tragsicherheit (GZT): Biegung mit Normalkraft', content: [
      rP(`Nachweis mit dem Fasermodell: Ebenbleiben der Querschnitte, Beton ohne Zugfestigkeit, Parabel-Rechteck-Diagramm (${R.mat.norm === 'SIA' ? 'SIA 262, 4.2.1.2' : 'EN 1992-1-1, 3.1.7'}), Betonstahl bilinear (${R.mat.norm === 'SIA' ? 'SIA 262, 4.2.2.2' : 'EN 1992-1-1, 3.2.7'}). Bruchdehnungsebenen nach der Pivot-Methode; die Ausnutzung η ergibt sich durch radiale Steigerung der Momente bei konstanter Normalkraft bis zum Interaktionsrand.`),
      repFormula(fx('η_M = sqrt(M_Ed,y^2 + M_Ed,z^2) / sqrt(M_Rd,y^2 + M_Rd,z^2)   (bei gleichem N und gleicher Momentenrichtung)')),
      repFormula(fx('η_N = N_Ed / N_Rd   (zentrischer Widerstand),   η = max(η_M, η_N)')),
      rTable([{ label: 'Lastfall' }, { label: 'N [kN]', num: true, digits: 0 }, { label: 'M_y/M_z [kNm]' }, { label: 'M_Rd,y/M_Rd,z [kNm]' }, { label: 'ε_c/ε_s [‰]' }, { label: 'Versagensart' }, { label: 'η', num: true, digits: 2 }, { label: 'Status' }],
        R.ulsCases.map((x) => [x.name, x.N, `${fmt(x.My, 1)} / ${fmt(x.Mz, 1)}`, x.uls.outside ? `N_Rd = ${fmt(x.uls.NR, 0)} kN` : `${fmt(x.uls.MyR, 1)} / ${fmt(x.uls.MzR, 1)}`,
          x.ulsState.ok ? `${fmt(x.ulsState.ext.ecMin * 1000, 2)} / ${fmt(x.ulsState.ext.esMax * 1000, 2)}` : '–', x.uls.mode, x.uls.eta, ok(x.uls.eta) ? 'erfüllt' : 'nicht erfüllt'])),
    ] });
  }

  if (R.slsCases.length) {
    const reqLabel = SLS_REQUIREMENTS.find((r) => r.value === (p.sls?.req || 'normal'))?.label;
    sections.push({ title: 'Gebrauchstauglichkeit (GZG): Spannungen im gerissenen Zustand', content: [
      rP(`Linear-elastische Berechnung im gerissenen Zustand (Beton ohne Zugfestigkeit, E_c,eff = E_s/n mit n = ${fmt(R.mat.nSLS, 2)}). ${R.mat.norm === 'SIA'
        ? `Anforderung an die Rissbreitenbegrenzung: ${reqLabel} (SIA 262, 4.4.2). Zulässige Stahlspannung σ_s,adm in Abhängigkeit des Stababstands s nach einer Näherung der Kurven von Fig. 31 (gerundete Ablesewerte, stückweise linear: erhöht ${SIA_FIG31.erhoeht.map(([a, b]) => `${a}→${b}`).join(', ')}; hoch ${SIA_FIG31.hoch.map(([a, b]) => `${a}→${b}`).join(', ')} [mm → MPa]). Die Werte sind mit der Norm zu vergleichen.`
        : 'Spannungsbegrenzung nach EN 1992-1-1, 7.2: σ_s ≤ 0.8·f_yk (charakteristische Kombination), |σ_c| ≤ 0.6·f_ck.'}`),
      rTable([{ label: 'Lastfall' }, { label: 'N [kN]', num: true, digits: 0 }, { label: 'M_y/M_z [kNm]' }, { label: 'x [mm]', num: true, digits: 0 }, { label: 'σ_c [MPa]', num: true, digits: 1 }, { label: 'σ_s [MPa]', num: true, digits: 0 }, { label: 'σ_s,adm [MPa]', num: true, digits: 0 }, { label: 'η', num: true, digits: 2 }, { label: 'Status' }],
        R.slsCases.map((x) => x.sls.error ? [x.name, x.N, `${fmt(x.My, 1)} / ${fmt(x.Mz, 1)}`, '–', '–', '–', '–', '–', x.sls.error]
          : [x.name, x.N, `${fmt(x.My, 1)} / ${fmt(x.Mz, 1)}`, Number.isFinite(x.slsState.x) ? x.slsState.x / MM : '∞', x.slsState.sigmaCmin, x.sls.sigS, x.sls.lim.value, x.sls.eta, ok(x.sls.eta) ? 'erfüllt' : 'nicht erfüllt'])),
    ] });
  }

  if (p.shear?.active && R.ulsCases.length) {
    const g = R.shearGeo, sh = p.shear;
    sections.push({ title: 'Querkraft', content: [
      rP(R.mat.norm === 'SIA'
        ? 'SIA 262, 4.3.3: mit Querkraftbewehrung V_Rd,s = (A_sw/s)·z·f_sd·cot α (4.3.3.4.3) und Betondruckfeld V_Rd,c = b_w·z·k_c·f_cd·sin α·cos α mit k_c = 0.55 (4.3.3.4.6); ohne Querkraftbewehrung V_Rd = k_d·τ_cd·d·b_w mit k_d = 1/(1 + ε_v·d·k_g), k_g = 48/(16 + D_max) (4.3.3.2, vereinfacht).'
        : 'EN 1992-1-1, 6.2: ohne Querkraftbewehrung V_Rd,c nach (6.2a/b); mit Querkraftbewehrung V_Rd,s = (A_sw/s)·z·f_ywd·cot θ (6.8) und V_Rd,max = α_cw·b_w·z·ν_1·f_cd/(cot θ + tan θ) (6.9).'),
      rKV([
        ['b_w / d / z', `${fmt(g.bw, 0)} / ${fmt(g.d, 0)} / ${fmt(g.z, 0)} mm`],
        ['Bügel', sh.dw > 0 && sh.s > 0 ? `${sh.legs}-schnittig Ø${sh.dw} s = ${fmt(sh.s, 0)} mm, ${R.mat.norm === 'SIA' ? 'α' : 'θ'} = ${fmt(sh.angle, 1)}°` : 'keine Querkraftbewehrung'],
      ]),
      rTable([{ label: 'Lastfall' }, { label: 'V_Ed [kN]', num: true, digits: 0 }, { label: 'Nachweise' }, { label: 'V_Rd [kN]', num: true, digits: 0 }, { label: 'η', num: true, digits: 2 }, { label: 'Status' }],
        R.ulsCases.filter((x) => x.shear).map((x) => [x.name, x.shear.VEd, x.shear.checks.map((ch) => `${ch.label}: ${fmt(ch.Rd, 0)} kN`).join('; '), x.shear.VRd, x.shear.eta, ok(x.shear.eta) ? 'erfüllt' : 'nicht erfüllt'])),
    ] });
  }

  // Diagramme
  const charts = [];
  const sel = R.cases.length ? caseIndex(app) : -1;
  const size = { width: 520, height: 340 };
  charts.push(rFig(xyChart({ ...nmChartOpts(R, 'My', sel, size), crosshair: false }), 'Interaktionsdiagramm N–M_y (Bruchzustand) mit Lastfällen'));
  if (R.gross.b > 0 && Math.abs(R.mrd.MzPos) > 0) charts.push(rFig(xyChart({ ...nmChartOpts(R, 'Mz', sel, size), crosshair: false }), 'Interaktionsdiagramm N–M_z (Bruchzustand)'));
  if (sel >= 0) {
    const c = R.cases[sel];
    const o = mymzChartOpts(R, c, { width: 460, height: 400 });
    if (o) charts.push(rFig(xyChart({ ...o, crosshair: false }), `M_y–M_z-Interaktion bei N = ${fmt(c.N, 0)} kN (Lastfall «${c.name}»)`));
    const setup = mkSetup(R, app, ctx);
    if (setup.curves.some((cv) => !cv.res.error)) charts.push(repFigure(xyChart({ ...mkChartOpts(setup, size), crosshair: false }), `Momenten-Krümmungs-Beziehung bei N = ${fmt(setup.N, 0)} kN (● Fliessbeginn, × Bruch, ■ Riss)`));
  }
  sections.push({ title: 'Interaktion und Verformungsverhalten', content: charts });

  if (sel >= 0) {
    const c = R.cases[sel];
    sections.push({ title: `Dehnungen und Spannungen – ${c.name}`, content: [
      repFigure(app.snapshot('dehnungen'), `Dehnungsebene und Nulllinie, ${c.type === 'GZT' ? 'GZT unter Bemessungslasten' : 'GZG gerissen'} (Druck blau, Zug rosé)`),
      repFigure(app.snapshot('spannungen'), 'Beton- und Stahlspannungen [MPa]'),
    ] });
  }

  sections.push({ title: 'Annahmen und Grenzen', content: [
    h('ul', {},
      h('li', {}, 'Ebenbleiben der Querschnitte (Bernoulli), starrer Verbund zwischen Beton und Bewehrung.'),
      h('li', {}, `Fasermodell mit ${R.nFibers} Dreiecksfasern (Kantenlänge ≈ ${fmt(R.mesh * 1000, 0)} mm); Betonfläche an den Stabstellen abgezogen.`),
      h('li', {}, 'Beton ohne Zugfestigkeit (ausser M-κ mit Mittelwerten bis zur Rissbildung); keine Mitwirkung des Betons zwischen den Rissen (Tension Stiffening).'),
      h('li', {}, 'Querschnittsnachweis ohne Einflüsse aus Theorie 2. Ordnung, Kriechen im GZT, Torsion und Interaktion mit Querkraft.'),
      h('li', {}, rich('Querkraftnachweis vereinfacht mit konstanten b_w, d und z; Mindestbewehrung und konstruktive Regeln sind separat zu prüfen.')),
      h('li', {}, rich(R.mat.norm === 'SIA' ? 'Zulässige Stahlspannungen nach Fig. 31 genähert – mit der Norm zu vergleichen.' : 'Spannungsgrenzen nach EN 1992-1-1, 7.2 mit empfohlenen Werten k_1 = 0.6, k_3 = 0.8.')),
    ),
  ] });
  return sections;
}
