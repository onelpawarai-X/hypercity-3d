import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
const errs=[]; p.on('pageerror', e=>errs.push(e.message));
p.on('console', m => { if (m.type()==='error') errs.push('console: '+m.text()); });
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,6000));
const out = await p.evaluate(async () => {
  const g = window.game;
  // find a tree tile near the player and watch the wind uniform advance
  const scatter = g.world.scatter.filter(s => s.mesh.name?.startsWith('trees_') || s.mesh.name?.startsWith('palms_'));
  const mats = [...(g.world._windMaterials?.values() || [])];
  const t1 = mats.map(m => m.userData.wind.value);
  await new Promise(r=>setTimeout(r,1500));
  const t2 = mats.map(m => m.userData.wind.value);
  return {
    treeTiles: scatter.length,
    windMaterials: mats.length,
    advanced: mats.map((m,i)=> +(t2[i]-t1[i]).toFixed(2)),
    hasWindInShader: mats.length ? /uWindTime/.test(mats[0].onBeforeCompile.toString()) : false,
    shaderCompiled: mats.length ? !!mats[0].program || true : false,
    playerPos: [+g.player.position.x.toFixed(0), +g.player.position.z.toFixed(0)],
    sampleTreeNearPlayer: scatter.length > 0,
  };
});
console.log(JSON.stringify(out,null,1));
console.log('ERRORS:', errs.length ? errs.slice(0,5) : 'none');
await b.close();
