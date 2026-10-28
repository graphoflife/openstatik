// Erddruck: Beiwerte (Rankine, Coulomb/Müller-Breslau, Ruhedruck, Erdwiderstand) und
// geschichtete Erddruckverteilung mit Auflasten, Streifen-/Linienlasten und Wasserdruck (DOM-frei).
//
// Vorzeichen und Konvention (wie DIN 4085):
//  α  Neigung der Wandrückseite gegen die Lotrechte; positiv, wenn der Wandkopf vom Erdreich
//     weg geneigt ist (Erdreich liegt auf der Wand → grösserer Erddruck).
//  β  Geländeneigung, positiv ansteigend vom Wandkopf weg.
//  δ  Wandreibungswinkel (aktiv: Erddruck um δ gegen die Wandnormale nach unten geneigt).
//  Beiwerte K_…h beziehen sich auf die HORIZONTALKOMPONENTE und die lotrechte Projektion der
//  Wand: e_ah(z) = K_agh·σ'_v(z) + K_aqh·q − K_ach·c',  E_ah = ∫ e_ah dz,  E_av = E_ah·tan(α+δ).
//  Die geneigte Resultierende ist K_a = K_agh / cos(α+δ) (z.B. φ=30°, δ=20°: K_a=0.297, K_agh=0.279).
import { rad, deg, layerAt, verticalStress } from './soil.js';

const sin = Math.sin, cos = Math.cos, tan = Math.tan, sqrt = Math.sqrt;

// ------------------------------------------------------------------ Beiwerte

/** Rankine, aktiv (lotrechte Wand, horizontales Gelände): K_a = tan²(45° − φ/2). */
export function kaRankine(phi) { return tan(rad(45 - phi / 2)) ** 2; }

/** Rankine, passiv: K_p = tan²(45° + φ/2). */
export function kpRankine(phi) { return tan(rad(45 + phi / 2)) ** 2; }

/**
 * Erdruhedruckbeiwert (horizontal) nach EN 1997-1, 9.5.2:
 * K_0 = (1 − sin φ')·√OCR, bei geneigtem Gelände K_0,β = K_0·(1 + sin β).
 */
export function k0(phi, ocr = 1, beta = 0) {
  return (1 - sin(rad(phi))) * sqrt(Math.max(1, ocr)) * (1 + sin(rad(beta)));
}

/**
 * Aktiver Erddruck nach Coulomb (ebene Gleitfläche), Formeln nach DIN 4085:
 *  K_agh = cos²(φ−α) / { cos²α·[1 + √( sin(φ+δ)·sin(φ−β) / (cos(α−β)·cos(α+δ)) )]² }
 *  K_ach = 2·cos(α−β)·cos φ·cos(α+δ) / [(1 + sin(φ+α+δ−β))·cos β]
 *  K_aqh = K_agh·cos α·cos β / cos(α−β)
 * Für β > φ existiert keine Lösung (Gelände nicht standfest) → Fehler.
 */
export function coulombActive({ phi, delta = 0, alpha = 0, beta = 0 }) {
  if (beta > phi + 1e-9 && phi > 0) throw new Error(`Geländeneigung β = ${beta}° ist grösser als φ' = ${phi}°: Das Gelände ist so nicht standfest. β verkleinern oder Böschungsnachweis führen.`);
  const p = rad(phi), d = rad(delta), a = rad(alpha), b = rad(beta);
  const arg = phi > 0 ? Math.max(0, sin(p + d) * sin(p - b) / (cos(a - b) * cos(a + d))) : 0;
  const Kagh = cos(p - a) ** 2 / (cos(a) ** 2 * (1 + sqrt(arg)) ** 2);
  const Kach = 2 * cos(a - b) * cos(p) * cos(a + d) / ((1 + sin(p + a + d - b)) * cos(b));
  const Kaqh = Kagh * cos(a) * cos(b) / cos(a - b);
  const theta = activeSlipAngle({ phi, delta, alpha, beta });
  return { Kagh, Kach, Kaqh, Ka: Kagh / cos(a + d), Kav: Kagh * tan(a + d), theta, delta };
}

/**
 * Erdwiderstand nach Coulomb (ebene Gleitfläche); δ_p als Betrag (Wandreibung wirkt nach oben auf
 * den Boden, Erdwiderstand gegen die Normale nach oben geneigt):
 *  K_pgh = cos²(φ+α) / { cos²α·[1 − √( sin(φ+δ_p)·sin(φ+β) / (cos(α−β)·cos(α−δ_p)) )]² }
 *  K_pch = 2·cos(α−β)·cos φ·cos(α−δ_p) / [(1 − sin(φ−α+δ_p+β))·cos β]
 * Für |δ_p| > φ/3 liefert die ebene Gleitfläche unsichere (zu grosse) Werte.
 */
export function coulombPassive({ phi, delta = 0, alpha = 0, beta = 0 }) {
  const p = rad(phi), d = rad(Math.abs(delta)), a = rad(alpha), b = rad(beta);
  const arg = sin(p + d) * sin(p + b) / (cos(a - b) * cos(a - d));
  if (!(arg < 1)) throw new Error('Erdwiderstand nach Coulomb: keine Lösung für diese Winkelkombination (δ_p bzw. β zu gross).');
  const Kpgh = cos(p + a) ** 2 / (cos(a) ** 2 * (1 - sqrt(Math.max(0, arg))) ** 2);
  const Kpch = 2 * cos(a - b) * cos(p) * cos(a - d) / ((1 - sin(p - a + d + b)) * cos(b));
  const Kpqh = Kpgh * cos(a) * cos(b) / cos(a - b);
  return { Kpgh, Kpch, Kpqh, Kp: Kpgh / cos(a - d), delta: Math.abs(delta) };
}

/**
 * Erdwiderstand mit gekrümmter Gleitfläche nach Lancellotta (2002), Géotechnique 52(8):
 *  K_p = cos δ/(1 − sin φ)·[cos δ + √(sin²φ − sin²δ)]·exp(2θ·tan φ),  2θ = arcsin(sin δ/sin φ) + δ
 * (Normalkomponente, lotrechte Wand, horizontales Gelände; untere Schranke, nahe Caquot–Kérisel).
 */
export function lancellottaKp(phi, delta = 0) {
  const p = rad(phi), d = Math.min(rad(Math.abs(delta)), p);
  if (phi <= 0) return 1;
  const t2 = Math.asin(Math.min(1, sin(d) / sin(p))) + d;
  return cos(d) / (1 - sin(p)) * (cos(d) + sqrt(Math.max(0, sin(p) ** 2 - sin(d) ** 2))) * Math.exp(t2 * tan(p));
}

/**
 * Erdwiderstand mit gekrümmter Gleitfläche für beliebige α, β: Lancellotta-Wert, für Wand- und
 * Geländeneigung mit dem Verhältnis der Coulomb-Werte (δ = 0) korrigiert. Kohäsionsanteil
 * konservativ K_pch = 2·√K_pgh.
 */
export function passiveCurved({ phi, delta = 0, alpha = 0, beta = 0 }) {
  const base = lancellottaKp(phi, delta);
  let corr = 1;
  if (alpha !== 0 || beta !== 0) corr = coulombPassive({ phi, delta: 0, alpha, beta }).Kpgh / kpRankine(phi);
  const Kpgh = base * corr;
  const a = rad(alpha), b = rad(beta);
  return { Kpgh, Kpch: 2 * sqrt(Kpgh), Kpqh: Kpgh * cos(a) * cos(b) / cos(a - b), Kp: Kpgh / cos(a - rad(Math.abs(delta))), delta: Math.abs(delta) };
}

// ------------------------------------------------------------------ Gleitkeil (numerisch)

/**
 * Coulomb-Gleitkeil für eine Wand der Höhe H (lotrechte Projektion), Gleitfuge unter θ [°]
 * gegen die Horizontale. Liefert E (Resultierende auf die Wand, geneigt um α+δ) für Raumgewicht
 * gamma, Kohäsion c in der Gleitfuge und eine zusätzliche Vertikallast P im Keil.
 * Wird für die Gleitfugenneigung und Linien-/Streifenlasten verwendet (und in Tests als Referenz).
 */
export function coulombWedge({ phi, delta = 0, alpha = 0, beta = 0, H = 1, gamma = 1, c = 0, P = 0, passive = false }, theta) {
  const a = rad(alpha), b = rad(beta), p = rad(phi), d = rad(delta), t = rad(theta);
  const top = [-H * tan(a), H];
  const det = -cos(t) * sin(b) + cos(b) * sin(t);
  if (Math.abs(det) < 1e-12) return NaN;
  const s = (-top[0] * sin(b) + cos(b) * top[1]) / det;
  const u = (cos(t) * top[1] - top[0] * sin(t)) / det;
  if (s <= 0 || u <= 0) return NaN;
  const Px = s * cos(t), Py = s * sin(t);
  const W = gamma * 0.5 * Math.abs(top[0] * Py - top[1] * Px) + P;
  const tv = [cos(t), sin(t)], n = [-sin(t), cos(t)];
  const sg = passive ? -1 : 1;
  const q = [cos(p) * n[0] + sg * sin(p) * tv[0], cos(p) * n[1] + sg * sin(p) * tv[1]];
  const e = passive ? [cos(a - d), sin(a - d)] : [cos(a + d), sin(a + d)];
  const C = [sg * c * s * tv[0], sg * c * s * tv[1]];
  const bx = -C[0], by = W - C[1];
  const dd = e[0] * q[1] - q[0] * e[1];
  return (bx * q[1] - q[0] * by) / dd;
}

/** Neigung der massgebenden aktiven Gleitfuge ϑ_a [°] (Maximum des Coulomb-Keils, Goldener Schnitt). */
export function activeSlipAngle({ phi, delta = 0, alpha = 0, beta = 0 }) {
  if (phi <= 0) return 45 + alpha / 2;
  const f = (t) => { const E = coulombWedge({ phi, delta, alpha, beta }, t); return Number.isFinite(E) ? E : -Infinity; };
  let lo = Math.max(beta, 0) + 0.01, hi = Math.min(89.99 + alpha, 179);
  // grobe Suche, dann Goldener Schnitt
  let best = lo, bv = -Infinity;
  for (let t = lo; t <= hi; t += 0.5) { const v = f(t); if (v > bv) { bv = v; best = t; } }
  lo = Math.max(lo, best - 0.5); hi = Math.min(hi, best + 0.5);
  const g = (sqrt(5) - 1) / 2;
  let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo), f1 = f(x1), f2 = f(x2);
  for (let i = 0; i < 40; i++) {
    if (f1 > f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = f(x1); }
    else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = f(x2); }
  }
  return (lo + hi) / 2;
}

/**
 * Horizontaler Erddruckzuwachs je Einheit Vertikallast im Gleitkeil mit fester Gleitfuge ϑ:
 * ΔE_ah = P·κ  mit κ = sin(ϑ−φ)·cos(α+δ) / cos(ϑ−φ−α−δ)  (aus dem Krafteck).
 */
export function wedgeLoadFactor({ phi, delta = 0, alpha = 0 }, theta) {
  const t = rad(theta), p = rad(phi), a = rad(alpha), d = rad(delta);
  return Math.max(0, sin(t - p) * cos(a + d) / cos(t - p - a - d));
}

// ------------------------------------------------------------------ Verteilung über die Tiefe

/**
 * Geschichtete Erddruckverteilung über eine lotrechte Wandprojektion von zTop bis zBot.
 * opts:
 *  soil         makeSoil(...)
 *  zTop, zBot   Tiefen der Wandoberkante / Wandunterkante [m] im Schichtsystem
 *  alpha, beta  [°]
 *  kind         'active' | 'increased' | 'atrest' | 'passive'
 *  deltaMode    'ratio' (δ = (δ/φ)·φ je Schicht) | 'beta' (δ = β, Rankine) | 'zero'
 *  passiveMethod 'curved' | 'coulomb',  dpRatio (δ_p/φ)
 *  mu           Erhöhungsfaktor für 'increased': e = e_a + μ·(e_0 − e_a)
 *  ocr          Überkonsolidierungsgrad (Ruhedruck)
 *  q            gleichmässige Auflast [kN/m²] (veränderlich)
 *  loads        [{type:'strip'|'line', p, a, b}] (veränderlich, nur Erddruck aktiv/erhöht/Ruhe)
 *  water        Wasserdruck auf die Wand berücksichtigen
 *  minPressure  Mindesterddruck (K_ah mit φ = 40°) bei kohäsiven Böden
 */
export function earthPressureProfile(opts) {
  const { soil } = opts;
  const zTop = opts.zTop ?? 0, zBot = opts.zBot;
  const H = zBot - zTop;
  if (!(H > 0)) throw new Error('Die Wandhöhe muss grösser als 0 sein.');
  const alpha = opts.alpha || 0, beta = opts.beta || 0;
  const kind = opts.kind || 'active';
  const q = opts.q || 0;
  const mu = opts.mu ?? 0.5;
  const warnings = [];
  if (opts.deltaMode === 'beta' && alpha !== 0) warnings.push('Rankine setzt eine lotrechte Wand voraus; für α ≠ 0 wird Coulomb mit δ = β verwendet.');

  // Beiwerte je Schicht
  const coeffs = new Map();
  const coeff = (L) => {
    if (coeffs.has(L.idx)) return coeffs.get(L.idx);
    const delta = opts.deltaMode === 'beta' ? beta : opts.deltaMode === 'zero' ? 0 : L.dr * L.phi;
    const K = { idx: L.idx, name: L.name, phi: L.phi, c: L.c, delta };
    if (kind === 'passive') {
      const dp = (opts.dpRatio ?? 0) * L.phi;
      const P = opts.passiveMethod === 'coulomb' ? coulombPassive({ phi: L.phi, delta: dp, alpha, beta }) : passiveCurved({ phi: L.phi, delta: dp, alpha, beta });
      Object.assign(K, { Kgh: P.Kpgh, Kch: P.Kpch, Kqh: P.Kpqh, deltaP: dp, tanV: tan(rad(dp - alpha)) });
      if (opts.passiveMethod === 'coulomb' && dp > L.phi / 3 + 1e-9) warnings.push(`${L.name}: δ_p > φ'/3 – die ebene Gleitfläche überschätzt den Erdwiderstand (gekrümmte Gleitfläche wählen).`);
    } else {
      const A = coulombActive({ phi: L.phi, delta, alpha, beta });
      const K0 = k0(L.phi, opts.ocr ?? 1, beta);
      K.Kah = A.Kagh; K.Kach = A.Kach; K.Kaqh = A.Kaqh; K.K0 = K0; K.theta = A.theta;
      if (kind === 'active') Object.assign(K, { Kgh: A.Kagh, Kch: A.Kach, Kqh: A.Kaqh, tanV: tan(rad(alpha + delta)) });
      else if (kind === 'atrest') Object.assign(K, { Kgh: K0, Kch: 0, Kqh: K0, tanV: 0 });
      else Object.assign(K, { Kgh: A.Kagh + mu * (K0 - A.Kagh), Kch: (1 - mu) * A.Kach, Kqh: A.Kaqh + mu * (K0 - A.Kaqh), tanV: (1 - mu) * tan(rad(alpha + delta)) });
      if (opts.minPressure && L.c > 0) K.Kmin = coulombActive({ phi: 40, delta: Math.min(delta, 40 * L.dr), alpha, beta }).Kagh;
    }
    coeffs.set(L.idx, K);
    return K;
  };

  // Streifen- und Linienlasten → Zusatzordinaten Δe(z) (Tiefe ab zTop)
  const strips = [];
  if (kind !== 'passive' && opts.loads?.length) {
    const L0 = layerAt(soil.layers, zTop + 1e-6);
    const K0 = coeff(L0);
    const theta = K0.theta ?? activeSlipAngle({ phi: L0.phi, delta: K0.delta, alpha, beta });
    const kappa = wedgeLoadFactor({ phi: L0.phi, delta: K0.delta, alpha }, theta);
    // Breite des Gleitkeils an der Oberfläche (horizontal, ab Wandkopf)
    const Lw = H * (tan(rad(alpha)) + 1 / tan(rad(theta)));
    const scale = kind === 'active' ? 1 : (K0.Kgh / K0.Kah);
    const tp = tan(rad(L0.phi)), tt = tan(rad(theta));
    for (const ld of opts.loads) {
      const p = Number(ld.p) || 0, a = Math.max(0, Number(ld.a) || 0), b = Math.max(0, Number(ld.b) || 0);
      if (p === 0) continue;
      if (ld.type === 'line') {
        if (a >= Lw) { strips.push({ ...ld, dE: 0, z1: 0, z2: 0, note: 'ausserhalb Gleitkeil' }); continue; }
        const dE = p * kappa * scale;
        let z1 = a * tp, z2 = a * tt;
        if (z2 - z1 < 0.1 * H) z2 = z1 + 0.1 * H;
        strips.push({ ...ld, type: 'line', dE, z1, z2, shape: 'tri', emax: 2 * dE / (z2 - z1) });
      } else {
        const bEff = Math.max(0, Math.min(a + b, Lw) - a);
        if (bEff <= 0) { strips.push({ ...ld, dE: 0, z1: 0, z2: 0, note: 'ausserhalb Gleitkeil' }); continue; }
        const dE = p * bEff * kappa * scale;
        const z1 = a * tp, z2 = Math.max(z1 + 0.05 * H, (a + bEff) * tt);
        strips.push({ ...ld, type: 'strip', dE, z1, z2, shape: 'rect', emax: dE / (z2 - z1) });
      }
    }
  }
  const stripAt = (zr) => {
    let s = 0;
    for (const st of strips) {
      if (!st.dE || zr < st.z1 - 1e-9 || zr > st.z2 + 1e-9) continue;
      s += st.shape === 'tri' ? st.emax * (st.z2 - zr) / (st.z2 - st.z1) : st.emax;
    }
    return s;
  };

  // Stützstellen
  const breaks = new Set([zTop, zBot]);
  for (const l of soil.layers) if (l.z > zTop && l.z < zBot) breaks.add(l.z);
  if (soil.zw > zTop && soil.zw < zBot) breaks.add(soil.zw);
  for (const st of strips) for (const zz of [st.z1, st.z2]) { const z = zTop + zz; if (z > zTop && z < zBot) breaks.add(z); }
  const bk = [...breaks].sort((a, b) => a - b);

  const evalAt = (z, L) => {
    const K = coeff(L);
    const { svp, u } = verticalStress(soil, z, zTop, 0);
    const dz = z - zTop;
    let eG, eQ;
    if (kind === 'passive') {
      eG = K.Kgh * svp + K.Kch * L.c;
      eQ = K.Kqh * q;
    } else {
      const raw = K.Kgh * svp - K.Kch * L.c;
      eG = Math.max(0, raw);
      let tot = Math.max(0, raw + K.Kqh * q + stripAt(dz));
      if (K.Kmin !== undefined) {
        const emin = K.Kmin * (svp + q);
        if (eG < K.Kmin * svp) eG = K.Kmin * svp;
        if (tot < emin) tot = emin;
      }
      eQ = Math.max(0, tot - eG);
    }
    return { z, eh: eG + eQ, ehG: eG, ehQ: eQ, u: opts.water ? u : 0, svp, layerIdx: L.idx, tanV: K.tanV };
  };

  const pts = [];
  for (let i = 0; i < bk.length - 1; i++) {
    const a = bk[i], b = bk[i + 1];
    if (b - a < 1e-9) continue;
    const L = layerAt(soil.layers, (a + b) / 2);
    const n = Math.max(6, Math.ceil((b - a) / H * 120));
    for (let k = 0; k <= n; k++) pts.push(evalAt(a + (b - a) * k / n, L));
  }

  // Integration (Trapez, Sprünge durch doppelte Stützstellen)
  let Eh = 0, EhG = 0, EhQ = 0, Ev = 0, EvG = 0, M = 0, MG = 0, MQ = 0, U = 0, MU = 0;
  const mom = (a, b, za, zb) => (zb - za) * (a * (2 * za + zb) + b * (za + 2 * zb)) / 6;
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1], dz = B.z - A.z;
    if (dz <= 0) continue;
    const e = (A.eh + B.eh) / 2;
    Eh += e * dz; EhG += (A.ehG + B.ehG) / 2 * dz; EhQ += (A.ehQ + B.ehQ) / 2 * dz;
    Ev += e * dz * A.tanV; EvG += (A.ehG + B.ehG) / 2 * dz * A.tanV;
    M += mom(A.eh, B.eh, A.z, B.z); MG += mom(A.ehG, B.ehG, A.z, B.z); MQ += mom(A.ehQ, B.ehQ, A.z, B.z);
    U += (A.u + B.u) / 2 * dz;
    MU += mom(A.u, B.u, A.z, B.z);
  }
  const zE = Eh > 0 ? M / Eh : zTop + H * 2 / 3;
  const zEG = EhG > 0 ? MG / EhG : zE, zEQ = EhQ > 0 ? MQ / EhQ : zE;
  const zU = U > 0 ? MU / U : zBot;

  const layers = [];
  for (const K of coeffs.values()) layers.push(K);
  layers.sort((a, b) => a.idx - b.idx);

  // Tiefe der Zugzone (Erddruck = 0 an der Oberfläche infolge Kohäsion)
  let zCrack = 0;
  if (kind !== 'passive') for (const p of pts) { if (p.eh <= 1e-9) zCrack = p.z - zTop; else break; }

  return {
    kind, zTop, zBot, H, alpha, beta, q, pts, layers, strips, warnings,
    Eh, EhG, EhQ, Ev, EvG, EvQ: Ev - EvG, zE, zEG, zEQ, hE: zBot - zE, U, zU, hU: zBot - zU,
    zCrack,
  };
}
