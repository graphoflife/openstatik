// Statischer Bericht: druckbares Dokument mit Projektkopf, Abschnitten, Tabellen und Grafiken
import { h, button, downloadText, rich } from './ui.js';
import { fmt } from './format.js';

/**
 * Öffnet den Bericht als Vollbild-Overlay.
 * meta: {title (Modul), subtitle, project:{name, author, date, comment}}
 * sections: [{title, content: Node | String(HTML) | Array}]
 */
export function openReport(meta, sections) {
  const doc = h('article', { class: 'report-doc' });
  const p = meta.project || {};
  doc.append(h('header', { class: 'rep-head' },
    h('div', {}, h('div', { class: 'muted small' }, `OpenStatik · ${meta.title}`), h('h1', {}, p.name || 'Unbenanntes Projekt'), meta.subtitle ? h('div', { class: 'muted' }, meta.subtitle) : null),
    h('div', { class: 'meta' },
      p.author ? h('div', {}, `Bearbeitung: ${p.author}`) : null,
      h('div', {}, `Datum: ${p.date || new Date().toLocaleDateString('de-CH')}`),
      p.number ? h('div', {}, `Projekt-Nr.: ${p.number}`) : null)));
  if (p.comment) doc.append(h('p', {}, p.comment));
  for (const s of sections) {
    if (!s) continue;
    doc.append(h('h2', {}, rich(s.title)));
    const items = Array.isArray(s.content) ? s.content : [s.content];
    for (const c of items) {
      if (c === null || c === undefined) continue;
      if (typeof c === 'string') { const d = h('div'); d.innerHTML = c; doc.append(d); }
      else doc.append(c);
    }
  }
  doc.append(h('footer', { class: 'rep-foot' },
    'Erstellt mit OpenStatik – Rechenergebnisse ohne Gewähr. Die Verantwortung für Eingaben, Modellbildung und Interpretation liegt bei der projektierenden Ingenieurin bzw. beim projektierenden Ingenieur.'));

  const back = h('div', { class: 'report-back' });
  const close = () => { back.remove(); document.body.classList.remove('printing'); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const toolbar = h('div', { class: 'report-toolbar' },
    h('b', {}, 'Bericht'), h('span', { class: 'muted' }, meta.title), h('span', { class: 'spacer' }),
    button('Drucken / PDF', { icon: 'print', primary: true, onClick: () => { document.body.classList.add('printing'); window.print(); setTimeout(() => document.body.classList.remove('printing'), 500); } }),
    button('Als HTML', { icon: 'download', onClick: () => saveHtml(doc, p.name || meta.title) }),
    button('Schliessen', { icon: 'close', onClick: close }));
  back.append(toolbar, doc);
  document.body.append(back);
  document.addEventListener('keydown', onKey);
  back.scrollTop = 0;
  return { close };
}

async function saveHtml(doc, name) {
  let css = '';
  try {
    const link = document.querySelector('link[rel="stylesheet"][href*="app.css"]');
    if (link) css = await (await fetch(link.href)).text();
  } catch { /* offline */ }
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(name)}</title><style>${css}\nbody{background:#eee}</style></head><body>${doc.outerHTML}</body></html>`;
  downloadText(`${name.replace(/[^\w\-äöüÄÖÜ ]+/g, '_')}.html`, html, 'text/html');
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ------------------------------------------------------------------ Bausteine

/** Tabelle für Berichte. headers: Strings oder {label, num, digits}; rows: Arrays. */
export function repTable(headers, rows, opts = {}) {
  const hs = headers.map((x) => (typeof x === 'string' ? { label: x } : x));
  return h('table', { class: 'rt', style: { margin: '4px 0 10px' } },
    opts.caption ? h('caption', {}, opts.caption) : null,
    h('thead', {}, h('tr', {}, hs.map((c) => h('th', { class: c.num ? 'num' : '' }, rich(c.label))))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((v, j) => h('td', { class: typeof v === 'number' || hs[j]?.num ? 'num' : '' }, typeof v === 'number' ? fmt(v, hs[j]?.digits ?? 2) : rich(v) ?? ''))))));
}

/** Schlüssel-Wert-Liste für Berichte. rows: [[label, value, unit, digits]] */
export function repKV(rows) {
  return h('table', { class: 'kv', style: { margin: '4px 0 10px', maxWidth: '520px' } }, h('tbody', {}, rows.filter(Boolean).map(([l, v, u, d]) =>
    h('tr', {}, h('td', {}, rich(l)), h('td', { class: 'val' }, typeof v === 'number' ? fmt(v, d ?? 2) : rich(v) ?? ''), h('td', { class: 'unit' }, rich(u || ''))))));
}

/** Abbildung (SVG-Element) mit Bildunterschrift. */
export function repFigure(svg, caption) {
  return h('figure', { class: 'rep-figure', style: { margin: '8px 0' } }, svg, caption ? h('figcaption', { class: 'muted small', style: { padding: '4px 8px' } }, rich(caption)) : null);
}

/** Formelzeile(n) in Monospace. */
export function repFormula(text) {
  return h('div', { class: 'formula' }, rich(text));
}

export function repP(text) { return h('p', {}, rich(text)); }
