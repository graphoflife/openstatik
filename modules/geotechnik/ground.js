// Bodenmodell mit frei geformten Schichten (DOM-frei)
//
//  soils  Bodenarten (Kennwerte): [{name, gamma, gammaP, phi, c, cu, ME, dr, col}]
//  zones  Flächen (Polygone) mit einer Bodenart: [{soil, ring: [[x, y], …]}]; spätere Zonen liegen oben
//  base   Bodenart ausserhalb aller Zonen («Untergrund»)
//
// Koordinaten: x [m] wie in der Darstellung der Analyse, y [m] relativ zum Bezugsniveau der Analyse
// (Wandkopf, Gelände beim Fundament, Böschungskrone, Mauerkrone), also y = −Tiefe.
// Für Profile und Punktabfragen wird das Modell in senkrechte Streifen zerlegt, in denen die Reihenfolge
// der Polygonkanten konstant ist (Trapezzerlegung): profileAt(x) und soilAt(x, y) sind dadurch schnell.

export const FAR = 1000;   // seitliche Ausdehnung waagrechter Schichten [m]
export const TOP = 50;     // Oberkante der obersten Schicht über dem Bezugsniveau [m]

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);

/** Bodenart prüfen und ergänzen (Raumgewicht unter Auftrieb → γ_sat). */
export function prepareSoil(s, i, gammaW = 10) {
  const L = {
    idx: i, name: s?.name || `Boden ${i + 1}`,
    gamma: num(s?.gamma, 19), gammaP: num(s?.gammaP, 10), phi: num(s?.phi, 0), c: num(s?.c, 0), cu: num(s?.cu, 0),
    ME: num(s?.ME, 10), dr: num(s?.dr, 2 / 3), col: Number(s?.col) || ((i % 8) + 1),
  };
  if (L.gamma <= 0) throw new Error(`Bodenart «${L.name}»: das Raumgewicht γ muss positiv sein.`);
  if (L.gammaP < 0) throw new Error(`Bodenart «${L.name}»: γ' darf nicht negativ sein.`);
  if (L.phi < 0 || L.phi >= 60) throw new Error(`Bodenart «${L.name}»: der Reibungswinkel φ' muss zwischen 0 und 60° liegen.`);
  if (L.c < 0 || L.cu < 0) throw new Error(`Bodenart «${L.name}»: die Kohäsion darf nicht negativ sein.`);
  if (L.ME <= 0) throw new Error(`Bodenart «${L.name}»: der Steifemodul M_E muss positiv sein.`);
  L.gammaSat = L.gammaP + gammaW;
  return L;
}

/**
 * Waagrechte Schichten (Tiefe der Oberkante z) → Bodenarten und Zonen. Die unterste Schicht wird zum
 * Untergrund, die übrigen zu breiten Rechtecken (Breite 2·FAR).
 */
export function layersToGround(layers) {
  const L = [...(layers || [])].map((l, i) => ({ ...l, _i: i })).sort((a, b) => num(a.z, 0) - num(b.z, 0));
  const soils = L.map((l) => { const s = { ...l }; delete s.z; delete s._i; return s; });
  const zones = [];
  for (let i = 0; i < L.length - 1; i++) {
    const top = i === 0 ? TOP : -num(L[i].z, 0), bot = -num(L[i + 1].z, 0);
    if (top - bot > 1e-9) zones.push({ soil: i, ring: [[-FAR, top], [FAR, top], [FAR, bot], [-FAR, bot]] });
  }
  return { soils, zones, base: Math.max(0, L.length - 1) };
}

/** Bodenmodell aus waagrechten Schichten (für Beispiele): [{name, z, gamma, …}] → {soils, zones, base}. */
export const layered = (layers) => layersToGround(layers);

/** Altes Projektformat (soil.layers) in Bodenarten und Zonen überführen (verändert das Objekt). */
export function migrateSoil(soil) {
  if (!soil || soil.soils) return soil;
  const g = layersToGround(soil.layers || []);
  soil.soils = g.soils.length ? g.soils : [{ name: 'Boden', gamma: 20, gammaP: 10, phi: 30, c: 0, cu: 0, ME: 20, dr: 2 / 3, col: 1 }];
  soil.zones = g.zones;
  soil.base = g.base;
  delete soil.layers;
  return soil;
}

// ------------------------------------------------------------------ Geometrie

export function pointInRing([x, y], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

/** Schnittpunkt der Strecken pq und ab: {t (auf pq), u (auf ab), pt} oder null. */
export function segIntersect(p, q, a, b) {
  const r = [q[0] - p[0], q[1] - p[1]], s = [b[0] - a[0], b[1] - a[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-14) return null;
  const t = ((a[0] - p[0]) * s[1] - (a[1] - p[1]) * s[0]) / den;
  const u = ((a[0] - p[0]) * r[1] - (a[1] - p[1]) * r[0]) / den;
  if (t < -1e-12 || t > 1 + 1e-12 || u < -1e-12 || u > 1 + 1e-12) return null;
  return { t, u, pt: [p[0] + t * r[0], p[1] + t * r[1]] };
}

/** Polygon auf ein achsparalleles Rechteck beschneiden (Sutherland–Hodgman). */
export function clipRingToBox(ring, box) {
  let out = ring.slice();
  const planes = [
    [(p) => p[0] >= box.x0, (a, b) => [box.x0, a[1] + (b[1] - a[1]) * (box.x0 - a[0]) / (b[0] - a[0])]],
    [(p) => p[0] <= box.x1, (a, b) => [box.x1, a[1] + (b[1] - a[1]) * (box.x1 - a[0]) / (b[0] - a[0])]],
    [(p) => p[1] >= box.y0, (a, b) => [a[0] + (b[0] - a[0]) * (box.y0 - a[1]) / (b[1] - a[1]), box.y0]],
    [(p) => p[1] <= box.y1, (a, b) => [a[0] + (b[0] - a[0]) * (box.y1 - a[1]) / (b[1] - a[1]), box.y1]],
  ];
  for (const [inside, cut] of planes) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const A = src[i], B = src[(i + 1) % src.length];
      const ia = inside(A), ib = inside(B);
      if (ia) out.push(A);
      if (ia !== ib) out.push(cut(A, B));
    }
    if (!out.length) return null;
  }
  return out.length >= 3 && Math.abs(ringArea(out)) > 1e-9 ? out : null;
}

/**
 * Sichtbare Teile einer Strecke innerhalb eines (beliebigen) Polygons: [[p0, p1, t0, t1], …].
 */
export function clipSegToRing(a, b, ring) {
  const ts = [0, 1];
  for (let i = 0; i < ring.length; i++) {
    const X = segIntersect(a, b, ring[i], ring[(i + 1) % ring.length]);
    if (X) ts.push(Math.min(1, Math.max(0, X.t)));
  }
  ts.sort((u, v) => u - v);
  const at = (t) => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  const parts = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const t0 = ts[i], t1 = ts[i + 1];
    if (t1 - t0 < 1e-9) continue;
    if (!pointInRing(at((t0 + t1) / 2), ring)) continue;
    const last = parts[parts.length - 1];
    if (last && Math.abs(last[3] - t0) < 1e-9) { last[1] = at(t1); last[3] = t1; } else parts.push([at(t0), at(t1), t0, t1]);
  }
  return parts;
}

/** Strecke auf ein Rechteck beschneiden (Liang–Barsky): [a', b', t0, t1] oder null. */
export function clipSegToBox(a, b, box) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const tests = [[-dx, a[0] - box.x0], [dx, box.x1 - a[0]], [-dy, a[1] - box.y0], [dy, box.y1 - a[1]]];
  for (const [p, q] of tests) {
    if (Math.abs(p) < 1e-15) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  if (t1 - t0 < 1e-12) return null;
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy], t0, t1];
}

/**
 * Polygon entlang einer Polylinie teilen. Die Polylinie wird an beiden Enden waagrecht verlängert, damit
 * auch breite Schichten getrennt werden. Rückgabe [ringA, ringB] oder null (keine zwei Schnittpunkte).
 */
export function splitRing(ring, line) {
  if (!line || line.length < 2) return null;
  const ln = line.slice();
  const ltr = ln[ln.length - 1][0] >= ln[0][0];
  ln.unshift([ltr ? -4 * FAR : 4 * FAR, ln[0][1]]);
  ln.push([ltr ? 4 * FAR : -4 * FAR, ln[ln.length - 1][1]]);
  const hits = [];
  for (let s = 0; s < ln.length - 1; s++) {
    const local = [];
    for (let i = 0; i < ring.length; i++) {
      const X = segIntersect(ln[s], ln[s + 1], ring[i], ring[(i + 1) % ring.length]);
      if (X) local.push({ ...X, s, i });
    }
    local.sort((m, n) => m.t - n.t);
    for (const hgt of local) {
      const last = hits[hits.length - 1];
      if (last && Math.hypot(last.pt[0] - hgt.pt[0], last.pt[1] - hgt.pt[1]) < 1e-9) continue;
      hits.push(hgt);
    }
  }
  if (hits.length < 2) return null;
  const [h0, h1] = hits;
  if (h0.i === h1.i) return null;
  const inner = ln.slice(h0.s + 1, h1.s + 1);
  const n = ring.length;
  const walk = (from, to) => { const out = []; for (let k = (from + 1) % n; ; k = (k + 1) % n) { out.push(ring[k]); if (k === to) break; } return out; };
  const A = [h0.pt, ...inner, h1.pt, ...walk(h1.i, h0.i)];
  const B = [h1.pt, ...inner.slice().reverse(), h0.pt, ...walk(h0.i, h1.i)];
  const clean = (r) => r.filter((p, k) => { const q = r[(k + 1) % r.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9; });
  const a = clean(A), b = clean(B);
  if (a.length < 3 || b.length < 3 || Math.abs(ringArea(a)) < 1e-9 || Math.abs(ringArea(b)) < 1e-9) return null;
  return [a, b];
}

// ------------------------------------------------------------------ Modell

const cache = { key: null, value: null };

/**
 * Bodenmodell für Abfragen. input: {soils, zones, base} (oder altes Format {layers}).
 * Rückgabe {soils, zones, base, profileAt(x), soilAt(x, y), layersAt(x), slabs}
 */
export function makeGround(input, gammaW = 10) {
  const key = JSON.stringify([input?.soils, input?.zones, input?.base, input?.layers, gammaW]);
  if (cache.key === key) return cache.value;
  const src = input?.soils ? input : layersToGround(input?.layers || []);
  if (!src.soils?.length) throw new Error('Es ist noch keine Bodenart definiert.');
  const soils = src.soils.map((s, i) => prepareSoil(s, i, gammaW));
  const base = Math.min(Math.max(0, Math.round(num(src.base, 0))), soils.length - 1);
  const zones = [];
  for (const [zi, z] of (src.zones || []).entries()) {
    const ring = (z.ring || []).map((p) => [Number(p[0]), Number(p[1])]).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (ring.length < 3 || Math.abs(ringArea(ring)) < 1e-9) continue;
    const s = Math.round(num(z.soil, base));
    zones.push({ soil: s >= 0 && s < soils.length ? s : base, ring, k: zi });
  }
  const pointSoil = (x, y) => {
    for (let k = zones.length - 1; k >= 0; k--) if (pointInRing([x, y], zones[k].ring)) return zones[k].soil;
    return base;
  };
  // Kanten (nicht senkrecht) und Bruchstellen in x
  const edges = [];
  for (const z of zones) {
    const r = z.ring;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      if (Math.abs(b[0] - a[0]) < 1e-12) continue;
      const [p, q] = a[0] < b[0] ? [a, b] : [b, a];
      edges.push({ x0: p[0], y0: p[1], x1: q[0], y1: q[1], m: (q[1] - p[1]) / (q[0] - p[0]) });
    }
  }
  const xs = new Set();
  for (const e of edges) { xs.add(e.x0); xs.add(e.x1); }
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const A = edges[i], B = edges[j];
    const lo = Math.max(A.x0, B.x0), hi = Math.min(A.x1, B.x1);
    if (hi - lo < 1e-12) continue;
    const dm = A.m - B.m;
    if (Math.abs(dm) < 1e-14) continue;
    const x = (B.y0 - B.m * B.x0 - (A.y0 - A.m * A.x0)) / dm;
    if (x > lo + 1e-12 && x < hi - 1e-12) xs.add(x);
  }
  const X = [...xs].sort((a, b) => a - b);
  const bounds = [-Infinity, ...X, Infinity];
  const yAt = (e, x) => e.y0 + e.m * (x - e.x0);
  const slabs = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i], b = bounds[i + 1];
    const xm = !Number.isFinite(a) ? (Number.isFinite(b) ? b - 1 : 0) : !Number.isFinite(b) ? a + 1 : (a + b) / 2;
    const cross = edges.filter((e) => e.x0 < xm && e.x1 > xm).sort((p, q) => yAt(q, xm) - yAt(p, xm));
    const ys = cross.map((e) => yAt(e, xm));
    const kinds = [];
    for (let j = 0; j <= ys.length; j++) {
      const ym = !ys.length ? 0 : j === 0 ? ys[0] + 1 : j === ys.length ? ys[ys.length - 1] - 1 : (ys[j - 1] + ys[j]) / 2;
      kinds.push(ys.length ? pointSoil(xm, ym) : base);
    }
    slabs.push({ a, b, cross, kinds });
  }
  const slabAt = (x) => {
    let lo = 0, hi = slabs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (slabs[m].a <= x) lo = m; else hi = m - 1; }
    return slabs[lo];
  };
  /** Senkrechtes Profil bei x: [{soil, yTop, yBot}] von oben (yTop = +∞) nach unten (yBot = −∞). */
  const build = (S, x) => {
    const ys = S.cross.map((e) => yAt(e, x));
    const out = [];
    for (let j = 0; j <= ys.length; j++) {
      const yTop = j === 0 ? Infinity : ys[j - 1], yBot = j === ys.length ? -Infinity : ys[j];
      if (yTop - yBot < 1e-9) continue;
      const s = S.kinds[j];
      const last = out[out.length - 1];
      if (last && last.soil === s) last.yBot = yBot; else out.push({ soil: s, yTop, yBot });
    }
    return out;
  };
  // In Streifen mit nur waagrechten Kanten ist das Profil konstant (vorab berechnet, nicht verändern)
  for (const S of slabs) if (S.cross.every((e) => Math.abs(e.m) < 1e-14)) S.fixed = build(S, 0);
  const profileAt = (x) => { const S = slabAt(x); return S.fixed || build(S, x); };
  const soilAt = (x, y) => {
    for (const iv of profileAt(x)) if (y <= iv.yTop && y >= iv.yBot) return soils[iv.soil];
    return soils[base];
  };
  /** Schichten in Tiefenkoordinaten (z = −y) bei x, kompatibel mit soil.js (z, zBot, idx = Bodenart). */
  const layersAt = (x) => profileAt(x).map((iv) => ({ ...soils[iv.soil], z: -iv.yTop, zBot: -iv.yBot }));
  const value = { soils, zones, base, slabs, profileAt, soilAt, layersAt, pointSoil };
  cache.key = key; cache.value = value;
  return value;
}
