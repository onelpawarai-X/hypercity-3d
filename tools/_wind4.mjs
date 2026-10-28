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
  for (const t of tiles) { const d=Math.hypot(t.center.x,t.center.z); if (d<bd){bd=d;best=t;} }
  const x = best.center.x + 5, z = best.center.z + 5;
  g.teleport(x, z, 0, Math.atan2(-(best.center.x-x), -(best.center.z-z)));
  await new Promise(r=>setTimeout(r,2500));

  const gl = g.renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const band = Math.floor(H*0.42);
  const grab = () => {
    g.renderer.render(g.scene, g.camera);
    const buf = new Uint8Array(W*80*4);
    gl.readPixels(0, band, W, 80, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  };
  const setWind = (v) => { for (const m of g.world._windMaterials.values()) m.userData.wind.value = v; };

  setWind(0);
  const a = grab();
  setWind(3.0);
  const c = grab();
  let changed = 0, maxd = 0;
  for (let i=0;i<a.length;i+=4) {
    const d = Math.abs(a[i]-c[i])+Math.abs(a[i+1]-c[i+1])+Math.abs(a[i+2]-c[i+2]);
    if (d > 12) changed++;
    if (d > maxd) maxd = d;
  }
  return { bandPixels: a.length/4, changedPixels: changed, percent: +(100*changed/(a.length/4)).toFixed(1), maxChannelDelta: maxd,
           treeTiles: tiles.length, windMaterials: g.world._windMaterials.size };
});
console.log(JSON.stringify(out,null,1));
await b.close();
