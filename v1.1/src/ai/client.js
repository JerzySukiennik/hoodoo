// Hoodoo AI client: sends a scene description to the Hoodoo Worker (Claude) and turns the reply into a scene proposal.

import { makeObject, ensureHeights, material } from '../scene/scene.js';
import { MATERIALS, SKIES } from '../scene/presets.js';
import { SKY_DEFAULT } from '../engine/sky.js';
import { GENERATORS } from '../engine/terrain.js';

const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
export const API = LOCAL ? 'http://127.0.0.1:8978' : 'https://hoodoo-api.kalakasanyt.workers.dev';

export function summarize(scene) {
  return {
    name: scene.name,
    sky: Object.fromEntries(['mode', 'sunAz', 'sunEl', 'haze', 'hazeColor', 'fog', 'fogHeight', 'fogColor', 'clouds', 'cover', 'zenith', 'horizon', 'sunset', 'sunColor', 'stars', 'rainbow', 'halo'].map((k) => [k, scene.sky[k]])),
    camera: scene.camera,
    objects: scene.objects.map((o) => ({
      type: o.type === 'plane' && o.mat.pattern === 'water' ? 'water' : o.type, name: o.name, pos: o.pos.map((v) => +v.toFixed(1)), rot: o.rot.map((v) => +v.toFixed(0)), scale: o.scale.map((v) => +v.toFixed(1)),
      material: o.mat.preset, colors: [o.mat.colorA, o.mat.colorB, o.mat.colorC],
      terrain: o.type === 'terrain' ? o.terrain.recipe : undefined,
    })),
  };
}

export async function askScene({ prompt, mode, current, previous }) {
  const res = await fetch(API + '/api/scene', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, mode, current, previous }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'HTTP ' + res.status);
  return j.scene;
}

const num = (v, d, lo = -1e5, hi = 1e5) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
const vec = (v, d, lo, hi) => (Array.isArray(v) && v.length === 3 ? v.map((x, i) => num(x, d[i], lo, hi)) : [...d]);
const col = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : d);

export function proposalToScene(p, base) {
  const sky = { ...SKY_DEFAULT };
  const ps = p.sky || {};
  if (ps.preset && SKIES[ps.preset]) Object.assign(sky, SKIES[ps.preset]);
  for (const k of ['sunAz', 'sunEl', 'haze', 'fog', 'fogHeight', 'clouds', 'cover', 'stars', 'rainbow', 'halo', 'glow', 'sunPower', 'ambient', 'shadows', 'moonPhase']) if (ps[k] != null) sky[k] = num(ps[k], sky[k]);
  for (const k of ['hazeColor', 'fogColor', 'cloudColor', 'zenith', 'horizon', 'sunset', 'sunColor', 'skyTint']) if (ps[k]) sky[k] = col(ps[k], sky[k]);
  if (['soft', 'darker', 'custom', 'off'].includes(ps.mode)) sky.mode = ps.mode;
  sky.sunEl = num(sky.sunEl, 20, -60, 90); sky.haze = num(sky.haze, 0.3, 0, 1); sky.fog = num(sky.fog, 0, 0, 1); sky.clouds = num(sky.clouds, 0.5, 0, 1); sky.cover = num(sky.cover, 0.45, 0, 1);
  const c = p.camera || {};
  const camera = { pos: vec(c.pos, [0, 8, 60], -5000, 5000), yaw: num(c.yaw, 0), pitch: num(c.pitch, 0, -89, 89), fov: num(c.fov, 50, 10, 110) };
  const objects = [];
  for (const o of (p.objects || []).slice(0, 40)) {
    const type = ['terrain', 'stone', 'sphere', 'cube', 'cylinder', 'cone', 'torus', 'pyramid', 'disc', 'square', 'plane', 'water', 'light'].includes(o.type) ? o.type : 'sphere';
    const matKey = MATERIALS[o.material] ? o.material : undefined;
    const opts = { name: String(o.name || '').slice(0, 40) || undefined, pos: vec(o.pos, [0, 0, 0], -5000, 5000), rot: vec(o.rot, [0, 0, 0], -720, 720), scale: vec(o.scale, [4, 4, 4], 0.01, 5000), mat: matKey };
    if (type === 'plane' || type === 'water') { opts.scale = [1, 1, 1]; opts.rot = [0, 0, 0]; }
    if (type === 'terrain') {
      const r = o.terrain || {};
      opts.recipe = {
        gen: GENERATORS.includes(r.gen) ? r.gen : 'mountains', seed: Math.round(num(r.seed, Math.random() * 9999, 0, 99999)), rough: num(r.rough, 0.5, 0, 1), scale: num(r.scale, 1, 0.3, 4), edges: num(r.edges, 0.6, 0, 1),
        ops: Array.isArray(r.ops) ? r.ops.slice(0, 6).filter((x) => x && typeof x.op === 'string').map((x) => ({ op: x.op, amount: num(x.amount, 0.5, 0, 1) })) : [],
      };
      opts.res = 512;
    }
    if (type === 'light') { opts.color = col(o.color, '#ffffff'); opts.power = num(o.power, 2, 0, 20); opts.range = num(o.range, 40, 1, 2000); }
    const x = makeObject(type, opts);
    if (o.colors && Array.isArray(o.colors)) {
      ['colorA', 'colorB', 'colorC'].forEach((k, i) => { if (o.colors[i]) x.mat[k] = col(o.colors[i], x.mat[k]); });
    }
    if (!matKey && o.material) x.mat = { ...material(x.type === 'terrain' ? 'rock' : 'clay'), ...x.mat };
    ensureHeights(x);
    objects.push(x);
  }
  return {
    version: 1, name: String(p.name || 'Claude scene').slice(0, 60), sky, camera, objects,
    anim: base && p.keepAnim ? base.anim : { duration: 6, fps: 30, tracks: { camera: [], sun: [], objects: {} } },
    render: base ? base.render : { size: 'view', quality: 'normal' },
    blurb: String(p.blurb || '').slice(0, 200),
  };
}
