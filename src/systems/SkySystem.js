import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { CONFIG } from '../config.js';
import { damp } from '../utils.js';

/**
 * Sky, sun and image-based lighting.
 *
 * Three real CC0 HDRI panoramas (Poly Haven) provide the environment map,
 * and a single directional light tracks a hand-authored sun path so that
 * shadows, sky colour and the time of day all agree. PMREM turns each HDRI
 * into a pre-filtered radiance map once, at load.
 */
export class SkySystem {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();

    this.environments = {};
    this.currentKey = 'day';
    this.timeOfDay = 0.42; // 0..1 across the day, 0.5 = noon
    this.autoTime = false;
    this.dayLength = 240; // seconds for a full cycle when autoTime is on

    // Sun / moon key light.
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
    this.sun.castShadow = CONFIG.render.shadows;
    const range = CONFIG.render.shadowRange;
    this.sun.shadow.camera.left = -range;
    this.sun.shadow.camera.right = range;
    this.sun.shadow.camera.top = range;
    this.sun.shadow.camera.bottom = -range;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = range * 4;
    this.sun.shadow.mapSize.set(CONFIG.render.shadowMapSize, CONFIG.render.shadowMapSize);
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // A soft fill so shaded building faces are not pitch black at night.
    this.hemi = new THREE.HemisphereLight(0x9fc4ff, 0x3a3226, 0.55);
    scene.add(this.hemi);

    this._targetIntensity = 2.4;
    this.outdoor = true;
  }

  /** Turn the outdoor sky and sun on or off (used when entering a building). */
  setOutdoor(on) {
    this.outdoor = on;
    this.sun.visible = on;
    this.hemi.visible = on;
    if (on) {
      this.scene.background = this.environments[this.currentKey]?.texture || null;
      this.scene.environment = this.environments[this.currentKey]?.envMap || null;
    } else {
      this.scene.background = new THREE.Color(0x0b0a09);
      this.scene.environment = null;
    }
  }

  async load(onProgress) {
    const loader = new RGBELoader();
    loader.setDataType(THREE.HalfFloatType);
    const entries = Object.entries(CONFIG.sky.hdri);
    for (let i = 0; i < entries.length; i++) {
      const [key, url] = entries[i];
      onProgress?.(i / entries.length, `sky: ${key}`);
      const tex = await loader.loadAsync(url);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const envRT = this.pmrem.fromEquirectangular(tex);
      this.environments[key] = { texture: tex, envMap: envRT.texture };
    }
    onProgress?.(1, 'sky ready');
    this.setEnvironment('day');
    return this;
  }

  setEnvironment(key) {
    const entry = this.environments[key];
    if (!entry) return;
    this.currentKey = key;
    if (!this.outdoor) return;
    this.scene.environment = entry.envMap;
    this.scene.environmentIntensity = 1.0;
    this.scene.background = entry.texture;
    this.scene.backgroundIntensity = key === 'night' ? 0.55 : 0.9;
    this.scene.backgroundBlurriness = 0;
  }

  /** Pick the environment that matches the current sun elevation. */
  _environmentForTime() {
    if (this.timeOfDay < 0.16 || this.timeOfDay > 0.86) return 'night';
    if (this.timeOfDay < 0.24 || this.timeOfDay > 0.78) return 'sunset';
    return 'day';
  }

  setTimeOfDay(t) {
    this.timeOfDay = ((t % 1) + 1) % 1;
    const key = this._environmentForTime();
    if (key !== this.currentKey) this.setEnvironment(key);
    this._updateSun();
  }

  cycleTime(delta) { this.setTimeOfDay(this.timeOfDay + delta); }

  /** Sun elevation from the time of day; drives colour and intensity. */
  _updateSun() {
    const angle = (this.timeOfDay - 0.25) * Math.PI * 2;
    const elevation = Math.sin(angle);
    const azimuth = this.timeOfDay * Math.PI * 2;

    const dir = new THREE.Vector3(
      Math.cos(azimuth) * Math.cos(angle),
      Math.max(elevation, -0.3),
      Math.sin(azimuth) * Math.cos(angle),
    ).normalize();

    this.sunDirection = dir;
    const night = this.currentKey === 'night';
    const dusk = this.currentKey === 'sunset';

    // Warm the light as the sun sinks, cool it at night.
    const color = new THREE.Color();
    if (night) color.setHex(0x8fa8d8);
    else if (dusk) color.setHex(0xffa863);
    else color.setHex(0xfff4e2);
    this.sun.color.lerp(color, 0.5);

    this._targetIntensity = night ? 0.35 : dusk ? 1.5 : 2.5;
    this.sun.intensity = damp(this.sun.intensity, this._targetIntensity, 3, 1 / 60);
    this.hemi.intensity = night ? 0.22 : dusk ? 0.42 : 0.55;
  }

  /** Move the shadow camera to follow the viewer so shadows stay crisp. */
  followTarget(position) {
    if (!this.sunDirection) return;
    const d = this.sunDirection.clone().multiplyScalar(CONFIG.render.shadowRange * 1.6);
    this.sun.position.copy(position).add(d);
    this.sun.target.position.copy(position);
    this.sun.target.updateMatrixWorld();
  }

  update(dt) {
    if (this.autoTime) this.timeOfDay = (this.timeOfDay + dt / this.dayLength) % 1;
    this.setTimeOfDay(this.timeOfDay);
  }

  get clockLabel() {
    const totalMinutes = this.timeOfDay * 24 * 60;
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = Math.floor(totalMinutes % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
