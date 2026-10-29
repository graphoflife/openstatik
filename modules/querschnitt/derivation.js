// Querschnitt – Herleitung (Rechenweg): allgemeine Formel, eingesetzte Werte, Ergebnis und Normbezug
//
// Abschnitte: Baustoffe, Bruttoquerschnitt, ideelle Werte, zentrischer Widerstand, je GZT-Lastfall Biegung mit
// Normalkraft (gzt:i) und Querkraft (v:i), je GZG-Lastfall Spannungsnachweis (gzg:i). Die Nachweiszeilen im
// Ergebnisbereich verlinken mit deriv: 'gzt:i' usw. auf ihren Abschnitt.
import { num } from '../../js/core/formula.js';
import { forceResultants, SIA_FIG31, SLS_REQUIREMENTS } from './calc.js';
import { polygonProps, barAreaMm2 } from './shapes.js';
import { shapeLabel } from './model.js';

const MM = 1e-3;
const pm = (e, d = 3) => num(e * 1000, d);              // Dehnung → ‰
const mmOf = (m, d = 1) => num(m / MM, d);              // m → mm
const par = (v, d) => (v < 0 ? `(${num(v, d)})` : num(v, d)); // negative Werte beim Einsetzen in Klammern
const okText = (eta) => (Number.isFinite(eta) && eta <= 1.0001 ? `η = ${num(eta, 2)} <= 1 → erfüllt` : `η = ${Number.isFinite(eta) ? num(eta, 2) : '∞'} > 1 → nicht erfüllt`);

/** Herleitung für createApp({derivation}). */
export function derivation(app) {
  const R = app.results;
  if (!R) return [];
  const p = app.project;
  const out = [materialsSection(R, p), grossSection(R, p), idealSection(R), axialSection(R)];
  for (const c of R.cases) {
    if (c.type === 'GZT') {
      out.push(ulsSection(R, c));
      if (c.shear) out.push(shearSection(R, p, c));
    } else out.push(slsSection(R, p, c));
  }
  return out.filter(Boolean);
}

// ------------------------------------------------------------------ Baustoffe

function materialsSection(R, p) {
  const { c, s } = R.mat;
  const sia = R.mat.norm === 'SIA';
  const steps = [];
  if (sia) {
    steps.push({ label: 'Umrechnungsbeiwert der Betonfestigkeit', f: 'η_fc = (30/f_ck)^{1/3} <= 1', v: `= (30/${num(c.fck, 0)})^{1/3}`, r: `= ${num(c.etaFc, 3)}`, ref: 'SIA 262, 4.2.1.2' });
    steps.push({ label: 'Bemessungswert der Betondruckfestigkeit', f: 'f_cd = η_fc·η_t·f_ck/γ_c', v: `= ${num(c.etaFc, 3)}·1.0·${num(c.fck, 0)}/${num(c.gammaC, 2)}`, r: `= ${num(c.fcd, 2)} MPa`, ref: 'SIA 262, 2.3.2.3', note: 'η_t = 1.0 (keine Langzeitabminderung).' });
    if (p.shear?.active) steps.push({ label: 'Bemessungswert der Schubspannungsgrenze', f: 'τ_cd = 0.3·η_t·sqrt(f_ck)/γ_c', v: `= 0.3·1.0·sqrt(${num(c.fck, 0)})/${num(c.gammaC, 2)}`, r: `= ${num(c.tcd, 3)} MPa`, ref: 'SIA 262, 2.3.2.4' });
    steps.push({ label: 'Elastizitätsmodul', f: 'E_cm = k_E·f_cm^{1/3}, f_cm = f_ck + 8', v: `= 10 000·(${num(c.fck, 0)} + 8)^{1/3}`, r: `= ${num(c.Ecm, 0)} MPa`, ref: 'SIA 262, 3.1.2.3', note: 'k_E = 10 000 (Mittelwert).' });
  } else {
    steps.push({ label: 'Bemessungswert der Betondruckfestigkeit', f: 'f_cd = α_cc·f_ck/γ_c', v: `= ${num(p.material?.alphaCC > 0 ? p.material.alphaCC : 1, 2)}·${num(c.fck, 0)}/${num(c.gammaC, 2)}`, r: `= ${num(c.fcd, 2)} MPa`, ref: 'EN 1992-1-1, 3.1.6 (3.15)' });
    steps.push({ label: 'Elastizitätsmodul', f: 'E_cm = 22·(f_cm/10)^{0.3} GPa, f_cm = f_ck + 8', v: `= 22·((${num(c.fck, 0)} + 8)/10)^{0.3}`, r: `= ${num(c.Ecm / 1000, 2)} GPa`, ref: 'EN 1992-1-1, Tab. 3.1' });
  }
  steps.push({ label: 'Mittlere Zugfestigkeit', f: 'f_ctm = 0.30·f_ck^{2/3}', v: `= 0.30·${num(c.fck, 0)}^{2/3}`, r: `= ${num(c.fctm, 2)} MPa`, ref: sia ? 'SIA 262, 3.1.2.2' : 'EN 1992-1-1, Tab. 3.1', note: 'Nur für die M-κ-Linie mit Mittelwerten (Rissmoment); im Tragwiderstand ohne Betonzug.' });
  steps.push({
    label: 'Parabel-Rechteck-Diagramm (Druck)', f: `|σ_c| = f_cd·[1 − (1 − |ε_c|/ε_c2)^${Number.isInteger(c.n) ? c.n : num(c.n, 2)}] für |ε_c| <= ε_c2;   |σ_c| = f_cd für ε_c2 < |ε_c| <= ε_cu`,
    v: `ε_c2 = ${pm(c.ec2, 2)} ‰, ε_cu = ${pm(c.ecu, 2)} ‰`, ref: sia ? 'SIA 262, 4.2.1' : 'EN 1992-1-1, 3.1.7 (3.17)', note: 'Beton ohne Zugfestigkeit; Druck negativ.',
  });
  steps.push({ label: sia ? 'Bemessungswert der Fliessgrenze' : 'Bemessungswert der Streckgrenze', f: sia ? 'f_sd = f_sk/γ_s' : 'f_yd = f_yk/γ_s', v: `= ${num(s.fsk, 0)}/${num(s.gammaS, 2)}`, r: `= ${num(s.fsd, 1)} MPa`, ref: sia ? 'SIA 262, 2.3.2.5' : 'EN 1992-1-1, 3.2.7' });
  steps.push({ label: 'Fliessdehnung', f: 'ε_sd = f_sd/E_s', v: `= ${num(s.fsd, 1)}/${num(s.Es, 0)}`, r: `= ${pm(s.fsd / s.Es, 2)} ‰`, note: `E_s = ${num(s.Es / 1000, 0)} GPa.` });
  steps.push({
    label: 'Bilineares Stahlgesetz', f: R.mat.hardening ? 'σ_s = E_s·ε_s für |ε_s| <= ε_sd; danach linear bis k_s·f_sd bei ε_ud' : 'σ_s = E_s·ε_s <= f_sd (horizontales Fliessplateau)',
    v: sia ? `ε_ud = ${pm(s.eud, 1)} ‰${R.mat.hardening ? `, k_s = ${num(s.ks, 2)}` : ''}` : `ε_ud = 0.9·ε_uk = 0.9·${pm(s.euk, 1)} ‰ = ${pm(s.eud, 1)} ‰${R.mat.hardening ? `, k = ${num(s.ks, 2)}` : ''}`,
    ref: sia ? 'SIA 262, 4.2.2' : 'EN 1992-1-1, 3.2.7 (2)',
  });
  return { id: 'baustoffe', title: 'Baustoffkennwerte', ref: sia ? `SIA 262 · ${c.name} · ${s.name}` : `EN 1992-1-1 · ${c.name} · ${s.name}`, steps };
}

// ------------------------------------------------------------------ Querschnittswerte

function grossSection(R, p) {
  const g = R.geom.mm, G = R.grossMm;
  const outer = polygonProps(g.outer);
  const holes = g.holes.map((hh) => polygonProps(hh));
  const Ah = holes.reduce((t, q) => t + Math.abs(q.A), 0);
  const A = G.A;
  const Sy = A * G.cz, Sz = A * G.cy;
  const sum = (k) => outer[k] * Math.sign(outer.A) - holes.reduce((t, q) => t + q[k] * Math.sign(q.A), 0);
  const Iy0 = sum('Iy0'), Iz0 = sum('Iz0'), Iyz0 = sum('Iyz0');
  const e6 = (x) => num(x / 1e6, 2);
  const steps = [];
  const t = p.shape.type, sp = p.shape[t] || {};
  steps.push({
    label: 'Fläche', f: holes.length ? 'A_c = A_Umriss − Σ A_Aussparung' : 'A_c = 1/2·Σ (y_i·z_{i+1} − y_{i+1}·z_i)',
    v: holes.length ? `= ${num(Math.abs(outer.A), 0)} − ${num(Ah, 0)}` : null, r: `= ${num(A, 0)} mm²`,
    note: `Gauss'sche Flächenformel über die ${g.outer.length} Eckpunkte des Umrisses${holes.length ? ` und ${holes.length} Aussparung(en)` : ''} (${shapeLabel(t)}).`,
  });
  if (t === 'rect' && !holes.length) steps.push({ label: 'Kontrolle Rechteck', f: 'A_c = b·h', v: `= ${num(sp.b, 0)}·${num(sp.h, 0)}`, r: `= ${num(sp.b * sp.h, 0)} mm²` });
  if (t === 'circle' && !holes.length) steps.push({ label: 'Kontrolle Kreis', f: 'A_c = π·D^2/4', v: `= π·${num(sp.D, 0)}^2/4`, r: `= ${num(Math.PI * sp.D ** 2 / 4, 0)} mm²`, note: 'Kreis als flächengleiches 72-Eck modelliert.' });
  steps.push({ label: 'Statische Momente', f: 'S_y = ∫z dA,   S_z = ∫y dA', r: `S_y = ${num(Sy / 1e6, 3)}·10^6 mm³,   S_z = ${num(Sz / 1e6, 3)}·10^6 mm³` });
  steps.push({ label: 'Schwerpunkt', f: 'y_S = S_z/A_c,   z_S = S_y/A_c', v: `= ${num(Sz / 1e6, 3)}·10^6/${num(A, 0)},   ${num(Sy / 1e6, 3)}·10^6/${num(A, 0)}`, r: `y_S = ${num(G.cy, 1)} mm,   z_S = ${num(G.cz, 1)} mm` });
  steps.push({ label: 'Trägheitsmoment um die y-Achse durch S', f: 'I_y = ∫z^2 dA − A_c·z_S^2', v: `= (${e6(Iy0)} − ${e6(A * G.cz ** 2)})·10^6`, r: `= ${e6(G.Iy)}·10^6 mm⁴`, ref: 'Steiner' });
  steps.push({ label: 'Trägheitsmoment um die z-Achse durch S', f: 'I_z = ∫y^2 dA − A_c·y_S^2', v: `= (${e6(Iz0)} − ${e6(A * G.cy ** 2)})·10^6`, r: `= ${e6(G.Iz)}·10^6 mm⁴` });
  if (t === 'rect' && !holes.length) steps.push({ label: 'Kontrolle Rechteck', f: 'I_y = b·h^3/12', v: `= ${num(sp.b, 0)}·${num(sp.h, 0)}^3/12`, r: `= ${e6(sp.b * sp.h ** 3 / 12)}·10^6 mm⁴` });
  if (t === 'circle' && !holes.length) steps.push({ label: 'Kontrolle Kreis', f: 'I = π·D^4/64', v: `= π·${num(sp.D, 0)}^4/64`, r: `= ${e6(Math.PI * sp.D ** 4 / 64)}·10^6 mm⁴`, note: 'Abweichung des 72-Ecks < 0.1 %.' });
  const rot = !G.isotropic && Math.abs(G.Iyz) > 1e-9 * (Math.abs(G.Iy) + Math.abs(G.Iz));
  steps.push({ label: 'Deviationsmoment', f: 'I_yz = ∫y·z dA − A_c·y_S·z_S', v: `= (${e6(Iyz0)} − ${e6(A * G.cy * G.cz)})·10^6`, r: `= ${e6(G.Iyz)}·10^6 mm⁴`, note: rot ? '' : 'I_yz = 0: y und z sind Hauptachsen.' });
  if (rot) {
    steps.push({ label: 'Hauptträgheitsmomente', f: 'I_{1,2} = (I_y + I_z)/2 ± sqrt(((I_y − I_z)/2)^2 + I_yz^2)', v: `= (${e6(G.Iy)} + ${e6(G.Iz)})/2 ± sqrt(((${e6(G.Iy)} − ${e6(G.Iz)})/2)^2 + ${par(G.Iyz / 1e6, 2)}^2)`, r: `I_1 = ${e6(G.I1)}·10^6, I_2 = ${e6(G.I2)}·10^6 mm⁴` });
    steps.push({ label: 'Lage der Hauptachse 1', f: 'tan 2α = −2·I_yz/(I_y − I_z)', r: `α = ${num(G.alpha * 180 / Math.PI, 2)}°`, note: 'Winkel gegen die y-Achse im Gegenuhrzeigersinn; Achse 1 mit dem grössten Trägheitsmoment.' });
  }
  return { id: 'querschnitt', title: 'Bruttoquerschnitt (Beton)', ref: 'Querschnittswerte', steps };
}

function idealSection(R) {
  const n = R.mat.nShort, I = R.ideal, G = R.grossMm;
  const bars = R.geom.mm.bars;
  if (!bars.length) return null;
  const As = bars.reduce((t, b) => t + barAreaMm2(b.d), 0);
  const Sy = bars.reduce((t, b) => t + barAreaMm2(b.d) * b.z, 0), Sz = bars.reduce((t, b) => t + barAreaMm2(b.d) * b.y, 0);
  const Ai = I.A * 1e6, ci = [I.cy / MM, I.cz / MM];
  const sumZ = bars.reduce((t, b) => t + barAreaMm2(b.d) * (b.z - ci[1]) ** 2, 0);
  const sumY = bars.reduce((t, b) => t + barAreaMm2(b.d) * (b.y - ci[0]) ** 2, 0);
  const e6 = (x) => num(x / 1e6, 2);
  const ds = [...new Set(bars.map((b) => b.d))].sort((a, b) => a - b);
  return {
    id: 'ideell', title: 'Ideelle Querschnittswerte (ungerissen)', ref: 'Kurzzeit-Wertigkeit',
    intro: 'Die Bewehrung wird mit der (n_0 − 1)-fachen Fläche zum Bruttobeton addiert, n_0 = E_s/E_cm (Kurzzeit, ohne Kriechen).',
    steps: [
      { label: 'Wertigkeit', f: 'n_0 = E_s/E_cm', v: `= ${num(R.mat.s.Es, 0)}/${num(R.mat.c.Ecm, 0)}`, r: `= ${num(n, 3)}` },
      { label: 'Bewehrung', f: 'A_s = Σ π·Ø_i^2/4', r: `= ${num(As, 0)} mm²`, note: `${bars.length} Stäbe (Ø ${ds.join(', ')} mm), ρ = A_s/A_c = ${num(As / G.A * 100, 2)} %.` },
      { label: 'Ideelle Fläche', f: 'A_i = A_c + (n_0 − 1)·A_s', v: `= ${num(G.A, 0)} + (${num(n, 3)} − 1)·${num(As, 0)}`, r: `= ${num(Ai, 0)} mm²` },
      { label: 'Ideeller Schwerpunkt', f: 'z_i = (A_c·z_S + (n_0 − 1)·Σ A_s,i·z_s,i)/A_i', v: `= (${num(G.A, 0)}·${num(G.cz, 1)} + ${num(n - 1, 3)}·${num(Sy, 0)})/${num(Ai, 0)}`, r: `= ${num(ci[1], 1)} mm (y_i = ${num(ci[0], 1)} mm)`, note: `y_i analog mit Σ A_s,i·y_s,i = ${num(Sz, 0)} mm³.` },
      { label: 'Ideelles Trägheitsmoment um y', f: 'I_y,i = I_y + A_c·(z_S − z_i)^2 + (n_0 − 1)·Σ A_s,i·(z_s,i − z_i)^2', v: `= (${e6(G.Iy)} + ${e6(G.A * (G.cz - ci[1]) ** 2)} + ${num(n - 1, 3)}·${e6(sumZ)})·10^6`, r: `= ${e6(I.Iy * 1e12)}·10^6 mm⁴` },
      { label: 'Ideelles Trägheitsmoment um z', f: 'I_z,i = I_z + A_c·(y_S − y_i)^2 + (n_0 − 1)·Σ A_s,i·(y_s,i − y_i)^2', v: `= (${e6(G.Iz)} + ${e6(G.A * (G.cy - ci[0]) ** 2)} + ${num(n - 1, 3)}·${e6(sumY)})·10^6`, r: `= ${e6(I.Iz * 1e12)}·10^6 mm⁴` },
    ],
  };
}

// ------------------------------------------------------------------ Zentrischer Widerstand

function axialSection(R) {
  const { c, s } = R.mat;
  const Ac = R.grossMm.A, As = R.geom.mm.bars.reduce((t, b) => t + barAreaMm2(b.d), 0);
  const sigC2 = Math.min(s.Es * c.ec2, s.fsd);
  const Nc = -((Ac - As) * c.fcd + As * sigC2) / 1000;
  const fu = R.mat.hardening ? s.ks * s.fsd : s.fsd;
  const Nt = As * fu / 1000;
  return {
    id: 'normalkraft', title: 'Zentrischer Widerstand', ref: R.mat.norm === 'SIA' ? 'SIA 262, 4.3.1 / 4.2.1' : 'EN 1992-1-1, 6.1 (5)',
    intro: 'Zentrischer Druck: gleichmässige Stauchung ε_c2 über den ganzen Querschnitt. Zentrischer Zug: nur die Bewehrung trägt (ε_s = ε_ud).',
    steps: [
      { label: 'Stahlspannung bei zentrischem Druck', f: 'σ_s(ε_c2) = min(E_s·ε_c2, f_sd)', v: `= min(${num(s.Es, 0)}·${num(c.ec2, 4)}, ${num(s.fsd, 1)})`, r: `= ${num(sigC2, 1)} MPa` },
      { label: 'Druckwiderstand', f: 'N_Rd,c = −[(A_c − A_s)·f_cd + A_s·σ_s(ε_c2)]', v: `= −[(${num(Ac, 0)} − ${num(As, 0)})·${num(c.fcd, 2)} + ${num(As, 0)}·${num(sigC2, 1)}]·10^{-3}`, r: `= ${num(Nc, 0)} kN`, note: `Fasermodell: N_Rd,c = ${num(R.axial.Nc, 0)} kN.` },
      { label: 'Zugwiderstand', f: R.mat.hardening ? 'N_Rd,t = A_s·k_s·f_sd' : 'N_Rd,t = A_s·f_sd', v: `= ${num(As, 0)}·${num(fu, 1)}·10^{-3}`, r: `= ${num(Nt, 0)} kN`, note: `Fasermodell: N_Rd,t = ${num(R.axial.Nt, 0)} kN.` },
    ],
  };
}

// ------------------------------------------------------------------ GZT: Biegung mit Normalkraft

/** Schritte der Dehnungsebene (Kern: e0 im Schwerpunkt S, ky/kz in 1/m). */
function planeSteps(st, label) {
  const k = Math.hypot(st.ky, st.kz);
  const cl = (v) => (Math.abs(v) < 1e-4 * k ? 0 : v); // numerisches Rauschen bei einachsiger Biegung
  const steps = [
    { label, f: 'ε(y, z) = ε_0 + κ_y·(y − y_S) + κ_z·(z − z_S)', v: `ε_0 = ${pm(st.e0)} ‰,   κ_y = ${pm(cl(st.ky))} ‰/m,   κ_z = ${pm(cl(st.kz))} ‰/m`, note: 'Ebenbleiben der Querschnitte (Bernoulli), starrer Verbund; ε_0 im Betonschwerpunkt S.' },
    { label: 'Randdehnungen', f: 'ε_c,min,   ε_s,max', r: `= ${pm(st.ext.ecMin, 2)} ‰,   ${st.bars.length ? `${pm(st.ext.esMax, 2)} ‰` : '–'}` },
  ];
  if (Number.isFinite(st.x) && st.x > 0 && k > 1e-12) steps.push({ label: 'Druckzonenhöhe', f: 'x = |ε_c,min|/|κ|,   |κ| = sqrt(κ_y^2 + κ_z^2)', v: `= ${pm(-st.ext.ecMin)}/${pm(k)}`, r: `= ${mmOf(st.x, 0)} mm` });
  return steps;
}

function ulsSection(R, c) {
  const u = c.uls;
  const sia = R.mat.norm === 'SIA';
  const G = R.secRef, Rf = R.ref;
  const dy = Rf[0] - G[0], dz = Rf[1] - G[1];
  const toG = (My, Mz) => ({ My: My - c.N * dz, Mz: Mz + c.N * dy });
  const ed = toG(c.My, c.Mz);
  const biax = Math.abs(ed.Mz) > 1e-6 || Math.abs(u.MzR) > 1e-3;
  const steps = [];
  steps.push({ label: 'Bemessungswerte der Schnittgrössen', f: 'N_Ed,   M_Ed,y,   M_Ed,z', r: `= ${num(c.N, 1)} kN,   ${num(c.My, 1)} kNm,   ${num(c.Mz, 1)} kNm`, note: 'N > 0 Zug; M_y > 0 Zug unten, M_z > 0 Zug rechts.' });
  if (Math.hypot(dy, dz) > 1e-9) {
    steps.push({
      label: 'Umrechnung auf den Betonschwerpunkt S', f: 'M_Ed,y,S = M_Ed,y − N_Ed·(z_R − z_S),   M_Ed,z,S = M_Ed,z + N_Ed·(y_R − y_S)',
      v: `= ${num(c.My, 1)} − ${par(c.N, 1)}·${par(dz, 4)},   ${num(c.Mz, 1)} + ${par(c.N, 1)}·${par(dy, 4)}`, r: `= ${num(ed.My, 1)} kNm,   ${num(ed.Mz, 1)} kNm`,
      note: 'R: Bezugspunkt der Eingabe. Gerechnet wird stets um S – die Ausnutzung hängt so nicht vom Bezugspunkt ab.',
    });
  }
  // Zustand unter Bemessungslasten
  if (c.ulsState.ok) {
    steps.push(...planeSteps(c.ulsState, 'Dehnungsebene unter Bemessungslasten (Gleichgewicht, Newton-Verfahren)'));
  } else {
    steps.push({ label: 'Dehnungsebene unter Bemessungslasten', f: '∫σ dA = N_Ed,   −∫σ·(z − z_S) dA = M_Ed,y,   ∫σ·(y − y_S) dA = M_Ed,z', note: 'Kein Gleichgewicht innerhalb der Grenzdehnungen – der Tragwiderstand ist überschritten.' });
  }
  // Widerstand
  if (u.outside) {
    steps.push({ label: 'Normalkraft ausserhalb des zentrischen Widerstands', f: 'η_N = N_Ed/N_Rd', v: `= ${num(c.N, 0)}/${num(u.NR, 0)}`, r: `= ${num(u.etaN, 3)}` });
    return { id: `gzt:${c.i}`, title: `${c.name}: Biegung mit Normalkraft`, ref: sia ? 'SIA 262, 4.3.2' : 'EN 1992-1-1, 6.1', steps, result: { eta: u.eta, text: okText(u.eta) } };
  }
  const rs = u.rstate;
  const resG = toG(u.MyR, u.MzR);
  if (rs) {
    const crit = /ε_?cu/.test(u.mode) ? `ε_c,min = −ε_cu = ${pm(rs.ext.ecMin, 2)} ‰` : /ε_?ud/.test(u.mode) ? `ε_s,max = ε_ud = ${pm(rs.ext.esMax, 2)} ‰` : `ε = −ε_c2 im Drehpunkt`;
    steps.push({ label: 'Bruchzustand bei gleichem N und gleicher Momentenrichtung', f: crit, note: `Versagensart: ${u.mode}. Die Dehnungsebene wird um den massgebenden Drehpunkt gedreht (Pivot-Methode), bis ∫σ dA = N_Ed.` });
    steps.push(...planeSteps(rs, 'Dehnungsebene im Bruchzustand'));
    const sec = R.secs.uls;
    const fr = forceResultants(sec, rs);
    const at = (pt) => (pt ? `y = ${mmOf(pt[0])} mm, z = ${mmOf(pt[1])} mm` : '');
    steps.push({ label: 'Betondruckkraft', f: 'F_c = ∫σ_c(ε) dA_c', r: `= ${num(fr.Fc, 1)} kN`, note: `Summe über ${sec.nFibers} Fasern; Angriffspunkt ${at(fr.pc)}.` });
    if (fr.nCompression) steps.push({ label: 'Stahldruckkraft', f: 'F_s,c = Σ σ_s,i·A_s,i   (σ_s < 0)', r: `= ${num(fr.Fsc, 1)} kN`, note: `${fr.nCompression} Stäbe; Angriffspunkt ${at(fr.psc)}.` });
    if (fr.nTension) steps.push({ label: 'Stahlzugkraft', f: 'F_s,t = Σ σ_s,i·A_s,i   (σ_s > 0)', r: `= ${num(fr.Fst, 1)} kN`, note: `${fr.nTension} Stäbe; Angriffspunkt ${at(fr.pst)}.` });
    steps.push({ label: 'Gleichgewicht der Normalkräfte', f: 'F_c + F_s,c + F_s,t = N_Ed', v: `= ${par(fr.Fc, 1)} + ${par(fr.Fsc, 1)} + ${par(fr.Fst, 1)}`, r: `= ${num(fr.N, 1)} kN (N_Ed = ${num(c.N, 1)} kN)` });
    if (fr.lever) steps.push({ label: 'Hebelarm der inneren Kräfte', f: 'z = Abstand der Resultierenden F_s,t und F_c + F_s,c (in Richtung des Dehnungsgradienten)', r: `= ${mmOf(fr.lever, 0)} mm` });
    const terms = (k) => [[fr.Fc, fr.pc], [fr.Fsc, fr.psc], [fr.Fst, fr.pst]].filter(([F, pt]) => pt && Math.abs(F) > 1e-9).map(([F, pt]) => `${par(F, 1)}·${par(pt[k] - G[k], 4)}`).join(' + ');
    steps.push({ label: 'Biegewiderstand um S (y-Achse)', f: 'M_Rd,y = −Σ F_i·(z_i − z_S)', v: `= −[${terms(1)}]`, r: `= ${num(fr.My, 1)} kNm` });
    if (biax) steps.push({ label: 'Biegewiderstand um S (z-Achse)', f: 'M_Rd,z = Σ F_i·(y_i − y_S)', v: `= ${terms(0)}`, r: `= ${num(fr.Mz, 1)} kNm` });
    const dev = Math.hypot(fr.My - resG.My, fr.Mz - resG.Mz) / Math.max(1e-9, Math.hypot(resG.My, resG.Mz));
    if (dev > 0.002) steps.push({ label: 'Widerstand am Interaktionsrand', f: 'M_Rd,y,   M_Rd,z', r: `= ${num(resG.My, 1)} kNm,   ${num(resG.Mz, 1)} kNm`, note: 'My-Mz-Rand aus 96 Richtungen, linear interpoliert; massgebend für η.' });
  }
  // Ausnutzung
  const MEd = Math.hypot(ed.My, ed.Mz), MRd = Math.hypot(resG.My, resG.Mz);
  if (u.shifted) {
    const f0 = u.from;
    const fG = toG(f0[0], f0[1]);
    steps.push({ label: 'Ausnutzung aus den Momenten', f: 'η_M = |M_Ed − M_0|/|M_Rd − M_0|', v: `M_0 = (${num(fG.My, 1)}, ${num(fG.Mz, 1)}) kNm`, r: `= ${num(u.etaM, 3)}`, note: 'Der Ursprung liegt bei diesem N ausserhalb des My-Mz-Bereichs; gesteigert wird vom Flächenschwerpunkt M_0 des Bereichs aus.' });
  } else if (biax) {
    steps.push({ label: 'Ausnutzung aus den Momenten (radial bei konstantem N)', f: 'η_M = sqrt(M_Ed,y^2 + M_Ed,z^2)/sqrt(M_Rd,y^2 + M_Rd,z^2)', v: `= sqrt(${par(ed.My, 1)}^2 + ${par(ed.Mz, 1)}^2)/sqrt(${par(resG.My, 1)}^2 + ${par(resG.Mz, 1)}^2)`, r: `= ${num(MEd, 1)}/${num(MRd, 1)} = ${num(u.etaM, 3)}` });
  } else {
    steps.push({ label: 'Ausnutzung aus den Momenten (bei konstantem N)', f: 'η_M = M_Ed,y/M_Rd,y', v: `= ${num(ed.My, 1)}/${num(resG.My, 1)}`, r: `= ${num(u.etaM, 3)}` });
  }
  steps.push({ label: 'Ausnutzung aus der Normalkraft', f: 'η_N = N_Ed/N_Rd', v: c.N < 0 ? `= ${num(c.N, 0)}/${num(u.Nc, 0)}` : c.N > 0 ? `= ${num(c.N, 0)}/${num(u.Nt, 0)}` : '= 0', r: `= ${num(u.etaN, 3)}` });
  steps.push({ label: 'Massgebende Ausnutzung', f: 'η = max(η_M, η_N)', r: `= ${num(u.eta, 3)}` });
  return {
    id: `gzt:${c.i}`, title: `${c.name}: Biegung mit Normalkraft`, ref: sia ? 'SIA 262, 4.3.2 / 4.2.1' : 'EN 1992-1-1, 6.1',
    intro: 'Fasermodell des Querschnitts mit den Bemessungswerten der Werkstoffgesetze. Der Widerstand ergibt sich, indem die Momente bei gleichbleibender Normalkraft radial bis zum Bruchzustand gesteigert werden.',
    steps, result: { eta: u.eta, text: okText(u.eta) },
  };
}

// ------------------------------------------------------------------ Querkraft

function shearSection(R, p, c) {
  const s = c.shear, g = R.shearGeo, sh = p.shear || {};
  const { c: cc, s: st } = R.mat;
  const sia = R.mat.norm === 'SIA';
  const ang = Math.min(89, Math.max(1, +sh.angle || 30));
  const rad = ang * Math.PI / 180;
  const cot = 1 / Math.tan(rad);
  const steps = [];
  steps.push({ label: 'Querkraft', f: 'V_Ed', r: `= ${num(s.VEd, 1)} kN` });
  steps.push({
    label: 'Wirksame Abmessungen', f: 'b_w,   d,   z = 0.9·d', r: `= ${num(g.bw, 0)} mm,   ${num(g.d, 0)} mm,   ${num(g.z, 0)} mm`,
    note: `${sh.bwAuto !== false ? 'b_w: kleinste Materialbreite zwischen 10 % und 90 % der Höhe. ' : 'b_w vorgegeben. '}${sh.dAuto !== false ? `d: Druckrand bis Schwerpunkt der Zugbewehrung (${sh.side === 'oben' ? 'oben' : 'unten'}). ` : 'd vorgegeben. '}${sh.zAuto !== false ? '' : 'z vorgegeben.'}`,
  });
  if (s.hasStirrups) {
    steps.push({ label: 'Querkraftbewehrung', f: 'a_sw = n·π·Ø_w^2/4/s', v: `= ${num(+sh.legs, 0)}·π·${num(+sh.dw, 0)}^2/4/${num(+sh.s, 0)}·1000`, r: `= ${num(s.asw, 0)} mm²/m` });
  }
  if (sia) {
    if (s.hasStirrups) {
      steps.push({ label: 'Widerstand der Querkraftbewehrung', f: 'V_Rd,s = a_sw·z·f_sd·cot α', v: `= ${num(s.asw / 1000, 4)}·${num(g.z, 0)}·${num(st.fsd, 1)}·${num(cot, 3)}·10^{-3}`, r: `= ${num(s.VRds, 1)} kN`, ref: 'SIA 262, 4.3.3.4.3', note: `α = ${num(ang, 1)}° (Neigung des Druckfelds).` });
      steps.push({ label: 'Widerstand des Betondruckfelds', f: 'V_Rd,c = b_w·z·k_c·f_cd·sin α·cos α', v: `= ${num(g.bw, 0)}·${num(g.z, 0)}·0.55·${num(cc.fcd, 2)}·${num(Math.sin(rad), 3)}·${num(Math.cos(rad), 3)}·10^{-3}`, r: `= ${num(s.VRdc, 1)} kN`, ref: 'SIA 262, 4.3.3.4.6', note: 'k_c = 0.55 (Stege mit Querkraftbewehrung, vereinfacht).' });
      steps.push({ label: 'Querkraftwiderstand', f: 'V_Rd = min(V_Rd,s, V_Rd,c)', r: `= ${num(s.VRd, 1)} kN` });
    } else {
      const Dmax = Number.isFinite(+sh.Dmax) ? +sh.Dmax : 32;
      steps.push({ label: 'Beiwert Grösstkorn', f: 'k_g = 48/(16 + D_max)', v: `= 48/(16 + ${num(Dmax, 0)})`, r: `= ${num(s.kg, 3)}`, ref: 'SIA 262, 4.3.3.2.1' });
      steps.push(sh.epsMode === 'plastic'
        ? { label: 'Dehnung (plastische Schnittgrössen)', f: 'ε_v = 1.5·f_sd/E_s', v: `= 1.5·${num(st.fsd, 1)}/${num(st.Es, 0)}`, r: `= ${pm(s.epsv, 3)} ‰`, ref: 'SIA 262, 4.3.3.2.2' }
        : { label: 'Dehnung (elastische Schnittgrössen)', f: 'ε_v = f_sd/E_s·m_Ed/m_Rd', v: `= ${num(st.fsd, 1)}/${num(st.Es, 0)}·${num(Math.min(1, c.uls?.eta ?? 1), 3)}`, r: `= ${pm(s.epsv, 3)} ‰`, ref: 'SIA 262, 4.3.3.2.2', note: 'm_Ed/m_Rd = Biegeausnutzung η dieses Lastfalls (höchstens 1).' });
      steps.push({ label: 'Beiwert', f: 'k_d = 1/(1 + ε_v·d·k_g)', v: `= 1/(1 + ${num(s.epsv, 5)}·${num(g.d, 0)}·${num(s.kg, 3)})`, r: `= ${num(s.kd, 3)}`, ref: 'SIA 262, 4.3.3.2.1' });
      steps.push({ label: 'Querkraftwiderstand ohne Querkraftbewehrung', f: 'V_Rd = k_d·τ_cd·d·b_w', v: `= ${num(s.kd, 3)}·${num(cc.tcd, 3)}·${num(g.d, 0)}·${num(g.bw, 0)}·10^{-3}`, r: `= ${num(s.VRd, 1)} kN`, ref: 'SIA 262, 4.3.3.2.1' });
    }
  } else {
    steps.push({ label: 'Massstabsbeiwert', f: 'k = 1 + sqrt(200/d) <= 2', v: `= min(1 + sqrt(200/${num(g.d, 0)}), 2)`, r: `= ${num(s.k, 3)}`, ref: 'EN 1992-1-1, 6.2.2 (1)' });
    steps.push({ label: 'Längsbewehrungsgrad', f: 'ρ_l = A_sl/(b_w·d) <= 0.02', v: `= min(${num(g.Asl, 0)}/(${num(g.bw, 0)}·${num(g.d, 0)}), 0.02)`, r: `= ${num(s.rhoL, 4)}` });
    steps.push({ label: 'Betondruckspannung aus N', f: 'σ_cp = N_Ed/A_c <= 0.2·f_cd', v: `= min(${num(Math.max(0, -c.N), 1)}·10^3/${num(g.Ac, 0)}, 0.2·${num(cc.fcd, 2)}) = min(${num(Math.max(0, -c.N) * 1e3 / g.Ac, 3)}, ${num(0.2 * cc.fcd, 3)})`, r: `= ${num(s.sigcp, 3)} MPa`, note: 'Nur Druck wirkt günstig (Zug: σ_cp = 0).' });
    steps.push({ label: 'Mindestwert', f: 'v_min = 0.035·k^{3/2}·f_ck^{1/2}', v: `= 0.035·${num(s.k, 3)}^{1.5}·${num(cc.fck, 0)}^{0.5}`, r: `= ${num(s.vmin, 3)} MPa` });
    steps.push({ label: 'Widerstand ohne Querkraftbewehrung', f: 'V_Rd,c = [C_Rd,c·k·(100·ρ_l·f_ck)^{1/3} + k_1·σ_cp]·b_w·d >= (v_min + k_1·σ_cp)·b_w·d', v: `C_Rd,c = 0.18/${num(cc.gammaC, 2)}, k_1 = 0.15`, r: `= ${num(s.VRdc, 1)} kN`, ref: 'EN 1992-1-1, 6.2.2 (6.2a/b)' });
    if (s.hasStirrups) {
      steps.push({ label: 'Widerstand der Querkraftbewehrung', f: 'V_Rd,s = (A_sw/s)·z·f_ywd·cot θ', v: `= ${num(s.asw / 1000, 4)}·${num(g.z, 0)}·${num(st.fsd, 1)}·${num(cot, 3)}·10^{-3}`, r: `= ${num(s.VRds, 1)} kN`, ref: 'EN 1992-1-1, 6.2.3 (6.8)', note: `θ = ${num(ang, 1)}°.` });
      steps.push({ label: 'Abminderungsbeiwert', f: 'ν_1 = 0.6·(1 − f_ck/250)', v: `= 0.6·(1 − ${num(cc.fck, 0)}/250)`, r: `= ${num(s.nu1, 3)}`, ref: 'EN 1992-1-1, 6.2.3 (3)' });
      steps.push({ label: 'Widerstand der Druckstrebe', f: 'V_Rd,max = α_cw·b_w·z·ν_1·f_cd/(cot θ + tan θ)', v: `= 1.0·${num(g.bw, 0)}·${num(g.z, 0)}·${num(s.nu1, 3)}·${num(cc.fcd, 2)}/(${num(cot, 3)} + ${num(1 / cot, 3)})·10^{-3}`, r: `= ${num(s.VRdmax, 1)} kN`, ref: 'EN 1992-1-1, 6.2.3 (6.9)' });
      steps.push({ label: 'Querkraftwiderstand', f: 'V_Rd = min(V_Rd,s, V_Rd,max)', r: `= ${num(s.VRd, 1)} kN` });
    }
  }
  steps.push({ label: 'Ausnutzung', f: 'η = V_Ed/V_Rd', v: `= ${num(s.VEd, 1)}/${num(s.VRd, 1)}`, r: `= ${num(s.eta, 3)}` });
  return { id: `v:${c.i}`, title: `${c.name}: Querkraft`, ref: sia ? 'SIA 262, 4.3.3' : 'EN 1992-1-1, 6.2', steps, result: { eta: s.eta, text: okText(s.eta) } };
}

// ------------------------------------------------------------------ GZG: Spannungen

function slsSection(R, p, c) {
  const sls = c.sls, st = c.slsState;
  const { c: cc, s: ss } = R.mat;
  const sia = R.mat.norm === 'SIA';
  const n = R.mat.nSLS, Eceff = ss.Es / n;
  const steps = [];
  const manualN = p.calc?.nMode === 'manual' && p.calc?.n > 0;
  steps.push(manualN
    ? { label: 'Wertigkeit (vorgegeben)', f: 'n = E_s/E_c,eff', r: `= ${num(n, 2)}` }
    : { label: 'Wertigkeit', f: 'n = E_s·(1 + φ)/E_cm', v: `= ${num(ss.Es, 0)}·(1 + ${num(R.mat.phi, 2)})/${num(cc.Ecm, 0)}`, r: `= ${num(n, 2)}` });
  steps.push({ label: 'Wirksamer E-Modul des Betons', f: 'E_c,eff = E_s/n', v: `= ${num(ss.Es, 0)}/${num(n, 2)}`, r: `= ${num(Eceff, 0)} MPa` });
  steps.push({ label: 'Werkstoffgesetze (gerissen, linear-elastisch)', f: 'σ_c = E_c,eff·ε_c (ε_c < 0, kein Zug),   σ_s = E_s·ε_s', note: 'Gleichgewicht ∫σ dA = N, −∫σ·(z − z_S) dA = M_y, ∫σ·(y − y_S) dA = M_z.' });
  steps.push({ label: 'Schnittgrössen (Gebrauch)', f: 'N,   M_y,   M_z', r: `= ${num(c.N, 1)} kN,   ${num(c.My, 1)} kNm,   ${num(c.Mz, 1)} kNm` });
  if (!st.ok || sls.error) {
    steps.push({ label: 'Gleichgewicht im gerissenen Zustand', f: '–', note: sls.error || st.msg });
    return { id: `gzg:${c.i}`, title: `${c.name}: Spannungen (GZG)`, ref: sia ? 'SIA 262, 4.4.2' : 'EN 1992-1-1, 7.2', steps, result: { eta: Infinity, text: 'kein Gleichgewicht' } };
  }
  steps.push(...planeSteps(st, 'Dehnungsebene im gerissenen Zustand'));
  steps.push({ label: 'Grösste Betondruckspannung', f: 'σ_c = E_c,eff·ε_c,min', v: `= ${num(Eceff, 0)}·${par(st.ext.ecMin, 6)}`, r: `= ${num(st.sigmaCmin, 2)} MPa` });
  if (st.bars.length) steps.push({ label: 'Grösste Stahlspannung', f: 'σ_s = E_s·ε_s,max', v: `= ${num(ss.Es, 0)}·${par(st.ext.esMax, 6)}`, r: `= ${num(sls.sigS, 1)} MPa`, note: sls.sigS > 0 ? '' : 'Keine Zugspannung in der Bewehrung.' });
  // Grenzwerte
  if (sia) {
    const req = p.sls?.req || 'normal';
    const reqLabel = SLS_REQUIREMENTS.find((r) => r.value === req)?.label || req;
    if (req === 'erhoeht' || req === 'hoch') {
      const tab = SIA_FIG31[req];
      const sv = sls.spacing;
      let i = tab.findIndex(([x]) => x >= sv);
      if (i <= 0) i = Math.max(1, i < 0 ? tab.length - 1 : 1);
      const [s1, v1] = tab[i - 1], [s2, v2] = tab[i];
      const sx = Math.min(Math.max(sv, tab[0][0]), tab[tab.length - 1][0]);
      steps.push({ label: 'Stababstand der Zuglage', f: 's', r: `= ${num(sv, 0)} mm`, note: sls.spacingAuto ? 'Grösster Achsabstand benachbarter Stäbe der am stärksten gezogenen Lage (σ_s >= 0.75·σ_s,max).' : 'Vorgegeben.' });
      steps.push({
        label: `Zulässige Stahlspannung (${reqLabel})`, f: 'σ_s,adm = σ_1 + (σ_2 − σ_1)·(s − s_1)/(s_2 − s_1) <= f_sd',
        v: `= ${num(v1, 0)} + (${num(v2, 0)} − ${num(v1, 0)})·(${num(sx, 0)} − ${num(s1, 0)})/(${num(s2, 0)} − ${num(s1, 0)})`, r: `= ${num(sls.lim.value, 1)} MPa`,
        ref: 'SIA 262, 4.4.2 / Fig. 31', note: 'Stützwerte als Näherung der Kurven von Fig. 31 (gerundete Ablesewerte) – mit der Norm vergleichen.',
      });
    } else if (req === 'manual') {
      steps.push({ label: 'Zulässige Stahlspannung (vorgegeben)', f: 'σ_s,adm', r: `= ${num(sls.lim.value, 1)} MPa` });
    } else {
      steps.push({ label: 'Zulässige Stahlspannung (normale Anforderungen)', f: 'σ_s,adm = f_sd', r: `= ${num(sls.lim.value, 1)} MPa`, ref: 'SIA 262, 4.4.2', note: 'Bei normalen Anforderungen wird die Rissbreite über die Mindestbewehrung begrenzt; Kontrolle σ_s <= f_sd.' });
    }
  } else {
    steps.push({ label: 'Grenze der Stahlspannung', f: 'σ_s <= k_3·f_yk = 0.8·f_yk', v: `= 0.8·${num(ss.fsk, 0)}`, r: `= ${num(0.8 * ss.fsk, 0)} MPa`, ref: 'EN 1992-1-1, 7.2 (5)' });
    steps.push({ label: 'Grenze der Betondruckspannung', f: '|σ_c| <= k_1·f_ck = 0.6·f_ck', v: `= 0.6·${num(cc.fck, 0)}`, r: `= ${num(0.6 * cc.fck, 1)} MPa`, ref: 'EN 1992-1-1, 7.2 (2)' });
  }
  const parts = sls.checks.map((ch) => `${num(ch.Ed, 1)}/${num(ch.Rd, 1)}`);
  steps.push({ label: 'Ausnutzung', f: sls.checks.length > 1 ? 'η = max(σ_s/σ_s,adm, |σ_c|/(0.6·f_ck))' : 'η = σ_s/σ_s,adm', v: parts.length ? `= ${parts.length > 1 ? `max(${parts.join(', ')})` : parts[0]}` : null, r: `= ${num(sls.eta, 3)}` });
  return { id: `gzg:${c.i}`, title: `${c.name}: Spannungen (GZG)`, ref: sia ? 'SIA 262, 4.4.2' : 'EN 1992-1-1, 7.2', steps, result: { eta: sls.eta, text: okText(sls.eta) } };
}
