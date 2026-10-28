// Herleitung (Rechenweg) aller Stahlbau-Nachweise: allgemeine Formel, eingesetzte Werte, Ergebnis, Normbezug.
// Formeln nach EN 1993-1-1 (Gleichungsnummern in Klammern); SIA 263 rechnet mit denselben Beziehungen.
// Die Abschnitts-IDs entsprechen den Nachweis-IDs aus calc.js (Nby/Nbz → Nb, int61/int62 → int, w-… → w).
import { num } from '../../js/core/formula.js';
import { ref, E_STEEL, G_STEEL } from './calc.js';

const f0 = (x) => num(x, 0), f1 = (x) => num(x, 1), f2 = (x) => num(x, 2), f3 = (x) => num(x, 3);
const kN = (v) => v / 1e3, kNm = (v) => v / 1e6;
const ok = (eta) => Number.isFinite(eta) && eta <= 1.0001;
const cmp = (eta) => (ok(eta) ? '<= 1.0' : '> 1.0');
const result = (eta, what = '') => ({ eta, text: `η = ${f3(eta)} ${cmp(eta)} – ${what ? `${what} ` : ''}${ok(eta) ? 'erfüllt' : 'nicht erfüllt'}` });
const proof = (fSym, Ed, Rd, eta, r0) => ({ label: 'Nachweis', ref: r0, f: `η = ${fSym}`, v: `= ${Ed}/${Rd}`, r: `= ${f3(eta)} ${cmp(eta)}` });
const where = (c) => `${c.comboName || ''}${Number.isFinite(c.x) ? `, x = ${f2(c.x)} m` : ''}`;

/** Text zum Momentenbeiwert Cm (Tab. B.3). */
function cmNote(cm, name) {
  if (!cm) return '';
  if (cm.kind === 'sway') return `${name}: seitenverschieblich → C_m = 0.9`;
  if (cm.kind === 'linear') return `${name}: linearer Verlauf, C_m = 0.6 + 0.4·ψ >= 0.4 mit ψ = ${f2(cm.psi)}`;
  if (cm.kind === 'Mh') return `${name}: Querlast, |M_h| >= |M_s|: α_s = M_s/M_h = ${f2(cm.alphaS)}, ψ = ${f2(cm.psi)}`;
  if (cm.kind === 'Ms') return `${name}: Querlast, |M_s| > |M_h|: α_h = M_h/M_s = ${f2(cm.alphaH)}, ψ = ${f2(cm.psi)}, C_m = 0.95 + 0.05·α_h (Gleichlast) bzw. 0.90 + 0.10·α_h (Einzellast)`;
  return `${name}: kein Moment → C_m = 1`;
}

/** Einfache Kontrolle: Einfeldträger mit Gleichlast über die ganze Länge (alle Lasten). */
function uniformSS(member) {
  if (member.mode !== 'beam' || member.system !== 'ss') return null;
  const L = member.L;
  if (!member.loads.length) return null;
  if (!member.loads.every((l) => l.type === 'q' && l.dir === 'z' && Math.abs(l.x1) < 1e-9 && Math.abs(l.x2 - L) < 1e-9 && Math.abs(l.v1 - l.v2) < 1e-9)) return null;
  return (factors) => member.loads.reduce((t, l) => t + (factors[l.lc] || 0) * l.v1, 0);
}

export function derivation(app) {
  const r = app.results;
  if (!r) return [];
  const p = app.project;
  const s = r.sec, mat = r.mat, norm = r.norm, m = r.member;
  const fy = mat.fy, g0 = mat.gammaM0, g1 = mat.gammaM1;
  const eps = Math.sqrt(235 / fy);
  const etaV = norm === 'EC' ? 1.2 : 1.0;
  const u = r.govUls;
  const ck = (id) => r.checks.find((c) => c.id === id);
  const out = [];
  const isI = s.type === 'I' || s.type === 'WI';

  // ---------------------------------------------------------------- Werkstoff
  out.push({
    id: 'grundlagen', title: 'Werkstoff und Beiwerte', ref: norm === 'SIA' ? 'SIA 263 Tab. 1 · EN 1993-1-1 3.2, 6.1' : 'EN 1993-1-1 3.2, 6.1',
    intro: `Stahl ${mat.name}; massgebende Erzeugnisdicke t = ${f1(s.tmax)} mm.`,
    steps: [
      { label: 'Streckgrenze', f: 'f_y', r: `= ${fy} N/mm²`, note: s.tmax > 40 ? 'abgemindert für Erzeugnisdicken über 40 mm' : '' },
      { label: 'Zugfestigkeit', f: 'f_u', r: `= ${mat.fu} N/mm²` },
      { label: 'Elastizitäts- und Schubmodul', f: `E = ${f0(E_STEEL)} N/mm², G = ${f0(G_STEEL)} N/mm²` },
      { label: 'Beiwert ε', ref: 'Tab. 5.2', f: 'ε = sqrt(235/f_y)', v: `= sqrt(235/${fy})`, r: `= ${f3(eps)}` },
      { label: 'Widerstandsbeiwerte', ref: '6.1', f: 'γ_M0, γ_M1', r: `= ${f2(g0)}, ${f2(g1)}`, note: p.gamma?.auto === false ? 'vom Benutzer vorgegeben' : norm === 'SIA' ? 'SIA 263: γ_M = 1.05' : 'empfohlene Werte EN 1993-1-1' },
    ],
  });

  // ---------------------------------------------------------------- Querschnittswerte
  {
    const steps = [];
    const rr = s.r || 0;
    if (isI) {
      steps.push({ label: 'Abmessungen', f: `h = ${f1(s.h)}, b = ${f1(s.b)}, t_w = ${f1(s.tw)}, t_f = ${f1(s.tf)}${rr ? `, r = ${f1(rr)}` : ''} mm` });
      steps.push({ label: 'Fläche', f: rr ? 'A = 2·b·t_f + (h − 2·t_f)·t_w + (4 − π)·r^2' : 'A = 2·b·t_f + (h − 2·t_f)·t_w', v: `= 2·${f1(s.b)}·${f1(s.tf)} + (${f1(s.h)} − 2·${f1(s.tf)})·${f1(s.tw)}${rr ? ` + (4 − π)·${f1(rr)}^2` : ''}`, r: `= ${f0(s.A)} mm²` });
      steps.push({
        label: 'Plastisches Widerstandsmoment', f: rr ? 'W_pl,y = b·t_f·(h − t_f) + t_w·(h − 2·t_f)^2/4 + (4 − π)·r^2·(h/2 − t_f − 0.2234·r)' : 'W_pl,y = b·t_f·(h − t_f) + t_w·(h − 2·t_f)^2/4',
        v: `= ${f1(s.b)}·${f1(s.tf)}·${f1(s.h - s.tf)} + ${f1(s.tw)}·${f1(s.h - 2 * s.tf)}^2/4${rr ? ` + (4 − π)·${f1(rr)}^2·${f2(s.h / 2 - s.tf - 0.2234 * rr)}` : ''}`, r: `= ${f1(s.Wply / 1e3)}·10^3 mm³`,
      });
      steps.push({ label: 'Trägheitsmomente', f: 'I_y, I_z', r: `= ${f0(s.Iy / 1e4)} cm⁴, ${f1(s.Iz / 1e4)} cm⁴`, note: rr ? 'aus den Nennmassen einschliesslich Ausrundungen' : 'aus den Blechabmessungen' });
      steps.push({ label: 'Elastische Widerstandsmomente', f: 'W_el,y = I_y/(h/2), W_el,z = I_z/(b/2)', r: `= ${f1(s.Wely / 1e3)} cm³, ${f1(s.Welz / 1e3)} cm³` });
      steps.push({ label: 'Wölbwiderstand', f: 'I_w = I_z·(h − t_f)^2/4', v: `= ${f1(s.Iz / 1e4)}·${f2((s.h - s.tf) / 10)}^2/4`, r: `= ${f0(s.Iw / 1e6)} cm⁶` });
    } else {
      steps.push({ label: 'Querschnittswerte', f: `A = ${f0(s.A)} mm², W_el,y = ${f1(s.Wely / 1e3)} cm³, W_pl,y = ${f1(s.Wply / 1e3)} cm³`, note: s.type === 'custom' ? 'vom Benutzer eingegeben' : 'aus den Nennmassen berechnet' });
      steps.push({ label: 'Trägheitsmomente', f: `I_y = ${f0(s.Iy / 1e4)} cm⁴, I_z = ${f1(s.Iz / 1e4)} cm⁴` });
      if (s.Iw > 0) steps.push({ label: 'Wölbwiderstand', f: `I_w = ${f0(s.Iw / 1e6)} cm⁶`, note: s.type === 'U' ? 'Näherung der Dünnwandtheorie' : '' });
    }
    steps.push({ label: 'Torsionsträgheitsmoment', f: 'I_t', r: `= ${f2(s.It / 1e4)} cm⁴` });
    steps.push({ label: 'Trägheitsradien', f: 'i_y = sqrt(I_y/A), i_z = sqrt(I_z/A)', v: `= sqrt(${f0(s.Iy)}/${f0(s.A)}), sqrt(${f0(s.Iz)}/${f0(s.A)})`, r: `= ${f1(s.iy)} mm, ${f1(s.iz)} mm` });
    out.push({ id: 'querschnitt', title: `Querschnittswerte ${s.name}`, ref: s.type === 'I' || s.type === 'U' ? 'EN 10365' : s.type === 'RHS' || s.type === 'CHS' ? 'EN 10210-2' : '', steps });
  }

  // ---------------------------------------------------------------- Einwirkungen
  {
    const steps = [];
    if (m.mode === 'beam') {
      const lcName = (id) => m.lcs.find((l) => l.id === id)?.name || id;
      const c = u.combo;
      steps.push({ label: 'Grundkombination', ref: norm === 'SIA' ? 'SIA 260 Gl. (10)' : 'EN 1990 (6.10)', f: 'E_d = Σ γ_G·G_k + γ_Q·Q_k,1 + Σ γ_Q·ψ_0,i·Q_k,i', note: `γ_G = ${f2(m.factors.gG)}, γ_G,inf = ${f2(m.factors.gGinf)}, γ_Q = ${f2(m.factors.gQ)}` });
      steps.push({ label: `Massgebende Kombination ${c.id}`, f: `E_d = ${Object.entries(c.factors).filter(([, v]) => v).map(([id, v]) => `${f2(v)}·«${lcName(id)}»`).join(' + ')}` });
      const qOf = uniformSS(m);
      if (qOf) {
        const qd = qOf(c.factors), L = m.L;
        steps.push({ label: 'Bemessungslast', f: 'q_d = Σ γ·q_k', r: `= ${f2(qd)} kN/m` });
        steps.push({ label: 'Feldmoment (Kontrolle Einfeldträger)', f: 'M_y,Ed = q_d·L^2/8', v: `= ${f2(qd)}·${f2(L)}^2/8`, r: `= ${f1(qd * L * L / 8)} kNm` });
        steps.push({ label: 'Auflagerquerkraft', f: 'V_z,Ed = q_d·L/2', v: `= ${f2(qd)}·${f2(L)}/2`, r: `= ${f1(qd * L / 2)} kN` });
      }
      steps.push({ label: 'Bemessungswerte (Stabstatik)', f: `M_y,Ed = ${f1(u.MyMax)} kNm (x = ${f2(u.xMy)} m), V_z,Ed = ${f1(Math.max(...u.smp.Vz.map(Math.abs)))} kN, N_Ed = ${f1(u.Nc)} kN${u.MzMax > 1e-9 ? `, M_z,Ed = ${f1(u.MzMax)} kNm` : ''}`, note: 'Theorie 1. Ordnung, Euler-Bernoulli-Balken; Druck positiv.' });
    } else {
      for (const c of m.combos) {
        const cs = (p.forces.cases || [])[m.combos.indexOf(c)] || {};
        steps.push({ label: c.name, f: `N_Ed = ${f1(c.N)} kN, M_y,Ed = ${f1(cs.My || 0)} kNm, M_z,Ed = ${f1(cs.Mz || 0)} kNm, V_z,Ed = ${f1(cs.Vz || 0)} kN`, note: `Verlauf M_y: ${cs.shapeY === 'lin' ? `linear, ψ = ${f2(cs.psiY ?? 1)}` : cs.shapeY}; Bemessungswerte direkt eingegeben` });
      }
    }
    out.push({ id: 'einwirkung', title: 'Einwirkungen und Schnittgrössen', ref: m.mode === 'beam' ? (norm === 'SIA' ? 'SIA 260' : 'EN 1990') : 'direkte Eingabe', steps });
  }

  // ---------------------------------------------------------------- Klassifizierung
  {
    const kl = u.klass;
    const steps = [{ label: 'Beanspruchung für die Klassifizierung', f: `N_Ed = ${f1(Math.max(0, u.Nc))} kN, M_y,Ed = ${f1(u.MyMax)} kNm, M_z,Ed = ${f1(u.MzMax)} kNm`, note: u.combo.name }];
    const seen = new Set();
    for (const pp of kl.parts) {
      const key = `${pp.label}|${pp.cls}|${pp.ct.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pl = s.plates?.find((q) => q.id === pp.id);
      const ct = pl ? `c/t = ${f1(pl.c)}/${f1(pl.t)} = ${f2(pp.ct)}` : `c/t = ${f2(pp.ct)}`;
      if (pp.tension) { steps.push({ label: pp.label, f: ct, r: '→ unter Zug: Klasse 1' }); continue; }
      if (pp.kind === 'tube') {
        steps.push({ label: pp.label, ref: 'Tab. 5.2 (Blatt 3)', f: `d/t = ${f2(pp.ct)}`, v: `Grenzen 50·ε^2 = ${f1(pp.lim[0])}, 70·ε^2 = ${f1(pp.lim[1])}, 90·ε^2 = ${f1(pp.lim[2])}`, r: `→ Klasse ${pp.cls}` });
      } else if (pp.kind === 'internal') {
        const l1 = pp.alpha > 0.5 ? '396·ε/(13·α − 1)' : '36·ε/α', l3 = pp.psi > -1 ? '42·ε/(0.67 + 0.33·ψ)' : '62·ε·(1 − ψ)·sqrt(−ψ)';
        steps.push({ label: `${pp.label} (beidseitig gestützt)`, ref: 'Tab. 5.2 (Blatt 1)', f: ct, v: `α = ${f3(pp.alpha)}, ψ = ${f3(pp.psi)}: Kl. 1 <= ${f1(pp.lim[0])}, Kl. 2 <= ${f1(pp.lim[1])}, Kl. 3 <= ${f1(pp.lim[2])}`, r: `→ Klasse ${pp.cls}`, note: `Kl. 1: c/t <= ${l1}; Kl. 2: ${pp.alpha > 0.5 ? '456·ε/(13·α − 1)' : '41.5·ε/α'}; Kl. 3: ${l3}` });
      } else {
        steps.push({ label: `${pp.label} (einseitig gestützt)`, ref: 'Tab. 5.2 (Blatt 2)', f: ct, v: `Kl. 1 <= 9·ε = ${f1(pp.lim[0])}, Kl. 2 <= 10·ε = ${f1(pp.lim[1])}, Kl. 3 <= 21·ε·sqrt(k_σ) = ${f1(pp.lim[2])}`, r: `→ Klasse ${pp.cls}`, note: `k_σ = ${f3(pp.ks)} (EN 1993-1-5 Tab. 4.2, ψ = ${f2(pp.psi)})` });
      }
    }
    if (!kl.parts.length) steps.push({ label: 'Querschnittsklasse', f: `Klasse ${u.cls}`, note: kl.note || '' });
    if (u.cls === 4 && u.effs.N) {
      steps.push({ label: 'Wirksame Breiten', ref: 'EN 1993-1-5 4.4', f: 'λ̄_p = (c/t)/(28.4·ε·sqrt(k_σ)); innen ρ = (λ̄_p − 0.055·(3 + ψ))/λ̄_p^2 <= 1; aussen ρ = (λ̄_p − 0.188)/λ̄_p^2 <= 1' });
      for (const hh of u.effs.N.holes) steps.push({ label: `${hh.label} (zentrischer Druck)`, f: `k_σ = ${f2(hh.ks)}, ρ = ${f3(hh.rho)}`, r: `nicht wirksam: ${f1(hh.to - hh.from)} mm` });
      steps.push({ label: 'Wirksame Querschnittswerte', f: `A_eff = ${f0(u.effs.N.A)} mm², W_eff,y = ${f1(u.effs.My.Wy / 1e3)} cm³, W_eff,z = ${f1(u.effs.Mz.Wz / 1e3)} cm³`, note: `Schwerpunktverschiebung e_N,y = ${f1(u.effs.N.eNy)} mm, e_N,z = ${f1(u.effs.N.eNz)} mm` });
    }
    out.push({
      id: 'klasse', title: 'Querschnittsklassifizierung', ref: ref('class', norm),
      intro: 'Die gedrückten Teile werden unter der tatsächlichen Spannungsverteilung der massgebenden Kombination eingestuft (Stege mit plastischer Druckzonenhöhe α, Klasse 3 mit Spannungsverhältnis ψ).',
      steps, result: { text: `Querschnittsklasse ${u.cls} → ${u.cls <= 2 ? 'plastische' : u.cls === 3 ? 'elastische' : 'wirksame'} Widerstände` },
    });
  }

  // ---------------------------------------------------------------- Querschnittsnachweise
  const cN = ck('N');
  if (cN) {
    const R = cN.u.R, comp = cN.label.includes('Druck');
    out.push({
      id: 'N', title: cN.label, ref: ref('N', norm), intro: where(cN),
      steps: comp ? [
        { label: 'Druckwiderstand', ref: R.cls === 4 ? '(6.11)' : '(6.10)', f: `N_c,Rd = ${R.cls === 4 ? 'A_eff' : 'A'}·f_y/γ_M0`, v: `= ${f0(R.Aeff)}·${fy}/${f2(g0)}`, r: `= ${f1(kN(R.NcRd))} kN` },
        proof('N_Ed/N_c,Rd', f1(cN.Ed), f1(cN.Rd), cN.eta, '(6.9)'),
      ] : [
        { label: 'Plastischer Zugwiderstand', ref: '(6.6)', f: 'N_pl,Rd = A·f_y/γ_M0', v: `= ${f0(s.A)}·${fy}/${f2(g0)}`, r: `= ${f1(kN(R.NtRd))} kN`, note: 'Bruttoquerschnitt ohne Lochschwächung' },
        proof('N_Ed/N_t,Rd', f1(cN.Ed), f1(cN.Rd), cN.eta, '(6.5)'),
      ],
      result: result(cN.eta),
    });
  }
  const cV = ck('Vz');
  if (cV) {
    const R = cV.u.R;
    const rr = s.r || 0;
    const avz = s.type === 'I' ? `A_v,z = A − 2·b·t_f + (t_w + 2·r)·t_f >= η·h_w·t_w` : s.type === 'WI' ? 'A_v,z = η·h_w·t_w' : s.type === 'U' ? 'A_v,z = A − 2·b·t_f + (t_w + r)·t_f' : s.type === 'RHS' ? 'A_v,z = A·h/(b + h)' : s.type === 'CHS' ? 'A_v = 2·A/π' : 'A_v,z (Eingabe)';
    const steps = [
      { label: 'Schubfläche', ref: '6.2.6(3)', f: avz, v: s.type === 'I' ? `= ${f0(s.A)} − 2·${f1(s.b)}·${f1(s.tf)} + (${f1(s.tw)} + 2·${f1(rr)})·${f1(s.tf)} >= ${f1(etaV)}·${f1(s.hw)}·${f1(s.tw)}` : '', r: `= ${f0(R.Avz)} mm²`, note: isI ? `η = ${f1(etaV)} (${norm === 'EC' ? 'EN 1993-1-5 5.1 für Stahlsorten bis S460' : 'auf der sicheren Seite'})` : '' },
      { label: 'Plastischer Querkraftwiderstand', ref: '(6.18)', f: 'V_pl,z,Rd = A_v,z·(f_y/sqrt(3))/γ_M0', v: `= ${f0(R.Avz)}·(${fy}/sqrt(3))/${f2(g0)}`, r: `= ${f1(kN(R.VplzRd))} kN` },
      proof('V_z,Ed/V_pl,z,Rd', f1(cV.Ed), f1(cV.Rd), cV.eta, '(6.17)'),
    ];
    if (R.hwtw) steps.push({ label: 'Schubbeulen des Stegs', ref: 'EN 1993-1-5 5.1(2)', f: 'h_w/t_w <= 72·ε/η', v: `${f1(R.hwtw)} ${R.hwtw <= R.hwtwLim ? '<=' : '>'} 72·${f3(eps)}/${f1(etaV)} = ${f1(R.hwtwLim)}`, r: R.hwtw <= R.hwtwLim ? '→ kein Beulnachweis nötig' : '→ Beulnachweis (Abschnitt «Schubbeulen»)' });
    if (cV.eta > 0.5) steps.push({ label: 'Interaktion mit Biegung', ref: '6.2.8', f: 'V_Ed > 0.5·V_pl,Rd → Abminderung des Biegewiderstands mit ρ', note: 'siehe Abschnitt «Biegung My»' });
    out.push({ id: 'Vz', title: 'Querkraft Vz', ref: ref('V', norm), intro: where(cV), steps, result: result(cV.eta) });
  }
  const cVb = ck('Vb');
  if (cVb) {
    const R = cVb.u.R, tw = s.type === 'RHS' ? s.t : s.tw;
    out.push({
      id: 'Vb', title: 'Schubbeulen Steg', ref: ref('Vb', norm), intro: `${where(cVb)}. Nur Quersteifen an den Auflagern (k_τ = 5.34).`,
      steps: [
        { label: 'Schlankheit des Stegs', ref: 'EN 1993-1-5 (5.5)', f: 'λ̄_w = h_w/(86.4·t_w·ε)', v: `= ${f1(s.hw)}/(86.4·${f1(tw)}·${f3(eps)})`, r: `= ${f3(R.lamw)}` },
        { label: 'Abminderungsfaktor', ref: 'EN 1993-1-5 Tab. 5.1', f: R.lamw < 0.83 / etaV ? 'χ_w = η' : 'χ_w = 0.83/λ̄_w', r: `= ${f3(R.chiw)}` },
        { label: 'Beulwiderstand', ref: 'EN 1993-1-5 (5.1), (5.2)', f: 'V_b,Rd = χ_w·f_y·h_w·t_w/(sqrt(3)·γ_M1) <= V_pl,Rd', v: `= ${f3(R.chiw)}·${fy}·${f1(s.hw)}·${f1(tw)}${s.type === 'RHS' ? '·2' : ''}/(sqrt(3)·${f2(g1)})`, r: `= ${f1(kN(R.VbRd))} kN` },
        proof('V_Ed/V_b,Rd', f1(cVb.Ed), f1(cVb.Rd), cVb.eta, 'EN 1993-1-5 (5.10)'),
      ],
      result: result(cVb.eta),
    });
  }
  const cVy = ck('Vy');
  if (cVy) {
    const R = cVy.u.R;
    out.push({
      id: 'Vy', title: 'Querkraft Vy', ref: ref('V', norm), intro: where(cVy),
      steps: [
        { label: 'Schubfläche', ref: '6.2.6(3)', f: isI ? 'A_v,y = 2·b·t_f' : 'A_v,y', r: `= ${f0(R.Avy)} mm²` },
        { label: 'Plastischer Querkraftwiderstand', ref: '(6.18)', f: 'V_pl,y,Rd = A_v,y·(f_y/sqrt(3))/γ_M0', v: `= ${f0(R.Avy)}·(${fy}/sqrt(3))/${f2(g0)}`, r: `= ${f1(kN(R.VplyRd))} kN` },
        proof('V_y,Ed/V_pl,y,Rd', f1(cVy.Ed), f1(cVy.Rd), cVy.eta, '(6.17)'),
      ],
      result: result(cVy.eta),
    });
  }
  const Wname = (cls, ax) => (cls <= 2 ? `W_pl,${ax}` : cls === 3 ? `W_el,${ax}` : `W_eff,${ax}`);
  const Mref = (cls) => (cls <= 2 ? '(6.13)' : cls === 3 ? '(6.14)' : '(6.15)');
  const cMy = ck('My');
  if (cMy) {
    const R = cMy.u.R, rho = cMy.u.cs.My.rho;
    const steps = [{ label: `Biegewiderstand (Klasse ${R.cls})`, ref: Mref(R.cls), f: `M_c,y,Rd = ${Wname(R.cls, 'y')}·f_y/γ_M0`, v: `= ${f1(R.Wy / 1e3)}·10^3·${fy}/${f2(g0)}`, r: `= ${f1(kNm(R.McyRd))} kNm` }];
    if (rho > 0) {
      const ratio = (Math.sqrt(rho) + 1) / 2;
      steps.push({ label: 'Abminderung durch Querkraft', ref: '6.2.8 (6.29)', f: 'ρ = (2·V_Ed/V_pl,Rd − 1)^2', v: `= (2·${f3(ratio)} − 1)^2`, r: `= ${f3(rho)}` });
      steps.push({ label: 'Abgeminderter Biegewiderstand', ref: '(6.30)', f: R.Aw ? `M_y,V,Rd = (${Wname(R.cls, 'y')} − ρ·A_w^2/(4·t_w))·f_y/γ_M0 <= M_c,y,Rd` : 'M_y,V,Rd = (1 − ρ)·M_c,y,Rd', r: `= ${f1(cMy.Rd)} kNm`, note: R.Aw ? `A_w = h_w·t_w = ${f0(R.Aw)} mm²` : '' });
    }
    steps.push(proof(`M_y,Ed/${rho > 0 ? 'M_y,V,Rd' : 'M_c,y,Rd'}`, f1(cMy.Ed), f1(cMy.Rd), cMy.eta, '(6.12)'));
    out.push({ id: 'My', title: 'Biegung My', ref: ref('M', norm), intro: where(cMy), steps, result: result(cMy.eta) });
  }
  const cMz = ck('Mz');
  if (cMz) {
    const R = cMz.u.R;
    out.push({
      id: 'Mz', title: 'Biegung Mz', ref: ref('M', norm), intro: where(cMz),
      steps: [
        { label: `Biegewiderstand (Klasse ${R.cls})`, ref: Mref(R.cls), f: `M_c,z,Rd = ${Wname(R.cls, 'z')}·f_y/γ_M0`, v: `= ${f1(R.Wz / 1e3)}·10^3·${fy}/${f2(g0)}`, r: `= ${f1(kNm(R.MczRd))} kNm` },
        proof('M_z,Ed/M_c,z,Rd', f1(cMz.Ed), f1(cMz.Rd), cMz.eta, '(6.12)'),
      ],
      result: result(cMz.eta),
    });
  }
  const cNM = ck('NM');
  if (cNM) {
    const nm = cNM.u.cs.NM, R = cNM.u.R;
    const steps = [{ label: 'Schnittgrössen an der massgebenden Stelle', f: `N_Ed = ${f1(nm.N)} kN, M_y,Ed = ${f1(nm.My)} kNm, M_z,Ed = ${f1(nm.Mz)} kNm`, note: `Verfahren: ${nm.method}` }];
    if (nm.MNy !== undefined) {
      steps.push({ label: 'Bezogene Normalkraft', f: 'n = N_Ed/N_pl,Rd', r: `= ${f3(nm.n)}` });
      if (isI) {
        steps.push({ label: 'Stegflächenanteil', f: 'a = (A − 2·b·t_f)/A <= 0.5', v: `= (${f0(s.A)} − 2·${f1(s.b)}·${f1(s.tf)})/${f0(s.A)}`, r: `= ${f3(nm.a)}` });
        steps.push({ label: 'Abgeminderter Biegewiderstand y', ref: '(6.33), (6.34), (6.36)', f: 'M_N,y,Rd = M_pl,y,Rd·(1 − n)/(1 − 0.5·a) <= M_pl,y,Rd', r: `= ${f1(kNm(nm.MNy))} kNm`, note: 'keine Abminderung für n <= 0.25 und N_Ed <= 0.5·h_w·t_w·f_y/γ_M0' });
        steps.push({ label: 'Abgeminderter Biegewiderstand z', ref: '(6.35), (6.37), (6.38)', f: 'n > a: M_N,z,Rd = M_pl,z,Rd·[1 − ((n − a)/(1 − a))^2]', r: `= ${f1(kNm(nm.MNz))} kNm`, note: 'keine Abminderung für N_Ed <= h_w·t_w·f_y/γ_M0' });
        steps.push({ label: 'Zweiachsige Biegung', ref: '(6.41)', f: '[M_y,Ed/M_N,y,Rd]^α + [M_z,Ed/M_N,z,Rd]^β <= 1', v: `α = 2, β = 5·n >= 1 = ${f2(nm.beta)}`, r: `η = ${f3(cNM.eta)}` });
      } else if (s.type === 'RHS') {
        steps.push({ label: 'Abgeminderte Biegewiderstände', ref: '(6.39), (6.40)', f: 'M_N,y,Rd = M_pl,y,Rd·(1 − n)/(1 − 0.5·a_w), M_N,z,Rd = M_pl,z,Rd·(1 − n)/(1 − 0.5·a_f)', r: `= ${f1(kNm(nm.MNy))} kNm, ${f1(kNm(nm.MNz))} kNm` });
        steps.push({ label: 'Zweiachsige Biegung', ref: '(6.41)', f: '[M_y,Ed/M_N,y,Rd]^α + [M_z,Ed/M_N,z,Rd]^β <= 1, α = β = 1.66/(1 − 1.13·n^2) <= 6', v: `α = β = ${f2(nm.alpha)}`, r: `η = ${f3(cNM.eta)}` });
      } else {
        steps.push({ label: 'Abgeminderte Biegewiderstände (Rohr)', f: 'M_N,Rd = M_pl,Rd·(1 − n^1.7)', r: `= ${f1(kNm(nm.MNy))} kNm` });
        steps.push({ label: 'Zweiachsige Biegung', ref: '(6.41)', f: '[M_y,Ed/M_N,y,Rd]^2 + [M_z,Ed/M_N,z,Rd]^2 <= 1', r: `η = ${f3(cNM.eta)}` });
      }
    } else {
      const NRd = nm.N >= 0 ? R.NcRd : R.NtRd;
      steps.push({
        label: R.cls <= 2 ? 'Lineare Interaktion' : R.cls === 3 ? 'Elastische Interaktion' : 'Wirksamer Querschnitt', ref: R.cls <= 2 ? '6.2.1(7)' : R.cls === 3 ? '(6.42)' : '(6.44)',
        f: R.cls === 4 ? 'N_Ed/(A_eff·f_y/γ_M0) + (M_y,Ed + N_Ed·e_N,z)/(W_eff,y·f_y/γ_M0) + (M_z,Ed + N_Ed·e_N,y)/(W_eff,z·f_y/γ_M0) <= 1' : 'N_Ed/N_Rd + M_y,Ed/M_y,Rd + M_z,Ed/M_z,Rd <= 1',
        v: `= ${f1(Math.abs(nm.N))}/${f1(kN(NRd))} + ${f1(Math.abs(nm.My) + kNm(nm.dMy || 0))}/${f1(kNm(R.McyRd))} + ${f1(Math.abs(nm.Mz) + kNm(nm.dMz || 0))}/${f1(kNm(R.MczRd))}`, r: `= ${f3(cNM.eta)}`,
      });
    }
    out.push({ id: 'NM', title: cNM.label, ref: ref('NM', norm), intro: where(cNM), steps, result: result(cNM.eta) });
  }

  // ---------------------------------------------------------------- Biegeknicken
  const cNb = [ck('Nby'), ck('Nbz')].filter(Boolean).sort((a, b) => b.eta - a.eta)[0];
  if (cNb) {
    const st = cNb.u.st, R = cNb.u.R;
    const steps = [
      { label: 'Normalkraft', f: `N_Ed = ${f1(kN(st.NEd))} kN`, note: cNb.comboName },
      { label: 'Charakteristischer Widerstand', f: `N_Rk = ${R.cls === 4 ? 'A_eff' : 'A'}·f_y`, v: `= ${f0(R.Aeff)}·${fy}`, r: `= ${f1(kN(st.NRk))} kN` },
    ];
    const axis = (ax) => {
      const Y = ax === 'y';
      const beta = Number(Y ? p.stab.betaY : p.stab.betaZ) || 1, Lref = Y ? st.LrefY : st.LsegMax;
      const Lcr = Y ? st.LcrY : st.LcrZ, Ncr = Y ? st.NcrY : st.NcrZ, lam = Y ? st.lamY : st.lamZ, Phi = Y ? st.PhiY : st.PhiZ, chi = Y ? st.chiY : st.chiZ, alpha = Y ? st.alphaY : st.alphaZ;
      const NbRd = Y ? st.NbyRd : st.NbzRd, I = Y ? s.Iy : s.Iz;
      steps.push(
        { label: `Knicklänge ${ax}-${ax}`, f: `L_cr,${ax} = β_${ax}·L`, v: `= ${f2(beta)}·${f3(Lref)}`, r: `= ${f3(Lcr / 1000)} m`, note: Y ? 'L: grösstes Feld bzw. Stablänge' : 'L: grösster Abstand der seitlichen Halterungen' },
        { label: 'Verzweigungslast', f: `N_cr,${ax} = π^2·E·I_${ax}/L_cr,${ax}^2`, v: `= π^2·${f0(E_STEEL)}·${f0(I / 1e4)}·10^4/${f0(Lcr)}^2`, r: `= ${f1(kN(Ncr))} kN` },
        { label: 'Schlankheit', ref: '(6.50)', f: `λ̄_${ax} = sqrt(N_Rk/N_cr,${ax})`, v: `= sqrt(${f1(kN(st.NRk))}/${f1(kN(Ncr))})`, r: `= ${f3(lam)}` },
        { label: `Knicklinie ${Y ? st.curveY : st.curveZ}`, ref: 'Tab. 6.1, 6.2', f: `α = ${f2(alpha)}` },
        { label: 'Hilfswert', ref: '(6.49)', f: `Φ_${ax} = 0.5·[1 + α·(λ̄_${ax} − 0.2) + λ̄_${ax}^2]`, v: `= 0.5·[1 + ${f2(alpha)}·(${f3(lam)} − 0.2) + ${f3(lam)}^2]`, r: `= ${f3(Phi)}` },
        { label: 'Abminderungsfaktor', ref: '(6.49)', f: `χ_${ax} = 1/(Φ_${ax} + sqrt(Φ_${ax}^2 − λ̄_${ax}^2)) <= 1`, v: lam > 0.2 ? `= 1/(${f3(Phi)} + sqrt(${f3(Phi)}^2 − ${f3(lam)}^2))` : 'λ̄ <= 0.2', r: `= ${f3(chi)}` },
        { label: 'Knickwiderstand', ref: '(6.47)', f: `N_b,${ax},Rd = χ_${ax}·N_Rk/γ_M1`, v: `= ${f3(chi)}·${f1(kN(st.NRk))}/${f2(g1)}`, r: `= ${f1(kN(NbRd))} kN` },
        proof(`N_Ed/N_b,${ax},Rd`, f1(kN(st.NEd)), f1(kN(NbRd)), st.NEd / NbRd, '(6.46)'));
    };
    axis('y'); axis('z');
    out.push({ id: 'Nb', title: 'Biegeknicken', ref: ref('Nb', norm), intro: 'Ersatzstabverfahren mit Knicklinien nach Tab. 6.2; Knicken um y-y (in der Ebene) und z-z (aus der Ebene, zwischen seitlichen Halterungen).', steps, result: result(cNb.eta, `massgebend ${cNb.id === 'Nby' ? 'y-y' : 'z-z'}:`) });
  }
  const cNT = ck('NbT');
  if (cNT) {
    const st = cNT.u.st;
    const steps = [
      { label: 'Polarer Trägheitsradius', f: s.type === 'U' ? 'i_0^2 = i_y^2 + i_z^2 + y_0^2' : 'i_0^2 = i_y^2 + i_z^2', v: `= ${f1(s.iy)}^2 + ${f1(s.iz)}^2${s.type === 'U' ? ` + ${f1(s.y0)}^2` : ''}`, r: `= ${f0(st.i02)} mm²` },
      { label: 'Drillknicklast', ref: 'EN 1993-1-3 6.2.3', f: 'N_cr,T = (G·I_t + π^2·E·I_w/L_T^2)/i_0^2', v: `= (${f0(G_STEEL)}·${f0(s.It)} + π^2·${f0(E_STEEL)}·${f1(s.Iw / 1e6)}·10^6/${f0(st.LT)}^2)/${f0(st.i02)}`, r: `= ${f1(kN(st.NcrT))} kN`, note: `L_T = k_w·L = ${f3(st.LT / 1000)} m` },
    ];
    if (s.type === 'U') steps.push({ label: 'Biegedrillknicklast (einfach symmetrisch)', ref: 'EN 1993-1-3 6.2.3', f: 'N_cr,TF = (N_cr,y + N_cr,T − sqrt((N_cr,y + N_cr,T)^2 − 4·β·N_cr,y·N_cr,T))/(2·β), β = 1 − (y_0/i_0)^2', r: `= ${f1(kN(st.NcrTF))} kN` });
    steps.push(
      { label: 'Schlankheit', ref: '(6.52)', f: 'λ̄_T = sqrt(N_Rk/N_cr)', v: `= sqrt(${f1(kN(st.NRk))}/${f1(kN(st.NcrTorsion))})`, r: `= ${f3(st.lamT)}` },
      { label: `Abminderung (Knicklinie ${st.curveZ})`, ref: '6.3.1.4', f: 'χ_T = 1/(Φ_T + sqrt(Φ_T^2 − λ̄_T^2))', v: `Φ_T = ${f3(st.PhiT)}`, r: `= ${f3(st.chiT)}` },
      { label: 'Widerstand', ref: '(6.47)', f: 'N_b,Rd = χ_T·N_Rk/γ_M1', v: `= ${f3(st.chiT)}·${f1(kN(st.NRk))}/${f2(g1)}`, r: `= ${f1(kN(st.NbTRd))} kN` },
      proof('N_Ed/N_b,Rd', f1(kN(st.NEd)), f1(kN(st.NbTRd)), cNT.eta, '(6.46)'));
    out.push({ id: 'NbT', title: cNT.label, ref: ref('NbT', norm), intro: cNT.comboName, steps, result: result(cNT.eta) });
  }

  // ---------------------------------------------------------------- Kippen
  const cLT = ck('Mb');
  if (cLT) {
    const sg = cLT.seg, st = cLT.u.st, R = cLT.u.R, lt = sg.lt;
    const method = st.ltbMethod;
    const lp = p.stab.loadPos || 'top';
    const steps = [
      { label: 'Kippsegment', f: `${f2(sg.x0)} … ${f2(sg.x1)} m, L = ${f3(sg.L)} m`, note: 'zwischen Auflagern bzw. seitlichen Halterungen (Gabellager)' },
      { label: 'Bemessungsmoment', f: `M_y,Ed = ${f1(sg.MyEd)} kNm`, note: cLT.comboName },
    ];
    if (sg.mcrBy === 'formula') {
      const fo = sg.formula;
      steps.push(
        { label: 'Momentenbeiwerte', ref: 'NCCI SN003', f: `C_1 = ${f3(sg.C1)}, C_2 = ${f3(sg.C2)}`, note: sg.csrc },
        { label: 'Lastangriffspunkt', f: `z_g = ${f0(sg.zg)} mm`, note: lp === 'top' ? 'Obergurt (+h/2, destabilisierend)' : lp === 'bottom' ? 'Untergurt (−h/2, stabilisierend)' : 'Schwerpunkt' },
        { label: 'Einspannung', f: `k = ${f2(sg.k)}, k_w = ${f2(sg.kw)}` },
        { label: 'Hilfswert', f: 'N_cr,z = π^2·E·I_z/(k·L)^2', v: `= π^2·${f0(E_STEEL)}·${f1(s.Iz / 1e4)}·10^4/(${f2(sg.k)}·${f0(sg.L * 1000)})^2`, r: `= ${f1(kN(fo.Ncrz))} kN` },
        { label: 'Ideales Kippmoment', ref: 'NCCI SN003 (3-Faktoren-Formel)', f: 'M_cr = C_1·N_cr,z·{sqrt[(k/k_w)^2·I_w/I_z + (k·L)^2·G·I_t/(π^2·E·I_z) + (C_2·z_g)^2] − C_2·z_g}', v: `= ${f3(sg.C1)}·${f1(kN(fo.Ncrz))}·{sqrt[${f0(fo.t1)} + ${f0(fo.t2)} + ${f0(fo.t3)}] − ${f1(sg.C2 * sg.zg)}}·10^-3`, r: `= ${f1(kNm(sg.Mcr))} kNm` });
    } else {
      steps.push({ label: 'Ideales Kippmoment (Eigenwertanalyse)', f: 'M_cr = α_cr·M_y,Ed', v: `= ${f3(sg.lambdaCr)}·${f1(sg.MyEd)}`, r: `= ${f1(kNm(sg.Mcr))} kNm`, note: `${sg.csrc}. FE-Biegedrillstab (Gabellager an Auflagern und Halterungen, Lastangriff z_g = ${f0(sg.zg ?? 0)} mm); entspricht C_1 = ${f3(sg.C1eq)} bezogen auf das konstante Moment.` });
    }
    const W = Wname(R.cls, 'y');
    steps.push({ label: 'Schlankheit', ref: '6.3.2.2', f: `λ̄_LT = sqrt(${W}·f_y/M_cr)`, v: `= sqrt(${f1(R.Wy / 1e3)}·10^3·${fy}/(${f1(kNm(sg.Mcr))}·10^6))`, r: `= ${f3(sg.lamLT)}` });
    const mref = method === 'general' ? '6.3.2.2, Tab. 6.3/6.4' : method === 'rolled' ? '6.3.2.3, Tab. 6.3/6.5' : 'SIA 263 (Kippen)';
    steps.push({ label: `Kipplinie ${sg.curveLT}`, ref: mref, f: `α_LT = ${f2(sg.alphaLT)}, λ̄_LT,0 = ${f2(lt.lam0)}, β = ${f2(lt.beta)}` });
    steps.push({ label: 'Hilfswert', f: 'Φ_LT = 0.5·[1 + α_LT·(λ̄_LT − λ̄_LT,0) + β·λ̄_LT^2]', v: `= 0.5·[1 + ${f2(sg.alphaLT)}·(${f3(sg.lamLT)} − ${f2(lt.lam0)}) + ${f2(lt.beta)}·${f3(sg.lamLT)}^2]`, r: `= ${f3(lt.Phi)}` });
    steps.push({ label: 'Abminderungsfaktor', ref: method === 'general' ? '(6.56)' : '(6.57)', f: `χ_LT = 1/(Φ_LT + sqrt(Φ_LT^2 − β·λ̄_LT^2)) <= 1${method === 'rolled' ? ', <= 1/λ̄_LT^2' : ''}`, v: sg.lamLT > lt.lam0 ? `= 1/(${f3(lt.Phi)} + sqrt(${f3(lt.Phi)}^2 − ${f2(lt.beta)}·${f3(sg.lamLT)}^2))` : 'λ̄_LT <= λ̄_LT,0', r: `= ${f3(lt.chi)}` });
    if (method === 'rolled') {
      steps.push(
        { label: 'Korrekturbeiwert', ref: 'Tab. 6.6', f: 'k_c', r: `= ${f3(sg.kc)}` },
        { label: 'Modifikation', ref: '(6.58)', f: 'f = 1 − 0.5·(1 − k_c)·[1 − 2·(λ̄_LT − 0.8)^2] <= 1', v: `= 1 − 0.5·(1 − ${f3(sg.kc)})·[1 − 2·(${f3(sg.lamLT)} − 0.8)^2]`, r: `= ${f3(lt.f)}` },
        { label: 'Modifizierter Abminderungsfaktor', ref: '(6.58)', f: 'χ_LT,mod = χ_LT/f <= 1', v: `= ${f3(lt.chi)}/${f3(lt.f)}`, r: `= ${f3(lt.chiMod)}` });
    }
    steps.push(
      { label: 'Kippwiderstand', ref: '(6.55)', f: `M_b,Rd = χ_LT·${W}·f_y/γ_M1`, v: `= ${f3(sg.chiLT)}·${f1(R.Wy / 1e3)}·10^3·${fy}/${f2(g1)}`, r: `= ${f1(kNm(sg.MbRd))} kNm` },
      proof('M_y,Ed/M_b,Rd', f1(cLT.Ed), f1(cLT.Rd), cLT.eta, '(6.54)'));
    out.push({ id: 'Mb', title: 'Biegedrillknicken (Kippen)', ref: ref('Mb', norm), intro: st.segments.filter((x) => x.Mcr).length > 1 ? 'Ausgewertet je Kippsegment; dargestellt ist das massgebende Segment.' : '', steps, result: result(cLT.eta) });
  } else if (u.st && !u.st.ltbActive) {
    out.push({ id: 'Mb', title: 'Biegedrillknicken (Kippen)', ref: ref('Mb', norm), intro: `Kein Kippnachweis erforderlich: ${u.st.ltbReason || 'nicht massgebend'}.`, steps: [] });
  }

  // ---------------------------------------------------------------- Interaktion
  const c61 = ck('int61'), c62 = ck('int62');
  if (c61 || c62) {
    const c = c62 && (!c61 || c62.eta >= c61.eta) ? c62 : c61;
    const sg = c.seg, st = c.u.st, R = c.u.R, k = sg.kf;
    const plastic = R.cls <= 2, sus = sg.susceptible, rhs = !!s.closed;
    const CmLT = Math.max(0.4, sg.CmLT.Cm);
    const NRk = kN(st.NRk);
    const steps = [
      { label: 'Bemessungswerte im Segment', f: `N_Ed = ${f1(sg.NEd)} kN, M_y,Ed = ${f1(sg.MyEd)} kNm, M_z,Ed = ${f1(sg.MzEd)} kNm`, note: `Segment ${f2(sg.x0)} … ${f2(sg.x1)} m · ${c.comboName}` },
      { label: 'Momentenbeiwerte', ref: 'Anhang B, Tab. B.3', f: `C_my = ${f3(sg.Cmy.Cm)}, C_mz = ${f3(sg.Cmz.Cm)}, C_mLT = ${f3(CmLT)}`, note: [cmNote(sg.Cmy, 'C_my'), cmNote(sg.Cmz, 'C_mz'), cmNote(sg.CmLT, 'C_mLT')].join(' · ') },
      { label: 'Bezogene Normalkräfte', f: 'n_y = N_Ed/(χ_y·N_Rk/γ_M1), n_z = N_Ed/(χ_z·N_Rk/γ_M1)', v: `= ${f1(sg.NEd)}/(${f3(st.chiY)}·${f1(NRk)}/${f2(g1)}), ${f1(sg.NEd)}/(${f3(st.chiZ)}·${f1(NRk)}/${f2(g1)})`, r: `= ${f3(sg.nY)}, ${f3(sg.nZ)}` },
    ];
    const tab = `${sus ? 'Tab. B.2 (verdrehweich)' : 'Tab. B.1 (verdrehsteif bzw. gehalten)'}, ${plastic ? 'Klasse 1/2' : 'Klasse 3/4'}`;
    if (plastic) {
      steps.push({ label: 'Beiwert k_yy', ref: tab, f: 'k_yy = C_my·[1 + (λ̄_y − 0.2)·n_y] <= C_my·(1 + 0.8·n_y)', v: `= ${f3(sg.Cmy.Cm)}·[1 + (${f3(st.lamY)} − 0.2)·${f3(sg.nY)}]`, r: `= ${f3(k.kyy)}` });
      steps.push(rhs
        ? { label: 'Beiwert k_zz', f: 'k_zz = C_mz·[1 + (λ̄_z − 0.2)·n_z] <= C_mz·(1 + 0.8·n_z)', v: `= ${f3(sg.Cmz.Cm)}·[1 + (${f3(st.lamZ)} − 0.2)·${f3(sg.nZ)}]`, r: `= ${f3(k.kzz)}` }
        : { label: 'Beiwert k_zz', f: 'k_zz = C_mz·[1 + (2·λ̄_z − 0.6)·n_z] <= C_mz·(1 + 1.4·n_z)', v: `= ${f3(sg.Cmz.Cm)}·[1 + (2·${f3(st.lamZ)} − 0.6)·${f3(sg.nZ)}]`, r: `= ${f3(k.kzz)}` });
      steps.push({ label: 'Beiwert k_yz', f: 'k_yz = 0.6·k_zz', r: `= ${f3(k.kyz)}` });
      steps.push(!sus ? { label: 'Beiwert k_zy', f: 'k_zy = 0.6·k_yy', r: `= ${f3(k.kzy)}` }
        : st.lamZ < 0.4 ? { label: 'Beiwert k_zy', f: 'k_zy = 0.6 + λ̄_z <= 1 − 0.1·λ̄_z·n_z/(C_mLT − 0.25)', r: `= ${f3(k.kzy)}` }
          : { label: 'Beiwert k_zy', f: 'k_zy = 1 − 0.1·λ̄_z·n_z/(C_mLT − 0.25) >= 1 − 0.1·n_z/(C_mLT − 0.25)', v: `= 1 − 0.1·${f3(st.lamZ)}·${f3(sg.nZ)}/(${f3(CmLT)} − 0.25)`, r: `= ${f3(k.kzy)}` });
    } else {
      steps.push({ label: 'Beiwert k_yy', ref: tab, f: 'k_yy = C_my·(1 + 0.6·λ̄_y·n_y) <= C_my·(1 + 0.6·n_y)', v: `= ${f3(sg.Cmy.Cm)}·(1 + 0.6·${f3(st.lamY)}·${f3(sg.nY)})`, r: `= ${f3(k.kyy)}` });
      steps.push({ label: 'Beiwert k_zz', f: 'k_zz = C_mz·(1 + 0.6·λ̄_z·n_z) <= C_mz·(1 + 0.6·n_z)', v: `= ${f3(sg.Cmz.Cm)}·(1 + 0.6·${f3(st.lamZ)}·${f3(sg.nZ)})`, r: `= ${f3(k.kzz)}` });
      steps.push({ label: 'Beiwert k_yz', f: 'k_yz = k_zz', r: `= ${f3(k.kyz)}` });
      steps.push(sus ? { label: 'Beiwert k_zy', f: 'k_zy = 1 − 0.05·λ̄_z·n_z/(C_mLT − 0.25) >= 1 − 0.05·n_z/(C_mLT − 0.25)', v: `= 1 − 0.05·${f3(st.lamZ)}·${f3(sg.nZ)}/(${f3(CmLT)} − 0.25)`, r: `= ${f3(k.kzy)}` } : { label: 'Beiwert k_zy', f: 'k_zy = 0.8·k_yy', r: `= ${f3(k.kzy)}` });
    }
    steps.push({ label: 'Kippen', f: `χ_LT = ${f3(sg.chiLT)}`, note: sus ? 'aus dem Kippnachweis des Segments' : 'nicht kippgefährdet bzw. gehalten → χ_LT = 1' });
    if (R.cls === 4) steps.push({ label: 'Zusatzmomente (Klasse 4)', f: 'ΔM_y,Ed = N_Ed·e_N,z, ΔM_z,Ed = N_Ed·e_N,y', r: `= ${f2(kNm(sg.dMy))} kNm, ${f2(kNm(sg.dMz))} kNm` });
    steps.push({
      label: 'Ausweichen in der Ebene', ref: '(6.61)', f: 'N_Ed/(χ_y·N_Rk/γ_M1) + k_yy·(M_y,Ed + ΔM_y,Ed)/(χ_LT·M_y,Rk/γ_M1) + k_yz·(M_z,Ed + ΔM_z,Ed)/(M_z,Rk/γ_M1) <= 1',
      v: `= ${f3(sg.terms.tN1)} + ${f3(k.kyy)}·${f3(sg.terms.tMy)} + ${f3(k.kyz)}·${f3(sg.terms.tMz)}`, r: `= ${f3(sg.int61)} ${cmp(sg.int61)}`,
    });
    steps.push({
      label: 'Ausweichen aus der Ebene', ref: '(6.62)', f: 'N_Ed/(χ_z·N_Rk/γ_M1) + k_zy·(M_y,Ed + ΔM_y,Ed)/(χ_LT·M_y,Rk/γ_M1) + k_zz·(M_z,Ed + ΔM_z,Ed)/(M_z,Rk/γ_M1) <= 1',
      v: `= ${f3(sg.terms.tN2)} + ${f3(k.kzy)}·${f3(sg.terms.tMy)} + ${f3(k.kzz)}·${f3(sg.terms.tMz)}`, r: `= ${f3(sg.int62)} ${cmp(sg.int62)}`,
      note: st.torsional && sg.chiZN < st.chiZ - 1e-9 ? `χ_z durch χ_T = ${f3(st.chiT)} ersetzt (Drillknicken massgebend)` : `M_y,Rk = ${W_RK(R, fy)}, M_z,Rk = ${f1(kNm(R.Wz * fy))} kNm`,
    });
    out.push({ id: 'int', title: 'Interaktion Normalkraft und Biegung', ref: ref('int', norm), intro: 'Methode 2 (Anhang B); ausgewertet je Kippsegment, dargestellt ist das massgebende.', steps, result: result(c.eta) });
  }
  const cT = ck('intT');
  if (cT) {
    const sg = cT.seg, R = cT.u.R;
    out.push({
      id: 'intT', title: cT.label, ref: ref('Mb', norm), intro: 'Zugkraft günstig vernachlässigt (auf der sicheren Seite).',
      steps: [{ label: 'Lineare Interaktion', f: 'M_y,Ed/(χ_LT·M_y,Rk/γ_M1) + M_z,Ed/(M_z,Rk/γ_M1) <= 1', v: `= ${f1(sg.MyEd)}/(${f3(sg.chiLT)}·${f1(kNm(R.Wy * fy))}/${f2(g1)}) + ${f1(sg.MzEd)}/(${f1(kNm(R.Wz * fy))}/${f2(g1)})`, r: `= ${f3(cT.eta)}` }],
      result: result(cT.eta),
    });
  }

  // ---------------------------------------------------------------- Gebrauchstauglichkeit
  const ws = ['SLS-char', 'SLS-qp'].map((t) => ck(`w-${t}`)).filter(Boolean);
  if (ws.length) {
    const steps = [];
    const qOf = uniformSS(m);
    for (const c of ws) {
      const w = c.sls, char = w.combo.type === 'SLS-char';
      steps.push({ label: char ? 'Charakteristische Kombination' : 'Quasi-ständige Kombination', ref: norm === 'SIA' ? (char ? 'SIA 260 Gl. (17)' : 'SIA 260 Gl. (19)') : (char ? 'EN 1990 (6.14b)' : 'EN 1990 (6.16b)'), f: char ? 'E_d = Σ G_k + Q_k,1 + Σ ψ_0,i·Q_k,i' : 'E_d = Σ G_k + Σ ψ_2,i·Q_k,i', note: w.combo.name });
      if (qOf && w.dir === 'z') {
        const q = qOf(w.combo.factors), L = m.L * 1000;
        steps.push({ label: 'Durchbiegung (Einfeldträger, Gleichlast)', f: 'w = 5·q·L^4/(384·E·I_y)', v: `= 5·${f3(q)}·${f0(L)}^4/(384·${f0(E_STEEL)}·${f0(s.Iy)})`, r: `= ${f1(5 * q * L ** 4 / (384 * E_STEEL * s.Iy))} mm` });
      } else steps.push({ label: `Durchbiegung ${w.dir === 'z' ? 'vertikal' : 'horizontal'} (Stabstatik)`, f: `w = ${f1(Math.abs(w.w))} mm`, note: `Feld ${f2(w.field.x0)} … ${f2(w.field.x1)} m, x = ${f2(w.x)} m` });
      steps.push({ label: 'Grenzwert', f: w.cant ? `w_lim = 2·L/${w.limit}` : `w_lim = L/${w.limit}`, v: `= ${w.cant ? '2·' : ''}${f0(w.field.L * 1000)}/${w.limit}`, r: `= ${f1(w.wLim)} mm`, note: w.cant ? 'Kragarm: doppelte Kraglänge' : '' });
      steps.push(proof('w/w_lim', f1(Math.abs(w.w)), f1(w.wLim), c.eta));
    }
    const wc = ws.reduce((a, b) => (b.eta > a.eta ? b : a));
    out.push({ id: 'w', title: 'Durchbiegung', ref: ref('w', norm), intro: 'Elastische Biegelinie mit E·I des Bruttoquerschnitts.', steps, result: result(wc.eta) });
  }
  return out;
}

function W_RK(R, fy) { return `${f1(kNm(R.Wy * fy))} kNm`; }
