// Herleitung (Rechenweg) Mauerwerk: allgemeine Formel, eingesetzte Werte, Ergebnis, Normbezug
import { num } from '../../js/core/formula.js';
import { typeById } from './materials.js';
import { sideFlags } from './calc.js';

/** Nachweis-ID → Abschnitt der Herleitung (für «Herleitung ›» in den Nachweistabellen). */
export const DERIV_OF = {
  top: 'ends', bot: 'ends', buck: 'buck', buckEN: 'buck', shear: 'shear', shearEN: 'shear', shearN: 'shear',
  conc: 'conc', concMid: 'conc', lat: 'lat', basMax: 'bas', basMin: 'bas', slender: 'gzg', crack: 'gzg',
};

const etaOf = (list) => list.reduce((m, x) => (Number.isFinite(x) ? Math.max(m, x) : Infinity), 0);
const verdict = (eta) => (Number.isFinite(eta) && eta <= 1.0001 ? 'erfüllt' : 'nicht erfüllt');
const mm = (x, d = 1) => num(x * 1000, d);

/** Kombination mit der grössten Ausnutzung für die genannten Nachweise. */
function govCombo(R, keys) {
  let best = null, be = -1;
  for (const c of R.combos) {
    for (const k of keys) {
      const ck = c.checks[k];
      if (!ck) continue;
      const e = Number.isFinite(ck.eta) ? ck.eta : 1e9;
      if (e > be) { be = e; best = c; }
    }
  }
  return best;
}

function comboLine(c, p) {
  const F = c.F;
  const parts = [`γ_G = ${num(F.g, 2)}`, `γ_Q = ${num(F.q, 2)}`];
  if (F.w) parts.push(`γ_W = ${num(F.w, 2)}`);
  if (F.e) parts.push(`γ_{Erd} = ${num(F.e, 2)}`);
  if (F.ae) parts.push(`γ_{Eb} = ${num(F.ae, 2)}`);
  return { label: `Kombination «${c.name}» (${c.type === 'SLS' ? 'GZG' : 'GZT'})`, f: parts.join(', '), ref: 'SIA 260, 4.4.3' };
}

export function derivation(app) {
  const p = app.project, R = app.results;
  if (!R) return [];
  const W = p.wall, L = p.loads, md = R.md, t = R.t, h = R.h, l = R.l;
  const out = [];
  const typ = typeById(p.material.type);

  // ------------------------------------------------------------------ 1 Baustoff
  out.push({
    id: 'mat', title: 'Baustoff und Bemessungswerte', ref: 'SIA 266, 2.2.5 / 3.3',
    intro: `${typ.label}. Charakteristische Werte sind Standardwerte bzw. Eingaben und vom Anwender zu prüfen.`,
    steps: [
      { label: 'Druckfestigkeit senkrecht zu den Lagerfugen', f: 'f_{xd} = f_{xk}/γ_M', v: `= ${num(md.fxk, 2)}/${num(md.gammaM, 2)}`, r: `= ${num(md.fxd, 3)} MPa`, ref: 'SIA 266, 2.2.5' },
      { label: 'Druckfestigkeit parallel zu den Lagerfugen', f: 'f_{yd} = f_{yk}/γ_M', v: `= ${num(md.fyk, 2)}/${num(md.gammaM, 2)}`, r: `= ${num(md.fyd, 3)} MPa` },
      p.material.exkAuto ? { label: 'Elastizitätsmodul', f: 'E_{xk} = K_E·f_{xk}', v: `= ${num(typ.KE, 0)}·${num(md.fxk, 2)}`, r: `= ${num(md.Exk, 0)} MPa`, ref: 'EN 1996-1-1, 3.7.2' } : { label: 'Elastizitätsmodul (Eingabe)', f: 'E_{xk}', r: `= ${num(md.Exk, 0)} MPa` },
      { label: 'E-Modul für Theorie 2. Ordnung', f: 'E_{xd} = E_{xk}/γ_E', v: `= ${num(md.Exk, 0)}/${num(md.gammaE, 2)}`, r: `= ${num(md.Exd, 0)} MPa`, note: 'γ_E = γ_M hält das Verhältnis E/f gleich wie im charakteristischen Zustand.' },
      { label: 'Eigengewicht der Wand', f: 'g_w = γ·t', v: `= ${num(md.gamma, 1)}·${num(t, 3)}`, r: `= ${num(md.gamma * t, 2)} kN/m²` },
    ],
  });

  // ------------------------------------------------------------------ 2 Knicklänge
  const sf = sideFlags(W);
  const nS = (sf.L ? 1 : 0) + (sf.R ? 1 : 0);
  const ls = W.ls > 0 ? W.ls : l;
  const eff = R.eff;
  const kSteps = [];
  if (W.support === 'manual') kSteps.push({ label: 'Knickbeiwert (Eingabe)', f: 'ρ', r: `= ${num(eff.rho, 3)}` });
  else {
    kSteps.push({ label: W.support === 'slab' ? 'Halterung durch Stahlbetondecken' : 'gelenkige Halterung oben und unten', f: 'ρ_2', r: `= ${num(eff.rho2, 2)}`, ref: 'EN 1996-1-1, 5.5.1.2', note: eff.notes?.length ? eff.notes.join(' ') : '' });
    if (nS === 1 && Math.abs(eff.rho - eff.rho2) > 1e-9) kSteps.push(h <= 3.5 * ls ? { label: 'dreiseitig gehalten (h ≤ 3.5·l)', f: 'ρ_3 = ρ_2/(1 + (ρ_2·h/(3·l))^2)', v: `= ${num(eff.rho2, 2)}/(1 + (${num(eff.rho2, 2)}·${num(h, 2)}/(3·${num(ls, 2)}))^2)`, r: `= ${num(eff.rho, 3)}` } : { label: 'dreiseitig gehalten (h > 3.5·l)', f: 'ρ_3 = 1.5·l/h', v: `= 1.5·${num(ls, 2)}/${num(h, 2)}`, r: `= ${num(eff.rho, 3)}` });
    if (nS === 2 && Math.abs(eff.rho - eff.rho2) > 1e-9) kSteps.push(h <= 1.15 * ls ? { label: 'vierseitig gehalten (h ≤ 1.15·l)', f: 'ρ_4 = ρ_2/(1 + (ρ_2·h/l)^2)', v: `= ${num(eff.rho2, 2)}/(1 + (${num(eff.rho2, 2)}·${num(h, 2)}/${num(ls, 2)})^2)`, r: `= ${num(eff.rho, 3)}` } : { label: 'vierseitig gehalten (h > 1.15·l)', f: 'ρ_4 = 0.5·l/h', v: `= 0.5·${num(ls, 2)}/${num(h, 2)}`, r: `= ${num(eff.rho, 3)}` });
  }
  kSteps.push({ label: 'Knicklänge', f: 'h_{ef} = ρ_n·h', v: `= ${num(eff.rho, 3)}·${num(h, 2)}`, r: `= ${num(R.hef, 3)} m` });
  kSteps.push({ label: 'Schlankheit', f: 'λ = h_{ef}/t', v: `= ${num(R.hef, 3)}/${num(t, 3)}`, r: `= ${num(R.slender, 1)}` });
  kSteps.push({ label: 'ungewollte Ausmitte (Vorverformung in Wandmitte)', f: `e_0 = h_{ef}/${num(R.nImp, 0)}`, v: `= ${num(R.hef * 1000, 0)}/${num(R.nImp, 0)}`, r: `= ${num(R.eImp * 1000, 2)} mm`, ref: 'EN 1996-1-1, 5.5.1.1' });
  out.push({ id: 'knick', title: 'Knicklänge und Schlankheit', ref: 'EN 1996-1-1, 5.5.1 (sinngemäss SIA 266)', steps: kSteps });

  // ------------------------------------------------------------------ 3 Wandkopf / Wandfuss
  const ce = govCombo(R, ['top', 'bot']);
  if (ce) {
    const F = ce.F;
    const k = ce.kOpen;
    const eDm = R.eD;
    const steps = [comboLine(ce, p)];
    steps.push({ label: 'Auflast aus der Wand darüber (zentrisch)', f: `n_{d,W} = (γ_G·g_{k,W} + γ_Q·q_{k,W})${k > 1 ? '·k_{Öff}' : ''}`, v: `= (${num(F.g, 2)}·${num(L.gW || 0, 1)} + ${num(F.q, 2)}·${num(L.qW || 0, 1)})${k > 1 ? `·${num(k, 3)}` : ''}`, r: `= ${num(ce.nW, 1)} kN/m` });
    steps.push({ label: 'Deckenauflagerkraft', f: `n_{d,D} = (γ_G·g_{k,D} + γ_Q·q_{k,D})${k > 1 ? '·k_{Öff}' : ''}`, v: `= (${num(F.g, 2)}·${num(L.gD || 0, 1)} + ${num(F.q, 2)}·${num(L.qD || 0, 1)})${k > 1 ? `·${num(k, 3)}` : ''}`, r: `= ${num(ce.nD, 1)} kN/m` });
    if (k > 1) steps.push({ label: 'Lastkonzentration auf die Pfeiler (Öffnungen)', f: 'k_{Öff} = l/(l − Σb)', v: `= ${num(l, 2)}/(${num(l, 2)} − ${num(R.openW, 2)})`, r: `= ${num(k, 3)}` });
    if (L.eMode === 'slab') steps.push({ label: 'Exzentrizität der Decke (Deckenverdrehung, Resultierende bei a/3)', f: 'e_D = t/2 − a/3', v: `= ${num(t * 500, 1)} − ${num(L.aD, 0)}/3`, r: `= ${mm(eDm)} mm` });
    else steps.push({ label: L.eMode === 'centric' ? 'Exzentrizität der Decke (zentrisch)' : 'Exzentrizität der Decke (Eingabe)', f: 'e_D', r: `= ${mm(eDm)} mm` });
    steps.push({ label: 'Exzentrizität der Resultierenden am Wandkopf', f: 'e_o = n_{d,D}·e_D/(n_{d,W} + n_{d,D})', v: `= ${num(ce.nD, 1)}·${mm(eDm)}/${num(ce.nTop, 1)}`, r: `= ${mm(ce.eTop)} mm` });
    if (R.method === 'EN') {
      const en = ce.en;
      steps.push({ label: 'Wandkopf: Ausmitte inkl. e_0, mindestens 0.05·t', f: 'e_{i,o} = |e_o| + e_0 >= 0.05·t', v: `= ${mm(Math.abs(ce.eTop))} + ${mm(R.eImp, 2)}`, r: `= ${mm(en.top.e)} mm`, ref: 'EN 1996-1-1 (6.5)' });
      steps.push({ label: 'Abminderungsfaktor Wandkopf', f: 'Φ_o = 1 − 2·e_{i,o}/t', v: `= 1 − 2·${mm(en.top.e)}/${num(t * 1000, 0)}`, r: `= ${num(en.top.phi, 3)}`, ref: 'EN 1996-1-1 (6.4)' });
      steps.push({ label: 'Widerstand Wandkopf', f: 'n_{Rd,o} = Φ_o·t·f_{xd}', v: `= ${num(en.top.phi, 3)}·${num(t, 3)}·${num(R.fxd, 0)}`, r: `= ${num(en.top.nRd, 1)} kN/m` });
      steps.push({ label: 'Wandfuss', f: 'n_{d,u} = n_{d,o} + γ_G·g_w·h', v: `= ${num(ce.nTop, 1)} + ${num(F.g, 2)}·${num(md.gamma * t, 2)}·${num(h, 2)}`, r: `= ${num(ce.nBot, 1)} kN/m` });
      steps.push({ label: 'Widerstand Wandfuss', f: 'n_{Rd,u} = (1 − 2·e_{i,u}/t)·t·f_{xd}', v: `= ${num(en.bot.phi, 3)}·${num(t, 3)}·${num(R.fxd, 0)}`, r: `= ${num(en.bot.nRd, 1)} kN/m` });
    } else {
      steps.push({ label: 'Widerstand Wandkopf (Spannungsblock über t − 2e)', f: 'n_{Rd,o} = f_{xd}·(t − 2·|e_o|)', v: `= ${num(R.fxd, 0)}·(${num(t, 3)} − 2·${num(Math.abs(ce.eTop), 4)})`, r: `= ${num(ce.top.nRd, 1)} kN/m`, ref: 'SIA 266, 4.3' });
      steps.push({ label: 'Normalkraft am Wandfuss (inkl. Eigengewicht)', f: 'n_{d,u} = n_{d,o} + γ_G·g_w·h', v: `= ${num(ce.nTop, 1)} + ${num(F.g, 2)}·${num(md.gamma * t, 2)}·${num(h, 2)}`, r: `= ${num(ce.nBot, 1)} kN/m` });
      steps.push({ label: 'Widerstand Wandfuss', f: 'n_{Rd,u} = f_{xd}·(t − 2·|e_u|)', v: `= ${num(R.fxd, 0)}·(${num(t, 3)} − 2·${num(Math.abs(ce.eBot), 4)})`, r: `= ${num(ce.bot.nRd, 1)} kN/m` });
    }
    const et = ce.checks.top.eta, eb = ce.checks.bot.eta;
    steps.push({ label: 'Ausnutzung', f: 'η = n_{Ed}/n_{Rd}', v: `Kopf ${num(ce.nTop, 1)}/${num(ce.checks.top.Rd, 1)}, Fuss ${num(ce.nBot, 1)}/${num(ce.checks.bot.Rd, 1)}`, r: `= ${num(et, 2)} / ${num(eb, 2)}` });
    const eta = etaOf([et, eb]);
    out.push({ id: 'ends', title: 'Normalkraft am Wandkopf und Wandfuss', ref: R.method === 'EN' ? 'EN 1996-1-1, 6.1.2.2' : 'SIA 266, 4.3', steps, result: { eta, text: `η = ${num(eta, 2)} → ${verdict(eta)}` } });
  }

  // ------------------------------------------------------------------ 4 Knicken
  const cb = govCombo(R, ['buck', 'buckEN']);
  if (cb) {
    const steps = [comboLine(cb, p)];
    steps.push({ label: 'Normalkraft in Wandmitte', f: 'n_{d,m} = n_{d,o} + γ_G·g_w·h/2', v: `= ${num(cb.nTop, 1)} + ${num(cb.F.g, 2)}·${num(md.gamma * t, 2)}·${num(h / 2, 2)}`, r: `= ${num(cb.nMid, 1)} kN/m` });
    if (R.method === 'EN') {
      const m = cb.en.mid;
      const mid = Math.floor(cb.model.m / 2);
      steps.push({ label: 'Ausmitte aus den Endmomenten in Wandmitte', f: 'e_{1,m} = M_{md}/N_{md}', v: `= ${num(cb.model.M1[mid], 2)}/${num(cb.nMid, 1)}`, r: `= ${mm(m.e0)} mm` });
      if (Math.abs(m.ehm) > 1e-9) steps.push({ label: 'Ausmitte aus Querlast', f: 'e_{hm} = M_{q,m}/N_{md}', r: `= ${mm(m.ehm)} mm`, note: cb.enNoEarth ? 'Erddruckmoment nicht enthalten (Nachweis nach EN 1996-3, 4.5).' : '' });
      steps.push({ label: 'Ausmitte in Wandmitte', f: 'e_m = |e_{1,m} + e_{hm}| + e_0', v: `= |${mm(m.e0)} + ${mm(m.ehm)}| + ${mm(R.eImp, 2)}`, r: `= ${mm(m.em)} mm`, ref: 'EN 1996-1-1 (6.7)' });
      steps.push({ label: 'Kriechausmitte', f: 'e_k = 0.002·φ_∞·h_{ef}/t·sqrt(t·e_m)', v: R.slender > 15 ? `= 0.002·${num(md.phi, 2)}·${num(R.slender, 1)}·sqrt(${num(t * 1000, 0)}·${mm(m.em)})` : '(h_{ef}/t ≤ 15 → e_k = 0)', r: `= ${mm(m.ek)} mm`, ref: 'EN 1996-1-1 (6.8)' });
      steps.push({ label: 'massgebende Ausmitte', f: 'e_{mk} = e_m + e_k >= 0.05·t', r: `= ${mm(m.emk)} mm` });
      steps.push({ label: 'Schlankheitsparameter', f: 'λ = h_{ef}/t·sqrt(f_k/E)', v: `= ${num(R.slender, 1)}·sqrt(${num(md.fxk, 2)}/${num(md.Exk, 0)})`, r: `= ${num(m.lam, 3)}`, ref: 'EN 1996-1-1 (G.2)' });
      steps.push({ label: 'Hilfswerte', f: 'A_1 = 1 − 2·e_{mk}/t; u = (λ − 0.063)/(0.73 − 1.17·e_{mk}/t)', r: `A_1 = ${num(m.A1, 3)}, u = ${num(m.u, 3)}`, ref: 'EN 1996-1-1 (G.3)' });
      steps.push({ label: 'Abminderungsfaktor in Wandmitte', f: 'Φ_m = A_1·e^{−u^2/2}', v: `= ${num(m.A1, 3)}·e^{−${num(m.u, 3)}^2/2}`, r: `= ${num(m.phi, 3)}`, ref: 'EN 1996-1-1 (G.1)' });
      steps.push({ label: 'Widerstand in Wandmitte', f: 'n_{Rd,m} = Φ_m·t·f_{xd}', v: `= ${num(m.phi, 3)}·${num(t, 3)}·${num(R.fxd, 0)}`, r: `= ${num(m.nRd, 1)} kN/m` });
      const eta = cb.checks.buckEN.eta;
      steps.push({ label: 'Ausnutzung', f: 'η = n_{d,m}/n_{Rd,m}', v: `= ${num(cb.nMid, 1)}/${num(m.nRd, 1)}`, r: `= ${num(eta, 2)}` });
      out.push({ id: 'buck', title: 'Normalkraft in Wandmitte (Knicken)', ref: 'EN 1996-1-1, 6.1.2.2, Anhang G', steps, result: { eta, text: `η = ${num(eta, 2)} → ${verdict(eta)}` } });
    } else {
      const b = cb.buck;
      steps.push({ label: 'wirksame Kriechzahl (Anteil ständiger Last)', f: 'φ_{eff} = φ_∞·n_{G,d}/n_{d,m}', v: p.settings.creep !== false ? `= ${num(md.phi, 2)}·${num(cb.rPerm, 3)}` : '(Kriechen nicht berücksichtigt)', r: `= ${num(cb.phiEff, 3)}` });
      steps.push({ label: 'wirksamer E-Modul', f: 'E_{eff} = E_{xd}/(1 + φ_{eff})', v: `= ${num(md.Exd, 0)}/(1 + ${num(cb.phiEff, 3)})`, r: `= ${num(cb.Eeff / 1000, 0)} MPa` });
      steps.push({ label: 'Krümmung ungerissen (|e| ≤ t/6, σ ≤ f_{xd})', f: 'κ = 12·N·e/(E_{eff}·t^3)', note: 'Rechteckquerschnitt 1 m breit ohne Zugfestigkeit.' });
      steps.push({ label: 'Krümmung gerissen (|e| > t/6)', f: 'κ = 2·N/(E_{eff}·c^2), c = 3·(t/2 − |e|)', note: 'Bei Erreichen von f_{xd} plastischer Randbereich; κ → ∞ für N → f_{xd}·(t − 2|e|).' });
      steps.push({ label: 'Ausmitte über die Höhe', f: 'e(z) = M_1(z)/N(z) + M_q(z)/N(z) + e_0·sin(π·z/h) + w(z)', note: 'M₁ linear zwischen n_{d,o}·e_o und n_{d,u}·e_u; e₀ in Richtung der Biegelinie Th. 1. O.' });
      steps.push({ label: 'Biegelinie (Theorie 2. Ordnung)', f: 'w″ = −κ(N, e),  w(0) = w(h_{ef}) = 0', note: 'Fixpunktiteration mit 32 Abschnitten über die Knicklänge h_ef.' });
      const zi = b.idx;
      const pt = cb.profile.pts[zi];
      if (cb.profile.ok && pt) steps.push({ label: `Zustand unter Bemessungslast bei z = ${num(pt.z, 2)} m`, f: 'e = e_1 + e_q + e_0 + w', v: `= ${mm(pt.e1)} + ${mm(pt.eq)} + ${mm(pt.imp, 2)} + ${mm(pt.w, 2)}`, r: `= ${mm(pt.e)} mm` });
      steps.push({ label: 'Laststeigerung bis zum Verlust des Gleichgewichts', f: 'λ_u = max λ: Gleichgewicht für λ·n_d', r: `λ_u = ${Number.isFinite(b.xMax) ? num(b.xMax, 3) : '> 1000'}`, note: `Versagen: ${b.mode}, massgebender Schnitt z = ${num(b.z, 2)} m.` });
      steps.push({ label: 'Tragwiderstand', f: 'n_{Rd} = λ_u·n_{Ed}(z)', v: `= ${num(b.xMax, 3)}·${num(b.nEd, 1)}`, r: `= ${num(b.nRd, 1)} kN/m` });
      steps.push({ label: 'Abminderung gegenüber dem Querschnitt', f: 'Φ = n_{Rd}/(t·f_{xd})', v: `= ${num(b.nRd, 1)}/(${num(t, 3)}·${num(R.fxd, 0)})`, r: `= ${num(b.phi, 3)}` });
      const eta = b.eta;
      steps.push({ label: 'Ausnutzung', f: 'η = 1/λ_u', r: `= ${num(eta, 2)}` });
      out.push({ id: 'buck', title: 'Normalkraft mit Knicken (Th. 2. Ordnung)', ref: 'SIA 266, 4.3', intro: 'Wandstreifen b = 1 m, gelenkig oben und unten, Knicklänge h_ef. Werkstoff ohne Zugfestigkeit, linear-elastisch – ideal-plastisch. Querschnittswiderstand mit Spannungsblock n_Rd = f_xd·(t − 2e).', steps, result: { eta, text: `η = ${num(eta, 2)} → ${verdict(eta)}` } });
    }
  }

  // ------------------------------------------------------------------ 5 Schub
  const cs = govCombo(R, ['shear', 'shearEN', 'shearN']);
  if (cs?.shear) {
    const s = cs.shear, F = cs.F;
    const steps = [comboLine(cs, p)];
    steps.push({ label: 'Horizontalkraft', f: 'V_d = γ_W·V_{w,k} + γ_{Eb}·V_{E,d}', v: `= ${num(F.w, 2)}·${num(L.Vw || 0, 1)} + ${num(F.ae, 2)}·${num(L.Ve || 0, 1)}`, r: `= ${num(s.V, 1)} kN` });
    steps.push({ label: 'Normalkraft am Wandfuss', f: 'N_d = n_{d,o}·l + γ_G·g_w·h·l', v: `= ${num(cs.nTop / cs.kOpen, 1)}·${num(l, 2)} + ${num(F.g, 2)}·${num(md.gamma * t, 2)}·${num(h, 2)}·${num(l, 2)}`, r: `= ${num(s.N, 1)} kN` });
    steps.push({ label: 'Schubspannweite', f: L.topFixed ? 'h_0 = h_V/2' : 'h_0 = h_V', v: L.topFixed ? `= ${num(s.hV, 2)}/2` : '', r: `= ${num(s.h0, 2)} m` });
    let eta;
    if (s.method === 'SIA') {
      steps.push({ label: 'Druckfeld (Fliessbedingung Ganz/Thürlimann, c = 0)', f: 'σ_x/f_{xd} + σ_y/f_{yd} <= 1,  σ_y = τ^2/σ_x', ref: 'SIA 266, 4.4' });
      steps.push({ label: 'Druckzone am Wandfuss', f: 'l_c = l − 2·V·h_0/N' });
      steps.push({ label: 'Widerstand Druckfeld', f: 'V_{Rd,c} = −t·h_0·f_{yd} + sqrt((t·h_0·f_{yd})^2 + f_{yd}·N·(t·l − N/f_{xd}))', v: `= −${num(t * s.h0 * R.fyd, 1)} + sqrt(${num(t * s.h0 * R.fyd, 1)}^2 + ${num(R.fyd, 0)}·${num(s.N, 1)}·(${num(t * l, 3)} − ${num(s.N / R.fxd, 4)}))`, r: `= ${num(s.Vstrut, 1)} kN` });
      steps.push({ label: 'Gleiten in der Lagerfuge', f: 'V_{Rd,f} = μ·N', v: `= ${num(md.mu, 2)}·${num(s.N, 1)}`, r: `= ${num(s.Vfric, 1)} kN` });
      steps.push({ label: 'Querkraftwiderstand', f: 'V_{Rd} = min(V_{Rd,c}; V_{Rd,f})', r: `= ${num(s.VRd, 1)} kN (${s.mode})` });
      if (s.lc > 0) steps.push({ label: 'Spannungen bei V_d', f: 'σ_x = N/(t·l_c), τ = V/(t·l_c)', v: `l_c = ${num(s.lc, 3)} m`, r: `σ_x = ${num(s.sx / 1000, 3)} MPa, τ = ${num(s.tau / 1000, 3)} MPa, σ_y = ${num(s.sy / 1000, 3)} MPa`, note: `Kontrolle: σ_x/f_xd + σ_y/f_yd = ${num(s.sx / R.fxd + s.sy / R.fyd, 3)}` });
      eta = cs.checks.shear.eta;
      steps.push({ label: 'Ausnutzung', f: 'η = V_d/V_{Rd}', v: `= ${num(s.V, 1)}/${num(s.VRd, 1)}`, r: `= ${num(eta, 2)}` });
    } else {
      steps.push({ label: 'Exzentrizität der Normalkraft am Wandfuss', f: 'e = V_d·h_0/N_d', v: `= ${num(s.V, 1)}·${num(s.h0, 2)}/${num(s.N, 1)}`, r: `= ${num(s.e, 3)} m` });
      steps.push({ label: 'überdrückte Länge (linear, gerissen)', f: s.e <= l / 6 ? 'l_c = l  (e ≤ l/6)' : 'l_c = 3·(l/2 − e)', r: `= ${num(s.lc, 3)} m` });
      steps.push({ label: 'mittlere Druckspannung', f: 'σ_d = N_d/(t·l_c)', v: `= ${num(s.N, 1)}/(${num(t, 3)}·${num(s.lc, 3)})`, r: `= ${num(s.sd / 1000, 3)} MPa` });
      steps.push({ label: 'Schubfestigkeit', f: 'f_{vk} = min(f_{vk0} + 0.4·σ_d; f_{vlt})', v: `= min(${num(md.fvk0, 2)} + 0.4·${num(s.sd / 1000, 3)}; ${num(md.fvlt, 2)})`, r: `= ${num(s.fvk / 1000, 3)} MPa`, ref: 'EN 1996-1-1 (3.5)' });
      steps.push({ label: 'Querkraftwiderstand', f: 'V_{Rd} = f_{vk}/γ_M·t·l_c', v: `= ${num(s.fvd / 1000, 3)}·${num(t, 3)}·${num(s.lc, 3)}·10^3`, r: `= ${num(s.VRd, 1)} kN`, ref: 'EN 1996-1-1 (6.13)' });
      steps.push({ label: 'Normalkraft in Wandebene', f: 'N_{Rd} = f_{xd}·t·(l − 2e)', v: `= ${num(R.fxd, 0)}·${num(t, 3)}·(${num(l, 2)} − 2·${num(s.e, 3)})`, r: `= ${num(s.NRd, 1)} kN` });
      eta = etaOf([cs.checks.shearEN.eta, cs.checks.shearN.eta]);
      steps.push({ label: 'Ausnutzung', f: 'η = max(V_d/V_{Rd}; N_d/N_{Rd})', r: `= ${num(eta, 2)}` });
    }
    out.push({ id: 'shear', title: 'Querkraft in Wandebene', ref: s.method === 'SIA' ? 'SIA 266, 4.4 (Spannungsfeld)' : 'EN 1996-1-1, 6.2', steps, result: { eta, text: `η = ${num(eta, 2)} → ${verdict(eta)}` } });
  }

  // ------------------------------------------------------------------ 6 Teilfläche
  const cc = govCombo(R, ['conc', 'concMid']);
  if (cc?.conc) {
    const q = cc.conc, C = L.conc, F = cc.F;
    const steps = [comboLine(cc, p)];
    steps.push({ label: 'Einzellast', f: 'N_{c,d} = γ_G·G_k + γ_Q·Q_k', v: `= ${num(F.g, 2)}·${num(C.G || 0, 1)} + ${num(F.q, 2)}·${num(C.Q || 0, 1)}`, r: `= ${num(q.Nc, 1)} kN` });
    steps.push({ label: 'Lastfläche', f: 'A_b = a·b', v: `= ${num(C.a / 1000, 3)}·${num(C.b / 1000, 3)}`, r: `= ${num(q.Ab, 4)} m²` });
    steps.push({ label: 'Randabstand', f: 'a_1 = min(x; l − x − a)', r: `= ${num(q.a1, 3)} m` });
    steps.push({ label: 'wirksame Länge in Wandmitte (Ausbreitung 60°)', f: 'l_{efm} = a + Σ min(Rand; h_c/(2·sqrt(3)))', v: `h_c/(2·sqrt(3)) = ${num(q.spread, 3)} m`, r: `= ${num(q.lefm, 3)} m` });
    steps.push({ label: 'Flächenverhältnis', f: 'A_b/A_{ef} = A_b/(l_{efm}·t) <= 0.45', v: `= ${num(q.Ab, 4)}/(${num(q.lefm, 3)}·${num(t, 3)})`, r: `= ${num(q.ratio, 3)}` });
    steps.push(md.solid
      ? { label: 'Erhöhungsfaktor', f: 'β = (1 + 0.3·a_1/h_c)·(1.5 − 1.1·A_b/A_{ef})', v: `= (1 + 0.3·${num(q.a1, 3)}/${num(h, 2)})·(1.5 − 1.1·${num(q.ratio, 3)}), 1 ≤ β ≤ ${num(q.betaMax, 3)}`, r: `= ${num(q.beta, 3)}`, ref: 'EN 1996-1-1 (6.10)' }
      : { label: 'Erhöhungsfaktor (Loch-/Hohlsteine)', f: 'β = 1.0', ref: 'EN 1996-1-1, 6.1.3 (1)' });
    steps.push({ label: 'Widerstand unter der Lastfläche', f: 'N_{Rdc} = β·A_b·f_{xd}', v: `= ${num(q.beta, 3)}·${num(q.Ab, 4)}·${num(R.fxd, 0)}`, r: `= ${num(q.NRdc, 1)} kN`, ref: 'EN 1996-1-1 (6.9)' });
    steps.push({ label: 'Wandmitte: Einzellast verteilt + Auflast', f: 'n_{Ed,m} = N_{c,d}/l_{efm} + n_{d,m}', v: `= ${num(q.Nc, 1)}/${num(q.lefm, 3)} + ${num(cc.nMid, 1)}`, r: `= ${num(q.nEdMid, 1)} kN/m` });
    steps.push({ label: 'Widerstand in Wandmitte', f: 'n_{Rd,m} = Φ_m·t·f_{xd}', v: `= ${num(cc.phiMid, 3)}·${num(t, 3)}·${num(R.fxd, 0)}`, r: `= ${num(q.nRdMid, 1)} kN/m` });
    const eta = etaOf([cc.checks.conc.eta, cc.checks.concMid.eta]);
    steps.push({ label: 'Ausnutzung', f: 'η = max(N_{c,d}/N_{Rdc}; n_{Ed,m}/n_{Rd,m})', v: `= max(${num(cc.checks.conc.eta, 2)}; ${num(cc.checks.concMid.eta, 2)})`, r: `= ${num(eta, 2)}` });
    out.push({ id: 'conc', title: 'Teilflächenbelastung', ref: 'EN 1996-1-1, 6.1.3', steps, result: { eta, text: `η = ${num(eta, 2)} → ${verdict(eta)}` } });
  }

  // ------------------------------------------------------------------ 7 Querlast
  const cl = govCombo(R, ['lat']);
  if (cl?.lat) {
    const F = cl.F, E = L.earth || {}, lt = cl.lat;
    const steps = [comboLine(cl, p)];
    const pf = [];
    if (L.wind) pf.push('γ_W·w_k');
    if (E.on) pf.push('γ_{Erd}·K·(γ_B·(h_e − z) + q_k)');
    steps.push({ label: 'Querlast über die Höhe', f: `p_d(z) = ${pf.join(' + ') || '0'}`, v: [L.wind ? `${num(F.w, 2)}·${num(L.wind, 2)}` : null, E.on ? `${num(F.e, 2)}·${num(E.K, 2)}·(${num(E.gs, 1)}·(${num(E.he, 2)} − z) + ${num(E.qs, 1)})` : null].filter(Boolean).join(' + '), r: `p_{d,max} = ${num(cl.pMax, 2)} kN/m²` });
    const Mq = Math.max(...cl.model.Mq.map(Math.abs));
    steps.push({ label: 'Moment aus Querlast (einfacher Balken der Höhe h)', f: 'M_q(z) = R_u·z − ∫_0^z p_d(ζ)·(z − ζ) dζ', r: `M_{q,max} = ${num(Mq, 2)} kNm/m` });
    steps.push({ label: 'Normalkraft in Wandmitte', f: 'n_{d,m}', r: `= ${num(cl.nMid, 1)} kN/m` });
    if (lt.arching) steps.push({ label: 'Bogenwirkung: Lage der Resultierenden am Wandfuss', f: '|e_u| <= t/2 − n_{d,u}/(2·f_{xd})', v: `= ${num(t * 500, 1)} − ${num(cl.nBot, 1)}/(2·${num(R.fxd / 1000, 3)})`, r: `gewählt e_u = ${mm(lt.eU, 0)} mm`, note: 'Statische Methode: die günstigste zulässige Lage wird gesucht (Goldener Schnitt).' });
    steps.push({ label: 'Stützlinie (Th. 2. Ordnung)', f: 'e(z) = (M_1(z) + μ·M_q(z))/N(z) + e_0·sin(π·z/h) + w(z),  |e| < t/2', note: 'Biegelinie wie beim Knicknachweis; die Vertikallasten bleiben fest.' });
    steps.push({ label: 'Laststeigerung der Querlast', f: 'μ_u = max μ: Gleichgewicht für μ·p_d', r: `μ_u = ${Number.isFinite(lt.xMax) ? num(lt.xMax, 3) : '> 1000'}`, note: `Versagen: ${lt.blocked ? 'Normalkraft ohne Querlast bereits ungenügend' : lt.mode}` });
    const eta = lt.eta;
    steps.push({ label: 'Ausnutzung', f: 'η = 1/μ_u', r: `= ${num(eta, 2)}` });
    out.push({ id: 'lat', title: 'Querbelastung (Stützlinie)', ref: 'SIA 266, 4.3', steps, result: { eta, text: `η = ${num(eta, 2)} → ${verdict(eta)}` } });
  }
  const cbs = govCombo(R, ['basMax', 'basMin']);
  if (cbs?.basement) {
    const b = cbs.basement, E = L.earth;
    const bc = p.settings.bc;
    const steps = [comboLine(cbs, p)];
    steps.push({ label: 'Beiwert für den Querwandabstand', f: 'β = 20 (b_c ≥ 2h); 60 − 20·b_c/h (h < b_c < 2h); 40 (b_c ≤ h)', v: `b_c = ${num(bc, 2)} m, h = ${num(h, 2)} m`, r: `β = ${num(b.beta, 1)}`, ref: 'EN 1996-3 (4.17)' });
    steps.push({ label: 'obere Grenze der Normalkraft', f: 'N_{Ed,max} <= t·f_d/3', v: `= ${num(t, 3)}·${num(R.fxd, 0)}/3`, r: `= ${num(b.NmaxRd, 1)} kN/m`, ref: 'EN 1996-3 (4.15)' });
    steps.push({ label: 'erforderliche Normalkraft (Bogenwirkung)', f: 'N_{Ed,min} >= ρ_e·h·h_e^2/(β·t)', v: `= ${num(E.gs, 1)}·${num(h, 2)}·${num(E.he, 2)}^2/(${num(b.beta, 1)}·${num(t, 3)})`, r: `= ${num(b.NminReq, 1)} kN/m`, ref: 'EN 1996-3 (4.16)' });
    steps.push({ label: 'vorhandene Normalkraft in Wandmitte', f: 'N_{Ed}', r: `= ${num(b.N, 1)} kN/m` });
    const eta = etaOf([cbs.checks.basMax.eta, cbs.checks.basMin.eta]);
    out.push({ id: 'bas', title: 'Kelleraussenwand vereinfacht', ref: 'EN 1996-3, 4.5', intro: 'Anwendungsgrenzen: h ≤ 2.6 m, t ≥ 200 mm, Decke als Scheibe, Geländeauflast ≤ 5 kN/m², kein Wasserdruck.', steps, result: { eta, text: `η = ${num(eta, 2)} → ${verdict(eta)}` } });
  }

  // ------------------------------------------------------------------ 8 Gebrauch
  const gSteps = [{ label: 'Schlankheit', f: `h_{ef}/t <= ${num(R.lambdaLim, 0)}`, v: `${num(R.hef, 3)}/${num(t, 3)}`, r: `= ${num(R.slender, 1)}`, ref: 'EN 1996-1-1, 5.5.1.4' }];
  const sls = R.combos.filter((c) => c.sls);
  for (const c of sls) {
    gSteps.push({ label: `Klaffende Fuge – ${c.name}`, f: 'max(|e_o|, |e_m|, |e_u|) <= t/3', v: `max(${mm(Math.abs(c.sls.eTop))}, ${mm(Math.abs(c.sls.eMid))}, ${mm(Math.abs(c.sls.eBot))}) ≤ ${mm(c.sls.lim)}`, r: `η = ${num(c.checks.crack.eta, 2)}`, note: 'Ausmitten nach Th. 1. Ordnung unter charakteristischen Lasten (Empfehlung zur Rissbegrenzung).' });
  }
  const etaG = etaOf([R.slender / R.lambdaLim, ...sls.map((c) => c.checks.crack.eta)]);
  out.push({ id: 'gzg', title: 'Gebrauchstauglichkeit und Konstruktion', ref: 'EN 1996-1-1, 5.5.1.4', steps: gSteps, result: { eta: etaG, text: `η = ${num(etaG, 2)} → ${verdict(etaG)}` } });

  return out;
}
