// Hoodoo GPU raytracer: Whitted-style tracing of terrains, primitives and infinite planes under a Bryce-like sky.

export const MAX_OBJ = 64;
export const OBJ_W = 8;
export const MAT_W = 12;
export const PREVIEW_ROW = 62;

export const VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const TRACE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;

#define MAX_OBJ ${MAX_OBJ}
#define STK 8
#define EPS 1e-4
#define PI 3.14159265

out vec4 fragColor;

uniform vec2 uRes;
uniform vec2 uOffset;
uniform float uBlock;
uniform vec2 uJitter;
uniform int uMode;
uniform vec2 uPickPix;
uniform int uPickCustom;
uniform vec3 uPickRo, uPickRd;
uniform int uIgnore;
uniform sampler2D uPrev;
uniform float uBlend;

uniform vec3 uCamPos, uCamRight, uCamUp, uCamFwd;
uniform float uTanHalf, uAspect;

uniform sampler2D uObjTex;
uniform sampler2D uMatTex;
uniform int uObjStart, uObjCount;
uniform sampler2DArray uHeights;
uniform sampler2DArray uCellMax;
uniform sampler2DArray uGrad;
uniform float uGridSize;

uniform int uLightCount;
uniform vec4 uLightPos[8];
uniform vec4 uLightCol[8];

uniform vec3 uSunDir, uSunCol;
uniform vec3 uDiscDir, uDiscCol;
uniform float uDiscSize, uGlow, uDiscVis;
uniform vec3 uMoonDir;
uniform float uMoonVis, uMoonPhase;
uniform vec3 uZenith, uHorizon, uSunset;
uniform float uSunsetAmt, uSkyCurve;
uniform vec3 uAmbient;
uniform float uShadow;
uniform vec3 uHazeCol;
uniform float uHazeAmt, uHazeDen;
uniform vec3 uFogCol;
uniform float uFogDen, uFogH;
uniform vec3 uCloudCol;
uniform float uCloudCover, uCloudAmt, uCloudH, uCloudFreq, uCloudAmp, uCloudSoft;
uniform vec2 uCloudOff;
uniform float uStars, uRainbow, uHalo, uTime, uPixAng;
uniform int uSkyOff;

uniform int uMaxRays, uMaxDepth, uTerrIter;
uniform float uMinW;
uniform int uShadowsOn, uCloudsOn, uBumpOn, uLightShadows;

// ---------------------------------------------------------------- noise
uint hsh(uint x){ x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16; return x; }
float h3(ivec3 p){ return float(hsh(uint(p.x) * 73856093U ^ hsh(uint(p.y) * 19349663U ^ hsh(uint(p.z) * 83492791U)))) * (1.0 / 4294967295.0); }
float h2(ivec2 p){ return float(hsh(uint(p.x) * 73856093U ^ hsh(uint(p.y) * 19349663U + 7U))) * (1.0 / 4294967295.0); }
vec2 h22(ivec2 p){ uint a = hsh(uint(p.x) * 73856093U ^ hsh(uint(p.y) * 19349663U + 11U)); return vec2(float(a & 0xffffU), float(a >> 16)) * (1.0 / 65535.0); }

vec4 noised(vec3 x){
  vec3 i = floor(x); vec3 w = fract(x);
  vec3 u = w*w*w*(w*(w*6.0-15.0)+10.0);
  vec3 du = 30.0*w*w*(w*(w-2.0)+1.0);
  ivec3 p = ivec3(i);
  float a = h3(p), b = h3(p+ivec3(1,0,0)), c = h3(p+ivec3(0,1,0)), d = h3(p+ivec3(1,1,0));
  float e = h3(p+ivec3(0,0,1)), f = h3(p+ivec3(1,0,1)), g = h3(p+ivec3(0,1,1)), hh = h3(p+ivec3(1,1,1));
  float k0 = a, k1 = b-a, k2 = c-a, k3 = e-a, k4 = a-b-c+d, k5 = a-c-e+g, k6 = a-b-e+f, k7 = -a+b+c-d+e-f-g+hh;
  return vec4(-1.0+2.0*(k0 + k1*u.x + k2*u.y + k3*u.z + k4*u.x*u.y + k5*u.y*u.z + k6*u.z*u.x + k7*u.x*u.y*u.z),
              2.0*du*vec3(k1 + k4*u.y + k6*u.z + k7*u.y*u.z, k2 + k5*u.z + k4*u.x + k7*u.z*u.x, k3 + k6*u.x + k5*u.y + k7*u.x*u.y));
}
float noise3(vec3 x){
  vec3 i = floor(x); vec3 w = fract(x);
  vec3 u = w*w*(3.0-2.0*w);
  ivec3 p = ivec3(i);
  return -1.0 + 2.0*mix(mix(mix(h3(p), h3(p+ivec3(1,0,0)), u.x), mix(h3(p+ivec3(0,1,0)), h3(p+ivec3(1,1,0)), u.x), u.y),
             mix(mix(h3(p+ivec3(0,0,1)), h3(p+ivec3(1,0,1)), u.x), mix(h3(p+ivec3(0,1,1)), h3(p+ivec3(1,1,1)), u.x), u.y), u.z);
}
float noise2(vec2 x){
  vec2 i = floor(x); vec2 w = fract(x);
  vec2 u = w*w*(3.0-2.0*w);
  ivec2 p = ivec2(i);
  return -1.0 + 2.0*mix(mix(h2(p), h2(p+ivec2(1,0)), u.x), mix(h2(p+ivec2(0,1)), h2(p+ivec2(1,1)), u.x), u.y);
}
const mat3 M3  = mat3( 0.00,  0.80,  0.60, -0.80,  0.36, -0.48, -0.60, -0.48,  0.64);
const mat3 M3I = mat3( 0.00, -0.80, -0.60,  0.80,  0.36, -0.48,  0.60, -0.48,  0.64);
const mat2 M2  = mat2(0.80, 0.60, -0.60, 0.80);

vec4 fbmd(vec3 x, int oct){
  float a = 0.0, b = 0.5; vec3 d = vec3(0.0); mat3 m = mat3(1.0);
  for (int i = 0; i < 8; i++){ if (i >= oct) break;
    vec4 n = noised(x); a += b*n.x; d += b*m*n.yzw; b *= 0.5; x = 2.02*M3*x; m = 2.02*M3I*m; }
  return vec4(a, d);
}
float fbm3(vec3 x, int oct){
  float a = 0.0, b = 0.5;
  for (int i = 0; i < 8; i++){ if (i >= oct) break; a += b*noise3(x); b *= 0.5; x = 2.03*M3*x; }
  return a;
}
float fbm2(vec2 x, int oct){
  float a = 0.0, b = 0.5;
  for (int i = 0; i < 9; i++){ if (i >= oct) break; a += b*noise2(x); b *= 0.5; x = 2.03*M2*x + vec2(17.1, 3.7); }
  return a;
}
vec3 voro2(vec2 x){
  vec2 n = floor(x); vec2 f = fract(x);
  float md = 8.0, md2 = 8.0; vec2 mr = vec2(0.0); float id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    vec2 g = vec2(float(i), float(j));
    ivec2 c = ivec2(n + g);
    vec2 o = h22(c);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < md){ md2 = md; md = d; mr = r; id = h2(c); } else if (d < md2) md2 = d;
  }
  return vec3(sqrt(md), sqrt(md2) - sqrt(md), id);
}

// ---------------------------------------------------------------- scene access
vec4 objT(int i, int k){ return texelFetch(uObjTex, ivec2(k, i), 0); }
vec4 matT(int i, int k){ return texelFetch(uMatTex, ivec2(k, i), 0); }

vec3 safeDir(vec3 d){ return mix(d, vec3(1e-9), vec3(lessThan(abs(d), vec3(1e-9)))); }

// ---------------------------------------------------------------- primitives (object space, unnormalized dir)
bool iSphere(vec3 o, vec3 d, float tmax, out float t, out vec3 n){
  float a = dot(d,d), b = dot(o,d), c = dot(o,o) - 1.0;
  float h = b*b - a*c; if (h < 0.0) return false; h = sqrt(h);
  float t0 = (-b - h)/a, t1 = (-b + h)/a;
  t = t0 > EPS ? t0 : t1;
  if (t <= EPS || t >= tmax) return false;
  n = o + d*t; return true;
}
bool iBox(vec3 o, vec3 d, float tmax, out float t, out vec3 n){
  vec3 dd = safeDir(d); vec3 inv = 1.0/dd;
  vec3 t1 = (-1.0 - o)*inv, t2 = (1.0 - o)*inv;
  vec3 tn = min(t1, t2), tf = max(t1, t2);
  float tN = max(max(tn.x, tn.y), tn.z), tF = min(min(tf.x, tf.y), tf.z);
  if (tN > tF || tF < EPS) return false;
  if (tN > EPS){ t = tN; n = -sign(dd)*step(tn.yzx, tn.xyz)*step(tn.zxy, tn.xyz); }
  else { t = tF; n = sign(dd)*step(tf.xyz, tf.yzx)*step(tf.xyz, tf.zxy); }
  return t < tmax;
}
bool iCyl(vec3 o, vec3 d, float tmax, out float t, out vec3 n){
  float best = tmax; bool hit = false;
  float a = d.x*d.x + d.z*d.z, b = o.x*d.x + o.z*d.z, c = o.x*o.x + o.z*o.z - 1.0;
  if (a > 1e-14){ float h = b*b - a*c; if (h >= 0.0){ h = sqrt(h);
    for (int k = 0; k < 2; k++){ float tt = k == 0 ? (-b - h)/a : (-b + h)/a;
      if (tt > EPS && tt < best){ float y = o.y + d.y*tt; if (abs(y) <= 1.0){ best = tt; n = vec3(o.x + d.x*tt, 0.0, o.z + d.z*tt); hit = true; } } } } }
  if (abs(d.y) > 1e-14){ for (int k = 0; k < 2; k++){ float yc = k == 0 ? -1.0 : 1.0; float tt = (yc - o.y)/d.y;
    if (tt > EPS && tt < best){ vec2 q = o.xz + d.xz*tt; if (dot(q,q) <= 1.0){ best = tt; n = vec3(0.0, yc, 0.0); hit = true; } } } }
  t = best; return hit;
}
bool iCone(vec3 o, vec3 d, float tmax, out float t, out vec3 n){
  const float k2 = 0.25;
  float best = tmax; bool hit = false;
  float q = 1.0 - o.y;
  float a = d.x*d.x + d.z*d.z - k2*d.y*d.y;
  float b = o.x*d.x + o.z*d.z + k2*q*d.y;
  float c = o.x*o.x + o.z*o.z - k2*q*q;
  if (abs(a) > 1e-14){ float h = b*b - a*c; if (h >= 0.0){ h = sqrt(h);
    for (int k = 0; k < 2; k++){ float tt = k == 0 ? (-b - h)/a : (-b + h)/a;
      if (tt > EPS && tt < best){ vec3 p = o + d*tt; if (p.y >= -1.0 && p.y <= 1.0){ best = tt; n = vec3(p.x, k2*(1.0 - p.y), p.z); hit = true; } } } } }
  if (abs(d.y) > 1e-14){ float tt = (-1.0 - o.y)/d.y;
    if (tt > EPS && tt < best){ vec2 qq = o.xz + d.xz*tt; if (dot(qq,qq) <= 1.0){ best = tt; n = vec3(0.0, -1.0, 0.0); hit = true; } } }
  t = best; return hit;
}
bool iConvex(vec3 o, vec3 d, float tmax, int kind, out float t, out vec3 n){
  float tN = -1e30, tF = 1e30; vec3 nN = vec3(0.0), nF = vec3(0.0);
  for (int i = 0; i < 6; i++){
    vec4 pl;
    if (kind == 0){
      if (i == 5) break;
      pl = i == 0 ? vec4(2.0,1.0,0.0,-1.0) : i == 1 ? vec4(-2.0,1.0,0.0,-1.0) : i == 2 ? vec4(0.0,1.0,2.0,-1.0) : i == 3 ? vec4(0.0,1.0,-2.0,-1.0) : vec4(0.0,-1.0,0.0,-1.0);
    } else break;
    float den = dot(pl.xyz, d), dist = dot(pl.xyz, o) + pl.w;
    if (abs(den) < 1e-14){ if (dist > 0.0) return false; continue; }
    float tt = -dist/den;
    if (den < 0.0){ if (tt > tN){ tN = tt; nN = pl.xyz; } }
    else { if (tt < tF){ tF = tt; nF = pl.xyz; } }
  }
  if (tN > tF || tF < EPS) return false;
  if (tN > EPS){ t = tN; n = nN; } else { t = tF; n = nF; }
  return t < tmax;
}
bool iTorus(vec3 o, vec3 dU, float tmax, float r, out float t, out vec3 n){
  float L = length(dU); vec3 d = dU/L;
  float R = 1.0 - r;
  float b = dot(o, d), c = dot(o, o) - 1.02;
  float h = b*b - c; if (h < 0.0) return false; h = sqrt(h);
  float t0 = max(-b - h, 0.0), t1 = -b + h;
  if (t1 < 0.0) return false;
  float tt = t0;
  vec3 p0 = o + d*t0;
  bool inside = length(vec2(length(p0.xz) - R, p0.y)) - r < 0.0;
  for (int i = 0; i < 96; i++){
    vec3 p = o + d*tt;
    float s = length(vec2(length(p.xz) - R, p.y)) - r;
    if (inside) s = -s;
    if (s < 2e-4*(1.0 + tt)){
      t = tt/L; if (t <= EPS || t >= tmax) return false;
      vec2 q = vec2(length(p.xz) - R, p.y);
      vec2 dirxz = normalize(p.xz + vec2(1e-9));
      n = normalize(vec3(dirxz.x*q.x, q.y, dirxz.y*q.x));
      return true;
    }
    tt += s;
    if (tt > t1) return false;
  }
  return false;
}
float stoneSdf(vec3 p, float seed, float rough){
  vec3 q = p + vec3(seed*13.1, seed*7.7, seed*3.3);
  float s = length(p*vec3(1.0, 1.15, 1.0)) - 0.78;
  s += rough*(0.18*noise3(q*1.6) + 0.07*noise3(q*3.7) + 0.025*noise3(q*8.3));
  return s;
}
bool iStone(vec3 o, vec3 dU, float tmax, float seed, float rough, out float t, out vec3 n){
  float L = length(dU); vec3 d = dU/L;
  float b = dot(o,d), c = dot(o,o) - 1.1;
  float h = b*b - c; if (h < 0.0) return false; h = sqrt(h);
  float t0 = max(-b - h, 0.0), t1 = -b + h;
  if (t1 < 0.0) return false;
  float tt = t0;
  bool inside = stoneSdf(o + d*t0, seed, rough) < 0.0;
  for (int i = 0; i < 80; i++){
    vec3 p = o + d*tt;
    float s = stoneSdf(p, seed, rough);
    if (inside) s = -s;
    if (s < 0.0015){
      t = tt/L; if (t <= EPS*2.0 || t >= tmax) return false;
      vec2 e = vec2(0.003, -0.003);
      n = normalize(e.xyy*stoneSdf(p + e.xyy, seed, rough) + e.yyx*stoneSdf(p + e.yyx, seed, rough) + e.yxy*stoneSdf(p + e.yxy, seed, rough) + e.xxx*stoneSdf(p + e.xxx, seed, rough));
      return true;
    }
    tt += max(s*0.7, 0.002);
    if (tt > t1) return false;
  }
  return false;
}

// ---------------------------------------------------------------- terrain
float tH(ivec2 c, int layer){ return texelFetch(uHeights, ivec3(c, layer), 0).r; }

bool iTerrain(vec3 o, vec3 d, float tmax, int layer, float res, int top, out float t, out vec3 n, out vec2 uv){
  t = 0.0; n = vec3(0.0, 1.0, 0.0); uv = vec2(0.0);
  float hTop = texelFetch(uCellMax, ivec3(0, 0, layer), top).r + 1e-4;
  vec3 dd = safeDir(d); vec3 inv = 1.0/dd;
  vec3 bmin = vec3(-1.0, -1e-4, -1.0), bmax = vec3(1.0, hTop, 1.0);
  vec3 t1 = (bmin - o)*inv, t2 = (bmax - o)*inv;
  vec3 tn = min(t1, t2), tf = max(t1, t2);
  float tN = max(max(tn.x, tn.y), tn.z), tF = min(min(tf.x, tf.y), tf.z);
  if (tN > tF || tF < EPS) return false;
  bool startInside = tN < 0.0;
  tN = max(tN, 0.0);
  if (tN >= tmax) return false;
  tF = min(tF, tmax);
  vec2 g0 = (o.xz*0.5 + 0.5)*res;
  vec2 gd = d.xz*0.5*res;
  if (!startInside){
    vec3 pe = o + d*tN;
    vec2 ge = clamp((pe.xz*0.5 + 0.5)*res, vec2(0.0), vec2(res - 1e-3));
    ivec2 ci = ivec2(floor(ge)); vec2 f = ge - vec2(ci);
    float he = mix(mix(tH(ci, layer), tH(ci + ivec2(1,0), layer), f.x), mix(tH(ci + ivec2(0,1), layer), tH(ci + ivec2(1,1), layer), f.x), f.y);
    if (pe.y < he - 2e-5){
      t = tN;
      n = -sign(dd)*step(tn.yzx, tn.xyz)*step(tn.zxy, tn.xyz);
      uv = ge/res;
      return t > EPS;
    }
  }
  vec3 ob = o + d*tN;
  float tBase = tN;
  g0 = (ob.xz*0.5 + 0.5)*res;
  o = ob;
  tF -= tBase;
  vec2 bias = sign(gd)*2e-3;
  float tc = 0.0;
  int L = top;
  float rmax = res;
  for (int i = 0; i < 2048; i++){
    if (i >= uTerrIter || tc > tF) break;
    vec2 g = g0 + gd*tc;
    float cs = float(1 << L);
    vec2 c = clamp(floor((g + bias)/cs), vec2(0.0), vec2(rmax/cs - 1.0));
    vec2 cmin = c*cs, cmax = cmin + cs;
    float txe = gd.x > 0.0 ? (cmax.x - g0.x)/gd.x : (gd.x < 0.0 ? (cmin.x - g0.x)/gd.x : 1e30);
    float tze = gd.y > 0.0 ? (cmax.y - g0.y)/gd.y : (gd.y < 0.0 ? (cmin.y - g0.y)/gd.y : 1e30);
    float te = min(min(txe, tze), tF);
    float y0 = o.y + d.y*tc, y1 = o.y + d.y*te;
    float hmax = texelFetch(uCellMax, ivec3(ivec2(c), layer), L).r;
    if (min(y0, y1) > hmax){ if (te >= tF) break; tc = max(te, tc); L = min(L + 1, top); continue; }
    if (L > 0){ L--; continue; }
    ivec2 ci = ivec2(c);
    float h00 = tH(ci, layer), h10 = tH(ci + ivec2(1,0), layer), h01 = tH(ci + ivec2(0,1), layer), h11 = tH(ci + ivec2(1,1), layer);
    vec2 l0 = g - cmin;
    float s1 = te - tc;
    float B = h10 - h00, C = h01 - h00, E = h00 - h10 - h01 + h11;
    float hc0 = h00 + B*l0.x + C*l0.y + E*l0.x*l0.y;
    float hc1 = B*gd.x + C*gd.y + E*(l0.x*gd.y + l0.y*gd.x);
    float hc2 = E*gd.x*gd.y;
    float qa = -hc2, qb = d.y - hc1, qc = y0 - hc0;
    float sHit = -1.0;
    if (qc <= 0.0) sHit = 0.0;
    else if (abs(qa) < 1e-12){ if (qb < 0.0){ float s = -qc/qb; if (s <= s1) sHit = s; } }
    else {
      float disc = qb*qb - 4.0*qa*qc;
      if (disc >= 0.0){
        float sq = sqrt(disc);
        float qq = -0.5*(qb + (qb >= 0.0 ? sq : -sq));
        float r1 = qq/qa, r2 = abs(qq) > 1e-20 ? qc/qq : 1e30;
        float rmin = min(r1, r2), rmx = max(r1, r2);
        if (rmin >= 0.0 && rmin <= s1) sHit = rmin; else if (rmx >= 0.0 && rmx <= s1) sHit = rmx;
      }
    }
    if (sHit >= 0.0 && tc + sHit + tBase > EPS){
      t = tc + sHit;
      vec2 gh = g0 + gd*t;
      t += tBase;
      vec2 gr = texture(uGrad, vec3((gh + 0.5)/uGridSize, float(layer))).rg;
      n = vec3(-gr.x*res*0.5, 1.0, -gr.y*res*0.5);
      uv = gh/res;
      return true;
    }
    if (te >= tF) break;
    tc = max(te, tc); L = min(L + 1, top);
  }
  return false;
}

// ---------------------------------------------------------------- scene intersection
struct Hit { float t; int obj; vec3 n; vec3 po; vec2 uv; };

bool intersectObj(int oi, vec3 ro, vec3 rd, float tmax, out float t, out vec3 n, out vec3 po, out vec2 uv){
  vec4 hd = objT(oi, 0);
  int type = int(hd.x);
  vec4 r0 = objT(oi, 1), r1 = objT(oi, 2), r2 = objT(oi, 3);
  vec3 o = vec3(dot(r0.xyz, ro) + r0.w, dot(r1.xyz, ro) + r1.w, dot(r2.xyz, ro) + r2.w);
  vec3 d = vec3(dot(r0.xyz, rd), dot(r1.xyz, rd), dot(r2.xyz, rd));
  bool hit = false; uv = vec2(0.0);
  if (type == 1) hit = iSphere(o, d, tmax, t, n);
  else if (type == 2) hit = iBox(o, d, tmax, t, n);
  else if (type == 3) hit = iCyl(o, d, tmax, t, n);
  else if (type == 4) hit = iCone(o, d, tmax, t, n);
  else if (type == 5){ vec4 pr = objT(oi, 5); hit = iTorus(o, d, tmax, pr.x, t, n); }
  else if (type == 6) hit = iConvex(o, d, tmax, 0, t, n);
  else if (type == 7 || type == 8){
    if (abs(d.y) > 1e-14){ float tt = -o.y/d.y; vec2 q = o.xz + d.xz*tt;
      bool inside = type == 7 ? dot(q,q) <= 1.0 : (abs(q.x) <= 1.0 && abs(q.y) <= 1.0);
      if (tt > EPS && tt < tmax && inside){ t = tt; n = vec3(0.0, 1.0, 0.0); hit = true; } }
  }
  else if (type == 9){ vec4 pr = objT(oi, 5); hit = iStone(o, d, tmax, pr.x, pr.y, t, n); }
  else if (type == 10){ vec4 pr = objT(oi, 5); hit = iTerrain(o, d, tmax, int(hd.z), pr.x, int(pr.y), t, n, uv); }
  else if (type == 11){
    if (abs(d.y) > 1e-14){ float tt = -o.y/d.y; if (tt > EPS && tt < tmax){ t = tt; n = vec3(0.0, 1.0, 0.0); hit = true; } }
  }
  if (hit) po = o + d*t;
  return hit;
}

bool traceScene(vec3 ro, vec3 rd, float tmax, int ignore, out Hit h){
  h.t = tmax; h.obj = -1; h.n = vec3(0.0, 1.0, 0.0); h.po = vec3(0.0); h.uv = vec2(0.0);
  for (int i = 0; i < MAX_OBJ; i++){
    if (i >= uObjCount) break;
    int oi = uObjStart + i;
    if (oi == ignore) continue;
    vec4 bs = objT(oi, 4);
    if (bs.w > 0.0){
      vec3 oc = ro - bs.xyz; float b = dot(oc, rd); float c = dot(oc, oc) - bs.w*bs.w;
      if (c > 0.0 && b > 0.0) continue;
      float disc = b*b - c; if (disc < 0.0) continue;
      if (-b - sqrt(disc) > h.t) continue;
    }
    float t; vec3 n, po; vec2 uv;
    if (intersectObj(oi, ro, rd, h.t, t, n, po, uv)){ if (t < h.t){ h.t = t; h.obj = oi; h.n = n; h.po = po; h.uv = uv; } }
  }
  return h.obj >= 0;
}

vec3 shadowTrace(vec3 ro, vec3 rd, float tmax, int self){
  vec3 tr = vec3(1.0);
  for (int i = 0; i < MAX_OBJ; i++){
    if (i >= uObjCount) break;
    int oi = uObjStart + i;
    vec4 hd = objT(oi, 0);
    if (hd.y > 0.5 && hd.y < 1.5) continue;
    vec4 bs = objT(oi, 4);
    if (bs.w > 0.0){
      vec3 oc = ro - bs.xyz; float b = dot(oc, rd); float c = dot(oc, oc) - bs.w*bs.w;
      if (c > 0.0 && b > 0.0) continue;
      float disc = b*b - c; if (disc < 0.0) continue;
      if (-b - sqrt(disc) > tmax) continue;
    }
    float t; vec3 n, po; vec2 uv;
    if (intersectObj(oi, ro, rd, tmax, t, n, po, uv)){
      vec4 m6 = matT(oi, 6);
      vec4 m7 = matT(oi, 7);
      float tp = m6.x;
      if (tp <= 0.001) return vec3(0.0);
      tr *= tp*mix(vec3(1.0), m7.rgb, 0.85);
      if (max(tr.r, max(tr.g, tr.b)) < 0.01) return vec3(0.0);
    }
  }
  return tr;
}

// ---------------------------------------------------------------- sky
vec3 hazeTarget(vec3 d){
  float cs = max(dot(d, uDiscDir), 0.0);
  return uHazeCol + uDiscCol*uDiscVis*(0.35*pow(cs, 6.0) + 0.25*pow(cs, 40.0))*(0.4 + uHazeAmt);
}
vec3 skyBase(vec3 d){
  float yy = max(d.y, 0.0);
  float g = pow(1.0 - yy, uSkyCurve);
  vec3 c = mix(uZenith, uHorizon, g);
  vec2 az = normalize(d.xz + vec2(1e-6));
  vec2 sz = normalize(uDiscDir.xz + vec2(1e-6));
  float side = pow(dot(az, sz)*0.5 + 0.5, 2.5);
  c = mix(c, uSunset, clamp(uSunsetAmt*g*g*side, 0.0, 1.0));
  float cs = max(dot(d, uDiscDir), 0.0);
  c += uDiscCol*uGlow*uDiscVis*(0.22*pow(cs, 10.0) + 0.45*pow(cs, 90.0) + 0.6*pow(cs, 900.0));
  float hz = uHazeAmt*pow(1.0 - yy, 7.0);
  c = mix(c, hazeTarget(d), clamp(hz, 0.0, 1.0));
  return c;
}
vec3 spectral(float x){
  x = clamp(x, 0.0, 1.0);
  return clamp(vec3(abs(x*6.0 - 3.0) - 1.0, 2.0 - abs(x*6.0 - 2.0), 2.0 - abs(x*6.0 - 4.0)), 0.0, 1.0).bgr;
}
vec3 skyFull(vec3 ro, vec3 d){
  if (uSkyOff == 1) return uZenith;
  vec3 c = skyBase(d);
  if (d.y > -0.02){
    if (uStars > 0.001 && d.y > 0.0){
      vec3 q = d*220.0;
      ivec3 cell = ivec3(floor(q));
      float hs = h3(cell);
      if (hs > 0.985){
        vec3 cc = vec3(cell) + 0.5 + (vec3(h3(cell + ivec3(5)), h3(cell + ivec3(9)), h3(cell + ivec3(13))) - 0.5)*0.6;
        float dist = length(q - cc);
        float br = (hs - 0.985)/0.015;
        c += uStars*vec3(0.85, 0.9, 1.0)*br*br*smoothstep(0.32, 0.0, dist)*smoothstep(0.0, 0.25, d.y);
      }
    }
    if (uMoonVis > 0.001){
      float cm = dot(d, uMoonDir);
      float ms = uDiscSize*1.25;
      float ang = acos(clamp(cm, -1.0, 1.0));
      if (ang < ms*1.6){
        vec3 up = abs(uMoonDir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 mx = normalize(cross(up, uMoonDir)), my = cross(uMoonDir, mx);
        vec2 lp = vec2(dot(d, mx), dot(d, my))/sin(ms);
        float r2 = dot(lp, lp);
        if (r2 < 1.0){
          float z = sqrt(1.0 - r2);
          vec3 sn = vec3(lp, z);
          vec3 ld = normalize(vec3(cos(uMoonPhase*PI)*0.999, 0.15, sin(uMoonPhase*PI)));
          float lit = smoothstep(-0.05, 0.12, dot(sn, ld));
          float mare = 0.82 + 0.18*fbm2(lp*3.0 + 4.0, 3);
          vec3 mc = vec3(0.96, 0.95, 0.9)*mare*(0.08 + 0.92*lit);
          c = mix(c, mc*1.05, uMoonVis*smoothstep(1.0, 0.92, r2));
        }
        c += uMoonVis*vec3(0.5, 0.55, 0.7)*0.15*pow(max(cm, 0.0), 400.0);
      }
    }
    if (uRainbow > 0.001 && uDiscVis > 0.01){
      float a = degrees(acos(clamp(dot(d, -uDiscDir), -1.0, 1.0)));
      float x = (a - 40.2)/2.6;
      if (x > 0.0 && x < 1.0){
        float w = sin(x*PI);
        c += uRainbow*0.45*spectral(x)*w*w*smoothstep(-0.02, 0.1, d.y);
      }
    }
    if (uHalo > 0.001 && uDiscVis > 0.01){
      float a = degrees(acos(clamp(dot(d, uDiscDir), -1.0, 1.0)));
      float ring = exp(-pow((a - 22.0)/0.9, 2.0));
      c += uHalo*0.35*mix(vec3(1.0, 0.85, 0.7), vec3(0.8, 0.9, 1.0), smoothstep(21.0, 23.0, a))*ring;
    }
    float cs = dot(d, uDiscDir);
    if (uDiscVis > 0.001){
      float ang = acos(clamp(cs, -1.0, 1.0));
      float disc = smoothstep(uDiscSize, uDiscSize*0.86, ang);
      c = mix(c, uDiscCol*1.6 + vec3(0.25), disc*uDiscVis);
    }
    if (uCloudsOn == 1 && uCloudAmt > 0.001 && d.y > 0.0){
      float t = (uCloudH - ro.y)/d.y;
      if (t > 0.0){
        vec2 p = (ro.xz + d.xz*t)*uCloudFreq*0.0012 + uCloudOff;
        float n = fbm2(p, 6)*0.5 + 0.5;
        float n2 = fbm2(p + uSunDir.xz*0.06, 4)*0.5 + 0.5;
        float th = 1.0 - uCloudCover;
        float dens = smoothstep(th, th + uCloudSoft, n)*uCloudAmt;
        float shade = clamp(0.62 + (n - n2)*uCloudAmp*4.0, 0.0, 1.2);
        float edge = 1.0 - smoothstep(th, th + 0.5, n);
        vec3 lit = uCloudCol*(uAmbient*0.7 + uSunCol*0.85*shade) + uDiscCol*uDiscVis*pow(max(cs, 0.0), 6.0)*edge*0.9;
        float fade = exp(-t/(uCloudH*16.0 + 1.0))*smoothstep(0.0, 0.08, d.y);
        dens *= fade;
        vec3 hz = mix(lit, hazeTarget(d), clamp(1.0 - fade, 0.0, 1.0)*0.6);
        c = mix(c, hz, clamp(dens, 0.0, 1.0));
      }
    }
  }
  return c;
}
vec3 skyEnv(vec3 d){ return skyBase(d); }

// atmosphere over a segment; returns premultiplied in-scatter, writes transmittance
vec3 atmosphere(vec3 o, vec3 d, float t, out vec3 trans){
  float fH = 1.0 - exp(-uHazeDen*t);
  vec3 hzC = mix(skyBase(normalize(vec3(d.x, 0.0, d.z) + vec3(0.0, 1e-4, 0.0))), hazeTarget(d), 0.35);
  float fF = 0.0;
  if (uFogDen > 0.0){
    float k = 1.0/max(uFogH, 0.01);
    float a = uFogDen*exp(-max(o.y, -50.0)*k);
    float dy = d.y*t*k;
    float od = abs(dy) > 1e-4 ? a*(1.0 - exp(-dy))/(d.y*k) : a*t;
    fF = 1.0 - exp(-max(od, 0.0));
  }
  float cs = max(dot(d, uDiscDir), 0.0);
  vec3 fogC = uFogCol*(0.55 + 0.45*uDiscVis) + uDiscCol*uDiscVis*0.25*pow(cs, 8.0);
  trans = vec3((1.0 - fH)*(1.0 - fF));
  return hzC*fH*(1.0 - fF) + fogC*fF;
}

// ---------------------------------------------------------------- materials
struct Mat {
  vec3 a, b, c; float pat; float scale; float turb;
  vec3 amb; float ambience; vec3 spec; float specularity;
  float diffusion, specExp, metal, refl;
  float trans, ior, bump, fresnel;
  vec3 tcol; float mapping;
  vec4 pp; vec4 pq;
};
Mat getMat(int oi){
  Mat m;
  vec4 m0 = matT(oi,0), m1 = matT(oi,1), m2 = matT(oi,2), m3 = matT(oi,3), m4 = matT(oi,4), m5 = matT(oi,5), m6 = matT(oi,6), m7 = matT(oi,7);
  m.a = m0.rgb; m.pat = m0.w; m.b = m1.rgb; m.scale = m1.w; m.c = m2.rgb; m.turb = m2.w;
  m.amb = m3.rgb; m.ambience = m3.w; m.spec = m4.rgb; m.specularity = m4.w;
  m.diffusion = m5.x; m.specExp = m5.y; m.metal = m5.z; m.refl = m5.w;
  m.trans = m6.x; m.ior = m6.y; m.bump = m6.z; m.fresnel = m6.w;
  m.tcol = m7.rgb; m.mapping = m7.w;
  m.pp = matT(oi, 8); m.pq = matT(oi, 9);
  return m;
}
vec3 ramp3(vec3 a, vec3 b, vec3 c, float x){
  x = clamp(x, 0.0, 1.0);
  return x < 0.5 ? mix(a, b, x*2.0) : mix(b, c, x*2.0 - 1.0);
}

// returns base color; writes bump gradient (mapping space) and emission
vec3 pattern(Mat m, vec3 p, float alt, float slope, vec3 pw, float fw, out vec3 g, out vec3 emis){
  g = vec3(0.0); emis = vec3(0.0);
  int pat = int(m.pat + 0.5);
  vec3 q = p*m.scale;
  if (pat == 0) return m.a;
  if (pat == 1){
    vec3 qq = q + vec3(1e-3);
    float s = mod(floor(qq.x) + floor(qq.y) + floor(qq.z), 2.0);
    return mix(s < 0.5 ? m.a : m.b, (m.a + m.b)*0.5, smoothstep(0.35, 1.3, fw));
  }
  if (pat == 2){
    vec4 nd = fbmd(q*0.9, 4);
    float f = alt*m.pp.x + m.turb*nd.x*0.8 + 0.25*fbm3(q*vec3(0.25, 3.0, 0.25), 2);
    float band = floor(f);
    float fr = fract(f);
    float hb = h2(ivec2(int(band), 3));
    vec3 col = ramp3(m.a, m.b, m.c, hb);
    col *= 0.86 + 0.14*smoothstep(0.0, 0.12, fr)*smoothstep(1.0, 0.82, fr);
    col *= 0.9 + 0.1*fbm3(q*6.0, 3);
    float top = smoothstep(m.pp.y, m.pp.y + 0.12, slope);
    col = mix(col, m.c*(0.92 + 0.08*nd.x), top*m.pp.z);
    g = nd.yzw*0.35;
    return col;
  }
  if (pat == 3){
    vec4 nd = fbmd(q*0.7, 5);
    float n = nd.x;
    float grassTop = m.pp.x + n*0.08;
    float snowLine = m.pp.y + n*0.1;
    float steep = 1.0 - smoothstep(m.pp.z - 0.08, m.pp.z + 0.08, slope);
    vec3 grass = m.a*(0.85 + 0.25*fbm3(q*4.0, 3));
    vec3 rock = m.b*(0.8 + 0.3*fbm3(q*3.0 + 5.0, 3));
    vec3 snow = m.c;
    vec3 col = mix(grass, rock, smoothstep(grassTop - 0.05, grassTop + 0.05, alt));
    col = mix(col, rock, steep);
    float sn = smoothstep(snowLine - 0.04, snowLine + 0.04, alt)*smoothstep(m.pp.z - 0.15, m.pp.z + 0.1, slope);
    col = mix(col, snow, sn);
    g = nd.yzw*0.3*(1.0 - sn*0.7);
    return col;
  }
  if (pat == 4){
    vec4 nd = fbmd(q*0.8, 5);
    float v = sin(q.x*2.5 + q.y*0.6 + m.turb*nd.x*6.0);
    float vein = pow(1.0 - abs(v), 6.0);
    vec3 col = mix(m.a, m.b, vein);
    col = mix(col, m.c, smoothstep(0.6, 1.0, fbm3(q*1.5 + 9.0, 3)*0.5 + 0.5)*0.5);
    g = nd.yzw*0.05;
    return col;
  }
  if (pat == 5){
    float n1 = noise3(q*6.0), n2 = noise3(q*17.0 + 3.0), n3 = fbm3(q*2.0, 3);
    vec3 col = mix(m.a, m.b, smoothstep(0.1, 0.5, n1*0.6 + n3*0.4));
    col = mix(col, m.c, smoothstep(0.55, 0.75, n2));
    vec4 nd = fbmd(q*5.0, 2);
    g = nd.yzw*0.08;
    return col;
  }
  if (pat == 6){
    vec4 nd = fbmd(q, 6);
    float x = nd.x*m.turb*1.4 + 0.5;
    g = nd.yzw*0.2;
    return ramp3(m.a, m.b, m.c, x);
  }
  if (pat == 7){
    float r = length(q.xz) + m.turb*fbm3(q*vec3(0.6, 0.15, 0.6), 3)*1.5;
    float f = fract(r*2.0);
    float ring = smoothstep(0.0, 0.25, f)*smoothstep(1.0, 0.6, f);
    vec3 col = mix(m.b, m.a, ring);
    col *= 0.9 + 0.1*noise3(q*vec3(1.0, 30.0, 1.0));
    return col;
  }
  if (pat == 8){
    vec4 nd = fbmd(q*0.8, 6);
    float r = 1.0 - abs(nd.x*1.6);
    float cre = smoothstep(0.75, 0.98, r);
    vec3 col = mix(m.b, m.a, cre);
    col = mix(col, m.c, smoothstep(0.2, 0.6, fbm3(q*0.4 + 2.0, 3))*0.6);
    col *= 0.85 + 0.2*noise3(q*9.0);
    g = nd.yzw*(nd.x > 0.0 ? -1.0 : 1.0)*0.9;
    return col;
  }
  if (pat == 9){
    float w = fbm3(q*0.3, 3);
    float ph = q.x*m.pp.x + q.z*0.3*m.pp.x + w*m.turb*8.0;
    float rip = sin(ph);
    g = vec3(cos(ph)*m.pp.x, 0.0, cos(ph)*0.3*m.pp.x)*0.04;
    vec3 col = mix(m.a, m.b, smoothstep(-0.4, 0.6, w + rip*0.15));
    return col*(0.94 + 0.06*noise3(q*20.0));
  }
  if (pat == 10){
    vec3 an = vec3(0.45, 0.0, 1.6);
    vec3 wq = vec3(pw.x, 0.0, pw.z)*an*m.scale*0.07 + vec3(uTime*0.05, 0.0, uTime*0.08);
    vec4 nd = fbmd(wq, 4);
    vec4 nd2 = fbmd(wq*2.7 + 11.0, 2);
    float fwW = fw/0.05*0.07*1.6;
    float fade = 1.0 - smoothstep(0.15, 1.6, fwW);
    float fade2 = 1.0 - smoothstep(0.05, 0.6, fwW);
    g = (nd.yzw*fade + nd2.yzw*0.35*fade2)*an*0.55;
    g.y = 0.0;
    return mix(m.a, m.b, clamp(nd.x*0.5 + 0.5, 0.0, 1.0)*m.turb);
  }
  if (pat == 11){
    vec3 f = abs(fract(q + 0.5) - 0.5);
    float lw = m.pp.x*0.5;
    float line = 1.0 - smoothstep(lw*0.6, lw, min(f.x, f.z));
    return mix(m.a, m.b, line);
  }
  if (pat == 12){
    vec2 qq = q.xz + vec2(fbm3(q*0.5, 2), fbm3(q*0.5 + 7.0, 2))*m.turb;
    vec3 v = voro2(qq);
    float crack = 1.0 - smoothstep(0.0, 0.08 + 0.05*m.pp.x, v.y);
    vec3 col = mix(m.a, m.b, v.z*0.5 + 0.3*fbm3(q*3.0, 3));
    emis = m.c*crack*2.2;
    col = mix(col, m.c, crack);
    g = vec3(0.0, 0.0, 0.0);
    return col;
  }
  if (pat == 13){
    vec2 qq = q.xz + vec2(fbm3(q*0.7, 2), fbm3(q*0.7 + 5.0, 2))*m.turb*0.6;
    vec3 v = voro2(qq);
    float crack = 1.0 - smoothstep(0.0, 0.05 + 0.04*m.pp.x, v.y);
    vec3 col = mix(m.a, m.a*0.85 + m.c*0.15, v.z);
    col *= 0.9 + 0.1*noise3(q*8.0);
    col = mix(col, m.b, crack);
    return col;
  }
  if (pat == 14){
    float x = alt + m.turb*fbm3(q, 4)*0.3;
    return ramp3(m.a, m.b, m.c, x);
  }
  if (pat == 15){
    vec4 nd = fbmd(q*0.6, 6);
    float n = nd.x*0.5 + 0.5;
    vec3 col = ramp3(m.a, m.b, m.c, clamp(alt*m.pp.x + n*m.turb, 0.0, 1.0));
    float cr = smoothstep(0.55, 0.9, 1.0 - abs(fbm3(q*2.5, 4)*2.0));
    col *= 1.0 - cr*0.35;
    col *= 0.9 + 0.15*noise3(q*12.0);
    g = nd.yzw*0.5;
    return col;
  }
  return m.a;
}

// ---------------------------------------------------------------- shading
vec3 objNormalToWorld(int oi, vec3 n){
  vec4 r0 = objT(oi, 1), r1 = objT(oi, 2), r2 = objT(oi, 3);
  return normalize(r0.xyz*n.x + r1.xyz*n.y + r2.xyz*n.z);
}

vec3 traceRay(vec3 ro, vec3 rd){
  vec3 sO[STK]; vec3 sD[STK]; vec3 sW[STK]; int sDep[STK]; float sDist[STK];
  int sp = 1; sO[0] = ro; sD[0] = rd; sW[0] = vec3(1.0); sDep[0] = 0; sDist[0] = 0.0;
  vec3 acc = vec3(0.0);
  int rays = 0;
  for (int it = 0; it < 24; it++){
    if (sp == 0) break;
    sp--;
    vec3 o = sO[sp], d = sD[sp], w = sW[sp]; int dep = sDep[sp]; float dist0 = sDist[sp];
    if (rays >= uMaxRays){ acc += w*skyFull(o, d); continue; }
    rays++;
    Hit h;
    if (!traceScene(o, d, 1e7, -1, h)){
      vec3 sc = skyFull(o, d);
      if (uFogDen > 0.0){
        float k = 1.0/max(uFogH, 0.01);
        float a = uFogDen*exp(-max(o.y, -50.0)*k);
        float tt = 9000.0;
        float dy = d.y*tt*k;
        float od = abs(dy) > 1e-4 ? a*(1.0 - exp(-dy))/(d.y*k) : a*tt;
        float fF = 1.0 - exp(-max(od, 0.0));
        float cs = max(dot(d, uDiscDir), 0.0);
        vec3 fogC = uFogCol*(0.55 + 0.45*uDiscVis) + uDiscCol*uDiscVis*0.25*pow(cs, 8.0);
        sc = mix(sc, fogC, fF);
      }
      acc += w*sc;
      continue;
    }
    int oi = h.obj;
    vec3 p = o + d*h.t;
    vec3 n = objNormalToWorld(oi, h.n);
    Mat m = getMat(oi);
    vec3 trA;
    vec3 atm = atmosphere(o, d, h.t, trA);
    acc += w*atm;
    w *= trA;
    if (max(w.r, max(w.g, w.b)) < uMinW*0.25) continue;

    vec4 hd = objT(oi, 0);
    int type = int(hd.x);
    float alt = type == 10 ? clamp(h.po.y, 0.0, 1.0) : h.po.y*0.5 + 0.5;
    vec3 mp = m.mapping > 0.5 ? p*0.05 : h.po;
    if (type == 10 && m.mapping < 0.5) mp = vec3(h.po.x*8.0, h.po.y*4.0, h.po.z*8.0);
    if (type == 11 && m.mapping < 0.5) mp = vec3(h.po.x, 0.0, h.po.z)*0.05;
    bool inside = dot(n, d) > 0.0;
    vec3 nf = inside ? -n : n;
    vec3 gb, emis;
    vec4 r0 = objT(oi, 1);
    float mapScale = m.mapping > 0.5 || type == 11 ? 0.05 : (type == 10 ? 8.0*length(r0.xyz) : length(r0.xyz));
    float fwWorld = (dist0 + h.t)*uPixAng/max(abs(dot(n, d)), 0.12);
    float fw = fwWorld*mapScale*m.scale;
    vec3 base = pattern(m, mp, alt, nf.y, p, fw, gb, emis);
    if (int(m.pat + 0.5) != 10) gb *= 1.0 - smoothstep(0.4, 2.5, fw);
    if (uBumpOn == 1 && m.bump != 0.0 && dot(gb, gb) > 0.0){
      vec3 gw = gb;
      if (m.mapping < 0.5 && int(m.pat + 0.5) != 10) gw = objNormalToWorld(oi, gb)*length(gb);
      vec3 gt = gw - dot(gw, nf)*nf;
      nf = normalize(nf - m.bump*gt);
    }
    vec3 v = -d;
    vec3 amb = m.amb.r < 0.0 ? base : m.amb;
    vec3 local = m.ambience*amb*uAmbient + emis;
    vec3 spec = vec3(0.0);
    vec3 pOff = p + nf*(2e-3 + h.t*4e-6);
    float ndl = dot(nf, uSunDir);
    vec3 specTint = mix(m.spec, m.spec*base, m.metal);
    if (ndl > 0.0 && max(uSunCol.r, max(uSunCol.g, uSunCol.b)) > 0.0){
      vec3 sh = vec3(1.0);
      if (uShadowsOn == 1 && uShadow > 0.0) sh = mix(vec3(1.0), shadowTrace(pOff, uSunDir, 1e7, oi), uShadow);
      vec3 Lc = uSunCol*sh;
      local += m.diffusion*base*Lc*ndl;
      vec3 r = reflect(-uSunDir, nf);
      float sp2 = pow(max(dot(r, v), 0.0), m.specExp);
      spec += m.specularity*specTint*Lc*sp2;
    }
    for (int li = 0; li < 8; li++){
      if (li >= uLightCount) break;
      vec3 L = uLightPos[li].xyz - p;
      float dist = length(L); L /= dist;
      float nl = dot(nf, L);
      if (nl <= 0.0) continue;
      float att = 1.0/(1.0 + pow(dist/max(uLightPos[li].w, 0.01), 2.0));
      vec3 Lc = uLightCol[li].rgb*att;
      if (uLightShadows == 1 && uShadowsOn == 1) Lc *= mix(vec3(1.0), shadowTrace(pOff, L, dist, oi), uShadow);
      local += m.diffusion*base*Lc*nl;
      vec3 r = reflect(-L, nf);
      spec += m.specularity*specTint*Lc*pow(max(dot(r, v), 0.0), m.specExp);
    }
    float refl = m.refl;
    float trn = m.trans;
    float cosi = clamp(dot(v, nf), 0.0, 1.0);
    if (m.fresnel > 0.5){
      float f0 = pow((m.ior - 1.0)/(m.ior + 1.0), 2.0);
      float fr = f0 + (1.0 - f0)*pow(1.0 - cosi, 5.0);
      refl = clamp(refl*0.35 + fr*(1.0 - refl*0.35), 0.0, 1.0)*step(0.001, max(m.refl, m.trans));
      refl = max(refl, m.refl*0.25);
    }
    vec3 wLocal = vec3((1.0 - refl)*(1.0 - trn));
    acc += w*(wLocal*local + spec);
    vec3 wR = w*refl*(1.0 - trn)*mix(vec3(1.0), base, m.metal);
    vec3 wT = w*trn*m.tcol;
    if (trn > 0.0 && m.fresnel > 0.5){ wR = w*refl*mix(vec3(1.0), base, m.metal); wT = w*trn*(1.0 - refl)*m.tcol; }
    vec3 rdir = reflect(d, nf);
    vec3 tdir = vec3(0.0);
    bool hasT = false;
    if (max(wT.r, max(wT.g, wT.b)) > uMinW){
      float eta = inside ? m.ior : 1.0/m.ior;
      tdir = refract(d, nf, eta);
      if (dot(tdir, tdir) < 1e-6){ wR += wT; wT = vec3(0.0); } else hasT = true;
    }
    bool hasR = max(wR.r, max(wR.g, wR.b)) > uMinW;
    if (dep >= uMaxDepth){
      if (hasR) acc += wR*skyEnv(rdir);
      if (hasT) acc += wT*skyEnv(tdir);
      continue;
    }
    float mr = max(wR.r, max(wR.g, wR.b)), mt = max(wT.r, max(wT.g, wT.b));
    for (int k = 0; k < 2; k++){
      bool first = k == 0;
      bool doR = first ? (mr < mt) : (mr >= mt);
      if (doR && hasR){
        if (sp < STK){ sO[sp] = p + nf*(2e-3 + h.t*4e-6); sD[sp] = rdir; sW[sp] = wR; sDep[sp] = dep + 1; sDist[sp] = dist0 + h.t; sp++; }
        else acc += wR*skyEnv(rdir);
      }
      if (!doR && hasT){
        if (sp < STK){ sO[sp] = p - nf*(2e-3 + h.t*4e-6); sD[sp] = tdir; sW[sp] = wT; sDep[sp] = dep + 1; sDist[sp] = dist0 + h.t; sp++; }
        else acc += wT*skyEnv(tdir);
      }
    }
  }
  return acc;
}

void main(){
  vec2 pix = (floor(gl_FragCoord.xy) + uJitter)*uBlock + uOffset;
  vec3 ro, rd;
  if (uMode == 1){
    if (uPickCustom == 1){ ro = uPickRo; rd = normalize(uPickRd); }
    else {
      vec2 ndc = uPickPix/uRes*2.0 - 1.0;
      ro = uCamPos; rd = normalize(uCamFwd + ndc.x*uTanHalf*uAspect*uCamRight + ndc.y*uTanHalf*uCamUp);
    }
    Hit h;
    if (traceScene(ro, rd, 1e7, uIgnore, h)) fragColor = vec4(float(h.obj - uObjStart) + 1.0, h.t, h.uv);
    else fragColor = vec4(0.0, -1.0, 0.0, 0.0);
    return;
  }
  vec2 ndc = pix/uRes*2.0 - 1.0;
  ro = uCamPos;
  rd = normalize(uCamFwd + ndc.x*uTanHalf*uAspect*uCamRight + ndc.y*uTanHalf*uCamUp);
  vec3 col = clamp(traceRay(ro, rd), 0.0, 1.0);
  if (uBlend < 1.0){
    vec3 prev = texelFetch(uPrev, ivec2(gl_FragCoord.xy), 0).rgb;
    col = mix(prev, col, uBlend);
  }
  fragColor = vec4(col, 1.0);
}
`;

export const BLIT = `#version 300 es
precision highp float;
precision highp sampler2D;
out vec4 fragColor;
uniform sampler2D uCur;
uniform sampler2D uOld;
uniform vec2 uCurScale, uOldScale;
uniform float uCurBlock, uOldBlock;
uniform int uCurNearest, uOldNearest, uUseOld;
uniform vec4 uView;
uniform vec2 uSrcSize;
uniform vec4 uDone;
uniform vec3 uBg;
vec3 sampleT(sampler2D t, int nearest, float block, vec2 scale, vec2 local, vec2 src){
  if (nearest == 1) return texelFetch(t, ivec2(floor(src/block)), 0).rgb;
  return texture(t, local*scale).rgb;
}
void main(){
  vec2 local = (gl_FragCoord.xy - uView.xy)/uView.zw;
  if (local.x < 0.0 || local.y < 0.0 || local.x > 1.0 || local.y > 1.0){ fragColor = vec4(uBg, 1.0); return; }
  vec2 src = min(local*uSrcSize, uSrcSize - 0.5);
  bool done = true;
  if (uUseOld == 1){
    vec2 q = floor(src/uCurBlock);
    float tile = uDone.z;
    float tx = floor(q.x/tile);
    float tyTop = floor((uDone.w - 1.0 - q.y)/tile);
    done = tyTop < uDone.y || (tyTop == uDone.y && tx < uDone.x);
  }
  vec3 col = done ? sampleT(uCur, uCurNearest, uCurBlock, uCurScale, local, src) : sampleT(uOld, uOldNearest, uOldBlock, uOldScale, local, src);
  fragColor = vec4(col, 1.0);
}
`;
