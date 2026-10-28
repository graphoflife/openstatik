// Lineare Algebra für Rechenkerne (DOM-frei)

/** n×m-Matrix als Array von Float64Array-Zeilen. */
export function matrix(n, m = n) {
  return Array.from({ length: n }, () => new Float64Array(m));
}

export function identity(n) {
  const A = matrix(n);
  for (let i = 0; i < n; i++) A[i][i] = 1;
  return A;
}

export function matMul(A, B) {
  const n = A.length, k = B.length, m = B[0].length;
  const C = matrix(n, m);
  for (let i = 0; i < n; i++) {
    const Ai = A[i], Ci = C[i];
    for (let p = 0; p < k; p++) {
      const a = Ai[p];
      if (a === 0) continue;
      const Bp = B[p];
      for (let j = 0; j < m; j++) Ci[j] += a * Bp[j];
    }
  }
  return C;
}

export function matVec(A, x) {
  const n = A.length, y = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; const Ai = A[i]; for (let j = 0; j < x.length; j++) s += Ai[j] * x[j]; y[i] = s; }
  return y;
}

export function transpose(A) {
  const n = A.length, m = A[0].length, T = matrix(m, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) T[j][i] = A[i][j];
  return T;
}

/** Tᵀ·K·T für Koordinatentransformationen. */
export function tripleProduct(T, K) {
  return matMul(transpose(T), matMul(K, T));
}

/**
 * Löst A·x = b (Gauss mit Spaltenpivotsuche). A und b werden nicht verändert.
 * b kann ein Vektor oder eine Liste von Vektoren sein. Wirft bei Singularität.
 */
export function solve(A, b) {
  const n = A.length;
  const M = A.map((r) => Float64Array.from(r));
  const multi = Array.isArray(b[0]) || b[0] instanceof Float64Array;
  const B = multi ? b.map((v) => Float64Array.from(v)) : [Float64Array.from(b)];
  let scale = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) scale = Math.max(scale, Math.abs(M[i][j]));
  const tol = 1e-13 * (scale || 1);
  const perm = Array.from({ length: n }, (_, i) => i);
  for (let k = 0; k < n; k++) {
    let p = k, best = Math.abs(M[k][k]);
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > best) { best = Math.abs(M[i][k]); p = i; }
    if (best <= tol) throw new SingularError(k);
    if (p !== k) { [M[p], M[k]] = [M[k], M[p]]; [perm[p], perm[k]] = [perm[k], perm[p]]; for (const v of B) { const t = v[p]; v[p] = v[k]; v[k] = t; } }
    const Mk = M[k], piv = Mk[k];
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / piv;
      if (f === 0) continue;
      const Mi = M[i];
      for (let j = k; j < n; j++) Mi[j] -= f * Mk[j];
      for (const v of B) v[i] -= f * v[k];
    }
  }
  for (const v of B) {
    for (let i = n - 1; i >= 0; i--) {
      let s = v[i];
      const Mi = M[i];
      for (let j = i + 1; j < n; j++) s -= Mi[j] * v[j];
      v[i] = s / Mi[i];
    }
  }
  return multi ? B : B[0];
}

export class SingularError extends Error {
  constructor(index) {
    super(`Gleichungssystem singulär (Freiheitsgrad ${index}). Das System ist kinematisch – Lagerung oder Gelenke prüfen.`);
    this.index = index;
  }
}

/** Determinante über LU (für kleine Matrizen). */
export function det(A) {
  const n = A.length, M = A.map((r) => Float64Array.from(r));
  let d = 1;
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    if (M[p][k] === 0) return 0;
    if (p !== k) { [M[p], M[k]] = [M[k], M[p]]; d = -d; }
    d *= M[k][k];
    for (let i = k + 1; i < n; i++) { const f = M[i][k] / M[k][k]; for (let j = k; j < n; j++) M[i][j] -= f * M[k][j]; }
  }
  return d;
}

export function invert(A) {
  const n = A.length;
  const cols = solve(A, Array.from({ length: n }, (_, i) => { const e = new Float64Array(n); e[i] = 1; return e; }));
  const inv = matrix(n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) inv[i][j] = cols[j][i];
  return inv;
}

// ------------------------------------------------------------------ Skyline-Speicher (symmetrisch, positiv definit)

/**
 * Symmetrische Matrix im Skyline-Format (unteres Dreieck zeilenweise, ab erster Nicht-Null-Spalte).
 * Verwendung:
 *   const K = new SkylineMatrix(n, firstCol);   // firstCol[i] = kleinster Spaltenindex mit Eintrag in Zeile i
 *   K.add(i, j, v) …                            // beliebige (i,j); nur unteres Dreieck wird gespeichert
 *   K.factor(); const x = K.solve(b);
 */
export class SkylineMatrix {
  constructor(n, firstCol) {
    this.n = n;
    this.first = Int32Array.from(firstCol);
    this.ptr = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.ptr[i + 1] = this.ptr[i] + (i - this.first[i] + 1);
    this.a = new Float64Array(this.ptr[n]);
    this.factored = false;
  }

  /** Erzeugt die Skyline aus Elementinzidenzen (Liste von Freiheitsgrad-Arrays). */
  static fromElements(n, elementDofs) {
    const first = Int32Array.from({ length: n }, (_, i) => i);
    for (const dofs of elementDofs) {
      let mn = Infinity;
      for (const d of dofs) if (d >= 0 && d < mn) mn = d;
      for (const d of dofs) if (d >= 0 && mn < first[d]) first[d] = mn;
    }
    return new SkylineMatrix(n, first);
  }

  idx(i, j) { // i ≥ j
    return this.ptr[i] + (j - this.first[i]);
  }

  add(i, j, v) {
    if (i < j) { const t = i; i = j; j = t; }
    if (j < this.first[i]) { if (v !== 0) throw new Error('Skyline: Eintrag ausserhalb des Profils'); return; }
    this.a[this.idx(i, j)] += v;
  }

  get(i, j) {
    if (i < j) { const t = i; i = j; j = t; }
    if (j < this.first[i]) return 0;
    return this.a[this.idx(i, j)];
  }

  /** Elementmatrix ke (dicht) mit Freiheitsgraden dofs einbauen; negative dofs werden übersprungen. */
  assemble(ke, dofs) {
    const m = dofs.length;
    for (let p = 0; p < m; p++) {
      const i = dofs[p];
      if (i < 0) continue;
      for (let q = 0; q < m; q++) {
        const j = dofs[q];
        if (j < 0 || j > i) continue;
        this.a[this.idx(i, j)] += ke[p][q];
      }
    }
  }

  /** Matrix-Vektor-Produkt (vor der Faktorisierung). */
  mul(x) {
    const n = this.n, y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const f = this.first[i], base = this.ptr[i] - f;
      for (let j = f; j < i; j++) { const v = this.a[base + j]; y[i] += v * x[j]; y[j] += v * x[i]; }
      y[i] += this.a[base + i] * x[i];
    }
    return y;
  }

  /** LDLᵀ-Zerlegung in-place. Wirft SingularError bei nicht positiv definiter Matrix. */
  factor() {
    const n = this.n, a = this.a, ptr = this.ptr, first = this.first;
    let maxDiag = 0;
    for (let i = 0; i < n; i++) maxDiag = Math.max(maxDiag, Math.abs(a[ptr[i] + i - first[i]]));
    const tol = 1e-11 * (maxDiag || 1);
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const fi = first[i], bi = ptr[i] - fi;
      // l_ij·d_j für j < i
      for (let j = fi; j < i; j++) {
        const fj = first[j], bj = ptr[j] - fj;
        const k0 = Math.max(fi, fj);
        let s = a[bi + j];
        for (let k = k0; k < j; k++) s -= a[bi + k] * a[bj + k];
        a[bi + j] = s; // vorerst u_ij = l_ij·d_j
      }
      let dii = a[bi + i];
      for (let j = fi; j < i; j++) {
        const u = a[bi + j];
        const l = u / d[j];
        dii -= u * l;
        a[bi + j] = l;
      }
      if (!(Math.abs(dii) > tol)) throw new SingularError(i);
      d[i] = dii;
      a[bi + i] = dii;
    }
    this.d = d;
    this.factored = true;
    this.negativePivots = d.reduce((c, v) => c + (v < 0 ? 1 : 0), 0);
    return this;
  }

  solve(b) {
    if (!this.factored) this.factor();
    const n = this.n, a = this.a, ptr = this.ptr, first = this.first;
    const x = Float64Array.from(b);
    for (let i = 0; i < n; i++) { // L·y = b
      const fi = first[i], bi = ptr[i] - fi;
      let s = x[i];
      for (let k = fi; k < i; k++) s -= a[bi + k] * x[k];
      x[i] = s;
    }
    for (let i = 0; i < n; i++) x[i] /= a[ptr[i] + i - first[i]]; // D
    for (let i = n - 1; i >= 0; i--) { // Lᵀ·x = y
      const fi = first[i], bi = ptr[i] - fi;
      const xi = x[i];
      for (let k = fi; k < i; k++) x[k] -= a[bi + k] * xi;
    }
    return x;
  }
}

/**
 * Reverse-Cuthill-McKee-Nummerierung zur Profilreduktion.
 * adjacency: Array von Nachbarlisten (Knotenindizes). Gibt perm zurück mit perm[alt] = neu.
 */
export function rcm(adjacency) {
  const n = adjacency.length;
  const deg = adjacency.map((a) => a.length);
  const visited = new Uint8Array(n);
  const order = [];
  while (order.length < n) {
    // Startknoten: unbesuchter Knoten minimalen Grades (pseudo-peripher via 2 BFS)
    let start = -1;
    for (let i = 0; i < n; i++) if (!visited[i] && (start < 0 || deg[i] < deg[start])) start = i;
    start = farthest(start);
    const queue = [start];
    visited[start] = 1;
    for (let q = 0; q < queue.length; q++) {
      const v = queue[q];
      order.push(v);
      const nb = adjacency[v].filter((w) => !visited[w]).sort((x, y) => deg[x] - deg[y]);
      for (const w of nb) { visited[w] = 1; queue.push(w); }
    }
  }
  function farthest(s) {
    const dist = new Int32Array(n).fill(-1);
    dist[s] = 0;
    const q = [s];
    let last = s;
    for (let k = 0; k < q.length; k++) {
      const v = q[k];
      for (const w of adjacency[v]) if (dist[w] < 0 && !visited[w]) { dist[w] = dist[v] + 1; q.push(w); last = w; }
    }
    return last;
  }
  order.reverse();
  const perm = new Int32Array(n);
  order.forEach((v, i) => { perm[v] = i; });
  return perm;
}

// ------------------------------------------------------------------ Eigenwerte

/**
 * Symmetrisches Eigenwertproblem A·x = λ·x (zyklisches Jacobi-Verfahren).
 * Gibt {values, vectors} aufsteigend sortiert zurück; vectors[k] ist der k-te Eigenvektor.
 */
export function eigSym(A) {
  const n = A.length;
  const a = A.map((r) => Float64Array.from(r));
  const v = identity(n);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const idx = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i][i] - a[j][j]);
  return {
    values: idx.map((i) => a[i][i]),
    vectors: idx.map((i) => Float64Array.from({ length: n }, (_, k) => v[k][i])),
  };
}

/** Cholesky-Zerlegung A = L·Lᵀ (dicht). */
export function cholesky(A) {
  const n = A.length, L = matrix(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= 0) throw new SingularError(i);
        L[i][i] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  }
  return L;
}

/**
 * Verallgemeinertes Eigenwertproblem K·x = λ·M·x mit K symmetrisch, M symmetrisch positiv definit
 * (dicht; für Schwingungen bis einige hundert Freiheitsgrade). Gibt {values, vectors} aufsteigend.
 */
export function eigGeneral(K, M) {
  const n = K.length;
  const L = cholesky(M);
  // Linv
  const Li = matrix(n);
  for (let i = 0; i < n; i++) {
    Li[i][i] = 1 / L[i][i];
    for (let j = 0; j < i; j++) {
      let s = 0;
      for (let k = j; k < i; k++) s -= L[i][k] * Li[k][j];
      Li[i][j] = s / L[i][i];
    }
  }
  const C = matMul(matMul(Li, K), transpose(Li));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const m = (C[i][j] + C[j][i]) / 2; C[i][j] = C[j][i] = m; }
  const { values, vectors } = eigSym(C);
  const LiT = transpose(Li);
  return { values, vectors: vectors.map((y) => matVec(LiT, y)) };
}

/**
 * Kleinster positiver Eigenwert λ von (K + λ·G)·x = 0 (Stabilität, G = geometrische Steifigkeit
 * für Einheitslast), per inverser Iteration mit Verschiebung. K muss positiv definit sein.
 * Gibt {lambda, vector} oder null, wenn kein Stabilitätsversagen unter Druck auftritt.
 */
export function bucklingFactor(K, G) {
  const n = K.length;
  // K·x = μ·(−G)·x → λ = μ. Auf Standardform über Cholesky von K: (−G)·x = (1/μ)·K·x
  const minusG = G.map((r) => Float64Array.from(r, (v) => -v));
  const L = cholesky(K);
  const Li = matrix(n);
  for (let i = 0; i < n; i++) {
    Li[i][i] = 1 / L[i][i];
    for (let j = 0; j < i; j++) {
      let s = 0;
      for (let k = j; k < i; k++) s -= L[i][k] * Li[k][j];
      Li[i][j] = s / L[i][i];
    }
  }
  const C = matMul(matMul(Li, minusG), transpose(Li));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const m = (C[i][j] + C[j][i]) / 2; C[i][j] = C[j][i] = m; }
  const { values, vectors } = eigSym(C);
  // grösster positiver Eigenwert ν = 1/μ → kleinstes μ
  let best = -1;
  for (let i = 0; i < n; i++) if (values[i] > 1e-12 && (best < 0 || values[i] > values[best])) best = i;
  if (best < 0) return null;
  const LiT = transpose(Li);
  return { lambda: 1 / values[best], vector: matVec(LiT, vectors[best]) };
}

// ------------------------------------------------------------------ Hilfen

export function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
export function norm(a) { return Math.sqrt(dot(a, a)); }

/** Nullstelle von f im Intervall [a,b] (Bisektion + Sekante), f(a)·f(b) ≤ 0 vorausgesetzt. */
export function findRoot(f, a, b, tol = 1e-10, maxIter = 200) {
  let fa = f(a), fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) return NaN;
  for (let i = 0; i < maxIter; i++) {
    // Illinois-Variante der Regula falsi mit Bisektionsschutz
    let c = b - fb * (b - a) / (fb - fa);
    if (!(c > Math.min(a, b) && c < Math.max(a, b))) c = (a + b) / 2;
    const fc = f(c);
    if (Math.abs(fc) < 1e-14 || Math.abs(b - a) < tol * (1 + Math.abs(c))) return c;
    if (fc * fb < 0) { a = b; fa = fb; } else { fa /= 2; }
    b = c; fb = fc;
  }
  return (a + b) / 2;
}

/** Lineare Interpolation in einer Tabelle xs (aufsteigend) → ys. */
export function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let i = 1;
  while (xs[i] < x) i++;
  const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + t * (ys[i] - ys[i - 1]);
}

/** Gauss-Legendre-Punkte und -Gewichte auf [-1,1]. */
export const GAUSS = {
  1: [[0], [2]],
  2: [[-0.5773502691896257, 0.5773502691896257], [1, 1]],
  3: [[-0.7745966692414834, 0, 0.7745966692414834], [0.5555555555555556, 0.8888888888888888, 0.5555555555555556]],
  4: [[-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526], [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538]],
};
