# HyperCity 3D — agent notes

A browser 3D city game built on three.js, using real downloaded assets rather
than procedural stand-ins. It is also an RL environment: every AI agent can be
driven from an external Python/Node trainer.

## Commands

```bash
npm run dev              # vite dev server on :12000 (host 0.0.0.0)
npm run build            # production bundle into dist/
node tools/training-server.mjs --port 12001   # trainer <-> browser relay
node tools/hold.mjs 300  # headless browser, keeps a game attached to the relay
node tools/verify.mjs    # end-to-end gameplay checks (needs the dev server)
python3 tools/rl_smoke.py  # exercises the gym-style API over the relay
```

`tools/verify.mjs`, `tools/api_check.mjs` and `tools/shots.mjs` all take a `URL`
env var (or a first argument), so they can be pointed at any deployment.

## Deployment

The game is published to GitHub Pages at
`https://onelpawarai-x.github.io/hypercity-3d/` from `.github/workflows/pages.yml`,
which builds `dist/` on every push to `main`. Nothing runs on a server, so the
link is permanent.

This is why `vite.config.js` sets `base: './'` and `src/config.js` routes every
public path through `asset()`: a Pages build is served from `/<repo>/`, not the
domain root. Absolute `/assets/...` paths work locally and 404 there. Test a
sub-path build before assuming a deployment is fine:

```bash
npx vite build && mkdir -p /tmp/sub/game && cp -r dist/* /tmp/sub/game/
(cd /tmp/sub && python3 -m http.server 12050) &
URL=http://localhost:12050/game/ node tools/verify.mjs
```

The training relay is a local process and has no equivalent on a static host.
On Pages, use `window.HyperCity` in the page (`tools/api_check.mjs`); over a
tunnel or the dev server, `/relay` is proxied and the WebSocket transport works
(`tools/rl_smoke.py`).

## Layout

```
src/main.js                 Game shell: modes, input wiring, per-frame update
src/config.js               All tunables (render budget, vehicles, agents)
src/world/World.js          Loads the city, collision grid, road graph, vegetation
src/world/ChunkedCity.js    Spatial + material chunking of the big city GLBs
src/world/Interior.js       Enterable room interiors with real furniture
src/player/PlayerController.js  On-foot movement, collision, health
src/vehicles/Vehicle.js     Car / truck / helicopter / plane / jet / drone physics
src/agents/AgentManager.js  Crowd, factions, rigs, gym-style observation/reward
src/systems/Combat.js       Damage, kills, gang director, progressive difficulty
src/systems/Police.js       Response to reported crime
src/systems/TrainingBridge.js  window.HyperCity + postMessage + WebSocket API
src/systems/HUD.js          DOM HUD, prompts, toasts
tools/                      Dev scripts (see above); not part of the bundle
public/assets/              Downloaded GLB assets (see "Assets")
public/data/city.json       Building/road/green layout derived from OSM
```

## Assets

Everything visible is a real downloaded model. Nothing in the city, the
vehicles, the aircraft, the characters or the furniture is generated at
runtime as a substitute for art.

- City: OSM/Geofabrik extract for Shenzhen/Guangdong (ODbL-1.0), converted to
  `public/data/city.json` plus chunked GLB meshes.
- Vehicles/aircraft: glTF sample and Sketchfab CC models in `public/assets/`.
- Characters: Mixamo-derived rigs (`knight`, `mage`, `rogue`, `barbarian`,
  `skeleton`, `skeletonMage`, `xbot`, `robot`), each with real animations.
- Interior furniture: Poly Haven CC0 props, 26 of them.

When adding an asset, record its licence next to the file; the project treats
"which licence is this" as part of the asset, not an afterthought.

## Render budget

The city is ~9M triangles across ~16k buildings, so it is chunked by space and
material and distance-culled (`ChunkedCity`, `World.updateChunks`). Two rules
that are easy to break:

- Vegetation is instanced *per spatial tile*, not one mesh for the whole map.
  A single InstancedMesh spanning 13 km can never be frustum-culled, which
  silently forces every tree into every frame.
- Anything added to `World.scatter` is distance-culled in `updateChunks`; add
  new instanced batches there rather than directly to `world.group`.

Check the cost with `game.renderer.info.render` (calls/triangles) rather than
guessing — the HUD reports fps, and `tools/verify.mjs` prints both at the end.

## Training API

`TrainingBridge` exposes one JSON protocol over three transports: the in-page
`window.HyperCity`, `postMessage`, and a WebSocket through the relay. Commands:
`ping stats envs make reset step observe close spawn despawn goal act snapshot
spawnVehicle clearVehicles setTime teleport freeze control`.

Replies echo the request `id`. Do not return a field named `id` from a command
handler — `handle()` spreads the result after the echoed id, so a handler that
returns its own `id` overwrites the correlation id and the trainer can never
match the reply. The `make` command therefore returns `{ env, agentId }`.

## Testing notes

- Headless chromium needs `--use-gl=swiftshader --enable-unsafe-swiftshader`
  and `headless: 'shell'` with `protocolTimeout: 900000`; without the long
  timeout, asset loading trips a protocol error.
- Wait for `#start:not(.hidden)` before interacting — that selector only
  appears once every asset has loaded.
- Under software rendering the game runs at ~20 fps regardless of scene
  complexity, so never assert on frame rate. Poll for the state you want
  instead of sleeping a fixed time (see `driveUntil` in `tools/verify.mjs`).
- To prove a `CharacterSelect` preview actually drew something, render and
  `readPixels` in the same task. Reading back after the animation loop has
  presented the frame returns all zeros, because the buffer is already gone.
- `tools/*.mjs` one-off probes are throwaway; delete them when the bug they
  chased is fixed. Durable checks belong in `tools/verify.mjs` or
  `tools/api_check.mjs`.

## Publishing

The `GITHUB_TOKEN` available here has read-only access to
`onelpawarai-X/hypercity-3d` (`permissions.push` is false), so an agent cannot
push to `main` and trigger the Pages deploy. Work lands on the local `master`
branch; the user pushes it, or grants a token with `contents: write`.

