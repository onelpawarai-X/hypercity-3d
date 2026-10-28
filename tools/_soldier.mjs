import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
const out = await p.evaluate(async () => {
  const mod = await import('/src/utils.js');
  const res = {};
  for (const f of ['soldier','pedestrian']) {
    try {
      const gltf = await mod.loadGLTF(`/assets/characters/${f}.glb`);
      res[f] = { anims: gltf.animations.map(a=>a.name) };
    } catch(e) { res[f] = 'ERR '+e.message; }
  }
  return res;
});
console.log(JSON.stringify(out,null,1));
await b.close();
