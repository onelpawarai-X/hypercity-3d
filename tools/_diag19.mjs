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

  // The user-facing scenario: stand outside a building, walk straight at the
  // wall in small steps, and see whether the walk ever ends up inside.
  let tested=0, breached=0, stuck=0, examples=[];
  for (const bld of g.world.buildings) {
    if (tested >= 120) break;
    const w = bld.maxX-bld.minX, d = bld.maxZ-bld.minZ;
    if (w < 6 || d < 6) continue;
    // approach the west face along +x, starting 3 m clear of the bbox
    const cz = (bld.minZ+bld.maxZ)/2;
    const startX = bld.minX - 3;
    if (pip(startX, cz, bld.ring)) continue;   // bbox centre line is outside the ring; skip odd shapes
    let cur = { x: startX, z: cz };
    let steps = 0;
    for (; steps < 80; steps++) {
      const nx = cur.x + 0.12, nz = cur.z;
      const r = g.world.resolveCollision(nx, nz, R);
      // never step into the wall
      if (pip(r.x, r.z, bld.ring)) { breached++; if (examples.length<3) examples.push({id:bld.id, at:[+r.x.toFixed(1),+r.z.toFixed(1)]}); break; }
      // stop once the position stops advancing (blocked by the wall)
      if (Math.abs(r.x - cur.x) < 0.01) break;
      cur = r;
    }
    tested++;
    // the player should end up roughly one radius short of the wall
    const gap = Math.abs(cur.x - bld.minX);
    if (gap < 0.05) stuck++;
  }
  return { tested, breached, examples, reachedTheWall: tested - stuck };
});
console.log('WALK_INTO_WALL', JSON.stringify(out, null, 1));
await b.close();
