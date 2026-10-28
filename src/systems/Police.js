import * as THREE from 'three';
import { CONFIG } from '../config.js';

/**
 * Police response.
 *
 * The force is deliberately thin: it only exists in response to reported
 * crime, it arrives from off-screen, and it disbands when the district cools
 * down. That keeps the street readable (a permanent police wall would make
 * the gang fights impossible to watch) while still making shooting in public
 * have a visible consequence.
 */
export class PoliceSystem {
  constructor(game) {
    this.game = game;
    this.units = [];
    this.cooldown = 0;
    this.active = false;
  }

  /** A crime was reported; send a squad if one is not already out. */
  respond(pos, severity = 1) {
    if (this.cooldown > 0) return;
    if (this.units.length >= CONFIG.police.maxUnits) return;
    this.cooldown = CONFIG.police.cooldown / Math.max(1, severity);
    // A harder district gets a bigger response, but the force is still capped.
    const wanted = CONFIG.police.squadSize + Math.floor(this.game.combatDirector.difficulty);
    const squad = Math.min(wanted, CONFIG.police.maxUnits - this.units.length);
    this._dispatch(pos, squad);
  }

  async _dispatch(pos, count) {
    this.active = true;
    const before = new Set(this.game.agents.agents.map((a) => a.id));
    await this.game.agents.spawnPolice(pos, count);
    for (const a of this.game.agents.agents) {
      if (!before.has(a.id) && a.faction === 'police') this.units.push(a.id);
    }
    this.game.hud.toast('পুলিশ ডাকা হয়েছে!', 2000);
    this.game.audio.siren?.();
  }

  /**
   * Track the deployed units and disband the squad once the district has been
   * quiet for a while, so the city returns to normal after a fight.
   */
  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);

    // Forget units that died or were culled.
    this.units = this.units.filter((id) => {
      const a = this.game.agents.get(id);
      return a && !a.dead;
    });

    if (!this.units.length) {
      if (this.active) this.active = false;
      return;
    }

    const heat = this.game.combatDirector.heatAt(this.game.player.position);
    if (heat < 0.08 && this.cooldown <= 0) {
      // Stand down: send them away from the player and let the culler retire
      // them naturally.
      for (const id of this.units) {
        const cop = this.game.agents.get(id);
        if (cop && !cop.combatTarget) {
          const away = new THREE.Vector3(cop.position.x - this.game.player.position.x, 0,
            cop.position.z - this.game.player.position.z).normalize().multiplyScalar(260);
          cop.setGoal(this.game.player.position.x + away.x, this.game.player.position.z + away.z, { run: false });
        }
      }
      this.units.length = 0;
      this.active = false;
      this.game.hud.toast('পুলিশ ফিরে গেছে', 1600);
    }
  }
}
