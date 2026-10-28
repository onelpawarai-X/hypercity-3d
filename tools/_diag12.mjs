import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,4000));

const out = await p.evaluate(async () => {
  const g = window.game, R = 0.42;
  const res = {};

  // ---- OUTDOOR: every push from inside must land OUTSIDE ----
  const tests = [];
  let checked = 0, failures = 0;
  for (const bld of g.world.buildings) {
    if (checked >= 40) break;
    const w = bld.maxX-bld.minX, d = bld.maxZ-bld.minZ;
    if (w < 8 || d < 8) continue;
    const cx=(bld.minX+bld.maxX)/2, cz=(bld.minZ+bld.maxZ)/2;
    const r = g.world.resolveCollision(cx, cz, R);
    const stillInside = r.x>bld.minX && r.x<bld.maxX && r.z>bld.minZ && r.z<bld.maxZ;
    checked++;
    if (stillInside) { failures++; if (tests.length<3) tests.push({id:bld.id, size:[+w.toFixed(1),+d.toFixed(1)]}); }
  }
  res.outdoorEject = { checked, stillInsideAfterEject: failures, examples: tests };

  // ---- INTERIOR: doorway must be the only way out ----
  let found=null;
  for (const bd of g.world.buildings) { if (g.world.buildingAt((bd.minX+bd.maxX)/2,(bd.minZ+bd.maxZ)/2,8)) { found=bd; break; } }
  g._enterInterior(found);
  await new Promise(r=>setTimeout(r,800));
  const it = g.interiors.active, bd = it.bounds, d = it.doorAt;
  const dirs = { north:[0,-1], south:[0,1], west:[-1,0], east:[1,0] };
  const o = dirs[it.doorSide];
  const isHoriz = it.doorSide==='north'||it.doorSide==='south';
  const doorTests = {};

  // a) stand inside 1.2m from the door, walk straight at it
  const insideX = d.x - o[0]*1.2, insideZ = d.z - o[1]*1.2;
  const step = 0.25;
  let cur = { x: insideX, z: insideZ };
  for (let i=0;i<40;i++) {
    const r = g.interiors.resolveCollision(cur.x + o[0]*step, cur.z + o[1]*step, R);
    cur = r;
  }
  doorTests.walkOutThroughDoor = {
    endedAt:{x:+cur.x.toFixed(1), z:+cur.z.toFixed(1)},
    steppedOut: cur.x<bd.x0-0.15||cur.x>bd.x1+0.15||cur.z<bd.z0-0.15||cur.z>bd.z1+0.15,
  };

  // b) walk straight at a SOLID wall 1.2m away (the one opposite the door)
  const oppX = d.x + o[0]*1.2, oppZ = d.z + o[1]*1.2;
  let c2 = { x: oppX, z: oppZ };
  for (let i=0;i<40;i++) c2 = g.interiors.resolveCollision(c2.x - o[0]*step, c2.z - o[1]*step, R);
  doorTests.walkIntoOppositeWall = {
    endedAt:{x:+c2.x.toFixed(1), z:+c2.z.toFixed(1)},
    escaped: c2.x<bd.x0-0.15||c2.x>bd.x1+0.15||c2.z<bd.z0-0.15||c2.z>bd.z1+0.15,
  };
  res.interiorDoor = { doorSide: it.doorSide, bounds:{x0:+bd.x0.toFixed(1),x1:+bd.x1.toFixed(1),z0:+bd.z0.toFixed(1),z1:+bd.z1.toFixed(1)}, ...doorTests };

  // ---- FURNITURE inside the room ----
  res.interiorContents = {
    meshes: it.root.children.filter(c=>c.isMesh).length,
    colliders: it.colliders.length,
    props: (window.game.interiorProps ? Object.keys(window.game.interiorProps).length : 'n/a'),
  };
  return res;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
