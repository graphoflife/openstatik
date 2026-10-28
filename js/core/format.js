// Zahlenformatierung und Zahleneingabe (DOM-frei, auch in Node nutzbar)

/** Formatiert eine Zahl mit fester Anzahl Nachkommastellen; -0 wird zu 0, ungültige Werte zu "–". */
export function fmt(x, digits = 2) {
  if (x === null || x === undefined || typeof x !== 'number' || !Number.isFinite(x)) return '–';
  const s = x.toFixed(digits);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

/** Formatiert mit Einheit, z.B. fmtU(12.345, 'kNm', 1) → "12.3 kNm". */
export function fmtU(x, unit, digits = 2) {
  return unit ? `${fmt(x, digits)} ${unit}` : fmt(x, digits);
}

/** Formatiert mit signifikanten Stellen (für Werte sehr unterschiedlicher Grösse). */
export function fmtSig(x, sig = 3) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return '–';
  if (x === 0) return '0';
  const mag = Math.floor(Math.log10(Math.abs(x)));
  const digits = Math.max(0, sig - 1 - mag);
  if (digits > 6) return x.toExponential(sig - 1);
  return fmt(x, digits);
}

/** Prozent, z.B. fmtPct(0.834) → "83.4 %". */
export function fmtPct(x, digits = 1) {
  return `${fmt(x * 100, digits)} %`;
}

/**
 * Liest eine Zahl aus einer Benutzereingabe. Akzeptiert Dezimalkomma, Hochkomma als
 * Tausendertrennzeichen und einfache Ausdrücke (+ − * / ^ Klammern, sqrt, pi), z.B. "6/2" oder "2*3,5".
 * Gibt NaN zurück, wenn die Eingabe nicht auswertbar ist.
 */
export function parseNum(input) {
  if (typeof input === 'number') return input;
  if (input === null || input === undefined) return NaN;
  let s = String(input).trim().replace(/['’\s]/g, '').replace(/,/g, '.').replace(/−/g, '-').replace(/×/g, '*');
  if (s === '') return NaN;
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return Number(s);
  try {
    const v = evalExpr(s);
    return Number.isFinite(v) ? v : NaN;
  } catch {
    return NaN;
  }
}

// Kleiner rekursiver Parser für arithmetische Ausdrücke (kein eval).
function evalExpr(src) {
  let i = 0;
  const peek = () => src[i];
  const eat = (c) => { if (src[i] === c) { i++; return true; } return false; };
  const FUN = { sqrt: Math.sqrt, sin: (x) => Math.sin(x * Math.PI / 180), cos: (x) => Math.cos(x * Math.PI / 180), tan: (x) => Math.tan(x * Math.PI / 180), abs: Math.abs };
  function primary() {
    if (eat('(')) { const v = sum(); if (!eat(')')) throw new Error(')'); return v; }
    const m = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(src.slice(i));
    if (m) { i += m[0].length; return Number(m[0]); }
    const w = /^[a-z]+/i.exec(src.slice(i));
    if (w) {
      i += w[0].length;
      const name = w[0].toLowerCase();
      if (name === 'pi') return Math.PI;
      if (FUN[name]) { if (!eat('(')) throw new Error('('); const v = sum(); if (!eat(')')) throw new Error(')'); return FUN[name](v); }
    }
    throw new Error('Ausdruck');
  }
  function unary() {
    if (eat('-')) return -unary();
    if (eat('+')) return unary();
    return power();
  }
  function power() {
    const b = primary();
    if (eat('^')) return Math.pow(b, unary());
    return b;
  }
  function product() {
    let v = unary();
    for (;;) {
      if (eat('*')) v *= unary();
      else if (eat('/')) v /= unary();
      else return v;
    }
  }
  function sum() {
    let v = product();
    for (;;) {
      if (eat('+')) v += product();
      else if (eat('-')) v -= product();
      else return v;
    }
  }
  const v = sum();
  if (i !== src.length || peek() !== undefined) throw new Error('Rest');
  return v;
}

/** Rundet auf eine "schöne" Zahl (1, 2, 2.5, 5 × 10^n). */
export function niceNum(x, round = true) {
  if (x <= 0 || !Number.isFinite(x)) return 1;
  const exp = Math.floor(Math.log10(x));
  const f = x / Math.pow(10, exp);
  let nf;
  if (round) nf = f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * Math.pow(10, exp);
}

/** Achseneinteilung: liefert {min, max, step, ticks} für einen Wertebereich. */
export function niceTicks(min, max, maxTicks = 7) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
  if (min === max) { const d = Math.abs(min) * 0.1 || 1; min -= d; max += d; }
  const range = niceNum(max - min, false);
  const step = niceNum(range / Math.max(1, maxTicks - 1), true);
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { min: lo, max: hi, step, ticks };
}

/** Anzahl sinnvoller Nachkommastellen für eine Schrittweite. */
export function decimalsFor(step) {
  if (!Number.isFinite(step) || step <= 0) return 2;
  return Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
}
