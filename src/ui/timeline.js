// Hoodoo timeline: play/scrub bar with keyframe lanes for camera, sun and the selected object, plus film export.

import { h, ib, btn, slider, selectRow, popover, closePopover, menuList, numField, toast, download } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { hasAnimation, applyAnimation, keyCamera, keySun, keyObject } from '../anim/anim.js';
import { filmSupported, createFilm } from '../anim/film.js';
import { QUALITY, RENDER_SAMPLES } from '../engine/renderer.js';

export function buildTimeline(app) {
  const root = document.getElementById('timeline');
  const playB = ib('play', 'Play ␣', () => app.play());
  const timeLbl = h('span.tl-time');
  const lanes = h('canvas.tl-lanes');
  const g = lanes.getContext('2d');
  const keyB = ib('key', t('addKey') + ' K', () => popover(keyB, menuList([
    { label: t('keyCam'), icon: 'camera', onClick: () => { keyCamera(app.scene, app.time); changed(); } },
    { label: t('keySun'), icon: 'sun', onClick: () => { keySun(app.scene, app.time); changed(); } },
    ...(app.selected ? [{ label: app.selected.name, icon: 'cube', onClick: () => { keyObject(app.scene, app.selected, app.time); changed(); } }] : []),
  ])));
  const autoB = h('button.tl-auto', { text: t('autoKey'), title: 'Auto-key' });
  const api = { autoKey: false };
  autoB.addEventListener('click', () => { api.autoKey = !api.autoKey; autoB.classList.toggle('on', api.autoKey); });
  const dur = numField({ label: '⟷', value: app.scene.anim.duration, step: 0.1, min: 1, max: 120, fmt: (v) => v.toFixed(1) + ' s', onInput: (v) => { app.scene.anim.duration = v; draw(); app.scheduleSave(); } });
  const filmB = btn(t('renderFilm'), () => filmDialog(), { iconName: 'film', cls: 'ghost small' });
  root.append(h('div.tl-bar', {}, playB, timeLbl, h('div.tl-lane-wrap', {}, lanes), keyB, autoB, dur, filmB));

  let sel = null;
  const rows = () => {
    const tr = app.scene.anim.tracks;
    const r = [{ name: t('keyCam'), keys: tr.camera, kind: 'camera' }, { name: t('keySun'), keys: tr.sun, kind: 'sun' }];
    const o = app.selected;
    if (o) r.push({ name: o.name, keys: tr.objects[o.id] || [], kind: 'object', id: o.id });
    for (const [id, ks] of Object.entries(tr.objects)) if (ks.length && (!o || id !== o.id)) { const oo = app.scene.objects.find((x) => x.id === id); if (oo) r.push({ name: oo.name, keys: ks, kind: 'object', id, dim: true }); }
    return r.slice(0, 4);
  };

  function draw() {
    const dpr = devicePixelRatio || 1;
    const w = lanes.clientWidth, hh = lanes.clientHeight;
    if (lanes.width !== Math.round(w * dpr)) { lanes.width = Math.round(w * dpr); lanes.height = Math.round(hh * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hh);
    const D = app.scene.anim.duration;
    const L = 78;
    const X = (tt) => L + (tt / D) * (w - L - 8);
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1;
    for (let s = 0; s <= D; s += D > 20 ? 5 : 1) { const x = Math.round(X(s)) + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, hh); g.stroke(); }
    const rr = rows();
    const rh = Math.min(12, (hh - 4) / Math.max(1, rr.length));
    g.font = '500 10px -apple-system, system-ui'; g.textBaseline = 'middle';
    rr.forEach((r, i) => {
      const y = 4 + rh * i + rh / 2;
      g.fillStyle = r.dim ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.55)';
      g.fillText(r.name.length > 11 ? r.name.slice(0, 10) + '…' : r.name, 6, y);
      for (const k of r.keys) {
        const x = X(k.t);
        const on = sel && sel.k === k;
        g.fillStyle = on ? '#ff9f0a' : r.dim ? 'rgba(255,255,255,0.45)' : '#f2f2f4';
        g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 4, y); g.lineTo(x, y + 4); g.lineTo(x - 4, y); g.closePath(); g.fill();
      }
    });
    if (!hasAnimation(app.scene)) { g.fillStyle = 'rgba(255,255,255,0.32)'; g.fillText(t('noKeys'), L + 8, hh / 2); }
    const px = X(app.time);
    g.strokeStyle = '#ff9f0a'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(px, 0); g.lineTo(px, hh); g.stroke();
    timeLbl.textContent = app.time.toFixed(1) + ' s';
    playB.innerHTML = icon(app.playing ? 'pause' : 'play');
    dur.set(app.scene.anim.duration);
  }

  function hitKey(x, y) {
    const w = lanes.clientWidth, hh = lanes.clientHeight, D = app.scene.anim.duration, L = 78;
    const rr = rows();
    const rh = Math.min(12, (hh - 4) / Math.max(1, rr.length));
    for (let i = 0; i < rr.length; i++) {
      const yy = 4 + rh * i + rh / 2;
      for (const k of rr[i].keys) { const kx = L + (k.t / D) * (w - L - 8); if (Math.abs(kx - x) < 6 && Math.abs(yy - y) < 6) return { k, list: rr[i].keys }; }
    }
    return null;
  }

  lanes.addEventListener('pointerdown', (e) => {
    const w = lanes.clientWidth, D = app.scene.anim.duration, L = 78;
    const toT = (x) => Math.max(0, Math.min(D, ((x - L) / (w - L - 8)) * D));
    const k = hitKey(e.offsetX, e.offsetY);
    lanes.setPointerCapture(e.pointerId);
    if (k) {
      sel = k;
      if (e.button === 2 || e.altKey) { k.list.splice(k.list.indexOf(k.k), 1); sel = null; changed(); return; }
      const mv = (ev) => { k.k.t = Math.round(toT(ev.offsetX) * 10) / 10; draw(); };
      const up = () => { k.list.sort((a, b) => a.t - b.t); lanes.removeEventListener('pointermove', mv); lanes.removeEventListener('pointerup', up); changed(); };
      lanes.addEventListener('pointermove', mv); lanes.addEventListener('pointerup', up);
      draw();
      return;
    }
    sel = null;
    app.play(false);
    app.setTime(toT(e.offsetX));
    const mv = (ev) => app.setTime(toT(ev.offsetX));
    const up = () => { lanes.removeEventListener('pointermove', mv); lanes.removeEventListener('pointerup', up); };
    lanes.addEventListener('pointermove', mv); lanes.addEventListener('pointerup', up);
  });
  lanes.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('keydown', (e) => {
    if (!sel || !/Backspace|Delete/.test(e.key) || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    e.stopImmediatePropagation();
    sel.list.splice(sel.list.indexOf(sel.k), 1); sel = null; changed();
  }, true);

  function changed() { draw(); app.scheduleSave(); if (hasAnimation(app.scene)) app.setTime(app.time); }

  // ---------------------------------------------------------------- film
  const film = { fps: 30, size: '1280x720', quality: 'normal' };
  function filmDialog() {
    if (!filmSupported()) { toast(t('filmNoCodec'), 'err'); return; }
    popover(filmB, h('div.pop-body', {},
      h('div.pop-title', { text: t('filmTitle') }),
      selectRow({ label: t('size'), value: film.size, options: [['1280x720', '1280 × 720'], ['1920x1080', '1920 × 1080'], ['1080x1350', '1080 × 1350'], ['1080x1920', '1080 × 1920']].map(([value, label]) => ({ value, label })), onChange: (v) => { film.size = v; } }),
      selectRow({ label: t('fps'), value: film.fps, options: [24, 30, 60].map((v) => ({ value: v, label: String(v) })), onChange: (v) => { film.fps = +v; } }),
      selectRow({ label: t('quality'), value: film.quality, options: [['draft', t('qDraft') + ' · 1×'], ['normal', t('qNormal') + ' · 4×'], ['fine', t('qFine') + ' · 12×']].map(([value, label]) => ({ value, label })), onChange: (v) => { film.quality = v; } }),
      h('div.row.end', {}, btn(t('filmGo'), () => { closePopover(); renderFilm(); }, { iconName: 'film', cls: 'accent small' })),
    ), { align: 'right' });
  }

  async function renderFilm() {
    if (app.mode !== 'edit') return;
    app.play(false);
    const [w, h0] = film.size.split('x').map(Number);
    const fps = film.fps, D = app.scene.anim.duration, N = Math.max(1, Math.round(D * fps));
    const r = app.renderer;
    let enc;
    try { enc = await createFilm({ width: w, height: h0, fps }); } catch (e) { toast(t('filmNoCodec') + ' ' + e.message, 'err'); return; }
    app.mode = 'film';
    app.drawOverlay();
    const ui = app.renderUI.filmStart(N);
    const saved = JSON.stringify({ camera: app.scene.camera, sky: { a: app.scene.sky.sunAz, e: app.scene.sky.sunEl }, objs: app.scene.objects.map((o) => [o.pos, o.rot, o.scale]) });
    const t0 = performance.now();
    let cancelled = false;
    ui.onCancel = () => { cancelled = true; };
    try {
      for (let i = 0; i < N && !cancelled; i++) {
        const tm = i / fps;
        applyAnimation(app.scene, tm);
        r.time = tm;
        r.setScene(app.scene);
        r.startJob(app.renderCamera(enc.width, enc.height), { width: enc.width, height: enc.height, samples: RENDER_SAMPLES[film.quality], bryce: false, quality: QUALITY.final, kind: 'film', tile: 160 });
        while (!r.job.done && !cancelled) { r.stepJob(40); r.showJob(); await new Promise((res) => requestAnimationFrame(res)); }
        if (cancelled) break;
        r.showJob();
        await enc.add(r.readTarget(r.job.final));
        r.endJob();
        const el = (performance.now() - t0) / 1000;
        ui.progress(i + 1, N, (el / (i + 1)) * (N - i - 1));
      }
      if (!cancelled) {
        const blob = await enc.finish();
        download(blob, (app.scene.name || 'hoodoo').toLowerCase().replace(/[^\w]+/g, '-') + '.mp4');
        toast(t('filmSaved'));
      } else enc.cancel();
    } catch (e) { toast(String(e.message || e), 'err'); enc.cancel(); }
    if (r.job) r.endJob();
    const s = JSON.parse(saved);
    app.scene.camera = s.camera; app.scene.sky.sunAz = s.sky.a; app.scene.sky.sunEl = s.sky.e;
    app.scene.objects.forEach((o, i) => { if (s.objs[i]) [o.pos, o.rot, o.scale] = s.objs[i]; });
    app.setTime(app.time);
    app.mode = 'edit';
    ui.end();
    app.changed('scene');
  }

  app.on((k) => { if (k === 'scene' || k === 'select' || k === 'anim') draw(); });
  new ResizeObserver(() => draw()).observe(lanes);
  api.update = draw;
  requestAnimationFrame(draw);
  return api;
}
