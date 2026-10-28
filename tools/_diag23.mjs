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
  // 1) normal walking in the open still moves a full step per tick
  const rp = g.world.randomRoadPoint();
  let moved = 0, blocked = 0;
  let cur = { x: rp.x, z: rp.z };
  const yaw = rp.yaw;
  const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  for (let i=0;i<60;i++) {
    const to = { x: cur.x + fwd.x*0.08, z: cur.z + fwd.z*0.08 };
    const r = g.world.moveWithCollision(cur.x, cur.z, to.x, to.z, R);
    const step = Math.hypot(r.x-cur.x, r.z-cur.z);
    if (step > 0.001) moved += step; else blocked++;
    cur = r;
  }
  res.openWalk = { travelled:+moved.toFixed(1), blockedTicks: blocked };

  // 2) sliding: walk diagonally into a wall, must slide along it
  let bld = null;
  for (const b of g.world.buildings) {
    if (b.maxX-b.minX > 10 && b.maxZ-b.minZ > 10) { bld = b; break; }
  }
  // stand 1m west of the west face, then push north-east into it
  let c2 = { x: bld.minX - 1.0, z: (bld.minZ+bld.maxZ)/2 };
  const z0 = c2.z;
  for (let i=0;i<200;i++) {
    const r = g.world.moveWithCollision(c2.x, c2.z, c2.x + 0.06, c2.z + 0.06, R);
    c2 = r;
  }
  res.slideAlongWall = { slidNorth:+Math.abs(c2.z - z0).toFixed(1), pushedIntoWall:+Math.abs(c2.x-(bld.minX-1.0)).toFixed(2) };

  // 3) walking inside an interior still works and walls hold
  let found=null;
  for (const bd of g.world.buildings) { if (g.world.buildingAt((bd.minX+bd.maxX)/2,(bd.minZ+bd.maxZ)/2,8)) { found=bd; break; } }
  g._enterInterior(found);
  await new Promise(r=>setTimeout(r,700));
  const it = g.interiors.active, bd = it.bounds;
  const d = it.doorAt;
  const dirs = { north:[0,-1], south:[0,1], west:[-1,0], east:[1,0] };
  const o = dirs[it.doorSide];
  let c3 = { x: d.x - o[0]*1.0, z: d.z - o[1]*1.0 };
  for (let i=0;i<60;i++) c3 = g.interiors.resolveCollision(c3.x + o[0]*0.2, c3.z + o[1]*0.2, R);
  res.interiorExit = { x:+c3.x.toFixed(1), z:+c3.z.toFixed(1), out: c3.x<bd.x0-0.15||c3.x>bd.x1+0.15||c3.z<bd.z0-0.15||c3.z>bd.z1+0.15 };
  return res;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
