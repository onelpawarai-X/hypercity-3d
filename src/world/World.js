import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { loadGLTF, SpatialGrid, rand, pick, clamp } from '../utils.js';
import { ChunkedCity } from './ChunkedCity.js';

/**
 * The playable world.
 *
 * Geometry comes from two independent sources that share one coordinate
 * system (local east/north metres, origin in Shenzhen):
 *   1. city.json  - OpenStreetMap derived vector data (ODbL-1.0): building
 *      footprints with heights, road centrelines, green areas, water.
 *   2. *.glb      - pre-built meshes of the same city (buildings, facades,
 *      roads, terrain, coast).
 *
 * city.json supplies the semantics (collision volumes, road graph, tree
 * scatter) while the GLBs supply the visuals.
 */
export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'world';
    scene.add(this.group);

    this.layout = null;
    this.meshes = {};
    this.roadSegments = [];
    this.roadGrid = new SpatialGrid(96);
    this.buildingGrid = new SpatialGrid(96);
    this.buildings = [];
    this.trees = 0;
    this.bounds = null;
    this.chunked = [];
    this.scatter = [];
  }

  async load(onProgress) {
    const steps = [
      ['city layout (OpenStreetMap)', () => this._loadLayout()],
      ['city buildings', () => this._loadChunked(CONFIG.world.assets.buildings, 'buildings', { castShadow: true })],
      ['facades', () => this._loadChunked(CONFIG.world.assets.facades, 'facades', { castShadow: false })],
      ['roads', () => this._loadChunked(CONFIG.world.assets.roads, 'roads', { castShadow: false })],
      ['terrain', () => this._loadChunked(CONFIG.world.assets.terrain, 'terrain', { castShadow: false })],
      ['coast', () => this._loadCoast()],
      ['collision + road graph', () => this._buildCollision()],
      ['vegetation', () => this._scatterVegetation()],
    ];
    for (let i = 0; i < steps.length; i++) {
      onProgress?.(i / steps.length, steps[i][0]);
      await steps[i][1]();
    }
    onProgress?.(1, 'প্রস্তুত');
    return this;
  }

  async _loadLayout() {
    const res = await fetch(CONFIG.world.layoutUrl);
    if (!res.ok) throw new Error(`city.json: HTTP ${res.status}`);
    this.layout = await res.json();
    const [minX, minZ, maxX, maxZ] = this.layout.meta.extent;
    this.bounds = { minX, minZ, maxX, maxZ };
  }

  /**
   * Load a large city GLB as spatially chunked, distance-culled meshes. This
   * is what keeps a five-million-triangle city renderable in a browser: the
   * source files hold hundreds of separate meshes, which are merged per
   * spatial bucket and per material, then hidden when far from the camera.
   */
  async _loadChunked(url, name, { castShadow }) {
    const cfg = CONFIG.render;
    const chunked = new ChunkedCity(this.group, {
      chunkSize: cfg.chunkSize,
      drawDistance: cfg.drawDistance,
      shadowDistance: cfg.shadowDistance,
    });
    await chunked.load(url, { castShadow, receiveShadow: true, source: name });
    this.chunked.push(chunked);
    this.meshes[name] = chunked;
    return chunked;
  }

  /** Small coastal models are cheap enough to load whole, without chunking. */
  async _loadCoast() {
    await this._loadSmall(CONFIG.world.assets.bridges, 'bridges');
    await this._loadSmall(CONFIG.world.assets.shoreline, 'shoreline');
  }

  async _loadSmall(url, name) {
    const gltf = await loadGLTF(url);
    const root = gltf.scene;
    root.name = name;
    root.traverse((o) => {
      if (o.isMesh) { o.receiveShadow = true; o.castShadow = false; }
    });
    this.group.add(root);
    this.meshes[name] = root;
    return root;
  }

  /** Cull distant city chunks and vegetation tiles against the camera. */
  updateChunks(cameraPosition) {
    for (const c of this.chunked) c.update(cameraPosition);
    // Vegetation is far cheaper to draw than the city, so it survives a
    // little further out; beyond that the tiles are hidden outright.
    const max2 = (CONFIG.render.drawDistance * 1.2) ** 2;
    for (const s of this.scatter) {
      const dx = s.center.x - cameraPosition.x;
      const dz = s.center.z - cameraPosition.z;
      const visible = dx * dx + dz * dz - s.radius * s.radius < max2;
      if (s.mesh.visible !== visible) s.mesh.visible = visible;
    }
  }

  /** Combined chunk statistics, for the stats API and the HUD. */
  get chunkStats() {
    let source = 0, chunkMeshes = 0, triangles = 0, mergeFailures = 0;
    for (const c of this.chunked) {
      source += c.stats.sourceMeshes;
      chunkMeshes += c.stats.chunkMeshes;
      triangles += c.stats.triangles;
      mergeFailures += c.stats.mergeFailures;
    }
    return { sourceMeshes: source, chunkMeshes, triangles, mergeFailures };
  }

  /**
   * Builds the collision structures and the road graph from city.json.
   * Buildings become convex-ish footprints in a spatial hash; roads become
   * a segment index used for spawning and for keeping traffic on tarmac.
   */
  _buildCollision() {
    const { buildings, roads } = this.layout;

    for (const b of buildings) {
      const ring = b.rings[0];
      if (!ring || ring.length < 3) continue;
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const [x, z] of ring) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      const rec = { ring, minX, minZ, maxX, maxZ, height: b.height || 10, id: b.id };
      this.buildings.push(rec);
      const cx = (minX + maxX) * 0.5, cz = (minZ + maxZ) * 0.5;
      this.buildingGrid.insert(cx, cz, rec);
    }

    for (const r of roads) {
      const pts = r.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b2 = pts[i + 1];
        const seg = {
          ax: a[0], az: a[1], bx: b2[0], bz: b2[1],
          width: r.width || 7,
          kind: r.kind,
          name: r.name || '',
        };
        seg.mx = (seg.ax + seg.bx) * 0.5;
        seg.mz = (seg.az + seg.bz) * 0.5;
        this.roadSegments.push(seg);
        this.roadGrid.insert(seg.mx, seg.mz, seg);
      }
    }
  }

  /** Scatter real tree/palm models across the mapped green areas. */
  async _scatterVegetation() {
    const green = this.layout.green || [];
    if (!green.length) return;

    const [treeGLTF, palmGLTF] = await Promise.all([
      loadGLTF(CONFIG.world.assets.trees).catch(() => null),
      loadGLTF(CONFIG.world.assets.palms).catch(() => null),
    ]);

    const treeParts = this._extractParts(treeGLTF);
    const palmParts = this._extractParts(palmGLTF);
    if (!treeParts.length && !palmParts.length) return;

    const total = 1800;
    const placements = { tree: [], palm: [] };
    let attempts = 0;
    while (placements.tree.length + placements.palm.length < total && attempts < total * 14) {
      attempts++;
      const poly = pick(green);
      const ring = poly.rings?.[0];
      if (!ring || ring.length < 3) continue;
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const [x, z] of ring) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      const x = rand(minX, maxX), z = rand(minZ, maxZ);
      if (!pointInPolygon(x, z, ring)) continue;
      // Keep clear of buildings so trees do not grow through walls.
      if (this.buildingAt(x, z, 3)) continue;
      const isPalm = Math.random() < 0.22;
      placements[isPalm ? 'palm' : 'tree'].push([x, z]);
    }

    this.trees = placements.tree.length + placements.palm.length;
    if (treeParts.length && placements.tree.length) {
      this._addInstanced(treeParts, placements.tree, 'trees');
    }
    if (palmParts.length && placements.palm.length) {
      this._addInstanced(palmParts, placements.palm, 'palms');
    }
  }

  _extractParts(gltf) {
    if (!gltf) return [];
    const parts = [];
    gltf.scene.traverse((o) => {
      if (o.isMesh) parts.push(o);
    });
    return parts;
  }

  /**
   * One InstancedMesh per source mesh per spatial tile.
   *
   * A single InstancedMesh holding all 1800 trees spans the whole 13 km city,
   * so it can never be frustum-culled and every tree is drawn every frame.
   * Splitting the placements into ~400 m tiles gives each mesh a small, real
   * bounding sphere, which lets the frustum and the distance cull discard the
   * vast majority of them.
   */
  _addInstanced(parts, positions, name, tileSize = 400) {
    const dummy = new THREE.Object3D();
    const tiles = new Map();
    for (const [x, z] of positions) {
      const key = `${Math.floor(x / tileSize)}_${Math.floor(z / tileSize)}`;
      let tile = tiles.get(key);
      if (!tile) { tile = []; tiles.set(key, tile); }
      tile.push([x, z]);
    }

    for (const tile of tiles.values()) {
      for (const mesh of parts) {
        const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, tile.length);
        inst.name = `${name}_${mesh.name}`;
        inst.castShadow = true;
        inst.receiveShadow = true;
        for (let i = 0; i < tile.length; i++) {
          const [x, z] = tile[i];
          dummy.position.set(x, 0, z);
          dummy.rotation.set(0, rand(0, Math.PI * 2), 0);
          const s = rand(0.8, 1.45);
          dummy.scale.set(s, s * rand(0.9, 1.2), s);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        this.group.add(inst);
        this.scatter.push({
          mesh: inst,
          center: inst.boundingSphere.center.clone(),
          radius: inst.boundingSphere.radius,
        });
      }
    }
  }

  // ---------------------------------------------------------------- queries

  /** Building record covering (x, z), if any (used for tree rejection). */
  buildingAt(x, z, margin = 0) {
    const near = this.buildingGrid.query(x, z, margin + 40);
    for (const b of near) {
      if (x < b.minX - margin || x > b.maxX + margin) continue;
      if (z < b.minZ - margin || z > b.maxZ + margin) continue;
      if (pointInPolygon(x, z, b.ring)) return b;
    }
    return null;
  }

  /** Nearest road segment to (x, z) within maxDist, or null. */
  nearestRoad(x, z, maxDist = 40) {
    let best = null, bestD2 = maxDist * maxDist;
    const near = this.roadGrid.query(x, z, maxDist);
    for (const s of near) {
      const d2 = pointSegmentDist2(x, z, s.ax, s.az, s.bx, s.bz);
      if (d2 < bestD2) { bestD2 = d2; best = s; }
    }
    return best;
  }

  /** A random point on a road, biased toward wide roads, for spawning. */
  randomRoadPoint(kinds = ['primary', 'secondary', 'tertiary', 'residential']) {
    for (let i = 0; i < 60; i++) {
      const s = pick(this.roadSegments);
      if (!kinds.includes(s.kind)) continue;
      const t = Math.random();
      return {
        x: s.ax + (s.bx - s.ax) * t,
        z: s.az + (s.bz - s.az) * t,
        yaw: Math.atan2(s.bx - s.ax, s.bz - s.az),
        segment: s,
      };
    }
    const s = this.roadSegments[0];
    return { x: s.ax, z: s.az, yaw: 0, segment: s };
  }

  /** Nearest road segment near a point, used for agent routes. */
  roadPolylineNear(x, z, maxDist = 60) {
    const near = this.roadGrid.query(x, z, maxDist);
    if (!near.length) return null;
    let best = null, bestD2 = Infinity;
    for (const s of near) {
      const d2 = pointSegmentDist2(x, z, s.ax, s.az, s.bx, s.bz);
      if (d2 < bestD2) { bestD2 = d2; best = s; }
    }
    return best;
  }

  /**
   * Push a circle (x, z, radius) out of every building it overlaps.
   * Returns the corrected position. Runs on a small candidate set thanks to
   * the spatial hash.
   */
  resolveCollision(x, z, radius) {
    const near = this.buildingGrid.query(x, z, radius + 60);
    let px = x, pz = z;
    // Eject and separate, alternating until stable. Separating from one
    // neighbour can push the point back inside a building it was just ejected
    // from (dense blocks share walls), so neither pass can be trusted to run
    // last on its own.
    for (let round = 0; round < 5; round++) {
      let moved = false;
      for (const b of near) {
        if (px < b.minX - radius || px > b.maxX + radius) continue;
        if (pz < b.minZ - radius || pz > b.maxZ + radius) continue;
        if (!pointInPolygon(px, pz, b.ring)) continue;
        const closest = closestPointOnPolygon(px, pz, b.ring);
        const dx = px - closest.x, dz = pz - closest.z;
        const d = Math.hypot(dx, dz);
        // The normal points from the edge toward the interior, so the exit is
        // in the opposite direction - adding it would push the player deeper.
        const nx = d > 1e-5 ? dx / d : 1, nz = d > 1e-5 ? dz / d : 0;
        px = closest.x - nx * (radius + 0.02);
        pz = closest.z - nz * (radius + 0.02);
        moved = true;
      }
      for (const b of near) {
        if (px < b.minX - radius || px > b.maxX + radius) continue;
        if (pz < b.minZ - radius || pz > b.maxZ + radius) continue;
        if (pointInPolygon(px, pz, b.ring)) continue;
        const closest = closestPointOnPolygon(px, pz, b.ring);
        const dx = px - closest.x, dz = pz - closest.z;
        const d = Math.hypot(dx, dz);
        if (d < radius) {
          const nx = d > 1e-5 ? dx / d : 1, nz = d > 1e-5 ? dz / d : 0;
          px = closest.x + nx * radius;
          pz = closest.z + nz * radius;
          moved = true;
        }
      }
      if (!moved) break;
    }
    // Final guarantee: never leave the player inside a wall. The separation
    // pass above can undo an ejection when blocks share a wall, so one last
    // eject-only sweep runs with nothing after it. It may leave the point
    // marginally inside a neighbouring building's margin, which is harmless,
    // but never inside a wall.
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const b of near) {
        if (px < b.minX - radius || px > b.maxX + radius) continue;
        if (pz < b.minZ - radius || pz > b.maxZ + radius) continue;
        if (!pointInPolygon(px, pz, b.ring)) continue;
        const closest = closestPointOnPolygon(px, pz, b.ring);
        const dx = px - closest.x, dz = pz - closest.z;
        const d = Math.hypot(dx, dz);
        const nx = d > 1e-5 ? dx / d : 1, nz = d > 1e-5 ? dz / d : 0;
        px = closest.x - nx * (radius + 0.02);
        pz = closest.z - nz * (radius + 0.02);
        moved = true;
      }
      if (!moved) break;
    }
    return { x: px, z: pz };
  }

  /**
   * Moves a circle from (fromX, fromZ) toward (toX, toZ), sliding along walls.
   *
   * `resolveCollision` can only fix a point that is already overlapping, and
   * ejecting such a point pushes it out through whichever face happens to be
   * nearest - so a fast or diagonal step into a wall can come out the far
   * side. This never lets that happen: each axis is advanced separately and
   * only if the result is not inside a footprint. Moving into a wall simply
   * stops that axis, which is also what gives natural sliding along facades.
   */
  moveWithCollision(fromX, fromZ, toX, toZ, radius) {
    let px = fromX, pz = fromZ;
    const near = this.buildingGrid.query(toX, toZ, radius + 60);
    const blocked = (x, z) => {
      for (const b of near) {
        if (x < b.minX - radius || x > b.maxX + radius) continue;
        if (z < b.minZ - radius || z > b.maxZ + radius) continue;
        if (pointInPolygon(x, z, b.ring)) return true;
        // Outside the footprint but closer than the radius counts as a hit too,
        // so the body stops flush against the wall instead of clipping into it.
        if (closestPointOnPolygon(x, z, b.ring).dist < radius) return true;
      }
      return false;
    };
    if (!blocked(toX, pz)) px = toX;
    if (!blocked(px, toZ)) pz = toZ;
    // If both axes were blocked the point may still overlap from an earlier
    // frame (a spawn or a teleport); fall back to a push-out so it cannot stick.
    if (pointInAnyPolygon(px, pz, near)) {
      const res = this.resolveCollision(px, pz, radius);
      px = res.x; pz = res.z;
    }
    return this.clampToBounds(px, pz);
  }

  /** Keep a position inside the mapped city extent. */
  clampToBounds(x, z) {
    const b = this.bounds;
    return {
      x: clamp(x, b.minX + 20, b.maxX - 20),
      z: clamp(z, b.minZ + 20, b.maxZ - 20),
    };
  }

  get spawn() {
    const s = this.layout.spawn;
    return { x: s.x, z: s.z, yaw: s.yaw ?? 0 };
  }

  get landmarks() {
    return this.layout.landmarks || [];
  }
}

// ------------------------------------------------------------------ geometry

export function pointInPolygon(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1];
    const xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** True when (x, z) falls inside any of the given building rings. */
export function pointInAnyPolygon(x, z, buildings) {
  for (const b of buildings) {
    if (x < b.minX || x > b.maxX) continue;
    if (z < b.minZ || z > b.maxZ) continue;
    if (pointInPolygon(x, z, b.ring)) return true;
  }
  return false;
}

function closestPointOnPolygon(x, z, ring) {
  let bx = 0, bz = 0, bd2 = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], az = ring[j][1];
    const cx = ring[i][0], cz = ring[i][1];
    const vx = cx - ax, vz = cz - az;
    const len2 = vx * vx + vz * vz;
    let t = len2 > 1e-9 ? ((x - ax) * vx + (z - az) * vz) / len2 : 0;
    t = clamp(t, 0, 1);
    const px = ax + vx * t, pz = az + vz * t;
    const d2 = (x - px) ** 2 + (z - pz) ** 2;
    if (d2 < bd2) { bd2 = d2; bx = px; bz = pz; }
  }
  return { x: bx, z: bz, dist: Math.sqrt(bd2) };
}

export function pointSegmentDist2(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 1e-9 ? ((px - ax) * vx + (pz - az) * vz) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + vx * t, cz = az + vz * t;
  return (px - cx) ** 2 + (pz - cz) ** 2;
}
