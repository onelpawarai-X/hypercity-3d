import { clamp } from './utils.js';

/**
 * Keyboard, mouse-look (pointer lock) and gamepad input.
 *
 * Held keys are polled with isDown(); one-shot actions (E, F, T, G, H, 1-6)
 * are dispatched through onAction so the game only reacts to the press edge.
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.sensitivity = 0.0022;
    this.listeners = new Map();
    this.padIndex = null;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onLockChange = this._onLockChange.bind(this);
    this._onBlur = this._onBlur.bind(this);

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onLockChange);
    window.addEventListener('blur', this._onBlur);

    window.addEventListener('gamepadconnected', (e) => { this.padIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { this.padIndex = null; });
  }

  on(action, fn) {
    if (!this.listeners.has(action)) this.listeners.set(action, []);
    this.listeners.get(action).push(fn);
  }

  emit(action, payload) {
    const fns = this.listeners.get(action);
    if (fns) for (const fn of fns) fn(payload);
  }

  _onKeyDown(e) {
    // Let the browser keep its own shortcuts (devtools, reload, ...).
    if (e.ctrlKey && !['ControlLeft', 'ControlRight'].includes(e.code)) return;
    if (e.metaKey || e.altKey) return;
    if (e.repeat) return;
    this.keys.add(e.code);

    switch (e.code) {
      case 'KeyE': this.emit('interact'); break;
      case 'KeyF': this.emit('camera'); break;
      case 'KeyT': this.emit('time'); break;
      case 'KeyG': this.emit('agent'); break;
      case 'KeyH': this.emit('help'); break;
      case 'KeyR': this.emit('reset'); break;
      case 'KeyC': this.emit('clearcars'); break;
      case 'Digit1': this.emit('spawn', 'car'); break;
      case 'Digit2': this.emit('spawn', 'truck'); break;
      case 'Digit3': this.emit('spawn', 'plane'); break;
      case 'Digit4': this.emit('spawn', 'helicopter'); break;
      case 'Digit5': this.emit('spawn', 'jet'); break;
      case 'Digit6': this.emit('spawn', 'drone'); break;
      default: break;
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  }

  _onKeyUp(e) { this.keys.delete(e.code); }

  _onBlur() { this.keys.clear(); }

  _onMouseMove(e) {
    if (!this.locked) return;
    this.mouseDX += e.movementX || 0;
    this.mouseDY += e.movementY || 0;
  }

  _onLockChange() {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) this.emit('unlock');
    else this.emit('lock');
  }

  requestLock() {
    if (!this.locked) this.canvas.requestPointerLock?.();
  }

  releaseLock() {
    if (this.locked) document.exitPointerLock?.();
  }

  /** Returns and clears accumulated mouse-look delta, already scaled. */
  consumeLook() {
    const dx = this.mouseDX * this.sensitivity;
    const dy = this.mouseDY * this.sensitivity;
    this.mouseDX = 0;
    this.mouseDY = 0;
    // Touch drag adds its own, unscaled delta (the touch layer already
    // applies a sensitivity that suits a finger rather than a mouse).
    if (this.touch) {
      const t = this.touch.consumeLook();
      return { dx: dx + t.dx, dy: dy + t.dy };
    }
    return { dx, dy };
  }

  isDown(code) { return this.keys.has(code) || this.virtual?.has(code); }

  /**
   * Virtual key state, driven by the on-screen touch controls. Kept separate
   * from real key events so a physical keyup cannot cancel a held button.
   */
  setVirtual(code, down) {
    if (!this.virtual) this.virtual = new Set();
    if (down) this.virtual.add(code); else this.virtual.delete(code);
  }

  /** Polled movement axes, normalised for diagonal input. */
  axes() {
    let x = 0, z = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) z -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) z += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;

    // Touch stick, if one is being held.
    if (this.touch) {
      const t = this.touch.axes;
      x += t.x; z += t.z;
    }

    const pad = this.gamepad();
    if (pad) {
      const dead = 0.14;
      const px = Math.abs(pad.axes[0]) > dead ? pad.axes[0] : 0;
      const py = Math.abs(pad.axes[1]) > dead ? pad.axes[1] : 0;
      x += px; z += py;
      if (pad.buttons[7]?.value > 0.15) z -= pad.buttons[7].value; // RT accelerates
      if (pad.buttons[6]?.value > 0.15) z += pad.buttons[6].value; // LT reverses
    }

    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z };
  }

  throttle() {
    const pad = this.gamepad();
    if (pad && pad.buttons[7]?.value > 0.1) return pad.buttons[7].value;
    if (this.touch && this.touch.move.y < -0.3) return -this.touch.move.y;
    return (this.isDown('KeyW') || this.isDown('ArrowUp')) ? 1 : 0;
  }

  brake() {
    const pad = this.gamepad();
    if (pad && pad.buttons[6]?.value > 0.1) return pad.buttons[6].value;
    if (this.touch && this.touch.move.y > 0.3) return this.touch.move.y;
    return (this.isDown('KeyS') || this.isDown('ArrowDown')) ? 1 : 0;
  }

  steer() {
    let s = 0;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) s += 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) s -= 1;
    if (this.touch) s -= this.touch.move.x;
    const pad = this.gamepad();
    if (pad) {
      const a = pad.axes[0];
      if (Math.abs(a) > 0.14) s -= a;
    }
    return clamp(s, -1, 1);
  }

  /** Helicopter/drone collective: W or Space climbs, S or Ctrl descends. */
  collective() {
    let up = 0, down = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp') || this.isDown('Space')) up = 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown') || this.isDown('ControlLeft') || this.isDown('ControlRight')) down = 1;
    if (this.touch) { up = Math.max(up, -Math.min(0, this.touch.move.y)); down = Math.max(down, Math.max(0, this.touch.move.y)); }
    const pad = this.gamepad();
    if (pad) { up = Math.max(up, pad.buttons[7]?.value || 0); down = Math.max(down, pad.buttons[6]?.value || 0); }
    return up - down;
  }

  sprint() { return this.isDown('ShiftLeft') || this.isDown('ShiftRight'); }
  jump() { return this.isDown('Space'); }
  descend() { return this.isDown('ControlLeft') || this.isDown('ControlRight'); }
  attacking() { return this.isDown('Mouse0'); }

  /** Look with the right stick as well as the mouse. */
  lookAxes() {
    const pad = this.gamepad();
    if (!pad) return { x: 0, y: 0 };
    const dead = 0.16;
    const x = Math.abs(pad.axes[2]) > dead ? pad.axes[2] : 0;
    const y = Math.abs(pad.axes[3]) > dead ? pad.axes[3] : 0;
    return { x, y };
  }

  gamepad() {
    if (this.padIndex === null || !navigator.getGamepads) return null;
    return navigator.getGamepads()[this.padIndex] || null;
  }
}
