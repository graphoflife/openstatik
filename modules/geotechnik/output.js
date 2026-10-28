// Ergebnisdarstellung und Bericht Geotechnik
import { h, group, stats, checksTable, summaryCard, resultTable, note, kvTable, fmt } from '../../js/core/ui.js';
import { chartBox, xyChart } from '../../js/core/chart.js';
import { repTable, repKV, repFigure, repFormula, repP } from '../../js/core/report.js';
import { ANALYSES } from './calc.js';
import { VIEW_MODES } from './draw.js';

const KIND = { active: 'aktiver Erddruck', increased: 'erhöhter aktiver Erddruck', atrest: 'Erdruhedruck', passive: 'Erdwiderstand (passiv)' };
const DRAIN = { drained: 'drainiert', undrained: 'undrainiert', both: 'drainiert und undrainiert' };

const HINTS = {
  bearing: 'Fundament verbreitern, tiefer gründen oder die Lasten reduzieren.',
  sliding: 'Sporn anordnen, Sohle verbreitern, Sohlreibung erhöhen (Ortbeton) oder Horizontallast reduzieren.',
  eccPerm: 'Fundament so vergrössern bzw. verschieben, dass die Resultierende der ständigen Lasten im Kern liegt.',
  eccDesign: 'Klaffende Fuge zu gross: Fundament verbreitern (z.B. Zehe verlängern) oder Momente reduzieren.',
  slope: 'Böschung abflachen, entwässern (Wasserspiegel senken), Fussauflast schütten oder stützen.',
  settle: 'Fundament vergrössern, Last reduzieren, tiefer gründen oder den Baugrund verbessern.',
};

/** Klare Aussage: erfüllt / nicht erfüllt mit Handlungsempfehlung. */
function verdict(items) {
  const failed = items.filter((c) => !(Number.isFinite(c.eta) && c.eta <= 1.0001));
  if (!failed.length) return note('Alle Nachweise sind erfüllt.', 'ok');
  return h('div', { class: 'note fail' },
    h('b', {}, failed.length === 1 ? 'Ein Nachweis ist nicht erfüllt:' : `${failed.length} Nachweise sind nicht erfüllt:`),
    h('ul', { style: { margin: '4px 0 0', paddingLeft: '18px' } }, failed.map((c) => h('li', {}, h('b', {}, c.label), c.hint ? ` – ${c.hint}` : ''))));
}

function infoCard(label, big, sub) {
  return h('div', { class: 'summary-card' }, h('div', { class: 'label' }, label), h('div', { class: 'big' }, big), sub ? h('div', { class: 'muted small', style: { marginTop: '2px' } }, sub) : null);
}

const unitF = (strip) => (strip ? 'kN/m' : 'kN');
const warnNotes = (list) => (list || []).filter(Boolean).map((w) => note(w, 'warn'));

// ------------------------------------------------------------------ Ergebnisbereich

export function renderResults(el, app) {
  const r = app.results;
  if (!r) return;
  if (r.type !== app.project.analysis) { el.append(note('Berechnung läuft …')); return; }
  const fn = { erddruck: resEP, grundbruch: resBC, setzung: resST, boeschung: resSL, stuetzmauer: resRW }[r.type];
  fn(el, r, app.project, app);
}

// ---------------------------------------------------------------- Erddruck
function resEP(el, r, p) {
  const R = r.ep;
  const passive = R.passive;
  const sym = passive ? 'E_ph' : 'E_ah';
  el.append(infoCard(KIND[R.kind] || 'Erddruck', `${sym} = ${fmt(R.Eh, 1)} kN/m`, `Angriffspunkt ${fmt(R.hE, 2)} m über dem Wandfuss · ${passive ? 'Bemessungswert E_ph,d = E_ph/γ_R,e' : 'Bemessungswert E_d'} = ${fmt(R.Ed, 1)} kN/m`));
  el.append(stats([
    [`${sym},k (horizontal)`, R.Eh, 'kN/m', 1],
    [passive ? 'E_pv,k (nach oben)' : 'E_av,k (vertikal)', R.Ev, 'kN/m', 1],
    ['Angriff über Fuss', R.hE, 'm', 2],
    R.U > 0 ? ['Wasserdruck W', R.U, 'kN/m', 1] : null,
    ['Moment am Fuss M_k', R.Mbase, 'kNm/m', 1],
    ['Moment am Fuss M_d', R.Mbased, 'kNm/m', 1],
    R.zCrack > 1e-6 ? ['Tiefe Zugzone', R.zCrack, 'm', 2] : null,
  ]));
  el.append(...warnNotes(R.warnings));
  el.append(group('Erddruckverteilung', [chartBox(epChartOpts(R))], { info: 'Horizontalkomponente des Erddrucks über die Tiefe ab Wandkopf. Gestapelt: Erddruck aus Bodeneigengewicht (G), aus Auflasten (Q) und der Wasserdruck.' }));
  el.append(group('Erddruckbeiwerte je Schicht', [resultTable(
    ['Schicht', { label: "φ'", num: true, digits: 1 }, { label: passive ? 'δ_p' : 'δ', num: true, digits: 1 }, { label: 'K_h', num: true, digits: 3 }, { label: 'K_ch', num: true, digits: 3 }, { label: 'K_0', num: true, digits: 3 }, { label: 'ϑ_a', num: true, digits: 1 }],
    R.layers.map((L) => [L.name, L.phi, passive ? L.deltaP : L.delta, L.Kgh, L.Kch, L.K0 ?? '–', L.theta ?? '–']))],
  { info: 'K_h: Beiwert für die Horizontalkomponente aus Bodeneigengewicht (e = K_h·σ\'_v), K_ch: Kohäsionsbeiwert, K_0: Erdruhedruckbeiwert, ϑ_a: Neigung der Gleitfuge gegen die Horizontale.' }));
  const cmp = R.cmp;
  el.append(group('Vergleich der Erddruckarten', [resultTable(['Erddruckart', { label: 'E_h [kN/m]', num: true, digits: 1 }, { label: 'Angriff [m]', num: true, digits: 2 }],
    [['aktiv', cmp.active?.Eh ?? '–', cmp.active?.hE ?? '–'], ['Ruhedruck', cmp.atrest?.Eh ?? '–', cmp.atrest?.hE ?? '–'], ['Erdwiderstand (ohne Auflast)', cmp.passive?.Eh ?? '–', cmp.passive?.hE ?? '–']])],
  { collapsible: true, info: 'Gleiche Geometrie und Bodenwerte, nur die Erddruckart wechselt. Der Erdwiderstand ist ein Widerstand (Bemessung mit γ_R,e).' }));
  if (R.strips.length) {
    el.append(group('Streifen- und Linienlasten', [resultTable(['Last', { label: 'ΔE_h [kN/m]', num: true, digits: 1 }, { label: 'z₁ [m]', num: true, digits: 2 }, { label: 'z₂ [m]', num: true, digits: 2 }],
      R.strips.map((s) => [`${s.type === 'line' ? 'Linie' : 'Streifen'} p=${fmt(+s.p, 1)}, a=${fmt(+s.a, 2)}${s.type === 'line' ? '' : `, b=${fmt(+s.b, 2)}`}${s.note ? ` (${s.note})` : ''}`, s.dE, s.z1, s.z2]))],
    { collapsible: true, info: 'Zusatzerddruck aus dem Coulomb-Krafteck mit unveränderter Gleitfuge ϑ_a; Verteilung zwischen z₁ = a·tan φ und z₂ = (a+b)·tan ϑ_a (Streifen: Rechteck, Linie: Dreieck).' }));
  }
  el.append(group('Werte an Schichtgrenzen', [resultTable(
    [{ label: 'z [m]', num: true, digits: 2 }, { label: "σ'_v [kN/m²]", num: true, digits: 1 }, { label: 'e_h [kN/m²]', num: true, digits: 1 }, { label: 'u [kN/m²]', num: true, digits: 1 }],
    edgeRows(R).map((q) => [q.z, q.svp, q.eh, q.u]))], { collapsible: true, collapsed: true }));
}

function edgeRows(R) {
  const pts = R.pts, out = [];
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i];
    const edge = i === 0 || i === pts.length - 1 || Math.abs(pts[i - 1].z - q.z) < 1e-9 || (i + 1 < pts.length && Math.abs(pts[i + 1].z - q.z) < 1e-9);
    if (edge) out.push(q);
  }
  return out;
}

function epChartOpts(R) {
  const z = (q) => q.z - R.zTop;
  const series = [{ points: R.pts.map((q) => [q.eh, z(q)]), label: 'e_h Erddruck', color: 'var(--c-load)', fill: true, area: 'x' }];
  if (R.pts.some((q) => q.ehQ > 1e-9)) series.push({ points: R.pts.map((q) => [q.ehG, z(q)]), label: 'Anteil G', color: 'var(--c-load)', dash: '4 3', width: 1.2 });
  if (R.pts.some((q) => q.u > 1e-9)) series.push({ points: R.pts.map((q) => [q.u, z(q)]), label: 'Wasser u', color: 'var(--c-water)', fill: true, area: 'x' });
  return { series, invertY: true, xLabel: 'Druck [kN/m²]', yLabel: 'Tiefe z [m]', height: 300, hLines: [{ v: R.zE - R.zTop, label: `Resultierende ${fmt(R.Eh, 1)} kN/m`, color: 'var(--c-neg)' }] };
}

// ---------------------------------------------------------------- Grundbruch
function bcChecks(R) {
  const strip = R.shape === 'strip';
  const g = R.gov;
  const list = [];
  list.push({
    id: 'bearing', label: 'Grundbruch', hint: HINTS.bearing, deriv: 'bc-R',
    ref: `EN 1997-1, 6.5.2 / Anh. D · SIA 267 · ${g.gov ? (g.gov.drained ? 'drainiert' : 'undrainiert') : ''}`,
    Ed: g.ld?.V, Rd: g.Rd, unit: unitF(strip), eta: g.eta,
    detail: g.error ? g.error : `V_d ≤ R_d = R_k/γ_R,v; Kombination γ_G = ${fmt(g.ld.gG, 2)}, γ_Q = ${fmt(g.ld.gQ, 2)}`,
  });
  const s = R.govS;
  list.push({ id: 'sliding', label: 'Gleiten', hint: HINTS.sliding, deriv: 'bc-slide', ref: 'EN 1997-1, 6.5.3 · SIA 267', Ed: s.Hd, Rd: s.Rd, unit: unitF(strip), eta: s.eta, detail: `${s.type}: R_h,d = ${s.type === 'drainiert' ? `γ_G,inf·V_G·tan δ` : "A'·c_u"} / γ_R,h, δ = ${fmt(R.slDelta, 1)}°` });
  const ep = R.eccPerm, ed = R.eccDesign;
  const rectEcc = R.shape === 'rect';
  list.push({ id: 'eccPerm', label: 'Ausmittigkeit ständig (Kern)', hint: HINTS.eccPerm, deriv: 'bc-ecc', ref: rectEcc ? 'e_B/B + e_L/L ≤ 1/6 (keine klaffende Fuge)' : R.shape === 'circle' ? 'e ≤ r/4 (keine klaffende Fuge)' : 'e ≤ B/6 (keine klaffende Fuge)', Ed: rectEcc ? ep.kern / 6 : ep.e, Rd: rectEcc ? 1 / 6 : ep.limKern, unit: rectEcc ? '' : 'm', digits: 3, eta: ep.kern });
  if (ed) list.push({ id: 'eccDesign', label: 'Ausmittigkeit Bemessung', hint: HINTS.eccDesign, deriv: 'bc-ecc', ref: rectEcc ? '(e_B/B)² + (e_L/L)² ≤ 1/9 · EN 1997-1, 6.5.4' : R.shape === 'circle' ? 'e ≤ 0.59·r (Fuge klafft höchstens bis Schwerpunkt) · EN 1997-1, 6.5.4' : 'e ≤ B/3 (Fuge klafft höchstens bis Schwerpunkt) · EN 1997-1, 6.5.4', Ed: rectEcc ? (ed.gap / 3) ** 2 : ed.e, Rd: rectEcc ? 1 / 9 : ed.limGap, unit: rectEcc ? '' : 'm', digits: 3, eta: ed.gap });
  return list;
}

function resBC(el, r, p) {
  const R = r.bc, g = R.gov, strip = R.shape === 'strip';
  const checks = bcChecks(R);
  el.append(summaryCard(R.etaMax, 'Maximale Ausnutzung', verdict(checks)));
  if (!g.error) {
    el.append(stats([
      ['Grundbruchwiderstand R_d', g.Rd, unitF(strip), 0],
      ['Bemessungslast V_d', g.ld.V, unitF(strip), 0],
      strip ? ["wirksame Breite B'", g.eff.Bp, 'm', 2] : ["wirksame Fläche A'", g.eff.A, 'm²', 2],
      ["Sohlspannung σ_d = V_d/A'", g.sigma, 'kN/m²', 0],
      ["Widerstand R_d/A'", g.Rd / g.eff.A, 'kN/m²', 0],
      R.charRes ? ['Globale Sicherheit R_k/V_k', R.charRes.F, '', 2] : null,
    ]));
  }
  el.append(group('Nachweise', [checksTable(checks)], { info: 'Bemessungswert der Einwirkung E_d (Ed) gegenüber dem Bemessungswert des Widerstands R_d (Rd). Erfüllt, wenn die Ausnutzung η = E_d/R_d ≤ 1.0.' }));
  if (g.soil?.phiSpread > 5) el.append(note(`Die Reibungswinkel im Einflussbereich unterscheiden sich um ${fmt(g.soil.phiSpread, 1)}° (> 5°): Die Mittelung ist nur eine Näherung. Massgebende Schicht separat prüfen (z.B. Durchstanzen einer weichen Schicht).`, 'warn'));
  if (!g.error) {
    const G = g.gov;
    el.append(group(`Beiwerte (${G.drained ? 'drainiert' : 'undrainiert'}, massgebend)`, [
      resultTable(['Term', { label: 'N', num: true, digits: 2 }, { label: 'b', num: true, digits: 3 }, { label: 's', num: true, digits: 3 }, { label: 'i', num: true, digits: 3 }, { label: 'Anteil [kN/m²]', num: true, digits: 1 }],
        G.drained
          ? [['Kohäsion c\'', G.N.Nc, G.b.c, G.s.c, G.i.c, G.terms.c], ["Überlagerung q'", G.N.Nq, G.b.q, G.s.q, G.i.q, G.terms.q], ["Eigengewicht γ'", G.N.Ng, G.b.g, G.s.g, G.i.g, G.terms.g]]
          : [['Scherfestigkeit c_u', G.N.Nc, G.b.c, G.s.c, G.i.c, G.terms.c], ['Überlagerung q', 1, 1, 1, 1, G.terms.q]]),
      kvTable([
        ["Boden unter Sohle (gemittelt bis 2B')", g.soil.layers.map((l) => l.name).join(', ')],
        G.drained ? ["φ' (Rechenwert)", g.soil.phi, '°', 1] : ['c_u (Rechenwert)', g.soil.cu, 'kN/m²', 1],
        G.drained ? ["c' (Rechenwert)", g.soil.c, 'kN/m²', 1] : null,
        ["γ' unter der Sohle", g.soil.gammaEff, 'kN/m³', 1],
        [G.drained ? "q' = σ'_v in Sohltiefe" : 'q = σ_v in Sohltiefe', G.drained ? g.soil.qEff : g.soil.qTot, 'kN/m²', 1],
        ["B' / L'", strip ? `${fmt(g.eff.Bp, 3)} / –` : `${fmt(g.eff.Bp, 3)} / ${fmt(g.eff.Lp, 3)}`, 'm'],
        G.m ? ['Exponent m', G.m, '', 3] : null,
        ['R_k (Bemessungslast-Geometrie)', g.R, unitF(strip), 0],
      ]),
    ], { collapsible: true, info: 'N: Tragfähigkeitsbeiwerte, b: Sohlneigung, s: Form, i: Lastneigung (EN 1997-1, Anhang D).' }));
  }
  el.append(group('Lastkombinationen', [resultTable(
    [{ label: 'γ_G', num: true, digits: 2 }, { label: 'γ_Q', num: true, digits: 2 }, { label: 'V_d', num: true, digits: 0 }, { label: 'H_d', num: true, digits: 0 }, { label: 'e_B [m]', num: true, digits: 3 }, { label: "B' [m]", num: true, digits: 2 }, { label: 'R_d', num: true, digits: 0 }, { label: 'η', num: true, digits: 2 }],
    R.bearing.map((b) => [b.combo.gG, b.combo.gQ, b.combo.V, Math.hypot(b.combo.HB, b.combo.HL), b.error ? '–' : b.eB, b.error ? '–' : b.eff.Bp, b.error ? '–' : b.Rd, b.error ? 'Fehler' : b.eta]),
    { rowClass: (row, i) => (R.bearing[i] === R.gov ? 'sum' : '') })], { collapsible: true, info: 'Alle Kombinationen ständig ungünstig/günstig × veränderlich mit/ohne. Massgebend ist die fett markierte Zeile.' }));
  if (R.curve.length > 2) {
    el.append(group('Widerstand in Abhängigkeit der Breite', [chartBox({
      series: [{ points: R.curve.map(([b, rd]) => [b, rd]), label: 'R_d', color: 'var(--c-pos)', fill: true }, { points: R.curve.map(([b, , vd]) => [b, vd]), label: 'V_d', color: 'var(--c-load)', dash: '5 3' }],
      points: [{ x: R.B, y: g.Rd, label: 'aktuell', color: 'var(--accent)' }],
      xLabel: 'Fundamentbreite B [m]', yLabel: `[${unitF(strip)}]`, height: 240,
    })], { collapsible: true, info: 'Grundriss affin skaliert (Eigengewicht angepasst). Wo R_d über V_d liegt, ist der Grundbruchnachweis erfüllt.' }));
  }
  if (R.Wf + R.Ws > 0) el.append(note(`Eigengewicht berücksichtigt: Fundament ${fmt(R.Wf, 1)} ${unitF(strip)}, Hinterfüllung ${fmt(R.Ws, 1)} ${unitF(strip)} (in V_G enthalten).`));
}

// ---------------------------------------------------------------- Setzung
function resST(el, r, p) {
  const R = r.st;
  const sAllow = Number(p.st.sAllow) || 0;
  const eta = sAllow > 0 ? R.sRef / sAllow : NaN;
  const refLabel = R.refKey === 'char' ? 'kennzeichnender Punkt (starres Fundament)' : 'Fundamentmitte (schlaffes Fundament)';
  const checks = sAllow > 0 ? [{ id: 'settle', label: 'Setzung', hint: HINTS.settle, deriv: 'st-s', ref: `s ≤ s_zul (Gebrauchstauglichkeit, SIA 267 / EN 1997-1, 6.6) · ${refLabel}`, Ed: R.sRef, Rd: sAllow, unit: 'mm', eta }] : [];
  if (sAllow > 0) el.append(summaryCard(eta, 'Setzung / zulässige Setzung', h('div', {}, h('div', { class: 'big', style: { fontSize: '16px', margin: '2px 0' } }, `s = ${fmt(R.sRef, 1)} mm`), verdict(checks))));
  else el.append(infoCard('Setzung', `s = ${fmt(R.sRef, 1)} mm`, refLabel));
  el.append(stats([
    ['Setzung Mitte', R.sCentre, 'mm', 1],
    ['Setzung kennz. Punkt', R.sChar, 'mm', 1],
    [R.shape === 'rect' ? 'Setzung Ecke' : 'Setzung Rand', R.sEdge, 'mm', 1],
    ['Grenztiefe z_gr', R.zLim, 'm', 2],
    ['Sohlspannung σ₀', R.p0, 'kN/m²', 1],
    ['Netto-Sohlspannung', R.pNet, 'kN/m²', 1],
  ]));
  el.append(...warnNotes(R.warnings));
  if (checks.length) el.append(group('Nachweis', [checksTable(checks)]));
  el.append(group('Spannungen über die Tiefe', [chartBox({
    series: [
      { points: R.profile.map((q) => [q.svp, q.z]), label: "σ'_v0", color: 'var(--c-soil)' },
      { points: R.profile.map((q) => [q.lim, q.z]), label: `${fmt(R.f, 2)}·σ'_v0`, color: 'var(--c-soil)', dash: '5 3' },
      { points: R.profile.map((q) => [q.centre, q.z]), label: 'Δσ Mitte', color: 'var(--c-pos)', fill: true, area: 'x' },
      { points: R.profile.map((q) => [q.char, q.z]), label: 'Δσ kennz. P.', color: 'var(--c-series-2)' },
    ],
    hLines: [{ v: R.zLim, label: `z_gr = ${fmt(R.zLim, 2)} m`, color: 'var(--c-neg)' }],
    invertY: true, xLabel: 'Spannung [kN/m²]', yLabel: 'Tiefe z [m]', height: 300,
  })], { info: 'Spannungszuwachs Δσ aus der Netto-Sohlspannung (Steinbrenner / Boussinesq) und Überlagerungsspannung σ\'_v0. Die Grenztiefe liegt dort, wo Δσ = f·σ\'_v0.' }));
  if (R.trough.length) {
    el.append(group('Setzungsmulde (Querschnitt durch die Mitte)', [chartBox({
      series: [{ points: R.trough.map(([x, s]) => [x, s]), label: 's(x)', color: 'var(--c-deform)', fill: true }],
      vLines: [{ v: -R.B / 2, label: 'Rand' }, { v: R.B / 2 }],
      invertY: true, xLabel: 'x [m]', yLabel: 'Setzung [mm]', height: 220,
    })], { collapsible: true }));
  }
  el.append(group('Setzungsanteile je Schicht', [resultTable(
    ['Schicht', { label: 'von [m]', num: true, digits: 2 }, { label: 'bis [m]', num: true, digits: 2 }, { label: 'M_E [MN/m²]', num: true, digits: 1 }, { label: 'Δσ_m [kN/m²]', num: true, digits: 1 }, { label: 's [mm]', num: true, digits: 1 }],
    [...R.layers.map((l) => [l.name, l.from, l.to, l.ME, l.dsigAvg, l.ds[R.refKey]]), ['Summe', '', '', '', '', R.sRef]],
    { rowClass: (row, i) => (i === R.layers.length ? 'sum' : '') })], { info: 's_i = Σ Δσ·Δz / M_E für den gewählten Bezugspunkt.' }));
}

// ---------------------------------------------------------------- Böschung
function resSL(el, r, p, app) {
  const R = r.sl, n = r.norm;
  const best = R.design.best || R.char.best;
  const checks = [{ id: 'slope', label: 'Gesamtstabilität', hint: HINTS.slope, deriv: 'sl-check', ref: `F_d ≥ γ_R · SIA 267 / EN 1997-1, 11.5.1 · Bishop`, Ed: n.gRs, Rd: R.Fd, unit: '', digits: 3, eta: R.eta }];
  el.append(summaryCard(R.eta, 'Gesamtstabilität (Böschungsbruch)', h('div', {}, h('div', { class: 'small', style: { margin: '2px 0 6px' } }, `F = ${fmt(R.F, 3)} (charakteristisch) · F_d = ${fmt(R.Fd, 3)} (Bemessung, Anforderung F_d ≥ ${fmt(n.gRs, 2)})`), verdict(checks))));
  el.append(stats([
    ['F Bishop (charakt.)', R.F, '', 3],
    ['F Fellenius (charakt.)', R.FF, '', 3],
    ['F_d Bishop (Bemessung)', R.Fd, '', 3],
    ['Radius R', best.R, 'm', 2],
    ['Mittelpunkt x / y', `${fmt(R.M.tx(best.xc), 2)} / ${fmt(best.yc, 2)}`, 'm'],
    ['Untersuchte Kreise', `${R.circles} (${R.ms} ms)`, ''],
  ]));
  el.append(group('Nachweis', [checksTable(checks, { edLabel: 'erforderlich', rdLabel: 'vorhanden' })], { info: 'Die Bemessungswerte der Scherparameter (tan φ\'/γ_φ, c\'/γ_c, c_u/γ_cu) und der veränderlichen Lasten (γ_Q) gehen direkt in die Gleitkreisberechnung ein. Erfüllt, wenn F_d ≥ γ_R.' }));
  if (best.clipped) el.append(note(`Bei ${best.clipped} Lamelle(n) war m_α < 0.2 (steile Basis am Kreisaustritt); m_α wurde auf 0.2 begrenzt.`, 'warn'));
  if (R.ms > 400) el.append(note('Die Suche dauert relativ lange. Im Register «Böschung» das Suchraster gröber wählen (weniger Mittelpunkte oder Radien).', 'warn'));
  const S = best.slices || [];
  if (S.length) {
    el.append(group(`Lamellen des massgebenden Kreises (${R.design.best ? 'Bemessung' : 'charakteristisch'})`, [resultTable(
      [{ label: 'Nr', num: true, digits: 0 }, { label: 'x [m]', num: true, digits: 2 }, { label: 'b [m]', num: true, digits: 2 }, { label: 'α [°]', num: true, digits: 1 }, { label: 'W [kN/m]', num: true, digits: 1 }, { label: 'u [kN/m²]', num: true, digits: 1 }, { label: "c [kN/m²]", num: true, digits: 1 }, { label: "φ [°]", num: true, digits: 1 }, 'Schicht'],
      S.map((s, i) => [i + 1, R.M.tx(s.xm), s.b, s.alpha * 180 / Math.PI, s.W + s.Q, s.u, s.c, Math.atan(s.tanPhi) * 180 / Math.PI, s.layer]))],
    { collapsible: true, collapsed: true, info: 'W enthält Auflast und Wasserauflast. c und φ sind die in der Berechnung verwendeten Werte (Bemessungswerte, falls angezeigt).' }));
  }
  el.append(note(`Böschung fällt nach ${R.M.dir === 1 ? 'rechts' : 'links'} ab. Suchraster: ${R.grid.nx} × ${R.grid.ny} Mittelpunkte × ${R.grid.nr} Radien, anschliessend lokale Verfeinerung.`));
  void app;
}

// ---------------------------------------------------------------- Stützmauer
function rwChecks(R) {
  const list = [];
  const s = R.govS, b = R.govB;
  list.push({ id: 'sliding', label: 'Gleiten', hint: HINTS.sliding, deriv: 'rw-slide', ref: 'EN 1997-1, 6.5.3 / 9.7 · SIA 267', Ed: s.Hd, Rd: s.Rd, unit: 'kN/m', eta: s.eta, detail: `R_h,d = γ_G,inf·V_G·tan δ/γ_R,h${s.Ep > 0 ? ` + E_p,Sporn/γ_R,e (${fmt(s.Ep, 1)} kN/m)` : ''}` });
  list.push({ id: 'bearing', label: 'Grundbruch', hint: HINTS.bearing, deriv: 'rw-bearing', ref: 'EN 1997-1, 6.5.2 / Anh. D · SIA 267', Ed: b.ld?.V ?? b.combo?.N, Rd: b.Rd, unit: 'kN/m', eta: b.eta, detail: b.error || `Streifen B' = ${fmt(b.eff?.Bp, 2)} m, Kombination γ_G = ${fmt(b.combo.fG, 2)}, γ_Q = ${fmt(b.combo.fQe, 2)}` });
  list.push({ id: 'eccPerm', label: 'Kippen: Ausmittigkeit ständig', hint: HINTS.eccPerm, deriv: 'rw-ecc', ref: 'e ≤ B/6 (Resultierende im Kern)', Ed: Math.abs(R.eccPerm.e), Rd: R.eccPerm.limKern, unit: 'm', digits: 3, eta: R.eccPerm.kern });
  if (R.eccDesign) list.push({ id: 'eccDesign', label: 'Kippen: Ausmittigkeit Bemessung', hint: HINTS.eccDesign, deriv: 'rw-ecc', ref: 'e ≤ B/3 · EN 1997-1, 6.5.4', Ed: Math.abs(R.eccDesign.e), Rd: R.eccDesign.limGap, unit: 'm', digits: 3, eta: R.eccDesign.gap });
  return list;
}

function resRW(el, r) {
  const R = r.rw;
  const checks = rwChecks(R);
  el.append(summaryCard(R.etaMax, 'Maximale Ausnutzung', verdict(checks)));
  el.append(stats([
    ['Fundamentbreite B', R.g.B, 'm', 2],
    ['Erddruck E_ah,k', R.ep.Eh, 'kN/m', 1],
    ['Vertikallast ΣV_k', R.charAll.N, 'kN/m', 1],
    ['Ausmitte e_k (ständig)', R.charG.e, 'm', 3],
    ['Sohldruck σ_max,d', R.sigDesign.max, 'kN/m²', 0],
    ['Wand: M_Ed (Einspannung)', R.sec.base.Md, 'kNm/m', 1],
    ['Wand: V_Ed (Einspannung)', R.sec.base.Vd, 'kN/m', 1],
    ['Kippsicherheit M_stb/M_dst', R.Fkipp, '', 2],
  ]));
  el.append(...warnNotes(R.warnings));
  el.append(group('Nachweise', [checksTable(checks)], { info: 'Gleiten, Grundbruch und Ausmittigkeit in der Fundamentsohle. Erddruck auf die lotrechte Ersatzwand durch das Fersenende; der Boden über der Ferse wirkt als Teil des Stützkörpers.' }));
  el.append(group('Schnittkräfte Wand (Bemessung)', [chartBox({
    series: [
      { points: R.sec.rows.map((q) => [q.Md, q.s]), label: 'M_Ed [kNm/m]', color: 'var(--c-pos)', fill: true, area: 'x' },
      { points: R.sec.rows.map((q) => [q.Vd, q.s]), label: 'V_Ed [kN/m]', color: 'var(--c-series-5)' },
    ],
    invertY: true, xLabel: 'M_Ed [kNm/m] / V_Ed [kN/m]', yLabel: 'Tiefe ab Wandkopf [m]', height: 260,
  }), kvTable([
    ['Einspannung Wand: M_Ed / V_Ed', `${fmt(R.sec.base.Md, 1)} / ${fmt(R.sec.base.Vd, 1)}`, 'kNm/m · kN/m'],
    ['Einspannung Wand: M_k / V_k', `${fmt(R.sec.base.Mk, 1)} / ${fmt(R.sec.base.Vk, 1)}`, 'kNm/m · kN/m'],
    R.slab ? ['Zehe (Anschnitt Wand): M_Ed / V_Ed', `${fmt(R.slab.toe.M, 1)} / ${fmt(R.slab.toe.V, 1)}`, 'kNm/m · kN/m'] : null,
    R.slab ? ['Ferse (Anschnitt Wand): M_Ed / V_Ed', `${fmt(R.slab.heel.M, 1)} / ${fmt(R.slab.heel.V, 1)}`, 'kNm/m · kN/m'] : null,
  ])], { info: 'Für die Bemessung des Stahlbetons (SIA 262): Wand mit Erddruck auf die Wandrückseite (γ_G auf Bodeneigengewicht/Wasser, γ_Q auf Auflast). Zehe: Zug unten, Ferse: Zug oben.' }));
  el.append(group('Kräfte je Laufmeter (charakteristisch)', [resultTable(
    ['Kraft', 'Art', { label: 'V [kN/m]', num: true, digits: 1 }, { label: 'H [kN/m]', num: true, digits: 1 }, { label: 'x [m]', num: true, digits: 2 }, { label: 'y [m]', num: true, digits: 2 }],
    R.forces.map((f) => [f.name, f.kind === 'G' ? 'ständig' : 'veränderlich', -f.Fy, -f.Fx, f.x, f.y]))],
  { collapsible: true, collapsed: true, info: 'V positiv nach unten, H positiv Richtung Luftseite (Zehe). Koordinaten ab Vorderkante Fundament (x) und Sohle (y).' }));
  el.append(group('Lastkombinationen (Grundbruch)', [resultTable(
    [{ label: 'γ_G', num: true, digits: 2 }, { label: 'γ_Q,E', num: true, digits: 2 }, { label: 'γ_Q,v', num: true, digits: 2 }, { label: 'N_d', num: true, digits: 1 }, { label: 'H_d', num: true, digits: 1 }, { label: 'e [m]', num: true, digits: 3 }, { label: 'R_d', num: true, digits: 0 }, { label: 'η', num: true, digits: 2 }],
    R.bearing.map((b) => [b.combo.fG, b.combo.fQe, b.combo.fQv, b.combo.N, b.combo.H, b.combo.e, b.error ? '–' : b.Rd, b.error ? 'Fehler' : b.eta]),
    { rowClass: (row, i) => (R.bearing[i] === R.govB ? 'sum' : '') })], { collapsible: true, collapsed: true }));
}

// ------------------------------------------------------------------ Bericht

export function buildReport(app) {
  const r = app.results, p = app.project, n = r.norm;
  const A = ANALYSES.find((a) => a.id === r.type);
  const out = [];
  out.push({ title: `Aufgabe: ${A.label}`, content: [repP(A.desc + '.'), repKV([
    ['Nachweiskonzept', NORM_LABEL(n)],
    ['Bodenverhalten', r.type === 'grundbruch' ? DRAIN[p.bc.drainage] : r.type === 'boeschung' ? DRAIN[p.sl.drainage] : r.type === 'stuetzmauer' ? DRAIN[p.rw.drainage] : 'drainiert (effektive Spannungen)'],
  ])] });
  out.push({ title: 'Baugrund', content: [
    repP(`Schichttiefen ab ${DEPTH_REF[r.type]}. Charakteristische Werte.`),
    repTable(['Schicht', { label: 'OK z [m]', num: true, digits: 2 }, { label: 'γ [kN/m³]', num: true, digits: 1 }, { label: "γ' [kN/m³]", num: true, digits: 1 }, { label: "φ'_k [°]", num: true, digits: 1 }, { label: "c'_k [kN/m²]", num: true, digits: 1 }, { label: 'c_u,k [kN/m²]', num: true, digits: 1 }, { label: 'M_E [MN/m²]', num: true, digits: 1 }, { label: 'δ/φ', num: true, digits: 2 }],
      [...p.soil.layers].sort((a, b) => a.z - b.z).map((l) => [l.name, +l.z, +l.gamma, +l.gammaP, +l.phi, +l.c, +l.cu, +l.ME, +l.dr])),
    repP(r.type === 'boeschung' && p.sl.waterMode === 'line' ? 'Wasserspiegel als Sickerlinie (siehe Eingaben).' : r.type === 'boeschung' && p.sl.waterMode === 'none' ? 'Kein Wasser angesetzt.' : p.soil.gw?.on ? `Grundwasserspiegel ${fmt(+p.soil.gw.z, 2)} m unter der Bezugsebene, γ_w = ${fmt(+p.soil.gammaW || 10, 1)} kN/m³.` : 'Kein Grundwasser angesetzt.'),
  ] });
  out.push({ title: 'Partialfaktoren', content: [repTable(['Faktor', { label: 'Wert', num: true, digits: 2 }, 'Verwendung'], [
    ['γ_φ (auf tan φ\')', n.gPhi, n.geoMode === 'M' ? 'Grundbruch, Gleiten, Böschung' : 'Böschung'],
    ["γ_c (auf c')", n.gC, n.geoMode === 'M' ? 'Grundbruch, Gleiten, Böschung' : 'Böschung'],
    ['γ_cu (auf c_u)', n.gCu, n.geoMode === 'M' ? 'Grundbruch, Gleiten, Böschung' : 'Böschung'],
    ['γ_G / γ_G,inf', `${fmt(n.gG, 2)} / ${fmt(n.gGinf, 2)}`, 'ständige Einwirkungen ungünstig / günstig'],
    ['γ_Q', n.gQ, 'veränderliche Einwirkungen'],
    ['γ_Q (Böschung)', n.gQslope, 'veränderliche Lasten im Böschungsnachweis'],
    ['γ_R,v / γ_R,h / γ_R,e', `${fmt(n.gRv, 2)} / ${fmt(n.gRh, 2)} / ${fmt(n.gRe, 2)}`, 'Grundbruch / Gleiten / Erdwiderstand'],
    ['γ_R (Böschung)', n.gRs, 'Gesamtstabilität: F_d ≥ γ_R'],
  ])] });
  const fig = (mode, cap) => repFigure(app.snapshot(mode), cap);
  const modes = VIEW_MODES[r.type] || [];
  out.push({ title: 'Darstellungen', content: modes.map((m) => fig(m.id, m.label)) });
  const fn = { erddruck: repEP, grundbruch: repBC, setzung: repST, boeschung: repSL, stuetzmauer: repRW }[r.type];
  out.push(...fn(r, p, n));
  out.push({ title: 'Annahmen und Grenzen', content: h('ul', {}, (LIMITS[r.type] || []).concat(LIMITS.common).map((t) => h('li', {}, t))) });
  return out;
}

const NORM_LABEL = (n) => `${n.code === 'EC' ? 'EN 1997-1, Nachweisverfahren 2' : 'SIA 267 / SIA 260'}; Grundbruch/Gleiten mit ${n.geoMode === 'M' ? 'Bemessungswerten der Bodenkennwerte (γ_M)' : 'charakteristischen Bodenkennwerten und Widerstandsbeiwerten γ_R'}`;

export const DEPTH_REF = {
  erddruck: 'Wandkopf (Gelände an der Wandrückseite)',
  grundbruch: 'Geländeoberkante beim Fundament',
  setzung: 'Geländeoberkante beim Fundament',
  boeschung: 'höchstem Punkt der Geländelinie (Böschungskrone)',
  stuetzmauer: 'Oberkante Hinterfüllung an der Wandrückseite (Mauerkrone)',
};

const checkRows = (checks) => checks.map((c) => [c.label + (c.ref ? ` (${c.ref})` : ''), c.Ed === undefined ? '' : `${fmt(c.Ed, c.digits ?? 1)} ${c.unit || ''}`, c.Rd === undefined ? '' : `${fmt(c.Rd, c.digits ?? 1)} ${c.unit || ''}`, c.eta, Number.isFinite(c.eta) && c.eta <= 1.0001 ? 'erfüllt' : 'nicht erfüllt']);
const checkTable = (checks, ed = 'E_d', rd = 'R_d') => repTable(['Nachweis', { label: ed, num: true }, { label: rd, num: true }, { label: 'η', num: true, digits: 2 }, 'Status'], checkRows(checks));

function repEP(r, p, n) {
  const R = r.ep, e = p.ep;
  const passive = R.passive;
  return [
    { title: 'Eingaben', content: repKV([
      ['Erddruckart', KIND[R.kind]], ['Wandhöhe H', +e.H, 'm', 2], ['Wandneigung α', +e.alpha || 0, '°', 1], ['Geländeneigung β', +e.beta || 0, '°', 1],
      passive ? ['Verfahren', e.passiveMethod === 'coulomb' ? 'ebene Gleitfläche (Coulomb)' : 'gekrümmte Gleitfläche (Lancellotta 2002)'] : ['Verfahren', e.method === 'rankine' ? 'Rankine (δ = β)' : 'Coulomb (δ = δ/φ · φ je Schicht)'],
      passive ? ['δ_p/φ', +e.dpRatio, '', 2] : null,
      R.kind === 'increased' ? ['Erhöhungsfaktor μ', +e.mu, '', 2] : null,
      ['Flächenlast q', +e.q || 0, 'kN/m²', 1], ['Wasserdruck', e.water ? 'ja' : 'nein'],
    ]) },
    { title: 'Berechnung', content: [
      repFormula(passive
        ? "Erdwiderstand: e_ph = K_pgh·σ'_v + K_pqh·q + K_pch·c'\nGekrümmt (Lancellotta): K_p = cos δ/(1−sin φ)·[cos δ + √(sin²φ − sin²δ)]·exp(2θ·tan φ), 2θ = asin(sin δ/sin φ) + δ"
        : "e_ah(z) = K_agh·σ'_v(z) + K_aqh·q − K_ach·c'  ≥ 0   (DIN 4085, Coulomb/Müller-Breslau)\nK_agh = cos²(φ−α) / {cos²α·[1 + √(sin(φ+δ)·sin(φ−β)/(cos(α−β)·cos(α+δ)))]²}\nK_ach = 2·cos(α−β)·cos φ·cos(α+δ) / [(1+sin(φ+α+δ−β))·cos β],   K_aqh = K_agh·cos α·cos β/cos(α−β)\nK_0 = (1 − sin φ)·√OCR·(1 + sin β)   (EN 1997-1, 9.5.2)"),
      repTable(['Schicht', { label: "φ'", num: true, digits: 1 }, { label: 'δ', num: true, digits: 1 }, { label: 'K_h', num: true, digits: 3 }, { label: 'K_ch', num: true, digits: 3 }, { label: 'ϑ_a', num: true, digits: 1 }],
        R.layers.map((L) => [L.name, L.phi, passive ? L.deltaP : L.delta, L.Kgh, L.Kch, L.theta ?? '–'])),
      repTable([{ label: 'z [m]', num: true, digits: 2 }, { label: "σ'_v [kN/m²]", num: true, digits: 1 }, { label: 'e_h [kN/m²]', num: true, digits: 1 }, { label: 'u [kN/m²]', num: true, digits: 1 }], edgeRows(R).map((q) => [q.z, q.svp, q.eh, q.u])),
      repFigure(xyChart({ ...epChartOpts(R), crosshair: false, width: 520, height: 320 }), 'Erddruckverteilung über die Tiefe'),
      repKV([
        [passive ? 'E_ph,k' : 'E_ah,k', R.Eh, 'kN/m', 1], [passive ? 'E_pv,k' : 'E_av,k', R.Ev, 'kN/m', 1], ['Angriff über Fuss', R.hE, 'm', 2],
        R.U > 0 ? ['Wasserdruck W', R.U, 'kN/m', 1] : null,
        [passive ? 'E_ph,d = E_ph,k/γ_R,e' : `E_d = ${fmt(n.gG, 2)}·(E_G + W) + ${fmt(n.gQ, 2)}·E_Q`, R.Ed, 'kN/m', 1],
        ['M_k / M_d am Fuss', `${fmt(R.Mbase, 1)} / ${fmt(R.Mbased, 1)}`, 'kNm/m'],
      ]),
    ] },
  ];
}

function repBC(r, p, n) {
  const R = r.bc, f = p.bc, g = R.gov, strip = R.shape === 'strip';
  const L = (o) => `V=${fmt(+o.V || 0, 1)}, H_B=${fmt(+o.HB || 0, 1)}${strip ? '' : `, H_L=${fmt(+o.HL || 0, 1)}`}, M_B=${fmt(+o.MB || 0, 1)}${strip ? '' : `, M_L=${fmt(+o.ML || 0, 1)}`}`;
  const content = [];
  if (!g.error) {
    const G = g.gov;
    content.push(repFormula(G.drained
      ? "R/A' = c'·N_c·b_c·s_c·i_c + q'·N_q·b_q·s_q·i_q + 0.5·γ'·B'·N_γ·b_γ·s_γ·i_γ   (EN 1997-1, Anh. D.4)\nN_q = e^(π·tan φ)·tan²(45°+φ/2),  N_c = (N_q−1)·cot φ,  N_γ = 2·(N_q−1)·tan φ\ns_q = 1 + (B'/L')·sin φ,  s_γ = 1 − 0.3·B'/L',  i_q = [1 − H/(V + A'·c'·cot φ)]^m,  i_γ = [...]^(m+1)"
      : "R/A' = (π+2)·c_u·b_c·s_c·i_c + q   (EN 1997-1, Anh. D.3)\ns_c = 1 + 0.2·B'/L',  i_c = ½·[1 + √(1 − H/(A'·c_u))]"));
    content.push(repTable(['Term', { label: 'N', num: true, digits: 2 }, { label: 'b', num: true, digits: 3 }, { label: 's', num: true, digits: 3 }, { label: 'i', num: true, digits: 3 }, { label: 'Anteil [kN/m²]', num: true, digits: 1 }],
      G.drained ? [["c'", G.N.Nc, G.b.c, G.s.c, G.i.c, G.terms.c], ["q'", G.N.Nq, G.b.q, G.s.q, G.i.q, G.terms.q], ["γ'", G.N.Ng, G.b.g, G.s.g, G.i.g, G.terms.g]] : [['c_u', G.N.Nc, G.b.c, G.s.c, G.i.c, G.terms.c], ['q', 1, 1, 1, 1, G.terms.q]]));
    content.push(repKV([
      ['massgebende Kombination', `γ_G = ${fmt(g.ld.gG, 2)}, γ_Q = ${fmt(g.ld.gQ, 2)}`],
      ['V_d / H_d', `${fmt(g.ld.V, 1)} / ${fmt(g.H, 1)}`, unitF(strip)],
      ['Ausmitte e_B / e_L', `${fmt(g.eB, 3)} / ${fmt(g.eL, 3)}`, 'm'],
      ["B' / L' / A'", `${fmt(g.eff.Bp, 3)} / ${strip ? '–' : fmt(g.eff.Lp, 3)} / ${fmt(g.eff.A, 3)}`, 'm, m²'],
      ["Bodenkennwerte (Mittel bis 2B')", G.drained ? `φ = ${fmt(g.soil.phi, 1)}°, c = ${fmt(g.soil.c, 1)} kN/m², γ' = ${fmt(g.soil.gammaEff, 1)} kN/m³, q' = ${fmt(g.soil.qEff, 1)} kN/m²` : `c_u = ${fmt(g.soil.cu, 1)} kN/m², q = ${fmt(g.soil.qTot, 1)} kN/m²`],
      ['R_k / R_d = R_k/γ_R,v', `${fmt(g.R, 1)} / ${fmt(g.Rd, 1)}`, unitF(strip)],
    ]));
  }
  content.push(repKV([
    ['Gleiten', `H_d = ${fmt(R.govS.Hd, 1)}, R_h,d = ${fmt(R.govS.Rd, 1)} ${unitF(strip)} (${R.govS.type}, δ = ${fmt(R.slDelta, 1)}°)`],
    ['Ausmitte ständig', `e_B = ${fmt(R.eG.eB, 3)} m, e_L = ${fmt(R.eG.eL, 3)} m`],
  ]));
  return [
    { title: 'Eingaben', content: repKV([
      ['Fundamentform', { strip: 'Streifen (je m)', rect: 'Rechteck', circle: 'Kreis' }[R.shape]],
      [R.shape === 'circle' ? 'Durchmesser' : 'Breite B', R.B, 'm', 2], R.shape === 'rect' ? ['Länge L', R.L, 'm', 2] : null,
      ['Einbindetiefe D', R.D, 'm', 2], ['Fundamentdicke t', R.t, 'm', 2], ['Sohlneigung α', +f.alphaBase || 0, '°', 1],
      ['Ständige Lasten G (OK Fundament)', L(f.loads.G), unitF(strip)], ['Veränderliche Lasten Q', L(f.loads.Q), unitF(strip)],
      ['Eigengewicht Fundament + Auflast', f.selfWeight ? `${fmt(R.Wf + R.Ws, 1)} ${unitF(strip)}` : 'nicht berücksichtigt'],
      ['Sohlreibung', f.interface === 'precast' ? 'Fertigteil (δ = 2/3·φ)' : 'Ortbeton (δ = φ)'],
    ]) },
    { title: 'Berechnung', content },
    { title: 'Nachweise', content: checkTable(bcChecks(R)) },
  ];
}

function repST(r, p) {
  const R = r.st, s = p.st;
  const sAllow = Number(s.sAllow) || 0;
  return [
    { title: 'Eingaben', content: repKV([
      ['Fundamentform', { strip: 'Streifen', rect: 'Rechteck', circle: 'Kreis' }[R.shape]],
      [R.shape === 'circle' ? 'Durchmesser' : 'Breite B', R.B, 'm', 2], R.shape === 'rect' ? ['Länge L', R.L, 'm', 2] : null,
      ['Gründungstiefe D', R.D, 'm', 2], ['Sohlspannung σ₀', R.p0, 'kN/m²', 1],
      ['Aushubentlastung', s.unload ? `ja (σ_v(D) = ${fmt(R.sv0D, 1)} kN/m²)` : 'nein'],
      ['Grenztiefenkriterium', `Δσ = ${fmt(R.f, 2)}·σ'_v0`],
      ['Bezugspunkt', R.refKey === 'char' ? 'kennzeichnender Punkt (starr)' : 'Mitte (schlaff)'],
    ]) },
    { title: 'Berechnung', content: [
      repFormula("Eckpunktformel (Steinbrenner, aus Boussinesq):  σ_z = p/(2π)·[arctan(ab/(zR)) + abz/R·(1/(a²+z²) + 1/(b²+z²))],  R = √(a²+b²+z²)\nÜberlagerung von vier Eckrechtecken für Mitte, kennzeichnenden Punkt (0.37·B, 0.37·L ab Mitte) und Ecke\ns = Σ Δσ_z·Δz / M_E   bis z_gr mit Δσ_z(z_gr) = f·σ'_v0(z_gr)"),
      repKV([['p_netto', R.pNet, 'kN/m²', 1], ['Grenztiefe z_gr', R.zLim, 'm', 2], ['s Mitte / kennz. Punkt / Rand', `${fmt(R.sCentre, 1)} / ${fmt(R.sChar, 1)} / ${fmt(R.sEdge, 1)}`, 'mm']]),
      repTable(['Schicht', { label: 'von [m]', num: true, digits: 2 }, { label: 'bis [m]', num: true, digits: 2 }, { label: 'M_E [MN/m²]', num: true, digits: 1 }, { label: 'Δσ_m [kN/m²]', num: true, digits: 1 }, { label: 's [mm]', num: true, digits: 1 }],
        R.layers.map((l) => [l.name, l.from, l.to, l.ME, l.dsigAvg, l.ds[R.refKey]])),
      repFigure(xyChart({
        series: [
          { points: R.profile.map((q) => [q.svp, q.z]), label: "σ'_v0", color: 'var(--c-soil)' },
          { points: R.profile.map((q) => [q.lim, q.z]), label: `${fmt(R.f, 2)}·σ'_v0`, color: 'var(--c-soil)', dash: '5 3' },
          { points: R.profile.map((q) => [q.centre, q.z]), label: 'Δσ Mitte', color: 'var(--c-pos)' },
          { points: R.profile.map((q) => [q.char, q.z]), label: 'Δσ kennz. P.', color: 'var(--c-series-2)' },
        ], invertY: true, xLabel: 'Spannung [kN/m²]', yLabel: 'Tiefe z [m]', width: 520, height: 320, crosshair: false,
      }), 'Spannungen über die Tiefe'),
    ] },
    sAllow > 0 ? { title: 'Nachweis', content: checkTable([{ label: 'Setzung s ≤ s_zul', Ed: R.sRef, Rd: sAllow, unit: 'mm', eta: R.sRef / sAllow }], 's', 's_zul') } : null,
  ].filter(Boolean);
}

function repSL(r, p, n) {
  const R = r.sl, s = p.sl;
  const best = R.design.best || R.char.best;
  const S = best.slices || [];
  const step = Math.max(1, Math.ceil(S.length / 15));
  return [
    { title: 'Eingaben', content: repKV([
      ['Geländelinie', (s.surface || []).map((q) => `(${fmt(+q.x, 2)}; ${fmt(+q.y, 2)})`).join('  ')],
      ['Wasser', { none: 'kein Wasser', gw: 'horizontaler Grundwasserspiegel', line: 'Sickerlinie (Polylinie)' }[s.waterMode]],
      ['Auflast', s.q && +s.q.p ? `q = ${fmt(+s.q.p, 1)} kN/m² von x = ${fmt(+s.q.x1, 2)} bis ${fmt(+s.q.x2, 2)} m` : 'keine'],
      ['Lamellen', R.n, '', 0], ['Mindesttiefe Gleitkörper', +s.tMin || 0, 'm', 2],
      ['Suchraster', `${R.grid.nx} × ${R.grid.ny} Mittelpunkte × ${R.grid.nr} Radien${s.grid?.auto === false ? ' (manuell)' : ' (automatisch)'}`],
    ]) },
    { title: 'Berechnung', content: [
      repFormula("Bishop (vereinfacht):  F = Σ [c'·b + (W − u·b)·tan φ'] / m_α  /  Σ W·sin α,   m_α = cos α + sin α·tan φ'/F\nFellenius:  F = Σ [c'·l + (W·cos α − u·l)·tan φ']  /  Σ W·sin α\nBemessung: tan φ'_d = tan φ'/γ_φ, c'_d = c'/γ_c, c_u,d = c_u/γ_cu, q_d = γ_Q·q (nur ungünstig);  F_d ≥ γ_R"),
      repKV([
        ['F (Bishop, charakteristisch)', R.F, '', 3], ['F (Fellenius, charakteristisch)', R.FF, '', 3], ['F_d (Bishop, Bemessung)', R.Fd, '', 3],
        ['Kritischer Kreis (Bemessung)', `x_M = ${fmt(R.M.tx(best.xc), 2)} m, y_M = ${fmt(best.yc, 2)} m, R = ${fmt(best.R, 2)} m`],
        ['Ein-/Austritt', `x = ${fmt(R.M.tx(best.xa), 2)} / ${fmt(R.M.tx(best.xe), 2)} m`],
      ]),
      S.length ? repTable([{ label: 'Nr', num: true, digits: 0 }, { label: 'x [m]', num: true, digits: 2 }, { label: 'b [m]', num: true, digits: 2 }, { label: 'α [°]', num: true, digits: 1 }, { label: 'W [kN/m]', num: true, digits: 1 }, { label: 'u [kN/m²]', num: true, digits: 1 }, { label: 'c_d', num: true, digits: 1 }, { label: 'φ_d [°]', num: true, digits: 1 }, 'Schicht'],
        S.filter((_, i) => i % step === 0).map((sl) => [S.indexOf(sl) + 1, R.M.tx(sl.xm), sl.b, sl.alpha * 180 / Math.PI, sl.W + sl.Q, sl.u, sl.c, Math.atan(sl.tanPhi) * 180 / Math.PI, sl.layer]), { caption: `Lamellen (Auszug, jede ${step}. von ${S.length})` }) : null,
    ] },
    { title: 'Nachweis', content: checkTable([{ label: 'Gesamtstabilität F_d ≥ γ_R (SIA 267 / EN 1997-1, 11.5.1)', Ed: n.gRs, Rd: R.Fd, digits: 3, eta: R.eta }], 'erforderlich', 'vorhanden') },
  ];
}

function repRW(r, p) {
  const R = r.rw, w = p.rw, g = R.g;
  return [
    { title: 'Eingaben', content: repKV([
      ['Wand h_s / t_oben / t_unten', `${fmt(g.hs, 2)} / ${fmt(g.tTop, 2)} / ${fmt(g.tBot, 2)}`, 'm'],
      ['Fundament Zehe / Ferse / Dicke / Breite', `${fmt(g.toe, 2)} / ${fmt(g.heel, 2)} / ${fmt(g.d, 2)} / ${fmt(g.B, 2)}`, 'm'],
      ['Einbindetiefe vorne D_f', g.Df, 'm', 2],
      g.key ? ['Sporn Tiefe / Breite / Lage', `${fmt(g.key.depth, 2)} / ${fmt(g.key.width, 2)} / ${fmt(g.key.x, 2)}`, 'm'] : ['Sporn', 'keiner'],
      ['Geländeneigung β / Auflast q', `${fmt(g.beta, 1)}° / ${fmt(+w.q || 0, 1)} kN/m²`],
      ['Erddruck auf Ersatzwand', w.method === 'coulomb' ? 'Coulomb (δ = δ/φ·φ)' : 'Rankine (δ = β)'],
      ['Wasserdruck', w.water ? 'ja' : 'nein'], ['Beton γ_c', +w.gammaC || 25, 'kN/m³', 1],
    ]) },
    { title: 'Berechnung', content: [
      repFormula("Erddruck auf die lotrechte Ersatzwand durch das Fersenende (Bodenkörper über der Ferse gehört zum Stützkörper)\nGleiten: H_d = γ_G·E_ah,G + γ_Q·E_ah,Q ≤ R_h,d = γ_G,inf·V_G·tan δ_b/γ_R,h (+ E_p,Sporn/γ_R,e)\nAusmitte: e = B/2 − (ΣM_stb − ΣM_dst)/ΣV;  ständig e ≤ B/6, Bemessung e ≤ B/3;  Grundbruch mit B' = B − 2e"),
      repTable(['Kraft', { label: 'V [kN/m]', num: true, digits: 1 }, { label: 'H [kN/m]', num: true, digits: 1 }, { label: 'x [m]', num: true, digits: 2 }, { label: 'y [m]', num: true, digits: 2 }],
        R.forces.map((f) => [f.name, -f.Fy, -f.Fx, f.x, f.y])),
      repKV([
        ['E_ah,k (G / Q)', `${fmt(R.ep.EhG, 1)} / ${fmt(R.ep.EhQ, 1)}`, 'kN/m'],
        ['ΣV_k ständig / total', `${fmt(R.charG.N, 1)} / ${fmt(R.charAll.N, 1)}`, 'kN/m'],
        ['Ausmitte e_k (ständig)', R.charG.e, 'm', 3],
        ['M_stb / M_dst (Kippen um Zehe)', `${fmt(R.Mstb, 1)} / ${fmt(R.Mdst, 1)} = ${fmt(R.Fkipp, 2)}`],
        ['Sohldruck Bemessung σ_max / σ_min', `${fmt(R.sigDesign.max, 1)} / ${fmt(R.sigDesign.min, 1)}`, 'kN/m²'],
        ['Wand Einspannung M_Ed / V_Ed', `${fmt(R.sec.base.Md, 1)} / ${fmt(R.sec.base.Vd, 1)}`, 'kNm/m, kN/m'],
        R.slab ? ['Zehe M_Ed / V_Ed', `${fmt(R.slab.toe.M, 1)} / ${fmt(R.slab.toe.V, 1)}`, 'kNm/m, kN/m'] : null,
        R.slab ? ['Ferse M_Ed / V_Ed', `${fmt(R.slab.heel.M, 1)} / ${fmt(R.slab.heel.V, 1)}`, 'kNm/m, kN/m'] : null,
      ]),
    ] },
    { title: 'Nachweise', content: checkTable(rwChecks(R)) },
  ];
}

const LIMITS = {
  common: [
    'Bodenkennwerte sind charakteristische Werte (vorsichtige Schätzung des Mittelwerts) und durch die Geotechnikerin bzw. den Geotechniker festzulegen.',
    'Die voreingestellten Partialfaktoren sind mit der gültigen Normausgabe und den Projektvorgaben abzugleichen.',
  ],
  erddruck: [
    'Ebene Gleitflächen (Coulomb) für den aktiven Erddruck; Kohäsionsanteil nach DIN 4085, Zugspannungen werden abgeschnitten.',
    'Bei geschichtetem Boden werden die Beiwerte schichtweise angesetzt (übliche Näherung); Geländeneigung β gilt für alle Schichten.',
    'Streifen- und Linienlasten: Coulomb-Krafteck mit der Gleitfuge der obersten Schicht, vereinfachte Verteilung.',
    'Erdwiderstand mit gekrümmter Gleitfläche nach Lancellotta (untere Schranke); für α, β ≠ 0 mit Coulomb-Verhältnis korrigiert. Die zur Mobilisierung nötigen Wandverschiebungen sind gross.',
  ],
  grundbruch: [
    'Bodenkennwerte unter der Sohle bis 2B\' dickengewichtet gemittelt (φ über tan φ). Bei stark unterschiedlichen Schichten (Δφ > 5°) ist die Mittelung nur eine Näherung.',
    'Keine Tiefenbeiwerte, kein Erdwiderstand vor dem Fundament, keine Nachbarlasten, keine Böschung neben dem Fundament.',
    'Gleiten ohne Adhäsion; undrainiert R_h = A\'·c_u.',
  ],
  setzung: [
    'Linear-elastischer, homogener Halbraum für die Spannungsausbreitung (Boussinesq/Steinbrenner) – auch bei geschichtetem Boden.',
    'Setzung mit dem Steifemodul M_E (eindimensional), ohne Kriechen, Konsolidationszeit und Wiederbelastungsast.',
    'Starres Fundament: Setzung im kennzeichnenden Punkt (Grasshoff).',
  ],
  boeschung: [
    'Kreisförmige Gleitflächen, vereinfachtes Verfahren nach Bishop (Momentengleichgewicht, Lamellenseitenkräfte horizontal). Nicht-kreisförmige Bruchmechanismen sind gesondert zu prüfen.',
    'Porenwasserdruck hydrostatisch aus dem Wasserspiegel; Wasser über Gelände wirkt als Auflast.',
    'Horizontale Schichtgrenzen; keine Anker, Nägel oder Bewehrungen; keine Erdbebenlasten.',
  ],
  stuetzmauer: [
    'Erddruck auf die lotrechte Ersatzwand durch das Fersenende; aktiver Erddruck setzt eine ausreichende Wandbewegung voraus.',
    'Erdwiderstand vor der Mauer wird nicht angesetzt (nur vor dem Sporn, auf dessen Höhe).',
    'Gesamtstabilität (Geländebruch) ist mit dem Böschungsnachweis separat zu prüfen.',
  ],
};
