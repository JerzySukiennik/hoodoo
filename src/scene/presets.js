// Hoodoo presets: material library, sky looks and starter scenes in the classic late-90s landscape style.

export const PATTERNS = ['solid', 'checker', 'strata', 'alpine', 'marble', 'granite', 'fractal', 'wood', 'rock', 'sand', 'water', 'tiles', 'lava', 'mud', 'gradient', 'desert'];

const M = (o) => ({
  pattern: 'solid', scale: 1, turb: 0.5, colorA: '#9a9a9a', colorB: '#555555', colorC: '#dddddd',
  ambientColor: null, ambience: 0.35, specColor: '#ffffff', specularity: 0.15, highlight: 0.5, metallicity: 0,
  diffusion: 0.85, reflection: 0, transparency: 0, ior: 1.5, bump: 0, fresnel: false, transColor: '#ffffff', mapping: 'object',
  p1: 0.5, p2: 0.5, p3: 0.5, p4: 0.5, ...o,
});

export const MATERIALS = {
  chrome: M({ name: 'Chrome', colorA: '#b9c0c8', diffusion: 0.08, ambience: 0.05, specularity: 1, highlight: 0.12, metallicity: 0.35, reflection: 0.94 }),
  mirror: M({ name: 'Mirror', colorA: '#ffffff', diffusion: 0, ambience: 0, specularity: 0.8, highlight: 0.05, reflection: 1 }),
  gold: M({ name: 'Gold', colorA: '#f2a92e', diffusion: 0.65, ambience: 0.35, specColor: '#fff0c0', specularity: 1, highlight: 0.22, metallicity: 1, reflection: 0.42 }),
  copper: M({ name: 'Copper', colorA: '#e07a4c', diffusion: 0.4, ambience: 0.15, specColor: '#ffd8c0', specularity: 0.9, highlight: 0.25, metallicity: 1, reflection: 0.55 }),
  glass: M({ name: 'Glass', colorA: '#ffffff', diffusion: 0.03, ambience: 0, specularity: 1, highlight: 0.06, reflection: 0.15, transparency: 0.94, ior: 1.5, fresnel: true, transColor: '#eef7ff' }),
  crystal: M({ name: 'Crystal', colorA: '#d8f0ff', diffusion: 0.04, ambience: 0, specularity: 1, highlight: 0.04, reflection: 0.25, transparency: 0.88, ior: 2.1, fresnel: true, transColor: '#bfe6ff' }),
  bubble: M({ name: 'Bubble', colorA: '#ffffff', diffusion: 0, ambience: 0, specularity: 1, highlight: 0.05, reflection: 0.3, transparency: 0.96, ior: 1.03, fresnel: true, transColor: '#fffaf0' }),
  water: M({ name: 'Lake water', pattern: 'water', scale: 1, turb: 0.4, colorA: '#123e52', colorB: '#1e5a6e', diffusion: 0.3, ambience: 0.25, specularity: 0.7, highlight: 0.02, reflection: 0.62, transparency: 0.45, ior: 1.33, bump: 0.45, fresnel: true, transColor: '#8ec2bd', mapping: 'world' }),
  ocean: M({ name: 'Ocean', pattern: 'water', scale: 0.6, turb: 0.6, colorA: '#0a2e48', colorB: '#174a66', diffusion: 0.35, ambience: 0.2, specularity: 0.8, highlight: 0.03, reflection: 0.62, transparency: 0.18, ior: 1.33, bump: 0.8, fresnel: true, transColor: '#5a9ab0', mapping: 'world' }),
  checker: M({ name: 'Checker', pattern: 'checker', scale: 4, colorA: '#f2f2f2', colorB: '#151515', diffusion: 0.8, ambience: 0.3, specularity: 0.2, highlight: 0.3, reflection: 0.08 }),
  redrock: M({ name: 'Red rock', pattern: 'strata', scale: 1, turb: 0.55, colorA: '#9a3e22', colorB: '#c66434', colorC: '#e6a878', p1: 16, p2: 0.86, p3: 0.85, diffusion: 0.9, ambience: 0.35, specularity: 0.05, bump: 0.6 }),
  sandstone: M({ name: 'Sandstone', pattern: 'strata', scale: 1, turb: 0.45, colorA: '#b5764a', colorB: '#d9a676', colorC: '#f1d6ae', p1: 22, p2: 0.9, p3: 0.6, diffusion: 0.9, ambience: 0.35, specularity: 0.05, bump: 0.5 }),
  alpine: M({ name: 'Alpine', pattern: 'alpine', scale: 1, colorA: '#4e6b32', colorB: '#6d645c', colorC: '#f4f7fb', p1: 0.22, p2: 0.58, p3: 0.8, diffusion: 0.9, ambience: 0.35, specularity: 0.08, bump: 0.6 }),
  meadow: M({ name: 'Green hills', pattern: 'alpine', scale: 1, colorA: '#5d7f33', colorB: '#7a6c56', colorC: '#7f9a46', p1: 0.75, p2: 1.2, p3: 0.68, diffusion: 0.9, ambience: 0.35, specularity: 0.04, bump: 0.4 }),
  granite: M({ name: 'Granite', pattern: 'granite', scale: 2, colorA: '#8a8987', colorB: '#4e4d4f', colorC: '#d8d2c6', diffusion: 0.85, ambience: 0.3, specularity: 0.3, highlight: 0.3, bump: 0.3 }),
  marble: M({ name: 'Marble', pattern: 'marble', scale: 1.4, turb: 0.7, colorA: '#f1eee6', colorB: '#3f4148', colorC: '#cfc4b0', diffusion: 0.8, ambience: 0.3, specularity: 0.7, highlight: 0.2, reflection: 0.12 }),
  rock: M({ name: 'Grey rock', pattern: 'rock', scale: 1.3, colorA: '#3a3835', colorB: '#8a857c', colorC: '#a69a86', diffusion: 0.9, ambience: 0.3, specularity: 0.06, bump: 1.1 }),
  volcanic: M({ name: 'Volcanic', pattern: 'rock', scale: 1.6, colorA: '#141212', colorB: '#3b3633', colorC: '#5a4a40', diffusion: 0.9, ambience: 0.25, specularity: 0.2, highlight: 0.4, bump: 1.2 }),
  mars: M({ name: 'Mars', pattern: 'desert', scale: 1, turb: 0.35, colorA: '#7a2e18', colorB: '#bf5a2e', colorC: '#e39a64', p1: 0.6, diffusion: 0.9, ambience: 0.35, specularity: 0.04, bump: 0.8 }),
  moon: M({ name: 'Moon dust', pattern: 'desert', scale: 1.2, turb: 0.4, colorA: '#4a4a4c', colorB: '#8a8a88', colorC: '#bdbcb6', p1: 0.4, diffusion: 0.9, ambience: 0.25, specularity: 0.02, bump: 0.9 }),
  sand: M({ name: 'Desert sand', pattern: 'sand', scale: 1, turb: 0.5, colorA: '#d6af72', colorB: '#c08e56', p1: 2.2, diffusion: 0.9, ambience: 0.4, specularity: 0.05, bump: 0.8 }),
  mud: M({ name: 'Mud flats', pattern: 'mud', scale: 3, turb: 0.5, colorA: '#a88a64', colorB: '#4a3828', colorC: '#c8ae86', p1: 0.5, diffusion: 0.9, ambience: 0.35, specularity: 0.03 }),
  lava: M({ name: 'Lava', pattern: 'lava', scale: 2.2, turb: 0.6, colorA: '#1a1210', colorB: '#3a2a22', colorC: '#ff6418', p1: 0.5, diffusion: 0.85, ambience: 0.2, specularity: 0.2 }),
  alien: M({ name: 'Alien moss', pattern: 'fractal', scale: 1.3, turb: 0.8, colorA: '#2a1450', colorB: '#8a34c4', colorC: '#3fe0c0', diffusion: 0.85, ambience: 0.4, specularity: 0.3, highlight: 0.35, bump: 0.5 }),
  ice: M({ name: 'Ice', colorA: '#d4ecfa', diffusion: 0.3, ambience: 0.3, specularity: 1, highlight: 0.1, reflection: 0.25, transparency: 0.45, ior: 1.31, fresnel: true, transColor: '#a6d6f2', bump: 0.15 }),
  snow: M({ name: 'Snow', pattern: 'granite', scale: 3, colorA: '#f4f7fb', colorB: '#dfe6f0', colorC: '#ffffff', diffusion: 0.95, ambience: 0.45, specularity: 0.15, highlight: 0.6, bump: 0.25 }),
  plastic: M({ name: 'Blue plastic', colorA: '#2f6fe0', diffusion: 0.85, ambience: 0.35, specularity: 0.75, highlight: 0.35 }),
  ivory: M({ name: 'Ivory', colorA: '#f1ead6', diffusion: 0.85, ambience: 0.4, specularity: 0.45, highlight: 0.4 }),
  wood: M({ name: 'Wood', pattern: 'wood', scale: 2, turb: 0.4, colorA: '#a8693a', colorB: '#6a3a1c', diffusion: 0.85, ambience: 0.3, specularity: 0.25, highlight: 0.45 }),
  tiles: M({ name: 'Tiles', pattern: 'tiles', scale: 1, colorA: '#e8e4da', colorB: '#3a3a3a', p1: 0.08, diffusion: 0.8, ambience: 0.3, specularity: 0.4, highlight: 0.25, reflection: 0.1 }),
  glow: M({ name: 'Glow', colorA: '#ffd27a', ambientColor: '#ffd27a', diffusion: 0.4, ambience: 1, specularity: 0 }),
  clay: M({ name: 'Clay', colorA: '#c9b49a', diffusion: 0.9, ambience: 0.35, specularity: 0.05 }),
};

export const SKIES = {
  clear: { name: 'Clear day', mode: 'soft', sunAz: 160, sunEl: 48, haze: 0.18, clouds: 0.45, cover: 0.38, fog: 0 },
  golden: { name: 'Golden hour', mode: 'soft', sunAz: 230, sunEl: 9, haze: 0.42, hazeColor: '#f3d6b0', clouds: 0.55, cover: 0.42, fog: 0.08, fogHeight: 10, fogColor: '#f0d2b0' },
  sunset: { name: 'Sunset', mode: 'soft', sunAz: 250, sunEl: 2.5, haze: 0.5, hazeColor: '#f2b08a', clouds: 0.7, cover: 0.5, cloudAmp: 0.7, fog: 0.12, fogHeight: 8, fogColor: '#e8a888', glow: 0.9 },
  dusk: { name: 'Dusk', mode: 'soft', sunAz: 260, sunEl: -4, haze: 0.4, hazeColor: '#8a7aa0', clouds: 0.45, cover: 0.4, fog: 0.05, fogColor: '#7a6a90' },
  night: { name: 'Moonlit night', mode: 'soft', sunAz: 196, sunEl: -14, haze: 0.2, hazeColor: '#2a3450', clouds: 0.25, cover: 0.3, cloudColor: '#9aa8c8', stars: 1, moon: true, moonPhase: 0.15, ambient: 0.8 },
  alien: { name: 'Alien dawn', mode: 'custom', sunAz: 120, sunEl: 7, zenith: '#2a1060', horizon: '#ff8ab8', sunset: '#ffd060', sunColor: '#ffe0f0', haze: 0.45, hazeColor: '#ffa0c8', clouds: 0.5, cover: 0.45, cloudColor: '#ffd0f0', fog: 0.1, fogColor: '#c080c0', glow: 1, rainbow: 0 },
  foggy: { name: 'Foggy morning', mode: 'soft', sunAz: 110, sunEl: 12, haze: 0.55, hazeColor: '#e0e4e6', clouds: 0.3, cover: 0.6, fog: 0.4, fogHeight: 14, fogColor: '#e6e8ea' },
  mars: { name: 'Mars noon', mode: 'custom', sunAz: 200, sunEl: 40, zenith: '#7a4a32', horizon: '#e0a878', sunset: '#e0b090', sunColor: '#fff0e0', haze: 0.5, hazeColor: '#d8a07a', clouds: 0, fog: 0.05, fogColor: '#c08060' },
  storm: { name: 'Storm', mode: 'darker', sunAz: 300, sunEl: 20, haze: 0.45, hazeColor: '#9aa2a8', clouds: 1, cover: 0.8, cloudColor: '#c8ccd0', cloudAmp: 1, ambient: 0.75, sunPower: 0.6, fog: 0.15, fogColor: '#a8b0b6' },
  arctic: { name: 'Arctic', mode: 'soft', sunAz: 180, sunEl: 14, haze: 0.3, hazeColor: '#e8f2fa', clouds: 0.35, cover: 0.35, halo: 0.6, fog: 0.08, fogColor: '#e8f0f8' },
  rainbow: { name: 'After rain', mode: 'soft', sunAz: 290, sunEl: 16, haze: 0.28, clouds: 0.75, cover: 0.55, cloudAmp: 0.8, rainbow: 0.9, fog: 0.06 },
  void: { name: 'Studio', mode: 'custom', sunAz: 210, sunEl: 38, zenith: '#30343a', horizon: '#9aa0a8', sunset: '#9aa0a8', haze: 0.0, clouds: 0, fog: 0 },
};

const terrain = (name, pos, scale, recipe, mat, rot = 0, res = 512) => ({ type: 'terrain', name, pos, rot: [0, rot, 0], scale, res, recipe, mat });
const obj = (type, name, pos, scale, mat, rot = [0, 0, 0], extra = {}) => ({ type, name, pos, rot, scale, mat, ...extra });

export const SCENES = {
  dawn: {
    name: 'Chrome Dawn',
    sky: { ...SKIES.golden, sunAz: 196, sunEl: 7, clouds: 0.6, cover: 0.46, haze: 0.4 },
    camera: { pos: [0, 9, 62], yaw: 0, pitch: 0.5, fov: 48 },
    objects: [
      obj('plane', 'Water', [0, 0, 0], [1, 1, 1], 'water'),
      terrain('Far range', [-40, -2, -520], [420, 120, 140], { gen: 'alps', seed: 11, rough: 0.6, scale: 1.4, edges: 0.7, ops: [{ op: 'erode', amount: 0.5 }] }, 'alpine'),
      terrain('Left peaks', [-210, -3, -260], [140, 78, 140], { gen: 'mountains', seed: 4, rough: 0.55, scale: 1, edges: 0.8, ops: [{ op: 'erode', amount: 0.6 }] }, 'rock', 25),
      terrain('Right mesa', [190, -4, -230], [150, 64, 150], { gen: 'canyon', seed: 9, rough: 0.4, scale: 0.9, edges: 0.8, ops: [{ op: 'erode', amount: 0.3 }] }, 'redrock', -15),
      obj('sphere', 'Chrome sphere', [0, 14, -12], [9, 9, 9], 'chrome'),
      obj('stone', 'Rock', [-22, 0, 6], [7, 5, 6], 'granite', [0, 30, 0], { seed: 3, rough: 1 }),
    ],
  },
  checker: {
    name: 'Checker Infinity',
    sky: { ...SKIES.clear, sunAz: 140, sunEl: 32, haze: 0.38, hazeColor: '#e4ecf4', clouds: 0.5, cover: 0.42 },
    camera: { pos: [0, 7, 38], yaw: 0, pitch: -6, fov: 50 },
    objects: [
      obj('plane', 'Checker floor', [0, 0, 0], [1, 1, 1], 'checker'),
      obj('sphere', 'Chrome sphere', [0, 6, 0], [6, 6, 6], 'chrome'),
      obj('sphere', 'Glass sphere', [-13, 4, 8], [4, 4, 4], 'glass'),
      obj('pyramid', 'Gold pyramid', [14, 5, -4], [5, 5, 5], 'gold', [0, 20, 0]),
      obj('torus', 'Torus', [-12, 1.2, -12], [6, 6, 6], 'marble', [0, 0, 0], { minor: 0.22 }),
      obj('cylinder', 'Column', [22, 8, -30], [2.5, 8, 2.5], 'ivory'),
      obj('cone', 'Cone', [-26, 6, -34], [4, 6, 4], 'plastic'),
      obj('cube', 'Cube', [8, 2.5, 14], [2.5, 2.5, 2.5], 'mirror', [0, 35, 0]),
    ],
  },
  canyon: {
    name: 'Red Mesa',
    sky: { ...SKIES.golden, sunAz: 245, sunEl: 13, haze: 0.45, hazeColor: '#f2cfa8', clouds: 0.45, cover: 0.38 },
    camera: { pos: [-20, 44, 330], yaw: 4, pitch: -7, fov: 50 },
    objects: [
      obj('plane', 'Desert floor', [0, 0, 0], [1, 1, 1], 'sand'),
      terrain('Mesas', [0, -1, -60], [260, 70, 260], { gen: 'canyon', seed: 21, rough: 0.55, scale: 1.1, edges: 0.55, ops: [{ op: 'erode', amount: 0.45 }] }, 'redrock'),
      terrain('Hoodoos', [70, -1, 40], [90, 40, 90], { gen: 'spires', seed: 5, rough: 0.5, scale: 1, edges: 0.6 }, 'sandstone'),
      terrain('Far buttes', [-120, -2, -420], [380, 90, 160], { gen: 'canyon', seed: 33, rough: 0.6, scale: 1.6, edges: 0.7 }, 'sandstone'),
    ],
  },
  alien: {
    name: 'Alien Shore',
    sky: { ...SKIES.alien },
    camera: { pos: [10, 6, 70], yaw: -6, pitch: 1, fov: 50 },
    objects: [
      obj('plane', 'Pink sea', [0, 0, 0], [1, 1, 1], 'water'),
      terrain('Moss island', [-40, -3, -40], [90, 30, 90], { gen: 'island', seed: 8, rough: 0.6, scale: 1, edges: 0.3, ops: [{ op: 'erode', amount: 0.5 }] }, 'alien'),
      terrain('Spire range', [60, -4, -260], [300, 110, 120], { gen: 'mountains', seed: 17, rough: 0.7, scale: 1.6, edges: 0.7 }, 'volcanic'),
      obj('sphere', 'Glass orb', [18, 7, 10], [6, 6, 6], 'crystal'),
      obj('sphere', 'Moonlet', [-30, 46, -220], [16, 16, 16], 'moon'),
      obj('torus', 'Ring', [18, 7, 10], [11, 11, 11], 'chrome', [70, 20, 0], { minor: 0.06 }),
    ],
  },
  alps: {
    name: 'Alpine Lake',
    sky: { ...SKIES.clear, sunAz: 210, sunEl: 26, haze: 0.3, clouds: 0.55, cover: 0.45 },
    camera: { pos: [0, 8, 90], yaw: 0, pitch: 4, fov: 50 },
    objects: [
      obj('plane', 'Lake', [0, 0, 0], [1, 1, 1], 'water'),
      terrain('Massif', [0, -6, -260], [320, 150, 220], { gen: 'alps', seed: 2, rough: 0.7, scale: 1.2, edges: 0.75, ops: [{ op: 'erode', amount: 0.7 }] }, 'alpine'),
      terrain('Left shore', [-150, -4, -20], [120, 34, 160], { gen: 'hills', seed: 6, rough: 0.5, scale: 1, edges: 0.8 }, 'meadow'),
      terrain('Right shore', [160, -4, 10], [120, 40, 150], { gen: 'mountains', seed: 14, rough: 0.5, scale: 0.9, edges: 0.8, ops: [{ op: 'erode', amount: 0.5 }] }, 'meadow'),
    ],
  },
  night: {
    name: 'Moonrise',
    sky: { ...SKIES.night },
    camera: { pos: [0, 10, 80], yaw: 0, pitch: 6, fov: 50 },
    objects: [
      obj('plane', 'Sea', [0, 0, 0], [1, 1, 1], 'ocean'),
      terrain('Cliffs', [-90, -4, -150], [200, 90, 160], { gen: 'mountains', seed: 27, rough: 0.6, scale: 1, edges: 0.7, ops: [{ op: 'erode', amount: 0.6 }] }, 'rock'),
      terrain('Far ridge', [120, -6, -480], [460, 120, 160], { gen: 'ridges', seed: 3, rough: 0.6, scale: 1.4, edges: 0.7 }, 'rock'),
      obj('light', 'Lantern', [-20, 6, 20], [1, 1, 1], 'glow', [0, 0, 0], { color: '#ffb060', power: 3, range: 30, visible: true }),
    ],
  },
  mars: {
    name: 'Red Planet',
    sky: { ...SKIES.mars },
    camera: { pos: [10, 22, 290], yaw: -2, pitch: -4, fov: 50 },
    objects: [
      obj('plane', 'Regolith', [0, 0, 0], [1, 1, 1], 'mars'),
      terrain('Crater field', [0, -1, -40], [240, 40, 240], { gen: 'craters', seed: 12, rough: 0.6, scale: 1, edges: 0.6 }, 'mars'),
      terrain('Volcano', [-60, -2, -400], [300, 140, 300], { gen: 'volcano', seed: 4, rough: 0.6, scale: 1, edges: 0.4 }, 'mars'),
      obj('stone', 'Boulder', [24, 0, 230], [5, 3.6, 5], 'volcanic', [0, 10, 0], { seed: 11, rough: 1 }),
    ],
  },
};

export const SCENE_ORDER = ['dawn', 'checker', 'canyon', 'alps', 'alien', 'night', 'mars'];

export const NAMES_PL = {
  'Chrome Dawn': 'Chromowy świt', 'Checker Infinity': 'Szachownica po horyzont', 'Red Mesa': 'Czerwona mesa', 'Alien Shore': 'Obcy brzeg', 'Alpine Lake': 'Alpejskie jezioro', 'Moonrise': 'Wschód księżyca', 'Red Planet': 'Czerwona planeta',
  'Water': 'Woda', 'Far range': 'Dalekie pasmo', 'Left peaks': 'Lewe szczyty', 'Right mesa': 'Prawa mesa', 'Chrome sphere': 'Chromowa kula', 'Rock': 'Głaz',
  'Checker floor': 'Szachownica', 'Glass sphere': 'Szklana kula', 'Gold pyramid': 'Złota piramida', 'Torus': 'Torus', 'Column': 'Kolumna', 'Cone': 'Stożek', 'Cube': 'Lustrzany sześcian',
  'Desert floor': 'Pustynia', 'Mesas': 'Mesy', 'Hoodoos': 'Iglice', 'Far buttes': 'Dalekie ostańce', 'Pink sea': 'Różowe morze', 'Moss island': 'Wyspa mchu', 'Spire range': 'Pasmo iglic',
  'Glass orb': 'Szklana kula', 'Moonlet': 'Mały księżyc', 'Ring': 'Pierścień', 'Lake': 'Jezioro', 'Massif': 'Masyw', 'Left shore': 'Lewy brzeg', 'Right shore': 'Prawy brzeg',
  'Sea': 'Morze', 'Cliffs': 'Klify', 'Far ridge': 'Daleki grzbiet', 'Lantern': 'Latarnia', 'Regolith': 'Regolit', 'Crater field': 'Pole kraterów', 'Volcano': 'Wulkan', 'Boulder': 'Głaz',
};
