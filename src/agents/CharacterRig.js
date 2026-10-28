import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadGLTF, damp, angleDelta, measure } from '../utils.js';

/**
 * A skinned, animated humanoid. Wraps one of the real downloaded characters
 * (Mixamo rigs from the three.js examples) and drives its clips with a
 * simple speed-based state machine.
 *
 * cloneCharacter() is the entry point for every instance after the first:
 * it uses SkeletonUtils.clone so the shared GPU buffers are reused while
 * each copy gets its own bone hierarchy.
 */
export class CharacterRig {
  constructor(gltf, { scale = 1, yOffset = 0 } = {}) {
    this.source = gltf;
    this.root = gltf.scene;
    this.root.scale.setScalar(scale);
    this.yOffset = yOffset;

    this.mixer = new THREE.AnimationMixer(this.root);
    this.clips = {};
    for (const clip of gltf.animations) {
      this.clips[clip.name.toLowerCase()] = this.mixer.clipAction(clip);
    }

    this.state = null;
    this.speed = 0;
    this.heading = 0;
    this.targetHeading = 0;
    this.yawOffset = Math.PI; // Mixamo characters face +Z; game forward is -Z.

    this._configureShadows();
    this._pickDefaultClips();
  }

  _configureShadows() {
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
  }

  /**
   * Resolve a logical clip name to whatever the model actually ships.
   *
   * The project mixes rigs from two families: KayKit characters use names
   * like "Walking_A" and "Unarmed_Melee_Attack_Punch_A", while the three.js
   * examples use "walk" and "run". Callers ask for the logical name and this
   * picks the best match, so no caller needs to know which family it has.
   */
  _resolve(name) {
    const wanted = String(name).toLowerCase();
    if (this.clips[wanted]) return wanted;
    const aliases = CLIP_ALIASES[wanted];
    if (aliases) {
      for (const a of aliases) {
        if (this.clips[a]) return a;
        const hit = Object.keys(this.clips).find((k) => k.includes(a));
        if (hit) return hit;
      }
    }
    return null;
  }

  _pickDefaultClips() {
    this.idleName = this._resolve('idle') || Object.keys(this.clips)[0];
    this.walkName = this._resolve('walk') || this.idleName;
    this.runName = this._resolve('run') || this.walkName;
    this.deathName = this._resolve('death');
    this.hitName = this._resolve('hit');
  }

  /** Deep clone for an additional instance of the same character. */
  clone() {
    const clonedScene = skeletonClone(this.source.scene);
    const rig = Object.create(CharacterRig.prototype);
    rig.source = this.source;
    rig.root = clonedScene;
    rig.root.scale.copy(this.root.scale);
    rig.yOffset = this.yOffset;
    rig.mixer = new THREE.AnimationMixer(rig.root);
    rig.clips = {};
    for (const clip of this.source.animations) {
      rig.clips[clip.name.toLowerCase()] = rig.mixer.clipAction(clip);
    }
    rig.state = null;
    rig.speed = 0;
    rig.heading = 0;
    rig.targetHeading = 0;
    rig.yawOffset = this.yawOffset;
    rig._configureShadows();
    rig._pickDefaultClips();
    return rig;
  }

  /**
   * Choose the animation that matches the current horizontal speed and
   * cross-fade into it. Called every frame from the owning entity.
   */
  setSpeed(speed, dt) {
    this.updateFlash(dt);
    // A dead rig holds its final pose; the mixer still advances so the death
    // clip finishes playing.
    if (this.dead) { this.mixer.update(dt); return; }
    this.speed = speed;
    let next = this.idleName;
    if (speed > 4.2) next = this.runName;
    else if (speed > 0.25) next = this.walkName;

    if (next !== this.state) {
      const prev = this.state ? this.clips[this.state] : null;
      const action = this.clips[next];
      if (action) {
        action.reset();
        action.enabled = true;
        action.setEffectiveTimeScale(1);
        action.setEffectiveWeight(1);
        if (prev) action.crossFadeFrom(prev, 0.22, false);
        action.play();
      }
      this.state = next;
    }

    // Playback rate follows the actual movement speed so feet do not skate.
    const action = this.clips[this.state];
    if (action) {
      const nominal = this.state === this.runName ? 4.6 : 1.4;
      action.setEffectiveTimeScale(this.state === this.idleName ? 1 : clamp(speed / nominal, 0.55, 1.9));
    }

    this.mixer.update(dt);
  }

  /** Play a one-off clip (punch, hit, death, ...) then return to locomotion. */
  playOneShot(name) {
    const key = this._resolve(name);
    if (!key) return false;
    const action = this.clips[key];
    if (!action) return false;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.setEffectiveWeight(1);
    const prev = this.state ? this.clips[this.state] : null;
    if (prev && prev !== action) action.crossFadeFrom(prev, 0.15, false);
    action.play();
    this.state = key;
    return true;
  }

  /** Collapse on death and hold the final pose. */
  playDeath() {
    if (!this.deathName) {
      this.root.rotation.z = Math.PI / 2;
      return;
    }
    this.playOneShot(this.deathName);
    this.dead = true;
  }

  /**
   * Brief red tint to show a hit landed. The tint is applied to the cloned
   * materials so it never leaks to other instances sharing the same GLB.
   */
  flash(color = 0xff2b2b, seconds = 0.18) {
    if (!this._flashMaterials) {
      this._flashMaterials = [];
      this.root.traverse((o) => {
        if (o.isMesh && o.material && o.material.emissive) {
          if (!o.material.__flashed) {
            o.material = o.material.clone();
            o.material.__flashed = true;
          }
          this._flashMaterials.push({ mat: o.material, base: o.material.emissive.clone() });
        }
      });
    }
    for (const f of this._flashMaterials) f.mat.emissive.setHex(color);
    this._flashUntil = seconds;
  }

  /** Return the emissive tint to normal once the flash has expired. */
  updateFlash(dt) {
    if (this._flashUntil === undefined) return;
    this._flashUntil -= dt;
    if (this._flashUntil <= 0 && this._flashMaterials) {
      for (const f of this._flashMaterials) f.mat.emissive.copy(f.base);
      this._flashUntil = undefined;
    }
  }

  get availableActions() {
    return Object.keys(this.clips);
  }

  /** Smoothly turn the mesh toward its movement heading. */
  faceHeading(targetYaw, dt, rate = 10) {
    const d = angleDelta(this.heading, targetYaw);
    this.heading += d * Math.min(1, dt * rate);
    this.root.rotation.y = this.heading + this.yawOffset;
  }

  set position(v) { this.root.position.copy(v); }
  get position() { return this.root.position; }

  update(dt) { this.mixer.update(dt); }
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

/**
 * Logical clip name -> candidate real clip names, best first.
 *
 * KayKit clip names are matched case-insensitively via the lowercased clip
 * map, so entries here are already lowercase. Prefix matching is used, so
 * "walk" also matches "walking_a".
 */
const CLIP_ALIASES = {
  idle: ['idle', 'unarmed_idle', 'standing', 'idle_b'],
  walk: ['walking_a', 'walking', 'walk'],
  run: ['running_a', 'running', 'run', 'jog'],
  death: ['death_a', 'death', 'death_b'],
  hit: ['hit_a', 'hit'],
  jump: ['jump_full_short', 'jump_start', 'jump'],
  punch: ['unarmed_melee_attack_punch_a', 'punch'],
  shoot: ['1h_ranged_shoot', '2h_ranged_shoot', 'shoot'],
  attack: ['unarmed_melee_attack_punch_a', '1h_melee_attack_chop', 'attack'],
  sit: ['sit_chair_idle', 'sitting'],
  wave: ['cheer', 'wave'],
  dance: ['cheer', 'dance'],
};

/**
 * Load a character GLB and normalise it to a real-world height.
 *
 * The downloaded models come at very different authored scales (the robot is
 * ~4.6 m tall, Xbot is ~0.02 m), so each is measured and rescaled so every
 * agent stands the same, believable height in the city.
 */
export async function loadCharacter(url, { targetHeight = 1.75, yawOffset = Math.PI } = {}) {
  const gltf = await loadGLTF(url);
  const rig = new CharacterRig(gltf, { scale: 1, yOffset: 0 });
  rig.yawOffset = yawOffset;

  const { size } = measure(rig.root);
  if (size.y > 1e-4) {
    const s = targetHeight / size.y;
    rig.root.scale.setScalar(s);
  }
  return rig;
}
