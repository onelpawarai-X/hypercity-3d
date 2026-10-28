import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await new Promise(r=>setTimeout(r,2000));
const out = await p.evaluate(() => {
  const res = [];
  for (const c of window.game.characterSelect.cards) {
    // render and read back in the same task, before the buffer is discarded
    c.model.setSpeed(0, 0.016);
    c.viewer.render(c.scene, c.camera);
    const gl = c.viewer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const buf = new Uint8Array(W*H*4);
    gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf);
    let lit=0, maxA=0;
    for (let i=3;i<buf.length;i+=4) { if (buf[i]>8) lit++; if (buf[i]>maxA) maxA=buf[i]; }
    res.push({ id:c.entry.id, pct:+(100*lit/(W*H)).toFixed(1), maxAlpha:maxA });
  }
  return res;
});
console.log(JSON.stringify(out));
await b.close();
