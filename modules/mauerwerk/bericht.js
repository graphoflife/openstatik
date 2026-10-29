// Bericht und Hilfe Mauerwerk
import { h, fmt, checksTable, rich } from '../../js/core/ui.js';
import { xyChart } from '../../js/core/chart.js';
import { repTable as coreTable, repKV as coreKV, repFigure } from '../../js/core/report.js';

// Berichtsbausteine mit Tiefstellung der Formelzeichen (f_xd → f<sub>xd</sub>)
const R_ = (v) => (typeof v === 'string' ? rich(v) : v);
const repP = (text) => h('p', {}, R_(text));
const repFormula = (text) => h('div', { class: 'formula' }, R_(text));
const repKV = (rows) => coreKV(rows.filter(Boolean).map(([l, v, u, d]) => [R_(l), R_(v), R_(u), d]));
const repTable = (headers, rows, opts) => coreTable(
  headers.map((x) => (typeof x === 'string' ? { label: R_(x) } : { ...x, label: R_(x.label) })),
  rows.map((r) => r.map(R_)), opts);
import { typeById, changedFromDefaults } from './materials.js';
import { sideFlags } from './calc.js';
import { pickCombo } from './view.js';

const yes = (b) => (b ? 'ja' : 'nein');

/**
 * Momentaufnahme mit fester Bildgrösse und ohne Aussparung für das Eigenschaftsfenster.
 * Umgehung: app.snapshot() übernimmt sonst die aktuelle Grösse der Zeichenfläche (oft hochformatig)
 * und die Einrückung des Editorfensters (view.insets), was im Bericht viel Leerraum erzeugt.
 */
const SNAP_SIZE = { ansicht: [900, 520], schnitt: [760, 620], schub: [900, 560] };
function snap(app, mode) {
  const v = app.view, el = v.container;
  if (!el || typeof v._resize !== 'function') return app.snapshot(mode);
  const prev = { w: el.style.width, h: el.style.height, flex: el.style.flex, ins: v.insets };
  const [w, hh] = SNAP_SIZE[mode] || [900, 560];
  try {
    el.style.flex = 'none'; el.style.width = `${w}px`; el.style.height = `${hh}px`;
    v.insets = null;
    v._resize();
    return app.snapshot(mode);
  } finally {
    el.style.width = prev.w; el.style.height = prev.h; el.style.flex = prev.flex;
    v.insets = prev.ins;
    v._resize();
  }
}
const etaS = (x) => (Number.isFinite(x) ? fmt(x, 2) : '∞');
const okS = (x) => (Number.isFinite(x) && x <= 1.0001 ? 'erfüllt' : 'nicht erfüllt');

const SUPPORT = { slab: 'Stahlbetondecken (ρ_2 = 0.75)', hinged: 'gelenkig (ρ_2 = 1.0)', manual: 'ρ manuell' };
const sidesText = (W) => { const f = sideFlags(W); return f.L && f.R ? 'beidseitig (vierseitig gehalten)' : f.L ? 'links (dreiseitig gehalten)' : f.R ? 'rechts (dreiseitig gehalten)' : 'keine (zweiseitig gehalten)'; };
const EMODE = { centric: 'zentrisch', slab: 'Deckenverdrehung e = t/2 − a/3', manual: 'manuell' };

function eccSvg(c, R, profile = c.profile, title = 'Exzentrizität über die Höhe') {
  const t = R.t * 1000;
  const series = [{ points: profile.pts.map((q) => [(q.e1 + q.eq) * 1000, q.z]), label: 'Th. 1. O.', color: 'var(--c-dim)', dash: '5 4' }];
  if (profile.ok) series.push({ points: profile.pts.map((q) => [q.e * 1000, q.z]), label: 'Stützlinie Th. 2. O.', color: 'var(--c-pos)', width: 2.2 });
  const svg = xyChart({
    title, series, xLabel: 'Exzentrizität e [mm]', yLabel: 'Höhe z [m]', width: 520, height: 300, crosshair: false,
    xRange: [-t * 0.55, t * 0.55], yRange: [0, R.h],
    vLines: [{ v: -t / 2, color: 'var(--fail)', dash: '0' }, { v: t / 2, color: 'var(--fail)', dash: '0', label: 'Rand' }, { v: -t / 6 }, { v: t / 6, label: 'Kern' }],
  });
  return h('div', { style: { maxWidth: '520px' } }, svg);
}

export function buildReport(app) {
  const p = app.project, R = app.results, W = p.wall, L = p.loads, M = p.material, S = p.settings || {};
  const md = R.md, t = R.t;
  const sec = [];
  const uls = R.combos.filter((c) => c.type === 'ULS');
  const E = L.earth || {}, C = L.conc || {};

  // ---------------------------------------------------------------- Grundlagen
  sec.push({
    title: 'Grundlagen',
    content: [
      repP('Nachweis einer Wand aus unbewehrtem Mauerwerk nach SIA 266 (2015) «Mauerwerk» mit Einwirkungen und Lastbeiwerten nach SIA 260/261. Wo SIA 266 keine geschlossene Formel vorgibt oder die Tabellenwerte nicht hinterlegt sind, werden mechanisch gleichwertige Verfahren bzw. EN 1996-1-1/-3 verwendet (bei jedem Nachweis angegeben).'),
      repKV([
        ['Normalkraft / Knicken', R.method === 'SIA' ? 'Th. 2. Ordnung numerisch, Spannungsblock (SIA 266, 4.3)' : 'EN 1996-1-1, 6.1.2 und Anhang G'],
        ['Querkraft in Wandebene', R.shearMethod === 'SIA' ? 'Spannungsfeld, Fliessbedingungen Ganz/Thürlimann (SIA 266, 4.4)' : 'EN 1996-1-1, 6.2'],
        ['Teilflächenbelastung', 'EN 1996-1-1, 6.1.3'],
        ['Querbelastung', `Stützlinie Th. 2. O.${S.arching !== false ? ' mit Bogenwirkung' : ''}${S.basementEN !== false && E.on ? '; EN 1996-3, 4.5' : ''}`],
        ['Vorzeichen', 'e und Querlast positiv zur Raumseite (+x)'],
        ['Einheiten', 'Linienlasten und Widerstände je m Wandlänge'],
      ]),
      repP('Hinweis: Die Mauerwerkskennwerte sind Standardwerte (Richtwerte) und müssen mit den Produktangaben bzw. den Tabellenwerten von SIA 266 überprüft werden.'),
    ],
  });

  // ---------------------------------------------------------------- Zusammenfassung
  sec.push({
    title: 'Ergebnisübersicht',
    content: [
      repP(`Maximale Ausnutzung η = ${etaS(R.etaMax)} – ${R.checks.every((c) => Number.isFinite(c.eta) && c.eta <= 1.0001) ? 'alle Nachweise sind erfüllt.' : 'mindestens ein Nachweis ist nicht erfüllt.'}`),
      checksTable(R.checks.map((c) => ({ label: c.label, ref: `${c.ref}${c.lc && c.lc !== 'alle' ? ` · ${c.lc}` : ''}`, Ed: c.Ed, Rd: c.Rd, unit: c.unit, digits: c.digits ?? (c.unit === 'kN/m²' ? 2 : 1), eta: c.eta }))),
      ...R.notes.map((n) => repP(`Hinweis: ${n}`)),
    ],
  });

  // ---------------------------------------------------------------- System
  const openRows = (W.openings || []).map((o, i) => [i + 1, o.x, o.b, o.y, o.hgt]);
  sec.push({
    title: 'Wand und Halterung',
    content: [
      repKV([
        ['Wandhöhe h', W.h, 'm', 2], ['Wanddicke t', W.t, 'mm', 0], ['Wandlänge l', W.l, 'm', 2],
        ['Halterung oben/unten', SUPPORT[W.support] || W.support], ['Seitliche Halterung', sidesText(W)],
        (sideFlags(W).L || sideFlags(W).R) ? ['Abstand Querwände l_s', W.ls, 'm', 2] : null,
        ['Knicklänge', R.eff.formula], ['Schlankheit h_ef/t', R.slender, '', 1],
      ]),
      openRows.length ? repTable(['Öffnung', { label: 'x [m]', num: true }, { label: 'Breite [m]', num: true }, { label: 'Brüstung [m]', num: true }, { label: 'Höhe [m]', num: true }], openRows) : null,
      openRows.length ? repP(`Lastkonzentration auf die Pfeiler: Faktor l/(l − Σb) = ${fmt(R.kOpen, 3)}${S.openingConc === false ? ' (nicht angesetzt)' : ''}.`) : null,
      repFigure(snap(app, 'ansicht'), 'Ansicht der Wand mit Lasten'),
    ],
  });

  // ---------------------------------------------------------------- Baustoff
  const ch = changedFromDefaults(M);
  sec.push({
    title: 'Baustoff',
    content: [
      repKV([
        ['Mauerwerksart', typeById(M.type).label],
        ['f_xk (senkrecht zu Lagerfugen)', md.fxk, 'MPa', 2], ['f_yk (parallel zu Lagerfugen)', md.fyk, 'MPa', 2],
        ['E_xk', md.Exk, 'MPa', 0], ['γ_M (SIA 266)', md.gammaM, '', 2], ['γ_E (E-Modul Th. 2. O.)', md.gammaE, '', 2],
        ['f_xd = f_xk/γ_M', md.fxd, 'MPa', 3], ['f_yd = f_yk/γ_M', md.fyd, 'MPa', 3], ['E_xd = E_xk/γ_E', md.Exd, 'MPa', 0],
        ['Raumlast γ', md.gamma, 'kN/m³', 1], ['Reibungsbeiwert μ', md.mu, '', 2], ['Endkriechzahl φ_{∞}', md.phi, '', 2],
        ['f_vk0 (EN 1996)', md.fvk0, 'MPa', 2], ['f_vlt = 0.065·f_b', md.fvlt, 'MPa', 2], ['Vollsteine (Gruppe 1)', yes(md.solid)],
      ]),
      ch.length ? repP(`Gegenüber den Standardwerten geändert: ${ch.join(', ')}.`) : repP('Es werden die Standardwerte der Mauerwerksart verwendet (vom Anwender zu prüfen).'),
    ],
  });

  // ---------------------------------------------------------------- Einwirkungen
  sec.push({
    title: 'Einwirkungen und Kombinationen',
    content: [
      repKV([
        ['Auflast Wand darüber g_k / q_k (zentrisch)', `${fmt(L.gW, 1)} / ${fmt(L.qW, 1)}`, 'kN/m'],
        ['Deckenauflager g_k / q_k', `${fmt(L.gD, 1)} / ${fmt(L.qD, 1)}`, 'kN/m'],
        ['Lastangriff Decke', `${EMODE[L.eMode] || L.eMode}: e_D = ${fmt(R.eD * 1000, 1)} mm`],
        ['Exzentrizität Wandfuss e_u', L.eU || 0, 'mm', 1],
        ['Eigengewicht Wand γ·t', md.gamma * t, 'kN/m²', 2],
        ['Wind quer w_k', L.wind || 0, 'kN/m²', 2],
        E.on ? ['Erddruck: h_e / γ_Boden / K / Auflast', `${fmt(E.he, 2)} m / ${fmt(E.gs, 1)} kN/m³ / ${fmt(E.K, 2)} / ${fmt(E.qs, 1)} kN/m²`] : null,
        (L.Vw || L.Ve) ? ['Horizontalkraft in Wandebene V_w,k / V_E,d', `${fmt(L.Vw || 0, 1)} / ${fmt(L.Ve || 0, 1)} kN auf h_V = ${fmt(L.hV || W.h, 2)} m`] : null,
        C.on ? ['Einzellast G_k / Q_k, Lastfläche a × b', `${fmt(C.G, 1)} / ${fmt(C.Q, 1)} kN, ${fmt(C.a, 0)} × ${fmt(C.b, 0)} mm bei x = ${fmt(C.x, 2)} m`] : null,
      ]),
      repTable(['Kombination', 'Art', { label: 'γ_G', num: true }, { label: 'γ_Q', num: true }, { label: 'γ_W', num: true }, { label: 'γ_Erd', num: true }, { label: 'γ_Eb', num: true }],
        (p.combos || []).filter((c) => c.on !== false).map((c) => [c.name, c.type === 'SLS' ? 'GZG' : 'GZT', c.g, c.q, c.w, c.e, c.ae])),
      repTable(['Kombination', { label: 'n_d,o [kN/m]', num: true, digits: 1 }, { label: 'e_o [mm]', num: true, digits: 1 }, { label: 'n_d,m [kN/m]', num: true, digits: 1 }, { label: 'n_d,u [kN/m]', num: true, digits: 1 }, { label: 'p_d,max [kN/m²]', num: true, digits: 2 }],
        R.combos.map((c) => [c.name, c.nTop, c.eTop * 1000, c.nMid, c.nBot, c.pMax])),
    ],
  });

  // ---------------------------------------------------------------- Normalkraft
  const gc = pickCombo(app, 'schnitt');
  const nk = [];
  nk.push(repFormula([
    `f_xd = f_xk/γ_M = ${fmt(md.fxk, 2)}/${fmt(md.gammaM, 2)} = ${fmt(md.fxd, 3)} MPa`,
    R.eff.formula,
    `Vorverformung e_0 = h_ef/${fmt(R.nImp, 0)} = ${fmt(R.eImp * 1000, 2)} mm (Richtung ungünstig)`,
    `Querschnittswiderstand (Spannungsblock): n_Rd = f_xd·(t − 2e)`,
    `Wandkopf: e_o = n_D·e_D/(n_W + n_D); Wandfuss: e_u (Eingabe)`,
  ].join('\n')));
  if (R.method === 'SIA') {
    nk.push(repP('Theorie 2. Ordnung: Wandstreifen b = 1 m, gelenkig gelagert, Knicklänge h_ef. Werkstoff ohne Zugfestigkeit, linear-elastisch (E_xd, mit Kriechen E_eff = E_xd/(1 + φ_{∞}·n_G/n_d)) und ideal-plastisch (f_xd). Die Krümmung folgt geschlossen aus dem gerissenen bzw. teilplastifizierten Rechteckquerschnitt; die Biegelinie wird iterativ bestimmt. Die Vertikallasten (inkl. Eigengewicht, bei festen Exzentrizitäten) werden bis zum Verlust des Gleichgewichts gesteigert: n_Rd = λ_u·n_Ed, η = 1/λ_u.'));
    nk.push(repTable(['Kombination', { label: 'n_d,o', num: true, digits: 1 }, { label: 'n_Rd,o', num: true, digits: 1 }, { label: 'n_d,u', num: true, digits: 1 }, { label: 'n_Rd,u', num: true, digits: 1 }, { label: 'λ_u', num: true, digits: 3 }, { label: 'z [m]', num: true, digits: 2 }, 'Versagen', 'η'],
      uls.map((c) => [c.name, c.nTop, c.top.nRd, c.nBot, c.bot.nRd, Number.isFinite(c.buck.xMax) ? c.buck.xMax : '>1000', c.buck.z, c.buck.mode, etaS(Math.max(c.checks.top.eta, c.checks.bot.eta, c.buck.eta))])));
    if (gc?.buck) {
      const b = gc.buck;
      nk.push(h('h3', {}, `Massgebende Kombination: ${gc.name}`));
      nk.push(repFormula([
        `E_eff = ${fmt(gc.Eeff / 1000, 0)} MPa (φ_eff = ${fmt(gc.phiEff, 3)})`,
        `λ_u = ${Number.isFinite(b.xMax) ? fmt(b.xMax, 3) : '> 1000'} → massgebender Schnitt z = ${fmt(b.z, 2)} m (${b.mode})`,
        `n_Rd = λ_u·n_Ed(z) = ${fmt(b.xMax, 3)}·${fmt(b.nEd, 1)} = ${fmt(b.nRd, 1)} kN/m;  Φ = n_Rd/(t·f_xd) = ${fmt(b.phi, 3)}`,
        `η = 1/λ_u = ${etaS(b.eta)} → ${okS(b.eta)}`,
      ].join('\n')));
    }
  } else {
    nk.push(repP('EN 1996-1-1, 6.1.2.2: Φ_i = 1 − 2·e_i/t mit e_i = M_id/N_id + e_he ± e_init ≥ 0.05·t; Wandmitte nach Anhang G: Φ_m = A_1·exp(−u²/2), A_1 = 1 − 2·e_mk/t, u = (λ − 0.063)/(0.73 − 1.17·e_mk/t), λ = h_ef/t·√(f_k/E), e_mk = e_m + e_k ≥ 0.05·t, e_k = 0.002·φ_{∞}·h_ef/t·√(t·e_m) (für h_ef/t > 15).'));
    nk.push(repTable(['Kombination', { label: 'Φ_o', num: true, digits: 3 }, { label: 'Φ_u', num: true, digits: 3 }, { label: 'e_mk [mm]', num: true, digits: 1 }, { label: 'Φ_m', num: true, digits: 3 }, { label: 'n_d,m', num: true, digits: 1 }, { label: 'n_Rd,m', num: true, digits: 1 }, 'η'],
      uls.map((c) => [c.name, c.en.top.phi, c.en.bot.phi, c.en.mid.emk * 1000, c.en.mid.phi, c.nMid, c.en.mid.nRd, etaS(Math.max(c.checks.top.eta, c.checks.bot.eta, c.checks.buckEN.eta))])));
  }
  nk.push(repFigure(snap(app, 'schnitt'), `Schnitt mit Stützlinie${gc ? ` (${gc.name})` : ''}, quer überhöht`));
  if (gc) nk.push(eccSvg(gc, R));
  sec.push({ title: 'Nachweis Normalkraft mit Knicken', content: nk });

  // ---------------------------------------------------------------- Schub
  const shearLC = R.combos.filter((c) => c.shear);
  if (shearLC.length) {
    const cont = [];
    if (R.shearMethod === 'SIA') {
      cont.push(repP('Spannungsfeld nach SIA 266: N und V werden über ein geneigtes, einachsiges Druckfeld in die Druckzone l_c am Wandfuss geleitet (Spannungsblock). Fliessbedingungen nach Ganz/Thürlimann ohne Kohäsion: Druckfeld σ_x/f_xd + σ_y/f_yd ≤ 1 mit σ_y = τ²/σ_x; Gleiten in der Lagerfuge τ ≤ μ·σ_x. Daraus folgt geschlossen:'));
      cont.push(repFormula('l_c = l − 2·V·h_0/N\nV_Rd,c = −t·h_0·f_yd + √((t·h_0·f_yd)² + f_yd·N·(t·l − N/f_xd))\nV_Rd,f = μ·N\nV_Rd = min(V_Rd,c; V_Rd,f)'));
      cont.push(repTable(['Kombination', { label: 'N_d [kN]', num: true, digits: 1 }, { label: 'V_d [kN]', num: true, digits: 1 }, { label: 'h_0 [m]', num: true, digits: 2 }, { label: 'V_Rd,c', num: true, digits: 1 }, { label: 'V_Rd,f', num: true, digits: 1 }, { label: 'l_c [m]', num: true, digits: 2 }, 'η'],
        shearLC.map((c) => [c.name, c.shear.N, c.shear.V, c.shear.h0, c.shear.Vstrut, c.shear.Vfric, c.shear.lc, etaS(c.checks.shear.eta)])));
    } else {
      cont.push(repP('EN 1996-1-1, 6.2: V_Rd = f_vd·t·l_c, f_vd = f_vk/γ_M, f_vk = f_vk0 + 0.4·σ_d ≤ f_vlt, σ_d = N_d/(t·l_c); l_c überdrückte Länge bei linearer Spannungsverteilung (gerissen l_c = 3·(l/2 − e), e = V_d·h_0/N_d). Zusätzlich N_Rd = f_xd·t·(l − 2e).'));
      cont.push(repTable(['Kombination', { label: 'N_d [kN]', num: true, digits: 1 }, { label: 'V_d [kN]', num: true, digits: 1 }, { label: 'l_c [m]', num: true, digits: 2 }, { label: 'f_vd [MPa]', num: true, digits: 3 }, { label: 'V_Rd [kN]', num: true, digits: 1 }, { label: 'N_Rd [kN]', num: true, digits: 1 }, 'η'],
        shearLC.map((c) => [c.name, c.shear.N, c.shear.V, c.shear.lc, c.shear.fvd / 1000, c.shear.VRd, c.shear.NRd, etaS(Math.max(c.checks.shearEN.eta, c.checks.shearN.eta))])));
    }
    cont.push(repFigure(snap(app, 'schub'), 'Wandscheibe mit Druckfeld und Spannungen am Wandfuss'));
    if (W.openings?.length) cont.push(repP('Öffnungen sind im Scheibennachweis nicht berücksichtigt; die Pfeiler sind bei Bedarf separat nachzuweisen.'));
    sec.push({ title: 'Querkraft in Wandebene', content: cont });
  }

  // ---------------------------------------------------------------- Teilfläche
  const concLC = R.combos.filter((c) => c.conc);
  if (concLC.length) {
    const q0 = concLC[0].conc;
    sec.push({
      title: 'Teilflächenbelastung',
      content: [
        repP('EN 1996-1-1, 6.1.3: N_Rdc = β·A_b·f_xd mit β = (1 + 0.3·a_1/h_c)·(1.5 − 1.1·A_b/A_ef), 1.0 ≤ β ≤ min(1.25 + a_1/(2h_c); 1.5), A_b/A_ef ≤ 0.45; A_ef = l_efm·t, l_efm wirksame Länge in Wandmitte bei Lastausbreitung unter 60°. Für Steine der Gruppen 2–4 gilt β = 1.0. Zusätzlich Nachweis der Normalkraft in Wandmitte mit Φ_m.'),
        repFormula(`A_b = ${fmt(q0.Ab * 1e4, 0)} cm², a_1 = ${fmt(q0.a1, 2)} m, h_c = ${fmt(W.h, 2)} m, l_efm = ${fmt(q0.lefm, 3)} m, A_b/A_ef = ${fmt(q0.ratio, 3)}, β = ${fmt(q0.beta, 3)}${md.solid ? '' : ' (Lochsteine: β = 1.0)'}`),
        repTable(['Kombination', { label: 'N_c,d [kN]', num: true, digits: 1 }, { label: 'N_Rdc [kN]', num: true, digits: 1 }, { label: 'n_Ed,m [kN/m]', num: true, digits: 1 }, { label: 'n_Rd,m [kN/m]', num: true, digits: 1 }, 'η'],
          concLC.map((c) => [c.name, c.conc.Nc, c.conc.NRdc, c.conc.nEdMid, c.conc.nRdMid, etaS(Math.max(c.checks.conc.eta, c.checks.concMid.eta))])),
      ],
    });
  }

  // ---------------------------------------------------------------- Querlast
  const latLC = R.combos.filter((c) => c.lat || c.basement);
  if (latLC.length) {
    const cont = [];
    cont.push(repP(`Die Querlast wird bei festen Vertikallasten der Kombination gesteigert, bis keine Gleichgewichtslage nach Th. 2. O. mehr existiert (Faktor μ_u, η = 1/μ_u).${S.arching !== false ? ' Bogenwirkung: Die Lage der Resultierenden am Wandfuss wird innerhalb des zulässigen Bereichs |eu| ≤ t/2 − nd,u/(2·fxd) so gewählt, dass μu maximal wird (statische Methode).' : ''}`));
    const withLat = latLC.filter((c) => c.lat);
    if (withLat.length) {
      cont.push(repTable(['Kombination', { label: 'p_d,max [kN/m²]', num: true, digits: 2 }, { label: 'n_d,m [kN/m]', num: true, digits: 1 }, { label: 'e_u [mm]', num: true, digits: 0 }, { label: 'μ_u', num: true, digits: 3 }, 'Versagen', 'η'],
        withLat.map((c) => [c.name, c.pMax, c.nMid, c.lat.eU * 1000, Number.isFinite(c.lat.xMax) ? c.lat.xMax : '>1000', c.lat.mode, etaS(c.lat.eta)])));
      const g = withLat.reduce((a, b) => ((Number.isFinite(b.lat.eta) ? b.lat.eta : 1e9) > (Number.isFinite(a.lat.eta) ? a.lat.eta : 1e9) ? b : a));
      if (g.lat.profile) cont.push(eccSvg(g, R, g.lat.profile, `Stützlinie unter Querlast – ${g.name}`));
    }
    const bas = latLC.filter((c) => c.basement);
    if (bas.length) {
      const b0 = bas[0].basement;
      cont.push(h('h3', {}, 'Kelleraussenwand nach EN 1996-3, 4.5'));
      cont.push(repFormula(`β = ${fmt(b0.beta, 0)} (b_c = ${fmt(S.bc, 2)} m)\nN_Ed,max ≤ t·f_d/3 = ${fmt(b0.NmaxRd, 1)} kN/m\nN_Ed,min ≥ ρ_e·h·h_e²/(β·t) = ${fmt(b0.NminReq, 1)} kN/m`));
      cont.push(repTable(['Kombination', { label: 'N_Ed [kN/m]', num: true, digits: 1 }, 'η max', 'η min'],
        bas.map((c) => [c.name, c.basement.N, etaS(c.checks.basMax.eta), etaS(c.checks.basMin.eta)])));
      cont.push(repP('Anwendungsgrenzen EN 1996-3, 4.5: h ≤ 2.6 m, t ≥ 200 mm, Decke wirkt als Scheibe, Auflast auf dem Gelände ≤ 5 kN/m², keine Einzellast > 15 kN näher als 1.5 m, kein hydrostatischer Druck, keine Gleitfuge (Sperrbahn) ohne Schubnachweis.'));
    }
    sec.push({ title: 'Querbelastung', content: cont });
  }

  // ---------------------------------------------------------------- Gebrauch
  const sls = R.combos.filter((c) => c.sls);
  sec.push({
    title: 'Gebrauchstauglichkeit und konstruktive Anforderungen',
    content: [
      repFormula(`h_ef/t = ${fmt(R.slender, 1)} ≤ ${fmt(R.lambdaLim, 0)} (EN 1996-1-1, 5.5.1.4) → ${okS(R.slender / R.lambdaLim)}`),
      sls.length ? repTable(['Kombination', { label: 'e_o [mm]', num: true, digits: 1 }, { label: 'e_m [mm]', num: true, digits: 1 }, { label: 'e_u [mm]', num: true, digits: 1 }, { label: 't/3 [mm]', num: true, digits: 1 }, 'η'],
        sls.map((c) => [c.name, c.sls.eTop * 1000, c.sls.eMid * 1000, c.sls.eBot * 1000, c.sls.lim * 1000, etaS(c.checks.crack.eta)])) : repP('Keine Kombination der Gebrauchstauglichkeit aktiv.'),
      repP('Klaffende Fuge: Unter charakteristischen Lasten soll die Resultierende innerhalb der Wanddicke so liegen, dass höchstens die halbe Fuge klafft (|e| ≤ t/3, Th. 1. O.). Empfehlung zur Rissbegrenzung; Grenzwerte projektspezifisch festlegen.'),
    ],
  });

  // ---------------------------------------------------------------- Annahmen
  sec.push({
    title: 'Annahmen und Grenzen',
    content: h('ul', {},
      [
        'Unbewehrtes Mauerwerk ohne Zugfestigkeit; Kohäsion (Haftscherfestigkeit) im SIA-Verfahren vernachlässigt.',
        'Wandstreifen gelenkig am Kopf und Fuss; Einspannwirkungen nur über die Exzentrizitäten (Eingabe) bzw. die Knicklänge.',
        'Knicklänge nach EN 1996-1-1, 5.5.1.2 (sinngemäss SIA 266); Vorverformung h_ef/450 (anpassbar).',
        'Exzentrizität aus Deckenverdrehung am Endauflager: Resultierende im Abstand a/3 vom Innenrand.',
        'Momente aus Querlast am einfachen Balken der Höhe h; Erddruck mit Ruhedruckbeiwert K (Eingabe).',
        'Öffnungen: Lastkonzentration auf die Pfeiler pauschal mit l/(l − Σb); Pfeiler, Stürze und Brüstungen sind gesondert nachzuweisen.',
        'Scheibe: N zentrisch am Wandkopf, V auf Höhe h_V; Wandkopf frei drehbar (h_0 = h_V) oder eingespannt (h_0 = h_V/2).',
        'Die Standardwerte der Mauerwerkskennwerte sind Richtwerte und müssen projektbezogen geprüft werden (SIA 266, Produktdatenblätter).',
        'Brandschutz, Erdbebenanforderungen an die Konstruktion (z.B. Mindestabmessungen) und Gebrauchstauglichkeit infolge Schwinden/Temperatur sind nicht Teil dieses Nachweises.',
      ].map((x) => h('li', {}, R_(x)))),
  });
  sec.forEach((x, i) => { x.title = `${i + 1} ${x.title}`; });
  return sec;
}

export const HELP = `
<h3>Zweck</h3>
<p>Nachweise für Wände aus unbewehrtem Mauerwerk nach SIA 266 (2015): Normalkraft mit Knicken, Querkraft in Wandebene (Schubwand), Teilflächenbelastung, Querbelastung (z.B. Kellerwand unter Erddruck) und Gebrauchstauglichkeit. Alle Nachweise werden bei jeder Eingabe sofort neu gerechnet.</p>
<h3>Grafische Eingabe</h3>
<p>Die Ansicht in der Mitte ist der Arbeitsbereich. Ein neues Projekt enthält eine Wand (2.60 × 5.00 m, 150 mm Backstein) ohne Lasten.</p>
<ul>
<li><b>Wand</b>: Klick auf die Wandfläche öffnet Abmessungen, Material und Halterung im Eigenschaftsfenster. Die Ecke oben rechts ziehen ändert Höhe und Länge, die Ecke oben links nur die Höhe, die Ecke unten rechts nur die Länge.</li>
<li><b>Öffnung</b> (O): Rechteck mit zwei Ecken aufziehen. Öffnungen lassen sich ziehen, an den Ecken in der Grösse ändern, kopieren (C) und löschen (Entf).</li>
<li><b>Auflast</b> (Q): Deckenoberkante anklicken – Auflasten aus der Wand darüber (zentrisch) und dem Deckenauflager (mit Exzentrizität).</li>
<li><b>Einzellast</b> (F): Stelle auf der Wandkrone anklicken (Teilflächenbelastung); entlang der Krone verschiebbar.</li>
<li><b>Horizontalkraft</b> (H): Wandrand auf der Höhe der Kraft anklicken (Schubwand); der Pfeil lässt sich senkrecht verschieben.</li>
<li><b>Querlast</b> (W): Wandfläche anklicken – Wind oder Erddruck senkrecht zur Wand (Symbol ⊗ neben der Wand).</li>
<li><b>Querwand</b> (K): linken oder rechten Wandrand anklicken – aussteifende Querwand ein/aus.</li>
<li>Im <b>Schnitt</b> öffnet ein Klick auf den Lastangriff am Wandkopf bzw. -fuss die Exzentrizitäten.</li>
<li>Fang an Punkten, Kanten und Raster; X/Y binden an eine Achse, Ziffern tippen Koordinaten, Esc bricht ab. Alle Werte sind zusätzlich in den Registern links verfügbar und bleiben synchron.</li>
<li>Die Lastkombinationen nach SIA 260 werden automatisch passend zu den erfassten Lasten erzeugt, solange sie nicht von Hand geändert werden.</li>
</ul>
<p>Unter <b>Herleitung</b> (rechts oben) steht der vollständige Rechenweg jedes Nachweises mit allgemeiner Formel, eingesetzten Werten, Ergebnis und Normbezug; «Herleitung ›» in den Nachweistabellen springt direkt dorthin.</p>
<h3>Verfahren</h3>
<ul>
<li><b>Bemessungswerte</b>: f<sub>xd</sub> = f<sub>xk</sub>/γ<sub>M</sub>, f<sub>yd</sub> = f<sub>yk</sub>/γ<sub>M</sub> mit γ<sub>M</sub> = 2.0 (SIA 266, 2.2.5).</li>
<li><b>Normalkraft mit Knicken (SIA)</b>: Spannungsblock n<sub>Rd</sub> = f<sub>xd</sub>·(t − 2e) für den Querschnitt (SIA 266, 4.3). Die Schlankheit wird mit einer numerischen Berechnung nach Theorie 2. Ordnung erfasst: Wandstreifen ohne Zugfestigkeit, linear-elastisch (E<sub>xd</sub> = E<sub>xk</sub>/γ<sub>E</sub>) – ideal-plastisch (f<sub>xd</sub>), Vorverformung h<sub>ef</sub>/450, Kriechen über E<sub>eff</sub> = E<sub>xd</sub>/(1 + φ<sub>∞</sub>·n<sub>G</sub>/n<sub>d</sub>). Die Vertikallast wird gesteigert, bis keine Gleichgewichtslage mehr existiert; daraus folgt n<sub>Rd</sub> = λu·nEd. Das Verfahren entspricht der mechanischen Grundlage der Bemessungsdiagramme von SIA 266 bzw. EN 1996-1-1 Anhang G (zum Vergleich als Knickkurve dargestellt).</li>
<li><b>Normalkraft (EN)</b>: alternativ Φi = 1 − 2ei/t und Φm nach EN 1996-1-1, Anhang G.</li>
<li><b>Querkraft in Wandebene (SIA)</b>: Spannungsfeld mit geneigtem Druckfeld über der Druckzone am Wandfuss, Fliessbedingungen nach Ganz/Thürlimann (Grundlage SIA 266) ohne Kohäsion: V<sub>Rd</sub> = min(−t·h<sub>0</sub>·f<sub>yd</sub> + √((t·h<sub>0</sub>·f<sub>yd</sub>)² + f<sub>yd</sub>·N·(t·l − N/f<sub>xd</sub>)); μ·N). Alternativ EN 1996-1-1, 6.2 (fvk = f<sub>vk0</sub> + 0.4·σd).</li>
<li><b>Teilflächenbelastung</b>: EN 1996-1-1, 6.1.3 (Erhöhungsfaktor β nur für Vollsteine, Lastausbreitung 60°).</li>
<li><b>Querbelastung</b>: Stützlinie nach Th. 2. O.; die Querlast wird bis zum Versagen gesteigert. Optional Bogenwirkung (Lage der Resultierenden am Wandfuss frei) und vereinfachter Kellerwandnachweis nach EN 1996-3, 4.5.</li>
<li><b>Gebrauchstauglichkeit</b>: Schlankheit h<sub>ef</sub>/t ≤ 27 und klaffende Fuge |e| ≤ t/3 unter charakteristischen Lasten (Empfehlung).</li>
</ul>
<h3>Vorzeichen</h3>
<p>Exzentrizitäten und Querlasten sind positiv in Richtung Raumseite (+x). Eine Querlast von aussen (Wind, Erddruck) wirkt also positiv. Die Deckenverdrehung an einem Endauflager verschiebt die Resultierende ebenfalls zur Raumseite.</p>
<h3>Zu prüfende Werte</h3>
<ul>
<li>Mauerwerkskennwerte f<sub>xk</sub>, f<sub>yk</sub>, E<sub>xk</sub>, μ, φ<sub>∞</sub>, f<sub>vk0</sub> und fb: Die Standardwerte sind Richtwerte. Massgebend sind SIA 266 bzw. die Produktdaten des Herstellers.</li>
<li>γE für den E-Modul in der Th. 2. O. (Standard γ<sub>E</sub> = γ<sub>M</sub>) und die Vorverformung h<sub>ef</sub>/450.</li>
<li>Knickbeiwerte ρ nach EN 1996-1-1 (sinngemäss SIA 266).</li>
<li>Erddruckbeiwert K (Ruhedruck K0 ≈ 1 − sin φ').</li>
</ul>
<h3>Grenzen</h3>
<ul>
<li>Bewehrtes Mauerwerk, Brandfall und Erdbebennachweise mit Verformungsvermögen (SIA 261) sind nicht enthalten; die Erdbebenkraft ist als Bemessungswert einzugeben.</li>
<li>Öffnungen werden nur pauschal berücksichtigt (Lastkonzentration); Pfeiler und Stürze separat nachweisen.</li>
<li>Die Wand wird als einzelner Streifen bzw. als Kragscheibe betrachtet; Zusammenwirken mit Querwänden (Flansche) ist nicht berücksichtigt.</li>
</ul>
<p class="muted">Ergebnisse ohne Gewähr. Die Verantwortung für Eingaben und Interpretation liegt beim Anwender.</p>
`;

export const INTRO = `<h4>So funktioniert's</h4>
<ol>
<li>Die Wand ist angelegt: <b>Ecke oben rechts ziehen</b> ändert Höhe und Länge, Klick auf die Wand zeigt Abmessungen und Material.</li>
<li>Lasten mit den Werkzeugen über der Grafik setzen: <b>Auflast</b> (Q) auf die Deckenoberkante, <b>Einzellast</b> (F), <b>Horizontalkraft</b> (H), <b>Querlast</b> (W); <b>Öffnung</b> (O) aufziehen.</li>
<li>Angeklicktes im Eigenschaftsfenster bearbeiten – alle Werte auch in den Registern links.</li>
<li>Rechts Nachweise und <b>Herleitung</b> lesen, Schnitt/Schub umschalten, Bericht erstellen.</li>
</ol>`;
