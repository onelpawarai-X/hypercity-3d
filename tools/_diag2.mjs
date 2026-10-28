import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,4000));
const out = await p.evaluate(() => {
  const g = window.game;
  const r = {};
  const t = g.world.meshes.terrain;
  r.terrainCtor = t && t.constructor.name;
  r.terrainKeys = t ? Object.keys(t) : null;
  r.terrainStats = t && t.stats ? t.stats : null;
  // chunk list
  if (t && t.chunks) r.chunkCount = t.chunks.length;
  // Look for any mesh in world group whose geometry spans large area and is near y=0
  let groundMeshes = [];
  g.world.group.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    const dy = bb.max.y - bb.min.y;
    const dx = bb.max.x - bb.min.x, dz = bb.max.z - bb.min.z;
    if (bb.min.y < 1.0 && bb.max.y < 12 && (dx > 50 || dz > 50)) {
      groundMeshes.push({ name: o.name, mat: o.material?.name, minY: +bb.min.y.toFixed(2), maxY: +bb.max.y.toFixed(2), dx: Math.round(dx), dz: Math.round(dz), visible: o.visible });
    }
  });
  r.groundMeshes = groundMeshes.slice(0, 20);
  r.groundMeshCount = groundMeshes.length;
  r.worldVisible = g.world.group.visible;
  // vegetation animation: check for any mixer / skeleton on trees
  let animObjs = 0, skinned = 0;
  g.world.group.traverse(o => { if (o.isSkinnedMesh) skinned++; if (o.userData && o.userData.mixer) animObjs++; });
  r.skinnedInWorld = skinned;
  r.animatedInWorld = animObjs;
  return r;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
