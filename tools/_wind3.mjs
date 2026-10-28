import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,6000));
const out = await p.evaluate(async () => {
  const g = window.game;
  const tiles = g.world.scatter.filter(s => s.mesh.name?.startsWith('trees_'));
  let best=tiles[0], bd=Infinity;
  for (const t of tiles) { const d=Math.hypot(t.center.x, t.center.z); if (d<bd){bd=d;best=t;} }
  const x = best.center.x + 5, z = best.center.z + 5;
  g.teleport(x, z, 0, Math.atan2(-(best.center.x-x), -(best.center.z-z)));
  await new Promise(r=>setTimeout(r,2500));

  const canvas = document.querySelector('canvas');
  const gl = g.renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  // sample a horizontal band through the middle (where foliage sits)
  const grab = () => {
    const buf = new Uint8Array(W * 64 * 4);
    gl.readPixels(0, Math.floor(H*0.45), W, 64, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  };
  const a = grab();
  const tA = g.world._windMaterials.values().next().value.userData.wind.value;
  await new Promise(r=>setTimeout(r,2000));
  const c = grab();
  const tB = g.world._windMaterials.values().next().value.userData.wind.value;
  let changed = 0;
  for (let i=0;i<a.length;i+=4) if (Math.abs(a[i]-c[i])+Math.abs(a[i+1]-c[i+1])+Math.abs(a[i+2]-c[i+2]) > 12) changed++;
  return { windTimeAdvanced: +(tB-tA).toFixed(2), bandPixels: a.length/4, changedPixels: changed,
           percentChanged: +(100*changed/(a.length/4)).toFixed(1) };
});
console.log(JSON.stringify(out,null,1));
await b.close();
