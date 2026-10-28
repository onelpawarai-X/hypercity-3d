# HyperCity 3D

A real-asset 3D city you can play, drive, fly and fight in — and an RL
environment you can train large agents inside. Every model is downloaded from
a credited source; nothing in the world is a procedural stand-in. See
[CREDITS.md](CREDITS.md) for the full asset list and licences.

## Play it now

**https://onelpawarai-x.github.io/hypercity-3d/**

Served as a static build from GitHub Pages, so the link is permanent and does
not depend on any machine staying up. First load streams ~199 MB of real
assets, so give it a minute on a slow connection.

## What is in it

- A 13 km × 5 km city derived from real OpenStreetMap data (Shenzhen): 16,076
  buildings, 36,172 road segments, ~9M triangles, chunked and distance-culled.
- Real cars and aircraft: car, truck, helicopter, plane, jet, drone — each with
  its own physics (road grip and steering; rotor collective, pitch and roll).
- Animated characters with eight rigs (knight, mage, rogue, barbarian,
  skeleton, skeleton mage, robot, X-Bot), driven by the crowd and combat AI.
- Enterable buildings: press E at a door to walk inside a furnished room with
  its own walls, floor, lighting and collision, then walk back out.
- Gangs, police response and a progressive difficulty curve that scales with
  how deep into the city you go.
- A training API so a Python or Node agent can act in the same world.

## Run it

```bash
npm install
npm run dev        # http://localhost:12000
```

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | move / drive / steer |
| `Shift` | sprint |
| `Space` | jump; brake; helicopter collective up |
| `S` / `Ctrl` | descend in a helicopter |
| mouse | look; aim |
| left click | attack |
| `E` | enter or leave a vehicle, enter or leave a building |
| `1`–`6` | spawn car, truck, plane, helicopter, jet, drone |
| `V` | switch first / third person |
| `T` | advance the time of day |

## Train agents in it

The game exposes a gym-style JSON protocol over three transports: the in-page
`window.HyperCity`, `postMessage`, and a WebSocket through a small relay.

```bash
node tools/training-server.mjs --port 12001   # start the relay
node tools/hold.mjs 600                       # keep a browser attached to it
python3 tools/rl_smoke.py                     # run a 300-step rollout
```

Commands: `ping stats envs make reset step observe close spawn despawn goal act
snapshot spawnVehicle clearVehicles setTime teleport freeze control`.

`make` returns `{ env, agentId }`; pass that `env` value to `reset`, `step` and
`observe`. Observations are 9 floats — `[x, z, heading, speed, goalDX, goalDZ,
distanceToGoal, stuck, nearestAgentDistance]` — and actions are 4 floats.

## Verify

```bash
node tools/verify.mjs       # end-to-end: load, drive, fly, interiors, combat, respawn
URL=<url> node tools/verify.mjs   # the same checks against any deployment
node tools/api_check.mjs    # the training API in-page, no relay needed
```

## Project layout

See [AGENTS.md](AGENTS.md) for a file-by-file map, the render-budget rules and
the testing notes.
