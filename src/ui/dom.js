// Hoodoo UI kit: tiny DOM builder, instrument-style controls, floating windows, popovers and toasts.

import { icon } from './icons.js';

export function h(tag, props = {}, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export const ib = (name, title, onClick, cls = '') => h('button.ib' + (cls ? '.' + cls : ''), { title, 'aria-label': title, onClick, html: icon(name) });

export function btn(label, onClick, { iconName, cls = '', title } = {}) {
  return h('button.btn' + (cls ? '.' + cls.split(' ').join('.') : ''), { onClick, title: title || label, html: (iconName ? icon(iconName, 16) : '') + `<span>${label}</span>` });
}

export function section(title, ...kids) {
  const body = h('div.sec-body', {}, ...kids);
  const head = h('div.sec-head', { text: title });
  return h('div.sec', {}, head, body);
}

export function slider({ label, min = 0, max = 1, step = 0.01, value = 0, onInput, onStart, fmt }) {
  const f = fmt || ((v) => (min >= 0 && max <= 2 && step <= 0.01 ? Math.round(v * 100) : +(+v).toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0)));
  const out = h('span.val');
  const inp = h('input.range', { type: 'range', min, max, step, value });
  const paint = () => { const p = ((+inp.value - min) / (max - min)) * 100; inp.style.setProperty('--p', p + '%'); out.textContent = f(+inp.value); };
  inp.addEventListener('pointerdown', () => onStart && onStart());
  inp.addEventListener('keydown', () => onStart && onStart());
  inp.addEventListener('input', () => { paint(); onInput && onInput(+inp.value); });
  paint();
  const row = h('label.row.slider-row', {}, h('span.lbl', { text: label }), inp, out);
  row.set = (v) => { inp.value = v; paint(); };
  return row;
}

export function colorRow({ label, value, onInput, onStart, auto = false, onAuto }) {
  const inp = h('input.swatch', { type: 'color', value: value || '#ffffff' });
  inp.addEventListener('pointerdown', () => onStart && onStart());
  inp.addEventListener('input', () => { if (autoBtn) autoBtn.classList.remove('on'); onInput && onInput(inp.value); });
  let autoBtn = null;
  if (onAuto) {
    autoBtn = h('button.mini' + (auto ? '.on' : ''), { text: 'auto', onClick: (e) => { e.preventDefault(); onStart && onStart(); autoBtn.classList.add('on'); onAuto(); } });
  }
  const row = h('label.row.color-row', {}, h('span.lbl', { text: label }), autoBtn, inp);
  row.set = (v) => { inp.value = v; };
  return row;
}

export function selectRow({ label, options, value, onChange }) {
  const sel = h('select.sel', { onChange: () => onChange(sel.value) }, ...options.map((o) => h('option', { value: o.value, text: o.label, selected: String(o.value) === String(value) })));
  const row = h('label.row', {}, h('span.lbl', { text: label }), sel);
  row.set = (v) => { sel.value = v; };
  return row;
}

export function segmented({ options, value, onChange, small = false }) {
  const el = h('div.seg' + (small ? '.small' : ''));
  const items = options.map((o) => {
    const b = h('button', { class: String(o.value) === String(value) ? 'on' : '', title: o.title || o.label, html: o.icon ? icon(o.icon, 16) + (o.label && !o.iconOnly ? `<span>${o.label}</span>` : '') : o.label });
    b.addEventListener('click', () => { items.forEach((x) => x.classList.remove('on')); b.classList.add('on'); onChange(o.value); });
    el.append(b);
    return b;
  });
  el.set = (v) => items.forEach((b, i) => b.classList.toggle('on', String(options[i].value) === String(v)));
  return el;
}

export function toggleRow({ label, value, onChange }) {
  const inp = h('input.tog', { type: 'checkbox' });
  inp.checked = !!value;
  inp.addEventListener('change', () => onChange(inp.checked));
  const row = h('label.row.toggle-row', {}, h('span.lbl', { text: label }), inp);
  row.set = (v) => { inp.checked = !!v; };
  return row;
}

export function numField({ label, value, step = 0.1, onInput, onStart, fmt = (v) => +v.toFixed(2), min = -Infinity, max = Infinity }) {
  const inp = h('input.num', { type: 'text', inputmode: 'decimal', value: fmt(value) });
  const lab = h('span.axis', { text: label });
  let cur = value;
  const commit = () => {
    const v = parseFloat(inp.value.replace(',', '.'));
    if (Number.isFinite(v)) { onStart && onStart(); cur = Math.min(max, Math.max(min, v)); onInput(cur); }
    inp.value = fmt(cur);
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); inp.blur(); } e.stopPropagation(); });
  inp.addEventListener('blur', commit);
  lab.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    lab.setPointerCapture(e.pointerId);
    onStart && onStart();
    let last = e.clientX;
    const mv = (ev) => {
      const d = ev.clientX - last; last = ev.clientX;
      cur = Math.min(max, Math.max(min, cur + d * step * (ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1)));
      inp.value = fmt(cur); onInput(cur);
    };
    const up = () => { lab.removeEventListener('pointermove', mv); lab.removeEventListener('pointerup', up); };
    lab.addEventListener('pointermove', mv);
    lab.addEventListener('pointerup', up);
  });
  const el = h('div.numf', {}, lab, inp);
  el.set = (v) => { cur = v; if (document.activeElement !== inp) inp.value = fmt(v); };
  return el;
}

export function vecRow({ label, value, step, onInput, onStart, fmt, axes = ['X', 'Y', 'Z'], min }) {
  const v = [...value];
  const fields = axes.map((a, i) => numField({ label: a, value: v[i], step, fmt, min, onStart, onInput: (x) => { v[i] = x; onInput([...v], i); } }));
  const row = h('div.row.vec-row', {}, h('span.lbl', { text: label }), h('div.vec', {}, ...fields));
  row.set = (nv) => { nv.forEach((x, i) => { v[i] = x; fields[i].set(x); }); };
  return row;
}

let zTop = 30;
export class FloatWin {
  constructor({ id, title, width = 560, onClose }) {
    this.onClose = onClose;
    this.body = h('div.win-body');
    this.titleEl = h('span.win-title', { text: title });
    this.head = h('div.win-head', {}, this.titleEl, ib('close', 'Close', () => this.close()));
    this.el = h('div.win', { id, style: { width: width + 'px' } }, this.head, this.body);
    document.getElementById('wins').append(this.el);
    const saved = JSON.parse(localStorage.getItem('hoodoo.win.' + id) || 'null');
    this.pos = saved || { x: Math.max(16, (innerWidth - width) / 2), y: 84 };
    this.place();
    this.head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      this.front();
      this.head.setPointerCapture(e.pointerId);
      const sx = e.clientX - this.pos.x, sy = e.clientY - this.pos.y;
      const mv = (ev) => { this.pos = { x: ev.clientX - sx, y: Math.max(52, ev.clientY - sy) }; this.place(); };
      const up = () => { this.head.removeEventListener('pointermove', mv); this.head.removeEventListener('pointerup', up); localStorage.setItem('hoodoo.win.' + id, JSON.stringify(this.pos)); };
      this.head.addEventListener('pointermove', mv);
      this.head.addEventListener('pointerup', up);
    });
    this.el.addEventListener('pointerdown', () => this.front());
  }
  place() {
    const w = this.el.offsetWidth || 400;
    this.pos.x = Math.min(Math.max(8 - w + 120, this.pos.x), innerWidth - 120);
    this.el.style.transform = `translate(${Math.round(this.pos.x)}px, ${Math.round(this.pos.y)}px)`;
  }
  front() { this.el.style.zIndex = ++zTop; }
  open() { this.el.classList.add('open'); this.front(); this.place(); this.isOpen = true; }
  close() { this.el.classList.remove('open'); this.isOpen = false; this.onClose && this.onClose(); }
  setTitle(t) { this.titleEl.textContent = t; }
}

let popEl = null;
export function popover(anchor, content, { align = 'right' } = {}) {
  closePopover();
  const r = anchor.getBoundingClientRect();
  popEl = h('div.pop', {}, content);
  document.body.append(popEl);
  const w = popEl.offsetWidth, ph = popEl.offsetHeight;
  const x = align === 'right' ? Math.min(innerWidth - w - 10, r.right - w) : Math.max(10, r.left);
  const up = r.bottom + 8 + ph > innerHeight - 8;
  const y = up ? Math.max(8, r.top - 8 - ph) : r.bottom + 8;
  popEl.style.transformOrigin = up ? 'bottom' : 'top';
  popEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  requestAnimationFrame(() => popEl && popEl.classList.add('open'));
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  return popEl;
}
function outside(e) { if (popEl && !popEl.contains(e.target)) closePopover(); }
export function closePopover() {
  document.removeEventListener('pointerdown', outside, true);
  if (popEl) { const p = popEl; p.classList.remove('open'); setTimeout(() => p.remove(), 160); popEl = null; }
}

export function menuList(items) {
  return h('div.menu', {}, ...items.map((it) => it === '-' ? h('div.menu-sep') : h('button.menu-item', { onClick: () => { closePopover(); it.onClick(); }, html: (it.icon ? icon(it.icon, 16) : '<span class="ic-sp"></span>') + `<span>${it.label}</span>` + (it.kbd ? `<kbd>${it.kbd}</kbd>` : '') })));
}

let toastTimer = null;
export function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast ' + kind; }, 2600);
}

export function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

export function pickFile(accept) {
  return new Promise((res) => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', () => { res(inp.files[0] || null); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}
