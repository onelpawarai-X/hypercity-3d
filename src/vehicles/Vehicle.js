import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { loadGLTF, damp, clamp } from '../utils.js';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Base class for anything the player can drive or fly.
 *
 * A vehicle owns a model (a clone of a cached GLTF), a position/heading in
 * world space, and a per-type update() that integrates its own physics.
 * Collision is handled against the building footprint index, which is all a
 * city this size needs.
 */
export class Vehicle {
  constructor(type, cfg, model, world) {
    this.type = type;
    this.cfg = cfg;
    this.world = world;
    this.root = model;
    this.position = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.pitch = 0;
    this.roll = 0;
    this.driven = false;
    this.radius = Math.max(cfg.width || 2, cfg.length * 0.32);
    this.vehicleInput = {};

    this.root.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
  }

  place(x, z, yaw, y = 0) {
    this.position.set(x, y, z);
    this.heading = yaw;
    this.syncTransform();
  }

  syncTransform() {
    this.root.position.copy(this.position);
    this.root.rotation.set(0, this.heading, 0);
  }

  /** Camera anchors: a chase point and a cockpit point. */
  get chaseAnchor() {
    const back = new THREE.Vector3(0, 0, 1).applyAxisAngle(Y_AXIS, this.heading);
    return this.position.clone()
      .addScaledVector(back, this.cfg.length * 1.05)
      .add(new THREE.Vector3(0, this.cfg.length * 0.42 + 1.6, 0));
  }

  get cockpitAnchor() {
    return this.position.clone().add(new THREE.Vector3(0, this.cfg.length * 0.24 + 0.9, 0));
  }

  update(dt, input) {}
}

/**
 * A wheeled car. Uses a kinematic bicycle model: the front wheels steer, the
 * body advances along its heading at the current speed, and speed is
 * integrated from throttle/brake/drag.
 *
 * Wheel meshes in the source GLB are authored in car space, so each wheel is
 * reparented under a pivot placed at the wheel's own centre - otherwise it
 * would orbit the car's origin instead of spinning in place.
 */
export class CarVehicle extends Vehicle {
  constructor(type, cfg, model, world) {
    super(type, cfg, model, world);
    this.wheels = [];
    this._setupWheels();
    this.steerAngle = 0;
    this.wheelSpin = 0;
  }

  _setupWheels() {
    const groups = new Map();
    this.root.traverse((o) => {
      const m = /^wheel_(lf|lr|rf|rr)_/.exec(o.name || '');
      if (!m) return;
      if (!groups.has(m[1])) groups.set(m[1], []);
      groups.get(m[1]).push(o);
    });

    for (const [key, nodes] of groups) {
      const box = new THREE.Box3();
      const tmp = new THREE.Box3();
      for (const n of nodes) {
        tmp.setFromObject(n);
        box.union(tmp);
      }
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      const pivot = new THREE.Group();
      pivot.name = `pivot_${key}`;
      pivot.position.copy(center);
      const parent = nodes[0].parent;
      parent.add(pivot);
      for (const n of nodes) {
        n.parent.remove(n);
        n.position.sub(center);
        pivot.add(n);
      }
      this.wheels.push({
        pivot,
        isFront: key.startsWith('lf') || key.startsWith('rf'),
        radius: Math.max(size.x, size.y) * 0.5 || this.cfg.wheelRadius,
      });
    }
  }

  update(dt, input) {
    const cfg = this.cfg;
    const throttle = input.throttle ?? 0;
    const brake = input.brake ?? 0;
    const steer = input.steer ?? 0;

    // Longitudinal: engine force, braking, aerodynamic drag.
    if (throttle > 0.01) this.speed += cfg.accel * throttle * dt;
    if (brake > 0.01) {
      if (this.speed > 0.2) this.speed -= cfg.brake * brake * dt;
      else this.speed -= cfg.accel * 0.55 * brake * dt; // reverse
    }
    const drag = cfg.drag * 0.0009 * this.speed * Math.abs(this.speed) + 0.6;
    if (throttle < 0.01 && brake < 0.01) {
      const decel = drag * dt;
      if (Math.abs(this.speed) <= decel) this.speed = 0;
      else this.speed -= Math.sign(this.speed) * decel;
    }
    this.speed = clamp(this.speed, -cfg.reverseSpeed, cfg.maxSpeed);

    // Steering: authority falls off with speed, and reverses when backing up.
    const speedFactor = 1 / (1 + Math.abs(this.speed) * 0.045);
    const targetSteer = steer * cfg.maxSteer * speedFactor;
    this.steerAngle = damp(this.steerAngle, targetSteer, 9, dt);

    const wheelBase = cfg.length * 0.62;
    const yawRate = (this.speed / wheelBase) * Math.tan(this.steerAngle);
    this.heading += yawRate * dt;

    // Advance along the heading (the model's nose points down -Z).
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(Y_AXIS, this.heading);
    const nx = this.position.x + forward.x * this.speed * dt;
    const nz = this.position.z + forward.z * this.speed * dt;
    const res = this.world.resolveCollision(nx, nz, this.radius);
    if (Math.abs(res.x - nx) > 1e-4 || Math.abs(res.z - nz) > 1e-4) {
      this.speed *= 0.28; // hit a wall
    }
    const b = this.world.clampToBounds(res.x, res.z);
    this.position.x = b.x;
    this.position.z = b.z;

    // A little body roll into corners, purely cosmetic.
    const targetRoll = -this.steerAngle * clamp(Math.abs(this.speed) / cfg.maxSpeed, 0, 1) * 0.35;
    this.roll = damp(this.roll, targetRoll, 6, dt);

    this._animateWheels(dt);
    this.syncTransform();
  }

  syncTransform() {
    this.root.position.copy(this.position);
    this.root.rotation.set(0, this.heading, 0);
    this.root.rotateZ(this.roll);
  }

  _animateWheels(dt) {
    this.wheelSpin += (this.speed / (this.cfg.wheelRadius || 0.4)) * dt;
    for (const w of this.wheels) {
      w.pivot.rotation.x = this.wheelSpin;
      if (w.isFront) w.pivot.rotation.y = this.steerAngle;
    }
  }
}

/**
 * A flying vehicle. Two flight models share one class:
 *
 *  - vtol (helicopter, drone): W/S set collective climb/descent, the pitch
 *    and roll axes tilt the rotor disc to translate, A/D yaw the nose.
 *    It hovers when hands are off.
 *  - fixedWing (plane, jet, floatplane): W/S set engine throttle, A/D roll
 *    the wings, and pitch trades airspeed for altitude. Roll drives a
 *    coordinated turn, and the craft always moves along its nose.
 */
export class AircraftVehicle extends Vehicle {
  constructor(type, cfg, model, world) {
    super(type, cfg, model, world);
    this.vtol = ['helicopter', 'drone'].includes(type);
    this.airThrottle = this.vtol ? 0 : 0.6;
    this.verticalSpeed = 0;
    this.velocity = new THREE.Vector3();
    this.rotors = [];
    this.rotorSpin = 0;
    this._setupRotors();
  }

  _setupRotors() {
    // The downloaded helicopters name their main and tail rotors clearly;
    // any node matching a rotor or propeller keyword is animated in place.
    const keywords = ['fan', 'rotor', 'propeller', 'prop', 'blade', 'main_rotor', 'tail_rotor'];
    this.root.traverse((o) => {
      const n = (o.name || '').toLowerCase();
      if (!n) return;
      if (keywords.some((k) => n.includes(k))) {
        const isTail = n.includes('back') || n.includes('tail');
        this.rotors.push({ node: o, isTail });
      }
    });
  }

  update(dt, input) {
    if (this.vtol) this._updateVtol(dt, input);
    else this._updateFixedWing(dt, input);
    this._animate(dt);
    this.syncTransform();
  }

  _updateVtol(dt, input) {
    const cfg = this.cfg;
    const collective = input.collective ?? 0; // W/S: climb or descend
    const pitchIn = input.pitch ?? 0;
    const rollIn = input.roll ?? 0;
    const yawIn = input.yaw ?? 0;

    this.verticalSpeed = damp(this.verticalSpeed, collective * cfg.lift, 2.4, dt);

    this.pitch = damp(this.pitch, pitchIn * cfg.maxPitch, 3.2, dt);
    this.roll = damp(this.roll, rollIn * cfg.maxRoll, 3.2, dt);
    this.heading += yawIn * 1.2 * dt;

    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(Y_AXIS, this.heading);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(Y_AXIS, this.heading);

    // Tilting the rotor disc converts lift into horizontal thrust.
    this.velocity.addScaledVector(forward, Math.sin(this.pitch) * cfg.accel * dt);
    this.velocity.addScaledVector(right, Math.sin(this.roll) * cfg.accel * dt);
    const dragFactor = Math.exp(-cfg.drag * dt);
    this.velocity.x *= dragFactor;
    this.velocity.z *= dragFactor;
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    if (hs > cfg.maxSpeed) { this.velocity.x *= cfg.maxSpeed / hs; this.velocity.z *= cfg.maxSpeed / hs; }

    let nx = this.position.x + this.velocity.x * dt;
    let nz = this.position.z + this.velocity.z * dt;
    let ny = this.position.y + this.verticalSpeed * dt;

    if (ny <= 0) { ny = 0; if (this.verticalSpeed < 0) this.verticalSpeed *= -0.15; }
    ny = Math.min(ny, 3000);

    // Only test building collision while low enough to actually hit one.
    if (ny < 320) {
      const res = this.world.resolveCollision(nx, nz, this.radius);
      if (res.x !== nx || res.z !== nz) {
        this.velocity.multiplyScalar(0.25);
        nx = res.x; nz = res.z;
      }
    }
    const b = this.world.clampToBounds(nx, nz);
    this.position.set(b.x, ny, b.z);
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
  }

  _updateFixedWing(dt, input) {
    const cfg = this.cfg;
    const throttleIn = input.throttle ?? 0;
    const pitchIn = input.pitch ?? 0;
    const rollIn = input.roll ?? 0;
    const yawIn = input.yaw ?? 0;

    this.airThrottle = clamp(this.airThrottle + throttleIn * dt * 0.8, 0, 1);
    this.speed = damp(this.speed, this.airThrottle * cfg.maxSpeed, 0.6, dt);
    const stallSpeed = cfg.maxSpeed * 0.22;

    this.pitch = damp(this.pitch, pitchIn * cfg.maxPitch, 3.4, dt);
    this.roll = damp(this.roll, rollIn * cfg.maxRoll, 3.4, dt);

    // Banked turn: rolling the wings converts lift into a heading change.
    const g = 9.81;
    const bankTurn = this.speed > stallSpeed
      ? (-Math.tan(this.roll) * g) / Math.max(this.speed, 14)
      : 0;
    this.heading += (bankTurn + yawIn * 0.5) * dt;

    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(Y_AXIS, this.heading);
    let nx = this.position.x + forward.x * this.speed * dt;
    let nz = this.position.z + forward.z * this.speed * dt;

    // Climb follows pitch; below stall speed gravity wins.
    const climb = Math.sin(this.pitch) * this.speed;
    let ny = this.position.y + climb * dt;
    if (this.speed < stallSpeed) ny -= (stallSpeed - this.speed) * 0.8 * dt;
    if (ny < 1.2) { ny = 1.2; this.pitch = Math.max(this.pitch, 0); }
    ny = Math.min(ny, 4000);

    if (ny < 320) {
      const res = this.world.resolveCollision(nx, nz, this.radius);
      if (res.x !== nx || res.z !== nz) {
        this.speed *= 0.2;
        nx = res.x; nz = res.z;
      }
    }
    const b = this.world.clampToBounds(nx, nz);
    this.position.set(b.x, ny, b.z);
  }

  _animate(dt) {
    const spinRate = this.vtol ? 26 + this.speed * 0.4 : 20 + this.speed * 0.3;
    this.rotorSpin += spinRate * dt;
    for (const r of this.rotors) {
      if (r.isTail) r.node.rotation.x = this.rotorSpin;
      else r.node.rotation.y = this.rotorSpin;
    }
  }

  /** Apply pitch/roll to the visual model only (physics stays yaw-based). */
  syncTransform() {
    this.root.position.copy(this.position);
    this.root.rotation.set(0, this.heading, 0);
    const k = this.vtol ? 0.85 : 1;
    this.root.rotateX(this.pitch * k);
    this.root.rotateZ(this.roll * k);
  }

  get chaseAnchor() {
    const back = new THREE.Vector3(0, 0, 1).applyAxisAngle(Y_AXIS, this.heading);
    const dist = this.cfg.length * 1.6 + 8;
    return this.position.clone()
      .addScaledVector(back, dist)
      .add(new THREE.Vector3(0, this.cfg.length * 0.3 + 2.5, 0));
  }
}

/**
 * Loads, caches and clones vehicle models. Only one GLB per type is fetched;
 * every subsequent spawn is a cheap clone sharing the same geometry.
 */
export class VehicleManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.cache = new Map();
    this.active = [];
    this.group = new THREE.Group();
    this.group.name = 'vehicles';
    scene.add(this.group);
  }

  async preload(types) {
    await Promise.all(types.map((t) => this._load(t)));
  }

  async _load(type) {
    if (this.cache.has(type)) return this.cache.get(type);
    const cfg = CONFIG.vehicles[type];
    if (!cfg) throw new Error(`unknown vehicle ${type}`);
    const gltf = await loadGLTF(cfg.model);
    const entry = { cfg, gltf, scale: cfg.baseScale || 1 };
    this.cache.set(type, entry);
    return entry;
  }

  /** Create an instance of a vehicle type at a world position. */
  async spawn(type, { x, z, y = 0, yaw = 0, driven = false } = {}) {
    const entry = await this._load(type);
    const model = entry.gltf.scene.clone(true);
    if (entry.scale !== 1) model.scale.setScalar(entry.scale);

    const Cls = ['helicopter', 'drone', 'plane', 'jet', 'floatplane'].includes(type)
      ? AircraftVehicle : CarVehicle;
    const v = new Cls(type, entry.cfg, model, this.world);
    v.place(x, z, yaw, y);
    v.driven = driven;
    this.group.add(model);
    this.active.push(v);
    return v;
  }

  remove(v) {
    const i = this.active.indexOf(v);
    if (i >= 0) this.active.splice(i, 1);
    this.group.remove(v.root);
  }

  clear() {
    for (const v of [...this.active]) this.remove(v);
  }

  /** Nearest vehicle to a point within maxDist (for the E-to-enter prompt). */
  nearest(pos, maxDist = 12) {
    let best = null, bestD = maxDist;
    for (const v of this.active) {
      const d = Math.hypot(v.position.x - pos.x, v.position.z - pos.z);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  update(dt, controller) {
    for (const v of this.active) {
      if (controller && controller.vehicle === v) v.update(dt, v.vehicleInput);
      else if (v.aiInput) v.update(dt, v.aiInput);
      else if (v.driven) v.update(dt, {});
    }
  }
}
