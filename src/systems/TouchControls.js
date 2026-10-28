import { clamp } from '../utils.js';

/**
 * Touch controls for phones and tablets.
 *
 * Rather than replacing the input layer, this feeds the same `Input` state
 * the keyboard drives, so the whole game (walking, driving, flying, combat)
 * works unchanged on a touch device. A left thumbstick moves, a right-hand
 * drag looks, and the on-screen buttons map to the keyboard actions.
 */
export class TouchControls {
  constructor(input, actions = {}) {
    this.input = input;
    this.actions = actions;
    this.enabled = false;
    this.move = { x: 0, y: 0 };
    this.lookDelta = { dx: 0, dy: 0 };
    this._pointers = new Map();
    this._root = null;
    this._built = false;
  }

  /** True for a device that should get touch controls by default. */
  static isTouchDevice() {
    return (typeof window !== 'undefined')
      && (('ontouchstart' in window) || navigator.maxTouchPoints > 0)
      && window.matchMedia('(pointer: coarse)').matches;
  }

  enable() {
    if (!this._built) this._build();
    this.enabled = true;
    this._root.classList.remove('hidden');
    document.body.classList.add('touch');
  }

  disable() {
    this.enabled = false;
    if (this._root) this._root.classList.add('hidden');
    document.body.classList.remove('touch');
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'touch-controls';
    root.innerHTML = `
      <div id="stick-base"><div id="stick-knob"></div></div>
      <div id="touch-buttons">
        <button class="tb" data-act="jump">⤒</button>
        <button class="tb" data-act="run">🏃</button>
        <button class="tb" data-act="attack">👊</button>
        <button class="tb" data-act="interact">E</button>
        <button class="tb" data-act="weapon">🔫</button>
        <button class="tb" data-act="camera">🎥</button>
        <button class="tb" data-act="vehicle">🚗</button>
      </div>`;
    document.body.appendChild(root);
    this._root = root;

    const base = root.querySelector('#stick-base');
    const knob = root.querySelector('#stick-knob');
    this._stick = { base, knob, id: null, cx: 0, cy: 0 };

    // Movement stick. The origin is wherever the thumb first lands inside the
    // base, which feels much better than a fixed centre on a small screen.
    base.addEventListener('pointerdown', (e) => {
      this._stick.id = e.pointerId;
      const r = base.getBoundingClientRect();
      this._stick.cx = r.left + r.width / 2;
      this._stick.cy = r.top + r.height / 2;
      base.setPointerCapture(e.pointerId);
      this._updateStick(e.clientX, e.clientY);
    });
    base.addEventListener('pointermove', (e) => {
      if (this._stick.id !== e.pointerId) return;
      this._updateStick(e.clientX, e.clientY);
    });
    const release = (e) => {
      if (this._stick.id !== e.pointerId) return;
      this._stick.id = null;
      this.move.x = 0; this.move.y = 0;
      knob.style.transform = 'translate(-50%, -50%)';
    };
    base.addEventListener('pointerup', release);
    base.addEventListener('pointercancel', release);

    // Look: dragging anywhere outside the stick and buttons turns the camera.
    const canvas = this.input.canvas;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    canvas.addEventListener('pointermove', (e) => {
      const prev = this._pointers.get(e.pointerId);
      if (!prev) return;
      this.lookDelta.dx += (e.clientX - prev.x) * 0.0032;
      this.lookDelta.dy += (e.clientY - prev.y) * 0.0032;
      prev.x = e.clientX; prev.y = e.clientY;
    });
    const endLook = (e) => this._pointers.delete(e.pointerId);
    canvas.addEventListener('pointerup', endLook);
    canvas.addEventListener('pointercancel', endLook);

    for (const btn of root.querySelectorAll('.tb')) {
      const act = btn.dataset.act;
      const press = (e) => {
        e.preventDefault();
        this._press(act, true);
        btn.classList.add('active');
      };
      const lift = (e) => {
        e.preventDefault();
        this._press(act, false);
        btn.classList.remove('active');
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', lift);
      btn.addEventListener('pointercancel', lift);
      btn.addEventListener('pointerleave', lift);
    }
  }

  _updateStick(clientX, clientY) {
    const s = this._stick;
    const dx = clientX - s.cx;
    const dy = clientY - s.cy;
    const max = 56;
    const len = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(len, max);
    const nx = (dx / len) * clamped;
    const ny = (dy / len) * clamped;
    s.knob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
    this.move.x = clamp(nx / max, -1, 1);
    this.move.y = clamp(ny / max, -1, 1);
  }

  _press(act, down) {
    switch (act) {
      case 'jump': this.input.setVirtual('Space', down); break;
      case 'run': this.input.setVirtual('ShiftLeft', down); break;
      case 'interact': if (down) this.actions.interact?.(); break;
      case 'camera': if (down) this.actions.camera?.(); break;
      case 'weapon': if (down) this.actions.weapon?.(); break;
      case 'vehicle': if (down) this.actions.vehicle?.(); break;
      case 'attack': this.input.setVirtual('Mouse0', down); break;
      default: break;
    }
  }

  /** Merged into the keyboard state each frame by Input. */
  get axes() { return { x: this.move.x, z: this.move.y }; }

  consumeLook() {
    const d = { dx: this.lookDelta.dx, dy: this.lookDelta.dy };
    this.lookDelta.dx = 0;
    this.lookDelta.dy = 0;
    return d;
  }
}
