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
  const clear = (x,z) => !g.world.buildingAt(x, z, R + 0.15);

  let tested=0, emergedPast=0, emergedWithNoWallCrossing=0, realBreaches=0;
  const real=[];

  for (const bld of g.world.buildings) {
    if (tested >= 150) break;
    const w = bld.maxX-bld.minX, d = bld.maxZ-bld.minZ;
    if (w < 6 || d < 6) continue;
    const cz = (bld.minZ+bld.maxZ)/2;
    const startX = bld.minX - 3;
    if (!clear(startX, cz)) continue;

    // Does the straight path cross this building's footprint at all?
    let pathCrosses = false;
    for (let x = startX; x <= bld.maxX + 3; x += 0.05) {
      if (pip(x, cz, bld.ring)) { pathCrosses = true; break; }
    }

    let cur = { x: startX, z: cz }, emerged = false;
    for (let i=0;i<500;i++) {
      const r = g.world.moveWithCollision(cur.x, cur.z, cur.x + 0.1, cur.z, R);
      if (Math.abs(r.x - cur.x) < 1e-3) break;
      cur = r;
      if (cur.x > bld.maxX + 1) { emerged = true; break; }
    }
    tested++;
    if (emerged) {
      emergedPast++;
      if (!pathCrosses) emergedWithNoWallCrossing++;
      else { realBreaches++; if (real.length<5) real.push({id:bld.id,size:[+w.toFixed(1),+d.toFixed(1)],pts:bld.ring.length}); }
    }
  }
  return { tested, emergedPast, emergedButPathNeverEnteredBuilding: emergedWithNoWallCrossing, realWallBreaches: realBreaches, real };
});
console.log('DEFINITIVE', JSON.stringify(out, null, 1));
await b.close();
