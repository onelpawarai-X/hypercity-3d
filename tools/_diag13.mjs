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
  let found=null;
  for (const bd of g.world.buildings) { if (g.world.buildingAt((bd.minX+bd.maxX)/2,(bd.minZ+bd.maxZ)/2,8)) { found=bd; break; } }
  g._enterInterior(found);
  await new Promise(r=>setTimeout(r,800));
  const it = g.interiors.active, bd = it.bounds, d = it.doorAt;
  const o = { north:[0,-1], south:[0,1], west:[-1,0], east:[1,0] }[it.doorSide];
  const half = (it.doorWidth ?? 1.6)/2;
  const trace = [];
  let cur = { x: d.x - o[0]*1.2, z: d.z - o[1]*1.2 };
  for (let i=0;i<12;i++) {
    const nx = cur.x + o[0]*0.25, nz = cur.z + o[1]*0.25;
    const r = g.interiors.resolveCollision(nx, nz, R);
    // reproduce the doorway predicate on the *input* point
    const inDoorway = d.horizontal
      ? Math.abs(nz - d.z) < 0.9 && Math.abs(nx - d.x) < half - R*0.5
      : Math.abs(nx - d.x) < 0.9 && Math.abs(nz - d.z) < half - R*0.5;
    trace.push({ i, in:{x:+nx.toFixed(2),z:+nz.toFixed(2)}, out:{x:+r.x.toFixed(2),z:+r.z.toFixed(2)}, inDoorway });
    cur = r;
  }
  return {
    doorSide: it.doorSide, doorAt: d, half, radius: R,
    bounds: {x0:+bd.x0.toFixed(2),x1:+bd.x1.toFixed(2),z0:+bd.z0.toFixed(2),z1:+bd.z1.toFixed(2)},
    colliders: it.colliders.map(c=>({minX:+c.minX.toFixed(2),maxX:+c.maxX.toFixed(2),minZ:+c.minZ.toFixed(2),maxZ:+c.maxZ.toFixed(2),h:+c.height.toFixed(2)})),
    trace,
  };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
