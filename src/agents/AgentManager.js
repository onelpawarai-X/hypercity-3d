import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { SpatialGrid, rand, pick, clamp, angleDelta } from '../utils.js';

/**
 * A single embodied AI agent living in the city.
 *
 * The agent is a plain state machine over a small, explicit action space so
 * that an external learning process can drive it through the same interface a
 * scripted crowd uses. Its observation vector and reward are exposed on
 * every step by the TrainingBridge, which makes this world usable as an RL
 * or LLM-agent environment rather than only a game.
 */
export class Agent {
  constructor(id, archetype, rig, world) {
    this.id = id;
    this.archetype = archetype;
    this.rig = rig;
    this.world = world;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.radius = CONFIG.agents.radius;

    this.goal = null;
    this.path = [];
    this.pathIndex = 0;
    this.state = 'idle';
    this.stateTimer = 0;
    this.stuck = 0;
    this.totalDistance = 0;
    this.stepsAlive = 0;

    this.vehicle = null;
    this.controlMode = 'auto'; // 'auto' | 'policy' | 'goal'
    this.lastAction = [0, 0, 0, 0];
    this.metadata = {};

    // Combat state. Every agent is a combatant, whether or not it ever fights.
    this.faction = CONFIG.combat.factions[archetype] || 'civilian';
    this.maxHealth = CONFIG.combat.health[archetype] ?? 100;
    this.health = this.maxHealth;
    this.dead = false;
    this.combatTarget = null;
    this.combatCooldown = 0;
    this.attackTimer = 0;
    this.kills = 0;
  }

  spawnAt(x, z, yaw = 0) {
    this.position.set(x, 0, z);
    this.heading = yaw;
    this.syncRig();
  }

  syncRig() {
    if (!this.rig) return;
    this.rig.position.set(this.position.x, this.position.y, this.position.z);
    this.rig.faceHeading(this.heading, 1, 999);
  }

  /** Assign a navigation goal; the agent walks there on its own. */
  setGoal(x, z, { run = false, onArrive = null } = {}) {
    this.goal = { x, z, run, onArrive };
    this.state = 'seek';
    this.path = [];
    this.pathIndex = 0;
    this.stuck = 0;
  }

  /**
   * Build a coarse road-following route. For city-scale travel we simply
   * chain the nearest road segments between the agent and the goal, which
   * keeps agents on plausible streets without a full navmesh.
   */
  _buildPath() {
    if (!this.goal) return;
    const start = this.world.roadPolylineNear(this.position.x, this.position.z, 90);
    const end = this.world.roadPolylineNear(this.goal.x, this.goal.z, 90);
    const pts = [];
    if (start) pts.push({ x: start.mx, z: start.mz });
    pts.push({ x: this.goal.x, z: this.goal.z });
    if (end) pts.push({ x: end.mx, z: end.mz });
    this.path = pts;
    this.pathIndex = 0;
  }

  /**
   * One fixed physics step. `action` is [forward, strafe, turn, sprint] in
   * [-1, 1] (sprint in [0, 1]); when controlMode is 'auto' the action is
   * derived from the current goal instead.
   */
  step(dt, action = null) {
    const cfg = CONFIG.agents;
    this.stepsAlive++;

    if (this.dead) {
      // A corpse stops moving; the rig plays its death clip and the agent is
      // culled by the manager after a few seconds.
      this.speed = 0;
      return this.observation();
    }

    // Fighting overrides whatever goal the agent had.
    if (this.combatTarget) {
      const t = this.combatTarget;
      if (t.dead || Math.hypot(t.position.x - this.position.x, t.position.z - this.position.z) > 90) {
        this.combatTarget = null;
        this.state = 'idle';
      } else {
        this._stepFight(dt, t);
        return this.observation();
      }
    }

    let a = action;
    if (this.controlMode === 'auto' || !a) a = this._autonomousAction(dt);
    this.lastAction = a;

    const prevX = this.position.x, prevZ = this.position.z;
    this._integrate(dt, a);

    const moved = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    this.totalDistance += moved;
    if (moved < 0.002 && Math.abs(this.speed) > 0.4) this.stuck += dt;
    else this.stuck = 0;
    if (this.stuck > 1.5) this._unstick();

    if (this.rig) {
      this.rig.position.set(this.position.x, this.position.y, this.position.z);
      this.rig.faceHeading(this.heading, dt, 9);
      this.rig.setSpeed(moved / dt, dt);
    }
    return this.observation();
  }

  _autonomousAction(dt) {
    const cfg = CONFIG.agents;
    if (!this.goal) {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        // Idle wandering: pick a nearby road point and stroll to it.
        const rp = this.world.randomRoadPoint();
        this.setGoal(rp.x, rp.z, { run: false });
        this.stateTimer = rand(6, 20);
      }
      return [0, 0, 0, 0];
    }

    if (this.path.length === 0) this._buildPath();
    const target = this.path[this.pathIndex] || this.goal;

    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);

    const arriveR = this.goal.onArrive ? 2.5 : 4;
    if (dist < arriveR) {
      if (this.pathIndex < this.path.length - 1) {
        this.pathIndex++;
      } else {
        const cb = this.goal.onArrive;
        this.goal = null;
        this.state = 'idle';
        this.stateTimer = rand(3, 12);
        cb?.();
        return [0, 0, 0, 0];
      }
    }

    // Convert world direction into a signed heading error.
    const desired = Math.atan2(-dx, -dz);
    const err = angleDelta(this.heading, desired);
    const turn = clamp(err * 2.2, -1, 1);
    const speedScale = Math.abs(err) > 1.2 ? 0.35 : 1;
    const sprint = this.goal.run && Math.abs(err) < 0.6 ? 1 : 0;
    return [speedScale, 0, turn, sprint];
  }

  _unstick() {
    this.stuck = 0;
    this.heading += rand(-2.4, 2.4);
    this.path = [];
    this.pathIndex = 0;
    if (this.rig) this.rig.playOneShot('jump');
  }

  /**
   * Close on a target and swing when in range. Melee only: a fistfight in the
   * street is what the crowd simulation is for. Firearms are reserved for the
   * player and for police, which is what makes them feel different.
   */
  _stepFight(dt, target) {
    const cfg = CONFIG.combat;
    const dx = target.position.x - this.position.x;
    const dz = target.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const desired = Math.atan2(-dx, -dz);
    const err = angleDelta(this.heading, desired);

    this.combatCooldown = Math.max(0, this.combatCooldown - dt);

    if (dist > cfg.meleeRange) {
      // Charge the target at a run.
      const turn = clamp(err * 2.4, -1, 1);
      this._integrate(dt, [1, 0, turn, 1]);
      return;
    }

    // In range: face the target, stop, and swing on a cooldown.
    this._integrate(dt, [0, 0, clamp(err * 3, -1, 1), 0]);
    if (this.combatCooldown <= 0) {
      this.combatCooldown = cfg.aiAttackCooldown + rand(-0.15, 0.35);
      this.rig?.playOneShot(pick(cfg.attackClips));
      // Hits land harder the further the player has pushed into the city.
      const scale = this.game?.combatDirector?.difficulty ?? 1;
      this.game?.combat?.damage(target, cfg.aiMeleeDamage * scale, {
        attacker: this, kind: 'melee', force: 1.2,
        direction: new THREE.Vector3(dx, 0, dz),
      });
    }
  }

  /** Shared movement integration for both goal-seeking and fighting. */
  _integrate(dt, a) {
    const cfg = CONFIG.agents;
    const [fwdIn, strafeIn, turnIn, sprintIn] = a;
    const speedTarget = (sprintIn > 0.5 ? cfg.runSpeed : cfg.walkSpeed) * clamp(fwdIn, -1, 1);
    this.speed = dampValue(this.speed, speedTarget, 8, dt);
    this.heading += turnIn * 2.6 * dt;

    const fx = -Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    const rx = Math.cos(this.heading);
    const rz = -Math.sin(this.heading);

    let nx = this.position.x + (fx * this.speed + rx * strafeIn * 2.4) * dt;
    let nz = this.position.z + (fz * this.speed + rz * strafeIn * 2.4) * dt;

    const neighbours = this.world.agents.grid.query(this.position.x, this.position.z, 2.4);
    for (const other of neighbours) {
      if (other === this || other.dead) continue;
      const ddx = this.position.x - other.position.x;
      const ddz = this.position.z - other.position.z;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 > 1e-4 && d2 < (this.radius + other.radius) ** 2) {
        const d = Math.sqrt(d2);
        const push = (this.radius + other.radius - d) * 0.5;
        nx += (ddx / d) * push;
        nz += (ddz / d) * push;
      }
    }

    const b = this.world.moveWithCollision(this.position.x, this.position.z, nx, nz, this.radius);
    this.position.x = b.x;
    this.position.z = b.z;

    if (this.rig) {
      this.rig.position.set(this.position.x, this.position.y, this.position.z);
      this.rig.faceHeading(this.heading, dt, 9);
      this.rig.setSpeed(Math.abs(this.speed), dt);
    }
  }

  /**
   * Observation vector handed to external policies:
   * [x, z, heading, speed, goalDX, goalDZ, distanceToGoal, stuck, nearestAgentDist]
   */
  observation() {
    let nearest = 9999;
    const near = this.world.agents.grid.query(this.position.x, this.position.z, 12);
    for (const o of near) {
      if (o === this) continue;
      const d = Math.hypot(o.position.x - this.position.x, o.position.z - this.position.z);
      if (d < nearest) nearest = d;
    }
    let gdx = 0, gdz = 0, gd = 0;
    if (this.goal) {
      gdx = this.goal.x - this.position.x;
      gdz = this.goal.z - this.position.z;
      gd = Math.hypot(gdx, gdz);
    }
    return [
      this.position.x, this.position.z, this.heading, this.speed,
      gdx, gdz, gd, this.stuck, nearest,
    ];
  }

  /** Scalar reward used by the training bridge. */
  reward(prevObs, obs) {
    const prevDist = Math.hypot(prevObs[4], prevObs[5]);
    const dist = Math.hypot(obs[4], obs[5]);
    let r = (prevDist - dist) * 1.0;      // progress toward the goal
    if (this.goal && dist < 3) r += 10;   // reached it
    if (this.stuck > 0.5) r -= 0.05;      // penalise being wedged
    r -= 0.001;                           // small time cost
    return r;
  }
}

function dampValue(a, b, lambda, dt) {
  return a + (b - a) * (1 - Math.exp(-lambda * dt));
}

/**
 * Manages the whole crowd of AI agents and exposes the training API.
 *
 * The API is intentionally small and JSON-shaped so it can be called from
 * the browser console, a Playwright script, or a Python process over a
 * WebSocket - the three ways an external trainer typically connects.
 *
 *   const api = game.agents;
 *   const id = api.create('citizen', x, z);       // spawn an agent
 *   api.setGoal(id, gx, gz);                      // scripted navigation
 *   const obs = api.observe(id);                  // observation vector
 *   api.act(id, [1, 0, 0.2, 1]);                  // policy action
 *   const { obs, reward, done } = api.step(id);   // gym-style step
 */
export class AgentManager {
  constructor(scene, world, characterFactory) {
    this.scene = scene;
    this.world = world;
    this.factory = characterFactory; // async (archetype) => CharacterRig
    this.group = new THREE.Group();
    this.group.name = 'agents';
    scene.add(this.group);

    this.grid = new SpatialGrid(16);
    this.agents = [];
    this.byId = new Map();
    this.nextId = 1;
    this.pending = 0;
    this.spawnRadius = 220;
    this.removals = []; // { agent, at }
    this.factions = { civilian: 0, gang: 0, police: 0 };
  }

  /** Give every agent a back-reference to the game, for combat callbacks. */
  attachGame(game) {
    for (const a of this.agents) a.game = game;
  }

  /** Number of agents currently simulated. */
  get count() { return this.agents.length; }

  /** Spawn an agent near the player. Returns its numeric id. */
  async create(archetype, x, z, yaw = 0, opts = {}) {
    if (!CONFIG.agents.models[archetype]) archetype = pick(CONFIG.agents.archetypes);
    const id = this.nextId++;
    this.pending++;
    let rig = null;
    try {
      rig = await this.factory(archetype);
    } catch (e) {
      console.warn('agent rig failed', archetype, e);
    } finally {
      this.pending--;
    }
    const agent = new Agent(id, archetype, rig, this.world);
    if (rig) this.group.add(rig.root);
    agent.spawnAt(x, z, yaw);
    agent.metadata = opts.metadata || {};
    agent.controlMode = opts.controlMode || 'auto';
    if (opts.faction) agent.faction = opts.faction;
    agent.game = opts.game || this.game || null;
    this.agents.push(agent);
    this.byId.set(id, agent);
    this._countFactions();
    return id;
  }

  /** Replace a dead agent with a fresh one after a short delay. */
  scheduleRemoval(agent, delay = 10) {
    this.removals.push({ agent, at: (agent.deathAt ?? 0) + delay });
  }

  /** Spawn a small police squad that converges on `pos`. */
  async spawnPolice(pos, count = 2) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const d = rand(90, 140);
      const x = pos.x + Math.cos(a) * d;
      const z = pos.z + Math.sin(a) * d;
      const id = await this.create(pick(CONFIG.agents.policeArchetypes), x, z, 0, {
        controlMode: 'auto', faction: 'police', game: this.game,
      });
      const cop = this.byId.get(id);
      if (cop) {
        cop.state = 'police';
        cop.setGoal(pos.x + rand(-8, 8), pos.z + rand(-8, 8), { run: true });
      }
    }
  }

  _countFactions() {
    this.factions.civilian = 0;
    this.factions.gang = 0;
    this.factions.police = 0;
    for (const a of this.agents) {
      if (a.faction === 'gang') this.factions.gang++;
      else if (a.faction === 'police') this.factions.police++;
      else this.factions.civilian++;
    }
  }

  remove(id) {
    const i = this.agents.findIndex((a) => a.id === id);
    if (i < 0) return false;
    const a = this.agents[i];
    if (a.rig) this.group.remove(a.rig.root);
    this.agents.splice(i, 1);
    this.byId.delete(id);
    return true;
  }

  clear() {
    for (const a of this.agents) if (a.rig) this.group.remove(a.rig.root);
    this.agents.length = 0;
    this.byId.clear();
  }

  // ------------------------------------------------------------- training

  get(id) { return this.byId.get(id); }

  observe(id) {
    const a = this.byId.get(id);
    return a ? a.observation() : null;
  }

  /** Send an action to a policy-controlled agent. */
  act(id, action) {
    const a = this.byId.get(id);
    if (!a) return null;
    a.controlMode = 'policy';
    a.pendingAction = normalizeAction(action);
    return a.observation();
  }

  setGoal(id, x, z, opts) {
    const a = this.byId.get(id);
    if (!a) return null;
    a.controlMode = 'auto';
    a.setGoal(x, z, opts);
    return a.observation();
  }

  /** Gym-style: run one fixed step for one agent and report reward/done. */
  step(id, action = null) {
    const a = this.byId.get(id);
    if (!a) return null;
    const prev = a.observation();
    if (action) { a.controlMode = 'policy'; a.pendingAction = normalizeAction(action); }
    a.step(CONFIG.sim.fixedStep);
    const obs = a.observation();
    const done = !!(a.goal === null && a.controlMode === 'policy');
    return { obs, reward: a.reward(prev, obs), done, info: { stuck: a.stuck, distance: a.totalDistance } };
  }

  /** Reset an agent to a fresh random road position (episode start). */
  reset(id, { x, z, yaw } = {}) {
    const a = this.byId.get(id);
    if (!a) return null;
    if (x === undefined) {
      const rp = this.world.randomRoadPoint();
      x = rp.x; z = rp.z; yaw = rp.yaw;
    }
    a.spawnAt(x, z, yaw ?? 0);
    a.speed = 0;
    a.goal = null;
    a.stuck = 0;
    a.totalDistance = 0;
    a.stepsAlive = 0;
    return a.observation();
  }

  /** Snapshot of every agent, for external trainers or a debug overlay. */
  snapshot() {
    return this.agents.map((a) => ({
      id: a.id,
      archetype: a.archetype,
      x: a.position.x, z: a.position.z, y: a.position.y,
      heading: a.heading, speed: a.speed,
      state: a.state,
      goal: a.goal ? { x: a.goal.x, z: a.goal.z } : null,
      controlMode: a.controlMode,
      metadata: a.metadata,
    }));
  }

  /** Keep a lively ambient crowd around a moving point (the player). */
  async maintainCrowd(center, target) {
    const want = clamp(target, 0, CONFIG.agents.maxAmbient);
    if (this.agents.length + this.pending >= want) return;
    const angle = rand(0, Math.PI * 2);
    const dist = rand(60, this.spawnRadius);
    const x = center.x + Math.cos(angle) * dist;
    const z = center.z + Math.sin(angle) * dist;
    const road = this.world.nearestRoad(x, z, 40);
    if (!road) return;
    const t = Math.random();
    const px = road.ax + (road.bx - road.ax) * t;
    const pz = road.az + (road.bz - road.az) * t;
    const yaw = Math.atan2(road.bx - road.ax, road.bz - road.az);
    await this.create(pick(CONFIG.agents.archetypes), px, pz, yaw, { controlMode: 'auto' });
  }

  /** Cull agents that have drifted far from the player to bound the cost. */
  cull(center, maxDist = 700) {
    for (let i = this.agents.length - 1; i >= 0; i--) {
      const a = this.agents[i];
      const d = Math.hypot(a.position.x - center.x, a.position.z - center.z);
      if (d > maxDist) this.remove(a.id);
    }
  }

  update(dt) {
    // Rebuild the spatial hash once per frame for separation queries.
    this.grid.cells.clear();
    for (const a of this.agents) this.grid.insert(a.position.x, a.position.z, a);

    for (const a of this.agents) {
      const action = a.pendingAction || null;
      a.pendingAction = null;
      a.step(dt, action);
    }

    // Retire corpses that have lain long enough.
    for (let i = this.removals.length - 1; i >= 0; i--) {
      const r = this.removals[i];
      if ((this.game?.elapsed ?? 0) >= r.at) {
        this.remove(r.agent.id);
        this.removals.splice(i, 1);
      }
    }
  }
}

function normalizeAction(action) {
  if (!action) return [0, 0, 0, 0];
  if (Array.isArray(action)) {
    return [
      clamp(action[0] ?? 0, -1, 1),
      clamp(action[1] ?? 0, -1, 1),
      clamp(action[2] ?? 0, -1, 1),
      clamp(action[3] ?? 0, 0, 1),
    ];
  }
  return [
    clamp(action.forward ?? 0, -1, 1),
    clamp(action.strafe ?? 0, -1, 1),
    clamp(action.turn ?? 0, -1, 1),
    clamp(action.sprint ?? 0, 0, 1),
  ];
}
