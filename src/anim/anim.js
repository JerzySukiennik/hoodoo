// Hoodoo animation: keyframe tracks for camera, sun and objects with Catmull-Rom easing between keys.

function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function flatten(k, kind) {
  if (kind === 'camera') return [...k.pos, k.yaw, k.pitch, k.fov];
  if (kind === 'sun') return [k.az, k.el];
  return [...k.pos, ...k.rot, ...k.scale];
}

function unflatten(v, kind) {
  if (kind === 'camera') return { pos: v.slice(0, 3), yaw: v[3], pitch: v[4], fov: v[5] };
  if (kind === 'sun') return { az: v[0], el: v[1] };
  return { pos: v.slice(0, 3), rot: v.slice(3, 6), scale: v.slice(6, 9) };
}

const ANGLES = { camera: [3], sun: [0], object: [3, 4, 5] };

export function evalTrack(keys, time, kind) {
  if (!keys || !keys.length) return null;
  const ks = [...keys].sort((a, b) => a.t - b.t);
  const vals = ks.map((k) => flatten(k, kind));
  for (const ai of ANGLES[kind] || []) {
    for (let i = 1; i < vals.length; i++) {
      let d = vals[i][ai] - vals[i - 1][ai];
      while (d > 180) { vals[i][ai] -= 360; d -= 360; }
      while (d < -180) { vals[i][ai] += 360; d += 360; }
    }
  }
  if (time <= ks[0].t) return unflatten(vals[0], kind);
  if (time >= ks[ks.length - 1].t) return unflatten(vals[vals.length - 1], kind);
  let i = 0;
  while (i < ks.length - 2 && time > ks[i + 1].t) i++;
  const t0 = ks[i].t, t1 = ks[i + 1].t;
  const u = (time - t0) / Math.max(1e-6, t1 - t0);
  const e = u;
  const v0 = vals[Math.max(0, i - 1)], v1 = vals[i], v2 = vals[i + 1], v3 = vals[Math.min(vals.length - 1, i + 2)];
  return unflatten(v1.map((_, j) => cr(v0[j], v1[j], v2[j], v3[j], e)), kind);
}

export function hasAnimation(scene) {
  const tr = scene.anim.tracks;
  return tr.camera.length > 0 || tr.sun.length > 0 || Object.values(tr.objects).some((k) => k.length > 0);
}

export function applyAnimation(scene, time) {
  const tr = scene.anim.tracks;
  const c = evalTrack(tr.camera, time, 'camera');
  if (c) Object.assign(scene.camera, c);
  const s = evalTrack(tr.sun, time, 'sun');
  if (s) { scene.sky.sunAz = s.az; scene.sky.sunEl = s.el; }
  for (const o of scene.objects) {
    const k = tr.objects[o.id];
    if (!k || !k.length) continue;
    const v = evalTrack(k, time, 'object');
    o.pos = v.pos; o.rot = v.rot; o.scale = v.scale;
  }
}

function upsert(list, key, time) {
  const i = list.findIndex((k) => Math.abs(k.t - time) < 1e-3);
  if (i >= 0) list[i] = key; else list.push(key);
  list.sort((a, b) => a.t - b.t);
}

export function keyCamera(scene, time) {
  const c = scene.camera;
  upsert(scene.anim.tracks.camera, { t: time, pos: [...c.pos], yaw: c.yaw, pitch: c.pitch, fov: c.fov }, time);
}

export function keySun(scene, time) {
  upsert(scene.anim.tracks.sun, { t: time, az: scene.sky.sunAz, el: scene.sky.sunEl }, time);
}

export function keyObject(scene, o, time) {
  const tr = scene.anim.tracks.objects;
  if (!tr[o.id]) tr[o.id] = [];
  upsert(tr[o.id], { t: time, pos: [...o.pos], rot: [...o.rot], scale: [...o.scale] }, time);
}
