import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
for (const vp of [{width:1280,height:800,name:'desktop'},{width:390,height:844,name:'phone'}]) {
  const p = await b.newPage();
  await p.setViewport(vp);
  await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
  await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
  await new Promise(r=>setTimeout(r,1500));
  const out = await p.evaluate(() => {
    const card = document.querySelector('.start-card');
    const cs = getComputedStyle(card);
    const r = card.getBoundingClientRect();
    const cards = [...document.querySelectorAll('.roster-card')].map(c=>{const b=c.getBoundingClientRect();return [Math.round(b.width),Math.round(b.height)];});
    return { cardW: Math.round(r.width), cardH: Math.round(r.height),
      overflowY: r.height > window.innerHeight, fits: r.bottom <= window.innerHeight + 1 && r.top >= -1,
      gridCols: getComputedStyle(document.getElementById('roster')).gridTemplateColumns.split(' ').length,
      cards, btnVisible: document.getElementById('start-btn').getBoundingClientRect().bottom <= window.innerHeight+1 };
  });
  console.log(vp.name, JSON.stringify(out));
  await p.screenshot({path:`/tmp/select-${vp.name}.png`});
  await p.close();
}
await b.close();
