import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,4000));
const out = await p.evaluate(() => {
  const g = window.game, R = 0.42;
  const pip = (x,z,ring)=>{ let ins=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){ const xi=ring[i][0],zi=ring[i][1],xj=ring[j][0],zj=ring[j][1];
      if((zi>z)!==(zj>z) && x < ((xj-xi)*(z-zi))/(zj-zi)+xi) ins=!ins; } return ins; };
  const bld = g.world.buildings.find(b=>b.id==='way/220656015');
  const cx=(bld.minX+bld.maxX)/2, cz=(bld.minZ+bld.maxZ)/2;
  const near = g.world.buildingGrid.query(cx, cz, R+60);
  const insideList = near.filter(b2 => pip(cx, cz, b2.ring)).map(b2=>({id:b2.id, size:[+(b2.maxX-b2.minX).toFixed(1),+(b2.maxZ-b2.minZ).toFixed(1)]}));
  const r = g.world.resolveCollision(cx, cz, R);
  return {
    center: [+cx.toFixed(1), +cz.toFixed(1)],
    nearCount: near.length,
    insideCount: insideList.length,
    insideList: insideList.slice(0,8),
    result: [+r.x.toFixed(2), +r.z.toFixed(2)],
    resultInsideOurBuilding: pip(r.x, r.z, bld.ring),
    resultInsideWhich: near.filter(b2=>pip(r.x,r.z,b2.ring)).map(b2=>b2.id),
  };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
