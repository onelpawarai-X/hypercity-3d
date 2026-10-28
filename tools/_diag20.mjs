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

  // Definitive test: walk from 3 m west of the building straight through to
  // 3 m east of it. A solid wall means the walk stops at the west face; if the
  // player emerges on the east side, they passed through the building.
  let tested=0, tunnelled=0, stoppedAtWall=0, examples=[];
  for (const bld of g.world.buildings) {
    if (tested >= 150) break;
    const w = bld.maxX-bld.minX, d = bld.maxZ-bld.minZ;
    if (w < 6 || d < 6) continue;
    const cz = (bld.minZ+bld.maxZ)/2;
    const startX = bld.minX - 3, endX = bld.maxX + 3;
    if (pip(startX, cz, bld.ring)) continue;
    let cur = { x: startX, z: cz };
    let emerged = false;
    for (let i=0;i<400;i++) {
      const r = g.world.resolveCollision(cur.x + 0.1, cur.z, R);
      if (Math.abs(r.x - cur.x) < 1e-3) break;   // blocked, cannot advance
      cur = r;
      if (cur.x > endX) { emerged = true; break; }
    }
    tested++;
    if (emerged) { tunnelled++; if (examples.length<5) examples.push({id:bld.id, size:[+w.toFixed(1),+d.toFixed(1)]}); }
    else if (cur.x < bld.minX + 0.6) stoppedAtWall++;
  }
  return { tested, tunnelledThroughBuilding: tunnelled, stoppedAtWall, examples };
});
console.log('PASS_THROUGH_TEST', JSON.stringify(out, null, 1));
await b.close();
