// Anwendungsrahmen aller Module: Kopfzeile, Eingabe, Grafik, Ergebnisse, Statuszeile,
// Speichern/Öffnen, Beispiele, Rückgängig, Bericht, Hell/Dunkel.
//
// Moduldefinition:
// createApp({
//   id, title, subtitle,                       – id dient als Speicherschlüssel und Dateiendung
//   defaultProject: () => ({…}),               – neues Projekt (meta wird ergänzt)
//   examples: [{name, desc, project: () => ({…})}],
//   migrate?(project) → project,               – ältere Dateien anpassen
//   inputTabs: [{id, label, render(el, app)}],
//   viewModes?: [{id, label, needsResults}] | (app) => […],
//   viewOptions?: [{key, label, type:'check'|'range'|'select', default, min, max, step, options}],
//   renderView(view, app, mode),               – zeichnet in SvgView (view.finish() ruft der Rahmen auf)
//   onViewClick?(x, y, app, ev),
//   autoCompute?: true,                        – nach jeder Änderung automatisch (entprellt) rechnen
//   compute(project, app) → results,           – darf Error werfen; Meldung wird angezeigt
//   renderResults(el, app),
//   report?(app) → [{title, content}],
//   help?: HTML-String,
// })
import { h, clear, button, icon, dropdown, segmented, tabs, textField, toast, modal, downloadText, pickFile, clone, checkField, rangeField, selectField, subscriptify, rich } from './ui.js';
import { SvgView } from './svgview.js';
import { openReport } from './report.js';
import { createEditor } from './editor.js';
import { renderDerivation, derivationReport } from './formula.js';

/**
 * Fehler für unvollständige Eingaben (z.B. leeres Projekt). Wird nicht als Fehler, sondern als
 * freundlicher Hinweis angezeigt: throw new IncompleteInput('Zeichnen Sie zuerst …').
 */
export class IncompleteInput extends Error {
  constructor(msg, hint) { super(msg); this.incomplete = true; this.hint = hint; }
}
import { fmt } from './format.js';

const LOGO = '<svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="6" fill="var(--accent)"/><path d="M5 17.5h14M5 17.5L12 6.5l7 11M12 6.5v11M8.5 12h7" stroke="#fff" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const store = {
  get(k) { try { return localStorage.getItem('openstatik.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('openstatik.' + k, v); } catch { /* privat/voll */ } },
};

export function applyTheme() {
  const t = store.get('theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t) return t === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export function themeButton(onChange) {
  const btn = button('', { icon: isDark() ? 'sun' : 'moon', ghost: true, title: 'Hell/Dunkel umschalten' });
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    store.set('theme', next);
    applyTheme();
    btn.replaceChildren(icon(isDark() ? 'sun' : 'moon'));
    onChange?.();
  });
  return btn;
}

function newMeta() {
  return { name: 'Neues Projekt', author: '', number: '', date: new Date().toLocaleDateString('de-CH'), comment: '' };
}

export function createApp(def) {
  applyTheme();
  const urlTheme = new URLSearchParams(location.search).get('theme');
  if (urlTheme === 'dark' || urlTheme === 'light') document.documentElement.dataset.theme = urlTheme;
  document.body.classList.add('app');
  document.title = `${def.title} · OpenStatik`;

  const app = {
    def,
    project: null,
    results: null,
    stale: true,
    error: null,
    viewMode: null,
    viewOpts: {},
    selection: null,
    undoStack: [],
    redoStack: [],
  };
  if (Array.isArray(def.viewOptions)) for (const o of def.viewOptions) app.viewOpts[o.key] = o.default;
  try { Object.assign(app.viewOpts, JSON.parse(store.get(`${def.id}.viewOpts`) || '{}')); } catch { /* ignore */ }

  // ---------------------------------------------------------------- Layout
  const statusMsg = h('span', { class: 'status-msg' }, 'Bereit');
  const statusRight = h('span', { class: 'muted' });
  const cursor = h('span', { class: 'cursor' });
  const statusHint = h('span', { class: 'status-hint' });
  const undoBtn = button('', { icon: 'undo', ghost: true, title: 'Rückgängig (Ctrl+Z)', onClick: () => undo() });
  const redoBtn = button('', { icon: 'redo', ghost: true, title: 'Wiederholen (Ctrl+Y)', onClick: () => redo() });
  const computeBtn = def.autoCompute ? null : button('Berechnen', { icon: 'play', primary: true, title: 'Berechnen (Ctrl+Enter)', onClick: () => app.compute() });

  const topbar = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '../../index.html', title: 'Zur Übersicht', html: `${LOGO}<span>OpenStatik</span>` }),
    h('div', { class: 'module-title' }, h('b', {}, def.title), h('span', {}, def.subtitle || '')),
    h('div', { class: 'spacer' }),
    h('nav', { class: 'menu' },
      button('Neu', { icon: 'new', ghost: true, title: 'Neues Projekt', onClick: () => newProject() }),
      button('Öffnen', { icon: 'open', ghost: true, title: 'Projektdatei öffnen', onClick: () => openProject() }),
      button('Speichern', { icon: 'save', ghost: true, title: 'Projekt als Datei speichern (Ctrl+S)', onClick: () => saveProject() }),
      def.examples?.length ? dropdown('Beispiele', () => def.examples.map((ex) => ({ label: ex.name, desc: ex.desc, onClick: () => loadExample(ex) })), { icon: 'examples', ghost: true }) : null,
      h('span', { style: { width: '1px', height: '20px', background: 'var(--border)', margin: '0 4px' } }),
      undoBtn, redoBtn,
      h('span', { style: { width: '1px', height: '20px', background: 'var(--border)', margin: '0 4px' } }),
      computeBtn,
      def.report ? button('Bericht', { icon: 'report', title: 'Statischen Bericht erstellen', onClick: () => showReport() }) : null,
      button('', { icon: 'panelRight', ghost: true, title: 'Ergebnisbereich ein-/ausblenden', onClick: () => toggleResults() }),
      def.help || def.intro ? button('', { icon: 'help', ghost: true, title: 'Hilfe und Anleitung', onClick: () => showHelp() }) : null,
      themeButton(() => renderView())));

  const inputPanel = h('aside', { class: 'panel input-panel', 'aria-label': 'Eingabe' });
  const resultPanel = h('aside', { class: 'panel result-panel', 'aria-label': 'Ergebnisse' });
  const canvas = h('div', { class: 'view-canvas' });
  const viewEmpty = h('div', { class: 'view-empty hidden' });
  const viewToolbar = h('div', { class: 'view-toolbar' });
  const floatCtl = h('div', { class: 'view-float' },
    button('', { icon: 'zoomIn', title: 'Vergrössern', onClick: () => app.view.zoom(1.3) }),
    button('', { icon: 'zoomOut', title: 'Verkleinern', onClick: () => app.view.zoom(1 / 1.3) }),
    button('', { icon: 'fit', title: 'Einpassen (Doppelklick)', onClick: () => app.view.fit() }),
    button('', { icon: 'image', title: 'Grafik als SVG exportieren', onClick: () => exportSvg() }));
  canvas.append(viewEmpty, floatCtl);
  const viewport = h('section', { class: 'viewport', 'aria-label': 'Grafik' }, viewToolbar, canvas);
  const split1 = h('div', { class: 'splitter', title: 'Breite anpassen' });
  const split2 = h('div', { class: 'splitter', title: 'Breite anpassen' });
  const workspace = h('main', { class: 'workspace' }, inputPanel, split1, viewport, split2, resultPanel);
  const statusbar = h('footer', { class: 'statusbar' }, statusMsg, statusHint, statusRight, cursor);
  document.body.append(topbar, workspace, statusbar);

  // Panelbreiten
  const lw = store.get('leftW'), rw = store.get('rightW');
  if (lw) document.documentElement.style.setProperty('--left-w', lw);
  if (rw) document.documentElement.style.setProperty('--right-w', rw);
  if (store.get(`${def.id}.hideResults`) === '1') workspace.classList.add('no-results');
  const dragSplit = (el, side) => {
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      el.classList.add('active');
      const move = (ev) => {
        const r = workspace.getBoundingClientRect();
        if (side === 'left') {
          const w = Math.max(260, Math.min(r.width * 0.5, ev.clientX - r.left));
          document.documentElement.style.setProperty('--left-w', `${w}px`);
        } else {
          const w = Math.max(260, Math.min(r.width * 0.55, r.right - ev.clientX));
          document.documentElement.style.setProperty('--right-w', `${w}px`);
        }
      };
      const up = () => {
        el.classList.remove('active');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        store.set('leftW', getComputedStyle(document.documentElement).getPropertyValue('--left-w').trim());
        store.set('rightW', getComputedStyle(document.documentElement).getPropertyValue('--right-w').trim());
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  };
  dragSplit(split1, 'left');
  dragSplit(split2, 'right');

  app.view = new SvgView(canvas, {
    onCursor: (x, y) => {
      const [ax, ay] = def.editor?.axes || ['x', 'y'];
      cursor.textContent = `${ax} = ${fmt(x, def.editor?.digits ?? 3)}  ${ay} = ${fmt(y, def.editor?.digits ?? 3)}${def.editor?.unit ? ` ${def.editor.unit}` : ''}`;
    },
    onClick: (x, y, ev) => def.onViewClick?.(x, y, app, ev),
    onHover: def.onViewHover ? (x, y, ev) => def.onViewHover(x, y, app, ev) : undefined,
  });

  // ---------------------------------------------------------------- Status
  let lastStatusAt = 0;
  app.status = (msg, kind = '', opts = {}) => {
    statusMsg.replaceChildren(rich(String(msg ?? '')) || '');
    statusMsg.className = `status-msg ${kind}`;
    if (!opts.auto) lastStatusAt = performance.now();
  };
  app.setStatusRight = (text) => { statusRight.textContent = text || ''; };
  app.setHint = (text) => { statusHint.textContent = text || ''; statusHint.title = text || ''; };

  // ---------------------------------------------------------------- Editor
  if (def.editor) {
    createEditor(app, def.editor);
    viewport.insertBefore(app.editor.toolbar, canvas);
    canvas.append(app.editor.panel);
    viewport.classList.add('has-editor');
  }

  // ---------------------------------------------------------------- Projekt
  function withMeta(p) {
    p.meta = { ...newMeta(), ...(p.meta || {}) };
    return p;
  }

  // ---------------------------------------------------------------- Dokument mit Positionen
  // Ein Dokument enthält mehrere Positionen (z.B. mehrere Querschnitte); das Modul sieht in app.project
  // immer nur die aktive Position. Projektangaben (meta) gelten für das ganze Dokument.
  const inst = { label: 'Position', plural: 'Positionen', ...(def.instance || {}) };
  let uidCounter = 0;
  const newId = () => `p${Date.now().toString(36)}${(uidCounter++).toString(36)}`;
  const prep = (p) => (def.migrate ? def.migrate(p) : p);
  const emptyJson = () => { try { return JSON.stringify(prep(def.defaultProject())); } catch { return ''; } };
  const isEmptyProject = (p) => { const c = { ...p }; delete c.meta; return JSON.stringify(c) === emptyJson(); };

  function docFromProject(p, name) {
    const meta = { ...newMeta(), ...(p?.meta || {}) };
    const proj = { ...p }; delete proj.meta;
    return { meta, items: [{ id: newId(), name: name || `${inst.label} 1`, project: proj }], active: 0 };
  }
  function normalizeDoc(doc) {
    doc.meta = { ...newMeta(), ...(doc.meta || {}) };
    doc.items = (doc.items || []).filter((it) => it && it.project);
    if (!doc.items.length) doc.items.push({ id: newId(), name: `${inst.label} 1`, project: def.defaultProject() });
    for (const it of doc.items) { it.id ||= newId(); it.name ||= inst.label; delete it.project.meta; it.project = prep(it.project); }
    doc.active = Math.min(Math.max(0, doc.active | 0), doc.items.length - 1);
    return doc;
  }
  function serializeDoc() {
    return JSON.stringify({ ...app.doc, items: app.doc.items.map((it) => { const pr = { ...it.project }; delete pr.meta; return { ...it, project: pr }; }) });
  }
  const resultCache = new Map();
  function activate(i) {
    const doc = app.doc;
    doc.active = Math.min(Math.max(0, i), doc.items.length - 1);
    const it = doc.items[doc.active];
    app.project = it.project;
    app.project.meta = doc.meta; // gemeinsame Projektangaben
    app.instance = it;
  }
  function cacheResults() {
    const it = app.instance;
    if (it) resultCache.set(it.id, { results: app.results, stale: app.stale, error: app.error, errorIncomplete: app.errorIncomplete, errorHint: app.errorHint });
  }
  function afterSwitch(opts = {}) {
    const c = !opts.fresh && resultCache.get(app.instance.id);
    app.results = c ? c.results : null;
    app.stale = c ? c.stale : true;
    app.error = c ? c.error : null;
    app.errorIncomplete = c ? c.errorIncomplete : false;
    app.errorHint = c ? c.errorHint : null;
    app.selection = null;
    if (app.editor) app.editor.sel = [];
    app.view.modelBounds = null;
    app.view.fitted = false;
    autosave();
    renderInputs();
    if (def.autoCompute && (!c || c.stale || opts.fresh)) app.compute(); else { renderView(); renderResults(); }
    updateUndo();
  }

  /** Ganzes Dokument ersetzen (Öffnen, Neu, Rückgängig). */
  app.setDocument = (doc, opts = {}) => {
    app.doc = normalizeDoc(doc);
    resultCache.clear();
    activate(app.doc.active);
    if (!opts.keepUndo) { app.undoStack = [serializeDoc()]; app.redoStack = []; }
    afterSwitch({ fresh: true });
  };

  /** Projekt der aktiven Position ersetzen (z.B. Beispiel laden). */
  app.setProject = (p, opts = {}) => {
    if (!app.doc) { app.setDocument(docFromProject(p, opts.name), opts); return; }
    const proj = { ...p }; delete proj.meta;
    app.instance.project = prep(proj);
    if (opts.name) app.instance.name = opts.name;
    resultCache.delete(app.instance.id);
    activate(app.doc.active);
    if (!opts.keepUndo) pushUndo(true);
    afterSwitch({ fresh: true });
  };

  /** Position wechseln, anlegen, duplizieren, umbenennen, löschen. */
  app.switchInstance = (i) => {
    if (i === app.doc.active) return;
    cacheResults();
    activate(i);
    afterSwitch();
    app.status(`${inst.label} «${app.instance.name}»`);
  };
  app.addInstance = (project, name) => {
    cacheResults();
    const proj = prep(project || def.defaultProject()); delete proj.meta;
    app.doc.items.push({ id: newId(), name: name || nextName(), project: proj });
    activate(app.doc.items.length - 1);
    pushUndo(true);
    afterSwitch({ fresh: true });
  };
  app.duplicateInstance = (i = app.doc.active) => {
    cacheResults();
    const src = app.doc.items[i];
    const proj = JSON.parse(JSON.stringify({ ...src.project, meta: undefined }));
    app.doc.items.splice(i + 1, 0, { id: newId(), name: `${src.name} (Kopie)`, project: prep(proj) });
    activate(i + 1);
    pushUndo(true);
    afterSwitch({ fresh: true });
  };
  app.renameInstance = (i, name) => { if (!name) return; app.doc.items[i].name = name; autosave(); pushUndo(true); renderInstbar(); };
  app.removeInstance = (i) => {
    if (app.doc.items.length < 2) { toast(`Die letzte ${inst.label} kann nicht gelöscht werden.`, 'warn'); return; }
    const [it] = app.doc.items.splice(i, 1);
    resultCache.delete(it.id);
    activate(Math.min(app.doc.active > i ? app.doc.active - 1 : app.doc.active, app.doc.items.length - 1));
    pushUndo(true);
    afterSwitch();
  };
  function nextName() {
    let n = app.doc.items.length + 1;
    const names = new Set(app.doc.items.map((it) => it.name));
    while (names.has(`${inst.label} ${n}`)) n++;
    return `${inst.label} ${n}`;
  }

  let undoTimer = null, computeTimer = null;
  /**
   * Nach jeder Eingabeänderung aufrufen.
   * opts.inputs: true → Eingabebereich neu aufbauen (z.B. nach Hinzufügen von Elementen, die andere Tabellen beeinflussen)
   */
  app.changed = (opts = {}) => {
    app.stale = true;
    app.error = null;
    autosave();
    clearTimeout(undoTimer);
    if (opts.undoNow) pushUndo(); // eigener Rückgängig-Schritt (z.B. grafische Bearbeitung)
    else undoTimer = setTimeout(pushUndo, 250);
    if (opts.inputs) renderInputs();
    if (def.autoCompute) {
      clearTimeout(computeTimer);
      computeTimer = setTimeout(() => app.compute(), opts.immediate ? 0 : 180);
      renderView();
    } else {
      renderView();
      renderResults();
    }
  };

  function autosave() { if (app.doc) store.set(`${def.id}.doc`, serializeDoc()); }

  function pushUndo() {
    if (!app.doc) return;
    const s = serializeDoc();
    if (app.undoStack[app.undoStack.length - 1] === s) return;
    app.undoStack.push(s);
    if (app.undoStack.length > 80) app.undoStack.shift();
    app.redoStack = [];
    updateUndo();
  }
  function updateUndo() {
    undoBtn.disabled = app.undoStack.length < 2;
    redoBtn.disabled = app.redoStack.length === 0;
  }
  function undo() {
    clearTimeout(undoTimer); pushUndo();
    if (app.undoStack.length < 2) return;
    app.redoStack.push(app.undoStack.pop());
    restore(app.undoStack[app.undoStack.length - 1]);
  }
  function redo() {
    if (!app.redoStack.length) return;
    const s = app.redoStack.pop();
    app.undoStack.push(s);
    restore(s);
  }
  function restore(s) {
    const activeId = app.instance?.id;
    const doc = normalizeDoc(JSON.parse(s));
    app.doc = doc;
    const idx = doc.items.findIndex((it) => it.id === activeId);
    activate(idx >= 0 ? idx : doc.active);
    resultCache.delete(app.instance.id);
    app.stale = true; app.results = def.autoCompute ? app.results : null;
    autosave();
    renderInputs();
    if (def.autoCompute) app.compute(); else { renderView(); renderResults(); }
    updateUndo();
  }

  function newProject() {
    modal('Neues Projekt', h('p', {}, `Alle ${inst.plural} verwerfen und ein neues, leeres Projekt beginnen? Nicht gespeicherte Änderungen gehen verloren. (Eine weitere ${inst.label} fügen Sie oben links mit «+» hinzu.)`), [
      { label: 'Abbrechen' },
      { label: 'Neues Projekt', primary: true, onClick: () => { app.setDocument(docFromProject(def.defaultProject())); app.status('Neues Projekt'); } },
    ]);
  }

  function loadExample(ex) {
    const p = ex.project();
    if (!app.doc) {
      const d = docFromProject(p, ex.name);
      d.meta.name = ex.name;
      app.setDocument(d);
    } else if (isEmptyProject(app.project)) {
      app.setProject(p, { name: ex.name });
      if (app.doc.meta.name === 'Neues Projekt') { app.doc.meta.name = ex.name; autosave(); }
    } else {
      app.addInstance(p, ex.name);
      toast(`Beispiel als neue ${inst.label} «${ex.name}» hinzugefügt – Ihre bisherigen ${inst.plural} bleiben oben links auswählbar.`, 'ok', 5000);
    }
    app.status(`Beispiel geladen: ${ex.name}`, 'ok');
  }

  async function openProject() {
    try {
      const { name, text } = await pickFile(`.json,.${def.id}.json,application/json`);
      const data = JSON.parse(text);
      if (data.app && data.app !== def.id) throw new Error(`Die Datei gehört zum Modul «${data.app}».`);
      if (data.document) app.setDocument(data.document);
      else app.setDocument(docFromProject(data.project || data));
      app.status(`Geöffnet: ${name}`, 'ok');
    } catch (e) {
      if (e.message !== 'Keine Datei gewählt') toast(`Datei konnte nicht geöffnet werden: ${e.message}`, 'error');
    }
  }

  function saveProject() {
    const name = (app.doc.meta?.name || def.id).replace(/[^\w\-äöüÄÖÜ ]+/g, '_').trim() || def.id;
    downloadText(`${name}.${def.id}.json`, JSON.stringify({ app: def.id, version: 2, saved: new Date().toISOString(), document: JSON.parse(serializeDoc()) }, null, 1));
    app.status(`Gespeichert: ${name}.${def.id}.json`, 'ok');
  }

  // ---------------------------------------------------------------- Positionsleiste
  const instbar = h('div', { class: 'instbar' });
  function renderInstbar() {
    clear(instbar);
    if (!app.doc) return;
    const n = app.doc.items.length;
    const pickBtn = h('button', { type: 'button', class: 'inst-pick', title: `${inst.plural} verwalten: wechseln, umbenennen, duplizieren, löschen` },
      h('span', { class: 'inst-kind' }, inst.label),
      h('span', { class: 'inst-name' }, app.instance?.name || ''),
      n > 1 ? h('span', { class: 'inst-n' }, `${app.doc.active + 1}/${n}`) : null,
      icon('chevron', 14));
    pickBtn.addEventListener('click', (e) => { e.stopPropagation(); openInstMenu(pickBtn); });
    instbar.append(pickBtn,
      button('', { icon: 'plus', title: `Neue ${inst.label} (leer)`, onClick: () => app.addInstance() }),
      button('', { icon: 'copy', title: `${inst.label} duplizieren`, onClick: () => app.duplicateInstance() }));
  }
  function openInstMenu(anchor) {
    document.querySelectorAll('.inst-menu').forEach((m) => m.remove());
    const r = anchor.getBoundingClientRect();
    const menu = h('div', { class: 'inst-menu', role: 'menu' });
    const close = () => { menu.remove(); document.removeEventListener('click', onDoc); };
    const onDoc = (e) => { if (!menu.contains(e.target)) close(); };
    app.doc.items.forEach((it, i) => {
      const nameEl = h('span', { class: 'inst-name' }, it.name);
      const row = h('div', { class: `inst-item${i === app.doc.active ? ' active' : ''}`, role: 'menuitem', onclick: (e) => { if (e.target.closest('.lst-act')) return; close(); app.switchInstance(i); } },
        nameEl,
        h('span', { class: 'lst-act' },
          button('', { icon: 'edit', small: true, ghost: true, title: 'Umbenennen', onClick: () => {
            const inp = h('input', { type: 'text', value: it.name });
            nameEl.replaceWith(inp); inp.focus(); inp.select();
            const done = () => { app.renameInstance(i, inp.value.trim() || it.name); close(); };
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') close(); });
            inp.addEventListener('blur', done);
          } }),
          button('', { icon: 'copy', small: true, ghost: true, title: 'Duplizieren', onClick: () => { close(); app.duplicateInstance(i); } }),
          app.doc.items.length > 1 ? button('', { icon: 'trash', small: true, ghost: true, title: 'Löschen', onClick: () => {
            close();
            modal(`${inst.label} löschen`, h('p', {}, `«${it.name}» wirklich löschen? (Rückgängig mit Ctrl+Z möglich)`), [{ label: 'Abbrechen' }, { label: 'Löschen', primary: true, onClick: () => app.removeInstance(i) }]);
          } }) : null));
      menu.append(row);
    });
    menu.append(h('div', { class: 'inst-foot' },
      button(`Neue ${inst.label}`, { icon: 'plus', small: true, onClick: () => { close(); app.addInstance(); } }),
      button('Duplizieren', { icon: 'copy', small: true, onClick: () => { close(); app.duplicateInstance(); } })));
    menu.style.left = `${r.left}px`;
    menu.style.top = `${r.bottom + 6}px`;
    document.body.append(menu);
    setTimeout(() => document.addEventListener('click', onDoc), 0);
  }

  // ---------------------------------------------------------------- Eingabe
  let inputTabs = null;
  let firstVisitDone = false;
  function renderInputs() {
    const active = inputTabs?.active();
    clear(inputPanel);
    const numbered = def.numberedTabs !== false && def.inputTabs.length > 1;
    const defs = [...def.inputTabs.map((t, i) => ({ id: t.id, label: numbered ? [h('span', { class: 'tab-num' }, String(i + 1)), t.label] : t.label, render: (el) => t.render(el, app) })),
      { id: '_project', label: 'Projekt', render: (el) => renderMeta(el) }];
    inputTabs = tabs(defs, { active, onSwitch: (id, initial) => { app.activeTab = id; if (!initial) def.onTabSwitch?.(id, app); } });
    renderInstbar();
    inputPanel.append(instbar);
    if (def.intro && store.get(`${def.id}.introHidden`) !== '1') {
      const card = h('div', { class: 'intro' });
      card.innerHTML = def.intro;
      subscriptify(card);
      // Titel als Klappkopf, Rest als Inhalt
      const head = card.querySelector('h4') || h('h4', {}, 'So funktioniert\'s');
      const body = h('div', { class: 'intro-body' });
      [...card.childNodes].forEach((n) => { if (n !== head) body.append(n); });
      card.replaceChildren(head, body);
      const ic = store.get(`${def.id}.introCollapsed`);
      // beim ersten Besuch offen, danach standardmässig eingeklappt (Klick öffnet)
      if (ic === '1' || (ic === null && firstVisitDone)) card.classList.add('collapsed');
      head.addEventListener('click', () => { card.classList.toggle('collapsed'); store.set(`${def.id}.introCollapsed`, card.classList.contains('collapsed') ? '1' : '0'); });
      card.append(button('', { icon: 'close', small: true, ghost: true, title: 'Ausblenden (über «?» wieder abrufbar)', onClick: () => { store.set(`${def.id}.introHidden`, '1'); card.remove(); } }));
      inputPanel.append(card);
    }
    inputPanel.append(inputTabs.el);
    app.editor?.refreshPanel(true, true);
  }
  app.renderInputs = renderInputs;
  app.selectTab = (id) => inputTabs?.select(id);

  function renderMeta(el) {
    const m = app.project.meta;
    const ch = () => { autosave(); pushUndo(); };
    el.append(h('div', { class: 'group' },
      h('div', { class: 'group-title' }, 'Projektangaben'),
      textField('Projekt', m, 'name', { onChange: ch }),
      textField('Projekt-Nr.', m, 'number', { onChange: ch }),
      textField('Bearbeitung', m, 'author', { onChange: ch }),
      textField('Datum', m, 'date', { onChange: ch }),
      textField('Bemerkungen', m, 'comment', { multiline: true, rows: 4, onChange: ch })));
    el.append(h('div', { class: 'note' }, 'Die Eingaben werden automatisch im Browser zwischengespeichert. Mit «Speichern» wird eine Projektdatei (.json) heruntergeladen, die später wieder geöffnet werden kann.'));
  }

  // ---------------------------------------------------------------- Grafik
  function modes() {
    const list = typeof def.viewModes === 'function' ? def.viewModes(app) : def.viewModes || [];
    return list.map((m) => ({ ...m, disabled: m.disabled || (m.needsResults && !app.results) }));
  }

  function renderToolbar() {
    clear(viewToolbar);
    const ms = modes();
    if (ms.length) {
      if (!ms.some((m) => m.id === app.viewMode && !m.disabled)) app.viewMode = ms.find((m) => !m.disabled)?.id;
      viewToolbar.append(segmented(ms, app.viewMode, (id) => { app.viewMode = id; renderView(); }));
    }
    const optsList = typeof def.viewOptions === 'function' ? def.viewOptions(app) : def.viewOptions || [];
    for (const o of optsList) if (app.viewOpts[o.key] === undefined) app.viewOpts[o.key] = o.default;
    if (optsList.length) {
      viewToolbar.append(h('span', { class: 'sep' }));
      const save = () => store.set(`${def.id}.viewOpts`, JSON.stringify(app.viewOpts));
      for (const o of optsList) {
        if (o.type === 'range') {
          const f = rangeField(o.label, app.viewOpts, o.key, { min: o.min, max: o.max, step: o.step, digits: o.digits, onInput: () => drawView(), onChange: save });
          f.style.gridTemplateColumns = 'auto 110px 34px';
          f.style.margin = '0';
          viewToolbar.append(f);
        } else if (o.type === 'select') {
          const f = selectField(o.label, app.viewOpts, o.key, o.options, { onChange: () => { save(); drawView(); } });
          f.style.gridTemplateColumns = 'auto 140px';
          f.style.margin = '0';
          f.lastChild.remove();
          viewToolbar.append(f);
        } else {
          const f = checkField(o.label, app.viewOpts, o.key, { onChange: () => { save(); drawView(); } });
          f.style.margin = '0';
          viewToolbar.append(f);
        }
      }
    }
    if (def.toolbarExtras) viewToolbar.append(...[].concat(def.toolbarExtras(app) || []));
  }

  function drawView() {
    const v = app.view;
    v.clear();
    viewEmpty.classList.add('hidden');
    try {
      def.renderView(v, app, app.viewMode);
    } catch (e) {
      console.error(e);
      viewEmpty.textContent = `Darstellung fehlgeschlagen: ${e.message}`;
      viewEmpty.classList.remove('hidden');
    }
    v.finish();
    app.editor?.afterRender();
  }

  function renderView() {
    renderToolbar();
    drawView();
    app.editor?.onModeChange();
  }
  app.renderView = renderView;
  app.redraw = drawView;
  app.setViewMode = (id) => { app.viewMode = id; renderView(); };
  app.showViewMessage = (msg) => { viewEmpty.textContent = msg; viewEmpty.classList.toggle('hidden', !msg); };

  function exportSvg() {
    const svg = app.view.snapshot();
    resolveCssVars(svg);
    const text = new XMLSerializer().serializeToString(svg);
    downloadText(`${(app.project.meta?.name || def.id).replace(/[^\w\-]+/g, '_')}_${app.viewMode || 'grafik'}.svg`, text, 'image/svg+xml');
  }

  // ---------------------------------------------------------------- Ergebnisse
  app.resultTab = 'results';
  function renderResults() {
    clear(resultPanel);
    const hasDeriv = !!def.derivation && !!app.results && !app.error;
    if (hasDeriv) {
      resultPanel.append(h('div', { class: 'result-tabs' }, segmented([
        { id: 'results', label: 'Ergebnisse', title: 'Kennzahlen und Nachweise' },
        { id: 'derivation', label: 'Herleitung', title: 'Rechenweg mit Formeln, eingesetzten Werten und Normbezügen' },
      ], app.resultTab, (id) => { app.resultTab = id; renderResults(); })));
    }
    if (app.error) {
      const box = app.errorIncomplete
        ? h('div', { class: 'empty-state', style: { marginTop: '8px' } }, h('b', {}, 'Noch nicht vollständig'), h('div', {}, app.error), app.errorHint ? h('div', { class: 'muted small', style: { marginTop: '6px' } }, app.errorHint) : null)
        : h('div', { class: 'note fail' }, h('b', {}, 'Berechnung nicht möglich'), h('div', {}, app.error));
      resultPanel.append(h('div', { class: 'panel-body' }, box));
      return;
    }
    if (!app.results) {
      resultPanel.append(h('div', { class: 'panel-body' }, h('div', { class: 'placeholder' },
        h('div', { style: { marginBottom: '10px' } }, def.autoCompute ? 'Berechnung läuft …' : 'Noch keine Ergebnisse.'),
        def.autoCompute ? null : button('Berechnen', { icon: 'play', primary: true, onClick: () => app.compute() }))));
      return;
    }
    if (app.stale && !def.autoCompute) {
      resultPanel.append(h('div', { class: 'stale-banner' }, icon('warn'), 'Eingaben geändert – Ergebnisse veraltet',
        button('Neu berechnen', { small: true, primary: true, onClick: () => app.compute() })));
    }
    const body = h('div', { class: 'panel-body' });
    resultPanel.append(body);
    try {
      if (hasDeriv && app.resultTab === 'derivation') {
        renderDerivation(body, def.derivation(app), app);
        if (app.derivTarget) {
          const t = body.querySelector(`[data-deriv="${CSS.escape(app.derivTarget)}"]`);
          app.derivTarget = null;
          if (t) { t.open = true; t.scrollIntoView({ block: 'start' }); t.classList.add('flash'); }
        }
      } else {
        def.renderResults(body, app);
      }
    } catch (e) {
      console.error(e);
      body.append(h('div', { class: 'note fail' }, `Darstellung fehlgeschlagen: ${e.message}`));
    }
  }
  /** Öffnet die Herleitung (optional an einem Abschnitt mit data-deriv=id). */
  app.showDerivation = (id) => {
    if (!def.derivation) return;
    if (workspace.classList.contains('no-results')) toggleResults();
    app.resultTab = 'derivation';
    app.derivTarget = id || null;
    renderResults();
  };
  document.addEventListener('os-derivation', (e) => app.showDerivation(e.detail));
  app.renderResults = renderResults;

  function toggleResults() {
    workspace.classList.toggle('no-results');
    store.set(`${def.id}.hideResults`, workspace.classList.contains('no-results') ? '1' : '0');
  }

  // ---------------------------------------------------------------- Berechnung
  app.compute = () => {
    clearTimeout(computeTimer);
    const t0 = performance.now();
    try {
      app.results = def.compute(app.project, app);
      app.stale = false;
      app.error = null;
      const dt = performance.now() - t0;
      // eine eben gesetzte Meldung (z.B. «Stab 3 erstellt») nicht sofort überschreiben
      if (performance.now() - lastStatusAt > 2500) app.status(`Berechnung abgeschlossen (${dt < 1000 ? `${Math.round(dt)} ms` : `${fmt(dt / 1000, 1)} s`})`, 'ok', { auto: true });
    } catch (e) {
      app.results = null;
      app.error = e.message || String(e);
      app.errorIncomplete = !!e.incomplete;
      app.errorHint = e.hint || null;
      if (e.incomplete) { if (performance.now() - lastStatusAt > 2500) app.status(app.error, 'warn', { auto: true }); }
      else { console.error(e); app.status(`Fehler: ${app.error}`, 'error'); }
    }
    renderView();
    renderResults();
  };

  // ---------------------------------------------------------------- Bericht & Hilfe
  function showReport() {
    if (!app.results || app.stale) {
      if (!def.autoCompute) app.compute();
    }
    if (!app.results) { toast('Für den Bericht wird eine erfolgreiche Berechnung benötigt.', 'warn'); return; }
    try {
      const sections = def.report(app);
      if (def.derivation && def.reportDerivation !== false) sections.push(derivationReport(def.derivation(app)));
      const multi = app.doc.items.length > 1 || !/^\S+ 1$/.test(app.instance.name);
      openReport({ title: def.title, subtitle: multi ? `${def.subtitle} · ${inst.label}: ${app.instance.name}` : def.subtitle, project: app.doc.meta }, sections);
    } catch (e) {
      console.error(e);
      toast(`Bericht konnte nicht erstellt werden: ${e.message}`, 'error');
    }
  }

  /** Erzeugt eine Momentaufnahme der Grafik in einer bestimmten Darstellung (für Berichte). */
  app.snapshot = (mode, opts = {}) => {
    const v = app.view;
    const prev = app.viewMode;
    const prevOpts = opts.viewOpts ? { ...app.viewOpts } : null;
    if (opts.viewOpts) Object.assign(app.viewOpts, opts.viewOpts);
    if (mode) app.viewMode = mode;
    // Berichtsgrafik in fester Breite; das Seitenverhältnis folgt dem Modell (nicht dem Bildschirmfenster)
    const saved = { s: v.s, tx: v.tx, ty: v.ty, w: v.width, h: v.height, fitted: v.fitted, user: v.userAdjusted, insets: v.insets };
    drawView();
    const b = v.modelBounds || v.bbox;
    const W = opts.width || 960;
    const ratio = b ? Math.min(1.25, Math.max(0.42, (b.y1 - b.y0) / Math.max(1e-9, b.x1 - b.x0) * 1.08)) : 0.6;
    v.width = W; v.height = Math.round(opts.height || W * ratio);
    v.insets = null;
    v.fit(opts.padding ?? 40);
    const svg = v.snapshot();
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.width = '100%';
    svg.style.height = 'auto';
    // Ansicht wiederherstellen
    Object.assign(v, { width: saved.w, height: saved.h, insets: saved.insets });
    app.viewMode = prev;
    if (prevOpts) app.viewOpts = prevOpts;
    drawView();
    v.s = saved.s; v.tx = saved.tx; v.ty = saved.ty; v.fitted = saved.fitted; v.userAdjusted = saved.user;
    v._apply();
    return svg;
  };

  function showHelp() {
    const body = h('div');
    body.innerHTML = (def.intro ? `<div class="intro" style="margin:0 0 12px;padding-right:12px">${def.intro}</div>` : '') + (def.help || '');
    subscriptify(body);
    if (def.intro) store.set(`${def.id}.introHidden`, '0');
    modal(`Hilfe – ${def.title}`, body);
  }

  // ---------------------------------------------------------------- Tastatur
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); }
    else if (mod && e.key === 'Enter') { e.preventDefault(); if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); setTimeout(() => app.compute(), 0); }
    else if (mod && !inField && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && !inField && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  });

  // ---------------------------------------------------------------- Start
  window.openstatik = app; // für Fehlersuche in der Konsole
  firstVisitDone = store.get(`${def.id}.visited`) === '1';
  store.set(`${def.id}.visited`, '1');
  const params = new URLSearchParams(location.search);
  const exParam = +(params.get('beispiel') || params.get('example') || 0);
  // Zwischenstand: Dokument (neu) oder einzelnes Projekt (ältere Version)
  let initial = null;
  try {
    const d = store.get(`${def.id}.doc`);
    if (d) initial = JSON.parse(d);
    else { const old = store.get(`${def.id}.autosave`); if (old) initial = docFromProject(JSON.parse(old)); }
  } catch { initial = null; }
  if (exParam >= 1 && def.examples?.[exParam - 1]) {
    const ex = def.examples[exParam - 1];
    const d = docFromProject(ex.project(), ex.name);
    d.meta.name = ex.name;
    app.setDocument(d);
    app.status(`Beispiel geladen: ${ex.name}`, 'ok');
  } else if (initial && !params.has('neu')) {
    app.setDocument(initial);
    app.status('Letzter Arbeitsstand wiederhergestellt – «Neu» beginnt ein leeres Projekt');
  } else {
    // Standard: leeres Projekt; Beispiele bleiben oben unter «Beispiele» abrufbar
    app.setDocument(docFromProject(def.defaultProject()));
    app.status(def.examples?.length ? 'Leeres Projekt – Beispiele finden Sie oben unter «Beispiele»' : 'Leeres Projekt');
  }
  const viewParam = params.get('ansicht') || params.get('view');
  if (viewParam) app.setViewMode(viewParam);
  return app;
}

/** Ersetzt var(--…) in Inline-Styles durch berechnete Werte (für eigenständige SVG-Dateien). */
export function resolveCssVars(root) {
  const cs = getComputedStyle(document.documentElement);
  const rep = (s) => s.replace(/var\((--[\w-]+)\)/g, (_, n) => cs.getPropertyValue(n).trim() || '#000');
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const st = el.getAttribute('style');
    if (st && st.includes('var(')) el.setAttribute('style', rep(st));
    for (const a of ['fill', 'stroke']) { const v = el.getAttribute(a); if (v && v.includes('var(')) el.setAttribute(a, rep(v)); }
  }
}
