# Asset credits

Every model, texture and sky in HyperCity 3D is downloaded from an external
source and used under the licence listed below. Nothing is a hand-built
stand-in. The download scripts in `scripts/` reproduce each file.

## City

| Asset | Source | Licence |
| --- | --- | --- |
| `assets/city/buildings.glb`, `facades.glb`, `roads.glb`, `terrain.glb`, `coastal-bridges.glb`, `coastal-shoreline.glb`, `data/city.json` | [linranff/GTA_SZ](https://github.com/linranff/GTA_SZ), built from an OpenStreetMap/Geofabrik extract of Shenzhen, Guangdong | ODbL-1.0 (OpenStreetMap contributors) |

Building heights come from OSM `height` / `building:levels` tags where present.
The game world is a 0.6-scaled adaptation of the real footprint; it is not a
survey-accurate copy of any address.

## Vehicles and aircraft

| Asset | Source | Licence |
| --- | --- | --- |
| `assets/vehicles/car.glb`, `traffic-car.glb` | Khronos CarConcept (DGG / Eric Chadwick), via GTA_SZ | CC BY 4.0 |
| `assets/air/helicopter.glb`, `airplane.glb`, `jet.glb`, `drone.glb` | [ir-engine-assets-basic](https://github.com/ir-engine/ir-engine-assets-basic) | Apache-2.0 |
| `assets/air/floatplane.glb` | GTA_SZ | CC BY 4.0 |

The aircraft are converted from the legacy `KHR_materials_pbrSpecularGlossiness`
encoding to metal/rough and meshopt-compressed by `scripts/convert-aircraft.sh`;
geometry, UVs, rigs and animations are the originals.

## Characters

| Asset | Source | Licence |
| --- | --- | --- |
| `assets/characters/knight.glb`, `mage.glb`, `rogue.glb`, `barbarian.glb`, `skeleton-warrior.glb`, `skeleton-mage.glb` | [KayKit Character Packs](https://github.com/KayKit-Game-Assets) | CC0 1.0 |
| `assets/characters/xbot.glb`, `assets/misc/littlest-tokyo.glb` | [three.js examples](https://github.com/mrdoob/three.js) | MIT / CC as noted in that repository |
| `assets/characters/robot.glb` | three.js `RobotExpressive` | CC0 1.0 |
| `assets/characters/pedestrian.glb` | GTA_SZ | ODbL-1.0 |

Each character carries its own skeletal animations (idle, walk, run, attack,
death); the game plays them rather than deforming meshes by hand.

## Nature

| Asset | Source | Licence |
| --- | --- | --- |
| `assets/nature/tree.glb`, `palm.glb` | [Poly Haven](https://polyhaven.com/) (Island Tree 03, Palm tree v2) | CC0 1.0 |
| `assets/nature/horse.glb`, `flamingo.glb`, `parrot.glb`, `stork.glb` | three.js examples | CC0 1.0 |

## Interior furniture

| Asset | Source | Licence |
| --- | --- | --- |
| `assets/interior/*.glb` (26 props: beds, seating, tables, storage, decor) | [Poly Haven](https://polyhaven.com/) models, baked to self-contained GLBs by `scripts/fetch-furniture.mjs` | CC0 1.0 |

## Environment

| Asset | Source | Licence |
| --- | --- | --- |
| `assets/env/belfast_sunset_puresky.hdr`, `kloofendal_48d_partly_cloudy_puresky.hdr`, `moonless_golf.hdr` | [Poly Haven](https://polyhaven.com/) HDRIs | CC0 1.0 |
| `assets/misc/park-floodlight.glb`, `life-hub.glb` | GTA_SZ | ODbL-1.0 |

## Audio

Sound effects and the ambient music are synthesised in-page with the Web Audio
API (`src/systems/Audio.js`). No external recordings or songs are used.

## Reproducing

```bash
bash scripts/fetch-assets.sh        # city, vehicles, aircraft, characters, nature
node scripts/fetch-characters.mjs   # KayKit character packs
node scripts/fetch-furniture.mjs    # Poly Haven interior props
bash scripts/convert-aircraft.sh    # normalise the aircraft encoding
```
