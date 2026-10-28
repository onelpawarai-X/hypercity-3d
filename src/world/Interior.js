import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { loadGLTF, rand, pick, clamp, measure } from '../utils.js';

/**
 * Enterable building interiors, furnished with real downloaded props.
 *
 * The city GLB has no interiors, so each one is built on demand from the
 * building's own footprint: walls are extruded from the same rectangle the
 * collision code uses, a doorway is cut on the street-facing side, and the
 * room is filled with Poly Haven (CC0) furniture.
 *
 * Interiors live in a separate group parked far below the city (see
 * INTERIOR_ORIGIN) so entering one is just a teleport plus a visibility
 * swap, with no risk of the interior overlapping the street geometry.
 */

const INTERIOR_ORIGIN = new THREE.Vector3(0, -800, 0);

/** Real props, grouped by the role they play in a room. */
export const PROP_SETS = {
  bed: ['GothicBed_01', 'old_bed_frame', 'vintage_day_bed'],
  seat: ['ArmChair_01', 'WoodenChair_01', 'Sofa_01', 'folding_wooden_stool', 'GreenChair_01'],
  table: ['WoodenTable_01', 'WoodenTable_02', 'coffee_table_round_01', 'SchoolDesk_01', 'metal_office_desk'],
  storage: ['Shelf_01', 'drawer_cabinet', 'chinese_cabinet', 'GothicCabinet_01',
    'painted_wooden_cabinet', 'vintage_cabinet_01', 'wooden_bookshelf_worn'],
  decor: ['ornate_mirror_01', 'potted_plant_01', 'ceramic_vase_01', 'old_military_crate', 'desk_lamp_arm_01'],
  clothes: ['life_jacket'],
};

/** Nominal height in metres, used only when a model's authored scale is off. */
const TARGET_HEIGHT = {
  bed: 0.62, seat: 0.95, table: 0.76, storage: 1.85, decor: 0.7, clothes: 0.8,
};

export class InteriorSystem {
  constructor(scene, world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'interiors';
    this.group.position.copy(INTERIOR_ORIGIN);
    this.group.visible = false;
    scene.add(this.group);

    this.templates = new Map(); // prop name -> { scene, size, box }
    this.built = new Map(); // building id -> interior record
    this.active = null;
    this.loaded = false;
    this.wallMaterial = new THREE.MeshStandardMaterial({ color: 0xd9d2c6, roughness: 0.92 });
    this.floorMaterial = new THREE.MeshStandardMaterial({ color: 0x6b5744, roughness: 0.85 });
    this.ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0xf1ece2, roughness: 1 });
  }

  async load(onProgress) {
    const names = Object.values(PROP_SETS).flat();
    let done = 0;
    await Promise.all(names.map(async (name) => {
      try {
        const gltf = await loadGLTF(`${CONFIG.interior.assetBase}/${name}.glb`);
        const root = gltf.scene;
        root.traverse((o) => {
          if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
        });
        const { size, box } = measure(root);
        this.templates.set(name, { root, size, box });
      } catch (e) {
        console.warn('interior prop failed', name, e);
      }
      done++;
      onProgress?.(done / names.length, `আসবাব ${done}/${names.length}`);
    }));
    this.loaded = this.templates.size > 0;
    return this;
  }

  /** All prop names that loaded successfully, for the stats API. */
  get propNames() { return [...this.templates.keys()]; }

  /**
   * Build (or reuse) the interior for a building record and return where the
   * player should stand inside it. Coordinates are local to the interior
   * group, so the caller must add `origin` to place anything in the scene.
   */
  enter(building) {
    if (!this.loaded || !building) return null;
    let interior = this.built.get(building.id);
    if (!interior) {
      interior = this._build(building);
      if (!interior) return null;
      this.built.set(building.id, interior);
      // Only a handful of interiors are kept resident; the rest are rebuilt
      // if the player ever comes back, which is cheaper than holding them all.
      if (this.built.size > CONFIG.interior.cacheSize) {
        const oldest = this.built.keys().next().value;
        if (oldest !== building.id) this._dispose(oldest);
      }
    }
    this.active = interior;
    this.group.visible = true;
    return { x: interior.spawn.x, z: interior.spawn.z, yaw: interior.spawn.yaw, buildingId: building.id };
  }

  /** Where the interiors live in world space (parked far below the city). */
  get origin() { return INTERIOR_ORIGIN; }

  exit() {
    this.active = null;
    this.group.visible = false;
  }

  _dispose(id) {
    const interior = this.built.get(id);
    if (!interior) return;
    this.group.remove(interior.root);
    this.built.delete(id);
  }

  /**
   * Lay out a room inside the building footprint.
   *
   * The room is inset from the building rectangle so the walls sit inside the
   * exterior shell the player saw from the street. Rooms are split in two
   * when the footprint is large enough, giving a bedroom and a living room.
   */
  _build(building) {
    const { minX, maxX, minZ, maxZ } = building;
    const bw = maxX - minX, bd = maxZ - minZ;
    if (bw < 4 || bd < 4) return null; // too small to stand in

    const inset = 0.6;
    const x0 = minX + inset, x1 = maxX - inset;
    const z0 = minZ + inset, z1 = maxZ - inset;
    const w = x1 - x0, d = z1 - z0;
    const height = clamp(building.height * 0.28, 2.9, 3.6);

    const root = new THREE.Group();
    root.name = `interior_${building.id}`;
    this.group.add(root);

    const colliders = [];
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;

    // Indoor lighting. The city's HDRI sky and directional sun are irrelevant
    // down here, so each room gets its own warm point lights plus a soft
    // ambient fill.
    const amb = new THREE.AmbientLight(0xfff0dd, 1.6);
    root.add(amb);
    const lampCount = w * d > 80 ? 4 : 2;
    for (let i = 0; i < lampCount; i++) {
      // Physical units: enough candela to read the room without the sun.
      const lamp = new THREE.PointLight(0xffd9a8, 60, Math.max(w, d) * 1.1, 1.2);
      const lx = x0 + w * ((i + 0.5) / lampCount);
      lamp.position.set(lx, height - 0.35, cz + rand(-d * 0.2, d * 0.2));
      root.add(lamp);
    }

    // Floor + ceiling.
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), this.floorMaterial);
    floor.position.set(cx, -0.1, cz);
    floor.receiveShadow = true;
    root.add(floor);

    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), this.ceilingMaterial);
    ceiling.position.set(cx, height + 0.1, cz);
    root.add(ceiling);

    // Walls. The doorway is a gap left in the wall nearest the street, which
    // is the side the player is standing on when they press E.
    const t = 0.22;
    const doorWidth = 1.6;
    const doorSide = this._doorSide(building);
    const walls = [
      { side: 'north', pos: [cx, height / 2, z0], size: [w, height, t] },
      { side: 'south', pos: [cx, height / 2, z1], size: [w, height, t] },
      { side: 'west', pos: [x0, height / 2, cz], size: [t, height, d] },
      { side: 'east', pos: [x1, height / 2, cz], size: [t, height, d] },
    ];
    let doorAt = null;
    for (const wd of walls) {
      if (wd.side === doorSide) {
        // Two segments with a gap in the middle.
        const [sx, sy, sz] = wd.size;
        const horizontal = sx > sz;
        const span = horizontal ? sx : sz;
        const seg = (span - doorWidth) / 2;
        if (seg > 0.3) {
          const offset = doorWidth / 2 + seg / 2;
          for (const dir of [-1, 1]) {
            const mesh = new THREE.Mesh(
              new THREE.BoxGeometry(horizontal ? seg : sx, height, horizontal ? sz : seg),
              this.wallMaterial,
            );
            mesh.position.set(
              wd.pos[0] + (horizontal ? dir * offset : 0),
              wd.pos[1],
              wd.pos[2] + (horizontal ? 0 : dir * offset),
            );
            mesh.castShadow = true; mesh.receiveShadow = true;
            root.add(mesh);
            colliders.push(this._box(mesh));
          }
        }
        // Door frame marker: where the player exits from inside.
        doorAt = { x: wd.pos[0], z: wd.pos[2], horizontal };
        continue;
      }
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...wd.size), this.wallMaterial);
      mesh.position.set(...wd.pos);
      mesh.castShadow = true; mesh.receiveShadow = true;
      root.add(mesh);
      colliders.push(this._box(mesh));
    }

    // Furniture. Larger rooms get a partition and two furnished halves.
    const twoRooms = w > 14 && d > 7;
    if (twoRooms) {
      const mid = x0 + w * 0.5;
      const gap = 1.4;
      const seg = (d - gap) / 2;
      for (const dir of [-1, 1]) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(t, height, seg), this.wallMaterial);
        mesh.position.set(mid, height / 2, cz + dir * (gap / 2 + seg / 2));
        mesh.castShadow = true; mesh.receiveShadow = true;
        root.add(mesh);
        colliders.push(this._box(mesh));
      }
      this._furnish(root, colliders, { x0, x1: mid - 0.4, z0, z1 }, ['bed', 'storage', 'decor'], doorAt);
      this._furnish(root, colliders, { x0: mid + 0.4, x1, z0, z1 }, ['seat', 'table', 'seat', 'storage', 'decor', 'clothes'], doorAt);
    } else {
      const set = ['bed', 'storage', 'seat', 'table', 'seat', 'decor', 'decor', 'clothes'];
      this._furnish(root, colliders, { x0, x1, z0, z1 }, set, doorAt);
    }

    // Spawn just inside the doorway, facing into the room.
    const spawn = { x: doorAt.x, z: doorAt.z, yaw: this._inwardYaw(doorSide) };
    const spawnInset = 1.1;
    spawn.x += Math.sin(spawn.yaw) * -spawnInset;
    spawn.z += Math.cos(spawn.yaw) * -spawnInset;

    // Where the player lands after stepping out of the door, on the street
    // side of the wall.
    const outward = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] }[doorSide];
    const exitPos = { x: doorAt.x + outward[0] * 1.5, z: doorAt.z + outward[1] * 1.5 };

    return {
      id: building.id, root, colliders, spawn, exitPos,
      bounds: { x0, x1, z0, z1 }, doorAt, doorSide, doorWidth, height,
    };
  }

  /** Scatter the requested furniture around the room's edges. */
  _furnish(root, colliders, bounds, roles, doorAt) {
    const { x0, x1, z0, z1 } = bounds;
    const w = x1 - x0, d = z1 - z0;
    if (w < 2 || d < 2) return;

    // Positions march along the walls, starting in a corner and skipping the
    // area in front of the door so the entrance stays walkable.
    const slots = [];
    const step = 2.3;
    for (let x = x0 + 1.0; x < x1 - 0.6; x += step) {
      slots.push({ x, z: z0 + 0.75, face: 0 });
      slots.push({ x, z: z1 - 0.75, face: Math.PI });
    }
    for (let z = z0 + 1.6; z < z1 - 1.2; z += step) {
      slots.push({ x: x0 + 0.75, z, face: Math.PI / 2 });
      slots.push({ x: x1 - 0.75, z, face: -Math.PI / 2 });
    }

    // Shuffle deterministically-ish, then take as many slots as we have roles.
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }

    let placed = 0;
    for (const slot of slots) {
      if (placed >= roles.length) break;
      if (doorAt && Math.hypot(slot.x - doorAt.x, slot.z - doorAt.z) < 2.2) continue;

      const role = roles[placed];
      const name = pick(PROP_SETS[role]);
      const tmpl = this.templates.get(name);
      if (!tmpl) continue;

      const obj = tmpl.root.clone(true);
      const scale = this._scaleFor(role, tmpl.size);
      obj.scale.setScalar(scale);
      obj.position.set(slot.x, 0, slot.z);
      obj.rotation.y = slot.face + rand(-0.25, 0.25);
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      root.add(obj);

      // One collision box per prop, sized from its scaled footprint.
      const halfW = (tmpl.size.x * scale) / 2 + 0.08;
      const halfD = (tmpl.size.z * scale) / 2 + 0.08;
      colliders.push({
        minX: slot.x - halfW, maxX: slot.x + halfW,
        minZ: slot.z - halfD, maxZ: slot.z + halfD,
        height: tmpl.size.y * scale,
      });
      placed++;
    }
  }

  _scaleFor(role, size) {
    const target = TARGET_HEIGHT[role];
    if (!target || size.y < 1e-4) return 1;
    // Only correct models whose authored scale is clearly wrong; correctly
    // authored furniture is left exactly as the artist made it.
    if (size.y > 0.6 * target && size.y < 1.7 * target) return 1;
    return clamp(target / size.y, 0.05, 25);
  }

  _box(mesh) {
    mesh.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(mesh);
    return { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z, height: b.max.y - b.min.y };
  }

  _doorSide(building) {
    // Face the doorway toward the street: the shortest run to a road decides
    // the side, falling back to south when nothing is near.
    const cx = (building.minX + building.maxX) / 2;
    const cz = (building.minZ + building.maxZ) / 2;
    const road = this.world.nearestRoad(cx, cz, 60);
    if (!road) return 'south';
    const dx = (road.ax + road.bx) / 2 - cx;
    const dz = (road.az + road.bz) / 2 - cz;
    if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 'east' : 'west';
    return dz > 0 ? 'south' : 'north';
  }

  _inwardYaw(side) {
    switch (side) {
      case 'north': return Math.PI;   // wall at -Z, look toward +Z
      case 'south': return 0;         // wall at +Z, look toward -Z
      case 'west': return -Math.PI / 2;
      default: return Math.PI / 2;
    }
  }

  /** Collide a circle against the active interior's walls and furniture. */
  resolveCollision(x, z, radius) {
    const interior = this.active;
    if (!interior) return { x, z };
    let px = x, pz = z;
    for (const c of interior.colliders) {
      if (c.height !== undefined && c.height < 0.35) continue; // step over rugs
      const nx = clamp(px, c.minX, c.maxX);
      const nz = clamp(pz, c.minZ, c.maxZ);
      const dx = px - nx, dz = pz - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 > radius * radius) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        px = nx + (dx / d) * radius;
        pz = nz + (dz / d) * radius;
      } else {
        // Centre is inside the box: push out along the shallowest axis.
        const left = px - c.minX, right = c.maxX - px;
        const back = pz - c.minZ, front = c.maxZ - pz;
        const m = Math.min(left, right, back, front);
        if (m === left) px = c.minX - radius;
        else if (m === right) px = c.maxX + radius;
        else if (m === back) pz = c.minZ - radius;
        else pz = c.maxZ + radius;
      }
    }
    // Keep the player inside the room shell, except across the doorway, where
    // the clamp is widened to the door span so the player can walk out.
    const b = interior.bounds;
    const d = interior.doorAt;
    const half = (interior.doorWidth ?? 1.6) / 2;
    const inDoorway = d && (
      d.horizontal
        ? Math.abs(pz - d.z) < 0.9 && Math.abs(px - d.x) < half - radius * 0.5
        : Math.abs(px - d.x) < 0.9 && Math.abs(pz - d.z) < half - radius * 0.5
    );
    if (inDoorway) {
      // Only the axis the door is on may be left; the other stays clamped.
      if (d.horizontal) {
        px = clamp(px, b.x0 + radius, b.x1 - radius);
        const outward = interior.doorSide === 'south' ? 1 : -1;
        const limit = outward > 0 ? b.z1 + 2.5 : b.z0 - 2.5;
        pz = outward > 0 ? Math.min(pz, limit) : Math.max(pz, limit);
      } else {
        pz = clamp(pz, b.z0 + radius, b.z1 - radius);
        const outward = interior.doorSide === 'east' ? 1 : -1;
        const limit = outward > 0 ? b.x1 + 2.5 : b.x0 - 2.5;
        px = outward > 0 ? Math.min(px, limit) : Math.max(px, limit);
      }
    } else {
      px = clamp(px, b.x0 + radius, b.x1 - radius);
      pz = clamp(pz, b.z0 + radius, b.z1 - radius);
    }
    return { x: px, z: pz };
  }

  /**
   * True once the player has stepped through the doorway and is standing
   * outside the room's shell, which is what ends the interior visit.
   */
  hasSteppedOut(x, z) {
    const interior = this.active;
    if (!interior) return false;
    const b = interior.bounds;
    const m = 0.15;
    return x < b.x0 - m || x > b.x1 + m || z < b.z0 - m || z > b.z1 + m;
  }
}
