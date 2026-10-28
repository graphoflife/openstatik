// Querschnitt – Ergebnisbereich und Bericht
import { h, tabs, segmented, selectInput, checksTable, summaryCard, stats, kvTable, resultTable, note, badge, emptyState, button, utilBar } from '../../js/core/ui.js';
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

// ------------------------------------------------------------------ Nachweiszeilen

function bendingRef(R) {
  return R.mat.norm === 'SIA'
    ? `SIA 262, 4.3.2 / 2.3.2: Fasermodell, Parabel-Rechteck (εcu = ${fmt(R.mat.c.ecu * 1000, 1)} ‰), εud = ${fmt(R.mat.s.eud * 1000, 0)} ‰`
    : `EN 1992-1-1, 6.1 / 3.1.7: Parabel-Rechteck (εcu2 = ${fmt(R.mat.c.ecu * 1000, 1)} ‰), εud = ${fmt(R.mat.s.eud * 1000, 0)} ‰`;
}

/** Nachweiszeilen eines Lastfalls für checksTable. */
export function caseChecks(R, c) {
  const rows = [];
  if (c.type === 'GZT') {
    const u = c.uls;
    const M = Math.hypot(c.My, c.Mz), MR = Math.hypot(u.MyR, u.MzR);
    if (u.outside || M < 0.01) {
      rows.push({ label: `${c.name} · Normalkraft`, ref: bendingRef(R), Ed: c.N, Rd: u.NR, unit: 'kN', eta: u.eta, digits: 0, detail: u.outside ? 'Normalkraft grösser als der zentrische Widerstand' : '', deriv: `gzt:${c.i}` });
    } else {
      rows.push({ label: `${c.name} · Biegung mit Normalkraft`, ref: bendingRef(R), Ed: M, Rd: MR, unit: 'kNm', eta: u.eta, digits: 1, detail: `bei N = ${fmt(c.N, 0)} kN${Math.abs(c.Mz) > 1e-6 && Math.abs(c.My) > 1e-6 ? ' (schiefe Biegung, Resultierende)' : ''}`, deriv: `gzt:${c.i}` });
    }
    if (c.shear) for (const ch of c.shear.checks) rows.push({ ...ch, label: `${c.name} · ${ch.label}`, digits: 0, deriv: `v:${c.i}` });
  } else if (c.sls) {
    if (c.sls.error) rows.push({ label: `${c.name} · Gebrauchszustand`, detail: c.sls.error, eta: Infinity, deriv: `gzg:${c.i}` });
    for (const ch of c.sls.checks) rows.push({ ...ch, label: `${c.name} · ${ch.label}`, deriv: `gzg:${c.i}` });
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
    el.append(emptyState('Noch keine Lastfälle', 'Im Register «Lasten» einen Lastfall mit N, My und Mz erfassen. Querschnittswerte und Interaktion sind bereits unten verfügbar.'));
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
    ['Dehnung im Bezugspunkt ε₀', (st.eRef ?? st.e0) * 1000, '‰', 3],
    ['Dehnungsgradient ∂ε/∂y', st.ky * 1000, '‰/m', 3],
    ['Dehnungsgradient ∂ε/∂z', st.kz * 1000, '‰/m', 3],
    ['Krümmung |κ|', Math.hypot(st.ky, st.kz) * 1000, '1/km', 3],
    ['Beton: min. Dehnung εc', st.ext.ecMin * 1000, '‰', 2],
    ['Beton: max. Dehnung (Zugrand)', st.ext.ecMax * 1000, '‰', 2],
    st.bars.length ? ['Stahl: max. Dehnung εs', st.ext.esMax * 1000, '‰', 2] : null,
    st.bars.length ? ['Stahl: min. Dehnung εs', st.ext.esMin * 1000, '‰', 2] : null,
    ['Druckzonenhöhe x', Number.isFinite(st.x) ? st.x / MM : 'voll überdrückt', Number.isFinite(st.x) ? 'mm' : '', 0],
    ['Betondruckspannung σc,min', st.sigmaCmin, 'MPa', 1],
    st.bars.length ? ['Stahlspannung σs,max', st.sigmaSmax, 'MPa', 0] : null,
    st.bars.length ? ['Stahlspannung σs,min', st.sigmaSmin, 'MPa', 0] : null,
    opts.withN ? ['Kontrolle N / My / Mz', `${fmt(st.N, 0)} / ${fmt(st.My, 1)} / ${fmt(st.Mz, 1)}`, 'kN, kNm'] : null,
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
  el.append(stats([['N', c.N, 'kN', 0], ['My', c.My, 'kNm', 1], ['Mz', c.Mz, 'kNm', 1], [c.shear ? 'max. Ausnutzung η (inkl. V)' : 'Ausnutzung η', Number.isFinite(eta) ? eta : '∞', '', 2]]));
  el.append(h('div', { style: { display: 'flex', gap: '6px', margin: '0 0 10px', flexWrap: 'wrap' } },
    button('Dehnungen zeigen', { small: true, icon: 'layers', onClick: () => app.setViewMode('dehnungen') }),
    button('Spannungen zeigen', { small: true, icon: 'grid', onClick: () => app.setViewMode('spannungen') })));
  if (c.type === 'GZT') {
    const u = c.uls;
    el.append(h('h4', { style: { margin: '6px 0 4px' } }, 'Widerstand (Bruchzustand)'));
    el.append(kvTable([
      ['Ausnutzung η = max(ηM, ηN)', u.eta, '', 3],
      u.outside ? null : ['ηM: Momente bei konstantem N', u.etaM, '', 3],
      ['ηN: N / NRd (zentrisch)', u.etaN, '', 3],
      u.outside ? ['Zentrischer Widerstand NRd', u.NR, 'kN', 0] : ['Widerstand MRd,y bei gleichem N', u.MyR, 'kNm', 1],
      u.outside ? null : ['Widerstand MRd,z bei gleichem N', u.MzR, 'kNm', 1],
      ['Versagensart', u.mode || '–', ''],
      u.rstate ? ['εc / εs,max im Bruchzustand', `${fmt(u.rstate.ext.ecMin * 1000, 2)} / ${fmt(u.rstate.ext.esMax * 1000, 2)}`, '‰'] : null,
      u.rstate && Number.isFinite(u.rstate.x) ? ['Druckzonenhöhe x im Bruchzustand', u.rstate.x / MM, 'mm', 0] : null,
    ]));
    el.append(h('div', { class: 'small muted', style: { margin: '4px 0 8px' } }, 'ηM: Momente bei konstanter Normalkraft radial bis zum Interaktionsrand gesteigert; ηN: Normalkraft im Verhältnis zum zentrischen Widerstand. Massgebend ist der grössere Wert.'));
    if (u.shifted) el.append(note('Der Bezugspunkt liegt bei dieser Normalkraft ausserhalb des My-Mz-Bereichs (stark exzentrischer Bezugspunkt). Die Momente werden deshalb vom Schwerpunkt des My-Mz-Bereichs aus gesteigert. Empfehlung: Bezugspunkt «Schwerpunkt Beton» wählen.', 'warn'));
    el.append(h('h4', { style: { margin: '6px 0 4px' } }, 'Dehnungszustand unter Bemessungslasten'));
    if (c.ulsState.ok) {
      if (c.ulsState.fail) el.append(note('Grenzdehnung überschritten – der Zustand liegt ausserhalb des zulässigen Bereichs.', 'fail'));
      el.append(kvTable(stateRows(c.ulsState)));
    } else el.append(note(c.ulsState.msg, 'fail'));
    if (c.shear) {
      const s = c.shear, g = R.shearGeo;
      el.append(h('h4', { style: { margin: '10px 0 4px' } }, 'Querkraft'));
      el.append(kvTable([
        ['Bemessungsquerkraft VEd', s.VEd, 'kN', 0],
        ['Stegbreite bw / statische Höhe d / Hebelarm z', `${fmt(g.bw, 0)} / ${fmt(g.d, 0)} / ${fmt(g.z, 0)}`, 'mm'],
        s.hasStirrups ? ['Bügelbewehrung asw', s.asw, 'mm²/m', 0] : ['Querkraftbewehrung', 'keine', ''],
        s.kd !== undefined ? ['kd = 1/(1 + εv·d·kg)', s.kd, '', 3] : null,
        s.VRds !== undefined ? ['VRd,s', s.VRds, 'kN', 0] : null,
        s.VRdc !== undefined ? [R.mat.norm === 'SIA' ? 'VRd,c (Betondruckfeld)' : 'VRd,c (ohne Querkraftbewehrung)', s.VRdc, 'kN', 0] : null,
        s.VRdmax !== undefined ? ['VRd,max', s.VRdmax, 'kN', 0] : null,
        ['Widerstand VRd', s.VRd, 'kN', 0],
      ]));
      for (const n of s.notes) el.append(note(n, 'warn'));
    }
  } else {
    const s = c.sls;
    el.append(h('h4', { style: { margin: '6px 0 4px' } }, 'Spannungsnachweis (gerissen, linear-elastisch)'));
    if (s.error) { el.append(note(s.error, 'fail')); return; }
    el.append(checksTable(s.checks, { edLabel: 'vorhanden', rdLabel: 'zulässig' }));
    el.append(kvTable([
      ['Wertigkeit n = Es/Ec,eff', R.mat.nSLS, '', 2],
      R.mat.norm === 'SIA' ? ['Stababstand s (Zuglage)', `${fmt(s.spacing, 0)}${s.spacingAuto ? ' (automatisch)' : ''}`, 'mm'] : null,
      ['σs,adm', s.lim.value, 'MPa', 0],
    ]));
    for (const n of s.notes) el.append(note(n, 'warn'));
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
    segmented([{ id: 'My', label: 'My (um y)' }, { id: 'Mz', label: 'Mz (um z)' }], axis, (id) => { ctx.ui.nmAxis = id; app.renderResults(); })));
  el.append(chartBox(nmChartOpts(R, axis, app.results.cases.length ? caseIndex(app) : -1)));
  el.append(h('div', { class: 'small muted', style: { margin: '-6px 0 10px' } },
    `Bruchzustand, Nulllinie ${axis === 'My' ? 'horizontal' : 'vertikal'}. Punkte: Lastfälle (● GZT, ■ GZG) mit ihrer ${axis}-Komponente. N < 0 Druck (oben).`));
  if (!R.cases.length) return;
  el.append(caseSelector(app));
  const c = R.cases[caseIndex(app)];
  const opts = mymzChartOpts(R, c);
  if (!opts) { el.append(note(`N = ${fmt(c.N, 0)} kN liegt ausserhalb des zentrischen Widerstands (${fmt(R.axial.Nc, 0)} … ${fmt(R.axial.Nt, 0)} kN) – kein My-Mz-Diagramm.`, 'fail')); return; }
  el.append(chartBox(opts));
  el.append(h('div', { class: 'small muted', style: { margin: '-6px 0 10px' } }, 'My-Mz-Interaktion bei der Normalkraft des Lastfalls; gestrichelt: Strahl bis zum Widerstand (η = Länge Einwirkung / Länge Widerstand).'));
}

export function nmChartOpts(R, axis, sel = -1, size = {}) {
  const curve = R.lazy.nm(axis);
  const pts = R.cases.map((c) => ({
    x: axis === 'My' ? c.My : c.Mz, y: c.N, shape: c.type === 'GZT' ? 'circle' : 'square',
    color: c.i === sel ? 'var(--c-highlight)' : c.type === 'GZT' ? 'var(--c-series-2)' : 'var(--c-series-4)',
    label: c.i === sel ? short(c.name) : '', title: `${c.name}: N = ${fmt(c.N, 0)} kN, ${axis} = ${fmt(axis === 'My' ? c.My : c.Mz, 1)} kNm`,
  }));
  return {
    series: [{ points: curve.map((p) => [p.M, p.N]), closed: true, fill: true, fillOpacity: 0.12, label: 'Widerstand', color: 'var(--c-series-1)' }],
    points: pts,
    xLabel: `${axis} [kNm] (${axis === 'My' ? '+ Zug unten' : '+ Zug rechts'})`, yLabel: 'N [kN]', invertY: true,
    title: `Interaktion N–${axis}`, ...size,
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
      { x: c.My, y: c.Mz, color: 'var(--c-highlight)', label: short(c.name), title: `Einwirkung: My = ${fmt(c.My, 1)}, Mz = ${fmt(c.Mz, 1)} kNm` },
      hasRay ? { x: u.MyR, y: u.MzR, shape: 'cross', color: 'var(--c-series-1)', title: `Widerstand: My = ${fmt(u.MyR, 1)}, Mz = ${fmt(u.MzR, 1)} kNm` } : null,
    ].filter(Boolean),
    xLabel: 'My [kNm] (+ Zug unten)', yLabel: 'Mz [kNm] (+ Zug rechts)', equal: true, title: `Interaktion My–Mz · ${short(c.name, 28)}`, ...size,
  };
}

// ------------------------------------------------------------------ M-κ

const MK_DIRS = [
  { value: 'auto', label: 'aus Lastfall' },
  { value: 'My+', label: 'My > 0 (Zug unten)' },
  { value: 'My-', label: 'My < 0 (Zug oben)' },
  { value: 'Mz+', label: 'Mz > 0 (Zug rechts)' },
  { value: 'Mz-', label: 'Mz < 0 (Zug links)' },
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
  if (laws !== 'mean') curves.push({ law: 'design', label: 'Bemessungswerte', color: 'var(--c-series-1)', dash: null, res: R.lazy.mk('design', N, theta) });
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
  el.append(h('div', { class: 'field wide' }, h('label', {}, 'Biegerichtung'), dirSel));
  el.append(h('div', { class: 'field wide', style: { marginBottom: '8px' } }, h('label', {}, 'Werkstoffgesetze'), lawSel));
  const setup = mkSetup(R, app, ctx);
  const errs = setup.curves.filter((cv) => cv.res.error);
  if (errs.length === setup.curves.length) { el.append(note(errs[0].res.error, 'fail')); return; }
  el.append(chartBox(mkChartOpts(setup)));
  const rows = [];
  for (const cv of setup.curves) {
    const r = cv.res;
    if (r.error) continue;
    const mu = r.yield && r.ultimate ? r.ultimate.kappa / r.yield.kappa : NaN;
    rows.push([cv.label,
      r.crack ? fmt(r.crack.M, 0) : '–', r.yield ? fmt(r.yield.M, 0) : '–', r.yield ? fmt(r.yield.kappa * 1000, 2) : '–',
      r.ultimate ? fmt(r.ultimate.M, 0) : '–', r.ultimate ? fmt(r.ultimate.kappa * 1000, 2) : '–', fmt(mu, 1),
      r.yield ? fmt(r.yield.M / r.yield.kappa / 1000, 1) : '–']);
  }
  el.append(resultTable([{ label: 'Gesetz' }, { label: 'Mcr', num: true }, { label: 'My', num: true }, { label: 'κy', num: true }, { label: 'Mu', num: true }, { label: 'κu', num: true }, { label: 'μκ', num: true }, { label: 'EIII', num: true }], rows));
  el.append(h('div', { class: 'small muted', style: { margin: '6px 0' } },
    `Momente in kNm, Krümmungen in 1/km, EIII = My/κy in MNm². μκ = κu/κy (Krümmungsduktilität). ${R.mat.phi > 0 ? `Kriechzahl φ = ${fmt(R.mat.phi, 1)} berücksichtigt (Dehnungen ×(1+φ)). ` : ''}Mittelwerte: fcm mit Zugfestigkeit fctm bis zum Riss, Stahl fsk mit Verfestigung bis ks·fsk (ohne Mitwirkung des Betons zwischen den Rissen).`));
}

// ------------------------------------------------------------------ Querschnittswerte

function propRows(R) {
  const g = R.gross, i = R.ideal;
  const mm2 = (x) => x * 1e6, mm4 = (x) => x * 1e12 / 1e6, mm3 = (x) => x * 1e9 / 1e3, mm = (x) => x * 1e3;
  const f = (x) => fmtSig(x, 4);
  return [
    ['Fläche A', f(mm2(g.A)), f(mm2(i.A)), 'mm²'],
    ['Schwerpunkt ys', fmt(mm(g.cy), 1), fmt(mm(i.cy), 1), 'mm'],
    ['Schwerpunkt zs', fmt(mm(g.cz), 1), fmt(mm(i.cz), 1), 'mm'],
    ['Iy (um y-Achse)', f(mm4(g.Iy)), f(mm4(i.Iy)), '10⁶ mm⁴'],
    ['Iz (um z-Achse)', f(mm4(g.Iz)), f(mm4(i.Iz)), '10⁶ mm⁴'],
    ['Iyz', f(mm4(g.Iyz)), f(mm4(i.Iyz)), '10⁶ mm⁴'],
    ['I1 (Hauptachse 1)', f(mm4(g.I1)), f(mm4(i.I1)), '10⁶ mm⁴'],
    ['I2 (Hauptachse 2)', f(mm4(g.I2)), f(mm4(i.I2)), '10⁶ mm⁴'],
    ['Winkel α der Achse 1', g.isotropic ? 'beliebig' : fmt(g.alpha * 180 / Math.PI, 2), i.isotropic ? 'beliebig' : fmt(i.alpha * 180 / Math.PI, 2), '°'],
    ['Wy oben', f(mm3(g.Wy_top)), f(mm3(i.Wy_top)), '10³ mm³'],
    ['Wy unten', f(mm3(g.Wy_bot)), f(mm3(i.Wy_bot)), '10³ mm³'],
    ['Wz rechts', f(mm3(g.Wz_right)), f(mm3(i.Wz_right)), '10³ mm³'],
    ['Wz links', f(mm3(g.Wz_left)), f(mm3(i.Wz_left)), '10³ mm³'],
  ];
}

function tabProps(el, app) {
  const R = app.results;
  el.append(stats([
    ['Bewehrung As', R.As * 1e6, 'mm²', 0],
    ['Bewehrungsgehalt ρ', R.rho * 100, '%', 2],
    ['NRd Druck', R.axial.Nc, 'kN', 0],
    ['NRd Zug', R.axial.Nt, 'kN', 0],
    ['MRd,y+ (N = 0)', R.mrd.MyPos, 'kNm', 1],
    ['MRd,y− (N = 0)', R.mrd.MyNeg, 'kNm', 1],
    ['MRd,z+ (N = 0)', R.mrd.MzPos, 'kNm', 1],
    ['MRd,z− (N = 0)', R.mrd.MzNeg, 'kNm', 1],
  ]));
  el.append(h('h4', { style: { margin: '6px 0 4px' } }, 'Querschnittswerte'));
  el.append(resultTable([{ label: 'Grösse' }, { label: 'Beton brutto', num: true }, { label: `ideell (n = ${fmt(R.mat.nShort, 2)})`, num: true }, { label: 'Einheit' }], propRows(R)));
  el.append(h('div', { class: 'small muted', style: { margin: '4px 0 10px' } }, 'Koordinaten bezogen auf den Ursprung der Eingabe. Ideell: ungerissen, Stäbe mit (n − 1)·As, n = Es/Ecm. Achse 1: grösstes Trägheitsmoment, Winkel α gegen die y-Achse.'));
  const { c, s } = R.mat;
  el.append(h('h4', { style: { margin: '6px 0 4px' } }, 'Baustoffe'));
  el.append(kvTable([
    [`Beton ${c.name} (${R.mat.norm})`, `fck = ${fmt(c.fck, 0)}`, 'MPa'],
    ['Bemessungswert fcd', c.fcd, 'MPa', 2],
    ['Zugfestigkeit fctm', c.fctm, 'MPa', 2],
    ['E-Modul Ecm', c.Ecm / 1000, 'GPa', 1],
    ['εc2 / εcu', `${fmt(c.ec2 * 1000, 2)} / ${fmt(c.ecu * 1000, 2)}`, '‰'],
    [`Betonstahl ${s.name}`, `fsk = ${fmt(s.fsk, 0)}`, 'MPa'],
    ['Bemessungswert fsd', s.fsd, 'MPa', 1],
    ['Es / εud', `${fmt(s.Es / 1000, 0)} GPa / ${fmt(s.eud * 1000, 1)} ‰`, ''],
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
    repP(`${shapeLabel}: ${params}.`),
    repFigure(app.snapshot('geometrie'), 'Querschnitt mit Bewehrung (Masse in mm), Schwerpunkt S und Haupt-/Schwerachsen'),
    repKV([
      ['Norm', R.mat.norm === 'SIA' ? 'SIA 262 (2013)' : 'EN 1992-1-1'],
      ['Beton', `${c.name}: fcd = ${fmt(c.fcd, 1)} MPa, fctm = ${fmt(c.fctm, 2)} MPa, Ecm = ${fmt(c.Ecm / 1000, 1)} GPa, εc2 = ${fmt(c.ec2 * 1000, 1)} ‰, εcu = ${fmt(c.ecu * 1000, 1)} ‰ (γc = ${fmt(c.gammaC, 2)})`],
      ['Betonstahl', `${s.name}: fsd = ${fmt(s.fsd, 1)} MPa, Es = ${fmt(s.Es / 1000, 0)} GPa, εud = ${fmt(s.eud * 1000, 1)} ‰ (γs = ${fmt(s.gammaS, 2)})${R.mat.hardening ? ', mit Verfestigung' : ''}`],
    ]),
  ] });

  const bars = (p.bars || []).map((b, i) => [i + 1, b.y, b.z, b.d, barAreaMm2(b.d)]);
  sections.push({ title: 'Bewehrung', content: [
    repTable([{ label: 'Nr.' }, { label: 'y [mm]', num: true, digits: 1 }, { label: 'z [mm]', num: true, digits: 1 }, { label: 'Ø [mm]', num: true, digits: 0 }, { label: 'As [mm²]', num: true, digits: 0 }], bars),
    repP(`Total ${bars.length} Stäbe, As = ${fmt(R.As * 1e6, 0)} mm², ρ = As/Ac = ${fmt(R.rho * 100, 2)} %.`),
  ] });

  sections.push({ title: 'Querschnittswerte', content: [
    repTable([{ label: 'Grösse' }, { label: 'Beton brutto', num: true }, { label: `ideell (n = ${fmt(R.mat.nShort, 2)})`, num: true }, { label: 'Einheit' }], propRows(R)),
    repP(`Zentrischer Widerstand: NRd = ${fmt(R.axial.Nc, 0)} kN (Druck) bzw. ${fmt(R.axial.Nt, 0)} kN (Zug). Biegewiderstand bei N = 0: MRd,y = +${fmt(R.mrd.MyPos, 1)} / ${fmt(R.mrd.MyNeg, 1)} kNm, MRd,z = +${fmt(R.mrd.MzPos, 1)} / ${fmt(R.mrd.MzNeg, 1)} kNm.`),
  ] });

  sections.push({ title: 'Schnittgrössen', content: [
    repP(`Vorzeichen: N > 0 Zug; My > 0 erzeugt Zug unten (z < 0), Mz > 0 Zug rechts (y > 0). Bezugspunkt: ${REF_POINTS.find((r) => r.value === R.refMode)?.label} (y = ${fmt(R.ref[0] / MM, 1)} mm, z = ${fmt(R.ref[1] / MM, 1)} mm).`),
    repTable([{ label: 'Lastfall' }, { label: 'Typ' }, { label: 'N [kN]', num: true, digits: 1 }, { label: 'My [kNm]', num: true, digits: 1 }, { label: 'Mz [kNm]', num: true, digits: 1 }, p.shear?.active ? { label: 'Vd [kN]', num: true, digits: 1 } : null].filter(Boolean),
      R.cases.map((x) => [x.name, x.type, x.N, x.My, x.Mz, ...(p.shear?.active ? [x.V] : [])])),
  ] });

  if (R.ulsCases.length) {
    sections.push({ title: 'Tragsicherheit (GZT): Biegung mit Normalkraft', content: [
      repP(`Nachweis mit dem Fasermodell: Ebenbleiben der Querschnitte, Beton ohne Zugfestigkeit, Parabel-Rechteck-Diagramm (${R.mat.norm === 'SIA' ? 'SIA 262, 4.2.1.2' : 'EN 1992-1-1, 3.1.7'}), Betonstahl bilinear (${R.mat.norm === 'SIA' ? 'SIA 262, 4.2.2.2' : 'EN 1992-1-1, 3.2.7'}). Bruchdehnungsebenen nach der Pivot-Methode; die Ausnutzung η ergibt sich durch radiale Steigerung der Momente bei konstanter Normalkraft bis zum Interaktionsrand.`),
      repFormula('ηM = √(MEd,y² + MEd,z²) / √(MRd,y² + MRd,z²)   (bei gleichem N und gleicher Momentenrichtung)\nηN = NEd / NRd   (zentrischer Widerstand)       η = max(ηM, ηN)'),
      repTable([{ label: 'Lastfall' }, { label: 'N [kN]', num: true, digits: 0 }, { label: 'My/Mz [kNm]' }, { label: 'MRd,y/MRd,z [kNm]' }, { label: 'εc/εs [‰]' }, { label: 'Versagensart' }, { label: 'η', num: true, digits: 2 }, { label: 'Status' }],
        R.ulsCases.map((x) => [x.name, x.N, `${fmt(x.My, 1)} / ${fmt(x.Mz, 1)}`, x.uls.outside ? `NRd = ${fmt(x.uls.NR, 0)} kN` : `${fmt(x.uls.MyR, 1)} / ${fmt(x.uls.MzR, 1)}`,
          x.ulsState.ok ? `${fmt(x.ulsState.ext.ecMin * 1000, 2)} / ${fmt(x.ulsState.ext.esMax * 1000, 2)}` : '–', x.uls.mode, x.uls.eta, ok(x.uls.eta) ? 'erfüllt' : 'nicht erfüllt'])),
    ] });
  }

  if (R.slsCases.length) {
    const reqLabel = SLS_REQUIREMENTS.find((r) => r.value === (p.sls?.req || 'normal'))?.label;
    sections.push({ title: 'Gebrauchstauglichkeit (GZG): Spannungen im gerissenen Zustand', content: [
      repP(`Linear-elastische Berechnung im gerissenen Zustand (Beton ohne Zugfestigkeit, Ec,eff = Es/n mit n = ${fmt(R.mat.nSLS, 2)}). ${R.mat.norm === 'SIA'
        ? `Anforderung an die Rissbreitenbegrenzung: ${reqLabel} (SIA 262, 4.4.2). Zulässige Stahlspannung σs,adm in Abhängigkeit des Stababstands s nach einer Näherung der Kurven von Fig. 31 (gerundete Ablesewerte, stückweise linear: erhöht ${SIA_FIG31.erhoeht.map(([a, b]) => `${a}→${b}`).join(', ')}; hoch ${SIA_FIG31.hoch.map(([a, b]) => `${a}→${b}`).join(', ')} [mm → MPa]). Die Werte sind mit der Norm zu vergleichen.`
        : 'Spannungsbegrenzung nach EN 1992-1-1, 7.2: σs ≤ 0.8·fyk (charakteristische Kombination), |σc| ≤ 0.6·fck.'}`),
      repTable([{ label: 'Lastfall' }, { label: 'N [kN]', num: true, digits: 0 }, { label: 'My/Mz [kNm]' }, { label: 'x [mm]', num: true, digits: 0 }, { label: 'σc [MPa]', num: true, digits: 1 }, { label: 'σs [MPa]', num: true, digits: 0 }, { label: 'σs,adm [MPa]', num: true, digits: 0 }, { label: 'η', num: true, digits: 2 }, { label: 'Status' }],
        R.slsCases.map((x) => x.sls.error ? [x.name, x.N, `${fmt(x.My, 1)} / ${fmt(x.Mz, 1)}`, '–', '–', '–', '–', '–', x.sls.error]
          : [x.name, x.N, `${fmt(x.My, 1)} / ${fmt(x.Mz, 1)}`, Number.isFinite(x.slsState.x) ? x.slsState.x / MM : '∞', x.slsState.sigmaCmin, x.sls.sigS, x.sls.lim.value, x.sls.eta, ok(x.sls.eta) ? 'erfüllt' : 'nicht erfüllt'])),
    ] });
  }

  if (p.shear?.active && R.ulsCases.length) {
    const g = R.shearGeo, sh = p.shear;
    sections.push({ title: 'Querkraft', content: [
      repP(R.mat.norm === 'SIA'
        ? 'SIA 262, 4.3.3: mit Querkraftbewehrung VRd,s = (Asw/s)·z·fsd·cot α (4.3.3.4.3) und Betondruckfeld VRd,c = bw·z·kc·fcd·sin α·cos α mit kc = 0.55 (4.3.3.4.6); ohne Querkraftbewehrung VRd = kd·τcd·d·bw mit kd = 1/(1 + εv·d·kg), kg = 48/(16 + Dmax) (4.3.3.2, vereinfacht).'
        : 'EN 1992-1-1, 6.2: ohne Querkraftbewehrung VRd,c nach (6.2a/b); mit Querkraftbewehrung VRd,s = (Asw/s)·z·fywd·cot θ (6.8) und VRd,max = αcw·bw·z·ν1·fcd/(cot θ + tan θ) (6.9).'),
      repKV([
        ['bw / d / z', `${fmt(g.bw, 0)} / ${fmt(g.d, 0)} / ${fmt(g.z, 0)} mm`],
        ['Bügel', sh.dw > 0 && sh.s > 0 ? `${sh.legs}-schnittig Ø${sh.dw} s = ${fmt(sh.s, 0)} mm, ${R.mat.norm === 'SIA' ? 'α' : 'θ'} = ${fmt(sh.angle, 1)}°` : 'keine Querkraftbewehrung'],
      ]),
      repTable([{ label: 'Lastfall' }, { label: 'VEd [kN]', num: true, digits: 0 }, { label: 'Nachweise' }, { label: 'VRd [kN]', num: true, digits: 0 }, { label: 'η', num: true, digits: 2 }, { label: 'Status' }],
        R.ulsCases.filter((x) => x.shear).map((x) => [x.name, x.shear.VEd, x.shear.checks.map((ch) => `${ch.label}: ${fmt(ch.Rd, 0)} kN`).join('; '), x.shear.VRd, x.shear.eta, ok(x.shear.eta) ? 'erfüllt' : 'nicht erfüllt'])),
    ] });
  }

  // Diagramme
  const charts = [];
  const sel = R.cases.length ? caseIndex(app) : -1;
  const size = { width: 520, height: 340 };
  charts.push(repFigure(xyChart({ ...nmChartOpts(R, 'My', sel, size), crosshair: false }), 'Interaktionsdiagramm N–My (Bruchzustand) mit Lastfällen'));
  if (R.gross.b > 0 && Math.abs(R.mrd.MzPos) > 0) charts.push(repFigure(xyChart({ ...nmChartOpts(R, 'Mz', sel, size), crosshair: false }), 'Interaktionsdiagramm N–Mz (Bruchzustand)'));
  if (sel >= 0) {
    const c = R.cases[sel];
    const o = mymzChartOpts(R, c, { width: 460, height: 400 });
    if (o) charts.push(repFigure(xyChart({ ...o, crosshair: false }), `My–Mz-Interaktion bei N = ${fmt(c.N, 0)} kN (Lastfall «${c.name}»)`));
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
      h('li', {}, 'Querkraftnachweis vereinfacht mit konstanten bw, d und z; Mindestbewehrung und konstruktive Regeln sind separat zu prüfen.'),
      h('li', {}, R.mat.norm === 'SIA' ? 'Zulässige Stahlspannungen nach Fig. 31 genähert – mit der Norm zu vergleichen.' : 'Spannungsgrenzen nach EN 1992-1-1, 7.2 mit empfohlenen Werten k1 = 0.6, k3 = 0.8.'),
    ),
  ] });
  return sections;
}
