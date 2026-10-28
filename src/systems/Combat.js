import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, rand, pick, angleDelta } from '../utils.js';

/**
 * Health, melee and ranged combat for the player, AI fighters and police.
 *
 * Design goals:
 *  - the player and every AI share one damage model, so the same numbers
 *    apply whether a punch comes from a policy or from a scripted thug;
 *  - hostility is a relationship, not a script: any agent can be told to
 *    attack any other entity, and the crowd logic decides who fights whom;
 *  - the whole thing is observable and drivable from the training bridge.
 *
 * A combatant is a small interface rather than a class hierarchy:
 *   { position, heading, health, maxHealth, dead, faction, rig }
 */

export const FACTIONS = {
  CIVILIAN: 'civilian',
  GANG: 'gang',
  POLICE: 'police',
  PLAYER: 'player',
};

/** Which factions treat which as enemies. Symmetric by construction. */
const HOSTILE = {
  civilian: new Set(['gang']),
  gang: new Set(['civilian', 'police', 'player']),
  police: new Set(['gang']),
  player: new Set(['gang']),
};

export function areHostile(a, b) {
  if (a === b) return false;
  return HOSTILE[a]?.has(b) || HOSTILE[b]?.has(a) || false;
}

/** A single damage event, kept so the HUD can show hit feedback. */
export class CombatSystem {
  constructor(game) {
    this.game = game;
    this.events = [];
    this.kills = 0;
    this.playerHitsTaken = 0;
    this.lastDamageAt = 0;
  }

  /**
   * Apply damage from `attacker` to `target`.
   *
   * Returns true if the hit landed. Friendly fire is allowed only between
   * entities that are not on the same faction, so police do not shoot each
   * other during a chase.
   */
  damage(target, amount, { attacker = null, kind = 'melee', force = 0, direction = null } = {}) {
    if (!target || target.dead) return false;
    if (attacker && attacker !== target && attacker.faction === target.faction) {
      if (attacker.faction !== FACTIONS.PLAYER) return false;
    }

    target.health = Math.max(0, (target.health ?? 100) - amount);
    target.lastHitAt = this.game.elapsed;

    this.events.push({
      t: this.game.elapsed, target: target.id ?? 'player', attacker: attacker?.id ?? 'player',
      amount, kind,
    });
    if (this.events.length > 64) this.events.shift();

    if (target === this.game.player) {
      this.playerHitsTaken++;
      this.game.hud.flashDamage();
      this.game.cameraShake = Math.max(this.game.cameraShake, clamp(amount / 40, 0.02, 0.22));
      this.game.audio.hit?.();
    } else if (target.rig) {
      target.rig.playOneShot('hit');
      target.rig.flash?.();
    }

    // Knockback.
    if (force > 0 && direction) {
      const kb = direction.clone().normalize().multiplyScalar(force);
      if (target.velocity) target.velocity.add(kb);
      else if (target.position) target.position.addScaledVector(kb, 0.02);
    }

    if (target.health <= 0) this._kill(target, attacker);
    return true;
  }

  _kill(target, attacker) {
    target.dead = true;
    target.deathAt = this.game.elapsed;
    if (target === this.game.player) {
      this.game.onPlayerDeath();
      return;
    }
    this.kills++;
    target.rig?.playDeath?.();
    if (attacker === this.game.player) {
      this.game.hud.toast('শত্রু পরাজিত');
      this.game.player.kills = (this.game.player.kills || 0) + 1;
      // Killing a gang member draws police attention to the player.
      this.game.police?.respond(target.position, 2);
    }
    // A fallen fighter is removed from the crowd shortly after.
    this.game.agents.scheduleRemoval(target, 12);
  }

  /** Heal a combatant (used by the police station and by respawn). */
  heal(target, amount) {
    if (!target || target.dead) return;
    target.health = Math.min(target.maxHealth ?? 100, (target.health ?? 100) + amount);
  }

  update(dt) {
    // Decay the event log so the HUD overlay does not grow without bound.
    const cutoff = this.game.elapsed - 5;
    while (this.events.length && this.events[0].t < cutoff) this.events.shift();
  }
}

/**
 * The player's own weapons and melee. Kept separate from the input layer so
 * an external policy can call the same methods (punch(), shoot()).
 */
export class PlayerCombat {
  constructor(game) {
    this.game = game;
    this.cooldown = 0;
    this.weapon = 'fists';
    this.ammo = { pistol: 48, rifle: 90 };
    this.stamina = 100;
  }

  get spec() {
    return CONFIG.combat.weapons[this.weapon] || CONFIG.combat.weapons.fists;
  }

  /** Cycle fists -> pistol -> rifle -> fists. */
  cycleWeapon() {
    const order = ['fists', 'pistol', 'rifle'];
    const i = order.indexOf(this.weapon);
    this.weapon = order[(i + 1) % order.length];
    this.game.hud.toast(`অস্ত্র: ${this.spec.label}`);
  }

  _aimDirection() {
    const p = this.game.player;
    if (p.thirdPerson) {
      // Third person: aim at whatever the camera is looking at, so a shot
      // goes where the crosshair points rather than along the body heading.
      const cam = this.game.camera;
      const dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      return dir;
    }
    const yaw = p.cameraYaw, pitch = p.cameraPitch;
    return new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );
  }

  _muzzle() {
    const p = this.game.player;
    return new THREE.Vector3(p.position.x, p.position.y + p.cfg.eyeHeight * 0.86, p.position.z);
  }

  attack() {
    if (this.cooldown > 0) return false;
    const spec = this.spec;
    this.cooldown = spec.cooldown;

    const origin = this._muzzle();
    const dir = this._aimDirection();
    const p = this.game.player;
    p.attackUntil = this.game.elapsed + spec.animTime;
    p.rig?.playOneShot(spec.clip);

    if (spec.kind === 'melee') {
      this.game.audio.melee?.();
      const target = this._nearestTargetInArc(origin, dir, spec.range, spec.arc);
      if (target) {
        this.game.combat.damage(target, spec.damage, {
          attacker: p, kind: 'melee', force: spec.force, direction: dir,
        });
        return true;
      }
      return false;
    }

    // Ranged: consume ammo and resolve a hitscan against the crowd and cars.
    if (this.ammo[this.weapon] <= 0) {
      this.game.hud.toast('গোলা শেষ');
      return false;
    }
    this.ammo[this.weapon]--;
    this.game.audio.gunshot?.(this.weapon);
    this.game.muzzleFlash?.(origin, dir);

    const hit = this._raycastTargets(origin, dir, spec.range);
    if (hit) {
      this.game.combat.damage(hit.entity, spec.damage, {
        attacker: p, kind: 'bullet', force: spec.force, direction: dir,
      });
      this.game.police?.notifyGunshot(origin);
      return true;
    }
    return false;
  }

  /** Pick the closest living enemy inside a cone in front of the player. */
  _nearestTargetInArc(origin, dir, range, arc) {
    let best = null, bestD = range;
    for (const a of this.game.agents.agents) {
      if (a.dead) continue;
      const dx = a.position.x - origin.x, dz = a.position.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      const dot = (dx / d) * dir.x + (dz / d) * dir.z;
      if (dot < Math.cos(arc)) continue;
      best = a; bestD = d;
    }
    return best;
  }

  /**
   * Hitscan against AI agents and vehicles. Vehicles absorb the shot, which
   * keeps bullets from passing through a car to hit someone behind it.
   */
  _raycastTargets(origin, dir, range) {
    const maxDist = range;
    let best = null, bestD = maxDist;
    const consider = (entity, radius) => {
      const dx = entity.position.x - origin.x;
      const dz = entity.position.z - origin.z;
      const dy = (entity.position.y + 1.0) - origin.y;
      const along = dx * dir.x + dz * dir.z + dy * dir.y;
      if (along <= 0 || along > bestD) return;
      const px = origin.x + dir.x * along, py = origin.y + dir.y * along, pz = origin.z + dir.z * along;
      const off = Math.hypot(entity.position.x - px, (entity.position.y + 1.0) - py, entity.position.z - pz);
      if (off <= radius) { best = entity; bestD = along; }
    };
    for (const a of this.game.agents.agents) if (!a.dead) consider(a, 0.55);
    for (const v of this.game.vehicles.active) consider(v, v.radius);
    return best ? { entity: best, distance: bestD } : null;
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.stamina < 100) this.stamina = Math.min(100, this.stamina + dt * 12);
  }
}

/**
 * The AI that decides who fights whom.
 *
 * Rather than scripting individual brawls, the city holds a hostility graph
 * plus a small set of "districts" with a temperature. When a district heats
 * up (the player fires, a gang member is killed nearby, a police alert goes
 * out) nearby gang agents flip to a combat state and path toward the nearest
 * enemy. Police spawn in response to heat and hunt the gangs.
 */
export class CombatDirector {
  constructor(game) {
    this.game = game;
    this.heat = new Map(); // district key -> 0..1
    this.alerts = [];
    this.timer = 0;
    this.autoFightChance = 0.55;
  }

  /**
   * Difficulty rises the further the player travels from the spawn point.
   *
   * Distance from spawn is the one quantity that measures "how far in" the
   * player has pushed, and unlike elapsed time it cannot be farmed by
   * standing still. It scales the size of gang squads, how quickly they
   * engage, how hard they hit, and how many police answer a crime.
   */
  get difficulty() {
    const p = this.game.player.position;
    const s = this.game.world.spawn;
    const km = Math.hypot(p.x - s.x, p.z - s.z) / 1000;
    return clamp(0.6 + km * 0.22, 0.6, 4);
  }

  /** How many gang members a fresh wave should contain. */
  get waveSize() {
    return Math.round(1 + this.difficulty * 1.6);
  }

  _key(pos) {
    return `${Math.round(pos.x / 400)}_${Math.round(pos.z / 400)}`;
  }

  addHeat(pos, amount) {
    const k = this._key(pos);
    this.heat.set(k, clamp((this.heat.get(k) || 0) + amount, 0, 1));
  }

  heatAt(pos) {
    return this.heat.get(this._key(pos)) || 0;
  }

  /**
   * Give the crowd something to do. Called a few times per second, not every
   * frame, because it is a search over all agents.
   */
  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;

    // Cool every district a little.
    for (const [k, v] of this.heat) {
      const nv = v - dt * 0.02;
      if (nv <= 0) this.heat.delete(k); else this.heat.set(k, nv);
    }

    const player = this.game.player;
    const playerHeat = this.heatAt(player.position);

    for (const a of this.game.agents.agents) {
      if (a.dead || a.vehicle) continue;
      a.combatCooldown = Math.max(0, (a.combatCooldown || 0) - 0.4);

      if (a.faction === FACTIONS.GANG) this._updateGang(a, player, playerHeat);
      else if (a.faction === FACTIONS.POLICE) this._updatePolice(a, player);
    }
  }

  _updateGang(gang, player, playerHeat) {
    // Already fighting: let the fighter logic continue.
    if (gang.combatTarget && !gang.combatTarget.dead) return;

    const distToPlayer = Math.hypot(
      gang.position.x - player.position.x, gang.position.z - player.position.z,
    );

    // Close to the player, or in a hot district: pick a fight. The further in
    // the player has pushed, the more willing the gang is to start one.
    const aggression = clamp(this.autoFightChance * this.difficulty * 0.7, 0.2, 0.95);
    const wantsPlayer = distToPlayer < 90 + this.difficulty * 20 && Math.random() < aggression;
    if (wantsPlayer) {
      this._engage(gang, player);
      return;
    }

    // Otherwise look for a nearby civilian or police officer to brawl with.
    if (Math.random() > 0.12) return;
    const target = this._nearestHostile(gang, 55 + this.difficulty * 15);
    if (target) this._engage(gang, target);
    void playerHeat;
  }

  _updatePolice(cop, player) {
    if (cop.combatTarget && !cop.combatTarget.dead) return;
    const target = this._nearestHostile(cop, 90);
    if (target) { this._engage(cop, target); return; }

    // With no gang nearby, police patrol toward the last reported crime.
    const alert = this.alerts[this.alerts.length - 1];
    if (alert && this.game.elapsed - alert.t < 30) {
      const d = Math.hypot(cop.position.x - alert.x, cop.position.z - alert.z);
      if (d > 12) cop.setGoal(alert.x + rand(-6, 6), alert.z + rand(-6, 6), { run: true });
    }
    void player;
  }

  _nearestHostile(from, range) {
    let best = null, bestD = range;
    for (const a of this.game.agents.agents) {
      if (a === from || a.dead) continue;
      if (!areHostile(from.faction, a.faction)) continue;
      const d = Math.hypot(a.position.x - from.position.x, a.position.z - from.position.z);
      if (d < bestD) { best = a; bestD = d; }
    }
    // The player is a valid target for gangs but not for police.
    const p = this.game.player;
    if (areHostile(from.faction, FACTIONS.PLAYER)) {
      const d = Math.hypot(p.position.x - from.position.x, p.position.z - from.position.z);
      if (d < bestD) best = p;
    }
    return best;
  }

  _engage(attacker, target) {
    attacker.combatTarget = target;
    attacker.state = 'fight';
    attacker.rig?.playOneShot('run');
    if (attacker.faction === FACTIONS.GANG) {
      this.game.hud.toast('একদল দুর্বৃত্ত তোমাকে আক্রমণ করছে!', 1800);
    }
  }

  /** Called when the player shoots: police come looking. */
  notifyGunshot(pos) {
    this.addHeat(pos, 0.35);
    this.alerts.push({ x: pos.x, z: pos.z, t: this.game.elapsed, kind: 'gunshot' });
    if (this.alerts.length > 12) this.alerts.shift();
    this.game.police?.respond(pos, 1);
  }

  notifyCrime(pos, severity = 1) {
    this.addHeat(pos, 0.25 * severity);
    this.alerts.push({ x: pos.x, z: pos.z, t: this.game.elapsed, kind: 'crime' });
    this.game.police?.respond(pos, severity);
  }
}
