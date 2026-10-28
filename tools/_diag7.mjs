import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,3000));

const out = await p.evaluate(async () => {
  // Load the raw GLB through the game's own loader and inspect node transforms.
  const mod = await import('/src/utils.js');
  const gltf = await mod.loadGLTF('/assets/city/terrain.glb');
  gltf.scene.updateMatrixWorld(true);
  const rows = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const e = o.matrixWorld.elements;
    const sx = Math.hypot(e[0], e[1], e[2]);
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    const pos = o.geometry.attributes.position;
    rows.push({
      name: o.name,
      parentName: o.parent && o.parent.name,
      nodeScale: o.scale.toArray().map(v => +v.toFixed(1)),
      matrixWorldScale: +sx.toFixed(2),
      matrixWorldPos: [ +e[12].toFixed(1), +e[13].toFixed(1), +e[14].toFixed(1) ],
      posType: pos.array.constructor.name,
      posNormalized: !!pos.normalized,
      posCount: pos.count,
      geoBox: [[+bb.min.x.toFixed(2),+bb.min.y.toFixed(2),+bb.min.z.toFixed(2)],
               [+bb.max.x.toFixed(2),+bb.max.y.toFixed(2),+bb.max.z.toFixed(2)]],
    });
  });
  return rows;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
