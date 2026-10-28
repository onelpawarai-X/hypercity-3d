import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,4000));
const hold = async (keys, ms) => {
  await p.evaluate(k => k.forEach(x => window.game.input.setVirtual(x, true)), keys);
  await new Promise(r => setTimeout(r, ms));
  await p.evaluate(k => k.forEach(x => window.game.input.setVirtual(x, false)), keys);
};

// ===== OUTDOOR WALL TEST (correct yaw: forward = (-sin, -cos)) =====
await p.evaluate(() => { const g=window.game; const rp=g.world.randomRoadPoint(); g.teleport(rp.x,rp.z,0,rp.yaw); });
await new Promise(r=>setTimeout(r,1500));
const setup = await p.evaluate(() => {
  const g = window.game;
  const px=g.player.position.x, pz=g.player.position.z;
  let best=null,bd=Infinity;
  for (const bld of g.world.buildings) {
    const cx=(bld.minX+bld.maxX)/2, cz=(bld.minZ+bld.maxZ)/2;
    const d=Math.hypot(cx-px,cz-pz);
    if (d>8 && d<bd) { bd=d; best={id:bld.id,minX:bld.minX,maxX:bld.maxX,minZ:bld.minZ,maxZ:bld.maxZ,h:bld.height}; }
  }
  const cx=(best.minX+best.maxX)/2, cz=(best.minZ+best.maxZ)/2;
  const dx=cx-px, dz=cz-pz, len=Math.hypot(dx,dz);
  g.player.position.set(px+dx/len*3, 0, pz+dz/len*3);
  g.player.cameraYaw = Math.atan2(-dx, -dz);
  window.__b = best;
  return { building:{w:+(best.maxX-best.minX).toFixed(1),d:+(best.maxZ-best.minZ).toFixed(1),h:best.h},
           start:{x:+g.player.position.x.toFixed(1),z:+g.player.position.z.toFixed(1)},
           distToWall:+ (bd-3).toFixed(1) };
});
await hold(['KeyW'], 6000);
const wall = await p.evaluate(() => {
  const g=window.game, b=window.__b;
  const a={x:g.player.position.x,z:g.player.position.z};
  const closest = { x: Math.max(b.minX, Math.min(a.x, b.maxX)), z: Math.max(b.minZ, Math.min(a.z, b.maxZ)) };
  return { end:{x:+a.x.toFixed(1),z:+a.z.toFixed(1)},
    INSIDE: a.x>b.minX&&a.x<b.maxX&&a.z>b.minZ&&a.z<b.maxZ,
    penetration: +Math.hypot(a.x-closest.x, a.z-closest.z).toFixed(2) };
});
console.log('OUTDOOR_WALL', JSON.stringify({setup, wall}));

// ===== INTERIOR WALL TEST: walk at a wall from inside =====
const inner = await p.evaluate(async () => {
  const g=window.game;
  let found=null;
  for (const b of g.world.buildings) {
    if (g.world.buildingAt((b.minX+b.maxX)/2,(b.minZ+b.maxZ)/2,8)) { found=b; break; }
  }
  g._enterInterior(found);
  await new Promise(r=>setTimeout(r,1000));
  const it=g.interiors.active;
  // face the wall opposite the door and push
  const o = {north:[0,-1],south:[0,1],west:[-1,0],east:[1,0]}[it.doorSide];
  g.player.cameraYaw = Math.atan2(o[0], o[1]); // away from door, into the far wall
  window.__it = { bounds: it.bounds, doorSide: it.doorSide };
  return { doorSide: it.doorSide, bounds: it.bounds, colliders: it.colliders.length };
});
await hold(['KeyW'], 5000);
const iwall = await p.evaluate(() => {
  const g=window.game, it=window.__it, b=it.bounds;
  const a={x:g.player.position.x,z:g.player.position.z};
  return { end:{x:+a.x.toFixed(1),z:+a.z.toFixed(1)},
    ESCAPED_ROOM: a.x<b.x0-0.3||a.x>b.x1+0.3||a.z<b.z0-0.3||a.z>b.z1+0.3,
    bounds:{x0:+b.x0.toFixed(1),x1:+b.x1.toFixed(1),z0:+b.z0.toFixed(1),z1:+b.z1.toFixed(1)} };
});
console.log('INTERIOR_WALL', JSON.stringify({inner, iwall}));
await b.close();
