// Geometrische Hilfsfunktionen für das Plattenmodul (DOM-frei)
// Punkte als [x, y] (Meter).

/** Vorzeichenbehaftete Fläche eines Polygons (positiv = Gegenuhrzeigersinn). */
export function signedArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Schwerpunkt eines einfachen Polygons. */
export function polygonCentroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const c = p[0] * q[1] - q[0] * p[1];
    a += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-14) {
    let sx = 0, sy = 0;
    for (const p of poly) { sx += p[0]; sy += p[1]; }
    return [sx / poly.length, sy / poly.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Punkt-in-Polygon (Strahlverfahren). Punkte auf dem Rand liefern ein beliebiges Ergebnis. */
export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Liegt der Punkt im Plattengebiet (innerhalb des Randes, ausserhalb aller Öffnungen)? */
export function inDomain(x, y, outline, holes = []) {
  if (!pointInPolygon(x, y, outline)) return false;
  for (const h of holes) if (pointInPolygon(x, y, h)) return false;
  return true;
}

/** Abstand Punkt–Strecke und Parameter t des Lotfusspunkts. */
export function distPointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx, qy = ay + t * dy;
  return { d: Math.hypot(px - qx, py - qy), t, x: qx, y: qy };
}

/** Kürzester Abstand eines Punktes zum Polygonrand. */
export function distToPolygon(px, py, poly) {
  let best = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const r = distPointSeg(px, py, a[0], a[1], b[0], b[1]);
    if (r.d < best) best = r.d;
  }
  return best;
}

/**
 * Schnitt zweier Strecken p→p2 und q→q2.
 * Liefert {t, u} (Parameter auf beiden Strecken) oder null; bei kollinearer Überlappung {collinear:true}.
 */
export function segIntersect(p, p2, q, q2, tol = 1e-9) {
  const rx = p2[0] - p[0], ry = p2[1] - p[1];
  const sx = q2[0] - q[0], sy = q2[1] - q[1];
  const rl = Math.hypot(rx, ry), sl = Math.hypot(sx, sy);
  if (rl < tol || sl < tol) return null;
  const den = rx * sy - ry * sx;
  const qpx = q[0] - p[0], qpy = q[1] - p[1];
  if (Math.abs(den) <= 1e-12 * rl * sl) {
    // parallel: kollinear?
    const dist = Math.abs(qpx * ry - qpy * rx) / rl;
    if (dist >= tol) return null;
    // Überlappung der Parameterbereiche prüfen
    const t0 = (qpx * rx + qpy * ry) / (rl * rl);
    const t1 = ((q2[0] - p[0]) * rx + (q2[1] - p[1]) * ry) / (rl * rl);
    const lo = Math.min(t0, t1), hi = Math.max(t0, t1), tt = tol / rl;
    return hi < -tt || lo > 1 + tt ? null : { collinear: true };
  }
  const t = (qpx * sy - qpy * sx) / den;
  const u = (qpx * ry - qpy * rx) / den;
  const tt = tol / rl, tu = tol / sl;
  if (t < -tt || t > 1 + tt || u < -tu || u > 1 + tu) return null;
  return { t: Math.max(0, Math.min(1, t)), u: Math.max(0, Math.min(1, u)) };
}

/** Prüft, ob sich ein Polygon selbst schneidet (nicht benachbarte Kanten). */
export function polygonSelfIntersects(poly, tol = 1e-9) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const c = poly[j], d = poly[(j + 1) % n];
      const r = segIntersect(a, b, c, d, tol);
      if (r) return true;
    }
  }
  return false;
}

/**
 * Bereinigt eine Punktliste zu einem Polygon: entfernt ungültige und doppelte
 * aufeinanderfolgende Punkte sowie einen wiederholten Anfangspunkt.
 */
export function cleanPolygon(pts, tol = 1e-9) {
  const out = [];
  for (const p of pts || []) {
    const x = Number(Array.isArray(p) ? p[0] : p?.x), y = Number(Array.isArray(p) ? p[1] : p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const last = out[out.length - 1];
    if (last && Math.hypot(last[0] - x, last[1] - y) < tol) continue;
    out.push([x, y]);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < tol) out.pop();
  return out;
}

export function bboxOf(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** Schnitt einer Strecke mit einem Gebiet: Liste der Teilstrecken [[t0,t1],…] im Gebiet. */
export function clipSegmentToDomain(a, b, outline, holes = []) {
  const ts = [0, 1];
  for (const ring of [outline, ...holes]) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const r = segIntersect(a, b, ring[i], ring[(i + 1) % n]);
      if (r && !r.collinear) ts.push(r.t);
    }
  }
  ts.sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i], t1 = ts[i + 1];
    if (t1 - t0 < 1e-9) continue;
    const tm = (t0 + t1) / 2;
    const x = a[0] + (b[0] - a[0]) * tm, y = a[1] + (b[1] - a[1]) * tm;
    if (inDomain(x, y, outline, holes) || onBoundary(x, y, outline, holes)) {
      if (out.length && Math.abs(out[out.length - 1][1] - t0) < 1e-9) out[out.length - 1][1] = t1;
      else out.push([t0, t1]);
    }
  }
  return out;
}

/** Liegt der Punkt (innerhalb tol) auf dem Rand des Gebietes? */
export function onBoundary(x, y, outline, holes = [], tol = 1e-7) {
  for (const ring of [outline, ...holes]) if (distToPolygon(x, y, ring) < tol) return true;
  return false;
}

/** Dreiecksqualität 4√3·A/(Σl²): 1 = gleichseitig, 0 = entartet. */
export function triQuality(ax, ay, bx, by, cx, cy) {
  const A = ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
  const s = (bx - ax) ** 2 + (by - ay) ** 2 + (cx - bx) ** 2 + (cy - by) ** 2 + (ax - cx) ** 2 + (ay - cy) ** 2;
  return s > 0 ? 4 * Math.sqrt(3) * A / s : 0;
}

/** Kleinster Innenwinkel eines Dreiecks [°]. */
export function triMinAngle(ax, ay, bx, by, cx, cy) {
  const a = Math.hypot(bx - cx, by - cy), b = Math.hypot(cx - ax, cy - ay), c = Math.hypot(ax - bx, ay - by);
  const ang = (o, p, q) => Math.acos(Math.max(-1, Math.min(1, (p * p + q * q - o * o) / (2 * p * q))));
  return Math.min(ang(a, b, c), ang(b, c, a), ang(c, a, b)) * 180 / Math.PI;
}

// ------------------------------------------------------------------ Gebiet aus mehreren Platten

/** Liegt der Punkt in mindestens einem der Ringe (Vereinigung) und in keiner Öffnung? */
export function inUnion(x, y, outlines, holes = []) {
  let inside = false;
  for (const r of outlines) if (pointInPolygon(x, y, r)) { inside = true; break; }
  if (!inside) return false;
  for (const h of holes) if (pointInPolygon(x, y, h)) return false;
  return true;
}

/** Liegt der Punkt (innerhalb tol) auf dem Rand eines der Ringe? */
export function onAnyRing(x, y, rings, tol = 1e-7) {
  for (const r of rings) if (distToPolygon(x, y, r) < tol) return true;
  return false;
}

/**
 * Freie Ränder der Vereinigung mehrerer Plattenpolygone (ohne Öffnungen): Kanten bzw. Kantenteile,
 * auf deren einer Seite keine Platte liegt. Gemeinsame Kanten benachbarter Platten und Ränder innen
 * liegender Platten (Verstärkungen) sind keine freien Ränder. → [[a, b], …]
 */
export function freeEdges(outlines, holes = [], tol = 1e-7) {
  const out = [];
  const L = Math.max(1, ...outlines.flat().map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1]))));
  const eps = 1e-5 * L;
  for (const r of outlines) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < tol) continue;
      // an Eckpunkten anderer Platten unterteilen
      const ts = [0, 1];
      for (const o of outlines) {
        if (o === r) continue;
        for (const q of o) {
          const d = distPointSeg(q[0], q[1], a[0], a[1], b[0], b[1]);
          if (d.d < tol && d.t > 1e-9 && d.t < 1 - 1e-9) ts.push(d.t);
        }
      }
      ts.sort((p, q) => p - q);
      const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
      for (let k = 0; k + 1 < ts.length; k++) {
        if (ts[k + 1] - ts[k] < 1e-9) continue;
        const tm = (ts[k] + ts[k + 1]) / 2;
        const mx = a[0] + (b[0] - a[0]) * tm, my = a[1] + (b[1] - a[1]) * tm;
        const s1 = inUnion(mx + nx * eps, my + ny * eps, outlines, []);
        const s2 = inUnion(mx - nx * eps, my - ny * eps, outlines, []);
        if (s1 !== s2) {
          out.push([[a[0] + (b[0] - a[0]) * ts[k], a[1] + (b[1] - a[1]) * ts[k]], [a[0] + (b[0] - a[0]) * ts[k + 1], a[1] + (b[1] - a[1]) * ts[k + 1]]]);
        }
      }
    }
  }
  void holes;
  return out;
}

/** Bounding Box mehrerer Ringe. */
export function bboxOfRings(rings) {
  return bboxOf(rings.flat());
}
