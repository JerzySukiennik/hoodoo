// Hoodoo scene model: objects, materials, packing into GPU tables, save files and undo history.

import { MATERIALS, SCENES, SKIES, PATTERNS } from './presets.js';
import { SKY_DEFAULT } from '../engine/sky.js';
import { hex2rgb, invTRS, uid, len } from '../engine/math.js';
import { generate, encodeHeights, decodeHeights } from '../engine/terrain.js';
import { MAX_OBJ, OBJ_W, MAT_W, PREVIEW_ROW } from '../engine/shader.js';

export const TYPES = {
  sphere: 1, cube: 2, cylinder: 3, cone: 4, torus: 5, pyramid: 6, disc: 7, square: 8, stone: 9, terrain: 10, plane: 11, light: 1,
};

export const CREATE = ['terrain', 'stone', 'sphere', 'cube', 'cylinder', 'cone', 'torus', 'pyramid', 'disc', 'square', 'plane', 'water', 'light'];

export function material(key) {
  const m = MATERIALS[key] || MATERIALS.clay;
  return JSON.parse(JSON.stringify({ ...m, preset: key }));
}

export function makeObject(type, o = {}) {
  const base = {
    id: uid(), type: type === 'water' ? 'plane' : type, name: o.name || defaultName(type),
    pos: o.pos ? [...o.pos] : [0, 0, 0], rot: o.rot ? [...o.rot] : [0, 0, 0], scale: o.scale ? [...o.scale] : [4, 4, 4],
    mat: typeof o.mat === 'object' && o.mat ? JSON.parse(JSON.stringify(o.mat)) : material(o.mat || defaultMat(type)), hidden: !!o.hidden,
  };
  if (base.type === 'stone') { base.seed = o.seed ?? Math.floor(Math.random() * 1000); base.rough = o.rough ?? 1; }
  if (base.type === 'torus') base.minor = o.minor ?? 0.28;
  if (base.type === 'light') { base.color = o.color || '#ffffff'; base.power = o.power ?? 2; base.range = o.range ?? 40; base.visible = o.visible ?? true; base.scale = [1, 1, 1]; }
  if (base.type === 'plane') base.scale = [1, 1, 1];
  if (base.type === 'terrain') {
    const res = o.res || 512;
    base.terrain = { res, recipe: o.recipe || { gen: 'mountains', seed: Math.floor(Math.random() * 9999), rough: 0.5, scale: 1, edges: 0.6 }, heights: null, edited: false, version: 0 };
    if (o.heights) { base.terrain.heights = o.heights; base.terrain.edited = true; }
    if (!o.scale) base.scale = [60, 24, 60];
  }
  return base;
}

function defaultName(type) {
  return { terrain: 'Terrain', stone: 'Rock', sphere: 'Sphere', cube: 'Cube', cylinder: 'Cylinder', cone: 'Cone', torus: 'Torus', pyramid: 'Pyramid', disc: 'Disc', square: 'Square', plane: 'Ground', water: 'Water', light: 'Light' }[type] || type;
}

function defaultMat(type) {
  return { terrain: 'rock', stone: 'granite', plane: 'sand', water: 'water', light: 'glow', sphere: 'chrome', cube: 'ivory', cylinder: 'ivory', cone: 'plastic', torus: 'gold', pyramid: 'sandstone', disc: 'marble', square: 'tiles' }[type] || 'clay';
}

export function ensureHeights(o) {
  if (o.type !== 'terrain') return;
  if (!o.terrain.heights) { o.terrain.heights = generate(o.terrain.res, o.terrain.recipe); o.terrain.version++; }
}

export function buildScene(key) {
  const p = SCENES[key] || SCENES.dawn;
  const sc = {
    version: 1, name: p.name,
    sky: { ...SKY_DEFAULT, ...p.sky },
    camera: { pos: [...p.camera.pos], yaw: p.camera.yaw, pitch: p.camera.pitch, fov: p.camera.fov },
    objects: p.objects.map((o) => makeObject(o.type, o)),
    anim: { duration: 6, fps: 30, tracks: { camera: [], sun: [], objects: {} } },
    render: { size: 'view', quality: 'normal' },
  };
  sc.objects.forEach(ensureHeights);
  return sc;
}

export function matFloats(m, out, off) {
  const a = hex2rgb(m.colorA), b = hex2rgb(m.colorB), c = hex2rgb(m.colorC);
  const amb = m.ambientColor ? hex2rgb(m.ambientColor) : [-1, -1, -1];
  const sp = hex2rgb(m.specColor), tc = hex2rgb(m.transColor);
  const pat = Math.max(0, PATTERNS.indexOf(m.pattern));
  const exp = 2 + Math.pow(1 - m.highlight, 2.2) * 420;
  const v = [
    a[0], a[1], a[2], pat,
    b[0], b[1], b[2], m.scale,
    c[0], c[1], c[2], m.turb,
    amb[0], amb[1], amb[2], m.ambience,
    sp[0], sp[1], sp[2], m.specularity,
    m.diffusion, exp, m.metallicity, m.reflection,
    m.transparency, m.ior, m.bump, m.fresnel ? 1 : 0,
    tc[0], tc[1], tc[2], m.mapping === 'world' ? 1 : 0,
    m.p1, m.p2, m.p3, m.p4,
  ];
  for (let i = 0; i < v.length; i++) out[off + i] = v[i];
}

export function packScene(scene, layerOf) {
  const objData = new Float32Array(MAX_OBJ * OBJ_W * 4);
  const matData = new Float32Array(MAX_OBJ * MAT_W * 4);
  const rows = [];
  const lights = [];
  let n = 0;
  for (const o of scene.objects) {
    if (o.hidden) continue;
    if (o.type === 'light') {
      if (lights.length < 8) {
        const c = hex2rgb(o.color);
        lights.push({ pos: o.pos, range: o.range, col: c.map((v) => v * o.power) });
      }
      if (!o.visible) continue;
    }
    if (n >= PREVIEW_ROW) break;
    writeObject(o, n, objData, matData, layerOf);
    rows.push(o.id);
    n++;
  }
  return { objData, matData, count: n, rows, lights };
}

export function writeObject(o, row, objData, matData, layerOf) {
  const t = TYPES[o.type] || 1;
  const off = row * OBJ_W * 4;
  const scale = o.type === 'light' ? [0.6, 0.6, 0.6] : o.scale;
  const inv = invTRS(o.pos, o.rot, scale);
  const layer = o.type === 'terrain' && layerOf ? layerOf(o) : 0;
  objData[off + 0] = t; objData[off + 1] = o.type === 'light' ? 1 : 0; objData[off + 2] = layer; objData[off + 3] = 0;
  for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) objData[off + 4 + r * 4 + k] = inv[r][k];
  const infinite = o.type === 'plane';
  objData[off + 16] = o.pos[0]; objData[off + 17] = o.pos[1]; objData[off + 18] = o.pos[2];
  objData[off + 19] = infinite ? -1 : len(scale) * 1.02 + 0.01;
  if (o.type === 'torus') objData[off + 20] = o.minor;
  if (o.type === 'stone') { objData[off + 20] = (o.seed % 97) * 0.37; objData[off + 21] = o.rough; }
  if (o.type === 'terrain') { objData[off + 20] = o.terrain.res; objData[off + 21] = Math.round(Math.log2(o.terrain.res)); }
  matFloats(o.type === 'light' ? { ...o.mat, colorA: o.color, ambientColor: o.color, ambience: 1, diffusion: 0, specularity: 0 } : o.mat, matData, row * MAT_W * 4);
}

export function sceneToJSON(scene, withHeights = true) {
  return {
    app: 'hoodoo', version: 1, name: scene.name, sky: scene.sky, camera: scene.camera, anim: scene.anim, render: scene.render,
    objects: scene.objects.map((o) => {
      const c = { ...o };
      if (o.type === 'terrain') {
        c.terrain = { res: o.terrain.res, recipe: o.terrain.recipe, edited: o.terrain.edited };
        if (withHeights && o.terrain.edited && o.terrain.heights) c.terrain.heights = encodeHeights(o.terrain.heights);
      }
      return c;
    }),
  };
}

export function sceneFromJSON(j) {
  const sc = {
    version: 1, name: j.name || 'Untitled', sky: { ...SKY_DEFAULT, ...(j.sky || {}) },
    camera: { pos: [0, 8, 40], yaw: 0, pitch: 0, fov: 50, ...(j.camera || {}) },
    anim: j.anim || { duration: 6, fps: 30, tracks: { camera: [], sun: [], objects: {} } },
    render: j.render || { size: 'view', quality: 'normal' },
    objects: [],
  };
  if (!sc.anim.tracks) sc.anim.tracks = { camera: [], sun: [], objects: {} };
  if (!sc.anim.tracks.objects) sc.anim.tracks.objects = {};
  for (const o of j.objects || []) {
    const x = makeObject(o.type, o);
    x.id = o.id || x.id;
    if (o.mat) x.mat = { ...material(o.mat.preset || 'clay'), ...o.mat };
    if (x.type === 'terrain') {
      const tt = o.terrain || {};
      x.terrain.res = tt.res || o.res || 512;
      x.terrain.recipe = tt.recipe || o.recipe || x.terrain.recipe;
      if (tt.heights) {
        const h = typeof tt.heights === 'string' ? decodeHeights(tt.heights) : tt.heights;
        if (h.length === (x.terrain.res + 1) ** 2) { x.terrain.heights = h; x.terrain.edited = true; }
      }
    }
    ensureHeights(x);
    sc.objects.push(x);
  }
  return sc;
}

export class History {
  constructor(limit = 60) { this.stack = []; this.redoStack = []; this.limit = limit; }
  snap(scene) {
    const heights = new Map();
    for (const o of scene.objects) if (o.type === 'terrain') heights.set(o.id, { h: o.terrain.heights, v: o.terrain.version, res: o.terrain.res, edited: o.terrain.edited });
    return { json: JSON.stringify(sceneToJSON(scene, false)), heights };
  }
  push(scene) {
    this.stack.push(this.snap(scene));
    if (this.stack.length > this.limit) this.stack.shift();
    this.redoStack.length = 0;
  }
  restore(s) {
    const sc = sceneFromJSONLight(JSON.parse(s.json), s.heights);
    return sc;
  }
  undo(scene) {
    if (!this.stack.length) return null;
    this.redoStack.push(this.snap(scene));
    return this.restore(this.stack.pop());
  }
  redo(scene) {
    if (!this.redoStack.length) return null;
    this.stack.push(this.snap(scene));
    return this.restore(this.redoStack.pop());
  }
}

function sceneFromJSONLight(j, heights) {
  const objs = j.objects;
  j.objects = [];
  const sc = sceneFromJSON(j);
  for (const o of objs) {
    const x = { ...o };
    if (o.type === 'terrain') {
      const hh = heights.get(o.id);
      x.terrain = { res: o.terrain.res, recipe: o.terrain.recipe, edited: hh ? hh.edited : o.terrain.edited, heights: hh ? hh.h : null, version: hh ? hh.v : 0 };
      if (!x.terrain.heights) ensureHeights(x);
    }
    sc.objects.push(x);
  }
  return sc;
}

export { SKIES, MATERIALS, SCENES };
