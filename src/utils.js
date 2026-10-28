import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent exponential approach. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Shortest signed angular difference, in (-PI, PI]. */
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * A single GLTFLoader shared by the whole game, wired with the Draco and
 * Meshopt decoders so that both the compressed city meshes and the
 * uncompressed character/vehicle models load through one code path.
 */
let sharedLoader = null;
export function getLoader() {
  if (sharedLoader) return sharedLoader;
  sharedLoader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/draco/');
  sharedLoader.setDRACOLoader(draco);
  sharedLoader.setMeshoptDecoder(MeshoptDecoder);
  return sharedLoader;
}

export function loadGLTF(url, onProgress) {
  return new Promise((resolve, reject) => {
    getLoader().load(
      url,
      resolve,
      (e) => onProgress && onProgress(e.loaded, e.total || 0),
      (err) => reject(new Error(`${url}: ${err?.message || err}`)),
    );
  });
}

export async function loadTexture(url, { srgb = true, repeat = null } = {}) {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  tex.anisotropy = 4;
  return tex;
}

/**
 * Uniform-grid spatial hash over the XZ plane. Used for building collision,
 * agent separation and nearest-target queries without allocating per frame.
 */
export class SpatialGrid {
  constructor(cellSize = 64) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }
  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  insert(x, z, item) {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const k = this.key(cx, cz);
    let bucket = this.cells.get(k);
    if (!bucket) { bucket = []; this.cells.set(k, bucket); }
    bucket.push(item);
  }
  /** All items in cells overlapping the circle (x, z, radius). */
  query(x, z, radius, out = []) {
    out.length = 0;
    const c = this.cellSize;
    const x0 = Math.floor((x - radius) / c), x1 = Math.floor((x + radius) / c);
    const z0 = Math.floor((z - radius) / c), z1 = Math.floor((z + radius) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const bucket = this.cells.get(this.key(cx, cz));
        if (bucket) for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
    return out;
  }
}

/** Enable shadows on every mesh under a subtree, keeping materials shared. */
export function enableShadows(root, { cast = true, receive = true } = {}) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = cast;
      o.receiveShadow = receive;
      o.frustumCulled = true;
    }
  });
}

/** Deep-dispose GPU resources for a subtree that is being removed for good. */
export function disposeSubtree(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        for (const key of Object.keys(m)) {
          const v = m[key];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    }
  });
}

/**
 * Compute a bounding box for a model and return it, used to normalise the
 * wildly different authored scales of the downloaded aircraft.
 */
export function measure(object3d) {
  const box = new THREE.Box3().setFromObject(object3d);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  return { box, size, center };
}

/** Format metres as a friendly altitude / distance string. */
export function fmtMeters(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
}
