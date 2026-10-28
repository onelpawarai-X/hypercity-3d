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
  // Read actual instance positions from a tree tile and stand next to one.
  const tile = g.world.scatter.find(s => s.mesh.name?.startsWith('trees_tree_bark'));
  const inst = tile.mesh;
  const m4 = new (inst.matrixWorld.constructor)();
  inst.getMatrixAt(0, m4);
  const tx = m4.elements[12], tz = m4.elements[14];
  g.teleport(tx + 6, tz + 6, 0, Math.atan2(-(tx - (tx+6)), -(tz - (tz+6))));
  await new Promise(r=>setTimeout(r,3000));

  const gl = g.renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const band = 0;
  const setWind = (v) => { for (const m of g.world._windMaterials.values()) m.userData.wind.value = v; };
  const grab = () => { g.renderer.render(g.scene, g.camera);
    const buf = new Uint8Array(W*H*4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf); return buf; };
  setWind(0); const a = grab();
  setWind(2.5); const c = grab();
  let changed=0, maxd=0;
  for (let i=0;i<a.length;i+=4){ const d=Math.abs(a[i]-c[i])+Math.abs(a[i+1]-c[i+1])+Math.abs(a[i+2]-c[i+2]);
    if(d>10)changed++; if(d>maxd)maxd=d; }
  return { treeAt:[+tx.toFixed(1), +tz.toFixed(1)], cameraAt:[+g.player.position.x.toFixed(1), +g.player.position.z.toFixed(1)],
    bandPixels:a.length/4, changedPixels:changed, percent:+(100*changed/(a.length/4)).toFixed(1), maxChannelDelta:maxd };
});
console.log(JSON.stringify(out,null,1));
await b.close();
