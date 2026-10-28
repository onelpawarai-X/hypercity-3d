import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
const errs=[]; p.on('pageerror', e=>errs.push(e.message));
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await new Promise(r=>setTimeout(r,2500));
const out = await p.evaluate(() => {
  const cards = window.game.characterSelect.cards;
  const res = cards.map(c => {
    const gl = c.viewer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const buf = new Uint8Array(W*H*4);
    gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf);
    let lit=0;
    for (let i=3;i<buf.length;i+=4) if (buf[i] > 8) lit++;
    return { id: c.entry.id, pixels: W*H, lit, pct: +(100*lit/(W*H)).toFixed(1),
             clip: c.model?.state, hasIdle: !!c.model?.idleName };
  });
  return res;
});
console.log(JSON.stringify(out,null,1));
console.log('ERR', errs.slice(0,3));
await b.close();
