import * as THREE from 'three';
import { CONFIG, MODES } from './config.js';
import { Input } from './input.js';
import { World } from './world/World.js';
import { InteriorSystem } from './world/Interior.js';
import { PlayerController } from './player/PlayerController.js';
import { VehicleManager } from './vehicles/Vehicle.js';
import { AgentManager } from './agents/AgentManager.js';
import { loadCharacter } from './agents/CharacterRig.js';
import { SkySystem } from './systems/SkySystem.js';
import { AudioSystem } from './systems/AudioSystem.js';
import { HUD } from './systems/HUD.js';
import { CameraRig } from './systems/CameraRig.js';
import { TrainingBridge } from './systems/TrainingBridge.js';
import { CombatSystem, PlayerCombat, CombatDirector } from './systems/Combat.js';
import { PoliceSystem } from './systems/Police.js';
import { QualityManager } from './systems/Quality.js';
import { TouchControls } from './systems/TouchControls.js';
import { clamp, rand, pick } from './utils.js';

/**
 * HyperCity 3D.
 *
 * An open, real-asset 3D city that a person can play and that external AI
 * agents can be trained inside. Every model in the scene was downloaded from
 * a credited source - nothing is hand-modelled - and the whole simulation is
 * scriptable through the TrainingBridge.
 */
class Game {
  constructor() {
    this.frozen = false;
    this.mode = MODES.WALK;
    this.clock = new THREE.Clock();
    this.fpsSamples = [];
    this.spawnedVehicles = [];
    this.currentVehicle = null;
    this.externalControl = null;
    this.crowdTimer = 0;
    this.elapsed = 0;
    this.cameraShake = 0;
    this.crowdTarget = CONFIG.agents.maxAmbient;
    this.gangTimer = 0;
  }

  async init(onProgress) {
    // ---- renderer --------------------------------------------------------
    this.renderer = new THREE.WebGLRenderer({
      canvas: document.getElementById('app'),
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.render.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = CONFIG.render.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      62, window.innerWidth / window.innerHeight, CONFIG.render.near, CONFIG.render.far,
    );
    this.scene.fog = new THREE.Fog(0xbfd3ea, CONFIG.render.fogNear, CONFIG.render.fogFar);

    this.cameraRig = new CameraRig(this.camera);

    // ---- systems ---------------------------------------------------------
    this.audio = new AudioSystem();
    this.sky = new SkySystem(this.scene, this.renderer);

    onProgress?.(0.02, 'আকাশ (Poly Haven HDRI)');
    await this.sky.load((p, label) => onProgress?.(0.02 + p * 0.1, label));

    this.world = new World(this.scene);
    await this.world.load((p, label) => onProgress?.(0.12 + p * 0.5, label));

    this.hud = new HUD(this.world);

    onProgress?.(0.62, 'ঘরের ভিতরের আসবাব (Poly Haven)');
    this.interiors = new InteriorSystem(this.scene, this.world);
    await this.interiors.load((p, label) => onProgress?.(0.62 + p * 0.08, label));

    onProgress?.(0.7, 'যানবাহন (গাড়ি, বিমান, হেলিকপ্টার)');
    this.vehicles = new VehicleManager(this.scene, this.world);
    // Preload one instance of each type so spawning is instant later.
    await this.vehicles.preload(['car', 'truck', 'plane', 'helicopter', 'jet', 'drone']);

    this.agents = new AgentManager(this.scene, this.world, (archetype) => this._makeRig(archetype));
    this.characterCache = new Map();

    onProgress?.(0.8, 'চরিত্র ও অ্যানিমেশন');
    await this._preloadCharacters();

    onProgress?.(0.9, 'প্লেয়ার ও যুদ্ধ সিস্টেম');
    const playerRig = this.characterCache.get('knight').clone();
    this.player = new PlayerController(this.world, playerRig);
    this.scene.add(playerRig.root);
    this.cameraRig.snapTo(this.player, { firstPerson: false, mode: MODES.WALK });

    // Combat, police and the crowd's own agenda.
    this.combat = new CombatSystem(this);
    this.playerCombat = new PlayerCombat(this);
    this.combatDirector = new CombatDirector(this);
    this.police = new PoliceSystem(this);
    this.world.agents = this.agents;
    this.agents.game = this;
    this.agents.attachGame(this);

    // Automatic quality scaling keeps a laptop smooth and still runs on a phone.
    this.quality = new QualityManager(this);
    this.quality.index = this.quality.detectInitialTier();

    this.bridge = new TrainingBridge(this, { port: 12001 });

    this._bindInput();
    this._bindResize();

    onProgress?.(1, 'প্রস্তুত');
    return this;
  }

  async _preloadCharacters() {
    const rigs = CONFIG.agents.rigs;
    const entries = Object.entries(CONFIG.agents.models);
    for (const [archetype, url] of entries) {
      const rc = rigs[archetype] || { targetHeight: 1.75, yawOffset: Math.PI };
      const rig = await loadCharacter(url, rc);
      this.characterCache.set(archetype, rig);
    }
  }

  async _makeRig(archetype) {
    let base = this.characterCache.get(archetype);
    if (!base) {
      const rc = CONFIG.agents.rigs[archetype] || { targetHeight: 1.75, yawOffset: Math.PI };
      base = await loadCharacter(CONFIG.agents.models[archetype], rc);
      this.characterCache.set(archetype, base);
    }
    return base.clone();
  }

  // ------------------------------------------------------------- interface

  _bindInput() {
    this.input = new Input(this.renderer.domElement);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('click', () => {
      if (this.started && !this.touchEnabled) this.input.requestLock();
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.started) return;
      if (e.button === 0) this.input.setVirtual('Mouse0', true);
      if (e.button === 2) this.playerCombat?.cycleWeapon();
    });
    canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.input.setVirtual('Mouse0', false);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.input.on('unlock', () => {});
    this.input.on('interact', () => this._interact());
    this.input.on('camera', () => this._toggleCamera());
    this.input.on('time', () => this._cycleTime());
    this.input.on('agent', () => this._spawnAgentNearby());
    this.input.on('help', () => this.hud.toggleHelp());
    this.input.on('reset', () => this._resetPlayer());
    this.input.on('clearcars', () => { this.vehicles.clear(); this.spawnedVehicles.length = 0; this.hud.toast('সব যানবাহন মুছে ফেলা হলো'); });
    this.input.on('spawn', (type) => this._spawnVehicle(type));
    this.input.on('weapon', () => this.playerCombat.cycleWeapon());

    // Touch controls drive the same Input state, so the game itself does not
    // need to know whether a keyboard or a thumb is in charge.
    this.touchEnabled = TouchControls.isTouchDevice();
    this.touch = new TouchControls(this.input, {
      interact: () => this._interact(),
      camera: () => this._toggleCamera(),
      weapon: () => this.playerCombat.cycleWeapon(),
      vehicle: () => this._spawnVehicle('car'),
    });
    this.input.touch = this.touch;
    if (this.touchEnabled) {
      document.getElementById('touch-note')?.classList.remove('hidden');
    }

    document.getElementById('respawn-btn')?.addEventListener('click', () => this.respawn());
  }

  _bindResize() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  start() {
    this.started = true;
    document.getElementById('start').classList.add('hidden');
    this.hud.show();
    this.audio.start();
    if (!this.touchEnabled) this.input.requestLock();
    else this.touch.enable();
    this.quality.apply(this.quality.tiers[this.quality.index]);
    this.hud.toast('স্বাগতম! E চাপো গাড়িতে উঠতে বা ঘরে ঢুকতে · ক্লিকে ঘুষি', 3200);
    this.clock.start();
    this._loop();
  }

  // ------------------------------------------------------------- actions

  _toggleCamera() {
    if (this.mode === MODES.WALK) this.player.thirdPerson = !this.player.thirdPerson;
    else this.firstPerson = !this.firstPerson;
    const ent = this._cameraEntity();
    this.cameraRig.snapTo(ent, { firstPerson: this._isFirstPerson(), mode: this.mode });
  }

  _isFirstPerson() {
    return this.mode === MODES.WALK ? !this.player.thirdPerson : !!this.firstPerson;
  }

  _cameraEntity() {
    return this.mode === MODES.WALK ? this.player : this.currentVehicle;
  }

  _cycleTime() {
    this.sky.autoTime = !this.sky.autoTime;
    this.hud.toast(this.sky.autoTime ? 'সময় স্বয়ংক্রিয়ভাবে চলছে' : 'সময় থেমে আছে');
  }

  /**
   * Context-sensitive E: step out of a building, leave a vehicle, enter a
   * vehicle, or walk into the nearest building's doorway.
   */
  _interact() {
    if (this.player.indoors) { this._exitInterior(); return; }
    if (this.mode !== MODES.WALK) { this._exitVehicle(); return; }

    const v = this.vehicles.nearest(this.player.position, 14);
    if (v) { this._enterVehicle(v); return; }

    const b = this.world.buildingAt(this.player.position.x, this.player.position.z, CONFIG.interior.promptRange);
    if (b) { this._enterInterior(b); return; }

    this.hud.toast('কাছে কোনো যানবাহন বা দরজা নেই — ১-৬ চেপে গাড়ি স্পন করো');
  }

  _enterInterior(building) {
    const entry = this.interiors.enter(building);
    if (!entry) { this.hud.toast('এই ঘরে ঢোকা যাচ্ছে না'); return; }
    this.player.enterInterior(entry, this.interiors, this.interiors.origin);
    // Hide the street world and the outdoor lights so the interior is lit
    // only by its own lamps.
    this.world.group.visible = false;
    this.agents.group.visible = false;
    this.sky.setOutdoor(false);
    this.hud.setMode('ঘরের ভিতরে');
    this.hud.toast('ঘরের ভিতরে — E চাপো বের হতে');
    this.cameraRig.snapTo(this.player, { firstPerson: false, mode: MODES.WALK });
  }

  _exitInterior() {
    const building = this.world.buildings.find((b) => b.id === this.interiors.active?.id);
    this.interiors.exit();
    this.world.group.visible = true;
    this.agents.group.visible = true;
    this.sky.setOutdoor(true);

    // Step back out onto the street in front of the doorway.
    const o = this.player.interiorOrigin;
    let x = this.player.position.x, z = this.player.position.z;
    if (building) {
      const local = this.player.interior ? this.player.interior.exitPos : null;
      if (local && o) { x = o.x + local.x; z = o.z + local.z; }
      else { x = (building.minX + building.maxX) / 2; z = (building.minZ + building.maxZ) / 2; }
      const b = this.world.clampToBounds(x, z);
      x = b.x; z = b.z;
    }
    this.player.exitInterior(x, z, this.player.cameraYaw);
    this.hud.setMode('পায়ে হাঁটা');
    this.hud.toast('বাইরে ফিরে এলে');
    this.cameraRig.snapTo(this.player, { firstPerson: false, mode: MODES.WALK });
  }

  _enterVehicle(v) {
    this.currentVehicle = v;
    v.driven = true;
    this.mode = ['helicopter', 'drone', 'plane', 'jet', 'floatplane'].includes(v.type) ? MODES.FLY : MODES.DRIVE;
    this.firstPerson = false;
    this.player.rig.root.visible = false;
    this.hud.setMode(`${v.cfg.label} চালাচ্ছো`);
    this.hud.toast(`${v.cfg.label} চালু — E চাপো নামতে`);
    this.cameraRig.snapTo(v, { firstPerson: false, mode: this.mode });
  }

  _exitVehicle() {
    const v = this.currentVehicle;
    if (!v) return;
    const side = new THREE.Vector3(Math.cos(v.heading), 0, -Math.sin(v.heading)).multiplyScalar(3);
    this.player.position.set(v.position.x + side.x, 0, v.position.z + side.z);
    const b = this.world.clampToBounds(this.player.position.x, this.player.position.z);
    this.player.position.x = b.x; this.player.position.z = b.z;
    this.player.velocity.set(0, 0, 0);
    this.player.rig.root.visible = true;
    v.driven = false;
    this.currentVehicle = null;
    this.mode = MODES.WALK;
    this.hud.setMode('পায়ে হাঁটা');
    this.hud.hideSpeed();
    this.hud.hideAltitude();
    this.cameraRig.snapTo(this.player, { firstPerson: this.player.thirdPerson ? false : true, mode: MODES.WALK });
    this.hud.toast('নেমে গেলে');
  }

  _spawnVehicle(type) {
    const cfg = CONFIG.vehicles[type];
    if (!cfg) return;
    let x, z, yaw;
    if (this.mode === MODES.WALK) {
      x = this.player.position.x; z = this.player.position.z;
      yaw = this.player.cameraYaw + Math.PI;
    } else {
      x = this.currentVehicle.position.x; z = this.currentVehicle.position.z;
      yaw = this.currentVehicle.heading;
    }
    // Drop it a few metres ahead and off to the side so it does not overlap.
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    x += fwd.x * 9 + right.x * 4;
    z += fwd.z * 9 + right.z * 4;
    const b = this.world.clampToBounds(x, z);
    x = b.x; z = b.z;

    this.vehicles.spawn(type, { x, z, yaw, y: 0 }).then((v) => {
      this.spawnedVehicles.push(v);
      this.hud.toast(`${cfg.label} স্পন হলো — কাছে গিয়ে E চাপো`);
    });
  }

  _spawnAgentNearby() {
    const angle = rand(0, Math.PI * 2);
    const dist = rand(8, 20);
    const x = this.player.position.x + Math.cos(angle) * dist;
    const z = this.player.position.z + Math.sin(angle) * dist;
    this.spawnAgent(pick(CONFIG.agents.archetypes), x, z, 0);
    this.hud.toast('এআই এজেন্ট যোগ হলো');
  }

  _resetPlayer() {
    const s = this.world.spawn;
    if (this.mode !== MODES.WALK) this._exitVehicle();
    this.player.position.set(s.x, 0, s.z);
    this.player.velocity.set(0, 0, 0);
    this.cameraRig.snapTo(this.player, { firstPerson: false, mode: MODES.WALK });
    this.hud.toast('শুরুর জায়গায় ফিরে গেলে');
  }

  // ---------------------------------------------------------- public API

  /** Used by the training bridge and the console. Resolves to the agent id. */
  spawnAgent(archetype, x, z, yaw = 0, opts = {}) {
    return this.agents.create(archetype, x, z, yaw, opts);
  }

  spawnVehicle(type, x, z, yaw = 0, y = 0) {
    return this.vehicles.spawn(type, { x, z, yaw, y });
  }

  teleport(x, z, y = 0, yaw) {
    if (this.mode !== MODES.WALK) this._exitVehicle();
    if (this.player.indoors) this._exitInterior();
    this.player.position.set(x, y, z);
    this.player.velocity.set(0, 0, 0);
    if (yaw !== undefined) this.player.cameraYaw = yaw;
    this.cameraRig.snapTo(this.player, { firstPerson: false, mode: MODES.WALK });
  }

  setExternalControl(mode, input) {
    this.externalControl = mode ? { mode, input } : null;
  }

  /** A short-lived tracer + light at the muzzle, for ranged fire. */
  muzzleFlash(origin, dir) {
    if (!this._flashPool) {
      this._flashPool = [];
      for (let i = 0; i < 4; i++) {
        const light = new THREE.PointLight(0xffd9a0, 0, 22, 2);
        this.scene.add(light);
        this._flashPool.push({ light, until: 0 });
      }
    }
    const slot = this._flashPool.find((f) => f.until <= this.elapsed) || this._flashPool[0];
    slot.light.position.copy(origin).addScaledVector(dir, 1.2);
    slot.light.intensity = 26;
    slot.until = this.elapsed + 0.05;
  }

  _updateFlashes() {
    if (!this._flashPool) return;
    for (const f of this._flashPool) {
      if (f.until > 0 && this.elapsed >= f.until) { f.light.intensity = 0; f.until = 0; }
    }
  }

  onPlayerDeath() {
    this.hud.showDeath();
    this.hud.setMode('অচেতন');
    if (this.mode !== MODES.WALK) this._exitVehicle();
    this.player.velocity.set(0, 0, 0);
  }

  /** Put the player back on their feet at the spawn point with full health. */
  respawn() {
    this.hud.hideDeath();
    if (this.player.indoors) this._exitInterior();
    const s = this.world.spawn;
    this.player.dead = false;
    this.player.health = this.player.maxHealth;
    this.player.position.set(s.x, 0, s.z);
    this.player.velocity.set(0, 0, 0);
    this.player.rig.root.visible = true;
    this.player.rig.dead = false;
    this.player.rig.root.rotation.set(0, 0, 0);
    this.mode = MODES.WALK;
    this.hud.setMode('পায়ে হাঁটা');
    this.cameraRig.snapTo(this.player, { firstPerson: false, mode: MODES.WALK });
    this.hud.toast('আবার যুদ্ধে ফিরে এলে', 2000);
  }

  seedRandom(seed) {
    // Small deterministic PRNG so episodes can be reproduced.
    let s = seed >>> 0 || 1;
    Math.random = () => {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return ((s >>> 0) % 100000) / 100000;
    };
  }

  stats() {
    return {
      fps: this._fps || 0,
      mode: this.mode,
      time: { value: this.sky.timeOfDay, label: this.sky.clockLabel, env: this.sky.currentKey },
      player: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z },
      vehicles: this.vehicles.active.length,
      agents: this.agents.count,
      buildings: this.world.buildings.length,
      roads: this.world.roadSegments.length,
      trees: this.world.trees,
      extent: this.world.layout.meta.extent,
      frozen: this.frozen,
    };
  }

  // ---------------------------------------------------------------- loop

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (!this.frozen) this._update(dt);
    this._render(dt);
  }

  _update(dt) {
    const mode = this.mode;
    this.elapsed += dt;

    // ---- input -> intent -------------------------------------------------
    const axes = this.input.axes();
    const look = this.input.consumeLook();
    const padLook = this.input.lookAxes();
    if (this.mode === MODES.WALK) {
      this.player.look(look.dx + padLook.x * 0.035, look.dy + padLook.y * 0.035);
      this.player.setIntent({
        x: axes.x, z: axes.z,
        run: this.input.sprint(),
        jump: this.input.jump(),
        yaw: null,
      });
    } else if (this.currentVehicle) {
      // Flight uses the mouse as a rate control: the craft keeps tilting
      // while the mouse is moving, and self-levels when it is not.
      const v = this.currentVehicle;
      v.lookYaw = clamp((v.lookYaw || 0) * 0.82 + look.dx * 2.4, -1, 1);
      v.lookPitch = clamp((v.lookPitch || 0) * 0.82 + look.dy * 2.4, -1, 1);
    }

    // ---- combat input ----------------------------------------------------
    this.playerCombat.update(dt);
    if (this.input.attacking() && !this.player.dead) {
      const hit = this.playerCombat.attack();
      if (hit) this.cameraShake = Math.max(this.cameraShake, 0.03);
    }
    this.combat.update(dt);

    // ---- vehicle input ---------------------------------------------------
    if (this.currentVehicle) {
      const v = this.currentVehicle;
      if (this.mode === MODES.DRIVE) {
        v.vehicleInput = {
          throttle: this.input.throttle(),
          brake: this.input.brake(),
          steer: this.input.steer(),
        };
      } else if (v.vtol) {
        // Helicopter/drone: W climbs, S descends, mouse tilts the rotor disc,
        // A/D yaw the nose.
        v.vehicleInput = {
          collective: this.input.collective(),
          pitch: v.lookPitch,
          roll: v.lookYaw * 0.6,
          yaw: this.input.steer(),
        };
      } else {
        // Plane/jet: W/S set throttle, mouse pitches and rolls the craft,
        // A/D add rudder.
        v.vehicleInput = {
          throttle: this.input.throttle() - this.input.brake(),
          pitch: v.lookPitch,
          roll: v.lookYaw * 1.2,
          yaw: this.input.steer(),
        };
      }
    }

    // ---- step the world --------------------------------------------------
    const playerSpeed = this.mode === MODES.WALK ? this.player.update(dt) : 0;
    // Walking back out through the doorway ends the interior visit, so the
    // street world can be restored without pressing E.
    if (this.player.indoors && this.mode === MODES.WALK) {
      const o = this.player.interiorOrigin;
      if (this.interiors.hasSteppedOut(this.player.position.x - o.x, this.player.position.z - o.z)) {
        this._exitInterior();
      }
    }
    this.vehicles.update(dt, { vehicle: this.currentVehicle, vehicleInput: this.currentVehicle?.vehicleInput || {} });
    this.agents.update(dt);
    this.combatDirector.update(dt);
    this.police.update(dt);

    // Ambient crowd around the player, plus a sprinkling of gangs so the
    // street has someone to fight with.
    this.crowdTimer -= dt;
    if (this.crowdTimer <= 0) {
      this.crowdTimer = 0.5;
      this.agents.maintainCrowd(this.player.position, this.crowdTarget);
      if (this.agents.count > CONFIG.agents.maxAmbient) this.agents.cull(this.player.position, 900);
    }
    this.gangTimer -= dt;
    if (this.gangTimer <= 0 && !this.player.indoors) {
      this.gangTimer = 4;
      this._maintainGangs();
    }

    // ---- city streaming --------------------------------------------------
    // Only the chunks near the camera are drawn; this is what keeps the
    // five-million-triangle city interactive.
    this.world.updateChunks(this.camera.position);

    // ---- camera ----------------------------------------------------------
    const entity = this._cameraEntity();
    if (entity) {
      this.cameraRig.update(entity, {
        firstPerson: this._isFirstPerson(),
        mode: this.mode,
        dt,
      });
      if (this.cameraShake > 0) {
        this.cameraShake = Math.max(0, this.cameraShake - dt * 0.6);
        this.camera.position.x += rand(-1, 1) * this.cameraShake;
        this.camera.position.y += rand(-1, 1) * this.cameraShake;
        this.camera.position.z += rand(-1, 1) * this.cameraShake;
      }
    }

    this._updateFlashes();

    // ---- sky / lighting --------------------------------------------------
    this.sky.update(dt);
    const camPos = this.camera.position;
    if (this.sky.outdoor) this.sky.followTarget(new THREE.Vector3(camPos.x, 0, camPos.z));

    // ---- audio -----------------------------------------------------------
    const vehicle = this.currentVehicle;
    this.audio.update({
      mode: this.mode,
      speed: vehicle ? vehicle.speed : playerSpeed,
      maxSpeed: vehicle ? vehicle.cfg.maxSpeed : 10,
      altitude: vehicle ? vehicle.position.y : 0,
      grounded: this.mode === MODES.WALK ? this.player.grounded : vehicle?.position.y < 1,
      moving: playerSpeed > 0.5,
    });

    // ---- HUD -------------------------------------------------------------
    this._updateHud(dt, playerSpeed);
  }

  /**
   * Keep a band of gangs near the player so the street always has someone to
   * fight, sized by the progressive difficulty (deeper in the city = bigger
   * and more frequent waves).
   */
  _maintainGangs() {
    const want = 10 + this.combatDirector.waveSize * 3;
    if (this.agents.factions.gang >= want) return;
    const wave = this.combatDirector.waveSize;
    const baseAngle = rand(0, Math.PI * 2);
    const dist = rand(90, 200);
    for (let i = 0; i < wave; i++) {
      const angle = baseAngle + rand(-0.6, 0.6);
      const x = this.player.position.x + Math.cos(angle) * dist;
      const z = this.player.position.z + Math.sin(angle) * dist;
      const road = this.world.nearestRoad(x, z, 60);
      if (!road) continue;
      const t = Math.random();
      const px = road.ax + (road.bx - road.ax) * t;
      const pz = road.az + (road.bz - road.az) * t;
      this.agents.create(pick(CONFIG.agents.gangArchetypes), px, pz, rand(0, 6.28), {
        controlMode: 'auto', faction: 'gang',
      });
    }
  }

  _updateHud(dt, playerSpeed) {
    const hud = this.hud;
    hud.setClock(this.sky.clockLabel);
    hud.setAgentCount(this.agents.count);
    hud.setHealth(this.player.health, this.player.maxHealth);
    hud.setFactionCounts(this.agents.factions, this.combatDirector.difficulty);
    const w = this.playerCombat.spec;
    hud.setWeapon(w.label, w.kind === 'melee' ? null : this.playerCombat.ammo[this.playerCombat.weapon]);

    if (this.player.indoors) {
      hud.hideSpeed();
      hud.hideAltitude();
      hud.showPrompt('<kbd>E</kbd> বাইরে বের হও');
    } else if (this.mode === MODES.WALK) {
      hud.hideSpeed();
      hud.hideAltitude();
      const near = this.vehicles.nearest(this.player.position, 14);
      if (near) hud.showPrompt(`<kbd>E</kbd> ${near.cfg.label} চালাও`);
      else if (this.world.buildingAt(this.player.position.x, this.player.position.z, CONFIG.interior.promptRange)) {
        hud.showPrompt('<kbd>E</kbd> ঘরের ভিতরে ঢোকো');
      } else hud.hidePrompt();
    } else if (this.mode === MODES.DRIVE) {
      hud.hideAltitude();
      hud.setSpeed(this.currentVehicle.speed * 3.6, this.currentVehicle.cfg.maxSpeed * 3.6);
      hud.showPrompt('<kbd>E</kbd> নামো · <kbd>F</kbd> ক্যামেরা');
    } else {
      hud.setSpeed(this.currentVehicle.speed * 3.6, this.currentVehicle.cfg.maxSpeed * 3.6);
      hud.setAltitude(this.currentVehicle.position.y);
      hud.showPrompt('<kbd>E</kbd> নামো · <kbd>F</kbd> ক্যামেরা');
    }

    hud.drawMinimap({
      x: this.player.position.x,
      z: this.player.position.z,
      heading: this.mode === MODES.WALK ? this.player.cameraYaw : this.currentVehicle.heading,
      vehicles: this.vehicles.active,
      agents: this.agents.agents,
    });
  }

  _render(dt) {
    this.renderer.render(this.scene, this.camera);

    // FPS, averaged over ~0.5 s.
    this.fpsSamples.push(dt);
    if (this.fpsSamples.length > 30) this.fpsSamples.shift();
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this._fps = 1 / avg;
    this.hud.setFps(this._fps);

    // Feed the frame time to the quality manager so it can adjust the tier.
    this.quality.update(dt * 1000);
  }
}

// ------------------------------------------------------------------ bootstrap

async function boot() {
  const barFill = document.getElementById('bar-fill');
  const status = document.getElementById('load-status');
  const setProgress = (p, label) => {
    barFill.style.width = `${clamp(p * 100, 0, 100)}%`;
    if (label) status.textContent = label;
  };

  const game = new Game();
  window.game = game;

  try {
    await game.init(setProgress);
  } catch (err) {
    console.error(err);
    status.innerHTML = `লোড করতে সমস্যা: ${err.message}`;
    return;
  }

  const startEl = document.getElementById('start');
  startEl.classList.remove('hidden');
  document.getElementById('loader').classList.add('hidden');
  document.getElementById('start-btn').addEventListener('click', () => game.start());
}

boot();
