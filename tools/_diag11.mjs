import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,4000));

// Deterministic collision tests - no frame-rate dependence.
const out = await p.evaluate(async () => {
  const g = window.game, R = 0.42;
  const res = {};

  // --- OUTDOOR: push a point deep inside a real building footprint ---
  let bld = null;
  for (const b of g.world.buildings) {
    if (b.maxX-b.minX > 12 && b.maxZ-b.minZ > 12) { bld = b; break; }
  }
  const cx = (bld.minX+bld.maxX)/2, cz = (bld.minZ+bld.maxZ)/2;
  const pushed = g.world.resolveCollision(cx, cz, R);
  res.outdoor = {
    buildingBox: {minX:+bld.minX.toFixed(1),maxX:+bld.maxX.toFixed(1),minZ:+bld.minZ.toFixed(1),maxZ:+bld.maxZ.toFixed(1)},
    centrePushedTo: {x:+pushed.x.toFixed(1), z:+pushed.z.toFixed(1)},
    stillInside: pushed.x>bld.minX && pushed.x<bld.maxX && pushed.z>bld.minZ && pushed.z<bld.maxZ,
  };
  // push from 0.1m inside the near wall
  const near = g.world.resolveCollision(bld.minX+0.1, cz, R);
  res.outdoorFromEdge = { x:+near.x.toFixed(1), stillInside: near.x>bld.minX && near.x<bld.maxX };

  // --- INTERIOR: try to push through each of the 4 walls ---
  let found=null;
  for (const b of g.world.buildings) { if (g.world.buildingAt((b.minX+b.maxX)/2,(b.minZ+b.maxZ)/2,8)) { found=b; break; } }
  g._enterInterior(found);
  await new Promise(r=>setTimeout(r,800));
  const it = g.interiors.active, bd = it.bounds;
  const trials = {
    north: [ (bd.x0+bd.x1)/2, bd.z0 - 3 ],
    south: [ (bd.x0+bd.x1)/2, bd.z1 + 3 ],
    west:  [ bd.x0 - 3, (bd.z0+bd.z1)/2 ],
    east:  [ bd.x1 + 3, (bd.z0+bd.z1)/2 ],
  };
  const o = g.interiors.origin;
  const out2 = {};
  for (const [k, [x,z]] of Object.entries(trials)) {
    const r = g.interiors.resolveCollision(x, z, R);
    out2[k] = { pushedTo:{x:+r.x.toFixed(1), z:+r.z.toFixed(1)}, escaped: r.x<bd.x0-0.3||r.x>bd.x1+0.3||r.z<bd.z0-0.3||r.z>bd.z1+0.3 };
  }
  res.interior = { doorSide: it.doorSide, bounds:{x0:+bd.x0.toFixed(1),x1:+bd.x1.toFixed(1),z0:+bd.z0.toFixed(1),z1:+bd.z1.toFixed(1)}, walls: out2 };

  // --- INTERIOR: can the player leave ONLY via the doorway? ---
  const d = it.doorAt;
  const throughDoor = g.interiors.resolveCollision(d.x, d.z + (it.doorSide==='south'? 2.5 : it.doorSide==='north'? -2.5 : 0), R);
  res.doorwayPassable = it.doorSide==='east'||it.doorSide==='west'
    ? Math.abs(throughDoor.x - d.x) > 1.0
    : Math.abs(throughDoor.z - d.z) > 1.0;
  return res;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
