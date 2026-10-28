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
  let sampled=0, stuckInside=0, examples=[];
  for (const bld of g.world.buildings) {
    if (bld.maxX-bld.minX < 8 || bld.maxZ-bld.minZ < 8) continue;
    const cx=(bld.minX+bld.maxX)/2, cz=(bld.minZ+bld.maxZ)/2;
    // only test points that really are inside this building's ring
    if (!g.world.buildingAt(cx, cz, 0.5)) continue;
    const r = g.world.resolveCollision(cx, cz, R);
    const stillIn = g.world.buildingAt(r.x, r.z, 0.05);
    sampled++;
    if (stillIn) { stuckInside++; if (examples.length<3) examples.push({id:bld.id, size:[+(bld.maxX-bld.minX).toFixed(1),+(bld.maxZ-bld.minZ).toFixed(1)], endedAt:[+r.x.toFixed(1),+r.z.toFixed(1)]}); }
    if (sampled >= 200) break;
  }
  return { sampled, stillInsideAfterEject: stuckInside, examples };
});
console.log('OUTDOOR_EJECT', JSON.stringify(out));
await b.close();
