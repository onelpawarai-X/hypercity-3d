import * as THREE from 'three';
import { CONFIG, MODES } from '../config.js';
import { damp, angleDelta, clamp } from '../utils.js';

/**
 * The human player on foot: a capsule with real gravity, building collision
 * and an animated character mesh.
 *
 * The controller is deliberately engine-agnostic: it exposes a plain
 * position/heading state so an AI agent can drive the exact same code path
 * through setIntent().
 */
export class PlayerController {
  constructor(world, rig) {
    this.world = world;
    this.rig = rig;
    this.cfg = CONFIG.player;

    const s = world.spawn;
    this.position = new THREE.Vector3(s.x, 0, s.z);
    this.velocity = new THREE.Vector3();
    this.heading = s.yaw;
    this.verticalVelocity = 0;
    this.grounded = true;
    this.radius = this.cfg.radius;

    this.cameraYaw = s.yaw;
    this.cameraPitch = -0.08;
    this.thirdPerson = true;

    this.intent = { x: 0, z: 0, run: false, jump: false, yaw: null };
    this.moving = 0;

    // Combat state: the player is an entity like any agent.
    this.id = 'player';
    this.faction = 'player';
    this.maxHealth = 100;
    this.health = 100;
    this.dead = false;
    this.kills = 0;
    this.lastHitAt = -99;
    this.attackUntil = 0;

    // Set while the player is inside a building, so collision uses the
    // interior's own walls and furniture instead of the city footprint.
    this.interior = null;
    this.interiorSystem = null;
    this.interiorOrigin = null;

    if (rig) {
      rig.root.position.set(this.position.x, 0, this.position.z);
      rig.heading = this.heading;
      rig.root.rotation.y = this.heading + rig.yawOffset;
    }
  }

  /** Move the player into an interior's coordinate space. */
  enterInterior({ x, z, yaw }, system, origin) {
    this.interiorSystem = system;
    this.interior = system.active;
    this.interiorOrigin = origin;
    this.position.set(origin.x + x, origin.y, origin.z + z);
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.heading = yaw;
    this.cameraYaw = yaw;
  }

  exitInterior(worldX, worldZ, yaw) {
    this.interior = null;
    this.interiorSystem = null;
    this.interiorOrigin = null;
    this.position.set(worldX, 0, worldZ);
    this.velocity.set(0, 0, 0);
    this.heading = yaw;
    this.cameraYaw = yaw;
  }

  /** True when the player is standing in an interior rather than the street. */
  get indoors() { return !!this.interior; }

  /**
   * Resolve horizontal movement. Indoors this uses the interior's wall and
   * furniture boxes; outdoors it uses the city's building footprints.
   */
  _resolveHorizontal(nx, nz) {
    if (this.interiorSystem) {
      const o = this.interiorOrigin;
      const res = this.interiorSystem.resolveCollision(nx - o.x, nz - o.z, this.radius);
      return { x: res.x + o.x, z: res.z + o.z };
    }
    const res = this.world.resolveCollision(nx, nz, this.radius);
    return this.world.clampToBounds(res.x, res.z);
  }

  setIntent(intent) {
    Object.assign(this.intent, intent);
  }

  /** Mouse/stick look. In first person it aims the body too. */
  look(dx, dy) {
    this.cameraYaw -= dx;
    this.cameraPitch = clamp(this.cameraPitch - dy, -1.35, 1.2);
  }

  update(dt) {
    const cfg = this.cfg;
    const intent = this.intent;

    // Dead: stop taking input, fall over, and wait for a respawn.
    if (this.dead) {
      this.velocity.set(0, 0, 0);
      if (this.rig) {
        this.rig.setSpeed(0, dt);
        if (!this.rig.dead) this.rig.playDeath();
      }
      return 0;
    }

    // Desired horizontal velocity, relative to where the camera is looking.
    const fwd = new THREE.Vector3(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    const right = new THREE.Vector3(Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw));
    const wish = new THREE.Vector3()
      .addScaledVector(right, intent.x)
      .addScaledVector(fwd, -intent.z);
    if (wish.lengthSq() > 1) wish.normalize();

    const speed = intent.run ? cfg.runSpeed : cfg.walkSpeed;
    const target = wish.multiplyScalar(speed);

    this.velocity.x = damp(this.velocity.x, target.x, cfg.acceleration, dt);
    this.velocity.z = damp(this.velocity.z, target.z, cfg.acceleration, dt);

    // Gravity + jump. Inside a building the floor sits at the interior origin.
    const floorY = this.interiorOrigin ? this.interiorOrigin.y : 0;
    this.verticalVelocity -= cfg.gravity * dt;
    if (intent.jump && this.grounded) {
      this.verticalVelocity = cfg.jumpSpeed;
      this.grounded = false;
    }
    this.position.y += this.verticalVelocity * dt;
    if (this.position.y <= floorY) {
      this.position.y = floorY;
      this.verticalVelocity = 0;
      this.grounded = true;
    }

    // Horizontal move with collision resolution. Indoors the floor is at the
    // interior origin, so the ground plane is not always y = 0.
    let nx = this.position.x + this.velocity.x * dt;
    let nz = this.position.z + this.velocity.z * dt;
    const resolved = this._resolveHorizontal(nx, nz);
    this.position.x = resolved.x;
    this.position.z = resolved.z;

    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.moving = horizSpeed;

    // Face the movement direction; in first person follow the camera instead.
    if (intent.yaw !== null && intent.yaw !== undefined) {
      this.heading = intent.yaw;
    } else if (this.thirdPerson && horizSpeed > 0.35) {
      this.heading = Math.atan2(this.velocity.x, this.velocity.z);
    } else {
      this.heading = this.cameraYaw;
    }

    if (this.rig) {
      this.rig.position.set(this.position.x, this.position.y, this.position.z);
      if (this.thirdPerson) this.rig.faceHeading(this.heading, dt, 12);
      else {
        this.rig.heading = this.heading;
        this.rig.root.rotation.y = this.heading + this.rig.yawOffset;
      }
      // Hide the body in first person so it does not block the view.
      this.rig.root.visible = this.thirdPerson;
      this.rig.setSpeed(horizSpeed, dt);
    }
    return horizSpeed;
  }

  get eyePosition() {
    return new THREE.Vector3(this.position.x, this.position.y + this.cfg.eyeHeight, this.position.z);
  }
}
