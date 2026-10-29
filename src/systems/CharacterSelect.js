import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { loadCharacter } from '../agents/CharacterRig.js';

/**
 * The start screen's playable-character picker.
 *
 * Each card is a small live WebGL preview of the real downloaded rig turning
 * on the spot, so the choice is made from the actual model rather than a
 * static icon. The chosen archetype is handed back to Game.start(), which
 * swaps the player's rig for that character.
 */
export class CharacterSelect {
  constructor(container) {
    this.container = container;
    this.cards = [];
    this.selected = CONFIG.agents.roster[0].id;
    this.onChange = null;
  }

  /**
   * Build one card per roster entry. `getRig` returns an already loaded
   * CharacterRig for an archetype, which keeps the previews from downloading
   * anything the game has not already loaded.
   */
  async build(getRig) {
    this.container.innerHTML = '';
    for (const entry of CONFIG.agents.roster) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'roster-card';
      card.dataset.id = entry.id;
      card.setAttribute('role', 'option');
      card.innerHTML = `<canvas></canvas><div class="rname">${entry.label}</div>`;
      card.addEventListener('click', () => this.select(entry.id));
      this.container.appendChild(card);

      const canvas = card.querySelector('canvas');
      const viewer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      viewer.setPixelRatio(Math.min(devicePixelRatio, 2));
      viewer.setClearColor(0x000000, 0);

      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xdff3ff, 0x2a2f3a, 2.1));
      const key = new THREE.DirectionalLight(0xffffff, 2.4);
      key.position.set(2.5, 4, 3.5);
      scene.add(key);

      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
      camera.position.set(0, 1.15, 3.3);
      camera.lookAt(0, 0.95, 0);

      const rig = await getRig(entry.id);
      if (rig) {
        const model = rig.clone();
        model.root.position.y = -0.95;   // stand the model on the origin
        scene.add(model.root);
        this.cards.push({ entry, card, viewer, scene, camera, model, angle: 0 });
      } else {
        this.cards.push({ entry, card, viewer, scene, camera, model: null, angle: 0 });
      }
    }

    this._resize();
    window.addEventListener('resize', () => this._resize());
    this.select(this.selected);
    return this;
  }

  _resize() {
    for (const c of this.cards) {
      const w = c.card.clientWidth - 16 || 150;
      const h = 92;
      c.viewer.setSize(w, h, false);
      c.camera.aspect = w / h;
      c.camera.updateProjectionMatrix();
    }
  }

  select(id) {
    if (!CONFIG.agents.roster.some((e) => e.id === id)) return;
    this.selected = id;
    for (const c of this.cards) {
      c.card.classList.toggle('selected', c.entry.id === id);
      c.card.setAttribute('aria-selected', String(c.entry.id === id));
    }
    const entry = CONFIG.agents.roster.find((e) => e.id === id);
    const nameEl = document.getElementById('roster-name');
    const blurbEl = document.getElementById('roster-blurb');
    if (nameEl) nameEl.textContent = entry.label;
    if (blurbEl) blurbEl.textContent = entry.blurb;
    this.onChange?.(id);
  }

  /** One preview frame per game frame; each model turns slowly on the spot. */
  update(dt) {
    for (const c of this.cards) {
      if (!c.model) continue;
      c.angle += dt * 0.55;
      c.model.root.rotation.y = c.angle;
      // setSpeed(0) drives the idle clip; update() alone would leave the rig
      // frozen in its bind pose.
      c.model.setSpeed(0, dt);
      c.viewer.render(c.scene, c.camera);
    }
  }

  /**
   * The start screen has no game loop of its own, so the previews run on a
   * private animation frame until the player presses start.
   */
  startPreview() {
    if (this._raf) return;
    let last = performance.now();
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      this.update(dt);
    };
    this._raf = requestAnimationFrame(tick);
  }

  stopPreview() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }
}
