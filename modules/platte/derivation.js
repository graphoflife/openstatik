// Herleitung (Rechenweg) der Plattenberechnung: Baustoffe, Steifigkeit, Kombinationen, Gleichgewicht,
// Wood–Armer und Biegebemessung am massgebenden Punkt, Durchstanzen je Stütze, Durchbiegung.
import { num } from '../../js/core/formula.js';
import { woodArmer, requiredAs, momentResistance } from './design.js';
import { comboTypeLabel, layerLabel, defaultCombos, barSuggestion } from './calc.js';

const TYPE_LABEL = { innen: 'Innenstütze', rand: 'Randstütze', ecke: 'Eckstütze' };
const MSD = { innen: ['V_d/8', 1 / 8], rand: ['V_d/4', 1 / 4], ecke: ['V_d/2', 1 / 2] };
const KE = { innen: '0.90', rand: '0.70', ecke: '0.65' };
const n0 = (v) => num(v, 0), n1 = (v) => num(v, 1), n2 = (v) => num(v, 2), n3 = (v) => num(v, 3);

/** Wood–Armer-Schritte für eine Lage am Knoten (mx, my, mxy). */
export function woodArmerSteps(mx, my, mxy, layer) {
  const a = Math.abs(mxy);
  const bottom = layer[0] === 'b';
  const dirX = layer[1] === 'x';
  const own = dirX ? mx : my, other = dirX ? my : mx;
  const o = dirX ? 'x' : 'y', q = dirX ? 'y' : 'x';
  const steps = [];
  const wa = woodArmer(mx, my, mxy);
  const val = wa[layer];
  if (bottom) {
    const first = own + a, second = other + a;
    if (first < 0) {
      steps.push({ label: 'Regelfall ergibt Druck', f: `m_{${o}} + |m_{xy}| < 0`, v: `= ${n1(own)} + ${n1(a)}`, r: `= ${n1(first)} → m_{${o},d} = 0`, note: 'Keine untere Bewehrung in dieser Richtung erforderlich.' });
    } else if (second < 0) {
      steps.push({ label: 'Korrektur (Gegenrichtung ohne untere Bewehrung)', f: `m_{${o},d} = m_{${o}} + m_{xy}^2/|m_{${q}}|`, v: `= ${n1(own)} + ${n1(mxy)}^2/${n1(Math.abs(other))}`, r: `= ${n1(val)} kNm/m` });
    } else {
      steps.push({ label: 'Regelfall', f: `m_{${o},d} = m_{${o}} + |m_{xy}|`, v: `= ${n1(own)} + ${n1(a)}`, r: `= ${n1(val)} kNm/m` });
    }
  } else {
    const first = own - a, second = other - a;
    if (first > 0) {
      steps.push({ label: 'Regelfall ergibt Zug unten', f: `m_{${o}} − |m_{xy}| > 0`, v: `= ${n1(own)} − ${n1(a)}`, r: `= ${n1(first)} → m'_{${o},d} = 0`, note: 'Keine obere Bewehrung in dieser Richtung erforderlich.' });
    } else if (second > 0) {
      steps.push({ label: 'Korrektur (Gegenrichtung ohne obere Bewehrung)', f: `m'_{${o},d} = m_{${o}} − m_{xy}^2/|m_{${q}}|`, v: `= ${n1(own)} − ${n1(mxy)}^2/${n1(Math.abs(other))}`, r: `= ${n1(-val)} kNm/m` });
    } else {
      steps.push({ label: 'Regelfall', f: `m'_{${o},d} = m_{${o}} − |m_{xy}|`, v: `= ${n1(own)} − ${n1(a)}`, r: `= ${n1(-val)} kNm/m` });
    }
  }
  return { steps, value: val };
}

export function derivation(app) {
  const r = app.results;
  if (!r) return [];
  const out = [];
  const c = r.conc, st = r.steel, sia = r.norm === 'SIA';

  // ---------------------------------------------------------------- Baustoffe und Steifigkeit
  const slabs = r.slabs || [{ name: 'Platte', h: r.h, conc: c, D: r.D }];
  const concs = [...new Map(slabs.map((sl) => [sl.conc.name, sl.conc])).values()];
  const matSteps = [];
  for (const cc of concs) {
    const tag = concs.length > 1 ? ` (${cc.name})` : '';
    matSteps.push(
      { label: `Mittelwert der Zylinderdruckfestigkeit${tag}`, f: 'f_{cm} = f_{ck} + 8', v: `= ${n0(cc.fck)} + 8`, r: `= ${n0(cc.fcm)} MPa` },
      sia
        ? { label: `Elastizitätsmodul${tag}`, f: 'E_{cm} = 10 000·f_{cm}^{1/3}', v: `= 10 000·${n0(cc.fcm)}^{1/3}`, r: `= ${n0(cc.Ecm)} MPa`, ref: 'SIA 262, 3.1.2.3' }
        : { label: `Elastizitätsmodul${tag}`, f: 'E_{cm} = 22 000·(f_{cm}/10)^{0.3}', v: `= 22 000·(${n0(cc.fcm)}/10)^{0.3}`, r: `= ${n0(cc.Ecm)} MPa`, ref: 'EN 1992-1-1, Tab. 3.1' },
      sia
        ? { label: `Bemessungswert der Betondruckfestigkeit${tag}`, f: 'f_{cd} = η_{fc}·f_{ck}/γ_c,  η_{fc} = (30/f_{ck})^{1/3} <= 1', v: `= ${n3(cc.etaFc)}·${n0(cc.fck)}/${n2(cc.gammaC)}`, r: `= ${n1(cc.fcd)} MPa`, ref: 'SIA 262, 2.3.2.3' }
        : { label: `Bemessungswert der Betondruckfestigkeit${tag}`, f: 'f_{cd} = α_{cc}·f_{ck}/γ_c', v: `= 1.0·${n0(cc.fck)}/${n2(cc.gammaC)}`, r: `= ${n1(cc.fcd)} MPa`, ref: 'EN 1992-1-1, 3.1.6' },
      sia ? { label: `Bemessungswert der Schubspannungsgrenze${tag}`, f: 'τ_{cd} = 0.3·sqrt(f_{ck})/γ_c', v: `= 0.3·sqrt(${n0(cc.fck)})/${n2(cc.gammaC)}`, r: `= ${n3(cc.tcd)} MPa`, ref: 'SIA 262, 2.3.2.4' } : null,
    );
  }
  matSteps.push({ label: 'Fliessgrenze Betonstahl', f: 'f_{sd} = f_{sk}/γ_s', v: `= ${n0(st.fsk)}/${n2(st.gammaS)}`, r: `= ${n0(st.fsd)} MPa` });
  for (const sl of slabs) {
    const tag = slabs.length > 1 ? ` «${sl.name}»` : '';
    matSteps.push(
      { label: `Biegesteifigkeit${tag}`, f: 'D = E_{cm}·h^3/(12·(1 − ν^2))', v: `= ${n0(sl.conc.Ecm * 1000)}·${n3(sl.h)}^3/(12·(1 − ${n2(r.nu)}^2))`, r: `= ${n0(sl.D)} kNm`, note: 'E in kN/m², h in m.' },
      { label: `Eigengewicht${tag}`, f: 'g_0 = γ_{Beton}·h', v: `= 25·${n3(sl.h)}`, r: `= ${n2(25 * sl.h)} kN/m²` },
    );
  }
  out.push({
    id: 'material', title: slabs.length > 1 ? 'Baustoffe und Steifigkeit je Platte' : 'Baustoffe und Plattensteifigkeit', ref: sia ? 'SIA 262, 2.3 und 3.1' : 'EN 1992-1-1, 3.1–3.2',
    intro: slabs.length > 1
      ? `${slabs.length} Platten: ${slabs.map((sl) => `${sl.name} (h = ${n2(sl.h)} m, ${sl.conc.name})`).join(', ')}. Liegt eine Platte innerhalb einer anderen, gelten dort ihre Dicke und ihr Beton. Linear-elastisch und ungerissen mit E_{cm}.`
      : `Beton ${c.name}, Betonstahl ${st.name}. Die Platte wird linear-elastisch und ungerissen mit E_{cm} gerechnet.`,
    steps: matSteps.filter(Boolean),
  });

  // ---------------------------------------------------------------- Modell
  const q = r.mesh.quality;
  out.push({
    id: 'modell', title: 'Berechnungsmodell', ref: 'Kirchhoff-Platte, DKT-Elemente',
    intro: `Finite Elemente nach Batoz/Bathe/Ho (1980): ${r.mesh.nNodes} Knoten, ${r.mesh.nTri} Dreiecke, ${r.neq} Gleichungen; kleinster Elementwinkel ${n1(q.minAngle)}°.`,
    steps: [
      { label: 'Gleichgewicht am Gesamtsystem', f: 'K · u = F', note: 'Unbekannte je Knoten: w, θ_x = ∂w/∂y, θ_y = −∂w/∂x. Starre Lager werden eliminiert, Einspannungen und Federn als Steifigkeiten eingebaut.' },
      { label: 'Schnittmomente aus den Krümmungen', f: 'm_x = −D·(w_{,xx} + ν·w_{,yy}),  m_y = −D·(w_{,yy} + ν·w_{,xx}),  m_{xy} = −D·(1 − ν)·w_{,xy}', note: 'Positiv = Zug an der Unterseite. Knotenwerte als flächengewichtetes Mittel der angrenzenden Elemente.' },
      { label: 'Auflagerkräfte', f: 'R = F − (K·u)', note: 'an starr gehaltenen Knoten; bei Federn R = k·w.' },
    ],
  });

  // ---------------------------------------------------------------- Kombinationen
  const combos = r.sets.filter((s) => s.kind === 'combo');
  out.push({
    id: 'kombi', title: 'Lastkombinationen', ref: sia ? 'SIA 260, 4.4.3 und 4.4.4' : 'EN 1990, (6.10), (6.16)',
    intro: 'Tragsicherheit: ständige Lasten mit γ_G = 1.35, Leiteinwirkung mit γ_Q = 1.5, Begleiteinwirkungen mit γ_Q·ψ_0. Gebrauchstauglichkeit quasi-ständig mit ψ_2.',
    steps: [
      { label: 'Tragsicherheit', f: 'E_d = γ_G·G_k + γ_Q·Q_{k,1} + Σ γ_Q·ψ_{0,i}·Q_{k,i}' },
      { label: 'quasi-ständig', f: 'E_d = G_k + Σ ψ_{2,i}·Q_{k,i}' },
      ...combos.map((s) => ({ label: `${s.name} (${comboTypeLabel(s.type)})`, f: `E_d = ${s.formula}`, r: `Σ Lasten = ${n1(s.sumF)} kN` })),
      ...r.lcs.filter((l) => l.type === 'Q').map((l) => ({ label: `Beiwerte ${l.name}`, f: `ψ_0 = ${n2(+l.psi0)},  ψ_1 = ${n2(+l.psi1)},  ψ_2 = ${n2(+l.psi2)}` })),
    ],
  });
  void defaultCombos;

  // ---------------------------------------------------------------- Gleichgewicht
  const uls = combos.filter((s) => s.type === 'ULS');
  const eq = uls[0] || r.sets[0];
  if (eq) {
    const dEq = Math.abs(eq.sumR - eq.sumF);
    out.push({
      id: 'gleich', title: 'Gleichgewichtskontrolle', ref: eq.name,
      steps: [
        { label: 'Summe der Lasten', f: 'ΣF = Σ (q·A) + Σ (p·L) + Σ P', r: `= ${n2(eq.sumF)} kN` },
        { label: 'Summe der Auflagerkräfte', f: 'ΣR = Σ R_i', r: `= ${n2(eq.sumR)} kN` },
        { label: 'Abweichung', f: '|ΣR − ΣF|', r: `= ${num(dEq, 4)} kN` },
      ],
      result: { text: dEq <= 1e-6 * Math.max(1, Math.abs(eq.sumF)) ? 'Gleichgewicht erfüllt' : 'Abweichung prüfen' },
    });
  }

  // ---------------------------------------------------------------- Biegebemessung
  const d = r.design;
  if (d) {
    const inp = d.inputs || {};
    for (const k of ['bx', 'by', 'tx', 'ty']) {
      const L = d.layers[k];
      const i = L.node;
      // massgebende Kombination am Knoten
      let gov = uls[0], best = -1;
      for (const s of uls) { const v = woodArmer(s.mx[i], s.my[i], s.mxy[i])[k]; if (v > best) { best = v; gov = s; } }
      const mx = gov.mx[i], my = gov.my[i], mxy = gov.mxy[i];
      const wa = woodArmerSteps(mx, my, mxy, k);
      const md = wa.value;
      const bottom = k[0] === 'b';
      const c0 = bottom ? inp.cBot : inp.cTop, phi = bottom ? inp.dBot : inp.dTop;
      const outer = (bottom ? inp.outerBot : inp.outerTop) === k[1];
      const fcdL = L.fcd ?? d.fcd, hL = L.h ?? r.h;
      const concL = r.slabs?.[L.slabIdx]?.conc || c;
      const ra = requiredAs(md, L.d, fcdL, d.fsd, d.lambda);
      const omega = ra.mu !== undefined ? 1 - Math.sqrt(1 - 2 * ra.mu) : 0;
      const req = L.asReq ?? Math.max(L.asMax, L.asMin);
      const bars = barSuggestion(req);
      const steps = [
        { label: `Schnittmomente am Knoten (x = ${n2(r.mesh.x[i])}, y = ${n2(r.mesh.y[i])} m)`, f: `m_x = ${n1(mx)},  m_y = ${n1(my)},  m_{xy} = ${n1(mxy)} kNm/m`, note: `Kombination ${gov.name}; dieser Knoten ergibt die grösste Biegebewehrung der Lage${(r.slabs?.length || 1) > 1 ? ` (Platte «${L.slab}», h = ${n2(hL)} m)` : ''}.` },
        ...wa.steps,
        outer
          ? { label: 'Statische Höhe (äussere Lage)', f: 'd = h − c − Ø/2', v: `= ${n0(hL * 1000)} − ${n0(c0)} − ${n0(phi)}/2`, r: `= ${n0(L.d)} mm` }
          : { label: 'Statische Höhe (innere Lage)', f: 'd = h − c − 1.5·Ø', v: `= ${n0(hL * 1000)} − ${n0(c0)} − 1.5·${n0(phi)}`, r: `= ${n0(L.d)} mm` },
      ];
      if (md > 0 && ra.ok) {
        steps.push(
          { label: 'Bezogenes Moment', f: 'μ = m_d/(b·d^2·f_{cd})', v: `= ${n1(md)}·10^6/(1000·${n0(L.d)}^2·${n1(fcdL)})`, r: `= ${num(ra.mu, 4)}` },
          { label: 'Mechanischer Bewehrungsgehalt', f: 'ω = 1 − sqrt(1 − 2·μ)', v: `= 1 − sqrt(1 − 2·${num(ra.mu, 4)})`, r: `= ${num(omega, 4)}` },
          { label: 'Druckzonenhöhe', f: `x = ω·d/${n2(d.lambda)}`, v: `= ${num(omega, 4)}·${n0(L.d)}/${n2(d.lambda)}`, r: `= ${n1(ra.x)} mm (x/d = ${n3(ra.xd)})`, note: ra.xd > 0.35 ? 'x/d > 0.35: Verformungsvermögen eingeschränkt – Platte verstärken oder Druckbewehrung prüfen.' : 'x/d ≤ 0.35: ausreichendes Verformungsvermögen.' },
          { label: 'Innerer Hebelarm', f: 'z = d − ω·d/2', v: `= ${n0(L.d)} − ${num(omega, 4)}·${n0(L.d)}/2`, r: `= ${n1(ra.z)} mm` },
          { label: 'Erforderliche Bewehrung', f: 'a_s = m_d/(z·f_{sd})', v: `= ${n1(md)}·10^6/(${n1(ra.z)}·${n0(d.fsd)})`, r: `= ${n0(ra.as)} mm²/m`, ref: sia ? 'SIA 262, 4.3.2' : 'EN 1992-1-1, 6.1' },
        );
      } else if (md > 0) {
        steps.push({ label: 'Biegedruckzone', f: 'μ = m_d/(b·d^2·f_{cd}) >= 0.5', note: 'Der Querschnitt kann das Moment ohne Druckbewehrung nicht aufnehmen – Plattendicke oder Betonsorte erhöhen.' });
      }
      steps.push(L.asMin > 0
        ? { label: 'Mindestbewehrung', f: inp.asMinMode === 'user' ? 'a_{s,min} = ρ_{min}·b·d' : 'a_{s,min} = max(0.26·f_{ctm}/f_{sk}; 0.0013)·b·d', v: inp.asMinMode === 'user' ? `= ${num(inp.rhoMin / 100, 4)}·1000·${n0(L.d)}` : `= max(0.26·${n2(concL.fctm)}/${n0(st.fsk)}; 0.0013)·1000·${n0(L.d)}`, r: `= ${n0(L.asMin)} mm²/m`, ref: 'EN 1992-1-1, 9.2.1.1' }
        : { label: 'Mindestbewehrung', f: 'nicht berücksichtigt' });
      steps.push({ label: 'Gewählte Bewehrung', f: `a_{s,erf} = max(a_s; a_{s,min}) = ${n0(req)} mm²/m`, r: `→ ${bars.label} = ${n0(bars.as)} mm²/m`, note: L.minGoverns ? 'Massgebend ist die Mindestbewehrung (grösster Wert aller Platten).' : '' });
      out.push({
        id: `as-${k}`, title: `Biegebewehrung ${layerLabel(k)}`, ref: 'Wood–Armer',
        intro: 'Bemessungsmomente nach Wood (1968) und Armer (1968) für eine orthogonale x/y-Bewehrung; Umhüllende aller Tragsicherheitskombinationen.',
        steps,
        result: { text: `a_{s,erf} = ${n0(req)} mm²/m → ${bars.label}` },
      });
    }
  }

  // ---------------------------------------------------------------- Durchstanzen
  for (const pc of r.punching || []) {
    if (pc.skip) continue;
    const t = TYPE_LABEL[pc.type];
    const steps = [
      { label: 'Stützenkraft', f: 'V_d = max R (Tragsicherheit)', r: `= ${n1(pc.Vd)} kN`, note: `Kombination ${pc.combo}; ohne Abzug der Last innerhalb des Nachweisschnitts.` },
      { label: 'Mittlere statische Höhe (obere Lagen)', f: 'd = (d_x + d_y)/2', v: `= (${n0(pc.dTx ?? r.design.depths.tx)} + ${n0(pc.dTy ?? r.design.depths.ty)})/2`, r: `= ${n0(pc.d)} mm`, note: (r.slabs?.length || 1) > 1 ? `Platte «${pc.slab}», h = ${n2(pc.hSlab)} m` : '' },
    ];
    if (sia) {
      const [msdF] = MSD[pc.type];
      const fullU = 2 * (pc.b + pc.h) + Math.PI * pc.dv / 1000;
      steps.push(
        { label: 'Wirksame statische Höhe', f: 'd_v = d', r: `= ${n0(pc.dv)} mm` },
        { label: 'Nachweisschnitt im Abstand dᵥ/2 vom Stützenrand', f: 'u_0 = 2·(b + h) + π·d_v', v: `= 2·(${n2(pc.b)} + ${n2(pc.h)}) + π·${n3(pc.dv / 1000)}`, r: `= ${n3(fullU)} m`, ref: 'SIA 262, 4.3.6.2' },
        Math.abs(pc.u - pc.uFull) > 1e-3
          ? { label: 'Wirksamer Anteil', f: 'u = u_0 − unwirksame Teile', r: `= ${n3(pc.u)} m`, note: 'Teile ausserhalb der Platte und im Schatten von Öffnungen (Abstand < 5d) zählen nicht.' }
          : null,
        { label: `Stützentyp: ${t}`, f: `k_e = ${KE[pc.type]}`, ref: 'SIA 262, 4.3.6.2.5', note: 'Vereinfachter Beiwert für die Lastausmitte (regelmässige Spannweiten).' },
        { label: 'Abstand Stützenachse – Momentennullpunkt', f: 'r_s = 0.22·L', v: `x: 0.22·${n2(pc.Lx)},  y: 0.22·${n2(pc.Ly)}`, r: `= ${n3(pc.rsx)} / ${n3(pc.rsy)} m`, note: 'L = Abstand zum nächsten Lager in x- bzw. y-Richtung.' },
        { label: 'Mittleres Moment im Stützstreifen', f: `m_{sd} = ${msdF}`, v: `= ${n1(pc.Vd)}·${n3(MSD[pc.type][1])}`, r: `= ${n1(pc.msd)} kNm/m`, ref: 'SIA 262, (64)–(67)' },
        { label: 'Biegewiderstand (obere Bewehrung)', f: 'm_{Rd} = a_s·f_{sd}·(d − a_s·f_{sd}/(2·f_{cd}))', v: `x: a_s = ${n0(pc.asx.as)} (${pc.asx.label || ''}), y: a_s = ${n0(pc.asy.as)} mm²/m`, r: `= ${n1(pc.mRdx)} / ${n1(pc.mRdy)} kNm/m` },
        { label: 'Plattenrotation', f: 'ψ = 1.5·(r_s/d)·(f_{sd}/E_s)·(m_{sd}/m_{Rd})^{1.5}', v: `x: 1.5·(${n0(pc.rsx * 1000)}/${n0(pc.d)})·(${n0(st.fsd)}/${n0(st.Es)})·(${n1(pc.msd)}/${n1(pc.mRdx)})^{1.5}`, r: `= ${num(pc.res.psiX * 1000, 3)} ‰ (y: ${num(pc.res.psiY * 1000, 3)} ‰)`, ref: 'SIA 262, (59) Näherungsstufe 2' },
        { label: 'Grösstkornbeiwert', f: 'k_g = 48/(16 + D_{max})', v: `= 48/(16 + ${n0(r.design.inputs?.Dmax ?? 32)})`, r: `= ${n3(pc.res.kg)}` },
        { label: 'Beiwert', f: 'k_r = 1/(0.45 + 0.18·ψ·d·k_g) <= 2', v: `= 1/(0.45 + 0.18·${num(pc.res.psi, 5)}·${n0(pc.d)}·${n3(pc.res.kg)})`, r: `= ${n3(pc.res.kr)}`, ref: 'SIA 262, (58)' },
        { label: 'Durchstanzwiderstand ohne Durchstanzbewehrung', f: 'V_{Rd,c} = k_r·τ_{cd}·d_v·k_e·u', v: `= ${n3(pc.res.kr)}·${n3((pc.conc || c).tcd)}·${n0(pc.dv)}·${n2(pc.ke)}·${n0(pc.u * 1000)}·10^{-3}`, r: `= ${n1(pc.VRd)} kN`, ref: 'SIA 262, (57)' },
      );
      if (pc.eta > 1) steps.push({ label: 'Maximaler Widerstand mit Durchstanzbewehrung', f: 'V_{Rd,max} = 2·k_r·τ_{cd}·d_v·k_e·u <= 3.5·τ_{cd}·d_v·k_e·u', r: `= ${n1(pc.res.VRdmax)} kN`, ref: 'SIA 262, 4.3.6.5.7', note: pc.res.possible ? 'V_d ≤ V_{Rd,max}: mit Durchstanzbewehrung möglich.' : 'V_d > V_{Rd,max}: Platte verstärken, Stütze vergrössern oder Stützenkopf vorsehen.' });
      steps.push({ label: 'Nachweis', f: 'η = V_d/V_{Rd,c}', v: `= ${n1(pc.Vd)}/${n1(pc.VRd)}`, r: `= ${n2(pc.eta)}` });
    } else {
      const R = pc.res;
      steps.push(
        { label: 'Kritischer Rundschnitt im Abstand 2d', f: 'u_1 = 2·(b + h) + 2π·2d', r: `= ${n3(pc.u)} m${Math.abs(pc.u - pc.uFull) > 1e-3 ? ` (wirksam, gesamt ${n3(pc.uFull)} m)` : ''}`, ref: 'EN 1992-1-1, 6.4.2' },
        { label: `Stützentyp: ${t}`, f: `β = ${n2(pc.beta)}`, ref: 'EN 1992-1-1, Bild 6.21N' },
        { label: 'Massstabsbeiwert', f: 'k = 1 + sqrt(200/d) <= 2', v: `= 1 + sqrt(200/${n0(pc.d)})`, r: `= ${n3(R.k)}` },
        { label: 'Bewehrungsgrad', f: 'ρ_l = sqrt(ρ_{lx}·ρ_{ly}) <= 0.02', r: `= ${num(pc.rhoL * 100, 3)} %`, note: `obere Bewehrung im Bereich c/2 + 3d: a_s = ${n0(pc.asx.as)} / ${n0(pc.asy.as)} mm²/m` },
        { label: 'Widerstand', f: 'v_{Rd,c} = 0.18/γ_c·k·(100·ρ_l·f_{ck})^{1/3} >= 0.035·k^{1.5}·sqrt(f_{ck})', r: `= ${n3(R.vRdc)} MPa`, ref: 'EN 1992-1-1, (6.47)' },
        { label: 'Einwirkung', f: 'v_{Ed} = β·V_{Ed}/(u_1·d)', v: `= ${n2(pc.beta)}·${n1(pc.Vd)}·10^3/(${n0(pc.u * 1000)}·${n0(pc.d)})`, r: `= ${n3(R.vEd)} MPa`, ref: 'EN 1992-1-1, (6.38)' },
        { label: 'Nachweis', f: 'η = v_{Ed}/v_{Rd,c}', r: `= ${n2(pc.eta)}` },
      );
    }
    out.push({
      id: `p-${pc.name}`, title: `Durchstanzen ${pc.name} (${t})`, ref: sia ? 'SIA 262, 4.3.6' : 'EN 1992-1-1, 6.4',
      steps,
      result: { eta: pc.eta, text: pc.eta <= 1 ? 'Ohne Durchstanzbewehrung erfüllt' : pc.res.possible ? 'Durchstanzbewehrung erforderlich' : 'Nicht erfüllt – Platte verstärken' },
    });
  }

  // ---------------------------------------------------------------- Durchbiegung
  if (r.sls) {
    const s = r.sls;
    out.push({
      id: 'sls', title: 'Durchbiegung', ref: 'SIA 260, Anhang C / SIA 262, 4.4.3',
      intro: `Kombination ${s.combo}; grösste elastische Durchbiegung bei x = ${n2(s.x)}, y = ${n2(s.y)} m.`,
      steps: [
        { label: 'Elastische Durchbiegung (ungerissen)', f: 'w_{el}', r: `= ${n2(s.wEl * 1000)} mm` },
        { label: 'Langzeitwert (Kriechen, Rissbildung)', f: 'w_{∞} = k·w_{el}', v: `= ${n2(s.factor)}·${n2(s.wEl * 1000)}`, r: `= ${n2(s.wLong * 1000)} mm` },
        { label: 'Grenzwert', f: `w_{lim} = L/${n0(s.limit)}`, v: `= ${n0(s.Lspan * 1000)}/${n0(s.limit)}`, r: `= ${n2(s.wLim * 1000)} mm`, note: s.autoSpan ? 'L automatisch: grösste Stützweite zwischen benachbarten Lagern bzw. kürzere Plattenabmessung.' : '' },
        { label: 'Nachweis', f: 'η = w_{∞}/w_{lim}', v: `= ${n2(s.wLong * 1000)}/${n2(s.wLim * 1000)}`, r: `= ${n2(s.eta)}` },
      ],
      result: { eta: s.eta, text: s.eta <= 1 ? 'Durchbiegung eingehalten' : 'Durchbiegung zu gross' },
    });
  }
  return out;
}
