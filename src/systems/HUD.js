import { clamp } from '../utils.js';

/**
 * Heads-up display: status panels, the interaction prompt, the help card and
 * a top-down minimap rendered from the OpenStreetMap road graph.
 *
 * The minimap pre-renders the static road network once into an offscreen
 * canvas, then each frame only blits that base and draws the moving markers.
 */
export class HUD {
  constructor(world) {
    this.world = world;
    this.el = {
      hud: document.getElementById('hud'),
      fps: document.getElementById('fps'),
      mode: document.getElementById('mode-label'),
      clock: document.getElementById('time-label'),
      agentCount: document.getElementById('agent-count'),
      prompt: document.getElementById('prompt'),
      toast: document.getElementById('toast'),
      help: document.getElementById('help'),
      speedo: document.getElementById('speedo'),
      speedVal: document.getElementById('speed-val'),
      speedFill: document.getElementById('speed-bar-fill'),
      altimeter: document.getElementById('altimeter'),
      altVal: document.getElementById('alt-val'),
      minimap: document.getElementById('minimap'),
      healthFill: document.getElementById('health-bar-fill'),
      healthVal: document.getElementById('health-val'),
      factionVal: document.getElementById('faction-val'),
      damageFlash: document.getElementById('damage-flash'),
      weapon: document.getElementById('weapon-label'),
      ammo: document.getElementById('ammo-val'),
      death: document.getElementById('death-screen'),
    };
    this.ctx = this.el.minimap.getContext('2d');
    this.toastTimer = null;
    this._buildMinimapBase();
  }

  _buildMinimapBase() {
    const base = document.createElement('canvas');
    base.width = base.height = 512;
    const g = base.getContext('2d');
    g.fillStyle = '#0a1020';
    g.fillRect(0, 0, 512, 512);

    const b = this.world.bounds;
    const spanX = b.maxX - b.minX;
    const spanZ = b.maxZ - b.minZ;
    const span = Math.max(spanX, spanZ);
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const scale = 512 / span;

    const toPx = (x, z) => [256 + (x - cx) * scale, 256 + (z - cz) * scale];

    // Buildings as faint blocks (sampled for speed).
    g.fillStyle = 'rgba(120,150,200,0.20)';
    const step = Math.max(1, Math.floor(this.world.buildings.length / 4000));
    for (let i = 0; i < this.world.buildings.length; i += step) {
      const bld = this.world.buildings[i];
      const [px, pz] = toPx((bld.minX + bld.maxX) / 2, (bld.minZ + bld.maxZ) / 2);
      const w = Math.max(1, (bld.maxX - bld.minX) * scale);
      const h = Math.max(1, (bld.maxZ - bld.minZ) * scale);
      g.fillRect(px - w / 2, pz - h / 2, w, h);
    }

    // Roads, coloured by importance.
    const kindColor = {
      trunk: '#5d6a80', primary: '#6b7a92', secondary: '#63708a',
      tertiary: '#57647c', residential: '#4a5468', service: '#3f4859',
    };
    g.lineCap = 'round';
    for (const s of this.world.roadSegments) {
      if (s.kind === 'service' && Math.random() < 0.5) continue;
      g.strokeStyle = kindColor[s.kind] || '#48505f';
      g.lineWidth = clamp((s.width || 6) * scale * 0.9, 0.6, 4);
      const [ax, az] = toPx(s.ax, s.az);
      const [bx, bz] = toPx(s.bx, s.bz);
      g.beginPath();
      g.moveTo(ax, az);
      g.lineTo(bx, bz);
      g.stroke();
    }
    this.minimapBase = base;
    this.minimapScale = scale;
    this.minimapCenter = { cx, cz };
  }

  setQuality(tier) {
    this._quality = tier;
    if (this.el.stats) this.el.stats.title = `quality: ${tier}`;
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  setMode(label) { this.el.mode.textContent = label; }
  setClock(label) { this.el.clock.textContent = label; }
  setFps(v) { this.el.fps.textContent = v.toFixed(0); }
  setAgentCount(n) { this.el.agentCount.textContent = String(n); }

  showPrompt(html) {
    this.el.prompt.innerHTML = html;
    this.el.prompt.classList.remove('hidden');
  }
  hidePrompt() { this.el.prompt.classList.add('hidden'); }

  toggleHelp() { this.el.help.classList.toggle('hidden'); }

  toast(message, ms = 2200) {
    this.el.toast.textContent = message;
    this.el.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.el.toast.classList.remove('show'), ms);
  }

  setSpeed(kmh, maxKmh) {
    this.el.speedo.classList.remove('hidden');
    this.el.speedVal.textContent = String(Math.round(Math.abs(kmh)));
    this.el.speedFill.style.width = `${clamp(Math.abs(kmh) / maxKmh, 0, 1) * 100}%`;
  }
  hideSpeed() { this.el.speedo.classList.add('hidden'); }

  setAltitude(m) {
    this.el.altimeter.classList.remove('hidden');
    this.el.altVal.textContent = String(Math.round(m));
  }
  hideAltitude() { this.el.altimeter.classList.add('hidden'); }

  /** Player health, shown as a bar plus a number. */
  setHealth(hp, max) {
    const frac = clamp(hp / max, 0, 1);
    this.el.healthFill.style.width = `${frac * 100}%`;
    this.el.healthFill.style.background = frac > 0.5 ? '#4ade80' : frac > 0.25 ? '#fbbf24' : '#ef4444';
    this.el.healthVal.textContent = String(Math.max(0, Math.round(hp)));
  }

  setFactionCounts({ civilian = 0, gang = 0, police = 0 } = {}, difficulty = 1) {
    this.el.factionVal.textContent =
      `লেভেল ${difficulty.toFixed(1)} · সাধারণ ${civilian} · গ্যাং ${gang} · পুলিশ ${police}`;
  }

  setWeapon(label, ammo) {
    this.el.weapon.textContent = label;
    this.el.ammo.textContent = ammo === null ? '∞' : String(ammo);
  }

  /** Red vignette when the player takes a hit. */
  flashDamage(strength = 1) {
    const el = this.el.damageFlash;
    el.style.opacity = String(clamp(0.55 * strength, 0.1, 0.85));
    clearTimeout(this._dmgTimer);
    this._dmgTimer = setTimeout(() => { el.style.opacity = '0'; }, 140);
  }

  showDeath() { this.el.death.classList.remove('hidden'); }
  hideDeath() { this.el.death.classList.add('hidden'); }

  /** Redraw the minimap: static base plus the live markers. */
  drawMinimap({ x, z, heading, vehicles, agents }) {
    const c = this.ctx;
    const { cx, cz } = this.minimapCenter;
    const scale = this.minimapScale;
    c.clearRect(0, 0, 200, 200);

    // Window: show a 2.2 km square around the player.
    const viewSpan = 2200;
    const vscale = 200 / viewSpan;
    const ox = 100 - (x - cx) * vscale;
    const oz = 100 - (z - cz) * vscale;

    c.save();
    c.beginPath();
    c.rect(0, 0, 200, 200);
    c.clip();

    // Blit the base map, scaled so 512px base == viewSpan metres.
    const baseScale = (vscale * (Math.max(this.world.bounds.maxX - this.world.bounds.minX,
      this.world.bounds.maxZ - this.world.bounds.minZ)) / 512);
    c.globalAlpha = 0.9;
    c.drawImage(this.minimapBase, ox, oz, 512 * baseScale, 512 * baseScale);
    c.globalAlpha = 1;

    // Agents, coloured by faction so a fight is visible at a glance.
    for (const a of agents) {
      const px = 100 + (a.position.x - x) * vscale;
      const pz = 100 + (a.position.z - z) * vscale;
      if (px < 0 || px > 200 || pz < 0 || pz > 200) continue;
      c.fillStyle = a.dead ? '#5b6472'
        : a.faction === 'gang' ? '#ff5c8a'
          : a.faction === 'police' ? '#7db4ff' : '#7cf7c0';
      c.fillRect(px - 1, pz - 1, 2, 2);
    }

    // Vehicles.
    for (const v of vehicles) {
      const px = 100 + (v.position.x - x) * vscale;
      const pz = 100 + (v.position.z - z) * vscale;
      c.fillStyle = v.driven ? '#ffb03a' : '#ff6b6b';
      c.fillRect(px - 2, pz - 2, 4, 4);
    }

    // Player arrow.
    c.save();
    c.translate(100, 100);
    c.rotate(-heading);
    c.fillStyle = '#38e8ff';
    c.beginPath();
    c.moveTo(0, -7);
    c.lineTo(5, 6);
    c.lineTo(0, 3);
    c.lineTo(-5, 6);
    c.closePath();
    c.fill();
    c.restore();
    c.restore();

    // Frame.
    c.strokeStyle = 'rgba(120,200,255,0.25)';
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, 199, 199);
  }
}
