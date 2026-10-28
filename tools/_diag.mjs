import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,4000));

const out = await p.evaluate(async () => {
  const g = window.game, THREE = g.THREE || null;
  const res = {};

  // --- what is in the scene: terrain / ground / grass ---
  const names = [];
  g.scene.traverse(o => { if (o.name) names.push(o.name); });
  res.sceneNames = [...new Set(names)].slice(0, 40);
  res.meshKeys = Object.keys(g.world.meshes);
  // terrain bbox
  const terr = g.world.meshes.terrain && g.world.meshes.terrain.root ? g.world.meshes.terrain.root : g.world.meshes.terrain;
  if (terr && terr.traverse) {
    const box = new (terr.constructor === Object ? Object : Object)();
    let min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
    terr.traverse(o => { if (o.isMesh) {
      const g2 = o.geometry; g2.computeBoundingBox();
      const bb = g2.boundingBox;
      min = [Math.min(min[0],bb.min.x),Math.min(min[1],bb.min.y),Math.min(min[2],bb.min.z)];
      max = [Math.max(max[0],bb.max.x),Math.max(max[1],bb.max.y),Math.max(max[2],bb.max.z)];
    }});
    res.terrainBox = { min, max };
  } else res.terrainBox = 'NO terrain mesh';

  // --- player ground height ---
  res.playerY = g.player.position.y;
  res.playerGrounded = g.player.grounded;

  // --- vegetation animation? ---
  res.scatterCount = g.world.scatter.length;
  res.treesCount = g.world.trees;

  // --- characters ---
  res.rigKeys = Object.keys(g.agents.rigs || {});
  res.agentCount = g.agents.count;
  const a0 = [...g.agents.list?.values?.() || []][0] || null;
  res.hasAgentList = !!g.agents.list;

  return res;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
