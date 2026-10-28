import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await p.screenshot({ path: '/tmp/s0-menu.png' });
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,3000));
await p.screenshot({ path: '/tmp/s1-street.png' });

await p.evaluate(async () => {
  const g = window.game;
  const rp = g.world.randomRoadPoint();
  g.teleport(rp.x, rp.z, 0, rp.yaw);
  g.player.thirdPerson = true;
});
await new Promise(r=>setTimeout(r,2500));
await p.screenshot({ path: '/tmp/s2-walk.png' });

await p.evaluate(async () => {
  const g = window.game;
  const rp = g.world.randomRoadPoint();
  g.teleport(rp.x, rp.z, 0, rp.yaw);
  const v = await g.spawnVehicle('car', rp.x + 5, rp.z, rp.yaw);
  g._enterVehicle(v);
});
await new Promise(r=>setTimeout(r,2500));
await p.screenshot({ path: '/tmp/s3-car.png' });

await p.evaluate(async () => {
  const g = window.game;
  g._exitVehicle();
  const bd = g.world.buildings.find(x=>(x.maxX-x.minX)>12&&(x.maxZ-x.minZ)>12);
  g._enterInterior(bd);
});
await new Promise(r=>setTimeout(r,2500));
await p.screenshot({ path: '/tmp/s4-interior.png' });

await p.evaluate(async () => {
  const g = window.game;
  g._exitInterior();
  const rp = g.world.randomRoadPoint();
  g.teleport(rp.x, rp.z, 0, rp.yaw);
  for (let i=0;i<6;i++) await g.agents.create('skeleton', g.player.position.x+2+i*1.5, g.player.position.z+2, 0, {controlMode:'auto', faction:'gang'});
});
await new Promise(r=>setTimeout(r,9000));
await p.screenshot({ path: '/tmp/s5-fight.png' });

await p.evaluate(async () => {
  const g = window.game;
  g.teleport(0, 0, 0, 0);
  const v = await g.spawnVehicle('helicopter', 8, 0, 0);
  g._enterVehicle(v);
  g.input.setVirtual('Space', true);
});
await new Promise(r=>setTimeout(r,6000));
await p.evaluate(()=>window.game.input.setVirtual('Space', false));
await new Promise(r=>setTimeout(r,1500));
await p.screenshot({ path: '/tmp/s6-heli.png' });
await b.close();
console.log('shots done');
