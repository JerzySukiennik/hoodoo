// Hoodoo app core: boot, scene state, render loop (preview, refine, final), camera navigation, gizmos and shortcuts.

import { Renderer, QUALITY, RENDER_SAMPLES } from './engine/renderer.js';
import { buildScene, makeObject, History, ensureHeights, sceneFromJSON, sceneToJSON } from './scene/scene.js';
import { camBasis, DEG, add, sub, mul, dot, norm, cross, len, localToWorld, rotMatrix, mv3, clamp } from './engine/math.js';
import { brush, sampleHeight } from './engine/terrain.js';
import { applyAnimation, hasAnimation, keyCamera, keyObject, keySun } from './anim/anim.js';
import { autosave, loadAutosave } from './storage.js';
import { t } from './ui/i18n.js';
import { toast } from './ui/dom.js';
import { buildPanels } from './ui/panels.js';
import { buildLabs } from './ui/labs.js';
import { buildTimeline } from './ui/timeline.js';
import { buildRenderUI } from './ui/render-ui.js';

const PIXEL_CAP = 2.6e6;
export const SIZES = {
  view: null, '1280x720': [1280, 720], '1920x1080': [1920, 1080], '2560x1440': [2560, 1440], '3840x2160': [3840, 2160],
  '2048x2048': [2048, 2048], '1080x1350': [1080, 1350], '1080x1920': [1080, 1920],
};

class App {
  constructor() {
    this.canvas = document.getElementById('view');
    this.overlay = document.getElementById('overlay');
    this.octx = this.overlay.getContext('2d');
    this.renderer = new Renderer(this.canvas);
    this.history = new History();
    this.sel = null;
    this.tool = 'move';
    this.scale = 0.6;
    this.time = 0;
    this.playing = false;
    this.mode = 'edit';
    this.dirtyScene = true;
    this.dirtyView = true;
    this.interacting = 0;
    this.refineAt = 0;
    this.hover = null;
    this.drag = null;
    this.pivotDist = 60;
    this.sculpt = { on: false, mode: 'raise', size: 0.08, strength: 0.5 };
    this.listeners = new Set();
  }

  async boot() {
    try {
      await this.renderer.init();
    } catch (e) {
      document.getElementById('boot-msg').textContent = t('webgl') + ' ' + (e.message || e);
      document.getElementById('boot').classList.add('err');
      return;
    }
    const q = new URLSearchParams(location.search);
    this.scene = (!q.get('scene') && await loadAutosave()) || buildScene(q.get('scene') || 'dawn');
    this.resize();
    this.panels = buildPanels(this);
    this.labs = buildLabs(this);
    this.timeline = buildTimeline(this);
    this.renderUI = buildRenderUI(this);
    this.bindViewport();
    this.bindKeys();
    addEventListener('resize', () => { this.resize(); this.changed('view'); });
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); toast(t('gpuLost')); });
    this.canvas.addEventListener('webglcontextrestored', async () => { this.renderer = new Renderer(this.canvas); await this.renderer.init(); this.changed('scene'); });
    this.emit('scene');
    this.changed('scene');
    document.getElementById('boot').classList.add('gone');
    document.body.classList.add('ready');
    window.HOODOO = this;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind) { for (const fn of this.listeners) fn(kind); }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    let dpr = Math.min(devicePixelRatio || 1, 2);
    if (r.width * r.height * dpr * dpr > PIXEL_CAP) dpr = Math.sqrt(PIXEL_CAP / (r.width * r.height));
    this.dpr = dpr;
    this.cssW = r.width; this.cssH = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    const od = devicePixelRatio || 1;
    this.overlay.width = Math.round(r.width * od);
    this.overlay.height = Math.round(r.height * od);
    this.odpr = od;
  }

  // ------------------------------------------------------------ state changes
  get selected() { return this.scene.objects.find((o) => o.id === this.sel) || null; }

  select(id) {
    this.sel = id;
    this.emit('select');
    this.drawOverlay();
  }

  commit() { this.history.push(this.scene); }

  changed(kind = 'scene', opts = {}) {
    if (kind === 'view') this.dirtyView = true;
    else this.dirtyScene = true;
    if (kind === 'camera' && this.timeline && this.timeline.autoKey && !this.playing) keyCamera(this.scene, this.time);
    if (!opts.silent) this.emit(kind);
    if (kind !== 'view' && kind !== 'camera') this.scheduleSave();
    if (kind === 'camera') this.scheduleSave();
    this.request();
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => autosave(this.scene), 1500);
  }

  setScene(sc, { keepHistory = true } = {}) {
    if (keepHistory) this.commit();
    this.scene = sc;
    this.sel = null;
    this.time = 0;
    this.emit('scene');
    this.changed('scene');
  }

  undo() { const s = this.history.undo(this.scene); if (s) { this.scene = s; if (!this.selected) this.sel = null; this.emit('scene'); this.changed('scene'); } }
  redo() { const s = this.history.redo(this.scene); if (s) { this.scene = s; if (!this.selected) this.sel = null; this.emit('scene'); this.changed('scene'); } }

  // ------------------------------------------------------------ render loop
  request() { if (!this.raf) this.raf = requestAnimationFrame((n) => this.frame(n)); }

  frame(now) {
    this.raf = 0;
    const r = this.renderer;
    if (this.mode === 'render' || this.mode === 'film') {
      if (this.mode === 'render' && r.job && !r.job.done) { r.stepJob(26); r.showJob(); this.renderUI.update(); this.request(); }
      else if (this.mode === 'render') { r.showJob(); this.renderUI.update(); }
      return;
    }
    if (this.playing) {
      const dt = this.lastPlay ? (now - this.lastPlay) / 1000 : 0;
      this.lastPlay = now;
      this.time += dt;
      if (this.time > this.scene.anim.duration) this.time = 0;
      applyAnimation(this.scene, this.time);
      this.dirtyScene = true;
      this.timeline.update();
    }
    if (this.dirtyScene) {
      r.time = this.time;
      r.setScene(this.scene);
      this.dirtyScene = false;
      this.dirtyView = true;
    }
    if (this.dirtyView) {
      if (r.job) r.endJob();
      const dt = r.drawPreview(this.scene.camera, this.scale);
      const target = this.playing ? 34 : 28;
      this.scale = clamp(this.scale * Math.sqrt(target / Math.max(dt, 1)), 0.25, 1);
      this.dirtyView = false;
      this.drawOverlay();
      this.refineAt = now + (this.playing ? 1e9 : 200);
      this.request();
      return;
    }
    if (this.refineAt && now >= this.refineAt && !this.interacting && !this.playing) {
      this.refineAt = 0;
      const W = this.canvas.width, H = this.canvas.height;
      r.ensurePreview(W, H);
      r.startJob(this.scene.camera, {
        width: W, height: H, samples: 4, bryce: false, quality: QUALITY.still, kind: 'still', targets: r.still, tile: 128,
        backdrop: { t: r.preview, scale: [Math.round(W * this.scale) / r.preview.w, Math.round(H * this.scale) / r.preview.h] },
      });
    }
    if (r.job && !r.job.done) { r.stepJob(16); r.showJob(); this.request(); }
    else if (r.job && r.job.done && !r.job.shown) { r.showJob(); r.job.shown = true; }
    else if (this.refineAt) this.request();
  }

  // ------------------------------------------------------------ camera math
  basis() { return camBasis(this.scene.camera); }

  project(p) {
    const c = this.scene.camera, b = this.basis();
    const v = sub(p, c.pos);
    const z = dot(v, b.fwd);
    if (z <= 0.05) return null;
    const th = Math.tan(c.fov * DEG / 2), asp = this.cssW / this.cssH;
    const x = dot(v, b.right) / (z * th * asp), y = dot(v, b.up) / (z * th);
    return [(x * 0.5 + 0.5) * this.cssW, (0.5 - y * 0.5) * this.cssH, z];
  }

  rayAt(sx, sy) {
    const c = this.scene.camera, b = this.basis();
    const th = Math.tan(c.fov * DEG / 2), asp = this.cssW / this.cssH;
    const nx = (sx / this.cssW) * 2 - 1, ny = 1 - (sy / this.cssH) * 2;
    return norm(add(b.fwd, add(mul(b.right, nx * th * asp), mul(b.up, ny * th))));
  }

  pickAt(sx, sy, ignore = -1) {
    const r = this.renderer;
    if (this.dirtyScene) { r.setScene(this.scene); this.dirtyScene = false; }
    return r.pick(this.scene.camera, sx * this.dpr, sy * this.dpr, this.canvas.width, this.canvas.height, ignore);
  }

  groundUnder(x, z, ignoreId) {
    const r = this.renderer;
    if (this.dirtyScene) { r.setScene(this.scene); this.dirtyScene = false; }
    const row = ignoreId ? r.rows.indexOf(ignoreId) : -1;
    const hit = r.pickRay(this.scene.camera, [x, 20000, z], [0, -1, 0], row);
    return hit ? 20000 - hit.t : 0;
  }

  bottomOffset(o) {
    const sy = o.scale[1];
    switch (o.type) {
      case 'terrain': case 'disc': case 'square': case 'plane': return 0;
      case 'torus': return -o.minor * sy;
      case 'stone': return -0.72 * sy;
      case 'light': return -1;
      default: return -sy;
    }
  }

  land(o = this.selected) {
    if (!o || o.type === 'plane') return;
    const g = this.groundUnder(o.pos[0], o.pos[2], o.id);
    const R = rotMatrix(o.rot);
    let off = this.bottomOffset(o);
    if (o.rot.some((v) => Math.abs(v) > 0.1) && o.type !== 'terrain') {
      const s = o.scale;
      off = -Math.abs(R[1][0] * s[0]) - Math.abs(R[1][1] * s[1]) - Math.abs(R[1][2] * s[2]);
      if (o.type === 'sphere') off = -Math.max(...s);
    }
    o.pos = [o.pos[0], g - off + (o.type === 'stone' ? -0.08 * o.scale[1] : 0), o.pos[2]];
    this.changed('object');
  }

  focus(o = this.selected) {
    if (!o) return;
    const c = this.scene.camera, b = this.basis();
    const rad = o.type === 'plane' ? 20 : Math.max(...o.scale) * (o.type === 'terrain' ? 1.2 : 1.6);
    const center = o.type === 'terrain' ? add(o.pos, [0, o.scale[1] * 0.4, 0]) : o.pos;
    const d = rad / Math.tan(c.fov * DEG / 2) * 1.2;
    c.pos = sub(center, mul(b.fwd, d));
    this.pivotDist = d;
    this.changed('camera');
  }

  add(type) {
    if (this.scene.objects.length >= 62) { toast(t('tooMany'), 'err'); return; }
    this.commit();
    const c = this.scene.camera, b = this.basis();
    const hit = this.pickAt(this.cssW / 2, this.cssH / 2);
    let p, dist;
    if (hit && hit.t < 3000) { dist = hit.t; p = add(c.pos, mul(this.rayAt(this.cssW / 2, this.cssH / 2), hit.t)); }
    else { dist = 40; p = add(c.pos, mul([b.fwd[0], 0, b.fwd[2]], 40 / Math.max(0.2, Math.hypot(b.fwd[0], b.fwd[2])))); p[1] = 0; }
    const s = Math.max(0.5, dist * 0.06);
    const opts = { pos: p, scale: [s, s, s] };
    if (type === 'terrain') { opts.scale = [dist * 0.5, dist * 0.18, dist * 0.5]; opts.pos = [p[0], 0, p[2] - dist * 0.25]; }
    if (type === 'cylinder' || type === 'cone') opts.scale = [s * 0.6, s, s * 0.6];
    if (type === 'stone') opts.scale = [s, s * 0.7, s * 0.85];
    if (type === 'light') opts.pos = add(p, [0, s * 3, 0]);
    if (type === 'water') opts.pos = [0, Math.min(p[1] + 0.5, 0.5), 0];
    if (type === 'plane') opts.pos = [0, 0, 0];
    const o = makeObject(type, opts);
    ensureHeights(o);
    this.scene.objects.push(o);
    this.sel = o.id;
    this.renderer.setScene(this.scene);
    if (type !== 'light' && type !== 'water' && type !== 'plane') this.land(o);
    this.emit('scene');
    this.emit('select');
    this.changed('object');
  }

  remove(o = this.selected) {
    if (!o) return;
    this.commit();
    this.scene.objects = this.scene.objects.filter((x) => x !== o);
    delete this.scene.anim.tracks.objects[o.id];
    this.sel = null;
    this.emit('scene');
    this.emit('select');
    this.changed('object');
  }

  duplicate(o = this.selected) {
    if (!o) return;
    if (this.scene.objects.length >= 62) { toast(t('tooMany'), 'err'); return; }
    this.commit();
    const j = sceneToJSON({ ...this.scene, objects: [o] }, true).objects[0];
    const sc = sceneFromJSON({ objects: [j] });
    const c = sc.objects[0];
    c.id = Math.random().toString(36).slice(2, 9);
    c.name = o.name + ' 2';
    if (o.type === 'terrain' && o.terrain.heights) { c.terrain.heights = o.terrain.heights.slice(); c.terrain.edited = o.terrain.edited; }
    c.pos = add(o.pos, [Math.max(...o.scale) * 2.2, 0, 0]);
    this.scene.objects.push(c);
    this.sel = c.id;
    this.emit('scene');
    this.emit('select');
    this.changed('object');
  }

  addKey() {
    const o = this.selected;
    if (o) keyObject(this.scene, o, this.time);
    else keyCamera(this.scene, this.time);
    this.emit('anim');
    this.scheduleSave();
  }

  addSunKey() { keySun(this.scene, this.time); this.emit('anim'); this.scheduleSave(); }

  setTime(tm) {
    this.time = clamp(tm, 0, this.scene.anim.duration);
    if (hasAnimation(this.scene)) { applyAnimation(this.scene, this.time); this.emit('object'); this.changed('scene', { silent: true }); }
    this.timeline.update();
  }

  play(on = !this.playing) {
    this.playing = on && hasAnimation(this.scene);
    this.lastPlay = 0;
    this.timeline.update();
    if (!this.playing) this.changed('view');
    this.request();
  }

  // ------------------------------------------------------------ viewport input
  bindViewport() {
    const el = this.overlay;
    const pointers = new Map();
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'edit') return;
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
      if (pointers.size === 2) { this.drag = { kind: 'pinch', last: [...pointers.values()] }; return; }
      const x = e.offsetX, y = e.offsetY;
      const g = e.button === 0 && !e.shiftKey ? this.gizmoHit(x, y) : null;
      if (g) {
        this.commit();
        this.drag = { kind: 'gizmo', g, x0: x, y0: y, o: this.selected, start: JSON.parse(JSON.stringify({ pos: this.selected.pos, rot: this.selected.rot, scale: this.selected.scale })) };
        this.interacting++;
        return;
      }
      if (e.button === 0 && !e.shiftKey && this.sculpt.on && this.labs.terrain.isOpen) {
        const o = this.selected;
        if (o && o.type === 'terrain') {
          const hit = this.pickAt(x, y);
          if (hit && hit.id === o.id) {
            this.commit();
            o.terrain.heights = o.terrain.heights.slice();
            o.terrain.edited = true;
            this.drag = { kind: 'sculpt', o };
            this.interacting++;
            this.sculptAt(o, hit.uv);
            return;
          }
        }
      }
      const pan = e.button === 2 || e.button === 1 || e.shiftKey;
      this.drag = { kind: pan ? 'pan' : 'orbit', x0: x, y0: y, lx: x, ly: y, moved: false, button: e.button };
    });
    el.addEventListener('pointermove', (e) => {
      const x = e.offsetX, y = e.offsetY;
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [x, y]);
      const d = this.drag;
      if (!d) {
        if (this.mode === 'edit') { const g = this.gizmoHit(x, y); const k = g ? g.axis + g.kind : null; if (k !== this.hover) { this.hover = k; el.style.cursor = g ? 'grab' : ''; this.drawOverlay(); } }
        return;
      }
      if (d.kind === 'pinch') {
        if (pointers.size < 2) return;
        const [a, b] = [...pointers.values()];
        const [a0, b0] = d.last;
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1]), dist0 = Math.hypot(a0[0] - b0[0], a0[1] - b0[1]);
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mx0 = (a0[0] + b0[0]) / 2, my0 = (a0[1] + b0[1]) / 2;
        this.dolly(mx, my, (dist - dist0) * 0.01);
        this.panBy(mx - mx0, my - my0);
        d.last = [a, b];
        return;
      }
      if (d.kind === 'gizmo') { this.gizmoDrag(d, x, y); return; }
      if (d.kind === 'sculpt') { const hit = this.pickAt(x, y); if (hit && hit.id === d.o.id) this.sculptAt(d.o, hit.uv); return; }
      const dx = x - d.lx, dy = y - d.ly;
      if (!d.moved && Math.hypot(x - d.x0, y - d.y0) < 3) return;
      if (!d.moved) {
        d.moved = true;
        this.interacting++;
        if (d.kind === 'orbit') {
          const hit = this.pickAt(d.x0, d.y0);
          const c = this.scene.camera;
          const dist = hit && hit.t < 5000 ? hit.t : this.pivotDist;
          d.pivot = add(c.pos, mul(this.rayAt(d.x0, d.y0), dist));
          this.pivotDist = dist;
        }
      }
      d.lx = x; d.ly = y;
      if (d.kind === 'orbit') this.orbit(d.pivot, dx, dy);
      else this.panBy(dx, dy);
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      const d = this.drag;
      if (!d) return;
      if (d.kind === 'pinch') { if (pointers.size < 2) this.drag = null; return; }
      this.drag = null;
      if (d.kind === 'gizmo' || d.kind === 'sculpt') { this.interacting = Math.max(0, this.interacting - 1); if (d.kind === 'gizmo' && this.timeline.autoKey) keyObject(this.scene, d.o, this.time); this.emit('object'); this.changed('object'); return; }
      if (d.moved) { this.interacting = Math.max(0, this.interacting - 1); this.changed('camera'); return; }
      if (d.button === 0 && this.mode === 'edit') {
        const hit = this.pickAt(d.x0, d.y0);
        const lightHit = this.lightAt(d.x0, d.y0);
        this.select(lightHit ? lightHit.id : hit ? hit.id : null);
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      if (this.mode !== 'edit') return;
      e.preventDefault();
      const x = e.offsetX, y = e.offsetY;
      const trackpad = e.deltaMode === 0 && (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) < 40) && !e.ctrlKey;
      if (e.ctrlKey) this.dolly(x, y, -e.deltaY * 0.012);
      else if (e.shiftKey) this.panBy(-e.deltaX, -e.deltaY);
      else if (trackpad) {
        if (!this.wheelPivot || performance.now() - this.wheelPivotT > 400) {
          const hit = this.pickAt(this.cssW / 2, this.cssH / 2);
          const c = this.scene.camera;
          const dist = hit && hit.t < 5000 ? hit.t : this.pivotDist;
          this.wheelPivot = add(c.pos, mul(this.basis().fwd, dist));
        }
        this.wheelPivotT = performance.now();
        this.orbit(this.wheelPivot, -e.deltaX * 0.6, -e.deltaY * 0.6);
      } else this.dolly(x, y, -Math.sign(e.deltaY) * 0.12);
      this.interacting++;
      clearTimeout(this.wheelEnd);
      this.wheelEnd = setTimeout(() => { this.interacting = Math.max(0, this.interacting - 1); this.changed('camera'); }, 160);
    }, { passive: false });
  }

  orbit(pivot, dx, dy) {
    const c = this.scene.camera;
    const dyaw = dx * 0.25, dpitch = -dy * 0.2;
    let off = sub(c.pos, pivot);
    const rotY = (v, a) => { const ca = Math.cos(a), sa = Math.sin(a); return [v[0] * ca - v[2] * sa, v[1], v[0] * sa + v[2] * ca]; };
    off = rotY(off, dyaw * DEG);
    let np = clamp(c.pitch + dpitch, -89, 89);
    const realP = np - c.pitch;
    c.yaw += dyaw;
    const b = camBasis(c);
    const k = b.right, a = -realP * DEG;
    const ca = Math.cos(a), sa = Math.sin(a);
    off = add(add(mul(off, ca), mul(cross(k, off), sa)), mul(k, dot(k, off) * (1 - ca)));
    c.pitch = np;
    c.pos = add(pivot, off);
    this.changed('camera', { silent: true });
  }

  panBy(dx, dy) {
    const c = this.scene.camera, b = this.basis();
    const s = this.pivotDist * 2 * Math.tan(c.fov * DEG / 2) / this.cssH;
    c.pos = add(c.pos, add(mul(b.right, -dx * s), mul(b.up, dy * s)));
    this.changed('camera', { silent: true });
  }

  dolly(x, y, amt) {
    const c = this.scene.camera;
    const hit = this.pickAt(x, y);
    const dist = hit && hit.t < 5000 ? hit.t : this.pivotDist;
    const step = clamp(dist * amt, -dist * 0.8, dist * 0.6);
    c.pos = add(c.pos, mul(this.rayAt(x, y), step));
    this.pivotDist = Math.max(1, dist - step);
    this.changed('camera', { silent: true });
  }

  sculptAt(o, uv) {
    const res = o.terrain.res;
    const s = this.sculpt;
    let target = 0.5;
    if (s.mode === 'flatten') target = this.flattenTarget ?? (this.flattenTarget = sampleHeight(o.terrain.heights, res, uv[0], uv[1]));
    brush(o.terrain.heights, res, uv[0] * res, uv[1] * res, s.size * res * 0.5, s.strength, s.mode, target);
    o.terrain.version++;
    this.renderer.updateTerrainOnly(o);
    this.changed('view');
    this.labs.terrain.redrawMap();
  }

  lightAt(x, y) {
    for (const o of this.scene.objects) {
      if (o.type !== 'light' || o.hidden) continue;
      const p = this.project(o.pos);
      if (p && Math.hypot(p[0] - x, p[1] - y) < 12) return o;
    }
    return null;
  }

  // ------------------------------------------------------------ gizmo
  gizmoFrame(o) {
    const center = o.type === 'terrain' ? add(o.pos, [0, o.scale[1] * 0.5, 0]) : o.pos;
    const p = this.project(center);
    if (!p) return null;
    const size = p[2] * Math.tan(this.scene.camera.fov * DEG / 2) * 2 * (78 / this.cssH);
    return { center, p, size };
  }

  gizmoHit(x, y) {
    const o = this.selected;
    if (!o || this.mode !== 'edit') return null;
    const f = this.gizmoFrame(o);
    if (!f) return null;
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    if (this.tool === 'rotate' && o.type !== 'light' && o.type !== 'plane') {
      let best = null;
      axes.forEach((ax, i) => {
        const pts = this.ringPoints(f.center, ax, f.size);
        for (let k = 0; k < pts.length - 1; k++) {
          const a = pts[k], b = pts[k + 1];
          if (!a || !b) continue;
          const d = segDist(x, y, a, b);
          if (d < 7 && (!best || d < best.d)) best = { d, axis: i, kind: 'rot' };
        }
      });
      return best;
    }
    if (Math.hypot(x - f.p[0], y - f.p[1]) < 9) return { axis: 3, kind: this.tool === 'scale' ? 'uni' : 'plane' };
    let best = null;
    axes.forEach((ax, i) => {
      if (o.type === 'plane' && i !== 1) return;
      const e = this.project(add(f.center, mul(ax, f.size)));
      if (!e) return;
      const d = segDist(x, y, f.p, e);
      if (d < 8 && (!best || d < best.d)) best = { d, axis: i, kind: this.tool === 'scale' ? 'scale' : 'move' };
    });
    return best;
  }

  ringPoints(c, ax, r) {
    const u = Math.abs(ax[1]) > 0.5 ? [1, 0, 0] : [0, 1, 0];
    const a = norm(cross(ax, u)), b = cross(ax, a);
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      pts.push(this.project(add(c, add(mul(a, Math.cos(t) * r), mul(b, Math.sin(t) * r)))));
    }
    return pts;
  }

  gizmoDrag(d, x, y) {
    const o = d.o, g = d.g, s0 = d.start;
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const c = this.scene.camera;
    if (g.kind === 'move') {
      const ax = axes[g.axis];
      const t0 = closestOnAxis(c.pos, this.rayAt(d.x0, d.y0), s0.pos, ax);
      const t1 = closestOnAxis(c.pos, this.rayAt(x, y), s0.pos, ax);
      o.pos = add(s0.pos, mul(ax, t1 - t0));
    } else if (g.kind === 'plane') {
      const hy = o.type === 'terrain' ? s0.pos[1] + o.scale[1] * 0.5 : s0.pos[1];
      const hitP = (sx, sy) => { const r = this.rayAt(sx, sy); if (Math.abs(r[1]) < 1e-4) return null; const tt = (hy - c.pos[1]) / r[1]; return tt > 0 ? add(c.pos, mul(r, tt)) : null; };
      const a = hitP(d.x0, d.y0), b = hitP(x, y);
      if (a && b) o.pos = [s0.pos[0] + b[0] - a[0], s0.pos[1], s0.pos[2] + b[2] - a[2]];
    } else if (g.kind === 'rot') {
      const f = this.gizmoFrame(o);
      const a0 = Math.atan2(d.y0 - f.p[1], d.x0 - f.p[0]), a1 = Math.atan2(y - f.p[1], x - f.p[0]);
      const toCam = sub(c.pos, f.center);
      const sgn = dot(toCam, axes[g.axis]) > 0 ? -1 : 1;
      const rot = [...s0.rot];
      rot[g.axis] = s0.rot[g.axis] + sgn * (a1 - a0) / DEG;
      o.rot = rot;
    } else if (g.kind === 'scale') {
      const f = this.gizmoFrame(o);
      const e = this.project(add(f.center, mul(axes[g.axis], f.size)));
      const dir = [e[0] - f.p[0], e[1] - f.p[1]];
      const L = Math.hypot(dir[0], dir[1]) || 1;
      const proj = ((x - d.x0) * dir[0] + (y - d.y0) * dir[1]) / L;
      const k = Math.max(0.02, 1 + proj / L);
      const sc = [...s0.scale];
      sc[g.axis] = s0.scale[g.axis] * k;
      o.scale = sc;
    } else if (g.kind === 'uni') {
      const k = Math.max(0.02, Math.exp(-(y - d.y0) * 0.01));
      o.scale = s0.scale.map((v) => v * k);
    }
    this.emit('object');
    this.changed('object', { silent: true });
  }

  drawOverlay() {
    const g = this.octx, dpr = this.odpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.cssW, this.cssH);
    if (this.mode !== 'edit') return;
    const size = SIZES[this.scene.render.size];
    if (size) {
      const ao = size[0] / size[1], av = this.cssW / this.cssH;
      let w = this.cssW, h = this.cssH;
      if (ao > av) h = w / ao; else w = h * ao;
      const x0 = (this.cssW - w) / 2, y0 = (this.cssH - h) / 2;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, 0, this.cssW, y0); g.fillRect(0, y0 + h, this.cssW, this.cssH - y0 - h);
      g.fillRect(0, y0, x0, h); g.fillRect(x0 + w, y0, this.cssW - x0 - w, h);
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    }
    for (const o of this.scene.objects) {
      if (o.type !== 'light' || o.hidden) continue;
      const p = this.project(o.pos);
      if (!p) continue;
      g.strokeStyle = o.id === this.sel ? '#ff9f0a' : 'rgba(255,255,255,0.8)';
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(p[0], p[1], 6, 0, Math.PI * 2); g.stroke();
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.beginPath(); g.moveTo(p[0] + Math.cos(a) * 9, p[1] + Math.sin(a) * 9); g.lineTo(p[0] + Math.cos(a) * 12, p[1] + Math.sin(a) * 12); g.stroke(); }
    }
    const o = this.selected;
    if (!o) return;
    const box = this.boxCorners(o);
    if (box) {
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 1;
      const E = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      g.beginPath();
      for (const [a, b] of E) { const pa = box[a], pb = box[b]; if (pa && pb) { g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pb[1]); } }
      g.stroke();
    }
    const f = this.gizmoFrame(o);
    if (!f) return;
    const cols = ['#ffd426', '#34c759', '#4da3ff'];
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    if (this.tool === 'rotate' && o.type !== 'light' && o.type !== 'plane') {
      axes.forEach((ax, i) => {
        const pts = this.ringPoints(f.center, ax, f.size);
        g.strokeStyle = this.hover === i + 'rot' ? '#ffffff' : cols[i];
        g.lineWidth = this.hover === i + 'rot' ? 2.5 : 1.6;
        g.beginPath();
        let started = false;
        for (const p of pts) { if (!p) { started = false; continue; } if (!started) { g.moveTo(p[0], p[1]); started = true; } else g.lineTo(p[0], p[1]); }
        g.stroke();
      });
      return;
    }
    axes.forEach((ax, i) => {
      if (o.type === 'plane' && i !== 1) return;
      const e = this.project(add(f.center, mul(ax, f.size)));
      if (!e) return;
      const hov = this.hover === i + (this.tool === 'scale' ? 'scale' : 'move');
      g.strokeStyle = g.fillStyle = hov ? '#ffffff' : cols[i];
      g.lineWidth = hov ? 2.5 : 1.8;
      g.beginPath(); g.moveTo(f.p[0], f.p[1]); g.lineTo(e[0], e[1]); g.stroke();
      const ang = Math.atan2(e[1] - f.p[1], e[0] - f.p[0]);
      if (this.tool === 'scale') { g.fillRect(e[0] - 4, e[1] - 4, 8, 8); }
      else { g.beginPath(); g.moveTo(e[0] + Math.cos(ang) * 9, e[1] + Math.sin(ang) * 9); g.lineTo(e[0] + Math.cos(ang + 2.5) * 6, e[1] + Math.sin(ang + 2.5) * 6); g.lineTo(e[0] + Math.cos(ang - 2.5) * 6, e[1] + Math.sin(ang - 2.5) * 6); g.closePath(); g.fill(); }
    });
    const hc = this.hover === '3plane' || this.hover === '3uni';
    g.strokeStyle = hc ? '#ffffff' : 'rgba(255,255,255,0.9)';
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(f.p[0], f.p[1], 6, 0, Math.PI * 2); g.fill(); g.stroke();
  }

  boxCorners(o) {
    if (o.type === 'plane' || o.type === 'light') return null;
    let y0 = -1, y1 = 1;
    if (o.type === 'terrain') { y0 = 0; y1 = 1; }
    if (o.type === 'torus') { y0 = -o.minor; y1 = o.minor; }
    if (o.type === 'disc' || o.type === 'square') { y0 = 0; y1 = 0; }
    const pts = [];
    for (const z of [-1, 1]) for (const y of [y0, y1]) for (const x of [-1, 1]) pts.push(this.project(localToWorld(o, [x, y, z])));
    return [pts[0], pts[1], pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]];
  }

  // ------------------------------------------------------------ final render
  outputSize() {
    const s = SIZES[this.scene.render.size];
    return s ? [...s] : [this.canvas.width, this.canvas.height];
  }

  renderCamera(w, h) {
    const c = JSON.parse(JSON.stringify(this.scene.camera));
    const ao = w / h, av = this.cssW / this.cssH;
    if (ao > av) c.fov = 2 * Math.atan(Math.tan(c.fov * DEG / 2) * av / ao) / DEG;
    return c;
  }

  startRender() {
    if (this.mode !== 'edit') return;
    this.play(false);
    const r = this.renderer;
    if (r.job) r.endJob();
    if (this.dirtyScene) { r.setScene(this.scene); this.dirtyScene = false; }
    const [w, h] = this.outputSize();
    const samples = RENDER_SAMPLES[this.scene.render.quality] || 4;
    this.mode = 'render';
    this.drawOverlay();
    this.renderStart = performance.now();
    r.startJob(this.renderCamera(w, h), { width: w, height: h, samples, bryce: true, quality: QUALITY.final, kind: 'final', tile: 64 });
    this.renderUI.show();
    this.request();
  }

  stopRender() {
    const r = this.renderer;
    if (r.job && !r.job.done) { r.job.done = true; r.job.final = r.job.lastShown && r.job.lastShown.block === 1 ? r.job.lastShown.tex : null; if (!r.job.final) { this.closeRender(); return; } }
    this.renderUI.update();
  }

  closeRender() {
    const r = this.renderer;
    if (r.job && r.job.done && r.job.final) this.keepLast(r.job);
    if (r.job) r.endJob();
    this.mode = 'edit';
    this.renderUI.hide();
    this.changed('view');
  }

  keepLast(job) {
    try { this.lastRender = { image: this.renderer.readTarget(job.final), name: this.scene.name }; } catch (e) { this.lastRender = null; }
  }

  // ------------------------------------------------------------ keys
  bindKeys() {
    addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) && !(e.metaKey || e.ctrlKey)) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); this.redo(); return; }
      if (mod && (k === 'enter' || k === 'r')) { e.preventDefault(); this.startRender(); return; }
      if (mod && k === 'k') { e.preventDefault(); this.renderUI.openAI(); return; }
      if (mod && k === 's') { e.preventDefault(); this.panels.saveFile(); return; }
      if (mod && k === 'o') { e.preventDefault(); this.panels.openFile(); return; }
      if (mod && k === 'd') { e.preventDefault(); this.duplicate(); return; }
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (k === 'escape') { if (this.mode === 'render') this.closeRender(); else this.select(null); return; }
      if (this.mode !== 'edit') return;
      if (k === 'backspace' || k === 'delete') { e.preventDefault(); this.remove(); return; }
      if (k === 'w') this.setTool('move');
      else if (k === 'e') this.setTool('rotate');
      else if (k === 'r') this.setTool('scale');
      else if (k === 'f') this.focus();
      else if (k === 'l') this.land();
      else if (k === 'h' && this.selected) { this.commit(); this.selected.hidden = !this.selected.hidden; this.emit('scene'); this.changed('object'); }
      else if (k === 'k') this.addKey();
      else if (k === ' ') { e.preventDefault(); this.play(); }
    });
  }

  setTool(tl) { this.tool = tl; this.emit('tool'); this.drawOverlay(); }
}

function segDist(px, py, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const l2 = vx * vx + vy * vy || 1;
  const tt = clamp(((px - a[0]) * vx + (py - a[1]) * vy) / l2, 0, 1);
  return Math.hypot(px - (a[0] + vx * tt), py - (a[1] + vy * tt));
}

function closestOnAxis(ro, rd, p, ax) {
  const w0 = sub(ro, p);
  const a = dot(rd, rd), b = dot(rd, ax), c = dot(ax, ax), d = dot(rd, w0), e = dot(ax, w0);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-9) return 0;
  return (a * e - b * d) / den;
}

const app = new App();
app.boot();
