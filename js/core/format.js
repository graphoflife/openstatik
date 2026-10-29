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

// ------------------------------------------------------------------ Tief- und Hochstellung

const SUB_CHARS = '[\\wäöüÄÖÜαβγδεζηθκλμνξρστφχψωΔΣ∞\'′.+−-]';
const SUB_RE = new RegExp(`_\\{([^}]*)\\}|_(${SUB_CHARS.replace('.+−-', '')}+(?:,${SUB_CHARS.replace('.+−-', '')}+)*)|\\^\\{([^}]*)\\}|\\^([-−]?[\\w.]+)`, 'g');

/**
 * Zerlegt eine Bezeichnung in normale, tief- und hochgestellte Teile:
 * "M_Ed,II" → [{t:'n',s:'M'},{t:'sub',s:'Ed,II'}], "h^3" → […,{t:'sup',s:'3'}], "f_{c,d}" → Klammerform.
 */
export function subTokens(str) {
  const s = String(str ?? '');
  const out = [];
  let last = 0;
  SUB_RE.lastIndex = 0;
  for (let m; (m = SUB_RE.exec(s));) {
    if (m.index > last) out.push({ t: 'n', s: s.slice(last, m.index) });
    if (m[1] !== undefined || m[2] !== undefined) out.push({ t: 'sub', s: m[1] ?? m[2] });
    else out.push({ t: 'sup', s: m[3] ?? m[4] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: 'n', s: s.slice(last) });
  return out;
}

/** true, wenn die Bezeichnung Tief- oder Hochstellungen enthält. */
export const hasSub = (str) => typeof str === 'string' && /[_^]/.test(str) && subTokens(str).some((x) => x.t !== 'n');

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Bezeichnung → HTML mit <sub>/<sup>. */
export function subHtml(str) {
  return subTokens(str).map((x) => (x.t === 'n' ? escHtml(x.s) : `<${x.t}>${escHtml(x.s)}</${x.t}>`)).join('');
}

const UNI_SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', ',': ',' };
const UNI_SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻', '−': '⁻', '+': '⁺', n: 'ⁿ', i: 'ⁱ' };

/**
 * Für reinen Text (z.B. <option>): Tief-/Hochstellung mit Unicode-Zeichen, soweit vorhanden;
 * sonst wird der Index ohne Unterstrich angehängt (f_cd → fcd).
 */
export function unicodeSub(str) {
  if (!hasSub(str)) return str;
  return subTokens(str).map((x) => {
    if (x.t === 'n') return x.s;
    const map = x.t === 'sub' ? UNI_SUB : UNI_SUP;
    const chars = [...x.s.toLowerCase()];
    return chars.every((c) => map[c]) ? chars.map((c) => map[c]).join('') : x.s;
  }).join('');
}
