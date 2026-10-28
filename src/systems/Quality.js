import { CONFIG } from '../config.js';

/**
 * Automatic quality scaling.
 *
 * The city is heavy enough that a fixed setting cannot serve both a phone and
 * a gaming laptop, so the renderer starts at a tier guessed from the device
 * and then moves up or down based on the frame times it actually measures.
 * Demotion is quick (a stutter is worse than a soft image) and promotion is
 * slow and one-way-until-stable, so the game cannot oscillate between tiers.
 */
export class QualityManager {
  constructor(game) {
    this.game = game;
    this.tiers = ['low', 'medium', 'high'];
    this.index = 1;
    this.avgMs = 16;
    this.holdTimer = 0;
    this.locked = false;
    this.history = [];
  }

  /** Guess the starting tier from device signals before the first frame. */
  detectInitialTier() {
    const isTouch = (typeof window !== 'undefined')
      && (('ontouchstart' in window) || navigator.maxTouchPoints > 0);
    const small = Math.min(window.innerWidth, window.innerHeight) < 760;
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    const mobile = isTouch && (small || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

    if (mobile || cores <= 4 || mem <= 4) return 0;
    if (cores >= 8 && !isTouch) return 2;
    return 1;
  }

  apply(tierName) {
    const tier = CONFIG.quality.tiers[tierName];
    if (!tier) return;
    this.current = tierName;
    const g = this.game;

    g.renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.pixelRatio));
    g.renderer.setSize(window.innerWidth, window.innerHeight);
    g.renderer.shadowMap.enabled = tier.shadows;
    if (g.sky?.sun) {
      g.sky.sun.castShadow = tier.shadows;
      if (g.sky.sun.shadow) {
        g.sky.sun.shadow.mapSize.setScalar(tier.shadowMapSize);
        g.sky.sun.shadow.map?.dispose();
        g.sky.sun.shadow.map = null;
      }
    }
    if (g.scene?.fog) g.scene.fog.far = tier.fogFar;

    // Streaming distances and crowd size are the two biggest levers.
    for (const c of g.world.chunked) {
      c.drawDistance = tier.drawDistance;
      c.shadowDistance = tier.shadowDistance;
    }
    g.crowdTarget = tier.maxAmbient;

    // Materials need a recompile when the shadow flag flips.
    g.scene.traverse((o) => { if (o.isMesh) o.material.needsUpdate = true; });

    this.game.hud?.setQuality?.(tierName);
  }

  /** Called once per rendered frame with the frame time in milliseconds. */
  update(ms) {
    if (this.locked) return;
    this.history.push(ms);
    if (this.history.length > 45) this.history.shift();
    if (this.history.length < 30) return;

    // Use the median so a single hitch does not trigger a demotion.
    const sorted = [...this.history].sort((a, b) => a - b);
    this.avgMs = sorted[Math.floor(sorted.length / 2)];

    this.holdTimer += ms / 1000;
    if (this.holdTimer < CONFIG.quality.settleSeconds) return;

    if (this.avgMs > CONFIG.quality.slowFrameMs && this.index > 0) {
      this.index--;
      this.apply(this.tiers[this.index]);
      this.holdTimer = 0;
      this.history.length = 0;
    } else if (this.avgMs < CONFIG.quality.fastFrameMs && this.index < this.tiers.length - 1) {
      this.index++;
      this.apply(this.tiers[this.index]);
      this.holdTimer = 0;
      this.history.length = 0;
    } else {
      this.holdTimer = 0;
    }
  }
}
