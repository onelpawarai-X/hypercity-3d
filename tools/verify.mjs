/**
 * End-to-end verification of the playable loop: load, drive, fly, fight,
 * die, respawn, enter and leave a building. Run against `npm run dev`.
 */
import puppeteer from 'puppeteer-core';

const URL = process.env.URL || 'http://localhost:12000/';
const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium', headless: 'shell', protocolTimeout: 900000,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) pageErrors.push(`HTTP ${r.status()} ${r.url()}`); });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
const boot = await page.evaluate(() => ({
  buildings: window.game.world.buildings.length,
  roads: window.game.world.roadSegments.length,
  trees: window.game.world.trees,
  props: window.game.interiors.propNames.length,
  rigs: [...window.game.characterCache.keys()].length,
}));
check('world loaded from real OSM + GLB data', boot.buildings > 15000 && boot.roads > 30000, JSON.stringify(boot));
check('interior furniture models loaded', boot.props >= 20, `${boot.props} props`);
check('animated character rigs loaded', boot.rigs >= 6, `${boot.rigs} rigs`);

await page.click('#start-btn');
await new Promise((r) => setTimeout(r, 1500));

await page.evaluate(() => {
  window.__probe = () => {
    const g = window.game;
    return {
      mode: g.mode, x: g.player.position.x, z: g.player.position.z,
      speed: g.currentVehicle ? g.currentVehicle.speed : g.player.moving,
      altitude: g.currentVehicle ? g.currentVehicle.position.y : g.player.position.y,
      hp: g.player.health, dead: g.player.dead, indoors: g.player.indoors,
      gang: g.agents.factions.gang, police: g.agents.factions.police,
      difficulty: g.combatDirector.difficulty,
    };
  };
});

/**
 * Hold the given keys until the probe reports the wanted condition, or the
 * deadline passes. Frame rate varies a lot between the local server and the
 * tunnel, so a fixed sleep is not a reliable way to reach a speed.
 */
const driveUntil = async (keys, predicate, deadlineMs = 25000) => {
  await page.evaluate((k) => k.forEach((key) => window.game.input.setVirtual(key, true)), keys);
  const t0 = Date.now();
  let state = await page.evaluate(() => window.__probe());
  while (Date.now() - t0 < deadlineMs) {
    state = await page.evaluate(() => window.__probe());
    if (predicate(state)) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  await page.evaluate((k) => k.forEach((key) => window.game.input.setVirtual(key, false)), keys);
  return state;
};

// ---- driving -------------------------------------------------------------
await page.evaluate(async () => {
  const g = window.game;
  const rp = g.world.randomRoadPoint();
  g.teleport(rp.x, rp.z, 0, rp.yaw);
  const v = await g.spawnVehicle('car', rp.x + 4, rp.z, rp.yaw);
  g._enterVehicle(v);
});
const drive = await driveUntil(['KeyW'], (s) => s.mode === 'drive' && s.speed > 6);
check('player can get in and drive a real car', drive.mode === 'drive' && drive.speed > 6,
  `mode=${drive.mode} speed=${drive.speed.toFixed(1)}m/s`);

// ---- flying --------------------------------------------------------------
await page.evaluate(async () => {
  const g = window.game;
  g._exitVehicle();
  const v = await g.spawnVehicle('helicopter', g.player.position.x + 6, g.player.position.z, 0);
  g._enterVehicle(v);
});
const fly = await driveUntil(['KeyW', 'Space'], (s) => s.mode === 'fly' && s.altitude > 6);
check('player can fly a real helicopter', fly.mode === 'fly' && fly.altitude > 6,
  `mode=${fly.mode} altitude=${fly.altitude.toFixed(1)}m`);
await page.evaluate(() => window.game._exitVehicle());

// ---- interiors -----------------------------------------------------------
const enter = await page.evaluate(async () => {
  const g = window.game;
  const b = g.world.buildings.find((x) => (x.maxX - x.minX) > 12 && (x.maxZ - x.minZ) > 12);
  g._enterInterior(b);
  return { indoors: g.player.indoors, y: g.player.position.y, colliders: g.interiors.active.colliders.length };
});
await page.evaluate(() => { window.game.input.setVirtual('KeyW', true); });
await new Promise((r) => setTimeout(r, 2500));
const walked = await page.evaluate(() => {
  const g = window.game;
  g.input.setVirtual('KeyW', false);
  return { x: g.player.position.x, y: g.player.position.y, indoors: g.player.indoors };
});
check('player walks inside a building with real furniture', enter.indoors && enter.colliders > 0,
  `${enter.colliders} interior colliders`);
check('interior has its own floor and stays enclosed', walked.indoors && walked.y === enter.y,
  `y=${walked.y}`);

// ---- leaving by walking out ---------------------------------------------
const left = await page.evaluate(async () => {
  const g = window.game;
  const o = g.interiors.origin;
  const d = g.interiors.active.doorAt;
  // Face the doorway and walk through it.
  g.player.cameraYaw = Math.atan2(
    -(d.x - (g.player.position.x - o.x)), -(d.z - (g.player.position.z - o.z)));
  g.input.setVirtual('KeyW', true);
  for (let i = 0; i < 12 && g.player.indoors; i++) await new Promise((r) => setTimeout(r, 400));
  g.input.setVirtual('KeyW', false);
  await new Promise((r) => setTimeout(r, 300));
  return { indoors: g.player.indoors, y: g.player.position.y, mode: g.mode };
});
check('walking out the door returns to the street', !left.indoors && left.y === 0,
  `y=${left.y}`);

// ---- combat --------------------------------------------------------------
await page.evaluate(async () => {
  const g = window.game;
  const rp = g.world.randomRoadPoint();
  g.teleport(rp.x, rp.z, 0, rp.yaw);
  g.player.health = g.player.maxHealth;
  for (let i = 0; i < 5; i++) {
    await g.agents.create('skeleton', g.player.position.x + 2 + i, g.player.position.z + 2, 0,
      { controlMode: 'auto', faction: 'gang' });
  }
});
// The gang has to walk to the player before it can hit them, and under
// software rendering that walk takes a variable number of frames. Poll for
// the damage rather than trusting one fixed wait.
const fought = await (async () => {
  const deadline = Date.now() + 60000;
  let state = await page.evaluate(() => ({
    hp: window.game.player.health,
    events: window.game.combat.events.length,
    police: window.game.agents.factions.police,
  }));
  while (Date.now() < deadline && state.hp >= 100 && state.events === 0) {
    await new Promise((r) => setTimeout(r, 1500));
    state = await page.evaluate(() => ({
      hp: window.game.player.health,
      events: window.game.combat.events.length,
      police: window.game.agents.factions.police,
    }));
  }
  return state;
})();
check('AI gang attacks the player and deals damage', fought.hp < 100 || fought.events > 0,
  `hp=${fought.hp} events=${fought.events}`);

const crime = await page.evaluate(async () => {
  const g = window.game;
  g.player.health = g.player.maxHealth;
  g.police.units.length = 0;
  g.police.cooldown = 0;
  // Shoot a gang member dead; a public killing is what summons the police.
  const gang = g.agents.agents.find((a) => a.faction === 'gang' && !a.dead);
  if (gang) g.combat.damage(gang, 1000, { attacker: g.player, kind: 'ranged' });
  await new Promise((r) => setTimeout(r, 4000));
  return { police: g.agents.factions.police, units: g.police.units.length };
});
check('police respond when the player commits a crime', crime.police > 0 || crime.units > 0,
  `police=${crime.police}`);

// ---- death and respawn ---------------------------------------------------
const died = await page.evaluate(async () => {
  const g = window.game;
  g.combat.damage(g.player, 1000, { kind: 'test' });
  await new Promise((r) => setTimeout(r, 600));
  const deadState = { dead: g.player.dead, mode: g.mode };
  g.respawn();
  await new Promise((r) => setTimeout(r, 600));
  return { deadState, after: { dead: g.player.dead, hp: g.player.health, mode: g.mode } };
});
check('player dies and can respawn', died.deadState.dead && !died.after.dead && died.after.hp === 100,
  JSON.stringify(died));

const fps = await page.evaluate(() => Math.round(window.game.stats().fps));
const perf = await page.evaluate(() => {
  const i = window.game.renderer.info;
  return { calls: i.render.calls, tris: i.render.triangles };
});
check('runtime is free of errors', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
console.log(`INFO  ${fps} fps (software renderer)  draw calls=${perf.calls}  triangles=${perf.tris}`);

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
