/**
 * Central configuration for HyperCity 3D.
 * Values that describe the real-world city (extent, scale, spawn) mirror
 * public/data/city.json, which is derived from OpenStreetMap (ODbL-1.0).
 */

export const CONFIG = {
  render: {
    // The city spans ~13.6 km east-west, so the far plane must reach beyond that.
    far: 60000,
    near: 0.25,
    // Capped low so the same scene runs on a phone; raised automatically on
    // desktop GPUs by the quality manager.
    maxPixelRatio: 1.5,
    fogNear: 700,
    fogFar: 9000,
    shadows: true,
    shadowMapSize: 2048,
    // Shadow camera only covers the area around the player, not the whole city.
    shadowRange: 160,
    // Spatially chunked city streaming: only chunks inside drawDistance are
    // drawn, which is what keeps a 9M-triangle city interactive.
    chunkSize: 512,
    drawDistance: 1100,
    shadowDistance: 420,
  },

  world: {
    layoutUrl: '/data/city.json',
    assets: {
      buildings: '/assets/city/buildings.glb',
      facades: '/assets/city/facades.glb',
      roads: '/assets/city/roads.glb',
      terrain: '/assets/city/terrain.glb',
      bridges: '/assets/city/coastal-bridges.glb',
      shoreline: '/assets/city/coastal-shoreline.glb',
      trees: '/assets/nature/tree.glb',
      palms: '/assets/nature/palm.glb',
      lamps: '/assets/misc/park-floodlight.glb',
    },
    // Half-extents of the playable area, read from city.json meta.extent.
    extent: [-6788.1, -2604.89, 6788.1, 2604.89],
  },

  sky: {
    // Real CC0 HDRIs from Poly Haven.
    hdri: {
      day: '/assets/env/kloofendal_48d_partly_cloudy_puresky.hdr',
      sunset: '/assets/env/belfast_sunset_puresky.hdr',
      night: '/assets/env/moonless_golf.hdr',
    },
  },

  player: {
    eyeHeight: 1.72,
    radius: 0.42,
    walkSpeed: 4.6,
    runSpeed: 9.4,
    jumpSpeed: 7.2,
    gravity: 22,
    acceleration: 12,
    // Which way the character mesh faces relative to its movement vector.
    modelYawOffset: 0,
  },

  vehicles: {
    car: {
      label: 'গাড়ি',
      model: '/assets/vehicles/car.glb',
      // Real dimensions measured from the GLB: 2.05 x 1.32 x 5.00 m.
      length: 5.0,
      width: 2.05,
      wheelRadius: 0.44,
      maxSpeed: 46, // m/s (~165 km/h)
      reverseSpeed: 12,
      accel: 13,
      brake: 26,
      drag: 0.42,
      maxSteer: 0.62,
      // The car's nose points down -Z, matching three.js forward.
      modelYawOffset: 0,
      mass: 1400,
    },
    truck: {
      label: 'ট্রাক',
      model: '/assets/vehicles/traffic-car.glb',
      length: 4.62,
      width: 2.3,
      wheelRadius: 0.4,
      maxSpeed: 34,
      reverseSpeed: 9,
      accel: 9,
      brake: 20,
      drag: 0.5,
      maxSteer: 0.55,
      modelYawOffset: 0,
      mass: 2600,
    },
    helicopter: {
      label: 'হেলিকপ্টার',
      model: '/assets/air/helicopter.glb',
      // Measured from the GLB: 14.4 x 5.5 x 15.5 m.
      length: 15.5,
      maxSpeed: 92,
      accel: 24,
      drag: 0.55,
      lift: 30,
      maxPitch: 0.42,
      maxRoll: 0.5,
      modelYawOffset: 0,
      rotors: ['top_fan', 'back_fan'],
    },
    plane: {
      label: 'প্লেন',
      model: '/assets/air/airplane.glb',
      length: 8.0,
      // The GLB is authored at ~0.29 m; it is scaled up to a real wingspan.
      baseScale: 30,
      maxSpeed: 140,
      accel: 34,
      drag: 0.32,
      lift: 46,
      maxPitch: 0.5,
      maxRoll: 0.9,
      modelYawOffset: 0,
      propeller: 'Propellor_Joint',
    },
    jet: {
      label: 'জেট',
      model: '/assets/air/jet.glb',
      length: 15,
      maxSpeed: 260,
      accel: 46,
      drag: 0.28,
      lift: 60,
      maxPitch: 0.55,
      maxRoll: 1.1,
      modelYawOffset: 0,
    },
    drone: {
      label: 'ড্রোন',
      model: '/assets/air/drone.glb',
      length: 2.4,
      baseScale: 12,
      maxSpeed: 40,
      accel: 22,
      drag: 0.6,
      lift: 20,
      maxPitch: 0.45,
      maxRoll: 0.55,
      modelYawOffset: 0,
    },
    floatplane: {
      label: 'সিপ্লেন',
      model: '/assets/air/floatplane.glb',
      length: 11,
      baseScale: 0.00004,
      maxSpeed: 110,
      accel: 30,
      drag: 0.34,
      lift: 42,
      maxPitch: 0.5,
      maxRoll: 0.9,
      modelYawOffset: 0,
    },
  },

  agents: {
    models: {
      // Real CC0 animated characters (KayKit Adventurers / Skeletons).
      knight: '/assets/characters/knight.glb',
      mage: '/assets/characters/mage.glb',
      rogue: '/assets/characters/rogue.glb',
      barbarian: '/assets/characters/barbarian.glb',
      skeleton: '/assets/characters/skeleton-warrior.glb',
      skeletonMage: '/assets/characters/skeleton-mage.glb',
      // three.js examples, kept as extra rigs.
      xbot: '/assets/characters/xbot.glb',
      robot: '/assets/characters/robot.glb',
    },
    // KayKit characters are authored ~1.8 units tall and face +Z, so only a
    // facing correction is needed. The three.js rigs need a height normalise.
    rigs: {
      knight: { targetHeight: 1.82, yawOffset: 0 },
      mage: { targetHeight: 1.78, yawOffset: 0 },
      rogue: { targetHeight: 1.76, yawOffset: 0 },
      barbarian: { targetHeight: 1.9, yawOffset: 0 },
      skeleton: { targetHeight: 1.85, yawOffset: 0 },
      skeletonMage: { targetHeight: 1.8, yawOffset: 0 },
      xbot: { targetHeight: 1.78, yawOffset: Math.PI },
      robot: { targetHeight: 2.35, yawOffset: 0 },
    },
    // The four adventurer classes are the crowd; skeletons are the gang.
    archetypes: ['knight', 'mage', 'rogue', 'barbarian'],
    gangArchetypes: ['skeleton', 'skeletonMage'],
    policeArchetypes: ['knight', 'barbarian'],
    walkSpeed: 1.5,
    runSpeed: 4.5,
    maxAmbient: 90,
    radius: 0.4,
    height: 1.75,
  },

  combat: {
    // Which faction each archetype belongs to.
    factions: {
      knight: 'civilian', mage: 'civilian', rogue: 'civilian', barbarian: 'civilian',
      xbot: 'civilian', robot: 'civilian',
      skeleton: 'gang', skeletonMage: 'gang',
    },
    health: {
      knight: 120, mage: 90, rogue: 100, barbarian: 150,
      xbot: 100, robot: 260, skeleton: 110, skeletonMage: 95,
    },
    meleeRange: 2.1,
    aiMeleeDamage: 9,
    aiAttackCooldown: 1.1,
    attackClips: [
      'Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Punch_B',
      '1H_Melee_Attack_Chop', '1H_Melee_Attack_Stab',
    ],
    // Player weapons. Melee has a short reach, firearms are hitscan.
    weapons: {
      fists: { label: 'মুষ্টি', kind: 'melee', damage: 12, range: 2.4, arc: 0.7, cooldown: 0.42, force: 3, clip: 'Unarmed_Melee_Attack_Punch_A', animTime: 0.42 },
      pistol: { label: 'পিস্তল', kind: 'ranged', damage: 26, range: 90, cooldown: 0.34, force: 1.5, clip: '1H_Ranged_Shoot', animTime: 0.3 },
      rifle: { label: 'রাইফেল', kind: 'ranged', damage: 34, range: 160, cooldown: 0.11, force: 2.2, clip: '2H_Ranged_Shoot', animTime: 0.25 },
    },
    respawnDelay: 4,
  },

  police: {
    // Police spawn when heat crosses this and stay for a while.
    responseHeat: 0.3,
    squadSize: 3,
    maxUnits: 14,
    cooldown: 12,
  },

  interior: {
    assetBase: '/assets/interior',
    cacheSize: 6,
    // How close to a doorway the player must be for the enter prompt.
    promptRange: 6,
  },

  // Automatic quality scaling so the same build runs on a laptop and a phone.
  quality: {
    // Tiers are picked from the measured frame time and device hints.
    tiers: {
      low: {
        pixelRatio: 0.7, shadows: false, drawDistance: 700, shadowDistance: 0,
        maxAmbient: 28, shadowMapSize: 1024, fogFar: 3000,
      },
      medium: {
        pixelRatio: 1.0, shadows: true, drawDistance: 1100, shadowDistance: 420,
        maxAmbient: 55, shadowMapSize: 1024, fogFar: 5000,
      },
      high: {
        pixelRatio: 1.5, shadows: true, drawDistance: 1500, shadowDistance: 600,
        maxAmbient: 90, shadowMapSize: 2048, fogFar: 8000,
      },
    },
    // A tier is demoted when the rolling average frame time exceeds this.
    slowFrameMs: 26,
    // ...and promoted when it stays comfortably under this.
    fastFrameMs: 13,
    settleSeconds: 3,
  },

  sim: {
    fixedStep: 1 / 60,
    maxSubSteps: 5,
  },
};

export const MODES = {
  WALK: 'walk',
  DRIVE: 'drive',
  FLY: 'fly',
};
