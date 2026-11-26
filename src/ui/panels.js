// Hoodoo panels: top bar (create, menu, render), outliner and the inspector for the scene or the selected object.

import { h, ib, btn, section, slider, colorRow, selectRow, segmented, toggleRow, vecRow, popover, closePopover, menuList, toast, download, pickFile } from './dom.js';
import { icon, TYPE_ICON } from './icons.js';
import { t, getLang, setLang } from './i18n.js';
import { CREATE, buildScene, makeObject, material, ensureHeights } from '../scene/scene.js';
import { SCENES, SCENE_ORDER, SKIES, MATERIALS } from '../scene/presets.js';
import { skyPreviewColors } from '../engine/sky.js';
import { rgb2hex } from '../engine/math.js';
import { sceneFile, readSceneFile } from '../storage.js';
import { fromImage } from '../engine/terrain.js';
import { SKY_DEFAULT } from '../engine/sky.js';

export function buildPanels(app) {
  const top = document.getElementById('top');
  const outl = document.getElementById('outliner');
  const insp = document.getElementById('inspector');
  let syncers = [];

  // ---------------------------------------------------------------- top bar
  const nameInp = h('input.scene-name', { value: app.scene.name, spellcheck: 'false' });
  nameInp.addEventListener('change', () => { app.scene.name = nameInp.value || t('untitled'); app.scheduleSave(); });
  nameInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInp.blur(); e.stopPropagation(); });
  const menuBtn = ib('menu', t('menu'), () => popover(menuBtn, menuList([
    { label: t('newScene') + '…', icon: 'plus', onClick: () => setTimeout(() => sceneMenu(), 0) },
    { label: t('open'), icon: 'folder', kbd: '⌘O', onClick: openFile },
    { label: t('save'), icon: 'save', kbd: '⌘S', onClick: saveFile },
    '-',
    { label: t('exportPng'), icon: 'image', onClick: exportLast },
    { label: t('importHeight'), icon: 'upload', onClick: importHeightmap },
    '-',
    { label: t('language'), icon: 'describe', onClick: () => { setLang(getLang() === 'pl' ? 'en' : 'pl'); location.reload(); } },
  ]), { align: 'left' }));
  const sceneMenu = () => popover(menuBtn, menuList([
    ...SCENE_ORDER.map((k) => ({ label: SCENES[k].name, icon: 'sky', onClick: () => app.setScene(buildScene(k)) })),
    '-',
    { label: getLang() === 'pl' ? 'Pusta scena' : 'Empty scene', icon: 'plane', onClick: () => app.setScene(emptyScene()) },
  ]), { align: 'left' });
  const left = h('div.tb-group.tb-left', {}, h('div.wordmark', { text: 'hoodoo' }), h('span.tb-sep'), nameInp, menuBtn);

  const createBtns = CREATE.map((type) => {
    const b = ib(TYPE_ICON[type], t(type), () => app.add(type));
    return b;
  });
  const mid = h('div.tb-group.tb-mid', {}, ...createBtns);

  const undoB = ib('undo', t('undo') + ' ⌘Z', () => app.undo());
  const redoB = ib('redo', t('redo') + ' ⇧⌘Z', () => app.redo());
  const aiB = btn(t('describe'), () => app.renderUI.openAI(), { iconName: 'describe', cls: 'ghost', title: t('describe') + ' ⌘K' });
  const renderMain = h('button.render-btn', { title: t('render') + ' ⌘↵', html: icon('render', 16) + `<span>${t('render')}</span>`, onClick: () => app.startRender() });
  const renderMore = h('button.render-more', { title: t('renderSettings'), html: icon('chevron', 16) });
  renderMore.addEventListener('click', () => popover(renderMore, renderSettings()));
  const right = h('div.tb-group.tb-right', {}, aiB, undoB, redoB, h('div.render-split', {}, renderMain, renderMore));
  top.append(left, mid, right);

  function renderSettings() {
    const r = app.scene.render;
    const sizes = [['view', t('viewSize')], ['1280x720', '1280 × 720'], ['1920x1080', '1920 × 1080'], ['2560x1440', '2560 × 1440'], ['3840x2160', '3840 × 2160 (4K)'], ['2048x2048', '2048 × 2048'], ['1080x1350', '1080 × 1350 (4:5)'], ['1080x1920', '1080 × 1920 (9:16)']];
    return h('div.pop-body', {},
      h('div.pop-title', { text: t('renderSettings') }),
      selectRow({ label: t('size'), options: sizes.map(([value, label]) => ({ value, label })), value: r.size, onChange: (v) => { r.size = v; app.drawOverlay(); app.scheduleSave(); } }),
      selectRow({ label: t('quality'), options: [['draft', t('qDraft') + ' · 1×'], ['normal', t('qNormal') + ' · 4×'], ['fine', t('qFine') + ' · 12×'], ['ultra', t('qUltra') + ' · 32×']].map(([value, label]) => ({ value, label })), value: r.quality, onChange: (v) => { r.quality = v; app.scheduleSave(); } }),
    );
  }

  function emptyScene() {
    const sc = buildScene('checker');
    sc.name = t('untitled');
    sc.objects = [makeObject('plane', { mat: 'sand', name: t('plane') })];
    sc.sky = { ...SKY_DEFAULT, ...SKIES.clear };
    sc.camera = { pos: [0, 8, 50], yaw: 0, pitch: -4, fov: 50 };
    return sc;
  }

  async function openFile() {
    const f = await pickFile('.hoodoo,.json,application/json');
    if (!f) return;
    try { app.setScene(await readSceneFile(f)); } catch (e) { toast(String(e.message || e), 'err'); }
  }

  function saveFile() {
    download(sceneFile(app.scene), (app.scene.name || 'scene').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.hoodoo');
    toast(t('saved'));
  }

  function exportLast() {
    if (!app.lastRender) { toast(t('noRender')); return; }
    const c = document.createElement('canvas');
    c.width = app.lastRender.image.width; c.height = app.lastRender.image.height;
    c.getContext('2d').putImageData(app.lastRender.image, 0, 0);
    c.toBlob((b) => download(b, slug(app.lastRender.name) + '.png'), 'image/png');
  }

  async function importHeightmap() {
    const f = await pickFile('image/*');
    if (!f) return;
    const img = new Image();
    img.src = URL.createObjectURL(f);
    await img.decode();
    app.add('terrain');
    const o = app.selected;
    o.terrain.heights = fromImage(img, o.terrain.res);
    o.terrain.edited = true;
    o.terrain.version++;
    o.name = f.name.replace(/\.\w+$/, '');
    app.emit('scene');
    app.changed('terrain');
  }

  // ---------------------------------------------------------------- outliner
  function buildOutliner() {
    outl.innerHTML = '';
    const list = h('div.ol-list');
    const skyRow = h('div.ol-row' + (app.sel ? '' : '.on'), { onClick: () => app.select(null) }, h('span.ol-ic', { html: icon('sky', 16) }), h('span.ol-name', { text: t('skyRow') }));
    list.append(skyRow);
    for (const o of app.scene.objects) {
      const eye = h('button.ol-eye' + (o.hidden ? '.off' : ''), { title: o.hidden ? t('show') : t('hide'), html: icon(o.hidden ? 'eyeOff' : 'eye', 15) });
      eye.addEventListener('click', (e) => { e.stopPropagation(); app.commit(); o.hidden = !o.hidden; buildOutliner(); app.changed('object'); });
      const typeIcon = o.type === 'plane' && o.mat.pattern === 'water' ? 'water' : TYPE_ICON[o.type];
      const row = h('div.ol-row' + (o.id === app.sel ? '.on' : '') + (o.hidden ? '.hidden' : ''), { onClick: () => app.select(o.id), onDblclick: () => app.focus(o) },
        h('span.ol-ic', { html: icon(typeIcon, 16) }), h('span.ol-name', { text: o.name }), eye);
      list.append(row);
    }
    outl.append(h('div.panel-head', {}, h('span', { text: t('scene') }), h('span.count', { text: String(app.scene.objects.length) })), list);
  }

  // ---------------------------------------------------------------- inspector
  function buildInspector() {
    insp.innerHTML = '';
    syncers = [];
    const o = app.selected;
    if (!o) buildSceneInspector();
    else buildObjectInspector(o);
    insp.classList.remove('enter');
    void insp.offsetWidth;
    insp.classList.add('enter');
  }

  function sunDial() {
    const size = 150;
    const cv = h('canvas.dial', { width: size * 2, height: size * 2, style: { width: size + 'px', height: size + 'px' } });
    const g = cv.getContext('2d');
    const R = size * 0.38, cx = size / 2, cy = size / 2;
    const draw = () => {
      const s = app.scene.sky;
      const pc = skyPreviewColors(s);
      g.setTransform(2, 0, 0, 2, 0, 0);
      g.clearRect(0, 0, size, size);
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, R);
      grad.addColorStop(0, rgb2hex(pc.zen)); grad.addColorStop(1, rgb2hex(pc.hor));
      g.fillStyle = grad;
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1;
      for (const e of [30, 60]) { g.beginPath(); g.arc(cx, cy, R * (90 - e) / 90, 0, Math.PI * 2); g.stroke(); }
      g.beginPath(); g.arc(cx, cy, R * 1.3, 0, Math.PI * 2); g.strokeStyle = 'rgba(255,255,255,0.08)'; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.45)'; g.font = '600 9px -apple-system, system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('N', cx, cy - R * 1.3 - 7); g.fillText('S', cx, cy + R * 1.3 + 7); g.fillText('E', cx + R * 1.3 + 7, cy); g.fillText('W', cx - R * 1.3 - 7, cy);
      const el = s.sunEl, az = s.sunAz * Math.PI / 180;
      const r = el >= 0 ? R * (90 - el) / 90 : R + R * 0.3 * Math.min(1, -el / 30);
      const x = cx + r * Math.sin(az), y = cy - r * Math.cos(az);
      g.fillStyle = el >= 0 ? '#ffd27a' : '#9fb0d8';
      g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.stroke();
    };
    const setFrom = (e) => {
      const rc = cv.getBoundingClientRect();
      const x = e.clientX - rc.left - cx, y = e.clientY - rc.top - cy;
      const r = Math.hypot(x, y);
      const az = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
      const el = r <= R ? 90 - (r / R) * 90 : -Math.min(30, ((r - R) / (R * 0.3)) * 30);
      app.scene.sky.sunAz = Math.round(az * 10) / 10;
      app.scene.sky.sunEl = Math.round(el * 10) / 10;
      draw();
      app.changed('sky', { silent: true });
      syncers.forEach((f) => f('sky'));
      app.labs.sky.sync();
    };
    cv.addEventListener('pointerdown', (e) => { app.commit(); cv.setPointerCapture(e.pointerId); app.interacting++; setFrom(e); const mv = (ev) => setFrom(ev); const up = () => { app.interacting = Math.max(0, app.interacting - 1); cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); app.changed('sky'); }; cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up); });
    draw();
    syncers.push(draw);
    return cv;
  }

  function skySlider(key, label, min, max, step) {
    const s = slider({ label, min, max, step, value: app.scene.sky[key], onStart: () => app.commit(), onInput: (v) => { app.scene.sky[key] = v; app.changed('sky', { silent: true }); app.labs.sky.sync(); } });
    syncers.push(() => s.set(app.scene.sky[key]));
    return s;
  }

  function buildSceneInspector() {
    const sky = app.scene.sky;
    const chips = h('div.chips', {}, ...Object.entries(SKIES).map(([k, s]) => {
      const pc = skyPreviewColors({ ...SKY_DEFAULT, ...s });
      const ch = h('button.chip', { title: s.name, style: { background: `linear-gradient(180deg, ${rgb2hex(pc.zen)}, ${rgb2hex(pc.hor)})` } }, h('span', { text: s.name }));
      ch.addEventListener('click', () => { app.commit(); const keep = { cloudOff: sky.cloudOff }; Object.assign(app.scene.sky, SKY_DEFAULT, s, keep); app.changed('sky'); syncers.forEach((f) => f('sky')); app.labs.sky.sync(); });
      return ch;
    }));
    const azS = skySlider('sunAz', t('azimuth'), 0, 360, 0.5);
    const elS = skySlider('sunEl', t('elevation'), -40, 90, 0.5);
    insp.append(
      h('div.panel-head', {}, h('span', { text: t('sky') })),
      h('div.insp-scroll', {},
        section(t('presets'), chips),
        section(t('sun'), h('div.dial-wrap', {}, sunDial()), azS, elS),
        section(t('sky'),
          skySlider('haze', t('haze'), 0, 1, 0.01),
          skySlider('fog', t('fog'), 0, 1, 0.01),
          skySlider('fogHeight', t('fogHeight'), 0.5, 80, 0.5),
          skySlider('clouds', t('clouds'), 0, 1, 0.01),
          skySlider('cover', t('cover'), 0, 1, 0.01),
          skySlider('shadows', t('shadows'), 0, 1, 0.01),
          skySlider('ambient', t('ambient'), 0, 1.5, 0.01),
          h('div.row.end', {}, btn(t('editSky'), () => app.labs.sky.open(), { iconName: 'sliders', cls: 'ghost small' })),
        ),
        section(t('camera'), camFov()),
      ),
    );
  }

  function camFov() {
    const s = slider({ label: t('fov'), min: 12, max: 100, step: 0.5, value: app.scene.camera.fov, fmt: (v) => Math.round(v) + '°', onStart: () => app.commit(), onInput: (v) => { app.scene.camera.fov = v; app.changed('camera', { silent: true }); app.drawOverlay(); } });
    syncers.push(() => s.set(app.scene.camera.fov));
    return s;
  }

  const dimsOf = (o) => o.type === 'terrain' ? [o.scale[0] * 2, o.scale[1], o.scale[2] * 2] : o.scale.map((v) => v * 2);
  const setDims = (o, d) => { o.scale = o.type === 'terrain' ? [d[0] / 2, d[1], d[2] / 2] : d.map((v) => v / 2); };

  function buildObjectInspector(o) {
    const name = h('input.obj-name', { value: o.name, spellcheck: 'false' });
    name.addEventListener('change', () => { app.commit(); o.name = name.value || o.name; buildOutliner(); app.scheduleSave(); });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); e.stopPropagation(); });
    const typeIcon = o.type === 'plane' && o.mat.pattern === 'water' ? 'water' : TYPE_ICON[o.type];
    const head = h('div.panel-head.obj-head', {}, h('span.ol-ic', { html: icon(typeIcon, 16) }), name,
      ib('focus', t('focus') + ' F', () => app.focus(o)),
      ib('duplicate', t('duplicate') + ' ⌘D', () => app.duplicate(o)),
      ib('trash', t('remove') + ' ⌫', () => app.remove(o)));
    const fmt = (v) => +v.toFixed(Math.abs(v) < 100 ? 2 : 1);
    const pos = vecRow({ label: t('position'), value: o.pos, step: 0.1, fmt, onStart: () => app.commit(), onInput: (v) => { o.pos = v; app.changed('object', { silent: true }); app.drawOverlay(); } });
    syncers.push(() => pos.set(o.pos));
    const blocks = [pos];
    if (o.type !== 'light' && o.type !== 'plane') {
      const rot = vecRow({ label: t('rotation'), value: o.rot, step: 0.5, fmt: (v) => +v.toFixed(1), onStart: () => app.commit(), onInput: (v) => { o.rot = v; app.changed('object', { silent: true }); app.drawOverlay(); } });
      const dims = vecRow({ label: t('dims'), value: dimsOf(o), step: 0.1, fmt, min: 0.01, onStart: () => app.commit(), onInput: (v) => { setDims(o, v); app.changed('object', { silent: true }); app.drawOverlay(); } });
      syncers.push(() => { rot.set(o.rot); dims.set(dimsOf(o)); });
      blocks.push(rot, dims);
    }
    const tools = segmented({ small: true, value: app.tool, options: [{ value: 'move', icon: 'move', label: t('move') + ' W', iconOnly: true }, { value: 'rotate', icon: 'rotate', label: t('rotate') + ' E', iconOnly: true }, { value: 'scale', icon: 'scale', label: t('scaleT') + ' R', iconOnly: true }], onChange: (v) => app.setTool(v) });
    syncers.push((k) => { if (k === 'tool') tools.set(app.tool); });
    const actions = h('div.row.actions', {}, tools, o.type !== 'plane' ? btn(t('landIt'), () => { app.commit(); app.land(o); syncers.forEach((f) => f()); }, { iconName: 'land', cls: 'ghost small', title: t('landIt') + ' L' }) : null);
    const kids = [section(t('position'), ...blocks, actions)];

    if (o.type === 'terrain') kids.push(terrainSection(o));
    if (o.type === 'stone') {
      kids.push(section(t('stone'),
        slider({ label: t('roughness'), min: 0, max: 2, step: 0.01, value: o.rough, onStart: () => app.commit(), onInput: (v) => { o.rough = v; app.changed('object', { silent: true }); } }),
        h('div.row.end', {}, btn(t('reroll'), () => { app.commit(); o.seed = Math.floor(Math.random() * 1000); app.changed('object'); }, { iconName: 'dice', cls: 'ghost small' }))));
    }
    if (o.type === 'torus') kids.push(section(t('torus'), slider({ label: t('thickness'), min: 0.03, max: 0.6, step: 0.01, value: o.minor, onStart: () => app.commit(), onInput: (v) => { o.minor = v; app.changed('object', { silent: true }); app.drawOverlay(); } })));
    if (o.type === 'light') {
      kids.push(section(t('light'),
        colorRow({ label: t('color'), value: o.color, onStart: () => app.commit(), onInput: (v) => { o.color = v; app.changed('object', { silent: true }); } }),
        slider({ label: t('power'), min: 0, max: 12, step: 0.05, value: o.power, onStart: () => app.commit(), onInput: (v) => { o.power = v; app.changed('object', { silent: true }); } }),
        slider({ label: t('range'), min: 1, max: 400, step: 1, value: o.range, onStart: () => app.commit(), onInput: (v) => { o.range = v; app.changed('object', { silent: true }); } }),
        toggleRow({ label: t('visibleBulb'), value: o.visible, onChange: (v) => { app.commit(); o.visible = v; app.changed('object'); } })));
    } else kids.push(materialSection(o));
    insp.append(head, h('div.insp-scroll', {}, ...kids));
  }

  function materialSection(o) {
    const cv = h('canvas.mat-thumb', { width: 128, height: 128 });
    const draw = () => { try { cv.getContext('2d').putImageData(app.renderer.materialPreview(o.mat, 128), 0, 0); } catch (e) { /* gpu busy */ } };
    requestAnimationFrame(draw);
    let tm = 0;
    syncers.push((k) => { if (k === 'material') { clearTimeout(tm); tm = setTimeout(draw, 40); } });
    const presetSel = selectRow({ label: t('presets'), value: o.mat.preset || '', options: [{ value: '', label: '—' }, ...Object.entries(MATERIALS).map(([k, m]) => ({ value: k, label: m.name }))], onChange: (v) => { if (!v) return; app.commit(); o.mat = material(v); app.changed('material'); app.labs.material.load(o); } });
    syncers.push((k) => { if (k === 'material') presetSel.set(o.mat.preset || ''); });
    const refl = slider({ label: t('reflection'), value: o.mat.reflection, onStart: () => app.commit(), onInput: (v) => { o.mat.reflection = v; app.changed('material', { silent: true }); syncers.forEach((f) => f('material')); app.labs.material.sync(); } });
    const trans = slider({ label: t('transparency'), value: o.mat.transparency, onStart: () => app.commit(), onInput: (v) => { o.mat.transparency = v; app.changed('material', { silent: true }); syncers.forEach((f) => f('material')); app.labs.material.sync(); } });
    syncers.push((k) => { if (k === 'material') { refl.set(o.mat.reflection); trans.set(o.mat.transparency); } });
    return section(t('material'),
      h('div.mat-card', { onClick: () => app.labs.material.open(o) }, cv, h('div.mat-meta', {}, h('div.mat-name', { text: o.mat.name || '—' }), h('div.mat-sub', { text: t('editMaterial') + ' →' }))),
      presetSel, refl, trans);
  }

  function terrainSection(o) {
    const gens = ['mountains', 'alps', 'hills', 'canyon', 'spires', 'dunes', 'island', 'craters', 'volcano', 'ridges'];
    const key = (g) => 'g' + g[0].toUpperCase() + g.slice(1);
    const chips = h('div.chips.small', {}, ...gens.map((g) => {
      const c = h('button.chip.plain' + (o.terrain.recipe.gen === g ? '.on' : ''), { text: t(key(g)) });
      c.addEventListener('click', () => { app.commit(); app.labs.terrain.generate(o, { ...o.terrain.recipe, gen: g, ops: defaultOps(g) }); chips.querySelectorAll('.chip').forEach((x) => x.classList.remove('on')); c.classList.add('on'); });
      return c;
    }));
    return section(t('terrain'), chips,
      h('div.row.actions', {},
        btn(t('reroll'), () => { app.commit(); app.labs.terrain.generate(o, { ...o.terrain.recipe, seed: Math.floor(Math.random() * 99999) }); }, { iconName: 'dice', cls: 'ghost small' }),
        btn(t('editTerrain'), () => app.labs.terrain.open(o), { iconName: 'brush', cls: 'ghost small' })));
  }

  app.on((kind) => {
    if (kind === 'scene') { nameInp.value = app.scene.name; buildOutliner(); buildInspector(); }
    else if (kind === 'select') { buildOutliner(); buildInspector(); }
    else if (kind === 'object' || kind === 'sky' || kind === 'camera' || kind === 'material' || kind === 'tool') syncers.forEach((f) => f(kind));
  });

  return { saveFile, openFile, buildOutliner, buildInspector, sync: (k) => syncers.forEach((f) => f(k)) };
}

export function defaultOps(g) {
  if (g === 'mountains' || g === 'alps' || g === 'island' || g === 'volcano') return [{ op: 'erode', amount: 0.5 }];
  if (g === 'canyon') return [{ op: 'erode', amount: 0.3 }];
  return [];
}

const slug = (s) => (s || 'render').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'render';
