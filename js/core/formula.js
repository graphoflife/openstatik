// Formelsatz und Herleitung (Rechenweg) für alle Module
//
// Herleitung (def.derivation(app)) – Liste von Abschnitten:
//   [{ id, title, ref, intro, steps: [{ label, f, v, r, ref, note }], result: { eta, text } }]
//   f  Formel allgemein          'M_Rd = A_s · f_sd · z'
//   v  eingesetzte Werte         '= 942 · 435 · 0.413 · 10⁻³'
//   r  Ergebnis                  '= 169.5 kNm'
// In Formeln: X_ab bzw. X_{a b} → Index, X^2 bzw. X^{-1} → Hochzahl, sqrt( → √(, * → ·, <= → ≤, >= → ≥.
import { h, rich } from './ui.js';
import { fmt } from './format.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Formel-String → HTML. */
export function fxHtml(src) {
  let s = esc(src ?? '');
  s = s.replace(/&lt;=/g, '≤').replace(/&gt;=/g, '≥').replace(/!=/g, '≠').replace(/-&gt;/g, '→');
  s = s.replace(/sqrt\(/g, '√(').replace(/\s\*\s/g, ' · ').replace(/(\S)\*(\S)/g, '$1·$2');
  s = s.replace(/_\{([^}]*)\}/g, '<sub>$1</sub>');
  s = s.replace(/_([\wäöüÄÖÜαβγδεζηθκλμνξρστφχψω'′]+(?:,[\wäöüαβγδεηθκλμρστφψω'′]+)*)/g, '<sub>$1</sub>');
  s = s.replace(/\^\{([^}]*)\}/g, '<sup>$1</sup>');
  s = s.replace(/\^([-−]?[\w.]+)/g, '<sup>$1</sup>');
  return s;
}

/** Formel-Element. */
export function fx(src, cls = '') {
  const el = h('span', { class: `fx ${cls}`.trim() });
  el.innerHTML = fxHtml(src);
  return el;
}

/** Zahl für Herleitungen: sinnvolle Stellen. */
export function num(x, d) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return '–';
  if (d !== undefined) return fmt(x, d);
  const a = Math.abs(x);
  return fmt(x, a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : a >= 1 ? 3 : 4);
}

function etaBadge(eta) {
  const ok = Number.isFinite(eta) && eta <= 1.0001;
  return h('span', { class: `badge ${ok ? 'ok' : 'fail'}` }, `η = ${Number.isFinite(eta) ? fmt(eta, 2) : '∞'} ${ok ? '✓' : '✕'}`);
}

/** Fliesstext mit Formelzeichen (Indizes/Hochzahlen), aber normaler Schrift. */
function prose(tag, cls, text) {
  const el = h(tag, { class: cls });
  el.innerHTML = fxHtml(text);
  return el;
}

function stepEl(st) {
  return h('div', { class: 'deriv-step' },
    st.label ? h('div', { class: 'deriv-label' }, rich(st.label), st.ref ? h('span', { class: 'deriv-ref' }, rich(st.ref)) : null) : null,
    h('div', { class: 'deriv-line' },
      st.f ? fx(st.f, 'deriv-f') : null,
      st.v ? fx(st.v, 'deriv-v') : null,
      st.r ? fx(st.r, 'deriv-r') : null),
    st.note ? prose('div', 'deriv-note', st.note) : null,
    !st.label && st.ref ? h('div', { class: 'deriv-ref' }, st.ref) : null);
}

/** Zeichnet die Herleitung in den Ergebnisbereich. */
export function renderDerivation(el, sections, app) {
  const list = (sections || []).filter(Boolean);
  el.append(h('div', { class: 'note' }, 'Rechenweg aller Nachweise: allgemeine Formel, eingesetzte Werte und Ergebnis mit Normbezug. Klick auf einen Abschnitt klappt ihn auf oder zu.'));
  if (!list.length) { el.append(h('div', { class: 'placeholder' }, 'Für diesen Stand gibt es noch keine Herleitung.')); return; }
  if (list.length > 2) {
    el.append(h('div', { class: 'deriv-toc' }, list.map((s) => h('button', {
      type: 'button', class: 'deriv-chip', onclick: () => { const t = el.querySelector(`[data-deriv="${CSS.escape(s.id || s.title)}"]`); if (t) { t.open = true; t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
    }, rich(s.title), s.result && Number.isFinite(s.result.eta) ? h('i', { class: s.result.eta <= 1.0001 ? 'ok' : 'fail' }) : null))));
  }
  list.forEach((s, i) => {
    const det = h('details', { class: 'deriv', open: i < 3 || list.length <= 4, dataset: { deriv: s.id || s.title } },
      h('summary', {}, h('span', { class: 'deriv-title' }, rich(s.title)), s.ref ? h('span', { class: 'deriv-ref' }, rich(s.ref)) : null, s.result && s.result.eta !== undefined ? etaBadge(s.result.eta) : null),
      s.intro ? prose('p', 'deriv-intro', s.intro) : null,
      (s.steps || []).filter(Boolean).map(stepEl),
      s.result?.text ? h('div', { class: `deriv-result ${s.result.eta !== undefined && !(s.result.eta <= 1.0001) ? 'fail' : 'ok'}` }, fx(s.result.text)) : null);
    el.append(det);
  });
  void app;
}

/** Abschnitt «Herleitung» für den Bericht. */
export function derivationReport(sections) {
  const content = [];
  for (const s of (sections || []).filter(Boolean)) {
    content.push(h('h3', {}, rich(s.title), s.ref ? [' (', rich(s.ref), ')'] : ''));
    if (s.intro) content.push(prose('p', '', s.intro));
    for (const st of (s.steps || []).filter(Boolean)) {
      content.push(h('div', { class: 'deriv-step rep' },
        st.label ? h('div', { class: 'deriv-label' }, rich(st.label), st.ref ? h('span', { class: 'deriv-ref' }, ' ', rich(st.ref)) : null) : null,
        h('div', { class: 'deriv-line' }, st.f ? fx(st.f, 'deriv-f') : null, st.v ? fx(st.v, 'deriv-v') : null, st.r ? fx(st.r, 'deriv-r') : null),
        st.note ? prose('div', 'deriv-note', st.note) : null));
    }
    if (s.result?.text) content.push(h('div', { class: 'deriv-result rep' }, fx(s.result.text)));
  }
  return { title: 'Herleitung der Berechnung', content };
}
