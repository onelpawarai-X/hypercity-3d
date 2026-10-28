import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadGLTF } from '../utils.js';

/**
 * A large city GLB split into spatial chunks for rendering.
 *
 * The downloaded city meshes are authored as hundreds of separate draw calls
 * (882 building meshes, 765 road meshes). Rendering all of them every frame
 * is far too slow, so each source mesh is bucketed by world position into a
 * coarse grid, meshes that share a bucket and a material are merged into one
 * geometry, and only the chunks near the camera are drawn.
 *
 * Merging is safe here because every source mesh already carries its own
 * transform and the merged geometry has that transform baked in. Materials
 * are never merged, so each bucket ends up with at most one mesh per source
 * material.
 */
export class ChunkedCity {
  /**
   * @param {THREE.Group} parent   group the chunk meshes are added to
   * @param {object} opts
   * @param {number} opts.chunkSize   spatial bucket size in metres
   * @param {number} opts.drawDistance  chunks further than this are hidden
   * @param {number} opts.shadowDistance chunks further than this stop casting
   */
  constructor(parent, { chunkSize = 512, drawDistance = 1800, shadowDistance = 700 } = {}) {
    this.parent = parent;
    this.chunkSize = chunkSize;
    this.drawDistance = drawDistance;
    this.shadowDistance = shadowDistance;
    this.chunks = [];
    this.stats = { sourceMeshes: 0, chunkMeshes: 0, triangles: 0, mergeFailures: 0 };
  }

  async load(url, { castShadow = false, receiveShadow = true } = {}) {
    const gltf = await loadGLTF(url);
    gltf.scene.updateMatrixWorld(true);

    const buckets = new Map();
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      this.stats.sourceMeshes++;
      const pos = new THREE.Vector3();
      o.getWorldPosition(pos);
      // The city GLB names its meshes after the city block they belong to
      // ("block_3_2_office", "roads_0_0_asphalt"). Bucketing by that name
      // merges a whole block into one mesh per material, which cuts the draw
      // calls far more than a positional grid does and still culls a sensible
      // unit of the city.
      const block = /^((?:block|roads|facade)_-?\d+_-?\d+)/.exec(o.name || '');
      const key = block
        ? `${block[1]}_${o.material.uuid}`
        : `${Math.floor(pos.x / this.chunkSize)}_${Math.floor(pos.z / this.chunkSize)}_${o.material.uuid}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { material: o.material, entries: [] };
        buckets.set(key, bucket);
      }
      bucket.entries.push(o);
    });

    const tmpBox = new THREE.Box3();
    for (const bucket of buckets.values()) {
      const geoms = [];
      // Only keep attributes every geometry in the bucket shares, otherwise
      // mergeGeometries rejects the set.
      const shared = this._sharedAttributes(bucket.entries);
      const allIndexed = bucket.entries.every((e) => !!e.geometry.index);
      const anyIndexed = bucket.entries.some((e) => !!e.geometry.index);

      for (const entry of bucket.entries) {
        let g = entry.geometry.clone();
        if (anyIndexed && !allIndexed) g = g.toNonIndexed();
        for (const name of Object.keys(g.attributes)) {
          if (!shared.has(name)) g.deleteAttribute(name);
        }
        g.applyMatrix4(entry.matrixWorld);
        geoms.push(g);
      }

      let merged;
      try {
        merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
      } catch (e) {
        merged = null;
      }
      if (!merged) {
        // Fall back to the unmerged meshes for this bucket.
        this.stats.mergeFailures++;
        for (const entry of bucket.entries) {
          const g = entry.geometry.clone();
          g.applyMatrix4(entry.matrixWorld);
          this._pushChunk(g, bucket.material, tmpBox, castShadow, receiveShadow);
        }
        continue;
      }
      for (const g of geoms) if (g !== merged) g.dispose();
      this._pushChunk(merged, bucket.material, tmpBox, castShadow, receiveShadow);
    }

    this._countTriangles();
    return this;
  }

  _sharedAttributes(entries) {
    let shared = null;
    for (const e of entries) {
      const names = new Set(Object.keys(e.geometry.attributes));
      if (shared === null) shared = names;
      else shared = new Set([...shared].filter((n) => names.has(n)));
    }
    return shared || new Set();
  }

  /** `geometry` must already be in world space and owned by this instance. */
  _pushChunk(geometry, material, tmpBox, castShadow, receiveShadow) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.parent.add(mesh);

    tmpBox.setFromObject(mesh);
    const center = tmpBox.getCenter(new THREE.Vector3());
    const radius = tmpBox.getSize(new THREE.Vector3()).length() * 0.5;
    this.chunks.push({ mesh, center, radius, castShadow });
    this.stats.chunkMeshes++;
  }

  _countTriangles() {
    let tris = 0;
    for (const c of this.chunks) {
      const g = c.mesh.geometry;
      const count = g.index ? g.index.count : g.attributes.position.count;
      tris += count / 3;
    }
    this.stats.triangles = Math.round(tris);
  }

  /**
   * Hide distant chunks and drop their shadows. Called once per frame with
   * the camera position; the comparison is on squared distance to avoid a
   * square root per chunk.
   */
  update(cameraPosition) {
    const shadow2 = this.shadowDistance * this.shadowDistance;
    for (const c of this.chunks) {
      const dx = c.center.x - cameraPosition.x;
      const dy = c.center.y - cameraPosition.y;
      const dz = c.center.z - cameraPosition.z;
      // Measure to the chunk's near surface, not its centre, so a large
      // chunk the camera is standing inside is never culled.
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) - c.radius;
      const visible = dist < this.drawDistance;
      if (c.mesh.visible !== visible) c.mesh.visible = visible;
      if (visible && c.castShadow) {
        const near = dist < this.shadowDistance;
        if (c.mesh.castShadow !== near) c.mesh.castShadow = near;
      }
      void shadow2;
    }
  }
}
