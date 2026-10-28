import * as THREE from 'three';
import { damp, clamp } from '../utils.js';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Third- and first-person camera for both the walking player and any vehicle.
 *
 * The camera never reads input directly; it follows whatever entity the game
 * hands it, so the same rig works for the player on foot, a driven car and a
 * fast jet. Position and look-at are critically damped to avoid jitter.
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this.fov = camera.fov;
  }

  /** Snap immediately (used on spawn / teleport so there is no lurch). */
  snapTo(entity, { firstPerson, mode }) {
    const target = this._computeTarget(entity, { firstPerson, mode });
    this.position.copy(target.pos);
    this.lookAt.copy(target.look);
    this._apply();
  }

  _computeTarget(entity, { firstPerson, mode }) {
    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();

    if (mode === 'walk') {
      const p = entity.position;
      if (firstPerson) {
        pos.set(p.x, p.y + entity.cfg.eyeHeight, p.z);
        const dir = new THREE.Vector3(
          -Math.sin(entity.cameraYaw) * Math.cos(entity.cameraPitch),
          Math.sin(entity.cameraPitch),
          -Math.cos(entity.cameraYaw) * Math.cos(entity.cameraPitch),
        );
        look.copy(pos).add(dir.multiplyScalar(10));
      } else {
        const dist = 5.6;
        const height = 2.5;
        const dir = new THREE.Vector3(
          Math.sin(entity.cameraYaw), 0, Math.cos(entity.cameraYaw),
        );
        pos.set(p.x + dir.x * dist, p.y + height + entity.cameraPitch * -3.5, p.z + dir.z * dist);
        look.set(p.x, p.y + entity.cfg.eyeHeight * 0.9, p.z);
      }
    } else {
      // Vehicle chase or cockpit.
      const v = entity;
      if (firstPerson) {
        pos.copy(v.cockpitAnchor);
        const fwd = new THREE.Vector3(0, 0, -1).applyAxisAngle(Y_AXIS, v.heading);
        look.copy(pos).addScaledVector(fwd, 30);
        look.y += Math.sin(v.pitch || 0) * 20;
      } else {
        pos.copy(v.chaseAnchor);
        look.copy(v.position).add(new THREE.Vector3(0, 1.2, 0));
      }
    }
    return { pos, look };
  }

  update(entity, { firstPerson, mode, dt, shake = 0 }) {
    const target = this._computeTarget(entity, { firstPerson, mode });
    const lambda = mode === 'fly' ? 6 : 9;
    this.position.x = damp(this.position.x, target.pos.x, lambda, dt);
    this.position.y = damp(this.position.y, target.pos.y, lambda, dt);
    this.position.z = damp(this.position.z, target.pos.z, lambda, dt);
    this.lookAt.x = damp(this.lookAt.x, target.look.x, lambda * 1.4, dt);
    this.lookAt.y = damp(this.lookAt.y, target.look.y, lambda * 1.4, dt);
    this.lookAt.z = damp(this.lookAt.z, target.look.z, lambda * 1.4, dt);

    if (shake > 0) {
      this.position.x += (Math.random() - 0.5) * shake;
      this.position.y += (Math.random() - 0.5) * shake;
      this.position.z += (Math.random() - 0.5) * shake;
    }

    // Field of view widens with speed for a sense of pace.
    const speed = mode === 'fly' ? (entity.speed || 0) : (entity.moving || 0);
    const targetFov = mode === 'fly'
      ? clamp(62 + (entity.speed || 0) / 6, 62, 96)
      : clamp(62 + (entity.moving || 0) * 0.55, 62, 78);
    this.camera.fov = damp(this.camera.fov, targetFov, 4, dt);
    this.camera.updateProjectionMatrix();

    this._apply();
  }

  _apply() {
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
  }
}
