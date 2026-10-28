import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,4000));

const hold = async (keys, ms) => {
  await p.evaluate(k => k.forEach(x => window.game.input.setVirtual(x, true)), keys);
  await new Promise(r => setTimeout(r, ms));
  await p.evaluate(k => k.forEach(x => window.game.input.setVirtual(x, false)), keys);
};

const out = await p.evaluate(() => {
  const g = window.game;
  const r = {};
  // terrain chunk world bounds
  const t = g.world.meshes.terrain;
  let min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity], vis=0, tot=0;
  t.chunks.forEach(c => (c.meshes||[]).forEach(m => {
    tot++;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox.clone();
    bb.applyMatrix4(m.matrixWorld);
    min=[Math.min(min[0],bb.min.x),Math.min(min[1],bb.min.y),Math.min(min[2],bb.min.z)];
    max=[Math.max(max[0],bb.max.x),Math.max(max[1],bb.max.y),Math.max(max[2],bb.max.z)];
    if (m.visible) vis++;
  }));
  r.terrainWorldBox = { min: min.map(v=>+v.toFixed(1)), max: max.map(v=>+v.toFixed(1)) };
  r.terrainChunkMeshes = { total: tot, visible: vis };
  // roads bbox
  const rd = g.world.meshes.roads;
  let rmin=[Infinity,Infinity,Infinity], rmax=[-Infinity,-Infinity,-Infinity], rvis=0, rtot=0;
  rd.chunks.forEach(c => (c.meshes||[]).forEach(m => {
    rtot++;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox.clone(); bb.applyMatrix4(m.matrixWorld);
    rmin=[Math.min(rmin[0],bb.min.x),Math.min(rmin[1],bb.min.y),Math.min(rmin[2],bb.min.z)];
    rmax=[Math.max(rmax[0],bb.max.x),Math.max(rmax[1],bb.max.y),Math.max(rmax[2],bb.max.z)];
    if (m.visible) rvis++;
  }));
  r.roadsWorldBox = { min: rmin.map(v=>+v.toFixed(1)), max: rmax.map(v=>+v.toFixed(1)) };
  r.roadsChunkMeshes = { total: rtot, visible: rvis };
  r.interiorOrigin = g.world.meshes ? undefined : undefined;
  return r;
});

// --- outdoor wall test with real input ---
await p.evaluate(() => {
  const g = window.game;
  const rp = g.world.randomRoadPoint();
  g.teleport(rp.x, rp.z, 0, rp.yaw);
});
await new Promise(r=>setTimeout(r,1500));
const setup = await p.evaluate(() => {
  const g = window.game;
  const px = g.player.position.x, pz = g.player.position.z;
  let best=null, bd=Infinity;
  for (const bld of g.world.buildings) {
    const cx=(bld.minX+bld.maxX)/2, cz=(bld.minZ+bld.maxZ)/2;
    const d=Math.hypot(cx-px,cz-pz);
    if (d>6 && d<bd) { bd=d; best={id:bld.id,cx,cz,minX:bld.minX,maxX:bld.maxX,minZ:bld.minZ,maxZ:bld.maxZ,h:bld.height}; }
  }
  if (!best) return null;
  const dx=best.cx-px, dz=best.cz-pz, len=Math.hypot(dx,dz);
  const sx=px+(dx/len)*1.5, sz=pz+(dz/len)*1.5;
  g.player.position.set(sx,0,sz);
  g.player.cameraYaw = Math.atan2(dx,dz);
  window.__bld = best;
  return { start:{x:+sx.toFixed(1),z:+sz.toFixed(1)}, building:best };
});
await hold(['KeyW'], 4000);
const wall = await p.evaluate(() => {
  const g=window.game, b=window.__bld;
  const a={x:g.player.position.x,z:g.player.position.z};
  return { end:{x:+a.x.toFixed(1),z:+a.z.toFixed(1)},
    INSIDE: a.x>b.minX && a.x<b.maxX && a.z>b.minZ && a.z<b.maxZ,
    distToCentre:+Math.hypot(a.x-(b.minX+b.maxX)/2, a.z-(b.minZ+b.maxZ)/2).toFixed(1) };
});
out.outdoorWallTest = { setup, wall };

// --- interior test ---
const inner = await p.evaluate(() => {
  const g=window.game;
  const rp=g.world.randomRoadPoint();
  g.teleport(rp.x,rp.z,0,rp.yaw);
  return {x:rp.x,z:rp.z};
});
await new Promise(r=>setTimeout(r,800));
const interior = await p.evaluate(async () => {
  const g=window.game;
  // find a building the prompt would accept and enter it directly
  let found=null;
  for (const b of g.world.buildings) {
    if (g.world.buildingAt((b.minX+b.maxX)/2,(b.minZ+b.maxZ)/2,8)) { found=b; break; }
  }
  if (!found) return {err:'no enterable building found'};
  g._enterInterior(found);
  await new Promise(r=>setTimeout(r,1200));
  const it = g.interiors.active;
  return {
    entered: !!it,
    colliders: it ? it.colliders.length : 0,
    hasDoor: !!(it && it.doorAt),
    doorWidth: it ? it.doorWidth : null,
    bounds: it ? {x0:+it.bounds.x0.toFixed(1),x1:+it.bounds.x1.toFixed(1),z0:+it.bounds.z0.toFixed(1),z1:+it.bounds.z1.toFixed(1)} : null,
    playerPos: {x:+g.player.position.x.toFixed(1),z:+g.player.position.z.toFixed(1),y:+g.player.position.y.toFixed(1)},
    childCount: it ? it.root.children.length : 0,
    furnitureMeshes: it ? it.root.children.filter(c=>c.isMesh).length : 0,
  };
});
out.interior = interior;
console.log(JSON.stringify(out, null, 1));
await b.close();
