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
  const closest = (x,z,ring)=>{ let bx=0,bz=0,bd=Infinity;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){ const ax=ring[j][0],az=ring[j][1],cx=ring[i][0],cz=ring[i][1];
      const vx=cx-ax,vz=cz-az,len2=vx*vx+vz*vz;
      let t=len2>1e-9?((x-ax)*vx+(z-az)*vz)/len2:0; t=Math.max(0,Math.min(1,t));
      const px=ax+vx*t,pz=az+vz*t,d2=(x-px)**2+(z-pz)**2;
      if(d2<bd2v){bd2v=d2;bx=px;bz=pz;} }
    return {x:bx,z:bz}; };
  return null;
});
// simpler: replicate in node-side JS with ring data
await b.close();

// Do it in Node directly using city.json
const fs=require('fs');
