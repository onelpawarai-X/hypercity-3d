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
// 1) OPEN-FIELD WALK SPEED
const w1 = await p.evaluate(() => {
  const g=window.game; const rp=g.world.randomRoadPoint();
  g.teleport(rp.x, rp.z, 0, rp.yaw);
  return { x:rp.x, z:rp.z, mode:g.player.mode };
});
await new Promise(r=>setTimeout(r,1500));
const before = await p.evaluate(() => ({x:window.game.player.position.x, z:window.game.player.position.z, mode:window.game.player.mode}));
await hold(['KeyW'], 4000);
const after = await p.evaluate(() => ({x:window.game.player.position.x, z:window.game.player.position.z}));
console.log('WALK_OPEN', JSON.stringify({
  mode: before.mode,
  moved: +Math.hypot(after.x-before.x, after.z-before.z).toFixed(2),
}));

// 2) RUN
await p.evaluate(() => { const g=window.game; const rp=g.world.randomRoadPoint(); g.teleport(rp.x,rp.z,0,rp.yaw); });
await new Promise(r=>setTimeout(r,1200));
const b2 = await p.evaluate(() => ({x:window.game.player.position.x, z:window.game.player.position.z}));
await hold(['KeyW','ShiftLeft'], 4000);
const a2 = await p.evaluate(() => ({x:window.game.player.position.x, z:window.game.player.position.z}));
console.log('RUN_OPEN', JSON.stringify({ moved: +Math.hypot(a2.x-b2.x, a2.z-b2.z).toFixed(2) }));

// 3) WALK INTO WALL from 10m out, on the side facing the player
await p.evaluate(() => { const g=window.game; const rp=g.world.randomRoadPoint(); g.teleport(rp.x,rp.z,0,rp.yaw); });
await new Promise(r=>setTimeout(r,1200));
const s3 = await p.evaluate(() => {
  const g=window.game; const px=g.player.position.x, pz=g.player.position.z;
  let best=null,bd=Infinity;
  for (const bld of g.world.buildings) {
    const cx=(bld.minX+bld.maxX)/2, cz=(bld.minZ+bld.maxZ)/2;
    const d=Math.hypot(cx-px,cz-pz);
    if (d>14 && d<bd){bd=d;best={minX:bld.minX,maxX:bld.maxX,minZ:bld.minZ,maxZ:bld.maxZ};}
  }
  const cx=(best.minX+best.maxX)/2, cz=(best.minZ+best.maxZ)/2;
  const dx=cx-px, dz=cz-pz, len=Math.hypot(dx,dz);
  g.player.position.set(px+dx/len*8, 0, pz+dz/len*8);
  g.player.cameraYaw = Math.atan2(-dx,-dz);
  window.__b=best;
  return { start:{x:+g.player.position.x.toFixed(1),z:+g.player.position.z.toFixed(1)} };
});
await hold(['KeyW','ShiftLeft'], 7000);
const w3 = await p.evaluate(() => {
  const g=window.game,b=window.__b; const a={x:g.player.position.x,z:g.player.position.z};
  const cx=Math.max(b.minX,Math.min(a.x,b.maxX)), cz=Math.max(b.minZ,Math.min(a.z,b.maxZ));
  const inside = a.x>b.minX&&a.x<b.maxX&&a.z>b.minZ&&a.z<b.maxZ;
  return { end:{x:+a.x.toFixed(1),z:+a.z.toFixed(1)}, movedFromStart:+Math.hypot(a.x-0,a.z-0).toFixed(0),
           distanceToBuilding:+Math.hypot(a.x-cx,a.z-cz).toFixed(2), INSIDE:inside };
});
console.log('WALL_APPROACH', JSON.stringify({s3, w3}));
await b.close();
