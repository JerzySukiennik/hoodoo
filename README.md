# Hoodoo

A landscape raytracer for the browser that renders scenes with the look of late-1990s Bryce 3D art (fractal mountains, mesas and hoodoos, mirror water, chrome and glass spheres, checkerboards to the horizon, hazy gradient skies), wrapped in a modern dark interface.

Nothing here is decompiled or copied from Bryce. The look is rebuilt from the techniques that produced it: heightfield terrains, a Whitted-style raytracer with hard shadows, procedural 3D textures, a parametric sky with haze and ground fog, 2D cumulus clouds and the classic coarse-to-fine render passes.

## Features

- **GPU raytracer** (WebGL2, one fragment shader): terrains traced exactly as bilinear patches through a max-height mip pyramid, analytic primitives (sphere, cube, cylinder, cone, pyramid, disc, square, infinite planes), sphere-traced torus and lumpy rocks, reflection and refraction trees up to 7 bounces, transparent shadows, point lights.
- **Bryce-style render**: Render shows the image refining in passes from 32-pixel blocks to full resolution, then anti-aliasing passes. Sizes up to 4K, PNG export.
- **Live preview** that only draws when something changes, with dynamic resolution while you move and a 4-sample refine when you stop.
- **Terrain editor**: 11 generators (mountains, alps, hills, canyon, spires, dunes, island, craters, volcano, ridges, flat), filters (hydraulic erosion, talus, smooth, sharpen, terraces, edges, valleys, spikes, mounds, noise, invert), brushes on the 2D map or directly in the viewport, 128-1024 resolution, image import and export.
- **Materials lab**: 16 procedural patterns (strata, alpine, marble, granite, rock, sand, water waves, lava, cracked mud, checker...), Bryce-like channels (diffusion, ambience, specularity, highlight size, metallicity, reflection, transparency, refraction, bump, Fresnel), 31 presets with raytraced preview spheres.
- **Sky & fog**: soft / darker / custom / off sky modes, sun dial, haze, ground fog, clouds, moon with phases and stars at night, rainbow, 22° halo, 12 sky presets.
- **Animation**: keyframes for camera, sun and objects, auto-key, MP4 export through WebCodecs.
- **Describe a scene**: type a description in Polish or English and Claude builds a full scene as a proposal you can apply, refine or discard.
- Undo/redo, autosave in IndexedDB, `.hoodoo` scene files, 7 starter scenes.

## Controls

| Action | Input |
| --- | --- |
| Orbit | drag, or two-finger scroll on a trackpad |
| Pan | Shift + drag, right drag |
| Zoom | mouse wheel, pinch |
| Select | click (double-click in the list to focus) |
| Move / rotate / scale gizmo | W / E / R |
| Focus, land on ground, hide | F / L / H |
| Duplicate, delete | ⌘D / ⌫ |
| Undo, redo | ⌘Z / ⇧⌘Z |
| Render | ⌘↵ |
| Describe a scene | ⌘K |
| Keyframe, play | K / Space |

## Running locally

No build step: ES modules straight from the folder.

```bash
python3 Niepotrzebne/devserver.py 8977
```

Open http://localhost:8977. Add `?scene=dawn|checker|canyon|alps|alien|night|mars` to start from a preset instead of the autosave.

### AI worker

`worker/` is a Cloudflare Worker that holds the Anthropic key and calls Claude Opus 5.5 with a JSON schema for scenes. Daily spend and per-IP calls are capped in D1.

```bash
cd worker && npm install
npx wrangler dev --port 8978 --local --persist-to ../Niepotrzebne/.wrangler-state
```

Deploy: `npx wrangler d1 create hoodoo-usage`, put the id in `wrangler.toml`, `npx wrangler secret put ANTHROPIC_API_KEYS`, `npx wrangler deploy`. The app calls `https://hoodoo-api.kalakasanyt.workers.dev` outside localhost (`src/ai/client.js`).

## Layout

- `src/engine/` shader, renderer (preview, passes, picking), terrain generators and filters, sky model, math
- `src/scene/` scene model, packing for the GPU, save format, presets
- `src/ui/` panels, labs, timeline, render bar, AI flow
- `src/anim/` keyframes and MP4 encoding
- `worker/` Claude scene director
- `Niepotrzebne/tests/` headless Chrome harnesses (engine, app, interaction)

## Credits

- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT), loaded from jsDelivr for MP4 export.
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) in the Worker.
- Bryce is a trademark of its owners; Hoodoo is an independent homage to its rendering style.
