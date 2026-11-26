// Hoodoo labs: floating Materials Lab, Terrain Editor and Sky & Fog windows.

import { h, btn, section, slider, colorRow, selectRow, segmented, toggleRow, FloatWin, download, pickFile } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { MATERIALS, PATTERNS } from '../scene/presets.js';
import { material } from '../scene/scene.js';
import { generate, applyOp, fromImage, resample } from '../engine/terrain.js';
import { SKY_DEFAULT } from '../engine/sky.js';
import { defaultOps } from './panels.js';

const thumbCache = new Map();

export function buildLabs(app) {
  return { material: materialLab(app), terrain: terrainLab(app), sky: skyLab(app) };
}

// ---------------------------------------------------------------- Materials Lab
const PAT_INFO = {
  solid: { cols: ['colA'] }, checker: { cols: ['colA', 'colB'] },
  strata: { cols: ['colA', 'colB', 'colC'], p: [['p1', 'bands', 2, 48, 0.5], ['p2', 'topSlope', 0.4, 1, 0.01], ['p3', 'topAmt', 0, 1, 0.01]] },
  alpine: { cols: ['colA', 'colB', 'colC'], p: [['p1', 'grassLine', 0, 1.2, 0.01], ['p2', 'snowLine', 0, 1.3, 0.01], ['p3', 'steep', 0.3, 1, 0.01]] },
  marble: { cols: ['colA', 'colB', 'colC'] }, granite: { cols: ['colA', 'colB', 'colC'] }, fractal: { cols: ['colA', 'colB', 'colC'] },
  wood: { cols: ['colA', 'colB'] }, rock: { cols: ['colA', 'colB', 'colC'] }, sand: { cols: ['colA', 'colB'], p: [['p1', 'ripples', 0.3, 8, 0.05]] },
  water: { cols: ['colA', 'colB'] }, tiles: { cols: ['colA', 'colB'], p: [['p1', 'lineWidth', 0.01, 0.4, 0.005]] },
  lava: { cols: ['colA', 'colB', 'colC'], p: [['p1', 'crack', 0, 1, 0.01]] }, mud: { cols: ['colA', 'colB', 'colC'], p: [['p1', 'crack', 0, 1, 0.01]] },
  gradient: { cols: ['colA', 'colB', 'colC'] }, desert: { cols: ['colA', 'colB', 'colC'], p: [['p1', 'altMix', 0, 2, 0.01]] },
};
const PAT_KEY = { solid: 'pSolid', checker: 'pChecker', strata: 'pStrata', alpine: 'pAlpine', marble: 'pMarble', granite: 'pGranite', fractal: 'pFractal', wood: 'pWood', rock: 'pRock', sand: 'pSand', water: 'pWater', tiles: 'pTiles', lava: 'pLava', mud: 'pMud', gradient: 'pGradient', desert: 'pDesert' };

function materialLab(app) {
  const win = new FloatWin({ id: 'matlab', title: t('matLab'), width: 660 });
  let obj = null, shape = 'sphere', syncers = [], drawTimer = 0;
  const preview = h('canvas.mat-big', { width: 448, height: 448 });
  const drawPreview = () => { if (!obj || !win.isOpen) return; try { preview.getContext('2d').putImageData(app.renderer.materialPreview(obj.mat, 448, shape), 0, 0); } catch (e) { /* busy */ } };
  const schedule = () => { clearTimeout(drawTimer); drawTimer = setTimeout(drawPreview, 30); };

  function grid() {
    const g = h('div.preset-grid');
    const keys = Object.keys(MATERIALS);
    keys.forEach((k) => {
      const c = h('canvas', { width: 96, height: 96 });
      const b = h('button.preset', { title: MATERIALS[k].name }, c, h('span', { text: MATERIALS[k].name }));
      b.addEventListener('click', () => { if (!obj) return; app.commit(); obj.mat = material(k); app.changed('material'); load(obj); });
      g.append(b);
      if (thumbCache.has(k)) c.getContext('2d').putImageData(thumbCache.get(k), 0, 0);
    });
    let i = 0;
    const step = () => {
      if (!win.isOpen || i >= keys.length) return;
      const k = keys[i];
      if (!thumbCache.has(k)) { try { thumbCache.set(k, app.renderer.materialPreview({ ...MATERIALS[k] }, 96)); } catch (e) { /* busy */ } }
      const c = g.children[i].querySelector('canvas');
      if (thumbCache.has(k)) c.getContext('2d').putImageData(thumbCache.get(k), 0, 0);
      i++;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return g;
  }

  function set(key, v, silentUI) {
    obj.mat[key] = v;
    obj.mat.preset = obj.mat.preset && !obj.mat.preset.endsWith('*') ? obj.mat.preset : obj.mat.preset;
    app.changed('material', { silent: true });
    app.panels.sync('material');
    schedule();
    if (!silentUI) syncers.forEach((f) => f());
  }

  function mslider(key, label, min = 0, max = 1, step = 0.01) {
    const s = slider({ label: t(label), min, max, step, value: obj.mat[key], onStart: () => app.commit(), onInput: (v) => set(key, v, true) });
    syncers.push(() => s.set(obj.mat[key]));
    return s;
  }
  function mcolor(key, label, auto) {
    const r = colorRow({ label: t(label), value: obj.mat[key] || obj.mat.colorA, auto: auto && !obj.mat[key], onStart: () => app.commit(), onInput: (v) => set(key, v, true), onAuto: auto ? () => set(key, null) : null });
    syncers.push(() => r.set(obj.mat[key] || obj.mat.colorA));
    return r;
  }

  function body() {
    win.body.innerHTML = '';
    syncers = [];
    if (!obj) return;
    const m = obj.mat;
    const info = PAT_INFO[m.pattern] || PAT_INFO.solid;
    const patSel = selectRow({ label: t('pattern'), value: m.pattern, options: PATTERNS.map((p) => ({ value: p, label: t(PAT_KEY[p]) })), onChange: (v) => { app.commit(); set('pattern', v); body(); } });
    const colKeys = { colA: 'colorA', colB: 'colorB', colC: 'colorC' };
    const colorLabels = m.pattern === 'alpine' ? ['gAlps', 'pRock', 'snowLine'] : null;
    const cols = info.cols.map((c, i) => mcolor(colKeys[c], colorLabels && m.pattern === 'alpine' ? ['colA', 'colB', 'colC'][i] : c));
    const params = (info.p || []).map(([k, l, a, b, s]) => mslider(k, l, a, b, s));
    const shapeSeg = segmented({ small: true, value: shape, options: [{ value: 'sphere', icon: 'sphere', label: t('sphere'), iconOnly: true }, { value: 'cube', icon: 'cube', label: t('cube'), iconOnly: true }, { value: 'stone', icon: 'stone', label: t('stone'), iconOnly: true }], onChange: (v) => { shape = v; drawPreview(); } });
    const left = h('div.lab-left', {}, h('div.preview-wrap', {}, preview, h('div.preview-tools', {}, shapeSeg)), h('div.sec-head', { text: t('presets') }), grid());
    const right = h('div.lab-right', {},
      section(t('pattern'), patSel, ...cols, mslider('scale', 'scale', 0.05, 12, 0.05), m.pattern !== 'solid' && m.pattern !== 'checker' ? mslider('turb', 'turbulence', 0, 2, 0.01) : null, ...params,
        selectRow({ label: t('mapping'), value: m.mapping, options: [{ value: 'object', label: t('mapObject') }, { value: 'world', label: t('mapWorld') }], onChange: (v) => { app.commit(); set('mapping', v); } })),
      section(t('surface'), mslider('diffusion', 'diffusion'), mslider('ambience', 'ambience', 0, 1.5), mcolor('ambientColor', 'ambColor', true), mslider('specularity', 'specularity'), mslider('highlight', 'highlight'), mcolor('specColor', 'specColor'), mslider('metallicity', 'metallicity'), mslider('bump', 'bump', -2, 2)),
      section(t('optics'), mslider('reflection', 'reflection'), mslider('transparency', 'transparency'), mslider('ior', 'ior', 1, 3), mcolor('transColor', 'transColor'),
        toggleRow({ label: t('fresnel'), value: m.fresnel, onChange: (v) => { app.commit(); set('fresnel', v); } })),
    );
    win.body.append(h('div.lab', {}, left, right));
    win.setTitle(t('matLab') + ' · ' + obj.name);
    drawPreview();
  }

  function load(o) { obj = o; if (win.isOpen) body(); }
  function open(o) { obj = o; win.open(); body(); }
  app.on((k) => {
    if (k === 'select') { const o = app.selected; if (o && o.type !== 'light') { obj = o; if (win.isOpen) body(); } else if (win.isOpen) win.close(); }
    if (k === 'scene' && win.isOpen) { const o = app.selected; if (!o) win.close(); else { obj = o; body(); } }
  });
  return { open, load, sync: () => { if (win.isOpen) { syncers.forEach((f) => f()); schedule(); } }, get isOpen() { return win.isOpen; } };
}

// ---------------------------------------------------------------- Terrain Editor
const GENS = ['mountains', 'alps', 'hills', 'canyon', 'spires', 'dunes', 'island', 'craters', 'volcano', 'ridges', 'flat'];
const FILTERS = [['erode', 'fErode'], ['thermal', 'fThermal'], ['smooth', 'fSmooth'], ['sharpen', 'fSharpen'], ['terrace', 'fTerrace'], ['edges', 'fEdges'], ['square', 'fSquare'], ['power', 'fPower'], ['spikes', 'fSpikes'], ['mounds', 'fMounds'], ['noise', 'fNoise'], ['invert', 'fInvert']];

function terrainLab(app) {
  const win = new FloatWin({ id: 'terrlab', title: t('terrLab'), width: 720, onClose: () => { app.sculpt.on = false; } });
  let obj = null, strength = 0.5, mapImg = null;
  const map = h('canvas.hmap', { width: 512, height: 512 });
  const mctx = map.getContext('2d');

  function redrawMap() {
    if (!obj || !win.isOpen) return;
    const res = obj.terrain.res, hts = obj.terrain.heights, n = res + 1;
    const S = 512;
    if (!mapImg) mapImg = mctx.createImageData(S, S);
    const d = mapImg.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const gx = Math.min(res - 1, Math.floor((x / S) * res)), gz = Math.min(res - 1, Math.floor((y / S) * res));
      const i = gz * n + gx;
      const hh = hts[i];
      const dx = hts[i + 1] - hts[i], dz = hts[i + n] - hts[i];
      const shade = Math.max(0, Math.min(1, 0.6 - (dx * 1.0 + dz * 0.6) * res * 0.6));
      const v = 0.18 + 0.55 * hh + 0.35 * (shade - 0.5);
      const c = Math.max(0, Math.min(255, v * 255));
      const k = (y * S + x) * 4;
      d[k] = c; d[k + 1] = c; d[k + 2] = c * 1.02; d[k + 3] = 255;
    }
    mctx.putImageData(mapImg, 0, 0);
  }

  function apply(o) {
    o.terrain.version++;
    app.renderer.updateTerrainOnly(o);
    app.changed('terrain');
    redrawMap();
  }

  function gen(o, recipe) {
    o.terrain.recipe = recipe;
    o.terrain.heights = generate(o.terrain.res, recipe);
    o.terrain.edited = false;
    apply(o);
    if (win.isOpen && o === obj) body();
  }

  function filter(op) {
    if (!obj) return;
    app.commit();
    const step = { op, amount: strength, seed: Math.floor(Math.random() * 9999) };
    if (!obj.terrain.edited) { obj.terrain.recipe = { ...obj.terrain.recipe, ops: [...(obj.terrain.recipe.ops || []), step] }; obj.terrain.heights = generate(obj.terrain.res, obj.terrain.recipe); }
    else { obj.terrain.heights = obj.terrain.heights.slice(); applyOp(obj.terrain.heights, obj.terrain.res, step); }
    apply(obj);
  }

  function paintBind() {
    let painting = false;
    const at = (e) => { const r = map.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    map.addEventListener('pointerdown', (e) => {
      if (!obj) return;
      app.commit();
      obj.terrain.heights = obj.terrain.heights.slice();
      obj.terrain.edited = true;
      painting = true;
      app.flattenTarget = null;
      map.setPointerCapture(e.pointerId);
      app.interacting++;
      app.sculptAt(obj, at(e));
    });
    map.addEventListener('pointermove', (e) => { if (painting) app.sculptAt(obj, at(e)); });
    const end = () => { if (painting) { painting = false; app.interacting = Math.max(0, app.interacting - 1); app.changed('terrain'); } };
    map.addEventListener('pointerup', end);
    map.addEventListener('pointercancel', end);
  }
  paintBind();

  function body() {
    win.body.innerHTML = '';
    if (!obj) return;
    const r = obj.terrain.recipe;
    const key = (g) => 'g' + g[0].toUpperCase() + g.slice(1);
    const chips = h('div.chips.small', {}, ...GENS.map((g) => {
      const c = h('button.chip.plain' + (r.gen === g && !obj.terrain.edited ? '.on' : ''), { text: t(key(g)) });
      c.addEventListener('click', () => { app.commit(); gen(obj, { ...obj.terrain.recipe, gen: g, ops: defaultOps(g) }); });
      return c;
    }));
    const recSlider = (k, label, min, max, st) => slider({ label: t(label), min, max, step: st, value: r[k] ?? 0.5, onStart: () => app.commit(), onInput: (v) => { clearTimeout(recSlider.tm); recSlider.tm = setTimeout(() => gen(obj, { ...obj.terrain.recipe, [k]: v }), 60); } });
    const filters = h('div.filter-grid', {}, ...FILTERS.map(([op, l]) => btn(t(l), () => filter(op), { cls: 'ghost small' })));
    const brushSeg = segmented({ small: true, value: app.sculpt.mode, options: [['raise', 'bRaise'], ['lower', 'bLower'], ['smooth', 'bSmooth'], ['flatten', 'bFlatten'], ['noise', 'bNoise']].map(([value, l]) => ({ value, label: t(l) })), onChange: (v) => { app.sculpt.mode = v; app.flattenTarget = null; } });
    const resSel = selectRow({ label: t('resolution'), value: obj.terrain.res, options: [128, 256, 512, 1024].map((v) => ({ value: v, label: `${v} × ${v}` })), onChange: (v) => {
      app.commit();
      const nr = +v;
      if (obj.terrain.edited) obj.terrain.heights = resample(obj.terrain.heights, obj.terrain.res, nr);
      obj.terrain.res = nr;
      if (!obj.terrain.edited) obj.terrain.heights = generate(nr, obj.terrain.recipe);
      apply(obj);
      app.changed('scene');
    } });
    const left = h('div.lab-left', {}, h('div.hmap-wrap', {}, map), h('div.row.actions', {},
      btn(t('importImg'), async () => {
        const f = await pickFile('image/*'); if (!f) return;
        const img = new Image(); img.src = URL.createObjectURL(f); await img.decode();
        app.commit();
        obj.terrain.heights = fromImage(img, obj.terrain.res); obj.terrain.edited = true; apply(obj);
      }, { iconName: 'upload', cls: 'ghost small' }),
      btn(t('exportImg'), () => {
        const n = obj.terrain.res + 1, c = document.createElement('canvas'); c.width = c.height = n;
        const id = c.getContext('2d').createImageData(n, n);
        for (let i = 0; i < n * n; i++) { const v = Math.round(obj.terrain.heights[i] * 255); id.data.set([v, v, v, 255], i * 4); }
        c.getContext('2d').putImageData(id, 0, 0);
        c.toBlob((b) => download(b, (obj.name || 'terrain').toLowerCase().replace(/\s+/g, '-') + '-height.png'));
      }, { iconName: 'download', cls: 'ghost small' })));
    const right = h('div.lab-right', {},
      section(t('generator'), chips,
        recSlider('rough', 'roughness', 0, 1, 0.01), recSlider('scale', 'scale', 0.3, 3, 0.01), recSlider('edges', 'fEdges', 0, 1, 0.01),
        h('div.row.actions', {}, btn(t('reroll'), () => { app.commit(); gen(obj, { ...obj.terrain.recipe, seed: Math.floor(Math.random() * 99999) }); }, { iconName: 'dice', cls: 'ghost small' }), resSel)),
      section(t('filters'), slider({ label: t('strength'), value: strength, onInput: (v) => { strength = v; } }), filters),
      section(t('brush'), brushSeg,
        slider({ label: t('brushSize'), min: 0.01, max: 0.4, step: 0.005, value: app.sculpt.size, onInput: (v) => { app.sculpt.size = v; } }),
        slider({ label: t('strength'), value: app.sculpt.strength, onInput: (v) => { app.sculpt.strength = v; } }),
        toggleRow({ label: t('sculptView'), value: app.sculpt.on, onChange: (v) => { app.sculpt.on = v; } })),
    );
    win.body.append(h('div.lab', {}, left, right));
    win.setTitle(t('terrLab') + ' · ' + obj.name);
    redrawMap();
  }

  function open(o) { obj = o; win.open(); body(); }
  app.on((k) => {
    if (k === 'select' || k === 'scene') { const o = app.selected; if (o && o.type === 'terrain') { obj = o; if (win.isOpen) body(); } else if (win.isOpen) win.close(); }
  });
  return { open, generate: gen, redrawMap, get isOpen() { return win.isOpen; } };
}

// ---------------------------------------------------------------- Sky Lab
function skyLab(app) {
  const win = new FloatWin({ id: 'skylab', title: t('skyLab'), width: 380 });
  let syncers = [];
  const sky = () => app.scene.sky;
  const set = (k, v) => { sky()[k] = v; app.changed('sky', { silent: true }); app.panels.sync('sky'); };
  const S = (k, label, min, max, st, fmt) => { const s = slider({ label: t(label), min, max, step: st, value: sky()[k], fmt, onStart: () => app.commit(), onInput: (v) => set(k, v) }); syncers.push(() => s.set(sky()[k])); return s; };
  const C = (k, label) => { const c = colorRow({ label: t(label), value: sky()[k], onStart: () => app.commit(), onInput: (v) => set(k, v) }); syncers.push(() => c.set(sky()[k])); return c; };
  const Tg = (k, label) => { const c = toggleRow({ label: t(label), value: sky()[k], onChange: (v) => { app.commit(); set(k, v); } }); syncers.push(() => c.set(sky()[k])); return c; };

  function body() {
    win.body.innerHTML = '';
    syncers = [];
    const mode = segmented({ small: true, value: sky().mode, options: [['soft', 'mSoft'], ['darker', 'mDarker'], ['custom', 'mCustom'], ['off', 'mOff']].map(([value, l]) => ({ value, label: t(l) })), onChange: (v) => { app.commit(); set('mode', v); body(); } });
    syncers.push(() => mode.set(sky().mode));
    const offX = slider({ label: t('cloudShift') + ' X', min: -20, max: 20, step: 0.01, value: sky().cloudOff[0], onStart: () => app.commit(), onInput: (v) => set('cloudOff', [v, sky().cloudOff[1]]) });
    const offZ = slider({ label: t('cloudShift') + ' Z', min: -20, max: 20, step: 0.01, value: sky().cloudOff[1], onStart: () => app.commit(), onInput: (v) => set('cloudOff', [sky().cloudOff[0], v]) });
    syncers.push(() => { offX.set(sky().cloudOff[0]); offZ.set(sky().cloudOff[1]); });
    const custom = sky().mode === 'custom';
    win.body.append(h('div.lab-col', {},
      section(t('sunMoon'), S('sunAz', 'azimuth', 0, 360, 0.5, (v) => Math.round(v) + '°'), S('sunEl', 'elevation', -40, 90, 0.5, (v) => Math.round(v) + '°'), C('sunColor', 'sunColor'), S('sunPower', 'sunPower', 0, 2, 0.01), S('glow', 'glow', 0, 2, 0.01), S('sunSize', 'sunSize', 0.2, 4, 0.05), Tg('moon', 'moon'), S('moonPhase', 'moonPhase', 0, 1, 0.01)),
      section(t('skySec'), mode, C('skyTint', 'skyTint'), custom ? C('zenith', 'zenith') : null, custom ? C('horizon', 'horizon') : null, custom ? C('sunset', 'sunset') : null, S('curve', 'curve', 0.8, 8, 0.05)),
      section(t('hazeSec'), S('haze', 'haze', 0, 1, 0.01), C('hazeColor', 'hazeColor'), S('fog', 'fog', 0, 1, 0.01), S('fogHeight', 'fogHeight', 0.5, 80, 0.5), C('fogColor', 'fogColor')),
      section(t('cloudSec'), S('clouds', 'clouds', 0, 1, 0.01), S('cover', 'cover', 0, 1, 0.01), S('cloudSoft', 'cloudSoft', 0.05, 0.8, 0.01), S('cloudFreq', 'cloudFreq', 0.2, 4, 0.01), S('cloudAmp', 'cloudAmp', 0, 1.5, 0.01), S('cloudHeight', 'cloudHeight', 100, 4000, 10), C('cloudColor', 'cloudColor'), offX, offZ),
      section(t('lightSec'), S('shadows', 'shadows', 0, 1, 0.01), S('ambient', 'ambient', 0, 1.5, 0.01), C('ambientColor', 'ambColor2')),
      section(t('fxSec'), S('stars', 'stars', 0, 1, 0.01), S('rainbow', 'rainbow', 0, 1, 0.01), S('halo', 'halo', 0, 1, 0.01)),
    ));
  }
  return {
    open: () => { win.open(); body(); },
    sync: () => { if (win.isOpen) syncers.forEach((f) => f()); },
    get isOpen() { return win.isOpen; },
  };
}
