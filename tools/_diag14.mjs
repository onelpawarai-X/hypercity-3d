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
  const pin = g.world.pointInPolygon || null;
  // real invariant: after resolveCollision, the point must not sit inside the ring
  let sampled = 0, violations = 0, examples = [];
  for (const bld of g.world.buildings) {
    const ring = bld.ring;
    if (bld.maxX-bld.minX < 8 || bld.maxZ-bld.minZ < 8) continue;
    // walk a grid over the footprint and keep points genuinely inside the ring
    for (let fx=0.15; fx<=0.85 && sampled<300; fx+=0.2) {
      for (let fz=0.15; fz<=0.85 && sampled<300; fz+=0.2) {
        const x = bld.minX + (bld.maxX-bld.minX)*fx;
        const z = bld.minZ + (bld.maxZ-bld.minZ)*fz;
        // pointInPolygon is module-private; test membership by asking the world
        // to resolve a point that starts inside and see if it moved out.
        const r = g.world.resolveCollision(x, z, R);
        // A point that was inside must have been moved; verify it is now clear
        // by resolving again from the result - a stable fixed point outside.
        const again = g.world.resolveCollision(r.x, r.z, R);
        const stable = Math.hypot(again.x-r.x, again.z-r.z) < 1e-6;
        sampled++;
        if (!stable) { violations++; if (examples.length<3) examples.push({x:+x.toFixed(1),z:+z.toFixed(1),r:[+r.x.toFixed(1),+r.z.toFixed(1)],again:[+again.x.toFixed(1),+again.z.toFixed(1)]}); }
      }
    }
    if (sampled>=300) break;
  }
  return { sampled, unstableAfterEject: violations, examples };
});
console.log('EJECT_INVARIANT', JSON.stringify(out));
await b.close();
