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
  const pip = (x,z,ring)=>{ let ins=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){ const xi=ring[i][0],zi=ring[i][1],xj=ring[j][0],zj=ring[j][1];
      if((zi>z)!==(zj>z) && x < ((xj-xi)*(z-zi))/(zj-zi)+xi) ins=!ins; } return ins; };
  let sampled=0, stuckSameBuilding=0, examples=[];
  for (const bld of g.world.buildings) {
    if (bld.maxX-bld.minX < 8 || bld.maxZ-bld.minZ < 8) continue;
    const cx=(bld.minX+bld.maxX)/2, cz=(bld.minZ+bld.maxZ)/2;
    if (!pip(cx, cz, bld.ring)) continue;   // genuinely inside THIS building
    const r = g.world.resolveCollision(cx, cz, R);
    sampled++;
    if (pip(r.x, r.z, bld.ring)) {
      stuckSameBuilding++;
      if (examples.length<5) {
        // how far did it travel, and how deep is the building?
        const depth = Math.min(bld.maxX-bld.minX, bld.maxZ-bld.minZ);
        examples.push({ id:bld.id, size:[+(bld.maxX-bld.minX).toFixed(1),+(bld.maxZ-bld.minZ).toFixed(1)],
          moved:+Math.hypot(r.x-cx, r.z-cz).toFixed(2), thinAxis:+depth.toFixed(1) });
      }
    }
    if (sampled>=200) break;
  }
  return { sampled, stillInsideSameBuilding: stuckSameBuilding, examples };
});
console.log('EJECT_SAME_BUILDING', JSON.stringify(out, null, 1));
await b.close();
