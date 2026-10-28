// UI-Bausteine: DOM-Helfer, Formularfelder, editierbare Tabellen, Tabs, Nachweistabellen, Dialoge
import { fmt, parseNum } from './format.js';

export { fmt, fmtU, fmtPct, fmtSig, parseNum } from './format.js';

// ------------------------------------------------------------------ DOM

/**
 * Erzeugt ein Element. props: class, style (Objekt oder String), dataset, on<Event>-Handler,
 * sonst Attribute bzw. Properties (value, checked, disabled …). Kinder: Node, String, Zahl, Array, null.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** SVG-Element erzeugen. */
export function svgEl(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null) continue;
    if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) if (sv !== undefined && sv !== null) el.style.setProperty(sk.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), sv);
    } else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c) el.append(c);
  return el;
}

// ------------------------------------------------------------------ Icons (24×24, Strich)

const ICONS = {
  new: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
  open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H8.5a2 2 0 0 0-1.9 1.4L4 19"/><path d="M4 19l2.6-7.6A2 2 0 0 1 8.5 10H21l-2.7 7.8a2 2 0 0 1-1.9 1.2H4z"/>',
  save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>',
  examples: '<path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M8 7h6M8 11h6"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  report: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7M9 9h3"/>',
  print: '<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17.5v.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 9.5V21h14V9.5"/>',
  panelRight: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  chevron: '<path d="M8 10l4 4 4-4"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  grid: '<path d="M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
};

/** Liefert ein Inline-SVG-Icon. */
export function icon(name, size = 16) {
  const s = svgEl('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  s.innerHTML = ICONS[name] || ICONS.info;
  if (name === 'play') { s.setAttribute('fill', 'currentColor'); s.setAttribute('stroke', 'none'); }
  return s;
}

/** Button mit optionalem Icon. opts: {icon, title, primary, ghost, small, danger, onClick} */
export function button(label, opts = {}) {
  const cls = ['btn', opts.primary && 'primary', opts.ghost && 'ghost', opts.small && 'small', opts.danger && 'danger', !label && 'icon', opts.class].filter(Boolean).join(' ');
  return h('button', { type: 'button', class: cls, title: opts.title || label || '', onclick: opts.onClick, disabled: opts.disabled }, opts.icon ? icon(opts.icon) : null, label ? h('span', {}, label) : null);
}

/** Segmentierte Auswahl. items: [{id,label,disabled,title}] */
export function segmented(items, active, onSelect) {
  const el = h('div', { class: 'seg', role: 'tablist' });
  for (const it of items) {
    el.append(h('button', {
      type: 'button', class: it.id === active ? 'active' : '', disabled: !!it.disabled, title: it.title || '',
      onclick: () => {
        for (const b of el.children) b.classList.remove('active');
        el.children[items.indexOf(it)].classList.add('active');
        onSelect(it.id);
      },
    }, it.label));
  }
  return el;
}

/** Dropdown-Menü. items: [{label, desc, onClick}] */
export function dropdown(label, items, opts = {}) {
  const wrap = h('div', { class: 'dropdown' + (opts.right ? ' right' : '') });
  const btn = button(label, { icon: opts.icon, title: opts.title, ghost: opts.ghost });
  btn.append(icon('chevron', 14));
  const menu = h('div', { class: 'dropdown-menu', role: 'menu' });
  const fill = () => {
    clear(menu);
    const list = typeof items === 'function' ? items() : items;
    for (const it of list) {
      menu.append(h('button', { type: 'button', role: 'menuitem', onclick: () => { wrap.classList.remove('open'); it.onClick(); } },
        it.label, it.desc ? h('span', { class: 'desc' }, it.desc) : null));
    }
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !wrap.classList.contains('open');
    document.querySelectorAll('.dropdown.open').forEach((d) => d.classList.remove('open'));
    if (open) { fill(); wrap.classList.add('open'); }
  });
  wrap.append(btn, menu);
  return wrap;
}
if (typeof document !== 'undefined') {
  document.addEventListener('click', () => document.querySelectorAll('.dropdown.open').forEach((d) => d.classList.remove('open')));
}

// ------------------------------------------------------------------ Gruppen & Tabs

/** Abschnitt mit Titel. opts: {collapsible, collapsed, actions: [Node]} */
export function group(title, children = [], opts = {}) {
  const el = h('section', { class: ['group', opts.collapsible && 'collapsible', opts.collapsed && 'collapsed', opts.class] });
  const head = h('div', { class: 'group-title' }, title, opts.info ? infoTip(opts.info) : null, opts.actions ? h('span', { class: 'actions', onclick: (e) => e.stopPropagation() }, opts.actions) : null);
  if (opts.collapsible) head.addEventListener('click', () => el.classList.toggle('collapsed'));
  el.append(head);
  append(el, [children]);
  return el;
}

/**
 * Registerkarten. defs: [{id, label, render(container)}]. Gibt {el, select(id), active()} zurück.
 * Der Inhalt wird beim Umschalten jeweils neu gerendert.
 */
export function tabs(defs, opts = {}) {
  const bar = h('div', { class: 'tab-bar', role: 'tablist' });
  const content = h('div', { class: 'tab-content' });
  const el = h('div', { class: 'tabs' }, bar, content);
  let current = opts.active && defs.some((d) => d.id === opts.active) ? opts.active : defs[0]?.id;
  const buttons = {};
  for (const d of defs) {
    buttons[d.id] = h('button', { type: 'button', role: 'tab', onclick: () => select(d.id) }, d.label);
    bar.append(buttons[d.id]);
  }
  function select(id, initial = false) {
    current = id;
    for (const [k, b] of Object.entries(buttons)) b.classList.toggle('active', k === id);
    clear(content);
    const d = defs.find((x) => x.id === id);
    if (d) d.render(content);
    opts.onSwitch?.(id, initial);
  }
  if (current) select(current, true);
  return { el, select, active: () => current, refresh: () => select(current) };
}

// ------------------------------------------------------------------ Formularfelder

let uid = 0;
const nextId = () => `f${++uid}`;

/**
 * Numerisches Eingabefeld, gebunden an obj[key].
 * opts: {unit, min, max, digits, help, onChange(value), readonly, title}
 */
export function numField(label, obj, key, opts = {}) {
  const id = nextId();
  const input = numInput(obj, key, { ...opts, id });
  return h('div', { class: 'field', title: opts.title || '' },
    labelEl(id, label, opts.info), input, h('span', { class: 'unit' }, opts.unit || ''),
    opts.help ? h('div', { class: 'help' }, opts.help) : null);
}

/** Nacktes numerisches Eingabefeld (für eigene Layouts). */
export function numInput(obj, key, opts = {}) {
  const show = (v) => (typeof v === 'number' && Number.isFinite(v) ? (opts.digits !== undefined ? fmt(v, opts.digits) : String(+v.toPrecision(10))) : '');
  const input = h('input', { id: opts.id, class: 'num', inputmode: 'decimal', value: show(obj[key]), readOnly: !!opts.readonly, title: opts.title });
  const commit = () => {
    const v = parseNum(input.value);
    const bad = !Number.isFinite(v) || (opts.min !== undefined && v < opts.min) || (opts.max !== undefined && v > opts.max);
    if (input.value.trim() === '' && opts.allowEmpty) { input.classList.remove('invalid'); if (obj[key] !== null) { obj[key] = null; opts.onChange?.(null); } return; }
    input.classList.toggle('invalid', bad);
    if (bad) return;
    if (v !== obj[key]) { obj[key] = v; opts.onChange?.(v); }
    input.value = show(v);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); input.select(); } });
  input.addEventListener('focus', () => input.select());
  return input;
}

/** Auswahlfeld. options: [{value,label}] oder [value,…] */
export function selectField(label, obj, key, options, opts = {}) {
  const id = nextId();
  const sel = selectInput(obj, key, options, { ...opts, id });
  return h('div', { class: 'field' + (opts.wide ? ' wide' : ''), title: opts.title || '' },
    labelEl(id, label, opts.info), sel, opts.wide ? null : h('span', { class: 'unit' }, opts.unit || ''),
    opts.help ? h('div', { class: 'help' }, opts.help) : null);
}

export function selectInput(obj, key, options, opts = {}) {
  const sel = h('select', { id: opts.id });
  const list = (typeof options === 'function' ? options() : options).map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));
  for (const o of list) sel.append(h('option', { value: String(o.value) }, o.label));
  sel.value = String(obj[key]);
  sel.addEventListener('change', () => {
    const o = list.find((x) => String(x.value) === sel.value);
    obj[key] = o ? o.value : sel.value;
    opts.onChange?.(obj[key]);
  });
  return sel;
}

export function textField(label, obj, key, opts = {}) {
  const id = nextId();
  const input = opts.multiline
    ? h('textarea', { id, rows: opts.rows || 3, value: obj[key] ?? '' })
    : h('input', { id, type: 'text', value: obj[key] ?? '' });
  input.addEventListener('change', () => { obj[key] = input.value; opts.onChange?.(input.value); });
  return h('div', { class: 'field wide' }, labelEl(id, label, opts.info), input);
}

export function checkField(label, obj, key, opts = {}) {
  const id = nextId();
  const cb = h('input', { id, type: 'checkbox', checked: !!obj[key] });
  cb.addEventListener('change', () => { obj[key] = cb.checked; opts.onChange?.(cb.checked); });
  return h('div', { class: 'field check', title: opts.title || '' }, cb, labelEl(id, label, opts.info));
}

/** Schieberegler mit Wertanzeige. */
export function rangeField(label, obj, key, opts = {}) {
  const id = nextId();
  const out = h('span', { class: 'unit' }, fmt(obj[key], opts.digits ?? 1));
  const input = h('input', { id, type: 'range', min: opts.min ?? 0, max: opts.max ?? 1, step: opts.step ?? 0.01, value: obj[key] });
  input.addEventListener('input', () => { obj[key] = Number(input.value); out.textContent = fmt(obj[key], opts.digits ?? 1); opts.onInput?.(obj[key]); });
  input.addEventListener('change', () => opts.onChange?.(obj[key]));
  return h('div', { class: 'field' }, labelEl(id, label, opts.info), input, out);
}

// ------------------------------------------------------------------ Editierbare Tabelle

/**
 * Editierbare Tabelle, die das Array `rows` direkt verändert.
 * columns: [{key, label, unit, type:'num'|'text'|'select'|'check'|'calc', options, width, digits, min, max, calc(row,i)}]
 * opts: {onChange({type,index}), newRow(rows) → Objekt, numbered=true, rowLabel(i,row), minRows=0,
 *        maxHeight, canAdd=true, canRemove=true, canMove=false, onSelect(index), hint}
 * Unterstützt Einfügen mehrzeiliger Daten aus Excel (Tab-getrennt).
 */
export function dataTable(columns, rows, opts = {}) {
  const numbered = opts.numbered !== false;
  const wrap = h('div', { class: 'dt-wrap', style: opts.maxHeight ? { maxHeight: opts.maxHeight } : undefined });
  const table = h('table', { class: 'dt' });
  const tbody = h('tbody');
  const head = h('tr', {}, numbered ? h('th', {}, '#') : null,
    columns.map((c) => h('th', { style: c.width ? { width: c.width } : undefined, title: c.title || '' }, c.label, c.info ? infoTip(c.info) : null, c.unit ? h('span', { class: 'unit' }, `[${c.unit}]`) : null)),
    h('th', {}, ''));
  table.append(h('thead', {}, head), tbody);
  wrap.append(table);
  const notify = (type, index) => opts.onChange?.({ type, index });
  let selected = -1;

  function cell(row, i, c, ci) {
    const td = h('td');
    if (c.type === 'calc') {
      td.className = 'num';
      td.style.padding = '0 6px';
      td.style.textAlign = 'right';
      td.style.color = 'var(--text-2)';
      td.textContent = c.calc(row, i);
      return td;
    }
    if (c.type === 'select') {
      const sel = selectInput(row, c.key, typeof c.options === 'function' ? () => c.options(row, i) : c.options, { onChange: () => { notify('edit', i); if (c.rerender) render(); } });
      sel.dataset.col = ci;
      td.append(sel);
    } else if (c.type === 'check') {
      const cb = h('input', { type: 'checkbox', checked: !!row[c.key] });
      cb.addEventListener('change', () => { row[c.key] = cb.checked; notify('edit', i); });
      cb.dataset.col = ci;
      td.append(cb);
    } else if (c.type === 'text') {
      const inp = h('input', { type: 'text', value: row[c.key] ?? '' });
      inp.addEventListener('change', () => { row[c.key] = inp.value; notify('edit', i); });
      inp.dataset.col = ci;
      td.append(inp);
    } else {
      const inp = numInput(row, c.key, { digits: c.digits, min: c.min, max: c.max, allowEmpty: c.allowEmpty, onChange: () => notify('edit', i) });
      inp.dataset.col = ci;
      td.append(inp);
    }
    return td;
  }

  function render() {
    clear(tbody);
    rows.forEach((row, i) => {
      const tr = h('tr', { class: i === selected ? 'selected' : '' });
      if (numbered) tr.append(h('td', { class: 'idx' }, opts.rowLabel ? opts.rowLabel(i, row) : i + 1));
      columns.forEach((c, ci) => tr.append(cell(row, i, c, ci)));
      const act = h('td', { class: 'act' });
      if (opts.canMove) {
        act.append(button('', { icon: 'up', small: true, ghost: true, title: 'Nach oben', onClick: () => move(i, -1) }));
        act.append(button('', { icon: 'down', small: true, ghost: true, title: 'Nach unten', onClick: () => move(i, 1) }));
      }
      if (opts.canRemove !== false) {
        act.append(button('', { icon: 'trash', small: true, ghost: true, title: 'Zeile löschen', disabled: rows.length <= (opts.minRows || 0), onClick: () => { rows.splice(i, 1); if (selected >= rows.length) selected = -1; render(); notify('remove', i); } }));
      }
      tr.append(act);
      tr.addEventListener('focusin', () => {
        if (selected === i) return;
        selected = i;
        for (const r of tbody.children) r.classList.remove('selected');
        tr.classList.add('selected');
        opts.onSelect?.(i);
      });
      tbody.append(tr);
    });
  }

  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    render();
    notify('move', j);
  }

  function addRow() {
    const r = opts.newRow ? opts.newRow(rows) : Object.fromEntries(columns.filter((c) => c.key).map((c) => [c.key, c.type === 'text' ? '' : 0]));
    rows.push(r);
    render();
    notify('add', rows.length - 1);
    const last = tbody.lastElementChild?.querySelector('input,select');
    last?.focus();
  }

  // Enter → gleiche Spalte nächste Zeile; Einfügen aus Tabellenkalkulation
  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
    const tr = e.target.closest('tr');
    const col = e.target.dataset.col;
    const next = tr.nextElementSibling;
    setTimeout(() => {
      if (next) next.querySelector(`[data-col="${col}"]`)?.focus();
      else if (opts.canAdd !== false && opts.enterAdds) addRow();
    }, 0);
  });
  tbody.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain');
    if (!text || !/[\t\n]/.test(text.trim())) return;
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    e.preventDefault();
    const startRow = [...tbody.children].indexOf(target.closest('tr'));
    const startCol = Number(target.dataset.col);
    const lines = text.replace(/\r/g, '').split('\n').filter((l, k, a) => l.length || k < a.length - 1);
    lines.forEach((line, k) => {
      const ri = startRow + k;
      if (ri >= rows.length) {
        if (opts.canAdd === false) return;
        rows.push(opts.newRow ? opts.newRow(rows) : {});
      }
      line.split('\t').forEach((val, m) => {
        const c = columns[startCol + m];
        if (!c || c.type === 'calc') return;
        if (c.type === 'text') rows[ri][c.key] = val;
        else if (c.type === 'check') rows[ri][c.key] = /^(1|x|ja|true|wahr)$/i.test(val.trim());
        else if (c.type === 'select') {
          const list = typeof c.options === 'function' ? c.options(rows[ri], ri) : c.options;
          const o = list.map((x) => (typeof x === 'object' ? x : { value: x, label: String(x) })).find((x) => String(x.value) === val.trim() || x.label === val.trim());
          if (o) rows[ri][c.key] = o.value;
        } else {
          const v = parseNum(val);
          if (Number.isFinite(v)) rows[ri][c.key] = v;
        }
      });
    });
    render();
    notify('paste', startRow);
  });

  render();
  const foot = h('div', { class: 'dt-foot' });
  if (opts.canAdd !== false) foot.append(button('Zeile', { icon: 'plus', small: true, onClick: addRow, title: 'Zeile hinzufügen' }));
  if (opts.extraButtons) foot.append(...opts.extraButtons);
  foot.append(h('span', { class: 'hint' }, opts.hint ?? 'Einfügen aus Excel möglich'));
  const el = h('div', { class: 'dt-container' }, wrap, foot);
  el.refresh = render;
  el.select = (i) => { selected = i; render(); };
  return el;
}

// ------------------------------------------------------------------ Ergebnisdarstellung

/** Schlüssel-Wert-Tabelle. rows: [[label, value(number|string|Node), unit, digits]] */
export function kvTable(rows) {
  return h('table', { class: 'kv' }, h('tbody', {}, rows.filter(Boolean).map(([label, value, unit, digits]) =>
    h('tr', {}, h('td', {}, label), h('td', { class: 'val' }, typeof value === 'number' ? fmt(value, digits ?? 2) : value ?? '–'), h('td', { class: 'unit' }, unit || '')))));
}

/**
 * Ergebnistabelle. headers: [{label, num, digits, unit}] oder Strings; rows: Arrays von Werten.
 * opts: {sumRow, caption, rowClass(row,i)}
 */
export function resultTable(headers, rows, opts = {}) {
  const hs = headers.map((x) => (typeof x === 'string' ? { label: x } : x));
  const t = h('table', { class: 'rt' });
  if (opts.caption) t.append(h('caption', {}, opts.caption));
  t.append(h('thead', {}, h('tr', {}, hs.map((c) => h('th', { class: c.num ? 'num' : '' }, c.label, c.unit ? ` [${c.unit}]` : '')))));
  const tb = h('tbody');
  rows.forEach((r, i) => tb.append(h('tr', { class: opts.rowClass ? opts.rowClass(r, i) : '' }, r.map((v, j) => {
    const c = hs[j] || {};
    return h('td', { class: c.num || typeof v === 'number' ? 'num' : '' }, typeof v === 'number' ? fmt(v, c.digits ?? 2) : v);
  }))));
  t.append(tb);
  return h('div', { class: 'dt-wrap', style: { border: 0 } }, t);
}

/** Ausnutzungsanzeige mit Balken. */
export function utilBar(eta) {
  const cls = !Number.isFinite(eta) ? 'fail' : eta > 1.0001 ? 'fail' : eta > 0.95 ? 'warn' : 'ok';
  const w = Number.isFinite(eta) ? Math.min(100, Math.max(0, eta * 100)) : 100;
  return h('div', { class: `util ${cls}`, title: `Ausnutzung η = ${fmt(eta, 3)}` },
    h('div', { class: 'util-bar' }, h('i', { style: { width: `${w}%` } })), h('span', {}, Number.isFinite(eta) ? fmt(eta, 2) : '∞'));
}

export function badge(text, kind = 'info') {
  return h('span', { class: `badge ${kind}` }, text);
}

/** Status-Badge aus Ausnutzung. */
export function etaBadge(eta) {
  const ok = Number.isFinite(eta) && eta <= 1.0001;
  return badge(ok ? 'erfüllt' : 'nicht erfüllt', ok ? 'ok' : 'fail');
}

/**
 * Nachweistabelle. checks: [{label, ref, Ed, Rd, unit, digits, eta, detail}]
 * eta wird aus |Ed|/|Rd| berechnet, falls nicht angegeben.
 */
export function checksTable(checks, opts = {}) {
  const ed = opts.edLabel || 'Ed', rd = opts.rdLabel || 'Rd';
  const list = h('div', { class: 'checks' });
  checks.forEach((c, i) => {
    const eta = c.eta ?? (Math.abs(c.Rd) > 0 ? Math.abs(c.Ed) / Math.abs(c.Rd) : Infinity);
    const d = c.digits ?? 1;
    const kind = !Number.isFinite(eta) || eta > 1.0001 ? 'fail' : eta > 0.95 ? 'warn' : 'ok';
    const w = Number.isFinite(eta) ? Math.min(100, Math.max(0, eta * 100)) : 100;
    const val = (v) => `${fmt(v, d)}${c.unit ? ' ' + c.unit : ''}`;
    const sub = [c.ref, c.detail].filter(Boolean);
    list.append(h('div', { class: `chk ${kind}`, style: { animationDelay: `${Math.min(i, 10) * 25}ms` }, title: `η = ${Number.isFinite(eta) ? fmt(eta, 3) : '∞'}` },
      h('div', { class: 'chk-head' },
        h('span', { class: 'chk-icon', 'aria-hidden': 'true' }, kind === 'fail' ? '✕' : '✓'),
        h('span', { class: 'chk-label' }, c.label),
        h('span', { class: `chk-eta ${kind}` }, Number.isFinite(eta) ? fmt(eta, 2) : '∞')),
      sub.length ? h('div', { class: 'chk-sub' }, sub.map((x, k) => [k ? ' · ' : '', x])) : null,
      c.Ed !== undefined || c.Rd !== undefined
        ? h('div', { class: 'chk-vals' },
          c.Ed !== undefined ? h('span', {}, h('i', {}, ed), ' ', val(c.Ed)) : null,
          c.Rd !== undefined ? h('span', {}, h('i', {}, rd), ' ', val(c.Rd)) : null)
        : null,
      h('div', { class: 'chk-bar' }, h('i', { style: { width: `${w}%` } }))));
  });
  return list;
}

/** Zusammenfassungskarte mit maximaler Ausnutzung. */
export function summaryCard(etaMax, label = 'Maximale Ausnutzung', extra = null) {
  const ok = Number.isFinite(etaMax) && etaMax <= 1.0001;
  return h('div', { class: `summary-card ${ok ? 'ok' : 'fail'}` },
    h('div', { class: 'label' }, label),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
      h('span', { class: 'big' }, Number.isFinite(etaMax) ? `η = ${fmt(etaMax, 2)}` : 'η = ∞'),
      etaBadge(etaMax)),
    extra);
}

/** Kennzahlen-Kacheln. items: [[label, value, unit, digits]] */
export function stats(items) {
  return h('div', { class: 'stats' }, items.filter(Boolean).map(([label, value, unit, digits]) =>
    h('div', { class: 'stat' }, h('div', { class: 'label' }, label),
      h('div', { class: 'value' }, typeof value === 'number' ? fmt(value, digits ?? 2) : value, unit ? h('small', {}, unit) : null))));
}

export function note(text, kind = '') {
  return h('div', { class: `note ${kind}` }, text);
}

/** Leerer Zustand mit Anleitung, z.B. "Noch keine Lasten – mit «+ Zeile» hinzufügen". */
export function emptyState(title, text) {
  return h('div', { class: 'empty-state' }, h('b', {}, title), text);
}

let popover = null;
/** Kleines (?)-Symbol mit Erklärung (Hover/Fokus/Klick). text darf HTML enthalten. */
export function infoTip(text) {
  const tip = h('i', { class: 'info-tip', tabindex: 0, role: 'button', 'aria-label': 'Erklärung' }, '?');
  const show = () => {
    hide();
    const r = tip.getBoundingClientRect();
    popover = h('div', { class: 'popover', role: 'tooltip', html: text });
    document.body.append(popover);
    const pr = popover.getBoundingClientRect();
    let left = Math.min(window.innerWidth - pr.width - 8, Math.max(8, r.left + r.width / 2 - pr.width / 2));
    let top = r.bottom + 6;
    if (top + pr.height > window.innerHeight - 8) top = r.top - pr.height - 6;
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  };
  const hide = () => { popover?.remove(); popover = null; };
  tip.addEventListener('mouseenter', show);
  tip.addEventListener('mouseleave', hide);
  tip.addEventListener('focus', show);
  tip.addEventListener('blur', hide);
  tip.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); popover ? hide() : show(); });
  return tip;
}

function labelEl(id, label, info) {
  return h('label', { for: id }, label, info ? infoTip(info) : null);
}

// ------------------------------------------------------------------ Meldungen & Dialoge

let toastHost = null;
export function toast(msg, kind = 'info', ms = 3500) {
  if (typeof document === 'undefined') return;
  if (!toastHost) { toastHost = h('div', { class: 'toast-host', 'aria-live': 'polite' }); document.body.append(toastHost); }
  const t = h('div', { class: `toast ${kind}` }, msg);
  toastHost.append(t);
  setTimeout(() => t.remove(), ms);
}

/** Modaler Dialog. buttons: [{label, primary, onClick → false verhindert Schliessen}] */
export function modal(title, body, buttons = [{ label: 'Schliessen', primary: true }]) {
  const back = h('div', { class: 'modal-back' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const footer = h('footer', {}, buttons.map((b) => button(b.label, { primary: b.primary, onClick: () => { if (b.onClick?.() !== false) close(); } })));
  const dlg = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, h('header', {}, title), h('div', { class: 'modal-body' }, body), footer);
  back.append(dlg);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  return { close };
}

// ------------------------------------------------------------------ Dateien

export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Öffnet einen Dateidialog und liefert {name, text}. */
export function pickFile(accept = '.json,application/json') {
  return new Promise((resolve, reject) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return reject(new Error('Keine Datei gewählt'));
      resolve({ name: f.name, text: await f.text() });
    });
    document.body.append(input);
    input.click();
  });
}

/** Tiefe Kopie (JSON-sicher). */
export const clone = (o) => JSON.parse(JSON.stringify(o));
