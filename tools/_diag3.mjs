import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,4000));

const out = await p.evaluate(async () => {
  const g = window.game;
  const r = {};
  const THREE = g.scene.constructor; // not helpful; use player's raycaster if any

  // 1) ground under player: raycast straight down from 50m
  const rp = g.world.randomRoadPoint();
  g.teleport(rp.x, rp.z, 0, rp.yaw);
  await new Promise(res => setTimeout(res, 1200));

  r.roadPoint = { x: +rp.x.toFixed(1), z: +rp.z.toFixed(1) };

  // 2) walk INTO a building wall: find nearest building, aim at its centre, push forward
  let best = null, bestD = Infinity;
  const px = g.player.position.x, pz = g.player.position.z;
  for (const bld of g.world.buildings) {
    const cx = (bld.minX+bld.maxX)/2, cz = (bld.minZ+bld.maxZ)/2;
    const d = Math.hypot(cx-px, cz-pz);
    if (d > 5 && d < bestD) { bestD = d; best = { bld, cx, cz, d }; }
  }
  r.nearestBuilding = best ? { id: best.bld.id, d: +best.d.toFixed(1), size: [+(best.bld.maxX-best.bld.minX).toFixed(1), +(best.bld.maxZ-best.bld.minZ).toFixed(1)], height: best.bld.height } : null;

  if (best) {
    // stand just outside and walk straight at the wall for 3 seconds
    const dx = best.cx - px, dz = best.cz - pz;
    const len = Math.hypot(dx,dz);
    const sx = px + (dx/len)*2, sz = pz + (dz/len)*2;
    g.player.position.set(sx, 0, sz);
    const yaw = Math.atan2(dx, dz);
    g.player.cameraYaw = yaw;
    g.player.setIntent({ x: 0, z: 1, run: true, jump: false, yaw: null });
    const before = { x: sx, z: sz };
    await new Promise(res => setTimeout(res, 3000));
    const after = { x: g.player.position.x, z: g.player.position.z };
    const bld = best.bld;
    const inside = after.x > bld.minX && after.x < bld.maxX && after.z > bld.minZ && after.z < bld.maxZ;
    r.wallTest = {
      before: { x:+before.x.toFixed(1), z:+before.z.toFixed(1) },
      after: { x:+after.x.toFixed(1), z:+after.z.toFixed(1) },
      moved: +Math.hypot(after.x-before.x, after.z-before.z).toFixed(1),
      buildingBox: { minX:+bld.minX.toFixed(1), maxX:+bld.maxX.toFixed(1), minZ:+bld.minZ.toFixed(1), maxZ:+bld.maxZ.toFixed(1) },
      ENDED_INSIDE_BUILDING: inside,
    };
    g.player.setIntent({ x:0, z:0, run:false, jump:false, yaw:null });
  }
  return r;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
