// Stütze – Herleitung (Rechenweg): allgemeine Formel, eingesetzte Werte, Ergebnis und Normbezug
//
// Die Herleitung gilt für den gewählten Lastfall und eine Biegeachse: Ziel eines Links «Herleitung ›»
// (ID mit -y/-z), sonst die zuletzt gewählte Achse (Ergebnisbereich oder Klick in die Grafik), sonst die
// massgebende Achse. Abschnitte mit Achsbezug tragen die Achse in der ID (z.B. allg-y).
import { num } from '../../js/core/formula.js';
import { SUPPORT_PRESETS, LAW_LABELS } from './calc.js';
import { lcIndex } from './views.js';

const AXNAME = { y: 'Biegung um y', z: 'Biegung um z' };
const permille = (e) => `${num(e * 1000, 2)} ‰`;
const reasonText = (A) => (A.capped ? 'Laststeigerung bis λ = 20 ohne Versagen (Suche begrenzt)'
  : A.reason === 'section' ? 'Versagen des Querschnitts: Grenzdehnung erreicht'
    : A.reason === 'axial' ? 'Normalkraft übersteigt den Querschnittswiderstand'
      : 'Stabilitätsversagen: kein stabiles Gleichgewicht mehr');

/** Biegeachse, für die die Herleitung gezeigt wird. */
function derivationAxis(app, r) {
  const m = /-(y|z)$/.exec(app.derivTarget || '');
  if (m) { app.stzAxis = m[1]; return m[1]; } // Link auf einen Abschnitt: diese Achse bleibt gewählt
  if (app.stzAxis === 'y' || app.stzAxis === 'z') return app.stzAxis;
  const sel = (app.editor?.sel || []).map((id) => String(id).split(':')[1]).find((a) => a === 'y' || a === 'z');
  return sel || r.governingAxis;
}

export function derivation(app) {
  const R = app.results;
  if (!R?.lcs?.length) return [];
  const li = lcIndex(app);
  const r = R.lcs[li] || R.lcs[0];
  const ax = derivationAxis(app, r);
  const A = r[ax.toUpperCase()];
  const p = R.p, m = R.mat, c = m.c, s = m.s, g = R.geo;
  const ec = p.norm === 'EC';
  const N = r.N;
  const out = [];

  // 1 Baustoffe
  out.push({
    id: 'baustoffe', title: 'Baustoffe', ref: ec ? 'EN 1992-1-1 3.1, 3.2' : 'SIA 262 2.3.2, 3.1.2',
    intro: `Herleitung für ${r.name}, ${AXNAME[ax]}${ax === r.governingAxis ? ' (massgebende Achse)' : ''}. Die andere Achse: Stütze im entsprechenden Bild anklicken oder im Ergebnisbereich die Achse wählen.`,
    steps: [
      ec ? null : { label: 'Beiwert für die Betondruckfestigkeit', f: 'η_fc = (30/f_ck)^{1/3} <= 1', v: `= (30/${num(c.fck, 0)})^{1/3}`, r: `= ${num(c.etaFc, 3)}` },
      ec
        ? { label: 'Bemessungswert der Betondruckfestigkeit', f: 'f_cd = α_cc·f_ck/γ_c', v: `= 1.0·${num(c.fck, 0)}/${num(c.gammaC, 2)}`, r: `= ${num(c.fcd, 2)} MPa`, ref: 'EN 1992-1-1 3.1.6' }
        : { label: 'Bemessungswert der Betondruckfestigkeit', f: 'f_cd = η_fc·f_ck/γ_c', v: `= ${num(c.etaFc, 3)}·${num(c.fck, 0)}/${num(c.gammaC, 2)}`, r: `= ${num(c.fcd, 2)} MPa`, ref: 'SIA 262 2.3.2.3' },
      ec
        ? { label: 'Elastizitätsmodul', f: 'E_cm = 22 000·(f_cm/10)^{0.3}', v: `= 22 000·(${num(c.fcm, 0)}/10)^{0.3}`, r: `= ${num(c.Ecm, 0)} MPa`, ref: 'EN 1992-1-1 Tab. 3.1' }
        : { label: 'Elastizitätsmodul', f: 'E_cm = 10 000·f_cm^{1/3}', v: `= 10 000·${num(c.fcm, 0)}^{1/3}`, r: `= ${num(c.Ecm, 0)} MPa`, ref: 'SIA 262 3.1.2.3' },
      { label: 'E-Modul für die Verformungsberechnung der Stütze', f: 'E_cd = E_cm/γ_cE', v: `= ${num(c.Ecm, 0)}/1.2`, r: `= ${num(m.Ecd, 0)} MPa`, ref: ec ? 'EN 1992-1-1 5.8.6(3)' : 'SIA 262 4.3.7' },
      { label: 'Grenzdehnungen Beton', f: `ε_c2 = ${permille(c.ec2)}, ε_cu = ${permille(c.ecu)}` },
      { label: `Betonstahl ${s.name}`, f: 'f_sd = f_sk/γ_s', v: `= ${num(s.fsk, 0)}/${num(s.gammaS, 2)}`, r: `= ${num(s.fsd, 1)} MPa` },
      { label: 'Fliessdehnung', f: 'ε_sd = f_sd/E_s', v: `= ${num(s.fsd, 1)}/${num(s.Es, 0)}`, r: `= ${permille(m.esd)}`, note: `Bruchdehnung ε_ud = ${permille(s.eud)}` },
    ],
  });

  // 2 Querschnitt
  const aMm = g.a * 1000;
  out.push({
    id: 'querschnitt', title: 'Querschnitt', ref: 'Querschnittswerte',
    steps: [
      g.shape === 'circle'
        ? { label: 'Betonfläche', f: 'A_c = π·D^2/4', v: `= π·${num(g.D, 3)}^2/4`, r: `= ${num(g.Ac, 4)} m²` }
        : { label: 'Betonfläche', f: 'A_c = b·h', v: `= ${num(g.b, 3)}·${num(g.h, 3)}`, r: `= ${num(g.Ac, 4)} m²` },
      { label: 'Längsbewehrung', f: 'A_s = n·π·Ø^2/4', v: `= ${g.n}·π·${p.section.dia}^2/4`, r: `= ${num(g.As * 1e6, 0)} mm²` },
      { label: 'Geometrischer Bewehrungsgehalt', f: 'ρ = A_s/A_c', v: `= ${num(g.As * 1e6, 0)}/${num(g.Ac * 1e6, 0)}`, r: `= ${num(g.As / g.Ac * 100, 2)} %` },
      { label: 'Mechanischer Bewehrungsgehalt', f: 'ω = A_s·f_sd/(A_c·f_cd)', v: `= ${num(g.As * 1e6, 0)}·${num(m.fsd, 1)}/(${num(g.Ac * 1e6, 0)}·${num(m.fcd, 2)})`, r: `= ${num(R.omega, 3)}` },
      p.section.coverMode === 'axis'
        ? { label: 'Achsabstand der Längsstäbe', f: 'a', r: `= ${num(aMm, 0)} mm`, note: 'vorgegeben' }
        : { label: 'Achsabstand der Längsstäbe', f: 'a = c_nom + Ø_w + Ø/2', v: `= ${num(p.section.cover, 0)} + ${num(p.section.stirrup, 0)} + ${num(p.section.dia / 2, 1)}`, r: `= ${num(aMm, 1)} mm` },
      { label: 'Fasermodell', note: `${R.nFibers} Fasern; die Betonfläche an den Stabstellen ist abgezogen.` },
    ],
  });

  // 3 Knicklänge und Schlankheit
  const pr = SUPPORT_PRESETS[A.preset] || {};
  const nom = A.nom;
  const knick = [
    { label: 'Lagerung', note: A.preset === 'custom' ? `Benutzerdefiniert: Fuss ${p[ax === 'z' && p.supportZ !== 'same' ? 'customZ' : 'custom'].bot}, Kopf ${p[ax === 'z' && p.supportZ !== 'same' ? 'customZ' : 'custom'].top}${A.sway ? ', Kopf verschieblich' : ''}` : pr.label },
    { label: 'Nennsteifigkeit (für Knicklast und Grenzschlankheit)', f: 'EI = K_c·E_cd·I_c + K_s·E_s·I_s', ref: 'EN 1992-1-1 5.8.7.2',
      v: `= ${num(nom.Kc, 4)}·${num(m.Ecd, 0)}·${num(A.props.Ic, 6)} + 1.0·${num(m.Es, 0)}·${num(A.props.Is, 7)}`, r: `= ${num(A.EInom / 1000, 2)} MNm²`,
      note: `K_c = k_1·k_2/(1 + φ_ef) mit k_1 = sqrt(f_ck/20) = ${num(nom.k1, 3)}, k_2 = n·λ/170 <= 0.20 → ${num(nom.k2, 3)}` },
  ];
  if (A.userBeta) knick.push({ label: 'Knicklängenbeiwert (vorgegeben)', f: 'β', r: `= ${num(A.beta, 3)}`, note: A.betaModel ? `aus der Lagerung wäre β = ${num(A.betaModel, 3)}` : '' });
  else if (pr.beta) knick.push({ label: 'Knicklängenbeiwert (Euler-Fall)', f: 'β', r: `= ${num(A.beta, 3)}` });
  else knick.push({ label: 'Knicklängenbeiwert aus dem Stabmodell mit Drehfedern', f: 'β = π/L·sqrt(EI/N_cr)', v: `= π/${num(p.L, 2)}·sqrt(${num(A.EInom, 0)}/${num(A.NBmodel, 0)})`, r: `= ${num(A.beta, 3)}`, note: 'N_cr: kleinste Verzweigungslast des Stabmodells (40 Elemente) mit der Nennsteifigkeit EI.' });
  knick.push(
    { label: 'Knicklänge', f: 'l_0 = β·L', v: `= ${num(A.beta, 3)}·${num(p.L, 2)}`, r: `= ${num(A.l0, 3)} m` },
    { label: 'Trägheitsradius', f: 'i = sqrt(I_c/A_c)', v: `= sqrt(${num(A.props.Ic, 6)}/${num(g.Ac, 4)})`, r: `= ${num(A.i * 1000, 1)} mm` },
    { label: 'Schlankheit', f: 'λ = l_0/i', v: `= ${num(A.l0, 3)}/${num(A.i, 4)}`, r: `= ${num(A.lam, 1)}` },
    { label: 'Knicklast', f: 'N_B = π^2·EI/l_0^2', v: `= π^2·${num(A.EInom, 0)}/${num(A.l0, 3)}^2`, r: `= ${num(A.NB, 0)} kN` },
  );
  if (ec) {
    const L = A.limEC, nRel = Math.max(0, N) / (g.Ac * m.fcd * 1000);
    knick.push(
      { label: 'Bezogene Normalkraft', f: 'n = N_Ed/(A_c·f_cd)', v: `= ${num(N, 0)}/(${num(g.Ac * 1e6, 0)}·${num(m.fcd, 2)}·10^{-3})`, r: `= ${num(nRel, 3)}` },
      { label: 'Beiwerte', f: 'A = 1/(1 + 0.2·φ_ef), B = sqrt(1 + 2·ω), C = 1.7 − r_m', v: `A = ${num(L.A, 3)}, B = ${num(L.B, 3)}, C = ${num(L.C, 3)}`, note: A.rm === null ? 'C = 0.7: Querlast, verschieblicher Kopf oder ohne Endmomente' : `r_m = M_01/M_02 = ${num(A.rm, 3)}` },
      { label: 'Grenzschlankheit', f: 'λ_lim = 20·A·B·C/sqrt(n)', v: `= 20·${num(L.A, 3)}·${num(L.B, 3)}·${num(L.C, 3)}/sqrt(${num(nRel, 3)})`, r: `= ${Number.isFinite(A.lamLim) ? num(A.lamLim, 1) : '∞'}`, ref: 'EN 1992-1-1 5.8.3.1' },
    );
  } else {
    knick.push({ label: 'Grenzschlankheit (Momente 2. Ordnung ≤ 10 %)', f: 'λ_lim = λ·sqrt(N_B/(11·N_Ed))', v: N > 0 ? `= ${num(A.lam, 1)}·sqrt(${num(A.NB, 0)}/(11·${num(N, 0)}))` : '', r: `= ${Number.isFinite(A.lamLim) ? num(A.lamLim, 1) : '∞'}`, note: 'Vergrösserungsfaktor 1/(1 − N_Ed/N_B) ≤ 1.1 ⇔ N_Ed ≤ N_B/11' });
  }
  out.push({
    id: `knick-${ax}`, title: `Knicklänge und Schlankheit (${AXNAME[ax]})`, ref: ec ? 'EN 1992-1-1 5.8.3' : 'SIA 262 4.3.7', steps: knick,
    result: { text: A.lam <= A.lamLim ? `λ = ${num(A.lam, 1)} <= λ_lim = ${num(A.lamLim, 1)}: Einflüsse 2. Ordnung vernachlässigbar (trotzdem berechnet)` : `λ = ${num(A.lam, 1)} > λ_lim = ${Number.isFinite(A.lamLim) ? num(A.lamLim, 1) : '∞'}: Theorie 2. Ordnung erforderlich` },
  });

  // 4 Imperfektion
  const imp = p.imperfection || {};
  const th = R.thetaI;
  const impSteps = [];
  if (imp.mode === 'user') impSteps.push({ label: 'Schiefstellung (vorgegeben)', f: 'θ_i', r: `= 1/${num(imp.denom, 0)}` });
  else if (imp.mode === 'none') impSteps.push({ label: 'Keine Imperfektion', note: 'Nur für Vergleichsrechnungen – der Nachweis setzt eine Imperfektion voraus.' });
  else if (ec) {
    const ahRaw = 2 / Math.sqrt(p.L), ah = Math.min(1, Math.max(2 / 3, ahRaw));
    impSteps.push(
      { label: 'Abminderung mit der Länge', f: 'α_h = 2/sqrt(L), 2/3 <= α_h <= 1', v: `= 2/sqrt(${num(p.L, 2)}) = ${num(ahRaw, 3)}`, r: `→ α_h = ${num(ah, 3)}` },
      { label: 'Schiefstellung', f: 'θ_i = θ_0·α_h·α_m', v: `= 1/200·${num(ah, 3)}·1.0`, r: `= 1/${num(1 / th, 0)}`, ref: 'EN 1992-1-1 5.2(5)' },
    );
  } else {
    const raw = 0.01 / Math.sqrt(p.L);
    impSteps.push({ label: 'Schiefstellung', f: 'α_i = 0.01/sqrt(L), 1/300 <= α_i <= 1/100', v: `= 0.01/sqrt(${num(p.L, 2)}) = 1/${num(1 / raw, 0)}`, r: `→ θ_i = 1/${num(1 / th, 0)}`, ref: 'SIA 262 4.3.7.2' });
  }
  if (th > 0) {
    impSteps.push(A.sway
      ? { label: `Kopfauslenkung (${AXNAME[ax]}, verschieblich)`, f: 'Δ_i = θ_i·L', v: `= 1/${num(1 / th, 0)}·${num(p.L, 2)}`, r: `= ${num(A.impAmp * 1000, 1)} mm`, note: 'Schiefstellung der ganzen Stütze.' }
      : { label: `Vorkrümmung (${AXNAME[ax]}, unverschieblich)`, f: 'e_i = θ_i·l_0/2', v: `= 1/${num(1 / th, 0)}·${num(A.l0, 3)}/2`, r: `= ${num(A.ei * 1000, 1)} mm`, note: 'Vorverformung in Form der Knickfigur, Richtung gleichsinnig mit der Verformung aus den Lasten (ungünstig).' });
  }
  out.push({ id: 'imp', title: 'Imperfektion', ref: ec ? 'EN 1992-1-1 5.2' : 'SIA 262 4.3.7.2', steps: impSteps });

  // 5 Kriechen
  out.push({
    id: 'kriechen', title: 'Kriechen', ref: ec ? 'EN 1992-1-1 5.8.4' : 'SIA 262 4.3.7.3',
    steps: [
      { label: 'Wirksame Kriechzahl', f: 'φ_ef = φ(∞,t_0)·M_0Eqp/M_0Ed', v: `= ${num(p.creep.phi, 2)}·${num(p.creep.ratio, 2)}`, r: `= ${num(R.phiEf, 3)}` },
      { label: 'Berücksichtigung im Betongesetz', f: 'σ_c(ε) = σ_c,0(ε/(1 + φ_ef))', v: `1 + φ_ef = ${num(1 + R.phiEf, 3)}`, note: 'Alle Dehnungen der Spannungs-Dehnungs-Linie werden gestreckt: gleiche Spannung erst bei grösserer Dehnung.' },
    ],
  });

  // 6 Schnittgrössen 1. Ordnung
  const ld = A.loads;
  const loadTxt = [`N_Ed = ${num(N, 0)} kN`, ld.Mt ? `M_oben = ${num(ld.Mt, 1)} kNm` : null, ld.Mb ? `M_unten = ${num(ld.Mb, 1)} kNm` : null, ld.H ? `H = ${num(ld.H, 1)} kN` : null, ld.q ? `q = ${num(ld.q, 2)} kN/m` : null].filter(Boolean).join(', ');
  out.push({
    id: `m1-${ax}`, title: `Schnittgrössen 1. Ordnung (${AXNAME[ax]})`, ref: 'Theorie 1. Ordnung',
    steps: [
      { label: 'Bemessungswerte der Einwirkungen', f: loadTxt, note: 'N als Druck positiv, Momente positiv bei Druckseite rechts.' },
      { label: 'Grösstes Moment ohne Imperfektion', f: 'M_0Ed = max|M_0(x)|', r: `= ${num(A.M1nMax, 1)} kNm`, note: 'Linear-elastisch am Stabmodell mit der gewählten Lagerung.' },
      th > 0 ? (A.sway
        ? { label: 'Anteil der Schiefstellung', f: 'H_i = θ_i·N_Ed', v: `= 1/${num(1 / th, 0)}·${num(N, 0)}`, r: `= ${num(th * N, 2)} kN`, note: 'Ersatzlast am Kopf (wirkt mit den übrigen Lasten).' }
        : { label: 'Anteil der Vorkrümmung', f: 'ΔM_i ≈ N_Ed·e_i', v: `= ${num(N, 0)}·${num(A.ei, 4)}`, r: `= ${num(N * A.ei, 1)} kNm` }) : null,
      { label: 'Moment 1. Ordnung inkl. Imperfektion', f: 'M_Ed,I = max|M_0(x) + M_i(x)|', r: `= ${num(A.M1max, 1)} kNm` },
    ],
  });

  // 7 Allgemeines Verfahren
  const st = A.at1;
  const ss = A.scanStats || {};
  const allg = [
    { label: 'Betongesetz für die Verformungen', note: `${LAW_LABELS[R.kind]}; Kriechen über 1 + φ_ef = ${num(1 + R.phiEf, 3)}. Betonstahl bilinear mit f_sd.` },
    { label: 'Stabmodell', f: `n_El = ${p.nEl} Balkenelemente, L = ${num(p.L, 2)} m`, note: 'Krümmungen aus der Momenten-Krümmungs-Beziehung M(κ, N) des Fasermodells je Gausspunkt; für jede Laststufe bei N = λ·N_Ed neu ermittelt.' },
    { label: 'Gleichgewicht am verformten System', f: 'f_int(u) − λ·N_Ed·K_G·u = λ·F + λ·N_Ed·K_G·w_0', note: 'K_G: geometrische Steifigkeit, w_0: Vorverformung, Lösung mit dem Newton-Raphson-Verfahren.' },
    { label: 'Proportionale Laststeigerung', f: 'λ = 0.1, 0.2, … bis zum Versagen, danach Bisektion', note: `${ss.steps ?? '–'} Gleichgewichtszustände, ${ss.solves ?? '–'} Lösungen mit insgesamt ${ss.iters ?? '–'} Newton-Iterationen.` },
  ];
  if (st) {
    const EIsec = Math.abs(st.kapCrit) > 1e-12 ? st.Mmax / Math.abs(st.kapCrit) : null;
    allg.push(
      { label: 'Moment 2. Ordnung bei Bemessungslast (λ = 1)', f: 'M_Ed,II = max|M(x)|', r: `= ${num(st.Mmax, 1)} kNm`, note: `bei x = ${num(A.x[st.iM], 2)} m; Vergrösserung M_Ed,II/M_Ed,I = ${A.amplification ? num(A.amplification, 3) : '–'}` },
      EIsec ? { label: 'Sekantensteifigkeit im massgebenden Schnitt', f: 'EI_sec = M/κ', v: `= ${num(st.Mmax, 1)}/${num(Math.abs(st.kapCrit) * 1000, 3)}·10^{-3}`, r: `= ${num(EIsec / 1000, 2)} MNm²`, note: `zum Vergleich EI_nom = ${num(A.EInom / 1000, 2)} MNm²` } : null,
    );
  } else {
    allg.push({ label: 'Bemessungslast', note: 'Bei λ = 1 besteht kein Gleichgewicht – die Stütze versagt unter der Bemessungslast.' });
  }
  allg.push({ label: 'Traglastfaktor', f: 'λ_u', r: `= ${num(A.lambdaU, 3)}`, note: reasonText(A) });
  out.push({
    id: `allg-${ax}`, title: `Allgemeines Verfahren (${AXNAME[ax]})`, ref: ec ? 'EN 1992-1-1 5.8.6' : 'SIA 262 4.3.7', steps: allg,
    result: { eta: A.etaU, text: `η = 1/λ_u = 1/${num(A.lambdaU, 3)} = ${num(A.etaU, 3)}` },
  });

  // 8 Querschnittswiderstand
  const Mn = ax === 'y' ? 'M_y' : 'M_z';
  out.push({
    id: `qs-${ax}`, title: `Querschnittswiderstand (${AXNAME[ax]})`, ref: ec ? 'EN 1992-1-1 6.1' : 'SIA 262 4.3.2',
    intro: 'M_Rd bei der vorhandenen Normalkraft aus dem Fasermodell: Parabel-Rechteck-Diagramm mit f_cd und bilinearer Betonstahl mit f_sd; Bruch, sobald ε_cu im Beton oder ε_ud im Stahl erreicht ist.',
    steps: [
      { label: 'Biegewiderstand bei der vorhandenen Normalkraft', f: `${Mn},Rd(N_Ed = ${num(N, 0)} kN)`, r: `= ${num(A.MRd, 1)} kNm` },
      A.M2max !== null
        ? { label: 'Nachweis', f: `${Mn},Ed,II <= ${Mn},Rd`, v: `${num(A.M2max, 1)} <= ${num(A.MRd, 1)}`, r: `η = ${num(A.etaSec, 3)}` }
        : { label: 'Nachweis', note: 'Kein Gleichgewicht bei λ = 1 – Ausnutzung als 1/λ_u angegeben.' },
    ],
    result: { eta: A.etaSec, text: `η = ${num(A.etaSec, 3)}` },
  });

  // 9 Normalkraft
  const nSteps = N >= 0 ? (() => {
    const ss2 = Math.min(m.fsd, m.Es * c.ec2);
    return [
      { label: 'Druckwiderstand bei zentrischer Stauchung', f: 'N_Rd = (A_c − A_s)·f_cd + A_s·σ_s(ε_c2)', v: `= (${num(g.Ac * 1e6, 0)} − ${num(g.As * 1e6, 0)})·${num(m.fcd, 2)} + ${num(g.As * 1e6, 0)}·${num(ss2, 1)}`, r: `= ${num(R.NRd, 0)} kN`, note: `σ_s = min(f_sd; E_s·ε_c2) = ${num(ss2, 1)} MPa` },
      { label: 'Nachweis', f: 'N_Ed <= N_Rd', v: `${num(N, 0)} <= ${num(R.NRd, 0)}`, r: `η = ${num(r.etaN, 3)}` },
    ];
  })() : [
    { label: 'Zugwiderstand', f: 'N_Rd,t = A_s·f_sd', v: `= ${num(g.As * 1e6, 0)}·${num(m.fsd, 1)}·10^{-3}`, r: `= ${num(g.As * m.fsd * 1000, 0)} kN` },
    { label: 'Nachweis', f: 'N_Ed,t <= N_Rd,t', v: `${num(-N, 0)} <= ${num(g.As * m.fsd * 1000, 0)}`, r: `η = ${num(r.etaN, 3)}` },
  ];
  out.push({ id: 'normalkraft', title: 'Normalkraft', ref: ec ? 'EN 1992-1-1 6.1' : 'SIA 262 4.3.2', steps: nSteps, result: { eta: r.etaN, text: `η = ${num(r.etaN, 3)}` } });

  // 10 Zweiachsige Biegung
  const gov = r.gov;
  const biaxSteps = r.combos.map((cb) => (cb.missing
    ? { label: cb.label, note: 'Kein Gleichgewicht unter Bemessungslast.' }
    : { label: cb.label, f: 'η = max_x |M_Ed|/|M_Rd| in Richtung (M_y, M_z)', v: `M_y = ${num(cb.My, 1)} kNm, M_z = ${num(cb.Mz, 1)} kNm bei x = ${num(cb.x, 2)} m`, r: `η = ${num(cb.eta, 3)}` }));
  biaxSteps.push({
    label: 'Vergleich mit der Näherung', f: '(M_Edz/M_Rdz)^a + (M_Edy/M_Rdy)^a <= 1', ref: 'EN 1992-1-1 (5.39)',
    v: `a = ${num(r.a, 2)} (${g.shape === 'circle' ? 'Kreis' : `N_Ed/N_Rd = ${num(N / R.NRdSimple, 3)}`})`, r: `= ${num(r.eta539, 3)}`,
    note: 'Nur zum Vergleich – massgebend ist die Interaktionskurve des Fasermodells.',
  });
  out.push({
    id: 'zweiachsig', title: g.shape === 'circle' ? 'Resultierendes Moment' : 'Zweiachsige Biegung (Interaktion)', ref: ec ? 'EN 1992-1-1 5.8.9' : 'SIA 262 4.3.7',
    intro: `Beide Richtungen werden nichtlinear berechnet; die Imperfektion wirkt jeweils nur in einer Richtung. Massgebend ist die Stelle mit der grössten Ausnutzung bezüglich ${g.shape === 'circle' ? 'des Widerstands M_Rd (rotationssymmetrisch)' : 'der M_y–M_z-Interaktionskurve bei N_Ed (radial gemessen)'}.${p.biaxial ? '' : ' Ohne Lasten um z wirkt in z nur die Imperfektion.'}`,
    steps: biaxSteps,
    result: { eta: gov.eta, text: `η = ${num(gov.eta, 3)} (${gov.label})` },
  });

  // 11 Vereinfachtes Verfahren
  const sm = A.simp;
  const simp = [
    { label: 'Statische Höhe', f: 'd = h/2 + i_s', v: `= ${num(A.props.h * 1000, 0)}/2 + ${num(A.props.is * 1000, 1)}`, r: `= ${num(sm.d * 1000, 1)} mm`, note: 'i_s: Trägheitsradius der Bewehrung' },
  ];
  if (ec) {
    simp.push(
      { label: 'Bezogene Normalkraft', f: 'n = N_Ed/(A_c·f_cd), n_u = 1 + ω', v: `n = ${num(sm.nRel, 3)}, n_u = ${num(sm.nu, 3)}` },
      { label: 'Beiwert für die Normalkraft', f: 'K_r = (n_u − n)/(n_u − n_bal) <= 1', v: `= (${num(sm.nu, 3)} − ${num(sm.nRel, 3)})/(${num(sm.nu, 3)} − 0.4)`, r: `= ${num(sm.Kr, 3)}` },
      { label: 'Beiwert für das Kriechen', f: 'K_φ = 1 + β·φ_ef >= 1, β = 0.35 + f_ck/200 − λ/150', v: `β = ${num(sm.betaPhi, 3)}`, r: `K_φ = ${num(sm.Kphi, 3)}` },
      { label: 'Krümmung', f: '1/r = K_r·K_φ·ε_yd/(0.45·d)', v: `= ${num(sm.Kr, 3)}·${num(sm.Kphi, 3)}·${num(sm.eyd, 5)}/(0.45·${num(sm.d, 4)})`, r: `= ${num(sm.curv * 1000, 2)} 1/km` },
      { label: 'Zusatzausmitte', f: 'e_2 = (1/r)·l_0^2/c', v: `= ${num(sm.curv, 5)}·${num(A.l0, 3)}^2/10`, r: `= ${num(sm.e2 * 1000, 1)} mm` },
    );
  } else {
    simp.push(
      { label: 'Bemessungskrümmung', f: 'χ_d = 2·ε_sd/(0.9·d)', v: `= 2·${num(sm.eyd, 5)}/(0.9·${num(sm.d, 4)})`, r: `= ${num(sm.curv * 1000, 2)} 1/km` },
      { label: 'Zusatzausmitte (Modellstütze)', f: 'e_2 = χ_d·l_0^2/π^2', v: `= ${num(sm.curv, 5)}·${num(A.l0, 3)}^2/π^2`, r: `= ${num(sm.e2 * 1000, 1)} mm` },
    );
  }
  if (sm.M02 !== undefined) {
    simp.push(
      { label: 'Endmomente inkl. Imperfektion', f: 'M_02 = |M_gross| + N_Ed·e_i, M_01 = ±|M_klein| + N_Ed·e_i', v: `M_02 = ${num(sm.M02, 1)} kNm, M_01 = ${num(sm.M01, 1)} kNm` },
      { label: 'Äquivalentes Moment 1. Ordnung', f: 'M_0e = 0.6·M_02 + 0.4·M_01 >= 0.4·M_02', v: `= 0.6·${num(sm.M02, 1)} + 0.4·${num(sm.M01, 1)}`, r: `= ${num(sm.M0e, 1)} kNm`, ref: 'EN 1992-1-1 5.8.8.2(2)' },
    );
  } else {
    simp.push({ label: 'Moment 1. Ordnung inkl. Imperfektion', f: 'M_0Ed = M_0,max + N_Ed·e_i', v: `= ${num(A.M1nMax, 1)} + ${num(N, 0)}·${num(A.ei, 4)}`, r: `= ${num(sm.M0Ed, 1)} kNm` });
  }
  simp.push({ label: 'Moment 2. Ordnung', f: 'M_2 = N_Ed·e_2', v: `= ${num(N, 0)}·${num(sm.e2, 4)}`, r: `= ${num(sm.M2, 1)} kNm` });
  simp.push(sm.M02 !== undefined
    ? { label: 'Bemessungsmoment', f: 'M_Ed = max(M_02; M_0e + M_2; M_01 + 0.5·M_2)', r: `= ${num(sm.MEd, 1)} kNm`, ref: 'EN 1992-1-1 5.8.8.2(3)' }
    : { label: 'Bemessungsmoment', f: 'M_Ed = M_0Ed + M_2', v: `= ${num(sm.M0Ed, 1)} + ${num(sm.M2, 1)}`, r: `= ${num(sm.MEd, 1)} kNm` });
  if (ec) simp.push({ label: 'Mindestausmitte', f: 'M_Ed >= N_Ed·e_0, e_0 = max(h/30; 20 mm)', v: `e_0 = ${num(sm.e0min * 1000, 1)} mm`, r: `→ M_Ed = ${num(sm.MEd, 1)} kNm`, ref: 'EN 1992-1-1 6.1(4)' });
  simp.push({ label: 'Nachweis', f: 'M_Ed <= M_Rd', v: `${num(sm.MEd, 1)} <= ${num(sm.MRd, 1)}`, r: `η = ${num(sm.eta, 3)}` });
  out.push({
    id: `vereinf-${ax}`, title: `${ec ? 'Nennkrümmungsverfahren' : 'Vereinfachtes Verfahren (Modellstütze)'} – ${AXNAME[ax]}`, ref: ec ? 'EN 1992-1-1 5.8.8' : 'SIA 262 4.3.7',
    intro: 'Zum Vergleich mit dem allgemeinen Verfahren (das allgemeine Verfahren ist massgebend).',
    steps: simp,
    result: { eta: sm.eta, text: `η = ${num(sm.eta, 3)}` },
  });
  return out;
}
