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
import { h, clear, button, icon, dropdown, segmented, tabs, textField, toast, modal, downloadText, pickFile, clone, checkField, rangeField, selectField } from './ui.js';
import { SvgView } from './svgview.js';
import { openReport } from './report.js';
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
  const statusbar = h('footer', { class: 'statusbar' }, statusMsg, statusRight, cursor);
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
    onCursor: (x, y) => { cursor.textContent = `x = ${fmt(x, 3)}  y = ${fmt(y, 3)}`; },
    onClick: (x, y, ev) => def.onViewClick?.(x, y, app, ev),
    onHover: def.onViewHover ? (x, y, ev) => def.onViewHover(x, y, app, ev) : undefined,
  });

  // ---------------------------------------------------------------- Status
  app.status = (msg, kind = '') => {
    statusMsg.textContent = msg;
    statusMsg.className = `status-msg ${kind}`;
  };
  app.setStatusRight = (text) => { statusRight.textContent = text || ''; };

  // ---------------------------------------------------------------- Projekt
  function withMeta(p) {
    p.meta = { ...newMeta(), ...(p.meta || {}) };
    return p;
  }

  app.setProject = (p, opts = {}) => {
    app.project = withMeta(def.migrate ? def.migrate(p) : p);
    app.results = null;
    app.stale = true;
    app.error = null;
    app.selection = null;
    if (!opts.keepUndo) { app.undoStack = [JSON.stringify(app.project)]; app.redoStack = []; }
    app.view.modelBounds = null;
    app.view.fitted = false;
    autosave();
    renderInputs();
    if (def.autoCompute) app.compute(); else { renderView(); renderResults(); }
    updateUndo();
  };

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
    undoTimer = setTimeout(pushUndo, 250);
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

  function autosave() { store.set(`${def.id}.autosave`, JSON.stringify(app.project)); }

  function pushUndo() {
    const s = JSON.stringify(app.project);
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
    app.project = JSON.parse(s);
    app.stale = true; app.results = def.autoCompute ? app.results : null;
    autosave();
    renderInputs();
    if (def.autoCompute) app.compute(); else { renderView(); renderResults(); }
    updateUndo();
  }

  function newProject() {
    modal('Neues Projekt', h('p', {}, 'Aktuelle Eingaben verwerfen und ein neues Projekt beginnen? Nicht gespeicherte Änderungen gehen verloren.'), [
      { label: 'Abbrechen' },
      { label: 'Neues Projekt', primary: true, onClick: () => { app.setProject(def.defaultProject()); app.status('Neues Projekt'); } },
    ]);
  }

  function loadExample(ex) {
    const p = ex.project();
    p.meta = { ...newMeta(), name: ex.name, ...(p.meta || {}) };
    app.setProject(p);
    app.status(`Beispiel geladen: ${ex.name}`, 'ok');
  }

  async function openProject() {
    try {
      const { name, text } = await pickFile(`.json,.${def.id}.json,application/json`);
      const data = JSON.parse(text);
      if (data.app && data.app !== def.id) throw new Error(`Die Datei gehört zum Modul «${data.app}».`);
      const p = data.project || data;
      app.setProject(p);
      app.status(`Geöffnet: ${name}`, 'ok');
    } catch (e) {
      if (e.message !== 'Keine Datei gewählt') toast(`Datei konnte nicht geöffnet werden: ${e.message}`, 'error');
    }
  }

  function saveProject() {
    const name = (app.project.meta?.name || def.id).replace(/[^\w\-äöüÄÖÜ ]+/g, '_').trim() || def.id;
    downloadText(`${name}.${def.id}.json`, JSON.stringify({ app: def.id, version: def.version || 1, saved: new Date().toISOString(), project: app.project }, null, 1));
    app.status(`Gespeichert: ${name}.${def.id}.json`, 'ok');
  }

  // ---------------------------------------------------------------- Eingabe
  let inputTabs = null;
  function renderInputs() {
    const active = inputTabs?.active();
    clear(inputPanel);
    const numbered = def.numberedTabs !== false && def.inputTabs.length > 1;
    const defs = [...def.inputTabs.map((t, i) => ({ id: t.id, label: numbered ? [h('span', { class: 'tab-num' }, String(i + 1)), t.label] : t.label, render: (el) => t.render(el, app) })),
      { id: '_project', label: 'Projekt', render: (el) => renderMeta(el) }];
    inputTabs = tabs(defs, { active, onSwitch: (id, initial) => { app.activeTab = id; if (!initial) def.onTabSwitch?.(id, app); } });
    if (def.intro && store.get(`${def.id}.introHidden`) !== '1') {
      const card = h('div', { class: 'intro' });
      card.innerHTML = def.intro;
      card.append(button('', { icon: 'close', small: true, ghost: true, title: 'Ausblenden (über «?» wieder abrufbar)', onClick: () => { store.set(`${def.id}.introHidden`, '1'); card.remove(); } }));
      inputPanel.append(card);
    }
    inputPanel.append(inputTabs.el);
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
  }

  function renderView() {
    renderToolbar();
    drawView();
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
  function renderResults() {
    clear(resultPanel);
    if (app.error) {
      resultPanel.append(h('div', { class: 'panel-body' }, h('div', { class: 'note fail' }, h('b', {}, 'Berechnung nicht möglich'), h('div', {}, app.error))));
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
      def.renderResults(body, app);
    } catch (e) {
      console.error(e);
      body.append(h('div', { class: 'note fail' }, `Ergebnisdarstellung fehlgeschlagen: ${e.message}`));
    }
  }
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
      app.status(`Berechnung abgeschlossen (${dt < 1000 ? `${Math.round(dt)} ms` : `${fmt(dt / 1000, 1)} s`})`, 'ok');
    } catch (e) {
      console.error(e);
      app.results = null;
      app.error = e.message || String(e);
      app.status(`Fehler: ${app.error}`, 'error');
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
      openReport({ title: def.title, subtitle: def.subtitle, project: app.project.meta }, def.report(app));
    } catch (e) {
      console.error(e);
      toast(`Bericht konnte nicht erstellt werden: ${e.message}`, 'error');
    }
  }

  /** Erzeugt eine Momentaufnahme der Grafik in einer bestimmten Darstellung (für Berichte). */
  app.snapshot = (mode, opts = {}) => {
    const prev = app.viewMode;
    const prevOpts = opts.viewOpts ? { ...app.viewOpts } : null;
    if (opts.viewOpts) Object.assign(app.viewOpts, opts.viewOpts);
    if (mode) app.viewMode = mode;
    drawView();
    app.view.fit(opts.padding ?? 36);
    const svg = app.view.snapshot();
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.width = '100%';
    svg.style.height = 'auto';
    app.viewMode = prev;
    if (prevOpts) app.viewOpts = prevOpts;
    drawView();
    return svg;
  };

  function showHelp() {
    const body = h('div');
    body.innerHTML = (def.intro ? `<div class="intro" style="margin:0 0 12px;padding-right:12px">${def.intro}</div>` : '') + (def.help || '');
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
  let initial = null;
  const params = new URLSearchParams(location.search);
  const exParam = +(params.get('beispiel') || params.get('example') || 0);
  const saved = store.get(`${def.id}.autosave`);
  if (saved) { try { initial = JSON.parse(saved); } catch { initial = null; } }
  if (exParam >= 1 && def.examples?.[exParam - 1]) {
    loadExample(def.examples[exParam - 1]);
  } else if (initial) {
    app.setProject(initial);
    app.status('Letzter Arbeitsstand wiederhergestellt');
  } else if (def.examples?.length) {
    loadExample(def.examples[0]);
  } else {
    app.setProject(def.defaultProject());
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
