import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,4000));

// pick a spot with NO building within 40m
const spot = await p.evaluate(() => {
  const g = window.game;
  for (let i=0;i<400;i++) {
    const rp = g.world.randomRoadPoint();
    const near = g.world.buildingGrid.query(rp.x, rp.z, 45);
    if (near.length === 0) { g.teleport(rp.x, rp.z, 0, rp.yaw); window.__spot=rp; return {x:+rp.x.toFixed(1),z:+rp.z.toFixed(1),nearBuildings:0}; }
  }
  return null;
});
console.log('SPOT', JSON.stringify(spot));
await new Promise(r=>setTimeout(r,1500));

const samples = await p.evaluate(async () => {
  const g = window.game;
  const out = [];
  const t0 = performance.now();
  const p0 = { x: g.player.position.x, z: g.player.position.z };
  g.input.setVirtual('KeyW', true);
  for (let i=0;i<12;i++) {
    await new Promise(r=>setTimeout(r,400));
    out.push({
      t: +((performance.now()-t0)/1000).toFixed(1),
      moved: +Math.hypot(g.player.position.x-p0.x, g.player.position.z-p0.z).toFixed(2),
      speed: +g.player.moving.toFixed(2),
      vel: +Math.hypot(g.player.velocity.x, g.player.velocity.z).toFixed(2),
      mode: g.player.mode, dead: g.player.dead,
      y: +g.player.position.y.toFixed(2),
    });
  }
  g.input.setVirtual('KeyW', false);
  return out;
});
console.log('SAMPLES');
for (const s of samples) console.log('  ', JSON.stringify(s));
await b.close();
