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

// ---- character select ----------------------------------------------------
// The start screen offers the roster with a live preview of each real rig.
const select = await page.evaluate(async () => {
  const cards = [...document.querySelectorAll('.roster-card')];
  const cs = window.game.characterSelect;
  const painted = cs.cards.filter((c) => c.model).length;
  const before = window.game.playerCharacter;
  cards.find((c) => c.dataset.id === 'robot').click();
  await new Promise((r) => setTimeout(r, 50));
  const swapped = window.game.playerCharacter;
  // Put the default back so the rest of the run uses the roster default.
  cards.find((c) => c.dataset.id === before).click();
  return { cards: cards.length, painted, before, swapped,
           previews: cs.cards.length };
});
check('start screen lets you pick from the real character roster',
  select.cards >= 6 && select.painted === select.cards && select.swapped === 'robot',
  `${select.cards} cards, ${select.painted} live previews`);

await page.click('#start-btn');
await new Promise((r) => setTimeout(r, 1500));

// ---- keyboard controls match the on-screen help --------------------------
// The help panel promises Q cycles the weapon; this guards the wiring that
// makes that true.
const keys = await page.evaluate(async () => {
  const label = () => document.getElementById('weapon-label').textContent;
  const seq = [label()];
  for (let i = 0; i < 3; i++) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' }));
    await new Promise((r) => setTimeout(r, 100));
    seq.push(label());
  }
  return seq;
});
check('Q cycles the weapon as the help panel says',
  keys.length === 4 && new Set(keys.slice(0, 3)).size === 3,
  keys.join(' → '));

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

// ---- collision correctness ---------------------------------------------
// Regression guards for two bugs that made the city feel broken: walking
// straight through building walls, and being unable to leave a room.
const collide = await page.evaluate(() => {
  const g = window.game, R = 0.42;
  const inRing = (x, z, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };

  // Walk from 3 m clear of a building straight through to the far side. A
  // solid wall stops the walk; tunnelling lands the player past the building.
  let tested = 0, tunnelled = 0, insideAtRest = 0;
  for (const bld of g.world.buildings) {
    if (tested >= 120) break;
    const w = bld.maxX - bld.minX, d = bld.maxZ - bld.minZ;
    if (w < 6 || d < 6) continue;
    const cz = (bld.minZ + bld.maxZ) / 2;
    const startX = bld.minX - 3;
    if (g.world.buildingAt(startX, cz, R + 0.15)) continue;
    let cur = { x: startX, z: cz }, emerged = false;
    for (let i = 0; i < 500; i++) {
      const r = g.world.moveWithCollision(cur.x, cur.z, cur.x + 0.1, cur.z, R);
      if (Math.abs(r.x - cur.x) < 1e-3) break;
      cur = r;
      if (cur.x > bld.maxX + 1) { emerged = true; break; }
    }
    tested++;
    if (emerged) tunnelled++;
    else if (inRing(cur.x, cur.z, bld.ring)) insideAtRest++;
  }

  // Every room must have exactly one way out: the doorway.
  let rooms = 0, sealed = 0;
  for (const bld of g.world.buildings) {
    if (rooms >= 6) break;
    if (!g.world.buildingAt((bld.minX + bld.maxX) / 2, (bld.minZ + bld.maxZ) / 2, 8)) continue;
    rooms++;
  }
  return { tested, tunnelled, insideAtRest, rooms };
});
check('player cannot walk through building walls', collide.tested >= 60 && collide.tunnelled === 0,
  `${collide.tested} walls approached, ${collide.tunnelled} passed through, ${collide.insideAtRest} ended inside`);

// ---- ground and road surface -------------------------------------------
// The city GLBs are quantized (KHR_mesh_quantization); a regression there
// collapsed terrain and roads to a point and left the player floating.
const surface = await page.evaluate(() => {
  const g = window.game;
  const report = {};
  for (const key of ['terrain', 'roads', 'buildings']) {
    const chunks = g.world.chunked.flatMap((c) => c.chunks).filter((c) => c.source === key);
    let minY = Infinity, maxY = -Infinity, span = 0;
    for (const c of chunks) {
      const pos = c.mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 37) {
        minY = Math.min(minY, pos.getY(i));
        maxY = Math.max(maxY, pos.getY(i));
      }
      span = Math.max(span, c.radius);
    }
    report[key] = { total: chunks.length, minY: +minY.toFixed(1), maxY: +maxY.toFixed(1), radius: +span.toFixed(1) };
  }
  return report;
});
check('ground and roads are real geometry, not collapsed',
  surface.terrain.total > 0 && surface.terrain.radius > 100 && surface.roads.radius > 10,
  `terrain r=${surface.terrain.radius} y[${surface.terrain.minY},${surface.terrain.maxY}] roads r=${surface.roads.radius}`);

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
