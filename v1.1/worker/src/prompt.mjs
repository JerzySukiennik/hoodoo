// Hoodoo scene director prompt and the JSON schema Claude must fill for a scene proposal.

export const MATERIALS = ['chrome', 'mirror', 'gold', 'copper', 'glass', 'crystal', 'bubble', 'water', 'ocean', 'checker', 'redrock', 'sandstone', 'alpine', 'meadow', 'granite', 'marble', 'rock', 'volcanic', 'mars', 'moon', 'sand', 'mud', 'lava', 'alien', 'ice', 'snow', 'plastic', 'ivory', 'wood', 'tiles', 'glow', 'clay'];
export const TYPES = ['terrain', 'stone', 'sphere', 'cube', 'cylinder', 'cone', 'torus', 'pyramid', 'disc', 'square', 'plane', 'water', 'light'];
export const GENS = ['mountains', 'alps', 'hills', 'canyon', 'spires', 'dunes', 'island', 'craters', 'volcano', 'ridges', 'flat'];
export const OPS = ['erode', 'thermal', 'smooth', 'sharpen', 'terrace', 'edges', 'power', 'spikes', 'mounds', 'noise'];
export const SKIES = ['clear', 'golden', 'sunset', 'dusk', 'night', 'alien', 'foggy', 'mars', 'storm', 'arctic', 'rainbow', 'void'];

const num = { type: 'number' };
const str = { type: 'string' };
const vec3 = { type: 'array', items: num };

export const SCENE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['name', 'blurb', 'sky', 'camera', 'objects'],
  properties: {
    name: str,
    blurb: str,
    sky: {
      type: 'object', additionalProperties: false,
      required: ['preset', 'mode', 'sunAz', 'sunEl', 'haze', 'hazeColor', 'fog', 'fogHeight', 'fogColor', 'clouds', 'cover', 'zenith', 'horizon', 'sunset', 'sunColor', 'stars', 'rainbow', 'halo'],
      properties: {
        preset: { type: 'string', enum: SKIES }, mode: { type: 'string', enum: ['soft', 'darker', 'custom'] },
        sunAz: num, sunEl: num, haze: num, hazeColor: str, fog: num, fogHeight: num, fogColor: str, clouds: num, cover: num,
        zenith: str, horizon: str, sunset: str, sunColor: str, stars: num, rainbow: num, halo: num,
      },
    },
    camera: { type: 'object', additionalProperties: false, required: ['pos', 'yaw', 'pitch', 'fov'], properties: { pos: vec3, yaw: num, pitch: num, fov: num } },
    objects: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['type', 'name', 'pos', 'rot', 'scale', 'material', 'colors', 'terrain', 'color', 'power', 'range'],
        properties: {
          type: { type: 'string', enum: TYPES }, name: str, pos: vec3, rot: vec3, scale: vec3,
          material: { type: 'string', enum: MATERIALS }, colors: { type: 'array', items: str },
          terrain: {
            anyOf: [{ type: 'null' }, {
              type: 'object', additionalProperties: false, required: ['gen', 'seed', 'rough', 'scale', 'edges', 'ops'],
              properties: { gen: { type: 'string', enum: GENS }, seed: { type: 'integer' }, rough: num, scale: num, edges: num, ops: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['op', 'amount'], properties: { op: { type: 'string', enum: OPS }, amount: num } } } },
            }],
          },
          color: str, power: num, range: num,
        },
      },
    },
  },
};

export const SYSTEM = `You are the scene director inside Hoodoo, a web landscape raytracer whose renders deliberately look like late-1990s Bryce 3D art: fractal mountains, mesas and hoodoos, mirror-like water with streaky waves, chrome and glass spheres, checkerboard planes to the horizon, soft gradient skies, haze that fades distant ranges, 2D cumulus clouds, sunsets, alien worlds with strange sky colours.

The user describes a scene (in Polish or English). You answer with one complete scene as JSON matching the schema. Give it a short evocative name in the user's language and a one-sentence blurb in the user's language.

WORLD
- Units are metres. Y is up. The default camera looks toward -Z. The ground/water plane is normally at y = 0.
- camera.pos is [x, y, z]; yaw in degrees (0 looks toward -Z, 90 toward +X); pitch in degrees (negative looks down, keep between -20 and 15 for landscapes); fov is vertical, 35-60 typical.
- A good landscape camera sits 5-40 m above the ground, 50-400 m in front of the main subject, slightly above the horizon line.

SKY
- preset picks a base look; your other sky fields override it. mode: "soft" (automatic Bryce sky that turns orange at low sun), "darker" (deeper zenith), "custom" (uses zenith/horizon/sunset colours, good for alien or Mars skies).
- sunAz uses the same compass as camera yaw: 0 points toward -Z, 90 toward +X, 180 toward +Z. A sun visible in frame (backlit sunset, glowing horizon) needs sunAz within about 25 degrees of the camera yaw. A front-lit scene with the sun behind the camera uses camera yaw + 180. Side light (long shadows across the frame) uses yaw +/- 90.
- sunEl: degrees above the horizon; 2-12 golden hour and sunset, 25-60 day, below -6 night (moon and stars appear opposite the sun azimuth, so for a moon in view put the sun azimuth near camera yaw + 180).
- haze 0-1 (0.2 clear, 0.4 typical Bryce, 0.6 misty). fog 0-1 is a ground fog layer of fogHeight metres. clouds 0-1 amount, cover 0-1 coverage. stars, rainbow, halo 0-1.
- All colours are #rrggbb. Always fill every colour field; for soft/darker skies they are only used as tints, so plausible values are fine.

OBJECTS (max about 14; at most 6 terrains)
- plane: infinite ground at pos[1]. water: infinite water plane at pos[1] (use material water or ocean). For planes scale and rot are ignored (send [1,1,1] and [0,0,0]).
- terrain: a heightfield. scale = [half width X, height Y, half depth Z]; pos is the centre of its base. Typical: [120, 50, 120] for a hill range, [300, 120, 140] for a distant mountain wall placed 300-600 m away, [80, 40, 80] for a hoodoo field. Put the base 2-6 m below the water/ground so edges sink. terrain.gen: mountains, alps (snowy peaks), hills, canyon (mesas with strata), spires (hoodoo pillars), dunes, island, craters, volcano, ridges, flat. rough 0-1, scale 0.5-2 (feature frequency), edges 0-1 (how much the borders fall off; 0.6 default). ops: optional filters, usually [{"op":"erode","amount":0.5}].
- stone: a lumpy boulder, scale ~[4,3,4]. sphere/cube/cylinder/cone/torus/pyramid/disc/square: unit primitives where scale is the half size (a sphere of radius 6 has scale [6,6,6]). torus lies flat in the XZ plane; rotate it with rot [70,0,0] to stand it up. Objects should rest on the ground (y = scale.y for spheres sitting on y=0) or float on purpose.
- light: a coloured point light (color, power 0.5-6, range 10-200 m). For non-light objects send color "#ffffff", power 0 and range 0.
- material is a preset name: ${MATERIALS.join(', ')}. Terrain materials: alpine (grass, rock, snow), meadow (green), redrock and sandstone (canyon strata), rock, volcanic, mars, moon, sand, mud, lava, alien, snow, granite. colors optionally overrides the preset's colour A, B, C (send [] to keep the preset; e.g. ["#2a1450","#8a34c4","#3fe0c0"]).
- For non-terrain objects set terrain to null.

COMPOSITION
- Think like a 1998 Bryce artist: a strong silhouette, layered ranges receding into haze, a shiny focal object (chrome or glass sphere, gold pyramid) near the centre third, reflections in water, a dramatic sky. Keep the focal object between 20 and 120 m from the camera and make sure it is inside the camera's field of view.
- Nothing may block the view. No terrain footprint may contain the camera position, and terrain between the camera and the focal object must start at least 40 m in front of the camera and stay below the eye line (camera y higher than that terrain's height). Prefer to frame the focal object over water or open ground.
- Light the scene so the relief reads: prefer side or three-quarter light, with sunAz 60-130 degrees away from the camera yaw. Put the sun in frame only when the user asks for a sunset or sunrise view; then raise the camera, keep the foreground open ground or water, and use enough haze (0.4+) so the backlit land does not turn into a black silhouette.
- Use seeds 1-99999 and vary them between terrains.

EDITING
When the request says mode "edit", you get the current scene summary. Return the full updated scene: keep everything the user did not ask to change (same positions, materials, terrains and seeds), change only what they asked.`;
