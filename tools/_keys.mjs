import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'shell', protocolTimeout:900000,
  args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.goto('http://localhost:12000/',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#start:not(.hidden)', { timeout: 300000 });
await p.click('#start-btn');
await new Promise(r=>setTimeout(r,2000));
const out = await p.evaluate(async () => {
  const label = () => document.getElementById('weapon-label').textContent;
  const seq = [label()];
  for (let i=0;i<3;i++) {
    window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyQ'}));
    await new Promise(r=>setTimeout(r,120));
    seq.push(label());
  }
  // H toggles the help panel
  const helpBefore = !document.getElementById('help').classList.contains('hidden');
  window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyH'}));
  await new Promise(r=>setTimeout(r,120));
  const helpAfter = !document.getElementById('help').classList.contains('hidden');
  return { weaponSequence: seq, helpBefore, helpAfter };
});
console.log(JSON.stringify(out,null,1));
await b.close();
