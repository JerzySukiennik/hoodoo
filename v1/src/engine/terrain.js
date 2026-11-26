// Hoodoo terrain lab: seeded heightmap generators, filters, brushes and the GPU-side pyramids (gradients, cell maxima).

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const G2 = (3 - Math.sqrt(3)) / 6, F2 = 0.5 * (Math.sqrt(3) - 1);
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

export function makeNoise(seed) {
  const rnd = mulberry32(seed * 9973 + 17);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  function simplex(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = GRAD[perm[ii + perm[jj]] & 7]; t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = GRAD[perm[ii + i1 + perm[jj + j1]] & 7]; t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = GRAD[perm[ii + 1 + perm[jj + 1]] & 7]; t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * n;
  }
  function fbm(x, y, oct, lac = 2.03, gain = 0.5) {
    let a = 0, b = 1, norm = 0;
    for (let o = 0; o < oct; o++) { a += b * simplex(x, y); norm += b; b *= gain; const nx = x * 0.8 - y * 0.6, ny = x * 0.6 + y * 0.8; x = nx * lac + 11.3; y = ny * lac + 4.7; }
    return a / norm;
  }
  function ridged(x, y, oct, gain = 2.1, lac = 2.0) {
    let sum = 0, amp = 0.5, w = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      let n = 1 - Math.abs(simplex(x, y));
      n *= n; n *= w;
      w = Math.min(1, Math.max(0, n * gain));
      sum += n * amp; norm += amp; amp *= 0.5;
      const nx = x * 0.8 - y * 0.6, ny = x * 0.6 + y * 0.8; x = nx * lac + 7.1; y = ny * lac + 2.9;
    }
    return sum / norm;
  }
  return { simplex, fbm, ridged };
}

export const GENERATORS = ['mountains', 'alps', 'hills', 'canyon', 'spires', 'dunes', 'island', 'craters', 'volcano', 'ridges', 'flat'];

function forEach(res, fn) {
  const n = res + 1, h = new Float32Array(n * n);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) h[z * n + x] = fn(x / res, z / res, x, z);
  return h;
}

export function normalize(h, lo = 0, hi = 1) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < h.length; i++) { const v = h[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const s = mx - mn > 1e-9 ? (hi - lo) / (mx - mn) : 0;
  for (let i = 0; i < h.length; i++) h[i] = lo + (h[i] - mn) * s;
  return h;
}

function edgeFalloff(u, v, amount) {
  if (amount <= 0) return 1;
  const dx = Math.min(u, 1 - u), dz = Math.min(v, 1 - v);
  const w = 0.04 + 0.32 * amount;
  const fx = Math.min(1, dx / w), fz = Math.min(1, dz / w);
  const s = (t) => t * t * (3 - 2 * t);
  return s(fx) * s(fz);
}

export function generate(res, rec) {
  const r = { gen: 'mountains', seed: 1, rough: 0.5, scale: 1, edges: 0.6, height: 1, ...rec };
  const N = makeNoise(r.seed | 0);
  const f = Math.max(0.2, r.scale);
  const oct = Math.round(5 + r.rough * 5);
  let h;
  switch (r.gen) {
    case 'flat': h = forEach(res, () => 0.02); break;
    case 'hills':
      h = forEach(res, (u, v) => {
        const x = u * 2.2 * f, y = v * 2.2 * f;
        return 0.55 + 0.45 * N.fbm(x, y, oct, 2.0, 0.42 + r.rough * 0.2) + 0.08 * N.fbm(x * 4 + 9, y * 4, 3);
      });
      break;
    case 'alps':
    case 'mountains': {
      const alps = r.gen === 'alps';
      h = forEach(res, (u, v) => {
        let x = u * 2.0 * f, y = v * 2.0 * f;
        const wx = N.fbm(x * 0.7 + 5.2, y * 0.7 + 1.3, 4), wy = N.fbm(x * 0.7 + 8.1, y * 0.7 + 2.8, 4);
        x += wx * 0.45; y += wy * 0.45;
        const rd = N.ridged(x, y, oct, 1.6 + r.rough * 0.8);
        const fb = 0.5 + 0.5 * N.fbm(x * 1.1 + 13, y * 1.1 + 2, oct, 2.0, 0.48);
        const base = 0.5 + 0.5 * N.fbm(x * 0.35 + 3, y * 0.35 + 7, 3);
        const m = alps ? 0.72 * rd + 0.28 * fb : 0.5 * rd + 0.5 * fb;
        return Math.pow(m, alps ? 1.5 : 1.35) * (0.45 + 0.75 * base);
      });
      break;
    }
    case 'ridges':
      h = forEach(res, (u, v) => {
        const x = u * 1.6 * f, y = v * 1.6 * f;
        const w = N.fbm(x * 0.5, y * 0.5, 3) * 1.2;
        const s = Math.abs(Math.sin((x * 0.9 + y * 0.35 + w) * Math.PI * 1.6));
        return Math.pow(1 - s, 1.8) * 0.7 + 0.3 * N.ridged(x * 2, y * 2, oct - 2);
      });
      break;
    case 'canyon': {
      h = forEach(res, (u, v) => {
        const x = u * 1.5 * f, y = v * 1.5 * f;
        const b = 0.5 + 0.5 * N.fbm(x, y, 5, 2.0, 0.5);
        const river = Math.abs(N.fbm(x * 0.6 + 20, y * 0.6 + 3, 4));
        const carve = Math.min(1, river * 5.5);
        return b * (0.35 + 0.65 * carve);
      });
      normalize(h);
      const steps = Math.round(3 + r.rough * 3);
      terrace(h, res, { steps, sharp: 0.86 });
      const N2 = makeNoise((r.seed | 0) + 101);
      for (let z = 0; z <= res; z++) for (let x = 0; x <= res; x++) {
        const i = z * (res + 1) + x;
        h[i] += 0.025 * N2.fbm(x / res * 14 * f, z / res * 14 * f, 4);
      }
      break;
    }
    case 'spires': {
      const rnd = mulberry32((r.seed | 0) * 31 + 5);
      const count = Math.round(40 + r.rough * 120) * f;
      const pts = [];
      for (let i = 0; i < count; i++) pts.push([rnd(), rnd(), 0.02 + rnd() * 0.035 / Math.sqrt(f), 0.35 + rnd() * 0.65]);
      h = forEach(res, (u, v) => 0.06 + 0.05 * N.fbm(u * 6, v * 6, 4));
      const n = res + 1;
      for (const [px, pz, rad, ht] of pts) {
        const x0 = Math.max(0, Math.floor((px - rad) * res)), x1 = Math.min(res, Math.ceil((px + rad) * res));
        const z0 = Math.max(0, Math.floor((pz - rad) * res)), z1 = Math.min(res, Math.ceil((pz + rad) * res));
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
          const u = x / res, v = z / res;
          const wob = 1 + 0.25 * N.simplex(u * 60, v * 60);
          const d = Math.hypot(u - px, v - pz) / (rad * wob);
          if (d >= 1) continue;
          const prof = Math.pow(1 - Math.pow(d, 3), 0.35);
          const val = ht * prof;
          const i = z * n + x;
          if (val > h[i]) h[i] = val;
        }
      }
      terrace(h, res, { steps: 7, sharp: 0.35 });
      break;
    }
    case 'dunes':
      h = forEach(res, (u, v) => {
        const x = u * 3 * f, y = v * 3 * f;
        const w = N.fbm(x * 0.4, y * 0.4, 3) * 1.6;
        const ph = (x * 1.0 + y * 0.25 + w) * Math.PI;
        const s = Math.sin(ph);
        const asym = s > 0 ? Math.pow(s, 0.7) : -Math.pow(-s, 1.6) * 0.4;
        return 0.35 + 0.22 * asym + 0.25 * N.fbm(x * 0.3 + 4, y * 0.3, 4) + 0.02 * N.fbm(x * 8, y * 8, 2);
      });
      break;
    case 'island':
      h = forEach(res, (u, v) => {
        const x = u * 2 * f, y = v * 2 * f;
        const d = Math.hypot(u - 0.5, v - 0.5) * 2;
        const fall = Math.max(0, 1 - Math.pow(d * (1 + 0.25 * N.fbm(x * 0.8 + 3, y * 0.8, 3)), 2.2));
        return fall * (0.45 + 0.55 * (0.5 + 0.5 * N.fbm(x, y, oct))) + 0.25 * fall * N.ridged(x * 1.5, y * 1.5, oct - 2);
      });
      break;
    case 'craters': {
      h = forEach(res, (u, v) => 0.4 + 0.12 * N.fbm(u * 3 * f, v * 3 * f, oct));
      const rnd = mulberry32((r.seed | 0) * 7 + 3);
      const count = Math.round(6 + r.rough * 20);
      const n = res + 1;
      for (let k = 0; k < count; k++) {
        const cx = rnd(), cz = rnd(), rad = (0.03 + Math.pow(rnd(), 2.5) * 0.22) / f, depth = rad * (1.1 + rnd());
        for (let z = 0; z <= res; z++) for (let x = 0; x <= res; x++) {
          const d = Math.hypot(x / res - cx, z / res - cz) / rad;
          if (d > 2.2) continue;
          const bowl = d < 1 ? (d * d - 1) * depth : 0;
          const rim = Math.exp(-Math.pow((d - 1) / 0.28, 2)) * depth * 0.45;
          h[z * n + x] += bowl + rim;
        }
      }
      break;
    }
    case 'volcano':
      h = forEach(res, (u, v) => {
        const d = Math.hypot(u - 0.5, v - 0.5) * 2;
        const x = u * 2 * f, y = v * 2 * f;
        const cone = Math.max(0, 1 - d * 1.15) ** 1.6;
        const crater = Math.exp(-Math.pow(d / 0.12, 2)) * 0.45;
        const rid = N.ridged(x * 1.5, y * 1.5, oct) * 0.25 * (0.3 + cone);
        return cone - crater + rid + 0.05 * N.fbm(x * 3, y * 3, 3);
      });
      break;
    default:
      h = forEach(res, () => 0);
  }
  if (r.gen === 'mountains' || r.gen === 'alps' || r.gen === 'hills' || r.gen === 'ridges') blur(h, res, Math.max(1, Math.round(res / 512)));
  normalize(h);
  const edges = r.gen === 'flat' ? 0 : r.edges;
  if (edges > 0) {
    const n = res + 1;
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) h[z * n + x] *= edgeFalloff(x / res, z / res, edges);
  }
  if (r.ops) for (const op of r.ops) applyOp(h, res, op, r.seed);
  clamp01(h);
  if (r.height !== 1) for (let i = 0; i < h.length; i++) h[i] *= r.height;
  return h;
}

function clamp01(h) { for (let i = 0; i < h.length; i++) h[i] = h[i] < 0 ? 0 : h[i] > 1 ? 1 : h[i]; }

export function applyOp(h, res, op, seed = 1) {
  const a = op.amount ?? 0.5;
  switch (op.op) {
    case 'erode': erode(h, res, a, (op.seed ?? seed) | 0); break;
    case 'thermal': thermal(h, res, a); break;
    case 'smooth': blur(h, res, Math.max(1, Math.round(1 + a * 4))); break;
    case 'sharpen': sharpen(h, res, a); break;
    case 'terrace': terrace(h, res, { steps: op.steps ?? Math.round(3 + a * 8), sharp: op.sharp ?? 0.8 }); break;
    case 'edges': { const n = res + 1; for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) h[z * n + x] *= edgeFalloff(x / res, z / res, a); break; }
    case 'square': { const n = res + 1; for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) if (x === 0 || z === 0 || x === res || z === res) h[z * n + x] = 0; break; }
    case 'invert': for (let i = 0; i < h.length; i++) h[i] = 1 - h[i]; break;
    case 'normalize': normalize(h); break;
    case 'raise': for (let i = 0; i < h.length; i++) h[i] += (a - 0.5) * 0.3; break;
    case 'power': { const e = op.exp ?? (0.5 + a * 1.5); for (let i = 0; i < h.length; i++) h[i] = Math.pow(Math.max(0, h[i]), e); break; }
    case 'spikes': spikes(h, res, a, (op.seed ?? seed) | 0); break;
    case 'mounds': mounds(h, res, a, (op.seed ?? seed) | 0); break;
    case 'noise': {
      const N = makeNoise(((op.seed ?? seed) | 0) + 77); const n = res + 1; const sc = 4 + a * 24;
      for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) h[z * n + x] += 0.04 * a * N.fbm(x / res * sc, z / res * sc, 5);
      break;
    }
    case 'clip': { const lo = op.lo ?? 0, hi = op.hi ?? 1; for (let i = 0; i < h.length; i++) h[i] = Math.min(hi, Math.max(lo, h[i])); normalize(h); break; }
    case 'flatten': { const lv = op.level ?? 0.2; for (let i = 0; i < h.length; i++) if (h[i] < lv) h[i] = lv; break; }
  }
  clamp01(h);
  return h;
}

export function blur(h, res, rad) {
  const n = res + 1, tmp = new Float32Array(h.length);
  for (let z = 0; z < n; z++) {
    let acc = 0, cnt = 0;
    for (let x = -rad; x <= rad; x++) { const xx = Math.min(n - 1, Math.max(0, x)); acc += h[z * n + xx]; cnt++; }
    for (let x = 0; x < n; x++) {
      tmp[z * n + x] = acc / cnt;
      const xo = Math.min(n - 1, Math.max(0, x - rad)), xi = Math.min(n - 1, Math.max(0, x + rad + 1));
      acc += h[z * n + xi] - h[z * n + xo];
    }
  }
  for (let x = 0; x < n; x++) {
    let acc = 0, cnt = 0;
    for (let z = -rad; z <= rad; z++) { const zz = Math.min(n - 1, Math.max(0, z)); acc += tmp[zz * n + x]; cnt++; }
    for (let z = 0; z < n; z++) {
      h[z * n + x] = acc / cnt;
      const zo = Math.min(n - 1, Math.max(0, z - rad)), zi = Math.min(n - 1, Math.max(0, z + rad + 1));
      acc += tmp[zi * n + x] - tmp[zo * n + x];
    }
  }
  return h;
}

function sharpen(h, res, a) {
  const b = Float32Array.from(h);
  blur(b, res, 2);
  for (let i = 0; i < h.length; i++) h[i] += (h[i] - b[i]) * (0.5 + a * 2.5);
}

export function terrace(h, res, { steps = 5, sharp = 0.8 }) {
  for (let i = 0; i < h.length; i++) {
    const v = h[i] * steps;
    const k = Math.floor(v), fr = v - k;
    h[i] = (k + Math.pow(fr, 1 + sharp * 10)) / steps;
  }
  return h;
}

function spikes(h, res, a, seed) {
  const rnd = mulberry32(seed * 13 + 1), n = res + 1;
  const count = Math.round(20 + a * 300);
  for (let k = 0; k < count; k++) {
    const cx = rnd() * res, cz = rnd() * res, rad = 1 + rnd() * res * 0.012, ht = (0.05 + rnd() * 0.25) * a;
    const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(res, Math.ceil(cx + rad));
    const z0 = Math.max(0, Math.floor(cz - rad)), z1 = Math.min(res, Math.ceil(cz + rad));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, z - cz) / rad; if (d >= 1) continue;
      h[z * n + x] += ht * (1 - d);
    }
  }
}

function mounds(h, res, a, seed) {
  const rnd = mulberry32(seed * 17 + 9), n = res + 1;
  const count = Math.round(5 + a * 30);
  for (let k = 0; k < count; k++) {
    const cx = rnd(), cz = rnd(), rad = 0.04 + rnd() * 0.14, ht = (0.08 + rnd() * 0.2) * (0.4 + a);
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const d2 = (Math.pow(x / res - cx, 2) + Math.pow(z / res - cz, 2)) / (rad * rad);
      if (d2 > 9) continue;
      h[z * n + x] += ht * Math.exp(-d2);
    }
  }
}

function thermal(h, res, a) {
  const n = res + 1, talus = 1.4 / res, iters = Math.round(10 + a * 50);
  for (let it = 0; it < iters; it++) {
    for (let z = 1; z < n - 1; z++) for (let x = 1; x < n - 1; x++) {
      const i = z * n + x, hv = h[i];
      let maxD = 0, mi = -1;
      const nb = [i - 1, i + 1, i - n, i + n];
      for (const j of nb) { const d = hv - h[j]; if (d > maxD) { maxD = d; mi = j; } }
      if (maxD > talus) { const m = (maxD - talus) * 0.5; h[i] -= m; h[mi] += m; }
    }
  }
}

export function erode(h, res, amount, seed = 1) {
  const n = res + 1;
  const rnd = mulberry32(seed * 101 + 7);
  const scale = res * 0.35;
  const H = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) H[i] = h[i] * scale;
  const drops = Math.round((0.3 + amount * 1.2) * n * n * 0.2);
  const inertia = 0.08, capF = 3, minCap = 0.01, dep = 0.3, ero = 0.25, evap = 0.02, grav = 4, life = 36;
  const radius = Math.max(2, Math.round(res / 200));
  const wOff = [], wW = [];
  let wsum = 0;
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
    const d = Math.hypot(dx, dz); if (d > radius) continue;
    const w = 1 - d / radius; wOff.push([dx, dz]); wW.push(w); wsum += w;
  }
  for (let k = 0; k < wW.length; k++) wW[k] /= wsum;
  const hg = (px, pz) => {
    const x = Math.floor(px), z = Math.floor(pz), u = px - x, v = pz - z;
    const i = z * n + x;
    const a = H[i], b = H[i + 1], c = H[i + n], d = H[i + n + 1];
    return [a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v, (b - a) * (1 - v) + (d - c) * v, (c - a) * (1 - u) + (d - b) * u];
  };
  for (let k = 0; k < drops; k++) {
    let px = 1 + rnd() * (n - 3), pz = 1 + rnd() * (n - 3);
    let dx = 0, dz = 0, speed = 1, water = 1, sed = 0;
    for (let l = 0; l < life; l++) {
      const ix = Math.floor(px), iz = Math.floor(pz);
      const ox = px - ix, oz = pz - iz;
      const [hh, gx, gz] = hg(px, pz);
      dx = dx * inertia - gx * (1 - inertia);
      dz = dz * inertia - gz * (1 - inertia);
      const len = Math.hypot(dx, dz);
      if (len < 1e-9) break;
      dx /= len; dz /= len;
      px += dx; pz += dz;
      if (px < 1 || pz < 1 || px >= n - 2 || pz >= n - 2) break;
      const nh = hg(px, pz)[0];
      const dh = nh - hh;
      const cap = Math.max(-dh * speed * water * capF, minCap);
      if (sed > cap || dh > 0) {
        const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * dep;
        sed -= amt;
        const i = iz * n + ix;
        H[i] += amt * (1 - ox) * (1 - oz); H[i + 1] += amt * ox * (1 - oz); H[i + n] += amt * (1 - ox) * oz; H[i + n + 1] += amt * ox * oz;
      } else {
        const amt = Math.min((cap - sed) * ero, -dh);
        for (let w = 0; w < wOff.length; w++) {
          const xx = ix + wOff[w][0], zz = iz + wOff[w][1];
          if (xx < 0 || zz < 0 || xx >= n || zz >= n) continue;
          const j = zz * n + xx;
          const take = Math.min(H[j], amt * wW[w]);
          H[j] -= take; sed += take;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * grav));
      water *= 1 - evap;
    }
  }
  for (let i = 0; i < h.length; i++) h[i] = H[i] / scale;
  return h;
}

export function brush(h, res, cx, cz, radius, strength, mode, target = 0.5) {
  const n = res + 1;
  const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(res, Math.ceil(cx + radius));
  const z0 = Math.max(0, Math.floor(cz - radius)), z1 = Math.min(res, Math.ceil(cz + radius));
  let src = null;
  if (mode === 'smooth') {
    src = new Float32Array((x1 - x0 + 1) * (z1 - z0 + 1));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      let acc = 0, c = 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const xx = Math.min(res, Math.max(0, x + dx)), zz = Math.min(res, Math.max(0, z + dz));
        acc += h[zz * n + xx]; c++;
      }
      src[(z - z0) * (x1 - x0 + 1) + (x - x0)] = acc / c;
    }
  }
  const N = mode === 'noise' ? makeNoise(7) : null;
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const d = Math.hypot(x - cx, z - cz) / radius;
    if (d >= 1) continue;
    const w = (Math.cos(d * Math.PI) * 0.5 + 0.5) * strength;
    const i = z * n + x;
    switch (mode) {
      case 'raise': h[i] += w * 0.02; break;
      case 'lower': h[i] -= w * 0.02; break;
      case 'smooth': h[i] += (src[(z - z0) * (x1 - x0 + 1) + (x - x0)] - h[i]) * Math.min(1, w * 1.5); break;
      case 'flatten': h[i] += (target - h[i]) * Math.min(1, w * 0.5); break;
      case 'noise': h[i] += w * 0.012 * N.fbm(x / res * 40, z / res * 40, 4); break;
    }
    if (h[i] < 0) h[i] = 0; else if (h[i] > 1) h[i] = 1;
  }
  return [x0, z0, x1, z1];
}

export function sampleHeight(h, res, u, v) {
  const n = res + 1;
  const gx = Math.min(res - 1e-4, Math.max(0, u * res)), gz = Math.min(res - 1e-4, Math.max(0, v * res));
  const x = Math.floor(gx), z = Math.floor(gz), fx = gx - x, fz = gz - z;
  const i = z * n + x;
  return (h[i] * (1 - fx) + h[i + 1] * fx) * (1 - fz) + (h[i + n] * (1 - fx) + h[i + n + 1] * fx) * fz;
}

export function gradients(h, res) {
  const n = res + 1, g = new Float32Array(n * n * 2);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const xm = Math.max(0, x - 1), xp = Math.min(res, x + 1), zm = Math.max(0, z - 1), zp = Math.min(res, z + 1);
    const i = (z * n + x) * 2;
    g[i] = (h[z * n + xp] - h[z * n + xm]) / (xp - xm);
    g[i + 1] = (h[zp * n + x] - h[zm * n + x]) / (zp - zm);
  }
  return g;
}

export function cellMaxPyramid(h, res) {
  const n = res + 1;
  const levels = [];
  let cur = new Float32Array(res * res);
  for (let z = 0; z < res; z++) for (let x = 0; x < res; x++) {
    const i = z * n + x;
    cur[z * res + x] = Math.max(h[i], h[i + 1], h[i + n], h[i + n + 1]);
  }
  levels.push(cur);
  let s = res;
  while (s > 1) {
    const s2 = s >> 1, nxt = new Float32Array(s2 * s2);
    for (let z = 0; z < s2; z++) for (let x = 0; x < s2; x++) {
      const a = (2 * z) * s + 2 * x;
      nxt[z * s2 + x] = Math.max(cur[a], cur[a + 1], cur[a + s], cur[a + s + 1]);
    }
    levels.push(nxt); cur = nxt; s = s2;
  }
  return levels;
}

export function resample(h, res, newRes) {
  const n2 = newRes + 1, out = new Float32Array(n2 * n2);
  for (let z = 0; z < n2; z++) for (let x = 0; x < n2; x++) out[z * n2 + x] = sampleHeight(h, res, x / newRes, z / newRes);
  return out;
}

export function fromImage(img, res) {
  const c = document.createElement('canvas');
  c.width = c.height = res + 1;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, res + 1, res + 1);
  const d = ctx.getImageData(0, 0, res + 1, res + 1).data;
  const h = new Float32Array((res + 1) * (res + 1));
  for (let i = 0; i < h.length; i++) h[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
  blur(h, res, 1);
  return h;
}

export function encodeHeights(h) {
  const u = new Uint16Array(h.length);
  for (let i = 0; i < h.length; i++) u[i] = Math.round(Math.min(1, Math.max(0, h[i])) * 65535);
  let s = '';
  const b = new Uint8Array(u.buffer);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function decodeHeights(str) {
  const s = atob(str);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  const u = new Uint16Array(b.buffer);
  const h = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) h[i] = u[i] / 65535;
  return h;
}
