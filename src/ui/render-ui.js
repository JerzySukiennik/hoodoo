// Hoodoo render overlay (Bryce-style pass progress, save PNG), film progress and the "describe a scene" Claude flow.

import { h, btn, segmented, toast, download } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { askScene, summarize, proposalToScene } from '../ai/client.js';

const fmtTime = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

export function buildRenderUI(app) {
  const bar = document.getElementById('renderbar');
  const label = h('span.rb-label');
  const line = h('div.rb-line', {}, h('div.rb-fill'));
  const stopB = btn(t('stop'), () => app.stopRender(), { iconName: 'stop', cls: 'ghost small' });
  const saveB = btn(t('savePng'), () => savePng(), { iconName: 'download', cls: 'accent small' });
  const closeB = btn(t('close'), () => app.closeRender(), { iconName: 'close', cls: 'ghost small' });
  bar.append(h('div.rb-row', {}, label, h('div.rb-btns', {}, stopB, saveB, closeB)), line);

  function show() { document.body.classList.add('rendering'); bar.classList.add('open'); update(); }
  function hide() { document.body.classList.remove('rendering'); bar.classList.remove('open'); }

  function update() {
    const r = app.renderer, j = r.job;
    if (!j) return;
    const el = (performance.now() - app.renderStart) / 1000;
    const p = r.progress();
    line.firstChild.style.transform = `scaleX(${p})`;
    if (j.done) {
      if (!j.doneAt) j.doneAt = el;
      label.innerHTML = `<b>${t('done')}</b> · ${j.W} × ${j.H} · ${fmtTime(j.doneAt)}`;
      stopB.style.display = 'none'; saveB.style.display = '';
      return;
    }
    const pass = j.passes[j.pi];
    const aaN = j.passes.filter((x) => x.sample > 1).length;
    const what = pass.sample > 1 ? `${t('aa')} ${pass.sample - 1}/${aaN}` : `${t('pass')} ${j.pi + 1} ${t('of')} ${j.passes.length - aaN}`;
    label.innerHTML = `<b>${t('rendering')}</b> · ${what} · ${Math.round(p * 100)}% · ${fmtTime(el)}`;
    stopB.style.display = ''; saveB.style.display = 'none';
  }

  function savePng() {
    const r = app.renderer, j = r.job;
    if (!j || !j.final) return;
    const img = r.readTarget(j.final);
    app.lastRender = { image: img, name: app.scene.name };
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0);
    c.toBlob((b) => download(b, (app.scene.name || 'render').toLowerCase().replace(/[^\w]+/g, '-') + '.png'), 'image/png');
  }

  // ---------------------------------------------------------------- film progress
  function filmStart(N) {
    document.body.classList.add('rendering');
    bar.classList.add('open');
    saveB.style.display = 'none'; closeB.style.display = 'none'; stopB.style.display = '';
    const ui = { onCancel: null };
    const prevStop = stopB.onclick;
    stopB.onclick = (e) => { e.stopImmediatePropagation(); ui.onCancel && ui.onCancel(); };
    label.innerHTML = `<b>${t('filmTitle')}</b> · ${t('frame')} 0/${N}`;
    line.firstChild.style.transform = 'scaleX(0)';
    ui.progress = (i, n, eta) => { label.innerHTML = `<b>${t('filmTitle')}</b> · ${t('frame')} ${i}/${n} · ${fmtTime(eta)} ${t('eta')}`; line.firstChild.style.transform = `scaleX(${i / n})`; };
    ui.end = () => { stopB.onclick = prevStop; closeB.style.display = ''; hide(); };
    return ui;
  }

  // ---------------------------------------------------------------- describe a scene (Claude)
  const aiBox = document.getElementById('aibox');
  const prop = document.getElementById('proposal');
  let mode = 'new', busy = false, proposal = null, before = null, lastPrompt = '';
  const ta = h('textarea.ai-ta', { placeholder: t('aiPlaceholder'), rows: 3 });
  const seg = segmented({ small: true, value: mode, options: [{ value: 'new', label: t('aiNew') }, { value: 'edit', label: t('aiEdit') }], onChange: (v) => { mode = v; } });
  const status = h('div.ai-status');
  const go = btn(t('aiGo'), () => submit(), { iconName: 'describe', cls: 'accent small' });
  aiBox.append(h('div.ai-head', {}, h('span', { html: icon('describe', 16) }), h('span', { text: t('aiTitle') })), ta, h('div.row.ai-foot', {}, seg, status, go));
  ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) { e.preventDefault(); submit(); } if (e.key === 'Escape') closeAI(); });

  function openAI(refine = false) {
    if (app.mode !== 'edit') return;
    aiBox.classList.add('open');
    ta.value = refine ? '' : ta.value;
    ta.placeholder = refine ? t('aiRefinePh') : t('aiPlaceholder');
    aiBox.dataset.refine = refine ? '1' : '';
    seg.style.display = refine ? 'none' : '';
    setTimeout(() => ta.focus(), 30);
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  }
  function outside(e) { if (!aiBox.contains(e.target) && !busy && !e.target.closest('.tb-right')) closeAI(); }
  function closeAI() { aiBox.classList.remove('open'); document.removeEventListener('pointerdown', outside, true); }

  async function submit() {
    const text = ta.value.trim();
    if (!text || busy) return;
    busy = true;
    aiBox.classList.add('busy');
    status.textContent = t('aiWorking');
    const refine = !!aiBox.dataset.refine && proposal;
    try {
      const base = refine ? proposal : app.scene;
      const reply = await askScene({ prompt: text, mode: refine ? 'edit' : mode, current: summarize(base), previous: refine ? lastPrompt : undefined });
      const sc = proposalToScene(reply, app.scene);
      if (!before) before = app.scene;
      proposal = sc;
      lastPrompt = refine ? lastPrompt + ' / ' + text : text;
      app.scene = sc;
      app.sel = null;
      const cam = sc.camera;
      const ground = app.groundUnder(cam.pos[0], cam.pos[2]);
      if (cam.pos[1] < ground + 3) cam.pos[1] = ground + 5;
      app.emit('scene');
      app.changed('scene', { silent: true });
      showProposal(sc);
      closeAI();
      ta.value = '';
    } catch (e) {
      status.textContent = '';
      toast(t('aiErr') + (e.message || e), 'err');
    }
    busy = false;
    aiBox.classList.remove('busy');
    status.textContent = '';
  }

  function showProposal(sc) {
    prop.innerHTML = '';
    prop.append(
      h('div.prop-text', {}, h('div.prop-k', { text: t('aiProposal') }), h('div.prop-name', { text: sc.name }), sc.blurb ? h('div.prop-blurb', { text: sc.blurb }) : null),
      h('div.prop-btns', {},
        btn(t('aiDiscard'), () => discard(), { cls: 'ghost small' }),
        btn(t('aiRefine'), () => openAI(true), { iconName: 'describe', cls: 'ghost small' }),
        btn(t('aiApply'), () => apply(), { iconName: 'check', cls: 'accent small' })),
    );
    prop.classList.add('open');
  }

  function apply() {
    if (!before) return;
    const accepted = app.scene;
    app.scene = before;
    app.commit();
    app.scene = accepted;
    before = null; proposal = null;
    prop.classList.remove('open');
    app.emit('scene');
    app.changed('scene');
  }

  function discard() {
    if (!before) return;
    app.scene = before;
    before = null; proposal = null;
    prop.classList.remove('open');
    app.sel = null;
    app.emit('scene');
    app.changed('scene');
  }

  return { show, hide, update, filmStart, openAI: () => openAI(false) };
}
