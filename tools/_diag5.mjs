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

// ---- terrain + roads real bbox (chunk.mesh, singular) ----
const geo = await p.evaluate(() => {
  const g = window.game;
  const box = (chunked) => {
    let min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity], vis=0, tot=0;
    for (const c of chunked.chunks) {
      const m = c.mesh; if (!m) continue;
      tot++; if (m.visible) vis++;
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox.clone(); bb.applyMatrix4(m.matrixWorld);
      min=[Math.min(min[0],bb.min.x),Math.min(min[1],bb.min.y),Math.min(min[2],bb.min.z)];
      max=[Math.max(max[0],bb.max.x),Math.max(max[1],bb.max.y),Math.max(max[2],bb.max.z)];
    }
    return { total: tot, visible: vis, min: min.map(v=>+v.toFixed(1)), max: max.map(v=>+v.toFixed(1)) };
  };
  return {
    terrain: box(g.world.meshes.terrain),
    roads: box(g.world.meshes.roads),
    buildings: box(g.world.meshes.buildings),
  };
});
console.log('GEOMETRY', JSON.stringify(geo));

// ---- outdoor wall test, correct yaw (forward = (-sin,-cos)) ----
await p.evaluate(() => { const g=window.game; const rp=g.world.randomRoadPoint(); g.teleport(rp.x,rp.z,0,rp.yaw); });
await new Promise(r=>setTimeout(r,1500));
const setup = await p.evaluate(() => {
  const g = window.game;
  const px=g.player.position.x, pz=g.player.position.z;
  let best=null,bd=Infinity;
  for (const bld of g.world.buildings) {
    const cx=(bld.minX+bld.maxX)/2, cz=(bld.minZ+bld.maxZ)/2;
    const d=Math.hypot(cx-px,cz-pz);
    if (d>6 && d<bd) { bd=d; best={id:bld.id,minX:bld.minX,maxX:bld.maxX,minZ:bld.minZ,maxZ:bld.maxZ,h:bld.height}; }
  }
  const cx=(best.minX+best.maxX)/2, cz=(best.minZ+best.maxZ)/2;
  const dx=cx-px, dz=cz-pz, len=Math.hypot(dx,dz);
  g.player.position.set(px+dx/len*1.5, 0, pz+dz/len*1.5);
  g.player.cameraYaw = Math.atan2(-dx, -dz);   // forward = (-sin,-cos)
  window.__b = best;
  return { building: best, start:{x:+g.player.position.x.toFixed(1),z:+g.player.position.z.toFixed(1)} };
});
await hold(['KeyW'], 5000);
const wall = await p.evaluate(() => {
  const g=window.game, b=window.__b;
  const a={x:g.player.position.x,z:g.player.position.z};
  return { end:{x:+a.x.toFixed(1),z:+a.z.toFixed(1)},
    INSIDE: a.x>b.minX&&a.x<b.maxX&&a.z>b.minZ&&a.z<b.maxZ,
    moved:+Math.hypot(a.x-b.minX,0).toFixed(1) };
});
console.log('WALL', JSON.stringify({ setup, wall }));

// ---- interior: door gap actually open? furniture count? ----
const interior = await p.evaluate(async () => {
  const g=window.game;
  let found=null;
  for (const b of g.world.buildings) {
    if (g.world.buildingAt((b.minX+b.maxX)/2,(b.minZ+b.maxZ)/2,8)) { found=b; break; }
  }
  g._enterInterior(found);
  await new Promise(r=>setTimeout(r,1000));
  const it=g.interiors.active;
  // count wall/furniture meshes and find the door gap in the collider set
  const meshes = it.root.children.filter(c=>c.isMesh);
  return {
    colliders: it.colliders.length,
    meshChildren: meshes.length,
    door: it.doorAt, doorSide: it.doorSide, doorWidth: it.doorWidth,
    bounds: {x0:+it.bounds.x0.toFixed(1),x1:+it.bounds.x1.toFixed(1),z0:+it.bounds.z0.toFixed(1),z1:+it.bounds.z1.toFixed(1)},
    player: {x:+g.player.position.x.toFixed(1),z:+g.player.position.z.toFixed(1),y:+g.player.position.y.toFixed(1)},
  };
});
console.log('INTERIOR', JSON.stringify(interior));

// walk out the door
await p.evaluate(() => {
  const g=window.game, it=g.interiors.active;
  // face the doorway and walk at it
  const o = {north:[0,-1],south:[0,1],west:[-1,0],east:[1,0]}[it.doorSide];
  g.player.cameraYaw = Math.atan2(-o[0], -o[1]);
});
await hold(['KeyW'], 4000);
const outRes = await p.evaluate(() => ({ indoors: window.game.player.indoors, y: window.game.player.position.y }));
console.log('WALKOUT', JSON.stringify(outRes));
await b.close();
