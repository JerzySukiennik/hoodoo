// Hoodoo renderer: WebGL2 host for the raytracer - scene tables, terrain pyramids, preview, Bryce-style pass renders, picking.

import { VERT, TRACE, BLIT, MAX_OBJ, OBJ_W, MAT_W, PREVIEW_ROW } from './shader.js';
import { camBasis, DEG, halton } from './math.js';
import { skyUniforms, SKY_DEFAULT } from './sky.js';
import { packScene, writeObject, material } from '../scene/scene.js';
import { gradients, cellMaxPyramid } from './terrain.js';

export const QUALITY = {
  move: { maxRays: 3, maxDepth: 2, terrIter: 220, minW: 0.05, lightShadows: 1 },
  still: { maxRays: 7, maxDepth: 4, terrIter: 420, minW: 0.02, lightShadows: 1 },
  final: { maxRays: 14, maxDepth: 7, terrIter: 900, minW: 0.008, lightShadows: 1 },
};

export const RENDER_SAMPLES = { draft: 1, normal: 4, fine: 12, ultra: 32 };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ready = false;
    this.layers = new Map();
    this.job = null;
    this.tilesPerFrame = 6;
    this.lastDraw = 0;
    this.onProgress = null;
  }

  async init() {
    const gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.cbf = gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');
    this.par = gl.getExtension('KHR_parallel_shader_compile');
    if (!this.cbf) throw new Error('This GPU cannot render to float textures (EXT_color_buffer_float).');
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.vao = vao;
    this.trace = await this.program(TRACE);
    this.blit = await this.program(BLIT);
    for (const p of [this.trace, this.blit]) {
      const loc = gl.getAttribLocation(p.prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }
    this.objTex = this.dataTex(OBJ_W, MAX_OBJ);
    this.matTex = this.dataTex(MAT_W, MAX_OBJ);
    this.objData = new Float32Array(MAX_OBJ * OBJ_W * 4);
    this.matData = new Float32Array(MAX_OBJ * MAT_W * 4);
    this.allocTerrain(2, 1);
    this.pickFbo = this.target(1, 1, gl.RGBA32F, gl.NEAREST);
    this.dummy = this.target(1, 1, gl.RGBA16F, gl.NEAREST);
    this.matFbo = this.target(448, 448, gl.RGBA8, gl.NEAREST);
    this.preview = null;
    this.ready = true;
    this.keepAlive = setInterval(() => { if (performance.now() - this.lastDraw > 2000 && !document.hidden) this.tickle(); }, 2500);
  }

  async program(fs) {
    const gl = this.gl;
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const vs = mk(gl.VERTEX_SHADER, VERT), f = mk(gl.FRAGMENT_SHADER, fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, f);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (this.par) {
      const t0 = performance.now();
      while (!gl.getProgramParameter(prog, this.par.COMPLETION_STATUS_KHR)) {
        await new Promise((r) => setTimeout(r, 30));
        if (performance.now() - t0 > 120000) break;
      }
    }
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getShaderInfoLog(f) || gl.getProgramInfoLog(prog);
      throw new Error('Shader failed: ' + log);
    }
    const uni = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      const name = info.name.replace(/\[0\]$/, '');
      uni[name] = { loc: gl.getUniformLocation(prog, info.name), type: info.type, size: info.size };
    }
    return { prog, uni };
  }

  set(p, name, v) {
    const u = p.uni[name];
    if (!u) return;
    const gl = this.gl;
    switch (u.type) {
      case gl.FLOAT: u.size > 1 ? gl.uniform1fv(u.loc, v) : gl.uniform1f(u.loc, v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
      case gl.INT: case gl.BOOL: case gl.SAMPLER_2D: case gl.SAMPLER_2D_ARRAY: gl.uniform1i(u.loc, v); break;
    }
  }

  dataTex(w, h) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }

  target(w, h, fmt, filter) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h, fmt };
  }

  freeTarget(t) {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  allocTerrain(size, layers) {
    const gl = this.gl;
    for (const t of [this.tHeights, this.tMax, this.tGrad]) if (t) gl.deleteTexture(t);
    this.tSize = size; this.tLayers = layers;
    const mk = (fmt, w, levels, filter) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, fmt, w, w, layers);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, filter === gl.LINEAR ? gl.LINEAR : (levels > 1 ? gl.NEAREST_MIPMAP_NEAREST : gl.NEAREST));
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.tHeights = mk(gl.R32F, size + 1, 1, gl.NEAREST);
    this.tMax = mk(gl.R32F, size, Math.round(Math.log2(size)) + 1, gl.NEAREST);
    this.tGrad = mk(gl.RG16F, size + 1, 1, gl.LINEAR);
    for (const v of this.layers.values()) v.ref = null;
  }

  uploadTerrain(o, layer) {
    const gl = this.gl;
    const res = o.terrain.res, h = o.terrain.heights;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tHeights);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, res + 1, res + 1, 1, gl.RED, gl.FLOAT, h);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tGrad);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, res + 1, res + 1, 1, gl.RG, gl.FLOAT, gradients(h, res));
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tMax);
    const lv = cellMaxPyramid(h, res);
    for (let l = 0; l < lv.length; l++) {
      const s = res >> l;
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, l, 0, 0, layer, s, s, 1, gl.RED, gl.FLOAT, lv[l]);
    }
  }

  syncTerrains(scene) {
    const terrains = scene.objects.filter((o) => o.type === 'terrain' && o.terrain.heights);
    const need = Math.max(2, ...terrains.map((o) => o.terrain.res));
    const ids = new Set(terrains.map((o) => o.id));
    for (const id of [...this.layers.keys()]) if (!ids.has(id)) this.layers.delete(id);
    const layerCount = Math.max(1, terrains.length);
    if (need !== this.tSize || layerCount > this.tLayers) this.allocTerrain(need, Math.max(layerCount, this.tLayers === 1 && layerCount === 1 ? 1 : layerCount + 1));
    const used = new Set([...this.layers.values()].map((v) => v.layer));
    for (const o of terrains) {
      let e = this.layers.get(o.id);
      if (!e) {
        let l = 0; while (used.has(l)) l++;
        if (l >= this.tLayers) { this.allocTerrain(need, l + 2); return this.syncTerrains(scene); }
        e = { layer: l, ref: null, version: -1 }; used.add(l); this.layers.set(o.id, e);
      }
      if (e.ref !== o.terrain.heights || e.version !== o.terrain.version) {
        this.uploadTerrain(o, e.layer);
        e.ref = o.terrain.heights; e.version = o.terrain.version;
      }
    }
  }

  setScene(scene) {
    this.scene = scene;
    this.syncTerrains(scene);
    const pk = packScene(scene, (o) => this.layers.get(o.id)?.layer ?? 0);
    this.objData.set(pk.objData.subarray(0, PREVIEW_ROW * OBJ_W * 4));
    this.matData.set(pk.matData.subarray(0, PREVIEW_ROW * MAT_W * 4));
    this.rows = pk.rows;
    this.count = pk.count;
    this.lights = pk.lights;
    this.uploadTables();
    this.sky = skyUniforms(scene.sky);
  }

  updateTerrainOnly(o) {
    const e = this.layers.get(o.id);
    if (!e) return;
    this.uploadTerrain(o, e.layer);
    e.ref = o.terrain.heights; e.version = o.terrain.version;
  }

  uploadTables() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.objTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, OBJ_W, MAX_OBJ, gl.RGBA, gl.FLOAT, this.objData);
    gl.bindTexture(gl.TEXTURE_2D, this.matTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAT_W, MAX_OBJ, gl.RGBA, gl.FLOAT, this.matData);
  }

  bindCommon(cam, w, h, q, sky = this.sky) {
    const gl = this.gl, p = this.trace;
    gl.useProgram(p.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.objTex); this.set(p, 'uObjTex', 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.matTex); this.set(p, 'uMatTex', 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tHeights); this.set(p, 'uHeights', 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tMax); this.set(p, 'uCellMax', 3);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tGrad); this.set(p, 'uGrad', 4);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.dummy.tex); this.set(p, 'uPrev', 5);
    this.set(p, 'uGridSize', this.tSize + 1);
    this.set(p, 'uObjStart', 0);
    this.set(p, 'uObjCount', this.count);
    const b = camBasis(cam);
    this.set(p, 'uCamPos', cam.pos); this.set(p, 'uCamFwd', b.fwd); this.set(p, 'uCamRight', b.right); this.set(p, 'uCamUp', b.up);
    this.set(p, 'uTanHalf', Math.tan(cam.fov * DEG * 0.5));
    this.set(p, 'uAspect', w / h);
    this.set(p, 'uRes', [w, h]);
    this.set(p, 'uPixAng', 2 * Math.tan(cam.fov * DEG * 0.5) / h);
    this.set(p, 'uOffset', [0, 0]);
    this.set(p, 'uBlock', 1);
    this.set(p, 'uJitter', [0.5, 0.5]);
    this.set(p, 'uMode', 0);
    this.set(p, 'uBlend', 1);
    this.set(p, 'uTime', this.time || 0);
    for (const [k, v] of Object.entries(sky)) this.set(p, k, v);
    const n = this.lights.length;
    const lp = new Float32Array(32), lc = new Float32Array(32);
    this.lights.forEach((l, i) => { lp.set([...l.pos, l.range], i * 4); lc.set([...l.col, 1], i * 4); });
    this.set(p, 'uLightCount', n); this.set(p, 'uLightPos', lp); this.set(p, 'uLightCol', lc);
    this.set(p, 'uMaxRays', q.maxRays); this.set(p, 'uMaxDepth', q.maxDepth); this.set(p, 'uTerrIter', q.terrIter); this.set(p, 'uMinW', q.minW);
    this.set(p, 'uShadowsOn', 1); this.set(p, 'uCloudsOn', 1); this.set(p, 'uBumpOn', 1); this.set(p, 'uLightShadows', q.lightShadows);
  }

  ensurePreview(w, h) {
    const gl = this.gl;
    if (!this.preview || this.preview.w < w || this.preview.h < h) {
      this.freeTarget(this.preview);
      this.preview = this.target(Math.ceil(w * 1.1), Math.ceil(h * 1.1), gl.RGBA16F, gl.LINEAR);
    }
    if (!this.still || this.still[0].w !== w || this.still[0].h !== h) {
      if (this.still) this.still.forEach((t) => this.freeTarget(t));
      this.still = [this.target(w, h, gl.RGBA16F, gl.LINEAR), this.target(w, h, gl.RGBA16F, gl.LINEAR)];
    }
  }

  sync() {
    const gl = this.gl;
    const px = new Float32Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);
  }

  drawPreview(cam, scale) {
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    this.ensurePreview(W, H);
    const w = Math.max(16, Math.round(W * scale)), h = Math.max(16, Math.round(H * scale));
    this.bindCommon(cam, w, h, QUALITY.move);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.preview.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const t0 = performance.now();
    this.sync();
    const dt = performance.now() - t0;
    this.showLinear(this.preview, w, h);
    this.lastDraw = performance.now();
    return dt;
  }

  showLinear(t, w, h) {
    this.present({ cur: t, curScale: [w / t.w, h / t.h], curNearest: 0, srcW: w, srcH: h });
  }

  present({ cur, curScale = [1, 1], curNearest = 0, curBlock = 1, old = null, oldScale = [1, 1], oldNearest = 0, oldBlock = 1, done = null, srcW, srcH, fit = true }) {
    const gl = this.gl, p = this.blit;
    const W = this.canvas.width, H = this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(p.prog);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, cur.tex); this.set(p, 'uCur', 6);
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, (old || cur).tex); this.set(p, 'uOld', 7);
    let vx = 0, vy = 0, vw = W, vh = H;
    if (fit) {
      const s = Math.min(W / srcW, H / srcH);
      vw = srcW * s; vh = srcH * s; vx = (W - vw) / 2; vy = (H - vh) / 2;
    }
    this.viewRect = [vx, vy, vw, vh];
    this.set(p, 'uView', [vx, vy, vw, vh]);
    this.set(p, 'uSrcSize', [srcW, srcH]);
    this.set(p, 'uCurScale', curScale); this.set(p, 'uCurBlock', curBlock); this.set(p, 'uCurNearest', curNearest);
    this.set(p, 'uOldScale', oldScale); this.set(p, 'uOldBlock', oldBlock); this.set(p, 'uOldNearest', oldNearest);
    this.set(p, 'uUseOld', old ? 1 : 0);
    this.set(p, 'uDone', done || [0, 0, 1, 1]);
    this.set(p, 'uBg', [0.043, 0.043, 0.047]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  tickle() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo.fbo);
    gl.viewport(0, 0, 1, 1);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.lastDraw = performance.now();
  }

  // ---------------------------------------------------------------- progressive jobs (still refine and final render)
  startJob(cam, opt) {
    const gl = this.gl;
    const W = opt.width, H = opt.height;
    const samples = opt.samples;
    const passes = [];
    if (opt.bryce) for (const b of [32, 16, 8, 4, 2]) passes.push({ block: b });
    passes.push({ block: 1, sample: 1 });
    for (let s = 2; s <= samples; s++) passes.push({ block: 1, sample: s });
    if (this.job) this.endJob();
    const acc = opt.targets || [this.target(W, H, gl.RGBA16F, gl.LINEAR), this.target(W, H, gl.RGBA16F, gl.LINEAR)];
    const blocks = opt.bryce ? [this.target(Math.ceil(W / 2), Math.ceil(H / 2), gl.RGBA16F, gl.NEAREST), this.target(Math.ceil(W / 2), Math.ceil(H / 2), gl.RGBA16F, gl.NEAREST)] : [];
    this.job = {
      cam: JSON.parse(JSON.stringify(cam)), W, H, passes, pi: 0, tile: opt.tile || 64, row: 0, col: 0, acc, blocks, accIdx: 0, blockIdx: 0,
      q: opt.quality || QUALITY.final, kind: opt.kind || 'final', own: !opt.targets, started: performance.now(), lastShown: null, done: false,
      onDone: opt.onDone, backdrop: opt.backdrop || null,
    };
    this.tilesPerFrame = opt.kind === 'still' ? 4 : 6;
    return this.job;
  }

  passTarget(j, pass) {
    if (pass.block > 1) return j.blocks[j.blockIdx];
    return j.acc[j.accIdx];
  }

  stepJob(budget = 24) {
    const j = this.job;
    if (!j || j.done) return false;
    const gl = this.gl;
    const t0 = performance.now();
    let drawn = 0;
    while (drawn < this.tilesPerFrame && !j.done) {
      const pass = j.passes[j.pi];
      const pw = Math.ceil(j.W / pass.block), ph = Math.ceil(j.H / pass.block);
      const cols = Math.ceil(pw / j.tile), rowsN = Math.ceil(ph / j.tile);
      const tgt = this.passTarget(j, pass);
      if (drawn === 0) this.bindCommon(j.cam, j.W, j.H, j.q);
      const p = this.trace;
      this.set(p, 'uBlock', pass.block);
      const s = pass.sample || 1;
      this.set(p, 'uJitter', s === 1 ? [0.5, 0.5] : [halton(s, 2), halton(s, 3)]);
      if (pass.block === 1 && s > 1) {
        const prev = j.acc[1 - j.accIdx];
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, prev.tex);
        this.set(p, 'uBlend', 1 / s);
      } else this.set(p, 'uBlend', 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fbo);
      gl.enable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, pw, ph);
      const x = j.col * j.tile, yTop = j.row * j.tile;
      const th = Math.min(j.tile, ph - yTop), tw = Math.min(j.tile, pw - x);
      const y = ph - yTop - th;
      gl.scissor(x, y, tw, th);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      drawn++;
      j.col++;
      if (j.col >= cols) { j.col = 0; j.row++; }
      if (j.row >= rowsN) {
        j.row = 0; j.col = 0;
        j.lastShown = { tex: tgt, block: pass.block };
        if (pass.block > 1) j.blockIdx = 1 - j.blockIdx;
        else j.accIdx = 1 - j.accIdx;
        j.pi++;
        if (j.pi >= j.passes.length) { j.done = true; j.final = j.acc[1 - j.accIdx]; }
      }
    }
    gl.disable(gl.SCISSOR_TEST);
    this.sync();
    const dt = performance.now() - t0;
    if (dt < budget * 0.5) this.tilesPerFrame = Math.min(512, Math.ceil(this.tilesPerFrame * 1.5));
    else if (dt > budget * 1.2) this.tilesPerFrame = Math.max(1, Math.floor(this.tilesPerFrame / 1.5));
    this.lastDraw = performance.now();
    return true;
  }

  showJob() {
    const j = this.job;
    if (!j) return;
    if (j.done) { this.present({ cur: j.final, srcW: j.W, srcH: j.H }); return; }
    const pass = j.passes[j.pi];
    const tgt = this.passTarget(j, pass);
    const old = j.lastShown;
    const pw = Math.ceil(j.W / pass.block), ph = Math.ceil(j.H / pass.block);
    if (!old && j.backdrop) {
      this.present({ cur: tgt, curNearest: 1, curBlock: pass.block, old: j.backdrop.t, oldScale: j.backdrop.scale, oldNearest: 0, done: [j.col, j.row, j.tile, ph], srcW: j.W, srcH: j.H });
      return;
    }
    this.present({
      cur: tgt, curNearest: 1, curBlock: pass.block,
      old: old ? old.tex : tgt, oldNearest: 1, oldBlock: old ? old.block : pass.block,
      done: old ? [j.col, j.row, j.tile, ph] : [j.col, j.row, j.tile, ph], srcW: j.W, srcH: j.H,
    });
  }

  progress() {
    const j = this.job;
    if (!j) return 0;
    if (j.done) return 1;
    const pass = j.passes[j.pi];
    const pw = Math.ceil(j.W / pass.block), ph = Math.ceil(j.H / pass.block);
    const cols = Math.ceil(pw / j.tile), rowsN = Math.ceil(ph / j.tile);
    const within = (j.row * cols + j.col) / (cols * rowsN);
    const weight = (b) => 1 / (b * b);
    let total = 0, doneW = 0;
    j.passes.forEach((p, i) => { const w = weight(p.block); total += w; if (i < j.pi) doneW += w; else if (i === j.pi) doneW += w * within; });
    return doneW / total;
  }

  endJob() {
    const j = this.job;
    if (!j) return;
    if (j.own) j.acc.forEach((t) => { if (t !== j.keep) this.freeTarget(t); });
    j.blocks.forEach((t) => this.freeTarget(t));
    this.job = null;
  }

  readTarget(t) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    const px = new Float32Array(t.w * t.h * 4);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = new Uint8ClampedArray(t.w * t.h * 4);
    for (let y = 0; y < t.h; y++) {
      const src = (t.h - 1 - y) * t.w * 4, dst = y * t.w * 4;
      for (let x = 0; x < t.w * 4; x += 4) {
        out[dst + x] = px[src + x] * 255 + 0.5; out[dst + x + 1] = px[src + x + 1] * 255 + 0.5; out[dst + x + 2] = px[src + x + 2] * 255 + 0.5; out[dst + x + 3] = 255;
      }
    }
    return new ImageData(out, t.w, t.h);
  }

  // ---------------------------------------------------------------- picking
  pick(cam, x, y, w, h, ignoreRow = -1) {
    return this.pickRaw(cam, w, h, (p) => { this.set(p, 'uPickCustom', 0); this.set(p, 'uPickPix', [x, h - y]); }, ignoreRow);
  }

  pickRay(cam, ro, rd, ignoreRow = -1) {
    return this.pickRaw(cam, 1, 1, (p) => { this.set(p, 'uPickCustom', 1); this.set(p, 'uPickRo', ro); this.set(p, 'uPickRd', rd); }, ignoreRow);
  }

  pickRaw(cam, w, h, setup, ignoreRow) {
    const gl = this.gl;
    this.bindCommon(cam, w, h, QUALITY.still);
    const p = this.trace;
    this.set(p, 'uMode', 1);
    this.set(p, 'uIgnore', ignoreRow);
    setup(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo.fbo);
    gl.viewport(0, 0, 1, 1);
    gl.disable(gl.SCISSOR_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Float32Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.set(p, 'uMode', 0);
    this.set(p, 'uIgnore', -1);
    if (px[0] < 0.5) return null;
    const row = Math.round(px[0]) - 1;
    return { row, id: this.rows[row], t: px[1], uv: [px[2], px[3]] };
  }

  // ---------------------------------------------------------------- material preview sphere
  materialPreview(mat, size = 160, shape = 'sphere') {
    const gl = this.gl;
    size = Math.min(448, size);
    const sphere = { type: shape, pos: [0, 1, 0], rot: shape === 'cube' ? [20, 35, 0] : [0, 0, 0], scale: shape === 'cube' ? [0.72, 0.72, 0.72] : [1, 1, 1], mat, seed: 4, rough: 1, minor: 0.3 };
    const floor = { type: 'plane', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], mat: { ...material('checker'), scale: 20, colorA: '#8c8c8c', colorB: '#3a3a3a', reflection: 0.05, specularity: 0.05 } };
    writeObject(sphere, PREVIEW_ROW, this.objData, this.matData);
    writeObject(floor, PREVIEW_ROW + 1, this.objData, this.matData);
    this.uploadTables();
    const cam = { pos: [0, 1.9, 4.1], yaw: 0, pitch: -12, fov: 34 };
    const sky = skyUniforms({ ...SKY_DEFAULT, sunAz: 145, sunEl: 38, clouds: 0.35, cover: 0.4, haze: 0.1, fog: 0, ambient: 0.6 });
    const savedLights = this.lights; this.lights = [];
    this.bindCommon(cam, size, size, QUALITY.still, sky);
    this.lights = savedLights;
    const p = this.trace;
    this.set(p, 'uObjStart', PREVIEW_ROW); this.set(p, 'uObjCount', 2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.matFbo.fbo);
    gl.viewport(0, 0, size, size);
    gl.disable(gl.SCISSOR_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) out.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    return new ImageData(out, size, size);
  }
}
