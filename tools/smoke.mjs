import puppeteer from 'puppeteer-core';

const URL = process.env.URL || 'http://localhost:12000/';
const errors = [];
const logs = [];

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  headless: 'shell',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-dev-shm-usage', '--window-size=1280,800',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

page.on('console', (m) => {
  const t = m.text();
  logs.push(`${m.type()}: ${t}`);
  if (m.type() === 'error') errors.push(t);
});
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => {
  const u = r.url();
  if (!u.startsWith('data:')) errors.push(`requestfailed: ${u} ${r.failure()?.errorText}`);
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });

// Wait for the loader to finish (the game object exposes its world).
await page.waitForFunction('window.game && window.game.world && window.game.player', { timeout: 180000 });
const loaded = await page.evaluate(() => ({
  buildings: window.game.world.buildings.length,
  roads: window.game.world.roadSegments.length,
  chunkMeshes: window.game.world.chunkStats.chunkMeshes,
  sourceMeshes: window.game.world.chunkStats.sourceMeshes,
  triangles: window.game.world.chunkStats.triangles,
  props: window.game.interiors.propNames.length,
  rigs: [...window.game.characterCache.keys()],
  quality: window.game.quality.tiers[window.game.quality.index],
}));
console.log('LOADED', JSON.stringify(loaded, null, 1));

await page.click('#start-btn');
await new Promise((r) => setTimeout(r, 2500));

// Walk forward, then attack, then enter a building.
await page.evaluate(() => {
  window.game.input.setVirtual('KeyW', true);
});
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => {
  window.game.input.setVirtual('KeyW', false);
  window.game.playerCombat.cycleWeapon();
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => { window.game.input.setVirtual('Mouse0', true); });
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => { window.game.input.setVirtual('Mouse0', false); });

// Force an interior entry on the nearest building, to exercise the interior path.
const interior = await page.evaluate(() => {
  const g = window.game;
  const b = g.world.buildingAt(g.player.position.x, g.player.position.z, 400)
    || g.world.buildings.find((x) => (x.maxX - x.minX) > 8 && (x.maxZ - x.minZ) > 8);
  if (!b) return { ok: false, reason: 'no building' };
  g._enterInterior(b);
  return {
    ok: g.player.indoors,
    colliders: g.interiors.active?.colliders.length ?? 0,
    props: g.interiors.active?.root.children.length ?? 0,
    pos: [g.player.position.x, g.player.position.y, g.player.position.z],
  };
});
console.log('INTERIOR', JSON.stringify(interior));
await new Promise((r) => setTimeout(r, 1200));

const inRoom = await page.evaluate(() => {
  const g = window.game;
  g.input.setVirtual('KeyW', true);
  return { y: g.player.position.y, indoors: g.player.indoors };
});
await new Promise((r) => setTimeout(r, 1200));
const afterRoom = await page.evaluate(() => {
  const g = window.game;
  g.input.setVirtual('KeyW', false);
  return { y: g.player.position.y, x: g.player.position.x, z: g.player.position.z };
});
console.log('ROOM_WALK', JSON.stringify({ inRoom, afterRoom }));

const exit = await page.evaluate(() => {
  const g = window.game;
  g._exitInterior();
  return { indoors: g.player.indoors, y: g.player.position.y, mode: g.mode };
});
console.log('EXIT', JSON.stringify(exit));

// Spawn a vehicle and drive it briefly.
const drive = await page.evaluate(async () => {
  const g = window.game;
  g._spawnVehicle('car');
  await new Promise((r) => setTimeout(r, 600));
  const v = g.vehicles.active[g.vehicles.active.length - 1];
  if (!v) return { ok: false };
  g._enterVehicle(v);
  g.input.setVirtual('KeyW', true);
  return { ok: true, mode: g.mode };
});
await new Promise((r) => setTimeout(r, 2000));
const afterDrive = await page.evaluate(() => {
  const g = window.game;
  g.input.setVirtual('KeyW', false);
  const s = { mode: g.mode, speed: g.currentVehicle?.speed ?? 0 };
  g._exitVehicle();
  return s;
});
console.log('DRIVE', JSON.stringify({ drive, afterDrive }));

// Spawn a gang squad next to the player and let the fight resolve.
const fight = await page.evaluate(async () => {
  const g = window.game;
  for (let i = 0; i < 6; i++) {
    g.agents.create(i % 2 ? 'skeleton' : 'skeletonMage',
      g.player.position.x + 8 + i * 2, g.player.position.z + 6, 0,
      { controlMode: 'auto', faction: 'gang' });
  }
  return { gang: g.agents.factions.gang };
});
await new Promise((r) => setTimeout(r, 9000));
const afterFight = await page.evaluate(() => {
  const g = window.game;
  return {
    gang: g.agents.factions.gang,
    police: g.agents.factions.police,
    playerHp: g.player.health,
    kills: g.player.kills,
    agents: g.agents.count,
    events: g.combat.events.length,
    dead: g.player.dead,
  };
});
console.log('FIGHT', JSON.stringify({ fight, afterFight }));

const stats = await page.evaluate(() => ({
  fps: Math.round(window.game.stats().fps),
  stats: window.game.stats(),
}));
console.log('STATS', JSON.stringify(stats.stats));

// Verify the interior furniture actually rendered by screenshotting inside.
await page.evaluate(() => {
  const g = window.game;
  const b = g.world.buildings.find((x) => (x.maxX - x.minX) > 10 && (x.maxZ - x.minZ) > 10);
  if (b) g._enterInterior(b);
  g.player.thirdPerson = false;
});
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: '/tmp/shot-interior.png' });
await page.evaluate(() => { window.game._exitInterior(); });
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: '/tmp/shot-city.png' });

console.log('ERRORS', errors.length);
for (const e of errors.slice(0, 25)) console.log('  !', e);

await browser.close();
process.exit(errors.length ? 1 : 0);
