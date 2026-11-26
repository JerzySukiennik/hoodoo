// Hoodoo sky model: turns Sky Lab settings (sun position, soft/darker/custom sky, haze, fog, clouds) into shader uniforms.

import { hex2rgb, mixc, smooth, clamp, DEG } from './math.js';

const STOPS = [
  { e: -18, zen: '#020309', hor: '#070b18', set: '#070b18', amt: 0, sun: '#000000', si: 0 },
  { e: -8, zen: '#0a1230', hor: '#2c2a52', set: '#5a3050', amt: 0.35, sun: '#000000', si: 0 },
  { e: -2, zen: '#22346e', hor: '#c27258', set: '#ff5c2c', amt: 0.85, sun: '#ff5a24', si: 0.25 },
  { e: 3, zen: '#2b4890', hor: '#f0a56c', set: '#ff7a34', amt: 0.85, sun: '#ff8c40', si: 0.65 },
  { e: 10, zen: '#2852a8', hor: '#ecc79e', set: '#ffa452', amt: 0.5, sun: '#ffc27a', si: 0.9 },
  { e: 22, zen: '#2557ba', hor: '#c9d9e8', set: '#ffe0b0', amt: 0.15, sun: '#ffe6c4', si: 1.0 },
  { e: 45, zen: '#1f50c4', hor: '#aecbea', set: '#ffffff', amt: 0.0, sun: '#fff4e4', si: 1.05 },
  { e: 90, zen: '#1a48c0', hor: '#a2c2e8', set: '#ffffff', amt: 0.0, sun: '#fff8ee', si: 1.1 },
];

function stopAt(e) {
  if (e <= STOPS[0].e) return STOPS[0];
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i], b = STOPS[i + 1];
    if (e <= b.e) {
      const t = smooth(0, 1, (e - a.e) / (b.e - a.e));
      return {
        zen: mixc(hex2rgb(a.zen), hex2rgb(b.zen), t), hor: mixc(hex2rgb(a.hor), hex2rgb(b.hor), t), set: mixc(hex2rgb(a.set), hex2rgb(b.set), t),
        amt: a.amt + (b.amt - a.amt) * t, sun: mixc(hex2rgb(a.sun), hex2rgb(b.sun), t), si: a.si + (b.si - a.si) * t,
      };
    }
  }
  const l = STOPS[STOPS.length - 1];
  return { zen: hex2rgb(l.zen), hor: hex2rgb(l.hor), set: hex2rgb(l.set), amt: l.amt, sun: hex2rgb(l.sun), si: l.si };
}

const norm = (s) => (Array.isArray(s.zen) ? s : { ...s, zen: hex2rgb(s.zen), hor: hex2rgb(s.hor), set: hex2rgb(s.set), sun: hex2rgb(s.sun) });

export function dirFromAngles(az, el) {
  const a = az * DEG, e = el * DEG;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}

export const SKY_DEFAULT = {
  mode: 'soft', sunAz: 200, sunEl: 18, sunColor: '#ffffff', sunPower: 1, glow: 0.6, sunSize: 1.1,
  skyTint: '#ffffff', zenith: '#2357c0', horizon: '#c0d6ec', sunset: '#ff8a40', curve: 3.2,
  haze: 0.25, hazeColor: '#dfe6ee', fog: 0, fogHeight: 12, fogColor: '#d8dde4',
  clouds: 0.5, cover: 0.45, cloudColor: '#ffffff', cloudHeight: 900, cloudFreq: 1, cloudAmp: 0.5, cloudOff: [0, 0], cloudSoft: 0.35,
  shadows: 0.85, ambient: 0.72, ambientColor: '#ffffff', stars: 1, moon: true, moonPhase: 0.5, rainbow: 0, halo: 0,
};

export function skyUniforms(sky0) {
  const sky = { ...SKY_DEFAULT, ...sky0 };
  const el = sky.sunEl;
  const st = norm(stopAt(el));
  const tint = hex2rgb(sky.skyTint);
  let zen = st.zen.map((v, i) => v * tint[i]);
  let hor = st.hor.map((v, i) => clamp(v * (0.75 + 0.25 * tint[i]), 0, 1));
  let set = st.set;
  let setAmt = st.amt;
  if (sky.mode === 'darker') { zen = zen.map((v) => v * 0.55); hor = mixc(hor, zen, 0.25); }
  if (sky.mode === 'custom') {
    const night = smooth(-10, 2, el);
    zen = hex2rgb(sky.zenith).map((v) => v * (0.12 + 0.88 * night));
    hor = hex2rgb(sky.horizon).map((v) => v * (0.15 + 0.85 * night));
    set = hex2rgb(sky.sunset);
  }
  const sunDisc = dirFromAngles(sky.sunAz, el);
  const day = smooth(-4, 1.5, el);
  const userSun = hex2rgb(sky.sunColor);
  const sunCol = st.sun.map((v, i) => v * st.si * userSun[i] * sky.sunPower);
  const moonDir = dirFromAngles(sky.sunAz + 180, Math.max(8, -el * 0.9 + 6));
  const night = 1 - smooth(-6, -1, el);
  const moonOn = sky.moon ? night : 0;
  const moonCol = [0.42, 0.5, 0.72].map((v) => v * 0.55 * moonOn * sky.sunPower);
  const lightDir = day > 0.02 || moonOn < 0.01 ? sunDisc : moonDir;
  const lightCol = day > 0.02 || moonOn < 0.01 ? sunCol : moonCol;
  const amb = hex2rgb(sky.ambientColor);
  const skyAvg = mixc(zen, hor, 0.62);
  const ambientRaw = mixc(skyAvg, [1, 1, 1], 0.35).map((v, i) => v * amb[i] * sky.ambient * (0.18 + 0.82 * Math.max(day, 0.25 * moonOn)));
  const hazeUser = hex2rgb(sky.hazeColor);
  const hazeCol = mixc(hor, hazeUser, 0.55).map((v) => v * (0.25 + 0.75 * Math.max(day, 0.3)));
  const fogUser = hex2rgb(sky.fogColor);
  const fogCol = fogUser.map((v) => v * (0.2 + 0.8 * Math.max(day, 0.15)));
  const cloudCol = hex2rgb(sky.cloudColor);
  const off = sky.mode === 'off';
  return {
    uSunDir: lightDir, uSunCol: off ? sunCol : lightCol,
    uDiscDir: sunDisc, uDiscCol: sunCol.map((v) => v * 0.9 + 0.1 * day), uDiscSize: sky.sunSize * 0.55 * DEG, uGlow: sky.glow, uDiscVis: day,
    uMoonDir: moonDir, uMoonVis: moonOn, uMoonPhase: sky.moonPhase,
    uZenith: off ? [0, 0, 0] : zen, uHorizon: hor, uSunset: set, uSunsetAmt: setAmt * (sky.mode === 'custom' ? 0.6 : 1), uSkyCurve: sky.curve,
    uAmbient: ambientRaw, uShadow: sky.shadows,
    uHazeCol: hazeCol, uHazeAmt: sky.haze, uHazeDen: 1 / Math.max(60, 22000 * Math.exp(-7 * clamp(sky.haze, 0, 1))),
    uFogCol: fogCol, uFogDen: sky.fog > 0 ? Math.pow(sky.fog, 2) * 0.06 : 0, uFogH: Math.max(0.5, sky.fogHeight),
    uCloudCol: cloudCol, uCloudCover: clamp(sky.cover, 0, 1), uCloudAmt: sky.clouds, uCloudH: sky.cloudHeight, uCloudFreq: sky.cloudFreq, uCloudAmp: sky.cloudAmp, uCloudSoft: sky.cloudSoft,
    uCloudOff: sky.cloudOff, uStars: sky.stars * night, uRainbow: sky.rainbow, uHalo: sky.halo, uSkyOff: off ? 1 : 0,
  };
}

export function skyPreviewColors(sky) {
  const u = skyUniforms(sky);
  return { zen: u.uZenith, hor: u.uHorizon, sun: u.uDiscCol };
}
