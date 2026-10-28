// Herleitung (Rechenweg) für das Stabwerk
import { num } from '../../js/core/formula.js';
import { LC_KINDS, pickResult } from './calc.js';
import { sectionProps, materialById } from './sections.js';

const parse = (id) => { const [t, v] = String(id).split(':'); return { t, i: +v }; };

export function derivation(app) {
  const p = app.project, r = app.results;
  if (!r) return [];
  const out = [];
  const key = app.viewOpts.case;
  const res = pickResult(r, key);

  // 1 Methode
  out.push({
    id: 'methode', title: 'Berechnungsverfahren', ref: 'Weggrössenverfahren',
    intro: 'Das Tragwerk wird in Stäbe (Euler-Bernoulli-Balken) zerlegt. Für jeden Stab wird die Steifigkeitsmatrix aufgestellt, zur Gesamtsteifigkeit K zusammengesetzt und das Gleichungssystem für die Knotenverschiebungen gelöst.',
    steps: [
      { label: 'Gleichgewicht am Gesamtsystem', f: 'K · u = F' },
      { label: 'Stabendkräfte je Stab (lokal)', f: 'f = k · u_lokal − f_0', note: 'f₀: Volleinspannkräfte aus Stablasten (Arbeitsäquivalenz mit Hermite-Formfunktionen).' },
      { label: 'Schnittgrössen im Feld aus Gleichgewicht am Teilstab', f: 'M(x) = −M_i + V_i·x + ∫_0^x (x − ξ)·q(ξ) dξ' },
      { label: 'Durchbiegung durch zweifache Integration der Krümmung', f: 'w″(x) = M(x)/(E·I) + κ_T' },
    ],
  });

  // 2 Kombinationen
  const lcs = p.loadCases;
  const comboSteps = r.combos.map((c, i) => {
    const terms = lcs.map((lc, j) => {
      const f = +p.combinations[i]?.factors?.[j] || 0;
      return f ? `${num(f, 2)}·${lc.kind}_{${j + 1}}` : null;
    }).filter(Boolean);
    return { label: `K${i + 1}: ${c.name}`, f: `E_d = ${terms.join(' + ') || '0'}`, note: terms.length ? lcs.map((lc, j) => (+p.combinations[i]?.factors?.[j] ? `${lc.kind}${j + 1} = ${lc.name}` : null)).filter(Boolean).join(' · ') : '' };
  });
  out.push({
    id: 'kombi', title: 'Lastfallkombinationen', ref: 'SIA 260, Gl. (10), (17), (19)',
    intro: 'Tragsicherheit (Typ 2): ständige Lasten mit γ_G = 1.35, die Leiteinwirkung mit γ_Q = 1.5, Begleiteinwirkungen mit γ_Q·ψ₀. Gebrauchstauglichkeit: charakteristisch bzw. quasi-ständig mit ψ₂.',
    steps: [
      { label: 'Tragsicherheit', f: 'E_d = γ_G·G_k + γ_Q·Q_{k,1} + Σ γ_Q·ψ_{0,i}·Q_{k,i}' },
      { label: 'quasi-ständig', f: 'E_d = G_k + Σ ψ_{2,i}·Q_{k,i}' },
      ...comboSteps,
      ...lcs.filter((lc) => LC_KINDS[lc.kind]?.variable).map((lc) => ({ label: `Beiwerte ${lc.name}`, f: `ψ_0 = ${num(lc.psi?.[0] ?? LC_KINDS[lc.kind].psi[0], 2)}, ψ_2 = ${num(lc.psi?.[2] ?? LC_KINDS[lc.kind].psi[2], 2)}` })),
    ],
  });

  // 3 Stab (ausgewählt oder mit grösstem Moment)
  if (res?.members?.length) {
    const selM = (app.editor?.sel || []).map(parse).find((x) => x.t === 'm' && p.members[x.i]);
    let k = selM ? selM.i : 0;
    if (!selM) { let best = -1; res.members.forEach((m, q) => { const v = Math.max(Math.abs(m.M.max), Math.abs(m.M.min)); if (v > best) { best = v; k = q; } }); }
    const m = p.members[k];
    const s = p.sections[m.sec - 1];
    const sp = sectionProps(s);
    const a = p.nodes[m.i - 1], b = p.nodes[m.j - 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const mat = materialById(s.mat);
    const steps = [
      { label: 'Stablänge', f: 'L = sqrt(Δx^2 + Δy^2)', v: `= sqrt(${num(b.x - a.x, 3)}^2 + ${num(b.y - a.y, 3)}^2)`, r: `= ${num(L, 3)} m` },
    ];
    if (s.type === 'rect') {
      steps.push({ label: 'Querschnittsfläche', f: 'A = b·h', v: `= ${num(s.b / 1000, 3)}·${num(s.h / 1000, 3)}`, r: `= ${num(sp.A, 4)} m²` });
      steps.push({ label: 'Flächenträgheitsmoment', f: 'I = b·h^3/12', v: `= ${num(s.b / 1000, 3)}·${num(s.h / 1000, 3)}^3/12`, r: `= ${num(sp.I * 1e8, 0)} cm⁴` });
    } else if (s.type === 'circle') {
      steps.push({ label: 'Querschnittsfläche', f: 'A = π·d^2/4', v: `= π·${num(s.d / 1000, 3)}^2/4`, r: `= ${num(sp.A, 4)} m²` });
      steps.push({ label: 'Flächenträgheitsmoment', f: 'I = π·d^4/64', v: `= π·${num(s.d / 1000, 3)}^4/64`, r: `= ${num(sp.I * 1e8, 0)} cm⁴` });
    } else {
      steps.push({ label: `Querschnittswerte ${s.type === 'profile' ? s.profile : ''}`.trim(), f: `A = ${num(sp.A * 1e4, 1)} cm², I = ${num(sp.I * 1e8, 0)} cm⁴`, note: s.type === 'profile' ? 'Tabellenwerte des Walzprofils (starke Achse).' : 'Direkt eingegebene Werte.' });
    }
    steps.push({ label: `E-Modul (${mat.label})`, f: 'E', r: `= ${num(sp.E / 1000, 0)} MPa`, note: mat.kind === 'Beton' ? 'E_cm = 10 000·f_cm^(1/3) nach SIA 262 (3.1.2.3)' : '' });
    steps.push({ label: 'Dehnsteifigkeit', f: 'E·A/L', v: `= ${num(sp.E, 0)}·${num(sp.A, 4)}/${num(L, 3)}`, r: `= ${num(sp.E * sp.A / L, 0)} kN/m` });
    steps.push({ label: 'Biegesteifigkeit (Stabende fest)', f: '4·E·I/L', v: `= 4·${num(sp.E * sp.I, 1)}/${num(L, 3)}`, r: `= ${num(4 * sp.E * sp.I / L, 1)} kNm` });
    steps.push({ label: 'Querverschiebungssteifigkeit', f: '12·E·I/L^3', v: `= 12·${num(sp.E * sp.I, 1)}/${num(L, 3)}^3`, r: `= ${num(12 * sp.E * sp.I / L ** 3, 1)} kN/m` });
    if (m.hi || m.hj) steps.push({ label: 'Gelenke', f: m.hi && m.hj ? 'M_i = M_j = 0' : m.hi ? 'M_i = 0' : 'M_j = 0', note: 'Gelenkenden erhalten einen eigenen Drehfreiheitsgrad.' });
    if (sp.gamma > 0) steps.push({ label: 'Eigengewicht', f: 'g_0 = γ·A', v: `= ${num(sp.gamma, 1)}·${num(sp.A, 4)}`, r: `= ${num(sp.gamma * sp.A, 3)} kN/m` });
    const mr = res.members[k];
    const st0 = mr.stations[0], st1 = mr.stations[mr.stations.length - 1];
    steps.push({ label: 'Stabendschnittgrössen', f: `N_i = ${num(st0.N, 1)} kN, V_i = ${num(st0.V, 1)} kN, M_i = ${num(st0.M, 1)} kNm`, note: `Ende: N_j = ${num(st1.N, 1)} kN, V_j = ${num(st1.V, 1)} kN, M_j = ${num(st1.M, 1)} kNm` });
    steps.push({ label: 'Extremwerte im Feld', f: `M_max = ${num(mr.M.max, 1)} kNm, M_min = ${num(mr.M.min, 1)} kNm`, note: 'Ausgewertet an 21 Stellen sowie an allen Lastsprüngen.' });
    // Plausibilitätskontrolle Einfeldträger mit Gleichlast
    const lc = r.lc.length === 1 ? p.loadCases[0] : null;
    if (lc && lc.dist.length === 1 && lc.dist[0].member === k + 1 && (lc.dist[0].q2 === null || lc.dist[0].q2 === '' || lc.dist[0].q2 === undefined) && !lc.selfWeight && !m.hi && !m.hj) {
      const q = +lc.dist[0].q1;
      steps.push({ label: 'Vergleich mit einfachem Balken (Kontrolle)', f: 'M_0 = q·L^2/8', v: `= ${num(q, 2)}·${num(L, 3)}^2/8`, r: `= ${num(q * L * L / 8, 1)} kNm`, note: 'Nur zur Orientierung – entspricht dem Feldmoment bei gelenkiger Lagerung beider Enden.' });
    }
    out.push({ id: 'stab', title: `Stab ${k + 1} (${s.name})`, ref: 'Steifigkeit und Schnittgrössen', intro: selM ? 'Ausgewählter Stab.' : 'Stab mit dem grössten Biegemoment – einen anderen Stab in der Grafik anklicken, um seine Herleitung zu sehen.', steps });
  }

  // 4 Gleichgewicht
  if (res && Number.isFinite(res.sumFx)) {
    out.push({
      id: 'gleich', title: 'Gleichgewichtskontrolle', ref: 'Σ Kräfte = 0',
      steps: [
        { label: 'Horizontal', f: 'ΣF_x + ΣR_x = 0', v: `= ${num(res.sumFx, 2)} + (${num(res.sumRx, 2)})`, r: `= ${num(res.sumFx + res.sumRx, 4)} kN` },
        { label: 'Vertikal', f: 'ΣF_y + ΣR_y = 0', v: `= ${num(res.sumFy, 2)} + (${num(res.sumRy, 2)})`, r: `= ${num(res.sumFy + res.sumRy, 4)} kN` },
      ],
      result: { text: Math.abs(res.sumFx + res.sumRx) + Math.abs(res.sumFy + res.sumRy) < 1e-4 * Math.max(1, Math.abs(res.sumFy)) ? 'Gleichgewicht erfüllt' : 'Abweichung prüfen' },
    });
  }

  // 5 Theorie 2. Ordnung & Stabilität
  const crit = r.combos.map((c, i) => ({ c, i })).filter(({ c }) => c.buckling).sort((a, b) => a.c.buckling.alpha - b.c.buckling.alpha)[0];
  if (crit) {
    const a = crit.c.buckling.alpha;
    const steps = [
      { label: 'Eigenwertproblem', f: '(K + α_cr·K_G(N))·φ = 0', note: 'K_G: geometrische Steifigkeit aus den Normalkräften der Kombination (Theorie 1. Ordnung).' },
      { label: `Kleinster Verzweigungslastfaktor (K${crit.i + 1})`, f: 'α_cr', r: `= ${num(a, 2)}` },
      { label: 'Abschätzung der Momentenvergrösserung', f: '1/(1 − 1/α_cr)', v: `= 1/(1 − 1/${num(a, 2)})`, r: `= ${num(1 / (1 - 1 / a), 3)}`, note: crit.c.amplification ? `Berechnet nach Theorie 2. Ordnung: ×${num(crit.c.amplification, 3)}` : '' },
      { label: 'Kriterium', f: 'α_cr ≥ 10 → Effekte 2. Ordnung vernachlässigbar', ref: 'EN 1993-1-1, 5.2.1', note: a >= 10 ? 'erfüllt' : 'nicht erfüllt – Theorie 2. Ordnung massgebend' },
    ];
    crit.c.buckling.lcr.forEach((q, k) => {
      if (!q) return;
      const sp = sectionProps(p.sections[p.members[k].sec - 1]);
      steps.push({ label: `Stab ${k + 1}: Knicklänge`, f: 'N_cr = α_cr·|N|, L_cr = π·sqrt(E·I/N_cr)', v: `N_cr = ${num(a, 2)}·${num(Math.abs(q.N), 1)} = ${num(q.Ncr, 0)} kN; L_cr = π·sqrt(${num(sp.E * sp.I, 0)}/${num(q.Ncr, 0)})`, r: `= ${num(q.Lcr, 2)} m (β = ${num(q.beta, 2)})` });
    });
    out.push({ id: 'stabil', title: 'Stabilität und Knicklängen', ref: 'lineare Stabilitätsanalyse', steps, result: { eta: 1 / a, text: `α_cr = ${num(a, 2)}${a >= 1 ? ' > 1' : ' < 1 – instabil'}` } });
  }
  return out;
}
