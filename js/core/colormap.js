// Farbskalen für Ergebnisdarstellungen (t ∈ [0,1])

function lerp(a, b, t) { return a + (b - a) * t; }

function ramp(stops) {
  return (t) => {
    if (!Number.isFinite(t)) return 'rgb(160,160,160)';
    t = Math.min(1, Math.max(0, t));
    const n = stops.length - 1;
    const i = Math.min(n - 1, Math.floor(t * n));
    const f = t * n - i;
    const a = stops[i], b = stops[i + 1];
    return `rgb(${Math.round(lerp(a[0], b[0], f))},${Math.round(lerp(a[1], b[1], f))},${Math.round(lerp(a[2], b[2], f))})`;
  };
}

/** Sequentielle Pastell-Skala (blau → türkis → grün → gelb → apricot → rosé), für Beträge. */
export const sequential = ramp([
  [96, 126, 214], [104, 162, 226], [108, 196, 206], [132, 206, 158], [204, 218, 128], [243, 200, 120], [238, 152, 118], [214, 104, 116],
]);

/** Divergierende Pastell-Skala (blau – weiss – rosé), für vorzeichenbehaftete Werte; t=0.5 ↔ 0. */
export const diverging = ramp([
  [74, 108, 196], [104, 142, 222], [150, 182, 236], [206, 220, 244], [246, 245, 250], [246, 214, 214], [236, 166, 170], [218, 112, 124], [184, 70, 92],
]);

/**
 * Liefert {color(v), t(v), min, max, levels} für einen Wertebereich.
 * symmetric: bei Werten beider Vorzeichen symmetrisch um 0 (divergierende Skala).
 */
export function scaleFor(values, { symmetric = 'auto', steps = 12 } = {}) {
  let min = Infinity, max = -Infinity;
  for (const v of values) if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
  if (!Number.isFinite(min)) { min = 0; max = 1; }
  const sym = symmetric === 'auto' ? min < 0 && max > 0 : symmetric;
  if (sym) { const a = Math.max(Math.abs(min), Math.abs(max)) || 1; min = -a; max = a; }
  if (max - min < 1e-12) { max = min + 1; }
  const fn = sym ? diverging : sequential;
  const levels = Array.from({ length: steps + 1 }, (_, i) => min + (max - min) * i / steps);
  const t = (v) => (v - min) / (max - min);
  return { min, max, levels, t, color: (v) => fn(t(v)), colorT: fn, symmetric: sym };
}
