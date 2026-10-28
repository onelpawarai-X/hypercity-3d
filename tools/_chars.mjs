import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
const out = await p.evaluate(() => {
  const g = window.game;
  const res = {};
  for (const [name, rig] of g.characterCache) {
    res[name] = { clips: Object.keys(rig.clips).length, names: Object.keys(rig.clips).slice(0,8),
                  anims: rig.source.animations.length };
  }
  return { cached: res, models: Object.keys(g.characterCache) };
});
console.log(JSON.stringify(out,null,1));
await b.close();
