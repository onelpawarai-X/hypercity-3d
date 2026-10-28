import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,6000));
const out = await p.evaluate(() => {
  const g = window.game;
  const info = [];
  for (const s of g.world.scatter) {
    if (!s.mesh.name?.startsWith('trees_')) continue;
    const geo = s.mesh.geometry;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    info.push({ name: s.mesh.name, minY:+bb.min.y.toFixed(2), maxY:+bb.max.y.toFixed(2),
                sizeY:+(bb.max.y-bb.min.y).toFixed(2), count: s.mesh.count,
                matType: s.mesh.material.type, hasOnBeforeCompile: typeof s.mesh.material.onBeforeCompile === 'function' });
    if (info.length >= 4) break;
  }
  // measure actual shader source
  const m = g.world._windMaterials.values().next().value;
  return { parts: info, uniformKeys: Object.keys(m.userData) };
});
console.log(JSON.stringify(out,null,1));
await b.close();
