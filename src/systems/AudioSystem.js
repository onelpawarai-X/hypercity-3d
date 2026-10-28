import * as THREE from 'three';
import { clamp } from '../utils.js';

/**
 * Procedural audio: engine, rotor, tyre screech, wind and footsteps.
 *
 * Everything is synthesised with Web Audio (oscillators + filtered noise), so
 * the project ships no sampled audio that would need separate licensing. The
 * noise buffer is generated once and reused.
 */
export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engine = null;
    this.rotor = null;
    this.wind = null;
    this.started = false;
    this.enabled = true;
  }

  /** Must be called from a user gesture (the Start button). */
  start() {
    if (this.started) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return; }
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    this._buildNoise();
    this._buildEngine();
    this._buildRotor();
    this._buildWind();
    this.started = true;
  }

  _buildNoise() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  _noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  _buildEngine() {
    const ctx = this.ctx;
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = 0;

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);

    osc1.frequency.value = 60;
    osc2.frequency.value = 90;
    osc1.start();
    osc2.start();
    this.engine = { osc1, osc2, filter, gain };
  }

  _buildRotor() {
    const ctx = this.ctx;
    const src = this._noiseSource();
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 220;
    band.Q.value = 0.8;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 14;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0;

    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    src.connect(band);
    band.connect(gain);
    gain.connect(this.master);
    src.start();
    lfo.start();
    this.rotor = { src, band, gain, lfo };
  }

  _buildWind() {
    const ctx = this.ctx;
    const src = this._noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
    this.wind = { src, filter, gain };
  }

  /** Called every frame with the current vehicle/player state. */
  update({ mode, speed, maxSpeed, altitude, grounded, moving }) {
    if (!this.started || !this.enabled) return;
    const t = this.ctx.currentTime;
    const s = (v, tc = 0.15) => v; // placeholder for smoothing if needed

    if (mode === 'drive') {
      const norm = clamp(speed / maxSpeed, 0, 1);
      const rpm = 60 + norm * 320;
      this.engine.osc1.frequency.setTargetAtTime(rpm, t, 0.08);
      this.engine.osc2.frequency.setTargetAtTime(rpm * 1.5, t, 0.08);
      this.engine.filter.frequency.setTargetAtTime(500 + norm * 2600, t, 0.1);
      this.engine.gain.gain.setTargetAtTime(0.05 + norm * 0.16, t, 0.1);
      this.rotor.gain.gain.setTargetAtTime(0, t, 0.2);
      this.wind.gain.gain.setTargetAtTime(norm * 0.05, t, 0.2);
    } else if (mode === 'fly') {
      const norm = clamp(speed / maxSpeed, 0, 1);
      this.engine.gain.gain.setTargetAtTime(0.02 + norm * 0.06, t, 0.15);
      this.engine.osc1.frequency.setTargetAtTime(120 + norm * 200, t, 0.1);
      this.rotor.lfo.frequency.setTargetAtTime(10 + norm * 12, t, 0.1);
      this.rotor.gain.gain.setTargetAtTime(0.12 + norm * 0.12, t, 0.15);
      this.wind.gain.gain.setTargetAtTime(clamp(norm * 0.12, 0, 0.14), t, 0.2);
    } else {
      this.engine.gain.gain.setTargetAtTime(0, t, 0.25);
      this.rotor.gain.gain.setTargetAtTime(0, t, 0.25);
      this.wind.gain.gain.setTargetAtTime(moving ? 0.02 : 0, t, 0.2);
    }
  }

  setMuted(muted) {
    this.enabled = !muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.55;
  }

  // ------------------------------------------------------- combat sounds
  // Every effect is synthesised from oscillators and the shared noise buffer,
  // so no audio files need to be downloaded and the mix stays licence-free.

  /** Short filtered noise burst: a punch landing or a body hitting the road. */
  melee() { this._burst({ freq: 220, q: 1.1, dur: 0.12, gain: 0.5, type: 'lowpass' }); }

  /** Sharp crack plus a low thump, for a firearm. */
  gunshot(weapon = 'pistol') {
    if (!this.started || !this.enabled) return;
    const heavy = weapon === 'rifle';
    this._burst({ freq: heavy ? 1400 : 900, q: 0.9, dur: heavy ? 0.16 : 0.1, gain: heavy ? 0.75 : 0.55, type: 'highpass' });
    this._tone({ freq: heavy ? 90 : 140, dur: 0.13, gain: 0.35, type: 'sine', sweepTo: 45 });
  }

  /** A hit taken by the player. */
  hit() { this._burst({ freq: 320, q: 0.7, dur: 0.18, gain: 0.4, type: 'lowpass' }); }

  /** Two-tone police siren that fades in and out over a few seconds. */
  siren() {
    if (!this.started || !this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.linearRampToValueAtTime(880, t + 0.5);
    osc.frequency.linearRampToValueAtTime(660, t + 1.0);
    osc.frequency.linearRampToValueAtTime(880, t + 1.5);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.16, t + 0.25);
    gain.gain.setValueAtTime(0.16, t + 1.6);
    gain.gain.linearRampToValueAtTime(0, t + 2.4);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 2.5);
  }

  _burst({ freq, q, dur, gain: peak, type }) {
    if (!this.started || !this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this._noiseSource();
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  _tone({ freq, dur, gain: peak, type, sweepTo }) {
    if (!this.started || !this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}
