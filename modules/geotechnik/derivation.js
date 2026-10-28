// Herleitung (Rechenweg) Geotechnik: allgemeine Formel, eingesetzte Werte, Ergebnis und Normbezug
import { num } from '../../js/core/formula.js';
import { makeSoil, verticalStress, rad } from './soil.js';
import { wedgeLoadFactor } from './earthpressure.js';
import { cornerFactor, stripFactor, circleFactor } from './settlement.js';
import { bishopHistory } from './slope.js';

const d1 = (x) => num(x, 1), d2 = (x) => num(x, 2), d3 = (x) => num(x, 3), d4 = (x) => num(x, 4);
const deg = (x) => `${d1(x)}°`;
const ok = (eta) => (Number.isFinite(eta) && eta <= 1.0001 ? 'erfüllt' : 'nicht erfüllt');
const st = (label, f, v, r, extra = {}) => ({ label, f, v, r, ...extra });

export function derivation(app) {
  const r = app.results;
  if (!r || r.type !== app.project.analysis) return [];
  const fn = { erddruck: dEP, grundbruch: dBC, setzung: dST, boeschung: dSL, stuetzmauer: dRW }[r.type];
  return fn ? fn(r, app.project) : [];
}

// ------------------------------------------------------------------ Erddruck

/** Abschnitte der Erddruckverteilung (auch für die Ersatzwand der Stützmauer). */
function epSections(R, n, p, opts = {}) {
  const pre = opts.prefix || 'ep';
  const passive = R.kind === 'passive';
  const out = [];
  const kSteps = [];
  const al = R.alpha || 0, be = R.beta || 0;
  for (const K of R.layers) {
    if (passive) {
      const dp = K.deltaP || 0;
      if (p.passiveMethod === 'coulomb') {
        kSteps.push(st(`${K.name}: Erdwiderstand (ebene Gleitfläche)`, 'K_pgh = cos^2(φ+α) / {cos^2α·[1 − sqrt(sin(φ+δ_p)·sin(φ+β) / (cos(α−β)·cos(α−δ_p)))]^2}',
          `= cos^2(${deg(K.phi)}+${deg(al)}) / {cos^2(${deg(al)})·[1 − sqrt(sin(${deg(K.phi)}+${deg(dp)})·sin(${deg(K.phi)}+${deg(be)}) / (cos(${deg(al)}−${deg(be)})·cos(${deg(al)}−${deg(dp)})))]^2}`, `= ${d4(K.Kgh)}`, { ref: 'DIN 4085 (Coulomb)' }));
      } else {
        const p0 = rad(K.phi), dd = rad(dp);
        const t2 = K.phi > 0 ? Math.asin(Math.min(1, Math.sin(dd) / Math.sin(p0))) + dd : 0;
        kSteps.push(st(`${K.name}: Erdwiderstand (gekrümmte Gleitfläche)`, 'K_p = cos δ_p/(1 − sin φ)·[cos δ_p + sqrt(sin^2φ − sin^2δ_p)]·e^{2θ·tan φ},  2θ = asin(sin δ_p/sin φ) + δ_p',
          `2θ = ${deg(t2 * 180 / Math.PI)} → K_p = cos ${deg(dp)}/(1 − sin ${deg(K.phi)})·[cos ${deg(dp)} + sqrt(sin^2${deg(K.phi)} − sin^2${deg(dp)})]·e^{${d3(t2)}·tan ${deg(K.phi)}}`, `= ${d4(K.Kgh)}`,
          { ref: 'Lancellotta (2002)', note: al || be ? 'Für α, β ≠ 0 mit dem Verhältnis der Coulomb-Werte (δ = 0) korrigiert.' : '' }));
      }
      kSteps.push(st('Kohäsionsbeiwert', p.passiveMethod === 'coulomb' ? 'K_pch = 2·cos(α−β)·cos φ·cos(α−δ_p) / [(1 − sin(φ−α+δ_p+β))·cos β]' : 'K_pch = 2·sqrt(K_pgh)', '', `= ${d4(K.Kch)}`));
      continue;
    }
    const dl = K.delta;
    kSteps.push(st(`${K.name}: aktiver Erddruck (Coulomb${opts.rankine ? ', δ = β' : ''})`,
      'K_agh = cos^2(φ−α) / {cos^2α·[1 + sqrt(sin(φ+δ)·sin(φ−β) / (cos(α−β)·cos(α+δ)))]^2}',
      `= cos^2(${deg(K.phi)}−${deg(al)}) / {cos^2(${deg(al)})·[1 + sqrt(sin(${deg(K.phi)}+${deg(dl)})·sin(${deg(K.phi)}−${deg(be)}) / (cos(${deg(al)}−${deg(be)})·cos(${deg(al)}+${deg(dl)})))]^2}`,
      `= ${d4(K.Kah)}`, { ref: 'DIN 4085', note: 'Horizontalkomponente; die geneigte Resultierende ist K_a = K_agh/cos(α+δ).' }));
    if (K.c > 0) kSteps.push(st('Kohäsionsbeiwert', 'K_ach = 2·cos(α−β)·cos φ·cos(α+δ) / [(1 + sin(φ+α+δ−β))·cos β]',
      `= 2·cos(${deg(al)}−${deg(be)})·cos ${deg(K.phi)}·cos(${deg(al)}+${deg(dl)}) / [(1 + sin(${deg(K.phi + al + dl - be)}))·cos ${deg(be)}]`, `= ${d4(K.Kach)}`));
    if (R.q > 0 && (al || be)) kSteps.push(st('Auflastbeiwert', 'K_aqh = K_agh·cos α·cos β / cos(α−β)', `= ${d4(K.Kah)}·cos ${deg(al)}·cos ${deg(be)}/cos(${deg(al - be)})`, `= ${d4(K.Kaqh)}`));
    if (R.kind === 'atrest' || R.kind === 'increased') {
      kSteps.push(st('Erdruhedruck', 'K_0 = (1 − sin φ)·sqrt(OCR)·(1 + sin β)', `= (1 − sin ${deg(K.phi)})·sqrt(${d2(p.ocr || 1)})·(1 + sin ${deg(be)})`, `= ${d4(K.K0)}`, { ref: 'EN 1997-1, 9.5.2' }));
    }
    if (R.kind === 'increased') kSteps.push(st('Erhöhter aktiver Erddruck', 'K_h = K_agh + μ·(K_0 − K_agh)', `= ${d4(K.Kah)} + ${d2(p.mu)}·(${d4(K.K0)} − ${d4(K.Kah)})`, `= ${d4(K.Kgh)}`));
    if (K.theta) kSteps.push(st('Neigung der Gleitfuge (Maximum des Coulomb-Keils)', 'ϑ_a', '', `= ${deg(K.theta)}`));
  }
  out.push({ id: `${pre}-k`, title: 'Erddruckbeiwerte', ref: 'DIN 4085 · EN 1997-1, Anh. C · SIA 267', intro: passive ? 'Erdwiderstand: Beiwerte für die Horizontalkomponente mit nach oben gerichteter Wandreibung δ_p.' : `Beiwerte je Schicht für die Horizontalkomponente des Erddrucks (α = ${deg(al)}, β = ${deg(be)}).`, steps: kSteps });

  // Ordinaten je Schicht
  const groups = [];
  for (const q of R.pts) {
    const g = groups[groups.length - 1];
    if (g && g.idx === q.layerIdx) g.pts.push(q); else groups.push({ idx: q.layerIdx, pts: [q] });
  }
  const eSteps = [];
  const sgn = passive ? '+' : '−';
  const gw = R.pts.some((q) => q.u > 0);
  eSteps.push(st('Vertikale Überlagerung', "σ'_v(z) = Σ γ_i·Δz_i", '', '', { note: gw ? "Unter dem Grundwasserspiegel mit γ' (Auftrieb); der Wasserdruck u = γ_w·(z − z_w) wirkt zusätzlich." : 'Mit dem Raumgewicht γ der jeweiligen Schicht.' }));
  for (const g of groups) {
    const K = R.layers.find((x) => x.idx === g.idx);
    if (!K) continue;
    for (const [lab, q] of [['oben', g.pts[0]], ['unten', g.pts[g.pts.length - 1]]]) {
      const zz = q.z - R.zTop;
      const raw = passive ? K.Kgh * q.svp + K.Kqh * R.q + K.Kch * K.c : K.Kgh * q.svp + K.Kqh * R.q - K.Kch * K.c;
      const extra = Math.abs(q.eh - Math.max(0, raw)) > 0.05 ? ` (inkl. Streifenlasten bzw. Mindesterddruck: ${d1(q.eh)})` : '';
      eSteps.push(st(`${K.name}, ${lab} (z = ${d2(zz)} m)`, `e_h = K_h·σ'_v + K_qh·q ${sgn} K_ch·c'`,
        `= ${d4(K.Kgh)}·${d1(q.svp)} + ${d4(K.Kqh)}·${d1(R.q)} ${sgn} ${d4(K.Kch)}·${d1(K.c)}`,
        `= ${d1(raw)}${!passive && raw < 0 ? ' → 0 (Zugspannung abgeschnitten)' : ''} kN/m²${extra}`));
    }
  }
  if (R.zCrack > 1e-6) eSteps.push(st('Tiefe der Zugzone (e_h = 0)', 'z_c', '', `= ${d2(R.zCrack)} m`, { note: 'In der Zugzone wird kein Erddruck angesetzt (keine Zugspannungen zwischen Boden und Wand).' }));
  if (R.U > 0) {
    const last = R.pts[R.pts.length - 1];
    eSteps.push(st('Wasserdruck am Wandfuss', 'u = γ_w·(z − z_w)', '', `= ${d1(last.u)} kN/m²`));
  }
  out.push({ id: `${pre}-e`, title: passive ? 'Erdwiderstand über die Tiefe' : 'Erddruckordinaten', ref: 'DIN 4085 · SIA 267', steps: eSteps });

  // Resultierende
  const rSteps = [];
  for (const g of groups) {
    const K = R.layers.find((x) => x.idx === g.idx);
    let E = 0, M = 0;
    for (let i = 0; i < g.pts.length - 1; i++) {
      const A = g.pts[i], B = g.pts[i + 1], dz = B.z - A.z;
      if (dz <= 0) continue;
      E += (A.eh + B.eh) / 2 * dz;
      M += dz * (A.eh * (2 * A.z + B.z) + B.eh * (A.z + 2 * B.z)) / 6;
    }
    const top = g.pts[0], bot = g.pts[g.pts.length - 1];
    rSteps.push(st(`Anteil ${K?.name ?? ''} (${d2(top.z - R.zTop)} … ${d2(bot.z - R.zTop)} m)`, 'E_i = ∫ e_h dz ≈ (e_oben + e_unten)/2·d_i',
      `≈ (${d1(top.eh)} + ${d1(bot.eh)})/2·${d2(bot.z - top.z)}`, `= ${d1(E)} kN/m`, { note: E > 0 ? `Schwerpunkt in z = ${d2(M / E - R.zTop)} m (numerische Integration über ${g.pts.length} Stützstellen).` : '' }));
  }
  rSteps.push(st('Horizontale Resultierende', 'E_h = Σ E_i = E_h,G + E_h,Q', `= ${d1(R.EhG)} + ${d1(R.EhQ)}`, `= ${d1(R.Eh)} kN/m`));
  rSteps.push(st('Lage der Resultierenden', 'z_E = Σ E_i·z_i / E_h,   h_E = H − z_E', `h_E = ${d2(R.H)} − ${d2(R.zE - R.zTop)}`, `= ${d2(R.hE)} m über dem Fuss`));
  rSteps.push(st(passive ? 'Vertikalkomponente (nach oben)' : 'Vertikalkomponente', passive ? 'E_pv = Σ E_i·tan(δ_p − α)' : 'E_v = Σ E_i·tan(α + δ)', '', `= ${d1(R.Ev)} kN/m`));
  if (R.U > 0) rSteps.push(st('Wasserdruck', 'W = ½·γ_w·h_w^2', '', `= ${d1(R.U)} kN/m, Angriff ${d2(R.hU)} m über dem Fuss`));
  if (opts.design !== false) {
    if (passive) rSteps.push(st('Bemessungswert (Widerstand)', 'E_ph,d = E_ph,k / γ_R,e', `= ${d1(R.Eh)} / ${d2(n.gRe)}`, `= ${d1(R.Ed)} kN/m`, { ref: 'SIA 267 / EN 1997-1, 2.4.7.3' }));
    else rSteps.push(st('Bemessungswert (Einwirkung)', 'E_d = γ_G·(E_h,G + W) + γ_Q·E_h,Q', `= ${d2(n.gG)}·(${d1(R.EhG)} + ${d1(R.U)}) + ${d2(n.gQ)}·${d1(R.EhQ)}`, `= ${d1(R.Ed)} kN/m`, { ref: 'SIA 260, Tab. 1' }));
    if (R.Mbase !== undefined) rSteps.push(st('Moment am Wandfuss', 'M_k = E_h·h_E + W·h_W', `= ${d1(R.Eh)}·${d2(R.hE)} + ${d1(R.U)}·${d2(R.hU)}`, `= ${d1(R.Mbase)} kNm/m (M_d = ${d1(R.Mbased)} kNm/m)`));
  }
  out.push({ id: `${pre}-E`, title: 'Resultierende und Angriffspunkt', steps: rSteps });

  // Streifen- und Linienlasten
  const strips = (R.strips || []).filter((s) => s.dE > 0);
  if (strips.length) {
    const K0 = R.layers[0];
    const kap = K0?.theta ? wedgeLoadFactor({ phi: K0.phi, delta: K0.delta, alpha: al }, K0.theta) : NaN;
    out.push({
      id: `${pre}-strip`, title: 'Streifen- und Linienlasten', ref: 'DIN 4085 / EAB (vereinfachte Verteilung)',
      intro: 'Zusatzerddruck aus dem Coulomb-Krafteck mit der Gleitfuge ϑ_a der obersten Schicht; Verteilung zwischen z_1 = a·tan φ und z_2 = (a+b)·tan ϑ_a.',
      steps: [
        st('Krafteckfaktor', 'κ = sin(ϑ_a − φ)·cos(α + δ) / cos(ϑ_a − φ − α − δ)', `= sin(${deg(K0.theta)} − ${deg(K0.phi)})·cos(${deg(al + K0.delta)}) / cos(${deg(K0.theta - K0.phi - al - K0.delta)})`, `= ${d4(kap)}`),
        ...strips.map((s, k) => st(`${s.type === 'line' ? 'Linienlast' : 'Streifenlast'} ${k + 1} (p = ${d1(+s.p)}, a = ${d2(+s.a)} m${s.type === 'line' ? '' : `, b = ${d2(+s.b)} m`})`,
          s.type === 'line' ? 'ΔE_h = P·κ,  e_max = 2·ΔE_h/(z_2 − z_1)' : 'ΔE_h = p·b_eff·κ,  Δe = ΔE_h/(z_2 − z_1)',
          `z_1 = ${d2(s.z1)} m, z_2 = ${d2(s.z2)} m`, `ΔE_h = ${d1(s.dE)} kN/m, e = ${d1(s.emax)} kN/m²`)),
      ],
    });
  }
  return out;
}

function dEP(r, p) {
  return epSections(r.ep, r.norm, p.ep, { rankine: p.ep.method === 'rankine' && p.ep.kind !== 'passive' });
}

// ------------------------------------------------------------------ Grundbruch (auch Stützmauer)

function bearingSteps(g, n, strip, unit) {
  const G = g.gov;
  const steps = [];
  if (G.drained) {
    const phi = g.soil.phi, tp = Math.tan(rad(phi));
    steps.push(st('Tragfähigkeitsbeiwert N_q', 'N_q = e^{π·tan φ}·tan^2(45° + φ/2)', `= e^{π·tan ${deg(phi)}}·tan^2(${deg(45 + phi / 2)})`, `= ${d2(G.N.Nq)}`, { ref: 'EN 1997-1, D.4' }));
    if (phi > 0) steps.push(st('N_c', 'N_c = (N_q − 1)·cot φ', `= (${d2(G.N.Nq)} − 1)·cot ${deg(phi)}`, `= ${d2(G.N.Nc)}`));
    steps.push(st('N_γ (rauhe Sohle)', 'N_γ = 2·(N_q − 1)·tan φ', `= 2·(${d2(G.N.Nq)} − 1)·${d4(tp)}`, `= ${d2(G.N.Ng)}`));
    const ratio = strip ? 0 : g.eff.Bp / g.eff.Lp;
    steps.push(st('Formbeiwerte', "s_q = 1 + (B'/L')·sin φ,  s_γ = 1 − 0.3·B'/L',  s_c = (s_q·N_q − 1)/(N_q − 1)", strip ? 'Streifen: B\'/L\' = 0' : `B'/L' = ${d3(ratio)}`, `s_q = ${d3(G.s.q)}, s_γ = ${d3(G.s.g)}, s_c = ${d3(G.s.c)}`));
    if (g.H > 0) {
      steps.push(st('Exponent der Lastneigung', strip ? 'm = m_B = 2' : "m = m_L·cos^2θ + m_B·sin^2θ,  m_B = (2 + B'/L')/(1 + B'/L')", '', `= ${d3(G.m)}`));
      steps.push(st('Neigungsbeiwerte', "i_q = [1 − H/(V + A'·c'·cot φ)]^m,  i_γ = [1 − H/(V + A'·c'·cot φ)]^{m+1},  i_c = i_q − (1 − i_q)/(N_c·tan φ)",
        `H/V = ${d1(g.H)}/${d1(g.ld.V)}`, `i_q = ${d3(G.i.q)}, i_γ = ${d3(G.i.g)}, i_c = ${d3(G.i.c)}`));
    }
    if (G.b.q < 1) steps.push(st('Sohlneigungsbeiwerte', 'b_q = b_γ = (1 − α·tan φ)^2,  b_c = b_q − (1 − b_q)/(N_c·tan φ)', '', `b_q = ${d3(G.b.q)}, b_c = ${d3(G.b.c)}`));
    steps.push(st('Grundbruchwiderstand je Flächeneinheit', "R/A' = c'·N_c·b_c·s_c·i_c + q'·N_q·b_q·s_q·i_q + 0.5·γ'·B'·N_γ·b_γ·s_γ·i_γ",
      `= ${d1(g.soil.c)}·${d2(G.N.Nc)}·${d3(G.b.c)}·${d3(G.s.c)}·${d3(G.i.c)} + ${d1(g.soil.qEff)}·${d2(G.N.Nq)}·${d3(G.b.q)}·${d3(G.s.q)}·${d3(G.i.q)} + 0.5·${d1(g.soil.gammaEff)}·${d3(g.eff.Bp)}·${d2(G.N.Ng)}·${d3(G.b.g)}·${d3(G.s.g)}·${d3(G.i.g)}`,
      `= ${d1(G.terms.c)} + ${d1(G.terms.q)} + ${d1(G.terms.g)} = ${d1(G.r)} kN/m²`, { ref: 'EN 1997-1, D.4 · SIA 267' }));
  } else {
    steps.push(st('Undrainierter Zustand', 'N_c = π + 2', '', '= 5.14', { ref: 'EN 1997-1, D.3' }));
    steps.push(st('Formbeiwert', "s_c = 1 + 0.2·B'/L'", '', `= ${d3(G.s.c)}`));
    if (g.H > 0) steps.push(st('Neigungsbeiwert', "i_c = ½·[1 + sqrt(1 − H/(A'·c_u))]", `= ½·[1 + sqrt(1 − ${d1(g.H)}/(${d3(g.eff.A)}·${d1(G.cu)}))]`, `= ${d3(G.i.c)}`));
    steps.push(st('Grundbruchwiderstand je Flächeneinheit', "R/A' = (π+2)·c_u·b_c·s_c·i_c + q", `= 5.14·${d1(G.cu)}·${d3(G.b.c)}·${d3(G.s.c)}·${d3(G.i.c)} + ${d1(G.q)}`, `= ${d1(G.r)} kN/m²`, { ref: 'EN 1997-1, D.3 · SIA 267' }));
  }
  steps.push(st('Charakteristischer Widerstand', "R_k = (R/A')·A'", `= ${d1(G.r)}·${d3(g.eff.A)}`, `= ${d1(g.R)} ${unit}`));
  steps.push(st('Bemessungswert', 'R_d = R_k / γ_R,v', `= ${d1(g.R)} / ${d2(n.gRv)}`, `= ${d1(g.Rd)} ${unit}`, { ref: 'SIA 267 / EN 1997-1, Tab. A.5' }));
  steps.push(st('Nachweis', 'V_d <= R_d', `${d1(g.ld.V)} <= ${d1(g.Rd)}`, `η = ${d2(g.eta)}`));
  return steps;
}

function soilSteps(g, n, applyM) {
  const steps = [st("Bodenkennwerte unter der Sohle (bis 2·B')", "tan φ = Σ tan φ_i·d_i / Σ d_i,  c = Σ c_i·d_i / Σ d_i", `Schichten: ${g.soil.layers.map((l) => l.name).join(', ')}; Tiefe 2B' = ${d2(g.soil.depth)} m`,
    g.gov.drained ? `φ = ${deg(g.soil.phi)}, c' = ${d1(g.soil.c)} kN/m²` : `c_u = ${d1(g.soil.cu)} kN/m²`, { note: applyM ? `Bemessungswerte: tan φ_d = tan φ_k/${d2(n.gPhi)}, c_d = c_k/${d2(n.gC)}, c_u,d = c_u,k/${d2(n.gCu)}.` : 'Charakteristische Werte (Sicherheit über γ_R,v).' })];
  steps.push(st("Raumgewicht unter der Sohle (bis B')", "γ' = Σ γ_i·d_i / Σ d_i  (unter GW mit γ')", '', `= ${d1(g.soil.gammaEff)} kN/m³`));
  steps.push(st('Seitliche Überlagerung in Sohltiefe', g.gov.drained ? "q' = σ'_v(D)" : 'q = σ_v(D)', '', `= ${d1(g.gov.drained ? g.soil.qEff : g.soil.qTot)} kN/m²`));
  return steps;
}

function dBC(r) {
  const R = r.bc, n = r.norm, g = R.gov, strip = R.shape === 'strip';
  const U = strip ? 'kN/m' : 'kN', UM = strip ? 'kNm/m' : 'kNm';
  const out = [];
  const lSteps = [];
  if (R.Wf + R.Ws > 0) lSteps.push(st('Eigengewicht Fundament und Auflast', 'G_F = A·γ_c·t + A·σ_v(D − t)', `= ${d3(R.area)}·25·${d2(R.t)} + ${d3(R.area)}·σ_v`, `= ${d1(R.Wf)} + ${d1(R.Ws)} = ${d1(R.Wf + R.Ws)} ${U}`));
  lSteps.push(st('Lasten in der Sohle (charakteristisch)', 'V_G,  M_B = M_B,OK + H_B·t', `G: V = ${d1(R.G.V)}, H_B = ${d1(R.G.HB)}, M_B = ${d1(R.G.MB)}`, `Q: V = ${d1(R.Q.V)}, H_B = ${d1(R.Q.HB)}, M_B = ${d1(R.Q.MB)}`));
  if (!g.error) {
    const ld = g.ld;
    lSteps.push(st('Massgebende Kombination', 'V_d = γ_G·V_G + γ_Q·V_Q', `= ${d2(ld.gG)}·${d1(R.G.V)} + ${d2(ld.gQ)}·${d1(R.Q.V)}`, `= ${d1(ld.V)} ${U}`, { ref: 'SIA 260, Tab. 1', note: 'Untersucht werden alle Kombinationen ständig ungünstig/günstig × veränderlich mit/ohne; massgebend ist die grösste Ausnutzung.' }));
    lSteps.push(st('', 'H_d = sqrt(H_B,d^2 + H_L,d^2),  M_B,d = γ_G·M_B,G + γ_Q·M_B,Q', '', `H_d = ${d1(g.H)} ${U}, M_B,d = ${d1(ld.MB)} ${UM}${strip ? '' : `, M_L,d = ${d1(ld.ML)} ${UM}`}`));
  }
  out.push({ id: 'bc-load', title: 'Einwirkungen', ref: 'SIA 260 / EN 1990', steps: lSteps });
  if (g.error) { out.push({ id: 'bc-R', title: 'Grundbruch', intro: g.error, steps: [], result: { eta: Infinity, text: g.error } }); return out; }
  const aSteps = [st('Lastausmitte', 'e_B = M_B,d / V_d', `= ${d1(g.ld.MB)} / ${d1(g.ld.V)}`, `= ${d3(g.eB)} m`)];
  if (R.shape === 'circle') {
    aSteps.push(st('Wirksame Fläche (Kreis)', "A' = 2·[r^2·acos(e/r) − e·sqrt(r^2 − e^2)]", `r = ${d3(R.B / 2)} m, e = ${d3(Math.hypot(g.eB, g.eL))} m`, `A' = ${d3(g.eff.A)} m², B' = ${d3(g.eff.Bp)} m, L' = ${d3(g.eff.Lp)} m`, { ref: 'API RP 2GEO (Ersatzrechteck)' }));
  } else {
    aSteps.push(st('Wirksame Breite (Meyerhof)', "B' = B − 2·|e_B|", `= ${d3(R.B)} − 2·${d3(Math.abs(g.eB))}`, `= ${d3(R.B - 2 * Math.abs(g.eB))} m`, { ref: 'EN 1997-1, D.1 · SIA 267' }));
    if (!strip) {
      aSteps.push(st('', 'e_L = M_L,d / V_d,  L\' = L − 2·|e_L|', `= ${d3(R.L)} − 2·${d3(Math.abs(g.eL))}`, `= ${d3(R.L - 2 * Math.abs(g.eL))} m`));
      aSteps.push(st('Wirksame Fläche', "A' = B'·L'", `= ${d3(g.eff.Bp)}·${d3(g.eff.Lp)}`, `= ${d3(g.eff.A)} m²`, { note: g.eff.swapped ? "B' und L' vertauscht, da B' ≤ L' gelten muss." : '' }));
    }
  }
  aSteps.push(st('Sohlspannung', "σ_d = V_d / A'", `= ${d1(g.ld.V)} / ${d3(g.eff.A)}`, `= ${d1(g.sigma)} kN/m²`));
  out.push({ id: 'bc-area', title: 'Wirksame Fläche', ref: 'EN 1997-1, Anh. D', steps: aSteps });
  out.push({ id: 'bc-soil', title: 'Bodenkennwerte', ref: 'SIA 267 · EN 1997-1, 2.4.5', steps: soilSteps(g, n, R.applyM) });
  out.push({ id: 'bc-R', title: `Grundbruch (${g.gov.drained ? 'drainiert' : 'undrainiert'})`, ref: 'EN 1997-1, 6.5.2 / Anh. D · SIA 267', steps: bearingSteps(g, n, strip, U), result: { eta: g.eta, text: `V_d = ${d1(g.ld.V)} ${U} <= R_d = ${d1(g.Rd)} ${U} → ${ok(g.eta)}` } });
  const s = R.govS;
  out.push({
    id: 'bc-slide', title: 'Gleiten', ref: 'EN 1997-1, 6.5.3 · SIA 267',
    steps: [
      st('Horizontale Bemessungslast', 'H_d = γ_G·H_G + γ_Q·H_Q', '', `= ${d1(s.Hd)} ${U}`),
      s.type === 'undrainiert'
        ? st('Gleitwiderstand (undrainiert)', "R_h,d = A'·c_u / γ_R,h", '', `= ${d1(s.Rd)} ${U}`)
        : st('Gleitwiderstand (drainiert)', 'R_h,d = γ_G,inf·V_G·tan δ_b / γ_R,h', `= ${d2(n.gGinf)}·${d1(R.G.V)}·tan ${deg(R.slDelta)} / ${d2(n.gRh)}`, `= ${d1(s.Rd)} ${U}`, { note: 'Sohlreibung δ_b = φ (Ortbeton) bzw. ⅔·φ (Fertigteil), EN 1997-1, 6.5.3 (10).' }),
      st('Nachweis', 'H_d <= R_h,d', `${d1(s.Hd)} <= ${d1(s.Rd)}`, `η = ${d2(s.eta)}`),
    ],
    result: { eta: s.eta, text: `H_d = ${d1(s.Hd)} <= R_h,d = ${d1(s.Rd)} → ${ok(s.eta)}` },
  });
  const ep = R.eccPerm, ed = R.eccDesign;
  const rect = R.shape === 'rect';
  out.push({
    id: 'bc-ecc', title: 'Ausmittigkeit', ref: 'EN 1997-1, 6.5.4 · SIA 267',
    steps: [
      st('Ständige Lasten (charakteristisch)', 'e_B = M_B,G / V_G', `= ${d1(R.G.MB)} / ${d1(R.G.V)}`, `= ${d3(R.eG.eB)} m`),
      rect ? st('Resultierende im Kern', 'e_B/B + e_L/L <= 1/6', `${d3(Math.abs(R.eG.eB))}/${d2(R.B)} + ${d3(Math.abs(R.eG.eL))}/${d2(R.L)} = ${d4(ep.kern / 6)}`, `η = ${d2(ep.kern)}`)
        : st('Resultierende im Kern', R.shape === 'circle' ? 'e <= r/4' : 'e <= B/6', `${d3(ep.e)} <= ${d3(ep.limKern)}`, `η = ${d2(ep.kern)}`),
      ed ? (rect ? st('Bemessung: klaffende Fuge höchstens bis zum Schwerpunkt', '(e_B/B)^2 + (e_L/L)^2 <= 1/9', '', `η = ${d2(ed.gap)}`)
        : st('Bemessung: klaffende Fuge höchstens bis zum Schwerpunkt', R.shape === 'circle' ? 'e_d <= 0.59·r' : 'e_d <= B/3', `${d3(ed.e)} <= ${d3(ed.limGap)}`, `η = ${d2(ed.gap)}`)) : null,
    ],
    result: { eta: Math.max(ep.kern, ed?.gap ?? 0), text: `Ausmittigkeit → ${ok(Math.max(ep.kern, ed?.gap ?? 0))}` },
  });
  return out;
}

// ------------------------------------------------------------------ Setzung

function dST(r, p) {
  const R = r.st, s = p.st;
  const soil = makeSoil(p.soil);
  const out = [];
  const pSteps = [];
  if (s.loadMode === 'V') pSteps.push(st('Sohlspannung', 'σ_0 = V / A', `= ${d1(+s.V)} / ${d3(R.area)}`, `= ${d1(R.p0)} kN/m²`));
  else pSteps.push(st('Sohlspannung (Eingabe)', 'σ_0', '', `= ${d1(R.p0)} kN/m²`));
  if (s.unload) pSteps.push(st('Netto-Sohlspannung (Aushubentlastung)', 'p = σ_0 − σ_v(D)', `= ${d1(R.p0)} − ${d1(R.sv0D)}`, `= ${d1(R.pNet)} kN/m²`));
  else pSteps.push(st('Setzungswirksame Spannung', 'p = σ_0', '', `= ${d1(R.pNet)} kN/m²`));
  out.push({ id: 'st-p', title: 'Setzungswirksame Belastung', ref: 'DIN 4019 · SIA 267', steps: pSteps });

  // Spannungsausbreitung im Bezugspunkt
  const ref = R.points.find((q) => q.key === R.refKey);
  const dSteps = [];
  const B = R.B, L = R.L || B;
  if (R.shape === 'rect') {
    dSteps.push(st('Eckpunktformel (Steinbrenner, aus Boussinesq)', 'i(a, b, z) = 1/(2π)·[arctan(a·b/(z·R)) + a·b·z/R·(1/(a^2+z^2) + 1/(b^2+z^2))],  R = sqrt(a^2+b^2+z^2)', '', '', { ref: 'Boussinesq / Steinbrenner' }));
    const a1 = B / 2 + ref.x, a2 = B / 2 - ref.x, b1 = L / 2 + ref.y, b2 = L / 2 - ref.y;
    dSteps.push(st(`Überlagerung für ${ref.label} (x = ${d3(ref.x)}, y = ${d3(ref.y)} m)`, 'Δσ = p·[i(a_1, b_1) + i(a_1, b_2) + i(a_2, b_1) + i(a_2, b_2)]', `a_1 = ${d3(a1)}, a_2 = ${d3(a2)}, b_1 = ${d3(b1)}, b_2 = ${d3(b2)} m`, ''));
    const zs = [B / 2, B, Math.max(0.01, R.zLim - R.D)].filter((z, k, arr) => arr.indexOf(z) === k);
    for (const z of zs) {
      const i = [cornerFactor(a1, b1, z), cornerFactor(a1, b2, z), a2 > 0 ? cornerFactor(a2, b1, z) : 0, a2 > 0 && b2 > 0 ? cornerFactor(a2, b2, z) : 0];
      const sum = i.reduce((x, y) => x + y, 0);
      dSteps.push(st(`Tiefe z = ${d2(z)} m unter der Sohle`, 'Δσ = p·Σ i', `= ${d1(R.pNet)}·(${i.map(d4).join(' + ')})`, `= ${d1(R.pNet * sum)} kN/m²`));
    }
  } else if (R.shape === 'strip') {
    dSteps.push(st('Streifenlast (exakte Lösung)', 'Δσ = p/π·[β_1 − β_2 + sin β_1·cos β_1 − sin β_2·cos β_2],  β_{1,2} = arctan((x ± B/2)/z)', '', '', { ref: 'Boussinesq' }));
    for (const z of [B / 2, B, Math.max(0.01, R.zLim - R.D)]) dSteps.push(st(`${ref.label}, z = ${d2(z)} m`, 'Δσ = i·p', `= ${d4(stripFactor(B, ref.x, z))}·${d1(R.pNet)}`, `= ${d1(R.pNet * stripFactor(B, ref.x, z))} kN/m²`));
  } else {
    dSteps.push(st('Kreisfläche (Mitte exakt, sonst Sektorintegration)', 'Δσ_Mitte = p·[1 − (1/(1 + (r/z)^2))^{3/2}]', '', '', { ref: 'Boussinesq' }));
    for (const z of [B / 2, B, Math.max(0.01, R.zLim - R.D)]) dSteps.push(st(`${ref.label}, z = ${d2(z)} m`, 'Δσ = i·p', `= ${d4(circleFactor(B / 2, Math.hypot(ref.x, ref.y), z))}·${d1(R.pNet)}`, `= ${d1(R.pNet * circleFactor(B / 2, Math.hypot(ref.x, ref.y), z))} kN/m²`));
  }
  out.push({ id: 'st-ds', title: 'Spannungsausbreitung', ref: 'DIN 4019', intro: `Bezugspunkt: ${ref.label}${R.refKey === 'char' ? ' (starres Fundament: Setzung des schlaffen Fundaments im kennzeichnenden Punkt nach Graßhoff)' : ''}.`, steps: dSteps });

  const svz = verticalStress(soil, R.zLim, 0, 0).svp;
  out.push({
    id: 'st-zlim', title: 'Grenztiefe', ref: 'DIN 4019',
    steps: [
      st('Kriterium', "Δσ(z_gr) = f·σ'_v0(z_gr)", `f = ${d2(R.f)}`, ''),
      st('Werte in der Grenztiefe', "σ'_v0(z_gr), f·σ'_v0", `σ'_v0 = ${d1(svz)} kN/m² → f·σ'_v0 = ${d1(R.f * svz)} kN/m²`, `z_gr = ${d2(R.zLim)} m`, { note: R.limitFound ? '' : 'Grenztiefe nicht erreicht – Integration bis zur Rechengrenze.' }),
    ],
  });
  const sSteps = [st('Setzung', 's = Σ Δσ·Δz / M_E', '', '', { note: 'Numerische Integration in dünnen Lamellen; je Schicht dargestellt mit der mittleren Zusatzspannung Δσ_m.' })];
  for (const l of R.layers) {
    const dd = l.to - l.from;
    sSteps.push(st(`${l.name} (${d2(l.from)} … ${d2(l.to)} m)`, 's_i = Δσ_m·d_i / M_E', `= ${d1(l.dsigAvg)}·${d2(dd)} / (${d1(l.ME)}·1000)·1000`, `= ${d1(l.ds[R.refKey])} mm`));
  }
  sSteps.push(st('Summe', 's = Σ s_i', R.layers.map((l) => d1(l.ds[R.refKey])).join(' + '), `= ${d1(R.sRef)} mm`));
  const sAllow = Number(s.sAllow) || 0;
  const eta = sAllow > 0 ? R.sRef / sAllow : undefined;
  if (sAllow > 0) sSteps.push(st('Gebrauchstauglichkeit', 's <= s_zul', `${d1(R.sRef)} <= ${d1(sAllow)}`, `η = ${d2(eta)}`, { ref: 'SIA 267 / EN 1997-1, 6.6' }));
  out.push({ id: 'st-s', title: 'Setzung je Schicht', ref: 'SIA 267 · EN 1997-1, 6.6.2', steps: sSteps, result: sAllow > 0 ? { eta, text: `s = ${d1(R.sRef)} mm <= s_zul = ${d1(sAllow)} mm → ${ok(eta)}` } : { text: `s = ${d1(R.sRef)} mm` } });
  return out;
}

// ------------------------------------------------------------------ Böschung

function dSL(r, p) {
  const R = r.sl, n = r.norm;
  const best = R.design.best || R.char.best;
  const S = best.slices || [];
  const out = [];
  const soil = makeSoil(p.soil);
  out.push({
    id: 'sl-method', title: 'Verfahren und Bemessungswerte', ref: 'SIA 267 · EN 1997-1, 11.5.1',
    intro: 'Kreisförmige Gleitflächen, Lamellenverfahren nach Bishop (vereinfacht): Momentengleichgewicht um den Kreismittelpunkt, Lamellenseitenkräfte horizontal.',
    steps: [
      st('Bishop', "F = Σ T_i / Σ W_i·sin α_i,  T_i = [c'·b + (W − u·b)·tan φ'] / m_α,  m_α = cos α + sin α·tan φ'/F"),
      st('Fellenius (Vergleich)', "F = Σ [c'·l + (W·cos α − u·l)·tan φ'] / Σ W·sin α"),
      ...soil.layers.map((L) => st(`${L.name}: Bemessungswerte`, "tan φ'_d = tan φ'_k/γ_φ,  c'_d = c'_k/γ_c", `= tan ${deg(L.phi)}/${d2(n.gPhi)},  ${d1(L.c)}/${d2(n.gC)}`, `φ'_d = ${deg(Math.atan(Math.tan(rad(L.phi)) / n.gPhi) * 180 / Math.PI)}, c'_d = ${d1(L.c / n.gC)} kN/m²${L.cu > 0 && R.undrained ? `, c_u,d = ${d1(L.cu / n.gCu)}` : ''}`)),
      st('Veränderliche Lasten', 'q_d = γ_Q·q  (nur ungünstig, d.h. bei α >= 0)', `γ_Q = ${d2(n.gQslope)}`, ''),
    ],
  });
  out.push({
    id: 'sl-circle', title: 'Massgebender Gleitkreis', ref: R.design.best ? 'Bemessung' : 'charakteristisch',
    steps: [
      st('Mittelpunkt und Radius', 'M = (x_M, y_M), R', `x_M = ${d2(R.M.tx(best.xc))} m, y_M = ${d2(best.yc)} m`, `R = ${d2(best.R)} m`),
      st('Ein- und Austritt', 'x_E, x_A', `${d2(R.M.tx(best.xa))} / ${d2(R.M.tx(best.xe))} m`, `${S.length} Lamellen à b = ${d3(S[0]?.b)} m`),
      st('Suche', '', `${R.grid.nx} × ${R.grid.ny} Mittelpunkte × ${R.grid.nr} Radien, danach Mustersuche`, `${R.circles} Kreise`),
    ],
  });
  if (S.length) {
    const pick = [...new Set([0, Math.round(S.length / 5), Math.round(2 * S.length / 5), Math.round(3 * S.length / 5), Math.round(4 * S.length / 5), S.length - 1])].filter((i) => i < S.length);
    const lam = pick.map((i) => {
      const s = S[i];
      return st(`Lamelle ${i + 1} (${s.layer}, α = ${deg(s.alpha * 180 / Math.PI)})`, 'T_i = [c·b + (W − u·b)·tan φ] / m_α',
        `= [${d1(s.c)}·${d3(s.b)} + (${d1(s.W + s.Q)} − ${d1(s.u)}·${d3(s.b)})·${d4(s.tanPhi)}] / ${d3(s.mAlpha)}`,
        `= ${d1(s.T)} kN/m;  W·sin α = ${d1(s.drive)} kN/m`);
    });
    const sumT = S.reduce((a, s) => a + s.T, 0), sumD = S.reduce((a, s) => a + s.drive, 0);
    out.push({ id: 'sl-slices', title: 'Lamellen (Auszug)', intro: `W enthält Bodeneigengewicht${p.sl.q?.p ? ', Auflast' : ''} und allfällige Wasserauflast; u = γ_w·(h_w − y_Basis).`, steps: [...lam, st('Summen über alle Lamellen', 'Σ T_i,  Σ W_i·sin α_i', '', `${d1(sumT)} kN/m,  ${d1(sumD)} kN/m`)] });
    const it = bishopHistory(S, best.FF);
    out.push({
      id: 'sl-iter', title: 'Iteration nach Bishop', ref: 'Bishop (1955)',
      intro: 'F steht auf beiden Seiten der Gleichung (in m_α); Startwert ist der Faktor nach Fellenius.',
      steps: it.hist.slice(0, 8).map((F, k) => st(k === 0 ? 'Startwert (Fellenius)' : `Iteration ${k}`, k === 0 ? 'F_0' : `F_${k} = Σ T_i(F_${k - 1}) / Σ W_i·sin α_i`, '', `= ${d4(F)}`)),
    });
  }
  const eta = R.eta;
  out.push({
    id: 'sl-check', title: 'Nachweis Gesamtstabilität', ref: 'SIA 267 · EN 1997-1, 11.5.1',
    steps: [
      st('Charakteristisch (Information)', 'F_k (Bishop) / F_k (Fellenius)', '', `${d3(R.F)} / ${d3(R.FF)}`),
      st('Bemessung', 'F_d >= γ_R', `${d3(R.Fd)} >= ${d2(n.gRs)}`, `η = γ_R/F_d = ${d2(eta)}`),
    ],
    result: { eta, text: `F_d = ${d3(R.Fd)} >= ${d2(n.gRs)} → ${ok(eta)}` },
  });
  return out;
}

// ------------------------------------------------------------------ Stützmauer

function dRW(r, p) {
  const R = r.rw, n = r.norm, w = p.rw, g = R.g;
  const out = [];
  const epS = epSections(R.ep, n, { method: w.method }, { prefix: 'rw-ep', rankine: w.method !== 'coulomb', design: false });
  epS[0].title = 'Erddruckbeiwerte (Ersatzwand)';
  epS[0].intro = `Lotrechte Ersatzwand durch das Fersenende (x = ${d2(g.B)} m), Höhe ${d2(R.ep.H)} m${w.method !== 'coulomb' ? '; Rankine mit δ = β' : ''}.`;
  out.push(...epS);

  const fSteps = R.forces.map((f) => {
    const V = -f.Fy, Hh = -f.Fx;
    const m = f.x * f.Fy - f.y * f.Fx;
    return st(`${f.name}${f.kind === 'G' ? '' : ' (veränderlich)'}`, Math.abs(Hh) > 1e-9 ? 'M_O = H·y' : 'M_O = −V·x', Math.abs(Hh) > 1e-9 ? `= ${d1(Hh)}·${d3(f.y)}` : `= −${d1(V)}·${d3(f.x)}`, `= ${d1(m)} kNm/m`);
  });
  out.push({ id: 'rw-forces', title: 'Kräfte und Momente um die Zehe', ref: 'je Laufmeter, charakteristisch', intro: 'Moment um die Vorderkante der Sohle (O), positiv kippend (Gegenuhrzeigersinn).', steps: fSteps });

  const c = R.charG;
  const ep = R.eccPerm, ed = R.eccDesign;
  out.push({
    id: 'rw-ecc', title: 'Kippen: Lage der Resultierenden', ref: 'SIA 267 · EN 1997-1, 6.5.4',
    steps: [
      st('Vertikalkraft (ständig)', 'N = Σ V', '', `= ${d1(c.N)} kN/m`),
      st('Abstand der Resultierenden von der Zehe', 'x_R = −Σ M_O / N', `= ${d1(-c.M)} / ${d1(c.N)}`, `= ${d3(c.xR)} m`),
      st('Ausmitte', 'e = B/2 − x_R', `= ${d3(g.B / 2)} − ${d3(c.xR)}`, `= ${d3(c.e)} m`),
      st('Ständige Lasten: Resultierende im Kern', 'e <= B/6', `${d3(Math.abs(c.e))} <= ${d3(g.B / 6)}`, `η = ${d2(ep.kern)}`),
      ed ? st('Bemessung: klaffende Fuge höchstens bis zum Schwerpunkt', 'e_d <= B/3', `${d3(Math.abs(ed.e))} <= ${d3(g.B / 3)} (γ_G = ${d2(ed.combo.fG)}, γ_Q = ${d2(ed.combo.fQe)})`, `η = ${d2(ed.gap)}`) : null,
      st('Kippsicherheit (Information)', 'M_stb / M_dst', `= ${d1(R.Mstb)} / ${d1(R.Mdst)}`, `= ${d2(R.Fkipp)}`),
    ],
    result: { eta: Math.max(ep.kern, ed?.gap ?? 0), text: `e = ${d3(c.e)} m → ${ok(Math.max(ep.kern, ed?.gap ?? 0))}` },
  });

  const s = R.govS;
  out.push({
    id: 'rw-slide', title: 'Gleiten', ref: 'EN 1997-1, 6.5.3 / 9.7 · SIA 267',
    steps: [
      st('Horizontale Bemessungslast', 'H_d = γ_G·(E_ah,G + W) + γ_Q·E_ah,Q', `= ${d2(n.gG)}·(${d1(R.ep.EhG)} + ${d1(R.ep.U)}) + ${d2(s.fQe)}·${d1(R.ep.EhQ)}`, `= ${d1(s.Hd)} kN/m`, { note: R.water ? 'Wasserdruck vorne wirkt entlastend.' : '' }),
      st('Sohlreibung', 'tan δ_b', `Schicht unter der Sohle: ${R.baseLayer}`, `= ${d4(R.tanD)}`),
      s.type === 'undrainiert'
        ? st('Gleitwiderstand (undrainiert)', "R_h,d = B'·c_u/γ_R,h", '', `= ${d1(s.Rk / n.gRh)} kN/m`)
        : st('Gleitwiderstand', 'R_h = γ_G,inf·N_G·tan δ_b / γ_R,h', `= ${d2(n.gGinf)}·${d1(c.N)}·${d4(R.tanD)} / ${d2(n.gRh)}`, `= ${d1(s.Rk / n.gRh)} kN/m`),
      s.Ep > 0 ? st('Erdwiderstand vor dem Sporn', 'E_p,d = E_p,k / γ_R,e', `= ${d1(s.Ep)} / ${d2(n.gRe)}`, `= ${d1(s.Ep / n.gRe)} kN/m`) : null,
      st('Nachweis', 'H_d <= R_h,d', `${d1(s.Hd)} <= ${d1(s.Rd)}`, `η = ${d2(s.eta)}`),
    ],
    result: { eta: s.eta, text: `H_d = ${d1(s.Hd)} <= R_h,d = ${d1(s.Rd)} kN/m → ${ok(s.eta)}` },
  });

  const b = R.govB;
  if (b && !b.error) {
    out.push({
      id: 'rw-bearing', title: `Grundbruch (${b.gov.drained ? 'drainiert' : 'undrainiert'})`, ref: 'EN 1997-1, 6.5.2 / Anh. D · SIA 267',
      steps: [
        st('Massgebende Kombination', 'N_d, H_d, e', `γ_G = ${d2(b.combo.fG)}, γ_Q = ${d2(b.combo.fQe)}`, `N_d = ${d1(b.combo.N)} kN/m, H_d = ${d1(b.combo.H)} kN/m, e = ${d3(b.combo.e)} m`),
        st('Wirksame Breite', "B' = B − 2·|e|", `= ${d3(g.B)} − 2·${d3(Math.abs(b.combo.e))}`, `= ${d3(b.eff.Bp)} m`),
        ...soilSteps(b, n, R.applyM),
        ...bearingSteps(b, n, true, 'kN/m'),
      ],
      result: { eta: b.eta, text: `N_d = ${d1(b.ld.V)} <= R_d = ${d1(b.Rd)} kN/m → ${ok(b.eta)}` },
    });
  } else if (b) {
    out.push({ id: 'rw-bearing', title: 'Grundbruch', steps: [], result: { eta: Infinity, text: b.error } });
  }

  const base = R.sec.base;
  out.push({
    id: 'rw-stem', title: 'Schnittkräfte der Wand (Einspannung)', ref: 'für die Bemessung nach SIA 262',
    intro: `Erddruck auf die Wandrückseite über die Wandhöhe h_s = ${d2(g.hs)} m (gleicher Ansatz wie für die Ersatzwand).`,
    steps: [
      st('Moment (charakteristisch)', 'M_k = M_G + M_Q + M_W', `= ${d1(base.MG)} + ${d1(base.MQ)} + ${d1(base.MW)}`, `= ${d1(base.Mk)} kNm/m`),
      st('Bemessungsmoment', 'M_Ed = γ_G·(M_G + M_W) + γ_Q·M_Q', `= ${d2(n.gG)}·(${d1(base.MG)} + ${d1(base.MW)}) + ${d2(n.gQ)}·${d1(base.MQ)}`, `= ${d1(base.Md)} kNm/m`),
      st('Bemessungsquerkraft', 'V_Ed = γ_G·(V_G + V_W) + γ_Q·V_Q', `= ${d2(n.gG)}·(${d1(base.VG)} + ${d1(base.VW)}) + ${d2(n.gQ)}·${d1(base.VQ)}`, `= ${d1(base.Vd)} kN/m`),
      R.slab ? st('Zehe (Anschnitt Wand)', 'M_Ed = ∫ (σ_d − g_d)·(l − x) dx', '', `= ${d1(R.slab.toe.M)} kNm/m (Zug unten), V_Ed = ${d1(R.slab.toe.V)} kN/m`) : null,
      R.slab ? st('Ferse (Anschnitt Wand)', 'M_Ed = ∫ (g_d − σ_d)·x dx + E_av,d·l', '', `= ${d1(R.slab.heel.M)} kNm/m (Zug oben), V_Ed = ${d1(R.slab.heel.V)} kN/m`) : null,
    ],
  });
  return out;
}
