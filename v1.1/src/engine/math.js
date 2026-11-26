// Hoodoo math: small vector helpers, TRS matrices, camera basis, colour parsing.

export const DEG = Math.PI / 180;
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function rotMatrix(rot) {
  const [rx, ry, rz] = rot.map((d) => d * DEG);
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  return mm3(mm3(Ry, Rx), Rz);
}

export function mm3(a, b) {
  const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return r;
}

export function mv3(m, v) {
  return [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
}

export function invTRS(pos, rot, scale) {
  const R = rotMatrix(rot);
  const s = scale.map((v) => (Math.abs(v) < 1e-6 ? 1e-6 : v));
  const rows = [];
  for (let i = 0; i < 3; i++) {
    const r = [R[0][i] / s[i], R[1][i] / s[i], R[2][i] / s[i]];
    rows.push([r[0], r[1], r[2], -(r[0] * pos[0] + r[1] * pos[1] + r[2] * pos[2])]);
  }
  return rows;
}

export function localToWorld(o, p) {
  const R = rotMatrix(o.rot);
  return add(o.pos, mv3(R, [p[0] * o.scale[0], p[1] * o.scale[1], p[2] * o.scale[2]]));
}

export function axesOf(rot) {
  const R = rotMatrix(rot);
  return [[R[0][0], R[1][0], R[2][0]], [R[0][1], R[1][1], R[2][1]], [R[0][2], R[1][2], R[2][2]]];
}

export function camBasis(cam) {
  const cy = Math.cos(cam.yaw * DEG), sy = Math.sin(cam.yaw * DEG), cp = Math.cos(cam.pitch * DEG), sp = Math.sin(cam.pitch * DEG);
  const fwd = [sy * cp, sp, -cy * cp];
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return { fwd, right, up };
}

export function lookAngles(from, to) {
  const d = norm(sub(to, from));
  return { yaw: Math.atan2(d[0], -d[2]) / DEG, pitch: Math.asin(clamp(d[1], -1, 1)) / DEG };
}

export function hex2rgb(h) {
  if (Array.isArray(h)) return h;
  const s = String(h || '#000').replace('#', '');
  const v = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.padEnd(6, '0');
  return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255];
}

export function rgb2hex(c) {
  return '#' + c.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
}

export const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function halton(i, b) {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
}

export function uid() {
  return Math.random().toString(36).slice(2, 9);
}
