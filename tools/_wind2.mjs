import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
const missing=[]; p.on('response', r => { if (r.status()>=400) missing.push(r.status()+' '+r.url()); });
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,6000));
// park the camera right next to a tree cluster and take two shots
await p.evaluate(() => {
  const g = window.game;
  const tiles = g.world.scatter.filter(s => s.mesh.name?.startsWith('trees_'));
  // nearest tile to spawn
  let best=tiles[0], bd=Infinity;
  for (const t of tiles) { const d=Math.hypot(t.center.x, t.center.z); if (d<bd){bd=d;best=t;} }
  const x = best.center.x + 6, z = best.center.z + 6;
  g.teleport(x, z, 0, Math.atan2(-(best.center.x-x), -(best.center.z-z)));
  window.__tree = {x:best.center.x, z:best.center.z, r:best.radius};
});
await new Promise(r=>setTimeout(r,2500));
await p.screenshot({path:'/tmp/wind-a.png'});
await new Promise(r=>setTimeout(r,2500));
await p.screenshot({path:'/tmp/wind-b.png'});
console.log('MISSING:', missing.length ? missing.slice(0,6) : 'none');
await b.close();
